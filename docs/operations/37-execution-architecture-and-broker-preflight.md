# Doc 37 — Execution Architecture & Broker Preflight

**Sprint 2.8.0 · Phase 2.8 — Broker-Assisted Execution (Architecture Layer)**

---

## 1. Overview

Sprint 2.8.0 implements the execution architecture, safety model, and broker preflight layer for VCP Trader AI. **No order submission is implemented in this sprint.** No `POST /execution/submit`, no `placeOrder` calls from the new execution flow.

The primary deliverables are:

- Global execution kill switch (`BROKER_EXECUTION_ENABLED`)
- Canonical execution types and policy engine
- 12-dimension broker execution preflight engine (pure computation, injectable deps)
- Read-only broker execution adapter interface
- Execution preflight API routes (4 endpoints)
- Kill-switch guards on all 5 legacy order-capable routes
- Execution preflight UI panel (client-side, Trade Plan page)
- Execution health section in Platform Health
- Two new database tables: `execution_preflights`, `execution_audit_events`

---

## 2. Execution Kill Switch

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `BROKER_EXECUTION_ENABLED` | `false` | **Master kill switch.** Must be `"true"` to allow any order submission. |
| `BROKER_EXECUTION_MODE` | `disabled` | `disabled` \| `sandbox` \| `production` |
| `TRADIER_EXECUTION_ENABLED` | `false` | Provider flag — only active when global flag is true |
| `TRADESTATION_EXECUTION_ENABLED` | `false` | Provider flag — only active when global flag is true |

### Precedence Rule

```
BROKER_EXECUTION_ENABLED=false → ALL execution DISABLED
  regardless of TRADIER_EXECUTION_ENABLED or TRADESTATION_EXECUTION_ENABLED
```

Missing, unset, or invalid values → treated as `false` / `disabled`.

### Legacy Route Guards

All 5 legacy order-capable routes now check the kill switch at handler entry:

| Route | Method | Guard Added |
|---|---|---|
| `/api/broker/orders` | POST | ✅ Sprint 2.8.0 |
| `/api/broker/positions/:symbol/close` | POST | ✅ Sprint 2.8.0 |
| `/api/trade/place-equity` | POST | ✅ Sprint 2.8.0 |
| `/api/trade/place` | POST | ✅ Sprint 2.8.0 |
| `/api/snaptrade/orders` | POST | ✅ Sprint 2.8.0 |

**Non-guarded (safe):**
- `POST /api/trade/place-option` — MOCK ONLY (`status: "filled_mock"`, never real broker)
- `POST /api/instatrade/entry/exit` — Sends to AlgoPilotX external webhook (not direct broker)
- `POST /api/orders/:orderId/cancel` — Cancel existing orders (not new order creation)

When `BROKER_EXECUTION_ENABLED` is false, guarded routes return:
```json
{
  "error": "Order submission is currently disabled.",
  "code": "EXECUTION_DISABLED",
  "executionEnabled": false,
  "executionMode": "disabled"
}
```
HTTP status: `503 Service Unavailable`

---

## 3. Execution Preflight Engine

### Purpose

Execution Preflight checks 12 technical and account prerequisites that would need to be satisfied before a future broker order could be prepared.

**A passing preflight is NOT an investment recommendation, suitability determination, guarantee of execution, or instruction to transact.**

### Mandatory Disclaimer

Every preflight response includes:

> "Execution Preflight checks technical and account prerequisites that would need to be satisfied before a future broker order could be prepared. A passing preflight is not an investment recommendation, suitability determination, guarantee of execution, or instruction to transact."

### Forbidden Status Values

Preflight `overallStatus` must NEVER be:
- `READY_TO_TRADE`
- `APPROVED`
- `RECOMMENDED`

Allowed values: `PASS` | `FAIL` | `REQUIRES_REVIEW` | `UNAVAILABLE` | `EXECUTION_DISABLED`

### Preflight Requires Saved Trade Plan

`POST /api/trade-plans/:id/execution/preflight` requires a valid, user-owned, non-archived Trade Plan with `tradePlanId`. There is no symbol→broker shortcut.

### 12 Validation Dimensions

| # | Dimension | Purpose |
|---|---|---|
| 1 | Trade Plan | Validates plan structure, status, not archived |
| 2 | Lifecycle | Checks for THESIS_INVALIDATED, DATA_STALE, REQUIRES_REVIEW, UNKNOWN |
| 3 | Freshness | Plan age, lifecycle evaluation recency |
| 4 | Broker Connection | Connected, not needing reauth |
| 5 | Account | Account resolved, ownership verified |
| 6 | Permissions | Equity/options/multi-leg permissions (unavailable from Tradier/TradeStation — returns UNAVAILABLE) |
| 7 | Buying Power | Available from broker, estimated capital vs. available |
| 8 | Position | Covered call / protective put / collar share count |
| 9 | Quote | Fresh bid/ask, not stale/crossed/zero-bid, contracts not expired |
| 10 | Structure | Option contract legs existence and availability |
| 11 | Risk | Risk analysis age (stale > 24h), max loss vs. constraint |
| 12 | Planning Constraint | Scenario loss vs. planning max risk |

### Freshness Thresholds (execution-grade)

| Data | Max Age |
|---|---|
| Underlying quote | 60 seconds |
| Options quote | 120 seconds |
| Account / buying power | 5 minutes |
| Position data | 2 minutes |
| Broker connection check | 10 minutes |
| Risk analysis | 24 hours |
| Lifecycle evaluation | 1 hour |
| **Preflight PASS result** | **5 minutes** |

### ValidUntil

Every `PASS` or `REQUIRES_REVIEW` result includes `validUntil` (ISO 8601). A stale preflight result cannot be reused. The 5-minute window is the shortest freshness threshold.

---

## 4. API Endpoints

### Static Routes (registered before dynamic)

#### `GET /api/execution/capabilities`
Returns platform-level execution capability summary.
- Never exposes raw account IDs or balances
- `executionEnabled`, `executionMode`, `brokerConnected`, `provider`, `accountResolved` (not full ID)
- `supportsEquityOrders`, `supportsOptionsOrders`, `supportsMultiLegOrders`

#### `GET /api/execution/health`
Returns execution health section for Platform Health page.
- Aggregate metrics only: preflight request/pass/failure counts
- No user PII, no balances, no positions
- `state`: `DISABLED` | `SANDBOX_READY` | `DEGRADED` | `NOT_READY`
- NEVER: `READY_FOR_LIVE_TRADING`

### Dynamic Trade Plan Routes

#### `POST /api/trade-plans/:id/execution/preflight`
Runs or re-runs execution preflight for a saved Trade Plan.

**Request:**
```json
{
  "requestedAccountRef": "optional account ref string"
}
```

**Rejected fields (returns 400):**
- `skipQuoteValidation`, `skipBuyingPower`, `skipPermissions`
- `forceExecute`, `ignoreInvalidation`, `overrideExecution`
- `bypassPreflight`, `skipLifecycle`, `skipRisk`

**Response:** `ExecutionPreflightResult` — always includes disclaimer in `limitations[]`

#### `GET /api/trade-plans/:id/execution/preflight`
Returns the most recent preflight result.
- Cross-user plan → 404 (not 403, to prevent user enumeration)
- No preflight yet → 404 with message
- Includes `isExpired: boolean` field

---

## 5. Data Model

### `execution_preflights` Table
```sql
CREATE TABLE execution_preflights (
  id                VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  trade_plan_id     VARCHAR NOT NULL,
  provider          TEXT,
  status            TEXT NOT NULL,
  result_json       JSONB NOT NULL DEFAULT '{}',
  evaluated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Indexes: `user_id`, `trade_plan_id`, `evaluated_at`

### `execution_audit_events` Table
```sql
CREATE TABLE execution_audit_events (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL,
  trade_plan_id       VARCHAR NOT NULL,
  event_type          TEXT NOT NULL,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider            TEXT,
  account_ref_masked  TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'
);
```

Indexes: `user_id`, `trade_plan_id`, `occurred_at`

**Audit event types (Sprint 2.8.0):**
`PREFLIGHT_STARTED` · `PREFLIGHT_COMPLETED` · `PREFLIGHT_FAILED` · `BROKER_CONNECTION_CHECKED` · `ACCOUNT_VALIDATED` · `PERMISSIONS_CHECKED` · `BUYING_POWER_CHECKED` · `POSITION_CHECKED` · `QUOTE_VALIDATED` · `RISK_VALIDATED` · `EXECUTION_DISABLED_ATTEMPT`

### Audit Data Rules
- NEVER store: broker tokens, full account IDs, raw portfolio balances, passwords
- Account references: masked only (`••••1234`)
- Metadata: `provider`, `planType`, `status`, `blockerCount`, `warningCount`, `hasFreshQuote`, `hasPermissions`, `durationMs`, `executionMode`

---

## 6. Provider Capability Matrix

| Capability | Tradier | TradeStation | SnapTrade |
|---|---|---|---|
| Equity orders | SUPPORTED | SUPPORTED | SUPPORTED |
| Options orders | SUPPORTED | SUPPORTED | UNKNOWN |
| Multi-leg | UNKNOWN | UNKNOWN | UNKNOWN |
| Sandbox | SUPPORTED | UNKNOWN | UNKNOWN |
| Permissions API | UNKNOWN | UNKNOWN | UNKNOWN |
| Buying power API | SUPPORTED | SUPPORTED | SUPPORTED |
| Positions API | SUPPORTED | SUPPORTED | SUPPORTED |
| Quote API | SUPPORTED | SUPPORTED | UNKNOWN |

> **Note on Permissions:** Tradier and TradeStation do not expose a dedicated permissions API. Insufficient permissions are detected reactively via API error responses. Preflight returns `UNAVAILABLE` for permissions dimension.

---

## 7. Safety Invariants

1. **No order methods called from preflight.** The `BrokerExecutionAdapter` interface has no `placeOrder`, `submitOrder`, `replaceOrder`, or `cancelOrder` methods. Tests verify spy call counts = 0.

2. **Client cannot bypass safety checks.** Rejected fields checked server-side on every POST.

3. **All safety policy flags default TRUE.** No policy flag can be flipped false by client.

4. **Cross-user isolation.** Plan ownership always verified against session `userId`. Cross-user plan access returns 404.

5. **Audit events are append-only.** No UPDATE or DELETE on audit tables.

6. **Preflight result has TTL.** `validUntil` computed from shortest freshness window. Old PASS cannot be reused.

7. **No raw tokens in outputs.** Broker tokens, full account IDs, and raw balances never appear in API responses, audit events, or logs.

---

## 8. Future Architecture (Sprint 2.8.1+)

Documented in `shared/execution-types.ts`:

- `ExecutionIntent` — user execution intent, short-lived, requires fresh preflight
- `OrderPreparationInput` — handoff to order preparation (Sprint 2.8.1)
- `ExecutionIntentState` — full state machine (DRAFT_INTENT → FILLED)
- `FutureOrderIdempotencyDesign` — persistent dedup architecture (Sprint 2.8.5)

**State machine transitions are server-side only. State skipping is prohibited.**

---

## 9. Execution Mode Lifecycle

| Phase | Sprint | Description |
|---|---|---|
| Architecture | 2.8.0 | Kill switch, preflight, types, audit, UI panel |
| Order Preparation | 2.8.1 | Structured order preparation from preflight + trade plan |
| Confirmation | 2.8.2 | Short-lived TTL confirmation flow, idempotency tokens |
| Submission | 2.8.5 | Actual broker order submission (first real orders) |
| Monitoring | 2.8.6+ | Order lifecycle, fill tracking, position reconciliation |

**Task #131 — Lifecycle scheduler cron:** Assigned to Sprint 2.8.4.

---

## 10. Operations Runbook

### Disabling Order Submission
```bash
# In Railway or environment config:
BROKER_EXECUTION_ENABLED=false
# All 5 order-capable routes will return 503
# No code change needed — kill switch is read at request time
```

### Enabling Sandbox Mode (future)
```bash
BROKER_EXECUTION_ENABLED=true
BROKER_EXECUTION_MODE=sandbox
TRADIER_EXECUTION_ENABLED=true
```

### Checking Execution Health
```bash
GET /api/execution/health
# Returns aggregate metrics, no PII
```

### Checking Preflight for a Trade Plan
```bash
POST /api/trade-plans/{planId}/execution/preflight
# Requires active session, plan must belong to user
# Body: {} (no bypass fields)
```

### Database Maintenance
Tables are created automatically at startup via `ensureExecutionPreflightTables()`.

Retention policy (recommended):
- `execution_preflights`: 90-day TTL
- `execution_audit_events`: 1-year retention (compliance)

---

## 11. Test Suite

**`npm run test:execution-preflight`**

Coverage: 175+ assertions across 22 test groups:
1. Kill switch env var behavior (5 tests)
2. Execution mode parsing (4 tests)
3. Provider flag + global override (5 tests)
4. Safety policy defaults (1 test)
5. Safety bypass detection (6 tests)
6. Execution disabled fast-path (4 tests)
7. Trade Plan required (3 tests)
8. Lifecycle state validation (6 tests)
9. Broker connection (3 tests)
10. Account resolution (3 tests)
11. Permissions (4 tests)
12. Buying power (3 tests)
13. Position requirements — covered call / protective put (4 tests)
14. Quote validation (4 tests)
15. Risk analysis freshness (3 tests)
16. Planning constraints (1 test)
17. Blockers, warnings, validUntil (3 tests)
18. No order calls / broker spy (3 tests)
19. Audit events (5 tests)
20. Log redaction / output scrubbing (2 tests)
21. Compliance language (5 tests)
22. Confirmation requirements (2 tests)
23. Persistence (2 tests)
24. Freshness threshold values (2 tests)

---

*Document created: Sprint 2.8.0 · August 2026*
