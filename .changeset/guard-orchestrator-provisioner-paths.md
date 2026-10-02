---
---

Validate the network and instance identifiers the orchestrator's provisioner uses to build filesystem paths, and resolve those paths against the project root before any read, write, or existence check. Rejects anything containing path separators or traversal segments instead of passing the raw value into `fs` calls.
