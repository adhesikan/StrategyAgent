---
name: Trade Risk & Scenario Analysis (Sprint 2.7.4)
description: Architecture rules, type field names, and key implementation decisions for the risk/scenario engine.
---

## Key Rules

- **Probability metrics: OFF** — `probabilityMetricsEnabled: false` always. Existing scorer is a heuristic; field must remain false until a calibrated model is introduced.
- **No Black-Scholes repricing** — price scenarios use expiration intrinsic payoff (exact math) + delta approximation (labeled ≈). These are two separate values per scenario row.
- **Missing Greeks → null, never zero** — `greeksCoveragePercent` tracks coverage %; partial is a valid state.
- **No auto-substitution** — if maxLoss exceeds constraint, return `EXCEEDS_CONSTRAINT`; never silently pick a different structure.
- **Server authoritative** — client POSTs only `contractResearchCandidateId`; server reconstructs all leg/quote/Greek data from `_sessionContractResearchCache` (30-min TTL).
- **Static routes before dynamic** — all 4 risk-analysis routes are registered before `/:symbol/context`.
- **`storeSessionContractResearch`** must be called in POST `/options/contracts` immediately after `buildContractResearchResult()`.

## Actual Type Field Names (many differ from intuitive names)

| Intuitive name | Actual field | Type |
|---|---|---|
| `ConstraintCheck.statusLabel` | compute from `status` using local map | — |
| `RiskFlag.severity` | use `code` (no severity field) | `RiskFlagCode` |
| `RiskFlag.message` | `note` | `string` |
| `StructureSummary.directionLabel` | does not exist | — |
| `StructureSummary.expirationLabel` | `expirations` (array) | `string[]` |
| `StructureSummary.legSummary` | `legs` | `StructureLegSummary[]` |
| `BreakevenPoint.type` | `label` | `string` |
| `PayoffProfile.payoffTypeNote` | `payoffNote` | `string` |
| `CapitalProfile.estimatedDebitPerContract` | `netDebitPerContract` | `number\|null` |
| `CapitalProfile.estimatedCreditPerContract` | `netCreditPerContract` | `number\|null` |
| `CapitalProfile.cashSecuredCapital` | `estimatedScenarioCapital` | `number\|null` |
| `PriceScenario.pctChange` | `movePct` | `number` |
| `PriceScenario.hypotheticalUnderlyingPrice` | `scenarioPrice` | `number` |
| `PriceScenario.expirationIntrinsicPnl` | `expirationIntrinsicPnlPerContract` | `number` |
| `PriceScenario.deltaApproxPnl` | `deltaApproxPnlPerContract` | `number\|null` |
| `VolatilityScenario.ivChangePct` | `ivRelativeChangePct` | `number` |
| `VolatilityScenario.estimatedPnl` | `estimatedValueChangePerContract` | `number\|null` |
| `TimeDecayScenario.estimatedPnl` | `cumulativeEstimatedDecayPerContract` | `number\|null` |
| `ThesisRisk.invalidationOverlay` | `invalidationNote` (single string) | `string\|null` |
| `LiquidityRisk.avgBidAskSpreadPct` | `widestBidAskSpreadPct` | `number\|null` |
| `LiquidityRisk.avgOpenInterest` | `lowestOpenInterest` | `number\|null` |
| `QuoteRisk.isStale` | does not exist; use `result.freshness.isStale` | — |
| `QuoteRisk.midpointDisclaimer` | `midpointNote` | `string` |
| `ConstraintCheck.note` | `statusNote` | `string` |

## Gotchas

- `LegRole` type includes `"wing_long" | "wing_short"` values not in `StructureLegSummary.role` — cast needed: `role: (leg.role === "long_leg" || leg.role === "short_leg" ? leg.role : "long_leg") as "long_leg" | "short_leg"`
- `new Set(...)` spread `[...new Set()]` hits "downlevelIteration" error — use `Array.from(new Set(...))` instead
- `uuid` package is not installed — use `crypto.randomUUID()` (built-in Node)
- `shared/trade-risk-scenario-types.ts` had a self-referential import for `RiskFlagCode` that was removed
- `storeSessionContractResearch` / `getSessionContractResearch` are in `trade-risk-scenario-service`, NOT `contract-research-service`

## Services / Exports

- `server/services/trade-risk-scenario-service.ts` exports: `buildTradeRiskScenarioResult`, `storeSessionContractResearch`, `getSessionContractResearch`, `getCachedRiskAnalysis`, `clearRiskScenarioCache`, `getRiskAnalysisHealth`
- Cache: 5-min per `(userId, sessionId, candidateId)`; session cache 30-min per `sessionId`

## 2.7.5 Handoff

`TradePlanInput` is included in every `TradeRiskScenarioResult.tradePlanHandoff`. It carries `planningContextId`, `contractResearchCandidateId`, `riskScenarioAnalysisId`, and `researchThesis` for the Trade Plan Workspace.
