---
"@lerna-labs/hydra-sdk": patch
"@lerna-labs/hydra-proof": patch
---

Clear the 73 open dependency security advisories across the workspace. axios moves to `^1.18.0` and ws to `^8.21.0`; ws is a declared runtime dependency of the published SDK, so its accepted range changes for consumers. uuid moves to `^11.1.1` in the orchestrator. The remaining fixes are transitive and land through the root `overrides` block: undici, brace-expansion, glob, ip-address, lodash, path-to-regexp, form-data, qs, picomatch, postcss-selector-parser, js-yaml, linkify-it, markdown-it, follow-redirects and body-parser. The bundled npm CLI moves from 10.9.9 to 11.19.1, which brings patched copies of pacote, sigstore, `@sigstore/core` and ip-address into the tree. Those four exist only inside npm's own bundled dependencies, where a direct override cannot reach them.

ip-address moves from 9.x to 10.x, and that changes behavior. The fix for CVE-2026-69192 rejects IPv4 addresses whose octets carry a leading zero rather than reading them as decimal, so pool relay addresses written in that form are now rejected by `@cardano-sdk/core` instead of being misparsed.
