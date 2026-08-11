/**
 * shared/equity-order-preview-types.ts — Sprint 2.8.2
 *
 * Canonical Equity Order Preview types.
 *
 * PERMANENT ARCHITECTURE INVARIANT:
 *   EquityOrderPreview is a read-only review surface.
 *   It may NEVER submit, confirm, mutate, or produce a live broker payload.
 *   executable is always false.
 *   broadExpressionType must be STOCK.
 *   selectedBy must be USER.
 *
 * FORBIDDEN status labels: READY_TO_TRADE, APPROVED, EXECUTION_READY, RECOMMENDED, GOOD_TO_GO
 * FORBIDDEN CTA labels: Confirm, Confirm & Submit, Place Order, Submit Order, Execute, Send to Broker
 */

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW STATUS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical preview status values.
 * NEVER: READY_TO_TRADE, APPROVED, EXECUTION_READY, RECOMMENDED, GOOD_TO_GO
 */
export type EquityPreviewStatus =
  | "VALID"
  | "REQUIRES_REVIEW"
  | "EXPIRED"
  | "INVALID"
  | "UNAVAILABLE";

/** Human-readable labels for preview status. */
export const EQUITY_PREVIEW_STATUS_LABELS: Record<EquityPreviewStatus, string> = {
  VALID:            "Preview Valid",
  REQUIRES_REVIEW:  "Requires Review",
  EXPIRED:          "Preview Expired",
  INVALID:          "Invalid",
  UNAVAILABLE:      "Preview Unavailable",
};

// ─────────────────────────────────────────────────────────────────────────────
// BLOCKER CODES
// ─────────────────────────────────────────────────────────────────────────────

export type EquityPreviewBlockerCode =
  | "ORDER_DRAFT_NOT_FOUND"
  | "ORDER_DRAFT_EXPIRED"
  | "ORDER_DRAFT_ABANDONED"
  | "ORDER_DRAFT_INVALID"
  | "PREFLIGHT_MISSING"
  | "PREFLIGHT_EXPIRED"
  | "PREFLIGHT_NOT_PASSING"
  | "TRADE_PLAN_NOT_FOUND"
  | "TRADE_PLAN_VERSION_CHANGED"
  | "WRONG_EXPRESSION_TYPE"           // broadExpressionType ≠ STOCK
  | "LIFECYCLE_THESIS_INVALIDATED"
  | "LIFECYCLE_CHANGED"
  | "QUOTE_STALE"
  | "ACCOUNT_CHANGED"
  | "BROKER_DISCONNECTED"
  | "ORDER_TYPE_UNSUPPORTED"
  | "TIF_UNSUPPORTED"
  | "INSUFFICIENT_BUYING_POWER"
  | "CROSS_USER_ACCESS_DENIED";

export interface EquityPreviewBlocker {
  code: EquityPreviewBlockerCode;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// WARNING CODES
// ─────────────────────────────────────────────────────────────────────────────

export type EquityPreviewWarningCode =
  | "MARKET_ORDER_PRICE_UNCERTAINTY"
  | "MARKET_CLOSED"
  | "PRE_MARKET"
  | "AFTER_HOURS"
  | "QUOTE_MOVED"
  | "QUOTE_NEAR_EXPIRY"
  | "DATA_REFRESH_SOON"
  | "RESEARCH_CHANGED"
  | "EARNINGS_WINDOW"
  | "CONCENTRATION_CONTEXT"
  | "EXECUTION_DISABLED"
  | "PREFLIGHT_EXPIRY_APPROACHING"
  | "LIMIT_ABOVE_ASK"
  | "LIMIT_BELOW_BID";

export interface EquityPreviewWarning {
  code: EquityPreviewWarningCode;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICE MOVEMENT
// ─────────────────────────────────────────────────────────────────────────────

export type PriceMovementCategory =
  | "UNCHANGED"
  | "SMALL_CHANGE"       // < 0.5%
  | "MATERIAL_CHANGE"    // ≥ 0.5%
  | "UNKNOWN";

/** Canonical threshold: 0.5% change = MATERIAL_CHANGE */
export const PRICE_MOVEMENT_MATERIAL_THRESHOLD_PCT = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// LIMIT PRICE MARKET RELATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Descriptive — never "Good Limit" or "Bad Limit".
 */
export type LimitMarketRelation =
  | "AT_OR_ABOVE_ASK"
  | "BETWEEN_BID_ASK"
  | "AT_OR_BELOW_BID"
  | "OUTSIDE_CURRENT_MARKET"
  | "UNKNOWN";

// ─────────────────────────────────────────────────────────────────────────────
// QUOTE CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Current market quote context for the preview.
 * This is CURRENT DATA — separate from draft quote snapshot.
 * Never conflate with draft limit price or draft quote.
 */
export interface PreviewQuoteContext {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  midpoint: number | null;
  quoteTime: string;       // ISO 8601
  freshnessCategory: "FRESH" | "AGING" | "STALE" | "UNAVAILABLE";
  freshnessSeconds: number;
  provider: string;
  isCrossed: boolean;
  isStale: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICING SECTION (draft inputs + current market context)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IMPORTANT: Separate draft values from current market context.
 * Draft values are immutable here — preview never rewrites them.
 */
export interface EquityPreviewPricing {
  orderType: "MARKET" | "LIMIT";

  // ── DRAFT VALUES (immutable in preview) ──
  /** User-selected limit price from the draft. null for MARKET orders. */
  draftLimitPrice: number | null;
  /** Source of the draft limit price. */
  draftLimitPriceSource: string | null;
  /** Bid at draft creation time (from draft quote snapshot). */
  draftBid: number | null;
  /** Ask at draft creation time (from draft quote snapshot). */
  draftAsk: number | null;
  /** Draft midpoint at creation time. */
  draftMidpoint: number | null;

  // ── CURRENT MARKET CONTEXT ──
  /** Current quote (fetched/validated at preview time — NOT from draft). */
  currentQuote: PreviewQuoteContext;

  // ── LIMIT ANALYSIS (only for LIMIT orders) ──
  limitMarketRelation?: LimitMarketRelation;
  limitDistanceFromBid?: number | null;    // dollars
  limitDistanceFromAsk?: number | null;    // dollars
  limitDistancePct?: number | null;        // percentage

  // ── PRICE MOVEMENT ──
  priceMovement: PriceMovementCategory;
  /** Numeric difference between current midpoint and draft midpoint. null if unknown. */
  priceDifferenceAbs?: number | null;
  priceDifferencePct?: number | null;

  // ── ESTIMATED NOTIONAL ──
  /** Estimated notional value. Always labeled transparently. */
  estimatedNotional: number | null;
  /** Label for estimated notional methodology, e.g. "Estimated Notional at Current Ask" */
  estimatedNotionalLabel: string;

  // ── MARKET ORDER SPECIFIC ──
  marketOrderWarning: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKET HOURS SECTION
// ─────────────────────────────────────────────────────────────────────────────

export interface EquityPreviewMarketHours {
  sessionState: "OPEN" | "CLOSED" | "PRE_MARKET" | "AFTER_HOURS" | "UNKNOWN";
  asOf: string;
  informationalNote?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// BROKER / ACCOUNT SECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Broker and account context.
 * Full account ID NEVER exposed — masked only.
 */
export interface EquityPreviewBrokerContext {
  provider: string;
  /** Display-safe masked identifier: "••••1234" */
  accountMasked: string;
  accountType: string;
  executionMode: "DISABLED" | "SANDBOX" | "PRODUCTION";
  executionEnabled: boolean;
  supportsMarketOrders: boolean;
  supportsLimitOrders: boolean;
  supportedTimeInForce: string[];
  buyingPowerCheckStatus: "PASS" | "FAIL" | "UNAVAILABLE";
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE INTEGRITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All critical source references must agree.
 * If any fails → preview INVALID / requires regeneration.
 */
export interface PreviewSourceIntegrity {
  tradePlanMatches: boolean;
  tradePlanVersionMatches: boolean;
  broadExpressionMatches: boolean;     // broadExpressionType = STOCK, selectedBy = USER
  preflightMatches: boolean;
  orderDraftMatches: boolean;
  accountMatches: boolean;
  symbolMatches: boolean;
  lifecycleCurrent: boolean;
  quoteCurrent: boolean;
  allPass: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANNING CONTEXT SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

export interface EquityPreviewPlanningContext {
  symbol: string;
  companyName?: string;
  researchSummary?: string;
  researchThesis?: string;
  researchScoreAtPlanCreation?: number | null;
  currentLifecycleState: string;
  thesisInvalidated: boolean;
  planVersion: number;
  planCreatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// RISK CONTEXT SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

export interface EquityPreviewRiskContext {
  constraintStatus: string;
  riskFlags: string[];
  researchInvalidation: boolean;
  planningScenarioLoss?: string | null;    // display string, no raw number
  concentrationContext?: string | null;
  coverageValidated: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// USER SELECTION TRACE (audit trail)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preserved audit metadata: user selected STOCK upstream.
 * selectedBy must always be "USER".
 */
export interface ExpressionSelectionTrace {
  selectedExpressionType: "STOCK";
  selectedBy: "USER";
  selectedAt?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL EQUITY ORDER PREVIEW
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical EquityOrderPreview — Sprint 2.8.2.
 *
 * NON-EXECUTABLE. executable is always false.
 * broadExpressionType must always be "STOCK".
 * selectedBy must always be "USER".
 *
 * Preview is ephemeral — not stored in a database table.
 * Audit events are written to execution_audit_events.
 */
export interface EquityOrderPreview {
  /** Always false. Non-executable. */
  readonly executable: false;

  id: string;
  userId: string;

  // ── Source references ──
  tradePlanId: string;
  tradePlanVersion: number;
  preflightId: string;
  orderDraftId: string;
  orderDraftVersion: number;

  /** Always "STOCK" for equity preview. */
  expressionType: "STOCK";
  /** Always "USER" — AI cannot set this. */
  expressionSelectedBy: "USER";
  expressionSelectedAt?: string | null;

  // ── Preview validity ──
  generatedAt: string;    // ISO 8601
  validUntil: string;     // ISO 8601 — shortest of draft/preflight/quote freshness

  status: EquityPreviewStatus;

  // ── Instrument ──
  symbol: string;
  companyName?: string;

  // ── Intent ──
  sideIntent: string;
  sideIntentLabel: string;

  // ── Quantity (user-selected — explicit, never hypothetical) ──
  quantity: number;
  quantityUnit: "shares";

  // ── Order parameters ──
  orderType: "MARKET" | "LIMIT";
  timeInForce: "DAY" | "GTC";
  allowExtendedHours: boolean;

  // ── Broker / Account ──
  broker: EquityPreviewBrokerContext;

  // ── Pricing ──
  pricing: EquityPreviewPricing;

  // ── Market hours ──
  marketHours: EquityPreviewMarketHours;

  // ── Planning context ──
  planningContext: EquityPreviewPlanningContext;

  // ── Risk context ──
  riskContext: EquityPreviewRiskContext;

  // ── Capital context ──
  estimatedDraftNotional: number | null;
  planningScenarioCapital?: string | null;
  buyingPowerCheckStatus: "PASS" | "FAIL" | "UNAVAILABLE";

  // ── Source integrity ──
  sourceIntegrity: PreviewSourceIntegrity;

  // ── Expression selection trace (audit) ──
  expressionTrace: ExpressionSelectionTrace;

  // ── Blockers / Warnings ──
  blockers: EquityPreviewBlocker[];
  warnings: EquityPreviewWarning[];

  // ── Disclaimer ──
  disclaimer: string;
  executionPriceDisclaimer: string;

  methodologyVersion: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT EVENT TYPES — Sprint 2.8.2
// ─────────────────────────────────────────────────────────────────────────────

export type EquityPreviewAuditEventType =
  | "EQUITY_PREVIEW_STARTED"
  | "EQUITY_PREVIEW_GENERATED"
  | "EQUITY_PREVIEW_REFRESHED"
  | "EQUITY_PREVIEW_REQUIRES_REVIEW"
  | "EQUITY_PREVIEW_EXPIRED";
// Never: ORDER_CONFIRMED, ORDER_SUBMITTED (Sprint 2.8.5+)

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM HEALTH
// ─────────────────────────────────────────────────────────────────────────────

export interface EquityPreviewHealthMetrics {
  previewRequests: number;
  previewPasses: number;
  previewRequiresReview: number;
  previewExpired: number;
  previewFailures: number;
  averagePreviewLatencyMs: number;
  lastPreviewAt: string | null;
  brokerSubmissionEnabled: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// API REQUEST / RESPONSE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Client may only submit orderDraftId and refresh flag.
 * ALL other fields come from server-stored sources.
 * Client MUST NOT submit: symbol, quantity, side, orderType, TIF, limitPrice, quote, account, plan version.
 */
export interface EquityPreviewRequest {
  orderDraftId: string;
  refresh?: boolean;
}

export interface EquityPreviewResponse {
  preview: EquityOrderPreview;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const EQUITY_PREVIEW_DISCLAIMER =
  "Equity Order Preview displays the current non-executable order draft and supporting market/account validation for review. " +
  "It does not submit an order, guarantee execution or price, or constitute investment advice, a recommendation, or a suitability determination.";

export const EQUITY_PREVIEW_PRICE_DISCLAIMER =
  "Displayed quotes and estimated notional values are reference values. " +
  "Market conditions may change before any future broker submission.";

export const EQUITY_PREVIEW_MARKET_ORDER_WARNING =
  "Market orders do not guarantee an execution price. A future fill could occur at a price materially different from the currently displayed quote.";

export const EQUITY_PREVIEW_LIMIT_EDUCATION =
  "A limit price sets the maximum price for a buy order or minimum price for a sell order, but does not guarantee execution.";

export const EQUITY_PREVIEW_NON_EXECUTION_BANNER =
  "Preview Only — Nothing has been submitted to your broker.";

export const EQUITY_PREVIEW_METHODOLOGY_VERSION = "2.8.2";

/** Forbidden labels in Equity Order Preview UI. */
export const EQUITY_PREVIEW_FORBIDDEN_LABELS = [
  "Ready to Trade", "Trade Approved", "Submit Now", "Buy Now", "Sell Now",
  "Guaranteed Fill", "Expected Fill", "Recommended Limit", "Recommended Quantity",
  "Best Price", "Optimal Order", "Confirm", "Confirm & Submit",
  "Place Order", "Submit Order", "Execute", "Send to Broker",
] as const;

/** Side intent user-facing labels. */
export const SIDE_INTENT_LABELS: Record<string, string> = {
  OPEN_LONG:    "Open Long Position",
  ADD_TO_LONG:  "Add to Long Position",
  REDUCE_LONG:  "Reduce Long Position",
  CLOSE_LONG:   "Close Long Position",
};

/** Default preview TTL: 10 minutes */
export const EQUITY_PREVIEW_DEFAULT_TTL_MS = 10 * 60 * 1000;

/** Quote freshness threshold for preview: 60 seconds */
export const EQUITY_PREVIEW_QUOTE_FRESHNESS_SEC = 60;

/** Preflight expiry warning threshold: within 5 minutes of expiry */
export const EQUITY_PREVIEW_PREFLIGHT_WARNING_SEC = 5 * 60;
