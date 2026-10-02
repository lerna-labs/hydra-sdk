---
"@lerna-labs/hydra-sdk": patch
---

`Wrangler` no longer requires `BLOCKFROST_API_KEY` at construction. The Blockfrost provider is now created on the first layer 1 operation (`incrementalCommit` and the deposit methods), which still throws `Missing required environment variable: BLOCKFROST_API_KEY` when the variable is unset. Layer 2 only callers can construct and use a `Wrangler` without a Blockfrost key.
