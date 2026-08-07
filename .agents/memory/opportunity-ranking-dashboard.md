---
name: Opportunity Ranking Dashboard wiring
description: Sprint 2.2.8 — dashboard switched from /api/opportunities/latest to /api/opportunities/today; new types, card design, helpers module.
---

## What changed

`/api/opportunities/latest` is no longer called from the dashboard for opportunity cards.
The single new call is `GET /api/opportunities/today` → `OpportunityTodayResponse`.

## Key types (client/src/pages/dashboard.tsx)

- `OpportunityScore` — composite score with overallScore, confidence, technicalScore, institutionalScore, fundamentalScore, riskScore, regimeScore, category, reasons[], warnings[]
- `ScoredStockCandidate` extends `RankedStockCandidate` with `opportunityScore: OpportunityScore`
- `ScoredWatchStockCandidate` extends `WatchStockCandidate` with `opportunityScore: OpportunityScore`
- `OpportunityChange` — { symbol, from, to, direction: "upgraded"|"downgraded"|"new"|"moved" }
- `OpportunityRanking` — full ranking result with generatedAt, regime, weights, topGrowth[], topIncome[], watchlist[], approaching[], changes[]
- `OpportunityTodayResponse` — { ranking: OpportunityRanking | null, available: boolean, message: string | null }

## Pure helpers module

`client/src/lib/opportunity-ranking-helpers.ts` — testable pure functions:
- `getScoreColorClass(score)` — text-emerald/sky/amber/rose-400 by threshold (80/60/40)
- `getScoreBarClass(score)` — bg variant, same thresholds
- `formatRelativeTime(dateStr, now?)` — "4 minutes ago" / "1 hour ago" style
- `getCategoryLabel(category)` — "Top Growth" → "Growth" etc.
- `getCategoryBadgeClass(category)` — colour class for badge
- `getChangeDisplay(direction)` — { symbol, label } for New/Upgraded/Downgraded/Moved
- `getChangeBadgeClass(direction)` — colour class for change badge
- `getConfidenceBadgeClass(confidence)` — colour class for high/medium/low

**Why:** extracting to a module enables 70 pure-function tests without RTL.

## Import alias to avoid conflict

The dashboard already had a local `formatRelativeTime` (day-based: "Today"/"Yesterday") at ~line 469.
The ranking helper uses a minute-based version. Import aliased as:
```typescript
import { formatRelativeTime as formatRankingAge } from "@/lib/opportunity-ranking-helpers";
```

## Components changed

- `StockOpportunityCard` — now requires `ScoredStockCandidate` (not plain `RankedStockCandidate`); shows overall score bar, 4 score pills (Tech/Inst/Fund/Risk), reasons[], warnings[]; removed `marketRegime` prop
- `CandidateSubsection` — candidates prop updated to `ScoredStockCandidate[]`; removed `marketRegime` prop
- `OpportunityEngineSection` — removed `changesData` prop; added `isError` prop; reads `ranking.*` instead of `snapshot.*`
- `RankingChangesPanel` — new component showing `ranking.changes[]` as chips
- `OpportunityTimeline` — switched from `snapshot?: OpportunitySnapshot | null` to `ranking?: OpportunityRanking | null`
- DashboardPage `oppsQuery` — key `["/api/opportunities/today"]`, type `OpportunityTodayResponse`
- DashboardPage `OpportunityTimeline` call — `ranking={oppsQuery.data?.ranking}` (was snapshot)

## What stays the same

- `/api/opportunities/latest` endpoint still exists (not removed, just not called from dashboard)
- `changesQuery` for `/api/opportunities/changes` stays in DashboardPage for `OpportunityLifecycleSection`
- `OpportunityLifecycleSection` is unchanged — still uses the changes endpoint
- `/api/opportunities/today` is the ONLY new call for the opportunity cards section
