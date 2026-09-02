---
name: Institutional reconciliation source status
description: The shared SEC streaming parser's usable status contract for read-only historical reconciliation.
---

Historical SEC reconciliation must treat both `success` and `partial_success` as usable source results. `partial_success` means valid source rows were parsed while some rows were rejected; it is not a transport or archive failure.

**Why:** A reconciler that accepts only `success` can report every otherwise-readable SEC archive as a source failure, even though the proven historical backfill path accepts and processes the same result.

**How to apply:** Reuse the backfill status predicate when consuming `streamBulkFromDescriptor`. Escalate only `failed` and parse-failure statuses, and map those to safe stage-specific diagnostics without exposing parser reasons or response bodies.