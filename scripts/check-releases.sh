#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────
# check-releases.sh — Compare current dependency versions against the
# latest available from npm and container registries.
# Usage: ./scripts/check-releases.sh [--create-issue]
# ──────────────────────────────────────────────────────────────────────

CREATE_ISSUE=false
[[ "${1:-}" == "--create-issue" ]] && CREATE_ISSUE=true

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PKG_JSON="$ROOT_DIR/package.json"
ENV_FILE="$ROOT_DIR/.env"

# ── Helpers ──────────────────────────────────────────────────────────

has() { command -v "$1" &>/dev/null; }

need() {
  for cmd in "$@"; do
    if ! has "$cmd"; then
      echo "❌ Required tool '$cmd' not found." >&2
      exit 1
    fi
  done
}

need jq curl

# Get the current version of an npm dependency from package.json
# Strips semver range chars (^, ~, >=, etc.)
current_npm() {
  local dep="$1"
  jq -r "(.dependencies[\"$dep\"] // .devDependencies[\"$dep\"] // \"?\") | ltrimstr(\"^\") | ltrimstr(\"~\") | ltrimstr(\">=\")" "$PKG_JSON"
}

# Get the latest version from the npm registry
latest_npm() {
  local dep="$1"
  local tag="${2:-latest}"
  local url="https://registry.npmjs.org/$dep"
  curl -sf "$url" | jq -r ".\"dist-tags\".\"$tag\" // .\"dist-tags\".latest // \"?\"" 2>/dev/null || echo "?"
}

# Get current Docker image tag from .env
current_env() {
  local var="$1"
  if [[ -f "$ENV_FILE" ]]; then
    grep -oP "^${var}=\K.*" "$ENV_FILE" | head -1 || echo "?"
  else
    echo "?"
  fi
}

# Extract tag from a full image reference (e.g. ghcr.io/foo/bar:tag → tag)
tag_from_image() {
  local img="$1"
  echo "${img##*:}"
}

# Get the latest tag for a GHCR image via OCI distribution API
# Paginates through all tags to find the highest semver
latest_ghcr_tag() {
  local image="$1" # e.g. cardano-scaling/hydra-node
  local token all_tags=() url last_tag
  token=$(ghcr_token "$image")
  url="https://ghcr.io/v2/${image}/tags/list"

  while [[ -n "$url" ]]; do
    local response headers
    response=$(curl -sf -D - -H "Authorization: Bearer $token" "$url" 2>/dev/null) || { echo "?"; return; }
    headers=$(echo "$response" | sed '/^\r$/q')
    local body
    body=$(echo "$response" | sed '1,/^\r$/d')
    local page_tags
    page_tags=$(echo "$body" | jq -r '.tags[]' 2>/dev/null) || break
    while IFS= read -r t; do
      [[ -n "$t" ]] && all_tags+=("$t")
    done <<< "$page_tags"
    # Check for Link header with next page
    local link
    link=$(echo "$headers" | grep -i '^link:' | grep -oP '<[^>]+>' | tr -d '<>' || echo "")
    if [[ -n "$link" ]]; then
      url="https://ghcr.io${link}"
    else
      url=""
    fi
  done

  # Filter to strict semver, sort numerically, return highest
  printf '%s\n' "${all_tags[@]}" \
    | grep -xE '[0-9]+\.[0-9]+\.[0-9]+' \
    | sort -t. -k1,1n -k2,2n -k3,3n \
    | tail -1 || echo "?"
}

# Get an anonymous token for GHCR
ghcr_token() {
  local image="$1"
  curl -sf "https://ghcr.io/token?scope=repository:${image}:pull" | jq -r '.token // ""' 2>/dev/null || echo ""
}

# Get latest commit SHA for a GHCR image that uses commit-based tags
latest_ghcr_commit() {
  local image="$1"
  local url="https://ghcr.io/v2/${image}/tags/list"
  local tags
  tags=$(curl -sf -H "Authorization: Bearer $(ghcr_token "$image")" "$url" 2>/dev/null) || { echo "?"; return; }
  # Filter for 40-char hex strings (commit SHAs), return the last one
  echo "$tags" | jq -r '.tags | map(select(test("^[0-9a-f]{40}$"))) | last // "?"' 2>/dev/null || echo "?"
}

# ── Collect versions ─────────────────────────────────────────────────

declare -a ROWS=()
HAS_UPDATE=false

check_npm() {
  local name="$1"
  local tag="${2:-latest}"
  local current latest status
  current=$(current_npm "$name")
  latest=$(latest_npm "$name" "$tag")
  if [[ "$current" == "$latest" ]]; then
    status="✅ up to date"
  elif [[ "$latest" == "?" ]]; then
    status="⚠️  could not fetch"
  else
    status="🔄 update available"
    HAS_UPDATE=true
  fi
  ROWS+=("| $name | npm | \`$current\` | \`$latest\` | $status |")
}

check_ghcr() {
  local name="$1"
  local env_var="$2"
  local ghcr_image="$3"
  local current_image current latest status
  current_image=$(current_env "$env_var")
  current=$(tag_from_image "$current_image")
  latest=$(latest_ghcr_tag "$ghcr_image")
  if [[ "$current" == "$latest" ]]; then
    status="✅ up to date"
  elif [[ "$latest" == "?" ]]; then
    status="⚠️  could not fetch"
  else
    status="🔄 update available"
    HAS_UPDATE=true
  fi
  ROWS+=("| $name | ghcr | \`$current\` | \`$latest\` | $status |")
}

check_ghcr_commit() {
  local name="$1"
  local env_var="$2"
  local ghcr_image="$3"
  local current_image current latest status
  current_image=$(current_env "$env_var")
  current=$(tag_from_image "$current_image")
  latest=$(latest_ghcr_commit "$ghcr_image")
  if [[ "$current" == "$latest" ]]; then
    status="✅ up to date"
  elif [[ "$latest" == "?" ]]; then
    status="⚠️  could not fetch"
  else
    status="🔄 new commit"
    HAS_UPDATE=true
  fi
  # Shorten SHAs for readability
  local cur_short="${current:0:12}" lat_short="${latest:0:12}"
  ROWS+=("| $name | ghcr (commit) | \`$cur_short\` | \`$lat_short\` | $status |")
}

# ── npm dependencies ─────────────────────────────────────────────────

check_npm "@meshsdk/core" "beta"
check_npm "@meshsdk/hydra" "beta"
check_npm "@meshsdk/core-csl" "beta"
check_npm "@emurgo/cardano-serialization-lib-nodejs"
check_npm "@emurgo/cardano-message-signing-nodejs"
check_npm "tx3-sdk"
check_npm "express"
check_npm "typescript"
check_npm "@noble/hashes"

# ── Docker images ────────────────────────────────────────────────────

check_ghcr "cardano-node" "CARDANO_IMAGE" "blinklabs-io/cardano-node"
check_ghcr "hydra-node" "HYDRA_IMAGE" "cardano-scaling/hydra-node"
check_ghcr_commit "tx3-hydra (TRP)" "HYDRA_TRP_IMAGE" "tx3-lang/tx3-hydra"

# ── Output ───────────────────────────────────────────────────────────

TABLE="| Dependency | Type | Current | Latest | Status |
|---|---|---|---|---|"

for row in "${ROWS[@]}"; do
  TABLE="$TABLE
$row"
done

echo "$TABLE"

# ── Optionally create GitHub issue ───────────────────────────────────

if [[ "$CREATE_ISSUE" == true ]] && [[ "$HAS_UPDATE" == true ]]; then
  if ! has gh; then
    echo "⚠️  gh CLI not found — skipping issue creation." >&2
    exit 0
  fi

  TITLE="Dependency updates available ($(date +%Y-%m-%d))"
  LABEL="dependency-update"

  # Ensure label exists
  gh label create "$LABEL" --description "Automated dependency update notice" --color "0075ca" 2>/dev/null || true

  # Check for existing open issue with same label
  EXISTING=$(gh issue list --label "$LABEL" --state open --limit 1 --json number -q '.[0].number // empty' 2>/dev/null || echo "")
  if [[ -n "$EXISTING" ]]; then
    echo "ℹ️  Open issue #$EXISTING already exists — updating comment."
    gh issue comment "$EXISTING" --body "$(cat <<EOF
## Updated dependency report — $(date +%Y-%m-%d)

$TABLE
EOF
)"
  else
    gh issue create \
      --title "$TITLE" \
      --label "$LABEL" \
      --body "$(cat <<EOF
## Dependency update report

$TABLE

---
*Generated by \`scripts/check-releases.sh\` — $(date -u +%Y-%m-%dT%H:%M:%SZ)*
EOF
)"
    echo "✅ Created new issue."
  fi
elif [[ "$CREATE_ISSUE" == true ]]; then
  echo "✅ All dependencies are up to date — no issue needed."
fi
