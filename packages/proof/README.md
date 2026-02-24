# @lerna-labs/hydra-proof

Merkle proof generation and verification using blake2b-256 — designed for anchoring file integrity proofs on Cardano Hydra Heads.

**Zero runtime dependencies.** Uses only Node.js built-in `crypto` module.

> **Beta** — APIs may change between releases. Currently at `1.0.0-beta.x`.

## Installation

```bash
npm install @lerna-labs/hydra-proof
```

## Quick Example

```typescript
import { computePackage, verifyInclusion } from "@lerna-labs/hydra-proof";

// Build a Merkle tree from a set of files
const pkg = computePackage([
  { name: "doc.pdf", content: pdfBuffer },
  { name: "image.png", content: pngBuffer },
]);

// pkg.root — the Merkle root hash (hex)
// pkg.proofs — one proof per file

// Later, verify that a specific file is included
const isValid = verifyInclusion(
  { name: "doc.pdf", contentHashHex: pkg.proofs[0].contentHashHex },
  pkg.proofs[0].steps,
  pkg.root,
);
// true
```

## How It Works

1. **Leaf hashing** — Each file is hashed with a `0x00` domain separator to produce a leaf hash. In `"content"` mode (default), only the file content is hashed. In `"content+path"` mode, the file name is included in the hash.

2. **Tree construction** — Leaf hashes are assembled into a binary Merkle tree. Each internal node is the blake2b-256 hash of its two children, prefixed with a `0x01` domain separator. Odd-count levels duplicate the last node.

3. **Proof generation** — For each leaf, a proof is a list of sibling hashes needed to recompute the root.

4. **Verification** — Given a file's content hash, its proof steps, and the expected root, `verifyInclusion()` rebuilds the path to the root and checks for a match.

## Leaf Modes

| Mode | Leaf hash input | Use case |
|------|----------------|----------|
| `"content"` (default) | File content only | When file names may change but content must be verified |
| `"content+path"` | File name + content | When both the name and content are part of the commitment |

## API Reference

### High-Level

| Export | Description |
|--------|-------------|
| `computePackage(files, mode?)` | Build a full Merkle tree and return root + per-file proofs |
| `verifyInclusion(file, proof, expectedRootHex, mode?)` | Verify a file's inclusion against a known Merkle root |

### Tree Primitives

| Export | Description |
|--------|-------------|
| `blake2b256(data)` | Hash data with blake2b-256 (32 bytes) |
| `leafHashFrom(file, mode?)` | Compute the domain-separated leaf hash for a file |
| `buildTree(leaves)` | Build a binary Merkle tree from leaf hashes |
| `buildProof(index, levels)` | Extract a proof (sibling path) for a leaf at a given index |

### Encoding Utilities

| Export | Description |
|--------|-------------|
| `bytesToHex(bytes)` | Convert a `Uint8Array` to a hex string |
| `hexToBytes(hex)` | Convert a hex string to a `Uint8Array` |

### Types

| Export | Description |
|--------|-------------|
| `Bytes` | Alias for `Uint8Array` |
| `FileLeaf` | Input file descriptor: `{ name: string; content: Bytes \| string }` |
| `HashHex` | Hex-encoded hash string |
| `LeafMode` | `"content"` or `"content+path"` |
| `ProofPackage` | Output of `computePackage()`: root hash + per-file proofs |
| `ProofStep` | Single step in a Merkle proof: `{ siblingHex: string }` |

## License

[Apache-2.0](../../LICENSE)
