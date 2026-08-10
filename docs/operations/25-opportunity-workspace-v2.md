# 25 — Opportunity Workspace v2

Sprint: 2.6.3  
Status: Production  
Route: `GET /opportunities/:symbol` (client) / `GET /api/opportunities/workspace/:symbol` (server)

---

## Overview

The Opportunity Workspace v2 is the canonical single-security research destination in VCP Trader AI.
It aggregates all available research intelligence for one symbol into one page without duplicating
business logic.

**Research questions answered:**

- Why is this security currently relevant?
- What evidence supports it?
- What changed?
- Where is evidence strengthening or weakening?
- What are the risks?
- What would invalidate the thesis?
- How does the sector/theme context look?
- What institutional evidence exists?
- What related research exists?
- How fresh is the data?
- What should I research next?

**What the workspace does NOT answer:**

- What should I buy/sell?
- What trade should I place?

Trade construction belongs to the future Trade Planning phase (Sprint 2.7.x).

---

## Architecture

### Client Route

```
/opportunities/:symbol   ← canonical, do not fragment
```

All research surfaces (Dashboard, Command Center, Collections, Research Monitor,
Portfolio Intelligence, Portfolio Analytics, AI Workspace) link here.

### API Calls (exactly 2 from client)

| # | Endpoint | Source | Notes |
|---|---------|--------|-------|
| 1 | `GET /api/opportunities/today` | In-memory ranking | Zero DB cost |
| 2 | `GET /api/opportunities/workspace/:symbol` | Aggregated endpoint | All sub-sections |

### Server-side Aggregation

The workspace endpoint assembles:

| Field | Source | DB? |
|-------|--------|-----|
| `opportunity` | `getCanonicalOpportunity(symbol)` — reads in-memory ranking | No |
| `history` | `getSymbolHistory(symbol, 100)` | Yes |
| `institutional` | `getInstitutionalSignal(symbol)` | In-memory |
| `changeExplanation` | `explainSymbolChange(...)` | No (pure) |
| `sectorContext` | `getLatestSectorDetail(sector)` | Yes (1 row) |
| `themeContexts` | `getLatestThemeSnapshots()` filtered by symbol's themes | Yes |
| `collections` | `getCollectionsForSymbol(userId, symbol)` | Yes |
| `monitoring` | `listWatches(userId)` filtered for symbol | Yes |
| `reports` | `listReports(userId, {keyword: symbol})` | Yes |
| `portfolioContext` | Direct DB query on portfolio_positions JOIN portfolios | Yes (1 row) |
| `relatedOpportunities` | Pure derivation from in-memory ranking | No |
| `freshness` | Assembled from all above timestamps | No |
| `limitations` | Derived from which subsystems returned data | No |

All subsystem calls run in parallel via `Promise.allSettled`. Each degrades independently.

### Performance Contract

| Scenario | Target |
|----------|--------|
| Cold load (no caches) | < 400 ms |
| Warm load (ranking + institutional in-memory) | < 100 ms |
| DB queries | sector: 1 row; themes: all per-theme latest; others: small sets |

---

## Page Sections

### Header (sticky)

- Symbol, Company Name, Exchange (if available)
- Sector badge, Industry badge
- Primary theme badges (up to 2)
- Opportunity Type badge
- Risk Level badge
- Market Regime badge
- Research Score (large, colored, with ResearchDefinitionTooltip)
- Last Updated timestamp
- Action buttons: Open AI Research | Collections | Monitor | Reports

No trade or order buttons in the header.

### Portfolio Context Card (optional)

Shown only when the authenticated user owns this symbol in a portfolio.
Shows: Portfolio Name, Portfolio Weight.
No raw account balances, account IDs, or broker tokens.

### Research Snapshot

Compact summary card showing:
- Classification (opportunityTypeLabel)
- Research Score
- Technical / Fundamental / Institutional sub-scores (with bars)
- Market Context (regime)
- Research Trend (from changeExplanation direction)
- Time Horizon
- Evidence Confidence
- Data Freshness

### Why This Qualified

Deterministic evidence panel. Groups:
- Primary Reasons (primaryEvidence[])
- Supporting Context (secondaryEvidence[])
- What Would Invalidate This Thesis (invalidatesThesis[])

Evidence is never AI-generated. All items come from the canonical opportunity snapshot.
Each group is collapsible. Each item shows label, value, and detail where available.

### What Changed

If changeExplanation is null or direction=unchanged: shows "No material research change since the previous snapshot."
If changed: shows summary, score delta, primary drivers, warnings, importance, and confidence.
No manufactured change.

### Evidence Matrix

7-row compact table:

| Dimension | Score / State | Direction | Confidence | Freshness |
|-----------|--------------|-----------|------------|-----------|
| Technical | ... | ... | ... | ... |
| Fundamental | ... | ... | ... | ... |
| Institutional | ... | ... | ... | ... |
| Sector | ... | ... | ... | ... |
| Theme | avg of themes | first theme label | ... | ... |
| Market Regime | — | regime string | ... | ... |
| Risk | — | riskLevel | ... | ... |

Includes textual equivalents for accessibility (aria-label on table).

### Tabbed Research Sections

Six tabs: Technical | Fundamental | Institutional | Sector & Theme | Risk | History

**Technical:**
- Opportunity Type, Technical Score
- Risk Level, Time Horizon
- Technical evidence items filtered from primaryEvidence/secondaryEvidence

**Fundamental:**
- Fundamental Score
- Partial data notice when fundamentalScore < 20
- Fundamental evidence items filtered from primaryEvidence/secondaryEvidence
- "Unavailable data is not treated as zero" notice

**Institutional:**
- 13F delay disclosure banner (always visible, at top)
- Institutional Score, Signal Label
- Manager counts (New / Increased / Reduced / Exited)
- Concentration & Trend
- Data Confidence, Latest Quarter
- No "Smart Money" language

**Sector & Theme:**
- Sector card: name, score, label, freshness, link to sector research page
- Theme cards: one per theme in opportunity.themes[], score, label, link to theme page
- Market Regime context: deterministic explanatory text

**Risk:**
- Risk Level badge
- Risk Factors with severity and detail
- What Would Invalidate This Thesis (from invalidatesThesis[])
- No "Too Risky / Safe / Suitable / Unsuitable" language

**History:**
- Change Timeline: chronological list of last 10 snapshots with date, score, delta, status
- Full Score History table: all history rows (up to 100)

### Related Research

Up to 6 related opportunities from in-memory ranking, scored by sector/theme/score proximity.
Labeled "Related Research" not "Similar Stocks to Buy."
No new recommendation algorithm.

### Collections Integration

Shows which of the user's collections contain this symbol.
Allows navigation to collection page.
Uses existing `getCollectionsForSymbol` service.

### Monitoring Integration

Shows current monitoring state: Active / not monitored.
Last change timestamp and summary if available.
Links to Research Monitor page.
No alerts — monitoring information only.

### Reports Integration

Shows up to 5 recent reports (filtered by symbol keyword).
Links to individual report pages.
No new DB indexing.

### AI Research

6 contextual action buttons:
- Explain This Candidate
- Challenge This Thesis
- Explain What Changed
- Explain Risk Factors
- Compare With Another Candidate
- Explain Institutional Evidence

All open `/research-workspace?symbol={symbol}&mode={mode}`.
No new AI chat component created.

### Future Trade Planning Handoff

Shows possible future research paths (Equity Research, Options Research, etc.)
depending on opportunity type. Does not construct trades.
Label: "Trade Planning capabilities are part of a future workflow."
No strikes, expirations, max gain/loss, or order construction.

### Coverage & Limitations

When any subsystem is unavailable, a limitations card is shown at the bottom with clear messages:
- "This symbol is not present in the latest Opportunity Intelligence snapshot."
- "Institutional evidence is unavailable for this symbol."
- "Sector intelligence data is not yet available."
- "Theme intelligence data is not yet available."
- "Research history will appear after multiple ranking cycles."

---

## Evidence Ownership

All scores are owned by their source services:

| Score | Owned By |
|-------|----------|
| researchScore | Opportunity Intelligence Engine |
| technicalScore | Opportunity Intelligence Engine |
| fundamentalScore | Opportunity Intelligence Engine |
| institutionalScore | Opportunity Intelligence Engine / Institutional Intelligence |
| sectorScore | Sector Intelligence Engine |
| themeScore | Theme Intelligence Engine |
| changeExplanation | Opportunity Change Intelligence |

The workspace **never recalculates** any score.

---

## Cache

The workspace endpoint does not add its own cache layer. Each sub-service has its own cache:
- Ranking: in-memory, refreshes every 240 minutes (OPPORTUNITY_SCAN_INTERVAL_MINUTES)
- Institutional signal: in-memory computation on precomputed aggregates
- Sector/theme snapshots: DB, regenerated by intelligence orchestrator
- Collections/monitoring/reports: real-time DB queries (user-personalized, cannot be shared)

Cache key for portfolio context: `userId::symbol` (implicit in the DB query)

**Cache isolation rule:** User-personalized context (collections, monitoring, reports, portfolio)
is never shared across users.

---

## Security

- Route is authenticated (`isAuthenticated` middleware)
- Portfolio context: strict userId ownership enforced via `WHERE p.user_id = $userId`
- Collection context: strict userId ownership via `getCollectionsForSymbol(userId, symbol)`
- Monitoring context: strict userId ownership via `listWatches(userId)`
- Reports: scoped to `userId`
- Symbol validated against `/^[A-Z]{1,10}$/` before any DB access
- No stack traces in response body
- No raw broker account IDs, balances, or tokens in response
- No user PII in structured logs

---

## Structured Logging

Safe log events:

```json
{ "event": "opportunity_workspace_completed", "durationMs": 145, "subsystemsAvailable": 5, "evidenceCounts": { "primary": 4, "secondary": 2, "riskFactors": 3, "invalidatesThesis": 2 }, "historyCount": 12, "limitations": 0 }
{ "event": "opportunity_workspace_partial", "durationMs": 230, "subsystemsAvailable": 3, "limitations": 2 }
{ "event": "opportunity_workspace_failed", "durationMs": 400, "error": "..." }
```

Fields never logged: symbol (in structured log), userId, portfolio values, raw AI prompts.

---

## Platform Health

The workspace exposes health via `getWorkspaceV2Health()`:

```ts
{
  workspaceRequests: number;
  workspaceSuccesses: number;
  workspacePartials: number;
  workspaceFailures: number;
  averageWorkspaceLatencyMs: number | null;
  lastSuccessfulWorkspaceAt: string | null;
}
```

This is imported and added to the platform health endpoint.
The health card exposes no symbols or user research history.

---

## Compliance

### Standard Disclaimer

> "Opportunity research summarizes deterministic and AI-assisted research evidence for informational
> and research purposes. It does not constitute investment advice or a recommendation to buy, sell,
> hold, or enter any particular security or strategy."

"AI-assisted" qualifier applies only where AI summary sections exist.

### Forbidden Language

The workspace never uses:
- Strong Buy / Top Pick / Buy Now / Sell
- Target Price / Expected Return
- Probability of Winning
- Safe Trade / Guaranteed
- Smart Money
- Too Risky / Suitable / Unsuitable

### Opportunity Type Labels (compliant)

- Growth Candidate
- Equity Research Candidate
- Options Research Candidate
- Income Strategy Candidate
- Covered Call Candidate
- Cash-Secured Put Candidate
- Defined-Risk Strategy Candidate

---

## Partial-Data Resilience

Each section degrades independently via `Promise.allSettled`. If institutional data
is unavailable, the institutional tab shows the 13F disclosure and an empty state;
all other tabs still render.

Partial responses are counted in `workspacePartials` health metric.

---

## Accessibility

- ARIA tabs on the main tab group (`role="tablist"`, `aria-label`)
- ARIA grid/table labels on Evidence Matrix and history tables
- ResearchDefinitionTooltip on Research Score in header
- Collapsible evidence groups with `aria-expanded`
- Timeline list uses `<ol>` with `aria-label`
- Score bars are accompanied by text labels
- No hover-only critical information
- Mobile: 375px breakpoint; tabs scroll; evidence cards stack; no clipped tables

---

## Runbooks

### Incident: Static opportunity route interpreted as ticker symbol

**Symptom:** Navigating to `/opportunities/today` or `/opportunities/changes` shows
"TODAY not in current ranking" or "CHANGES not in current ranking" instead of the expected page.

**Root cause:** Wouter's dynamic `<Route path="/opportunities/:symbol">` catches any path segment
under `/opportunities/*` when no explicit static route is registered first. The strings "today"
and "changes" were being treated as ticker symbols.

**Fix applied (Sprint 2.6.3 blocking defect fix):**

1. Two new static pages registered in `client/src/App.tsx` BEFORE the dynamic route:
   - `/opportunities/today` → `OpportunityTodayPage` (`client/src/pages/opportunity-today.tsx`)
   - `/opportunities/changes` → `OpportunityChangesPage` (`client/src/pages/opportunity-changes.tsx`)

2. Reserved segment denylist in `OpportunityWorkspacePage` as defense-in-depth:
   ```ts
   const RESERVED_OPPORTUNITY_SEGMENTS = new Set([
     "TODAY", "CHANGES", "GROWTH", "INCOME",
     "WATCH", "WATCHLIST", "HISTORY", "MONITOR", "RESEARCH",
   ]);
   ```
   Matches are redirected to their canonical routes before any API calls fire.

3. Bug fix in `market-research-hub.tsx`: "See What Changed" button was linked to
   `/opportunities/today` instead of `/opportunities/changes`. Now correct.

**Canonical opportunity URL table:**

| URL | Destination | Component |
|-----|-------------|-----------|
| `/opportunities/today` | All ranked opportunities | `OpportunityTodayPage` |
| `/opportunities/changes` | Change intelligence feed | `OpportunityChangesPage` |
| `/opportunities/:symbol` | Single-security workspace | `OpportunityWorkspacePage` |

**Regression tests:** `client/src/pages/__tests__/opportunity-routing.test.ts` — 45 assertions
covering: reserved segment set, canonical URLs, Research Hub link correctness, unranked ticker
behavior, route ordering, symbol link construction, data contracts, compliance, portfolio links.

**UAT sequence:**
1. Open `/research` → click "View All Opportunities" → must land on `/opportunities/today`
2. Return to `/research` → click "See What Changed" → must land on `/opportunities/changes`
3. Click any ranked symbol → must land on `/opportunities/:symbol` workspace
4. Direct open `/opportunities/NVDA` → Workspace v2 for NVDA
5. Direct open `/opportunities/today` → All Ranked Opportunities page
6. Direct open `/opportunities/changes` → Change Intelligence page
7. Valid unranked ticker (e.g. `/opportunities/XYZ`) → not-ranked workspace state, not a redirect

---

### "Workspace shows limitations for institutional data"

1. Check `getInstitutionalSignal(symbol)` is returning non-null.
2. Check that institutional aggregation has run: `GET /api/admin/health/platform`.
3. Institutional signal is computed from precomputed aggregates — run ingestion if never populated.

### "Sector/theme context unavailable"

1. Check `sector_intelligence_snapshots` and `theme_intelligence_snapshots` tables have rows.
2. Intelligence orchestrator must have completed at least one cycle.
3. Trigger via `/api/admin/intelligence/trigger` if available.

### "Portfolio context not showing for owned symbol"

1. Confirm user has a portfolio with this symbol in `portfolio_positions`.
2. Check that `portfolio_positions.symbol` is stored uppercase.
3. The DB query joins `portfolios p ON p.id = pp.portfolio_id WHERE p.user_id = $userId`.

### "Related opportunities is empty"

1. Related opportunities come from in-memory ranking. If ranking is null, related will be empty.
2. Wait for the opportunity engine to complete its first scan.

### "Performance is slow (> 400ms)"

1. Check DB query plans for `getLatestThemeSnapshots()` — may need DISTINCT ON index.
2. Check if portfolio context query is hitting a full table scan.
3. All sub-calls run in parallel so total latency = slowest parallel call.

---

## Known Gaps

| Gap | Status |
|-----|--------|
| Exchange field not in CanonicalOpportunity | Deferred — no exchange data source connected |
| Theme filtering uses name-match (not ID) | Works; themes in CanonicalOpportunity are strings |
| Reports filtered by keyword only (not symbol field) | report service symbol filter not implemented; keyword works as proxy |
| monitoring.recentActivityCount always 0 | Requires separate DB call; deferred to avoid N+1 |

---

## Extension Points

The workspace is designed to support future additions:

| Future Feature | Extension Point |
|----------------|----------------|
| Trade Planning | Add tab to main Tabs component; populate from future trade-planning-service |
| Portfolio Research Workspace | Extend portfolioContext with position intelligence |
| RIA Edition | Add firm collection section |
| Institutional Edition | Add fund-level holder table |
| Earnings Calendar | Add to Technical or a new Events tab |
| Interactive Price Chart | Add to Technical tab when market data integration is connected |

---

## UAT Checklist

See `docs/operations/16-api-and-uat-reference.md` Sprint 2.6.3 section for 27-step UAT checklist.

---

## Files

| File | Role |
|------|------|
| `client/src/pages/opportunity-workspace.tsx` | Canonical client page (full rewrite) + reserved-segment guard |
| `client/src/pages/opportunity-today.tsx` | Static `/opportunities/today` — all ranked opportunities |
| `client/src/pages/opportunity-changes.tsx` | Static `/opportunities/changes` — change intelligence feed |
| `client/src/App.tsx` | Route registration (static routes before dynamic `:symbol`) |
| `server/routes/opportunity-workspace.ts` | Aggregated server endpoint (extended) |
| `server/routes/__tests__/opportunity-workspace-v2.test.ts` | 127 pure server assertions |
| `client/src/pages/__tests__/opportunity-routing.test.ts` | 45 pure routing regression tests |
| `docs/operations/25-opportunity-workspace-v2.md` | This document |
