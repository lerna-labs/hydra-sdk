import { readFileSync } from 'node:fs';
import { MeshWallet } from '@meshsdk/core';

export async function getAdmin(): Promise<MeshWallet> {
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

  let networkId = parseInt(process.env.HYDRA_NETWORK || '0', 10);

  if (networkId < 0) {
    networkId = 0;
  } else if (networkId > 1) {
    networkId = 1;
  }

  const wallet = new MeshWallet({
    networkId: networkId as 0 | 1,
    key: {
      type: 'cli',
      payment: keyCborHex,
    },
  });

  await wallet.init();

  if (!wallet.addresses.enterpriseAddressBech32) {
    throw new Error('Wallet failed to initialize!');
  }

  return wallet;
}
