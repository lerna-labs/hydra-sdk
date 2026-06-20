# Offline Hydra Head — rapid local testing

An **offline** Hydra head needs no Cardano L1, no peers, and no faucet. The
hydra-node boots straight into the `Open` state seeded with a UTxO set you hand
it, which makes it the fastest loop for developing and testing against the SDK.

It runs the exact `hydra-node` image pinned in `.env`
(`ghcr.io/cardano-scaling/hydra-node:2.2.0` at time of writing), so behaviour
matches preprod/mainnet — including the Hydra v2 (ADR-33) semantics.

> **Heads up — how v2 seeds the head (ADR-33).** Under Hydra v2 the head opens
> with an **empty** UTxO set, and your `--initial-utxo` is ingested immediately
> afterwards as a **deposit/increment** that finalizes a moment later. So right
> at open the L2 snapshot is `{}`; ~1s later it contains your seeded UTxOs. The
> tooling below waits for the UTxOs to actually land before reporting "ready".

---

## Quick start

```bash
# Start an offline head with the default UTxO set (data/offline/config/utxo.json)
make offline-start

# Watch it
make offline-status
make offline-logs

# Stop it
make offline-stop
```

`make offline-start` will, in order:

1. create the `hydra-network-offline` docker network (if missing),
2. generate the offline Hydra keys (if missing),
3. apply the UTxO set,
4. boot **only** the `hydra-node` service (TRP / express-api are skipped for speed),
5. poll until the head is **Open and funded**, then print the live L2 snapshot.

The head is then reachable at:

| Endpoint | URL |
|----------|-----|
| HTTP API | `http://localhost:4000` |
| WebSocket | `ws://localhost:4000` |

(Ports come from `.offline.env`.)

---

## Seeding a custom UTxO set

Pass a Hydra-format UTxO JSON file with `UTXO=`. Because a *persisted* head
resumes its old state and ignores `--initial-utxo`, use `reset` (or `FRESH=1`)
to start a fresh head so your new set actually takes effect:

```bash
# Fresh head seeded from a custom file
UTXO=./my-utxo.json make offline-start FRESH=1
# or, equivalently, via the script directly:
UTXO=./my-utxo.json ./scripts/offline-head.sh reset
```

The UTxO file is Hydra's wire format — a map of `"txHash#index"` → output:

```json
{
  "1111111111111111111111111111111111111111111111111111111111111111#0": {
    "address": "addr_test1vp7f4380zv203gjqscn5ls4j6s0v976nnqdhds5n78ty6hqu9e072",
    "value": { "lovelace": 42000000 }
  },
  "1111111111111111111111111111111111111111111111111111111111111111#1": {
    "address": "addr_test1vp7f4380zv203gjqscn5ls4j6s0v976nnqdhds5n78ty6hqu9e072",
    "value": { "lovelace": 7000000 }
  }
}
```

When you pass `UTXO=`, the existing `data/offline/config/utxo.json` is backed up
once to `utxo.json.bak` (gitignored) before being replaced.

---

## Verifying with the SDK

A smoke test drives the **SDK itself** (`HydraMonitor` + `HydraHttpClient`)
against the running head and asserts the v2 expectations (head `OPEN`, node
version `2.x`, funded snapshot):

```bash
npx tsx scripts/offline-smoke.ts
```

Expected tail:

```
▶ headInfo: { "headStatus": "Open", "nodeVersion": "2.2.0-…", … }
▶ L2 snapshot has 3 UTxO(s): …
✓ SDK v2 smoke test passed against the live node.
```

Point it elsewhere with `HYDRA_WS_URL` / `HYDRA_API_URL`.

---

## Commands reference

| Command | Effect |
|---------|--------|
| `make offline-start` | Start (resume if state exists) with the current UTxO set |
| `make offline-start FRESH=1` | Wipe state and start a fresh head |
| `UTXO=f make offline-start FRESH=1` | Fresh head seeded from file `f` |
| `make offline-stop` | Stop and remove the head container |
| `make offline-status` | Show container + whether the API is responding |
| `make offline-logs` | Follow hydra-node logs |
| `./scripts/offline-head.sh {up\|reset\|down\|status\|logs}` | Same, directly |

Environment knobs (script or `make`): `UTXO=<path>`, `FRESH=0\|1`, `WAIT=0\|1`.

---

## Troubleshooting

- **Snapshot is `{}` right after start** — expected for ~1s while the initial
  UTxO deposit finalizes (see the ADR-33 note above). `offline-start` already
  waits for funding; if you query manually, retry `GET /snapshot/utxo`.
- **A new `UTXO=` didn't take effect** — you resumed a persisted head. Re-run
  with `FRESH=1` / `reset`.
- **Port 4000 already in use** — another head (or a previous run) is bound.
  `make offline-stop`, or change ports in `.offline.env`.
- **State is root-owned and won't delete** — `FRESH=1`/`reset` wipes it via a
  throwaway container; don't `rm` it by hand.
