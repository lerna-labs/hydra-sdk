import {
  MeshWallet,
} from '@meshsdk/core';

export async function getAdmin(): Promise<MeshWallet> {
  const keyCborHex = process.env.HYDRA_ADMIN_CARDANO_PK || null;
  if (!keyCborHex) {
    throw new Error('Admin signing key is not defined!');
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