import fs from 'node:fs/promises';
import path from 'node:path';

const IPFS_API_URL = process.env.IPFS_API_URL || 'http://localhost:5001';

export interface PinResult {
  cid: string;
  size: number;
}

/**
 * Pin a JSON payload to the local IPFS node.
 *
 * @param filename - Name used for the IPFS file object.
 * @param payload  - Arbitrary JSON-serialisable data.
 * @returns The CID and size reported by the IPFS node.
 */
export async function pinJson(filename: string, payload: unknown): Promise<PinResult> {
  const body = JSON.stringify(payload, null, 2);
  const form = new FormData();
  form.append('file', new Blob([body], { type: 'application/json' }), filename);

  const res = await fetch(`${IPFS_API_URL}/api/v0/add?pin=true`, {
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
 * Pin an entire directory to IPFS and return the wrapping directory CID.
 *
 * @param dirPath - Absolute path to the directory on disk.
 * @returns The root directory CID.
 */
export async function pinDirectory(dirPath: string): Promise<PinResult> {
  const entries = await fs.readdir(dirPath);
  const form = new FormData();

  for (const entry of entries) {
    const filePath = path.join(dirPath, entry);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) continue;
    const content = await fs.readFile(filePath, 'utf-8');
    form.append('file', new Blob([content]), entry);
  }

  const res = await fetch(`${IPFS_API_URL}/api/v0/add?pin=true&wrap-with-directory=true&recursive=true`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    throw new Error(`IPFS directory pin failed: ${res.status} ${await res.text()}`);
  }

  // The Kubo add API returns one JSON object per line (ndjson).
  // The last entry is the wrapping directory.
  const text = await res.text();
  const lines = text.trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]) as { Hash: string; Size: string };
  return { cid: last.Hash, size: Number.parseInt(last.Size, 10) };
}
