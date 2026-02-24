import { describe, expect, it } from 'vitest';
import {
  blake2b256,
  buildProof,
  buildTree,
  bytesToHex,
  computePackage,
  hexToBytes,
  leafHashFrom,
  verifyInclusion,
} from './merkle.js';
import type { FileLeaf } from './merkle.js';

// ── Hex conversion round-trip ───────────────────────────────────────

describe('hexToBytes / bytesToHex', () => {
  it('round-trips arbitrary hex', () => {
    const hex = 'deadbeef01020304';
    expect(bytesToHex(hexToBytes(hex))).toBe(hex);
  });

  it('handles single byte', () => {
    expect(bytesToHex(hexToBytes('ff'))).toBe('ff');
  });

  it('throws on empty string (match returns null)', () => {
    expect(() => hexToBytes('')).toThrow();
  });
});

// ── blake2b256 ──────────────────────────────────────────────────────

describe('blake2b256', () => {
  it('produces 32-byte output', () => {
    expect(blake2b256('hello').length).toBe(32);
  });

  it('is deterministic', () => {
    const a = bytesToHex(blake2b256('hello'));
    const b = bytesToHex(blake2b256('hello'));
    expect(a).toBe(b);
  });

  it('different inputs produce different hashes', () => {
    const a = bytesToHex(blake2b256('hello'));
    const b = bytesToHex(blake2b256('world'));
    expect(a).not.toBe(b);
  });

  it('accepts Uint8Array input', () => {
    const bytes = new TextEncoder().encode('hello');
    const fromBytes = bytesToHex(blake2b256(bytes));
    const fromString = bytesToHex(blake2b256('hello'));
    expect(fromBytes).toBe(fromString);
  });
});

// ── leafHashFrom ────────────────────────────────────────────────────

describe('leafHashFrom', () => {
  const file: FileLeaf = {
    name: 'test.txt',
    contentHashHex: bytesToHex(blake2b256('file content')),
  };

  it('content mode ignores file name', () => {
    const file2: FileLeaf = { name: 'other.txt', contentHashHex: file.contentHashHex };
    const a = bytesToHex(leafHashFrom(file, 'content'));
    const b = bytesToHex(leafHashFrom(file2, 'content'));
    expect(a).toBe(b);
  });

  it('content+path mode includes file name', () => {
    const file2: FileLeaf = { name: 'other.txt', contentHashHex: file.contentHashHex };
    const a = bytesToHex(leafHashFrom(file, 'content+path'));
    const b = bytesToHex(leafHashFrom(file2, 'content+path'));
    expect(a).not.toBe(b);
  });

  it('defaults to content+path mode', () => {
    const withDefault = bytesToHex(leafHashFrom(file));
    const explicit = bytesToHex(leafHashFrom(file, 'content+path'));
    expect(withDefault).toBe(explicit);
  });
});

// ── buildTree ───────────────────────────────────────────────────────

describe('buildTree', () => {
  it('returns single empty-byte level for 0 leaves', () => {
    const levels = buildTree([]);
    expect(levels).toHaveLength(1);
    expect(levels[0][0].length).toBe(0);
  });

  it('single leaf tree has one level', () => {
    const leaf = blake2b256('a');
    const levels = buildTree([leaf]);
    expect(levels).toHaveLength(1);
    expect(bytesToHex(levels[0][0])).toBe(bytesToHex(leaf));
  });

  it('two leaves produce two levels', () => {
    const a = blake2b256('a');
    const b = blake2b256('b');
    const levels = buildTree([a, b]);
    expect(levels).toHaveLength(2);
    expect(levels[0]).toHaveLength(2);
    expect(levels[1]).toHaveLength(1);
  });

  it('three leaves produce three levels', () => {
    const leaves = ['a', 'b', 'c'].map((s) => blake2b256(s));
    const levels = buildTree(leaves);
    expect(levels).toHaveLength(3);
    expect(levels[0]).toHaveLength(3);
    expect(levels[1]).toHaveLength(2);
    expect(levels[2]).toHaveLength(1);
  });

  it('root is deterministic for same leaves', () => {
    const leaves = ['x', 'y', 'z'].map((s) => blake2b256(s));
    const root1 = bytesToHex(buildTree(leaves).at(-1)![0]);
    const root2 = bytesToHex(buildTree(leaves).at(-1)![0]);
    expect(root1).toBe(root2);
  });
});

// ── buildProof ──────────────────────────────────────────────────────

describe('buildProof', () => {
  it('proof has levels.length - 1 steps', () => {
    const leaves = ['a', 'b', 'c', 'd'].map((s) => blake2b256(s));
    const levels = buildTree(leaves);
    const proof = buildProof(0, levels);
    expect(proof).toHaveLength(levels.length - 1);
  });

  it('single-leaf proof is empty', () => {
    const levels = buildTree([blake2b256('only')]);
    const proof = buildProof(0, levels);
    expect(proof).toHaveLength(0);
  });
});

// ── verifyInclusion ─────────────────────────────────────────────────

describe('verifyInclusion', () => {
  const files: FileLeaf[] = [
    { name: 'a.txt', contentHashHex: bytesToHex(blake2b256('aaa')) },
    { name: 'b.txt', contentHashHex: bytesToHex(blake2b256('bbb')) },
    { name: 'c.txt', contentHashHex: bytesToHex(blake2b256('ccc')) },
  ];

  const pkg = computePackage(files);

  it('verifies each file against root', () => {
    for (const f of pkg.files) {
      expect(verifyInclusion(f, f.merkleProof, pkg.rootHex)).toBe(true);
    }
  });

  it('rejects tampered content hash', () => {
    const tampered = { ...pkg.files[0], contentHashHex: bytesToHex(blake2b256('tampered')) };
    expect(verifyInclusion(tampered, pkg.files[0].merkleProof, pkg.rootHex)).toBe(false);
  });

  it('rejects wrong root', () => {
    const f = pkg.files[0];
    const wrongRoot = bytesToHex(blake2b256('wrong'));
    expect(verifyInclusion(f, f.merkleProof, wrongRoot)).toBe(false);
  });
});

// ── computePackage ──────────────────────────────────────────────────

describe('computePackage', () => {
  it('has correct schema metadata', () => {
    const files: FileLeaf[] = [{ name: 'x.bin', contentHashHex: bytesToHex(blake2b256('x')) }];
    const pkg = computePackage(files);
    expect(pkg.schema).toBe('lerna-labs/merkle-proof@v1');
    expect(pkg.hashAlg).toBe('blake2b-256');
    expect(pkg.leafPrefixHex).toBe('00');
    expect(pkg.nodePrefixHex).toBe('01');
    expect(pkg.pairSort).toBe('lexicographic');
    expect(pkg.leafMode).toBe('content+path');
  });

  it('includes all files with proofs', () => {
    const files: FileLeaf[] = [
      { name: 'a.txt', contentHashHex: bytesToHex(blake2b256('a')) },
      { name: 'b.txt', contentHashHex: bytesToHex(blake2b256('b')) },
    ];
    const pkg = computePackage(files);
    expect(pkg.files).toHaveLength(2);
    for (const f of pkg.files) {
      expect(f.leafHashHex).toBeDefined();
      expect(f.merkleProof).toBeDefined();
    }
  });

  it('sets createdAt to valid ISO timestamp', () => {
    const pkg = computePackage([{ name: 'f', contentHashHex: bytesToHex(blake2b256('f')) }]);
    expect(() => new Date(pkg.createdAt).toISOString()).not.toThrow();
  });
});
