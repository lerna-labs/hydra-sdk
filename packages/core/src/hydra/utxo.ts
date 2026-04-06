import { requireEnv } from '../config.js';

interface SnapshotUtxoValue {
  [unit: string]: string;
}

interface SnapshotUtxo {
  address: string;
  datum: null | string;
  datumHash: null | string;
  inlineDatum: null | unknown;
  referenceScript: null | unknown;
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
  datum?: string | null;
  datumHash?: string | null;
  inlineDatum?: unknown | null;
  referenceScript?: unknown | null;
}

/** Options for UTxO query functions. */
export interface UtxoQueryOptions {
  /** Include datum, datumHash, inlineDatum, and referenceScript fields. Defaults to `false`. */
  includeDatums?: boolean;
}

/**
 * Fetch the full UTxO set from the Hydra head snapshot.
 *
 * Reads `HYDRA_API_URL` from the environment.
 *
 * @param options - Query options. Set `includeDatums: true` to include datum/script fields.
 * @returns All UTxOs currently held in the Hydra head.
 */
export async function getUtxoSet(options?: UtxoQueryOptions): Promise<ParsedUtxo[]> {
  const baseUrl = requireEnv('HYDRA_API_URL');

  const url = `${baseUrl}/snapshot/utxo`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }
    const data: Record<string, SnapshotUtxo> = await response.json();

    const UtxoSet: ParsedUtxo[] = [];
    for (const [txKey, utxo] of Object.entries(data)) {
      const [tx_hash, index_str] = txKey.split('#');
      const output_index = parseInt(index_str, 10);
      const amount = Object.entries(utxo.value).map(([unit, quantity]) => ({
        unit,
        quantity,
      }));

      const parsed: ParsedUtxo = { tx_hash, output_index, address: utxo.address, amount };

      if (options?.includeDatums) {
        parsed.datum = utxo.datum ?? null;
        parsed.datumHash = utxo.datumHash ?? null;
        parsed.inlineDatum = utxo.inlineDatum ?? null;
        parsed.referenceScript = utxo.referenceScript ?? null;
      }

      UtxoSet.push(parsed);
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
export async function queryUtxoByAddress(address: string, options?: UtxoQueryOptions): Promise<ParsedUtxo[]> {
  const result: ParsedUtxo[] = [];
  const data = await getUtxoSet(options);
  for (const utxo of data) {
    if (utxo.address === address) {
      result.push(utxo);
    }
  }
  return result;
}
