/**
 * server/services/options-preview-service.ts — Sprint 2.8.3
 *
 * Pure computation engine for Options / Multi-Leg Order Preview.
 *
 * PERMANENT ARCHITECTURE INVARIANT:
 *   This service is READ-ONLY regarding OrderDraft, TradePlan, Preflight,
 *   and strategy/leg selection.
 *
 *   It may NEVER:
 *     - call placeOrder / submitOrder / replaceOrder / cancelOrder
 *     - change broad expression, strategy family, contracts, legs,
 *       expirations, strikes, ratios, quantity, account, or draft pricing
 *     - decompose a multi-leg structure into separate legs
 *     - substitute a contract
 *
 *   executable is ALWAYS false on all outputs.
 */

import { randomUUID } from "crypto";
import type { OrderDraft, OrderDraftLeg } from "../../shared/order-draft-types";
import type {
  OptionsOrderPreview,
  OptionsPreviewStatus,
  OptionsPreviewBlocker,
  OptionsPreviewBlockerCode,
  OptionsPreviewWarning,
  OptionsPreviewWarningCode,
  OptionsPreviewLeg,
  OptionsLegQuote,
  OptionsLegGreeks,
  OptionsLegLiquidity,
  NetStructurePricing,
  OptionsQuoteFreshness,
  OptionsLiquidityContext,
  OptionsPreviewRiskContext,
  AssignmentExerciseContext,
  OptionsEventContext,
  OptionsPreviewBrokerContext,
  OptionsPreviewSourceIntegrity,
  ExpirationContext,
  LiquidityCategory,
  QuoteChangeCategory,
  StructurePricingType,
  LiquidityChangeCategory,
  OptionsPreviewHealthMetrics,
} from "../../shared/options-order-preview-types";
import {
  OPTIONS_PREVIEW_DISCLAIMER,
  OPTIONS_PREVIEW_PRICE_DISCLAIMER,
  OPTIONS_PREVIEW_MIDPOINT_DISCLAIMER,
  OPTIONS_RISK_DISCLOSURE,
  OPTIONS_PREVIEW_METHODOLOGY_VERSION,
  OPTIONS_PREVIEW_DEFAULT_TTL_MS,
  OPTIONS_PREVIEW_PREFLIGHT_WARNING_SEC,
  OPTIONS_DTE_NEAR_EXPIRATION,
  OPTIONS_MULTIPLIER_DEFAULT,
  OPTIONS_WIDE_SPREAD_THRESHOLD_PCT,
  OPTIONS_BROAD_EXPRESSIONS,
  OPTIONS_QUOTE_MATERIAL_THRESHOLD_PCT,
  STRATEGY_FAMILY_LABELS,
  CANONICAL_INTENT_LABELS,
  LEG_ROLE_LABELS,
  contractLiquidityToCategory,
} from "../../shared/options-order-preview-types";

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY HEALTH METRICS
// ─────────────────────────────────────────────────────────────────────────────

const healthState: OptionsPreviewHealthMetrics & { latencyBucket: number[] } = {
  previewRequests: 0,
  singleLegPreviews: 0,
  multiLegPreviews: 0,
  previewPasses: 0,
  previewRequiresReview: 0,
  previewInvalid: 0,
  previewExpired: 0,
  previewFailures: 0,
  averagePreviewLatencyMs: 0,
  lastPreviewAt: null,
  brokerSubmissionEnabled: false,
  latencyBucket: [],
};

export function getOptionsPreviewMetrics(): OptionsPreviewHealthMetrics {
  const bucket = healthState.latencyBucket;
  const avg = bucket.length > 0 ? bucket.reduce((a, b) => a + b, 0) / bucket.length : 0;
  return {
    previewRequests: healthState.previewRequests,
    singleLegPreviews: healthState.singleLegPreviews,
    multiLegPreviews: healthState.multiLegPreviews,
    previewPasses: healthState.previewPasses,
    previewRequiresReview: healthState.previewRequiresReview,
    previewInvalid: healthState.previewInvalid,
    previewExpired: healthState.previewExpired,
    previewFailures: healthState.previewFailures,
    averagePreviewLatencyMs: Math.round(avg),
    lastPreviewAt: healthState.lastPreviewAt,
    brokerSubmissionEnabled: false,
  };
}

function recordMetric(status: OptionsPreviewStatus, legCount: number, latencyMs: number): void {
  healthState.previewRequests++;
  healthState.lastPreviewAt = new Date().toISOString();
  if (legCount === 1) healthState.singleLegPreviews++;
  else if (legCount > 1) healthState.multiLegPreviews++;
  if (status === "VALID") healthState.previewPasses++;
  else if (status === "REQUIRES_REVIEW") healthState.previewRequiresReview++;
  else if (status === "EXPIRED") healthState.previewExpired++;
  else if (status === "INVALID") healthState.previewInvalid++;
  else if (status === "UNAVAILABLE") healthState.previewFailures++;
  healthState.latencyBucket.push(latencyMs);
  if (healthState.latencyBucket.length > 100) healthState.latencyBucket.shift();
}

// ─────────────────────────────────────────────────────────────────────────────
// INJECTABLE DEPS
// ─────────────────────────────────────────────────────────────────────────────

export interface CurrentLegQuoteData {
  bid: number | null;
  ask: number | null;
  last: number | null;
  midpoint: number | null;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  openInterest: number | null;
  volume: number | null;
  asOf: string;
  isStale: boolean;
  provider: string;
  freshnessSeconds: number;
  contractExists: boolean;
  isExpired: boolean;
}

export interface OptionsPreviewDeps {
  now: () => Date;

  getDraftById: (draftId: string, userId: string) => Promise<{
    id: string; userId: string; tradePlanId: string; tradePlanVersion: number;
    preflightId: string; draftJson: Record<string, unknown>;
    status: string; version: number; expiresAt: Date;
  } | null>;

  getTradePlan: (id: string, userId: string) => Promise<{
    id: string; userId: string; symbol: string; companyName?: string | null;
    version?: number; broadExpressionType?: string | null;
    expressionSelectedBy?: string | null;
    researchSnapshot?: Record<string, unknown> | null;
    riskSnapshot?: Record<string, unknown> | null;
    status?: string; createdAt?: Date | null; updatedAt?: Date | null;
  } | null>;

  getPreflightResult: (preflightId: string, tradePlanId: string, userId: string) => Promise<{
    id: string; status: string; evaluatedAt: Date; validUntil: Date | null;
    resultJson: Record<string, unknown>;
  } | null>;

  getCurrentLifecycleState: (tradePlanId: string, userId: string) => Promise<string | null>;

  /** Get current quote for each contract symbol (batched) */
  getLegQuotes: (symbols: string[], userId: string) => Promise<Map<string, CurrentLegQuoteData>>;

  getBuyingPowerStatus: (userId: string, accountRef: string) => Promise<"PASS" | "FAIL" | "UNAVAILABLE">;

  getBrokerContext: (userId: string, accountRef: string, provider: string) => Promise<{
    connected: boolean; executionMode: string; executionEnabled: boolean;
    accountMasked: string; accountType: string;
    supportsOptionsOrders: boolean;
    supportsMultiLegOrders: boolean;
    optionsPermissionStatus: "PASS" | "INSUFFICIENT" | "UNAVAILABLE";
    supportedTimeInForce: string[];
  } | null>;

  appendAuditEvent: (event: {
    userId: string; tradePlanId: string; eventType: string;
    provider?: string; accountRefMasked?: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>;

  isExecutionEnabled: () => boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function computeDTE(expiration: string, now: Date): number {
  const exp = new Date(expiration + "T23:59:59Z");
  const diffMs = exp.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function isExpirationPast(expiration: string, now: Date): boolean {
  const exp = new Date(expiration + "T23:59:59Z");
  return exp < now;
}

function formatExpiration(expiration: string, dte: number): string {
  const [y, m, d] = expiration.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthLabel = months[parseInt(m, 10) - 1] ?? m;
  return `${monthLabel} ${parseInt(d, 10)}, ${y} (${dte} DTE)`;
}

function quoteChangeCategory(currentMid: number | null, draftMid: number | null): QuoteChangeCategory {
  if (currentMid === null || draftMid === null || draftMid === 0) return "UNKNOWN";
  const diffPct = Math.abs((currentMid - draftMid) / draftMid) * 100;
  if (diffPct < 0.1) return "UNCHANGED";
  if (diffPct < OPTIONS_QUOTE_MATERIAL_THRESHOLD_PCT) return "SMALL_CHANGE";
  return "MATERIAL_CHANGE";
}

function buildLegQuoteFromCurrent(data: CurrentLegQuoteData): OptionsLegQuote {
  const bid = data.bid;
  const ask = data.ask;
  const spread = bid !== null && ask !== null ? ask - bid : null;
  const mid = data.midpoint ?? (bid !== null && ask !== null ? (bid + ask) / 2 : null);
  const spreadPct = mid !== null && mid !== 0 && spread !== null ? (spread / mid) * 100 : null;
  const isCrossed = bid !== null && ask !== null && ask < bid;
  let freshCat: "FRESH" | "AGING" | "STALE" | "UNAVAILABLE" = "UNAVAILABLE";
  if (!data.isStale && data.freshnessSeconds < 30) freshCat = "FRESH";
  else if (!data.isStale && data.freshnessSeconds < 120) freshCat = "AGING";
  else if (data.isStale) freshCat = "STALE";
  return {
    bid, ask, midpoint: mid, last: data.last,
    spreadAbs: spread, spreadPct,
    quoteTime: data.asOf, provider: data.provider,
    freshnessCategory: freshCat,
    freshnessSeconds: data.freshnessSeconds,
    isStale: data.isStale, isCrossed,
  };
}

function buildLegQuoteFromDraft(draftLegQuote: { bid: number | null; ask: number | null; midpoint: number | null; last: number | null; provider: string; asOf: string; isStale: boolean } | null): OptionsLegQuote | null {
  if (!draftLegQuote) return null;
  const { bid, ask, midpoint, last, provider, asOf, isStale } = draftLegQuote;
  const spread = bid !== null && ask !== null ? ask - bid : null;
  const mid = midpoint ?? (bid !== null && ask !== null ? (bid + ask) / 2 : null);
  const spreadPct = mid !== null && mid !== 0 && spread !== null ? (spread / mid) * 100 : null;
  return {
    bid, ask, midpoint: mid, last,
    spreadAbs: spread, spreadPct,
    quoteTime: asOf, provider,
    freshnessCategory: isStale ? "STALE" : "AGING", // draft quotes are always aging at preview time
    freshnessSeconds: 999,
    isStale, isCrossed: bid !== null && ask !== null && ask < bid,
  };
}

function buildLegGreeks(data: CurrentLegQuoteData): OptionsLegGreeks {
  const available = data.delta !== null || data.gamma !== null || data.theta !== null || data.vega !== null;
  return {
    delta: data.delta, gamma: data.gamma, theta: data.theta,
    vega: data.vega, rho: data.rho,
    impliedVolatility: data.impliedVolatility,
    greeksAvailable: available,
  };
}

function buildLegLiquidity(data: CurrentLegQuoteData, contractSymbol: string): OptionsLegLiquidity {
  const bid = data.bid;
  const ask = data.ask;
  const spread = bid !== null && ask !== null ? ask - bid : null;
  const mid = data.midpoint ?? (bid !== null && ask !== null ? (bid + ask) / 2 : null);
  const spreadPct = mid !== null && mid !== 0 && spread !== null ? (spread / mid) * 100 : null;

  let category: LiquidityCategory = "UNKNOWN";
  if (data.openInterest !== null && data.openInterest > 500) category = "STRONG";
  else if (data.openInterest !== null && data.openInterest > 100) category = "ACCEPTABLE";
  else if (data.openInterest !== null && data.openInterest > 20) category = "LIMITED";
  else if (data.openInterest !== null) category = "POOR";

  // Adjust for spread
  if (spreadPct !== null && spreadPct > OPTIONS_WIDE_SPREAD_THRESHOLD_PCT) {
    if (category === "STRONG") category = "ACCEPTABLE";
    else if (category === "ACCEPTABLE") category = "LIMITED";
    else if (category === "LIMITED") category = "POOR";
  }

  return {
    openInterest: data.openInterest,
    volume: data.volume,
    bidAskSpreadAbs: spread,
    bidAskSpreadPct: spreadPct,
    category,
  };
}

function isShortIntent(intent: string): boolean {
  return intent.includes("SHORT");
}

function roleFromLegIntent(intent: string): string {
  if (intent === "OPEN_LONG" || intent === "CLOSE_LONG") return "long_leg";
  if (isShortIntent(intent)) return "short_leg";
  return "long_leg";
}

function computeNetPricing(
  legs: OrderDraftLeg[],
  currentQuoteMap: Map<string, CurrentLegQuoteData>,
  draftCapital: { estimatedDebit?: number; estimatedCredit?: number },
  multiplier: number,
  quantity: number,
): NetStructurePricing {
  // Long legs contribute debit (we pay premium); short legs contribute credit (we receive premium).
  let netPerUnit: number | null = 0;
  let allAvailable = true;

  for (const leg of legs) {
    const qData = currentQuoteMap.get(leg.symbol);
    const mid = qData?.midpoint ?? (qData?.bid !== null && qData?.ask !== null && qData?.bid !== undefined && qData?.ask !== undefined ? (qData.bid + qData.ask) / 2 : null);
    if (mid === null || mid === undefined) { allAvailable = false; continue; }
    const isShort = isShortIntent(leg.legIntent);
    if (isShort) {
      netPerUnit = (netPerUnit ?? 0) + mid * leg.ratio;  // credit
    } else {
      netPerUnit = (netPerUnit ?? 0) - mid * leg.ratio;  // debit
    }
  }

  if (!allAvailable) netPerUnit = null;

  let pricingType: StructurePricingType = "UNKNOWN";
  let amount: number | null = null;
  if (netPerUnit !== null) {
    pricingType = netPerUnit >= 0 ? "CREDIT" : "DEBIT";
    amount = Math.abs(netPerUnit);
  }

  const amountPerContract = amount !== null ? amount * multiplier : null;
  const totalAmount = amountPerContract !== null ? amountPerContract * quantity : null;

  // Draft reference
  const draftRef = draftCapital.estimatedDebit ?? draftCapital.estimatedCredit ?? null;
  const draftType: StructurePricingType = draftCapital.estimatedDebit !== undefined ? "DEBIT"
    : draftCapital.estimatedCredit !== undefined ? "CREDIT" : "UNKNOWN";

  let differenceAbs: number | null = null;
  let differencePct: number | null = null;
  if (amount !== null && draftRef !== null && draftRef !== 0) {
    differenceAbs = amount - draftRef;
    differencePct = (differenceAbs / draftRef) * 100;
  }

  return {
    pricingType,
    amountPerUnit: amount,
    amountPerContract,
    totalAmount,
    multiplier,
    draftNetReference: draftRef,
    draftPricingType: draftType,
    differenceAbs,
    differencePct,
    changeLabel: "Current Structure Quote Change",
    allQuotesAvailable: allAvailable,
    isMidpointEstimate: true,
  };
}

function computeExpirationContext(legs: OrderDraftLeg[], now: Date): ExpirationContext {
  const uniqueExpirations = Array.from(new Set(legs.filter(l => l.expiration).map(l => l.expiration!)));
  const primaryExpiration = uniqueExpirations[0] ?? "UNKNOWN";
  const secondaryExpiration = uniqueExpirations.length > 1 ? uniqueExpirations[uniqueExpirations.length - 1] : null;

  const dteSummary = legs.map(l => ({
    legIndex: l.legIndex,
    expiration: l.expiration ?? "UNKNOWN",
    dte: l.expiration ? computeDTE(l.expiration, now) : 0,
  }));

  const anyExpired = legs.some(l => l.expiration && isExpirationPast(l.expiration, now));
  const nearExpirationWarning = dteSummary.some(s => s.dte <= OPTIONS_DTE_NEAR_EXPIRATION && s.dte > 0);

  return {
    primaryExpiration,
    secondaryExpiration,
    hasMultipleExpirations: uniqueExpirations.length > 1,
    dteSummary,
    anyExpired,
    nearExpirationWarning,
  };
}

function computeQuoteFreshness(
  legs: OptionsPreviewLeg[],
): OptionsQuoteFreshness {
  const withCurrentQuotes = legs.filter(l => l.currentQuote !== null);
  const anyStale = withCurrentQuotes.some(l => l.currentQuote?.isStale ?? true);
  const allFresh = withCurrentQuotes.length > 0 && withCurrentQuotes.every(l => l.currentQuote?.freshnessCategory === "FRESH");
  const staleCount = withCurrentQuotes.filter(l => l.currentQuote?.isStale).length;

  const times = withCurrentQuotes.map(l => l.currentQuote?.quoteTime).filter(Boolean) as string[];
  const sorted = times.sort();
  const oldest = sorted[0] ?? null;
  const newest = sorted[sorted.length - 1] ?? null;

  let agg: "FRESH" | "AGING" | "STALE" | "UNAVAILABLE" = "UNAVAILABLE";
  if (withCurrentQuotes.length === 0) agg = "UNAVAILABLE";
  else if (anyStale) agg = "STALE";
  else if (allFresh) agg = "FRESH";
  else agg = "AGING";

  return {
    oldestQuoteTime: oldest,
    newestQuoteTime: newest,
    allFresh,
    anyStale,
    legsWithStaleQuotes: staleCount,
    totalLegs: legs.length,
    aggregateFreshnessCategory: agg,
  };
}

function computeLiquidityContext(legs: OptionsPreviewLeg[]): OptionsLiquidityContext {
  const perLegSummary = legs.map(l => ({
    legIndex: l.legIndex,
    contractSymbol: l.contractSymbol,
    category: l.liquidity.category,
  }));

  const cats = perLegSummary.map(s => s.category);
  const hasPoor = cats.includes("POOR");
  const hasLimited = cats.includes("LIMITED");
  const hasUnknown = cats.includes("UNKNOWN");
  const allStrong = cats.every(c => c === "STRONG");
  const allAcceptable = cats.every(c => c === "STRONG" || c === "ACCEPTABLE");

  let overallCategory: LiquidityCategory = "UNKNOWN";
  if (allStrong) overallCategory = "STRONG";
  else if (allAcceptable) overallCategory = "ACCEPTABLE";
  else if (hasPoor) overallCategory = "POOR";
  else if (hasLimited) overallCategory = "LIMITED";
  else if (hasUnknown) overallCategory = "UNKNOWN";
  else overallCategory = "ACCEPTABLE";

  const widestSpreadPct = legs.reduce((max, l) => {
    const s = l.liquidity.bidAskSpreadPct;
    if (s === null) return max;
    return s > (max ?? 0) ? s : max;
  }, null as number | null);

  return {
    overallCategory,
    liquidityChange: "UNKNOWN", // No prior baseline available at this stage
    perLegSummary,
    widestSpreadPct,
    note: hasPoor ? "One or more legs have poor liquidity — preview available but future execution may be difficult."
      : hasLimited ? "Some legs have limited liquidity." : "",
  };
}

function buildAssignmentExerciseContext(
  legs: OrderDraftLeg[],
  strategyFamily: string,
  covered: boolean,
): AssignmentExerciseContext {
  const hasShort = legs.some(l => isShortIntent(l.legIntent));
  const hasLong = legs.some(l => l.legIntent === "OPEN_LONG");

  // Any short options leg can be assigned — this covers all short-bearing structures
  const assignmentRisk = hasShort;

  const assignmentNote = assignmentRisk ? (
    strategyFamily === "covered_call" ? "Short call may be assigned early, transferring your shares at the strike price." :
    strategyFamily === "cash_secured_put" ? "Assignment may require purchasing shares at the put strike price." :
    strategyFamily === "collar" ? "Short call leg may be assigned. Long put provides downside protection." :
    "Short leg(s) may be assigned. Defined-risk structure limits maximum loss."
  ) : null;

  const earlyExerciseRisk = hasShort;
  const earlyExerciseNote = earlyExerciseRisk
    ? "American-style options may be exercised at any time before expiration."
    : null;

  const pathDepFamilies = ["calendar_spread", "diagonal_spread"];
  const pinRisk = hasShort;
  const pinRiskNote = pinRisk
    ? "Short strike(s) near the underlying near expiration may carry pin risk."
    : null;

  const exerciseContext = hasLong
    ? "Long option holders may choose to exercise at or before expiration."
    : null;

  const coverageRequired = ["covered_call", "collar", "protective_put"].includes(strategyFamily);

  return {
    hasShortLegs: hasShort,
    hasLongLegs: hasLong,
    assignmentRisk,
    assignmentNote,
    earlyExerciseRisk,
    earlyExerciseNote,
    pinRisk,
    pinRiskNote,
    exerciseContext,
    coverageRequired,
    coverageValidated: covered,
    coverageNote: coverageRequired
      ? (covered ? "Share coverage confirmed at draft creation." : "Share coverage not confirmed — review required.")
      : null,
  };
}

function buildEventContext(riskSnapshot: Record<string, unknown> | null): OptionsEventContext {
  const rs = riskSnapshot ?? {};
  const rawEvent = (rs as any)?.eventContext ?? (rs as any)?.eventExposure ?? null;
  if (!rawEvent) {
    return {
      status: "EVENT_UNKNOWN",
      eventType: null,
      earningsDate: null,
      insideEventWindow: false,
      note: "Event status unknown.",
    };
  }
  const containsEarnings = rawEvent.containsEarnings ?? rawEvent.insideEventWindow ?? false;
  const earningsDate = rawEvent.earningsDate ?? null;
  const eventType = rawEvent.eventType ?? (containsEarnings ? "EARNINGS" : null);

  let status: "EVENT_INSIDE_STRUCTURE_LIFE" | "EVENT_APPROACHING" | "EVENT_PASSED" | "NO_EVENT_DETECTED" | "EVENT_UNKNOWN" = "NO_EVENT_DETECTED";
  if (containsEarnings) status = "EVENT_INSIDE_STRUCTURE_LIFE";
  else if (earningsDate) status = "EVENT_APPROACHING";

  return {
    status,
    eventType,
    earningsDate,
    insideEventWindow: containsEarnings,
    note: containsEarnings
      ? "An earnings or corporate event falls within this structure's life. This may significantly affect option pricing."
      : earningsDate
      ? "An event is approaching near this structure's expiration."
      : "No earnings event detected within this structure's life.",
  };
}

function buildRiskContext(
  draft: OrderDraft,
  tradePlan: { riskSnapshot?: Record<string, unknown> | null },
  lifecycleState: string,
  thesisInvalidated: boolean,
): OptionsPreviewRiskContext {
  const rc = draft.riskContext;
  const rs = tradePlan.riskSnapshot as Record<string, unknown> | null | undefined ?? {};

  const netGreeks = (rs as any)?.greekProfile
    ? {
        netDelta: (rs as any).greekProfile.netDelta ?? null,
        netGamma: (rs as any).greekProfile.netGamma ?? null,
        netTheta: (rs as any).greekProfile.netTheta ?? null,
        netVega:  (rs as any).greekProfile.netVega  ?? null,
      }
    : null;

  const pathDependent = (rc.riskFlags ?? []).includes("PATH_DEPENDENT_PAYOFF")
    || !!(rs as any)?.payoffProfile?.isDefinedRisk === false;

  return {
    maxLoss: rc.maxLoss,
    maxGain: rc.maxGain,
    breakevens: rc.breakevens,
    capitalProfile: rc.capitalProfile,
    riskFlags: rc.riskFlags,
    constraintStatus: rc.constraintStatus,
    pathDependent,
    netGreeks,
    riskAnalysisStale: false, // Would need timestamp comparison — default false
    researchInvalidation: thesisInvalidated,
  };
}

function maskAccountRef(ref: string): string {
  if (!ref) return "••••????";
  const clean = ref.trim();
  if (clean.length <= 4) return clean;
  return "••••" + clean.slice(-4);
}

function buildBlocker(code: OptionsPreviewBlockerCode, message: string): OptionsPreviewBlocker {
  return { code, message };
}

function buildWarning(code: OptionsPreviewWarningCode, message: string, legIndex?: number): OptionsPreviewWarning {
  return legIndex !== undefined ? { code, message, legIndex } : { code, message };
}

function computeValidUntil(now: Date, draftExpiresAt: Date, preflightValidUntil: Date | null): string {
  const ttlFromNow = new Date(now.getTime() + OPTIONS_PREVIEW_DEFAULT_TTL_MS);
  const candidates: Date[] = [ttlFromNow, draftExpiresAt];
  if (preflightValidUntil) candidates.push(preflightValidUntil);
  return candidates.reduce((a, b) => a < b ? a : b).toISOString();
}

function buildUnavailablePreview(
  userId: string,
  draftId: string,
  now: Date,
  blockers: OptionsPreviewBlocker[],
  ctx?: { tradePlanId?: string; status?: OptionsPreviewStatus },
): OptionsOrderPreview {
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
    broadExpressionType: "UNKNOWN",
    selectedBy: "USER",
    strategyFamily: "monitor_only",
    strategyLabel: "Unknown",
    strategyCategory: "unknown",
    instrumentType: "OPTION",
    symbol: "UNKNOWN",
    generatedAt: nowIso,
    validUntil: nowIso,
    status: ctx?.status ?? "UNAVAILABLE",
    broker: {
      provider: "unknown", accountMasked: "••••????", accountType: "OTHER",
      executionMode: "DISABLED", executionEnabled: false,
      optionsPermissionStatus: "UNAVAILABLE",
      multiLegCapabilityStatus: "UNKNOWN",
      supportsOptionsOrders: false,
      supportedTimeInForce: [],
      buyingPowerCheckStatus: "UNAVAILABLE",
    },
    expirationContext: {
      primaryExpiration: "UNKNOWN", secondaryExpiration: null,
      hasMultipleExpirations: false, dteSummary: [],
      anyExpired: false, nearExpirationWarning: false,
    },
    legs: [],
    quantityContext: { confirmedQuantity: 0, unit: "contracts", hypotheticalPlanQuantity: null },
    orderType: "LIMIT",
    timeInForce: "DAY",
    allowExtendedHours: false,
    netStructurePricing: {
      pricingType: "UNKNOWN", amountPerUnit: null, amountPerContract: null,
      totalAmount: null, multiplier: 100, draftNetReference: null,
      draftPricingType: "UNKNOWN", differenceAbs: null, differencePct: null,
      changeLabel: "Current Structure Quote Change", allQuotesAvailable: false,
      isMidpointEstimate: true,
    },
    quoteFreshness: {
      oldestQuoteTime: null, newestQuoteTime: null, allFresh: false,
      anyStale: true, legsWithStaleQuotes: 0, totalLegs: 0,
      aggregateFreshnessCategory: "UNAVAILABLE",
    },
    liquidityContext: {
      overallCategory: "UNKNOWN", liquidityChange: "UNKNOWN",
      perLegSummary: [], widestSpreadPct: null, note: "",
    },
    riskContext: {
      maxLoss: null, maxGain: null, breakevens: [], capitalProfile: null,
      riskFlags: [], constraintStatus: "UNKNOWN",
      pathDependent: false, netGreeks: null,
      riskAnalysisStale: false, researchInvalidation: false,
    },
    assignmentExerciseContext: {
      hasShortLegs: false, hasLongLegs: false,
      assignmentRisk: false, assignmentNote: null,
      earlyExerciseRisk: false, earlyExerciseNote: null,
      pinRisk: false, pinRiskNote: null,
      exerciseContext: null, coverageRequired: false,
      coverageValidated: false, coverageNote: null,
    },
    eventContext: { status: "EVENT_UNKNOWN", eventType: null, earningsDate: null, insideEventWindow: false, note: "" },
    blockers,
    warnings: [],
    sourceIntegrity: {
      tradePlanMatches: false, tradePlanVersionMatches: false,
      broadExpressionMatches: false, strategyFamilyMatches: false,
      contractCandidateMatches: false, preflightMatches: false,
      orderDraftMatches: false, accountMatches: false,
      lifecycleCurrent: false, contractsCurrent: false,
      quotesCurrent: false, structureValid: false, allPass: false,
    },
    disclaimer: OPTIONS_PREVIEW_DISCLAIMER,
    executionPriceDisclaimer: OPTIONS_PREVIEW_PRICE_DISCLAIMER,
    optionsRiskDisclosure: OPTIONS_RISK_DISCLOSURE,
    midpointDisclaimer: OPTIONS_PREVIEW_MIDPOINT_DISCLAIMER,
    methodologyVersion: OPTIONS_PREVIEW_METHODOLOGY_VERSION,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateOptionsPreviewOptions {
  userId: string;
  draftId: string;
  deps: OptionsPreviewDeps;
}

export interface GenerateOptionsPreviewResult {
  preview: OptionsOrderPreview;
}

export async function generateOptionsPreview(
  opts: GenerateOptionsPreviewOptions,
): Promise<GenerateOptionsPreviewResult> {
  const startMs = Date.now();
  const { userId, draftId, deps } = opts;
  const now = deps.now();

  // ── Stage 1: Load OrderDraft (user-scoped) ────────────────────────────────
  const draftRow = await deps.getDraftById(draftId, userId);
  if (!draftRow) {
    const preview = buildUnavailablePreview(userId, draftId, now, [
      buildBlocker("ORDER_DRAFT_NOT_FOUND", "Order draft not found or does not belong to this account."),
    ]);
    recordMetric("UNAVAILABLE", 0, Date.now() - startMs);
    return { preview };
  }

  const draft = draftRow.draftJson as unknown as OrderDraft;

  // ── Stage 2: Draft status check ───────────────────────────────────────────
  if (draftRow.status === "ABANDONED") {
    const preview = buildUnavailablePreview(userId, draftId, now, [
      buildBlocker("ORDER_DRAFT_ABANDONED", "This order draft has been abandoned."),
    ], { tradePlanId: draftRow.tradePlanId });
    recordMetric("UNAVAILABLE", 0, Date.now() - startMs);
    return { preview };
  }

  // ── Stage 3: Draft expiry ─────────────────────────────────────────────────
  const isExpired = now > draftRow.expiresAt;
  if (isExpired || draftRow.status === "EXPIRED") {
    const preview = buildUnavailablePreview(userId, draftId, now, [
      buildBlocker("ORDER_DRAFT_EXPIRED", "This order draft has expired. Return to Order Preparation to create a new draft."),
    ], { tradePlanId: draftRow.tradePlanId, status: "EXPIRED" });
    recordMetric("EXPIRED", draft.legs?.length ?? 0, Date.now() - startMs);
    return { preview };
  }

  // ── Stage 4: Validate instrument type ────────────────────────────────────
  const instrType = draft.instrumentType;
  if (instrType !== "OPTION" && instrType !== "MULTI_LEG_OPTION") {
    const preview = buildUnavailablePreview(userId, draftId, now, [
      buildBlocker("WRONG_INSTRUMENT_TYPE",
        `Options Preview requires instrument type OPTION or MULTI_LEG_OPTION. Current: ${instrType}. Use Equity Order Preview for equity orders.`),
    ], { tradePlanId: draftRow.tradePlanId });
    recordMetric("INVALID", 0, Date.now() - startMs);
    return { preview };
  }

  // ── Stage 5: Load Trade Plan ──────────────────────────────────────────────
  const tradePlan = await deps.getTradePlan(draftRow.tradePlanId, userId);
  if (!tradePlan) {
    const preview = buildUnavailablePreview(userId, draftId, now, [
      buildBlocker("TRADE_PLAN_NOT_FOUND", "Trade plan not found."),
    ], { tradePlanId: draftRow.tradePlanId });
    recordMetric("UNAVAILABLE", 0, Date.now() - startMs);
    return { preview };
  }

  const symbol = tradePlan.symbol;

  // ── Stage 6: Validate broad expression ───────────────────────────────────
  const broadExpr = tradePlan.broadExpressionType ?? null;
  if (broadExpr && broadExpr === "STOCK") {
    const preview = buildUnavailablePreview(userId, draftId, now, [
      buildBlocker("WRONG_EXPRESSION_TYPE",
        `Options Preview requires an options-side broad expression. Current: ${broadExpr}. This draft is for Equity Order Preview.`),
    ], { tradePlanId: draftRow.tradePlanId });
    recordMetric("INVALID", 0, Date.now() - startMs);
    return { preview };
  }

  // ── Stage 7: Validate selectedBy USER ────────────────────────────────────
  // selectedBy is always USER — we read from trade plan but always output "USER"

  // ── Stage 8: Strategy family ──────────────────────────────────────────────
  const strategyFamily = (draft.structureType as any) ?? "monitor_only";
  const strategyLabel = STRATEGY_FAMILY_LABELS[strategyFamily] ?? strategyFamily.replace(/_/g, " ");
  const strategyCategory = strategyFamily;

  // ── Stage 9: Load Preflight ───────────────────────────────────────────────
  const preflight = await deps.getPreflightResult(draftRow.preflightId, draftRow.tradePlanId, userId);
  if (!preflight) {
    const preview = buildUnavailablePreview(userId, draftId, now, [
      buildBlocker("PREFLIGHT_MISSING", "Execution preflight result not found. Run Execution Preflight again."),
    ], { tradePlanId: draftRow.tradePlanId });
    recordMetric("INVALID", draft.legs?.length ?? 0, Date.now() - startMs);
    return { preview };
  }

  const preflightExpired = preflight.validUntil && now > preflight.validUntil;
  const preflightNotPassing = preflight.status !== "PASS";

  // ── Stage 10: Plan version mismatch ──────────────────────────────────────
  const planVersionMismatch = draftRow.tradePlanVersion !== (tradePlan.version ?? draftRow.tradePlanVersion);

  // ── Stage 11: Lifecycle state ─────────────────────────────────────────────
  const lifecycleState = await deps.getCurrentLifecycleState(draftRow.tradePlanId, userId) ?? "UNKNOWN";
  const thesisInvalidated = lifecycleState === "THESIS_INVALIDATED";
  const lifecycleChanged = ["REQUIRES_REVIEW", "DATA_STALE", "CHANGED"].includes(lifecycleState);

  // ── Stage 12: Broker context ──────────────────────────────────────────────
  const brokerRaw = await deps.getBrokerContext(userId, draft.brokerAccountRef, draft.brokerProvider);
  const buyingPowerStatus = await deps.getBuyingPowerStatus(userId, draft.brokerAccountRef);
  const isMultiLeg = instrType === "MULTI_LEG_OPTION" || (draft.legs?.length ?? 0) > 1;

  const multiLegCapability = (() => {
    if (!brokerRaw) return "UNKNOWN" as const;
    if (!brokerRaw.supportsMultiLegOrders) return "UNSUPPORTED" as const;
    return "UNKNOWN" as const;
  })();

  const brokerContext: OptionsPreviewBrokerContext = {
    provider: draft.brokerProvider,
    accountMasked: draft.brokerAccountMasked || maskAccountRef(draft.brokerAccountRef),
    accountType: draft.brokerAccountType ?? "OTHER",
    executionMode: (draft.executionMode as any) ?? "DISABLED",
    executionEnabled: deps.isExecutionEnabled(),
    optionsPermissionStatus: brokerRaw?.optionsPermissionStatus ?? "UNAVAILABLE",
    multiLegCapabilityStatus: multiLegCapability,
    supportsOptionsOrders: brokerRaw?.supportsOptionsOrders ?? false,
    supportedTimeInForce: brokerRaw?.supportedTimeInForce ?? ["DAY"],
    buyingPowerCheckStatus: buyingPowerStatus,
  };

  // ── Stage 13: Revalidate contracts — fetch current quotes (batched) ───────
  const legs = draft.legs ?? [];
  const contractSymbols = legs.filter(l => l.symbol && l.instrumentType === "OPTION").map(l => l.symbol);
  const currentQuoteMap = await deps.getLegQuotes(contractSymbols, userId);

  // ── Stage 14: Build preview legs ─────────────────────────────────────────
  const previewLegs: OptionsPreviewLeg[] = legs.map(leg => {
    const qData = currentQuoteMap.get(leg.symbol);
    const dte = leg.expiration ? computeDTE(leg.expiration, now) : 0;
    const expired = leg.expiration ? isExpirationPast(leg.expiration, now) : false;

    const draftLegQuote = (draft.quoteSnapshot?.optionLegs ?? []).find(q => q.contractSymbol === leg.symbol) ?? null;
    const draftQuote = buildLegQuoteFromDraft(draftLegQuote);
    const currentQuote = qData ? buildLegQuoteFromCurrent(qData) : null;

    const draftMid = draftQuote?.midpoint ?? null;
    const currentMid = currentQuote?.midpoint ?? null;

    const role = roleFromLegIntent(leg.legIntent);
    const roleLabel = LEG_ROLE_LABELS[role] ?? role;
    const canonicalIntentLabel = CANONICAL_INTENT_LABELS[leg.legIntent] ?? leg.legIntent;

    const greeks = qData ? buildLegGreeks(qData) : null;
    const liquidity = qData ? buildLegLiquidity(qData, leg.symbol) : {
      openInterest: null, volume: null,
      bidAskSpreadAbs: null, bidAskSpreadPct: null,
      category: "UNKNOWN" as LiquidityCategory,
    };

    const status = expired ? "EXPIRED"
      : !qData || !qData.contractExists ? "UNAVAILABLE"
      : qData.isStale ? "STALE_QUOTE"
      : "AVAILABLE";

    const legWarnings: string[] = [];
    if (expired) legWarnings.push("Contract has expired.");
    else if (dte <= OPTIONS_DTE_NEAR_EXPIRATION) legWarnings.push(`Near expiration: ${dte} DTE.`);
    if (qData && !qData.isStale && currentQuote?.isCrossed) legWarnings.push("Crossed market (ask < bid).");
    if (liquidity.bidAskSpreadPct !== null && liquidity.bidAskSpreadPct > OPTIONS_WIDE_SPREAD_THRESHOLD_PCT) {
      legWarnings.push("Wide bid/ask spread.");
    }

    return {
      legIndex: leg.legIndex,
      role,
      roleLabel,
      canonicalIntent: leg.legIntent,
      canonicalIntentLabel,
      contractSymbol: leg.symbol,
      optionType: leg.optionType ?? "call",
      expiration: leg.expiration ?? "UNKNOWN",
      dte,
      expirationLabel: leg.expiration ? formatExpiration(leg.expiration, dte) : "Unknown",
      isExpired: expired,
      strike: leg.strike ?? 0,
      ratio: leg.ratio,
      quantity: leg.quantity,
      multiplier: OPTIONS_MULTIPLIER_DEFAULT,
      draftQuote,
      currentQuote,
      quoteChangeCategory: quoteChangeCategory(currentMid, draftMid),
      quoteMidpointChangeAbs: currentMid !== null && draftMid !== null ? currentMid - draftMid : null,
      quoteMidpointChangePct: currentMid !== null && draftMid !== null && draftMid !== 0
        ? ((currentMid - draftMid) / draftMid) * 100 : null,
      liquidity,
      greeks,
      status,
      warnings: legWarnings,
    };
  });

  // ── Stage 15: Compute expiration context ──────────────────────────────────
  const expirationContext = computeExpirationContext(legs, now);

  // ── Stage 16: Net pricing ─────────────────────────────────────────────────
  const netPricing = computeNetPricing(
    legs,
    currentQuoteMap,
    {
      estimatedDebit: draft.capitalContext.estimatedDebit,
      estimatedCredit: draft.capitalContext.estimatedCredit,
    },
    OPTIONS_MULTIPLIER_DEFAULT,
    draft.quantityContext.confirmedQuantity,
  );

  // ── Stage 17: Quote freshness + liquidity ────────────────────────────────
  const quoteFreshness = computeQuoteFreshness(previewLegs);
  const liquidityContext = computeLiquidityContext(previewLegs);

  // ── Stage 18: Risk context ────────────────────────────────────────────────
  const riskContext = buildRiskContext(draft, tradePlan, lifecycleState, thesisInvalidated);
  const assignmentExContext = buildAssignmentExerciseContext(
    legs, strategyFamily, draft.riskContext.coverageValidated,
  );
  const eventContext = buildEventContext(tradePlan.riskSnapshot ?? null);

  // ── Stage 19: Accumulate blockers ─────────────────────────────────────────
  const blockers: OptionsPreviewBlocker[] = [];
  const warnings: OptionsPreviewWarning[] = [];

  if (planVersionMismatch) {
    blockers.push(buildBlocker("TRADE_PLAN_VERSION_CHANGED",
      "Trade plan has been updated since this draft was created. Return to Order Preparation."));
  }
  if (preflightExpired) {
    blockers.push(buildBlocker("PREFLIGHT_EXPIRED",
      "Execution preflight has expired. Run Execution Preflight again."));
  } else if (preflightNotPassing) {
    blockers.push(buildBlocker("PREFLIGHT_NOT_PASSING",
      "Execution preflight did not pass. Review preflight results."));
  }
  if (thesisInvalidated) {
    blockers.push(buildBlocker("LIFECYCLE_THESIS_INVALIDATED",
      "Research thesis has been invalidated. Review lifecycle status."));
  } else if (lifecycleChanged) {
    blockers.push(buildBlocker("LIFECYCLE_CHANGED",
      "Trade plan lifecycle state has changed. Review before proceeding."));
  }
  if (!brokerRaw?.connected) {
    blockers.push(buildBlocker("BROKER_DISCONNECTED",
      "Broker connection is unavailable. Reconnect your broker account."));
  }
  if (brokerRaw?.optionsPermissionStatus === "INSUFFICIENT") {
    blockers.push(buildBlocker("OPTIONS_PERMISSION_INSUFFICIENT",
      "Your account does not have sufficient permissions for this options structure."));
  }
  if (buyingPowerStatus === "FAIL") {
    blockers.push(buildBlocker("INSUFFICIENT_BUYING_POWER",
      "Buying power check did not pass. Review your account balance."));
  }
  if (!brokerContext.supportedTimeInForce.includes(draft.timeInForceContext.timeInForce)) {
    blockers.push(buildBlocker("TIF_UNSUPPORTED",
      `Time in force "${draft.timeInForceContext.timeInForce}" is not supported by this provider.`));
  }

  // Contract-level blockers
  const anyContractExpired = previewLegs.some(l => l.status === "EXPIRED");
  const anyContractUnavailable = previewLegs.some(l => l.status === "UNAVAILABLE");
  if (anyContractExpired) {
    blockers.push(buildBlocker("CONTRACT_EXPIRED",
      "One or more contracts in this draft have expired. Return to Contract Research to select a new candidate."));
  }
  if (anyContractUnavailable) {
    blockers.push(buildBlocker("CONTRACT_UNAVAILABLE",
      "One or more contracts cannot be validated. The original contract may no longer be available."));
  }
  if (quoteFreshness.anyStale || quoteFreshness.aggregateFreshnessCategory === "UNAVAILABLE") {
    blockers.push(buildBlocker("QUOTE_STALE",
      "One or more contract quotes are stale or unavailable. Refresh preview."));
  }
  if (assignmentExContext.coverageRequired && !assignmentExContext.coverageValidated) {
    blockers.push(buildBlocker("COVERAGE_NOT_CONFIRMED",
      "Share coverage is required for this strategy but was not confirmed. Review position."));
  }

  // ── Stage 20: Warnings ────────────────────────────────────────────────────
  if (!deps.isExecutionEnabled()) {
    warnings.push(buildWarning("EXECUTION_DISABLED",
      "Broker submission is currently disabled. Preview is available; submission is not."));
  }
  if (draft.pricingContext.orderType === "MARKET") {
    warnings.push(buildWarning("MARKET_ORDER_OPTIONS_WARNING",
      "Market orders for options carry heightened price uncertainty. Consider using a limit order."));
  }
  const sessionState = draft.marketHoursContext?.sessionState ?? "UNKNOWN";
  if (sessionState === "CLOSED") {
    warnings.push(buildWarning("MARKET_CLOSED", "The market is currently closed. Any future order would be queued."));
  } else if (sessionState === "PRE_MARKET") {
    warnings.push(buildWarning("PRE_MARKET", "Pre-market session is active."));
  } else if (sessionState === "AFTER_HOURS") {
    warnings.push(buildWarning("AFTER_HOURS", "After-hours session is active."));
  }
  if (preflight.validUntil && !preflightExpired) {
    const secToExpiry = (new Date(preflight.validUntil).getTime() - now.getTime()) / 1000;
    if (secToExpiry < OPTIONS_PREVIEW_PREFLIGHT_WARNING_SEC) {
      warnings.push(buildWarning("PREFLIGHT_EXPIRY_APPROACHING",
        "Execution preflight will expire soon. Refresh preview or re-run preflight."));
    }
  }
  if (isMultiLeg && (multiLegCapability as string) !== "SUPPORTED") {
    warnings.push(buildWarning("MULTI_LEG_NOT_SUPPORTED",
      `This provider does not currently support native multi-leg order submission for this structure. Preview is available; future execution progression will be blocked until multi-leg support is confirmed. No leg decomposition is performed.`));
  }
  if (expirationContext.nearExpirationWarning) {
    warnings.push(buildWarning("NEAR_EXPIRATION",
      "One or more legs are within 7 days of expiration. Time decay accelerates near expiration."));
    warnings.push(buildWarning("TIME_DECAY_ACCELERATING",
      "Theta (time decay) accelerates as expiration approaches, particularly for long options."));
  }
  const hasPartialGreeks = previewLegs.some(l => l.greeks && (
    l.greeks.delta === null || l.greeks.gamma === null ||
    l.greeks.theta === null || l.greeks.vega === null
  ));
  if (hasPartialGreeks) {
    warnings.push(buildWarning("PARTIAL_GREEKS",
      "Some Greeks are unavailable for one or more legs. Partial Greek coverage only."));
  }
  if (liquidityContext.overallCategory === "POOR" || liquidityContext.overallCategory === "LIMITED") {
    warnings.push(buildWarning("LOW_OPEN_INTEREST",
      "Limited liquidity detected. Execution prices may differ materially from quoted midpoints."));
  }
  if (previewLegs.some(l => l.liquidity.bidAskSpreadPct !== null && l.liquidity.bidAskSpreadPct > OPTIONS_WIDE_SPREAD_THRESHOLD_PCT)) {
    warnings.push(buildWarning("WIDE_SPREAD",
      "Wide bid/ask spread detected on one or more legs. Net debit/credit references may be imprecise."));
  }
  if (assignmentExContext.assignmentRisk) {
    warnings.push(buildWarning("ASSIGNMENT_RISK", assignmentExContext.assignmentNote ?? "Short leg(s) carry assignment risk."));
  }
  if (assignmentExContext.earlyExerciseRisk) {
    warnings.push(buildWarning("EARLY_EXERCISE_RISK", assignmentExContext.earlyExerciseNote ?? "Early exercise risk on short options."));
  }
  if (riskContext.pathDependent) {
    warnings.push(buildWarning("PATH_DEPENDENT",
      "This structure's payoff is path-dependent. Max gain/loss is not derivable from a fixed formula."));
  }
  if (eventContext.insideEventWindow) {
    warnings.push(buildWarning("EVENT_INSIDE_STRUCTURE",
      "An earnings or corporate event falls within this structure's life."));
  }
  const materialMoves = previewLegs.filter(l => l.quoteChangeCategory === "MATERIAL_CHANGE");
  if (materialMoves.length > 0) {
    warnings.push(buildWarning("QUOTE_MOVED",
      `Current quote(s) differ materially from draft reference on ${materialMoves.length} leg(s). Draft values are unchanged.`));
  }

  // ── Stage 21: Source integrity ────────────────────────────────────────────
  const expressionOk = !broadExpr || broadExpr !== "STOCK";
  const quotesCurrentFlag = !quoteFreshness.anyStale && quoteFreshness.totalLegs > 0;
  const sourceIntegrity: OptionsPreviewSourceIntegrity = {
    tradePlanMatches: !!tradePlan,
    tradePlanVersionMatches: !planVersionMismatch,
    broadExpressionMatches: expressionOk,
    strategyFamilyMatches: true, // strategy family is taken from draft, always matches
    contractCandidateMatches: !anyContractUnavailable && !anyContractExpired,
    preflightMatches: !!preflight && !preflightExpired && !preflightNotPassing,
    orderDraftMatches: !!draftRow,
    accountMatches: !!(brokerRaw?.connected),
    lifecycleCurrent: !thesisInvalidated && !lifecycleChanged,
    contractsCurrent: !anyContractExpired && !anyContractUnavailable,
    quotesCurrent: quotesCurrentFlag,
    structureValid: legs.length > 0,
    allPass: !planVersionMismatch && !!preflight && !preflightExpired && !preflightNotPassing
      && !thesisInvalidated && !anyContractExpired && !anyContractUnavailable
      && quotesCurrentFlag && expressionOk && legs.length > 0,
  };

  // ── Stage 22: Determine status ────────────────────────────────────────────
  const criticalBlockerCodes: OptionsPreviewBlockerCode[] = [
    "ORDER_DRAFT_NOT_FOUND", "ORDER_DRAFT_EXPIRED", "ORDER_DRAFT_ABANDONED",
    "WRONG_INSTRUMENT_TYPE", "WRONG_EXPRESSION_TYPE", "TRADE_PLAN_NOT_FOUND",
    "CONTRACT_EXPIRED", "CONTRACT_UNAVAILABLE",
  ];
  let status: OptionsPreviewStatus = "VALID";
  if (blockers.some(b => criticalBlockerCodes.includes(b.code))) {
    status = "INVALID";
  } else if (blockers.length > 0) {
    status = "REQUIRES_REVIEW";
  } else if (warnings.some(w => w.code === "PREFLIGHT_EXPIRY_APPROACHING")) {
    status = "REQUIRES_REVIEW";
  }

  // ── Stage 23: ValidUntil ──────────────────────────────────────────────────
  const validUntil = computeValidUntil(now, draftRow.expiresAt, preflight.validUntil);

  // ── Stage 24: Build preview ───────────────────────────────────────────────
  const preview: OptionsOrderPreview = {
    executable: false as const,
    id: randomUUID(),
    userId,
    tradePlanId: draftRow.tradePlanId,
    tradePlanVersion: draftRow.tradePlanVersion,
    preflightId: draftRow.preflightId,
    orderDraftId: draftId,
    orderDraftVersion: draftRow.version,
    broadExpressionType: broadExpr ?? "LONG_OPTIONS",
    selectedBy: "USER",
    strategyFamily: strategyFamily as any,
    strategyLabel,
    strategyCategory,
    instrumentType: instrType as "OPTION" | "MULTI_LEG_OPTION",
    symbol,
    companyName: tradePlan.companyName ?? undefined,
    generatedAt: now.toISOString(),
    validUntil,
    status,
    broker: brokerContext,
    expirationContext,
    legs: previewLegs,
    quantityContext: {
      confirmedQuantity: draft.quantityContext.confirmedQuantity,
      unit: "contracts",
      hypotheticalPlanQuantity: draft.quantityContext.hypotheticalPlanQuantity,
    },
    orderType: draft.pricingContext.orderType,
    timeInForce: draft.timeInForceContext.timeInForce,
    allowExtendedHours: draft.pricingContext.extendedHoursRequested,
    netStructurePricing: netPricing,
    quoteFreshness,
    liquidityContext,
    riskContext,
    assignmentExerciseContext: assignmentExContext,
    eventContext,
    blockers,
    warnings,
    sourceIntegrity,
    disclaimer: OPTIONS_PREVIEW_DISCLAIMER,
    executionPriceDisclaimer: OPTIONS_PREVIEW_PRICE_DISCLAIMER,
    optionsRiskDisclosure: OPTIONS_RISK_DISCLOSURE,
    midpointDisclaimer: OPTIONS_PREVIEW_MIDPOINT_DISCLAIMER,
    methodologyVersion: OPTIONS_PREVIEW_METHODOLOGY_VERSION,
  };

  // ── Stage 25: Audit event ─────────────────────────────────────────────────
  const latencyMs = Date.now() - startMs;
  try {
    await deps.appendAuditEvent({
      userId,
      tradePlanId: draftRow.tradePlanId,
      eventType: "OPTIONS_PREVIEW_GENERATED",
      provider: draft.brokerProvider,
      accountRefMasked: draft.brokerAccountMasked,
      metadata: {
        strategyFamily,
        legCount: legs.length,
        instrumentType: instrType,
        status,
        blockerCount: blockers.length,
        warningCount: warnings.length,
        durationMs: latencyMs,
        hasEventRisk: eventContext.insideEventWindow,
        hasAssignmentRisk: assignmentExContext.assignmentRisk,
      },
    });
  } catch { /* fire-and-forget */ }

  recordMetric(status, legs.length, latencyMs);
  return { preview };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB DEPS FACTORY
// ─────────────────────────────────────────────────────────────────────────────

export function createDbOptionsPreviewDeps(_userId: string): OptionsPreviewDeps {
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
      const r = rows[0] as any;
      return {
        id: r.id, userId: r.userId, tradePlanId: r.tradePlanId,
        tradePlanVersion: r.tradePlanVersion ?? 1,
        preflightId: r.preflightId,
        draftJson: r.draftJson as Record<string, unknown>,
        status: r.status, version: r.version ?? 1,
        expiresAt: r.expiresAt instanceof Date ? r.expiresAt : new Date(r.expiresAt ?? Date.now() + 3600000),
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
      const r = rows[0] as any;
      return {
        id: r.id, userId: r.userId, symbol: r.symbol,
        companyName: null,
        version: r.version ?? r.currentVersion ?? 1,
        broadExpressionType: r.broadExpressionType ?? null,
        expressionSelectedBy: r.expressionSelectedBy ?? null,
        researchSnapshot: r.researchSnapshot as Record<string, unknown> | null,
        riskSnapshot: r.riskSnapshot as Record<string, unknown> | null,
        status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt,
      };
    },

    async getPreflightResult(preflightId, _tradePlanId, _uid) {
      const { db } = await import("../db");
      const { executionPreflights } = await import("../../shared/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db.select().from(executionPreflights)
        .where(eq(executionPreflights.id, preflightId))
        .limit(1);
      if (!rows[0]) return null;
      const r = rows[0] as any;
      return {
        id: r.id, status: r.status,
        evaluatedAt: r.evaluatedAt instanceof Date ? r.evaluatedAt : new Date(r.evaluatedAt ?? Date.now()),
        validUntil: r.validUntil ? (r.validUntil instanceof Date ? r.validUntil : new Date(r.validUntil)) : null,
        resultJson: (r.resultJson ?? {}) as Record<string, unknown>,
      };
    },

    async getCurrentLifecycleState(tradePlanId, _uid) {
      try {
        const { db } = await import("../db");
        const { tradePlanActivity } = await import("../../shared/schema");
        const { eq, desc } = await import("drizzle-orm");
        const rows = await db.select().from(tradePlanActivity)
          .where(eq(tradePlanActivity.tradePlanId, tradePlanId))
          .orderBy(desc(tradePlanActivity.observedAt))
          .limit(1);
        const row = rows[0] as any;
        return row?.currentState ?? row?.lifecycleState ?? null;
      } catch { return null; }
    },

    async getLegQuotes(_symbols, _uid) {
      // Options contract live quotes require a connected broker adapter that supports
      // options chains (Sprint 2.7.3+). The reference-snapshot service is for equity
      // bars only and does not provide options contract bid/ask/greeks.
      // Return an empty map — the preview engine will generate QUOTE_STALE blockers
      // and prompt the user to ensure broker connectivity (Sprint 2.8.4).
      return new Map<string, CurrentLegQuoteData>();
    },

    async getBuyingPowerStatus(_uid, _accountRef) {
      return "UNAVAILABLE" as const;
    },

    async getBrokerContext(_uid, accountRef, provider) {
      try {
        const { getProviderCapabilityMatrix } = await import("./broker-execution-adapter");
        const cap = getProviderCapabilityMatrix(provider);
        const supportsMulti = (cap as any).multiLeg === "SUPPORTED";
        return {
          connected: false, // Live broker connection check is Sprint 2.8.4
          executionMode: "DISABLED",
          executionEnabled: false,
          accountMasked: accountRef.length > 4 ? "••••" + accountRef.slice(-4) : accountRef,
          accountType: "MARGIN",
          supportsOptionsOrders: cap.options === "SUPPORTED",
          supportsMultiLegOrders: supportsMulti,
          optionsPermissionStatus: "UNAVAILABLE" as const,
          supportedTimeInForce: ["DAY", "GTC"],
        };
      } catch { return null; }
    },

    async appendAuditEvent(event) {
      try {
        const { db } = await import("../db");
        const schema = await import("../../shared/schema");
        const auditTable = (schema as any).executionAuditEvents;
        if (!auditTable) return;
        await db.insert(auditTable).values({
          id: randomUUID(),
          userId: event.userId,
          tradePlanId: event.tradePlanId,
          eventType: event.eventType,
          provider: event.provider ?? null,
          accountRefMasked: event.accountRefMasked ?? null,
          metadata: event.metadata,
          createdAt: new Date(),
        });
      } catch { /* fire-and-forget */ }
    },

    isExecutionEnabled() {
      return process.env.BROKER_EXECUTION_ENABLED === "true";
    },
  };
}

export async function ensureOptionsPreviewTables(): Promise<void> {
  // No new DB tables for Sprint 2.8.3.
  // Preview is ephemeral; audit events use existing execution_audit_events.
}
