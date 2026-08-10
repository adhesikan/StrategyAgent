---
name: Trade Plan Workspace (Sprint 2.7.5)
description: Persistent trade plan DB tables, service signatures, and test gotchas for the plan workspace sprint.
---

## Core Architecture

- **DB tables:** `trade_plans` (17 cols) + `trade_plan_versions` (10 cols), both VARCHAR PK with `DEFAULT gen_random_uuid()`
- **Drizzle definitions:** `shared/schema.ts` exports `tradePlans` + `tradePlanVersions`
- **Startup migration:** `ensureTradePlanTables()` in `trade-plan-service.ts` — idempotent `CREATE TABLE IF NOT EXISTS`; called from `server/routes.ts` via dynamic import
- **Types file:** `shared/trade-plan-types.ts` — canonical types, constants, defaults, disclaimer strings

## Critical Function Signatures

### `getCachedRiskAnalysis` (trade-risk-scenario-service.ts)
Takes **3 args**: `(userId, sessionId, candidateId)` — NOT `(sessionId, candidateId)`.

### `buildTradePlanningContext` (trade-planning-service.ts)
Options shape: `{ goalId?, portfolioId?, constraints? }` — does **NOT** accept `sessionId`.

## Test Gotcha

`RESEARCH_REVIEW_CHECKLIST_DISCLAIMER` contains the phrase "not an approval" (as a negation). Therefore:
- `expect(disclaimer).toContain("not an approval")` → ✅ correct
- `expect(disclaimer).not.toContain("approval")` → ❌ fails (substring "approval" is in "not an approval")

The correct test pattern is `.not.toContain("is an approval")` or `.not.toContain("regulatory approval")`.

## Plan Health States

`CURRENT` | `CHANGED` | `REQUIRES_REVIEW` | `THESIS_INVALIDATED` | `DATA_STALE` | `UNKNOWN`

REQUIRES_REVIEW threshold: ≥5 pt score change, qualification lost, material risk/regime shift.
THESIS_INVALIDATED: only when a *new* invalidation condition fires (not one present at creation).

## Route Registration Rule

`/api/trade-plans/health` (static) MUST be registered BEFORE `/api/trade-plans/:id` (dynamic).
Same rule: `/trade-plans` client route before `/trade-plans/:id`.

## Cross-User Isolation

Wrong-user plan lookup → `null` → **404** (not 403 — avoids existence leakage).

## Forbidden in Plan Data

No: `brokerOrderId`, `orderType`, `fillPrice`, `ticketJson`, `probabilityOfProfit`, `expectedReturn`, `suitabilityScore`.
No execution CTA on any plan page. "Order Preparation — Upcoming" is the only forward reference.

## Why

**Server-authoritative creation:** prevents client from supplying tampered scores, prices, or Greeks.
**Immutable snapshots:** research state at plan creation must be preserved as a historical record.
**404 on wrong user:** 403 would confirm the plan ID exists — information leakage risk.
**3-arg getCachedRiskAnalysis:** risk cache is keyed `userId:sessionId:candidateId` for user isolation.
