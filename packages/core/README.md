# @lerna-labs/hydra-sdk

Core TypeScript SDK for managing [Cardano Hydra](https://hydra.family/) Heads — connect, open, transact, and close Hydra Heads with a high-level API.

> **Beta** — APIs may change between releases. Currently at `1.0.0-beta.x`.

## Installation

```bash
npm install @lerna-labs/hydra-sdk
```

## Environment Variables

The SDK reads configuration from environment variables at the point of use (never at import time):

| Variable | Required | Description |
|----------|----------|-------------|
| `BLOCKFROST_API_KEY` | Yes (Wrangler) | Blockfrost project ID for L1 chain queries |
| `HYDRA_API_URL` | Yes (UTxO queries) | Hydra node HTTP API endpoint (e.g. `http://localhost:4001`) |
| `HYDRA_WS_URL` | Yes (Wrangler) | Hydra node WebSocket endpoint (e.g. `ws://localhost:4001`) |
| `HYDRA_ADMIN_KEY_FILE` | One required | Path to a Cardano `.sk` signing key file |
| `HYDRA_ADMIN_CARDANO_PK` | One required | Cardano private key hex string (fallback if no key file) |

## Usage

### Wrangler — Head Lifecycle Management

The `Wrangler` class manages the full Hydra Head lifecycle: connecting, opening, monitoring, and closing.

```typescript
import { Wrangler } from "@lerna-labs/hydra-sdk";

const wrangler = new Wrangler();

// Connect to the Hydra node with automatic retry
await wrangler.connect();

// Open the Head (commits UTxO from L1 tx)
await wrangler.waitForHeadOpen({ txHash: "abc123...", txIndex: 0 });

// Monitor status
const status = await wrangler.getHeadStatus();
wrangler.onStatusChange((status) => console.log("Status:", status));

// Close and finalize
await wrangler.waitForHeadClose();

// Disconnect when done
await wrangler.disconnect();
```

### UTxO Queries

```typescript
import { getUtxoSet, queryUtxoByAddress } from "@lerna-labs/hydra-sdk";

// Get all UTxOs in the Hydra Head
const utxos = await getUtxoSet();

// Query UTxOs for a specific address
const myUtxos = await queryUtxoByAddress("addr_test1...");
```

### Wallet & Admin

```typescript
import { getAdmin, createMultisigAddress } from "@lerna-labs/hydra-sdk";

// Get a MeshWallet instance from env-configured signing key
const adminWallet = await getAdmin();

// Create a multisig address from two participant addresses
const { address, scriptCbor, scriptHash } = createMultisigAddress(
  "addr_test1...",
  "addr_test2...",
);
```

### Signature Verification

```typescript
import { verifySignature } from "@lerna-labs/hydra-sdk";

const { isValid, sigMeta, pubKeyHex } = verifySignature(
  signature,
  message,
  signingAddress,
  signatureKey,
);
```

### Transaction Submission

```typescript
import { submitTx } from "@lerna-labs/hydra-sdk";

const response = await submitTx(submitEndpoint, cborPayload, txId);
```

### Config Helpers

```typescript
import { requireEnv, optionalEnv } from "@lerna-labs/hydra-sdk";

// Throws with a clear message if missing
const apiKey = requireEnv("BLOCKFROST_API_KEY");

// Returns fallback if not set
const url = optionalEnv("HYDRA_API_URL", "http://localhost:4001");
```

### Utilities

```typescript
import { chunkString, bufferToHex, bufferToAscii } from "@lerna-labs/hydra-sdk";

const chunks = chunkString("abcdef", 2); // ["ab", "cd", "ef"]
```

## API Reference

### Functions

| Export | Description |
|--------|-------------|
| `getAdmin()` | Create a `MeshWallet` from env-configured signing key |
| `createMultisigAddress(addr1, addr2, networkId?, scriptType?)` | Build a multisig address from two participant addresses |
| `createNativeScript(addr, networkId?, scriptType?, invalidBefore?, invalidHereafter?)` | Build a native script address with optional time bounds |
| `getUtxoSet()` | Fetch all UTxOs in the Hydra Head |
| `queryUtxoByAddress(address)` | Fetch UTxOs for a specific address |
| `submitTx(endpoint, payload, id)` | Submit a signed transaction to the Hydra node |
| `verifySignature(signature, message, address, key)` | Verify a CIP-8 message signature |
| `requireEnv(name)` | Read a required environment variable (throws if missing) |
| `optionalEnv(name, fallback)` | Read an optional environment variable with fallback |
| `chunkString(str, size)` | Split a string into fixed-size chunks |
| `bufferToHex(buffer)` | Convert a buffer to a hex string |
| `bufferToAscii(buffer)` | Convert a buffer to an ASCII string |

### Classes

| Export | Description |
|--------|-------------|
| `Wrangler` | Hydra Head lifecycle manager — connect, open, monitor, close |

### Types

| Export | Description |
|--------|-------------|
| `CommitArgs` | Arguments for committing UTxOs when opening a Head |
| `HeadStatus` | Hydra Head status identifier |
| `HydraMessage` | Typed Hydra protocol message |
| `HydraWsMessage` | Raw WebSocket message from Hydra node |
| `ParsedUtxo` | Parsed UTxO with address, value, and datum |
| `ServerOutput` | Hydra node server output message type |

## License

[Apache-2.0](../../LICENSE)
