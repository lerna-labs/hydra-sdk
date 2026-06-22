#!/usr/bin/env tsx
/**
 * fund-split.ts — carve a small L1 UTxO off the admin wallet.
 *
 * The Hydra deposit path commits a *whole* UTxO into the head, so to keep only a
 * small amount at risk we first split off a small UTxO (default 10 ADA) and
 * deposit that one. The remainder stays as change on L1.
 *
 * Idempotent: if a UTxO <= MAX_SMALL already exists, it does nothing.
 *
 * Usage:
 *   HYDRA_ADMIN_KEY_FILE=… HYDRA_NETWORK=0 BLOCKFROST_API_KEY=preprod… \
 *   SPLIT_LOVELACE=10000000 npx tsx scripts/fund-split.ts
 */
import sodium from 'libsodium-wrappers-sumo';
import { BlockfrostProvider, MeshTxBuilder } from '@meshsdk/core';
import { getAdmin } from '../packages/core/src/mesh/get-admin.js';

const BF = process.env.BLOCKFROST_API_KEY ?? '';
const SPLIT = process.env.SPLIT_LOVELACE ?? '10000000'; // 10 ADA each
const COUNT = Math.max(1, Number(process.env.SPLIT_COUNT ?? '1')); // how many small UTxOs
const MAX_SMALL = BigInt(process.env.MAX_SMALL_LOVELACE ?? '20000000');

const lovelaceOf = (u: { output: { amount: { unit: string; quantity: string }[] } }) =>
  BigInt(u.output.amount.find((a) => a.unit === 'lovelace')?.quantity ?? '0');

async function main() {
  if (!BF) throw new Error('BLOCKFROST_API_KEY required');
  await sodium.ready; // MeshWallet crypto needs libsodium initialized first
  const admin = await getAdmin(BF);
  const addr = admin.addresses.enterpriseAddressBech32 as string;
  // Query the funded enterprise address directly — MeshWallet.getUtxos() looks at
  // its own derived address set, which need not match the enterprise address.
  const bf = new BlockfrostProvider(BF);
  const utxos = await bf.fetchAddressUTxOs(addr);
  console.log('admin address:', addr);
  console.log('L1 UTxOs:', utxos.map((u) => `${u.input.txHash}#${u.input.outputIndex}=${lovelaceOf(u)}`));

  const existing = utxos.filter((u) => lovelaceOf(u) <= MAX_SMALL).length;
  if (existing >= COUNT) {
    console.log(`✓ ${existing} small UTxO(s) already present (need ${COUNT}) — nothing to do`);
    process.exit(0);
  }
  const toMake = COUNT - existing;
  console.log(`Creating ${toMake} small UTxO(s) of ${SPLIT} lovelace each…`);

  const tb = new MeshTxBuilder({ fetcher: bf, submitter: bf, verbose: false });
  for (let i = 0; i < toMake; i++) tb.txOut(addr, [{ unit: 'lovelace', quantity: SPLIT }]);
  const unsigned = await tb.changeAddress(addr).selectUtxosFrom(utxos).complete();
  const signed = await admin.signTx(unsigned);
  const hash = await admin.submitTx(signed);
  console.log(`✓ Split tx submitted (${SPLIT} lovelace → self): ${hash}`);
  console.log('  Wait ~1-2 preprod blocks, then re-query UTxOs.');
  process.exit(0);
}

main().catch((e) => {
  console.error('fund-split failed:', e);
  process.exit(1);
});
