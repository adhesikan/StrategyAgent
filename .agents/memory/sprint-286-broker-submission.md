---
name: Sprint 2.8.6 — Broker Submission, Execution Status & Fills
description: Architecture decisions, invariants, and known quirks for the sandbox/test-live submission pipeline.
---

# Sprint 2.8.6 — Broker Submission, Execution Status & Fills

## Core Invariants
- One confirmed snapshot hash → at most one broker mutation. Enforced by `idempotency_key` UNIQUE constraint + atomic `WHERE state = $expected` UPDATE.
- PRODUCTION mode is permanently blocked (literal constant `PRODUCTION_SUBMISSION_NOT_ENABLED: true` in `shared/execution-intent-types.ts`).
- SUBMISSION_UNKNOWN on timeout/ambiguity — never auto-retry. Reconcile-only path.
- Persist submission attempt (IN_PROGRESS) BEFORE the network call (persist-before-send).
- `x-agent-source` header on submit → 403 immediately (AI submission hard-blocked).

## State Machine (15 states)
`INTENT_CREATED → FINAL_VALIDATION_IN_PROGRESS → {FINAL_VALIDATION_FAILED | SANDBOX_SUBMISSION_IN_PROGRESS | SUBMISSION_IN_PROGRESS} → BROKER_ACCEPTED → {OPEN | PARTIALLY_FILLED | FILLED → POSITION_LINKED | CANCELLED | EXPIRED_AT_BROKER} | SUBMISSION_UNKNOWN → {BROKER_ACCEPTED | REJECTED | ABANDONED}`.

Transitions enforced via `atomicTransitionState()` which does `UPDATE ... WHERE state = $from AND id = $id AND user_id = $user`. Returns false on race-loss — caller must handle.

## TEST_LIVE Safety Gates
All 10 env vars must be simultaneously configured. Empty allowlists = all blocked. Checked in both `runFinalValidation()` (final-validation-service.ts) and route-level. Market orders banned. Multi-leg banned.

**Why:** isTestLiveArmed uses `isNaN(expiry)` guard (not try/catch) because `new Date("invalid")` doesn't throw — returns NaN.

## Key Integration Points
- `placeBrokerOrder(userId, order)` from `server/broker/index.ts` handles simMode routing internally
- `cancelBrokerOrder(userId, orderId)` from same file
- `getBrokerOrders(userId)` for reconciliation queries
- `invalidateBrokerCache(userId)` called fire-and-forget after position link
- `maskAccountId()` from `server/services/broker-execution-adapter.ts`

## Order-Confirmation Test Fix
`makePreview()` fixture in `order-confirmation.test.ts` had `new Date().toISOString()` for `quoteFreshness.newestQuoteTime` which flows into canonical hash — made the determinism test flaky across milliseconds. Fixed to use `FIXED_QUOTE_TIME` constant.

## Test Count
18 suites / 1312 tests after Sprint 2.8.6. New suite: `test:execution` (222 tests, pure/injectable, no DB or broker).
