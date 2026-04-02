import { readFileSync } from 'node:fs';
import { BlockfrostProvider, MeshWallet } from '@meshsdk/core';
import { optionalEnv } from '../config.js';

/**
 * Create and initialize a MeshWallet for the Hydra head admin.
 *
 * Reads the Cardano signing key from `HYDRA_ADMIN_KEY_FILE` (preferred)
 * or falls back to `HYDRA_ADMIN_CARDANO_PK`. Network is selected via `HYDRA_NETWORK`.
 *
 * @param blockfrostProjectId - Optional Blockfrost project ID. When provided, the wallet
 *   is configured with a Blockfrost fetcher and submitter for L1 operations (e.g. preparing
 *   the Hydra head, querying UTxOs, submitting commit transactions).
 * @returns An initialized MeshWallet ready for signing transactions.
 * @throws If no signing key is available or the wallet fails to initialize.
 */
export async function getAdmin(blockfrostProjectId?: string): Promise<MeshWallet> {
  let keyCborHex: string | null = null;

  // Preferred: read the instance's cardano.sk file directly (no secrets in .env)
  const keyFile = process.env.HYDRA_ADMIN_KEY_FILE;
  if (keyFile) {
    const content = JSON.parse(readFileSync(keyFile, 'utf-8'));
    keyCborHex = content.cborHex ?? content.key?.cborHex ?? null;
  }

  // Fallback: cborHex passed via env var (backward compatible)
  if (!keyCborHex) {
    keyCborHex = process.env.HYDRA_ADMIN_CARDANO_PK || null;
  }

  if (!keyCborHex) {
    throw new Error(
      'Cardano signing key not found. Set HYDRA_ADMIN_KEY_FILE to the instance cardano.sk path, or HYDRA_ADMIN_CARDANO_PK to its cborHex.',
    );
  }

  let networkId = parseInt(optionalEnv('HYDRA_NETWORK', '0'), 10);

  if (networkId < 0) {
    networkId = 0;
  } else if (networkId > 1) {
    networkId = 1;
  }

  const walletOptions: ConstructorParameters<typeof MeshWallet>[0] = {
    networkId: networkId as 0 | 1,
    key: {
      type: 'cli',
      payment: keyCborHex,
    },
  };

  if (blockfrostProjectId) {
    const blockfrost = new BlockfrostProvider(blockfrostProjectId);
    walletOptions.fetcher = blockfrost;
    walletOptions.submitter = blockfrost;
  }

  const wallet = new MeshWallet(walletOptions);

  await wallet.init();

  if (!wallet.addresses.enterpriseAddressBech32) {
    throw new Error('Wallet failed to initialize!');
  }

  return wallet;
}
