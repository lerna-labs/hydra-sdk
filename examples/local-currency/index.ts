import './load';

import {
  createMultisigAddress,
  getAdmin,
  queryUtxoByAddress,
  submitTx,
  verifySignature,
  Wrangler,
} from '@lerna-labs/hydra-sdk';
import type { MeshWallet } from '@meshsdk/core';
import express from 'express';
import { ArgValue } from 'tx3-sdk/trp';
import { authHeaderMiddleware } from './middleware';
import { Client } from './protocol';

const app = express();
app.use(express.json());
app.use(authHeaderMiddleware);
const port = process.env.EXPRESS_PORT || 3000;
const TRP_URL = process.env.TRP_URL as string;
const HYDRA_NETWORK = parseInt(process.env.HYDRA_NETWORK || '0', 10);
const BYPASS_TOKEN = process.env.BYPASS_TOKEN || 'true';

type initializePayload = {
  admin_wallet?: MeshWallet;
  address?: string;
  scriptCbor?: string;
  client?: Client;
};

// Recursive function to sanitize BigInts... need to swap them to strings when passing JSON
function sanitizeBigInts(obj: any): any {
  if (typeof obj === 'bigint') {
    return obj.toString();
  } else if (Array.isArray(obj)) {
    return obj.map(sanitizeBigInts);
  } else if (obj && typeof obj === 'object') {
    const newObj: any = {};
    for (const key of Object.keys(obj)) {
      newObj[key] = sanitizeBigInts(obj[key]);
    }
    return newObj;
  } else {
    return obj;
  }
}

async function initialize(user_address?: string): Promise<initializePayload> {
  let admin_wallet: MeshWallet;
  try {
    admin_wallet = await getAdmin();
  } catch (error: any) {
    console.error(`Failed to initialize...`, error);
    return {};
  }

  const admin_address = admin_wallet.addresses.enterpriseAddressBech32 as string;
  const client = new Client({
    endpoint: TRP_URL as string,
  });

  if (user_address === undefined) {
    return { admin_wallet, client };
  } else {
    const { address, scriptCbor } = createMultisigAddress(admin_address, user_address, HYDRA_NETWORK);
    return { admin_wallet, address, scriptCbor, client };
  }
}

app.get('/', (_, res) => {
  res.send('Hydra SDK API is running');
});

app.get('/health', async (_, res) => {
  const wrangler = new Wrangler(process.env.HYDRA_API_URL, process.env.HYDRA_WS_URL);
  try {
    const status = await wrangler.getHeadStatus(5000); // 5s
    return res.json({ status });
  } catch (e: any) {
    console.error('Health check failed:', e);
    return res.json({
      status: 'ERROR',
      message: 'Could not connect to Hydra node!',
    });
  }
});

app.post('/start', async (req, res) => {
  const wrangler = new Wrangler(process.env.HYDRA_API_URL, process.env.HYDRA_WS_URL);
  const txHash = req.body.txHash;
  const txIndex = req.body.txIdx;

  if (!txHash || txIndex === undefined || txIndex === null || txIndex < 0) {
    console.error(`Bad commit identifiers:`, txHash, txIndex);
    return res.status(400).json({
      status: 'ERROR',
      message: 'Bad Commit UTxO Identifiers',
    });
  }

  try {
    await wrangler.waitForHeadOpen({ txHash, txIndex }, 180000);
    return res.json({
      status: 'SUCCESS',
      message: 'Head is open',
    });
  } catch (err: any) {
    console.error('Failed to start head:', err);
    return res.json({
      status: 'ERROR',
      message: err.message || 'Failed to start head',
    });
  }
});

app.get('/utxos/:address', async (req, res) => {
  const user_address = req.params.address;
  const { admin_wallet, address } = await initialize(user_address);

  if (!admin_wallet) {
    res.json({
      status: 'ERROR',
      message: 'Could not initialize admin wallet',
    });
    return;
  }

  if (!address) {
    res.json({
      status: 'ERROR',
      message: 'Could not initialize user address',
    });
    return;
  }

  try {
    const utxos = await queryUtxoByAddress(address);
    res.json({
      status: 'SUCCESS',
      data: {
        address,
        utxos,
      },
    });
  } catch (_error: any) {
    res.json({
      status: 'ERROR',
      message: 'Failed to query UTxO',
    });
  }
});

app.get('/balance/:address', async (req, res) => {
  const user_address = req.params.address;
  const { admin_wallet, address } = await initialize(user_address);

  if (!admin_wallet) {
    res.json({
      status: 'ERROR',
      message: 'Could not initialize admin wallet',
    });
    return;
  }

  if (!address) {
    res.json({
      status: 'ERROR',
      message: 'Could not initialize user address',
    });
    return;
  }

  try {
    const utxos = await queryUtxoByAddress(address);
    const balance: Record<string, bigint> = {};
    utxos.forEach((utxo: any) => {
      utxo.amount.forEach((value: any) => {
        const policy_id = value.unit;
        for (const [asset_id, quantity] of Object.entries(value.quantity)) {
          const unit = `${policy_id}.${asset_id}`;
          if (balance[unit] === undefined) {
            balance[unit] = 0n;
          }

          balance[unit] += BigInt(quantity as string);
        }
      });
    });
    res.json({
      status: 'SUCCESS',
      data: {
        balance: sanitizeBigInts(balance),
      },
    });
  } catch (error: any) {
    console.error(`Balance check error`, error);
    res.json({
      status: 'ERROR',
      message: 'Could not query utxo by address',
    });
  }
});

app.post('/send', async (req, res) => {
  const sender_address = req.body.sender;
  const receiver_address = req.body.receiver;
  const quantity = req.body.quantity;
  const reason = req.body.reason;
  const signature = req.body.signature;
  const signature_key = req.body.key;

  try {
    const { isValid, sigMeta, pubKeyHex } =
      req.headers['x-bypass-validation'] !== BYPASS_TOKEN
        ? verifySignature(signature, reason, sender_address, signature_key)
        : {
            isValid: true,
            sigMeta: ['', ''],
            pubKeyHex: '',
          };

    if (!isValid) {
      res.json({
        status: 'ERROR',
        message: 'Invalid signature',
      });
      return;
    }

    const { admin_wallet, address, scriptCbor, client } = await initialize(sender_address);
    if (!admin_wallet) {
      res.json({
        status: 'ERROR',
        message: 'Could not initialize admin wallet',
      });
      return;
    }

    if (!address) {
      res.json({
        status: 'ERROR',
        message: 'Could not initialize user address',
      });
      return;
    }

    if (!client) {
      res.json({
        status: 'ERROR',
        message: 'Could not start the TRP client!',
      });
      return;
    }

    const args = {
      quantity: ArgValue.from(quantity),
      sender: ArgValue.from(address),
      receiver: ArgValue.from(receiver_address),
      reason: ArgValue.from(Buffer.from(reason, 'utf-8')),
      userSignature1: ArgValue.from(Buffer.from(sigMeta[0], 'hex')),
      userSignature2: ArgValue.from(Buffer.from(sigMeta[1], 'hex')),
      userKey: ArgValue.from(Buffer.from(pubKeyHex, 'hex')),
      userScript: ArgValue.from(Buffer.from(scriptCbor as string, 'hex')),
    };

    const response = await client.sendCoinsTx(args);
    const signedTx = await admin_wallet.signTx(response.tx);
    const submit_response = await submitTx(TRP_URL, signedTx, reason);
    const response_json = await submit_response.json();

    if (response_json.error) {
      res.json({
        status: 'ERROR',
        message: response_json.error.message,
      });
      return;
    }

    res.json({
      status: 'SUCCESS',
      data: {
        txHash: response_json.result.hash,
      },
    });
  } catch (err: any) {
    console.error('Send Tx Error', err);
    res.json({
      status: 'ERROR',
      message: 'Could not create transaction, please try again',
    });
  }
});

app.post('/reward', async (req, res) => {
  const user_address = req.body.address;
  const reason = req.body.reason;
  const quantity = req.body.quantity;

  const { admin_wallet, address, client } = await initialize(user_address);

  if (!admin_wallet) {
    res.json({
      status: 'ERROR',
      message: 'Could not initialize admin wallet',
    });
    return;
  }

  const admin_payment_address = admin_wallet.addresses.enterpriseAddressBech32 as string;

  if (!address) {
    res.json({
      status: 'ERROR',
      message: 'Could not initialize user address',
    });
    return;
  }

  if (!client) {
    res.json({
      status: 'ERROR',
      message: 'Could not start the TRP client!',
    });
    return;
  }

  console.log(`Attempting to issue ${quantity} rewards from ${admin_payment_address} to ${address} for: ${reason}`);

  const mintArgs = {
    admin: ArgValue.from(admin_payment_address),
    metadataValue: ArgValue.from(Buffer.from(reason, 'utf-8')),
    quantity: ArgValue.from(quantity),
    receiver: ArgValue.from(address as string),
    mintingScript: ArgValue.from(Buffer.from('820181820400', 'hex')),
  };

  try {
    const response = await client.mintCoinsTx(mintArgs);
    const signedTx = await admin_wallet.signTx(response.tx);
    const submit_response = await submitTx(TRP_URL, signedTx, reason);
    const response_json = await submit_response.json();

    if (response_json.error) {
      console.error(`Failed to mint`, response_json.error.data);
      res.json({
        status: 'ERROR',
        message: response_json.error.message,
      });
      return;
    }

    console.log(`Mint Success!`, response_json.result.hash);

    res.json({
      status: 'SUCCESS',
      data: {
        txHash: response_json.result.hash,
      },
    });
  } catch (err: any) {
    console.error('Mint Tx Failure', err);
    res.json({
      status: 'ERROR',
      message: 'Could not mint coins',
    });
  }
});

app.post('/merge', async (req, res) => {
  const user_address = req.body.address;
  const ref_utxo = req.body.input;

  const { admin_wallet, address, scriptCbor, client } = await initialize(user_address);

  if (!admin_wallet) {
    res.json({
      status: 'ERROR',
      message: 'Could not initialize admin wallet',
    });
    return;
  }

  const admin_payment_address = admin_wallet.addresses.enterpriseAddressBech32 as string;

  if (!address) {
    res.json({
      status: 'ERROR',
      message: 'Could not initialize user address',
    });
    return;
  }

  if (!client) {
    res.json({
      status: 'ERROR',
      message: 'Could not start the TRP client!',
    });
    return;
  }

  try {
    const response = await client.mergeEmptyTx({
      admin: ArgValue.from(admin_payment_address),
      emptyref: ArgValue.from(ref_utxo),
      emptyscript: ArgValue.from(Buffer.from(scriptCbor as string, 'hex')),
    });

    const signedTx = await admin_wallet.signTx(response.tx);
    const submit_response = await submitTx(TRP_URL, signedTx, 'mergeitrealgood');
    const response_json = await submit_response.json();

    if (response_json.error) {
      console.error(`Failed to merge?`, response_json.error.data);
      res.json({
        status: 'ERROR',
        message: response_json.error.message,
      });
      return;
    }

    console.log(`Merge success!`, response_json.result.hash);
    res.json({
      status: 'SUCCESS',
      data: {
        txHash: response_json.result.hash,
      },
    });
  } catch (err: any) {
    console.error('Could not merge?', err);
    res.json({ status: 'ERROR', message: 'Could not merge?' });
  }
});

app.post('/burn', async (req, res) => {
  const user_address = req.body.address;
  const quantity = req.body.quantity;

  const { admin_wallet, address, scriptCbor, client } = await initialize(user_address);

  if (!admin_wallet) {
    res.json({
      status: 'ERROR',
      message: 'Could not initialize admin wallet',
    });
    return;
  }

  if (!client) {
    res.json({
      status: 'ERROR',
      message: 'Could not start the TRP client!',
    });
    return;
  }

  const burner_address = admin_wallet.addresses.enterpriseAddressBech32 === user_address ? user_address : address;

  const burn_args = {
    burner: ArgValue.from(burner_address as string),
    quantity: ArgValue.from(quantity),
    mintingScript: ArgValue.from(Buffer.from('820181820400', 'hex')),
    userScript: ArgValue.from(Buffer.from(scriptCbor as string, 'hex')),
  };

  try {
    const response = await client.burnCoinsTx(burn_args);
    const signedTx = await admin_wallet.signTx(response.tx);
    const submit_response = await submitTx(TRP_URL, signedTx, 'burnbabyburn');
    const response_json = await submit_response.json();

    if (response_json.result?.hash) {
      res.json({
        status: 'SUCCESS',
        data: {
          txHash: response_json.result.hash,
        },
      });
    } else {
      console.error(`Burn Tx Failure`, response_json);
      res.json({
        status: 'ERROR',
        message: 'Could not create burn transaction, please try again',
      });
    }
  } catch (e: any) {
    console.error(`Could not resolve burn tx:`, e);
    res.json({
      status: 'ERROR',
      message: 'Could not create burn transaction, please try again',
    });
    return;
  }
});

app.post('/adminburn', async (req, res) => {
  const quantity = req.body.quantity;

  const { admin_wallet, client } = await initialize();

  if (!admin_wallet) {
    res.json({
      status: 'ERROR',
      message: 'Could not initialize admin wallet',
    });
    return;
  }

  if (!client) {
    res.json({
      status: 'ERROR',
      message: 'Could not start the TRP client!',
    });
    return;
  }

  const admin_payment_address = admin_wallet.addresses.enterpriseAddressBech32 as string;

  const burn_args = {
    admin: ArgValue.from(admin_payment_address),
    quantity: ArgValue.from(quantity),
    mintingScript: ArgValue.from(Buffer.from('820181820400', 'hex')),
  };

  try {
    const response = await client.adminBurnTx(burn_args);
    const signedTx = await admin_wallet.signTx(response.tx);
    const submit_response = await submitTx(TRP_URL, signedTx, 'burnbabyburn');
    const response_json = await submit_response.json();
    if (response_json.result?.hash) {
      res.json({
        status: 'SUCCESS',
        data: {
          txHash: response_json.result.hash,
        },
      });
    } else {
      console.error(`Admin Burn Tx Failure`, response_json);
      res.json({
        status: 'ERROR',
        message: 'Could not create burn transaction, please try again',
      });
    }
  } catch (e: any) {
    console.error(`Could not resolve admin burn tx:`, e);
    res.json({
      status: 'ERROR',
      message: 'Could not create burn transaction, please try again',
    });
    return;
  }
});

app.listen(port, () => {
  console.log(`✅ Hydra SDK API server is running on http://localhost:${port}`);
  console.log(`✅ Hydra Network: ${HYDRA_NETWORK}`);
});
