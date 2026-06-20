# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### ⚠️ Breaking — Hydra v2 (ADR-33: direct-open head)

Aligns the SDK with Hydra-Node v2.x, which removes the head-initialization
phase entirely: `Init` now opens the head directly with an empty UTxO set —
there is no longer a `Commit → CollectCom → Open` flow, nor `Abort`. The SDK
now targets Hydra-Node v2.x only and drops v1.3.0 support.

#### Removed
- `'Initializing'` from `HeadStatus` and `'INITIALIZING'` from `HydraStatus` — heads transition `Idle → Open` directly
- `{ tag: 'Abort' }` from `ClientInput` — abort no longer exists on-chain
- Server-output message types `HeadIsInitializing`, `Committed`, `HeadIsAborted`, and `IgnoredHeadInitializing` (and their `ServerOutput` union entries)
- `Wrangler` opening-commit internals (`doCommit`, `fetchUtxos`) — opening a head no longer commits any UTxOs
- `HydraMonitor` `HeadIsAborted → IDLE` reset handling

#### Changed
- **`Wrangler.waitForHeadOpen(timeoutMs?)`** — no longer accepts `CommitArgs`; the head opens empty. Fund it afterwards with `incrementalCommit()` (a deposit into the open head).
- **`Wrangler.startHead()`** — no longer accepts `CommitArgs`; sends `Init` on an `Idle` head and waits for `HeadIsOpen`.
- `POST /commit` is now exclusively a deposit/increment into an open head (unchanged `HydraHttpClient.buildCommit` surface, new semantics).
- Example `local-currency` `/start`: opens the head empty, then deposits any supplied `utxos[]` via `incrementalCommit` (UTxOs are now optional).

### Added
- Package READMEs and root README with full API documentation
- Centralized `requireEnv()` / `optionalEnv()` config helpers for standardized environment variable access
- Wrangler test coverage: 29 tests for lifecycle, retry, and timeout (75 total across 6 files)
- WebSocket resilience to Wrangler: `connectWithRetry()` with exponential backoff, `disconnect()`, `getStatus()`, `onStatusChange()` passthroughs
- `awaitMessage()` helper to deduplicate Wrangler promise-based methods
- API surface reviewer: snapshot extraction, CI comparison, typedoc generation, TSDoc comments
- `packages/proof/src/index.ts` barrel file re-exporting all public types and functions
- `ParsedUtxo` and `CommitArgs` exports from core barrel file
- `HYDRA_ADMIN_KEY_FILE` support in `getAdmin()` for direct key-file auth
- Docker infrastructure validator for automated drift detection (8 checks)
- Dependabot for automated dependency updates (npm weekly, GitHub Actions weekly)
- Test coverage for verify-signature, submit-tx, and utxo modules
- Vitest test framework, Biome linter/formatter, and CI workflow (typecheck + lint + test)
- Dependency release tracker script and weekly cron workflow

### Changed
- Restructured `data/` directory: moved network config from `scripts/` to `data/`, replaced `SCRIPTS_DIR` with `DATA_DIR`
- Split monolithic Docker compose volume mounts into granular per-concern mounts for instance isolation
- Removed module-level `BLOCKFROST_API_KEY` side effect from wrangler.ts that broke unrelated imports
- Eliminated async promise executor anti-pattern in Wrangler
- Regenerated protocol.ts bindings with trix codegen for tx3-sdk 0.7.0
- Updated stale dependencies and Docker images
- Excluded generated files (.tx3/codegen, protocol.ts, dist/) from Biome linting

### Fixed
- `waitForHeadClose` parameter (literal type 180000 replaced with default value)
- Fragile resolve/reject reassignment pattern in Wrangler
- Instance env generation script writing incorrect variable
- Lint issues across codebase with Biome auto-fix

## [1.0.0-beta.13] - 2025-10-24

### Added
- `createNativeScript()` function for creating native scripts for minting assets

### Changed
- Docker instances now map to default internal port 3000 instead of requiring unique internal ports

## [1.0.0-beta.12] - 2025-10-24

### Added
- Explicit dependencies inside sub-packages to prevent dependency resolution issues downstream

## [1.0.0-beta.11] - 2025-10-24

### Fixed
- Relative/internal imports missing `.js` extensions

## [1.0.0-beta.10] - 2025-10-24

### Changed
- Explicit function exports in `index.ts` for better downstream type-hinting

## [1.0.0-beta.9] - 2025-10-23

### Changed
- Express-api service to use only the specified image; updated middleware guard in Makefile

### Fixed
- Key generation issue

## [1.0.0-beta.8] - 2025-10-23

### Added
- `waitForHeadClose()` function to the Hydra Wrangler

## [1.0.0-beta.7] - 2025-10-23

### Added
- `getUtxoSet()` function to fetch the full UTxO set from the Hydra head

### Changed
- Updated `.gitignore` to ignore local build test files

## [1.0.0-beta.6] - 2025-10-23

### Fixed
- NPM provenance checking issue

## [1.0.0-beta.5] - 2025-10-23

### Fixed
- Minor build issue resolutions

## [1.0.0-beta.4] - 2025-10-23

### Fixed
- Additional dependency issues

## [1.0.0-beta.3] - 2025-10-23

### Fixed
- Missing dependencies in package-lock

## [1.0.0-beta.2] - 2025-10-23

### Fixed
- Build issues

## [1.0.0-beta.1] - 2025-10-23

### Added
- Initial beta release of `@lerna-labs/hydra-sdk` and `@lerna-labs/hydra-proof`
- Hydra Wrangler for head lifecycle management (init, commit, open, close, fanout)
- MeshWallet integration for admin signing (`getAdmin()`)
- Multisig native script creation (`createMultisigAddress()`)
- UTxO querying from Hydra head snapshots
- CIP-30 COSE_Sign1 signature verification
- Transaction submission via Hydra WebSocket
- Merkle proof generation and verification (blake2b-256) in `@lerna-labs/hydra-proof`
- Docker Compose infrastructure for Cardano node, Hydra node, and TRP
- Multi-network support (offline, preprod, mainnet) via Makefile
- Express.js local-currency example API for Hydra payments

[Unreleased]: https://github.com/Lerna-Labs/hydra-sdk/compare/sdk-v1.0.0-beta.13...HEAD
[1.0.0-beta.13]: https://github.com/Lerna-Labs/hydra-sdk/compare/sdk-v1.0.0-beta.12...sdk-v1.0.0-beta.13
[1.0.0-beta.12]: https://github.com/Lerna-Labs/hydra-sdk/compare/sdk-v1.0.0-beta.11...sdk-v1.0.0-beta.12
[1.0.0-beta.11]: https://github.com/Lerna-Labs/hydra-sdk/compare/sdk-v1.0.0-beta.10...sdk-v1.0.0-beta.11
[1.0.0-beta.10]: https://github.com/Lerna-Labs/hydra-sdk/compare/sdk-v1.0.0-beta.9...sdk-v1.0.0-beta.10
[1.0.0-beta.9]: https://github.com/Lerna-Labs/hydra-sdk/compare/sdk-v1.0.0-beta.8...sdk-v1.0.0-beta.9
[1.0.0-beta.8]: https://github.com/Lerna-Labs/hydra-sdk/compare/sdk-v1.0.0-beta.7...sdk-v1.0.0-beta.8
[1.0.0-beta.7]: https://github.com/Lerna-Labs/hydra-sdk/compare/sdk-v1.0.0-beta.6...sdk-v1.0.0-beta.7
[1.0.0-beta.6]: https://github.com/Lerna-Labs/hydra-sdk/compare/sdk-v1.0.0-beta.5...sdk-v1.0.0-beta.6
[1.0.0-beta.5]: https://github.com/Lerna-Labs/hydra-sdk/compare/sdk-v1.0.0-beta.4...sdk-v1.0.0-beta.5
[1.0.0-beta.4]: https://github.com/Lerna-Labs/hydra-sdk/compare/sdk-v1.0.0-beta.3...sdk-v1.0.0-beta.4
[1.0.0-beta.3]: https://github.com/Lerna-Labs/hydra-sdk/compare/sdk-v1.0.0-beta.2...sdk-v1.0.0-beta.3
[1.0.0-beta.2]: https://github.com/Lerna-Labs/hydra-sdk/compare/sdk-v1.0.0-beta.1...sdk-v1.0.0-beta.2
[1.0.0-beta.1]: https://github.com/Lerna-Labs/hydra-sdk/releases/tag/sdk-v1.0.0-beta.1
