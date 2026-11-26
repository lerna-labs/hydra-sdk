# Dependency overrides

The root `package.json` carries an `overrides` block that forces a resolved version for a package
this project doesn't depend on directly. Each entry is one of two kinds. A **functional** entry
exists because a version boundary changes runtime behavior independent of any security advisory, and
it stays an exact pin because a caret range could resolve to a version that reintroduces the problem
the pin exists to avoid. An **advisory-floor** entry exists only to keep a transitive package above
a version a security advisory covers, so it is written as a caret range: a lockfile update, such
as `npm update` or a regenerated lockfile, can then take a later patch release without anyone
revising the manifest. `npm ci` and `npm install` keep the locked version.

An override rewrites resolution only in this repository's own installs. npm ignores `overrides`
when a package is installed as someone else's dependency, so no entry below reaches consumers of
the published `@lerna-labs/hydra-sdk` or `@lerna-labs/hydra-proof`. What a consumer resolves is set
by the dependency ranges the published packages and their dependencies declare.

Before touching an entry, check whether the dependency that pulls the package in has since shipped
a version that resolves to a patched copy on its own. If it has, bumping that dependency is
preferable to carrying the override.

## Functional pins

### `libsodium-wrappers-sumo`

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

## Advisory-floor overrides

Every entry below exists only to keep a transitive package above an advisory's vulnerable range,
and every one is a caret range for that reason. Versions quoted as resolved are the ones in
`package-lock.json`.

### `brace-expansion@1` and `brace-expansion@2`

`brace-expansion@1` is `^1.1.21` and `brace-expansion@2` is `^2.1.7`. Both are the patched releases
for GHSA-q2hr-2g5m-vwhr (quadratic-time expansion of the `{a},b}` rewrite, a CPU denial of service),
vulnerable `< 1.1.21` and `>= 2.0.0, < 2.1.7`. The earlier floors were `^1.1.16` and `^2.1.4`, set
against GHSA-3jxr-9vmj-r5cp and GHSA-rgw5-rvv9-x895 (both denial of service in the same package),
then `^1.1.18` against GHSA-rgw5-rvv9-x895. GHSA-6j4f-fj2g-mc7p (`1.1.19`, `2.1.5`) and
GHSA-qhr7-859c-m2p7 (`1.1.20`, `2.1.6`) are also covered by the current floors.

Both copies are development-only. The 2.x copy (resolved `2.1.7`) comes from `minimatch` 9.0.9,
which `glob` 10.5.0 and `typedoc` use; `glob` is reached through `sucrase`, a dependency of
`tailwindcss`, and `typedoc` is reached directly and through `typedoc-plugin-markdown`. The 1.x copy
(resolved `1.1.21`) comes from `minimatch` 3.1.5 under `glob` 7.2.3, `rimraf` 2.7.1 and
`ts-node-dev`. `minimatch` 9.0.9 declares `brace-expansion@^2.0.2` and 3.1.5 declares `^1.1.7`; both
are the latest releases of their lines, and both ranges admit vulnerable versions, so the override
is what holds the floors. It can be removed once the `minimatch` copies that request
`brace-expansion` declare floors at or above `1.1.21` and `2.1.7`, or those copies leave the tree.

It affects only this repository's own installs and does not reach consumers of the published
`@lerna-labs/hydra-sdk`. Neither published package declares `brace-expansion`, and both copies are
development-only, so a consumer's install does not contain them; hydra-sdk #95, which tracks
consumer exposure, does not cover them.

### `ip-address`

`^10.7.4`. Patched release for GHSA-rxp7-6hxx-x8q5 (`Address6` matches a zone identifier in
quadratic time ahead of its length limit, so one long string can stall the process), vulnerable
`<= 10.7.3`. The earlier floors were `^10.3.1`, set against GHSA-v2v4-37r5-5v8g and
GHSA-mwp4-54f8-5fhr (patched `10.1.1` and `10.3.1`), and `^10.7.2`, set when the lockfile resolved
`10.7.0`, inside the vulnerable range of GHSA-j6r3-76f7-8jcv and GHSA-h3mg-xc3c-68pw (both
`<= 10.7.0`).

`@cardano-sdk/core` 0.46.12 declares `ip-address@^9.0.5`. Three packages pin it exactly:
`@meshsdk/core-cst` 1.9.1, `@meshsdk/transaction` 1.9.1 (both reached from `@meshsdk/core` 1.9.1),
and the `@meshsdk/core-cst` 1.9.0-beta.100 copy nested under `@meshsdk/provider` 1.9.0-beta.101. The
override is what moves that copy from the 9.x line to `10.7.4`. `express-rate-limit` 8.7.0, a
dependency declared in the root `package.json`, declares `^10.2.0` and takes the same copy.
`@cardano-sdk/core` 0.46.15 is the first release that declares `^10.2.0`, but that range, like the
one `express-rate-limit` declares, admits `10.2.0` through `10.7.3`, inside the vulnerable range.
The override can be removed once every range in the tree that requests `ip-address` has a floor at
or above `10.7.4`.

It affects only this repository's own installs and does not reach consumers of the published
`@lerna-labs/hydra-sdk`. A consumer who installs the published package resolves `ip-address` 9.0.5
through `@cardano-sdk/core` 0.46.12. hydra-sdk #95 tracks that exposure and the upstream release
that has to land.

### `undici`

`^6.29.1`. Patched release for GHSA-xjj6-f33q-929c (a denial of service from an unhandled error on
excessive `content-encoding` values, vulnerable `>= 6.23.0`) and GHSA-4qv8-2p9j-2685 (unbounded
memory in the `EventSource` parser, vulnerable `>= 6.5.0`), both `< 6.29.1`. Three more advisories
published the day after the floor was raised have the same patched release on the 6.x line:
GHSA-2m5v-pch6-74hx (TLS certificate validation bypass, `>= 4.0.0`), GHSA-qrxm-fqhp-jwvm (denial
of service through TLS 1.2 certificate-changing renegotiation, `>= 4.2.1`) and GHSA-9fm3-97px-rjf6
(unbounded PONG buffering in the WebSocket client, `>= 5.15.0`). The earlier floors came from
GHSA-3wwx-pv8p-q78v and GHSA-rfgv-xxqx-mfg5 (`6.28.1`) and GHSA-m8rv-5g2x-5cg5 (`6.28.0`).

`@connectrpc/connect-node` 1.4.0 declares `undici@^5.28.3`. It is reached through `@utxorpc/sdk`
0.6.8, `@meshsdk/provider` 1.9.0-beta.101 and `@meshsdk/core` 1.9.1, so the override is what moves
that copy from 5.29.0 to the 6.x line. It is the only package in the lockfile that requests
`undici`. No `@utxorpc/sdk` release removes the dependency yet: `@connectrpc/connect-node` 2.2.0 has
no `undici` dependency, so `@utxorpc/sdk` would have to move to the 2.x connect packages, and
`@meshsdk/provider` and `@meshsdk/core` would then have to release against it. The override can be
removed once nothing in the tree requests a range that admits versions below `6.29.1`, which that
chain landing achieves by taking `undici` out of the tree.

It affects only this repository's own installs and does not reach consumers of the published
`@lerna-labs/hydra-sdk`. A consumer who installs the published package resolves `undici` 5.29.0
through the same chain. hydra-sdk #95 tracks that exposure and the upstream releases that have to
land.
