# 44 — Broker Submission, Execution Status & Fills

**Sprint:** 2.8.6  
**Status:** Live (Sandbox + TEST_LIVE supported; Production blocked)  
**Tables:** `execution_intents`, `execution_submission_attempts`, `execution_fills`, `execution_position_links`

---

## Overview

Sprint 2.8.6 introduces the first real broker submission path for VCP Trader AI.

- **SANDBOX mode** — paper trading via the provider's simulation endpoint. No real money at risk.
- **TEST_LIVE mode** — live broker submission restricted to a pre-approved test account and symbol list. Requires all 10 safety gates simultaneously.
- **PRODUCTION mode** — permanently blocked in this release.

**Permanent invariant:** one confirmed snapshot hash may produce **at most one** broker mutation. This is enforced by the `idempotency_key` UNIQUE constraint and the atomic state-machine transition layer.

---

## State Machine (15 States)

```
INTENT_CREATED
  → FINAL_VALIDATION_IN_PROGRESS
      → FINAL_VALIDATION_FAILED          [terminal]
      → SANDBOX_SUBMISSION_IN_PROGRESS
          → BROKER_ACCEPTED
          → SUBMISSION_UNKNOWN
          → REJECTED                     [terminal]
      → SUBMISSION_IN_PROGRESS
          → BROKER_ACCEPTED
          → SUBMISSION_UNKNOWN
          → REJECTED                     [terminal]

BROKER_ACCEPTED
  → OPEN
      → PARTIALLY_FILLED → FILLED → POSITION_LINKED [terminal]
      → CANCELLED [terminal]
      → EXPIRED_AT_BROKER [terminal]
  → PARTIALLY_FILLED
  → FILLED → POSITION_LINKED [terminal]
  → CANCELLED [terminal]
  → EXPIRED_AT_BROKER [terminal]
  → SUBMISSION_UNKNOWN

SUBMISSION_UNKNOWN
  → BROKER_ACCEPTED
  → REJECTED [terminal]
  → ABANDONED [terminal]
```

Transitions are enforced atomically via `WHERE state = $expected` UPDATE. A race-lost transition is a no-op (returns false from `atomicTransitionState`).

---

## Execution Modes

| Mode | Env Var | Description |
|------|---------|-------------|
| `disabled` | (default) | No submissions allowed |
| `sandbox` | `BROKER_EXECUTION_MODE=sandbox` | Paper trading via SIM endpoint |
| `test_live` | `BROKER_EXECUTION_MODE=test_live` | Real account, allowlisted only |
| `production` | — | Blocked this release |

---

## TEST_LIVE Safety Gates

**All 10 conditions must be simultaneously true:**

| Gate | Env Var | Notes |
|------|---------|-------|
| Execution enabled | `BROKER_EXECUTION_ENABLED=true` | Master kill switch |
| Mode | `BROKER_EXECUTION_MODE=test_live` | Must be exactly test_live |
| Armed | `EXECUTION_TEST_LIVE_ARMED=true` | Plus optional expiry |
| Armed expiry | `EXECUTION_TEST_LIVE_ARMED_UNTIL` | ISO 8601 timestamp |
| Account allowlist | `EXECUTION_TEST_ACCOUNT_ALLOWLIST` | Comma-separated; empty = all blocked |
| Symbol allowlist | `EXECUTION_TEST_SYMBOL_ALLOWLIST` | Comma-separated; empty = all blocked |
| Max notional | `EXECUTION_TEST_MAX_NOTIONAL` | USD cap per order |
| Max equity qty | `EXECUTION_TEST_MAX_EQUITY_QTY` | Shares cap per equity order |
| Max option contracts | `EXECUTION_TEST_MAX_OPTION_CONTRACTS` | Contracts cap per option order |
| No market orders | (hard-coded) | Market orders banned in TEST_LIVE |
| No multi-leg | (hard-coded) | Multi-leg options banned in TEST_LIVE |

---

## Submission Flow

1. Trader completes order review and confirms (`order_confirmations` record)
2. Client calls `POST /api/executions/from-confirmation/:confirmationId` → creates `ExecutionIntent` in `INTENT_CREATED`
3. Trader clicks Submit → `POST /api/executions/:id/submit`
4. Server runs `runFinalValidation()` — 19+ checks, all blockers collected
5. If valid: transitions to `SUBMISSION_IN_PROGRESS` (or `SANDBOX_SUBMISSION_IN_PROGRESS`)
6. **Persist-before-send**: `insertSubmissionAttempt` with `IN_PROGRESS` before any network call
7. Single `placeBrokerOrder()` call with 30-second AbortController timeout
8. Outcome:
   - `ACCEPTED` + orderId → `BROKER_ACCEPTED`
   - `REJECTED` (clear error) → `REJECTED`
   - Timeout or ambiguous → `SUBMISSION_UNKNOWN`

---

## SUBMISSION_UNKNOWN Protocol

If the broker connection times out or returns an ambiguous response:
- State is set to `SUBMISSION_UNKNOWN`
- **Never auto-retry** — the order may already be placed
- Trader must check their broker account directly
- Use `POST /api/executions/:id/reconcile` to query broker status
- Reconcile-only path: reads broker by `brokerOrderRef` → `clientOrderTag` → cannot resolve
- If found: apply correct state; if still unknown: keep `SUBMISSION_UNKNOWN`

---

## Idempotency

The `idempotency_key` is SHA-256 of:
```
userId | confirmationId | confirmationSnapshotHash | accountRef | provider
```

The `UNIQUE` constraint on `execution_intents(idempotency_key)` prevents double-submit even if the client clicks twice. The route also checks for an existing intent for the same `confirmationId` and returns it idempotently.

---

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/executions/health` | Health + mode info (no auth required) |
| POST | `/api/executions/from-confirmation/:cid` | Create intent from confirmed order |
| GET | `/api/executions` | List user's intents (max 50) |
| GET | `/api/executions/:id` | Get intent + fills |
| GET | `/api/executions/:id/status` | Status + fills (polling-friendly) |
| GET | `/api/executions/:id/activity` | Audit events |
| POST | `/api/executions/:id/submit` | **THE ONLY submission endpoint** |
| POST | `/api/executions/:id/reconcile` | Trigger broker status reconcile |
| POST | `/api/executions/:id/cancel` | Cancel OPEN/BROKER_ACCEPTED order |

### Submit endpoint security hardening
- `userId` always from session — never from request body
- `x-agent-source` header → 403 (AI submission blocked)
- Forbidden field guard (`brokerPayload`, `forceSubmit`, `skipValidation`, etc.)
- PRODUCTION mode → 422 always

---

## Database Tables

### `execution_intents`
Primary record for each execution attempt. `idempotency_key` UNIQUE. `(confirmation_id, user_id)` UNIQUE to prevent one confirmation producing two intents.

### `execution_submission_attempts`
One row per broker call attempt. Records `IN_PROGRESS` before network call. Updated with outcome after.

### `execution_fills`
Fill records from broker, persisted after reconciliation confirms fill quantity and price.

### `execution_position_links`
Created after FILLED → POSITION_LINKED transition. Triggers a fire-and-forget broker portfolio cache invalidation.

---

## Startup Recovery

On server startup, `reconcileStaleExecutionIntents()` finds any `SUBMISSION_IN_PROGRESS` intents older than 2 minutes (from a crashed server restart) and marks them `SUBMISSION_UNKNOWN`. This prevents phantom in-progress states from persisting across restarts.

---

## Forbidden Client Fields (Submission Body)

The submit endpoint rejects any body containing:
`brokerPayload`, `rawOrder`, `accountId`, `legs`, `quantity`, `price`, `side`, `symbol`, `forceSubmit`, `skipValidation`, `retry`, `mode`, `testAccount`, `overrideMode`, `bypassGate`, `production`, `live`

---

## Compliance Labels

| Mode | User-Facing Label |
|------|-------------------|
| SANDBOX | Paper Trading |
| TEST_LIVE | Live Test Account |
| DISABLED | Disabled |
| PRODUCTION | Production (Blocked) |

---

## Operations Checklist

**Before enabling SANDBOX:**
- [ ] `BROKER_EXECUTION_ENABLED=true`
- [ ] `BROKER_EXECUTION_MODE=sandbox`
- [ ] Broker connection active and token valid

**Before enabling TEST_LIVE:**
- [ ] All SANDBOX requirements above
- [ ] `BROKER_EXECUTION_MODE=test_live`
- [ ] `EXECUTION_TEST_LIVE_ARMED=true`
- [ ] `EXECUTION_TEST_LIVE_ARMED_UNTIL=<ISO expiry>`
- [ ] `EXECUTION_TEST_ACCOUNT_ALLOWLIST=<comma-separated account IDs>`
- [ ] `EXECUTION_TEST_SYMBOL_ALLOWLIST=<comma-separated symbols>`
- [ ] `EXECUTION_TEST_MAX_NOTIONAL=<USD cap>`
- [ ] `EXECUTION_TEST_MAX_EQUITY_QTY=<shares cap>`
- [ ] `EXECUTION_TEST_MAX_OPTION_CONTRACTS=<contracts cap>`
- [ ] Verify test account has adequate paper/test funds
- [ ] Review SUBMISSION_UNKNOWN resolution protocol with team

**Disarming TEST_LIVE:**
- Set `EXECUTION_TEST_LIVE_ARMED=false` or allow `EXECUTION_TEST_LIVE_ARMED_UNTIL` to expire

---

## Test Suite

`test:execution` — 222 pure tests, no DB or broker connections required.

Covers: state machine (30+ tests), compliance (18 tests), final validation (40+ tests), TEST_LIVE gates (20+ tests), fingerprinting (12 tests), broker translation (25+ tests), normalizer (24 tests), policy functions (25+ tests), security (10 tests), reconciliation (9 tests), API exports (25+ tests).
