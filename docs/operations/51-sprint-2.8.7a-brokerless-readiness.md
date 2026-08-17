# Doc 51 — Sprint 2.8.7A: Brokerless Trade Plan Readiness & Preflight Split

**Sprint:** 2.8.7A  
**Category:** Architecture Implementation  
**Status:** COMPLETE  
**Date:** 2026-08-17  
**Cross-references:** Doc 46 (Architecture), Doc 47 (Audit A), Doc 48 (Audit B), Doc 50 (Audit D)

---

## 1. Scope

Implements the first P0 architecture package from the Broker Independence audit series (Audits A, B, C, C1, D):

- **BI-001 / BI-002** — Execution Preflight two-layer split
- **BI-014** — Trade Plan execution section brokerless behavior

**Not in scope:** independent options provider, theoretical options engine, dashboard portfolio redesign, options scanner redesign, onboarding/guided journey, broad market-data abstraction.

---

## 2. Primary Goal

A user WITHOUT a broker connection can:

1. Open a saved Trade Plan
2. Run Trade Plan Readiness
3. See independent readiness dimensions
4. Receive a meaningful PASS / REQUIRES_REVIEW / FAIL result
5. Continue monitoring/researching the plan

Broker absence is NOT shown as a plan failure.

**Critical invariant:** Trade Plan Readiness PASS NEVER authorizes order preparation or broker submission.

---

## 3. Two-Layer Model

### 3.1 Layer 1: Trade Plan Readiness (Broker-Independent)

**Type:** `TradePlanReadiness`

```typescript
interface TradePlanReadiness {
  status: "PASS" | "FAIL" | "REQUIRES_REVIEW";
  label: string; // "Plan Ready" | "Blocked" | "Review Required"
  dimensions: {
    tradePlan: ValidationDimension;         // dim 1
    lifecycle: ValidationDimension;         // dim 2
    freshness: ValidationDimension;         // dim 3
    risk: ValidationDimension;              // dim 11
    planningConstraints: ValidationDimension; // dim 12
  };
  limitations: string[];
}
```

**Status logic:**
- Any FAIL dim → status = "FAIL" → label = "Blocked"
- Any REQUIRES_REVIEW or UNAVAILABLE dim → status = "REQUIRES_REVIEW" → label = "Review Required"
- All PASS → status = "PASS" → label = "Plan Ready"

**INVARIANT:** `tradePlanReadiness.status === "PASS"` NEVER authorizes order preparation or broker submission.

### 3.2 Layer 2: Broker Execution Readiness (Broker-Dependent)

**Type:** `BrokerExecutionReadiness`

```typescript
interface BrokerExecutionReadiness {
  status: "READY" | "NOT_CONNECTED" | "REQUIRES_REVIEW" | "BLOCKED";
  label: string;
  brokerConnected: boolean;
  provider?: string;
  dimensions: {
    brokerConnection: ValidationDimension;
    brokerAccount: ValidationDimension;
    permissions: ValidationDimension;
    buyingPower: ValidationDimension;
    position: ValidationDimension;
    quote: ValidationDimension;
    structure: ValidationDimension;
  };
}
```

When broker not connected: `status = "NOT_CONNECTED"`, `label = "Not Connected"`. Not an error state.

### 3.3 Overall Status — Preserved Semantics

```
overallStatus === "PASS"
  ↔ tradePlanReadiness.status === "PASS"
  AND brokerExecutionReadiness.status === "READY"
  AND brokerConnected === true
```

No brokerless code path may produce `overallStatus = "PASS"`.

**Brokerless path with no plan blockers:** `overallStatus = "UNAVAILABLE"` (not FAIL)  
**Real plan blockers present:** `overallStatus = "FAIL"` (regardless of broker)

---

## 4. New `ValidationStatus` Values

Added in `shared/execution-types.ts`:

| Value | Meaning | Color |
|---|---|---|
| `NOT_CONNECTED` | Broker absent — expected, not an error | Gray |
| `NOT_APPLICABLE` | Dimension does not apply in this context | Gray (muted) |
| `NOT_CONFIRMED` | Value cannot be confirmed without broker | Amber |
| `PLANNING_MODE` | Evaluated in planning context; broker not available | Blue |

---

## 5. Dimension Behavior Without Broker

| Dimension | Old Behavior | New Behavior (Brokerless) |
|---|---|---|
| Broker Connection (dim 4) | FAIL + BROKER_NOT_CONNECTED blocker | **NOT_CONNECTED** — no blocker |
| Broker Account (dim 5) | FAIL + ACCOUNT_NOT_RESOLVED blocker | **NOT_CONNECTED** — no blocker |
| Broker Permissions (dim 6) | UNAVAILABLE + warning | **NOT_CONNECTED** — no warning |
| Buying Power (dim 7) | UNAVAILABLE + blocker | **NOT_CONFIRMED** — no blocker |
| Position (dim 8) | UNAVAILABLE | **NOT_APPLICABLE** (equity) / **NOT_CONFIRMED** (covered/protective) |
| Quote Validation (dim 9) | UNAVAILABLE + QUOTE_STALE blocker | **PLANNING_MODE** — no blocker |
| Structure Validation (dim 10) | PASS (equity) / PASS (options, no contracts) | PASS (equity) / **PLANNING_MODE** (options) |
| Trade Plan (dim 1) | unchanged | unchanged |
| Research Lifecycle (dim 2) | unchanged | unchanged |
| Plan Freshness (dim 3) | unchanged | unchanged |
| Risk Analysis (dim 11) | unchanged | unchanged |
| Planning Constraints (dim 12) | was void → now ValidationDimension | ValidationDimension (PASS/FAIL/UNAVAILABLE) |

---

## 6. Dimension Behavior With Broker Connected

All dimensions evaluate as before. New `tradePlanReadiness` and `brokerExecutionReadiness` fields are populated and `executionAvailable = (overallStatus === "PASS")`.

---

## 7. API Contract

Existing preflight endpoints unchanged. Response gains additive fields:

```typescript
// ExecutionPreflightResult now includes (optional — backward compatible):
tradePlanReadiness?: TradePlanReadiness;
brokerExecutionReadiness?: BrokerExecutionReadiness | null;
executionAvailable?: boolean;
```

DB schema: `execution_preflights.status` remains the existing `overallStatus`. No migration required. `result_json` stores the full result including new fields.

---

## 8. Order Preparation Gate — Unchanged

```
preflightRow.status === "PASS"
```

This is a permanent safety boundary. Not changed in this sprint.

---

## 9. Trade Plan UI — Before / After

### Before

| State | UI |
|---|---|
| No broker | BLOCKED — yellow warning, no check possible |
| Broker connected | "Check Execution Preconditions" CTA → workflow |

### After (Sprint 2.8.7A)

**Card 1: Trade Plan Readiness** (always visible, no broker gate)

| State | UI |
|---|---|
| No result yet | "Run a readiness check to evaluate your plan's current status" + "Check Plan Readiness" button |
| Result available | TradePlanReadinessPanel with 5-dim table + headline (Plan Ready / Review Required / Blocked) |
| Button | Always enabled — explicit user action required |

**Card 2: Direct Execution** (always visible)

| State | UI |
|---|---|
| No broker | Neutral gray: "Brokerage not connected" + "Connect Broker — Optional" (secondary) |
| Broker, no result | "Run a readiness check above to evaluate broker account status" |
| Broker + result | BrokerExecutionReadinessPanel with 7-dim table |
| overallStatus=PASS + broker | "Prepare for Execution" CTA appears (primary) |

### Execution workflow (`showExecution` section)

Preflight Panel removed from this section (readiness is now in Card 1). Workflow now shows:  
Order Preparation → Equity Preview → Final Review

---

## 10. Broker Disconnect / Reconnect

| Scenario | TPR | BER | overallStatus | executionAvailable |
|---|---|---|---|---|
| Broker connected, all pass | PASS | READY | PASS | true |
| Broker disconnects | PASS (unchanged) | NOT_CONNECTED | UNAVAILABLE | false |
| Broker reconnects | PASS (unchanged) | READY | PASS | true |

No plan recreation required. Same plan re-evaluates.

---

## 11. Platform Health

Broker disconnected MUST NOT make the overall Trade Planning subsystem degraded when broker-independent readiness is operational. Broker absence ≠ platform failure.

---

## 12. Safety Invariants (Permanent Tests)

| ID | Invariant |
|---|---|
| INV-A | Brokerless Trade Plan Readiness can PASS |
| INV-B | Brokerless overallStatus is NEVER "PASS" |
| INV-C | Brokerless executionAvailable is ALWAYS false |
| INV-D | Order preparation rejects brokerless result (overallStatus ≠ PASS) |
| INV-E | Broker submission remains impossible |
| INV-F | Broker connection transition enriches same plan (TPR status unchanged) |
| INV-G | Broker disconnect removes execution availability only (TPR intact) |
| INV-H | Lifecycle/freshness logic remains unchanged |
| INV-I | No automatic broker calls from Trade Plan rendering |

---

## 13. Files Changed

### Server

| File | Change |
|---|---|
| `shared/execution-types.ts` | Added 4 new `ValidationStatus` values; `TradePlanReadiness` interface; `BrokerExecutionReadiness` interface; `ExecutionPreflightResult` extended with 3 additive fields |
| `server/services/execution-preflight-service.ts` | Refactored 7 dimension builders (broker absent → new status values, no blockers); `checkPlanningConstraints` → `buildPlanningConstraintDimension` (returns `ValidationDimension`); added `computeTradePlanReadiness()`; added `computeBrokerExecutionReadiness()`; updated main flow to include new fields; `methodologyVersion` → `"2.8.7a"` |

### Client

| File | Change |
|---|---|
| `client/src/pages/trade-plan-detail.tsx` | Removed `brokerConnected` from preflight query `enabled`; added `runReadiness` mutation; added `TradePlanReadinessPanel` + `BrokerExecutionReadinessPanel` helpers; replaced single "Execution Preparation" card with two-card TPR/BER layout; updated execution workflow section (Preflight Panel removed, steps renumbered) |
| `client/src/components/execution/ExecutionPreflightPanel.tsx` | Added status icon/color handling for 4 new `ValidationStatus` values; removed broker gate on run button; updated info text |

### Tests

| File | Change |
|---|---|
| `server/__tests__/execution-preflight-brokerless.test.ts` | **NEW** — 11 suites, permanent invariant tests |

### Docs

| File | Change |
|---|---|
| `docs/operations/51-sprint-2.8.7a-brokerless-readiness.md` | **THIS DOCUMENT** |
| `docs/operations/46-broker-independence-architecture.md` | Sprint 2.8.7A implementation entry |
| `docs/operations/48-audit-b-preflight-layering.md` | Implementation reference updated |
| `docs/operations/50-audit-d-brokerless-ux.md` | Implementation reference updated |
| `docs/operations/15-known-issues-and-backlog.md` | BI-001/002/014 marked RESOLVED |
| `docs/operations/README.md` | Doc 51 entry added |
| `docs/operations/17-sprint-change-log.md` | Sprint 2.8.7A entry |

---

## 14. UAT Acceptance Criteria

### Brokerless User

1. Open Trade Plan → Trade Plan Readiness section visible ✓
2. Click "Check Plan Readiness" → independent dimensions evaluate ✓
3. Plan may show "Plan Ready" (PASS) ✓
4. Direct Execution shows "Brokerage not connected" (neutral gray) ✓
5. No red broker failure banner ✓
6. "Connect Broker — Optional" CTA visible (secondary, neutral) ✓
7. No order preparation possible ✓
8. "Prepare for Execution" CTA does NOT appear ✓

### Broker-Connected User

9. Run readiness → both layers evaluate ✓
10. overallStatus=PASS → "Prepare for Execution" CTA appears ✓
11. Existing Order Preparation → Preview → Final Review workflow unchanged ✓
12. Broker disconnect → TPR preserved, "Prepare for Execution" CTA disappears ✓

---

## 15. READY_FOR_RAILWAY_REDEPLOY

**READY_FOR_RAILWAY_REDEPLOY** — No DB migration required. All new fields are additive. Existing `result_json` rows remain valid. `methodologyVersion` bumped to `"2.8.7a"` for auditability.
