# Sprint 2.8.7 BI-004 — Broker-Independent Planning Capital & Risk Sizing

**Sprint:** 2.8.7 BI-004  
**Status:** IMPLEMENTATION COMPLETE — AUTOMATED VALIDATION PASS (39/39 tests)  
**Date:** 2026-08-17  
**Related backlog item:** BI-004 (CON-004) — resolved  
**Architecture track:** Broker Independence (Doc 46)  

---

## Overview

Sprint 2.8.7 BI-004 allows traders to enter their own planning capital, max risk %, and max position allocation % directly on a Trade Plan — without connecting a broker. The platform uses these user-defined planning assumptions to provide a **research-grade risk sizing context** within the Execution Readiness panel (dim 7 / Buying Power).

This is the companion to Sprint 2.8.7A (brokerless Trade Plan Readiness) and Sprint 2.8.7B (brokerless equity market data). It closes the last major gap in the broker-independent planning experience: previously, dim 7 always showed `NOT_CONFIRMED` when no broker was connected. With BI-004, it shows `PLANNING_MODE` when planning capital is present.

---

## Safety Invariants (Permanent)

All 14 invariants are enforced by automated tests (39 tests pass):

| Invariant | Description |
|-----------|-------------|
| I1 | `source` is always `USER_DEFINED_PLANNING_CAPITAL` — never broker-sourced |
| I2 | `computePlanningCapitalContext()` returns null for invalid/missing inputs — no fabricated values |
| I3 | `PlanningCapitalContext` is embedded in `planningSnapshot` (JSONB) — never in broker data structures |
| I4 | `PLANNING_MODE` is not `PASS` — planning capital never authorizes execution |
| I5 | `overallStatus` never becomes `PASS` due to planning capital alone |
| I6 | `executionAvailable` never becomes `true` due to planning capital |
| I7 | `BrokerExecutionReadiness` remains `NOT_CONNECTED` when broker absent (planning capital does not affect BER) |
| I8 | Broker buying power never overwrites planning capital (separate fields, additive) |
| I9 | Planning capital is never presented as broker buying power |
| I10 | Order preparation still requires execution-grade broker readiness |
| I11 | `validateConstraints` rejects `maxRiskPercent` / `maxAllocationPercent` outside [0, 100] |
| I12 | `constraintsFingerprint` includes new percentage fields |
| I13 | `THEORETICAL_ONLY` brand on option values is unchanged — planning capital does not affect options gate |
| I14 | `NOT_CONFIRMED` returned when no planning capital set (broker absent, no capital) |

---

## Architecture

### Type: PlanningCapitalContext

```typescript
interface PlanningCapitalContext {
  capitalAmount:         number;  // user-entered (from capitalAvailable constraint)
  maxRiskPercent:        number;  // user-entered 0–100
  maxRiskDollars:        number;  // derived: capitalAmount × maxRiskPercent / 100
  maxAllocationPercent:  number;  // user-entered 0–100
  maxAllocationDollars:  number;  // derived: capitalAmount × maxAllocationPercent / 100
  source:                "USER_DEFINED_PLANNING_CAPITAL";
  capturedAt:            string;  // ISO timestamp
}
```

### Session Constraints (extended)

`TradePlanningConstraints` gains two new optional percentage fields:
- `maxRiskPercent?: number` — max risk per trade as a percentage (0–100)
- `maxAllocationPercent?: number` — max position allocation as a percentage (0–100)

These are validated by `validateConstraints()` and included in `constraintsFingerprint()`.

### Snapshot Embedding

`TradePlanPlanningSnapshot` gains `planningCapital?: PlanningCapitalContext | null`. This is embedded in the `planning_snapshot` JSONB column — **no schema migration required**.

`_buildPlanningSnapshot()` in `trade-plan-service.ts` auto-embeds planning capital from session constraints at plan creation when all three inputs are present (capitalAvailable + maxRiskPercent + maxAllocationPercent).

### Post-Creation Updates

`PATCH /api/trade-plans/:id/planning-capital` patches only `planningSnapshot.planningCapital` in the JSONB. No version bump. No `planningSnapshot` immutability bypass (it is a dedicated sub-route that only patches the single nested field).

### Dim 7 — Buying Power Availability

| Condition | Status |
|-----------|--------|
| Broker connected | Existing path (live buying power vs. estimated capital requirement) |
| Broker absent + `planningCapital` present + `source = USER_DEFINED_PLANNING_CAPITAL` | `PLANNING_MODE` |
| Broker absent + no planning capital | `NOT_CONFIRMED` (unchanged) |

`PLANNING_MODE` does NOT contribute to `overallStatus = PASS`. The dim note clearly states "research only — not broker buying power."

---

## UI: Planning Capital Card

Location: `trade-plan-detail.tsx`, above the Execution Preparation section (EQUITY + non-ARCHIVED plans only).

Three numeric inputs:
1. **Planning Capital ($)** — maps to `capitalAvailable` constraint and `planningCapital.capitalAmount`
2. **Max Risk / Trade (%)** — maps to `maxRiskPercent`
3. **Max Position Allocation (%)** — maps to `maxAllocationPercent`

Derived display (real-time, no server round-trip):
- **Max Risk:** `$capitalAmount × maxRiskPercent / 100`
- **Max Position:** `$capitalAmount × maxAllocationPercent / 100`

Label: *"Planning assumptions — not broker buying power. Execution requires a connected broker account."*

Save button: calls `PATCH /api/trade-plans/:id/planning-capital`. On success, invalidates preflight cache. User must re-run the readiness check to see updated dim 7.

---

## Test Coverage

File: `server/services/__tests__/planning-capital.test.ts` (new, 39 tests)

| Section | Tests |
|---------|-------|
| §PC1–PC2: computePlanningCapitalContext happy path | 4 |
| §PC3/PC13: invalid inputs return null | 13 |
| §PC4: planningCapital field in type system | 2 |
| §PC5–PC8: dim-7 status contract | 4 |
| §PC9–PC10: broker data additive, never overwrites | 2 |
| §PC11–PC12: BER and order preparation require broker | 2 |
| §PC14: theoretical options unchanged | 2 |
| §PC15–PC16: validateConstraints new fields | 8 |
| §PC17: constraintsFingerprint new fields | 4 |
| **Total** | **39** |

---

## STOP BEFORE PUSH/DEPLOY

Per sprint spec: **do not push to Railway or deploy**. Production UAT for planning capital requires a live broker-absent Trade Plan session. Test against existing plans in development.

---

## Docs Updated

- Doc 15 (BI-004 resolved)
- Doc 17 (sprint entry added)
- Doc 53 (status corrected: AUTOMATED VALIDATION PASS, visual UAT pending)
- Doc 55 (this file — new)
