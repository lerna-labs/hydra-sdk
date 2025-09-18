import './load';

import express from 'express';
import { authHeaderMiddleware } from './middleware';
import {
  Wrangler,
  queryUtxoByAddress,
} from '@lerna-labs/hydra-sdk';

const app = express();
app.use(express.json());
app.use(authHeaderMiddleware);
const port = process.env.EXPRESS_PORT || 3000;
const HYDRA_NETWORK = parseInt(process.env.HYDRA_NETWORK || '0', 10);

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

  if (!user_address) {
    res.json({
      status: 'ERROR',
      message: 'Could not initialize user address',
    });
    return;
  }

  try {
    const utxos = await queryUtxoByAddress(user_address);
    res.json({
      status: 'SUCCESS',
      data: {
        address: user_address,
        utxos,
      },
    });
  } catch (error: any) {
    res.json({
      status: 'ERROR',
      message: 'Failed to query UTxO',
    });
  }
});

app.get('/balance/:address', async (req, res) => {
  const user_address = req.params.address;

  if (!user_address) {
    res.json({
      status: 'ERROR',
      message: 'Could not initialize user address',
    });
    return;
  }

  try {
    const utxos = await queryUtxoByAddress(user_address);
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

app.listen(port, () => {
  console.log(`✅ Hydra SDK API server is running on http://localhost:${port}`);
  console.log(`✅ Hydra Network: ${HYDRA_NETWORK}`);
});
