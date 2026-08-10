---
name: Equity Trade Planning Engine (Sprint 2.7.1)
description: Architecture rules, type constraints, and field-name pitfalls for the Equity Planning Engine.
---

# Equity Trade Planning Engine — Sprint 2.7.1

## Key Architecture Rules

**No fabricated levels.** Entry zones and invalidation levels must derive exclusively from:
- Stored EMA bars (ema9, ema21, ema50) from `getReferenceSnapshot()`
- `invalidatesThesis[]` and `riskFactors[]` from canonical `TradePlanningContext`

If no validated level exists → `available: false` with `unavailableReason`. Never invent a price.

**Reference price is server-only.** Client cannot inject referencePrice, support, resistance, pivot, scores, or qualification status. Server always fetches from stored bars.

**Sizing uses floor() throughout.** `effectiveShares = min(floor(maxCapital/price), floor(maxLoss/riskPerShare))`. Capital ceiling enforced.

**No new DB migration.** Scenarios computed on-demand; `equity_planning_scenarios` table is deferred to a future sprint when versioning is needed.

**Static routes before dynamic.** Session endpoints (`/session/:id/equity`, `/session/:id/equity/scenarios`) must be registered before `/:symbol/context` to prevent routing conflicts.

## Type Gotchas

### EvidenceItem (from opportunity-intelligence-types.ts)
Fields: `type`, `label`, `detail`, `strength` (no `severity`).
When mapping to `EquityResearchEvidence.primaryEvidence[]`, use `(e as any).detail` for the detail field since it's typed as `string` (not `string | null`) in the source.

### PlanningFreshness (from trade-planning-types.ts)
Fields: `status`, `label`, `ageMinutes?`, `updatedAt?` (no `asOf`).
When building freshness from `portfolioContext.freshness`, use `.updatedAt ?? null` (not `.asOf`).

### ResearchGlossaryEntry
Required fields: `key`, `label`, `shortDefinition`, `fullDefinition`, `category`, `userFacing`.
Optional: `shortLabel`, `methodologySummary`, `interpretation`, `caution`, `higherIsBetter`, `aliases`.

**Wrong field names (used by pre-existing portfolio/trade entries — do NOT repeat):**
- `term` → must be `label`
- `short` → must be `shortDefinition`
- `full` → must be `fullDefinition`
- `sources` → not a valid field (use `methodologySummary` instead)
- `caveat` → must be `caution`

These wrong names create TS errors in PORTFOLIO_INTELLIGENCE_ENTRIES (line ~802), PORTFOLIO_ANALYTICS_ENTRIES, and TRADE_PLANNING_ENTRIES (line ~1121). They are pre-existing and no longer growing — new entries must use correct field names.

### ScenarioRow plPct null-guard
`hypotheticalPLPct` is `number | null`. The ScenarioRow prop must be `number | null` and the condition must check both `pl !== null && plPct !== null` before using `.toFixed()`.

## Compliance Vocabulary

| Forbidden | Correct |
|-----------|---------|
| Buy Zone | Research Scenario Entry Zone |
| Recommended Position Size | Hypothetical Scenario Size |
| Expected Return | Scenario P/L (Hypothetical) |
| Price Forecast | Scenario Analysis |
| Stop Loss | Research Invalidation Level |

`SCENARIO_DISCLAIMER` contains "not a price forecast... expected return..." — test must check it does NOT positively assert these phrases, not that it doesn't contain them.

## Route File Structure

4 new endpoints in `server/routes/trade-planning.ts`:
1. `GET  /session/:id/equity`
2. `PATCH /session/:id/equity`
3. `GET  /session/:id/equity/scenarios`
4. `POST /:symbol/equity`  ← dynamic, must come after session routes

## Future Work Documented (Not Implemented)

- `equity_planning_scenarios` DB table + versioning (when user changes constraints)
- Alert implementation for monitoring plan
- Cross-instrument comparison (equity vs covered call vs spread)
- Entitlement enforcement by tier
