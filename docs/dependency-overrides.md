# Dependency overrides

The root `package.json` carries an `overrides` block that forces a resolved version for a
package this project doesn't depend on directly. This entry is a **functional** pin: it exists
because a version boundary changes runtime behavior independent of any security advisory, and
it stays an exact pin because a caret range could resolve to a version that reintroduces the
problem the pin exists to avoid.

## `libsodium-wrappers-sumo`

`libsodium-wrappers-sumo: 0.7.15` has no advisory behind it; it is a functional pin. The
lockfile requires this package at three different version specifiers: `@meshsdk/core` and
`@meshsdk/core-cst` want it at exact `0.7.15`, `@cardano-sdk/crypto` (pulled in through
`@meshsdk/core-cst`) wants exact `0.7.10`, and other nested `@cardano-sdk/crypto` copies want
`^0.7.5`. Without a forced single resolution, npm installs two separate physical copies of the
package at different versions, and initializing both throws "libsodium was not correctly
initialized" at runtime, which breaks wallet signing through MeshSDK.

Pinning a single resolved version through `overrides` keeps one copy of the library in the
tree and avoids the double-load. A caret range does not close this reliably: npm's override
resolver can settle on one version across a full install, but a later partial install or an
added dependency can resolve a different version for a new subtree without reconciling it
against a copy already in place elsewhere in the tree, letting the two-copies failure recur.
The pin stays exact until the tree only pulls one version of `libsodium-wrappers-sumo` on its
own.

This mirrors the `libsodium-sumo` override ekklesia-hydra documents in its own
`docs/dependency-overrides.md`.
