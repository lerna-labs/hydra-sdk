---
"@lerna-labs/hydra-sdk": minor
---

Add rollback-resilient deposits via `Wrangler.depositResilient`, which automatically re-drafts a deposit when a submit fails on a transient stale-input error. Harden the preprod close and fanout path so the full open to fanout round-trip is proven end to end.
