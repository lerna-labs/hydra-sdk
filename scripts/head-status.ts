#!/usr/bin/env tsx
/**
 * head-status.ts — connect the SDK HydraMonitor to a head and print its status.
 *
 * Read-only: prints headInfo (status, headId, node version, sync) and exits.
 * Does not assert anything, so it works for a head in any state (Idle/Open/…).
 *
 * Usage:  HYDRA_WS_URL=ws://localhost:4102 npx tsx scripts/head-status.ts
 */
import { HydraMonitor } from '../packages/core/src/hydra/hydra-monitor.js';

const WS_URL = process.env.HYDRA_WS_URL ?? 'ws://localhost:4000';

async function main() {
  const m = new HydraMonitor({ wsUrl: WS_URL, reconnect: { enabled: false } });
  await m.start();
  console.log(`headStatus: ${m.headStatus}`);
  console.log('headInfo:', JSON.stringify(m.headInfo, null, 2));
  await m.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error('head-status failed:', err);
  process.exit(1);
});
