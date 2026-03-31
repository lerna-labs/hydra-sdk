import fs from 'node:fs/promises';
import path from 'node:path';

export interface IpfsConfig {
  /** Base URL for the Kubo HTTP API (e.g. "http://localhost:5001"). */
  apiUrl: string;
}

export interface PinResult {
  /** The content-identifier returned by the IPFS node. */
  cid: string;
  /** Size in bytes as reported by the IPFS node. */
  size: number;
}

/**
 * Create an IPFS client bound to the given Kubo API endpoint.
 *
 * All operations go through the Kubo HTTP RPC, so the only requirement
 * is a reachable Kubo node — no additional IPFS libraries are needed.
 */
export function createIpfsClient(config: IpfsConfig) {
  const { apiUrl } = config;

  /**
   * Pin a single JSON-serialisable payload and return its CID.
   *
   * @param filename - Filename used inside the IPFS object.
   * @param payload  - Any JSON-serialisable value.
   */
  async function pinJson(filename: string, payload: unknown): Promise<PinResult> {
    const body = JSON.stringify(payload, null, 2);
    const form = new FormData();
    form.append('file', new Blob([body], { type: 'application/json' }), filename);

    const res = await fetch(`${apiUrl}/api/v0/add?pin=true`, {
      method: 'POST',
      body: form,
    });

    if (!res.ok) {
      throw new Error(`IPFS pin failed: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as { Hash: string; Size: string };
    return { cid: json.Hash, size: Number.parseInt(json.Size, 10) };
  }

  /**
   * Pin every file in a directory and wrap them in an IPFS directory object.
   *
   * @param dirPath - Absolute path to a local directory.
   * @returns The CID of the wrapping IPFS directory.
   */
  async function pinDirectory(dirPath: string): Promise<PinResult> {
    const entries = await fs.readdir(dirPath);
    const form = new FormData();

    for (const entry of entries) {
      const filePath = path.join(dirPath, entry);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      const content = await fs.readFile(filePath, 'utf-8');
      form.append('file', new Blob([content]), entry);
    }

    const res = await fetch(`${apiUrl}/api/v0/add?pin=true&wrap-with-directory=true&recursive=true`, {
      method: 'POST',
      body: form,
    });

    if (!res.ok) {
      throw new Error(`IPFS directory pin failed: ${res.status} ${await res.text()}`);
    }

    // Kubo returns one JSON object per line (ndjson). The last line is the
    // wrapping directory entry.
    const text = await res.text();
    const lines = text.trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]) as { Hash: string; Size: string };
    return { cid: last.Hash, size: Number.parseInt(last.Size, 10) };
  }

  /**
   * Fetch a JSON payload from IPFS by CID.
   *
   * @param cid - The content identifier to retrieve.
   */
  async function fetchJson<T = unknown>(cid: string): Promise<T> {
    const res = await fetch(`${apiUrl}/api/v0/cat?arg=${cid}`, {
      method: 'POST',
    });

    if (!res.ok) {
      throw new Error(`IPFS fetch failed: ${res.status} ${await res.text()}`);
    }

    return (await res.json()) as T;
  }

  return { pinJson, pinDirectory, fetchJson };
}

export type IpfsClient = ReturnType<typeof createIpfsClient>;
