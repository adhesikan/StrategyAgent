---
name: Opportunity Lifecycle Intelligence
description: Sprint 2.0 architecture — DB table, pure comparison service, history writer, two API endpoints, dashboard lifecycle section + symbol history drawer.
---

# Opportunity Lifecycle Intelligence (Sprint 2.0)

## Rule
`opportunity_history` records one row per symbol per scan. The history writer is fire-and-forget and must never block or throw to the engine. The comparison service is pure (no DB/HTTP calls) and directly unit-testable.

**Why:** Scanner runs on background schedule; any fatal side effect in history writing would abort the scan silently.

## How to apply
- `writeOpportunityHistory()` is called in `opportunity-engine.ts` after `saveSuccessfulSnapshot()` — never before (snapshotId must exist in DB first).
- `prevSnapshotForHistory` must be captured BEFORE `saveSuccessfulSnapshot()` so it holds the previous scan, not the new one.
- `computeLifecycleState()` in `opportunity-comparison-service.ts` is pure and exported for unit tests.
- `deriveScore(rank, isQualified)` = `max(0, 100 - (rank-1) * 5)` for qualified; 0 for watch.
- `getPreviousValidSnapshot()` uses LIMIT 2 on the snapshots table and returns row[1].

## 8 lifecycle state rules (in priority order)
1. NEWLY_QUALIFIED — in latest qualified, absent from ALL prev buckets (or was watch only)
2. STILL_QUALIFIED — both qualified, |rankDelta| ≤ 1
3. STRENGTHENING — both qualified, rankCurrent improved by ≥ 2
4. WEAKENING — both qualified, rankCurrent worsened by ≥ 2
5. APPROACHING — in latest watch (regardless of prev)
6. TRIGGERED — prev qualified, absent from ALL latest buckets, unavailableCount = 0
7. DROPPED — prev watch only, absent from ALL latest buckets, unavailableCount = 0
8. UNAVAILABLE — absent from latest, was in prev, unavailableCount > 0

## Dashboard integration
- `OpportunityLifecycleSection` renders below `OpportunityEngineSection` in `DashboardPage`.
- Visible only when `changesData?.hasPreviousScan === true`.
- `changesQuery` fetches `/api/opportunities/changes` (12-min refetch).
- `SymbolHistoryDrawer` (Sheet) fetches `/api/opportunities/symbol/:symbol/history`.
- `LIFECYCLE_BADGE` constant maps all 8 states to label + CSS class.
- Route tests avoid supertest — use mock request simulation pattern (call service logic directly with mocked store).

## Key files
- `server/services/opportunity-comparison-service.ts`
- `server/services/opportunity-history-writer.ts`
- `server/services/opportunity-snapshot-store.ts` (getPreviousValidSnapshot, getFirstSeenMap, getSnapshotHistory, getSymbolHistory added)
- `server/routes/opportunity-changes.ts`
- `server/routes/opportunity-symbol-history.ts`
- `scripts/migrate.js` (opportunity_history table)
- `shared/schema.ts` (opportunityHistory Drizzle table + types)
- `client/src/pages/dashboard.tsx` (OpportunityLifecycleSection, SymbolHistoryDrawer, changesQuery)
