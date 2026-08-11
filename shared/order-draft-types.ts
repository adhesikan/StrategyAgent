/**
 * shared/order-draft-types.ts — Sprint 2.8.1 Order Preparation Engine
 *
 * Canonical OrderDraft types shared between server and client.
 *
 * ARCHITECTURE INVARIANT:
 * An OrderDraft is a NON-EXECUTABLE representation of a possible future broker
 * order. It describes what a future order COULD contain if the user later
 * proceeds through the full execution pipeline.
 *
 * An OrderDraft MUST NOT:
 * - submit, place, or cancel a broker order
 * - constitute investment advice, suitability determination, or recommendation
 * - be used as input to a broker submission API without 2.8.5 validation
 *
 * Type separation is MANDATORY:
 *   OrderDraft             — non-executable, Sprint 2.8.1
 *   ConfirmedOrderIntent   — future Sprint 2.8.5 (not yet defined)
 *   BrokerSubmissionRequest — future Sprint 2.8.5 (not yet defined)
 *
 * These three types must never be the same type.
 * OrderDraft.executable is always false at the type level.
 */

import type { ExecutionMode, BrokerAccountType } from "./execution-types";

// ─────────────────────────────────────────────────────────────────────────────
// INSTRUMENT TYPE
// ─────────────────────────────────────────────────────────────────────────────

export type DraftInstrumentType = "EQUITY" | "OPTION" | "MULTI_LEG_OPTION";

// ─────────────────────────────────────────────────────────────────────────────
// ORDER DRAFT STATUS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allowed OrderDraft statuses.
 * NEVER: SUBMITTED, FILLED, APPROVED, READY_TO_TRADE.
 */
export type OrderDraftStatus =
  | "DRAFT"
  | "VALID"
  | "REQUIRES_REVIEW"
  | "EXPIRED"
  | "INVALID"
  | "ABANDONED";

// ─────────────────────────────────────────────────────────────────────────────
// SIDE / LEG INTENT  (canonical — not broker-specific BUY/SELL)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Equity side intent.
 * Derived from user-selected Trade Plan semantics.
 * Never inferred from ticker alone.
 * OPEN_LONG is the only currently supported scenario.
 */
export type DraftSideIntent =
  | "OPEN_LONG"
  | "ADD_TO_LONG"
  | "REDUCE_LONG"
  | "CLOSE_LONG";

/**
 * Option leg intent — canonical semantics.
 * Provider-specific vocabulary (BUY_TO_OPEN, SELL_TO_OPEN, etc.) is
 * deferred to Sprint 2.8.2/2.8.3 provider translation.
 *
 * Mapping from research leg roles:
 *   research LONG leg    → OPEN_LONG
 *   research SHORT leg (with shares coverage) → OPEN_SHORT_COVERED
 *   research SHORT leg (with cash secured)    → OPEN_SHORT_SECURED
 *   closing a long leg   → CLOSE_LONG
 *   closing a short leg  → CLOSE_SHORT
 */
export type DraftLegIntent =
  | "OPEN_LONG"
  | "OPEN_SHORT_COVERED"
  | "OPEN_SHORT_SECURED"
  | "CLOSE_LONG"
  | "CLOSE_SHORT";

// ─────────────────────────────────────────────────────────────────────────────
// ORDER TYPE & TIME IN FORCE
// ─────────────────────────────────────────────────────────────────────────────

/** Supported order type preferences for Sprint 2.8.1. */
export type DraftOrderType = "MARKET" | "LIMIT";

/**
 * Supported time-in-force preferences.
 * IOC / FOK / GTD are future if provider/instrument requires.
 */
export type DraftTimeInForce = "DAY" | "GTC";

/** Source of the limit price reference. Never auto-optimized. */
export type DraftLimitPriceSource =
  | "USER_SELECTED"
  | "REFERENCE_MIDPOINT"
  | "REFERENCE_BID"
  | "REFERENCE_ASK";

// ─────────────────────────────────────────────────────────────────────────────
// MARKET HOURS CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

export type MarketSessionState =
  | "OPEN"
  | "CLOSED"
  | "PRE_MARKET"
  | "AFTER_HOURS"
  | "UNKNOWN";

export interface DraftMarketHoursContext {
  sessionState: MarketSessionState;
  asOf: string; // ISO 8601
}

// ─────────────────────────────────────────────────────────────────────────────
// QUOTE SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────────

/** Quote reference for one instrument leg. Stored as a snapshot at draft creation. */
export interface DraftLegQuote {
  contractSymbol: string;
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  last: number | null;
  provider: string;
  asOf: string; // ISO 8601
  isStale: boolean;
}

/**
 * Quote snapshot preserved in the OrderDraft.
 * Quotes are references used at draft creation time.
 * They will change before any future order is submitted.
 */
export interface DraftQuoteSnapshot {
  /** Underlying equity quote */
  underlying?: DraftLegQuote;
  /** Option leg quotes (by legIndex) */
  optionLegs?: DraftLegQuote[];
  capturedAt: string; // ISO 8601
  freshnessStatus: "FRESH" | "AGING" | "STALE" | "UNAVAILABLE";
  /** Estimated seconds until this snapshot is considered stale */
  estimatedFreshForSec: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ORDER DRAFT LEG
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One leg of the OrderDraft.
 * For equity: single leg with instrumentType = EQUITY.
 * For options: one or more legs with instrumentType = OPTION.
 *
 * Uses canonical leg semantics — never broker BUY/SELL vocabulary.
 * Provider translation is deferred to Sprint 2.8.2/2.8.3.
 */
export interface OrderDraftLeg {
  legIndex: number;
  instrumentType: DraftInstrumentType;
  /** Underlying symbol (equity) or OCC-style contract symbol (option) */
  symbol: string;
  /** Option type — only for option legs */
  optionType?: "call" | "put";
  /** Expiration date YYYY-MM-DD — only for option legs */
  expiration?: string;
  /** Strike price — only for option legs */
  strike?: number;
  /** Canonical leg intent — never inferred from ticker alone */
  legIntent: DraftLegIntent;
  /** Leg-level ratio (e.g., 1 for standard, 2 for backspread) */
  ratio: number;
  /** Number of shares (equity) or contracts (options) for this leg */
  quantity: number;
  /** Quote reference at draft creation time */
  quoteReference?: DraftLegQuote;
}

// ─────────────────────────────────────────────────────────────────────────────
// QUANTITY CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Explicit quantity context for the order draft.
 *
 * IMPORTANT: Hypothetical scenario sizes from Trade Plan research are NEVER
 * automatically used as order quantities. The user must provide an explicit
 * order quantity. The hypothetical size is carried here for reference only.
 */
export interface DraftQuantityContext {
  /** User-confirmed explicit quantity for this draft. Always > 0. */
  confirmedQuantity: number;
  /** Unit: "shares" for equity, "contracts" for options */
  unit: "shares" | "contracts";
  /** Hypothetical quantity from Trade Plan research (reference only, not authoritative) */
  hypotheticalPlanQuantity: number | null;
  /** Whether fractional shares are supported for this provider/account */
  fractionalSupported: boolean;
  /** Whether quantity requires user re-confirmation */
  requiresExplicitConfirmation: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICING CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pricing preferences and references for the order draft.
 * No auto-optimization. No price chasing. No limit adjustment.
 */
export interface DraftPricingContext {
  orderType: DraftOrderType;
  /** User-specified limit price (only when orderType = LIMIT) */
  limitPriceReference?: number;
  limitPriceSource?: DraftLimitPriceSource;
  /** Whether market order warning was generated */
  marketOrderWarningGenerated: boolean;
  /** Extended hours: defaults false. Only if provider supports and user selects. */
  extendedHoursRequested: boolean;
  extendedHoursSupported: boolean;
  /** Rounding applied to limit price (provider-specific precision) */
  priceRoundingApplied: boolean;
  priceRoundingNote?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIME IN FORCE CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

export interface DraftTimeInForceContext {
  timeInForce: DraftTimeInForce;
  /** Whether this TIF is confirmed valid for this provider/instrument */
  supported: boolean;
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPITAL CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimated capital context.
 * All values are ESTIMATES based on draft quote references.
 * Broker buying power remains authoritative at execution time.
 * Do not label any value as "required cash" without broker confirmation.
 */
export interface DraftCapitalContext {
  /** Estimated order notional (equity: qty × ref price) */
  estimatedNotional?: number;
  /** Estimated debit (options net: sum of long premiums - short premiums) */
  estimatedDebit?: number;
  /** Estimated credit (for net-credit strategies) */
  estimatedCredit?: number;
  /** Estimated cash-secured capital (for CSP) */
  estimatedCashSecured?: number;
  /** Estimated defined-risk capital (for defined-risk spreads) */
  estimatedDefinedRisk?: number;
  currency: string;
  estimateNote: string; // "Estimated. Broker buying power is authoritative."
}

// ─────────────────────────────────────────────────────────────────────────────
// RISK CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Risk context carried from the Trade Plan's saved riskSnapshot.
 * Not recalculated here. Future preview uses authoritative Risk Analysis.
 */
export interface DraftRiskContext {
  maxLoss: Record<string, unknown> | null;
  maxGain: Record<string, unknown> | null;
  breakevens: Record<string, unknown>[];
  capitalProfile: Record<string, unknown> | null;
  riskFlags: string[];
  constraintStatus: string;
  riskAnalysisId: string | null;
  /** Whether coverage/cash validation passed in preflight */
  coverageValidated: boolean;
  coverageNote?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// FRESHNESS INFO
// ─────────────────────────────────────────────────────────────────────────────

export interface DraftFreshnessInfo {
  preflightAge: number; // seconds
  quoteAge: number; // seconds
  lifecycleAge: number; // seconds
  overallFreshness: "FRESH" | "AGING" | "STALE";
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION MODEL
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderDraftValidation {
  valid: boolean;
  planValid: boolean;
  preflightValid: boolean;
  lifecycleValid: boolean;
  accountValid: boolean;
  quoteValid: boolean;
  quantityValid: boolean;
  structureValid: boolean;
  orderTypeSupported: boolean;
  timeInForceSupported: boolean;
  priceValid: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCKERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical order preparation blocker codes.
 * No recommendation semantics.
 */
export type OrderDraftBlockerCode =
  | "PREFLIGHT_MISSING"
  | "PREFLIGHT_EXPIRED"
  | "PREFLIGHT_NOT_PASSING"
  | "TRADE_PLAN_VERSION_CHANGED"
  | "LIFECYCLE_CHANGED"
  | "QUOTE_STALE"
  | "ACCOUNT_CHANGED"
  | "ACCOUNT_UNAVAILABLE"
  | "QUANTITY_REQUIRED"
  | "INVALID_QUANTITY"
  | "ORDER_TYPE_UNSUPPORTED"
  | "TIF_UNSUPPORTED"
  | "LIMIT_PRICE_REQUIRED"
  | "INVALID_LIMIT_PRICE"
  | "STRUCTURE_INVALID"
  | "CONTRACT_UNAVAILABLE"
  | "COVERAGE_NO_LONGER_VALID"
  | "BUYING_POWER_CHANGED"
  | "EXECUTION_DISABLED"
  | "TRADE_PLAN_NOT_FOUND"
  | "TRADE_PLAN_ARCHIVED"
  | "ORDER_PREPARATION_DISABLED";

export interface OrderDraftBlocker {
  code: OrderDraftBlockerCode;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// WARNINGS
// ─────────────────────────────────────────────────────────────────────────────

export type OrderDraftWarningCode =
  | "MARKET_ORDER_PRICE_UNCERTAINTY"
  | "WIDE_SPREAD"
  | "MARKET_CLOSED"
  | "EARNINGS_WINDOW"
  | "EXPIRATION_APPROACHING"
  | "LIMIT_REFERENCE_NEAR_BID"
  | "LIMIT_REFERENCE_NEAR_ASK"
  | "DATA_REFRESH_SOON";

export interface OrderDraftWarning {
  code: OrderDraftWarningCode;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL ORDER DRAFT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical OrderDraft — Sprint 2.8.1.
 *
 * NON-EXECUTABLE. The `executable: false` literal type is a type-level guard.
 * This type cannot satisfy a future BrokerSubmissionRequest interface.
 *
 * An OrderDraft describes what a future broker order COULD contain if
 * the user later proceeds through the full execution pipeline
 * (preflight → order prep → preview → explicit confirmation → submission).
 *
 * The existence of an OrderDraft must never cause broker mutation.
 */
export interface OrderDraft {
  /** Type-level non-executable guard. ALWAYS false. Never remove. */
  readonly executable: false;

  id: string;
  userId: string;
  tradePlanId: string;
  tradePlanVersion: number;
  preflightId: string;

  brokerProvider: string;
  brokerAccountRef: string;
  /** Display-safe masked ID only */
  brokerAccountMasked: string;
  brokerAccountType: BrokerAccountType;

  instrumentType: DraftInstrumentType;
  /** e.g. "equity_long", "long_call", "bull_call_spread", "covered_call" */
  structureType: string;

  /** Equity side intent (equity plans only) */
  sideIntent?: DraftSideIntent;

  status: OrderDraftStatus;
  executionMode: ExecutionMode;

  legs: OrderDraftLeg[];

  quantityContext: DraftQuantityContext;
  pricingContext: DraftPricingContext;
  timeInForceContext: DraftTimeInForceContext;

  capitalContext: DraftCapitalContext;
  riskContext: DraftRiskContext;

  quoteSnapshot: DraftQuoteSnapshot;
  freshness: DraftFreshnessInfo;
  marketHoursContext: DraftMarketHoursContext;

  validation: OrderDraftValidation;
  warnings: OrderDraftWarning[];
  blockers: OrderDraftBlocker[];

  /** Deterministic fingerprint: changes when any user-editable order parameter changes */
  preparationFingerprint: string;
  /** Increments each time user-editable preferences change */
  version: number;

  createdAt: string;  // ISO 8601
  updatedAt: string;  // ISO 8601
  /** Draft expires after this time. User must regenerate. */
  expiresAt: string;  // ISO 8601

  methodologyVersion: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT INPUT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User order preferences — the ONLY client-mutable fields.
 *
 * Client MUST NOT submit: symbol, contract legs, option strike, expiration,
 * quote, market price, research score, risk analysis, buying power,
 * broker capabilities. Those come from server.
 */
export interface OrderPreparationPreferences {
  /** Explicit user-selected quantity (shares for equity, contracts for options). > 0. */
  quantity: number;
  orderTypePreference: DraftOrderType;
  timeInForcePreference: DraftTimeInForce;
  /** Only required/allowed when orderTypePreference = LIMIT */
  limitPricePreference?: number;
  limitPriceSource?: DraftLimitPriceSource;
  /** Defaults false. Only honored if provider supports. */
  allowExtendedHours?: boolean;
}

/**
 * Full create draft request from client.
 * Server validates all fields. Client cannot inject authoritative market data.
 */
export interface CreateOrderDraftRequest {
  tradePlanId: string;
  preflightId: string;
  preferences: OrderPreparationPreferences;
}

/**
 * Update draft request — only editable preference fields.
 * Cannot change: symbol, strategy, contracts, legs, broker, account.
 */
export interface UpdateOrderDraftRequest {
  preferences: OrderPreparationPreferences;
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDOFF TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handoff contract to Sprint 2.8.2 (Equity Order Preview)
 * and Sprint 2.8.3 (Options / Multi-Leg Order Preview).
 *
 * Preview may show broker-like representation but still must NOT submit.
 * Preview will revalidate freshness before displaying.
 */
export interface OrderPreviewInput {
  orderDraftId: string;
  tradePlanId: string;
  preflightId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT EVENT TYPES (extends execution-types.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Order-preparation-specific audit event types for Sprint 2.8.1.
 * These extend the ExecutionAuditEventType union.
 * ORDER_SUBMITTED is explicitly EXCLUDED — belongs to Sprint 2.8.5.
 */
export type OrderDraftAuditEventType =
  | "ORDER_DRAFT_STARTED"
  | "ORDER_DRAFT_CREATED"
  | "ORDER_DRAFT_UPDATED"
  | "ORDER_DRAFT_INVALIDATED"
  | "ORDER_DRAFT_EXPIRED"
  | "ORDER_DRAFT_ABANDONED";
// Never: ORDER_SUBMITTED from Sprint 2.8.1

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM HEALTH
// ─────────────────────────────────────────────────────────────────────────────

export type OrderPreparationHealthState =
  | "HEALTHY"
  | "DEGRADED"
  | "DISABLED"
  | "UNKNOWN";

export interface OrderPreparationHealthSummary {
  state: OrderPreparationHealthState;
  orderPreparationEnabled: boolean;
  brokerSubmissionEnabled: boolean;
  draftsCreated: number;
  activeDrafts: number;
  expiredDrafts: number;
  invalidDrafts: number;
  abandonedDrafts: number;
  draftCreationFailures: number;
  averageDraftLatencyMs: number;
  lastDraftCreatedAt?: string; // ISO 8601
  checkedAt: string; // ISO 8601
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical Order Preparation disclaimer.
 * Must appear in every OrderDraft response to users.
 */
export const ORDER_PREPARATION_DISCLAIMER =
  "Order Preparation converts a user-selected Trade Plan into a non-executable " +
  "order draft for review. It does not submit an order, guarantee execution, " +
  "or constitute investment advice, a recommendation, or a suitability determination.";

/**
 * Persistent non-execution banner text.
 * Must be prominently displayed wherever an OrderDraft is shown.
 */
export const ORDER_DRAFT_NON_EXECUTION_BANNER =
  "Order Draft Only — Nothing has been submitted to your broker.";

/**
 * Market order price uncertainty warning.
 * Required whenever orderType = MARKET.
 */
export const MARKET_ORDER_WARNING =
  "Market orders do not guarantee an execution price. The final execution " +
  "price may differ from currently displayed quotes.";

/**
 * Quote reference warning.
 * Must appear wherever quotes are displayed in an order draft.
 */
export const DRAFT_QUOTE_WARNING =
  "Quotes shown are references used to prepare this draft. Quotes can change " +
  "before any future order is submitted.";

/**
 * Order Preparation feature flag.
 * When ORDER_PREPARATION_ENABLED=false, draft creation is disabled.
 * BROKER_EXECUTION_ENABLED continues to control actual order submission separately.
 */
export const ORDER_PREPARATION_ENABLED_DEFAULT = true;

/**
 * Draft expiry: 15 minutes from creation.
 * User must regenerate after expiry.
 */
export const ORDER_DRAFT_EXPIRY_SECONDS = 900;

/**
 * Methodology version for Sprint 2.8.1.
 */
export const ORDER_PREPARATION_METHODOLOGY_VERSION = "2.8.1";

/**
 * Forbidden phrases in Order Preparation UI and API.
 * Extends EXECUTION_FORBIDDEN_PHRASES.
 */
export const ORDER_PREPARATION_FORBIDDEN_PHRASES = [
  "Confirm Order",
  "Confirm Trade",
  "Final Confirmation",
  "Place Trade",
  "Submit Order",
  "Submit",
  "Execute",
  "Execute Now",
  "Trade Approved",
  "Approved Trade",
  "Ready to Trade",
  "Safe to Trade",
  "Recommended Order",
  "Guaranteed Fill",
  "Guaranteed Execution",
  "Order Submitted",
  "Filled",
  "Buy Now",
  "Sell Now",
] as const;
