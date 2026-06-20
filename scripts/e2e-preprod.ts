#!/usr/bin/env tsx
/**
 * e2e-preprod.ts — full Hydra v2 round-trip on preprod, driven by the SDK.
 *
 *   open → deposit funds → L2 transaction → close → fanout
 *
 * Phase-gated via STOP_AFTER=open|deposit|tx|close|all (default all) so it can be
 * run incrementally and safely. The deposit phase is idempotent: it skips if the
 * head already holds a UTxO at the admin address.
 *
 * Env:
 *   HYDRA_API_URL, HYDRA_WS_URL, HYDRA_ADMIN_KEY_FILE, BLOCKFROST_API_KEY,
 *   HYDRA_NETWORK=0, DEPOSIT_MAX_LOVELACE (pick a small UTxO <= this; default 20 ADA)
 *
 * See docs/e2e-preprod.md.
 */
import sodium from 'libsodium-wrappers-sumo';
import { BlockfrostProvider, MeshTxBuilder } from '@meshsdk/core';
import { HydraHttpClient } from '../packages/core/src/hydra/hydra-http-client.js';
import { HydraMonitor } from '../packages/core/src/hydra/hydra-monitor.js';
import { getAdmin } from '../packages/core/src/mesh/get-admin.js';
import { Wrangler } from '../packages/core/src/wrangler.js';

const API_URL = process.env.HYDRA_API_URL ?? 'http://localhost:4102';
const WS_URL = process.env.HYDRA_WS_URL ?? 'ws://localhost:4102';
const BF = process.env.BLOCKFROST_API_KEY ?? '';
const STOP_AFTER = process.env.STOP_AFTER ?? 'all';
const DEPOSIT_MAX = BigInt(process.env.DEPOSIT_MAX_LOVELACE ?? '20000000'); // pick a small UTxO

const log = (m: string) => console.log(`\n\x1b[36m━━ ${m}\x1b[0m`);
const ok = (m: string) => console.log(`\x1b[32m✓ ${m}\x1b[0m`);
const info = (m: string) => console.log(`  ${m}`);
const stopHere = (phase: string) => STOP_AFTER === phase;
const lovelaceOf = (u: { output: { amount: { unit: string; quantity: string }[] } }) =>
  BigInt(u.output.amount.find((a) => a.unit === 'lovelace')?.quantity ?? '0');

async function main() {
  if (!BF) throw new Error('BLOCKFROST_API_KEY is required');
  await sodium.ready;

  log('Setup: admin wallet + monitor + http client');
  const admin = await getAdmin(BF);
  const adminAddr = admin.addresses.enterpriseAddressBech32 as string;
  const bf = new BlockfrostProvider(BF);
  info(`admin address: ${adminAddr}`);

  const monitor = new HydraMonitor({ wsUrl: WS_URL, reconnect: { enabled: false } });
  await monitor.start();
  const http = new HydraHttpClient(API_URL);
  const wrangler = new Wrangler(API_URL, WS_URL, monitor);
  info(`connected — head is ${monitor.headStatus}, node ${monitor.headInfo?.nodeVersion}`);

  // ── Phase 1: OPEN ──────────────────────────────────────────────────────────
  log('Phase 1 — OPEN the head (Init → HeadIsOpen, empty UTxO set)');
  await wrangler.waitForHeadOpen(180_000);
  ok(`head Open (headId ${monitor.headInfo?.headId})`);
  if (stopHere('open')) return finish(monitor);

  // ── Phase 2: DEPOSIT a small UTxO (rollback-resilient) ─────────────────────
  log('Phase 2 — DEPOSIT a small UTxO into the open head (signed, rollback-resilient)');
  const already = Object.entries(await http.getSnapshotUtxo()).filter(([, e]) => e.address === adminAddr);
  if (already.length > 0) {
    ok(`head already funded (${already.length} UTxO at admin) — skipping deposit (idempotent)`);
  } else {
    // Provide a FRESH small UTxO per attempt — a live L1 query naturally excludes
    // any UTxO already consumed by a previous (stranded) attempt. Pre-split enough
    // small UTxOs with: SPLIT_COUNT=3 npx tsx scripts/fund-split.ts
    const getUtxo = async () => {
      const l1 = await bf.fetchAddressUTxOs(adminAddr);
      const small = l1.find((u) => lovelaceOf(u) <= DEPOSIT_MAX && lovelaceOf(u) >= 3_000_000n);
      if (!small) throw new Error(`No small L1 UTxO (<= ${DEPOSIT_MAX}) available. Run: SPLIT_COUNT=3 npx tsx scripts/fund-split.ts`);
      info(`depositing ${small.input.txHash}#${small.input.outputIndex} (${lovelaceOf(small)} lovelace)`);
      return { txHash: small.input.txHash, outputIndex: small.input.outputIndex };
    };
    const l1TxId = await wrangler.depositResilient(getUtxo, (cbor) => admin.signTx(cbor, true), {
      maxAttempts: Number(process.env.DEPOSIT_MAX_ATTEMPTS ?? '3'),
      finalizeTimeoutMs: Number(process.env.DEPOSIT_FINALIZE_TIMEOUT_MS ?? '180000'),
    });
    ok(`deposit finalized into the head (L1 tx ${l1TxId})`);
  }
  const afterDeposit = await http.getSnapshotUtxo();
  ok(`head now holds ${Object.keys(afterDeposit).length} UTxO(s)`);
  if (stopHere('deposit')) return finish(monitor);

  // ── Phase 3: L2 TRANSACTION ────────────────────────────────────────────────
  log('Phase 3 — L2 transaction (self-transfer via NewTx)');
  const headUtxos = await http.getSnapshotUtxo();
  const found = Object.entries(headUtxos).find(([, e]) => e.address === adminAddr);
  if (!found) throw new Error('No in-head UTxO at admin address to spend');
  const [ref, entry] = found;
  const [txHash, ixStr] = ref.split('#');
  const lovelace = String(entry.value.lovelace);
  info(`spending in-head UTxO ${ref} (${lovelace} lovelace)`);

  const tb = new MeshTxBuilder({ fetcher: bf, submitter: bf, verbose: false });
  const unsigned = await tb
    .txIn(txHash, Number(ixStr), [{ unit: 'lovelace', quantity: lovelace }], adminAddr)
    .changeAddress(adminAddr)
    .selectUtxosFrom([])
    .complete();
  const signedL2 = await admin.signTx(unsigned, true);

  const txValid = monitor.waitForMessage('TxValid', 120_000);
  const snap = monitor.waitForMessage('SnapshotConfirmed', 120_000);
  monitor.ws.send({ tag: 'NewTx', transaction: { type: 'Tx ConwayEra', description: '', cborHex: signedL2 } });
  await txValid;
  ok('L2 transaction valid (TxValid)');
  await snap;
  ok('snapshot confirmed with the new transaction');
  if (stopHere('tx')) return finish(monitor);

  // ── Phase 4: CLOSE + FANOUT ────────────────────────────────────────────────
  log('Phase 4 — CLOSE then FANOUT (Close → ReadyToFanout → Fanout → HeadIsFinalized)');
  await wrangler.waitForHeadClose(900_000);
  ok('head finalized — funds fanned out to L1');

  await finish(monitor, true);
}

async function finish(monitor: HydraMonitor, complete = false) {
  await monitor.stop();
  if (complete) {
    console.log('\n\x1b[32m━━ E2E COMPLETE — open → deposit → L2 tx → close → fanout ✓\x1b[0m');
    console.log(`Next: kill the instance →  INSTANCE=${process.env.INSTANCE ?? 'e2e'} scripts/preprod-head.sh kill`);
  } else {
    console.log(`\n(stopped after STOP_AFTER=${STOP_AFTER})`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('\n\x1b[31m✗ E2E failed:\x1b[0m', err);
  process.exit(1);
});
