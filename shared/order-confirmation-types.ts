/**
 * shared/order-confirmation-types.ts — Sprint 2.8.5
 *
 * Canonical types for Review, Consent & Final Order Confirmation.
 *
 * PERMANENT INVARIANTS:
 *   - A confirmation is always cryptographically bound to the exact snapshot hash reviewed.
 *   - brokerSubmissionEnabled is always false — this sprint never submits orders.
 *   - No LLM involvement in snapshot creation, acknowledgement generation, or confirmation.
 *   - Client may NOT inject: userId, snapshotHash, readiness status, broker/account state.
 *   - Confirmation cannot survive a changed preview or changed readiness result.
 *   - BLOCKED readiness → no snapshot created.
 *
 * Confirmation lifecycle:
 *   CREATED → VIEWED → CONFIRMED
 *                    → EXPIRED        (TTL exceeded)
 *                    → INVALIDATED    (preview changed / readiness changed / trade plan changed)
 */

// ─────────────────────────────────────────────────────────────────────────────
// SNAPSHOT STATE
// ─────────────────────────────────────────────────────────────────────────────

export type FinalReviewSnapshotState =
  | "CREATED"
  | "VIEWED"
  | "CONFIRMED"
  | "EXPIRED"
  | "INVALIDATED";

// FORBIDDEN states (compliance — never use):
//   APPROVED, AUTHORIZED, RECOMMENDED, AI_CONFIRMED, PASS, GO, CLEARED, TRADE_APPROVED

// ─────────────────────────────────────────────────────────────────────────────
// ACKNOWLEDGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderAcknowledgement {
  code: string;
  required: boolean;
  title: string;
  text: string;
}

/** All supported acknowledgement codes. Stable identifiers — safe to store in audit records. */
export const ACK_REVIEWED_ORDER = "ACK_REVIEWED_ORDER";
export const ACK_OPTIONS_RISK = "ACK_OPTIONS_RISK";
export const ACK_SHORT_ASSIGNMENT = "ACK_SHORT_ASSIGNMENT";
export const ACK_ZERO_DTE = "ACK_ZERO_DTE";
export const ACK_DEFINED_RISK_ESTIMATE = "ACK_DEFINED_RISK_ESTIMATE";
export const ACK_BUYING_POWER_ESTIMATE = "ACK_BUYING_POWER_ESTIMATE";
export const ACK_MARKET_CLOSED = "ACK_MARKET_CLOSED";
export const ACK_NEAR_EXPIRATION = "ACK_NEAR_EXPIRATION";
export const ACK_MULTI_LEG = "ACK_MULTI_LEG";

export const ACKNOWLEDGEMENT_DEFINITIONS: Record<string, Omit<OrderAcknowledgement, "code">> = {
  [ACK_REVIEWED_ORDER]: {
    required: true,
    title: "Order Reviewed",
    text: "I have reviewed the order details, including the strategy, legs, pricing, and quantity.",
  },
  [ACK_OPTIONS_RISK]: {
    required: true,
    title: "Options Risk",
    text: "I understand that options involve risk and may expire worthless, resulting in loss of the premium paid.",
  },
  [ACK_SHORT_ASSIGNMENT]: {
    required: true,
    title: "Assignment Risk",
    text: "I understand that short option legs may be assigned before expiration, potentially requiring me to buy or deliver shares.",
  },
  [ACK_ZERO_DTE]: {
    required: true,
    title: "Same-Day Expiration",
    text: "I understand this option expires today and its value can change rapidly. It may expire worthless.",
  },
  [ACK_DEFINED_RISK_ESTIMATE]: {
    required: true,
    title: "Max Loss Estimate",
    text: "I understand the displayed max loss is an estimate based on the entered order terms and may differ due to execution, fees, assignment, or early exercise.",
  },
  [ACK_BUYING_POWER_ESTIMATE]: {
    required: true,
    title: "Capital Estimate",
    text: "I understand the displayed capital requirement is an estimate only. Actual margin and buying-power requirements are determined by my broker.",
  },
  [ACK_MARKET_CLOSED]: {
    required: false,
    title: "Market Conditions",
    text: "I understand I am reviewing this order outside regular market hours. Quote data may not reflect live conditions.",
  },
  [ACK_NEAR_EXPIRATION]: {
    required: false,
    title: "Near Expiration",
    text: "I understand this option is close to expiration and time decay will accelerate.",
  },
  [ACK_MULTI_LEG]: {
    required: false,
    title: "Multi-Leg Order",
    text: "I understand this is a multi-leg order and all legs are intended to be submitted as a single structure.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// FINAL ORDER REVIEW LEG
// ─────────────────────────────────────────────────────────────────────────────

export interface FinalOrderReviewLeg {
  legIndex: number;
  contractSymbol: string;
  optionType: "call" | "put";
  direction: "LONG" | "SHORT";
  expiration: string;
  dte: number;
  strike: number;
  quantity: number;
  multiplier: number;
  canonicalIntent: string;
  currentMidpoint: number | null;
  limitPriceContribution: number | null;
  isExpired: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// FINAL ECONOMICS
// ─────────────────────────────────────────────────────────────────────────────

export interface FinalOrderEconomics {
  estimatedMaxProfit: number | null;
  estimatedMaxLoss: number | null;
  estimatedCapitalRequired: number | null;
  breakEvenPoints: number[];
  capitalSource: "calculated" | "readiness_estimate" | "unavailable";
  profitSource: "calculated" | "unavailable";
  lossSource: "calculated" | "unavailable";
  feesDisclaimer: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// FINAL ORDER REVIEW SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────────

export interface FinalOrderReviewSnapshot {
  id: string;
  tradePlanId: string;
  orderPreviewId: string;
  executionReadinessId: string;
  userId: string;

  strategyFamily: string;
  strategyLabel: string;
  symbol: string;
  companyName: string | null;

  legs: FinalOrderReviewLeg[];
  quantity: number;

  pricing: {
    pricingType: "DEBIT" | "CREDIT" | "EVEN" | "UNKNOWN";
    netPrice: number | null;
    limitPrice: number | null;
    estimatedNotional: number | null;
    multiplier: number;
  };

  economics: FinalOrderEconomics;

  readiness: {
    status: "READY" | "READY_WITH_WARNINGS";
    blockerCount: number;
    warningCount: number;
    findingCodes: string[];
  };

  acknowledgements: OrderAcknowledgement[];

  marketDataObservedAt: string | null;
  reviewedDataVersion: string;

  snapshotHash: string;

  state: FinalReviewSnapshotState;
  createdAt: string;
  expiresAt: string;
  invalidatedAt: string | null;
  invalidationReason: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ORDER CONFIRMATION
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderConfirmation {
  id: string;
  snapshotId: string;
  userId: string;

  /** The state of the confirmation. Only CONFIRMED is valid — never APPROVED, AUTHORIZED, etc. */
  status: "CONFIRMED";

  acknowledgementCodes: string[];

  confirmedAt: string;

  /** Non-sensitive request metadata. Never full headers or tokens. */
  ipMetadata: string | null;
  userAgentMetadata: string | null;

  /** Hash of the snapshot at the time of confirmation. Immutable record. */
  snapshotHash: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT EVENTS
// ─────────────────────────────────────────────────────────────────────────────

export type OrderConfirmationAuditEventType =
  | "FINAL_REVIEW_CREATED"
  | "FINAL_REVIEW_VIEWED"
  | "FINAL_REVIEW_CONFIRMED"
  | "FINAL_REVIEW_EXPIRED"
  | "FINAL_REVIEW_INVALIDATED"
  | "ORDER_CONFIRMED";

export interface OrderConfirmationAuditEvent {
  id: string;
  tradePlanId: string | null;
  snapshotId: string | null;
  userId: string;
  eventType: OrderConfirmationAuditEventType;
  eventAt: string;
  snapshotHash: string | null;
  metadata: Record<string, unknown> | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export interface FinalReviewConfig {
  /** TTL in seconds for a snapshot to be confirmed. Default 120s. */
  snapshotTtlSeconds: number;
  /** Reviewed data version — bump when schema changes. */
  reviewedDataVersion: string;
  /** Maximum allowed delta between snapshot net price and current net price (0 = any change invalidates) */
  netPriceTolerance: number;
}

export const DEFAULT_FINAL_REVIEW_CONFIG: FinalReviewConfig = {
  snapshotTtlSeconds: 120,
  reviewedDataVersion: "1",
  netPriceTolerance: 0, // any change invalidates (conservative v1)
};

// ─────────────────────────────────────────────────────────────────────────────
// ERROR / STATUS CODES
// ─────────────────────────────────────────────────────────────────────────────

export const CR_BLOCKED_NOT_ELIGIBLE = "CR_BLOCKED_NOT_ELIGIBLE";
export const CR_NO_READINESS = "CR_NO_READINESS";
export const CR_NO_PREVIEW = "CR_NO_PREVIEW";
export const CR_SNAPSHOT_EXPIRED = "CR_SNAPSHOT_EXPIRED";
export const CR_SNAPSHOT_INVALIDATED = "CR_SNAPSHOT_INVALIDATED";
export const CR_SNAPSHOT_NOT_FOUND = "CR_SNAPSHOT_NOT_FOUND";
export const CR_MISSING_REQUIRED_ACK = "CR_MISSING_REQUIRED_ACK";
export const CR_CONFIRMATION_REVIEW_REQUIRED = "CR_CONFIRMATION_REVIEW_REQUIRED";
export const CR_HASH_MISMATCH = "CR_HASH_MISMATCH";
export const CR_OWNERSHIP_VIOLATION = "CR_OWNERSHIP_VIOLATION";
export const CR_FORBIDDEN_FIELD = "CR_FORBIDDEN_FIELD";
export const CR_READINESS_NOW_BLOCKED = "CR_READINESS_NOW_BLOCKED";
export const CR_PREVIEW_CHANGED = "CR_PREVIEW_CHANGED";
export const CR_PRICING_CHANGED = "CR_PRICING_CHANGED";
export const CR_MARKET_DATA_STALE = "CR_MARKET_DATA_STALE";
export const CR_ALREADY_CONFIRMED = "CR_ALREADY_CONFIRMED";

// ─────────────────────────────────────────────────────────────────────────────
// BROKER SUBMISSION INVARIANT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compile-time invariant: no broker submission in Sprint 2.8.5.
 * This literal type constant must never be changed to true.
 */
export const BROKER_SUBMISSION_ENABLED: false = false;

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE
// ─────────────────────────────────────────────────────────────────────────────

export const FORBIDDEN_CONFIRMATION_LABELS = [
  "APPROVED",
  "AUTHORIZED",
  "RECOMMENDED",
  "AI APPROVED",
  "TRADE APPROVED",
  "SAFE TRADE",
  "BEST TRADE",
  "AI AUTHORIZED",
  "AUTO CONFIRMED",
  "GUARANTEED",
  "EXECUTION AUTHORIZED",
];

export const FINAL_REVIEW_DISCLAIMER =
  "This confirmation does not submit an order to your broker. " +
  "Order placement is not yet enabled. " +
  "This is not investment advice. Options involve risk and are not appropriate for all investors.";

export const FEES_DISCLAIMER =
  "Broker fees, commissions, exchange fees, and regulatory fees may not be included in the estimated costs shown.";
