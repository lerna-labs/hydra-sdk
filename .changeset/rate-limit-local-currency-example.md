---
---

Add rate limiting to the local-currency example's Express server. Every route builds or submits a Hydra transaction, so an unbounded caller could exhaust the head with repeated requests; `express-rate-limit` now caps each client to 60 requests per minute before any route handler runs.
