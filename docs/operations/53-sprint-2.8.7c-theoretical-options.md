# Sprint 2.8.7C — Broker-Independent Theoretical Options Research

**Sprint:** 2.8.7C  
**Status:** IMPLEMENTATION COMPLETE — Production UAT pending  
**Date:** 2026-08-17  
**Architecture:** Audit C / Amendment C1 — UNDERLYING_ONLY_THEORETICAL_MODE  

---

## Overview

Sprint 2.8.7C adds broker-independent theoretical options research to VCP Trader AI.  
Users can now explore theoretical option values, model Greeks, historical volatility, and a hypothetical strike grid without connecting a brokerage account or accessing a live options chain.

All outputs are **research data only** — permanently unable to satisfy any execution-grade gate.

---

## Sprint Status Chain

| Sprint | Title | Status |
|--------|-------|--------|
| 2.8.7A | Brokerless Trade Plan Readiness | COMPLETE / UAT PASS |
| 2.8.7B | Broker-Independent Equity Planning Data | IMPLEMENTATION COMPLETE — Production UAT pending natural qualified opportunity |
| 2.8.7C | Theoretical Options Research | IMPLEMENTATION COMPLETE — Production UAT pending |

**Opportunity Intelligence Diagnostic (2026-08-17): HEALTHY_ZERO_OPPORTUNITIES**  
No remediation required. Do NOT alter qualification thresholds or Opportunity Engine behavior.

---

## Primary Goal

Allow users to perform meaningful options research without:
- A connected brokerage account
- Access to a live options chain

**Source:** Twelve Data / stored daily bars (via existing planning-market-data infrastructure)  
**Output:** Clearly labeled THEORETICAL research data

---

## Reuse Map

| Component | Decision |
|-----------|----------|
| `getPlanningQuoteData()` (planning-quote.ts, 2.8.7B) | **REUSED** — underlying price source |
| `getHistoricalBars()` (market-history-service.ts) | **REUSED** — bar data for HV |
| `historicalVolatility()` (indicators.ts) | **REUSED** — log-return HV function |
| Twelve Data client (twelve-data-client.ts) | **UNCHANGED** — no new direct client |
| `getRealtimeQuoteForUser()` (realtime-quote.ts) | **UNCHANGED** (used indirectly) |
| Options Strategy Matching | **EXTENDED** — can consume `atmSummary` from theoretical research for enrichment |
| Trade Risk & Scenario | **EXTENDED** — accepts `optionDataAsOf` provenance note for modeled inputs |
| Contract Research (2.7.3) | **BOUNDARY** — continues to require live broker options chain; indicates unavailability when chain absent |
| All execution pipeline files | **UNCHANGED** — theoretical values structurally excluded |

---

## New Files

| File | Purpose |
|------|---------|
| `shared/theoretical-options-types.ts` | Canonical types: TheoreticalOptionValue, TheoreticalGreeks, TheoreticalStrikeRow, TheoreticalStrikeGrid, HistoricalVolatilitySet, TheoreticalQuality, ExpirationMode, OptionsResearchValue |
| `server/services/theoretical-options/risk-free-rate.ts` | Isolated risk-free rate module (APPROX_RATE, configurable) |
| `server/services/theoretical-options/realized-volatility.ts` | HV10/20/30/60/90 engine using log returns |
| `server/services/theoretical-options/black-scholes.ts` | Full BSM + 5 Greeks, T = DTE/365 |
| `server/services/theoretical-options/strike-grid.ts` | Theoretical strike grid generator |
| `server/services/theoretical-options/theoretical-options-research-service.ts` | Orchestration service |
| `server/routes/theoretical-options.ts` | API routes |
| `client/src/components/theoretical-options/TheoreticalOptionsPanel.tsx` | UI component |
| `server/__tests__/theoretical-options-math.test.ts` | Math tests (A–R, §22) |
| `server/__tests__/theoretical-options-product.test.ts` | Product behavior tests (A–K, §23) |

---

## Types Added

### `shared/theoretical-options-types.ts`
- `TheoreticalQuality` — 6 states: NORMAL, LOW_CONFIDENCE, SHORT_DTE_WARNING, DEEP_ITM_OTM_WARNING, INSUFFICIENT_HISTORY, UNAVAILABLE
- `ExpirationMode` — ACTUAL_LISTED_EXPIRATION | HYPOTHETICAL_EXPIRATION
- `DividendYieldSource` — OBSERVED | DERIVED | DEFAULT_ZERO
- `RiskFreeRateSource` — APPROX_RATE | LIVE_TREASURY | CONFIGURED
- `HistoricalVolatilityEntry` — per-lookback HV record with provenance
- `HistoricalVolatilitySet` — HV10/20/30/60/90 + defaultVol (HV30)
- `TheoreticalGreeks` — modelDelta, modelGamma, modelTheta, modelVega, modelRho + greekSource
- `TheoreticalOptionValue` — full theoretical option value with `_brand: "THEORETICAL_ONLY"` structural incompatibility
- `TheoreticalStrikeRow` — single strike row (no OCC symbols, no bid/ask/volume/OI)
- `TheoreticalStrikeGrid` — full DTE grid (HYPOTHETICAL_EXPIRATION, never a listed date)
- `AtmSummaryRow` — ATM per-DTE quick-reference row
- `TheoreticalOptionsResearch` — full research result
- `OptionsResearchValue` — Audit C/C1 envelope: {theoretical, market: null, derivedComparison: null}
- `TheoreticalMethodology` — expandable methodology metadata
- `THEORETICAL_OPTIONS_DISCLOSURE` — required user-facing disclosure text
- `THEORETICAL_OPTIONS_SHORT_DISCLOSURE` — abbreviated version
- `HYPOTHETICAL_DTE_SCENARIOS` — [7, 14, 30, 45, 60, 90]

---

## Historical Volatility Implementation

**Method:** Log returns → annualized standard deviation  
**Formula:**
```
r_t = ln(P_t / P_{t-1})
HVn = stddev(r_t over n periods) × sqrt(252)
```

**Annualization factor:** 252 trading days (NOT used for BSM T — see Time Convention)

**Lookbacks:** HV10, HV20, HV30, HV60, HV90  
**Default for pricing:** HV30 (per Amendment C1)  
**Fallback chain:** HV30 → HV20 → HV60 → HV10 → HV90 → null

**Reuse:** Delegates to `historicalVolatility()` in `indicators.ts` — no code duplication.

---

## Time-to-Expiration Convention (CRITICAL)

```
T = DTE / 365    (calendar-time fraction)
```

**NOT** `DTE / 252`.

- **252** is used only for annualizing trading-day realized volatility.
- **BSM T** uses calendar days (DTE / 365).
- This is documented explicitly in `black-scholes.ts`, `theoretical-options-types.ts`, and `methodology.timeConvention`.

---

## Risk-Free Rate Approach

| Field | Value |
|-------|-------|
| Source | `APPROX_RATE` |
| Default | 4.5% (0.045) — approximate US short-term rate, mid-2026 |
| Override | `THEORETICAL_OPTIONS_RISK_FREE_RATE` env var (decimal, e.g. "0.045") |
| When configured via env | source = "CONFIGURED" |
| Isolation | All callers use `getRiskFreeRate()` only — no scattered hardcoded values |
| Replacement path | Implement `getLiveRiskFreeRate()` in `risk-free-rate.ts`, update source label to "LIVE_TREASURY" |

---

## Dividend Yield Approach

| Field | Value |
|-------|-------|
| Source | `DEFAULT_ZERO` |
| Value | q = 0 |
| Rationale | No live dividend yield source exists in the codebase |
| UI label | "0.00% (DEFAULT_ZERO)" — never silently implied |
| Replacement path | Add `OBSERVED` or `DERIVED` source when fundamental data includes yield |

---

## Black-Scholes Implementation

**Model:** Black-Scholes-Merton with continuous dividend yield  
**Canonical name:** `BLACK_SCHOLES_CONTINUOUS_DIVIDEND`

**Formulas:**
```
d1 = [ln(S/K) + (r - q + σ²/2) × T] / (σ × √T)
d2 = d1 - σ × √T

Call = S × e^(-qT) × N(d1) - K × e^(-rT) × N(d2)
Put  = K × e^(-rT) × N(-d2) - S × e^(-qT) × N(-d1)
```

**Normal CDF:** Abramowitz & Stegun 26.2.17 approximation (max error: 7.5e-8)

**Output field names:**
- `modelCallValue`, `modelPutValue` (never price/bid/ask/mark/midpoint/last/executionPrice)

---

## Model Greeks Implementation

| Greek | Formula | Units |
|-------|---------|-------|
| Delta (call) | e^(-qT) × N(d1) | per $1 move |
| Delta (put) | e^(-qT) × [N(d1) - 1] | per $1 move |
| Gamma | e^(-qT) × φ(d1) / (S × σ × √T) | per $1² |
| Theta (call) | [-S×e^(-qT)×φ(d1)×σ/(2√T) - r×K×e^(-rT)×N(d2) + q×S×e^(-qT)×N(d1)] / 365 | per calendar day |
| Theta (put) | [-S×e^(-qT)×φ(d1)×σ/(2√T) + r×K×e^(-rT)×N(-d2) - q×S×e^(-qT)×N(-d1)] / 365 | per calendar day |
| Vega | S×e^(-qT)×φ(d1)×√T / 100 | per 1% vol |
| Rho (call) | K×T×e^(-rT)×N(d2) / 100 | per 1% rate |
| Rho (put) | -K×T×e^(-rT)×N(-d2) / 100 | per 1% rate |

**greekSource:** Always `"VCP_REALIZED_VOL_MODEL"` — never BROKER or LIVE.

---

## Quality States

| State | Trigger |
|-------|---------|
| NORMAL | HV30 available, T > 0, σ > 0, inputs valid |
| LOW_CONFIDENCE | HV30 null but another lookback succeeded |
| SHORT_DTE_WARNING | DTE < 7 |
| DEEP_ITM_OTM_WARNING | \|ln(S/K)\| > 0.5 |
| INSUFFICIENT_HISTORY | No HV lookback has enough bars |
| UNAVAILABLE | Missing underlying price, σ = 0, T ≤ 0, S ≤ 0, or K ≤ 0 |

UNAVAILABLE → all numeric outputs null. Never fabricated.

---

## Hypothetical DTE Implementation

**Scenarios:** [7, 14, 30, 45, 60, 90]  
**Labels:** "7 DTE (hypothetical)", "30 DTE (hypothetical)", etc.  
**ExpirationMode:** `HYPOTHETICAL_EXPIRATION`

- Never displays an actual exchange-listed expiration date
- No OCC contract symbols generated
- Not visually indistinguishable from a real option chain

---

## Theoretical Strike Grid

**Strike increment policy:**

| Underlying Price | Increment |
|-----------------|-----------|
| < $10 | $0.50 |
| $10 – $30 | $1.00 |
| $30 – $100 | $2.50 |
| $100 – $300 | $5.00 |
| > $300 | $10.00 |

**Strike count:** ATM ± 5 = 11 strikes per DTE grid (configurable `strikesEachSide`)  
**Performance:** All grids computed locally — underlying price and bars fetched once.

---

## Options Strategy Matching Integration (§13)

`buildOptionsStrategyMatchResult()` is unchanged.

Callers (e.g. the trade plan workspace) may enrich the strategy display with `theoreticalResearch.atmSummary` data (e.g. showing hypothetical call/put values alongside strategy descriptions). This is a UI-layer consumer pattern — the service itself is not modified.

Enrichment of strategy-level display is limited to:
- Expected underlying range (from ATM grid)
- Hypothetical strike exploration
- Theoretical call/put value per DTE scenario
- Modeled Greeks summary

Not introduced:
- "best", "recommended", "optimal", "highest-probability", "POP"
- Automatic strategy selection

---

## Risk/Scenario Analysis Integration (§14)

`buildTradeRiskScenarioResult()` is unchanged.

When a user selects a theoretical strike for scenario exploration, the caller may pass `optionDataAsOf: "THEORETICAL_MODEL"` to `BuildRiskScenarioInput.optionDataAsOf` — this signals to the scenario engine that option leg data is model-based, not market-observed. The risk engine treats this as a labeling distinction (surfaced in `qualityCategory`), not a logic change.

Modeled premiums are explicitly labeled "Hypothetical / Model-Based" in the UI.

---

## Contract Research Boundary (§15)

Contract Research (Sprint 2.7.3) remains unchanged and continues to require a live broker options chain. When no broker is connected:
- Contract Research indicates that actual contract-level data is unavailable.
- The UI should refer users to Theoretical Options Research for model-based exploration.
- No fake contract symbols, expiration dates, bid/ask, volume, OI, or IV are generated.

---

## Execution Safety — Permanent Invariant C1

```
TheoreticalOptionValue._brand = "THEORETICAL_ONLY"
```

This field is structurally absent from:
- `NormalizedOptionContract`
- `ExecutionQuote`
- `BrokerQuote`
- `OrderPreparationQuote`

TypeScript enforces incompatibility at compile time. Runtime tests verify `_brand = "THEORETICAL_ONLY"` is never "EXECUTION_GRADE".

A modeled value cannot satisfy any of:
- Execution Preflight quote validation
- Order Preparation execution quote
- Order Preview executable price validation
- Final Revalidation
- Broker Submission

Broker connection after the fact does NOT promote a theoretical value to execution-grade.

---

## API Endpoints

### GET /api/trade-planning/theoretical-options/health
No authentication required.

### GET /api/trade-planning/theoretical-options/:symbol
Authentication required. Returns `TheoreticalOptionsResearch`.

**Query parameters:**
- `strikesEachSide` (optional, integer 1–10, default 5) — strikes above/below ATM

---

## UI Notes

- Disclosure banner always visible: "Theoretical values — not live option quotes."
- ATM summary table uses `~$` prefix on all values
- Strike grids are collapsible — collapsed by default
- Methodology expandable section shows: BSM model, HV30, underlying source, risk-free rate, dividend yield, T = DTE/365 convention
- Does NOT visually imitate a live option chain
- Mode B badge visible in header

---

## Tests Added

**Math tests:** `server/__tests__/theoretical-options-math.test.ts`  
Tests A–R per §22: known BSM call/put, put-call parity, dividend yield, HV10/20/30/60/90, insufficient history, Delta sign/range, Gamma positive, Theta sign, Vega positive, Rho direction, short DTE warning, deep ITM/OTM warning, null-input behavior.

**Product behavior tests:** `server/__tests__/theoretical-options-product.test.ts`  
Tests A–K per §23: no-broker availability, no-fabrication on unavailable data, broker-agnostic math layer, execution gate structural incompatibility, Order Preparation exclusion, Order Preview exclusion, Final Revalidation exclusion, hypothetical DTE labeling, no OCC symbols, no bid/ask/volume/OI, full provenance.

---

## Remaining Limitations

| ID | Description |
|----|-------------|
| TH-001 | Dividend yield is always `DEFAULT_ZERO` — a future fundamental data feed could provide `OBSERVED` or `DERIVED` yields |
| TH-002 | Risk-free rate is `APPROX_RATE` — a future Treasury/SOFR feed would replace with `LIVE_TREASURY` |
| TH-003 | IV solver not implemented — deferred to independent options-market-data package |
| TH-004 | `OptionsResearchValue.market` is always null — populated when independent chain data arrives |
| TH-005 | `OptionsResearchValue.derivedComparison` is always null — populated when both theoretical and market coexist |
| CON-004 | Hypothetical buying power entry (Task #161) remains pending |

---

## Production UAT Plan

1. Verify `GET /api/trade-planning/theoretical-options/:symbol` returns a valid `TheoreticalOptionsResearch` response for a qualified symbol (e.g. NVDA, AMD, MSFT).
2. Confirm `disclosure` field contains "Theoretical values — not live option quotes."
3. Confirm `mode = "UNDERLYING_ONLY_THEORETICAL_MODE"`.
4. Confirm all `strikeGrids[n].expirationMode = "HYPOTHETICAL_EXPIRATION"`.
5. Confirm no `bid`, `ask`, `volume`, `openInterest`, `occSymbol` fields in any strike row.
6. Confirm `quality ≠ "UNAVAILABLE"` when underlying data is available.
7. Confirm `methodology.timeConvention` contains "DTE / 365".
8. Verify put-call parity holds for returned ATM values: C - P ≈ S·e^(-qT) - K·e^(-rT).
9. Confirm `TheoreticalOptionsPanel` renders with disclosure banner and MODE B badge.
10. Confirm theoretical values cannot enter the order preparation flow (no `executable` field, no `contractId`).
