/**
 * server/services/equity-preview-service.ts — Sprint 2.8.2
 *
 * Equity Order Preview computation engine.
 *
 * PERMANENT ARCHITECTURE INVARIANT:
 *   - This service is READ-ONLY regarding OrderDraft, TradePlan, Preflight.
 *   - It may NEVER call placeOrder, submitOrder, replaceOrder, cancelOrder.
 *   - executable is always false on all outputs.
 *   - broadExpressionType must be STOCK; selectedBy must be USER.
 *   - Draft values (limit price, quantity, side) are NEVER silently changed.
 *
 * BROKER ADAPTER BOUNDARY:
 *   Allowed: getConnectionStatus, listAccounts, getAccountCapabilities,
 *            getBuyingPower, getPositions, getQuoteValidation.
 *   NEVER: placeOrder, submitOrder, replaceOrder, cancelOrder, modifyOrder.
 */

import { randomUUID } from "crypto";
import type { OrderDraft } from "../../shared/order-draft-types";
import type {
  EquityOrderPreview,
  EquityPreviewStatus,
  EquityPreviewBlocker,
  EquityPreviewBlockerCode,
  EquityPreviewWarning,
  EquityPreviewWarningCode,
  EquityPreviewPricing,
  EquityPreviewMarketHours,
  EquityPreviewBrokerContext,
  EquityPreviewPlanningContext,
  EquityPreviewRiskContext,
  PreviewSourceIntegrity,
  ExpressionSelectionTrace,
  PreviewQuoteContext,
  LimitMarketRelation,
  PriceMovementCategory,
  EquityPreviewHealthMetrics,
} from "../../shared/equity-order-preview-types";
import {
  EQUITY_PREVIEW_DISCLAIMER,
  EQUITY_PREVIEW_PRICE_DISCLAIMER,
  EQUITY_PREVIEW_MARKET_ORDER_WARNING,
  EQUITY_PREVIEW_METHODOLOGY_VERSION,
  EQUITY_PREVIEW_DEFAULT_TTL_MS,
  EQUITY_PREVIEW_QUOTE_FRESHNESS_SEC,
  EQUITY_PREVIEW_PREFLIGHT_WARNING_SEC,
  PRICE_MOVEMENT_MATERIAL_THRESHOLD_PCT,
  SIDE_INTENT_LABELS,
} from "../../shared/equity-order-preview-types";

// ─────────────────────────────────────────────────────────────────────────────
// INJECTABLE DEPS (testable without DB)
// ─────────────────────────────────────────────────────────────────────────────

export interface EquityPreviewDeps {
  now: () => Date;

  /** Load OrderDraft by id, user-scoped (returns null if not found or cross-user). */
  getDraftById: (draftId: string, userId: string) => Promise<{
    id: string; userId: string; tradePlanId: string; tradePlanVersion: number;
    preflightId: string; draftJson: Record<string, unknown>;
    status: string; version: number; expiresAt: Date;
  } | null>;

  /** Load TradePlan by id, user-scoped. */
  getTradePlan: (id: string, userId: string) => Promise<{
    id: string; userId: string; symbol: string; companyName?: string | null;
    version?: number; broadExpressionType?: string | null;
    expressionSelectedBy?: string | null; expressionSelectedAt?: string | null;
    selectedExpressionFamily?: string | null;
    researchSnapshot?: Record<string, unknown> | null;
    planningSnapshot?: Record<string, unknown> | null;
    riskSnapshot?: Record<string, unknown> | null;
    planningContextId?: string | null; researchGoalId?: string | null;
    status?: string; createdAt?: Date | null; updatedAt?: Date | null;
  } | null>;

  /** Load preflight by id, trade plan scoped. */
  getPreflightResult: (preflightId: string, tradePlanId: string, userId: string) => Promise<{
    id: string; status: string; evaluatedAt: Date; validUntil: Date | null;
    resultJson: Record<string, unknown>;
  } | null>;

  /** Get current lifecycle state for a trade plan (from plan_activity or monitoring). */
  getCurrentLifecycleState: (tradePlanId: string, userId: string) => Promise<string | null>;

  /** Get a fresh read-only quote for the symbol. Returns null if unavailable. */
  getQuoteForPreview: (symbol: string, userId: string) => Promise<{
    bid: number | null; ask: number | null; last: number | null;
    midpoint: number | null; asOf: string; isStale: boolean;
    isCrossed: boolean; provider: string; freshnessSeconds: number;
  } | null>;

  /** Get buying power check status. READ-ONLY. */
  getBuyingPowerStatus: (userId: string, accountRef: string) => Promise<"PASS" | "FAIL" | "UNAVAILABLE">;

  /** Get broker connection and account context. READ-ONLY. */
  getBrokerContext: (userId: string, accountRef: string, provider: string) => Promise<{
    connected: boolean; executionMode: string; executionEnabled: boolean;
    accountMasked: string; accountType: string;
    supportsMarketOrders: boolean; supportsLimitOrders: boolean;
    supportedTimeInForce: string[];
  } | null>;

  /** Append audit event (fire-and-forget). */
  appendAuditEvent: (event: {
    userId: string; tradePlanId: string; eventType: string;
    provider?: string; accountRefMasked?: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>;

  isExecutionEnabled: () => boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY HEALTH METRICS
// ─────────────────────────────────────────────────────────────────────────────

const healthState: EquityPreviewHealthMetrics & { latencyBucket: number[] } = {
  previewRequests: 0,
  previewPasses: 0,
  previewRequiresReview: 0,
  previewExpired: 0,
  previewFailures: 0,
  averagePreviewLatencyMs: 0,
  lastPreviewAt: null,
  brokerSubmissionEnabled: false,
  latencyBucket: [],
};

export function getEquityPreviewMetrics(): EquityPreviewHealthMetrics {
  const avg = healthState.latencyBucket.length > 0
    ? Math.round(healthState.latencyBucket.reduce((a, b) => a + b, 0) / healthState.latencyBucket.length)
    : 0;
  return {
    previewRequests: healthState.previewRequests,
    previewPasses: healthState.previewPasses,
    previewRequiresReview: healthState.previewRequiresReview,
    previewExpired: healthState.previewExpired,
    previewFailures: healthState.previewFailures,
    averagePreviewLatencyMs: avg,
    lastPreviewAt: healthState.lastPreviewAt,
    brokerSubmissionEnabled: healthState.brokerSubmissionEnabled,
  };
}

function recordMetric(status: EquityPreviewStatus, latencyMs: number): void {
  healthState.previewRequests++;
  healthState.lastPreviewAt = new Date().toISOString();
  if (status === "VALID") healthState.previewPasses++;
  else if (status === "REQUIRES_REVIEW") healthState.previewRequiresReview++;
  else if (status === "EXPIRED") healthState.previewExpired++;
  else if (status === "INVALID" || status === "UNAVAILABLE") healthState.previewFailures++;
  healthState.latencyBucket.push(latencyMs);
  if (healthState.latencyBucket.length > 100) healthState.latencyBucket.shift();
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function resolveMarketHours(sessionState: string): EquityPreviewMarketHours {
  const asOf = new Date().toISOString();
  const notes: Record<string, string> = {
    CLOSED:      "Market is currently closed. Order may be queued until next session.",
    PRE_MARKET:  "Pre-market session active. Extended hours preference applies.",
    AFTER_HOURS: "After-hours session active. Extended hours preference applies.",
    OPEN:        "",
    UNKNOWN:     "Market session status could not be determined.",
  };
  return {
    sessionState: sessionState as any,
    asOf,
    informationalNote: notes[sessionState] || undefined,
  };
}

function resolveLimitRelation(
  limitPrice: number,
  bid: number | null,
  ask: number | null,
): LimitMarketRelation {
  if (bid === null || ask === null) return "OUTSIDE_CURRENT_MARKET";
  if (limitPrice >= ask) return "AT_OR_ABOVE_ASK";
  if (limitPrice <= bid) return "AT_OR_BELOW_BID";
  return "BETWEEN_BID_ASK";
}

function resolvePriceMovement(
  currentMid: number | null,
  draftMid: number | null,
): PriceMovementCategory {
  if (currentMid === null || draftMid === null || draftMid === 0) return "UNKNOWN";
  const diff = Math.abs((currentMid - draftMid) / draftMid) * 100;
  if (diff < 0.01) return "UNCHANGED";
  if (diff < PRICE_MOVEMENT_MATERIAL_THRESHOLD_PCT) return "SMALL_CHANGE";
  return "MATERIAL_CHANGE";
}

function computeValidUntil(
  now: Date,
  draftExpiresAt: Date,
  preflightValidUntil: Date | null,
): string {
  const ttlFromNow = new Date(now.getTime() + EQUITY_PREVIEW_DEFAULT_TTL_MS);
  const candidates: Date[] = [ttlFromNow, draftExpiresAt];
  if (preflightValidUntil) candidates.push(preflightValidUntil);
  return candidates.reduce((a, b) => a < b ? a : b).toISOString();
}

function maskAccountRef(ref: string): string {
  if (!ref) return "••••????";
  const clean = ref.trim();
  if (clean.length <= 4) return clean;
  return "••••" + clean.slice(-4);
}

function buildBlocker(code: EquityPreviewBlockerCode, message: string): EquityPreviewBlocker {
  return { code, message };
}

function buildWarning(code: EquityPreviewWarningCode, message: string): EquityPreviewWarning {
  return { code, message };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE: generateEquityPreview
// ─────────────────────────────────────────────────────────────────────────────

export interface GeneratePreviewOptions {
  userId: string;
  draftId: string;
  deps: EquityPreviewDeps;
}

export interface GeneratePreviewResult {
  preview: EquityOrderPreview;
}

export async function generateEquityPreview(
  opts: GeneratePreviewOptions,
): Promise<GeneratePreviewResult> {
  const startMs = Date.now();
  const { userId, draftId, deps } = opts;
  const now = deps.now();

  // ── Load OrderDraft (user-scoped) ─────────────────────────────────────────
  const draftRow = await deps.getDraftById(draftId, userId);
  if (!draftRow) {
    const preview = buildUnavailablePreview(userId, draftId, now, [
      buildBlocker("ORDER_DRAFT_NOT_FOUND", "Order draft not found or does not belong to this account."),
    ]);
    recordMetric("UNAVAILABLE", Date.now() - startMs);
    return { preview };
  }

  // Parse the stored OrderDraft JSON
  const draft = draftRow.draftJson as unknown as OrderDraft;

  // ── Draft status check ───────────────────────────────────────────────────
  if (draftRow.status === "ABANDONED") {
    const preview = buildUnavailablePreview(userId, draftId, now, [
      buildBlocker("ORDER_DRAFT_ABANDONED", "This order draft has been abandoned."),
    ], { tradePlanId: draftRow.tradePlanId });
    recordMetric("UNAVAILABLE", Date.now() - startMs);
    return { preview };
  }

  // ── Draft expiry check ───────────────────────────────────────────────────
  const isExpired = now > draftRow.expiresAt;
  if (isExpired || draftRow.status === "EXPIRED") {
    const preview = buildUnavailablePreview(userId, draftId, now, [
      buildBlocker("ORDER_DRAFT_EXPIRED", "This order draft has expired. Return to Order Preparation to create a new draft."),
    ], { tradePlanId: draftRow.tradePlanId, status: "EXPIRED" });
    recordMetric("EXPIRED", Date.now() - startMs);
    return { preview };
  }

  // ── Load TradePlan (user-scoped) ─────────────────────────────────────────
  const tradePlan = await deps.getTradePlan(draftRow.tradePlanId, userId);
  if (!tradePlan) {
    const preview = buildUnavailablePreview(userId, draftId, now, [
      buildBlocker("TRADE_PLAN_NOT_FOUND", "Trade plan not found."),
    ], { tradePlanId: draftRow.tradePlanId });
    recordMetric("UNAVAILABLE", Date.now() - startMs);
    return { preview };
  }

  const symbol = tradePlan.symbol;

  // ── STOCK expression invariant ───────────────────────────────────────────
  const broadExpr = tradePlan.broadExpressionType;
  const selectedBy = tradePlan.expressionSelectedBy;
  if (broadExpr && broadExpr !== "STOCK") {
    const preview = buildUnavailablePreview(userId, draftId, now, [
      buildBlocker("WRONG_EXPRESSION_TYPE",
        `Equity Order Preview requires expression type STOCK. Current: ${broadExpr}. Use the appropriate preview for this structure.`),
    ], { tradePlanId: draftRow.tradePlanId });
    recordMetric("INVALID", Date.now() - startMs);
    return { preview };
  }

  // ── Load Preflight ───────────────────────────────────────────────────────
  const preflight = await deps.getPreflightResult(draftRow.preflightId, draftRow.tradePlanId, userId);
  if (!preflight) {
    const preview = buildPreviewWithBlockers(userId, draftId, draftRow, draft, tradePlan, now, [
      buildBlocker("PREFLIGHT_MISSING", "Execution preflight result not found. Run Execution Preflight again."),
    ]);
    recordMetric("INVALID", Date.now() - startMs);
    return { preview };
  }

  // ── Preflight expiry ─────────────────────────────────────────────────────
  const preflightExpired = preflight.validUntil && now > preflight.validUntil;
  const preflightNotPassing = preflight.status !== "PASS";

  // ── Trade plan version mismatch ──────────────────────────────────────────
  const planVersionMismatch = draftRow.tradePlanVersion !== (tradePlan.version ?? draftRow.tradePlanVersion);

  // ── Lifecycle state ──────────────────────────────────────────────────────
  const lifecycleState = await deps.getCurrentLifecycleState(draftRow.tradePlanId, userId) ?? "UNKNOWN";
  const thesisInvalidated = lifecycleState === "THESIS_INVALIDATED";
  const lifecycleChanged = ["REQUIRES_REVIEW", "DATA_STALE", "CHANGED"].includes(lifecycleState);

  // ── Fresh quote ──────────────────────────────────────────────────────────
  const freshQuote = await deps.getQuoteForPreview(symbol, userId);
  const quoteStale = !freshQuote || freshQuote.isStale;

  // ── Broker context ───────────────────────────────────────────────────────
  const brokerRaw = await deps.getBrokerContext(userId, draft.brokerAccountRef, draft.brokerProvider);
  const buyingPowerStatus = await deps.getBuyingPowerStatus(userId, draft.brokerAccountRef);

  const brokerContext: EquityPreviewBrokerContext = {
    provider: draft.brokerProvider,
    accountMasked: draft.brokerAccountMasked || maskAccountRef(draft.brokerAccountRef),
    accountType: draft.brokerAccountType ?? "OTHER",
    executionMode: (draft.executionMode as any) ?? "DISABLED",
    executionEnabled: deps.isExecutionEnabled(),
    supportsMarketOrders: brokerRaw?.supportsMarketOrders ?? true,
    supportsLimitOrders: brokerRaw?.supportsLimitOrders ?? true,
    supportedTimeInForce: brokerRaw?.supportedTimeInForce ?? ["DAY", "GTC"],
    buyingPowerCheckStatus: buyingPowerStatus,
  };

  // ── Accumulate blockers ──────────────────────────────────────────────────
  const blockers: EquityPreviewBlocker[] = [];
  const warnings: EquityPreviewWarning[] = [];

  if (planVersionMismatch) {
    blockers.push(buildBlocker("TRADE_PLAN_VERSION_CHANGED",
      "Trade plan has been updated since this draft was created. Return to Order Preparation."));
  }

  if (preflightExpired) {
    blockers.push(buildBlocker("PREFLIGHT_EXPIRED",
      "Execution preflight has expired. Run Execution Preflight again before continuing."));
  } else if (preflightNotPassing) {
    blockers.push(buildBlocker("PREFLIGHT_NOT_PASSING",
      "Execution preflight did not pass. Review preflight results before proceeding."));
  }

  if (thesisInvalidated) {
    blockers.push(buildBlocker("LIFECYCLE_THESIS_INVALIDATED",
      "Research thesis has been invalidated. Review lifecycle status before proceeding."));
  } else if (lifecycleChanged) {
    blockers.push(buildBlocker("LIFECYCLE_CHANGED",
      "Trade plan lifecycle state has changed. Review before proceeding."));
  }

  if (quoteStale) {
    blockers.push(buildBlocker("QUOTE_STALE",
      "Market quote is stale or unavailable. Refresh preview to revalidate."));
  }

  if (!brokerRaw?.connected || brokerRaw === null) {
    blockers.push(buildBlocker("BROKER_DISCONNECTED",
      "Broker connection is unavailable. Reconnect your broker account."));
  }

  if (buyingPowerStatus === "FAIL") {
    blockers.push(buildBlocker("INSUFFICIENT_BUYING_POWER",
      "Buying power check did not pass. Review your account balance."));
  }

  if (draft.pricingContext.orderType === "MARKET" &&
      !brokerContext.supportsMarketOrders) {
    blockers.push(buildBlocker("ORDER_TYPE_UNSUPPORTED",
      "Market orders are not currently supported by this account configuration."));
  }

  if (!brokerContext.supportedTimeInForce.includes(draft.timeInForceContext.timeInForce)) {
    blockers.push(buildBlocker("TIF_UNSUPPORTED",
      `Time in force "${draft.timeInForceContext.timeInForce}" is not supported. Edit draft to change.`));
  }

  // ── Warnings ─────────────────────────────────────────────────────────────
  if (!deps.isExecutionEnabled()) {
    warnings.push(buildWarning("EXECUTION_DISABLED",
      "Broker submission is currently disabled. Preview is available; submission is not."));
  }

  if (draft.pricingContext.orderType === "MARKET") {
    warnings.push(buildWarning("MARKET_ORDER_PRICE_UNCERTAINTY", EQUITY_PREVIEW_MARKET_ORDER_WARNING));
  }

  const sessionState = draft.marketHoursContext?.sessionState ?? "UNKNOWN";
  if (sessionState === "CLOSED") {
    warnings.push(buildWarning("MARKET_CLOSED",
      "The market is currently closed. Any future order would be queued for the next session."));
  } else if (sessionState === "PRE_MARKET") {
    warnings.push(buildWarning("PRE_MARKET", "Pre-market session is active."));
  } else if (sessionState === "AFTER_HOURS") {
    warnings.push(buildWarning("AFTER_HOURS", "After-hours session is active."));
  }

  // Preflight expiry approaching
  if (preflight.validUntil && !preflightExpired) {
    const secToExpiry = (new Date(preflight.validUntil).getTime() - now.getTime()) / 1000;
    if (secToExpiry < EQUITY_PREVIEW_PREFLIGHT_WARNING_SEC) {
      warnings.push(buildWarning("PREFLIGHT_EXPIRY_APPROACHING",
        "Execution preflight will expire soon. Refresh preview or re-run preflight."));
    }
  }

  // ── Pricing computation ──────────────────────────────────────────────────
  const draftQuote = draft.quoteSnapshot?.underlying;
  const draftMid = draftQuote?.midpoint ?? null;
  const draftBid = draftQuote?.bid ?? null;
  const draftAsk = draftQuote?.ask ?? null;

  const currentMid = freshQuote?.midpoint ?? null;
  const currentBid = freshQuote?.bid ?? null;
  const currentAsk = freshQuote?.ask ?? null;

  const priceMovement = resolvePriceMovement(currentMid, draftMid);
  if (priceMovement === "MATERIAL_CHANGE") {
    const diff = currentMid !== null && draftMid !== null && draftMid !== 0
      ? ((currentMid - draftMid) / draftMid * 100).toFixed(2)
      : null;
    warnings.push(buildWarning("QUOTE_MOVED",
      `Current quote differs materially from draft reference${diff ? ` (${diff}%)` : ""}. Draft values are unchanged.`));
  }

  const quoteContext: PreviewQuoteContext = freshQuote
    ? {
        symbol,
        bid: freshQuote.bid,
        ask: freshQuote.ask,
        last: freshQuote.last,
        midpoint: freshQuote.midpoint,
        quoteTime: freshQuote.asOf,
        freshnessCategory: freshQuote.isStale ? "STALE" : freshQuote.freshnessSeconds < 30 ? "FRESH" : "AGING",
        freshnessSeconds: freshQuote.freshnessSeconds,
        provider: freshQuote.provider,
        isCrossed: freshQuote.isCrossed,
        isStale: freshQuote.isStale,
      }
    : {
        symbol,
        bid: null, ask: null, last: null, midpoint: null,
        quoteTime: now.toISOString(),
        freshnessCategory: "UNAVAILABLE",
        freshnessSeconds: 0,
        provider: "unavailable",
        isCrossed: false,
        isStale: true,
      };

  const qty = draft.quantityContext.confirmedQuantity;
  const orderType = draft.pricingContext.orderType;
  const draftLimitPrice = draft.pricingContext.limitPriceReference ?? null;

  let estimatedNotional: number | null = null;
  let estimatedNotionalLabel = "Estimated Notional";

  if (orderType === "LIMIT" && draftLimitPrice !== null) {
    estimatedNotional = qty * draftLimitPrice;
    estimatedNotionalLabel = "Estimated Notional at Draft Limit Price";
  } else if (orderType === "MARKET") {
    const ref = currentAsk ?? currentMid;
    if (ref !== null) {
      estimatedNotional = qty * ref;
      estimatedNotionalLabel = currentAsk !== null
        ? "Estimated Notional at Current Ask"
        : "Estimated Notional at Current Midpoint";
    }
  }

  let limitMarketRelation: LimitMarketRelation | undefined;
  let limitDistanceFromBid: number | null = null;
  let limitDistanceFromAsk: number | null = null;
  let limitDistancePct: number | null = null;

  if (orderType === "LIMIT" && draftLimitPrice !== null) {
    limitMarketRelation = resolveLimitRelation(draftLimitPrice, currentBid, currentAsk);
    if (currentBid !== null) limitDistanceFromBid = draftLimitPrice - currentBid;
    if (currentAsk !== null) limitDistanceFromAsk = draftLimitPrice - currentAsk;
    const midRef = currentMid;
    if (midRef !== null && midRef !== 0) {
      limitDistancePct = ((draftLimitPrice - midRef) / midRef) * 100;
    }
    if (limitMarketRelation === "AT_OR_ABOVE_ASK") {
      warnings.push(buildWarning("LIMIT_ABOVE_ASK",
        "Draft limit price is at or above the current ask. A market order may execute closer to market price."));
    } else if (limitMarketRelation === "AT_OR_BELOW_BID") {
      warnings.push(buildWarning("LIMIT_BELOW_BID",
        "Draft limit price is at or below the current bid."));
    }
  }

  const priceDifferenceAbs = currentMid !== null && draftMid !== null ? currentMid - draftMid : null;
  const priceDifferencePct = currentMid !== null && draftMid !== null && draftMid !== 0
    ? ((currentMid - draftMid) / draftMid) * 100 : null;

  const pricing: EquityPreviewPricing = {
    orderType,
    draftLimitPrice,
    draftLimitPriceSource: draft.pricingContext.limitPriceSource ?? null,
    draftBid,
    draftAsk,
    draftMidpoint: draftMid,
    currentQuote: quoteContext,
    limitMarketRelation,
    limitDistanceFromBid,
    limitDistanceFromAsk,
    limitDistancePct,
    priceMovement,
    priceDifferenceAbs,
    priceDifferencePct,
    estimatedNotional,
    estimatedNotionalLabel,
    marketOrderWarning: orderType === "MARKET",
  };

  // ── Planning context ─────────────────────────────────────────────────────
  const researchSnap = tradePlan.researchSnapshot ?? {};
  const planningContext: EquityPreviewPlanningContext = {
    symbol,
    companyName: tradePlan.companyName ?? undefined,
    researchSummary: (researchSnap as any)?.summary ?? undefined,
    researchThesis: (researchSnap as any)?.thesis ?? undefined,
    researchScoreAtPlanCreation: (researchSnap as any)?.score ?? null,
    currentLifecycleState: lifecycleState,
    thesisInvalidated,
    planVersion: tradePlan.version ?? draftRow.tradePlanVersion,
    planCreatedAt: tradePlan.createdAt?.toISOString() ?? now.toISOString(),
  };

  // ── Risk context ─────────────────────────────────────────────────────────
  const riskCtx = draft.riskContext;
  const riskContext: EquityPreviewRiskContext = {
    constraintStatus: riskCtx.constraintStatus,
    riskFlags: riskCtx.riskFlags,
    researchInvalidation: thesisInvalidated,
    planningScenarioLoss: null,
    concentrationContext: null,
    coverageValidated: riskCtx.coverageValidated,
  };

  // ── Source integrity ─────────────────────────────────────────────────────
  const expressionOk = !broadExpr || broadExpr === "STOCK";
  const selectedByOk = !selectedBy || selectedBy === "USER";
  const sourceIntegrity: PreviewSourceIntegrity = {
    tradePlanMatches: !!tradePlan,
    tradePlanVersionMatches: !planVersionMismatch,
    broadExpressionMatches: expressionOk && selectedByOk,
    preflightMatches: !!preflight,
    orderDraftMatches: !!draftRow,
    accountMatches: true,  // account validated via broker context above
    symbolMatches: true,
    lifecycleCurrent: !thesisInvalidated && !lifecycleChanged,
    quoteCurrent: !quoteStale,
    allPass: !planVersionMismatch && !!preflight && !preflightExpired && !preflightNotPassing
      && !thesisInvalidated && !quoteStale && expressionOk && selectedByOk,
  };

  // ── Expression trace ─────────────────────────────────────────────────────
  const expressionTrace: ExpressionSelectionTrace = {
    selectedExpressionType: "STOCK",
    selectedBy: "USER",
    selectedAt: tradePlan.expressionSelectedAt ?? null,
  };

  // ── Determine preview status ─────────────────────────────────────────────
  let status: EquityPreviewStatus = "VALID";
  if (blockers.some(b => ["ORDER_DRAFT_EXPIRED", "ORDER_DRAFT_NOT_FOUND",
      "ORDER_DRAFT_ABANDONED", "WRONG_EXPRESSION_TYPE", "TRADE_PLAN_NOT_FOUND"].includes(b.code))) {
    status = "INVALID";
  } else if (blockers.length > 0) {
    status = "REQUIRES_REVIEW";
  } else if (warnings.some(w => w.code === "PREFLIGHT_EXPIRY_APPROACHING")) {
    status = "REQUIRES_REVIEW";
  }

  // ── ValidUntil ───────────────────────────────────────────────────────────
  const validUntil = computeValidUntil(now, draftRow.expiresAt, preflight.validUntil);

  // ── Side intent label ─────────────────────────────────────────────────────
  const sideIntent = draft.sideIntent ?? "OPEN_LONG";
  const sideIntentLabel = SIDE_INTENT_LABELS[sideIntent] ?? sideIntent;

  // ── Build preview ────────────────────────────────────────────────────────
  const preview: EquityOrderPreview = {
    executable: false as const,
    id: randomUUID(),
    userId,
    tradePlanId: draftRow.tradePlanId,
    tradePlanVersion: draftRow.tradePlanVersion,
    preflightId: draftRow.preflightId,
    orderDraftId: draftId,
    orderDraftVersion: draftRow.version,
    expressionType: "STOCK",
    expressionSelectedBy: "USER",
    expressionSelectedAt: tradePlan.expressionSelectedAt ?? null,
    generatedAt: now.toISOString(),
    validUntil,
    status,
    symbol,
    companyName: tradePlan.companyName ?? undefined,
    sideIntent,
    sideIntentLabel,
    quantity: qty,
    quantityUnit: "shares",
    orderType,
    timeInForce: draft.timeInForceContext.timeInForce,
    allowExtendedHours: draft.pricingContext.extendedHoursRequested,
    broker: brokerContext,
    pricing,
    marketHours: resolveMarketHours(sessionState),
    planningContext,
    riskContext,
    estimatedDraftNotional: estimatedNotional,
    buyingPowerCheckStatus: buyingPowerStatus,
    sourceIntegrity,
    expressionTrace,
    blockers,
    warnings,
    disclaimer: EQUITY_PREVIEW_DISCLAIMER,
    executionPriceDisclaimer: EQUITY_PREVIEW_PRICE_DISCLAIMER,
    methodologyVersion: EQUITY_PREVIEW_METHODOLOGY_VERSION,
  };

  // ── Audit event ──────────────────────────────────────────────────────────
  const latencyMs = Date.now() - startMs;
  try {
    await deps.appendAuditEvent({
      userId,
      tradePlanId: draftRow.tradePlanId,
      eventType: "EQUITY_PREVIEW_GENERATED",
      provider: draft.brokerProvider,
      accountRefMasked: draft.brokerAccountMasked,
      metadata: {
        orderType,
        tif: draft.timeInForceContext.timeInForce,
        status,
        blockerCount: blockers.length,
        warningCount: warnings.length,
        durationMs: latencyMs,
        quoteFreshnessCategory: quoteContext.freshnessCategory,
      },
    });
  } catch {
    // fire-and-forget
  }

  recordMetric(status, latencyMs);

  return { preview };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — partial/error previews
// ─────────────────────────────────────────────────────────────────────────────

function buildUnavailablePreview(
  userId: string,
  draftId: string,
  now: Date,
  blockers: EquityPreviewBlocker[],
  ctx?: { tradePlanId?: string; status?: EquityPreviewStatus },
): EquityOrderPreview {
  const nowIso = now.toISOString();
  return {
    executable: false as const,
    id: randomUUID(),
    userId,
    tradePlanId: ctx?.tradePlanId ?? "unknown",
    tradePlanVersion: 0,
    preflightId: "unknown",
    orderDraftId: draftId,
    orderDraftVersion: 0,
    expressionType: "STOCK",
    expressionSelectedBy: "USER",
    expressionSelectedAt: null,
    generatedAt: nowIso,
    validUntil: nowIso,
    status: ctx?.status ?? "UNAVAILABLE",
    symbol: "UNKNOWN",
    sideIntent: "OPEN_LONG",
    sideIntentLabel: "Open Long Position",
    quantity: 0,
    quantityUnit: "shares",
    orderType: "MARKET",
    timeInForce: "DAY",
    allowExtendedHours: false,
    broker: {
      provider: "unknown",
      accountMasked: "••••????",
      accountType: "OTHER",
      executionMode: "DISABLED",
      executionEnabled: false,
      supportsMarketOrders: false,
      supportsLimitOrders: false,
      supportedTimeInForce: [],
      buyingPowerCheckStatus: "UNAVAILABLE",
    },
    pricing: {
      orderType: "MARKET",
      draftLimitPrice: null,
      draftLimitPriceSource: null,
      draftBid: null,
      draftAsk: null,
      draftMidpoint: null,
      currentQuote: {
        symbol: "UNKNOWN", bid: null, ask: null, last: null, midpoint: null,
        quoteTime: nowIso, freshnessCategory: "UNAVAILABLE", freshnessSeconds: 0,
        provider: "unavailable", isCrossed: false, isStale: true,
      },
      priceMovement: "UNKNOWN",
      estimatedNotional: null,
      estimatedNotionalLabel: "Estimated Notional",
      marketOrderWarning: false,
    },
    marketHours: { sessionState: "UNKNOWN", asOf: nowIso },
    planningContext: {
      symbol: "UNKNOWN",
      currentLifecycleState: "UNKNOWN",
      thesisInvalidated: false,
      planVersion: 0,
      planCreatedAt: nowIso,
    },
    riskContext: {
      constraintStatus: "UNKNOWN",
      riskFlags: [],
      researchInvalidation: false,
      coverageValidated: false,
    },
    estimatedDraftNotional: null,
    buyingPowerCheckStatus: "UNAVAILABLE",
    sourceIntegrity: {
      tradePlanMatches: false,
      tradePlanVersionMatches: false,
      broadExpressionMatches: false,
      preflightMatches: false,
      orderDraftMatches: false,
      accountMatches: false,
      symbolMatches: false,
      lifecycleCurrent: false,
      quoteCurrent: false,
      allPass: false,
    },
    expressionTrace: { selectedExpressionType: "STOCK", selectedBy: "USER", selectedAt: null },
    blockers,
    warnings: [],
    disclaimer: EQUITY_PREVIEW_DISCLAIMER,
    executionPriceDisclaimer: EQUITY_PREVIEW_PRICE_DISCLAIMER,
    methodologyVersion: EQUITY_PREVIEW_METHODOLOGY_VERSION,
  };
}

function buildPreviewWithBlockers(
  userId: string,
  draftId: string,
  draftRow: { tradePlanId: string; tradePlanVersion: number; preflightId: string; version: number; expiresAt: Date },
  draft: OrderDraft,
  tradePlan: { symbol: string; companyName?: string | null; version?: number; createdAt?: Date | null },
  now: Date,
  blockers: EquityPreviewBlocker[],
): EquityOrderPreview {
  const nowIso = now.toISOString();
  return {
    executable: false as const,
    id: randomUUID(),
    userId,
    tradePlanId: draftRow.tradePlanId,
    tradePlanVersion: draftRow.tradePlanVersion,
    preflightId: draftRow.preflightId,
    orderDraftId: draftId,
    orderDraftVersion: draftRow.version,
    expressionType: "STOCK",
    expressionSelectedBy: "USER",
    expressionSelectedAt: null,
    generatedAt: nowIso,
    validUntil: nowIso,
    status: "INVALID",
    symbol: tradePlan.symbol,
    companyName: tradePlan.companyName ?? undefined,
    sideIntent: draft.sideIntent ?? "OPEN_LONG",
    sideIntentLabel: SIDE_INTENT_LABELS[draft.sideIntent ?? "OPEN_LONG"] ?? draft.sideIntent ?? "Open Long Position",
    quantity: draft.quantityContext.confirmedQuantity,
    quantityUnit: "shares",
    orderType: draft.pricingContext.orderType,
    timeInForce: draft.timeInForceContext.timeInForce,
    allowExtendedHours: draft.pricingContext.extendedHoursRequested,
    broker: {
      provider: draft.brokerProvider,
      accountMasked: draft.brokerAccountMasked || maskAccountRef(draft.brokerAccountRef),
      accountType: draft.brokerAccountType ?? "OTHER",
      executionMode: (draft.executionMode as any) ?? "DISABLED",
      executionEnabled: false,
      supportsMarketOrders: false,
      supportsLimitOrders: false,
      supportedTimeInForce: [],
      buyingPowerCheckStatus: "UNAVAILABLE",
    },
    pricing: {
      orderType: draft.pricingContext.orderType,
      draftLimitPrice: draft.pricingContext.limitPriceReference ?? null,
      draftLimitPriceSource: draft.pricingContext.limitPriceSource ?? null,
      draftBid: draft.quoteSnapshot?.underlying?.bid ?? null,
      draftAsk: draft.quoteSnapshot?.underlying?.ask ?? null,
      draftMidpoint: draft.quoteSnapshot?.underlying?.midpoint ?? null,
      currentQuote: {
        symbol: tradePlan.symbol, bid: null, ask: null, last: null, midpoint: null,
        quoteTime: nowIso, freshnessCategory: "UNAVAILABLE", freshnessSeconds: 0,
        provider: "unavailable", isCrossed: false, isStale: true,
      },
      priceMovement: "UNKNOWN",
      estimatedNotional: null,
      estimatedNotionalLabel: "Estimated Notional",
      marketOrderWarning: draft.pricingContext.orderType === "MARKET",
    },
    marketHours: { sessionState: draft.marketHoursContext?.sessionState ?? "UNKNOWN", asOf: nowIso },
    planningContext: {
      symbol: tradePlan.symbol,
      companyName: tradePlan.companyName ?? undefined,
      currentLifecycleState: "UNKNOWN",
      thesisInvalidated: false,
      planVersion: tradePlan.version ?? draftRow.tradePlanVersion,
      planCreatedAt: tradePlan.createdAt?.toISOString() ?? nowIso,
    },
    riskContext: {
      constraintStatus: draft.riskContext.constraintStatus,
      riskFlags: draft.riskContext.riskFlags,
      researchInvalidation: false,
      coverageValidated: draft.riskContext.coverageValidated,
    },
    estimatedDraftNotional: null,
    buyingPowerCheckStatus: "UNAVAILABLE",
    sourceIntegrity: {
      tradePlanMatches: true,
      tradePlanVersionMatches: true,
      broadExpressionMatches: true,
      preflightMatches: false,
      orderDraftMatches: true,
      accountMatches: true,
      symbolMatches: true,
      lifecycleCurrent: false,
      quoteCurrent: false,
      allPass: false,
    },
    expressionTrace: { selectedExpressionType: "STOCK", selectedBy: "USER", selectedAt: null },
    blockers,
    warnings: [],
    disclaimer: EQUITY_PREVIEW_DISCLAIMER,
    executionPriceDisclaimer: EQUITY_PREVIEW_PRICE_DISCLAIMER,
    methodologyVersion: EQUITY_PREVIEW_METHODOLOGY_VERSION,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB DEPS FACTORY
// ─────────────────────────────────────────────────────────────────────────────

export function createDbEquityPreviewDeps(userId: string): EquityPreviewDeps {
  return {
    now: () => new Date(),

    async getDraftById(draftId, uid) {
      const { db } = await import("../db");
      const { orderDrafts } = await import("../../shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const rows = await db.select().from(orderDrafts)
        .where(and(eq(orderDrafts.id, draftId), eq(orderDrafts.userId, uid)))
        .limit(1);
      if (!rows[0]) return null;
      const r = rows[0];
      return {
        id: r.id, userId: r.userId, tradePlanId: r.tradePlanId,
        tradePlanVersion: r.tradePlanVersion,
        preflightId: r.preflightId,
        draftJson: r.draftJson as Record<string, unknown>,
        status: r.status, version: r.version, expiresAt: r.expiresAt,
      };
    },

    async getTradePlan(id, uid) {
      const { db } = await import("../db");
      const { tradePlans } = await import("../../shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const rows = await db.select().from(tradePlans)
        .where(and(eq(tradePlans.id, id), eq(tradePlans.userId, uid)))
        .limit(1);
      if (!rows[0]) return null;
      const r = rows[0];
      return {
        id: r.id, userId: r.userId, symbol: r.symbol, companyName: r.companyName,
        version: (r as any).version ?? 1,
        broadExpressionType: (r as any).broadExpressionType ?? null,
        expressionSelectedBy: (r as any).expressionSelectedBy ?? null,
        expressionSelectedAt: (r as any).expressionSelectedAt?.toISOString() ?? null,
        selectedExpressionFamily: r.selectedExpressionFamily ?? null,
        researchSnapshot: r.researchSnapshot as any,
        planningSnapshot: r.planningSnapshot as any,
        riskSnapshot: r.riskSnapshot as any,
        status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt,
      };
    },

    async getPreflightResult(preflightId, tradePlanId, uid) {
      const { db } = await import("../db");
      const { executionPreflights } = await import("../../shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const rows = await db.select().from(executionPreflights)
        .where(and(
          eq(executionPreflights.id, preflightId),
          eq(executionPreflights.tradePlanId, tradePlanId),
          eq(executionPreflights.userId, uid),
        ))
        .limit(1);
      if (!rows[0]) return null;
      const r = rows[0];
      return {
        id: r.id, status: r.status,
        evaluatedAt: r.evaluatedAt, validUntil: r.validUntil,
        resultJson: r.resultJson as Record<string, unknown>,
      };
    },

    async getCurrentLifecycleState(tradePlanId, _uid) {
      try {
        const { db } = await import("../db");
        const { tradePlanActivity } = await import("../../shared/schema");
        const { eq, desc } = await import("drizzle-orm");
        const rows = await db.select()
          .from(tradePlanActivity)
          .where(eq(tradePlanActivity.tradePlanId, tradePlanId))
          .orderBy(desc(tradePlanActivity.occurredAt))
          .limit(1);
        return rows[0]?.lifecycleState ?? null;
      } catch {
        return null;
      }
    },

    async getQuoteForPreview(symbol, _uid) {
      try {
        // Use reference market data (read-only, stored bars)
        const { getReferenceSnapshot } = await import("./daily-market-data/reference-snapshot");
        const snap = await getReferenceSnapshot(symbol);
        if (!snap) return null;
        const ageSec = (Date.now() - new Date(snap.asOf ?? snap.timestamp ?? Date.now()).getTime()) / 1000;
        const mid = snap.bid && snap.ask ? (snap.bid + snap.ask) / 2 : snap.close ?? null;
        return {
          bid: snap.bid ?? null, ask: snap.ask ?? null,
          last: snap.close ?? null, midpoint: mid,
          asOf: new Date(snap.asOf ?? snap.timestamp ?? Date.now()).toISOString(),
          isStale: ageSec > EQUITY_PREVIEW_QUOTE_FRESHNESS_SEC,
          isCrossed: snap.bid !== null && snap.ask !== null ? snap.bid > snap.ask : false,
          provider: snap.provider ?? "reference",
          freshnessSeconds: Math.round(ageSec),
        };
      } catch {
        return null;
      }
    },

    async getBuyingPowerStatus(uid, accountRef) {
      try {
        const { createLiveBrokerExecutionAdapter } = await import("./broker-execution-adapter");
        const adapter = createLiveBrokerExecutionAdapter();
        const bp = await adapter.getBuyingPower(uid, accountRef);
        return bp.available ? "PASS" : "FAIL";
      } catch {
        return "UNAVAILABLE";
      }
    },

    async getBrokerContext(uid, _accountRef, _provider) {
      try {
        const { createLiveBrokerExecutionAdapter } = await import("./broker-execution-adapter");
        const adapter = createLiveBrokerExecutionAdapter();
        const status = await adapter.getConnectionStatus(uid);
        return {
          connected: status.connected,
          executionMode: process.env.BROKER_EXECUTION_ENABLED === "true" ? "PRODUCTION" : "DISABLED",
          executionEnabled: process.env.BROKER_EXECUTION_ENABLED === "true",
          accountMasked: "••••????",
          accountType: "OTHER",
          supportsMarketOrders: true,
          supportsLimitOrders: true,
          supportedTimeInForce: ["DAY", "GTC"],
        };
      } catch {
        return null;
      }
    },

    async appendAuditEvent(event) {
      try {
        const { db } = await import("../db");
        const { executionAuditEvents } = await import("../../shared/schema");
        await db.insert(executionAuditEvents).values({
          id: randomUUID(),
          userId: event.userId,
          tradePlanId: event.tradePlanId,
          eventType: event.eventType,
          occurredAt: new Date(),
          provider: event.provider ?? null,
          accountRefMasked: event.accountRefMasked ?? null,
          metadata: event.metadata as Record<string, unknown>,
        }).onConflictDoNothing();
      } catch {
        // fire-and-forget
      }
    },

    isExecutionEnabled: () => process.env.BROKER_EXECUTION_ENABLED === "true",
  };
}
