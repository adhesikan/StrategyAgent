---
name: Institutional acceptance semantics
description: Interpret post-APPLY coverage analyzer target and completion fields.
---

`aggregateTargets` and `signalTargets` are scheduled canonical target counts, not pending counts; existing targets remain scheduled after APPLY. Acceptance requires aggregate/signal missing counts, pending mapping/holding operations, and snapshot-family missing counts to be zero, with reconciliation and blocker checks passing.

**Why:** A successful APPLY can leave the expected target totals unchanged, so those totals alone cannot distinguish complete materialization from additional work.

**How to apply:** Use the summary-only acceptance fields or the full plan's `downstream`, `materialization`, current/projected coverage, and operation actions. Treat the plan hash as a deterministic hash of current state, not proof of completion.