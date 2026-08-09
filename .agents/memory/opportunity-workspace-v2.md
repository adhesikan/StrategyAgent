---
name: Opportunity Workspace v2
description: Sprint 2.6.3 — aggregated server endpoint, 15-section client rewrite, canonical /opportunities/:symbol route.
---

## Key Rules

**Client API calls:** Exactly 2. `/api/opportunities/today` + `/api/opportunities/workspace/:symbol`. Never add a 3rd call.

**Score ownership:** Workspace never recalculates any score. researchScore/technicalScore/fundamentalScore/institutionalScore all come from CanonicalOpportunity via getCanonicalOpportunity(symbol) which reads the in-memory ranking.

**WatchStatus values:** `"active" | "paused" | "archived"` (lowercase). Not uppercase.

**Theme matching:** CanonicalOpportunity.themes is `string[]` of theme names (not IDs). Filter getLatestThemeSnapshots() by `themeSummary.themeName.toLowerCase() === theme.toLowerCase()`.

**Portfolio context query:** Raw SQL on portfolio_positions JOIN portfolios WHERE user_id = $userId AND symbol = $symbol.

**Partial resilience:** All subsystem calls use Promise.allSettled. Each section degrades independently; no section failure crashes the page.

**Compliance:** No "buy/sell/Smart Money/target price/expected return/guaranteed/top pick/strong buy". 13F disclosure always visible in institutional tab. Trade handoff uses "future workflow" language only.

**Why:**
The aggregated endpoint must return sectorContext, themeContexts, collections, monitoring, reports, portfolioContext, relatedOpportunities, freshness, limitations in addition to the original history+institutional+changeExplanation. All these are new as of Sprint 2.6.3.
