---
name: Brokerless Trade Plan Readiness (Sprint 2.8.7A)
description: Two-layer preflight split, TPR/BER model, status vocabulary, critical gotchas.
---

## The Rule

Trade Plan Readiness (TPR) is broker-independent. Broker absence = UNAVAILABLE overall (not FAIL). TPR PASS never authorizes order preparation.

## Two-Layer Model

- **TradePlanReadiness** (dims 1–3, 11, 12): plan, lifecycle, freshness, risk, planning constraints. Fully brokerless.
- **BrokerExecutionReadiness** (dims 4–10): broker/account/permissions/buying-power/position/quote/structure. Broker-dependent.
- Both are additive fields on `ExecutionPreflightResult` — no DB migration.

**Why:** BI-001/002/014 from audit series; users without broker should still see plan readiness (not BLOCKED).

## Status Vocabulary

| Status | When | Color |
|---|---|---|
| `NOT_CONNECTED` | Broker dims when broker absent | Gray |
| `NOT_APPLICABLE` | Equity position dim (no shares needed for direct purchase) | Gray muted |
| `NOT_CONFIRMED` | Buying power when broker absent | Amber |
| `PLANNING_MODE` | Quote dim + OPTIONS structure when broker absent | Blue |

## How to Apply

- Broker absent → dims 4–6: `NOT_CONNECTED` (no blocker), dim 7: `NOT_CONFIRMED` (no blocker), dim 8: `NOT_APPLICABLE`, dim 9: `PLANNING_MODE`, dim 10: PASS (equity) / `PLANNING_MODE` (options)
- Plan blockers (lifecycle FAIL, constraint exceeded, etc.) still produce `overallStatus = "FAIL"` regardless of broker
- `overallStatus = "PASS"` still requires TPR=PASS AND BER=READY AND brokerConnected

## Critical Gotcha — EXECUTION_DISABLED Fast Path

`isExecutionEnabled()` returns false when `BROKER_EXECUTION_ENABLED` env is unset (default). The EXECUTION_DISABLED fast path MUST still compute TPR (broker-independent) before returning. Failure to do this causes `tradePlanReadiness = undefined` in tests. Fixed in `runExecutionPreflight` by loading plan + lifecycle FIRST, then fast-pathing with TPR populated.

## Test Setup

Tests that exercise the brokerless path (not EXECUTION_DISABLED) must set:
```javascript
beforeEach(() => { process.env.BROKER_EXECUTION_ENABLED = "true"; });
afterEach(() => { delete process.env.BROKER_EXECUTION_ENABLED; });
```

## UI Contract

- **Card 1 (Trade Plan Readiness)**: always visible, `data-testid="check-plan-readiness-cta"` always enabled
- **Card 2 (Direct Execution)**: always visible; `data-testid="broker-execution-not-connected"` when no broker (neutral gray, not error)
- **"Prepare for Execution" CTA**: only when `overallStatus === "PASS" && brokerConnected` — `data-testid="prepare-for-execution-cta"`
- Execution workflow section: Step 1 is now Order Preparation (preflight panel removed from workflow)

## Changed Tests

- `execution-preflight.test.ts`: "SKIPPED" test → only checks broker dims; "BROKER_NOT_CONNECTED" → NOT_CONNECTED status; quote "UNAVAILABLE" → PLANNING_MODE; methodology "2.8.0" → "2.8.7a"
- `execution-entry-point.test.ts`: §VD3 → checks "Brokerage not connected" + new testid; §VD10 → checks two-card layout
- `trade-plan-detail-hook-order.test.ts`: §HK21 → must search for `queryKey: ["/api/trade-plans", id, "lifecycle"]` not `"lifecycle"` (my helper introduces `"lifecycle"` earlier in the file)

## methodologyVersion

Bumped from `"2.8.0"` → `"2.8.7a"`. buildFailResult also updated to include `executionAvailable: false`.
