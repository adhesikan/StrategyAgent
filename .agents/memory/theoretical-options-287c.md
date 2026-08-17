---
name: Theoretical Options Research (Sprint 2.8.7C)
description: BSM engine, HV10/20/30/60/90, hypothetical strike grid, execution safety invariants — broker-independent options research.
---

# Theoretical Options Research — Sprint 2.8.7C

## Key decisions and invariants

**Time-to-expiration:** T = DTE / 365 (calendar days). NEVER DTE / 252.
- 252 is used ONLY for annualizing realized volatility (HV computation).
- BSM T is a calendar-time fraction.
- This is enforced in `black-scholes.ts`, `theoretical-options-types.ts`, and `methodology.timeConvention`.

**ATM Delta:** For r > 0 and non-trivial T, ATM call delta > 0.5 (not exactly 0.5).
- d1 = [ln(S/K) + (r - q + σ²/2) × T] / (σ√T) > 0 when r > 0, S = K.
- At r=4.5%, T=0.25, σ=25%: ATM call delta ≈ 0.56, not 0.5.
- Test must assert delta > 0.5, not ≈ 0.5.

**Structural incompatibility:** `TheoreticalOptionValue._brand = "THEORETICAL_ONLY"`.
- This field is absent from `NormalizedOptionContract`, `ExecutionQuote`, `BrokerQuote`, `OrderPreparationQuote`.
- TypeScript enforces incompatibility at compile time.
- A theoretical value can NEVER satisfy any execution gate.

**Dividend yield:** Always `q = 0`, `qSource = "DEFAULT_ZERO"`. Never silently implied.

**Risk-free rate:** `r = 0.045` (4.5%), `source = "APPROX_RATE"`. Configurable via `THEORETICAL_OPTIONS_RISK_FREE_RATE` env var. All callers must use `getRiskFreeRate()` — no scattered hardcoded values.

**Default vol:** HV30. Fallback: HV30 → HV20 → HV60 → HV10 → HV90 → null.

**HV reuse:** `historicalVolatility()` in `indicators.ts` is the canonical implementation. `realized-volatility.ts` wraps it — no duplication.

**getHistoricalBars() API:**
```typescript
// CORRECT: single params object, returns HistoricalBarsResult
const barsResult = await getHistoricalBars({
  symbol: "NVDA",
  outputSize: 120,
  purpose: "user",   // NOT "theoretical_options_research" — not a valid value
  allowExternalRefresh: true,
  caller: "theoretical_options_research",
});
const bars = barsResult.bars;  // .bars, not the result itself
```

**Purpose parameter valid values:** `"scan" | "user" | "regime"` — nothing else.

**Strike grid:** ATM ± 5 = 11 strikes. Increments: <$10 → $0.50, $10–30 → $1, $30–100 → $2.50, $100–300 → $5, >$300 → $10.

**DTE scenarios:** [7, 14, 30, 45, 60, 90]. Always labeled "N DTE (hypothetical)". ExpirationMode = HYPOTHETICAL_EXPIRATION. Never an actual listed date.

**UNAVAILABLE behavior:** When underlying price is null or HV set has no valid lookback, return UNAVAILABLE result with all numeric fields null. Never fabricate values.

**Why these matter:**
- T = DTE/365 is standard BSM calendar convention; using 252 would systematically understate T for all maturities.
- _brand guards prevent accidental use in order flows — this is a permanent invariant (Invariant C1).
- getHistoricalBars returning HistoricalBarsResult (not the bars array directly) caused a TypeScript error that needs `.bars` extraction.

## Files

- `shared/theoretical-options-types.ts` — all canonical types and disclosures
- `server/services/theoretical-options/risk-free-rate.ts` — isolated rate module
- `server/services/theoretical-options/realized-volatility.ts` — HV10–90 wrapper
- `server/services/theoretical-options/black-scholes.ts` — BSM + 5 Greeks
- `server/services/theoretical-options/strike-grid.ts` — hypothetical strike grid
- `server/services/theoretical-options/theoretical-options-research-service.ts` — orchestration
- `server/routes/theoretical-options.ts` — API routes
- `client/src/components/theoretical-options/TheoreticalOptionsPanel.tsx` — UI
- `server/__tests__/theoretical-options-math.test.ts` — 62 math tests
- `server/__tests__/theoretical-options-product.test.ts` — 23 product tests
