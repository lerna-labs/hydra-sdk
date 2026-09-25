# @lerna-labs/hydra-proof

## 1.0.0

### Patch Changes

- 66cc80e: Clear the 73 open dependency security advisories across the workspace. axios moves to `^1.18.0` and ws to `^8.21.0`; ws is a declared runtime dependency of the published SDK, so its accepted range changes for consumers. uuid moves to `^11.1.1` in the orchestrator. The remaining fixes are transitive and land through the root `overrides` block: undici, brace-expansion, glob, ip-address, lodash, path-to-regexp, form-data, qs, picomatch, postcss-selector-parser, js-yaml, linkify-it, markdown-it, follow-redirects and body-parser. The bundled npm CLI moves from 10.9.9 to 11.19.1, which brings patched copies of pacote, sigstore, `@sigstore/core` and ip-address into the tree. Those four exist only inside npm's own bundled dependencies, where a direct override cannot reach them.

  ip-address moves from 9.x to 10.x, and that changes behavior. The fix for CVE-2026-69192 rejects IPv4 addresses whose octets carry a leading zero rather than reading them as decimal, so pool relay addresses written in that form are now rejected by `@cardano-sdk/core` instead of being misparsed.

- f04c12e: Pin the transitively bundled npm CLI package to 10.9.9 and override minimatch, resolving GHSA-23hp-3jrh-7fpw and a cluster of related tar and minimatch advisories. tar and minimatch were reachable only through npm's own bundled dependencies, which a direct override cannot patch; moving npm itself to a version that ships patched tar and minimatch clears them. This is a build tooling change only; no published package contents are affected.
- 3e9926a: Bump the vitest devDependency to 4.1.11, resolving GHSA-5xrq-8626-4rwp, a critical vulnerability that let vitest's UI dev server be used for arbitrary file read and code execution. This is a build and test tooling change only; no published package contents are affected.
- 8d2945c: Refresh the lockfile so yaml resolves to 2.9.0 and diff resolves to 4.0.4, clearing GHSA-48c2-rrv3-qjmp and GHSA-73rr-hh4g-fpgx. Both packages are pulled in only by dev tooling (lint-staged, typedoc, postcss-load-config for yaml; ts-node for diff), and their declared parent ranges already admitted the patched versions, so no override was needed. This is a build and test tooling change only; no published package contents are affected.
- 94b4818: Raise the `brace-expansion@1` override floor from `^1.1.16` to `^1.1.18`, closing GHSA-rgw5-rvv9-x895: the old floor admitted 1.1.16 and 1.1.17, both vulnerable, and only resolved to a patched version because npm happened to pick the newest release in range.

  Raise the declared `axios` range from `^1.18.0` to `^1.19.0`. Axios 1.18.0 and 1.18.1 declare `form-data: ^4.0.5`, which admits the version vulnerable to GHSA-hmw2-7cc7-3qxx; 1.19.0 and 1.20.0 declare `form-data: ^4.0.6`, the patched floor. With that raised, the root's own `form-data` override is redundant and is removed.

  The root's `follow-redirects` override is also removed: every axios version admitted by the declared range already declares `follow-redirects: ^1.16.0`, matching GHSA-r4q5-vmmm-2653's patched version, so the override restated the dependent's own constraint and added nothing.
