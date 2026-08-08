---
name: Opportunity Intelligence Engine (Sprint 2.5.0)
description: Canonical opportunity model architecture — enrichment layer, types, routes, test patterns, compliance rules.
---

## Architecture

Pure enrichment layer over the existing ranking snapshot. Never re-implements scanning or ranking.

1. `getLatestRanking()` — reads existing in-memory snapshot (no DB)
2. Batch query `market_data_symbols` for `companyName`, `sector`, `industry` (one call for all symbols)
3. `getAllThemes()` + `buildSymbolThemeMap()` — theme membership from curated registry (no DB)
4. Assemble `CanonicalOpportunity` objects deterministically

## Key files

- `shared/opportunity-intelligence-types.ts` — canonical types + OPPORTUNITY_TYPE_LABELS
- `server/services/opportunity-intelligence-service.ts` — engine
- `server/routes/opportunity-intelligence.ts` — 3 GET-only routes
- `server/routes/__tests__/opportunity-intelligence.test.ts` — 156 tests

## Routes

- `GET /api/intelligence/opportunities` — filtered + sorted list
- `GET /api/intelligence/opportunities/meta` — filter options (lightweight)
- `GET /api/intelligence/opportunities/:symbol` — single opportunity

## Score mapping rules

- `researchScore` = `overallScore` from existing ranking (already 0-100 composite)
- `sentimentScore` = `round(institutionalScore * 0.65 + regimeScore * 0.35)`
- `riskLevel`: riskScore ≥ 60 → high, 35-59 → medium, 0-34 → low
- `timeHorizon`: swing/momentum/covered_call/cash_secured_put → short; long_term_investment → long; else → medium

## opportunityType mapping priority

1. strategy string match: "covered call" → covered_call, "cash secured put" → cash_secured_put, "dividend" → dividend, "etf" → etf, "value" → value, "momentum" → momentum, "swing" → swing, "long-term/compounder" → long_term_investment
2. sourceCategory: topIncome → income, watchlist/approaching → swing, else → growth

## Compliance enforcement

All types/routes/services must NOT contain: `recommendation:`, `= "recommendation"`, `"recommendations"`, `targetPrice`, `target_price`, `: "buy"`, `: "sell"`. Tests check for these patterns specifically (not bare words, which appear in compliance *comments*).

**Why:** Bare-word checks flagged compliance notes in comments. Pattern-based checks (as assignments or JSON keys) avoid false positives while still catching actual violations.

## Evidence panel limits

- `primaryEvidence[]` — max 4 items; includes institutional item if institutionalScore ≥ 45
- `secondaryEvidence[]` — max 4 items; max 2 theme items
- `riskFactors[]` — max 3 items from scanner warnings
- `invalidatesThesis[]` — from scanner invalidation field + high-severity risk factors

## Metadata enrichment failure handling

`companyName`/`sector`/`industry` are null-safe. DB query failure is caught, proceeds with empty meta. Opportunities are still returned.

## Platform health

`checkOpportunityIntelligence()` → `opportunityIntelligence` key in `buildPlatformHealth()`. Status: UNKNOWN if no snapshot, DEGRADED if 0 opportunities, HEALTHY otherwise.

## Future consumers

Portfolio Intelligence, Watchlists, Alerts, AI Agents all consume this engine via `getOpportunityIntelligence()` or `getCanonicalOpportunity()`. No duplication of enrichment logic.
