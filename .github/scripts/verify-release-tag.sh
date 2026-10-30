#!/usr/bin/env bash
# Verify a release tag before anything is published from it.
# Usage: verify-release-tag.sh <tag>
# Reads GITHUB_REPOSITORY and GH_TOKEN from the environment. Run it inside a
# clone that has the tag and origin/main fetched. When GITHUB_OUTPUT is set it
# also writes the package name, directory and version the tag names.
set -euo pipefail

TAG="${1:?usage: verify-release-tag.sh <tag>}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"

fail() {
  echo "::error::$1"
  exit 1
}

# Tag to package: the tag is <package name>@<version>.
NAME="${TAG%@*}"
VERSION="${TAG##*@}"
case "$NAME" in
  @lerna-labs/hydra-sdk) DIR=packages/core ;;
  @lerna-labs/hydra-proof) DIR=packages/proof ;;
  *) fail "Tag $TAG does not name a releasable package (expected @lerna-labs/hydra-sdk@X.Y.Z or @lerna-labs/hydra-proof@X.Y.Z)." ;;
esac
[ "$NAME@$VERSION" = "$TAG" ] && [ -n "$VERSION" ] || fail "Tag $TAG is not of the form <package>@<version>."

# 1. The ref must be an annotated tag object, not a lightweight tag.
type=$(gh api "repos/$REPO/git/ref/tags/$TAG" --jq .object.type) || fail "Tag $TAG was not found in $REPO."
[ "$type" = "tag" ] || fail "Tag $TAG is a lightweight tag (ref points at a $type). Create it with 'git tag -s'."
object_sha=$(gh api "repos/$REPO/git/ref/tags/$TAG" --jq .object.sha)

# 2. GitHub must report the tag object's signature as verified.
verified=$(gh api "repos/$REPO/git/tags/$object_sha" --jq .verification.verified)
if [ "$verified" != "true" ]; then
  reason=$(gh api "repos/$REPO/git/tags/$object_sha" --jq .verification.reason)
  fail "Tag $TAG signature is not verified by GitHub (reason: $reason)."
fi

# 3. The tagged commit must be an ancestor of origin/main.
commit=$(git rev-parse "refs/tags/$TAG^{commit}") || fail "Tag $TAG is not fetched locally."
git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null || fail "origin/main is not fetched."
git merge-base --is-ancestor "$commit" refs/remotes/origin/main || fail "Tagged commit $commit is not an ancestor of origin/main."

# 4. The tag version must equal the version in the tagged package's package.json.
pkg_version=$(git show "$commit:$DIR/package.json" | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version') || fail "Could not read $DIR/package.json at $commit."
[ "$pkg_version" = "$VERSION" ] || fail "Tag version $VERSION does not match $DIR/package.json version $pkg_version at $commit."

echo "Tag $TAG verified: annotated, signed, on main, version $VERSION."
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "name=$NAME"
    echo "dir=$DIR"
    echo "version=$VERSION"
  } >>"$GITHUB_OUTPUT"
fi
