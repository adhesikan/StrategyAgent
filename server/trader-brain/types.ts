// TraderBrain Core — shared types.
//
// This module defines the closed type algebra for the TraderBrain layer.
// All types here are orchestration-layer contracts — they wrap but do NOT
// duplicate domain types owned by MCP, scanner, or broker modules.
//
// Constraints:
//   - No `any` types.
//   - All string unions are closed (exhaustively handled by switch/if).
//   - No credential, token, account ID, or portfolio balance appears in any
//     type that is ever serialized to the client.

import type { VcpAnalysis } from "../mcp/analysis-scan";
import type { MultiStrategyAnalysis } from "../mcp/multi-strategy-analysis";
import type { StrategyRecommendation } from "../mcp/strategy-recommendation";
import type { RankedTradeSearch } from "../routes/ranked-trade-search";
import type {
  PortfolioTradePlan,
  PortfolioTradePlanGoal,
} from "../routes/portfolio-trade-plan";
import type { SafePortfolioAwareness } from "../routes/internal-portfolio";
import type { PortfolioIntelligence } from "./portfolio-intelligence-engine";

// ---------------------------------------------------------------------------
// Intent — closed union
// ---------------------------------------------------------------------------

export type TraderBrainIntent =
  | "ANALYZE_SYMBOL"                    // "Analyze MU", "What is NVDA doing?"
  | "RECOMMEND_SYMBOL_TRADE"            // "Find a covered call on NVDA", "trade idea for AAPL"
  | "RANK_MARKET_TRADES"                // "Find the best trades today", "income opportunities"
  | "PLAN_PORTFOLIO_TRADE"              // "Find a trade risking under $500"
  | "COMBINED_ANALYSIS_RECOMMENDATION" // "Analyze MU and give me a trade"
  | "EXPLAIN_CONCEPT"                   // "What is a credit spread?"
  | "EDUCATION_PLUS_ACTION"             // "Explain VCP and find one"
  | "MARKET_RESEARCH"                   // "Why is the market down?", "Fed news"
  | "UNKNOWN";                          // catch-all

// ---------------------------------------------------------------------------
// Execution status
// ---------------------------------------------------------------------------

export type BrainExecutionStatus =
  | "complete"     // all required steps succeeded
  | "partial"      // optional steps failed; result still useful
  | "degraded"     // primary succeeded with mock/cached/estimated data
  | "unavailable"  // primary tool failed; honest response returned
  | "error";       // unrecoverable

// ---------------------------------------------------------------------------
// Failure policies (per step)
// ---------------------------------------------------------------------------

export type BrainFailurePolicy =
  | "abort_request"            // required step failed → return unavailable
  | "skip_section"             // optional step failed → omit section + warn
  | "use_cached_fallback"      // use stored/DB result if available
  | "degrade_to_market_only"   // portfolio step failed → continue market-only
  | "use_rule_based_fallback"; // ruleBasedAnswer() as last resort

// ---------------------------------------------------------------------------
// Trusted-context scopes (declared per step; never from model output)
// ---------------------------------------------------------------------------

export type TrustedContextScope =
  | "NONE"
  | "PORTFOLIO_CONTEXT"   // short-lived opaque portfolio token
  | "OPTIONS_CONTEXT"     // short-lived opaque options token
  | "BROKER_READ_CONTEXT"; // read-only broker session

// ---------------------------------------------------------------------------
// Brain-level tool identifiers
// (superset of McpAllowedTool; includes orchestrated sequences)
// ---------------------------------------------------------------------------

export type BrainToolId =
  | "recommend_trade_strategy"
  | "rank_market_trade_candidates"
  | "plan_portfolio_trade"
  | "multi_strategy_analysis"  // orchestrates scan_strategy + build_trade_candidate
  | "scan_vcp"
  | "get_quote"
  | "get_news"
  | "get_market_history"
  | "openai_explanation";       // prose only; no trading decision

export type TimeoutClass = "fast" | "standard" | "extended";

// ---------------------------------------------------------------------------
// Tool plan
// ---------------------------------------------------------------------------

export interface ToolPlanStep {
  /** Stable identifier referenced by dependsOn. */
  id: string;
  tool: BrainToolId;
  /** Model-safe args only — never credentials, tokens, or account IDs. */
  arguments: Record<string, unknown>;
  /** IDs of steps that must complete before this one starts. */
  dependsOn: string[];
  /** false → failure is allowed; result degrades gracefully. */
  required: boolean;
  timeoutClass: TimeoutClass;
  /** Contexts injected by Executor from TrustedContext; never from plan args. */
  trustedContextScopes: TrustedContextScope[];
  failurePolicy: BrainFailurePolicy;
}

export interface ResponsePolicy {
  requiresOpenAi: boolean;
  openAiRole: "none" | "explanation" | "prose" | "education";
  /** What drives CTA selection in the Composer. */
  ctaSource: "verdict" | "intent" | "stage";
}

export interface ToolPlan {
  /** Immutable — set before any execution begins. */
  intent: TraderBrainIntent;
  normalizedRequest: NormalizedBrainRequest;
  steps: ToolPlanStep[];
  responsePolicy: ResponsePolicy;
}

// ---------------------------------------------------------------------------
// Normalized brain request
// ---------------------------------------------------------------------------

/** Portfolio constraints extracted by classifyPortfolioTradePlan(). */
export interface BrainPortfolioConstraints {
  kind: PortfolioTradePlanGoal["kind"];
  maxRiskDollars?: number;
  maxRiskPercent?: number;
  excludeSectors?: string[];
  requireExistingPosition?: boolean;
  objective?: "income" | "growth";
}

/**
 * Validated, sanitized orchestration input.
 * Never contains raw user text after normalization is complete.
 * Only fields that were deterministically parsed are set.
 */
export interface NormalizedBrainRequest {
  rawPrompt: string;
  intent: TraderBrainIntent;
  /** Primary symbol (single-symbol intents only). */
  symbol?: string;
  /** All validated tickers extracted from the prompt. */
  tickers: string[];
  direction?: "bullish" | "bearish" | "neutral" | "either";
  instrumentPreference?: "stock" | "options" | "either";
  objective?: "growth" | "income" | "capital_preservation" | "hedging" | "speculative";
  requestedStrategy?: string;
  maxRiskDollars?: number;
  maxRiskPercent?: number;
  numberOfIdeas?: number;
  timeframe?: string;
  portfolioConstraints?: BrainPortfolioConstraints;
  educationTopic?: string;
  universeHint?: string;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type EvidenceStatus =
  | "ok"        // live MCP response, validated
  | "degraded"  // mock or estimated data
  | "failed"    // call failed; error captured
  | "skipped"   // dependency failed or step not needed
  | "cached";   // served from cache

export type EvidenceSource =
  | "mcp_live"
  | "mcp_mock"
  | "db_stored"
  | "rule_based"
  | "cache"
  | "openai";

export interface ToolEvidenceDataQuality {
  estimated: boolean;
  simulated: boolean;
  partial: boolean;
  stale: boolean;
  stalenessNote?: string;
}

export interface ToolEvidence {
  stepId: string;
  source: EvidenceSource;
  tool: BrainToolId;
  status: EvidenceStatus;
  durationMs: number;
  generatedAt: string;
  /** Validated + scrubbed payload. Original shape preserved — never flattened. */
  data: unknown;
  dataQuality: ToolEvidenceDataQuality;
  warnings: string[];
  limitations: string[];
  confidence?: "high" | "medium" | "low" | "none";
  /** Domain verdict preserved from tool response (e.g. "TRADE_READY"). */
  verdict?: string;
  verdictReason?: string;
  /** Safe error code when status is "failed". */
  safeErrorCode?: string;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export interface EducationSection {
  concept: string;
  explanation: string;
  keyPoints: string[];
}

/**
 * Domain-specific sections — never a generic blob.
 * undefined = intent does not produce this section.
 * null = section was expected but tool data was unavailable.
 */
export interface TraderBrainSections {
  analysis?: MultiStrategyAnalysis | VcpAnalysis | null;
  recommendation?: StrategyRecommendation | null;
  rankedSearch?: RankedTradeSearch | null;
  portfolioFit?: SafePortfolioAwareness | null;
  portfolioTradePlan?: PortfolioTradePlan | null;
  education?: EducationSection | null;
  /** Prose only. Never used as a data source. Present only when OpenAI succeeded. */
  openAiExplanation?: string;
  /**
   * Portfolio Intelligence section (Sprint 5.3B).
   * Computed from portfolioFit + other sections — no extra MCP calls.
   * Undefined when portfolio context was not available.
   */
  portfolioIntelligence?: PortfolioIntelligence | null;
}

// ---------------------------------------------------------------------------
// Next actions (CTAs)
// ---------------------------------------------------------------------------

export interface NextAction {
  label: string;
  href: string;
  gate?: "verdict_trade_ready" | "verdict_watch" | "broker_connected" | "always";
}

// ---------------------------------------------------------------------------
// TraderBrainResult
// ---------------------------------------------------------------------------

export interface TraderBrainResult {
  requestId: string;
  intent: TraderBrainIntent;
  normalizedRequest: NormalizedBrainRequest;
  status: BrainExecutionStatus;
  headline: string;
  confidence: "high" | "medium" | "low" | "none";
  sections: TraderBrainSections;
  /** Full evidence envelopes — stripped before any client-facing response. */
  evidence: ToolEvidence[];
  warnings: string[];
  limitations: string[];
  nextActions: NextAction[];
  generatedAt: string;
  openAiUsed: boolean;
  openAiRole?: "explanation" | "prose" | "education";
}

// ---------------------------------------------------------------------------
// Trusted context (assembled before Brain.execute(), never from model output)
// ---------------------------------------------------------------------------

/**
 * All sensitive material lives here.
 * The Brain reads these scopes only to inject into MCP calls per step
 * `trustedContextScopes` declarations — never logs them, never sends to client.
 */
export interface TrustedContext {
  /** Authenticated session user ID. */
  userId: string;
  /** Validated tickers extracted from the prompt. */
  tickers: string[];
  brokerConnected: boolean;
  /** Opaque, short-lived — never forwarded to client or OpenAI. */
  portfolioToken?: string;
  /** Opaque, short-lived — never forwarded to client or OpenAI. */
  optionsToken?: string;
  portfolioAwareness?: SafePortfolioAwareness;
}

// ---------------------------------------------------------------------------
// Service request
// ---------------------------------------------------------------------------

export interface TraderBrainRequest {
  requestId: string;
  question: string;
}

// ---------------------------------------------------------------------------
// Client-facing projection (additive field on AskResponse — not full result)
// ---------------------------------------------------------------------------

/**
 * The `traderBrain` field added to existing AskResponse during shadow mode.
 * Evidence is always stripped. Tokens never appear here.
 */
export interface TraderBrainResponseField {
  intent: TraderBrainIntent;
  status: BrainExecutionStatus;
  sections: TraderBrainSections;
  warnings: string[];
  generatedAt: string;
}
