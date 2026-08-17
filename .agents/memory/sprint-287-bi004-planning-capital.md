---
name: Sprint 2.8.7 BI-004 — Planning Capital
description: Broker-independent planning capital for risk sizing — architecture, safety invariants, and dim-7 contract for PLANNING_MODE status.
---

## Rule

`PlanningCapitalContext` (source: "USER_DEFINED_PLANNING_CAPITAL") is embedded in `TradePlanPlanningSnapshot.planningCapital` (JSONB — no migration required). It is NEVER execution-grade.

## Dim-7 Contract

| Condition | buildBuyingPowerDimension returns |
|-----------|-----------------------------------|
| Broker connected | existing live buying power path |
| Broker absent + planningCapital.source === "USER_DEFINED_PLANNING_CAPITAL" | `PLANNING_MODE` |
| Broker absent + no planning capital | `NOT_CONFIRMED` |

`PLANNING_MODE` ≠ `PASS`. `overallStatus` NEVER becomes PASS from planning capital. `executionAvailable` NEVER true from planning capital. `BrokerExecutionReadiness` stays `NOT_CONNECTED` when broker absent.

**Why:** CON-004: previously dim-7 always returned NOT_CONFIRMED/UNAVAILABLE when broker absent; traders had no way to do research-level risk sizing. Planning capital closes this gap without touching execution gates.

**How to apply:** When adding any new execution gate or dim, planning capital must never satisfy it. PLANNING_MODE is a research-only status — treat like NOT_CONFIRMED for execution decisions.

## Persistence Pattern

- Session constraints: `capitalAvailable` + `maxRiskPercent` + `maxAllocationPercent` (PATCH /api/trade-planning/session/:id)
- At plan creation: `_buildPlanningSnapshot()` auto-embeds `computePlanningCapitalContext(...)` into snapshot
- Post-creation update: `PATCH /api/trade-plans/:id/planning-capital` (dedicated sub-route, patches JSONB only, no version bump)
- Route order: this PATCH must come BEFORE the /:id dynamic catch-all

## Type Extension Pattern

`TradePlanningConstraints` now has `maxRiskPercent?: number` and `maxAllocationPercent?: number`. Both are validated by `validateConstraints()` (rejects < 0 or > 100) and included in `constraintsFingerprint()`.
