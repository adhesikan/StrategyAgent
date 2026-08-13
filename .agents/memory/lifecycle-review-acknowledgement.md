---
name: Lifecycle review acknowledgement
description: How the REQUIRES_REVIEW lifecycle state is cleared by an explicit user review action (lastReviewedAt + /lifecycle/review endpoint).
---

## Rule
`REQUIRES_REVIEW` can be cleared by the user explicitly clicking "Mark Research Reviewed" in the trade plan lifecycle panel. The server records `lastReviewedAt` and re-evaluates the lifecycle — if `lastReviewedAt` is within 7 days and the plan would otherwise be `REQUIRES_REVIEW`, it becomes `CURRENT`.

**Why:** The NVDA UAT showed the lifecycle panel was a dead-end — no mechanism existed for the user to acknowledge material research changes and unblock execution.

## Priority ordering in `computeLifecycleState`
1. `ARCHIVED` / `INVALIDATED` plan status → `ARCHIVED`
2. `DATA_STALE` (freshnessChanges with DATA_BECAME_STALE/DATA_UNAVAILABLE) → `DATA_STALE`
3. `THESIS_INVALIDATED` (invalidationChanges observed) → `THESIS_INVALIDATED`
4. Material changes + recent review (≤ 7 days) → `CURRENT`
5. Material changes + no/expired review → `REQUIRES_REVIEW`
6. Non-material changes → `CHANGED`
7. No changes → `CURRENT`

`THESIS_INVALIDATED` and `DATA_STALE` are NEVER cleared by user review. Review only clears `REQUIRES_REVIEW`.

## Review window
`REVIEW_ACKNOWLEDGEMENT_WINDOW_DAYS = 7` — after 7 days, REQUIRES_REVIEW reappears if scores still diverge.

## How to apply
- `computeLifecycleState()` accepts `lastReviewedAt?: Date | null`
- `evaluateTradePlanLifecycle()` reads `lastReviewedAt` from plan row via `(plan as any).lastReviewedAt`
- Schema: `last_reviewed_at TIMESTAMPTZ` nullable column on `trade_plans`
- Migration: `server/migrations/add-trade-plan-last-reviewed-at.sql`

## Symbol qualification loss (Defect-10)

**`symbolNotQualified` vs `opportunityFetchError`:**
- `getCanonicalOpportunity()` returns `null` (no exception) → `symbolNotQualified = true` → lifecycle = `REQUIRES_REVIEW` with `QUALIFICATION_LOST` reason
- exception thrown → `opportunityFetchError = true` → lifecycle = `UNKNOWN` (system error — unchanged)

**`symbolNotQualified` in `computeLifecycleState`:** checked BEFORE `!currentAvailable → UNKNOWN` and BEFORE `DATA_STALE`. `lastReviewedAt` window does NOT apply to qualification loss — review records awareness but symbol stays unqualified until OppIntel re-qualifies it.

**`computeReviewReasons` early return:** when `symbolNotQualified = true`, emits only `QUALIFICATION_LOST` then returns — prevents `CRITICAL_DATA_STALE` pollution from `DATA_UNAVAILABLE` freshness change.

**`TradePlanLifecycleResult.symbolQualificationStatus`:** `"QUALIFIED"` | `"NOT_QUALIFIED"` | `"UNKNOWN"`. Client derives `isNotQualified = lifecycle?.symbolQualificationStatus === "NOT_QUALIFIED"`. Review panel shows two modes: (a) NOT_QUALIFIED: saved-research + "No Longer Qualified" current status card; (b) score-based: Saved vs Now comparison.

**Invariant:** QUALIFICATION_LOST → REQUIRES_REVIEW → preflight always blocks, even after `Mark Research Reviewed`.

## Schema deployment contract (Defect-10b — production 500 on GET /api/trade-plans)

**Root cause:** `last_reviewed_at` added to Drizzle schema but NOT to `ensureTradePlanTables()` ALTER block → Railway startup ran ensure but column was never added → SQLSTATE 42703 on every list query.

**Canonical deployment path:** `ensureTradePlanTables()` in `trade-plan-service.ts` is the ONLY thing that runs on Railway startup. Files in `server/migrations/*.sql` are NOT auto-executed. Every new column on `trade_plans` MUST appear in the `ALTER TABLE trade_plans ADD COLUMN IF NOT EXISTS ...` block inside `ensureTradePlanTables()`.

**Contract test:** `server/services/__tests__/trade-plan-schema-contract.test.ts` — update `NEWER_COLUMNS` there whenever a new column is added to `trade_plans`.

**Nullability rule:** `last_reviewed_at` is nullable; existing plans that have never been reviewed must remain NULL (no backfill).

## Broken link fix (Defect-9)
Both "Open Research Workspace" CTAs in the lifecycle panel previously navigated to `/research/${plan.symbol}` → `ResearchDetailPage` which expects a Sprint 5.4D record UUID — not a symbol ticker. Fixed to `/research-workspace?symbol=${plan.symbol}` (AI Research Workspace).

## Ownership guard
`POST /api/trade-plans/:id/lifecycle/review` — cross-user returns 404 (not 403) to prevent plan-ID enumeration. Placement: before `/lifecycle/evaluate` in `trade-plans.ts` (deepest static route must register last).
