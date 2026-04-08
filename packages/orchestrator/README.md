# Hydra Head Orchestrator

REST API for programmatic Hydra head infrastructure provisioning. The orchestrator handles the infrastructure layer — generating keys, allocating ports, starting/stopping Docker containers, and monitoring host health — so that external applications can spin up Hydra heads on demand without manual intervention.

## Separation of Concerns

| Layer | Responsibility | Example |
|-------|---------------|---------|
| **Orchestrator** | Infrastructure: keys, ports, containers, health gating | `POST /heads`, `DELETE /heads/:id` |
| **Middleware** | Head operations: commit, open, transact, decommit | Your app's Express image |
| **Caller** | Requests infrastructure, funds wallets, uses the head | Voting app, payments service |

The orchestrator never interacts with the Hydra protocol itself. Each head specifies its own middleware Docker image (`expressImage`) which handles everything inside the head.

## Workflow

```
1. POST /heads                    Caller requests a new head
       │
       ▼
2. Orchestrator scaffolds         Generates keys, starts containers
       │                          Returns adminAddress + endpoints
       ▼
3. Poll GET /heads/:id            Wait for status: READY
       │
       ▼
4. Fund admin wallet on L1        Send seed UTxOs + tokens to adminAddress
       │
       ▼
5. Use the middleware              Call endpoints.express to open head,
       │                          submit transactions, etc.
       ▼
6. DELETE /heads/:id              Tear down when done
```

## Quick Start

### 1. Set the orchestrator API key

```bash
echo "ORCHESTRATOR_API_KEY=$(uuidgen)" >> .env
```

### 2. Start the orchestrator

```bash
make orchestrator-start
# or for hot-reload during development:
make orchestrator-dev
```

The orchestrator listens on port `7000` by default (configurable via `ORCHESTRATOR_PORT`).

### 3. Scaffold a head

```bash
curl -X POST http://localhost:7000/heads \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "network": "preprod",
    "expressImage": "ghcr.io/lerna-labs/ekklesia-hydra:branch-main",
    "instanceName": "vote-round-1"
  }'
```

Response (202):

```json
{
  "id": "vote-round-1",
  "network": "preprod",
  "status": "SCAFFOLDING",
  "adminAddress": null,
  "endpoints": null,
  "apiKey": null,
  "createdAt": "2026-04-08T12:00:00.000Z"
}
```

### 4. Poll for readiness

```bash
curl http://localhost:7000/heads/vote-round-1 \
  -H "Authorization: Bearer <your-api-key>"
```

Once `status` is `READY`, the response includes everything you need:

```json
{
  "id": "vote-round-1",
  "network": "preprod",
  "status": "READY",
  "adminAddress": "addr_test1qr...",
  "endpoints": {
    "hydraApi": "http://localhost:4102",
    "hydraWs": "ws://localhost:4102",
    "trp": "http://localhost:8266",
    "express": "http://localhost:3102",
    "metrics": "http://localhost:6102/metrics"
  },
  "apiKey": "a1b2c3d4-e5f6-...",
  "createdAt": "2026-04-08T12:00:00.000Z"
}
```

### 5. Fund and use

Send funds to `adminAddress` on L1, then interact with the middleware at `endpoints.express` using the `apiKey` as the `x-api-key` header.

### 6. Tear down

```bash
curl -X DELETE http://localhost:7000/heads/vote-round-1 \
  -H "Authorization: Bearer <your-api-key>"
```

## API Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/heads` | Bearer | Scaffold a new instance |
| `GET` | `/heads` | Bearer | List all managed instances |
| `GET` | `/heads/{id}` | Bearer | Get instance status and details |
| `DELETE` | `/heads/{id}` | Bearer | Stop containers and tear down |
| `GET` | `/health` | None | Host metrics and capacity check |

Full OpenAPI 3.1 spec: [`openapi.yaml`](./openapi.yaml)

### POST /heads

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `network` | string | Yes | `offline`, `preprod`, or `mainnet` |
| `expressImage` | string | Yes | Docker image for the middleware |
| `instanceName` | string | No | Lowercase alphanumeric + hyphens, 2-21 chars. Auto-generated if omitted |
| `contestationPeriod` | integer | No | Close contestation window in seconds (default: 600) |
| `depositPeriod` | integer | No | Min time before deposit deadline in seconds (default: 3600) |

### GET /health

Returns host metrics and a capacity decision. No authentication required.

```json
{
  "canProvision": true,
  "activeInstances": 3,
  "maxInstances": 20,
  "host": {
    "cpuLoadAvg1m": 2.1,
    "cpuCores": 8,
    "cpuLoadRatio": 0.26,
    "memTotalMb": 32768,
    "memAvailableMb": 18432,
    "memUsedPercent": 43.7,
    "diskIopsRead": 120,
    "diskIopsWrite": 85
  }
}
```

Returns `200` when healthy, `503` when at capacity.

## Instance Lifecycle

```
SCAFFOLDING ──► READY ──► STOPPED
     │            │          │
     └────────────┴──────────┘
              FAILED
```

| Status | Meaning |
|--------|---------|
| `SCAFFOLDING` | Keys being generated, containers starting (~30-60s) |
| `READY` | All containers up, hydra-node responding. Caller can fund and use |
| `STOPPED` | Torn down via `DELETE`. Env files and keys preserved for audit |
| `FAILED` | Something went wrong. Check the `error` field on `GET /heads/{id}` |

## Configuration

All configuration is via environment variables:

### Required

| Variable | Description |
|----------|-------------|
| `ORCHESTRATOR_API_KEY` | Bearer token for API authentication |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `ORCHESTRATOR_PORT` | `7000` | Port the orchestrator listens on |
| `EXTERNAL_HOST` | `localhost` | Hostname used in returned endpoint URLs |
| `PROJECT_ROOT` | Auto-detected | Path to the monorepo root (where Makefile lives) |
| `ALLOWED_NETWORKS` | `offline,preprod,mainnet` | Comma-separated list of allowed networks |
| `IMAGE_ALLOWLIST_PATTERN` | *(empty = allow all)* | Regex pattern for allowed middleware images |
| `MAX_CPU_LOAD_RATIO` | `0.8` | Max 1m load avg / core count before rejecting |
| `MIN_MEMORY_AVAILABLE_MB` | `2048` | Min available memory (MB) before rejecting |
| `MAX_DISK_UTIL_PERCENT` | `85` | Max disk utilization before rejecting |
| `MAX_INSTANCES` | `20` | Hard cap on active instances |
| `READINESS_TIMEOUT_S` | `120` | Seconds to wait for hydra-node readiness |
| `READINESS_POLL_INTERVAL_S` | `3` | Seconds between readiness polls |
| `INSTANCE_TTL_S` | `0` | Auto-cleanup TTL in seconds. 0 = disabled |
| `CLEANUP_INTERVAL_S` | `300` | Seconds between cleanup sweeps |

## How It Works

Under the hood, the orchestrator delegates to the existing Makefile targets:

1. **`make create-instance`** — Generates the instance env file (port allocation via flock-based counter), Hydra keys, and Cardano keys
2. Appends `EXPRESS_IMAGE` and optional head parameters to the env file
3. **`make hydra-start`** — Generates TRP config and starts 3 containers: `hydra-node`, `hydra-trp`, and the middleware
4. Polls `GET /protocol-parameters` on the hydra-node until it responds
5. Writes Prometheus `targets.json` for automatic metric discovery

Teardown calls **`make hydra-down`** to stop and remove containers.

## Monitoring Integration

The orchestrator writes `docker/monitoring/targets.json` which Prometheus watches via `file_sd_configs`. New instances are automatically scraped within 15 seconds — no Prometheus restart needed.

## Audit Log

All provisioning actions are logged to `data/orchestrator/audit.log` in JSONL format:

```jsonl
{"timestamp":"2026-04-08T12:00:00.000Z","action":"scaffold_requested","id":"vote-round-1","network":"preprod","expressImage":"ghcr.io/..."}
{"timestamp":"2026-04-08T12:00:45.000Z","action":"scaffold_completed","id":"vote-round-1","network":"preprod"}
{"timestamp":"2026-04-08T18:00:00.000Z","action":"teardown_requested","id":"vote-round-1","network":"preprod"}
{"timestamp":"2026-04-08T18:00:03.000Z","action":"teardown_completed","id":"vote-round-1"}
```

## State Persistence

Instance state is persisted to `data/orchestrator/instances.json`. On restart, the orchestrator reconciles this with actual Docker container state — if containers are no longer running, the instance is marked `FAILED`.
