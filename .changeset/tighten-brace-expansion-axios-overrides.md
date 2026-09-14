---
"@lerna-labs/hydra-sdk": patch
"@lerna-labs/hydra-proof": patch
---

Raise the `brace-expansion@1` override floor from `^1.1.16` to `^1.1.18`, closing GHSA-rgw5-rvv9-x895: the old floor admitted 1.1.16 and 1.1.17, both vulnerable, and only resolved to a patched version because npm happened to pick the newest release in range.

Raise the declared `axios` range from `^1.18.0` to `^1.19.0`. Axios 1.18.0 and 1.18.1 declare `form-data: ^4.0.5`, which admits the version vulnerable to GHSA-hmw2-7cc7-3qxx; 1.19.0 and 1.20.0 declare `form-data: ^4.0.6`, the patched floor. With that raised, the root's own `form-data` override is redundant and is removed.

The root's `follow-redirects` override is also removed: every axios version admitted by the declared range already declares `follow-redirects: ^1.16.0`, matching GHSA-r4q5-vmmm-2653's patched version, so the override restated the dependent's own constraint and added nothing.
