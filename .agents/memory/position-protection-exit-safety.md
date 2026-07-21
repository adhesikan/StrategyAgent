---
name: Position Protection exit safety
description: Durable invariants for the app-managed exit worker — never double-fire, never hit broker in paper, honor exit order type
---

# Position Protection — durable safety invariants

The monitoring worker submits real broker exit orders when a stop/target/trail
rule triggers. These invariants must survive any future change:

1. **Never submit more than one exit per plan.** The ACTIVE→TRIGGERED claim is
   atomic and predicated on the plan still being ACTIVE with no exit order yet.
   The lifecycle is a strict state machine: closed states (triggered/exited/
   cancelled/error) can never be re-armed to active.
   **Why:** without this a re-armed or double-ticked plan fires a second market
   exit. **How to apply:** any new transition or worker exit path must keep both
   the atomic claim and the "no exit order id" guard.

2. **Paper plans never touch the broker.** `accountMode === "paper"` simulates a
   fill locally; only `"live"` routes a real order.
   **Why:** paper is a learning/trial surface — a real order there is a serious
   safety bug. **How to apply:** any new exit/order path must branch on
   accountMode before calling the broker.

   **Re-verify the live position before exiting, scoped to the plan's account.**
   A plan can go stale (user closed/reduced the position manually). The live
   path must fetch positions for `plan.brokerAccountId` (NOT the connection's
   default/preferred account) and match symbol + side; abort (cancel + notify,
   no order) if missing/flipped, and clamp exit qty to what's actually held.
   **Why:** validating against account A while submitting on account B
   reintroduces phantom/over-exit risk. `getBrokerPositions(userId, accountId?)`
   is account-scoped (cache key + token resolution).

3. **Honor the user's exit order type.** Plans persist an exit order type
   (market / stop / stop-limit); the live path must build the broker order to
   match, falling back to market only when no usable trigger level exists.
   **Why:** the field is user-chosen risk control; silently sending market
   defeats it.

**Broker note:** No provider exposes a native trailing_stop order — trailing is
app-managed; the worker submits a regular order on trigger. Customer-facing PP is
live-only, but live exits submit real-money orders so `liveEnabled` defaults OFF
(explicit `ENABLE_LIVE_POSITION_PROTECTION=true` required); `sandboxEnabled`
(paper plans) also defaults OFF. Env flags accept both `ENABLE_*` and legacy
`POSITION_PROTECTION_*` names. The create route derives accountMode from the
`sandbox:` account-id prefix — never trust the client's mode claim.
Live polls faster than paper (separate env-configurable cadences). `getWorkerHeartbeat()`
feeds admin telemetry.

**Compliance copy:** public Position Protection copy must avoid
autopilot/autonomous/AI-managed/guaranteed. "Not autonomous"-style disclaimers
are the accepted app-wide pattern; describe cadence as "periodic during market
hours," never a fixed second count.
