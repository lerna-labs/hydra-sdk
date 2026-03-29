import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Disk-backed in-memory cache for notarised documents.
 *
 * Each entry is keyed by document hash and persisted as a JSON file under
 * the staging directory. On startup, the cache rehydrates from disk so that
 * the most recent notarisation per document survives service restarts.
 */

export interface NotaryEntry {
  docHash: string;
  ipfsCid: string;
  txHash?: string;
  submitter: string;
  filename: string;
  timestamp: number;
}

const STAGING_DIR = process.env.IPFS_STAGING_DIR || '/ipfs-staging';
const DOCS_DIR = path.join(STAGING_DIR, 'documents');
const LATEST_DIR = path.join(STAGING_DIR, 'latest');

/** In-memory hot cache: docHash -> most recent entry */
const cache = new Map<string, NotaryEntry>();

/**
 * Rehydrate the in-memory cache from the `latest/` directory on disk.
 * Call this once before starting the HTTP server.
 */
export async function rehydrateCache(): Promise<number> {
  await fs.mkdir(DOCS_DIR, { recursive: true });
  await fs.mkdir(LATEST_DIR, { recursive: true });

  const files = await fs.readdir(LATEST_DIR);
  let count = 0;
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(LATEST_DIR, file), 'utf-8');
      const entry: NotaryEntry = JSON.parse(raw);
      cache.set(entry.docHash, entry);
      count++;
    } catch {
      // Skip corrupt files
    }
  }
  return count;
}

/**
 * Store a notarisation entry in both memory and on disk.
 *
 * - The full payload is written to `documents/` (this is what gets pinned to IPFS).
 * - A latest-lookup copy is written to `latest/{docHash}.json`.
 */
export async function cacheEntry(entry: NotaryEntry, fullPayload: unknown): Promise<string> {
  cache.set(entry.docHash, entry);

  const docPath = path.join(DOCS_DIR, entry.filename);
  await fs.writeFile(docPath, JSON.stringify(fullPayload, null, 2));

  const latestPath = path.join(LATEST_DIR, `${entry.docHash}.json`);
  await fs.writeFile(latestPath, JSON.stringify(entry));

  return docPath;
}

/** Retrieve the most recent notarisation for a given document hash. */
export function getEntry(docHash: string): NotaryEntry | undefined {
  return cache.get(docHash);
}

/** Retrieve all cached entries. */
export function getAllEntries(): NotaryEntry[] {
  return Array.from(cache.values());
}

/** Return the documents directory path (for pinning the whole directory to IPFS). */
export function getDocumentsDir(): string {
  return DOCS_DIR;
}
