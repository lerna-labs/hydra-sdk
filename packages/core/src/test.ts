import * as dotenv from 'dotenv';

dotenv.config({ path: '.local.env' });

import { BlockfrostProvider, MeshTxBuilder, MeshWallet } from '@meshsdk/core';
import { Wrangler } from './wrangler.js';

(async () => {
  const admin_wallet = new MeshWallet({
    networkId: parseInt(process.env.HYDRA_NETWORK_ID || '0', 10) as 1 | 0,
    key: {
      type: 'cli',
      payment: process.env.HYDRA_ADMIN_CARDANO_PK as string,
    },
  });

  await admin_wallet.init();

  const admin_address = admin_wallet.addresses.enterpriseAddressBech32 as string;
  console.log(`Admin address: ${admin_address}`);

  const blockfrostProvider = new BlockfrostProvider(process.env.BLOCKFROST_API_KEY as string);

  const _txHash = 'a000003f633d9b2efcc18dedefaf60623e3132c8b05a5751ac08d3bf6f505d54';
  const _txIndex = 3;

  const utxo = await blockfrostProvider.fetchAddressUTxOs(admin_address);

  if (utxo.length < 3) {
    console.log(utxo);
    const unsigned_tx = await new MeshTxBuilder({
      fetcher: blockfrostProvider,
    })
      .txOut(admin_address, [
        {
          unit: 'lovelace',
          quantity: '5000000',
        },
      ])
      .txOut(admin_address, [
        {
          unit: 'lovelace',
          quantity: '5000000',
        },
      ])
      .txOut(admin_address, [
        {
          unit: 'lovelace',
          quantity: '5000000',
        },
      ])
      .txOut(admin_address, [
        {
          unit: 'lovelace',
          quantity: '5000000',
        },
      ])
      .txOut(admin_address, [
        {
          unit: 'lovelace',
          quantity: '5000000',
        },
      ])
      .changeAddress(admin_address)
      .selectUtxosFrom(utxo)
      .complete();
    const signed = await admin_wallet.signTx(unsigned_tx);
    await blockfrostProvider.submitTx(signed);
    console.log('Just created some seed utxo... give it a minute!');
    return;
  }

  const wrangler = new Wrangler();
  // await wrangler.startHead(txHash, txIndex);
  await wrangler.shutdownHead();
})();
