---
name: Lifecycle review acknowledgement
description: Review validity uses state-anchored computeResearchChanges(reviewedBaseline, current) — NOT timestamps. lastReviewedResearchState JSONB stores the baseline at review time.
---

## Rule
`REQUIRES_REVIEW` is cleared by the user clicking "Mark Research Reviewed". The server records
`lastReviewedAt` AND captures the current OppIntel research state as `lastReviewedResearchState`
(JSONB). On subsequent lifecycle evaluations, `computeResearchChanges(reviewedBaseline, current)` is
called — the SAME canonical comparator used for plan-creation → current changes. No separate
threshold logic.

**Review validity (state-anchored, PRIMARY):**
- No material changes between reviewed baseline and current state → CURRENT
- Any material change since the review → REQUIRES_REVIEW

**Legacy fallback (plans reviewed before this fix, `lastReviewedResearchState` = null):**
7-day wall-clock window (`REVIEW_ACKNOWLEDGEMENT_WINDOW_DAYS = 7`).

**Why state-anchored over timestamp-anchored:**
`currentSummary.asOf` = `generatedAt` = timestamp of the opportunity-ranking engine scan run
(every 4h). Identical scores in a new scan advance `asOf` — timestamp comparison wrongly treated
that as "newer data" and invalidated the review. State comparison has no such false positive.

## Priority ordering in `computeLifecycleState`
1. `ARCHIVED` / `INVALIDATED` plan status → `ARCHIVED`
2. `DATA_STALE` → `DATA_STALE`
3. `THESIS_INVALIDATED` → `THESIS_INVALIDATED`
4. `symbolNotQualified = true` → `REQUIRES_REVIEW` (qualification-loss, NOT clearable by review)
5. `!currentAvailable` (system error) → `UNKNOWN`
6. Material changes + `reviewedStateChanges` empty/non-material → `CURRENT`
7. Material changes + `reviewedStateChanges` has material change → `REQUIRES_REVIEW`
8. Material changes + no reviewed baseline (`reviewedStateChanges = null`) → legacy 7-day window
9. Non-material changes → `CHANGED`
10. No changes → `CURRENT`

`THESIS_INVALIDATED`, `DATA_STALE`, and `QUALIFICATION_LOST` are NEVER cleared by review.

## How to apply
- `computeLifecycleState()` accepts `reviewedStateChanges?: ResearchChangeItem[] | null`
  - `null` → no reviewed baseline stored → legacy 7-day fallback
  - `[]` → reviewed baseline matches current → CURRENT
  - `[...material...]` → scores drifted since review → REQUIRES_REVIEW
- `evaluateTradePlanLifecycle()` reads `lastReviewedResearchState` from plan row, calls
  `computeResearchChanges(lastReviewedResearchState as TradePlanResearchSnapshot, currentSummary)`,
  passes result as `reviewedStateChanges`.
- `POST .../lifecycle/review` captures `getCanonicalOpportunity(symbol)` at review time,
  strips `asOf`/scan-timestamps, persists as `lastReviewedResearchState`. Fire-and-forget
  capture failure → `lastReviewedResearchState = null` → legacy fallback still works.
- Schema: `last_reviewed_research_state JSONB DEFAULT NULL` on `trade_plans`
- Drizzle: `lastReviewedResearchState: jsonb("last_reviewed_research_state")`
- `ensureTradePlanTables()` ALTER block: `ADD COLUMN IF NOT EXISTS last_reviewed_research_state JSONB DEFAULT NULL`
- Schema contract test: `NEWER_COLUMNS` array — update when adding new columns to `trade_plans`

## Symbol qualification loss (Defect-10)
`getCanonicalOpportunity()` returning `null` (symbol not in qualified snapshot) → `symbolNotQualified = true`
→ `REQUIRES_REVIEW` with `QUALIFICATION_LOST` reason. Review RECORDS awareness but cannot clear it
until OppIntel re-qualifies the symbol. `computeReviewReasons` early-returns for symbolNotQualified
to prevent `CRITICAL_DATA_STALE` noise.

## Preflight consistency
- `createDbPreflightDeps.getLifecycleResult()` always uses `{ force: true }` — never serves a
  pre-review cache entry.
- `POST .../lifecycle/review` deletes all `execution_preflights` rows for the plan/user.
- Client `handleMarkReviewed` invalidates BOTH query keys: `["execution-preflight", tradePlanId]`
  AND `["/api/trade-plans", id, "execution", "preflight"]`.
- Diagnostic logging: `[lifecycle:diagnostic]` in `evaluateTradePlanLifecycle`;
  `[preflight:lifecycle-diagnostic]` in `getLifecycleResult`.

## Schema deployment contract
Every new column on `trade_plans` MUST appear in the `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
block inside `ensureTradePlanTables()` in `trade-plan-service.ts`. That block is the ONLY thing
Railway runs on startup. Files in `server/migrations/*.sql` are supplemental, NOT auto-executed.

## Broken link fix (Defect-9)
"Open Research Workspace" CTAs in lifecycle panel navigate to `/research-workspace?symbol=...`
(AI Research Workspace) — NOT `/research/${plan.symbol}` (Sprint 5.4D record UUID route).

## Ownership guard
`POST .../lifecycle/review` returns 404 for unknown/unauthorized plans (not 403) to prevent
plan-ID enumeration.
