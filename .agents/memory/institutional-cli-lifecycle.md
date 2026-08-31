---
name: Institutional CLI lifecycle
description: One-shot institutional commands must flush output, expose status, and close shared database resources.
---

One-shot Node CLIs that import the shared PostgreSQL pool must avoid hard `process.exit(...)`: report errors, await pool cleanup, and assign `process.exitCode` only after cleanup completes.

**Why:** Railway shell sessions can lose observable output or status when a CLI hard-exits while shared database resources remain open.

**How to apply:** Wrap institutional CLI entrypoints in the shared lifecycle runner; keep dry-run and APPLY logic unchanged, and use a transaction-level read-only verifier for production state checks.