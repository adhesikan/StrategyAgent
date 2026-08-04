# TraderBrain Core — Architecture & Contract Design

> **Status:** Architecture proposal. No code has been implemented.
> **Scope:** Orchestration layer only. Does not modify MCP, scanner, ranking,
> recommendation, risk, portfolio, broker, Trade Builder, or execution behavior.
> **Author:** Generated from codebase audit of `server/routes/ask.ts` and all
> modules it imports, August 2026.

---

## Table of Contents

1. [Current Orchestration Map](#1-current-orchestration-map)
2. [Duplication Found](#2-duplication-found)
3. [Proposed Module Structure](#3-proposed-module-structure)
4. [Intent Matrix](#4-intent-matrix)
5. [Tool-Plan Contract](#5-tool-plan-contract)
6. [Evidence Contract](#6-evidence-contract)
7. [Response Contract](#7-response-contract)
8. [Failure Policies](#8-failure-policies)
9. [Migration Sequence](#9-migration-sequence)
10. [Test Strategy](#10-test-strategy)
11. [Risks and Compatibility Concerns](#11-risks-and-compatibility-concerns)

---

## 1. Current Orchestration Map

### 1.1 Entry Point

```
POST /api/ask
  server/routes/ask.ts  registerAskRoutes()
```

**Middleware chain:**
1. `isAuthenticated` — session guard (→ 401 on miss)
2. `askSchema.safeParse(req.body)` — Zod: `{ question: string(1–500) }` (→ 400 on fail)
3. `req.session.userId` guard (→ 401)

### 1.2 Shared Pre-routing Steps (always executed)

| Step | Function | File |
|---|---|---|
| Legacy intent classification | `classifyIntent(q)` | `ask.ts:548` |
| Symbol extraction | `extractTickers(question)` | `lib/ticker-extraction.ts` |
| Context building | `buildContext(userId, question, intent, tickers)` | `ask.ts` |

**`classifyIntent` output taxonomy (legacy):**
`"best-trade" | "income" | "growth" | "news" | "trade-idea" | "general"`

**`buildContext` output:** quotes, computed indicators (RSI/MACD/SMA/Bollinger/ATR/VWAP),
news sentiment, reference snapshots, broker-connected flag, `pfAwareness` (if connected).
Does NOT call MCP directly — uses reference-snapshot module and news-service.

### 1.3 Routing Branches (evaluated in order, first match returns)

```
POST /api/ask
 │
 ├─ isMcpEnabled() ──────────────────────────────────────────────────────────────┐
 │   │                                                                            │
 │   ├─ [A] classifyPortfolioTradePlan(question, tickers)                        │
 │   │       → PortfolioTradePlanGoal | null                                     │
 │   │       file: routes/portfolio-trade-plan.ts:146                            │
 │   │       if match → mint pfToken + optToken                                  │
 │   │                → plan_portfolio_trade (MCP)                               │
 │   │                → buildPortfolioTradePlanAnswer()                          │
 │   │                → OpenAI explanation (optional)                            │
 │   │                → revoke tokens                                            │
 │   │                → return early ✓                                           │
 │   │                                                                            │
 │   ├─ [B] classifyRankedTradeSearch(question, tickers)                         │
 │   │       → TradeGoal | null                                                  │
 │   │       file: routes/ranked-trade-search.ts:49                              │
 │   │       calls: classifyTradeRequest() + normalizeTradeGoal()                │
 │   │       if match → mint pfToken (connected users)                           │
 │   │                → rank_market_trade_candidates (MCP)                       │
 │   │                → validateRankedTradeSearch()                              │
 │   │                → buildRankedTradeSearchAnswer()                           │
 │   │                → OpenAI explanation (optional)                            │
 │   │                → return early ✓                                           │
 │   │                                                                            │
 │   └─ [C] classifyOpportunitySearch(question, tickers)                         │
 │           → OpportunitySearchGoal | null                                      │
 │           file: routes/opportunity-search.ts                                  │
 │           if match → scan_opportunities (MCP)                                 │
 │                    OR stored-DB fallback (runOpportunitySearch)               │
 │                    → OpenAI explanation (optional)                            │
 │                    → return early ✓                                           │
 │                                                                               │
 └─ [D] General path → callOpenAi(question, ctx)                                │
         Internal routing inside callOpenAi:                                    │
           ├─ classifyTradeRequest() → if recommendation:                       │
           │   ├─ recommend_trade_strategy (MCP)                                │
           │   └─ return deterministic + optional OpenAI prose                  │
           ├─ multi-strategy analysis (scan_vcp + multi-strategy tools)         │
           └─ generic OpenAI GPT with MCP_AI_TOOLS (get_quote, get_news,       │
              get_market_history, scan_vcp)                                     │
```

### 1.4 CTA Selection (post-routing, before `res.json`)

```
if (strategyRecommendation) → suggestionsForRecommendation()   (strategy-recommendation.ts)
else if (multiStrategyAnalysis) → suggestionsForMultiStrategy() (multi-strategy-analysis.ts)
else if (vcpAnalysis.stage) → suggestionsForVcpStage()          (analysis-scan.ts)
else → suggestionsForIntent()                                    (ask.ts:578)

Opportunity: suggestionsForOpportunitySearch()                   (opportunity-search.ts)
Ranked: rankedTradeSearchSuggestions()                           (ranked-trade-search.ts)
Portfolio plan: portfolioTradePlanSuggestions()                  (portfolio-trade-plan.ts)
```

### 1.5 Response Assembly

All branches converge at `res.json(...)` with an ad-hoc spread of fields:

```typescript
res.json({
  question,
  intent,           // legacy classifyIntent output
  tickers,
  brokerConnected,
  ...answer,        // headline, answer, keyPoints, riskNote, confidence, source
  portfolioAwareness,
  picks,
  tradeDetail,
  suggestions,
  source,
  disclaimer,
  // Branch-specific fields added by spread before this point:
  // rankedTradeSearch, rankedSearchSource, rankedTradeSearchFailed,
  // opportunitySearch, opportunitySearchFailed,
  // portfolioTradePlan, portfolioTradePlanFailed,
  // vcpAnalysis, vcpScanFailed,
  // strategyRecommendation, multiStrategyAnalysis,
  // referencesUsed,
})
```

### 1.6 MCP Tool Allowlist Summary

```typescript
// AI-callable (model may invoke via function-calling):
MCP_AI_TOOLS = ["get_quote", "get_market_history", "get_news", "scan_vcp"]

// Backend-orchestration only (model never selects or sees these arguments):
BACKEND_ONLY_TOOLS = [
  "scan_strategy", "scan_opportunities",
  "build_trade_candidate", "calculate_position_risk",
  "get_market_regime", "get_earnings", "get_fundamentals",
  "get_options_chain", "analyze_options",
  "select_option_contracts", "calculate_trade_risk",
  "prepare_trade_ticket",
  "recommend_trade_strategy",
  "rank_market_trade_candidates",
  "plan_portfolio_trade",
]
```

Source: `server/mcp/tools.ts:19–66`.

---

## 2. Duplication Found

### 2.1 Multiple Classification Layers for One Question

A single question is classified by up to **four independent classifiers** that
do not share a taxonomy and are not mutually aware:

| Classifier | Location | Output type |
|---|---|---|
| `classifyIntent()` | `ask.ts:548` | `"best-trade" \| "income" \| "growth" \| "news" \| "trade-idea" \| "general"` |
| `classifyPortfolioTradePlan()` | `portfolio-trade-plan.ts:146` | `PortfolioTradePlanGoal \| null` |
| `classifyRankedTradeSearch()` | `ranked-trade-search.ts:49` | `TradeGoal \| null` |
| `classifyOpportunitySearch()` | `opportunity-search.ts` | `OpportunitySearchGoal \| null` |
| `classifyTradeRequest()` | `strategy-recommendation.ts:477` | `TradeRequestIntent \| null` |

**Risk:** A new intent type requires changes in multiple files with no
compile-time guarantee they stay consistent. A classification added in one file
is invisible to the others.

### 2.2 `classifyTradeRequest` + `normalizeTradeGoal` Invoked in Three Places

1. `ranked-trade-search.ts:50–54` (ranked classifier)
2. `ask.ts:1685–1688` (legacy ticket suppression guard — `recommendationHandled`)
3. Inside `callOpenAi` (internal routing to `recommend_trade_strategy`)

All three call the same pure functions, but the results are not shared. The
ranked branch and `callOpenAi` effectively run the same classification
independently for the same question.

### 2.3 Portfolio Token Minting Pattern Repeated in Three Branches

Each of portfolio trade plan (Branch A), ranked trade search (Branch B), and
the general recommendation path mints its own `pfToken` / `optToken`, revokes
it in `finally`, and reads `pfAwareness` independently. The pattern is correct
but duplicated; any change to token lifecycle must be applied to all three.

### 2.4 Deterministic Answers Built in Two Places for the Same Intent

For symbol recommendations, the deterministic result is assembled inside
`callOpenAi` (which is also responsible for OpenAI prose), rather than in a
separate step. This conflates "compute the deterministic answer" with
"optionally enrich with prose," making it hard to test either in isolation.

### 2.5 Legacy `classifyIntent` Kept in Parallel with Specialized Classifiers

`classifyIntent` was the original router. Specialized classifiers were added
additionally but never replaced it. Its output still drives CTA fallback
(`suggestionsForIntent`) and the OpenAI system prompt context — but the
specialized classifiers return first for the intents they own. The legacy
classifier therefore classifies questions that were already handled,
contributing to confusion about the "true" intent.

---

## 3. Proposed Module Structure

```
server/
  brain/
    TraderBrainService.ts       ← Main orchestrator (§3.1)
    IntentClassifier.ts         ← Unified closed-enum classifier (§4)
    ToolPlanner.ts              ← Deterministic tool-plan builder (§5)
    EvidenceCollector.ts        ← MCP execution + evidence envelope (§6)
    ResponseComposer.ts         ← Builds TraderBrainResult from evidence (§7)
    TrustedContextMinter.ts     ← Portfolio/options token lifecycle (refactored)
    FailurePolicy.ts            ← Named failure behaviors (§8)
    types.ts                    ← All shared types for the brain layer
    __tests__/
      IntentClassifier.test.ts
      ToolPlanner.test.ts
      EvidenceCollector.test.ts
      ResponseComposer.test.ts
```

### 3.1 TraderBrainService

```typescript
interface TraderBrainService {
  execute(
    request: TraderBrainRequest,
    trustedContext: TrustedContext,
  ): Promise<TraderBrainResult>;
}

interface TraderBrainRequest {
  requestId: string;        // uuid minted at handler entry
  question: string;         // validated (1–500 chars)
  userId: string;           // from authenticated session
}

interface TrustedContext {
  // Computed once per request, before classification.
  // Never derived from model output.
  tickers: string[];                            // from extractTickers()
  brokerConnected: boolean;
  portfolioToken?: string;                      // opaque, short-lived
  optionsToken?: string;                        // opaque, short-lived
  portfolioAwareness?: SafePortfolioAwareness;  // safe derived fields only
  marketContext?: BuildContextResult;           // quotes, news, sentiment
}
```

**Invariants:**
- `TrustedContext` is assembled by the route handler, not by the Brain.
- The Brain never constructs, inspects, or forwards broker credentials.
- Token lifecycle (mint, pass to MCP, revoke) remains in `TrustedContextMinter`.

### 3.2 Responsibility Boundaries (spec §2)

| Layer | Owns |
|---|---|
| **TraderBrain** | Intent classification, tool-plan construction, MCP execution sequencing, evidence collection, response composition, failure isolation, observability |
| **MCP** (`vcp-trader-mcp`) | Trading decisions, candidate qualification, ranking, risk calculations, strategy semantics, portfolio policy, options selection |
| **OpenAI** | Explanation prose only, education text, natural-language summarization. Never selects symbols, tools, or verdicts. |
| **Frontend** | Rendering, CTA gating (based on validated structured fields only), user interaction |

---

## 4. Intent Matrix

### 4.1 Closed Intent Union

```typescript
type TraderBrainIntent =
  | "ANALYZE_SYMBOL"                  // "Analyze MU", "What is NVDA doing?"
  | "RECOMMEND_SYMBOL_TRADE"          // "Find a covered call on NVDA", "Trade idea for AAPL"
  | "RANK_MARKET_TRADES"              // "Find the best trades today", "Income opportunities"
  | "PLAN_PORTFOLIO_TRADE"            // "Find a trade risking under $500", "5% of my portfolio"
  | "ANALYZE_PORTFOLIO"               // "How is my portfolio positioned?", "What is my exposure?"
  | "EXPLAIN_CONCEPT"                 // "What is a credit spread?", "How does VCP work?"
  | "EDUCATION_PLUS_ACTION"           // "Explain momentum AND find me one" (composite)
  | "MARKET_RESEARCH"                 // "Why is the market down?", "Fed news impact"
  | "COMBINED_ANALYSIS_RECOMMENDATION" // "Analyze MU and give me a trade idea"
  | "UNKNOWN";                        // Catch-all → safe generic response
```

### 4.2 Intent Definitions

#### ANALYZE_SYMBOL

| Field | Value |
|---|---|
| **Required fields** | `tickers` (1+ validated symbol) |
| **Optional fields** | `marketContext`, `portfolioAwareness` |
| **Primary MCP tool** | `scan_vcp` → `build_trade_candidate` |
| **Supporting tools** | `get_quote`, `get_news`, `get_market_history`, `get_earnings`, `get_fundamentals` |
| **Trusted-context requirement** | Market context only (no portfolio token needed unless awareness requested) |
| **Output sections** | `analysis`, `marketContext` |
| **Failure behavior** | If `scan_vcp` fails: return market context only, disclose scan unavailability |
| **OpenAI used** | Yes — explain analysis results in plain English |

#### RECOMMEND_SYMBOL_TRADE

| Field | Value |
|---|---|
| **Required fields** | `tickers` (exactly 1 validated symbol), `normalizedGoal` |
| **Optional fields** | `portfolioAwareness`, `optionsToken` |
| **Primary MCP tool** | `recommend_trade_strategy` |
| **Supporting tools** | `get_options_chain` → `analyze_options` → `select_option_contracts` → `calculate_trade_risk` (when options strategy) |
| **Trusted-context requirement** | Options token when `instrumentPreference: "options"` |
| **Output sections** | `recommendation`, `risk`, `portfolioFit` |
| **Failure behavior** | No invented fallback trade. Disclose unavailability honestly. |
| **OpenAI used** | Yes — brief explanation supporting deterministic verdict |

#### RANK_MARKET_TRADES

| Field | Value |
|---|---|
| **Required fields** | `normalizedGoal` (no symbol) |
| **Optional fields** | `portfolioAwareness`, `portfolioToken` |
| **Primary MCP tool** | `rank_market_trade_candidates` |
| **Supporting tools** | None |
| **Trusted-context requirement** | Portfolio token for connected users (improves ranking) |
| **Output sections** | `rankedSearch`, `portfolioFit`, `risk` |
| **Failure behavior** | `RANKED_MCP_FAILED_WITH_FALLBACK` status; no invented candidates |
| **OpenAI used** | Optional — brief context summary only; never reorders buckets |

#### PLAN_PORTFOLIO_TRADE

| Field | Value |
|---|---|
| **Required fields** | `portfolioTradePlanGoal` (dollar / pct / sector / holdings kind) |
| **Optional fields** | `portfolioAwareness`, `portfolioToken`, `optionsToken` |
| **Primary MCP tool** | `plan_portfolio_trade` |
| **Supporting tools** | None at plan stage; `calculate_position_risk` for sizing |
| **Trusted-context requirement** | Portfolio token required; graceful degradation to market-only if unavailable |
| **Output sections** | `portfolioFit`, `recommendation`, `risk` |
| **Failure behavior** | If portfolio token unavailable: continue market-only, disclose limitation |
| **OpenAI used** | Optional explanation; never overrides feasibility verdict or constraint statuses |

#### ANALYZE_PORTFOLIO

| Field | Value |
|---|---|
| **Required fields** | `portfolioAwareness` (broker connected) |
| **Optional fields** | `portfolioToken` |
| **Primary MCP tool** | None in Phase 1 (future: `get_portfolio_summary` MCP tool) |
| **Supporting tools** | `get_market_regime` |
| **Trusted-context requirement** | Portfolio awareness required; if unavailable → redirect to "connect broker" |
| **Output sections** | `portfolioFit`, `marketContext` |
| **Failure behavior** | If broker not connected: immediate honest response, no invented positions |
| **OpenAI used** | Yes — narrative summary of portfolio context |

#### EXPLAIN_CONCEPT

| Field | Value |
|---|---|
| **Required fields** | `conceptTerms` (extracted from question) |
| **Optional fields** | `tickers` (for grounded examples) |
| **Primary MCP tool** | None (education is OpenAI-only) |
| **Supporting tools** | `get_quote` (if ticker present, to ground example) |
| **Trusted-context requirement** | None |
| **Output sections** | `education` |
| **Failure behavior** | If OpenAI unavailable: return `ruleBasedAnswer()` fallback |
| **OpenAI used** | Yes — primary output |

#### EDUCATION_PLUS_ACTION

| Field | Value |
|---|---|
| **Required fields** | `conceptTerms` + one of: `tickers` or `normalizedGoal` |
| **Optional fields** | All fields from both EXPLAIN_CONCEPT and RECOMMEND_SYMBOL_TRADE |
| **Primary MCP tool** | `recommend_trade_strategy` (for the action component) |
| **Supporting tools** | `get_quote`, `get_news` |
| **Trusted-context requirement** | Same as the action component |
| **Output sections** | `education`, `recommendation` |
| **Failure behavior** | Education section preserved even if action tool fails |
| **OpenAI used** | Yes — education prose + recommendation explanation |

#### MARKET_RESEARCH

| Field | Value |
|---|---|
| **Required fields** | `marketContext` |
| **Optional fields** | `tickers` |
| **Primary MCP tool** | `get_news` → `get_market_regime` |
| **Supporting tools** | `get_quote` (if ticker present) |
| **Trusted-context requirement** | None |
| **Output sections** | `marketContext` |
| **Failure behavior** | Degrade to available data; disclose what was unavailable |
| **OpenAI used** | Yes — synthesis of news and market context |

#### COMBINED_ANALYSIS_RECOMMENDATION

| Field | Value |
|---|---|
| **Required fields** | `tickers` (1+) + `normalizedGoal` |
| **Optional fields** | `portfolioAwareness` |
| **Primary MCP tool** | `scan_vcp` + `recommend_trade_strategy` |
| **Supporting tools** | `get_quote`, `get_news`, options chain (if applicable) |
| **Trusted-context requirement** | Options token when options strategy |
| **Output sections** | `analysis`, `recommendation`, `risk` |
| **Failure behavior** | If scan fails: recommendation only + disclose analysis unavailable; if recommendation fails: analysis only |
| **OpenAI used** | Yes — integrated explanation |

#### UNKNOWN

| Field | Value |
|---|---|
| **Required fields** | None |
| **Primary MCP tool** | `get_news` (if tickers extracted) else none |
| **Failure behavior** | `ruleBasedAnswer()` fallback always available |
| **OpenAI used** | Yes — best-effort answer |

---

## 5. Tool-Plan Contract

### 5.1 ToolPlan Type

```typescript
interface ToolPlan {
  // Immutable header — set before any execution begins
  intent: TraderBrainIntent;
  normalizedRequest: NormalizedRequest;

  steps: ToolPlanStep[];

  responsePolicy: ResponsePolicy;
}

interface NormalizedRequest {
  // Validated, sanitized inputs the tool plan was built from.
  // Never contains raw user text after this point.
  tickers: string[];
  tradeGoal?: TradeGoal;                 // from normalizeTradeGoal()
  portfolioGoal?: PortfolioTradePlanGoal; // from classifyPortfolioTradePlan()
  conceptTerms?: string[];               // from education classifier
  universeHint?: string;                 // from detectUniverseHint()
}

interface ToolPlanStep {
  id: string;                            // stable identifier, e.g. "recommend", "options-chain"
  tool: McpAllowedTool;
  arguments: Record<string, unknown>;    // model-safe args only; never credentials
  dependsOn: string[];                   // step ids that must complete first
  required: boolean;                     // false → failure is allowed (degrade, not abort)
  timeoutClass: "fast" | "standard" | "extended";
  trustedContextScopes: TrustedContextScope[];
  failurePolicy: FailurePolicy;
}

type TrustedContextScope =
  | "none"
  | "portfolio_token"
  | "options_token"
  | "market_context";

type FailurePolicy =
  | "abort_request"           // required step failed → return error result
  | "skip_section"            // optional step failed → omit section, add warning
  | "use_cached_fallback"     // use stored/DB result if available
  | "degrade_to_market_only"  // portfolio step failed → continue without portfolio context
  | "use_rule_based_fallback"; // use ruleBasedAnswer()

interface ResponsePolicy {
  requiresOpenAi: boolean;
  openAiRole: "none" | "explanation" | "prose" | "education";
  // OpenAI may never: select symbols, override verdicts, reorder candidates,
  // alter risk calculations, or gate CTAs.
  ctaSource: "verdict" | "intent" | "stage";
}
```

### 5.2 Example Tool Plans

#### RECOMMEND_SYMBOL_TRADE for "Find a covered call on NVDA"

```typescript
{
  intent: "RECOMMEND_SYMBOL_TRADE",
  normalizedRequest: {
    tickers: ["NVDA"],
    tradeGoal: { symbol: "NVDA", requestedStrategy: "covered_call", objective: "income" }
  },
  steps: [
    {
      id: "recommend",
      tool: "recommend_trade_strategy",
      arguments: { symbol: "NVDA", requestedStrategy: "covered_call" },
      dependsOn: [],
      required: true,
      timeoutClass: "extended",
      trustedContextScopes: ["market_context"],
      failurePolicy: "abort_request",
    },
    {
      id: "options-chain",
      tool: "get_options_chain",
      arguments: { symbol: "NVDA" },
      dependsOn: ["recommend"],
      required: false,
      timeoutClass: "standard",
      trustedContextScopes: ["options_token"],
      failurePolicy: "skip_section",
    },
    {
      id: "select-contracts",
      tool: "select_option_contracts",
      arguments: { symbol: "NVDA", strategy: "covered_call" },
      dependsOn: ["options-chain"],
      required: false,
      timeoutClass: "standard",
      trustedContextScopes: ["options_token"],
      failurePolicy: "skip_section",
    }
  ],
  responsePolicy: {
    requiresOpenAi: true,
    openAiRole: "explanation",
    ctaSource: "verdict",
  }
}
```

#### RANK_MARKET_TRADES for "Find income trades risking under $500"

```typescript
{
  intent: "RANK_MARKET_TRADES",
  normalizedRequest: {
    tickers: [],
    tradeGoal: { objective: "income", maxRiskDollars: 500 }
  },
  steps: [
    {
      id: "rank",
      tool: "rank_market_trade_candidates",
      arguments: { objective: "income", maxRiskDollars: 500 },
      dependsOn: [],
      required: true,
      timeoutClass: "extended",
      trustedContextScopes: ["portfolio_token"],
      failurePolicy: "abort_request",
    }
  ],
  responsePolicy: {
    requiresOpenAi: false,
    openAiRole: "none",
    ctaSource: "verdict",
  }
}
```

### 5.3 Tool-Plan Invariants

1. **Deterministic:** Same `NormalizedRequest` always produces the same `ToolPlan`.
2. **Model cannot influence:** Tool plans are produced by `ToolPlanner` from validated inputs. OpenAI never selects tools, sets arguments, or modifies the plan.
3. **No duplicate tools:** A given `McpAllowedTool` appears at most once per plan (enforce at construction).
4. **No execution in planner:** `ToolPlanner.build()` returns a plan; it never calls MCP.
5. **Dependency DAG:** `dependsOn` must form an acyclic graph; circular dependencies are a construction error.
6. **Arguments contain no credentials:** Validated at construction. `portfolioContextToken` and `optionsContextToken` are injected by `EvidenceCollector` from `TrustedContext`, never from plan arguments.

---

## 6. Evidence Contract

### 6.1 Evidence Envelope

```typescript
interface EvidenceEnvelope {
  // --- Identity ---
  stepId: string;          // matches ToolPlanStep.id
  source: EvidenceSource;
  tool: McpAllowedTool;

  // --- Outcome ---
  status: "ok" | "degraded" | "failed" | "skipped" | "cached";
  durationMs: number;
  generatedAt: string;     // ISO-8601

  // --- Payload (always the ORIGINAL validated tool response, never flattened) ---
  data: unknown;           // validated + scrubbed; original shape preserved

  // --- Quality signals ---
  dataQuality: DataQuality;
  warnings: string[];      // advisory messages from the tool (non-fatal)
  limitations: string[];   // disclosed limitations (estimated data, etc.)
  confidence: "high" | "medium" | "low" | "none" | undefined;

  // --- Domain fields (preserved from tool response, never flattened away) ---
  verdict?: string;                // e.g. "TRADE_READY", "NO_TRADE", "WATCH"
  verdictReason?: string;
  rejectionSummary?: RejectionGroup[];
  exclusionSummary?: ExclusionGroup[];
  candidateCount?: number;
  qualifiedCount?: number;
  rejectedCount?: number;
  unavailableCount?: number;
  portfolioAwareness?: SafePortfolioAwareness;
}

type EvidenceSource =
  | "mcp_live"        // live MCP tool response
  | "mcp_mock"        // MCP returned source:"mock" (dev/staging)
  | "db_stored"       // stored scan result from DB (opportunity fallback)
  | "rule_based"      // deterministic local fallback
  | "cache";          // served from server-side cache

interface DataQuality {
  estimated: boolean;    // any field was estimated/approximated
  simulated: boolean;    // any field was from a paper/sim environment
  partial: boolean;      // response is a subset of requested data
  stale: boolean;        // data is past freshness threshold
  stalenessNote?: string;
}
```

### 6.2 Evidence Collector Contract

```typescript
interface EvidenceCollector {
  /**
   * Execute a ToolPlan step-by-step, respecting dependency order.
   * Returns one EvidenceEnvelope per step.
   *
   * Invariants:
   *   - Steps with dependsOn are not started until all dependencies resolve.
   *   - A required step failure triggers immediate abort (remaining steps skipped).
   *   - An optional step failure produces status:"failed" envelope; execution continues.
   *   - Tokens from TrustedContext are injected per trustedContextScopes; never logged.
   *   - Original validated tool payload is preserved in data; never flattened.
   */
  collect(
    plan: ToolPlan,
    trustedContext: TrustedContext,
  ): Promise<EvidenceEnvelope[]>;
}
```

### 6.3 Preserved Fields

The evidence collector must never discard the following fields from tool responses:

- `verdict`, `verdictReason`, `verdictConfidence`
- `rejectionSummary`, `exclusionSummary`, `groupedCandidateCount`
- `excludedCount`, `excludedCountNote`
- `dataQuality`, `source`, `limitations`
- `portfolioAwareness`, `concentrationWarning`
- `warnings`, `candidateWarnings`
- `feasibility`, `constraintStatuses` (portfolio plan)

---

## 7. Response Contract

### 7.1 TraderBrainResult

```typescript
interface TraderBrainResult {
  // --- Identity ---
  requestId: string;
  intent: TraderBrainIntent;
  normalizedRequest: NormalizedRequest;
  generatedAt: string;     // ISO-8601

  // --- Top-level status ---
  status: ResultStatus;
  headline: string;        // deterministic; never model-generated
  confidence: "high" | "medium" | "low" | "none";

  // --- Structured sections (domain-specific, not a generic payload) ---
  sections: TraderBrainSections;

  // --- Evidence (full envelopes for observability; stripped before client) ---
  evidence: EvidenceEnvelope[];

  // --- Cross-section metadata ---
  warnings: string[];       // aggregated advisory warnings
  limitations: string[];    // aggregated data limitations
  nextActions: NextAction[]; // verdict-gated CTAs

  // --- Source traceability ---
  openAiUsed: boolean;
  openAiRole?: "explanation" | "prose" | "education";
  rankedSearchSource?: RankedSearchSource;
  vcpScanFailed?: boolean;
}

type ResultStatus =
  | "complete"          // all required steps succeeded
  | "partial"           // some optional steps failed; result still useful
  | "degraded"          // primary step degraded (mock/cached/estimated)
  | "unavailable"       // primary tool failed; honest response returned
  | "error";            // unrecoverable error; generic safe response

interface TraderBrainSections {
  // Each section is present only when the intent requires it.
  // Undefined means "this intent does not produce this section."
  // Null means "section was expected but data was unavailable."
  analysis?: VcpAnalysis | MultiStrategyAnalysis | null;
  recommendation?: StrategyRecommendation | null;
  rankedSearch?: RankedTradeSearch | null;
  portfolioFit?: SafePortfolioAwareness | null;
  portfolioTradePlan?: PortfolioTradePlan | null;
  risk?: RiskSection | null;
  education?: EducationSection | null;
  marketContext?: MarketContextSection | null;
  openAiExplanation?: string;  // prose only; never primary output
}

interface NextAction {
  label: string;
  href: string;
  /** Gate: action is only shown when this condition is met. */
  gate?: "verdict_trade_ready" | "verdict_watch" | "broker_connected" | "always";
}
```

### 7.2 Section Definitions

#### `RiskSection`

```typescript
interface RiskSection {
  maxRiskDollars?: number;       // confirmed applied ceiling
  maxRiskPercent?: number;
  positionSizeShares?: number;
  dollarRiskPerShare?: number;
  riskRewardRatio?: number;
  disclaimer: string;            // mandatory; never omitted
  limitations: string[];
}
```

#### `EducationSection`

```typescript
interface EducationSection {
  concept: string;
  explanation: string;           // OpenAI-generated; must be labeled as AI
  keyPoints: string[];
  relatedConcepts?: string[];
}
```

#### `MarketContextSection`

```typescript
interface MarketContextSection {
  regime?: string;               // from get_market_regime
  newsSentiment?: "bullish" | "bearish" | "neutral" | "mixed";
  headlines?: string[];
  earningsNote?: string;
}
```

### 7.3 Client-Facing Response Shape

`TraderBrainResult` is NOT sent directly to the client. The route handler
projects it to the existing `AskResponse` shape for backward compatibility
(see §9 Migration).

Evidence envelopes are **stripped** before sending — they are for server-side
observability only.

### 7.4 Additive Compatibility Rule

> Preserve existing `AskResponse` response contracts where possible.
> The migration must never remove a field the frontend already reads.
> New fields are additive. Fields may be promoted from ad-hoc spread to
> structured `sections` only after the frontend is updated to consume from
> the new location.

---

## 8. Failure Policies

### 8.1 Policy Definitions

| Policy | Behavior |
|---|---|
| `abort_request` | Stop execution, return `status: "unavailable"` with honest message. **Never fabricate a trade, candidate, or recommendation.** |
| `skip_section` | Mark evidence as `status: "failed"`, add `warning`, continue. Section is `null` in response. |
| `use_cached_fallback` | Use stored/DB result. Set `source: "db_stored"`, `status: "degraded"`. Disclose in `limitations`. |
| `degrade_to_market_only` | Continue without portfolio context. Add `limitation: "portfolio context unavailable — results are market-only"`. Revoke partial tokens. |
| `use_rule_based_fallback` | Return `ruleBasedAnswer()` result. Set `openAiUsed: false`. |

### 8.2 Per-Scenario Policies

#### Primary recommendation tool timeout (`recommend_trade_strategy`)

```
Policy: abort_request
Result: status = "unavailable"
Headline: "Trade recommendation is temporarily unavailable."
No fallback trade invented.
OpenAI must not substitute a trade recommendation.
```

#### Optional supporting tool failure (e.g. `get_options_chain` after `recommend_trade_strategy` succeeds)

```
Policy: skip_section
Result: recommendation section present, options detail absent
Warning: "Options contract details temporarily unavailable — recommendation shown without contract specifics."
Main verdict and recommendation are unaffected.
```

#### MCP service entirely unavailable

```
Policy: abort_request for all deterministic tools
         use_rule_based_fallback for EXPLAIN_CONCEPT / MARKET_RESEARCH / UNKNOWN
Result: status = "unavailable" for trade intents
        status = "degraded" for education/research intents
Headline: honest disclosure; no invented content
```

#### Trusted context (portfolio token) unavailable

```
Policy: degrade_to_market_only
Applies to: PLAN_PORTFOLIO_TRADE, RANK_MARKET_TRADES, RECOMMEND_SYMBOL_TRADE
Result: continue execution without portfolio filter
Limitation disclosed: "Results shown without portfolio context — connect a broker for personalized sizing."
Token revocation still executes in finally block (no-op if token was never minted).
```

#### Malformed / unvalidated tool response

```
Policy: abort_request (required step) OR skip_section (optional step)
Do NOT pass malformed data to OpenAI or client.
Validation happens in EvidenceCollector before envelope is stored.
Log the raw error server-side.
```

#### OpenAI unavailable

```
Policy: use_rule_based_fallback (for prose/explanation)
Deterministic structured result is preserved and returned.
openAiUsed: false
openAiRole: undefined
The structured sections (recommendation, rankedSearch, etc.) are NEVER conditional on OpenAI.
```

#### Partial success (some optional steps failed, required succeeded)

```
status: "partial"
Populated sections: all succeeded ones
Null sections: all failed optional ones
warnings: one entry per skipped section
The deterministic primary result is complete and reliable.
```

#### No qualifying result (MCP succeeded, zero candidates)

```
status: "complete" (not "unavailable" — the tool worked)
rankedSearch.candidates = []
rejectionSummary populated
Honest empty-state response with rejection reasons.
No invented candidates to pad the result.
```

---

## 9. Migration Sequence

### Principles

1. **No big-bang replacement.** Migrate one intent flow at a time.
2. **Shadow mode first.** Run the Brain in parallel with the existing path; compare outputs before switching.
3. **Feature flags per intent.** Each intent can be toggled independently.
4. **Additive response shape.** Never remove a client-visible field during migration.
5. **MCP is not touched.** All 16 MCP tools remain as-is.

### Phase 0 — Foundation (no behavior change)

1. Create `server/brain/types.ts` — all shared types
2. Create `server/brain/ToolPlanner.ts` — deterministic plan builder with tests
3. Create `server/brain/IntentClassifier.ts` — unified classifier with tests
4. Create `server/brain/EvidenceCollector.ts` — wraps existing MCP calls
5. Create `server/brain/ResponseComposer.ts` — projects to existing `AskResponse` shape
6. Create `server/brain/TraderBrainService.ts` — orchestrates the above

> No route changes. Shadow mode only. Feature flag: `TRADER_BRAIN_ENABLED=false`.

### Phase 1 — Combined Analysis + Recommendation (lowest risk, highest usage)

**Intent:** `COMBINED_ANALYSIS_RECOMMENDATION`
**Existing path:** `callOpenAi` → internal recommendation branch

1. Enable Brain for `COMBINED_ANALYSIS_RECOMMENDATION` only
2. `ask.ts` route handler: if `TRADER_BRAIN_ENABLED && intent === COMBINED_ANALYSIS_RECOMMENDATION`, call `TraderBrainService.execute()` instead of `callOpenAi`
3. `ResponseComposer` projects `TraderBrainResult` → existing `AskResponse` spread (no client changes)
4. Shadow-validate: run both paths for 48h, compare response shapes
5. Remove old code path for this intent after validation

### Phase 2 — Symbol Recommendation

**Intent:** `RECOMMEND_SYMBOL_TRADE`
**Existing path:** `callOpenAi` → `runStrategyRecommendation`

1. Enable Brain for `RECOMMEND_SYMBOL_TRADE`
2. Remove `recommendationHandled` guard in legacy ticket path (now handled by intent exclusion in the Brain)
3. Shadow-validate, then remove old recommendation branch from `callOpenAi`

### Phase 3 — Ranked Market Search

**Intent:** `RANK_MARKET_TRADES`
**Existing path:** Branch B (ranked-trade-search module)

1. Enable Brain for `RANK_MARKET_TRADES`
2. Brain calls `ranked-trade-search.ts:runRankedTradeSearch()` — do not duplicate its logic
3. Shadow-validate; remove Branch B from `ask.ts`

### Phase 4 — Goal-Based Planner

**Intent:** `PLAN_PORTFOLIO_TRADE`
**Existing path:** Branch A (portfolio-trade-plan module)

1. Enable Brain for `PLAN_PORTFOLIO_TRADE`
2. Brain calls `portfolio-trade-plan.ts:runPortfolioTradePlan()` — do not duplicate
3. Shadow-validate; remove Branch A from `ask.ts`

### Phase 5 — Symbol Analysis

**Intent:** `ANALYZE_SYMBOL`
**Existing path:** `callOpenAi` → VCP scan + multi-strategy

1. Enable Brain for `ANALYZE_SYMBOL`
2. Extract VCP + multi-strategy orchestration from `callOpenAi` into `EvidenceCollector`
3. Shadow-validate; shrink `callOpenAi` to prose-only role

### Phase 6 — Education and Research

**Intents:** `EXPLAIN_CONCEPT`, `MARKET_RESEARCH`, `UNKNOWN`
**Existing path:** `callOpenAi` generic path + `ruleBasedAnswer` fallback

1. Enable Brain for remaining intents
2. `callOpenAi` becomes `OpenAiExplainer.explain(evidence, context)` — prose only
3. `ruleBasedAnswer` promoted to named `FailurePolicy.ruleBasedFallback()`
4. Legacy `classifyIntent()` retired; `suggestionsForIntent()` replaced by `ResponseComposer` CTA logic

### Feature Flag Design

```typescript
// server/brain/config.ts
export function isBrainEnabled(intent: TraderBrainIntent): boolean {
  const flag = process.env.TRADER_BRAIN_ENABLED ?? "none";
  if (flag === "all") return true;
  if (flag === "none") return false;
  // Comma-separated intent list: "COMBINED_ANALYSIS_RECOMMENDATION,RECOMMEND_SYMBOL_TRADE"
  return flag.split(",").map(s => s.trim()).includes(intent);
}
```

### Shadow Mode Validation

```typescript
// ask.ts (during migration)
if (isBrainEnabled(brainIntent)) {
  const brainResult = await brainService.execute(request, trustedContext);
  res.json(projectToAskResponse(brainResult));
} else {
  // existing path unchanged
  const answer = await callOpenAi(question, ctx);
  res.json({ question, intent, ...answer, ... });
}
```

Shadow log both results to a comparison table during Phase 0–1 before
switching traffic.

---

## 10. Test Strategy

### 10.1 IntentClassifier Tests

```
for each intent in TraderBrainIntent:
  - canonical phrasing produces correct intent
  - alternative phrasings produce correct intent
  - anti-patterns (similar but different intent) do NOT produce this intent
  - same input always produces same output (deterministic repeatability)

cross-intent:
  - "Analyze MU and give me a trade" → COMBINED_ANALYSIS_RECOMMENDATION (not ANALYZE_SYMBOL)
  - "What is a covered call on NVDA?" → EXPLAIN_CONCEPT (not RECOMMEND_SYMBOL_TRADE)
  - "Find a trade risking $500" → PLAN_PORTFOLIO_TRADE (not RANK_MARKET_TRADES)
  - symbol present + trade goal → RECOMMEND_SYMBOL_TRADE (not RANK_MARKET_TRADES)
  - no symbol + broad search → RANK_MARKET_TRADES (not RECOMMEND_SYMBOL_TRADE)
  - empty/gibberish → UNKNOWN
```

### 10.2 ToolPlanner Tests

```
for each intent:
  - correct tool(s) included
  - no tool appears twice (no duplication)
  - dependency order is a valid DAG (no cycles)
  - required vs optional flags match spec
  - timeoutClass matches tool type
  - trustedContextScopes match intent requirements
  - model-safe args only (no userId, no connectionId, no broker token)
  - same NormalizedRequest → same ToolPlan every time (determinism)
  - ToolPlanner.build() does not make any I/O calls (pure function)

edge cases:
  - symbol present in normalizedRequest but intent is RANK_MARKET_TRADES → symbol dropped from args
  - maxRiskDollars > 100_000 → clamped
  - no tickers for ANALYZE_SYMBOL → construction error (required field missing)
```

### 10.3 EvidenceCollector Tests

```
- required step success → status "ok" envelope
- required step failure → abort; remaining steps get status "skipped"
- optional step failure → status "failed" envelope; execution continues
- dependency step failure → dependent step gets status "skipped"
- original validated tool payload preserved in data (not flattened)
- verdict/verdictReason/rejectionSummary fields preserved
- portfolioAwareness preserved from MCP response
- dataQuality fields populated correctly
- tokens injected per trustedContextScopes (not from plan arguments)
- tokens never appear in evidence envelopes or logs
- durationMs populated on every envelope
- no MCP calls made (mock injected via dependency injection)
```

### 10.4 ResponseComposer Tests

```
- status "complete" with all sections → full AskResponse projection
- status "partial" → missing sections are null/undefined in projection
- status "unavailable" → honest headline; no invented recommendation
- openAiExplanation absent when OpenAI unavailable → prose field empty, structured sections unchanged
- CTA source "verdict" → CTAs gated on deterministic verdict field
- CTA source "intent" → CTAs use intent-based list
- disclaimer always present in output (never omitted)
- evidence envelopes stripped from client-facing response
- additive fields: existing AskResponse fields all present after projection
```

### 10.5 Failure Isolation Tests

```
- abort_request policy: result has no recommendation/candidate fields populated
- skip_section policy: recommendation present, skipped section absent + warning present
- degrade_to_market_only: result present, portfolioAwareness absent, limitation present
- use_rule_based_fallback: openAiUsed false, answer present
- OpenAI unavailable: structured deterministic sections unaffected, prose empty
- MCP unavailable: status "unavailable" for trade intents, "degraded" for education
- zero candidates from MCP: status "complete" (not "unavailable"), rejectionSummary present
```

### 10.6 No-Execution and Security Tests

```
- ToolPlan.steps contains no execute/order/place tools (none currently exist)
- No userId, accountId, connectionId, broker OAuth token in any plan arguments
- Portfolio token not logged (string not present in structured log output)
- Evidence envelope data field does not contain raw account numbers
- TraderBrainResult does not contain evidence envelopes when projected to AskResponse
- OpenAI never receives portfolio token, account data, or broker credentials
```

### 10.7 Deterministic Repeatability

```
for all pure functions (IntentClassifier, ToolPlanner, ResponseComposer projections):
  - same input → same output (no Date.now(), no random, no I/O)
  - property-based test: 100 random questions → intent is always a valid TraderBrainIntent
```

---

## 11. Risks and Compatibility Concerns

### 11.1 Response Shape Compatibility

**Risk:** The existing `AskResponse` is assembled via ad-hoc spreads (`...answer`,
`...(pfAwareness ? {...} : {})`). The frontend reads many optional fields and
silently ignores absent ones — but any field accidentally dropped during
`ResponseComposer` projection will break a UI section without a compile-time error.

**Mitigation:**
- Define `AskResponse` as a TypeScript interface (currently implicit); add it to
  `client/src/lib/` so the compiler enforces shape.
- Test each Brain intent's projection against the full `AskResponse` type in CI.
- Never remove a field during migration; only add.

### 11.2 `classifyTradeRequest` / `normalizeTradeGoal` Called from Multiple Callsites

**Risk:** Three callsites (ranked, legacy guard, `callOpenAi`) already call
these functions independently. During migration phases 1–3, a fourth callsite
(the Brain) will be added before the old ones are removed. Any change to
normalization logic will affect all four paths simultaneously.

**Mitigation:**
- Do not modify `normalizeTradeGoal` or `classifyTradeRequest` during the Brain
  migration. They are stable, tested APIs.
- Remove the old callsites during the same PR as enabling the Brain for that intent.

### 11.3 Token Lifecycle during Partial Migration

**Risk:** During phases 1–3, some intents are handled by the Brain (mints tokens
via `TrustedContextMinter`) and others by the existing branches (mint tokens
inline). Concurrent requests could create token lifecycle races if the route
handler's `finally` block is restructured prematurely.

**Mitigation:**
- Keep all token lifecycle in the route handler's existing `finally` block until
  Phase 6 (full migration). `TrustedContextMinter` in Phase 0 is defined but
  not yet responsible for token lifecycle.
- Only centralize token lifecycle after all branches are migrated to the Brain.

### 11.4 Shadow Mode Output Divergence

**Risk:** During shadow mode validation, Brain and legacy paths may diverge on
edge cases (different headline, different CTA, different `source` field) without
being "wrong." These divergences could mask genuine regressions.

**Mitigation:**
- Define explicit equivalence criteria before shadow validation: which fields
  must match exactly (verdict, candidateCount, rejectedCount) vs. which may
  differ (prose, headline wording, CTA labels).
- Log divergences to a structured comparison table, not just error logs.

### 11.5 OpenAI Non-Authority Enforcement

**Risk:** `callOpenAi` currently both runs the OpenAI call AND assembles
deterministic sections (recommendation, VCP analysis). This coupling means
OpenAI failures inside `callOpenAi` can inadvertently affect the deterministic
result. The Brain design separates these, but the separation must be strict.

**Mitigation:**
- `EvidenceCollector` completes all MCP calls before any OpenAI call begins.
- `OpenAiExplainer` receives only the already-assembled `EvidenceEnvelope[]`
  and the user question — never raw MCP responses or broker context.
- Test: OpenAI unavailable → all structured sections still populate correctly.

### 11.6 MCP Mock Data in Production

**Risk:** The MCP service may return `source: "mock"` in development/staging,
which could leak into production responses if not gated.

**Mitigation:** `EvidenceCollector` sets `dataQuality.simulated = true` and
`source: "mcp_mock"` when `data.source === "mock"`. `ResponseComposer` adds
a `limitation` entry and (in production) escalates to a warning log.

### 11.7 Legacy `classifyIntent` Retirement

**Risk:** `classifyIntent` output is used for: (1) CTA fallback in
`suggestionsForIntent`, (2) `buildContext` market data selection, (3) the
`intent` field in `AskResponse` (read by the client). Removing it prematurely
before (2) and (3) are migrated will break context quality and client rendering.

**Mitigation:**
- Keep `classifyIntent` and its output field until Phase 6.
- Map `TraderBrainIntent` → legacy `classifyIntent` output in `ResponseComposer`
  to keep the `intent` field populated during the transition.
- Replace `intent` field with `TraderBrainIntent` in a future sprint after the
  client is updated.

---

*Document complete. No code has been implemented. All decisions are subject to review.*
