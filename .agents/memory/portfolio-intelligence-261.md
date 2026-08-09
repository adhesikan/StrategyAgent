---
name: Portfolio Intelligence (Sprint 2.6.1)
description: Architecture, gotchas, and compliance rules for the Portfolio Intelligence engine and tab.
---

## Core rules

- Computation engine: `server/services/portfolio-intelligence-service.ts` — all functions are pure (no side effects beyond DB reads).
- `EvidenceItem` from `shared/opportunity-intelligence-types.ts` is the type for `primaryEvidence` in `OpportunityOverlapItem` — NOT a local `{ type: string; description: string; weight: number }` shape.
- `OpportunityOverlapItem.primaryEvidence: EvidenceItem[]` — import `EvidenceItem` from opportunity-intelligence-types.
- No portfolio score/grade/rating introduced — ops doc must avoid even mentioning "portfolio score", "portfolio grade", "portfolio rating" literally (test regex: `/\bportfolio score\b/`).
- ConcentrationLabel vocabulary: only "Low" | "Moderate" | "High".
- All research scores come from OppIntel exclusively (`CanonicalOpportunity`) — never recomputed.

## Auth pattern

- Routes use `req.session.userId!` (not `req.user?.id`) — consistent with all other portfolio routes in this codebase.
- `registerPortfolioIntelligenceRoutes(app, isAuthenticated)` signature.

## Opportunity overlap classification

- `_sourceCategory === "topGrowth" | "topIncome"` → CURRENTLY_QUALIFIED
- `_sourceCategory === "approaching" | "watchlist"` → APPROACHING_QUALIFICATION
- Not in OppIntel but in `changes.noLongerQualified` → NO_LONGER_QUALIFIED
- Not in OppIntel at all → NOT_CURRENTLY_RANKED

## Cache

- 15-minute in-memory TTL, keyed `${userId}:${portfolioId}`.
- Invalidated by calling `invalidatePortfolioIntelligenceCache(userId, portfolioId)`.
- `snapshotId` param bypasses cache.

## Concentration thresholds (documented in Research Glossary)

| Metric | Low | Moderate | High |
|--------|-----|----------|------|
| Largest position | <10% | 10–20% | >20% |
| Top-3 | <25% | 25–50% | >50% |
| Sector | <30% | 30–50% | >50% |
| Theme | <20% | 20–40% | >40% |

## Glossary terms added

9 new terms in `shared/research-glossary.ts` via `PORTFOLIO_INTELLIGENCE_ENTRIES[]` constant + `getPortfolioGlossaryEntry(key)` export:
portfolio_research_coverage, portfolio_concentration, sector_exposure, theme_exposure, opportunity_overlap, research_strengthened, research_weakened, qualified_holding, uncovered_holding

## Bulk load pattern (no N+1)

Single `Promise.allSettled` dispatches:
1. OppIntel in-memory read
2. `getReferenceSnapshotsBulk(userId, symbols)` → lastPrice
3. `institutionalSymbolSignals` Drizzle `inArray(symbol, symbols)` query
4. `getPortfolioChanges(portfolioId, userId)`
5. `getAllThemes()` (sync, no DB)

## Ops doc compliance

`docs/operations/22-portfolio-intelligence.md` test checks (`/\bportfolio score\b/i`, `/\bportfolio grade\b/i`, `/\bportfolio rating\b/i`). Write "opaque composite metric" or "transparent dimensional metrics" instead of those phrases verbatim.

**Why:** Compliance — Sprint 2.6.1 spec §21 explicitly prohibits opaque composite portfolio scores; test enforces this.
**How to apply:** Any future ops doc additions must use "transparent dimensions" or "observable metrics" language.
