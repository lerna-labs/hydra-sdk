import { blake2b } from '@noble/hashes/blake2.js';

/** Raw byte array. */
export type Bytes = Uint8Array;
/** Lowercase hex-encoded hash string. */
export type HashHex = string;
/** Controls whether leaf hashes include the file path. */
export type LeafMode = 'content' | 'content+path';

/** Metadata for a file to be included in the Merkle tree. */
export type FileLeaf = {
  name: string;
  mime?: string;
  size?: number;
  contentHashHex: string;
};

/** A single sibling hash step in a Merkle inclusion proof. */
export type ProofStep = { siblingHex: HashHex };

/** Self-describing proof package containing the tree root and per-file proofs. */
export type ProofPackage = {
  schema: 'lerna-labs/merkle-proof@v1';
  hashAlg: 'blake2b-256';
  leafPrefixHex: '00';
  nodePrefixHex: '01';
  pairSort: 'lexicographic';
  rootHex: string;
  createdAt: string;
  files: Array<{
    name: string;
    mime?: string;
    size?: number;
    contentHashHex: string;
    leafHashHex: string;
    merkleProof: { siblingHex: string }[];
  }>;
  leafMode: LeafMode;
};

/** Convert a hex string to a byte array. */
export const hexToBytes = (hex: string): Bytes => new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));

/** Convert a byte array to a lowercase hex string. */
export const bytesToHex = (b: Bytes): string =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');

/** Compute a blake2b-256 hash of the given data. */
export function blake2b256(data: Bytes | string): Bytes {
  const d = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return blake2b(d, { dkLen: 32 });
}

/**
 * Compute the leaf hash for a file using the `0x00` domain prefix.
 *
 * @param file - File metadata including the pre-computed content hash.
 * @param mode - Whether to include the file path in the hash.
 */
export function leafHashFrom(file: FileLeaf, mode: LeafMode = 'content+path'): Uint8Array {
  const prefix = new Uint8Array([0x00]);
  const ch = hexToBytes(file.contentHashHex);
  const payload =
    mode === 'content'
      ? new Uint8Array(prefix.length + ch.length)
      : new Uint8Array(prefix.length + ch.length + new TextEncoder().encode(file.name).length);

  payload.set(prefix, 0);
  payload.set(ch, 1);

  if (mode === 'content+path') {
    const nameBytes = new TextEncoder().encode(file.name);
    payload.set(nameBytes, 1 + ch.length);
  }
  return blake2b256(payload);
}

function parentHash(a: Bytes, b: Bytes): Bytes {
  const [L, R] = bytesToHex(a) < bytesToHex(b) ? [a, b] : [b, a];
  const prefix = new Uint8Array([0x01]);
  const payload = new Uint8Array(prefix.length + L.length + R.length);
  payload.set(prefix, 0);
  payload.set(L, 1);
  payload.set(R, 1 + L.length);
  return blake2b256(payload);
}

/**
 * Build a complete Merkle tree from leaf hashes.
 *
 * @param leaves - Array of leaf-level hashes.
 * @returns Array of levels, from leaves (index 0) to root (last index).
 */
export function buildTree(leaves: Bytes[]): Bytes[][] {
  if (leaves.length === 0) return [[new Uint8Array(0)]];
  let level = leaves.slice();
  const levels: Bytes[][] = [level];
  while (level.length > 1) {
    const next: Bytes[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? level[i];
      next.push(parentHash(left, right));
    }
    level = next;
    levels.push(level);
  }
  return levels;
}

/**
 * Extract the Merkle inclusion proof for a leaf at the given index.
 *
 * @param index - Zero-based index of the leaf in the tree.
 * @param levels - Tree levels as returned by {@link buildTree}.
 * @returns Ordered sibling hashes needed to recompute the root.
 */
export function buildProof(index: number, levels: Bytes[][]): ProofStep[] {
  const proof: ProofStep[] = [];
  let idx = index;
  for (let h = 0; h < levels.length - 1; h++) {
    const level = levels[h];
    const sib = idx ^ 1;
    const sibling = level[sib] ?? level[idx]; // duplicate if no sibling
    proof.push({ siblingHex: bytesToHex(sibling) });
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/**
 * Compute a full proof package for a set of files.
 *
 * Builds the Merkle tree and generates an inclusion proof for every file.
 *
 * @param files - Files to include in the tree.
 * @param mode - Leaf hashing mode.
 * @returns A self-describing {@link ProofPackage} with the root hash and per-file proofs.
 */
export function computePackage(files: FileLeaf[], mode: LeafMode = 'content+path'): ProofPackage {
  const leaves = files.map((f) => leafHashFrom(f, mode));
  const levels = buildTree(leaves);
  const rootHex = bytesToHex(levels.at(-1)![0]);
  const createdAt = new Date().toISOString();

  return {
    schema: 'lerna-labs/merkle-proof@v1',
    hashAlg: 'blake2b-256',
    leafPrefixHex: '00',
    nodePrefixHex: '01',
    pairSort: 'lexicographic',
    rootHex,
    createdAt,
    leafMode: mode,
    files: files.map((f, i) => ({
      name: f.name,
      mime: f.mime,
      size: f.size,
      contentHashHex: f.contentHashHex,
      leafHashHex: bytesToHex(leaves[i]),
      merkleProof: buildProof(i, levels),
    })),
  };
}

/**
 * Verify that a file is included in a Merkle tree with the given root.
 *
 * @param file - The file's name and content hash.
 * @param proof - Sibling hashes from the inclusion proof.
 * @param expectedRootHex - Expected Merkle root hex string.
 * @param mode - Leaf hashing mode (must match the mode used to build the tree).
 * @returns `true` if the proof is valid.
 */
export function verifyInclusion(
  file: { name: string; contentHashHex: string },
  proof: { siblingHex: string }[],
  expectedRootHex: string,
  mode: LeafMode = 'content+path',
): boolean {
  let node = leafHashFrom({ name: file.name, contentHashHex: file.contentHashHex }, mode);
  for (const step of proof) node = parentHash(node, hexToBytes(step.siblingHex));
  return bytesToHex(node) === expectedRootHex.toLowerCase();
}
