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

export async function getUtxoSet(): Promise<ParsedUtxo[]> {
  const baseUrl = process.env.HYDRA_API_URL;

  if (!baseUrl) {
    throw new Error("HYDRA_API_URL is not defined in the environment variables!");
  }

  const url = `${baseUrl}/snapshot/utxo`;

  try {
    const response = await axios.get<Record<string, SnapshotUtxo>>(url);
    const data = response.data;

    const UtxoSet: ParsedUtxo[] = [];
    for (const [txKey, utxo] of Object.entries(data)) {
      const [tx_hash, index_str] = txKey.split("#");
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
    console.error("Error fetching the Hydra Ledger?", error);
    throw error;
  }
}

/**
 * Fetches the full UTxO snapshot and filters by address.
 */
export async function queryUtxoByAddress(address: string): Promise<ParsedUtxo[]> {
    console.log(`Querying UTxO by Address: ${address}`);


  try {
    const result: ParsedUtxo[] = [];
    const data = await getUtxoSet();
    for (const utxo of data) {
      if (utxo.address === address) {
        result.push(utxo);
      }
    }
    return result;
  } catch (error: any) {
    console.error('Failed to fetch or parse UTxO snapshot:', error.message);
    throw error;
  }
}