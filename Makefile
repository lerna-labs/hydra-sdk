SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

# Load base .env
ifneq (,$(wildcard .env))
    include .env
endif

# Optional override: .${NETWORK}.env (e.g., .preprod.env)
ifneq (,$(wildcard .$(NETWORK).env))
    include .$(NETWORK).env
endif

# Optional per-instance override, e.g. .mainnet.alpha.env
ifneq (,$(wildcard .$(NETWORK).$(INSTANCE).env))
    include .$(NETWORK).$(INSTANCE).env
endif

# blank export exports all environment variables for use in other commands
export
export DOCKER_BUILDKIT := 1

# ── Directory Layout ─────────────────────────────────────────────────
#
#   data/
#     {network}/
#       config/              Static network config (git-tracked)
#       node/                Cardano node ledger DB + socket (gitignored)
#       tls/                 TLS certificates (gitignored)
#       instances/           Per-Hydra-head isolation (gitignored)
#         .counter           Port offset tracker
#         {instance}/
#           keys/            Hydra + Cardano signing/verification keys
#           hydra/           Hydra persistence state
#           config/          Instance-specific TRP config (trp.toml)
#
#   scripts/                 Automation tools only (git-tracked)
#
# ── Instance Lifecycle ───────────────────────────────────────────────
#
#   1. make NETWORK=preprod INSTANCE=alpha create-instance
#      → generates .preprod.alpha.env, keys, sets HYDRA_ADMIN_KEY_FILE
#   2. make NETWORK=preprod INSTANCE=alpha hydra-start
#      → starts hydra-node, hydra-trp, express-api for that instance
#
# ── Environment Layering ─────────────────────────────────────────────
#
#   .env                     Base (images, common settings)
#   .{NETWORK}.env           Network-specific (ports, tx IDs, DATA_DIR)
#   .{NETWORK}.{INSTANCE}.env  Instance-specific (port offsets, API keys)
#
# ── Port Offset Logic ────────────────────────────────────────────────
#
#   Each instance gets a unique port offset added to the base ports
#   defined in .{NETWORK}.env. The offset is auto-incremented via
#   data/{network}/instances/.counter, or can be passed manually:
#     make NETWORK=preprod INSTANCE=beta gen-instance-env OFFSET=3
#
# ─────────────────────────────────────────────────────────────────────

DATA_DIR_LOCAL := data/$(NETWORK)
INSTANCE_DIR := $(DATA_DIR_LOCAL)/instances/$(INSTANCE)
KEY_DIR := $(INSTANCE_DIR)/keys
export KEY_ROOT := /$(NETWORK)/keys/$(INSTANCE)

TLS_DIR := $(DATA_DIR_LOCAL)/tls
TLS_CERT := $(TLS_DIR)/hydraCert.pem
TLS_KEY := $(TLS_DIR)/hydraKey.pem

CONFIG_DIR := $(DATA_DIR_LOCAL)/config

CARDANO_COMPOSE := docker/docker-compose.cardano.yml
CARDANO_PROJECT := cardano-$(NETWORK)
DOCKER_CARDANO := docker compose -f $(CARDANO_COMPOSE) -p $(CARDANO_PROJECT)

IPFS_COMPOSE := docker/docker-compose.ipfs.yml
IPFS_PROJECT := ipfs
DOCKER_IPFS := docker compose -f $(IPFS_COMPOSE) -p $(IPFS_PROJECT)

HYDRA_COMPOSE := docker/docker-compose.$(NETWORK).yml
HYDRA_PROJECT := hydra-$(NETWORK)-$(INSTANCE)
DOCKER_HYDRA := docker compose -f $(HYDRA_COMPOSE) -p $(HYDRA_PROJECT)

MONITORING_COMPOSE := docker/docker-compose.monitoring.yml
MONITORING_PROJECT := monitoring
DOCKER_MONITORING := docker compose -f $(MONITORING_COMPOSE) -p $(MONITORING_PROJECT)

# List of make commands
HYDRA_TARGETS := hydra-start hydra-stop hydra-down hydra-logs hydra-restart hydra-clean hydra-rebuild hydra-pull hydra-status hydra-stats
CARDANO_TARGETS := cardano-start cardano-stop cardano-logs
IPFS_TARGETS := ipfs-start ipfs-stop ipfs-down ipfs-logs ipfs-status
MONITORING_TARGETS := monitoring-start monitoring-stop monitoring-down monitoring-restart monitoring-logs gen-prometheus-config
UTILITY_TARGETS := help check-hydra-keys gen-hydra-keys gen-cardano-keys gen-cardano-address gen-trp-config gen-tls-cert
UTILITY_TARGETS += check-tls-cert _guard-network _guard-instance _abort-if-exists _check-key-exists _prepare-directories
UTILITY_TARGETS += gen-instance-env reset-instance-counter create-instance extract-cardano-privkey append-admin-pk _assert-middleware
UTILITY_TARGETS += dolos-init dolos-logs
UTILITY_TARGETS += test lint typecheck fmt check-releases validate-docker api-snapshot docs

.PHONY: $(HYDRA_TARGETS) $(CARDANO_TARGETS) $(IPFS_TARGETS) $(MONITORING_TARGETS) $(UTILITY_TARGETS)

_assert-middleware: _guard-network _guard-instance
	@set -a; . .$(NETWORK).$(INSTANCE).env; set +a; \
	if [ -z "$${EXPRESS_IMAGE:-}" ]; then \
	  echo "❌ EXPRESS_IMAGE is not set in .$(NETWORK).$(INSTANCE).env"; \
	  echo "   e.g. EXPRESS_IMAGE=ghcr.io/lerna-labs/ekklesia-hydra:branch-main"; \
	  exit 1; \
	else \
	  echo "✅ Building middleware from: $$EXPRESS_IMAGE"; \
	fi

_guard-instance:
	@if [ -z "$(INSTANCE)" ]; then \
        echo "❌ INSTANCE is not set. Run:"; \
        echo "   make NETWORK=$(NETWORK) INSTANCE=<id> $(MAKECMDGOALS)"; \
        exit 1; \
    fi

_guard-network:
	@if [ -z "$(NETWORK)" ]; then \
  		echo "❌ NETWORK is not set. Run:"; \
  		echo "   make NETWORK=<network> INSTANCE=<id> $(MAKECMDGOALS)"; \
  		exit 1; \
	fi

DATA_DIRS = config node tls dolos
_prepare-directories: _guard-network
	@for dir in $(DATA_DIRS); do \
		mkdir -p "./data/${NETWORK}/$${dir}"; \
	done
	@if [ -n "$(INSTANCE)" ]; then \
		mkdir -p "./data/${NETWORK}/instances/$(INSTANCE)/keys"; \
		mkdir -p "./data/${NETWORK}/instances/$(INSTANCE)/hydra"; \
		mkdir -p "./data/${NETWORK}/instances/$(INSTANCE)/config"; \
	fi

cardano-start: _prepare-directories
	$(DOCKER_CARDANO) up -d

cardano-stop: _guard-network
	$(DOCKER_CARDANO) stop

cardano-logs: _guard-network
	$(DOCKER_CARDANO) logs cardano-node -ft --tail=50 | grep -Ev "TrInbound|TrPromoted" || true

ipfs-start:
	@mkdir -p data/ipfs/data data/ipfs/staging
	$(DOCKER_IPFS) up -d

ipfs-stop:
	$(DOCKER_IPFS) stop

ipfs-down:
	$(DOCKER_IPFS) down

ipfs-logs:
	$(DOCKER_IPFS) logs -ft --tail=50

ipfs-status:
	$(DOCKER_IPFS) ps

gen-prometheus-config:
	@bash ./scripts/generate-prometheus-config.sh

monitoring-start: gen-prometheus-config
	$(DOCKER_MONITORING) up -d

monitoring-stop:
	$(DOCKER_MONITORING) stop

monitoring-down:
	$(DOCKER_MONITORING) down -v

monitoring-restart: gen-prometheus-config
	$(DOCKER_MONITORING) up -d --force-recreate

monitoring-logs:
	$(DOCKER_MONITORING) logs -ft --tail=50

orchestrator-start:
	@echo "🚀 Starting Hydra Orchestrator on port $${ORCHESTRATOR_PORT:-7000}..."
	@cd packages/orchestrator && npx tsx src/index.ts

orchestrator-dev:
	@echo "🚀 Starting Hydra Orchestrator (dev) on port $${ORCHESTRATOR_PORT:-7000}..."
	@cd packages/orchestrator && npx tsx watch src/index.ts

hydra-start: _assert-middleware _prepare-directories check-hydra-keys check-cardano-keys check-tls-cert gen-trp-config
	$(DOCKER_HYDRA) up -d

hydra-stop: _assert-middleware
	$(DOCKER_HYDRA) stop

hydra-down: _assert-middleware
	$(DOCKER_HYDRA) down

hydra-clean: _assert-middleware
	$(DOCKER_HYDRA) down --remove-orphans

hydra-restart: _assert-middleware
	$(MAKE) hydra-stop && $(MAKE) hydra-start

hydra-rebuild: _assert-middleware
	$(DOCKER_HYDRA) build --no-cache --pull && \
	$(MAKE) hydra-start

hydra-pull: _assert-middleware
	$(DOCKER_HYDRA) pull

hydra-logs: _assert-middleware
	$(DOCKER_HYDRA) logs -ft --tail=50

hydra-status: _assert-middleware
	$(DOCKER_HYDRA) ps

hydra-stats: _assert-middleware
	@ids=$$($(DOCKER_HYDRA) ps -q); \
	if [ -n "$$ids" ]; then \
		docker stats $$ids; \
	else \
		echo "ℹ️  No Hydra containers for project '$(HYDRA_PROJECT)'."; \
	fi

_abort-if-exists:
	@if [ -f "$(KEY_PATH)" ]; then \
		echo "❌ $(WHAT) key already exists at $(KEY_PATH)"; \
		echo "👉 Aborting to avoid overwriting existing keys."; \
		exit 1; \
	fi

_check-key-exists:
	@if [ "$(NETWORK)" != "offline" ]; then \
		if [ ! -f "$(KEY_PATH)" ]; then \
			echo "❌ $(WHAT) key not found at $(KEY_PATH)"; \
			echo "👉 Please generate keys before proceeding:"; \
			echo "   make NETWORK=$(NETWORK) gen-$(what-lc)-keys"; \
			exit 1; \
		else \
			echo "✅ Found $(WHAT) key: $(KEY_PATH)"; \
		fi; \
	else \
		echo "🧪 Offline mode — skipping $(WHAT) key check."; \
	fi

check-hydra-keys: _guard-network _guard-instance _prepare-directories
	@$(MAKE) --no-print-directory _check-key-exists \
    		KEY_PATH="$(KEY_DIR)/${INSTANCE}.hydra.sk" \
    		WHAT="Hydra" what-lc="hydra"

check-cardano-keys: _guard-network _guard-instance _prepare-directories
	@$(MAKE) --no-print-directory _check-key-exists \
    		KEY_PATH="$(KEY_DIR)/${INSTANCE}.cardano.sk" \
    		WHAT="Cardano" what-lc="cardano"

gen-hydra-keys: _guard-network _guard-instance _prepare-directories
	@$(MAKE) --no-print-directory _abort-if-exists \
		KEY_PATH="$(KEY_DIR)/${INSTANCE}.hydra.sk" WHAT="Hydra"
	@echo "🔐 Generating Hydra keys for $(INSTANCE) instance on $(NETWORK) network"
	docker compose -f "docker/docker-compose.keys.yml" run --rm hydra-key-gen

gen-cardano-keys: _guard-network _guard-instance _prepare-directories
	@$(MAKE) --no-print-directory _abort-if-exists \
		KEY_PATH="$(KEY_DIR)/${INSTANCE}.cardano.sk" WHAT="Cardano (signing key)"
	@$(MAKE) --no-print-directory _abort-if-exists \
		KEY_PATH="$(KEY_DIR)/${INSTANCE}.cardano.addr" WHAT="Cardano (address)"
	@echo "🔐 Generating Cardano keys for network: $(NETWORK)"
	docker compose -f "docker/docker-compose.keys.yml" run --rm cardano-key-gen
	@echo "🏗️  Building Cardano address"
	@if [ "$(NETWORK)" = "mainnet" ]; then \
		docker compose -f "docker/docker-compose.keys.yml" run --rm cardano-addr-gen-mainnet; \
	else \
		docker compose -f "docker/docker-compose.keys.yml" run --rm cardano-addr-gen-testnet; \
	fi

gen-cardano-address: _guard-network _guard-instance _prepare-directories
	@$(MAKE) --no-print-directory _abort-if-exists \
		KEY_PATH="$(KEY_DIR)/${INSTANCE}.cardano.addr" WHAT="Cardano (address)"
	@echo "🏗️  Building Cardano address"
	@if [ "$(NETWORK)" = "mainnet" ]; then \
		docker compose -f "docker/docker-compose.keys.yml" run --rm cardano-addr-gen-mainnet; \
	else \
		docker compose -f "docker/docker-compose.keys.yml" run --rm cardano-addr-gen-testnet; \
	fi

gen-trp-config: _guard-network _guard-instance
	@echo "Generating TRP config for network=$(NETWORK) instance=$(INSTANCE)..."
	@./scripts/generate-trp-config.sh "./data/$(NETWORK)/instances/$(INSTANCE)/config/trp.toml"

dolos-init: _guard-network _prepare-directories
	@echo "Initializing Dolos for network=$(NETWORK)..."
	docker run --rm -it \
		-v "$(CURDIR)/data/$(NETWORK)/dolos:/data" \
		-w /data \
		$(DOLOS_IMAGE) init --known-network $(NETWORK) \
			--serve-grpc true --serve-trp true \
			--serve-ouroboros false --serve-minibf false \
			--enable-relay false
	@echo "✅ Dolos initialized for $(NETWORK) — config + genesis saved to data/$(NETWORK)/dolos/"

dolos-logs: _guard-network
	$(DOCKER_CARDANO) logs cardano-dolos -ft --tail=50

gen-tls-cert: _guard-network
	@echo "Preparing to generate self-signed cert for network=$(NETWORK)..."
	@mkdir -p $(TLS_DIR)
	@if [ -f "$(TLS_CERT)" ] && [ -f "$(TLS_KEY)" ]; then \
	  echo "⚠️  TLS cert and key already exist at:"; \
	  echo "    cert: $(TLS_CERT)"; \
	  echo "    key:  $(TLS_KEY)"; \
	  echo "    Skipping generation to avoid overwrite."; \
	else \
	  echo "Generating new self-signed cert in $(TLS_DIR)..."; \
	  openssl req -x509 -nodes -days 365 \
	    -newkey rsa:4096 \
	    -keyout $(TLS_KEY) \
	    -out $(TLS_CERT) \
	    -subj "/CN=localhost" \
	    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"; \
	  echo "✅ Created cert: $(TLS_CERT)"; \
	  echo "✅ Created key:  $(TLS_KEY)"; \
	fi

gen-instance-env: _guard-network _guard-instance _prepare-directories
	@echo "🧬 Generating instance env for NETWORK=$(NETWORK) INSTANCE=$(INSTANCE)"
	@OFFSET_ARG=$${OFFSET:+$$OFFSET}; \
	bash ./scripts/generate-instance-env.sh "$(NETWORK)" "$(INSTANCE)" $$OFFSET_ARG

reset-instance-counter: _guard-network
	@mkdir -p "data/$(NETWORK)/instances"
	@echo "0" > "data/$(NETWORK)/instances/.counter"
	@echo "🔄 Reset counter for NETWORK=$(NETWORK) to 0"

extract-cardano-privkey: _guard-network _guard-instance _prepare-directories
	@SKEY_FILE=""; \
	for f in "data/$(NETWORK)/instances/$(INSTANCE)/keys/$(INSTANCE).cardano.skey" "data/$(NETWORK)/instances/$(INSTANCE)/keys/$(INSTANCE).cardano.sk"; do \
	  if [ -f "$$f" ]; then SKEY_FILE="$$f"; break; fi; \
	done; \
	if [ -z "$$SKEY_FILE" ]; then \
	  echo "❌ Could not find Cardano Skey for INSTANCE=$(INSTANCE) under data/$(NETWORK)/instances/$(INSTANCE)/keys/" >&2; \
	  exit 1; \
	fi; \
	if ! command -v jq >/dev/null 2>&1; then \
	  echo "❌ 'jq' is required to parse the Skey JSON." >&2; exit 1; \
	fi; \
	PK=$$(jq -r '.cborHex // .key.cborHex // empty' "$$SKEY_FILE"); \
	if [ -z "$$PK" ] || [ "$$PK" = "null" ]; then \
	  echo "❌ Could not parse private key hex from $$SKEY_FILE" >&2; exit 1; \
	fi; \
	echo "$$PK"

append-admin-pk: _guard-network _guard-instance _prepare-directories
	@PK=$$($(MAKE) -s NETWORK=$(NETWORK) INSTANCE=$(INSTANCE) extract-cardano-privkey); \
	printf "\nHYDRA_ADMIN_CARDANO_PK=%s\n" "$$PK" >> ".${NETWORK}.${INSTANCE}.env"; \
	echo "🔐 Appended HYDRA_ADMIN_CARDANO_PK to .${NETWORK}.${INSTANCE}.env"

create-instance: _guard-network _guard-instance _prepare-directories
	@echo "🚀 Creating instance: NETWORK=$(NETWORK) INSTANCE=$(INSTANCE)"
	@$(MAKE) --no-print-directory gen-instance-env
	@set -a; . .$(NETWORK).$(INSTANCE).env; set +a; \
      echo "🔑 Generating keys for INSTANCE=$(INSTANCE)..."; \
      $(MAKE) --no-print-directory NETWORK=$(NETWORK) INSTANCE=$(INSTANCE) gen-hydra-keys; \
      $(MAKE) --no-print-directory NETWORK=$(NETWORK) INSTANCE=$(INSTANCE) gen-cardano-keys; \
      echo "HYDRA_ADMIN_KEY_FILE=/${NETWORK}/keys/$(INSTANCE).cardano.sk" >> ".${NETWORK}.${INSTANCE}.env"; \
      echo "✅ Instance ready: .$(NETWORK).$(INSTANCE).env includes X_API_KEY and HYDRA_ADMIN_KEY_FILE"

check-tls-cert: _guard-network
	@if [[ "${USE_TLS}" == "1" || "${USE_TLS,,}" == "true" ]]; then \
	  if [ ! -f "$(TLS_CERT)" ] || [ ! -f "$(TLS_KEY)" ]; then \
	    echo "❌ USE_TLS is enabled but TLS cert/key are missing."; \
	    echo "   Expected cert: $(TLS_CERT)"; \
	    echo "   Expected key:  $(TLS_KEY)"; \
	    echo "👉 Run: make NETWORK=$(NETWORK) gen-tls-cert"; \
	    exit 1; \
	  else \
	    echo "✅ TLS is enabled and certificate + key exist."; \
	  fi; \
	else \
	  echo "ℹ️  USE_TLS is not enabled; skipping TLS cert presence check."; \
	fi

test:
	npm test

lint:
	npm run lint

typecheck:
	npm run typecheck

fmt:
	npm run lint:fix

check-releases:
	./scripts/check-releases.sh

validate-docker:
	npx tsx scripts/validate-docker.ts

api-snapshot:
	npm run api:extract

docs:
	npm run docs:api

help:
	@echo ""
	@echo "Usage: make NETWORK=<network> [INSTANCE=<id>] <target>"
	@echo ""
	@echo "── Cardano Node & Dolos ────────────────────────────────────"
	@echo "  cardano-start            Start Cardano node + Dolos for NETWORK"
	@echo "  cardano-stop             Stop Cardano node + Dolos"
	@echo "  cardano-logs             Tail Cardano node logs"
	@echo "  dolos-logs               Tail Dolos logs"
	@echo "  dolos-init               Bootstrap Dolos genesis files (one-time)"
	@echo ""
	@echo "── IPFS (shared, network-independent) ───────────────────────"
	@echo "  ipfs-start               Start shared IPFS node"
	@echo "  ipfs-stop                Stop IPFS node"
	@echo "  ipfs-down                Stop and remove IPFS container"
	@echo "  ipfs-logs                Tail IPFS node logs"
	@echo "  ipfs-status              Show IPFS container status"
	@echo ""
	@echo "── Monitoring (Prometheus + Grafana) ────────────────────────"
	@echo "  monitoring-start         Start Prometheus + Grafana (auto-generates config)"
	@echo "  monitoring-stop          Stop monitoring stack"
	@echo "  monitoring-down          Stop and remove monitoring containers + volumes"
	@echo "  monitoring-restart       Restart monitoring (re-generates config)"
	@echo "  monitoring-logs          Tail monitoring logs"
	@echo "  gen-prometheus-config    Regenerate Prometheus scrape targets from instance envs"
	@echo ""
	@echo "── Hydra Instance ──────────────────────────────────────────"
	@echo "  hydra-start              Start hydra-node + TRP + express-api"
	@echo "  hydra-stop               Stop Hydra services"
	@echo "  hydra-down               Stop and remove Hydra containers"
	@echo "  hydra-clean              Stop, remove containers + orphans"
	@echo "  hydra-restart            Restart Hydra services"
	@echo "  hydra-rebuild            Rebuild images (no cache) and start"
	@echo "  hydra-pull               Pull latest images (use before restart)"
	@echo "  hydra-logs               Tail Hydra service logs"
	@echo "  hydra-status             Show container status"
	@echo "  hydra-stats              Show live container resource usage"
	@echo ""
	@echo "── Instance Management ─────────────────────────────────────"
	@echo "  create-instance          Full setup: env + keys + admin key"
	@echo "  gen-instance-env         Generate .NETWORK.INSTANCE.env with port offsets"
	@echo "  reset-instance-counter   Reset port offset counter to 0"
	@echo "  append-admin-pk          Extract and append admin PK to instance env"
	@echo "  extract-cardano-privkey  Print Cardano signing key cborHex"
	@echo ""
	@echo "── Key & Certificate Generation ────────────────────────────"
	@echo "  gen-hydra-keys           Generate Hydra signing/verification keys"
	@echo "  gen-cardano-keys         Generate Cardano signing/verification keys + address"
	@echo "  gen-cardano-address      Generate Cardano address from existing vk"
	@echo "  gen-trp-config           Generate TRP config (trp.toml) for instance"
	@echo "  gen-tls-cert             Generate self-signed TLS certificate"
	@echo "  check-hydra-keys         Verify Hydra keys exist"
	@echo "  check-cardano-keys       Verify Cardano keys exist"
	@echo "  check-tls-cert           Verify TLS cert exists (if USE_TLS=1)"
	@echo ""
	@echo "── Development ─────────────────────────────────────────────"
	@echo "  test                     Run Vitest test suite"
	@echo "  lint                     Run Biome linter"
	@echo "  typecheck                Run TypeScript type checker"
	@echo "  fmt                      Auto-fix lint issues"
	@echo "  check-releases           Check upstream dependency releases"
	@echo "  validate-docker          Validate Docker infrastructure config"
	@echo "  api-snapshot             Extract API surface snapshot to api/snapshot.json"
	@echo "  docs                     Generate API reference docs to docs/api/"
	@echo ""
	@echo "── Port Allocation (base ports per network) ────────────────"
	@echo "  Network   Cardano  Express  API   Listen  TRP(Hydra) Monitor  TRP(Dolos) gRPC(Dolos)"
	@echo "  offline   3001     3000     4000  5000    8165       6001     —          —"
	@echo "  preprod   3100     3101     4101  5101    8265       6101     8164       50151"
	@echo "  mainnet   3000     3001     4001  5001    8165       6001     8064       50051"
	@echo ""
	@echo "  Per-instance ports = base + offset (auto-incremented)"
	@echo "  Dolos ports are per-network (shared across instances)"
	@echo "  Prometheus: $${PROMETHEUS_PORT:-9090}  Grafana: $${GRAFANA_PORT:-3333}"
	@echo ""
	@echo "── Hydra Head Parameters (env vars, all optional) ──────────"
	@echo "  CONTESTATION_PERIOD      Close contestation window in seconds (default: 600)"
	@echo "  DEPOSIT_PERIOD           Min time before deposit deadline (default: 3600)"
	@echo "  API_TX_TIMEOUT           API transaction timeout in seconds (default: 300)"
	@echo "  PERSISTENCE_ROTATE_AFTER Events before persistence rotation (default: 2250)"
	@echo ""
