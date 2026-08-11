---
name: Sprint 2.8.0 — Execution Architecture
description: Kill switch, preflight engine, broker adapter, audit tables, and route guards for Phase 2.8 execution layer.
---

## Execution Kill Switch

- `BROKER_EXECUTION_ENABLED` env var: must be exact string `"true"` to enable. Missing/invalid/false → disabled.
- `BROKER_EXECUTION_MODE`: `disabled|sandbox|production`. Invalid → `disabled`.
- Provider flags (`TRADIER_EXECUTION_ENABLED`, `TRADESTATION_EXECUTION_ENABLED`): only ever active when global flag is true. Global always wins.
- **Why:** Orders are a one-way door. Default-disabled means a misconfigured env is always safe.

## Legacy Route Guards

Five routes now guarded with `isExecutionEnabled()` at handler entry (all return 503 + `EXECUTION_DISABLED` when disabled):
- `POST /api/broker/orders`
- `POST /api/broker/positions/:symbol/close`
- `POST /api/trade/place-equity`
- `POST /api/trade/place`
- `POST /api/snaptrade/orders`

`POST /api/trade/place-option` is MOCK ONLY — no guard needed (returns `status:"filled_mock"`).

## Preflight Engine

- File: `server/services/execution-preflight-service.ts` — pure computation, injectable deps.
- 12 dimensions: tradePlan, lifecycle, freshness, broker, account, permissions, buyingPower, position, quote, structure, risk, planningConstraints.
- `BrokerAccount` is in `@shared/execution-types`, NOT in `broker-execution-adapter` (caused TS error).
- `buildAccountDimension` must reference `import("@shared/execution-types").BrokerAccount[]`.
- Broker adapter: `server/services/broker-execution-adapter.ts` uses `../broker/index` (not `../broker-service` — that file doesn't export these functions).
- `getBrokerAccounts`, `getBrokerPositions`, `getOptionQuote` are all from `server/broker/index.ts`.
- No `getBrokerQuote` function exported from `broker/index` — use optional chain with `?.`.

## Preflight Compliance Invariants

- `overallStatus` allowed: `PASS|FAIL|REQUIRES_REVIEW|UNAVAILABLE|EXECUTION_DISABLED`. NEVER: `READY_TO_TRADE`, `APPROVED`, `RECOMMENDED`.
- Client bypass fields (`forceExecute`, `skipQuoteValidation`, etc.) must be rejected server-side.
- Disclaimer in `EXECUTION_PREFLIGHT_DISCLAIMER` constant must appear in `limitations[]` of every result.
- `validUntil` = NOW + 300s for PASS/REQUIRES_REVIEW results only; undefined for FAIL/UNAVAILABLE.

## DB Tables

- `execution_preflights`: append-only, `result_json` JSONB holds full `ExecutionPreflightResult`.
- `execution_audit_events`: append-only, never store tokens/full account IDs/balances.
- Tables auto-created at startup via `ensureExecutionPreflightTables()` (same pattern as trade-plan tables).
- Drizzle schema entries in `shared/schema.ts` at end of file.

## Test Suite

- `npm run test:execution-preflight` → 88 tests, 175+ assertions.
- All tests use pure computation + `MockBrokerExecutionAdapter` — no DB, no real broker calls.
- `MockBrokerExecutionAdapter.spy` tracks `placeOrder/submitOrder/replaceOrder/cancelOrder` call counts — must all be 0.
- `afterEach` must be imported from vitest alongside `beforeEach`.

## Route Registration Order

Static routes (`/api/execution/capabilities`, `/api/execution/health`) MUST be registered BEFORE dynamic routes (`/api/trade-plans/:id/execution/preflight`). This follows the same pattern as all other route files.

## Pre-existing TS Errors (not Sprint 2.8.0)

- `routes.ts` Map iteration (TS2802) — pre-existing, not introduced here.
- `institutional-trade-card.tsx` `decision` undefined — pre-existing.
- `research-domain-summary.tsx` `unknown` ReactNode — pre-existing.

## Task #131 Disposition

Lifecycle scheduler cron: assigned to Sprint 2.8.4. Documented in ops doc 37.

## Phase 2.8 Sequence

2.8.0 (Architecture) → 2.8.1 (Order Preparation) → 2.8.2 (Confirmation) → 2.8.4 (Lifecycle Scheduler) → 2.8.5 (First Real Order Submission)
