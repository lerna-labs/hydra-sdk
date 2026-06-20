#!/usr/bin/env tsx
/**
 * head-close.ts — close an open Hydra head and fan out to L1.
 *
 * Uses a fresh Wrangler connection (no shared monitor): waitForHeadClose() sends
 * Close, then on ReadyToFanout sends Fanout, resolving on HeadIsFinalized.
 *
 * Usage: HYDRA_API_URL=http://localhost:4102 HYDRA_WS_URL=ws://localhost:4102 \
 *        npx tsx scripts/head-close.ts
 */
import { Wrangler } from '../packages/core/src/wrangler.js';

const API_URL = process.env.HYDRA_API_URL ?? 'http://localhost:4102';
const WS_URL = process.env.HYDRA_WS_URL ?? 'ws://localhost:4102';

async function main() {
  const w = new Wrangler(API_URL, WS_URL);
  console.log('Closing head (Close → ReadyToFanout → Fanout → HeadIsFinalized)…');
  await w.waitForHeadClose(Number(process.env.CLOSE_TIMEOUT_MS ?? '600000'));
  console.log('✓ head finalized — funds fanned out to L1');
  await w.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('✗ close failed:', e);
  process.exit(1);
});
