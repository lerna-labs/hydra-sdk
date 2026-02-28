import axios from 'axios';
import { requireEnv } from '../config.js';

interface SnapshotUtxoValue {
  [unit: string]: string;
}

interface SnapshotUtxo {
  address: string;
  datum: null | string;
  datumHash: null | string;
  inlineDatum: null | string;
  referenceScript: null | string;
  value: SnapshotUtxoValue;
}

/** A UTxO entry parsed from the Hydra snapshot. */
export interface ParsedUtxo {
  tx_hash: string;
  output_index: number;
  address: string;
  amount: {
    unit: string;
    quantity: string;
  }[];
}

/**
 * Fetch the full UTxO set from the Hydra head snapshot.
 *
 * Reads `HYDRA_API_URL` from the environment.
 *
 * @returns All UTxOs currently held in the Hydra head.
 */
export async function getUtxoSet(): Promise<ParsedUtxo[]> {
  const baseUrl = requireEnv('HYDRA_API_URL');

  const url = `${baseUrl}/snapshot/utxo`;

  try {
    const response = await axios.get<Record<string, SnapshotUtxo>>(url);
    const data = response.data;

    const UtxoSet: ParsedUtxo[] = [];
    for (const [txKey, utxo] of Object.entries(data)) {
      const [tx_hash, index_str] = txKey.split('#');
      const output_index = parseInt(index_str, 10);
      const amount = Object.entries(utxo.value).map(([unit, quantity]) => ({
        unit,
        quantity,
      }));

      UtxoSet.push({
        tx_hash,
        output_index,
        address: utxo.address,
        amount,
      });
    }

    return UtxoSet;
  } catch (error) {
    console.error('Error fetching the Hydra Ledger?', error);
    throw error;
  }
}

/**
 * Fetch UTxOs belonging to a specific address from the Hydra head snapshot.
 *
 * @param address - Bech32 address to filter by.
 * @returns UTxOs matching the given address.
 */
export async function queryUtxoByAddress(address: string): Promise<ParsedUtxo[]> {
  const result: ParsedUtxo[] = [];
  const data = await getUtxoSet();
  for (const utxo of data) {
    if (utxo.address === address) {
      result.push(utxo);
    }
  }
  return result;
}
