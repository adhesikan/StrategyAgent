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

## Broken link fix (Defect-9)
Both "Open Research Workspace" CTAs in the lifecycle panel previously navigated to `/research/${plan.symbol}` → `ResearchDetailPage` which expects a Sprint 5.4D record UUID — not a symbol ticker. Fixed to `/research-workspace?symbol=${plan.symbol}` (AI Research Workspace).

## Ownership guard
`POST /api/trade-plans/:id/lifecycle/review` — cross-user returns 404 (not 403) to prevent plan-ID enumeration. Placement: before `/lifecycle/evaluate` in `trade-plans.ts` (deepest static route must register last).
