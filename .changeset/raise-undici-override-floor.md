---
---

Raise the root `undici` override floor to ^6.28.1 and refresh the lockfile so undici resolves to 6.29.0, clearing GHSA-3wwx-pv8p-q78v. The package is reached only through `@connectrpc/connect-node` in the private orchestrator and the root override; neither published package declares it, so no published package contents change.
