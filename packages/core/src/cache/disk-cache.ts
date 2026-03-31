import fs from 'node:fs/promises';
import path from 'node:path';

export interface DiskCacheConfig {
  /** Root directory for all cache storage (e.g. "/ipfs-staging"). */
  stagingDir: string;
  /**
   * Subdirectory name for the full document payloads.
   * @default "documents"
   */
  documentsSubdir?: string;
  /**
   * Subdirectory name for the latest-entry lookup files.
   * @default "latest"
   */
  latestSubdir?: string;
}

/**
 * A generic disk-backed in-memory cache keyed by a string identifier.
 *
 * Each entry is persisted to disk in two places:
 * - `documents/` — the full payload (intended for IPFS pinning)
 * - `latest/`    — a lightweight lookup file keyed by id (for fast rehydration)
 *
 * On startup, call {@link rehydrate} to rebuild the in-memory `Map` from the
 * `latest/` directory so the cache survives service restarts.
 *
 * @typeParam E - The shape of a cache entry (must include a string `id` field
 *               used as the Map key and the latest/ filename).
 */
export function createDiskCache<E extends object>(
  config: DiskCacheConfig,
  /** Extract the cache key from an entry. */
  keyFn: (entry: E) => string,
) {
  const docsDir = path.join(config.stagingDir, config.documentsSubdir ?? 'documents');
  const latestDir = path.join(config.stagingDir, config.latestSubdir ?? 'latest');
  const cache = new Map<string, E>();

  /** Ensure the storage directories exist. */
  async function ensureDirs(): Promise<void> {
    await fs.mkdir(docsDir, { recursive: true });
    await fs.mkdir(latestDir, { recursive: true });
  }

  /**
   * Rebuild the in-memory cache from the `latest/` directory on disk.
   * Call once before the service starts accepting requests.
   *
   * @returns The number of entries loaded.
   */
  async function rehydrate(): Promise<number> {
    await ensureDirs();
    const files = await fs.readdir(latestDir);
    let count = 0;
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(latestDir, file), 'utf-8');
        const entry: E = JSON.parse(raw);
        cache.set(keyFn(entry), entry);
        count++;
      } catch {
        // Skip corrupt / unparseable files
      }
    }
    return count;
  }

  /**
   * Store an entry in both the in-memory cache and on disk.
   *
   * @param entry       - The cache entry.
   * @param filename    - Filename for the full payload in `documents/`.
   * @param fullPayload - The complete payload to persist (may differ from
   *                      the lightweight entry stored in `latest/`).
   * @returns Absolute path to the written document file.
   */
  async function put(entry: E, filename: string, fullPayload: unknown): Promise<string> {
    await ensureDirs();
    const key = keyFn(entry);
    cache.set(key, entry);

    const docPath = path.join(docsDir, filename);
    await fs.writeFile(docPath, JSON.stringify(fullPayload, null, 2));

    const latestPath = path.join(latestDir, `${key}.json`);
    await fs.writeFile(latestPath, JSON.stringify(entry));

    return docPath;
  }

  /** Retrieve an entry by key from the in-memory cache. */
  function get(key: string): E | undefined {
    return cache.get(key);
  }

  /** Return all cached entries. */
  function getAll(): E[] {
    return Array.from(cache.values());
  }

  /** Return the absolute path to the documents directory (for IPFS pinning). */
  function getDocumentsDir(): string {
    return docsDir;
  }

  return { rehydrate, put, get, getAll, getDocumentsDir };
}

export type DiskCache<E extends object> = ReturnType<typeof createDiskCache<E>>;
