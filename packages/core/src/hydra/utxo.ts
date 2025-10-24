import axios from 'axios';

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

interface ParsedUtxo {
  tx_hash: string;
  output_index: number;
  address: string;
  amount: {
    unit: string;
    quantity: string;
  }[];
}

/**
 * Fetches the full UTxO snapshot and filters by address.
 */
export async function queryUtxoByAddress(address: string): Promise<ParsedUtxo[]> {
    console.log(`Querying UTxO by Address: ${address}`);

  const baseUrl = process.env.HYDRA_API_URL;
  console.log(`Base Url: ${baseUrl}`);

  if (!baseUrl) {
    throw new Error('HYDRA_API_URL is not defined in the environment variables.');
  }

  const url = `${baseUrl}/snapshot/utxo`;

  try {
    const response = await axios.get<Record<string, SnapshotUtxo>>(url);
    const data = response.data;

    console.log(`Did get data?`, Object.entries(data).length);

    const result: ParsedUtxo[] = [];

    for (const [txKey, utxo] of Object.entries(data)) {
      if (utxo.address === address) {
        const [tx_hash, indexStr] = txKey.split('#');
        const output_index = parseInt(indexStr, 10);

        const amount = Object.entries(utxo.value).map(([unit, quantity]) => ({
          unit,
          quantity,
        }));

        result.push({
          tx_hash,
          output_index,
          address: utxo.address,
          amount,
        });
      }
    }

    return result;
  } catch (error: any) {
    console.error('Failed to fetch or parse UTxO snapshot:', error.message);
    throw error;
  }
}