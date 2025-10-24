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

KEY_DIR := scripts/$(NETWORK)/keys
export KEY_ROOT := /$(NETWORK)/keys/$(INSTANCE)

TLS_DIR := ./scripts/$(NETWORK)/tls
TLS_CERT := $(TLS_DIR)/hydraCert.pem
TLS_KEY := $(TLS_DIR)/hydraKey.pem

CARDANO_COMPOSE := docker/docker-compose.cardano.yml
CARDANO_PROJECT := cardano-$(NETWORK)
DOCKER_CARDANO := docker compose -f $(CARDANO_COMPOSE) -p $(CARDANO_PROJECT)

HYDRA_COMPOSE := docker/docker-compose.$(NETWORK).yml
HYDRA_PROJECT := hydra-$(NETWORK)-$(INSTANCE)
DOCKER_HYDRA := docker compose -f $(HYDRA_COMPOSE) -p $(HYDRA_PROJECT)

# List of make commands
HYDRA_TARGETS := hydra-start hydra-stop hydra-down hydra-logs hydra-restart hydra-clean hydra-rebuild hydra-status hydra-stats
CARDANO_TARGETS := cardano-start cardano-stop cardano-logs
UTILITY_TARGETS := help check-hydra-keys gen-hydra-keys gen-cardano-keys gen-cardano-address gen-trp-config gen-tls-cert
UTILITY_TARGETS += check-tls-cert _guard-network _guard-instance _abort-if-exists _check-key-exists _prepare-directories
UTILITY_TARGETS += gen-instance-env reset-instance-counter create-instance extract-cardano-privkey append-admin-pk _assert-middleware

.PHONY: $(HYDRA_TARGETS) $(CARDANO_TARGETS) $(UTILITY_TARGETS)

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

CARDANO_DIRS = hydra keys node instances
_prepare-directories: _guard-network
	@for dir in $(CARDANO_DIRS); do \
		mkdir -p "./scripts/${NETWORK}/${dir}"; \
	done

cardano-start: _prepare-directories
	$(DOCKER_CARDANO) up -d

cardano-stop: _guard-network
	$(DOCKER_CARDANO) stop

cardano-logs: _guard-network
	$(DOCKER_CARDANO) logs cardano-node -ft --tail=50 | grep -Ev "TrInbound|TrPromoted" || true

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

check-hydra-keys: _guard-instance _prepare-directories
	@$(MAKE) --no-print-directory _check-key-exists \
    		KEY_PATH="$(KEY_DIR)/${INSTANCE}.hydra.sk" \
    		WHAT="Hydra" what-lc="hydra"

check-cardano-keys: _guard-instance _prepare-directories
	@$(MAKE) --no-print-directory _check-key-exists \
    		KEY_PATH="$(KEY_DIR)/${INSTANCE}.cardano.sk" \
    		WHAT="Cardano" what-lc="cardano"

gen-hydra-keys: _guard-instance _prepare-directories
	@$(MAKE) --no-print-directory _abort-if-exists \
		KEY_PATH="$(KEY_DIR)/${instance}.hydra.sk" WHAT="Hydra"
	@echo "🔐 Generating Hydra keys for $(INSTANCE) instance on $(NETWORK) network"
	docker compose -f "docker/docker-compose.keys.yml" run --rm hydra-key-gen

gen-cardano-keys: _guard-instance _prepare-directories
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

gen-cardano-address: _guard-instance _prepare-directories
	@$(MAKE) --no-print-directory _abort-if-exists \
		KEY_PATH="$(KEY_DIR)/${INSTANCE}.cardano.addr" WHAT="Cardano (address)"
	@echo "🏗️  Building Cardano address"
	@if [ "$(NETWORK)" = "mainnet" ]; then \
		docker compose -f "docker/docker-compose.keys.yml" run --rm cardano-addr-gen-mainnet; \
	else \
		docker compose -f "docker/docker-compose.keys.yml" run --rm cardano-addr-gen-testnet; \
	fi

gen-trp-config: _guard-network
	@echo "Generating TRP config for network=$(NETWORK)..."
	@./scripts/generate-trp-config.sh "./scripts/$(NETWORK)/config/$(INSTANCE).toml"

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

gen-instance-env: _guard-instance _prepare-directories
	@echo "🧬 Generating instance env for NETWORK=$(NETWORK) INSTANCE=$(INSTANCE)"
	@OFFSET_ARG=$${OFFSET:+$$OFFSET}; \
	bash ./scripts/generate-instance-env.sh "$(NETWORK)" "$(INSTANCE)" $$OFFSET_ARG

reset-instance-counter: _guard-network
	@mkdir -p "scripts/$(NETWORK)/instances"
	@echo "0" > "scripts/$(NETWORK)/instances/.counter"
	@echo "🔄 Reset counter for NETWORK=$(NETWORK) to 0"

extract-cardano-privkey: _guard-instance _prepare-directories
	@SKEY_FILE=""; \
	for f in "scripts/$(NETWORK)/keys/$(INSTANCE).cardano.skey" "scripts/$(NETWORK)/keys/$(INSTANCE).cardano.sk"; do \
	  if [ -f "$$f" ]; then SKEY_FILE="$$f"; break; fi; \
	done; \
	if [ -z "$$SKEY_FILE" ]; then \
	  echo "❌ Could not find Cardano Skey for INSTANCE=$(INSTANCE) under scripts/$(NETWORK)/keys/" >&2; \
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

append-admin-pk: _guard-instance _prepare-directories
	@PK=$$($(MAKE) -s NETWORK=$(NETWORK) INSTANCE=$(INSTANCE) extract-cardano-privkey); \
	printf "\nHYDRA_ADMIN_CARDANO_PK=%s\n" "$$PK" >> ".${NETWORK}.${INSTANCE}.env"; \
	echo "🔐 Appended HYDRA_ADMIN_CARDANO_PK to .${NETWORK}.${INSTANCE}.env"

create-instance: _guard-instance _prepare-directories
	@echo "🚀 Creating instance: NETWORK=$(NETWORK) INSTANCE=$(INSTANCE)"
	@$(MAKE) --no-print-directory gen-instance-env
	@set -a; . .$(NETWORK).$(INSTANCE).env; set +a; \
      echo "🔑 Generating keys for INSTANCE=$(INSTANCE)..."; \
      $(MAKE) --no-print-directory NETWORK=$(NETWORK) INSTANCE=$(INSTANCE) gen-hydra-keys; \
      $(MAKE) --no-print-directory NETWORK=$(NETWORK) INSTANCE=$(INSTANCE) gen-cardano-keys; \
      $(MAKE) --no-print-directory NETWORK=$(NETWORK) INSTANCE=$(INSTANCE) append-admin-pk; \
      echo "✅ Instance ready: .$(NETWORK).$(INSTANCE).env includes X_API_KEY and HYDRA_ADMIN_CARDANO_PK"

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

help:
	@echo "Targets:"
	@echo "  cardano-{start,stop,logs}"
	@echo "  hydra-{start,stop,down,clean,restart,rebuild,logs,status,stats}"
	@echo "  gen-hydra-keys / gen-cardano-keys"
	@echo "  check-hydra-keys / check-cardano-keys"
	@echo "  gen-trp-config / gen-tls-cert / check-tls-cert"
