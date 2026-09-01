---
name: Institutional CLI lifecycle
description: One-shot institutional commands must flush output, expose status, and close shared database resources.
---

One-shot Node CLIs that import the shared PostgreSQL pool must avoid hard `process.exit(...)`: report errors, await pool cleanup, and assign `process.exitCode` only after cleanup completes.

**Why:** Railway shell sessions can lose observable output or status when a CLI hard-exits while shared database resources remain open.

**How to apply:** Wrap institutional CLI entrypoints in the shared lifecycle runner; keep dry-run and APPLY logic unchanged, and use a transaction-level read-only verifier for production state checks.

Executable CLI modules must not import helpers from another executable CLI module; move or duplicate small inert helpers so importing one command cannot launch another command as a side effect.

**Why:** Entry-point guards based on the test environment still execute during a real CLI-to-CLI import, which can start two production processes with the same arguments.

**How to apply:** Keep cross-command helpers in non-entry-point modules, or define bounded safety helpers locally; dynamically import database modules only after enforcing read-only connection options.