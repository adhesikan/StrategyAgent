---
name: Position Protection exit safety
description: Why exit-order submission has two idempotency guards and a strict lifecycle state machine
---

# Position Protection — preventing duplicate exit orders

The monitoring worker submits real broker exit orders when a stop/target/trail
triggers. Two safeguards prevent ever submitting more than one exit per plan:

1. **Atomic claim in `triggerExit`** — the ACTIVE→TRIGGERED update is predicated on
   `status = ACTIVE AND submittedExitOrderId IS NULL`. If zero rows return, another
   worker tick already claimed it (or an order was already sent) and it returns early.
2. **Strict lifecycle state machine** — pause/resume/cancel only transition from
   explicitly allowed source statuses (active↔paused; active/paused→cancelled).
   Closed states (triggered/exited/cancelled/error) can never be re-armed back to active.

**Why:** without #2 a crafted resume call could flip an already-exited plan back to
active and the worker would submit a second market exit. Without the `submittedExitOrderId IS NULL`
half of #1, a re-armed plan with a lingering order id could still double-fire.

**How to apply:** any new lifecycle transition or worker exit path must preserve both
guards. Never let a plan that has a `submittedExitOrderId` return to ACTIVE.

**Broker note:** Tradier has NO native trailing_stop order type — trailing is
app-managed; the worker submits a regular market order on trigger. Same for the other
providers (all `nativeTrailingStop = false`). Defaults: paper+stocks ON, live/options/
spreads OFF behind env flags (`PROTECTION_LIVE_ENABLED` etc.).
