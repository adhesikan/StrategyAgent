# Doc 49 — Audit C: Broker-Independent Options Data & Analytics

**Sprint 2.8.7 Architecture Audit — Read-Only**  
**Date:** 2026-08-17  
**Status:** COMPLETE — No application code changed  
**Depends on:** [Doc 47 — Audit A](47-audit-a-broker-gate-inventory.md), [Doc 48 — Audit B](48-audit-b-preflight-layering.md)

---

## 1. Existing Options Architecture

### 1.1 Components and Data Flow (Current)

```
User requests options research
        │
        ├── Options Strategy Matching (BROKER_INDEPENDENT ✓)
        │     server/services/options-strategy-matching-service.ts
        │     Inputs: TradePlanningContext (from OppIntel + plan)
        │     No external calls — pure deterministic logic
        │
        ├── Options Contract Research (BROKER_REQUIRED today)
        │     server/services/contract-research-service.ts
        │     server/routes/internal-options.ts
        │     ↓
        │     getBrokerConnection() → checks Tradier/TradeStation connected
        │     getOptionExpirations() → live broker call (Tradier/TradeStation)
        │     getOptionChain() per expiration → live broker call
        │     normalizeOptionChainContract() → NormalizedOptionContract
        │     → filter by DTE, liquidity, moneyness, event rules
        │     → ExpirationResearchCandidate + ContractResearchCandidate
        │
        └── Trade Risk & Scenario Analysis (BROKER_INDEPENDENT ✓)
              server/services/trade-risk-scenario-service.ts
              Inputs: stored legs (strike, premium, type, role) from plan
              No external calls — pure deterministic, intrinsic-value based
              probabilityMetricsEnabled: false (literal type, permanent)
```

### 1.2 External Data Fields — Current Inventory

| Field | Current Provider | Call Site | Notes |
|---|---|---|---|
| Option expirations list | Tradier / TradeStation (broker) | `internal-options.ts:167` | 409 when no broker |
| Option chain (all strikes, one expiry) | Tradier / TradeStation (broker) | `internal-options.ts:188` | 409 when no broker |
| `bid` | Broker chain | `normalizeOptionChainContract()` | null-safe |
| `ask` | Broker chain | `normalizeOptionChainContract()` | null-safe |
| `mark` | Calculated (bid+ask)/2 | `normalizeOptionChainContract()` | independent already |
| `volume` | Broker chain | `normalizeOptionChainContract()` | null-safe |
| `openInterest` | Broker chain | `normalizeOptionChainContract()` | null-safe |
| `impliedVolatility` | Broker chain (`greeks.mid_iv`) | `normalizeOptionChainContract()` | from Tradier Greeks |
| `delta` | Broker chain (`greeks.delta`) | `normalizeOptionChainContract()` | from Tradier Greeks |
| `gamma` | Broker chain (`greeks.gamma`) | `normalizeOptionChainContract()` | from Tradier Greeks |
| `theta` | Broker chain (`greeks.theta`) | `normalizeOptionChainContract()` | from Tradier Greeks |
| `vega` | Broker chain (`greeks.vega`) | `normalizeOptionChainContract()` | from Tradier Greeks |
| Underlying price | Broker quote (exec path) / Twelve Data bar (planning path) | dashboard, home-snapshot | Twelve Data already available |

### 1.3 What Is Already Calculated Internally

| Metric | Where | Independent? |
|---|---|---|
| `mark` (bid+ask midpoint) | `normalizeOptionChainContract()` | ✓ |
| Moneyness classification (ATM/ITM/OTM) | `contract-research-service.ts:182` | ✓ — needs underlying price |
| Strike distance % | `contract-research-service.ts:189` | ✓ — needs underlying price |
| Liquidity quality (STRONG/ACCEPTABLE/LIMITED/POOR) | `contract-research-service.ts:198–207` | ✓ — from bid/ask/OI/volume |
| Expiration IV summary (median/min/max) | `contract-research-service.ts:267` | ✓ — from chain IV values |
| DTE calculation | `contract-research-service.ts` | ✓ |
| Event relation (earnings window) | `contract-research-service.ts` | ✓ — from stored event data |
| Breakeven, max gain, max loss | `trade-risk-scenario-service.ts` | ✓ — from stored premiums |
| Scenario P/L at expiration (intrinsic) | `trade-risk-scenario-service.ts` | ✓ |
| Delta approximation (pre-expiration) | `trade-risk-scenario-service.ts` | ✓ — clearly labeled |
| ATR (14-period) | `server/engine/indicators.ts:58` | ✓ — from stored OHLCV |

### 1.4 What Is Currently Stored/Cached

- Daily OHLCV bars: `market_data_bars` DB table (Twelve Data ingested)
- Opportunity scan results: `opportunity_scan_snapshots` DB table
- Trade Plan structure snapshot: `trade_plans.structureSnapshot` JSONB
- Risk snapshot: `trade_plans.riskSnapshot` JSONB (includes leg premiums/strikes)
- Contract research chain: short-lived in-memory cache (2-minute TTL per userId:symbol:expiration)
- No persistent options chain storage currently

---

## 2. Options Data Taxonomy

| Metric | Class | Broker Required Today | Broker Required in Principle |
|---|---|---|---|
| Historical volatility (10/20/30/60/90d) | **A. UNDERLYING-DERIVED** | No | No |
| Realized volatility | **A. UNDERLYING-DERIVED** | No | No |
| ATR | **A. UNDERLYING-DERIVED** | No | No |
| Support/resistance levels | **A. UNDERLYING-DERIVED** | No | No |
| EMA structure | **A. UNDERLYING-DERIVED** | No | No |
| VCP pattern characteristics | **C. VCP-DERIVED** | No | No |
| Expected underlying price range (HV-based) | **A. UNDERLYING-DERIVED** | No | No |
| Option expirations list | **B. OPTION-MARKET-OBSERVED** | Yes | No (independent provider) |
| Option bid/ask/last | **B. OPTION-MARKET-OBSERVED** | Yes | No (independent provider) |
| Volume, open interest | **B. OPTION-MARKET-OBSERVED** | Yes | No (independent provider) |
| Implied volatility (from market chain) | **B. OPTION-MARKET-OBSERVED** | Yes | No (independent provider / VCP calculation) |
| Provider Greeks (delta/gamma/theta/vega) | **B. OPTION-MARKET-OBSERVED** | Yes | No (can model; provider optional) |
| Mark/midpoint | **C. VCP-DERIVED** | No | No — calculated from bid+ask |
| Moneyness | **C. VCP-DERIVED** | No | No — from strike + underlying |
| Liquidity quality classification | **C. VCP-DERIVED** | No | No — from bid/ask/OI/volume |
| Breakeven calculations | **C. VCP-DERIVED** | No | No — from strikes + premiums |
| Max gain / max loss | **C. VCP-DERIVED** | No | No — from strategy structure |
| Scenario P/L table | **C. VCP-DERIVED** | No | No — intrinsic value |
| Model Greeks (from IV) | **C. VCP-DERIVED** | No | No — Black-Scholes (labeled MODEL_) |
| IV (calculated from observed premium) | **C. VCP-DERIVED** | No | No — numerical solver needed |
| Expected move (IV-based) | **C. VCP-DERIVED** | No | No — from IV + DTE |
| Actual positions (shares owned) | **D. ACCOUNT/BROKER-SPECIFIC** | Yes | Yes — account data |
| Live buying power / cash | **D. ACCOUNT/BROKER-SPECIFIC** | Yes | Yes — account data |
| Options trading permissions | **D. ACCOUNT/BROKER-SPECIFIC** | Yes | Yes — account data |
| Order execution validation | **D. ACCOUNT/BROKER-SPECIFIC** | Yes | Yes — execution |

---

## 3. Underlying-Derived Metrics

All of the following can be calculated from stored OHLCV bars (Twelve Data, already in DB):

### 3.1 Historical / Realized Volatility

| Metric | Required Inputs | Formula | Assumptions | Production Use | Label |
|---|---|---|---|---|---|
| HV-N (rolling N-day) | N daily closing prices | σ = std(log(Pt/Pt-1)) × √252 × 100 | Log-normal returns, 252 trading days | ✓ Research | `HISTORICAL_VOLATILITY_Nd` |
| HV-10, HV-20, HV-30, HV-60, HV-90 | 10–90 daily closes | Same formula, varying window | Same | ✓ | `HV_10`, `HV_20`, etc. |
| Realized vol (monthly) | ~21 days of closes | Same | Same | ✓ | `REALIZED_VOL_21D` |

**Confidence:** High for daily bars. **Limitation:** Cannot capture intraday gaps or overnight moves.

### 3.2 ATR

| Required Inputs | Formula | Production Use | Label |
|---|---|---|---|
| Daily OHLC, 14-period default | True range average | ✓ Already implemented (`indicators.ts:58`) | `ATR_14` |

### 3.3 Expected Underlying Price Range

| Metric | Inputs | Formula | Label | Required User-Facing Disclaimer |
|---|---|---|---|---|
| 1-sigma price range (N days) | HV, underlying price, DTE | `S × HV × √(DTE/252)` | `EXPECTED_RANGE_1SD` | "Model estimate. Based on historical volatility. Not a forecast." |
| 2-sigma range | same | `S × 2 × HV × √(DTE/252)` | `EXPECTED_RANGE_2SD` | Same |

**Never presented as a prediction.** Label: "Historical-vol based range estimate."

### 3.4 Model Option Value (Black-Scholes, underlying-only mode)

When no IV is available from an observed market price, a model value can be estimated using HV as the volatility input:

| Required Inputs | Model | Limitation | Label |
|---|---|---|---|
| S (underlying price), K (strike), T (DTE/252), r (risk-free rate, hardcoded default), σ (HV), q (dividend yield, optional) | Black-Scholes European | American options may differ; dividend yield approximated; not an executable quote | `MODEL_VALUE` |

**MUST NOT be presented as a market price or executable mid.** Display: "Theoretical value (HV model). Not a market quote."

### 3.5 Model Greeks (Underlying-Only Mode)

Using Black-Scholes with HV as volatility input:

| Greek | Formula (BS) | Label | Compliance Note |
|---|---|---|---|
| Delta | N(d1) for call; N(d1)−1 for put | `MODEL_DELTA` | "Model estimate. Not market-observed delta." |
| Gamma | n(d1) / (S × σ × √T) | `MODEL_GAMMA` | Same |
| Theta | -(S × n(d1) × σ) / (2√T) − ... | `MODEL_THETA` | Same |
| Vega | S × n(d1) × √T × (1/100) | `MODEL_VEGA` | Same |
| Rho | K × T × e^(-rT) × N(d2) × (1/100) | `MODEL_RHO` | Same |

**Modeled Greeks must NEVER be presented as market-observed Greeks.** The `greekSource` field (§8) enforces this.

---

## 4. Option-Market-Observed Minimum Fields

From the current `NormalizedOptionContract` and contract-research-service analysis, the minimum required observed fields are:

### 4.1 Required (Cannot Be Derived Without Observation)

| Field | Why Required |
|---|---|
| `contractSymbol` | OCC symbol for expiry/strike/type identification |
| `expiration` | DTE calculation, event-window filtering |
| `strike` | Moneyness, breakeven, payoff |
| `type` | call / put |
| `bid` | Spread calculation, liquidity quality, midpoint |
| `ask` | Same |
| `volume` | Liquidity quality |
| `openInterest` | Liquidity quality |
| `quoteTimestamp` | Freshness validation — must not be omitted |

### 4.2 Optional (Can Be Derived or Omitted)

| Field | If Missing, VCP Can… |
|---|---|
| `last` | Use midpoint from bid/ask |
| `impliedVolatility` (provider IV) | Calculate via internal IV solver (§7) |
| `delta` | Calculate via Black-Scholes with solved IV |
| `gamma` | Same |
| `theta` | Same |
| `vega` | Same |
| `tradeTimestamp` | Omit from freshness display |

**Goal: buy raw bid/ask/OI/volume observations; calculate intelligence ourselves.**

---

## 5. VCP-Derived Metrics from Minimal Independent Feed

Given only: `expiration, strike, type, bid, ask, last, volume, openInterest` + underlying price:

| Metric | Can VCP Calculate? | Method | Notes |
|---|---|---|---|
| Midpoint | ✓ | `(bid + ask) / 2` | Already in `normalizeOptionChainContract()` |
| Spread % | ✓ | `(ask − bid) / midpoint` | Already in liquidity classification |
| Liquidity tier | ✓ | STRONG/ACCEPTABLE/LIMITED/POOR thresholds | Already in `contract-research-service.ts` |
| IV (from midpoint) | ✓ | Internal numerical solver (§7) | Requires underlying price + risk-free rate |
| Delta (from solved IV) | ✓ | Black-Scholes `N(d1)` | Labeled `MODEL_DELTA` |
| Gamma | ✓ | BS formula | Labeled `MODEL_GAMMA` |
| Theta | ✓ | BS formula | Labeled `MODEL_THETA` |
| Vega | ✓ | BS formula | Labeled `MODEL_VEGA` |
| Rho | ✓ | BS formula | Labeled `MODEL_RHO` |
| Breakeven | ✓ | Strike ± midpoint | Already in `trade-risk-scenario-service.ts` |
| Max profit | ✓ | Strategy-specific formulas | Already implemented |
| Max loss | ✓ | Strategy-specific formulas | Already implemented |
| Multi-leg debit/credit | ✓ | Sum of leg premiums × sign | Already implemented |
| Spread economics (width, net cost/credit) | ✓ | Strike differential ± net premium | Already implemented |
| Scenario P/L at expiration | ✓ | Intrinsic value at N price points | Already in `trade-risk-scenario-service.ts` |
| Expected move (IV-based) | ✓ | `S × IV × √(DTE/252)` | Requires solved IV |
| Contract quality classification | ✓ | Liquidity + moneyness + spread | Already implemented |
| Strategy-family analytics | ✓ | All 17 families already in service | Already implemented |

**Key finding:** VCP already implements most of these. The missing piece is only: (a) the IV solver and (b) the Black-Scholes Greeks calculator.

**Existing engines NOT to duplicate:**
- Strategy-family selection: `options-strategy-matching-service.ts` ✓
- Risk scenarios: `trade-risk-scenario-service.ts` ✓
- Liquidity classification: `contract-research-service.ts` ✓
- Breakeven/payoff: `trade-risk-scenario-service.ts` ✓

---

## 6. Pricing Model Recommendation

### 6.1 Model Choice

| Use Case | Recommended Model | Fallback | Rationale |
|---|---|---|---|
| Research approximation (European-style) | **Black-Scholes (with continuous dividends)** | None needed | Industry standard; transparent; easily labeled |
| American equity options | Black-Scholes (approximation only) | Binomial (if dividend is material) | BS underprices early exercise; label prominently |
| Dividend-paying stocks | BS with continuous dividend yield (q) | Use 0 if yield unavailable | Approximate continuous dividend from annual yield |
| Short-dated (DTE < 7) | BS with caveat; label `SHORT_DTE_WARNING` | None | High theta instability; surface warning |
| Deep ITM/OTM | BS with `LOW_CONFIDENCE` flag | None | Numerics degrade; delta approaches 0 or 1 |

### 6.2 Baseline Parameters

```
Underlying price S:     Twelve Data stored daily bar (last close) — labeled "End-of-day reference price"
Strike K:               From observed chain
Time T:                 DTE / 252
Risk-free rate r:       Hardcoded approximation (e.g., 5.0% or sourced from Fed Funds rate)
                        Label: "Approximate risk-free rate — actual may vary"
Dividend yield q:       From stored fundamental data if available; 0 otherwise
                        Label: "Dividend yield approximated" if used
Volatility σ:           IV solved from market mid, OR HV-30 if no market data
                        Label: "Market-observed IV" vs "Historical volatility (model)"
```

### 6.3 Key Constraints

- **NEVER present model prices as executable market prices.** Midpoint from bid/ask is market-observed; BS value is labeled `MODEL_VALUE`.
- BS values are for **research understanding only** — not for order construction.
- For execution, live broker quote prevails.

---

## 7. Implied Volatility Engine Design

### 7.1 Architecture

```
Inputs:
  S  = underlying price (Twelve Data daily bar — end-of-day)
  K  = strike
  T  = DTE / 252
  r  = risk-free rate (approximated)
  q  = dividend yield (approximated)
  P  = observed option price (midpoint preferred; last as fallback)

Solver:
  Newton-Raphson iteration on Black-Scholes formula
  Initial guess: Brenner-Subrahmanyam approximation σ₀ ≈ √(2π/T) × (P/S)
  Convergence: |BS(σ) − P| < ε = 0.0001
  Max iterations: 100
  Clamp result: σ ∈ [0.001, 20.0] (0.1% to 2000% — extreme tail)

Output:
  { iv: number; quality: IvQuality; note?: string }

IvQuality:
  "CALCULATED"     — solver converged normally
  "LOW_CONFIDENCE" — converged but DTE < 7 OR deep ITM/OTM (moneyness > 50%)
  "UNAVAILABLE"    — input invalid, solver diverged, or mid ≤ 0
```

### 7.2 Input Policies

| Situation | Policy |
|---|---|
| Zero bid, positive ask | Use ask as market price (skews high; label `ASK_ONLY`) |
| Zero bid, zero ask | `UNAVAILABLE` |
| Crossed market (bid > ask) | `UNAVAILABLE` — do not use |
| Last trade instead of mid | Acceptable if mid unavailable; label `LAST_PRICE` |
| No market price at all | `UNAVAILABLE` |
| Missing dividend yield | Use 0; label `NO_DIVIDEND_DATA` |
| Missing risk-free rate | Use hardcoded constant; label `APPROX_RATE` |
| Stale quote (underlying > 1 trading day old) | Proceed with `LOW_CONFIDENCE` |

### 7.3 Output Quality States

```typescript
type IvQuality =
  | "CALCULATED"      // Normal; iv is reliable for research
  | "LOW_CONFIDENCE"  // Usable but should be interpreted cautiously
  | "UNAVAILABLE";    // Do not use
```

**VCP must never zero-fill IV.** Null is the correct representation for unavailable IV.

---

## 8. Greeks Design

### 8.1 Dual-Track Architecture

```typescript
interface GreeksResult {
  // Market-observed (from provider chain — source of truth when available)
  providerGreeks: {
    delta:  number | null;
    gamma:  number | null;
    theta:  number | null;
    vega:   number | null;
    rho?:   number | null;
    iv:     number | null;
  } | null;

  // VCP-calculated (from IV solver + Black-Scholes)
  calculatedGreeks: {
    modelDelta:  number | null;
    modelGamma:  number | null;
    modelTheta:  number | null;
    modelVega:   number | null;
    modelRho?:   number | null;
    modelIv:     number | null;
    ivQuality:   IvQuality;
  } | null;

  // Which to display / use in downstream calculations
  greekSource:
    | "MARKET_PROVIDER"           // providerGreeks used
    | "VCP_IV_MODEL"              // calculatedGreeks used (from market-observed mid)
    | "VCP_REALIZED_VOL_MODEL"    // calculatedGreeks used (HV as σ input)
    | "UNAVAILABLE";

  // What the UI should show for iv
  displayIv: number | null;
  displayDelta: number | null;
}
```

### 8.2 Precedence Rules

```
If providerGreeks.delta !== null AND greekSource === "MARKET_PROVIDER":
    Use providerGreeks for display and calculation
Else if calculatedGreeks.modelDelta !== null AND ivQuality !== "UNAVAILABLE":
    Use calculatedGreeks; label as "MODEL_"
Else:
    Display null; do not fabricate
```

**Critical:** VCP must NEVER silently mix sources — if one leg has provider Greeks and another has model Greeks, both provenance labels must be visible.

### 8.3 When VCP Greeks Are Shown

| Scenario | Greek Source | Label Shown |
|---|---|---|
| Provider chain available | `MARKET_PROVIDER` | "Δ 0.45" (no extra label) |
| Independent chain, IV solved | `VCP_IV_MODEL` | "Δ 0.45 (model)" |
| Independent chain, IV unavailable, HV used | `VCP_REALIZED_VOL_MODEL` | "Δ ~0.45 (hist. vol model)" |
| No chain, HV only | `VCP_REALIZED_VOL_MODEL` | "~Δ 0.43 (theoretical — no market data)" |

---

## 9. Probability Metrics — Compliance Findings

### 9.1 Current Prohibition (Sprint 2.7.4 — PERMANENT)

From `shared/trade-risk-scenario-types.ts`:
```typescript
probabilityMetricsEnabled: false;  // literal type — cannot be overridden
```

From `server/services/trade-risk-scenario-service.ts:8`:
> "PROBABILITY METRICS: OFF (probabilityMetricsEnabled = false always)."

**Permanently prohibited in Trade Risk & Scenario Analysis:**
- Probability of Profit (POP)
- "Chance of winning"
- "Expected return"
- "Recommended trade"
- Any probability-of-outcome framing on the trade decision path

### 9.2 What Is Allowed Elsewhere

The prohibition is on **recommendation-oriented probability language** on the trade decision path. Separately, the research glossary (`shared/research-glossary.ts:1632`) already explains delta's mathematical relationship to moneyness without calling it a probability:

> "Delta is not a probability of profit."

**Neutral statistical context that MAY be permissible on a separate, clearly-labeled "Market Context" research surface** (not on the trade planning path):

| Metric | Permissible? | Required Framing |
|---|---|---|
| Historical distribution of underlying returns | ✓ Likely — statistical education | "Historical distribution of returns. Not a forecast or recommendation." |
| Modeled probability underlying ≥ strike at expiry (normal distribution) | ⚠ FLAG for compliance review | Could be misread as POP even with neutral framing |
| "N(d2)" from Black-Scholes | ⚠ FLAG — this IS the risk-neutral probability | Must not be surfaced as "probability of profit" |
| Expected move range | ✓ If framed as "historical volatility range" | "Based on historical price behavior. Not a price forecast." |

**Recommendation:** Flag `N(d2)` and any form of "probability options finish ITM" for explicit compliance review before surfacing. Do not implement until cleared. The existing prohibition covers the execution path; the research path requires a separate compliance decision.

---

## 10. Twelve Data Options Capability

### 10.1 Current Integration Audit

From `server/services/daily-market-data/`:

| File | What It Does | Options? |
|---|---|---|
| `twelve-data-client.ts` | Fetches daily OHLCV bars | **No options endpoints found** |
| `realtime-quote.ts` | Fetches real-time price quote for a symbol | **Equity only — no options** |
| `indicators.ts` | ATR and other technical indicators | **No options** |
| `config.ts` | License mode, API key, rate limits | **No options config** |
| `ingestion.ts` | Daily bar ingestion scheduler | **No options** |

**Conclusion: Twelve Data is integrated only for equity OHLCV bars and real-time equity quotes. No options endpoints are currently used or configured.**

### 10.2 Twelve Data Options API — Questions for External Verification

Twelve Data has documented an options API. The following questions must be answered with an account holder / support inquiry before integration planning:

| Question | Required Answer |
|---|---|
| Does the current Twelve Data plan/tier include options data? | Yes / No / Which tier? |
| Available endpoints: `/v1/options/expirations`? | Yes / No |
| Available endpoints: `/v1/options/chain`? | Yes / No |
| Chain fields: bid, ask, last, volume, open interest? | Confirm field names |
| Chain fields: implied volatility (provider-calculated)? | Yes / No |
| Chain fields: Greeks (delta, gamma, theta, vega)? | Yes / No |
| Real-time vs delayed? Which delay (15/20 min)? | Confirm |
| Historical options data? | Yes / No |
| **Commercial use / SaaS redistribution rights?** | Must confirm — this is the critical gate |
| Per-user display rights? | Confirm |
| Caching / local storage allowed? | Confirm duration |
| Rate limits for options endpoints? | Credits per call, per minute |

**Until all of the above are confirmed, Twelve Data cannot be designated as the independent options provider.** The architecture design below uses a provider-neutral interface (§11) so any confirmed provider can be plugged in.

### 10.3 Other Independent Provider Candidates (Not Evaluated)

The following are publicly known options data providers that could be evaluated as alternatives if Twelve Data does not meet requirements. **No integration assessment has been performed on any of these.**

| Provider | Known for |
|---|---|
| Polygon.io | Options chain, greeks, OI — has explicit SaaS distribution licensing |
| Market Data App | Options chains, real-time/delayed |
| CBOE DataShop | Official exchange data |
| IEX Cloud | Options data (limited) |
| Alpaca Markets | Options data for US equities |

**Selection criterion:** Must explicitly permit commercial redistribution to end users; must provide bid/ask/OI/volume at minimum; must have a latency and rate-limit profile compatible with VCP's use case.

---

## 11. Independent Options Provider Interface

Provider-neutral interface. No Tradier/TradeStation-specific types leak into downstream services.

```typescript
// Canonical independent options provider interface
// All providers (Twelve Data, Polygon, etc.) must implement this

interface IndependentOptionQuote {
  contractSymbol:   string;          // OCC format: AAPL230120C00150000
  underlying:       string;          // "AAPL"
  expiration:       string;          // YYYY-MM-DD
  strike:           number;
  type:             "call" | "put";

  // Market observations — null if unavailable, NEVER zero-filled
  bid:              number | null;
  ask:              number | null;
  last:             number | null;
  volume:           number | null;
  openInterest:     number | null;
  quoteTimestamp:   string | null;   // ISO 8601; NEVER substitute fetch time

  // Optional provider-supplied fields
  providerIv?:      number | null;   // Provider-calculated IV (not always available)
  providerDelta?:   number | null;
  providerGamma?:   number | null;
  providerTheta?:   number | null;
  providerVega?:    number | null;
  tradeTimestamp?:  string | null;   // Last actual trade time (may differ from quote)

  // Provenance
  providerName:     string;          // "twelve_data" | "polygon" | etc.
  retrievedAt:      string;          // ISO 8601 — when VCP fetched this
  delayedByMinutes: number | null;   // 0 = real-time; 15 = standard delayed; null = unknown
}

// Interface a provider adapter must implement
interface IndependentOptionsProvider {
  getOptionExpirations(symbol: string): Promise<string[]>;
  getOptionChain(symbol: string, expiration: string): Promise<IndependentOptionQuote[]>;
  getOptionQuote(contractSymbol: string): Promise<IndependentOptionQuote | null>;
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; note?: string }>;
}
```

**Existing `NormalizedOptionContract` (from `live-contract-resolver.ts`) maps cleanly to this interface** — the independent provider adapter would produce the same `NormalizedOptionContract` shape used by `contract-research-service.ts` today, making the broker-path and independent-path interchangeable downstream.

---

## 12. Data Provenance

Every displayed options value must carry provenance. Proposed canonical provenance shape:

```typescript
interface OptionsDataProvenance {
  provider:           string;        // "tradier" | "twelve_data" | "polygon" | "vcp_model"
  observedAt:         string | null; // When market quote was timestamped (from quoteTimestamp)
  retrievedAt:        string;        // When VCP fetched from provider
  marketSession:      "regular" | "pre_market" | "after_hours" | "closed" | "unknown";
  delayedByMinutes:   number | null; // 0 = real-time; >0 = delayed
  quality:
    | "REAL_TIME"
    | "DELAYED"
    | "END_OF_DAY"
    | "STALE"
    | "MODELED"
    | "UNAVAILABLE";
  calculationMethod?: string;        // e.g. "black_scholes_mid_iv" for model Greeks
  derivedFrom?:       string[];      // e.g. ["bid", "ask", "underlying_close"]
}
```

### 12.1 UI Display Examples

```
Bid/Ask: $2.10 / $2.20
  Provider: Twelve Data  |  Observed: 10:32:14 ET  |  Delayed 15min

IV: 42.3%
  Source: VCP calculated from midpoint  |  Method: Black-Scholes Newton-Raphson

Delta: 0.43 (model)
  Source: VCP Black-Scholes  |  Volatility input: calculated IV  |  Theoretical — not market-observed

Delta: 0.45
  Source: Twelve Data provider  |  Observed: 10:32:14 ET
```

---

## 13. Freshness Model

Options data requires different freshness thresholds than equity quotes:

| Data Type | Research OK | Planning OK | Execution-Grade Required | Staleness Threshold |
|---|---|---|---|---|
| Underlying price (equity quote) | ≤ 1 trading day (daily bar) | ≤ 1 trading day | ≤ 60s (live broker) | `DAILY_BAR_MODE` vs `LIVE_QUOTE_MODE` |
| Option bid/ask | ≤ 15 min delayed | ≤ 1h for strategy research | ≤ 60s (execution) | `OPTION_QUOTE_STALE_RESEARCH` = 3600s |
| Option last trade | ≤ 1 day | ≤ 1 day | N/A (use bid/ask) | `OPTION_LAST_STALE` = 86400s |
| Volume (daily) | ≤ 1 day | ≤ 1 day | ≤ 1 day | `delayedByDesign: true` |
| Open interest | ≤ 1 day (OI is end-of-day) | ≤ 1 day | ≤ 1 day | `OI_FRESHNESS = "DAILY_BY_DESIGN"` |
| Provider IV | ≤ 15 min | ≤ 1h | ≤ 60s | Same as bid/ask |
| Provider Greeks | ≤ 15 min | ≤ 1h | ≤ 60s | Same as bid/ask |
| Calculated IV (from mid) | Matches mid freshness | Same | N/A for execution | Same as bid/ask |
| Model Greeks (from calc IV) | Matches IV freshness | Same | N/A | Same |

**Key rules:**
- Open interest is **`delayedByDesign`** — it is an end-of-day exchange figure. Must NOT be marked stale using quote-level thresholds.
- For research: delayed bid/ask (15 min) is acceptable. Surface `DELAYED_DATA` badge clearly.
- For execution: only live broker quote (≤ 60s) is acceptable. Independent data is not execution-grade.

---

## 14. Options Contract Research — Independent Mode Flow

**Proposed broker-independent flow for Sprint 2.8.7+:**

```
User requests options contract research for a symbol
        │
        ├── [1] Get underlying reference price
        │     → Twelve Data daily bar (already in DB)
        │     → Label: "End-of-day reference price"
        │
        ├── [2] Get option expirations
        │     → Independent provider (Twelve Data options or equivalent)
        │     → If unavailable: "Live contract data not currently available"
        │     → Filter: DTE thresholds + earnings window rules
        │
        ├── [3] Get option chain per candidate expiration
        │     → Independent provider → IndependentOptionQuote[]
        │     → Normalize to NormalizedOptionContract (existing function)
        │
        ├── [4] VCP filtering (all existing logic — no broker needed)
        │     → Liquidity filter (bid/ask/OI/volume)
        │     → Moneyness filter (strike vs underlying)
        │     → Event window filter (earnings exclusion)
        │     → DTE bucket classification
        │
        ├── [5] VCP IV calculation (new module)
        │     → Solve IV for each contract from midpoint
        │     → Attach IvQuality + provenance
        │
        ├── [6] VCP Greeks calculation (new module)
        │     → Black-Scholes from solved IV
        │     → Label as MODEL_DELTA, MODEL_GAMMA, etc.
        │
        ├── [7] Candidate structure assembly
        │     → ExpirationResearchCandidate (existing type)
        │     → ContractResearchCandidate (existing type)
        │     → All provenance fields attached
        │
        └── [8] Result returned to client
              → Full contract research with provenance labels
              → BROKER_NOT_CONNECTED note on execution section only
```

**What broker still adds (BROKER_ENHANCED path):**
- Live bid/ask within execution freshness window (≤ 60s)
- Live Greeks from market maker models
- Actual options permissions verification
- Live buying power
- Actual position confirmation (covered call, protective put)

---

## 15. Covered Call / Protective Put Ownership Model

### 15.1 Ownership States

```typescript
type OwnershipConfirmationState =
  | "OWNERSHIP_CONFIRMED_BROKER"     // Live broker positions API confirmed ≥ 100 shares
  | "OWNERSHIP_CONFIRMED_PORTFOLIO"  // User's stored/imported portfolio shows ≥ 100 shares
  | "OWNERSHIP_NOT_CONFIRMED";       // No confirmation source available
```

### 15.2 Research vs Execution

| State | Allowed Research | Allowed Execution |
|---|---|---|
| `OWNERSHIP_CONFIRMED_BROKER` | ✓ Full research | ✓ (subject to full execution preflight) |
| `OWNERSHIP_CONFIRMED_PORTFOLIO` | ✓ Full research with disclosure | ✗ — Must confirm via broker before execution |
| `OWNERSHIP_NOT_CONFIRMED` | ✓ Research with "Requires 100 shares per contract" disclosure | ✗ — Blocked |

**OWNERSHIP_NOT_CONFIRMED must NEVER silently become a naked-call research path.** The research display must state: "This strategy requires 100 underlying shares per contract at execution. Ownership not confirmed."

### 15.3 Manual Portfolio as Ownership Source

If a user has imported a portfolio (CSV/XLSX) showing ≥ 100 shares of the underlying:
- State: `OWNERSHIP_CONFIRMED_PORTFOLIO`
- Research unlocked with disclosure: "Based on your imported portfolio. Verify actual holdings with your broker before execution."
- Execution: BLOCKED until broker confirms live position

---

## 16. Cash-Secured Put — Brokerless Research Model

### 16.1 What Can Be Calculated Without Broker

| Calculation | Independent? | Method |
|---|---|---|
| Cash obligation per contract | ✓ | `strike × 100` |
| Premium-adjusted effective entry | ✓ | `strike − mid_premium` |
| Max loss (underlying → 0) | ✓ | `(strike − premium) × 100` per contract |
| Breakeven price | ✓ | `strike − net_premium` |
| Scenario P/L at expiration | ✓ | Intrinsic value calculation (already in risk-scenario-service) |
| Annualized return on collateral (if assigned) | ✓ | `(premium / strike) × (365 / DTE)` |

### 16.2 Research vs Execution Distinction

| Mode | What's Available |
|---|---|
| Research (brokerless) | All calculations above; "Requires $K × 100 in available cash per contract for execution" |
| Research (with portfolio) | Can check if portfolio shows adequate cash/equity (approximate) |
| Execution | Live buying power check required; broker must confirm cash-secured designation |

---

## 17. Long Options — Brokerless Research Capability

**Long Call and Long Put** have the fewest constraints in independent mode:

| Dimension | Independent? | Notes |
|---|---|---|
| Strategy family matching | ✓ | Already BROKER_INDEPENDENT |
| Expiration selection | ✓ | If independent chain available |
| Strike selection / moneyness | ✓ | From chain + underlying price |
| Premium cost | ✓ | From market bid/ask/mid |
| Max loss | ✓ | `premium × 100` per contract |
| Max gain | ✓ | Long call: unlimited (underlying → ∞); Long put: substantial downside |
| Breakeven | ✓ | Strike ± premium |
| Scenario P/L | ✓ | Already in risk-scenario-service |
| IV research | ✓ | Solved from midpoint |
| Model Greeks | ✓ | From solved IV via BS |
| Positions required | None | NOT_APPLICABLE |
| Cash obligation | ✓ | `premium × 100` — already calculable |
| Permissions | Not needed for research | Needed for execution only |
| Buying power check | Not needed for research | Execution only |

**Conclusion:** Long calls and long puts are **near-fully independent** for research if an independent options chain is available. The only broker-required elements are execution-specific.

---

## 18. Vertical Spreads — Brokerless Research Capability

All four vertical spreads (Bull Call, Bear Put, Bull Put, Bear Call):

| Metric | Independent? | Method |
|---|---|---|
| Net debit (debit spreads) | ✓ | Long leg mid − short leg mid |
| Net credit (credit spreads) | ✓ | Short leg mid − long leg mid |
| Spread width | ✓ | Strike differential |
| Max gain | ✓ | Width − net debit (debit); credit received (credit) |
| Max loss | ✓ | Net debit (debit); width − credit (credit) |
| Breakeven | ✓ | Defined by strikes and net premium |
| Scenario P/L | ✓ | Already in risk-scenario-service |
| Multi-leg net mid | ✓ | Sum of signed leg mids |
| Liquidity (per leg) | ✓ | Existing STRONG/ACCEPTABLE/LIMITED/POOR |
| Net Greeks | ✓ | Sum of signed leg Greeks (model) |
| Permissions for research | None | Execution: spread permissions needed |
| Positions required | None | NOT_APPLICABLE for debit spreads; short put may need cash/margin for credit |

**Conclusion:** All four vertical spreads are **fully researchable without a broker** given an independent chain.

---

## 19. Neutral / Complex Strategies — Brokerless Capability

### 19.1 Summary Table (All 17 Canonical Families)

| Strategy | Positions Required for Research | Broker Needed for Research | Notes |
|---|---|---|---|
| Long Call | None | No | Fully independent ✓ |
| Long Put | None | No | Fully independent ✓ |
| Bull Call Spread | None | No | Fully independent ✓ |
| Bear Put Spread | None | No | Fully independent ✓ |
| Bull Put Spread | None | No | Fully independent ✓ |
| Bear Call Spread | None | No | Fully independent ✓ |
| Covered Call | 100 shares (ownership state) | No (research); broker for exec | `OWNERSHIP_CONFIRMED_PORTFOLIO` path |
| Cash-Secured Put | Cash adequate (not verified) | No (research) | Show cash obligation; broker for exec |
| Protective Put | Underlying shares (ownership) | No (research) | Same as covered call |
| Collar | Underlying shares (ownership) | No (research) | Same as covered call |
| Iron Condor | None | No | 4 legs; all from chain |
| Iron Butterfly | None | No | 4 legs; all from chain |
| Long Straddle | None | No | 2 legs; ATM call + put |
| Long Strangle | None | No | 2 legs; OTM call + put |
| Calendar Spread | None | No (research, 2 expirations) | Requires 2 expiry chain fetches |
| Diagonal Spread | None | No (research) | 2 expirations, different strikes |
| Monitor Only | None | No | No contract action |

**Calendar and Diagonal:** Require fetching chains for two different expirations. This is a data-volume concern (2× chain fetches) but not a broker requirement.

---

## 20. Provider Fallback Hierarchy

```
1. PRIMARY INDEPENDENT OPTIONS PROVIDER
   └─ Twelve Data options (if plan + rights confirmed by Audit C.10.2 verification)
       OR Polygon.io or other confirmed provider
   └─ Real-time or delayed bid/ask/OI/volume
   └─ Provider IV + Greeks if available; otherwise VCP calculates

2. BROKER PROVIDER (if user has connected Tradier or TradeStation)
   └─ Live chain via existing internal-options routes
   └─ Used when: no independent provider available, OR broker connected + execution path
   └─ Broker data enhances; does NOT replace independent data unnecessarily

3. UNDERLYING-ONLY MODE (no chain available from any source)
   └─ Strategy matching only (already works ✓)
   └─ HV-based expected move approximation
   └─ Model option value from HV (labeled: no market observations)
   └─ Risk scenarios from stored plan data (already works ✓)
   └─ Display: "Live contract market data is not currently available."
              "Strategy research and scenario analysis are still available."

RULES:
- Never silently substitute modeled option premiums for observed contract prices
- Provider enrichment order: independent provider > broker provider
- Broker does not replace independent data; it enhances with live quote + account context
- For execution: broker live quote always takes precedence (execution-grade freshness)
```

---

## 21. No-Broker UX Design

### 21.1 When Independent Chain Available

```
OPTIONS RESEARCH
  AAPL — Long Call

  Contract Research              Strategy Research
  ─────────────────────────────  ──────────────────────────
  [Expiration picker]            Thesis: Bullish
  [Strike selector]             DTE guidance: 30–90 days
  [Contract table]              Risk characteristics: ...

  Data: Twelve Data (delayed 15min)    [i]

  ────────────────────────────────────────────────────────
  [Risk & Scenario Analysis]
  Max loss: $250  |  Breakeven: $152.50  |  DTE: 45
  ────────────────────────────────────────────────────────

  Execution requires a connected broker.
  [Connect Broker — Optional]
```

### 21.2 When No Chain Available (Underlying-Only Mode)

```
OPTIONS RESEARCH
  AAPL — Long Call

  Live contract market data is not currently available.
  Strategy analysis and scenarios are shown using end-of-day
  reference data and model estimates.

  Strategy Research (from underlying data)
  Expected move (30d HV): ±$8.40 per share
  Model value (theoretical): ~$3.20 — not a market quote

  Risk & Scenario Analysis
  Using manually entered or stored contract parameters.
```

**Never:** "Connect your broker to view options." — broker is not the requirement; a data provider is.

---

## 22. Broker-Connected UX

When broker connected:
- Contract research runs via existing broker chain path (live, execution-grade freshness)
- Independent data is NOT discarded — it may be shown as a reference / second opinion
- Provider precedence for execution path: broker live quote > independent delayed quote
- Account context (positions, buying power, permissions) enriches research
- Ownership states: `OWNERSHIP_CONFIRMED_BROKER` enables covered strategies

```
OPTIONS RESEARCH
  AAPL — Covered Call

  ✓ 200 shares confirmed (Tradier)     ✓ Strategy available with current holdings

  Contract Research             |  Account Context
  Live chain: Tradier           |  Shares owned: 200
  Quote age: 12s                |  Buying power available
                                |  Options permission: Level 1 ✓

  [Risk & Scenario Analysis]
  [Prepare for Execution]  ← only when plan is saved + preflight passes
```

---

## 23. Licensing / Redistribution Requirements Checklist

Any independent options provider must be verified against all of the following before integration:

| Requirement | Status for Twelve Data | Status for Alternative |
|---|---|---|
| Commercial SaaS use permitted | **VERIFY** | **VERIFY** |
| Display rights (per-user display of bid/ask) | **VERIFY** | **VERIFY** |
| Redistribution rights (serving data to end users) | **VERIFY** | **VERIFY** |
| Derived data rights (display of VCP-calculated IV/Greeks) | **VERIFY** | **VERIFY** |
| Real-time data commercial use (if required) | **VERIFY** | **VERIFY** |
| Delayed data commercial use | **VERIFY** | **VERIFY** |
| Historical options data storage | **VERIFY** | **VERIFY** |
| Caching duration permitted | **VERIFY** | **VERIFY** |
| Per-user display (not just aggregate) | **VERIFY** | **VERIFY** |
| API rate limits compatible with VCP scan cadence | **VERIFY** | **VERIFY** |
| Attribution requirements | **VERIFY** | **VERIFY** |

**Current Twelve Data equity license status:** `TWELVE_DATA_LICENSE_MODE` controls display. The existing equity license explicitly gates display via `TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED`. The same gating mechanism must be extended to any options data use.

**None of the above may be assumed.** Licensing verification is a prerequisite for implementation of any independent options data integration.

---

## 24. Minimum Independent Options Feed Specification

### 24.1 Required Fields (Minimum Viable Integration)

```typescript
// Minimum required per contract
{
  symbol:           string;          // "AAPL"
  contractSymbol:   string;          // OCC symbol
  expiration:       string;          // YYYY-MM-DD
  strike:           number;          // e.g. 150.0
  type:             "call" | "put";
  bid:              number | null;   // null if no market maker
  ask:              number | null;   // null if no market maker
  last:             number | null;   // last trade price
  volume:           number | null;   // daily volume
  openInterest:     number | null;   // end-of-day OI
  quoteTimestamp:   string | null;   // ISO 8601 (MUST NOT be substituted with fetch time)
}
```

### 24.2 Optional Fields (Enhancement)

```typescript
{
  impliedVolatility?: number | null;  // Provider-calculated IV
  delta?:             number | null;  // Provider-calculated delta
  gamma?:             number | null;
  theta?:             number | null;
  vega?:              number | null;
  tradeTimestamp?:    string | null;  // Last actual trade time
  openPrice?:         number | null;  // Opening premium
}
```

**If optional fields are absent, VCP calculates them internally (§5) with appropriate provenance labels.**

### 24.3 Required Expiration Endpoint

```
getOptionExpirations(symbol) → string[]  // Array of YYYY-MM-DD
```

### 24.4 Quality Expectations

- Minimum: 15-minute delayed data for research
- Chain coverage: all listed strikes for a given expiration
- Update frequency: at minimum every 15 minutes during market hours

---

## 25. Implementation Groups

### Group A — Independent Options Provider Interface

**Scope:** Define `IndependentOptionsProvider` interface; build one adapter (Twelve Data options OR confirmed alternative) once licensing is verified.

**Files:** New `server/services/independent-options-provider.ts`; adapter per provider.

**Prerequisite:** Licensing verification (§23) must be complete.

**Resolves:** BI-GATE-017, BI-GATE-018, CON-002

### Group B — Underlying Volatility & Modeling Engine

**Scope:** Add HV-10/20/30/60/90 calculation from stored daily bars; rolling volatility series; expected-move range using HV.

**Files:** Extend `server/engine/indicators.ts` or new `server/services/volatility-engine.ts`

**Prerequisite:** None — uses existing stored bars.

**Available immediately** (no external provider needed).

### Group C — Internal IV + Greeks Engine

**Scope:** Newton-Raphson IV solver (§7); Black-Scholes Greeks calculator (§8); `GreeksResult` with dual-track provenance.

**Files:** New `server/services/options-pricing-engine.ts`; types in `shared/options-pricing-types.ts`

**Prerequisite:** Group B (for HV as σ fallback).

### Group D — Brokerless Contract Research

**Scope:** Rewire `contract-research-service.ts` to use `IndependentOptionsProvider` as primary source; keep broker path as BROKER_ENHANCED secondary; remove 409 NO_BROKER; resolve BI-GATE-017/018.

**Files:** `server/services/contract-research-service.ts`, `server/routes/internal-options.ts`

**Prerequisite:** Group A (provider adapter) + Group C (IV/Greeks for enrichment).

### Group E — Ownership / Capital Context

**Scope:** `OwnershipConfirmationState` enum; check portfolio (manual/imported) for shares; surface disclosure in covered-call and protective-put research.

**Files:** `server/services/contract-research-service.ts`; portfolio service integration.

**Prerequisite:** None — portfolio data already in DB.

### Group F — Options Data Provenance & Freshness

**Scope:** `OptionsDataProvenance` struct; freshness thresholds per data type (§13); attach to all `NormalizedOptionContract` responses; differentiate OI freshness from quote freshness.

**Files:** `shared/contract-research-types.ts`, `server/services/live-contract-resolver.ts`

**Prerequisite:** None — additive types.

### Group G — UI Brokerless Options Experience

**Scope:** Redesign options research panels to show `INDEPENDENT_MODE` vs `BROKER_ENHANCED` mode; replace "Connect Broker" with "Live contract data not available" when chain is absent; provenance badges; model-Greek labels.

**Files:** `client/src/components/research/structure/live-contract-resolver.tsx`, `client/src/components/research/structure/trade-structure-engine.tsx`

**Prerequisite:** Group D (so backend can serve independent data).

---

## 26. Safety / Compliance Invariants

The following must be preserved through all implementation:

| Invariant | Source | Enforcement |
|---|---|---|
| No "best contract" selection | `shared/contract-research-types.ts:7` | Strategy family is USER-selected; VCP never auto-selects a contract |
| No "recommended" contract | Same | Forbidden vocabulary in all response labels |
| No POP or probability of profit | `shared/trade-risk-scenario-types.ts:15`; `probabilityMetricsEnabled: false` | Literal type constant — cannot override |
| No automatic strategy substitution | `shared/contract-research-types.ts:7` | User must explicitly select strategy family |
| Covered call/protective put requires ownership confirmation for execution | §15 | `OWNERSHIP_NOT_CONFIRMED` → execution blocked |
| CSP cash obligation required for execution | §16 | Buying power check before execution |
| Modeled values must be labeled | §3, §8 | `MODEL_DELTA`, `MODEL_VALUE`, etc. — not market-observed |
| No fabricated quotes or Greeks | `shared/contract-research-types.ts:7` | Null when unavailable; never zero-fill |
| Midpoint ≠ fill price | `shared/contract-research-types.ts:7` | All displays: "Midpoint — not a fill guarantee" |
| Execution still requires broker layer | §14, Doc 48 | Broker execution readiness still required for order prep |
| N(d2) / probability of finishing ITM | §9.2 | Flagged for compliance review — do not surface until cleared |
| Research data provenance must be transparent | §12 | Every displayed value includes source and quality |

---

## 27. Test Plan

### 27.1 Required Test Suites for Implementation

**Suite 1: Underlying-Only Model Calculations** (`underlying-volatility-engine.test.ts`)
- [ ] HV-10/20/30/60/90 from known OHLC sequence
- [ ] Expected-move range from HV + DTE
- [ ] ATR calculation matches existing `indicators.ts` output
- [ ] Rolling volatility with insufficient bars returns null (not zero)

**Suite 2: IV Solver** (`iv-solver.test.ts`)
- [ ] Correct IV for known BS input (round-trip test)
- [ ] Zero-bid → `UNAVAILABLE`
- [ ] Crossed market (bid > ask) → `UNAVAILABLE`
- [ ] DTE < 7 → `LOW_CONFIDENCE` not failure
- [ ] Deep OTM → `LOW_CONFIDENCE`
- [ ] Solver divergence → `UNAVAILABLE` (max iterations exceeded)
- [ ] Wide spread (>50%) handled without crash
- [ ] Missing dividend → uses 0, attaches `NO_DIVIDEND_DATA` note

**Suite 3: Black-Scholes Greeks** (`bs-greeks.test.ts`)
- [ ] Known BS formula outputs match reference values
- [ ] `MODEL_DELTA` label present on all outputs
- [ ] Rho calculated correctly for both calls and puts
- [ ] Short-DTE warning attached when DTE < 7
- [ ] Provider Greeks take precedence when available

**Suite 4: Provider Provenance** (`options-provenance.test.ts`)
- [ ] `greekSource = "MARKET_PROVIDER"` when provider Greeks present
- [ ] `greekSource = "VCP_IV_MODEL"` when provider IV absent + mid available
- [ ] `greekSource = "VCP_REALIZED_VOL_MODEL"` when no market mid
- [ ] Mixed-source legs: provenance attached per-leg

**Suite 5: Brokerless Long-Option Research** (`brokerless-long-options.test.ts`)
- [ ] Full contract research runs to completion without broker connection
- [ ] No broker → no 409 error
- [ ] Breakeven, max loss, scenario P/L all correct
- [ ] Model Greeks present with `MODEL_` label
- [ ] UI does not show "Connect Broker" when chain available from independent source

**Suite 6: Brokerless Vertical Spread Research** (`brokerless-verticals.test.ts`)
- [ ] Net debit/credit calculated correctly from independent chain
- [ ] Max gain/loss correct for all 4 spread types
- [ ] Multi-leg provenance: both legs show independent-provider source

**Suite 7: Ownership Confirmation** (`ownership-confirmation.test.ts`)
- [ ] `OWNERSHIP_CONFIRMED_PORTFOLIO` when portfolio shows ≥ 100 shares
- [ ] `OWNERSHIP_NOT_CONFIRMED` when no portfolio and no broker
- [ ] `OWNERSHIP_CONFIRMED_BROKER` only when broker positions API confirms
- [ ] Research not blocked in `OWNERSHIP_NOT_CONFIRMED` — disclosure shown
- [ ] Execution blocked in `OWNERSHIP_NOT_CONFIRMED`

**Suite 8: CSP Capital Calculation** (`csp-capital.test.ts`)
- [ ] Cash obligation = strike × 100 per contract (correct formula)
- [ ] Premium-adjusted effective entry correct
- [ ] Breakeven correct
- [ ] Research available without broker — shows obligation amount

**Suite 9: Freshness Model** (`options-freshness.test.ts`)
- [ ] OI never marked stale via quote-level threshold
- [ ] Bid/ask > 1h old → `STALE` label
- [ ] Bid/ask ≤ 15min → `DELAYED` label (not stale)
- [ ] Missing `quoteTimestamp` → `UNAVAILABLE` not `STALE` (per quote-timestamp contract)

**Suite 10: Compliance Invariants** (`options-compliance.test.ts`)
- [ ] No `probabilityMetricsEnabled: true` in any options path
- [ ] No "recommended" / "best contract" / "POP" in any label field
- [ ] `MODEL_VALUE` present whenever BS theoretical price is shown
- [ ] Zero-fill of null Greeks: fails test
- [ ] "Midpoint — not a fill guarantee" disclosure in all midpoint displays

---

## 28. Documentation Updates

| File | Change |
|---|---|
| `docs/operations/49-audit-c-broker-independent-options.md` | **NEW** — this document |
| `docs/operations/46-broker-independence-architecture.md` | §4b Audit C summary to be added |
| `docs/operations/47-audit-a-broker-gate-inventory.md` | Audit C reference to be added |
| `docs/operations/48-audit-b-preflight-layering.md` | Options independent mode reference updated |
| `docs/operations/15-known-issues-and-backlog.md` | BI-003 / BI-007 updated with Audit C findings |
| `docs/operations/README.md` | Doc 49 entry |
| `docs/operations/17-sprint-change-log.md` | Audit C entry |

**Application code changed: NO**
