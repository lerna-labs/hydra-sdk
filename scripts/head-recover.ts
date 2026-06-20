#!/usr/bin/env tsx
/**
 * head-recover.ts — recover a pending Hydra deposit back to L1.
 *
 * A deposit that is observed and then disrupted by an L1 rollback can remain
 * "pending" (see GET /commits) without being incremented into the head. This
 * sends the `Recover` client input so the funds return to the original owner.
 *
 * Usage:
 *   HYDRA_WS_URL=ws://localhost:4102 HYDRA_API_URL=http://localhost:4102 \
 *   npx tsx scripts/head-recover.ts [<depositTxId>]
 *   (with no arg, recovers all txids listed by GET /commits)
 */
import { HydraMonitor } from '../packages/core/src/hydra/hydra-monitor.js';

const WS_URL = process.env.HYDRA_WS_URL ?? 'ws://localhost:4102';
const API_URL = process.env.HYDRA_API_URL ?? 'http://localhost:4102';

async function main() {
  let ids = process.argv.slice(2);
  if (ids.length === 0) {
    const res = await fetch(`${API_URL}/commits`);
    ids = (await res.json()) as string[];
  }
  if (!ids.length) {
    console.log('No pending deposits to recover.');
    process.exit(0);
  }
  console.log('Recovering pending deposits:', ids);

  const m = new HydraMonitor({ wsUrl: WS_URL, reconnect: { enabled: false } });
  await m.start();

  for (const recoverTxId of ids) {
    const recovered = m.waitForMessage('CommitRecovered', 300_000).catch(() => null);
    m.ws.send({ tag: 'Recover', recoverTxId });
    console.log(`  → Recover sent for ${recoverTxId}, waiting for CommitRecovered…`);
    const r = await recovered;
    console.log(r ? `  ✓ recovered ${recoverTxId}` : `  ! no CommitRecovered for ${recoverTxId} (check /commits)`);
  }

  await m.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error('head-recover failed:', e);
  process.exit(1);
});
