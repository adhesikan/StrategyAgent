---
name: Market Research Hub
description: Sprint 2.3.5 — unified /research page aggregating all major research surfaces; 6 modules, search, recently viewed, no new computation.
---

## Route

`/research` → `MarketResearchHub` (new hub page)
`/research/library` → `ResearchLibraryPage` (saved records, moved from `/research`)
`/research/:id` → `ResearchDetailPage` (unchanged)

Nav item: "Research" → `/research` (was "My Research")

## Architecture

**Pure aggregation — no new computation.** Hub consumes 4 parallel precomputed endpoints:
1. `GET /api/opportunities/today` → Opportunities module
2. `GET /api/intelligence/briefing` → Market Intelligence + Institutional Activity modules
3. `GET /api/opportunities/changes/explained` → Changes module
4. `GET /api/institutional/funds?sort=reportedPortfolioValue&pageSize=8` → Funds module

All 4 fire in parallel on page mount via `useQuery`.

## Modules

| Module | API | CTA destination |
|---|---|---|
| Opportunities | /api/opportunities/today | /opportunities/today |
| Market Intelligence | /api/intelligence/briefing | /intelligence |
| Changes | /api/opportunities/changes/explained | /opportunities/today |
| Institutional Activity | briefing.institutionalHighlights | /institutional/funds |
| Funds | /api/institutional/funds | /institutional/funds |
| Events | no data source | graceful unavailable state |

## Search

Client-side across already-loaded data: stocks (from ranking), themes (from briefing.leadingThemes), sectors (from briefing.leadingSectors), funds (from funds list).

`buildSearchIndex()` → `runSearch()` (case-insensitive substring) → `groupSearchResults()` (Stocks/Themes/Sectors/Funds groups).
Max 20 results total; grouped by type. No server-side search endpoint. No AI.

## Recently Viewed

localStorage key: `vcp_research_recent`, max 5 items.
Shape: `Array<{ type: "stock"|"theme"|"sector"|"fund", label, href, viewedAt }>`.
Prepends on click, deduplicates by href, caps at 5.
Pattern: read on mount via useState initializer, write on each addItem call.
No server-side persistence — localStorage only per spec.

## Institutional Disclosure

Always shows "SEC Form 13F · Delayed Data" badge on both Institutional Activity and Funds modules.
Footer note: "Reported institutional holdings reflect SEC Form 13F filings. Data is delayed by 45+ days."
NEVER "Smart Money" anywhere in this file.

## Events Module

Graceful unavailable state — no event data provider wired. Shows placeholder message.
No fake data, no mocked events. CTA removed since no destination page exists.

## Navigation Model

Sub-nav bar on hub (ghost buttons):
Opportunities → /opportunities/today
Intelligence → /intelligence
Institutional → /institutional/funds
Funds → /institutional/funds
Saved Research → /research/library

## Key Constraints

- `get[Latest]Ranking` lives in `opportunity-ranking-engine.ts`, NOT `opportunity-engine.ts`
- `new Set(...)` spread → must use `Array.from(new Set(...))` (TS2802 downlevelIteration)
- Test env has no `localStorage` → test pure functions only; no renderHook (no @testing-library/react)
- Freshness shows per-module using individual `generatedAt` fields, not a single global timestamp

## Tests

53 pure-function tests in `client/src/__tests__/market-research-hub.test.tsx`:
- formatFreshness (5 edge cases), formatPortfolioValue (4), healthColor (4), directionIcon (2)
- buildSearchIndex (6 cases including cross-link hrefs)
- runSearch (8 including empty query, case-insensitive, cap at 20)
- groupSearchResults (3)
- recently viewed pure logic (8 cases using addRecentItem + parseRecentItems helpers)
- compliance — no forbidden language (1)
- cross-link contract (4 — stock/theme/sector/fund hrefs)
- no LLM / determinism (2)
- partial API state (3)
- freshness labels (2)
