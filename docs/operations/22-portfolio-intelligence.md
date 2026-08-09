# 22 — Portfolio Intelligence

## Overview

**Sprint:** 2.6.1 — Portfolio Intelligence
**Phase:** Phase 3 — Portfolio Intelligence
**Prerequisite:** Sprint 2.6.0 Portfolio History & Change Intelligence

Portfolio Intelligence is a **research-first personalization layer** over the existing VCP Trader AI Research Platform. It answers:

> "What does the existing VCP Trader AI research mean for MY portfolio?"

It does NOT:
- Create buy/sell/trim/add recommendations
- Introduce a single opaque composite score, grade, or rating for the portfolio
- Determine suitability for any individual
- Rebalance or recommend rebalancing
- Create an independent scoring universe

All research scores are sourced exclusively from Opportunity Intelligence.

---

## Architecture

### Service Ownership

| Component | File | Responsibility |
|-----------|------|----------------|
| Types | `shared/portfolio-intelligence-types.ts` | Canonical types for all portfolio intelligence data |
| Computation | `server/services/portfolio-intelligence-service.ts` | Pure computation engine |
| API Routes | `server/routes/portfolio-intelligence.ts` | HTTP endpoints |
| Client Tab | `client/src/pages/portfolio.tsx` | Intelligence tab in Portfolio page |
| Health | `server/routes/platform-health.ts` | `checkPortfolioIntelligence()` + health card |

### Data Flow

```
portfolios + portfolio_positions (Drizzle)
     ↓
Opportunity Intelligence snapshot (in-memory, getOpportunityIntelligence())
     ↓
Theme Registry (getAllThemes(), pure config)
     ↓
Reference Prices (getReferenceSnapshotsBulk(), bulk)
     ↓
Institutional Signals (institutionalSymbolSignals, Drizzle inArray, bulk)
     ↓
Portfolio History Changes (getPortfolioChanges(), sprint 2.6.0)
     ↓
computePortfolioIntelligence() → PortfolioIntelligenceResult
```

### Query Budget

All bulk loads are parallelized via `Promise.allSettled`:
- 1 portfolio row
- 1 positions query
- 1 OppIntel in-memory read
- 1 reference prices bulk call
- 1 institutional signals DB query (`inArray`)
- 1 portfolio history call
- 0 N+1 queries

Performance profile (measured):
| Portfolio Size | Approx. Latency |
|----------------|-----------------|
| ~10 holdings   | ~150ms          |
| ~50 holdings   | ~200ms          |
| ~200 holdings  | ~400ms          |

---

## Canonical Result — PortfolioIntelligenceResult

```typescript
PortfolioIntelligenceResult {
  portfolioId, portfolioName, generatedAt, snapshotId
  marketValue, costBasis, positionCount, marketRegime

  coverage:               PortfolioResearchCoverage
  concentration:          ConcentrationMetrics
  sectorExposure[]:       SectorExposureItem[]        // sorted largest first
  themeExposure[]:        ThemeExposureItem[]          // sorted largest first; may overlap
  opportunityOverlap[]:   OpportunityOverlapItem[]

  strengthenedHoldings[], weakenedHoldings[]
  newlyQualifiedHoldings[], noLongerQualifiedHoldings[]

  qualifiedHoldings[]:    HoldingResearchSummary[]     // in OppIntel
  uncoveredHoldings[]:    HoldingResearchSummary[]     // not in OppIntel

  institutionalSummary:   InstitutionalContextSummary

  riskObservations[]:     RiskObservation[]            // descriptive, never advisory
  researchObservations[]: ResearchObservation[]
  furtherResearchAreas[]: FurtherResearchArea[]

  disclaimer, limitations[], freshness
}
```

No opaque composite score. Transparent dimensions only.

---

## Research Coverage

Coverage tracks how much of the portfolio has each data dimension available.

| Field | Definition |
|-------|-----------|
| `positionsWithMarketData` | Reference price available |
| `positionsWithOpportunityIntelligence` | Symbol in current OppIntel snapshot |
| `positionsWithFundamentalEvidence` | `fundamentalScore > 0` (not null, not zero) |
| `positionsWithInstitutionalEvidence` | Institutional signal record exists |
| `positionsWithSector` | Sector field not null |
| `positionsWithTheme` | At least one theme membership |
| `overallCoveragePercent` | Weighted composite: OppIntel 40%, market data 25%, sector 15%, theme 10%, institutional 10% |

**Rule:** Missing data is stored and reported as `null`. It is never converted to 0.

---

## Concentration Analysis

### Thresholds (also in Research Glossary)

| Metric | Low | Moderate | High |
|--------|-----|----------|------|
| Largest position | < 10% | 10–20% | > 20% |
| Top 3 positions | < 25% | 25–50% | > 50% |
| Top 5 positions | < 35% | 35–60% | > 60% |
| Largest sector | < 30% | 30–50% | > 50% |
| Largest theme | < 20% | 20–40% | > 40% |

Labels: **Low**, **Moderate**, **High** — descriptive only.

Do NOT use: "too high", "bad", "good", "overweight", "underweight".

---

## Sector Exposure

- Sources sector classification from Opportunity Intelligence (`CanonicalOpportunity.sector`)
- Falls back to `market_data_symbols.sector` via OppIntel's company metadata enrichment
- Does NOT create new sector classifications
- Sorted largest exposure first
- Attaches `changeSincePreviousSnapshot` (percentage-point delta) from Portfolio History when available

---

## Theme Exposure

- Sources theme membership from curated Theme Registry (`getAllThemes()`)
- One holding may belong to multiple themes
- Theme percentages can exceed 100% total — this is by design (overlapping)
- **Disclosure is required** in any UI or report: "Theme percentages may exceed 100% total due to overlap."

---

## Opportunity Overlap

Maps each holding to its relationship with the current Opportunity Intelligence snapshot.

| Category | Condition |
|----------|-----------|
| `CURRENTLY_QUALIFIED` | `_sourceCategory` is `topGrowth` or `topIncome` |
| `APPROACHING_QUALIFICATION` | `_sourceCategory` is `approaching` or `watchlist` |
| `NO_LONGER_QUALIFIED` | Previously classified from history; now absent from snapshot |
| `NOT_CURRENTLY_RANKED` | Not in current OppIntel snapshot |

**Absence is not a negative quality signal.** Use language: "Not currently represented in the latest Opportunity Intelligence snapshot."

---

## Research Strengthening / Weakening

Sourced from Portfolio History (`getPortfolioChanges()`) — Sprint 2.6.0.

| Change Type | Definition |
|-------------|-----------|
| `RESEARCH_STRENGTHENED` | Research score improved by ≥ 2 points between snapshots |
| `RESEARCH_WEAKENED` | Research score declined by ≥ 2 points between snapshots |
| `NEWLY_QUALIFIED` | Score moved from null to non-null between snapshots |
| `NO_LONGER_QUALIFIED` | Score moved from non-null to null between snapshots |

Requires at least 2 portfolio snapshots. Returns empty arrays when unavailable.

---

## Institutional Context

- Sourced from `institutional_symbol_signals` (precomputed from SEC 13F ingestion)
- **13F Disclosure (required everywhere institutional data appears):**

> Institutional data is sourced from SEC Form 13F filings. These filings are required from institutional investment managers with assets under management of $100M or more. Filing dates are typically 45 days after quarter-end and reflect holdings as of the prior quarter-end. Data does not reflect current institutional positions.

- When unavailable: display "Institutional evidence unavailable for this holding." Do NOT treat unavailable as zero institutional activity.

---

## Market Context

- `marketRegime` sourced from `OpportunityIntelligenceResult.marketRegime` — never recomputed
- Sector and theme intelligence context comes from existing sector/theme services
- Do NOT reinterpret portfolio suitability based on regime

---

## Privacy & Security

### Requirements

- All endpoints require `req.user?.id` authentication
- Ownership verified at portfolio level: `userId = req.user.id AND portfolioId = :id`
- No private financial values (market values, cost basis, symbols) in structured logs
- No holdings leaked in admin health endpoint
- Cache key format: `${userId}:${portfolioId}` — no cross-user cache collisions

### Structured Logging — Safe Fields

| Event | Safe Fields |
|-------|-------------|
| `portfolio_intelligence_started` | portfolioId |
| `portfolio_intelligence_completed` | durationMs, positionCount, coveragePercent, subsystemsAvailable, partial |
| `portfolio_intelligence_partial` | durationMs, limitations count |
| `portfolio_intelligence_failed` | durationMs, error (stringified) |

**Never log:** symbols, market values, cost basis, user PII.

---

## Caching

- **TTL:** 15 minutes in-memory
- **Key:** `${userId}:${portfolioId}`
- **Invalidated on:**
  - Position add/edit/delete (via `invalidatePortfolioIntelligenceCache`)
  - Snapshot capture (via `triggerSnapshotAsync`)
  - Broker sync completion
  - Import confirmation
  - Opportunity Intelligence ranking refresh (future hook)

---

## API

### GET `/api/portfolio/:id/intelligence`

Returns `PortfolioIntelligenceResponse`:
```json
{
  "available": true,
  "portfolioId": "...",
  "generatedAt": "...",
  "intelligence": { ... }
}
```

Query params:
- `?snapshotId=` — optional; bypasses cache and pins to a specific snapshot

If no positions: `{ available: false, message: "Portfolio has no positions." }`
If not found: `{ available: false, message: "Portfolio not found or access denied." }`

### GET `/api/portfolio/:id/intelligence/:symbol`

Returns `PortfolioSymbolIntelligence` for one holding:
- `portfolioWeight`, `marketValue`, `sector`, `industry`, `themes`
- `overlapCategory`, `researchChange`, `hasInstitutionalEvidence`
- `institutionalDisclosure`, `furtherResearch`, `disclaimer`

Note: `canonicalOpportunity` is `null` — caller should fetch from `/api/opportunities/workspace/:symbol` to avoid duplication.

---

## UI — Intelligence Tab

The Intelligence tab is the third tab on the Portfolio page (`/portfolio`).

### Sections

1. **Portfolio Research Summary** — header stats (coverage %, qualified count, sector dominant, value)
2. **Research Coverage** — breakdown of coverage dimensions
3. **Opportunity Overlap** — holdings classified by OppIntel status with links to Opportunity Workspace
4. **Strengthening / Weakening** — research evidence changes (requires 2+ snapshots)
5. **Sector Exposure** — market value and % by sector with change deltas
6. **Theme Exposure** — market value and % by theme (with overlap disclosure)
7. **Concentration** — labeled metrics (Low/Moderate/High) per threshold table above
8. **Institutional Context** — coverage summary with mandatory 13F disclosure
9. **Risk Observations** — descriptive, never advisory observations
10. **Compliance Disclaimer** — rendered once at bottom of tab

### Research-First UX

Every section should link back to the Research Platform:
- "Open [SYMBOL] Research" → `/opportunities/:symbol`
- "View [SECTOR] Sector" → `/research/sectors`
- "View [THEME] Theme" → `/research/themes`
- "Explore in Research Workspace" → `/research/workspace`
- "View Recent Changes" → History tab

---

## Platform Health

**Card key:** `portfolioIntelligence`

| Status | Condition |
|--------|-----------|
| `HEALTHY` | portfoliosAnalyzed > 0, failedAnalyses = 0 |
| `DEGRADED` | failedAnalyses > 0 |
| `UNKNOWN` | portfoliosAnalyzed = 0 (no analyses yet this session) |
| `DISABLED` | Not currently used |

### Admin-Safe Metrics

- `portfoliosAnalyzed` — total count this session
- `lastAnalysisAt` — ISO timestamp
- `averageAnalysisDurationMs`
- `partialAnalyses` — analyses with limitations (subsystem unavailable)
- `failedAnalyses` — error count
- `averageCoveragePercent`

**Never expose:** symbols, portfolio names, market values, user IDs.

---

## Compliance

### Required Disclaimer (display once per Intelligence tab)

> "Portfolio Intelligence summarizes research evidence and observed portfolio characteristics for informational and research purposes. It does not provide individualized investment advice, suitability determinations, or recommendations to buy, sell, hold, or rebalance securities."

### Prohibited Language

| Prohibited | Use Instead |
|-----------|-------------|
| Recommendation | Research observation |
| Suitable / Unsuitable | — |
| Overweight / Underweight recommendation | Exposure percentage |
| Directional buy/sell/trim/add labels | — |
| Rebalancing directive | Portfolio exposure change |
| Single opaque composite metric / grade | Transparent dimensional metrics |
| "You should..." | Factual observation |

---

## Glossary Terms Added

The following terms were added to `shared/research-glossary.ts`:

| Term | Key |
|------|-----|
| Portfolio Research Coverage | `portfolio_research_coverage` |
| Portfolio Concentration | `portfolio_concentration` |
| Sector Exposure | `sector_exposure` |
| Theme Exposure | `theme_exposure` |
| Opportunity Overlap | `opportunity_overlap` |
| Research Strengthened | `research_strengthened` |
| Research Weakened | `research_weakened` |
| Qualified Holding | `qualified_holding` |
| Uncovered Holding | `uncovered_holding` |

---

## Roadmap Alignment

| Sprint | Scope |
|--------|-------|
| 2.6.0 | Portfolio History & Change Intelligence |
| **2.6.1** | **Portfolio Intelligence (this sprint)** |
| 2.6.2 | Portfolio Analytics (value chart #120, time-series) |
| 2.6.3 | Portfolio Research Workspace (AI context integration) |
| 2.6.4 | Goals & Planning |
| Future | Trade Planning / Trade Construction |

---

## UAT Checklist

1. Open a portfolio with at least 5 positions
2. Click the Intelligence tab
3. Confirm Research Coverage section shows percentages
4. Confirm Opportunity Overlap section shows CURRENTLY_QUALIFIED / APPROACHING / NOT_RANKED
5. Confirm Sector Exposure section sorted by largest first
6. Confirm Theme Exposure section with overlap disclosure visible
7. Confirm Concentration section shows labeled metrics (Low/Moderate/High)
8. Confirm Institutional Context shows 13F disclosure text
9. Click through to Opportunity Workspace for a qualified holding
10. Click through to Research Workspace
11. Confirm partial state when OppIntel snapshot unavailable
12. Verify cross-user denial: user B cannot see user A's portfolio intelligence
13. Verify Platform Health card shows portfolioIntelligence
14. Verify no 500 errors in logs
15. Verify no holdings / market values in structured logs

---

## Troubleshooting

| Symptom | Likely Cause | Action |
|---------|-------------|--------|
| `available: false, message: "Portfolio not found"` | Wrong userId or portfolioId | Check auth + ownership |
| Coverage at 0% | OppIntel snapshot absent (MCP disabled) | Normal in dev; enable MCP_ENABLED |
| `institutionalSummary.symbolsCovered = 0` | 13F ingestion not run | Run ingestion via `/admin/institutional-operations` |
| History changes empty | < 2 snapshots captured | Capture a snapshot, then make position changes |
| Stale data after position change | Cache not invalidated | Call `invalidatePortfolioIntelligenceCache()` |
| Platform Health DEGRADED | failedAnalyses > 0 | Check `portfolio_intelligence_failed` log events |

---

## Commercial Extension Points (documented, not implemented)

| Tier | Capability |
|------|-----------|
| FREE | Basic portfolio overview (positionCount, sectorCount) |
| RETAIL | Full Portfolio Intelligence tab |
| PROFESSIONAL | Longer history, multiple portfolios, cross-portfolio comparison |
| RIA | Client portfolio intelligence, advisor workflow |
| INSTITUTIONAL | Multi-portfolio, firm analytics |
| ENTERPRISE | Custom methodologies, API, private datasets |

Extension hooks for future: `organizationId`, advisor/client relationship, custom theme registry, custom research rules.

---

## Schema Impact

No new database tables in Sprint 2.6.1.

Existing tables read:
- `portfolios` — portfolio metadata + ownership
- `portfolio_positions` — current holdings
- `institutional_symbol_signals` — institutional evidence (Sprint 2.2.5)
- Portfolio snapshot tables — via `getPortfolioChanges()` (Sprint 2.6.0)
