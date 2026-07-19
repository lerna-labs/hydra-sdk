# @lerna-labs/hydra-sdk

## 2.0.0

### Minor Changes

- 57b03ab: Add rollback-resilient deposits via `Wrangler.depositResilient`, which automatically re-drafts a deposit when a submit fails on a transient stale-input error. Harden the preprod close and fanout path so the full open to fanout round-trip is proven end to end.
