---
name: Guarded canonical security corrections
description: Canonical type and symbol corrections must be applied as a separate, hash-bound production operation before institutional remediation.
---

Canonical security-type and provider-backed symbol corrections are a distinct transaction from institutional remediation. They require fresh provider evidence, preserve CUSIP identity, never overwrite reviewed or rejected records, and block stock materialization until a fresh canonical-state check has no unresolved blockers.

**Why:** Persisted machine-derived asset types can be stale, and invalid or contradictory symbols cannot safely be repaired by guessing. Mixing correction and downstream rebuilds would make a partial or stale plan capable of changing derived institutional data.

**How to apply:** Keep correction actions and unresolved review blockers separate in the deterministic plan. Require production identity, `NODE_ENV`, an explicit correction environment guard, `DATABASE_URL` without an external override, and an exact fresh plan hash inside an advisory-locked transaction. Re-run canonical verification before any remediation APPLY.