# Preprod E2E round-trip — user manual

A full, reproducible round-trip of a **Hydra v2** head on the **preprod**
testnet, driven by the SDK:

```
create instance → start node → OPEN → DEPOSIT funds → L2 TRANSACTION → CLOSE → FANOUT → KILL
```

This uses `hydra-node:2.2.0` (ADR-33 "directly-open-head"), so the choreography
differs from Hydra v1: **`Init` opens the head directly with an empty UTxO set**,
and funds are added afterwards as a **deposit/increment** — there is no
opening Commit/CollectCom and no Abort.

> **Status of this guide.** Phases marked ✅ have been validated end-to-end
> against the live node. Phases marked ⏳ are implemented and pending the first
> funded live run (they need tADA in the head). See "Validated so far" below.

---

## Prerequisites

| Need | How |
|------|-----|
| Docker + the repo `.env` pinning `HYDRA_IMAGE=…:2.2.0` | already set |
| `cardano-node-preprod` running and **synced to tip** | `make cardano-start`, then `make NETWORK=preprod cardano-status` → `syncProgress: 100.00` |
| `jq`, Node ≥18, `npm ci` done | — |
| A `BLOCKFROST_API_KEY` for preprod | in `.preprod.env` |
| Single `libsodium-wrappers-sumo` (host MeshSDK signing) | enforced via `overrides` in root `package.json` (see note) |

> **Why the libsodium override.** MeshSDK pulls multiple `@meshsdk/core-cst`
> versions which bundle two `libsodium-wrappers-sumo` copies; loading both makes
> `_sodium_init()` fail (`libsodium was not correctly initialized`) and breaks
> `MeshWallet` signing on the host. The root `package.json` pins a single version
> via `overrides`, after which host-side signing (split, deposit, L2 tx) works.

---

## Step 1 — Create the instance ✅

```bash
make NETWORK=preprod INSTANCE=e2e create-instance
```

Generates `.preprod.e2e.env`, the Hydra keys, and a fresh Cardano admin key
under `data/preprod/instances/e2e/keys/`. Ports for `e2e`: API `4102`, listen
`5102`, monitoring `6102`; node-id `preprod-e2e`.

## Step 2 — Fund the admin address ⛽

Print the address and request tADA from the
[preprod faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/)
(one request = 10,000 tADA):

```bash
cat data/preprod/instances/e2e/keys/e2e.cardano.addr
```

Confirm it landed (a few preprod blocks, ~1–2 min):

```bash
curl -s -H "project_id: $(grep -E '^BLOCKFROST_API_KEY=' .preprod.env | cut -d= -f2)" \
  "https://cardano-preprod.blockfrost.io/api/v0/addresses/$(cat data/preprod/instances/e2e/keys/e2e.cardano.addr)/utxos" | jq
```

## Step 3 — Start the hydra-node ✅

Boots **only** `hydra-node` (no TRP/express middleware), connected to the local
`cardano-node` via its socket:

```bash
INSTANCE=e2e ./scripts/preprod-head.sh up
```

Verify it reached `Idle` and is chain-synced (driven through the SDK monitor):

```bash
HYDRA_WS_URL=ws://localhost:4102 npx tsx scripts/head-status.ts
# → headStatus: IDLE, nodeVersion: 2.2.0-…, chainSyncedStatus: InSync
```

## Step 3b — Carve off a small UTxO ✅

The deposit path commits a **whole** UTxO into the head, so to keep only a small
amount at risk, split off a small UTxO first (the rest stays as change on L1):

```bash
SPLIT_LOVELACE=10000000 \
HYDRA_ADMIN_KEY_FILE=data/preprod/instances/e2e/keys/e2e.cardano.sk \
HYDRA_NETWORK=0 BLOCKFROST_API_KEY=$(grep -E '^BLOCKFROST_API_KEY=' .preprod.env | cut -d= -f2) \
npx tsx scripts/fund-split.ts
```

Wait ~1–2 preprod blocks for it to confirm.

## Step 4 — Run the round-trip ⏳

`scripts/e2e-preprod.ts` performs OPEN → DEPOSIT → L2 TX → CLOSE → FANOUT,
logging the exact SDK calls and the Hydra messages it waits for at each phase:

```bash
# STOP_AFTER=open|deposit|tx|close|all (default all) — run incrementally and safely.
STOP_AFTER=all INSTANCE=e2e \
HYDRA_API_URL=http://localhost:4102 \
HYDRA_WS_URL=ws://localhost:4102 \
HYDRA_ADMIN_KEY_FILE=data/preprod/instances/e2e/keys/e2e.cardano.sk \
HYDRA_NETWORK=0 \
BLOCKFROST_API_KEY=$(grep -E '^BLOCKFROST_API_KEY=' .preprod.env | cut -d= -f2) \
npx tsx scripts/e2e-preprod.ts
```

The deposit phase is idempotent (skips if the head already holds a UTxO at the
admin address) and picks a small UTxO (`<= DEPOSIT_MAX_LOVELACE`, default 20 ADA).

What each phase does:

1. **OPEN** — `wrangler.waitForHeadOpen()` sends `Init`; head opens directly into
   `Open` with an empty UTxO set (ADR-33).
2. **DEPOSIT** — pick a funded L1 UTxO, draft a deposit via `POST /commit`, **sign
   with the admin key**, submit to L1, wait for `CommitFinalized`. The UTxO now
   lives in the head's L2 ledger.
3. **L2 TRANSACTION** — build a self-transfer over an in-head UTxO, sign it, submit
   via `NewTx`, wait for `TxValid` + `SnapshotConfirmed`.
4. **CLOSE + FANOUT** — `wrangler.waitForHeadClose()` sends `Close`; after the
   contestation period (~120s here) the node emits `ReadyToFanout`; the SDK sends
   `Fanout`; resolves on `HeadIsFinalized`. Funds return to L1.

## Step 5 — Kill the instance ✅

```bash
INSTANCE=e2e ./scripts/preprod-head.sh kill      # stop node + purge head state
make NETWORK=preprod INSTANCE=e2e purge-instance-data   # (optional) wipe everything
```

---

## Validated so far

Against the live preprod stack, with no funds yet:

- ✅ `cardano-node-preprod` synced to tip (real-time chain following).
- ✅ Instance `e2e` created (keys + env + admin address).
- ✅ `hydra-node-preprod-e2e` (2.2.0) starts, connects to cardano-node, validates
  the `HYDRA_TX_ID` reference scripts, and reaches `Idle` / `InSync` — confirmed
  via the SDK `HydraMonitor` (`scripts/head-status.ts`).
- ⏳ OPEN / DEPOSIT / L2 TX / CLOSE / FANOUT — pending the first funded run.

The same SDK code paths (direct-open, deposit-ingest, snapshot) are already
exercised end-to-end by the **offline** head — see `docs/offline-head.md`.

---

## Notes & troubleshooting

- **Deposit signing (confirmed).** A real L1 deposit **must** be signed by the
  UTxO owner. `scripts/e2e-preprod.ts` drafts via `POST /commit`, signs with the
  admin key (`admin.signTx(draft, true)`), and submits to L1. The high-level
  `Wrangler.incrementalCommit()` submits the draft *unsigned* (fine for offline
  auto-deposit, not for a real network) — folding a signer into the SDK is a
  follow-up.
- **Deposit + L1 rollbacks (important).** A deposit is incremented into the head
  by a snapshot that fires on the deposit's *observation* event. If a preprod
  rollback reverts the block the deposit landed in, that increment is cancelled
  and hydra-node 2.2.0 does **not** re-fire it for the already-recorded pending
  deposit (it shows in `GET /commits` but never enters the snapshot). The funds
  are safe — recover them after the deposit deadline:
  ```bash
  # lists GET /commits and sends Recover for each (only works AFTER the deadline)
  HYDRA_WS_URL=ws://localhost:4102 HYDRA_API_URL=http://localhost:4102 \
    npx tsx scripts/head-recover.ts
  ```
  Mitigation: retry the deposit (a rollback hitting the exact deposit block is
  uncommon), or wait for a quiet chain window. The offline head (no rollbacks)
  exercises the same increment path deterministically.
- **Timing.** Deposit finalization waits for L1 confirmation (~1–2 preprod
  blocks). Close→fanout waits the contestation period (`--contestation-period`,
  ~120s on this instance). Tune `CONTESTATION_PERIOD` / `DEPOSIT_PERIOD` in
  `.preprod.e2e.env` for faster loops.
- **Dolos crash-loop.** `cardano-dolos-preprod` is unrelated to this flow (it
  backs tx3/TRP, which we bypass by submitting L2 txs via `NewTx`). It fails with
  `missing configuration field "upstream"` and can be ignored for the E2E.
- **`EXPRESS_IMAGE` warning.** `preprod-head.sh` sets a placeholder so docker
  compose validates; the express-api service is never started.
```
