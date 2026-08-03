# VCP Trader AI — Architecture v1

**Status:** Authoritative design document for the VCP Trader AI ecosystem
**Version:** 1.0 · August 2026
**Audience:** Engineers, architects, and product owners. A new senior engineer should be able to understand the entire system after reading this document.

> This document is future-looking while accurately reflecting the current implementation. Sections describing **current** behavior cite real modules; sections describing **future** architecture are explicitly labeled *(future)* and are design intent, not shipped code.

---

## Table of Contents

1. [Vision](#1-vision)
2. [Design Principles](#2-design-principles)
3. [High-Level Architecture](#3-high-level-architecture)
4. [MCP Architecture](#4-mcp-architecture)
5. [Domain Models](#5-domain-models)
6. [User Intents](#6-user-intents)
7. [Trading Engine](#7-trading-engine)
8. [Investment Engine (future)](#8-investment-engine-future)
9. [Options Engine](#9-options-engine)
10. [Portfolio Engine (future)](#10-portfolio-engine-future)
11. [AI Command Center](#11-ai-command-center)
12. [MCP Tool Taxonomy](#12-mcp-tool-taxonomy)
13. [Security](#13-security)
14. [Data Flow](#14-data-flow)
15. [Roadmap](#15-roadmap)
16. [Future Agent](#16-future-agent)
17. [Appendix](#17-appendix)

---

## 1. Vision

**VCP Trader AI is an AI Market Intelligence Platform.**

It helps traders and investors:

- **Discover opportunities** — deterministic scanners run on schedules across strategy families and surface ranked, tracked setups.
- **Analyze opportunities** — AI-guided analysis grounded in deterministic scan results (VCP structure, contraction sequences, pivots, market regime).
- **Manage risk** — position sizing, execution guardrails, Position Protection exit plans, and NO_TRADE as a first-class recommendation.
- **Generate income** — covered calls, cash-secured puts, and wheel-style strategy selection, in estimated or live-broker mode.
- **Build portfolios** *(future)* — investment analysis, allocation, and rebalancing as a domain independent of trading.
- **Continuously monitor markets** — scheduled scans, opportunity lifecycle tracking, alerting, and exit monitoring.

Three sentences define the entire product philosophy:

> **The AI explains. Deterministic engines decide. Execution always requires explicit user confirmation.**

The AI never invents numbers, never ranks, and never trades. Every price, score, stage, and candidate comes from a deterministic engine; the AI's job is to translate those facts into an explanation the user can act on. The intended path to a live order is a user reviewing and confirming a ticket (see Principle 3 in §2 for the one legacy, consent-gated exception the forward architecture deprecates).

---

## 2. Design Principles

| # | Principle | What it means in this codebase |
|---|-----------|-------------------------------|
| 1 | **AI explains; deterministic engines calculate** | Every number shown to a user (score, stage, trigger, stop, contraction %) originates in a scanner, calculator, or broker API. The LLM receives those results and may only summarize them (`server/routes/ask.ts` injects deterministic scan/opportunity payloads with strict "explain-only" system rules). |
| 2 | **Never fabricate** | Missing data is shown as missing. Fields that aren't stored return `null` or empty arrays (e.g., internal scanner API's `reasons: []`, estimated options never show premiums/Greeks). Failures return honest error states ("Live opportunity data is temporarily unavailable"), never invented content. |
| 3 | **No autonomous trading** | No AI *answer* ever produces an order. InstaTrade is the user-directed execution path, gated by review + acknowledgment; Position Protection executes only user-authored exit plans. The MCP AI tool subset deliberately excludes `get_positions`. One caveat exists today: a legacy auto-agent worker (`server/agent-worker.ts`, started in `server/index.ts`) can place orders when a user's agent policy is explicitly set to AUTO mode (consent-gated, `auto_mode_consents`). This is historical/admin functionality, is not reachable from any AI conversation, and the forward architecture treats it as deprecated: all new execution surfaces must terminate in user-confirmed tickets. |
| 4 | **NO_TRADE is a valid recommendation** | Empty scan results, unqualified setups, and "no high-quality setups currently meet the criteria" are correct, first-class outputs — not errors to paper over. |
| 5 | **Trading and Investing are different domains** | Trading = setups, triggers, stops, days-to-weeks. Investing *(future)* = quality, valuation, thesis, quarters-to-years. They share infrastructure (market data, MCP) but never share candidates, scores, or vocabulary. |
| 6 | **Market data providers are replaceable** | `server/services/daily-market-data/` isolates Twelve Data behind a normalized provider interface (`NormalizedDailyBar`, error classification, credit reservation). Swapping providers touches one directory. |
| 7 | **Strategies are replaceable** | Strategies register in a registry (`server/strategies/index.ts`) behind a common contract (`PatternStage`, `StrategyLevels`, score). The internal scanner API (`/api/internal/scanner/strategies`) is the authoritative registry other services reconcile against. |
| 8 | **Brokerages are replaceable** | `server/broker/types.ts` defines normalized accounts/positions/orders/capabilities; adapters (Tradier, TradeStation, Schwab) plug into a provider registry in `server/broker/index.ts`. |
| 9 | **Everything exposed through MCP tools** | Cross-service intelligence flows through the vcp-trader-mcp service via allowlisted, schema-validated tools — not ad-hoc HTTP calls scattered through the code. |
| 10 | **Backend owns secrets** | Broker OAuth tokens (encrypted at rest), `MCP_SERVICE_TOKEN`, `VCP_INTERNAL_API_KEY`, Stripe and market-data keys never reach the browser. The frontend never talks to a broker or provider directly. |
| 11 | **Frontend owns experience** | The React client owns navigation, gating CTAs, panel isolation, and progressive disclosure. It renders backend contracts; it never computes trading math. |

---

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                   USER                                   │
│           (browser — React 18 + wouter + TanStack Query client)          │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │ HTTPS (session cookie / JWT)
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        VCP TRADER (Express backend)                      │
│                                                                          │
│   ┌──────────────┐  ┌──────────────────────────────────────────────┐     │
│   │ INTENT ROUTER │  │ Deterministic engines                        │    │
│   │ /api/ask      │─▶│ scanners · opportunity store · risk sizing   │    │
│   │ classifyIntent│  │ options evaluator · position protection      │    │
│   │ + opportunity-│  └──────────────────────────────────────────────┘    │
│   │   search gate │  ┌──────────────────────────────────────────────┐    │
│   └──────┬───────┘   │ OpenAI (explain-only, tool-constrained)      │    │
│          │           └──────────────────────────────────────────────┘    │
└──────────┼───────────────────────────────────────────────────────────────┘
           │ Streamable HTTP + Bearer MCP_SERVICE_TOKEN
           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│              vcp-trader-mcp (separate Railway service)                   │
│   Tool host: get_quote · get_market_history · get_news · scan_vcp        │
│   (Sprint 1B: scan_strategy · scan_opportunities · build_trade_candidate)│
└──────────┬───────────────────────────────────────────────────────────────┘
           │ PROVIDERS (normalized interfaces)
           ▼
┌───────────────────────────────┐   ┌──────────────────────────────────────┐
│ Market Data Provider          │   │ Strategy Provider                    │
│ (Twelve Data via VCP internal │   │ (VCP internal scanner API:           │
│  /api/internal/market/history)│   │  /api/internal/scanner/*)            │
└───────────────────────────────┘   └──────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          BROKERAGES (adapters)                           │
│        Tradier · TradeStation · Schwab · SnapTrade (aggregation)         │
│        sandbox/paper accounts · OAuth tokens encrypted at rest           │
└──────────┬───────────────────────────────────────────────────────────────┘
           │ Only through user-confirmed tickets
           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                               EXECUTION                                  │
│   InstaTrade ticket → guardrails → placeBrokerOrder → provider adapter   │
│   Position Protection worker → user-authored exit plans only             │
└──────────────────────────────────────────────────────────────────────────┘
```

Key boundary facts:

- **The browser only talks to the VCP Trader backend.** No broker, market-data, MCP, or OpenAI credentials exist client-side.
- **MCP is bidirectional in dependency but one-directional per call**: VCP Trader calls MCP tools (analysis); MCP calls back into VCP Trader's *internal* authenticated APIs for market history and scanner data. The two services share no database.
- **Execution is below a hard line.** Everything above the Brokerages layer is read/analyze; orders exist only in InstaTrade and Position Protection paths, both requiring explicit prior user action.

---

## 4. MCP Architecture

The MCP layer is a **separate service** (`vcp-trader-mcp` on Railway) hosting tools over the MCP Streamable HTTP transport. VCP Trader is its client (`server/mcp/client.ts` — lazy connect, session reuse, Bearer auth, 5s reconnect cooldown, max 2 attempts, normalized errors, never crashes the app when MCP is down).

### 4.1 Current domains

| Domain | Purpose | Tools (current) | Inputs | Outputs | Dependencies |
|--------|---------|-----------------|--------|---------|--------------|
| **Market** | Quotes, history, news for grounding analysis | `get_quote`, `get_market_history`, `get_news` | symbol, interval/outputSize, limits | quote snapshot; OHLCV series; headline list | Market Data Provider → VCP `/api/internal/market/history` (Twelve Data) |
| **Scanner** | Deterministic pattern analysis | `scan_vcp` (Sprint 1B adds `scan_strategy`, `scan_opportunities`) | `scan_vcp`: `symbols[]` + optional `lookbackDays`; Sprint 1B tools add strategy/timeframe params | stage (no-setup / early / developing / contraction / pivot-ready), contraction sequence, pivot, levels, score | Strategy Provider → VCP `/api/internal/scanner/*` |
| **Risk** | Deterministic trade math | `calculate_trade_risk` (Sprint 1B) | entry, stop, target, account constraints | R:R, position size, dollar risk | none (pure calculation) |
| **Research** | Contextual research | `get_news` (shared with Market); future dedicated research tools | symbol/topic | summarized source material | news provider |
| **Trade** | Trade candidate assembly | `build_trade_candidate` (Sprint 1B), backend-only `get_positions` | SetupCandidate + account context | TradeCandidate (stock / estimated_options / no_trade) | Scanner + Risk + broker positions (backend-only) |

**Allowlisting:** `server/mcp/tools.ts` maintains a hard allowlist. The AI-callable subset excludes `get_positions` — position data reaches prompts only through backend-controlled context builders, never through model-initiated tool calls.

### 4.2 Future domains *(future)*

| Domain | Purpose | Representative tools |
|--------|---------|---------------------|
| **Investment** | Long-horizon company analysis | `analyze_investment`, `compare_investments` |
| **Portfolio** | Holdings-level intelligence | `analyze_portfolio`, `suggest_rebalance`, `find_income_from_holdings` |
| **Planning** | Multi-step goal decomposition | `plan_goal`, `prepare_trade_ticket` |
| **Monitoring** | Standing conditions & alerts | `monitor_conditions`, `check_thesis_breakers` |

### 4.3 Provider architecture

The MCP service is deliberately thin: tools normalize and orchestrate; **providers** own data access.

```
                 vcp-trader-mcp
        ┌────────────┴─────────────┐
        ▼                          ▼
 MarketDataProvider          StrategyProvider
 (interface)                 (interface)
        │                          │
        ▼                          ▼
 VCP internal market API     VCP internal scanner API
 /api/internal/market/       /api/internal/scanner/
   history                     strategies | setup | opportunities
 (Twelve Data behind it)     (authoritative registry + stored results)
```

- `STRATEGY_PROVIDER=vcp` points the MCP at VCP Trader's internal scanner API; the `/strategies` endpoint is **authoritative** and the MCP reconciles its provisional registry against it (alias layer maps slug ids like `momentum_breakout` → real id `VCP`).
- Providers are replaceable per Principle 6/7: a different market-data vendor or an external strategy engine plugs in behind the same interface without touching tools.

---

## 5. Domain Models

Normalized contracts exist so that **every layer speaks the same language about the same thing**: a scanner hit in Postgres, an MCP tool result, an Ask AI card, and a Trade Builder prefill all describe candidates with the same fields. Without them, each surface would re-derive (and eventually contradict) trading semantics.

### 5.1 SetupCandidate *(current)*

The raw output of a strategy scan — "this symbol shows this pattern at this stage."

| Field | Meaning |
|-------|---------|
| `symbol`, `strategy`, `strategyDisplayName` | identity |
| `direction` | `bullish` (all current production strategies are long-only) |
| `status` / stage | normalized `forming / ready / triggered / extended / invalid / unknown` (raw stage preserved in `details`) |
| `score` | raw per-strategy score (0–100); **not** comparable across strategies |
| `timeframe` | currently `1d` in stored results |
| `trigger`, `invalidation`, `technicalObjective` | entry trigger, stop reference, resistance — real stored levels only, `null` when absent |
| `currentPrice`, `detectedAt`, `source` | freshness and provenance |
| `reasons[]`, `warnings[]` | honest, possibly empty |

Persisted form: the `opportunities` table (`shared/schema.ts`), lifecycle `ACTIVE → RESOLVED (BROKE_RESISTANCE | INVALIDATED | EXPIRED)`.

### 5.2 TradeCandidate *(Sprint 1B contract; partially current)*

A SetupCandidate advanced to "how would you actually trade this," produced by `build_trade_candidate`:

- `candidateState`: `stock` | `estimated_options` | `no_trade`
- position sizing inputs, R:R, dollar risk (from the Risk domain)
- for options states: strategy label (CSP/CC), DTE window, strike **zone** (estimated mode never includes premiums/Greeks)
- `no_trade` carries reasons — NO_TRADE is a recommendation, not an absence.

The Ask AI opportunity-search cards already render this contract with `candidateState: null` until the MCP tool ships.

### 5.3 MarketRegime *(current)*

Deterministic market-condition classification (`market_regime_history` table, daily analysis conditions): trend/breadth/volatility posture used to contextualize setups. AI receives it as context; it never computes it.

### 5.4 OptionCandidate *(current)*

A concrete or estimated option position candidate: underlying, strategy (CSP/CC/spread), expiration/DTE, strike (or strike zone in estimated mode), and — only in live-broker mode — premium, Greeks, OI, bid/ask. Stored in `option_candidates` / produced by `server/services/options-evaluator.ts`.

### 5.5 RiskProfile *(current)*

Per-user risk configuration (`riskProfiles`, user settings): account allocation method, per-trade risk, allowed instruments, minimum score/R:R guardrails. Consumed by position sizing (`server/position-sizing.ts`) and execution guardrails (`server/services/execution-guardrails.ts`).

### 5.6 IncomeCandidate *(current)*

Income-specific candidate: covered call (requires ≥100 actually-owned shares, broker-connected) or cash-secured put (estimated from bullish setups). Strike zones derive only from real technical levels (stop reference → detected price). Rendered by Ask AI income searches and Income Mode.

### 5.7 InvestmentCandidate *(future)*

Long-horizon analogue of SetupCandidate: quality/growth/valuation/financial-strength scores, theme membership, thesis, thesis breakers. Deliberately shares **no fields** with SetupCandidate beyond `symbol` — different domain, different vocabulary (Principle 5).

### 5.8 PortfolioAnalysis *(future)*

Holdings-level rollup: allocation by asset/sector/theme, concentration flags, income potential from holdings, hedging suggestions, rebalancing deltas. Built from normalized broker positions, never raw broker payloads.

---

## 6. User Intents

All natural-language entry points funnel into `POST /api/ask` (`server/routes/ask.ts`). Routing is **deterministic-first**: regex/keyword classification runs before any LLM call, and specialized intents short-circuit to deterministic engines.

### 6.1 Intent families

| Family | Example | Routing behavior (current) |
|--------|---------|---------------------------|
| **Analyze** | "Analyze MU" | Ticker extraction → deterministic `scan_vcp` via MCP (forced single scan, `server/mcp/analysis-scan.ts`) → structured `VcpAnalysis` (stage, contraction sequence, pivot) → LLM explains; confidence computed deterministically |
| **Find Trades** | "Find high-quality trade opportunities" | `shouldRouteOpportunitySearch` (intent-first + strict explicit-ticker check) → `runOpportunitySearch` over stored ACTIVE detections → ranked cards; LLM may only summarize the returned list |
| **Find Income** | "Generate income" | Same gate, income type → IncomeCandidates (CC from real holdings, estimated CSPs); no-broker mode labels everything Estimated with a Connect Broker CTA |
| **Compare** | "Compare NVDA and AMD" | Multi-ticker context building; per-ticker deterministic data feeds one explanation |
| **Invest** *(future)* | "Is NVDA a good long-term investment?" | Routes to Investment domain tools — never to trading scanners |
| **Portfolio** | "How are my positions doing?" | Backend-only positions context (never model-initiated); *(future)* full PortfolioAnalysis |
| **Education** | "What is a VCP?" | Educational/general prose path; strategy guides in-app |
| **Research / News** | "Why is NVDA moving?" | `get_news` + quote context |
| **Market** | "How's the market today?" | Home snapshot / market regime context (`/api/home/snapshot`) |

### 6.2 Routing rules

1. **Deterministic classification first** (`classifyIntent`, `classifyOpportunitySearch`) — regexes, not LLM classification.
2. **Ticker-specific asks keep their flows.** Broad-search routing requires no *explicit* ticker (a strict check — the general ticker extractor false-positives on words like "high" and must not gate routing).
3. **Specialized routes short-circuit**: opportunity/income searches return deterministic candidates and skip the LLM entirely on failure/empty.
4. **LLM is constrained per intent**: the system prompt for each specialized route forbids inventing, re-ranking, or calling tools beyond the injected data.
5. **Fallback is rule-based, not silent**: if OpenAI is unavailable, deterministic prose answers ship with the same data (dev environments run this path routinely).

---

## 7. Trading Engine

### 7.1 Scan tools

- **`scan_vcp` (current, MCP):** deterministic single-symbol VCP analysis; stages `no-setup / early / developing / contraction / pivot-ready`; contraction sequence and actionable pivot detection; payload capped; failure never throws into user flows.
- **`scan_strategy` (Sprint 1B):** generalization to any registry strategy, backed by the Strategy Provider (`/api/internal/scanner/setup`).
- **`scan_opportunities` (Sprint 1B):** ranked stored opportunities across strategies (`/api/internal/scanner/opportunities`), production order preserved (detectedAt DESC), no cross-strategy score sorting.

### 7.2 Scheduled scanning (current)

```
 node-cron (ET, weekdays, holiday-aware)  server/scheduled-scan-service.ts
 ┌────────────┬──────────────┬───────────────┬──────────────┬──────────────┐
 │ 8:00 pre-  │ 9:45 VCP     │ 10:00 early   │ 11:00 mid-   │ 16:15 ext-   │
 │ market     │ window       │ momentum      │ morning      │ hours        │
 │ GAP_AND_GO │ VCP          │ ORB5, ORB15,  │ VWAP_RECLAIM │ VCP,         │
 │ VCP,       │ VCP_MULTIDAY │ GAP_AND_GO    │ HIGH_RVOL    │ VCP_MULTIDAY │
 │ VCP_MULTI- │              │               │              │ VWAP_RECLAIM │
 │ DAY        │              │               │              │ HIGH_RVOL    │
 └─────┬──────┴──────┬───────┴──────┬────────┴──────┬───────┴──────┬───────┘
       └─────────────┴── classifyQuote per strategy ┴──────────────┘
                              │  FORMING / READY / BREAKOUT only
                              ▼
                  opportunities table (ACTIVE, deduped per day)
                              │  resolver every 5 min (server/index.ts)
                              ▼
              RESOLVED: BROKE_RESISTANCE | INVALIDATED | EXPIRED (10d for 1d)
```

Ten production strategies (registry `server/strategies/types.ts`, catalog `shared/strategies.ts`): VCP (Momentum Breakout), VCP_MULTIDAY (Power Breakout), ORB5/ORB15 (Open Drive), HIGH_RVOL (Volume Surge), GAP_AND_GO (Gap Force), CLASSIC_PULLBACK (Precision Pullback), TREND_CONTINUATION (Trend Pilot), VWAP_RECLAIM (Institutional Reclaim), VOLATILITY_SQUEEZE (Pressure Break). All long-only.

### 7.3 build_trade_candidate & trade risk

`build_trade_candidate` *(Sprint 1B)* composes: SetupCandidate → risk math (`calculate_trade_risk`: R:R, sizing from RiskProfile) → instrument selection (stock vs options vs no_trade) → TradeCandidate. Earnings proximity and market regime act as deterministic warnings/vetoes, not LLM judgments.

### 7.4 Trade Builder (current)

`/trade-finder` (AgentPage): prompt → `server/agent/prompt-interpreter.ts` → `server/agent/strategy-engine.ts` → scored setups (`trade_setup_history`), instrument recommendation (`server/services/instrument-selector.ts`), probability context (`server/services/probability-engine.ts`), position sizing (`server/position-sizing.ts`). Output is a **ticket**, never an order.

### 7.5 InstaTrade (current) — the user-directed execution path

```
 Setup card ─▶ Trade ticket (stock/option/futures components)
                  │ user reviews: qty, entry, stop, target, account
                  ▼
       Risk acknowledgment + (live) liveSetupCompleted gate (422 otherwise)
                  ▼
       Execution guardrails (server/services/execution-guardrails.ts)
       allowed instruments · defined risk · min score · min R:R
                  ▼
       POST /api/trade/place-equity | place-option
                  ▼
       placeBrokerOrder (server/broker/index.ts) ─▶ provider adapter
       sandbox:* accounts → simulated/sandbox; live → real order
```

### 7.6 Position Protection (current)

User-authored exit plans (stop / target / trailing, stock or option, market/stop/stop-limit exits). Worker polls (~15s live / ~60s paper) during tradeable sessions, advances high-water trailing stops, and on trigger **re-fetches the position, verifies side/existence, clamps quantity to held amount** before submitting the opposite-side exit. Atomic `ACTIVE→TRIGGERED` claim plus order-id guard prevents duplicate exits. Live exits additionally require `ENABLE_LIVE_POSITION_PROTECTION`. Failed exits become terminal `ERROR` with notification (retry queue is a known roadmap item).

---

## 8. Investment Engine *(future)*

**Independent from trading by design.** No shared candidates, scores, or stages; only shared infrastructure (market data, MCP transport, auth).

| Component | Design intent |
|-----------|---------------|
| **InvestmentCandidate** | symbol + four pillar scores (quality, growth, valuation, financial strength), theme tags, thesis, thesis breakers |
| **Quality** | margins, returns on capital, moat proxies — deterministic scoring from fundamentals data |
| **Growth** | revenue/EPS trajectory, durability signals |
| **Valuation** | multiple-based and yield-based fair-value ranges; never a single "target price" |
| **Financial strength** | leverage, coverage, liquidity |
| **Themes** | curated theme membership (e.g., AI infrastructure) for discovery and concentration analysis |
| **Thesis** | short structured investment thesis the AI *explains*, generated from pillar data |
| **Thesis breakers** | explicit falsifiers ("thesis breaks if X") that feed the Monitoring domain |
| **Portfolio allocation** | hands candidates to the Portfolio Engine; the Investment Engine itself never sizes positions |

MCP tools: `analyze_investment`, `compare_investments`, `build_investment_portfolio`. A fundamentals data provider joins the provider architecture (Principle 6) — the trading market-data path is not overloaded for this.

---

## 9. Options Engine

### 9.1 Two modes

| | **Estimated mode** (no broker) | **Live mode** (broker connected) |
|---|---|---|
| Data source | Real technical levels from stored setups only | Broker option chains (bid/ask, Greeks, OI) |
| Output | Strategy + DTE window + strike **zone**; explicitly labeled *Estimated* | Concrete contracts with live pricing |
| Never shown | Premiums, Greeks, OI, bid/ask — **never fabricated** | — |
| CTA | "Connect Tradier or TradeStation to evaluate live contracts…" | Trade ticket |

**Why estimated mode exists:** most users start without a connected broker. Refusing to discuss options would gut the income experience; fabricating premiums would violate Principle 2. Estimated mode threads the needle: it teaches the *shape* of the trade (strategy, strike zone from real support/resistance, DTE window) from data we actually have, and is honest about what requires live chains.

### 9.2 Provider abstraction

Option chains flow through the same broker abstraction (`server/broker/index.ts` delegating to provider adapters):

- **Tradier** — primary options broker; sandbox accounts (`sandbox:<id>`) for paper; no native trailing stops (Position Protection emulates them).
- **TradeStation** — options + futures; `simMode` selects SIM endpoints.
- **Future providers** — any adapter implementing the chain/quote/order capabilities in `server/broker/types.ts` slots in; capability flags let the UI degrade gracefully per broker.

Evaluation (delta/DTE/premium/OI/volume/max-risk filters) lives in `server/services/options-evaluator.ts` and the options scanner; income strategy selection (CSP vs CC vs wheel transitions) in the instrument selector / prompt interpreter.

---

## 10. Portfolio Engine *(future)*

Builds on the **existing** normalized position layer (`getBrokerPositions`, `getBrokerAccounts` across Tradier/TradeStation/Schwab plus SnapTrade aggregation for read-only holdings).

| Capability | Design intent |
|------------|---------------|
| **Portfolio analysis** | Allocation by asset class/sector/theme; performance attribution from normalized positions |
| **Income generation** | Scan *holdings* for covered-call/CSP opportunities (the current ≥100-share CC rule generalizes here) |
| **Hedging** | Deterministic hedge suggestions (protective puts, collars) sized from RiskProfile |
| **Allocation** | Target-vs-actual with InvestmentCandidate inputs |
| **Rebalancing** | Delta lists a user can turn into tickets — every leg goes through the standard confirm-to-execute path |
| **Concentration** | Position/sector/theme concentration flags feeding Monitoring |

**Broker interaction rule:** the engine reads *normalized* positions only, and its outputs are recommendations that terminate in Trade Builder tickets. It never places orders. Multi-broker users get a merged view with per-account provenance.

---

## 11. AI Command Center

The logged-in homepage (`client/src/pages/command-center.tsx`) is **goal-oriented, not feature-oriented**: users arrive with a goal, not a feature name, so the page leads with a natural-language command bar backed by the single Ask AI backend, surrounded by glanceable panels.

### 11.1 Goal pillars & example prompts

| Pillar | Example prompts |
|--------|----------------|
| **Trade** | "Find high-quality trade opportunities" · "Analyze MU" · "Show me pivot-ready stocks" |
| **Income** | "Generate income" · "Find covered call opportunities" |
| **Invest** *(future)* | "Is NVDA a good 3-year investment?" · "Compare AMD and NVDA as investments" |
| **Portfolio** | "How are my positions doing?" · *(future)* "Where am I over-concentrated?" |
| **Research** | "Why is MU moving today?" · "What's the market regime?" |

### 11.2 Current structure

- **Hero command bar** → routes through `askRoute()` to `/ask?q=`; quick actions: Analyze (prefills), Find Trades, Generate Income, Scan Market (→ `/scanner`).
- **Today's Opportunities** — top 5 ACTIVE detections with stage-aware CTAs (Trade Builder only for pivot-ready; §9 gating in `client/src/lib/command-center.ts`).
- **My Portfolio** — connected/disconnected states; null-safe totals (never invents a total when any position lacks data).
- **Market Intelligence** — compact `/api/home/snapshot` (60s refetch).
- **Per-panel failure isolation** — one failing panel never blanks the page.
- **Hidden boundaries** — AI Brief and Continue Research render null until their backends exist (honest absence over placeholder content).

---

## 12. MCP Tool Taxonomy

### 12.1 Current tools

| Group | Tool | Notes |
|-------|------|-------|
| Market | `get_quote` | quote snapshot |
| Market | `get_market_history` | OHLCV via internal market API |
| Research | `get_news` | headlines for a symbol |
| Scanner | `scan_vcp` | deterministic VCP analysis (stages, contractions, pivot) |
| Trade (backend-only) | `get_positions` | excluded from AI-callable subset by design |

### 12.2 Sprint 1B tools (contract agreed; VCP-side provider APIs shipped)

| Group | Tool |
|-------|------|
| Scanner | `scan_strategy` (any registry strategy, one symbol) |
| Scanner | `scan_opportunities` (ranked stored opportunities, filters) |
| Trade | `build_trade_candidate` (SetupCandidate → TradeCandidate) |
| Risk | `calculate_trade_risk` |

### 12.3 Planned tools *(future)*

| Group | Tools |
|-------|-------|
| Investment | `analyze_investment` · `compare_investments` · `build_investment_portfolio` |
| Portfolio | `analyze_portfolio` · `find_income_from_holdings` · `suggest_rebalance` · `suggest_hedges` |
| Options | `select_option_contracts` (live-mode contract selection) |
| Planning | `prepare_trade_ticket` (assembles a ticket for user confirmation — never submits) |
| Monitoring | `monitor_conditions` · `check_thesis_breakers` |
| Market | `get_market_regime` · `get_earnings_calendar` |

Grouping rule: tools live in exactly one domain; cross-domain workflows compose tools (Planner, §16) rather than growing mega-tools.

---

## 13. Security

| Boundary | Mechanism |
|----------|-----------|
| **User ↔ VCP Trader** | Email/password (bcrypt) with Postgres-backed sessions (7-day httpOnly cookie) + JWT Bearer compatibility (`AUTH_JWT_SECRET`, 12h); email verification stores only SHA-256 token hashes; verification/reset links built from configured base URL, never request headers (host-header token-leak prevention) |
| **VCP Trader ↔ MCP** | `MCP_BASE_URL` + `MCP_SERVICE_TOKEN` Bearer (backend env only); tool allowlist; AI-callable subset excludes position access |
| **MCP ↔ VCP internal APIs** | `Authorization: Bearer <VCP_INTERNAL_API_KEY>`; constant-time compare (SHA-256 + `timingSafeEqual`); fail-closed 503 when unset; token never logged; endpoints expose market/scanner intelligence only — userId, internal row ids, dedupe keys stripped; no broker/account/order data reachable |
| **Broker credentials** | OAuth tokens in encrypted DB columns; proactive refresh loops; secrets never serialized to the client; SnapTrade user secrets encrypted |
| **Read-only vs execution tools** | All MCP tools are read/analyze. Execution endpoints (`/api/trade/place-*`) require an authenticated user session, risk acknowledgment, live-setup gate, and server-side guardrails — no service token can reach them |
| **Execution boundaries** | AI answers end in CTAs, never orders; Position Protection acts only on user-authored plans with atomic claim + clamp-to-held-quantity safety; live protection additionally env-gated; the legacy AUTO-mode agent worker (§2, Principle 3) is consent-gated and slated for deprecation |
| **Plan/feature gating** | Server-side `requireFeature()` (402 structured upgrade), daily AI quotas (429), trial symbol allowlists; market-data licensing enforced server-side via env-controlled access levels |

---

## 14. Data Flow

### 14.1 Analyze Stock (current)

```
User: "Analyze MU"
  │
  ▼
/api/ask ── classifyIntent → analyze (ticker: MU)
  │
  ├─▶ buildContext: local services (market snapshot, sentiment,
  │    user/session context) — no MCP calls here
  ▼
callOpenAi(question, context)
  ├─ forced deterministic scan_vcp(MU) ── MCP ──▶ StrategyEngine
  │      └─ VcpAnalysis: stage, contraction sequence, pivot, levels
  │        (injected into the prompt; explain-only rules)
  ├─ model may call allowlisted MCP tools (quote/history/news)
  │        └─ fallback: rule-based prose from same payload
  ▼
Answer + structured VCP card + deterministic confidence
```

### 14.2 Find Trades (current)

```
User: "Find high-quality trade opportunities"
  │
  ▼
/api/ask ── shouldRouteOpportunitySearch → "trade"   (intent-first;
  │          strict explicit-ticker check — never blocked by
  │          extractTickers false positives like "high")
  ▼
runOpportunitySearch
  ├─ fetch stored ACTIVE detections (≤14d, supported stages)
  ├─ preserve production order (detectedAt DESC) — no re-ranking
  └─ toOpportunityCard: real fields only, candidateState null until
     build_trade_candidate ships
  │
  ├─ empty → "No high-quality setups currently meet the criteria."
  ├─ failure → "Live opportunity data is temporarily unavailable." (no LLM)
  ▼
Optional LLM summary of the exact list → ranked cards + gated CTAs
```

### 14.3 Generate Income (current)

```
User: "Generate income"
  │
  ▼ income intent (checked before trade intents)
buildIncomeCandidates
  ├─ broker connected? ── yes ─▶ positions ≥100 shares → CoveredCall candidates
  │                    └─ position fetch failure degrades CC only
  └─ bullish stored setups → Estimated CSP candidates
        strike zones from real stop-reference/detected prices ONLY
        never premiums/Greeks/OI  →  "Connect broker" CTA when estimated
  ▼
Income cards (Estimated labels) + deterministic confidence
```

### 14.4 Trade Builder → Execution (current)

```
Setup (scan / opportunity card / prompt)
  ▼
Trade Builder: interpreter → strategy engine → sizing → ticket
  ▼
User edits & confirms ticket ──▶ risk acknowledgment ──▶ live-setup gate
  ▼
Guardrails (instrument / defined-risk / min score / min R:R)
  ▼
placeBrokerOrder → adapter (sandbox: simulated | live: real)
  ▼
Order status → positions → (optional) Position Protection plan
```

### 14.5 Investment Analysis *(future)*

```
User: "Is NVDA a good long-term investment?"
  ▼
Intent Router → Invest domain (never trading scanners)
  ▼
analyze_investment (MCP) → fundamentals provider
  ├─ pillar scores: quality · growth · valuation · strength
  ├─ thesis + thesis breakers (deterministic inputs)
  ▼
LLM explains the thesis → InvestmentCandidate card
  ▼
optional: build_investment_portfolio → Portfolio Engine → allocation
  (execution, as always, only via user-confirmed tickets)
```

---

## 15. Roadmap

Sprints are sequential milestones (roughly 1–2 weeks each); dependencies are explicit.

| Sprint | Objective | Key deliverables | Acceptance criteria | Depends on |
|--------|-----------|------------------|---------------------|------------|
| **0** | Foundation hardening *(done)* | MCP client + allowlist; internal market API; deterministic Analyze flow; exit-safety tests | Analyze works E2E vs live MCP; internal API authed; no fabricated data paths | — |
| **1A** | AI Command Center + deterministic opportunity search *(done, pending approval)* | Command Center homepage; opportunity-search routing, income candidates, cards | Broad searches return ranked real candidates; ticker asks untouched; tests green | 0 |
| **1B** | Strategy Provider + MCP scanner tools | VCP internal scanner API *(done, pending approval)*; MCP `scan_strategy`/`scan_opportunities`/`build_trade_candidate`/`calculate_trade_risk`; registry reconciliation | MCP with `STRATEGY_PROVIDER=vcp` lists the 10 real strategies; tools return stored results with truthful freshness | 0 |
| **2** | Live opportunity answers | Ask AI switches to `scan_opportunities`; candidateState from `build_trade_candidate`; graceful fallback to stored data | Cards show stock/estimated_options/no_trade states from live data; `/api/ask` integration tests | 1A, 1B |
| **3** | Execution-path verification | Paper-sim exit placement tests; live re-verify/clamp validation vs broker sandbox; exit retry queue + "needs attention" surfacing | Failed exits retry with visibility; no duplicate submits under fault injection | 0 |
| **4** | Options live-mode deepening | `select_option_contracts`; live-chain candidate upgrade of estimated cards; liquidity guards | Estimated→live upgrade path for connected users; illiquid contracts filtered | 2 |
| **5** | Monitoring v1 | `monitor_conditions`; standing alerts on triggers/invalidation; notification pipeline consolidation | User can arm "tell me when X triggers" from any card | 2 |
| **6** | Portfolio Engine v1 (read) | PortfolioAnalysis model; allocation/concentration analysis; holdings-income scan | Multi-broker merged view; income-from-holdings answers use real positions | 1B |
| **7** | Fundamentals provider | Provider abstraction for fundamentals; data licensing; caching/credit control | Pillar data retrievable for US equities within quota | — |
| **8** | Investment Engine v1 | InvestmentCandidate; `analyze_investment`; Invest intent family | Invest asks route to investment tools; zero bleed into trading vocabulary | 7 |
| **9** | Compare & themes | `compare_investments`; theme registry; comparison UI | Side-by-side pillar comparison cards | 8 |
| **10** | Portfolio Engine v2 (advise) | Rebalancing deltas; hedging suggestions; `suggest_rebalance` | Every suggestion terminates in a reviewable ticket | 6, 8 |
| **11** | Planner v1 | Goal decomposition over MCP tools; multi-step reasoning traces; `prepare_trade_ticket` | Planner produces auditable tool-call plans; never executes | 2, 5, 6 |
| **12** | Thesis monitoring & continuous intelligence | `check_thesis_breakers`; regime-change alerts; proactive AI Brief panel | AI Brief populates from real monitors; thesis-breaker alerts fire on data | 5, 8, 11 |

---

## 16. Future Agent

The long-term AI planner generalizes today's single-intent routing into **multi-step, goal-oriented orchestration** — with the same hard boundary: *the planner never executes trades*.

```
User Goal ("Generate $500/month income from my portfolio with defined risk")
  │
  ▼
PLANNER (LLM constrained to the MCP tool catalog)
  ├─ decomposes goal → ordered tool plan
  ├─ plan is visible/auditable before and after running
  ▼
MULTIPLE MCP TOOLS (read/analyze only)
  get_positions* → analyze_portfolio → find_income_from_holdings
  → select_option_contracts → calculate_trade_risk
  (*backend-injected — position data never via model-initiated calls)
  ▼
REASONING
  deterministic outputs in → LLM synthesizes tradeoffs, flags NO_TRADE legs
  ▼
RECOMMENDATION
  structured candidate set + rationale + risks; every number traceable
  to a tool result
  ▼
TRADE BUILDER
  user opens pre-filled tickets → reviews → confirms (or doesn't)
```

Guardrails carried forward from v1: tool allowlisting per domain; explain-only synthesis (no invented numbers); deterministic confidence; bounded tool budgets per plan; full audit trail of tool calls and outputs; and execution exclusively through user-confirmed tickets behind the existing guardrail stack.

---

## 17. Appendix

### 17.1 Glossary

| Term | Definition |
|------|-----------|
| **VCP** | Volatility Contraction Pattern — successively tighter price contractions preceding a potential breakout |
| **Contraction sequence** | The measured series of contraction depths (e.g., 21.6% → 28.9% → 22.4%) characterizing a base |
| **Pivot** | Actionable breakout trigger price at the top of the final contraction |
| **Stage** | Scanner classification of setup maturity (local: FORMING/READY/BREAKOUT; MCP VCP: no-setup → pivot-ready) |
| **SetupCandidate / TradeCandidate / IncomeCandidate / InvestmentCandidate** | Normalized domain contracts (§5) |
| **NO_TRADE** | First-class recommendation that no qualified trade exists |
| **InstaTrade** | The user-directed execution path (ticket → guardrails → broker) |
| **Position Protection** | User-authored automated exit plans (stop/target/trailing) |
| **Wheel** | Income cycle: CSP → assignment → covered calls → called away |
| **Estimated mode** | Options guidance from real technical levels without live chains; never fabricates pricing |
| **Opportunity** | A persisted scanner detection with lifecycle tracking (ACTIVE → RESOLVED) |

### 17.2 Acronyms

MCP (Model Context Protocol) · VCP (Volatility Contraction Pattern) · CSP (Cash-Secured Put) · CC (Covered Call) · DTE (Days To Expiration) · OI (Open Interest) · R:R (Reward-to-Risk) · RVOL (Relative Volume) · ORB (Opening Range Breakout) · OHLCV (Open/High/Low/Close/Volume) · E2E (End to End)

### 17.3 Architecture decisions (ADR summary)

| Decision | Rationale |
|----------|-----------|
| Deterministic-first intent routing (regex before LLM) | Predictable, testable, zero-cost routing; LLM variability never decides *what* runs |
| MCP as a separate service | Independent deploy cadence; clean provider abstraction; tool allowlisting as a security boundary |
| Internal APIs over shared DB between services | Contract-versioned, authenticated boundaries; no cross-service schema coupling |
| Constant-time internal-key auth, fail-closed | Service tokens are the only cross-service trust; misconfiguration must deny, not allow |
| Per-user opportunity rows, cross-user dedupe at the internal API | Preserves per-user product semantics while exposing market intelligence service-level |
| Estimated options mode | Honest value without live chains (Principle 2); creates a truthful upgrade path to broker connection |
| No cross-strategy score normalization | Scores are strategy-local; pretending comparability would fabricate a ranking |
| Alias layer for strategy ids | Lets external registries (MCP provisional slugs) reconcile without breaking; `/strategies` stays authoritative |
| Session + JWT dual auth | Browser UX (cookie sessions) plus service/API compatibility (Bearer) |
| Trailing stops emulated in Position Protection | Tradier lacks native trailing stops; emulation with atomic claims keeps behavior broker-portable |

### 17.4 Naming conventions

- **Strategy ids**: SCREAMING_SNAKE (`VCP_MULTIDAY`); display names are branded ("Power Breakout"); guide slugs kebab-case.
- **Lifecycle values**: UPPERCASE in storage (`ACTIVE`, `RESOLVED`, `BROKE_RESISTANCE`); normalized lowercase vocabularies at API boundaries (`forming`…`unknown`).
- **Routes**: `/api/<domain>/...`; internal service APIs under `/api/internal/...`.
- **Files**: kebab-case modules; colocated `*.test.ts`; React pages in `client/src/pages`, shared logic in `client/src/lib` (pure, testable), presentational components in `client/src/components`.
- **Intents**: `opportunity-search:<type>` style compound intent labels in API responses.

### 17.5 Folder organization

```
client/src/
  pages/        route-level components (wouter)
  components/   presentational + feature components (shadcn/Radix ui/ subdir)
  lib/          pure helpers & typed API contracts (unit-tested)
server/
  routes/       feature route modules (+ tests); routes.ts = registration hub
  mcp/          MCP client, config, tool allowlist, analysis normalization
  strategies/   strategy registry + implementations
  broker/       normalized broker abstraction + provider adapters
  services/     domain services (billing, email, options, guardrails,
                position-protection, daily-market-data, …)
  agent/        Trade Builder interpreter/engine
shared/
  schema.ts     Drizzle schema + shared enums/types (single source of truth)
  strategies.ts strategy catalog (display metadata)
docs/           architecture & design documents (this file)
```

### 17.6 Coding standards

- TypeScript everywhere; shared types flow from `shared/schema.ts` outward — never redefined per layer.
- Pure logic lives in importable, unit-testable modules; route handlers stay thin and use dependency injection for storage/network (see `internal-scanner.ts`, `opportunity-search.ts` deps patterns).
- Structured errors: `{ error: { code, message } }` with stable codes; client messages stable, provider detail stays in logs.
- No silent fallbacks: failures surface as explicit states; absence of data renders as absence.
- Secrets only via environment; never logged, never serialized to clients.

### 17.7 Testing philosophy

- **Deterministic-first testing**: pure engines (classifiers, filters, normalizers, calculators) get exhaustive unit tests; LLM output is never asserted on — only the deterministic payloads that feed it.
- Route tests run against standalone Express apps with injected fakes (auth via env-keyed bearer, storage via deps) — no live DB or network.
- Safety paths get dedicated tests: exit-trigger/duplicate-exit safety, no-scan-triggered assertions, sensitive-field leak checks.
- Practicality note: vitest resolves root to `client/`; server tests run with `npx vitest run --root . <file>`.

### 17.8 Versioning strategy

- **This document**: versioned filename (`VCP_Trader_AI_Architecture_v1.md`); breaking architectural revisions bump the version, additive edits amend v1 with a changelog entry below.
- **Internal API contracts**: additive-only within a version; breaking changes require a new path or negotiated migration with the consuming service (MCP), coordinated via the authoritative `/strategies` registry.
- **MCP tools**: tool schemas are contracts; new capabilities arrive as new tools or optional fields, never repurposed fields.
- **Database**: Drizzle migrations run at Railway startup (`script/migrate.ts`); schema changes are forward-only.

### 17.9 Changelog

| Date | Version | Change |
|------|---------|--------|
| 2026-08 | 1.0 | Initial authoritative architecture document |
