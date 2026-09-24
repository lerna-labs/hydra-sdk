---
"@lerna-labs/hydra-sdk": patch
---

`HydraHttpClient` no longer uses a regular expression to strip trailing slashes from the base URL passed to its constructor. The pattern could take quadratic time on a URL containing a long run of `/` characters, so a caller passing an unbounded string could tie up the event loop. The trailing slashes are now removed with a linear scan that runs in time proportional to the input length regardless of its shape.
