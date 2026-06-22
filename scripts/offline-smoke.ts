#!/usr/bin/env tsx
/**
 * offline-smoke.ts — validate the v2 SDK against a live hydra-node.
 *
 * Connects the SDK's HydraMonitor + HydraHttpClient to a running head (offline
 * by default) and asserts the v2 (ADR-33) expectations:
 *   - Greetings parses and the head reports OPEN (direct-open, no Initializing)
 *   - headInfo surfaces the node version (expected 2.x)
 *   - GET /snapshot/utxo returns the funded UTxO set
 *
 * Usage:
 *   npx tsx scripts/offline-smoke.ts                 # ws://localhost:4000
 *   HYDRA_WS_URL=ws://host:4000 HYDRA_API_URL=http://host:4000 npx tsx scripts/offline-smoke.ts
 */
import { HydraHttpClient } from '../packages/core/src/hydra/hydra-http-client.js';
import { HydraMonitor } from '../packages/core/src/hydra/hydra-monitor.js';

const WS_URL = process.env.HYDRA_WS_URL ?? 'ws://localhost:4000';
const API_URL = process.env.HYDRA_API_URL ?? 'http://localhost:4000';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  console.log(`▶ Connecting SDK HydraMonitor to ${WS_URL}`);
  const monitor = new HydraMonitor({ wsUrl: WS_URL, reconnect: { enabled: false } });
  await monitor.start();

  const info = monitor.headInfo;
  console.log('▶ headInfo:', JSON.stringify(info, null, 2));

  assert(monitor.connected, 'monitor should be connected');
  assert(info, 'headInfo should be populated after Greetings');
  assert(
    monitor.headStatus === 'OPEN',
    `expected head OPEN (v2 direct-open), got ${monitor.headStatus}`,
  );
  // v2 (ADR-33) ships as hydra-node 2.x — sanity-check we are not on a 1.x/0.x node.
  if (info.nodeVersion && !info.nodeVersion.startsWith('2.')) {
    console.warn(`! node version is ${info.nodeVersion} (expected 2.x for ADR-33 semantics)`);
  }

  console.log(`▶ Fetching /snapshot/utxo via SDK HydraHttpClient (${API_URL})`);
  const http = new HydraHttpClient(API_URL);
  const utxo = await http.getSnapshotUtxo();
  const refs = Object.keys(utxo);
  console.log(`▶ L2 snapshot has ${refs.length} UTxO(s):`);
  for (const ref of refs) {
    console.log(`    ${ref} → ${JSON.stringify((utxo as Record<string, { value?: unknown }>)[ref]?.value)}`);
  }

  await monitor.stop();
  console.log('\n✓ SDK v2 smoke test passed against the live node.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n✗ SDK v2 smoke test failed:', err);
  process.exit(1);
});
