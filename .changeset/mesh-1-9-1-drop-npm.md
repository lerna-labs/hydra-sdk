---
"@lerna-labs/hydra-sdk": patch
---

Move `@meshsdk/core` and `@meshsdk/core-cst` from the exact pin 1.9.0-beta.99 to the exact pin 1.9.1. The npm CLI no longer ships in the package's dependency tree, so consumers no longer install a bundled copy of `ip-address` or `undici` through it.
