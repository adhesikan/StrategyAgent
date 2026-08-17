# Doc 54 — Independent Options Market Data Provider & Licensing Decision

**Type:** Research / Architecture Decision Only  
**Date:** 2026-08-17  
**Status:** RESEARCH COMPLETE (AMENDED 2026-08-17) — Twelve Data options: NOT_AVAILABLE (vendor confirmed). Independent observed-options provider integration DEFERRED beyond V1.  
**Depends on:** [Doc 49 — Audit C](49-audit-c-broker-independent-options.md), [Doc 53 — Sprint 2.8.7C](53-sprint-2.8.7c-theoretical-options.md)  
**Application code changed:** NO

---

> **📌 V1 SCOPE CLOSURE — 2026-08-17**  
> VCP Trader AI V1 will NOT integrate an independent observed-options market-data provider.
> MarketData.app and Polygon.io are recorded as future candidates only — they are NOT
> current roadmap blockers and NO vendor outreach or licensing action is required.
>
> The provider-neutral architecture (§11 `IndependentOptionsProvider` interface, Audit C
> Groups A–G) is preserved as future architecture and must NOT be deleted.
>
> **V1 brokerless options capability is complete as of Sprint 2.8.7C** (theoretical
> values, HV10–90, model Greeks, strike grids, scenario analysis — all THEORETICAL_ONLY).
> Actual contract data (bid/ask, IV, OI, Greeks) is provided by broker connections
> (Tradier / TradeStation) for connected users. No independent provider bridge is required.

---

## 1. Audit C Compatibility

### 1.1 Architecture Reuse

The entire design in Audit C (Doc 49) applies without modification. The following elements
are already specified and must be reused exactly — not redesigned:

| Artifact | Audit C Reference | Status |
|---|---|---|
| `IndependentOptionsProvider` interface | §11 | **Reuse as-is** |
| `IndependentOptionQuote` type | §11 | **Reuse as-is** |
| `OptionsDataProvenance` struct | §12 | **Reuse as-is** |
| `GreeksResult` dual-track provenance | §8 | **Reuse as-is** |
| Newton-Raphson IV solver design | §7 | **Implement per spec** |
| VCP-derived Greeks (BS + solved IV) | §5, §8 | **Implement per spec** |
| Provider fallback hierarchy | §20 | **Reuse as-is** |
| Freshness model | §13 | **Reuse as-is** |
| Minimum required fields | §24.1 | **Reuse as-is** |
| `OptionsResearchValue` (theoretical + market + comparison) | §C1.10 | **Already implemented in 2.8.7C** |
| Implementation Groups A–G | §25 | **Group A depends on licensing gate** |
| Compliance invariants | §26 | **Permanent — never override** |
| 10 required test suites | §27 | **Required for implementation sprint** |

### 1.2 Amendment C1 Status

Sprint 2.8.7C (Doc 53) implemented the `UNDERLYING_ONLY_THEORETICAL_MODE` (Level 2 in the
hierarchy). The observed provider (Level 1) is what this document evaluates. Level 2
remains available as a fallback regardless of which provider is chosen.

**Invariant C1 is permanent:** Theoretical values can never satisfy execution gates.
Adding observed options data does NOT change this. The `_brand: "THEORETICAL_ONLY"` field
on `TheoreticalOptionValue` is a structural firewall that must remain.

### 1.3 `OptionsResearchValue` Mapping

The `market` slot in the existing `OptionsResearchValue` type (already designed in Amendment
C1.10) maps directly to the independent provider data:

```
OptionsResearchValue.theoretical  → Sprint 2.8.7C (complete ✓)
OptionsResearchValue.market       → THIS sprint (observed provider data)
OptionsResearchValue.derivedComparison → Populated only when both are present
```

No type redesign is required. The market slot accepts the normalized fields from any
provider, sourced through the `IndependentOptionQuote` → `NormalizedOptionContract` pipeline.

---

## 2. Twelve Data Technical Capability Assessment

### 2.1 Current Integration Inventory

The existing Twelve Data integration (`server/services/daily-market-data/`) covers:

| Capability | Status |
|---|---|
| Daily OHLCV bars (equity) | ✓ Active — `twelve-data-client.ts` |
| Real-time equity quote | ✓ Active — `realtime-quote.ts` |
| Technical indicators (ATR) | ✓ Active — `indicators.ts` |
| **Options data of any kind** | **Not present in any file** |

The existing client makes calls only to `/time_series`. No options endpoints are referenced
anywhere in the codebase.

### 2.2 Twelve Data Options API — Field-by-Field Classification

> **⚠ AMENDED 2026-08-17 — VENDOR CONFIRMATION RECEIVED**
> Direct written confirmation was received from Liam at Twelve Data on 2026-08-17:
> *"We don't currently provide options data, but we hope to add it in future.
> Though there isn't currently a firm ETA."*
>
> This direct written statement supersedes all prior ambiguous or public documentation
> references to options functionality on the Twelve Data platform. All fields below are
> classified `NOT_AVAILABLE` on the basis of vendor confirmation, not inference.

| Field | Classification | Source |
|---|---|---|
| Expirations list | `NOT_AVAILABLE` | Vendor confirmed (Liam, Twelve Data, 2026-08-17) |
| Option chain (all strikes) | `NOT_AVAILABLE` | Vendor confirmed (Liam, Twelve Data, 2026-08-17) |
| OCC contract symbol | `NOT_AVAILABLE` | Vendor confirmed (Liam, Twelve Data, 2026-08-17) |
| `bid` | `NOT_AVAILABLE` | Vendor confirmed (Liam, Twelve Data, 2026-08-17) |
| `ask` | `NOT_AVAILABLE` | Vendor confirmed (Liam, Twelve Data, 2026-08-17) |
| `last` | `NOT_AVAILABLE` | Vendor confirmed (Liam, Twelve Data, 2026-08-17) |
| `volume` | `NOT_AVAILABLE` | Vendor confirmed (Liam, Twelve Data, 2026-08-17) |
| `openInterest` | `NOT_AVAILABLE` | Vendor confirmed (Liam, Twelve Data, 2026-08-17) |
| `quoteTimestamp` | `NOT_AVAILABLE` | Vendor confirmed (Liam, Twelve Data, 2026-08-17) |
| `impliedVolatility` (provider) | `NOT_AVAILABLE` | Vendor confirmed (Liam, Twelve Data, 2026-08-17) |
| `delta`, `gamma`, `theta`, `vega` | `NOT_AVAILABLE` | Vendor confirmed (Liam, Twelve Data, 2026-08-17) |
| Delayed data | `NOT_AVAILABLE` | Vendor confirmed (Liam, Twelve Data, 2026-08-17) |
| Real-time data | `NOT_AVAILABLE` | Vendor confirmed (Liam, Twelve Data, 2026-08-17) |
| Historical chains | `NOT_AVAILABLE` | Vendor confirmed (Liam, Twelve Data, 2026-08-17) |

**All fields are classified NOT_AVAILABLE. This is a closed question — no further
vendor inquiry regarding Twelve Data options capability is required or should be sent.**

### 2.3 Twelve Data — Licensing Assessment

All licensing dimensions are moot following vendor confirmation that no options product
exists. Recorded for completeness:

| Dimension | Status |
|---|---|
| A. API technical availability for options | **NOT_AVAILABLE** — vendor confirmed no options data (2026-08-17) |
| B. Internal commercial use | **NOT_AVAILABLE** — product does not exist |
| C. Display to authenticated VCP customers | **NOT_AVAILABLE** — product does not exist |
| D. Redistribution rights | **NOT_AVAILABLE** — product does not exist |
| E. Delayed options-data rights | **NOT_AVAILABLE** — product does not exist |
| F. Real-time options-data rights | **NOT_AVAILABLE** — product does not exist |
| G. Exchange/OPRA requirements | **NOT_AVAILABLE** — product does not exist |
| H. User-level exchange entitlement | **NOT_AVAILABLE** — product does not exist |

**Assessment: Twelve Data is eliminated as an independent options data candidate.
The existing equity/OHLCV/HV integration (Sprint 2.8.7C) is unaffected and continues
unchanged.**

### 2.4 Vendor Confirmation Record

| Field | Value |
|---|---|
| Confirmation date | 2026-08-17 |
| Respondent | Liam (Twelve Data) |
| Verbatim statement | *"We don't currently provide options data, but we hope to add it in future. Though there isn't currently a firm ETA."* |
| Classification | `NOT_AVAILABLE` — permanent until Twelve Data notifies otherwise |
| Supersedes | Any ambiguous public documentation references to Twelve Data options or derivatives functionality |
| Impact on existing integration | **None** — OHLCV bars, real-time equity quote, ATR, and Black-Scholes HV pipeline all continue unchanged |
| Re-evaluation trigger | Only if Twelve Data proactively notifies of an options product launch |

---

## 3. MarketData.app Capability Assessment

### 3.1 API Capability — Field-by-Field

MarketData.app (`api.marketdata.app/v1/options/`) has confirmed public documentation for
all standard options fields via REST:

| Field | Classification | Notes |
|---|---|---|
| Expirations list | `CONFIRMED` | Dedicated expirations endpoint |
| Full option chain | `CONFIRMED` | `/v1/options/chain/{symbol}/` |
| OCC contract symbol (`optionSymbol`) | `CONFIRMED` | Standard OCC format |
| `bid` | `CONFIRMED` | Present in chain response |
| `ask` | `CONFIRMED` | Present in chain response |
| `last` | `CONFIRMED` | Present in chain response |
| `volume` | `CONFIRMED` | Present in chain response |
| `openInterest` | `CONFIRMED` | Present in chain response |
| `quoteTimestamp` | `CONFIRMED` | Present in response |
| `impliedVolatility` (provider) | `CONFIRMED` | Included in chain response |
| `delta` | `CONFIRMED` | Greeks included |
| `gamma` | `CONFIRMED` | Greeks included |
| `theta` | `CONFIRMED` | Greeks included |
| `vega` | `CONFIRMED` | Greeks included |
| Delayed data (15-min) | `CONFIRMED` | Starter plan level |
| Real-time data | `CONFIRMED` | Trader plan — requires non-professional qualification |
| Historical chains (EOD) | `CONFIRMED` | 8 years of history |
| Filtering (expiration, side, strike range) | `CONFIRMED` | Extensive query parameters |

### 3.2 API Quality

- REST API, no special terminal or daemon required
- JSON responses, SDK available (JS, Python)
- Extensive filtering: expiration, side, strike range, moneyness, DTE range
- 100% US equity and index options coverage
- Well-maintained documentation
- Python and JavaScript SDKs documented

### 3.3 MarketData.app — Licensing Assessment

**Critical finding:** MarketData.app self-service plans (Free, Starter, Trader) explicitly
**do not permit redistribution**. Their public Data Redistribution Policy states:

> "Market Data's self-service plans are personal licenses that allow you to access and
> use market data for your own purposes only. Redistribution of that data — in any form
> — is not permitted under these plans."
>
> Redistribution explicitly includes:
> - "Embedding live or recent data in a product or service accessible to others"
> - "Sharing API access or account credentials with other users"

This means the self-service Trader plan ($30-75/month) **cannot be used for VCP Trader AI
as a commercial product serving end users** without a separate commercial agreement.

| Dimension | Status |
|---|---|
| A. API technical availability | `CONFIRMED` — full options chain API documented |
| B. Internal commercial use | `CONFIRMED` — permitted under self-service plans for own use |
| C. Display to authenticated VCP customers | `REQUIRES_COMMERCIAL_AGREEMENT` — explicitly prohibited under self-service plans |
| D. Redistribution rights | `REQUIRES_COMMERCIAL_AGREEMENT` — prohibited under self-service; Commercial Use Addendum exists |
| E. Delayed options-data rights (commercial) | `UNCLEAR_REQUIRES_VENDOR_CONFIRMATION` — delay available on Starter; commercial terms unknown |
| F. Real-time options-data rights (commercial) | `UNCLEAR_REQUIRES_VENDOR_CONFIRMATION` — available on Trader; commercial terms unknown |
| G. Exchange/OPRA requirements | `UNCLEAR_REQUIRES_VENDOR_CONFIRMATION` — OPRA implications under commercial agreement unclear |
| H. User-level exchange entitlement | `UNCLEAR_REQUIRES_VENDOR_CONFIRMATION` — non-professional requirement applies to self-service users |

**The Commercial Use Addendum** (updated October 2025) is the path forward. This is a
separate agreement beyond the self-service plan that must be negotiated with MarketData.app
before any integration work begins.

**Assessment: Technically the strongest candidate for V1. Commercially requires the
Commercial Use Addendum. This is a standard negotiation path for SaaS companies and
MarketData.app explicitly provides it.**

---

## 4. Other Providers Evaluated

### 4.1 Polygon.io

**Data capability:**

| Field | Classification |
|---|---|
| Expirations list | `CONFIRMED` |
| Option chain (all strikes) | `CONFIRMED` |
| OCC contract symbol | `CONFIRMED` |
| `bid`, `ask`, `last` | `CONFIRMED` |
| `volume`, `openInterest` | `CONFIRMED` |
| `quoteTimestamp` | `CONFIRMED` |
| `impliedVolatility` | `CONFIRMED` |
| Greeks (delta, gamma, theta, vega) | `CONFIRMED` |
| 15-min delayed | `CONFIRMED` — Starter plan |
| Real-time | `CONFIRMED` — higher plan |
| Historical chains | `CONFIRMED` |

**Commercial/licensing:**

Polygon.io is one of the most established fintech data API providers for SaaS redistribution.
They have per-asset-class plan tiers: Basic (free, delayed), Starter, Developer, Advanced, Business.
Polygon.io submitted public comments to the SEC about OPRA fee fairness — they have active
understanding of and experience navigating OPRA for commercial redistribution. Their plans
explicitly address SaaS use cases and redistribution. They are currently rebranding to "Massive"
but the API and data agreements remain the same.

**Assessment: Strong second choice. More established commercial redistribution story than
MarketData.app. Slightly higher starting price but more enterprise-ready. Good option for
scale if MarketData.app's commercial terms are unfavorable.**

### 4.2 ThetaData

**Data capability:**

| Field | Classification |
|---|---|
| Option chain (all strikes) | `CONFIRMED` |
| OCC symbols | `CONFIRMED` |
| Bid/ask | `CONFIRMED` — real-time plans |
| Volume, OI | `CONFIRMED` |
| IV, Greeks | `CONFIRMED` |
| Tick-level historical | `CONFIRMED` — one of the best in market |
| Chain snapshots | `CONFIRMED` — Options Standard+ |

**Retail pricing:**

| Plan | Monthly | Data | Request Types |
|---|---|---|---|
| Options Value | $40 | Real-time, 4 years | 3 request types |
| Options Standard | $80 | Real-time, 8 years, tick-level | 7 request types |
| Options Pro | Higher | Full historical | More types |

**Why ThetaData is NOT recommended for VCP Trader AI V1:**

1. **Theta Terminal required.** Data is accessed through a local daemon ("Theta Terminal")
   that must be running. This is a significant infrastructure requirement unsuitable for
   a cloud-hosted SaaS — every server/environment would need the Terminal running.

2. **Retail plans prohibit commercial redistribution.** APIs.io documents: "Retail pricing is
   for individual use; commercial licensing is separate." A separate commercial agreement
   is required, adding another negotiation path.

3. **OPRA fees on top.** OPRA real-time fees apply to commercial redistribution, per their
   own OPRA fee guide. These are not included in the retail plan price.

4. **Optimized for quant research, not SaaS.** ThetaData is excellent for backtesting,
   tick-level historical analysis, and quantitative research. It is not optimized for
   serving an options chain to individual users in a web application.

**Assessment: Excellent for future backtesting and historical options analysis features.
Not suitable for V1 observed market data display in a SaaS product.**

### 4.3 Intrinio

Intrinio provides a financial data API with options coverage (chain, expirations, OCC symbols,
IV, Greeks, OI). Their commercial terms and redistribution model are better established than
MarketData.app's self-service plans. However, Intrinio's pricing starts significantly higher
and their documentation/SDK is somewhat older.

**Assessment: Viable but not a top-2 candidate for V1. Worth considering at scale (1,000+
users) if Polygon.io pricing becomes prohibitive.**

### 4.4 Equibles

Also appeared in research: confirmed 15-minute delayed US options chain with IV, Greeks, OI.
Smaller provider. Insufficient information on commercial redistribution terms.
**Assessment: Insufficient information — not evaluated further.**

---

## 5. Feature Comparison Table

| Capability | Twelve Data | MarketData.app | Polygon.io | ThetaData |
|---|---|---|---|---|
| Options Chain API | ❌ NOT_AVAILABLE (vendor confirmed 2026-08-17) | ✅ CONFIRMED | ✅ CONFIRMED | ✅ CONFIRMED |
| Expirations endpoint | ❌ NOT_AVAILABLE | ✅ CONFIRMED | ✅ CONFIRMED | ✅ CONFIRMED |
| OCC symbol | ❌ NOT_AVAILABLE | ✅ CONFIRMED | ✅ CONFIRMED | ✅ CONFIRMED |
| Bid / Ask | ❌ NOT_AVAILABLE | ✅ CONFIRMED | ✅ CONFIRMED | ✅ CONFIRMED |
| Last | ❌ NOT_AVAILABLE | ✅ CONFIRMED | ✅ CONFIRMED | ✅ CONFIRMED |
| Volume | ❌ NOT_AVAILABLE | ✅ CONFIRMED | ✅ CONFIRMED | ✅ CONFIRMED |
| Open Interest | ❌ NOT_AVAILABLE | ✅ CONFIRMED | ✅ CONFIRMED | ✅ CONFIRMED |
| IV (provider-supplied) | ❌ NOT_AVAILABLE | ✅ CONFIRMED | ✅ CONFIRMED | ✅ CONFIRMED |
| Greeks (provider-supplied) | ❌ NOT_AVAILABLE | ✅ CONFIRMED | ✅ CONFIRMED | ✅ CONFIRMED |
| 15-min Delayed | ❌ NOT_AVAILABLE | ✅ Starter | ✅ Starter | ✅ All plans |
| Real-time | ❌ NOT_AVAILABLE | ✅ Trader | ✅ Higher plans | ✅ All plans |
| Historical chains | ❌ NOT_AVAILABLE | ✅ 8 years | ✅ Multi-year | ✅ 4-8+ years |
| REST API (no daemon) | ✅ Yes (equity only) | ✅ Yes | ✅ Yes | ❌ Terminal required |
| Commercial redistribution | ❌ NOT_AVAILABLE (options) | 🔶 Commercial Addendum req'd | ✅ SaaS-ready plans | 🔶 Separate commercial deal |
| Self-service plan exists | ✅ Yes (equity only) | ✅ Yes (equity) | ✅ Yes | ✅ Yes (retail only) |
| Startup-friendly pricing | ✅ Existing (equity only) | ✅ ($30-75/mo) | 🔶 Higher | 🔶 $40-80/mo retail |
| Existing VCP integration | ✅ Yes (equity/OHLCV only) | ❌ No | ❌ No | ❌ No |

---

## 6. Licensing Comparison

| Dimension | Twelve Data | MarketData.app | Polygon.io | ThetaData |
|---|---|---|---|---|
| **SaaS redistribution framework** | ❌ NOT_AVAILABLE (no options product) | 🔶 Commercial Addendum (exists) | ✅ Explicit SaaS plans | 🔶 Separate commercial required |
| **OPRA — delayed display** | ❌ NOT_AVAILABLE | ❓ Confirm under commercial | ✅ Handled via plan | ❓ OPRA fees on top |
| **OPRA — real-time display** | ❌ NOT_AVAILABLE | ❓ Confirm under commercial | 🔶 Higher plan + OPRA | ❌ OPRA fees significant |
| **Non-display calculation rights** | ❌ NOT_AVAILABLE | ❓ Confirm | ✅ Permitted | ✅ Permitted |
| **Per-user entitlement** | ❌ NOT_AVAILABLE | ❓ Confirm | Standard per OPRA | Standard per OPRA |
| **Caching permitted** | ✅ Yes (equity only) | ❓ Confirm duration | ✅ Allowed | ✅ Allowed |
| **Attribution required** | ✅ Yes (equity only) | ❓ Confirm | Usually yes | Usually yes |

**Key OPRA fact (applies to all providers):**

OPRA fees are set by the Options Price Reporting Authority — not individual data vendors.
For real-time data displayed to end users, OPRA requires the vendor to report and pay
fees. As of 2017-2018: $30.50-$31.50 per professional subscriber device per month.
For non-professionals, a vendor-paid fee structure exists.

**For delayed (15-min) data:** OPRA still applies, but the fee structure for delayed display
is separate and typically lower than real-time. This is the most cost-effective path for
a research product. Confirm exact delayed-data fee schedule with the chosen vendor.

**Non-display use** (VCP internal IV solving + Greeks calculation from market mid):
OPRA has a separate Non-Display Declaration and fee schedule. For research SaaS that
stores observed data server-side to calculate derived analytics, this may be the most
relevant category.

---

## 7. Real-Time vs Delayed Recommendation

### 7.1 Architecture

```
EXECUTION         → Broker live execution-grade data (≤60s freshness)
                    No independent provider involved — this is preserved
                    
RESEARCH          → 15-minute delayed observed options data   ← RECOMMENDED
                    From independent provider (MarketData.app or Polygon.io)
                    
THEORETICAL       → VCP Black-Scholes / HV engine (Sprint 2.8.7C)
                    Always available — no provider required
```

### 7.2 Why 15-Minute Delayed Is Sufficient for Research

**VCP Trader AI is a research platform, not a trading terminal.**

The primary research use cases are:

| Research task | Data requirement |
|---|---|
| "Is this options contract liquid enough to consider?" | OI, volume, spread — changes little in 15 min |
| "What is the approximate IV environment for this symbol?" | IV — changes slowly during the day |
| "What is the bid/ask spread?" | Changes, but for strategy evaluation 15-min is sufficient |
| "What expirations are available?" | Expirations — changes weekly, not minute-by-minute |
| "What strikes are near the money?" | Changes slowly unless the stock is very volatile |
| "Compare theoretical vs market premium" | Educational — 15-min is more than sufficient |

**Execution uses broker live data.** Any user who needs sub-60s precision for actual
trading is already connected to a broker, who provides execution-grade quotes.

### 7.3 OPRA Cost Reduction from Delayed vs Real-Time

Delayed options data (15-min) has significantly lower OPRA implications than real-time:
- Real-time: Full OPRA vendor agreement + per-subscriber reporting required
- Delayed (non-real-time): Simpler OPRA framework — confirm with vendor

**Recommendation: Start with 15-minute delayed. Add real-time only if user demand demonstrates
it is needed for research (not execution — execution always uses the broker path).**

---

## 8. Target Architecture

This exactly matches Audit C §20 with Level 2 now implemented:

```
OPTIONS RESEARCH DATA — THREE-LEVEL HIERARCHY

Level 1: Independent Observed Provider (THIS SPRINT)
  Source: MarketData.app (recommended) or Polygon.io
  Data mode: OPTION_MARKET_OBSERVED
  Delay: 15-minute delayed (recommended V1)
  Fields: OCC symbol, expiration, strike, bid, ask, last, volume, OI,
          timestamp, provider IV (if included), provider Greeks (if included)
  
Level 2: UNDERLYING_ONLY_THEORETICAL_MODE (Sprint 2.8.7C — COMPLETE ✓)
  Source: VCP Black-Scholes + stored Twelve Data bars
  Data mode: THEORETICAL_ONLY
  Fields: MODEL_CALL_VALUE, MODEL_PUT_VALUE, MODEL_DELTA, MODEL_GAMMA,
          MODEL_THETA, MODEL_VEGA, MODEL_RHO
  When used: Level 1 unavailable OR provider fails
  
Level 3: Broker-Connected (BROKER_ENHANCED — existing)
  Source: Tradier / TradeStation live chain
  Data mode: OPTION_MARKET_OBSERVED (execution-grade freshness)
  When used: User has connected broker (adds live quote + account context)
  Precedence for execution: Broker takes over from Level 1 on execution path

EXECUTION GUARD (permanent, unchanged):
  No Level 1 or Level 2 data can satisfy:
    - Order Preparation execution quote
    - Order Preview executable price
    - Execution Preflight dim-9 Quote Validation (PASS requires broker live quote)
    - Final Revalidation
    - Broker Submission
```

### 8.1 Execution Safety — Critical

Observed independent data (Level 1) is **research-grade, not execution-grade**. The only
change from today is:

| Before | After |
|---|---|
| No chain → no research | No chain from Level 1 → fall back to Level 2 (theoretical) |
| Chain → broker only | Chain from Level 1 → research available; execution still requires broker |
| Live broker quote → execution | Live broker quote → execution (unchanged) |

**The `NormalizedOptionContract` type** (from `live-contract-resolver.ts`) is the shared
normalized type for both broker and independent provider data. When sourced from an
independent provider, `provider` field = `"marketdata_app"` and `updatedAt` reflects the
15-min delayed timestamp. This is passed through to `contract-research-service.ts` as today.

---

## 9. Provider-Neutral Architecture

### 9.1 Interface (Audit C §11 — Reuse Verbatim)

```typescript
// server/services/independent-options-provider.ts (GROUP A — Audit C)
// DO NOT MODIFY. This is the approved Audit C interface.

interface IndependentOptionQuote {
  contractSymbol:   string;          // OCC format: AAPL230120C00150000
  underlying:       string;          // "AAPL"
  expiration:       string;          // YYYY-MM-DD
  strike:           number;
  type:             "call" | "put";
  bid:              number | null;
  ask:              number | null;
  last:             number | null;
  volume:           number | null;
  openInterest:     number | null;
  quoteTimestamp:   string | null;   // ISO 8601 from provider; NEVER fetch time

  providerIv?:      number | null;
  providerDelta?:   number | null;
  providerGamma?:   number | null;
  providerTheta?:   number | null;
  providerVega?:    number | null;
  tradeTimestamp?:  string | null;

  providerName:     string;          // "marketdata_app" | "polygon" | etc.
  retrievedAt:      string;          // ISO 8601 — when VCP fetched
  delayedByMinutes: number | null;   // 15 for delayed; 0 for real-time; null = unknown
}

interface IndependentOptionsProvider {
  getOptionExpirations(symbol: string): Promise<string[]>;
  getOptionChain(symbol: string, expiration: string): Promise<IndependentOptionQuote[]>;
  getOptionQuote(contractSymbol: string): Promise<IndependentOptionQuote | null>;
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; note?: string }>;
}
```

### 9.2 Provider Capability Declaration

Each adapter declares what it supports:

```typescript
interface ProviderCapabilities {
  providerName:          string;
  supportsRealtime:      boolean;
  supportsDelayed:       boolean;
  delayMinutes:          number | null;       // 15 for delayed, 0 for realtime
  supportsGreeks:        boolean;             // Provider supplies Greeks
  supportsIV:            boolean;             // Provider supplies IV
  supportsOpenInterest:  boolean;
  supportsVolume:        boolean;
  supportsHistorical:    boolean;
  licenseMode:           "research" | "research_and_display" | "commercial_redistribution";
  dataDelay:             "realtime" | "delayed_15min" | "eod" | "unknown";
}
```

### 9.3 Adapter Pattern

Each provider gets one adapter file:

```
server/services/options-providers/
  index.ts                        ← getActiveOptionsProvider() factory
  marketdata-app-adapter.ts       ← implements IndependentOptionsProvider (recommended)
  polygon-adapter.ts              ← implements IndependentOptionsProvider (backup)
```

The factory reads `INDEPENDENT_OPTIONS_PROVIDER=marketdata_app|polygon|disabled` from env.
This allows provider switching without code changes.

### 9.4 env vars Required (New)

```bash
INDEPENDENT_OPTIONS_PROVIDER=marketdata_app   # or polygon, or disabled
MARKETDATA_APP_API_KEY=...                    # from commercial agreement
MARKETDATA_APP_OPTIONS_ENABLED=false          # default false; true after licensing confirmed
MARKETDATA_APP_DELAY_MINUTES=15               # 15 = delayed; 0 = real-time
```

---

## 10. Existing Code Reuse Map

**ALL of the following existing code is reused without modification:**

| Component | File | Reuse |
|---|---|---|
| `NormalizedOptionContract` | `server/services/live-contract-resolver.ts` | Fields from `IndependentOptionQuote` normalize into this type; downstream unchanged |
| `normalizeOptionChainContract()` | `server/services/live-contract-resolver.ts` | May need an independent variant that reads `IndependentOptionQuote` fields |
| Liquidity quality classification | `server/services/contract-research-service.ts:198–207` | ✓ Unchanged — operates on bid/ask/OI/volume |
| Moneyness classification | `server/services/contract-research-service.ts:182` | ✓ Unchanged — operates on strike vs underlying |
| Strike distance % | `server/services/contract-research-service.ts:189` | ✓ Unchanged |
| DTE calculation | `server/services/contract-research-service.ts` | ✓ Unchanged |
| Event relation (earnings window) | `server/services/contract-research-service.ts` | ✓ Unchanged |
| Breakeven / max gain / max loss | `server/services/trade-risk-scenario-service.ts` | ✓ Unchanged — from stored premiums |
| Scenario P/L | `server/services/trade-risk-scenario-service.ts` | ✓ Unchanged — from stored premiums |
| Strategy matching (17 families) | `server/services/options-strategy-matching-service.ts` | ✓ Unchanged — pure logic |
| Black-Scholes engine (Sprint 2.8.7C) | `server/services/theoretical-options/black-scholes.ts` | ✓ Reused for VCP Greeks from solved IV |
| HV engine (Sprint 2.8.7C) | `server/services/theoretical-options/realized-volatility.ts` | ✓ Reused for HV fallback |
| TheoreticalOptionsPanel | `client/src/components/theoretical-options/` | ✓ Unchanged — Level 2 display |
| `ExpirationResearchCandidate` | `shared/contract-research-types.ts` | ✓ Unchanged |
| `ContractResearchCandidate` | `shared/contract-research-types.ts` | ✓ Unchanged |

**New code required (Group A, Audit C §25):**

| Component | File (to be created) | What it does |
|---|---|---|
| Independent provider interface | `server/services/options-providers/index.ts` | Factory + interface |
| MarketData.app adapter | `server/services/options-providers/marketdata-app-adapter.ts` | HTTP → `IndependentOptionQuote[]` |
| IV solver | `server/services/options-pricing/iv-solver.ts` | Newton-Raphson; already designed in Audit C §7 |
| Brokerless route update | `server/routes/internal-options.ts` | Remove 409 NO_BROKER (Audit C Group D) |

---

## 11. Contract Research Integration Approach

**Desired brokerless flow (from the spec):**

```
Theoretical Options Research (Level 2 — already complete)
+
Observed Options Market Research (Level 1 — this sprint)
+
Contract Research
WITHOUT broker

Broker connection adds:
  account-aware execution validation
  + live execution quotes
  + order preparation/submission
```

**Current code path:**

```
GET /api/options/contracts/:symbol
  → internal-options.ts
  → getBrokerConnection() — throws 409 if no broker
  → getOptionExpirations() via broker
  → getOptionChain() via broker
  → contract-research-service.ts (filtering + enrichment)
```

**Modified code path (after this sprint):**

```
GET /api/options/contracts/:symbol
  → internal-options.ts
  → try IndependentOptionsProvider (Level 1)
      → getOptionExpirations(symbol)
      → getOptionChain(symbol, expiration)
      → normalize to IndependentOptionQuote[]
      → IV solver (derive IV from midpoint if provider IV absent)
      → VCP Greeks (from solved IV via existing BS engine)
      → contract-research-service.ts (same filtering + enrichment — unchanged)
  → if Level 1 unavailable: fall back to Level 2 (theoretical mode — already mounted)
  → if broker connected: augment Level 1 data with live execution quote (BROKER_ENHANCED)
```

**What does NOT change:**
- `contract-research-service.ts` filtering logic
- `ExpirationResearchCandidate` / `ContractResearchCandidate` types
- Liquidity quality classification
- All 17 strategy family analytics
- Execution path (requires broker)
- Execution preflight (requires broker)
- `BI-GATE-009`, `BI-GATE-015`, `BI-GATE-016` (order prep / submission — preserved)

---

## 12. Market-vs-Model Integration

From Amendment C1.10, the `OptionsResearchValue` type already has the shape:

```
theoretical: { MODEL_CALL_VALUE, MODEL_PUT_VALUE, Greeks, quality }   ← Sprint 2.8.7C ✓
market:      { bid, ask, midpoint, volume, OI, IV, Greeks }            ← THIS sprint
derivedComparison: { modelVsMarketDifference, ivVsHvSpread, note }    ← populated when both present
```

**Population rules:**

```
market.bid / market.ask:
  → From IndependentOptionQuote.bid / .ask (null if provider returns null)
  
market.midpoint:
  → (bid + ask) / 2 ONLY when both are non-null; never a model value
  → Label always: "Midpoint — not a fill guarantee"
  
market.volume:
  → From IndependentOptionQuote.volume

market.openInterest:
  → From IndependentOptionQuote.openInterest
  → Freshness: delayedByDesign = true (OI is EOD by exchange design)
  
market.impliedVolatility:
  → Preference: providerIv if not null (greekSource = MARKET_PROVIDER)
  → Fallback: VCP Newton-Raphson solver from midpoint (greekSource = VCP_IV_MODEL)
  → null if neither available (NEVER zero-fill)
  
market.greeks.providerGreeks:
  → From providerDelta / providerGamma / providerTheta / providerVega (if present)
  
market.greeks.calculatedGreeks:
  → From VCP BS + solved IV (labeled MODEL_DELTA etc.)
  
derivedComparison.modelVsMarketDifference:
  → theoretical.MODEL_CALL_VALUE (or PUT) minus market.midpoint
  → Research label: "Theoretical vs market premium — research comparison only"
  
derivedComparison.ivVsHvSpread:
  → market.impliedVolatility minus theoretical.volatilityInput (HV30 used)
  → Research label: "Market IV vs historical vol — research context only"
  → Never: recommendation-oriented language
```

**No recommendations from the comparison.** The comparison is educational only.

---

## 13. Caching Recommendation

### V1: Per-Symbol, Per-Expiration, Short TTL

```
Cache key: symbol:expiration  (e.g. "NVDA:2026-09-19")
TTL: 5 minutes during market hours; 30 minutes outside hours

Benefits:
  - One provider request serves all users researching the same symbol+expiration
  - Reduces API costs by 10–100× at moderate user counts
  - 5-min TTL is within the 15-min data delay (no freshness violation)
  
Storage: In-memory (Redis or node Map with TTL)
NOT: Persistent DB storage of options chains (avoid storage compliance questions)
```

**Cache strategy by scenario:**

| Data Type | Cache TTL | Notes |
|---|---|---|
| Expirations list | 60 minutes | Changes weekly |
| Option chain (bid/ask/vol/OI) | 5 minutes | Within 15-min delay |
| Option chain (OI only) | 30 minutes | End-of-day by exchange design |
| Historical chains (EOD) | 24 hours | Historical — immutable |

**Why not 1-minute TTL:** At low user counts, 1-minute provides minimal savings over
no cache and risks burning API credits faster. 5 minutes is the minimum useful window
for research usage.

**Why not 15-minute TTL:** Overly conservative. If the provider updates at 15-min intervals
and the cache is also 15 min, users at the tail of the window see nearly 30-min-old data.
5-minute server cache + 15-min provider delay = max 20-min effective latency, which is
fine for research.

---

## 14. Provider Failure Behavior

Exactly as specified in the brief (§15):

```
Level 1 available → show observed (market) + theoretical side-by-side
  ↓ provider error or timeout
Level 1 unavailable → theoretical research remains available (Level 2)
  + display: "Observed market data temporarily unavailable. Theoretical values shown."
  
Broker unavailable → research remains available (Level 1 + Level 2)
  + display: "Broker not connected. Live execution data unavailable."
  
Everything unavailable → explicit unavailable state
  + display: "Options data currently unavailable. Try again later."
  + NEVER: fabricated data, zero-fill, or stale cached data served as current
```

**Circuit breaker (recommended):** After 3 consecutive provider failures within 60s,
stop calling the provider for 5 minutes and serve Level 2 (theoretical) only.

---

## 15. Cost Model

### 15.1 Assumptions for Cost Estimate

- Estimated provider requests per user session: 5-10 (a few symbols, a few expirations)
- Server-side caching (5-min TTL): reduces provider calls by ~80-90% at moderate scale
- Research cadence: not continuous — user browses, views options, moves on

### 15.2 MarketData.app Estimated Costs

**Self-service plans (not redistribution-licensed — research internal use only):**

| Plan | Monthly | Credits/day | Options data |
|---|---|---|---|
| Starter | $12/mo annual | 10,000/day | 15-min delayed |
| Trader | $30/mo annual | 100,000/day | Real-time |

**Commercial redistribution pricing: UNKNOWN — requires Commercial Use Addendum negotiation**

Typical startup SaaS commercial data arrangements cost $200–$2,000/month depending on
volume commitments and data type. Estimate only — confirm with vendor.

### 15.3 Polygon.io Estimated Costs (Options Asset Class)

| Plan | Estimated Monthly | Options features |
|---|---|---|
| Starter | ~$29/mo | Delayed snapshots |
| Developer | ~$79/mo | More access |
| Advanced | ~$199/mo | Real-time, broader |
| Business | Custom | Full redistribution |

These are estimated from the 2024-2025 schedule. Check polygon.io/pricing for current figures.

### 15.4 Cost by Scale (Delayed Data Recommendation)

The main cost driver is not user count but API call volume, mitigated by caching.

| Scale | API calls/day (estimated, cached) | MarketData.app (COMMERCIAL, estimated) | Polygon.io (COMMERCIAL, estimated) |
|---|---|---|---|
| 100 users | ~500 calls/day | UNKNOWN — vendor quote needed | ~$29-79/mo |
| 500 users | ~1,500 calls/day | UNKNOWN — vendor quote needed | ~$79-199/mo |
| 1,000 users | ~3,000 calls/day | UNKNOWN — vendor quote needed | ~$199/mo |
| 5,000 users | ~10,000 calls/day | UNKNOWN — vendor quote needed | Custom / Business plan |

**OPRA fee overlay (delayed display):**

OPRA fees for delayed (non-real-time) options data display depend on whether the provider
passes them through to the subscriber or absorbs them in the plan price. Confirm with vendor:
does the commercial plan include OPRA, or is it separately billed?

| Scenario | Estimated OPRA component |
|---|---|
| Delayed display, absorbed by vendor in plan | $0 incremental |
| Delayed display, passed through | UNKNOWN — confirm with vendor |
| Real-time display, non-professional subscribers | Vendor-reported fee (vendor pays OPRA per subscriber) |
| Non-display calculations (IV solving, Greeks) | Separate OPRA Non-Display Declaration; typically lower |

**UNKNOWN costs marked clearly. Do not fabricate pricing.**

### 15.5 Cost Comparison: Delayed vs Real-Time

| Approach | API cost | OPRA cost | Complexity | Recommended |
|---|---|---|---|---|
| 15-min delayed | Lower plan tier | Simpler / potentially lower | Lower | ✅ V1 |
| Real-time | Higher plan tier | Full OPRA vendor reporting | Higher | 🔶 Future if user demand proven |

---

## 16. Future Primary Provider Candidate (Post-V1)

### **B. MARKETDATA_APP — FUTURE CANDIDATE — NOT CURRENT ROADMAP BLOCKER**

> **V1 SCOPE CLOSURE:** Independent observed-options provider integration is DEFERRED
> beyond V1. MarketData.app is recorded here as the leading future candidate only.
> No commercial licensing action, vendor outreach, or integration code is required
> for the current roadmap.

**Why it is the leading future candidate:**

1. **Full options capability confirmed.** All required fields (OCC symbol, expirations,
   bid/ask, last, volume, OI, IV, Greeks) are documented and confirmed in public API docs.

2. **Clean REST API, no daemon required.** Unlike ThetaData (Terminal required), MarketData.app
   is a standard REST API callable from any server environment.

3. **Commercial path exists.** The Commercial Use Addendum (updated Oct 2025) is the
   documented path for SaaS redistribution. This is a standard negotiation, not a custom
   enterprise deal from scratch.

4. **Startup-friendly economics.** Starting price point is appropriate for an early-stage
   product. Commercial pricing will be higher but is negotiable.

5. **Historical options data (8 years).** Useful for future backtesting and historical chain
   research features without changing providers.

6. **Strong API documentation** with filtering, SDK support, and clear field definitions.

**When this becomes relevant:** After V1 launches and observed contract data for brokerless
users is identified as a high-value V2 capability. Commercial Use Addendum negotiation is
the first step at that point.

---

## 17. Future Backup Provider Candidate (Post-V1)

### **Polygon.io — FUTURE BACKUP CANDIDATE — NOT CURRENT ROADMAP BLOCKER**

> **V1 SCOPE CLOSURE:** Independent observed-options provider integration is DEFERRED
> beyond V1. Polygon.io is recorded here as the leading future backup candidate only.
> No licensing action, outreach, or integration code is required for the current roadmap.

**Why it is the leading future backup candidate:**

1. **Established fintech SaaS redistribution track record.** Polygon.io is widely used
   in commercial trading applications for exactly this use case.

2. **Explicit OPRA engagement.** They submitted public comments to the SEC about OPRA fee
   structure — they deeply understand the commercial redistribution landscape.

3. **Better enterprise-scale story.** At 1,000+ users, Polygon.io's Business plan and
   established SLA/support may be preferable.

4. **Per-asset-class plans.** Options can be licensed independently from equities.

5. **Same provider-neutral interface.** A Polygon.io adapter is a straightforward addition
   to the same `IndependentOptionsProvider` interface. No redesign required.

**Use Polygon if (post-V1):** MarketData.app's commercial terms are not acceptable, pricing
is higher than expected, or you want a single provider for both equities and options at scale.

---

## 18. Vendor Questions (Archived — Post-V1 Reference)

> **V1 SCOPE CLOSURE:** These vendor questions are NOT to be sent during V1.
> Independent observed-options provider integration is deferred. The email scripts
> below are archived here for future reference when the V1 scope boundary is revisited.

### 18A. MarketData.app — Questions for Commercial Use Addendum (Post-V1 Reference)

```
Subject: Commercial Use Addendum — SaaS Options Data Display (VCP Trader AI)

We are building a paid SaaS platform (VCP Trader AI) for individual stock traders.
We are evaluating MarketData.app as our source for independent options market data.

We understand the self-service plans do not permit redistribution and that your 
Commercial Use Addendum governs SaaS use. We are writing to:
1. Obtain the Commercial Use Addendum terms
2. Confirm the following specific requirements are covered

Please confirm in writing:

1. REDISTRIBUTION / END-USER DISPLAY
   Does the Commercial Use Addendum permit us to display options market data
   (bid, ask, last, volume, open interest, IV, Greeks) to authenticated users
   of our paid SaaS application?

2. DELAYED DATA
   Does the Commercial Use Addendum cover 15-minute delayed options data for
   display to end users? Is delayed display OPRA-licensed under your agreement,
   or do we need a separate OPRA arrangement?

3. REAL-TIME DATA
   Does the Commercial Use Addendum cover real-time options data for display to
   end users? What are the OPRA implications, and are they included in your price?

4. OPRA REQUIREMENTS
   What are the OPRA obligations for our account under the commercial terms?
   Do we need to self-report subscriber counts to OPRA, or do you handle this?
   Is a distinction made between professional and non-professional subscribers?

5. NON-DISPLAY / DERIVED ANALYTICS
   We plan to run server-side IV calculations and Black-Scholes Greeks derivation
   using your observed market data. Does the commercial agreement permit
   non-display computational use of the data for these derived analytics?

6. CACHING
   May we cache option chain data server-side for a period of up to 15 minutes
   to reduce API calls across multiple users viewing the same symbol?

7. ATTRIBUTION
   What attribution or "powered by" requirements apply to displayed data?

8. HISTORICAL OPTIONS DATA
   Does the Commercial Use Addendum cover historical end-of-day options chain
   data for non-display research features (e.g. backtesting research context)?

9. USER COUNT AND PRICING
   We expect 100–1,000 authenticated end users in Year 1, growing to 5,000+ in Year 2.
   Can you provide commercial pricing for these scale levels?

10. DATA STORAGE
    May we store option chain snapshots (the data you provide) server-side in
    our database for short periods (up to 24 hours)?
```

### 18B. Twelve Data — CLOSED (Vendor Confirmation Received)

> **No further questions should be sent to Twelve Data regarding options data.**
>
> Direct written confirmation was received from Liam at Twelve Data on 2026-08-17:
> *"We don't currently provide options data, but we hope to add it in future.
> Though there isn't currently a firm ETA."*
>
> This supersedes all prior ambiguous public documentation. Twelve Data is eliminated
> from the options provider candidate list. The existing equity OHLCV / real-time quote /
> ATR / HV pipeline (used by Sprint 2.8.7C) is unaffected.
>
> Re-evaluation is only warranted if Twelve Data proactively notifies of a new options
> product launch. No monitoring action is required.

---

## 19. Risks

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| MarketData.app commercial terms are prohibitive | HIGH | MEDIUM | Polygon.io is ready backup; provider-neutral architecture allows swap |
| OPRA fees are much higher than expected at scale | HIGH | MEDIUM | Delayed data reduces exposure; confirm before implementation |
| Provider rate limits are hit at scale | MEDIUM | LOW | 5-min server-side cache; circuit breaker |
| Provider outage disrupts research | MEDIUM | LOW | Level 2 (theoretical) fallback always available; never crashes page |
| ~~Twelve Data equity license doesn't cover options~~ | ~~MEDIUM~~ | ~~MEDIUM~~ | **CLOSED 2026-08-17** — vendor confirmed no options product exists; equity integration unaffected |
| Delayed data (15-min) is stale during volatile moves | LOW | LOW | Research context only; users know data is delayed; execution uses broker |
| OCC symbol format differences between providers | LOW | LOW | `IndependentOptionQuote` normalizes — adapter handles per-provider variations |
| Provider changes pricing mid-integration | LOW | LOW | env var `INDEPENDENT_OPTIONS_PROVIDER=disabled` allows instant cutoff |
| Caching period causes freshness disclosures to be inaccurate | LOW | LOW | Attach server `retrievedAt` timestamp; display effective data age, not just provider delay |
| OPRA Non-Display declaration required for IV solver | LOW | MEDIUM | Confirm with vendor — typically required for real-time; delayed may have lighter obligation |

---

## 20. Recommended Next Implementation Sprint

### V1 Scope Closure — 2026-08-17

**Independent observed-options provider integration is DEFERRED beyond V1.**

V1 brokerless options capability is complete as of Sprint 2.8.7C:
- HV10/HV20/HV30/HV60/HV90 engine
- Black-Scholes theoretical call/put values
- Model Greeks (delta, gamma, theta, vega, rho)
- Hypothetical strike grids and DTE scenarios
- Options strategy research and scenario/risk analysis
- All outputs permanently labeled THEORETICAL_ONLY

Actual listed contract data (expirations, bid/ask, OI, market IV, execution Greeks)
is provided by connected broker (Tradier / TradeStation) for broker-connected users.
No independent provider bridge is required for V1.

### Post-V1 Prerequisites (archived — not current roadmap)

When the scope boundary is revisited post-V1:

1. **Sign MarketData.app Commercial Use Addendum** — or confirm Polygon.io as primary
2. **Receive written answers to MarketData.app questions in §18A** — specifically on redistribution, OPRA, and caching (Twelve Data is fully resolved — §18B closed)
3. **Licensing gate env var set**: `MARKETDATA_APP_OPTIONS_ENABLED=false` defaults in place before any code is written

### Sprint 2.8.7D Scope (archived — not current roadmap)

**Objective:** Add Level 1 (OPTION_MARKET_OBSERVED) to the existing three-level options
research hierarchy. Level 2 (THEORETICAL_ONLY) and Level 3 (BROKER_ENHANCED) remain unchanged.

**Implementation groups (from Audit C §25):**

| Group | Description | Dependencies |
|---|---|---|
| Group A | `IndependentOptionsProvider` interface + MarketData.app adapter | Licensing gate confirmed |
| Group B | HV engine (**already implemented in 2.8.7C** — reuse) | None — complete |
| Group C | IV solver (Newton-Raphson) + VCP Greeks from observed mid | Group B (complete) |
| Group D | Brokerless contract research: remove 409, wire independent provider | Groups A + C |
| Group E | Ownership confirmation (portfolio as source for covered/protective strategies) | None |
| Group F | Options data provenance + freshness labels | None — additive |
| Group G | UI: independent mode vs broker-enhanced; provenance badges; model-Greek labels | Group D |

**Required test suites (Audit C §27 — 10 suites minimum):**

1. IV solver (Newton-Raphson round-trip, zero-bid, crossed market, convergence)
2. BS Greeks from solved IV (labels, provenance, rho)
3. Provider provenance (MARKET_PROVIDER / VCP_IV_MODEL / VCP_REALIZED_VOL_MODEL)
4. Brokerless long option research (no 409, correct scenario math)
5. Brokerless vertical spread research (all 4 types)
6. Ownership confirmation (portfolio source, broker source, execution gate)
7. CSP capital calculation (cash obligation formula)
8. Freshness model (OI delayed-by-design, stale thresholds)
9. Compliance invariants (no POP, no zero-fill, midpoint labeling)
10. Caching contract (TTL, invalidation, stale guard)

**Gate condition for sprint close:**
- All 10 required test suites passing
- `MARKETDATA_APP_OPTIONS_ENABLED=false` default confirmed
- Broker path unchanged and passing existing tests
- Level 2 (theoretical) fallback verified when Level 1 is disabled
- OPRA disclosure and data-delay label present in all observed-data displays

---

## Summary Decision Matrix

| Decision | Answer |
|---|---|
| V1 independent provider integration? | **DEFERRED beyond V1 — not current roadmap** |
| Future primary provider candidate | **B. MARKETDATA_APP — future candidate only; NOT a current blocker** |
| Future backup provider candidate | **Polygon.io — future backup candidate only; NOT a current blocker** |
| Real-time or delayed? | **15-min delayed recommended when revisited post-V1** |
| Twelve Data for options? | **NOT_AVAILABLE — vendor confirmed (Liam, Twelve Data, 2026-08-17). Equity/OHLCV/HV integration unchanged.** |
| ThetaData? | **Not suitable for SaaS redistribution — possible future backtesting use** |
| MarketData.app a current blocker? | **NO** |
| Implementation prerequisite | **Post-V1: Commercial Use Addendum signed + vendor questions answered (§18A)** |
| V1 brokerless options capability? | **COMPLETE — Sprint 2.8.7C (theoretical values, HV10–90, model Greeks, strike grids)** |
| Next sprint for this work | **Post-V1 Sprint 2.8.7D** (after licensing gate cleared; Audit C architecture preserved) |
| Architecture change required? | **No — reuse Audit C interface and types verbatim when the time comes** |
| Execution path affected? | **No — execution remains broker-only; unchanged** |
| Theoretical mode (2.8.7C) affected? | **No — remains as Level 2 fallback; unchanged** |
