---
"@lerna-labs/hydra-sdk": patch
"@lerna-labs/hydra-proof": patch
---

Pin the transitively bundled npm CLI package to 10.9.9 and override minimatch, resolving GHSA-23hp-3jrh-7fpw and a cluster of related tar and minimatch advisories. tar and minimatch were reachable only through npm's own bundled dependencies, which a direct override cannot patch; moving npm itself to a version that ships patched tar and minimatch clears them. This is a build tooling change only; no published package contents are affected.
