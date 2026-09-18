---
"@lerna-labs/hydra-sdk": patch
"@lerna-labs/hydra-proof": patch
---

Refresh the lockfile so yaml resolves to 2.9.0 and diff resolves to 4.0.4, clearing GHSA-48c2-rrv3-qjmp and GHSA-73rr-hh4g-fpgx. Both packages are pulled in only by dev tooling (lint-staged, typedoc, postcss-load-config for yaml; ts-node for diff), and their declared parent ranges already admitted the patched versions, so no override was needed. This is a build and test tooling change only; no published package contents are affected.
