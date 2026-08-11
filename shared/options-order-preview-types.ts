/**
 * shared/options-order-preview-types.ts — Sprint 2.8.3
 *
 * Canonical types for Options / Multi-Leg Order Preview.
 *
 * PERMANENT ARCHITECTURE INVARIANT:
 *   Options Order Preview is a read-only representation of the exact option
 *   structure the user selected upstream and prepared as a non-executable
 *   OrderDraft. It may NEVER:
 *     - change the user's broad expression
 *     - change the selected strategy family
 *     - change the selected contract candidate
 *     - replace a contract / change expiration / strike / ratio / quantity
 *     - change broker account or draft pricing preference
 *     - decompose a multi-leg structure
 *     - submit an order
 *
 * executable is always false at the type level.
 */

import type { OptionsStrategyFamily } from "./options-strategy-types";

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW STATUS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options preview status.
 * NEVER: READY_TO_TRADE, APPROVED, EXECUTION_READY, RECOMMENDED, BEST_STRUCTURE.
 */
export type OptionsPreviewStatus =
  | "VALID"
  | "REQUIRES_REVIEW"
  | "EXPIRED"
  | "INVALID"
  | "UNAVAILABLE";

export const OPTIONS_PREVIEW_STATUS_LABELS: Record<OptionsPreviewStatus, string> = {
  VALID:           "Preview Ready",
  REQUIRES_REVIEW: "Needs Attention",
  EXPIRED:         "Preview Expired",
  INVALID:         "Preview Blocked",
  UNAVAILABLE:     "Preview Unavailable",
};

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED BROAD EXPRESSIONS (options side)
// ─────────────────────────────────────────────────────────────────────────────

export const OPTIONS_BROAD_EXPRESSIONS = new Set([
  "LONG_OPTIONS",
  "COVERED_CALL",
  "CASH_SECURED_PUT",
  "DEFINED_RISK_OPTIONS",
  "INCOME_OPTIONS",
  "NEUTRAL_OPTIONS",
  "ADVANCED_OPTIONS",
  "EXPLORE_COMPATIBLE_STRUCTURES",
] as const);

export type OptionsBroadExpression = typeof OPTIONS_BROAD_EXPRESSIONS extends Set<infer T> ? T : never;

// ─────────────────────────────────────────────────────────────────────────────
// LIQUIDITY CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────

export type LiquidityCategory = "STRONG" | "ACCEPTABLE" | "LIMITED" | "POOR" | "UNKNOWN";

export const LIQUIDITY_CATEGORY_LABELS: Record<LiquidityCategory, string> = {
  STRONG:     "Strong",
  ACCEPTABLE: "Acceptable",
  LIMITED:    "Limited",
  POOR:       "Poor",
  UNKNOWN:    "Unknown",
};

export function contractLiquidityToCategory(raw: string | null | undefined): LiquidityCategory {
  if (!raw) return "UNKNOWN";
  const s = raw.toLowerCase();
  if (s === "strong" || s === "excellent") return "STRONG";
  if (s === "acceptable" || s === "good" || s === "moderate") return "ACCEPTABLE";
  if (s === "limited" || s === "low") return "LIMITED";
  if (s === "poor" || s === "very_low" || s === "very low") return "POOR";
  return "UNKNOWN";
}

// ─────────────────────────────────────────────────────────────────────────────
// QUOTE CHANGE CATEGORY
// ─────────────────────────────────────────────────────────────────────────────

export type QuoteChangeCategory = "MATERIAL_CHANGE" | "SMALL_CHANGE" | "UNCHANGED" | "UNKNOWN";

export const OPTIONS_QUOTE_MATERIAL_THRESHOLD_PCT = 2.0; // 2% change is material for options

// ─────────────────────────────────────────────────────────────────────────────
// LIQUIDITY CHANGE CATEGORY
// ─────────────────────────────────────────────────────────────────────────────

export type LiquidityChangeCategory = "IMPROVED" | "UNCHANGED" | "WEAKENED" | "UNKNOWN";

// ─────────────────────────────────────────────────────────────────────────────
// PRICING TYPE (sign convention)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical pricing type for net structure price.
 * amount is always a positive number.
 * DEBIT = buyer pays amount; CREDIT = seller receives amount.
 */
export type StructurePricingType = "DEBIT" | "CREDIT" | "UNKNOWN";

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-LEG CAPABILITY STATUS
// ─────────────────────────────────────────────────────────────────────────────

export type MultiLegCapabilityStatus =
  | "SUPPORTED"      // provider can submit this as native multi-leg
  | "UNKNOWN"        // not yet verified
  | "UNSUPPORTED"    // provider cannot submit multi-leg natively
  | "SINGLE_LEG_ONLY"; // provider supports options but single-leg only

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS PERMISSION STATUS
// ─────────────────────────────────────────────────────────────────────────────

export type OptionsPermissionStatus = "PASS" | "INSUFFICIENT" | "UNAVAILABLE";

// ─────────────────────────────────────────────────────────────────────────────
// PER-LEG QUOTE
// ─────────────────────────────────────────────────────────────────────────────

export interface OptionsLegQuote {
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  last: number | null;
  spreadAbs: number | null;
  spreadPct: number | null;
  quoteTime: string;    // ISO 8601
  provider: string;
  freshnessCategory: "FRESH" | "AGING" | "STALE" | "UNAVAILABLE";
  freshnessSeconds: number;
  isStale: boolean;
  isCrossed: boolean;    // ask < bid
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-LEG GREEKS
// ─────────────────────────────────────────────────────────────────────────────

export interface OptionsLegGreeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  impliedVolatility: number | null;
  greeksAvailable: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-LEG LIQUIDITY
// ─────────────────────────────────────────────────────────────────────────────

export interface OptionsLegLiquidity {
  openInterest: number | null;
  volume: number | null;
  bidAskSpreadAbs: number | null;
  bidAskSpreadPct: number | null;
  category: LiquidityCategory;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT AVAILABILITY STATUS (per-leg)
// ─────────────────────────────────────────────────────────────────────────────

export type LegContractStatus =
  | "AVAILABLE"      // contract validated, quote fresh
  | "STALE_QUOTE"    // contract found but quote is stale
  | "UNAVAILABLE"    // contract not found or cannot be resolved
  | "EXPIRED";       // contract has expired

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS PREVIEW LEG
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical preview leg.
 * All values come from the OrderDraft or server-side validation.
 * Client may never inject any field.
 */
export interface OptionsPreviewLeg {
  legIndex: number;

  /** Canonical role from research (long_leg / short_leg / wing_long / wing_short) */
  role: string;
  roleLabel: string;

  /** Canonical intent — never BUY_TO_OPEN / SELL_TO_OPEN broker vocabulary */
  canonicalIntent: string;
  canonicalIntentLabel: string;

  /** OCC-style contract symbol */
  contractSymbol: string;

  optionType: "call" | "put";

  expiration: string;  // YYYY-MM-DD
  dte: number;         // calendar days remaining as of preview generation
  expirationLabel: string;
  isExpired: boolean;

  strike: number;

  /** Leg-level ratio (typically 1) */
  ratio: number;
  /** Number of contracts for this leg */
  quantity: number;
  /** Option multiplier (typically 100 for US equity options) */
  multiplier: number;

  /** Quote captured at draft creation */
  draftQuote: OptionsLegQuote | null;
  /** Current quote fetched at preview generation time */
  currentQuote: OptionsLegQuote | null;

  /** Change category vs draft midpoint */
  quoteChangeCategory: QuoteChangeCategory;
  /** Change amount (current mid - draft mid) */
  quoteMidpointChangeAbs: number | null;
  /** Change % vs draft midpoint */
  quoteMidpointChangePct: number | null;

  liquidity: OptionsLegLiquidity;

  greeks: OptionsLegGreeks | null;

  status: LegContractStatus;
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// NET STRUCTURE PRICING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Net debit/credit pricing for the structure.
 *
 * Sign convention:
 *   long legs contribute DEBIT (pay premium).
 *   short legs contribute CREDIT (receive premium).
 *   net = Σ(short midpoints) - Σ(long midpoints)
 *   If net > 0 → CREDIT; net < 0 → DEBIT.
 *   amount is ALWAYS positive; pricingType distinguishes direction.
 */
export interface NetStructurePricing {
  /** DEBIT or CREDIT — explicit, never implicit from sign */
  pricingType: StructurePricingType;
  /** Positive net amount per contract unit (in dollars per share, pre-multiplier) */
  amountPerUnit: number | null;
  /** Net amount × multiplier per contract */
  amountPerContract: number | null;
  /** Total for all contracts (amountPerContract × quantity) */
  totalAmount: number | null;

  /** Multiplier used */
  multiplier: number;

  /** Draft net reference (from OrderDraft.capitalContext) */
  draftNetReference: number | null;
  /** Draft pricing type */
  draftPricingType: StructurePricingType;

  /** Current - Draft difference (current amountPerUnit - draft net ref) */
  differenceAbs: number | null;
  /** Change % ((current - draft) / draft × 100) */
  differencePct: number | null;

  /** "Current Structure Quote Change" label — never "Gain/Loss" */
  changeLabel: string;

  /** Whether all leg quotes were available for this calculation */
  allQuotesAvailable: boolean;
  /** Whether this is a midpoint estimate */
  isMidpointEstimate: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// QUOTE FRESHNESS CONTEXT (aggregate)
// ─────────────────────────────────────────────────────────────────────────────

export interface OptionsQuoteFreshness {
  oldestQuoteTime: string | null;
  newestQuoteTime: string | null;
  allFresh: boolean;
  anyStale: boolean;
  legsWithStaleQuotes: number;
  totalLegs: number;
  aggregateFreshnessCategory: "FRESH" | "AGING" | "STALE" | "UNAVAILABLE";
}

// ─────────────────────────────────────────────────────────────────────────────
// LIQUIDITY CONTEXT (aggregate)
// ─────────────────────────────────────────────────────────────────────────────

export interface OptionsLiquidityContext {
  overallCategory: LiquidityCategory;
  liquidityChange: LiquidityChangeCategory;
  perLegSummary: Array<{
    legIndex: number;
    contractSymbol: string;
    category: LiquidityCategory;
  }>;
  widestSpreadPct: number | null;
  note: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// RISK CONTEXT (carried from Risk Analysis — never recomputed)
// ─────────────────────────────────────────────────────────────────────────────

export interface OptionsPreviewRiskContext {
  /** Max loss per contract */
  maxLoss: Record<string, unknown> | null;
  /** Max gain per contract */
  maxGain: Record<string, unknown> | null;
  /** Breakeven prices */
  breakevens: Record<string, unknown>[];
  /** Capital profile from Risk Analysis */
  capitalProfile: Record<string, unknown> | null;
  /** Risk flags from Trade Plan */
  riskFlags: string[];
  /** Planning constraint status */
  constraintStatus: string;
  /** Whether the payoff is path-dependent */
  pathDependent: boolean;
  /** Net Greeks from Risk Analysis */
  netGreeks: {
    netDelta: number | null;
    netGamma: number | null;
    netTheta: number | null;
    netVega: number | null;
  } | null;
  /** Whether risk analysis is considered stale */
  riskAnalysisStale: boolean;
  /** Whether thesis has been invalidated */
  researchInvalidation: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGNMENT / EXERCISE CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

export interface AssignmentExerciseContext {
  hasShortLegs: boolean;
  hasLongLegs: boolean;

  /** Assignment risk applies to short legs */
  assignmentRisk: boolean;
  assignmentNote: string | null;

  /** Early exercise risk (American-style options) */
  earlyExerciseRisk: boolean;
  earlyExerciseNote: string | null;

  /** Pin risk — short strike near underlying near expiration */
  pinRisk: boolean;
  pinRiskNote: string | null;

  /** Exercise context for long legs near expiration */
  exerciseContext: string | null;

  /** Covered status (for Covered Call / Collar / Protective Put) */
  coverageRequired: boolean;
  coverageValidated: boolean;
  coverageNote: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

export type EventStatus =
  | "EVENT_INSIDE_STRUCTURE_LIFE"
  | "EVENT_APPROACHING"
  | "EVENT_PASSED"
  | "NO_EVENT_DETECTED"
  | "EVENT_UNKNOWN";

export interface OptionsEventContext {
  status: EventStatus;
  eventType: string | null;
  earningsDate: string | null;
  insideEventWindow: boolean;
  note: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPIRATION CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

export interface ExpirationContext {
  /** Primary expiration date (YYYY-MM-DD) */
  primaryExpiration: string;
  /** Secondary expiration for calendar/diagonal (null for single-expiration) */
  secondaryExpiration: string | null;
  /** Calendar/diagonal flag */
  hasMultipleExpirations: boolean;
  /** DTEs for each leg */
  dteSummary: Array<{ legIndex: number; expiration: string; dte: number }>;
  /** Whether any leg is at or past expiration */
  anyExpired: boolean;
  /** Near-expiration warning threshold (≤7 DTE) */
  nearExpirationWarning: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// BROKER CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

export interface OptionsPreviewBrokerContext {
  provider: string;
  accountMasked: string;
  accountType: string;
  executionMode: string;
  executionEnabled: boolean;
  optionsPermissionStatus: OptionsPermissionStatus;
  multiLegCapabilityStatus: MultiLegCapabilityStatus;
  supportsOptionsOrders: boolean;
  supportedTimeInForce: string[];
  buyingPowerCheckStatus: "PASS" | "FAIL" | "UNAVAILABLE";
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE INTEGRITY
// ─────────────────────────────────────────────────────────────────────────────

export interface OptionsPreviewSourceIntegrity {
  tradePlanMatches: boolean;
  tradePlanVersionMatches: boolean;
  broadExpressionMatches: boolean;
  strategyFamilyMatches: boolean;
  contractCandidateMatches: boolean;
  preflightMatches: boolean;
  orderDraftMatches: boolean;
  accountMatches: boolean;
  lifecycleCurrent: boolean;
  contractsCurrent: boolean;
  quotesCurrent: boolean;
  structureValid: boolean;
  allPass: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCKER CODES
// ─────────────────────────────────────────────────────────────────────────────

export type OptionsPreviewBlockerCode =
  | "ORDER_DRAFT_NOT_FOUND"
  | "ORDER_DRAFT_EXPIRED"
  | "ORDER_DRAFT_ABANDONED"
  | "WRONG_INSTRUMENT_TYPE"          // draft is EQUITY, not OPTION/MULTI_LEG_OPTION
  | "WRONG_EXPRESSION_TYPE"          // broadExpressionType is STOCK
  | "TRADE_PLAN_NOT_FOUND"
  | "TRADE_PLAN_VERSION_CHANGED"
  | "PREFLIGHT_MISSING"
  | "PREFLIGHT_EXPIRED"
  | "PREFLIGHT_NOT_PASSING"
  | "LIFECYCLE_THESIS_INVALIDATED"
  | "LIFECYCLE_CHANGED"
  | "STRATEGY_FAMILY_MISMATCH"
  | "STRUCTURE_INVALID"
  | "LEG_COUNT_INVALID"
  | "CONTRACT_UNAVAILABLE"
  | "CONTRACT_EXPIRED"
  | "QUOTE_STALE"
  | "BROKER_DISCONNECTED"
  | "OPTIONS_PERMISSION_INSUFFICIENT"
  | "INSUFFICIENT_BUYING_POWER"
  | "COVERAGE_NOT_CONFIRMED"        // for Covered Call / Collar / Protective Put
  | "TIF_UNSUPPORTED"
  | "ORDER_TYPE_UNSUPPORTED";

export interface OptionsPreviewBlocker {
  code: OptionsPreviewBlockerCode;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// WARNING CODES
// ─────────────────────────────────────────────────────────────────────────────

export type OptionsPreviewWarningCode =
  | "EXECUTION_DISABLED"
  | "QUOTE_MOVED"                    // per-leg or aggregate movement
  | "QUOTE_STALE_PARTIAL"            // some quotes stale but not all
  | "MARKET_CLOSED"
  | "PRE_MARKET"
  | "AFTER_HOURS"
  | "PREFLIGHT_EXPIRY_APPROACHING"
  | "RISK_ANALYSIS_STALE"
  | "NEAR_EXPIRATION"                // ≤7 DTE on any leg
  | "MARKET_ORDER_OPTIONS_WARNING"   // market order on options — high risk
  | "MULTI_LEG_NOT_SUPPORTED"       // provider cannot submit native multi-leg
  | "WIDE_SPREAD"
  | "LOW_OPEN_INTEREST"
  | "EVENT_INSIDE_STRUCTURE"
  | "ASSIGNMENT_RISK"
  | "EARLY_EXERCISE_RISK"
  | "TIME_DECAY_ACCELERATING"        // theta warning near expiration
  | "PATH_DEPENDENT"                 // calendar/diagonal
  | "PARTIAL_GREEKS"                 // some Greeks unavailable
  | "LIMIT_ABOVE_MARKET_REFERENCE"
  | "LIMIT_BELOW_MARKET_REFERENCE";

export interface OptionsPreviewWarning {
  code: OptionsPreviewWarningCode;
  message: string;
  legIndex?: number;  // if leg-specific
}

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL OPTIONS ORDER PREVIEW
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical OptionsOrderPreview.
 *
 * NON-EXECUTABLE. executable is always false at the type level.
 * This type CANNOT satisfy a BrokerSubmissionRequest.
 *
 * All values are computed server-side.
 * Client may never inject: strategy, legs, contracts, strikes, expirations,
 * ratios, quantity, account, quotes, debit/credit, risk values, or
 * broker capabilities.
 */
export interface OptionsOrderPreview {
  /** Type-level non-executable guard. ALWAYS false. Never remove. */
  readonly executable: false;

  id: string;
  userId: string;
  tradePlanId: string;
  tradePlanVersion: number;

  preflightId: string;
  orderDraftId: string;
  orderDraftVersion: number;

  /** Broad expression — read from Trade Plan; never from client */
  broadExpressionType: string;
  /** Always "USER" — the trader explicitly selected this expression */
  selectedBy: "USER";

  /** Specific strategy family — read from OrderDraft.structureType */
  strategyFamily: OptionsStrategyFamily;
  strategyLabel: string;
  strategyCategory: string;

  /** OPTION or MULTI_LEG_OPTION */
  instrumentType: "OPTION" | "MULTI_LEG_OPTION";

  /** Underlying equity symbol */
  symbol: string;
  companyName?: string;

  generatedAt: string;   // ISO 8601
  validUntil: string;    // ISO 8601

  status: OptionsPreviewStatus;

  broker: OptionsPreviewBrokerContext;

  expirationContext: ExpirationContext;

  /** All legs from the OrderDraft — immutable, never replaced */
  legs: OptionsPreviewLeg[];

  /** Order-level quantity context */
  quantityContext: {
    confirmedQuantity: number;
    unit: "contracts";
    hypotheticalPlanQuantity: number | null;
  };

  orderType: string;
  timeInForce: string;
  allowExtendedHours: boolean;

  netStructurePricing: NetStructurePricing;
  quoteFreshness: OptionsQuoteFreshness;
  liquidityContext: OptionsLiquidityContext;

  riskContext: OptionsPreviewRiskContext;
  assignmentExerciseContext: AssignmentExerciseContext;
  eventContext: OptionsEventContext;

  blockers: OptionsPreviewBlocker[];
  warnings: OptionsPreviewWarning[];

  sourceIntegrity: OptionsPreviewSourceIntegrity;

  disclaimer: string;
  executionPriceDisclaimer: string;
  optionsRiskDisclosure: string;
  midpointDisclaimer: string;

  methodologyVersion: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH METRICS
// ─────────────────────────────────────────────────────────────────────────────

export interface OptionsPreviewHealthMetrics {
  previewRequests: number;
  singleLegPreviews: number;
  multiLegPreviews: number;
  previewPasses: number;
  previewRequiresReview: number;
  previewInvalid: number;
  previewExpired: number;
  previewFailures: number;
  averagePreviewLatencyMs: number;
  lastPreviewAt: string | null;
  brokerSubmissionEnabled: false;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const OPTIONS_PREVIEW_METHODOLOGY_VERSION = "2.8.3" as const;

export const OPTIONS_PREVIEW_NON_EXECUTION_BANNER =
  "Preview Only — Nothing has been submitted to your broker." as const;

export const OPTIONS_PREVIEW_DISCLAIMER =
  "Options Order Preview displays the current non-executable order draft, selected option structure, current quote context, and existing risk analysis for review. It does not submit an order, guarantee execution or price, or constitute investment advice, a recommendation, or a suitability determination." as const;

export const OPTIONS_PREVIEW_PRICE_DISCLAIMER =
  "Displayed contract quotes and net debit/credit references are current research/preview values. Actual execution prices may differ materially." as const;

export const OPTIONS_PREVIEW_MIDPOINT_DISCLAIMER =
  "Net debit/credit values are calculated from current quote references. Actual execution prices may differ materially." as const;

export const OPTIONS_RISK_DISCLOSURE =
  "Options trading involves significant risk. Losses can exceed the amount invested for certain strategies. Not all strategies are suitable for all investors. Prior to trading options, review the Characteristics and Risks of Standardized Options (ODD) document." as const;

export const OPTIONS_PREVIEW_DEFAULT_TTL_MS = 8 * 60 * 1000; // 8 minutes (shorter than equity due to options volatility)

export const OPTIONS_PREVIEW_PREFLIGHT_WARNING_SEC = 5 * 60; // 5 minutes before preflight expires
export const OPTIONS_DTE_NEAR_EXPIRATION = 7;    // ≤7 DTE → warning
export const OPTIONS_MULTIPLIER_DEFAULT = 100;    // standard US equity options
export const OPTIONS_WIDE_SPREAD_THRESHOLD_PCT = 15; // spread > 15% → WIDE_SPREAD warning

/** Labels forbidden in any options preview UI or response */
export const OPTIONS_PREVIEW_FORBIDDEN_LABELS: readonly string[] = [
  "Best Options Trade", "Recommended Spread", "Recommended Contract",
  "Best Strike", "Best Expiration", "Ready to Trade",
  "Submit Now", "Guaranteed Fill", "Expected Profit",
  "Probability of Profit", "Chance of Winning", "POP",
  "Roll Now", "Close Now", "Place Order",
  "Confirm & Submit", "Execute", "Send to Broker",
  "Trade Approved", "Execution Ready", "Good to Go",
  "Buy to Open", "Sell to Open",  // broker vocabulary not yet translated
] as const;

/** Strategy family display labels */
export const STRATEGY_FAMILY_LABELS: Partial<Record<string, string>> = {
  long_call:        "Long Call",
  long_put:         "Long Put",
  covered_call:     "Covered Call",
  cash_secured_put: "Cash-Secured Put",
  protective_put:   "Protective Put",
  collar:           "Collar",
  bull_call_spread: "Bull Call Spread",
  bear_put_spread:  "Bear Put Spread",
  bull_put_spread:  "Bull Put Spread",
  bear_call_spread: "Bear Call Spread",
  iron_condor:      "Iron Condor",
  iron_butterfly:   "Iron Butterfly",
  long_straddle:    "Long Straddle",
  long_strangle:    "Long Strangle",
  calendar_spread:  "Calendar Spread",
  diagonal_spread:  "Diagonal Spread",
};

/** Canonical intent display labels */
export const CANONICAL_INTENT_LABELS: Record<string, string> = {
  OPEN_LONG:              "Open Long",
  OPEN_SHORT_COVERED:     "Open Short (Covered)",
  OPEN_SHORT_SECURED:     "Open Short (Cash-Secured)",
  OPEN_SHORT_DEFINED_RISK:"Open Short (Defined Risk)",
  CLOSE_LONG:             "Close Long",
  CLOSE_SHORT:            "Close Short",
};

/** Role display labels */
export const LEG_ROLE_LABELS: Record<string, string> = {
  long_leg:    "Long",
  short_leg:   "Short",
  wing_long:   "Long Wing",
  wing_short:  "Short Wing",
};
