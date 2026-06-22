# Hydra v2 (ADR-33): committing the ballot-results token becomes a deposit

## What changed

Under **Hydra v1** we put the ballot-results token into the head at the same time
we created it: the lifecycle was

```
Init → Commit (ballot token)  → CollectCom → Open
```

so by the time the head reached `Open` the token was already inside it.

Under **Hydra v2** (hydra-node 2.x, ADR-33 "directly-open-head") that
initialization phase is gone. `Init` opens the head **immediately with an empty
UTxO set** — there is no `Commit`/`CollectCom`/`Abort`. Funds and tokens are
added **after** the head is open, through the unified **deposit / increment**
mechanism:

```
Init → Open (empty)  →  deposit (ballot token)  →  …increment… →  token in head
```

The practical consequence: **the ballot-results token is not in the head at the
moment it opens.** There is a delay between submitting the deposit and the token
actually becoming usable inside the head. The rest of this document is about
sizing that delay.

> SDK note: opening is now `wrangler.waitForHeadOpen()` (no commit args); the
> token is added with `wrangler.depositResilient(getUtxo, sign, …)`. See
> `docs/e2e-preprod.md` for the full, proven flow.

## The new timeline (and where the waits are)

| Step | What happens | Roughly how long |
|------|--------------|------------------|
| 1. Open | `Init` → `HeadIsOpen`, empty UTxO set | seconds |
| 2. Submit deposit | draft via `POST /commit`, sign, submit the ballot token to L1 | one L1 submission |
| 3. L1 confirmation | the deposit tx is included in a block | ~1–2 preprod blocks (~20–40 s) |
| 4. **Maturation wait** | hydra-node waits **`deposit-period`** before pulling the deposit into the head | **`deposit-period` (the big knob)** |
| 5. Increment | `DepositActivated → CommitApproved → IncrementTx → CommitFinalized`; token now in the head's L2 ledger | seconds |
| 6. Use | transact with the token on L2 (zero-fee — see below) | instant |
| 7. Close | `Close` → `HeadIsClosed` | one L1 tx + confirmation |
| 8. **Contestation wait** | node waits **`contestation-period`** before fanout is allowed | **`contestation-period`** |
| 9. Fanout | `ReadyToFanout` → `Fanout` → `HeadIsFinalized`; token back on L1 | one L1 tx |

Total "token available in the head" ≈ **L1 confirmation + `deposit-period`**.
Total "head torn down" ≈ **L1 confirmation + `contestation-period`**.

## The two wait times to configure

### `deposit-period` (a.k.a. DEPOSIT_PERIOD) — the deposit maturation wait

This is the single most important value to get right. **It is a *minimum* wait,
not a maximum/timeout.** hydra-node will not increment a deposit into the head
until at least `deposit-period` has elapsed — it is how long the node lets the
deposit *settle* on L1 before trusting it. The on-chain deadline placed on a
drafted deposit is `2 × deposit-period`.

- **Default: `3600s` (1 hour).** With the default, the ballot token will not be
  usable in the head until ~an hour after you submit it. That is correct for
  mainnet (it buys safety against L1 rollbacks) but far too slow for testing or
  interactive flows.
- **Lowering it speeds up token availability but reduces rollback safety.** If
  the deposit matures and is incremented before it has settled deeply enough, an
  L1 fork-switch can revert it and the increment is cancelled (the deposit then
  lingers, recoverable after its deadline). The SDK's `depositResilient()` is
  built to ride this out (re-draft on transient errors, retry with a fresh UTxO),
  but a longer `deposit-period` makes it rarer.

| Environment | Suggested `deposit-period` | Rationale |
|-------------|---------------------------|-----------|
| Offline / unit testing | n/a (offline auto-deposits the `--initial-utxo` instantly) | no L1, no rollbacks |
| Preprod / dev loops | `60`–`120s` | fast iteration; tolerate the occasional reorg-retry |
| Preprod / pre-prod rehearsal | `300`–`600s` | closer to real settlement behaviour |
| Mainnet | leave at `3600s` (or higher) | rollback safety for real value |

> All participants in a multi-party head should agree on these values.

### `contestation-period` (a.k.a. CONTESTATION_PERIOD) — the close→fanout wait

After `Close`, the node waits `contestation-period` before it will fan out (this
is the window in which a stale close could be contested). Fanout — and therefore
getting the ballot token back to L1 — cannot happen until it elapses.

- **Default: `600s` (10 min).** For testing we use `60s`. All participants must
  use the same value or the `Init` tx is ignored.

## Operational notes carried over from the bring-up

These are not new in v2 but matter for the deposit flow specifically:

- **L2 transactions on the token must be zero-fee.** Any ADA burned to fees
  changes the head's ADA overhead and the close fails with
  `H65 (ChangedHeadAdaOverhead)`. Build L2 txs with an explicit fee of `0`.
- **The deposit must be signed** by the owner of the committed UTxO before it is
  submitted to L1.
- **Deposits are recoverable.** A deposit that is reorg-stranded (in
  `GET /commits` but never incremented) is reclaimable after its deadline via
  `scripts/head-recover.ts`.

## TL;DR for configuration

```ini
# Fast preprod testing
DEPOSIT_PERIOD=120        # token usable ~2 min after deposit (minimum wait, not a timeout)
CONTESTATION_PERIOD=60    # fanout ~1 min after close

# Mainnet
DEPOSIT_PERIOD=3600       # ~1 h maturation; rollback-safe
CONTESTATION_PERIOD=600
```

See `docs/e2e-preprod.md` (full round-trip + critical config) and
`docs/offline-head.md` (rapid local testing).
