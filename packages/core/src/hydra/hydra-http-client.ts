import type { CommitBlueprintPayload, HydraTransaction, HydraUTxOEntry, HydraUTxOs } from './types.js';

/**
 * HTTP client for the Hydra node REST API.
 *
 * Uses native `fetch` (Node 18+). Accepts 200 and 202 as success responses.
 */
export class HydraHttpClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Build a commit transaction.
   *
   * `POST /commit` — returns the unsigned L1 transaction CBOR hex.
   */
  async buildCommit(payload: HydraUTxOs | CommitBlueprintPayload | Record<string, never>): Promise<string> {
    const response = await this.post('/commit', payload);
    return response.cborHex;
  }

  /**
   * Publish a decommit transaction.
   *
   * `POST /decommit` — submits the decommit request to the Hydra node.
   */
  async publishDecommit(transaction: HydraTransaction): Promise<unknown> {
    return this.post('/decommit', { tag: 'Decommit', transaction });
  }

  /** Fetch the current UTxO snapshot. `GET /snapshot/utxo` */
  async getSnapshotUtxo(): Promise<Record<string, HydraUTxOEntry>> {
    return this.get('/snapshot/utxo');
  }

  /** Fetch protocol parameters. `GET /protocol-parameters` */
  async getProtocolParameters(): Promise<unknown> {
    return this.get('/protocol-parameters');
  }

  private async post(path: string, payload: unknown): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok && response.status !== 202) {
      const body = await response.text().catch(() => '');
      throw new Error(`Hydra HTTP ${response.status} on POST ${path}: ${body}`);
    }
    return response.json();
  }

  private async get(path: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok && response.status !== 202) {
      const body = await response.text().catch(() => '');
      throw new Error(`Hydra HTTP ${response.status} on GET ${path}: ${body}`);
    }
    return response.json();
  }
}
