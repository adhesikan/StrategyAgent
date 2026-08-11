/**
 * server/services/order-confirmation-service.ts — Sprint 2.8.5
 *
 * Pure deterministic engine for Review, Consent & Final Order Confirmation.
 *
 * PERMANENT INVARIANTS:
 *   - No LLM calls, ever.
 *   - No broker submission, ever. brokerSubmissionEnabled: false is a compile-time constant.
 *   - Confirmation is cryptographically bound to the exact snapshot hash reviewed.
 *   - A changed preview or changed readiness result always invalidates the snapshot.
 *   - BLOCKED readiness → no snapshot created.
 *   - Client-injected userId, snapshotHash, broker state → always rejected before reaching here.
 *   - Snapshot is immutable once created — never mutate legs, pricing, or readiness in-place.
 *   - Missing max profit/loss → null (never fabricated).
 */

import crypto from "crypto";
import type { OptionsOrderPreview, OptionsPreviewLeg } from "../../shared/options-order-preview-types";
import type { ExecutionReadinessResult } from "../../shared/execution-readiness-types";
import {
  BROKER_SUBMISSION_ENABLED,
  DEFAULT_FINAL_REVIEW_CONFIG,
  ACKNOWLEDGEMENT_DEFINITIONS,
  ACK_REVIEWED_ORDER,
  ACK_OPTIONS_RISK,
  ACK_SHORT_ASSIGNMENT,
  ACK_ZERO_DTE,
  ACK_DEFINED_RISK_ESTIMATE,
  ACK_BUYING_POWER_ESTIMATE,
  ACK_MARKET_CLOSED,
  ACK_NEAR_EXPIRATION,
  ACK_MULTI_LEG,
  FEES_DISCLAIMER,
  FINAL_REVIEW_DISCLAIMER,
  CR_BLOCKED_NOT_ELIGIBLE,
  CR_NO_READINESS,
  CR_SNAPSHOT_EXPIRED,
  CR_SNAPSHOT_INVALIDATED,
  CR_CONFIRMATION_REVIEW_REQUIRED,
  CR_READINESS_NOW_BLOCKED,
  CR_PREVIEW_CHANGED,
  CR_PRICING_CHANGED,
  CR_MARKET_DATA_STALE,
  CR_ALREADY_CONFIRMED,
} from "../../shared/order-confirmation-types";
import type {
  FinalOrderReviewSnapshot,
  FinalOrderReviewLeg,
  FinalOrderEconomics,
  OrderAcknowledgement,
  OrderConfirmation,
  OrderConfirmationAuditEvent,
  OrderConfirmationAuditEventType,
  FinalReviewConfig,
} from "../../shared/order-confirmation-types";
import { isShortIntent } from "./execution-readiness-service";

// ─────────────────────────────────────────────────────────────────────────────
// BROKER SUBMISSION SAFETY
// ─────────────────────────────────────────────────────────────────────────────

/** Compile-time proof that this module never enables broker submission. */
const _SUBMISSION_SAFETY_CHECK: false = BROKER_SUBMISSION_ENABLED;
void _SUBMISSION_SAFETY_CHECK;

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL HASH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sort object keys recursively for deterministic JSON serialization.
 * Arrays preserve order; object keys are sorted alphabetically.
 */
function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortObjectKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Compute the canonical business payload (volatile fields excluded). */
export function computeCanonicalPayload(snapshot: Pick<FinalOrderReviewSnapshot,
  "tradePlanId" | "orderPreviewId" | "executionReadinessId" | "userId" |
  "strategyFamily" | "symbol" | "legs" | "quantity" | "pricing" | "economics" |
  "readiness" | "marketDataObservedAt" | "reviewedDataVersion"
>): unknown {
  return sortObjectKeys({
    tradePlanId: snapshot.tradePlanId,
    orderPreviewId: snapshot.orderPreviewId,
    executionReadinessId: snapshot.executionReadinessId,
    userId: snapshot.userId,
    strategyFamily: snapshot.strategyFamily,
    symbol: snapshot.symbol,
    legs: snapshot.legs,
    quantity: snapshot.quantity,
    pricing: snapshot.pricing,
    economics: snapshot.economics,
    readiness: snapshot.readiness,
    marketDataObservedAt: snapshot.marketDataObservedAt,
    reviewedDataVersion: snapshot.reviewedDataVersion,
  });
}

/** Deterministic SHA-256 hash of the canonical business payload. */
export function computeSnapshotHash(payload: unknown): string {
  const canonical = JSON.stringify(sortObjectKeys(payload));
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// LEG CONVERSION
// ─────────────────────────────────────────────────────────────────────────────

export function buildFinalOrderReviewLeg(leg: OptionsPreviewLeg): FinalOrderReviewLeg {
  const isShort = isShortIntent(leg.canonicalIntent);
  return {
    legIndex: leg.legIndex,
    contractSymbol: leg.contractSymbol,
    optionType: leg.optionType,
    direction: isShort ? "SHORT" : "LONG",
    expiration: leg.expiration,
    dte: leg.dte,
    strike: leg.strike,
    quantity: leg.quantity,
    multiplier: leg.multiplier,
    canonicalIntent: leg.canonicalIntent,
    currentMidpoint: leg.currentQuote?.midpoint ?? null,
    limitPriceContribution: leg.currentQuote?.midpoint ?? null,
    isExpired: leg.isExpired,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ECONOMICS
// ─────────────────────────────────────────────────────────────────────────────

export function buildFinalEconomics(
  preview: OptionsOrderPreview,
  readiness: ExecutionReadinessResult,
): FinalOrderEconomics {
  // Prefer values from the preview risk context
  const riskCtx = preview.riskContext;
  const capitalFromReadiness = readiness.capitalEstimate?.estimatedRequirementUsd ?? null;

  const estimatedCapitalRequired =
    capitalFromReadiness !== null ? capitalFromReadiness : null;
  const capitalSource: FinalOrderEconomics["capitalSource"] =
    capitalFromReadiness !== null ? "readiness_estimate" : "unavailable";

  // Max loss for debit strategies = total debit paid
  const pricing = preview.netStructurePricing;
  let estimatedMaxLoss: number | null = null;
  let lossSource: FinalOrderEconomics["lossSource"] = "unavailable";
  let estimatedMaxProfit: number | null = null;
  let profitSource: FinalOrderEconomics["profitSource"] = "unavailable";

  if (riskCtx.maxLoss !== null && riskCtx.maxLoss !== undefined) {
    estimatedMaxLoss = Math.abs(riskCtx.maxLoss);
    lossSource = "calculated";
  } else if (pricing.pricingType === "DEBIT" && pricing.totalAmount !== null) {
    estimatedMaxLoss = Math.abs(pricing.totalAmount);
    lossSource = "calculated";
  } else if (capitalFromReadiness !== null && pricing.pricingType === "DEBIT") {
    estimatedMaxLoss = capitalFromReadiness;
    lossSource = "readiness_estimate";
  }

  if (riskCtx.maxGain !== null && riskCtx.maxGain !== undefined) {
    estimatedMaxProfit = Math.abs(riskCtx.maxGain);
    profitSource = "calculated";
  }

  const breakEvenPoints: number[] = Array.isArray(riskCtx.breakevens)
    ? riskCtx.breakevens.filter((b: unknown) => typeof b === "number")
    : [];

  return {
    estimatedMaxProfit,
    estimatedMaxLoss,
    estimatedCapitalRequired,
    breakEvenPoints,
    capitalSource,
    profitSource,
    lossSource,
    feesDisclaimer: FEES_DISCLAIMER,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACKNOWLEDGEMENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministically compute required acknowledgements from order structure.
 * No LLM involvement.
 */
export function determineRequiredAcknowledgements(
  preview: OptionsOrderPreview,
  readiness: ExecutionReadinessResult,
): OrderAcknowledgement[] {
  const codes = new Set<string>();

  // Always required for any options order
  codes.add(ACK_REVIEWED_ORDER);
  codes.add(ACK_OPTIONS_RISK);

  // Short leg → assignment risk
  const hasShortLeg = preview.legs.some(l => isShortIntent(l.canonicalIntent));
  if (hasShortLeg) codes.add(ACK_SHORT_ASSIGNMENT);

  // 0DTE
  const hasZeroDte = preview.legs.some(l => l.dte === 0 && !l.isExpired);
  if (hasZeroDte) codes.add(ACK_ZERO_DTE);

  // Near expiration (1 day, non-0DTE)
  const hasNearExpiration = preview.legs.some(l => l.dte > 0 && l.dte <= 2);
  if (hasNearExpiration) codes.add(ACK_NEAR_EXPIRATION);

  // Defined-risk spread → estimate ack
  const definedRiskFamilies = new Set([
    "bull_call_spread", "bear_put_spread", "bull_put_spread", "bear_call_spread",
    "iron_condor", "iron_butterfly", "collar",
  ]);
  if (definedRiskFamilies.has(preview.strategyFamily as string)) {
    codes.add(ACK_DEFINED_RISK_ESTIMATE);
  }

  // Capital estimate present → buying power ack
  if (readiness.capitalEstimate !== null) {
    codes.add(ACK_BUYING_POWER_ESTIMATE);
  }

  // Multi-leg order
  if (preview.instrumentType === "MULTI_LEG_OPTION") {
    codes.add(ACK_MULTI_LEG);
  }

  // Market closed warning present in findings
  const hasMarketClosedWarning = readiness.findings.some(f => f.code === "MARKET_CLOSED_WARNING");
  if (hasMarketClosedWarning) codes.add(ACK_MARKET_CLOSED);

  return Array.from(codes).map(code => ({
    code,
    required: ACKNOWLEDGEMENT_DEFINITIONS[code]?.required ?? true,
    title: ACKNOWLEDGEMENT_DEFINITIONS[code]?.title ?? code,
    text: ACKNOWLEDGEMENT_DEFINITIONS[code]?.text ?? "",
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// SNAPSHOT ELIGIBILITY
// ─────────────────────────────────────────────────────────────────────────────

export function validateSnapshotEligibility(
  readiness: ExecutionReadinessResult | null,
): { eligible: boolean; errorCode?: string; errorMessage?: string } {
  if (!readiness) {
    return { eligible: false, errorCode: CR_NO_READINESS, errorMessage: "No execution readiness result found. Run readiness check first." };
  }
  if (readiness.status === "BLOCKED") {
    return {
      eligible: false,
      errorCode: CR_BLOCKED_NOT_ELIGIBLE,
      errorMessage: "Execution readiness is BLOCKED. Resolve all blockers before creating a review snapshot.",
    };
  }
  return { eligible: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// SNAPSHOT REVALIDATION (server-side before confirm)
// ─────────────────────────────────────────────────────────────────────────────

export interface RevalidationResult {
  valid: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export function revalidateBeforeConfirm(
  snapshot: FinalOrderReviewSnapshot,
  currentReadiness: ExecutionReadinessResult | null,
  currentPreview: OptionsOrderPreview | null,
  now: Date,
  config: FinalReviewConfig = DEFAULT_FINAL_REVIEW_CONFIG,
): RevalidationResult {
  // 1. Not expired
  if (snapshot.state === "EXPIRED" || new Date(snapshot.expiresAt) <= now) {
    return { valid: false, errorCode: CR_SNAPSHOT_EXPIRED, errorMessage: "Review snapshot has expired. Please create a new review." };
  }

  // 2. Not invalidated
  if (snapshot.state === "INVALIDATED") {
    return { valid: false, errorCode: CR_SNAPSHOT_INVALIDATED, errorMessage: `Review snapshot was invalidated: ${snapshot.invalidationReason ?? "order changed"}. Please create a new review.` };
  }

  // 3. Readiness still not BLOCKED
  if (!currentReadiness || currentReadiness.status === "BLOCKED") {
    return { valid: false, errorCode: CR_READINESS_NOW_BLOCKED, errorMessage: "Execution readiness is now BLOCKED. Resolve blockers and create a new review." };
  }

  // 4. Readiness result ID unchanged (same evaluation was used)
  if (currentReadiness.id !== snapshot.executionReadinessId) {
    return { valid: false, errorCode: CR_CONFIRMATION_REVIEW_REQUIRED, errorMessage: "Execution readiness result has changed. Please create a new review snapshot." };
  }

  // 5. Preview unchanged
  if (currentPreview && currentPreview.id !== snapshot.orderPreviewId) {
    return { valid: false, errorCode: CR_PREVIEW_CHANGED, errorMessage: "Order preview has been regenerated. Please create a new review snapshot." };
  }

  // 6. Pricing unchanged (conservative: any change invalidates)
  if (currentPreview) {
    const currentNetPrice = currentPreview.netStructurePricing.amountPerUnit;
    const snapshotNetPrice = snapshot.pricing.netPrice;
    if (
      snapshotNetPrice !== null &&
      currentNetPrice !== null &&
      currentNetPrice !== undefined &&
      Math.abs((currentNetPrice - snapshotNetPrice) / Math.max(Math.abs(snapshotNetPrice), 0.01)) > config.netPriceTolerance
    ) {
      return { valid: false, errorCode: CR_PRICING_CHANGED, errorMessage: "Pricing has changed since review. Please create a new review snapshot." };
    }
  }

  // 7. Quote freshness still acceptable
  if (currentPreview && (currentPreview.quoteFreshness.anyStale || currentPreview.quoteFreshness.aggregateFreshnessCategory === "UNAVAILABLE")) {
    return { valid: false, errorCode: CR_MARKET_DATA_STALE, errorMessage: "Market data is stale. Refresh quotes and create a new review." };
  }

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACKNOWLEDGEMENT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

export function checkAllRequiredAcknowledgementsPresent(
  submittedCodes: string[],
  requiredAcknowledgements: OrderAcknowledgement[],
): { valid: boolean; missing: string[] } {
  const submitted = new Set(submittedCodes);
  const missing = requiredAcknowledgements
    .filter(a => a.required && !submitted.has(a.code))
    .map(a => a.code);
  return { valid: missing.length === 0, missing };
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────────

export function buildFinalOrderReviewSnapshot(
  preview: OptionsOrderPreview,
  readiness: ExecutionReadinessResult,
  userId: string,
  tradePlanId: string,
  config: FinalReviewConfig = DEFAULT_FINAL_REVIEW_CONFIG,
  now: Date = new Date(),
): FinalOrderReviewSnapshot {
  const id = crypto.randomUUID();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + config.snapshotTtlSeconds * 1000).toISOString();

  const legs: FinalOrderReviewLeg[] = preview.legs.map(buildFinalOrderReviewLeg);
  const economics = buildFinalEconomics(preview, readiness);
  const acknowledgements = determineRequiredAcknowledgements(preview, readiness);

  const pricing = {
    pricingType: preview.netStructurePricing.pricingType as "DEBIT" | "CREDIT" | "EVEN" | "UNKNOWN",
    netPrice: preview.netStructurePricing.amountPerUnit,
    limitPrice: preview.netStructurePricing.amountPerUnit, // limit = midpoint net for v1
    estimatedNotional: preview.netStructurePricing.totalAmount,
    multiplier: preview.netStructurePricing.multiplier,
  };

  const readinessRef = {
    status: readiness.status as "READY" | "READY_WITH_WARNINGS",
    blockerCount: readiness.blockerCount,
    warningCount: readiness.warningCount,
    findingCodes: readiness.findings.map(f => f.code),
  };

  const marketDataObservedAt = preview.quoteFreshness?.newestQuoteTime ?? preview.generatedAt ?? null;

  // Build canonical payload (volatile fields excluded from hash)
  const canonicalPayload = computeCanonicalPayload({
    tradePlanId,
    orderPreviewId: preview.id,
    executionReadinessId: readiness.id,
    userId,
    strategyFamily: preview.strategyFamily as string,
    symbol: preview.symbol,
    legs,
    quantity: preview.quantityContext.confirmedQuantity,
    pricing,
    economics,
    readiness: readinessRef,
    marketDataObservedAt,
    reviewedDataVersion: config.reviewedDataVersion,
  });

  const snapshotHash = computeSnapshotHash(canonicalPayload);

  return {
    id,
    tradePlanId,
    orderPreviewId: preview.id,
    executionReadinessId: readiness.id,
    userId,
    strategyFamily: preview.strategyFamily as string,
    strategyLabel: preview.strategyLabel ?? (preview.strategyFamily as string),
    symbol: preview.symbol,
    companyName: preview.companyName ?? null,
    legs,
    quantity: preview.quantityContext.confirmedQuantity,
    pricing,
    economics,
    readiness: readinessRef,
    acknowledgements,
    marketDataObservedAt,
    reviewedDataVersion: config.reviewedDataVersion,
    snapshotHash,
    state: "CREATED",
    createdAt,
    expiresAt,
    invalidatedAt: null,
    invalidationReason: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureOrderConfirmationTables(): Promise<void> {
  const { pool } = await import("../db");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS final_order_review_snapshots (
      id VARCHAR PRIMARY KEY,
      trade_plan_id VARCHAR NOT NULL,
      order_preview_id VARCHAR NOT NULL,
      execution_readiness_id VARCHAR NOT NULL,
      user_id VARCHAR NOT NULL,
      snapshot_json JSONB NOT NULL,
      snapshot_hash VARCHAR NOT NULL,
      state VARCHAR NOT NULL DEFAULT 'CREATED',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      invalidated_at TIMESTAMPTZ,
      invalidation_reason TEXT
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fors_trade_plan_user
      ON final_order_review_snapshots(trade_plan_id, user_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_confirmations (
      id VARCHAR PRIMARY KEY,
      snapshot_id VARCHAR NOT NULL,
      user_id VARCHAR NOT NULL,
      snapshot_hash VARCHAR NOT NULL,
      acknowledgement_codes JSONB NOT NULL,
      confirmed_at TIMESTAMPTZ NOT NULL,
      ip_metadata VARCHAR,
      user_agent_metadata VARCHAR,
      UNIQUE (snapshot_id, user_id)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_oc_snapshot_user
      ON order_confirmations(snapshot_id, user_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_confirmation_audit_events (
      id VARCHAR PRIMARY KEY,
      trade_plan_id VARCHAR,
      snapshot_id VARCHAR,
      user_id VARCHAR NOT NULL,
      event_type VARCHAR NOT NULL,
      event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      snapshot_hash VARCHAR,
      metadata JSONB
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ocae_trade_plan
      ON order_confirmation_audit_events(trade_plan_id);
  `);
}

export async function persistSnapshot(snapshot: FinalOrderReviewSnapshot): Promise<void> {
  const { pool } = await import("../db");
  await pool.query(
    `INSERT INTO final_order_review_snapshots
       (id, trade_plan_id, order_preview_id, execution_readiness_id, user_id,
        snapshot_json, snapshot_hash, state, created_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
     ON CONFLICT (id) DO NOTHING`,
    [
      snapshot.id,
      snapshot.tradePlanId,
      snapshot.orderPreviewId,
      snapshot.executionReadinessId,
      snapshot.userId,
      JSON.stringify(snapshot),
      snapshot.snapshotHash,
      snapshot.state,
      snapshot.createdAt,
      snapshot.expiresAt,
    ]
  );
}

export async function getLatestSnapshot(
  tradePlanId: string,
  userId: string,
): Promise<FinalOrderReviewSnapshot | null> {
  const { pool } = await import("../db");
  const res = await pool.query(
    `SELECT snapshot_json, state, invalidated_at, invalidation_reason
     FROM final_order_review_snapshots
     WHERE trade_plan_id = $1 AND user_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [tradePlanId, userId]
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  const snap = row.snapshot_json as FinalOrderReviewSnapshot;
  snap.state = row.state;
  if (row.invalidated_at) snap.invalidatedAt = row.invalidated_at;
  if (row.invalidation_reason) snap.invalidationReason = row.invalidation_reason;
  return snap;
}

export async function getSnapshotById(
  snapshotId: string,
  userId: string,
): Promise<FinalOrderReviewSnapshot | null> {
  const { pool } = await import("../db");
  const res = await pool.query(
    `SELECT snapshot_json, state, invalidated_at, invalidation_reason
     FROM final_order_review_snapshots
     WHERE id = $1 AND user_id = $2`,
    [snapshotId, userId]
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  const snap = row.snapshot_json as FinalOrderReviewSnapshot;
  snap.state = row.state;
  if (row.invalidated_at) snap.invalidatedAt = row.invalidated_at;
  if (row.invalidation_reason) snap.invalidationReason = row.invalidation_reason;
  return snap;
}

export async function invalidateExistingSnapshots(
  tradePlanId: string,
  userId: string,
  reason: string,
): Promise<void> {
  const { pool } = await import("../db");
  await pool.query(
    `UPDATE final_order_review_snapshots
     SET state = 'INVALIDATED', invalidated_at = now(), invalidation_reason = $3
     WHERE trade_plan_id = $1 AND user_id = $2
       AND state NOT IN ('CONFIRMED', 'INVALIDATED')`,
    [tradePlanId, userId, reason]
  );
}

export async function updateSnapshotState(
  snapshotId: string,
  state: string,
  invalidatedAt?: string,
  invalidationReason?: string,
): Promise<void> {
  const { pool } = await import("../db");
  await pool.query(
    `UPDATE final_order_review_snapshots
     SET state = $2, invalidated_at = $3, invalidation_reason = $4
     WHERE id = $1`,
    [snapshotId, state, invalidatedAt ?? null, invalidationReason ?? null]
  );
}

export async function getExistingConfirmation(
  snapshotId: string,
  userId: string,
): Promise<OrderConfirmation | null> {
  const { pool } = await import("../db");
  const res = await pool.query(
    `SELECT id, snapshot_id, user_id, snapshot_hash,
            acknowledgement_codes, confirmed_at, ip_metadata, user_agent_metadata
     FROM order_confirmations
     WHERE snapshot_id = $1 AND user_id = $2`,
    [snapshotId, userId]
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    userId: row.user_id,
    status: "CONFIRMED",
    acknowledgementCodes: Array.isArray(row.acknowledgement_codes) ? row.acknowledgement_codes : [],
    confirmedAt: row.confirmed_at,
    ipMetadata: row.ip_metadata ?? null,
    userAgentMetadata: row.user_agent_metadata ?? null,
    snapshotHash: row.snapshot_hash,
  };
}

export async function persistConfirmation(confirmation: OrderConfirmation): Promise<void> {
  const { pool } = await import("../db");
  await pool.query(
    `INSERT INTO order_confirmations
       (id, snapshot_id, user_id, snapshot_hash, acknowledgement_codes, confirmed_at, ip_metadata, user_agent_metadata)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
     ON CONFLICT (snapshot_id, user_id) DO NOTHING`,
    [
      confirmation.id,
      confirmation.snapshotId,
      confirmation.userId,
      confirmation.snapshotHash,
      JSON.stringify(confirmation.acknowledgementCodes),
      confirmation.confirmedAt,
      confirmation.ipMetadata,
      confirmation.userAgentMetadata,
    ]
  );
}

export async function persistAuditEvent(event: OrderConfirmationAuditEvent): Promise<void> {
  const { pool } = await import("../db");
  await pool.query(
    `INSERT INTO order_confirmation_audit_events
       (id, trade_plan_id, snapshot_id, user_id, event_type, event_at, snapshot_hash, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      event.id,
      event.tradePlanId,
      event.snapshotId,
      event.userId,
      event.eventType,
      event.eventAt,
      event.snapshotHash,
      event.metadata ? JSON.stringify(event.metadata) : null,
    ]
  );
}

/** Fire-and-forget audit log. Never blocks the response. Never logs secrets. */
export function logAuditEvent(
  eventType: OrderConfirmationAuditEventType,
  userId: string,
  tradePlanId: string | null,
  snapshotId: string | null,
  snapshotHash: string | null,
  metadata?: Record<string, unknown>,
): void {
  const event: OrderConfirmationAuditEvent = {
    id: crypto.randomUUID(),
    tradePlanId,
    snapshotId,
    userId,
    eventType,
    eventAt: new Date().toISOString(),
    snapshotHash,
    metadata: metadata ?? null,
  };
  persistAuditEvent(event).catch(e =>
    console.error("[order-confirmation] audit event failed:", e?.message)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────────────────────────────────────────

export function getOrderConfirmationHealth(): Record<string, unknown> {
  return {
    service: "order-confirmation",
    sprintVersion: "2.8.5",
    brokerSubmissionEnabled: false,
    schemaVersion: "1",
    disclaimer: FINAL_REVIEW_DISCLAIMER,
  };
}
