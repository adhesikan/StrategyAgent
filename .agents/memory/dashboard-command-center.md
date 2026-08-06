---
name: Dashboard command-center redesign
description: Sprint 2.0.1 UX constraints — what was changed, what gaps remain, and the prop contract for lifecycle badge wiring.
---

## What was changed
- `MarketCommandBar` — new component above `MorningHeaderSection`; reads `snapshot.marketRegime`, `snapshot.marketTone`, `snapshot.asOf`, `data.portfolio.brokerConnected`; derives session label via `getMarketSessionInfo()`; no new API calls.
- `OpportunityTimeline` — new component below `OpportunityLifecycleSection`; renders a two-row scan rail from `oppsQuery.data?.snapshot` + `changesQuery.data`; vanishes when snapshot is null.
- `StockOpportunityCard` — added `lifecycleState?: LifecycleState` and `marketRegime?: string | null` props; renders `<LifecycleBadge>` inline and a regime-alignment note.
- `OpportunityEngineSection` — added `changesData?: SnapshotComparison` prop; builds `lifecycleBySymbol` Map from `changesData.all` and passes per-symbol state down to each card.
- Quick Actions — 6 equal tiles; IDs: growth, income, analyze, portfolio, research, markets.

## Known gap
`LifecycleSubsection` (Today's Changes categories) is a plain `<div>` — no collapse/expand. Sprint spec required collapsible categories. Tracked as Task #74.

## Invariants to preserve on future edits
- Three queries (`dashboardQuery`, `oppsQuery`, `changesQuery`) must not be changed — their `queryKey` shapes are referenced by tests and cache logic.
- The `/api/analysis/cached` batch fetch inside `OpportunityEngineSection` must stay — it powers the "Open Analysis" vs "Analyze" CTA text.
- All `data-testid` attributes must be preserved.
- No new API calls from the dashboard client — all data must come from the existing three queries.

**Why:** The sprint was purely UI — zero backend changes. Future edits that break the query contracts or add API calls violate the sprint's scope boundary and could affect passing tests.

**How to apply:** Before any dashboard.tsx edit, confirm the three queries are unchanged and no new `useQuery` calls are added.
