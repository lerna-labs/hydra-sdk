# Hydra SDK

A TypeScript SDK for building applications on [Cardano Hydra](https://hydra.family/) — the layer-2 scaling solution for Cardano.

> **Beta** — This project is under active development. APIs may change between releases.

## Packages

| Package | Description | Version |
|---------|-------------|---------|
| [`@lerna-labs/hydra-sdk`](./packages/core/) | Core SDK: Hydra Head lifecycle, UTxO queries, wallet management, tx submission, signature verification | [![npm](https://img.shields.io/npm/v/@lerna-labs/hydra-sdk)](https://www.npmjs.com/package/@lerna-labs/hydra-sdk) |
| [`@lerna-labs/hydra-proof`](./packages/proof/) | Merkle proof generation and verification (blake2b-256) — zero runtime dependencies | [![npm](https://img.shields.io/npm/v/@lerna-labs/hydra-proof)](https://www.npmjs.com/package/@lerna-labs/hydra-proof) |

## Quick Start

```bash
# Core SDK — Hydra Head management, UTxOs, wallets, transactions
npm install @lerna-labs/hydra-sdk

# Merkle proofs — standalone, no extra dependencies
npm install @lerna-labs/hydra-proof
```

See each package's README for detailed usage and API reference:

- [**@lerna-labs/hydra-sdk** documentation](./packages/core/README.md)
- [**@lerna-labs/hydra-proof** documentation](./packages/proof/README.md)

## Example

The [`examples/local-currency/`](./examples/local-currency/) directory contains a full Express.js REST API for Hydra-based payments, deployed at [Rare Evo 2025](https://rareevo.io/). It demonstrates real-world usage of the SDK including Head lifecycle management, UTxO handling, and transaction submission.

## Development

### Prerequisites

- Node.js >= 18
- npm (workspaces are used for monorepo management)

### Scripts

```bash
npm run build        # Build all packages
npm run test         # Run all tests (Vitest)
npm run lint         # Lint with Biome
npm run lint:fix     # Auto-fix lint issues
npm run typecheck    # Type-check all packages
npm run api:extract  # Rebuild API surface snapshot
npm run docs:api     # Generate API reference docs (typedoc)
```

### Project Structure

```
hydra-sdk/
├── packages/
│   ├── core/          # @lerna-labs/hydra-sdk
│   └── proof/         # @lerna-labs/hydra-proof
├── examples/
│   └── local-currency/  # Express.js REST API example
├── docker/            # Compose files for Cardano + Hydra nodes
├── data/              # Network configs and runtime data
├── scripts/           # Automation tools
└── api/               # API surface snapshots (CI-tracked)
```

## License

[Apache-2.0](./LICENSE)
