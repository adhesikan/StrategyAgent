# Trade Risk & Scenario Analysis — Operations Guide

**Sprint:** 2.7.4  
**Status:** Live  
**Service:** `server/services/trade-risk-scenario-service.ts`  
**Routes:** `server/routes/trade-planning.ts` (session risk-analysis routes)  
**Client:** `client/src/pages/trade-planning.tsx` → `RiskAnalysisPanel`

---

## Overview

Trade Risk & Scenario Analysis is a deterministic, pure-computation engine that characterizes the economic and risk profile of a selected Options Contract Research candidate (Sprint 2.7.3). It answers:

- What is the **maximum loss / maximum gain** for this structure at expiration?
- Where are the **breakeven prices**?
- How does the structure react to **hypothetical price moves** (−40% to +40%)?
- How does it react to **IV changes** and **time decay**?
- Does the defined max loss fit within the user's **planning constraint**?

This module does **not** provide trade recommendations, probability of profit, or suitability assessments.

---

## Architecture

### Key Design Rules

| Rule | Value |
|------|-------|
| Probability metrics | **OFF** — `probabilityMetricsEnabled: false` always |
| Black-Scholes repricing | **Not used** — price scenarios use intrinsic payoff + delta approx |
| Missing Greeks | Remain `null`, never substituted with zero |
| Server authority | Client posts only `contractResearchCandidateId`; server reconstructs all data |
| Cache TTL | 5 min in-memory per `(userId, sessionId, candidateId)` triple |
| Session contract cache | 30 min, stored by `storeSessionContractResearch()` after every `/options/contracts` POST |

### Why probability metrics are disabled

The existing `probability-engine.ts` is a heuristic 0–100 point scorer — not a statistical probability model. Surfacing its output as "probability of profit" would be misleading. The field `probabilityMetricsEnabled` is always `false` in v2.7.4; a future sprint may introduce a calibrated model.

---

## Routes

All 4 routes are registered as **static** paths before the dynamic `/:symbol/context` route.

```
POST /api/trade-planning/session/:id/risk-analysis
GET  /api/trade-planning/session/:id/risk-analysis?contractResearchCandidateId=<id>
GET  /api/trade-planning/session/:id/risk-analysis/:analysisId
POST /api/trade-planning/session/:id/risk-analysis/recalculate
```

### POST `/session/:id/risk-analysis`

Builds a `TradeRiskScenarioResult` for the selected candidate.

**Request body:**
```json
{
  "contractResearchCandidateId": "cand-abc123",
  "customScenarioPcts": [-20, -10, 0, 10, 20],
  "customIVChangePcts": [-30, 0, 30]
}
```

**Server reconstructs:** candidate legs, quotes, Greeks, underlying price (reference snapshot), constraints, event exposure, quality category.

**Client must NOT send:** legs, strikes, midpoints, Greeks, underlying price, research scores.

### POST `/session/:id/risk-analysis/recalculate`

Same as above. Bypasses the 5-min cache to force a fresh computation with new custom scenario parameters.

---

## Computation Modules

| Module | Description |
|--------|-------------|
| `computePayoffProfile` | Dispatches to 15 strategy-family-specific handlers; derives max loss, max gain, breakevens |
| `computeCapitalProfile` | Net debit/credit, cash-secured capital from legs |
| `computeGreekProfile` | Sums signed Greek contributions across legs; tracks coverage % |
| `computePriceScenarios` | 11 default points (−40% to +40%); expiration intrinsic + delta approx |
| `computeVolatilityScenarios` | Vega approximation for IV changes; 5 default points |
| `computeTimeDecayScenarios` | 6 checkpoints (1 day → 100% of DTE); linear theta approx |
| `computeEventScenarios` | Detects earnings window; appends descriptive event contexts |
| `computeLiquidityRisk` | Avg bid-ask spread %, avg OI across legs |
| `computeQuoteRisk` | Staleness check; includes `MIDPOINT_DISCLAIMER` |
| `computeRiskFlags` | 11 flag codes (see `RiskFlagCode` in types) |
| `computeConstraintCheck` | Compares defined max loss to `maxCapitalAtRisk` constraint |
| `computeStructureSummary` | Human-readable labels for legs, direction, risk profile |
| `computeThesisRisk` | Converts `invalidatesThesis` / `eventContext` notes into overlay text |

---

## Payoff Strategies

The following 15 strategy families have dedicated payoff handlers:

| Family | Max Loss | Max Gain |
|--------|----------|---------|
| long_call | Premium (DEFINED) | UNLIMITED |
| long_put | Premium (DEFINED) | (Strike − Premium) × 100 (DEFINED) |
| bull_call_spread | Net debit (DEFINED) | (Width − Debit) × 100 (DEFINED) |
| bear_put_spread | Net debit (DEFINED) | (Width − Debit) × 100 (DEFINED) |
| bull_put_spread | (Width − Credit) × 100 (DEFINED) | Net credit (DEFINED) |
| bear_call_spread | (Width − Credit) × 100 (DEFINED) | Net credit (DEFINED) |
| covered_call | SUBSTANTIAL (share downside offset by credit) | NOT_APPLICABLE |
| cash_secured_put | (Strike − Credit) × 100 (DEFINED) | Net credit (DEFINED) |
| protective_put | NOT_APPLICABLE (share upside intact) | UNLIMITED |
| collar | Net cost (DEFINED) | DEFINED |
| iron_condor | (Width − Credit) × 100 (DEFINED) | Net credit (DEFINED) |
| iron_butterfly | (Width − Credit) × 100 (DEFINED) | Net credit (DEFINED) |
| long_straddle | Premium (DEFINED) | UNLIMITED |
| long_strangle | Premium (DEFINED) | UNLIMITED |
| calendar_spread | Net debit (DEFINED) | PATH_DEPENDENT |
| diagonal_spread | Net debit (DEFINED) | PATH_DEPENDENT |

---

## Risk Flag Codes

| Code | Trigger |
|------|---------|
| UNDEFINED_RISK | Max loss type is not DEFINED |
| EXCEEDS_CONSTRAINT | Defined max loss > planning constraint |
| STALE_QUOTES | Option data age > 4 hours |
| WIDE_BID_ASK | Avg spread ≥ 15% |
| LOW_OPEN_INTEREST | Avg OI < 50 |
| EARNINGS_IN_WINDOW | Earnings within DTE |
| EARLY_EXERCISE_POSSIBLE | Short call/put leg present in American-style option |
| PATH_DEPENDENT | Calendar or diagonal spread |
| NO_GREEKS | Greek coverage = 0% |
| PARTIAL_GREEKS | Greek coverage > 0 but < 100% |
| HIGH_IV | Any leg IV > 100% |

---

## Health Metrics

Accessible via `GET /api/platform/health` → `tradePlanning.details.riskAnalysesRequested`.

| Metric | Description |
|--------|-------------|
| riskAnalysesRequested | Total POST calls to risk analysis endpoint |
| riskAnalysesCompleted | Successful results returned |
| partialRiskAnalyses | Completed with data gaps (stale/missing Greeks) |
| failedRiskAnalyses | Unhandled errors |
| averageRiskAnalysisLatencyMs | Rolling average duration |
| staleRiskAnalyses | Results flagged as stale at time of delivery |
| probabilityMetricsEnabled | Always `false` in Sprint 2.7.4 |
| lastSuccessfulRiskAnalysisAt | ISO timestamp |

---

## Session Flow

```
1. POST /session/:id/options/contracts
   → buildContractResearchResult()
   → storeSessionContractResearch(sessionId, result)   ← 30-min session cache

2. User selects a candidate in the UI

3. POST /session/:id/risk-analysis { contractResearchCandidateId }
   → getSessionContractResearch(sessionId)              ← look up candidate
   → getReferenceSnapshot(userId, symbol)               ← server-side price
   → buildTradeRiskScenarioResult({ input, ... })       ← pure computation
   → getCachedRiskAnalysis()                            ← 5-min per-user cache

4. POST /session/:id/risk-analysis/recalculate { ... } ← force fresh compute
```

---

## Compliance Notes

- All scenario tables are labelled **Hypothetical** — they are not forecasts.
- `RISK_SCENARIO_DISCLAIMER` must appear on every response.
- `MIDPOINT_EXECUTION_NOTE` must accompany every response with quote-based values.
- Delta is described as a **sensitivity measure**, never as probability of profit or finishing ITM.
- "Probability of profit" and "chance of finishing" language is prohibited.
- No "recommendation," "best structure," "optimal," or "pick this one" language anywhere in the result.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| 404 "Contract research result not found" | POST `/options/contracts` not called or session expired | Call POST `/options/contracts` first |
| 404 "Candidate not found" | Wrong `contractResearchCandidateId` or stale session | Re-run contract research, use returned IDs |
| Stale quote warning | Option data > 4 hours old | Reconnect broker; re-run contract research |
| Max loss = null, type = DEFINED | Legs missing or debit/credit unresolvable | Check contract research result for data quality issues |
| Greek coverage < 100% | Some broker-chain legs missing IV/Greeks | Expected for LIMITED_DATA candidates — noted in output |
