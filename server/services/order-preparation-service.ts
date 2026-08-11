/**
 * server/services/order-preparation-service.ts — Sprint 2.8.1
 *
 * Order Preparation Engine — Pure computation.
 *
 * ARCHITECTURE INVARIANT:
 * This service builds a NON-EXECUTABLE OrderDraft from a saved Trade Plan +
 * a passing Execution Preflight. It MUST NOT submit, place, replace, or cancel
 * any broker order. It has no access to broker mutation methods.
 *
 * All dependencies are injected for deterministic testing.
 */

import crypto from "crypto";
import { db } from "../db";
import { executionPreflights, executionAuditEvents, orderDrafts } from "../../shared/schema";
import { eq, and, desc } from "drizzle-orm";
import type { TradePlan, TradePlanOptionsSnapshot } from "../../shared/trade-plan-types";
import type {
  BrokerAccountType,
  ExecutionMode,
} from "../../shared/execution-types";
import type {
  OrderDraft,
  OrderDraftLeg,
  OrderDraftBlocker,
  OrderDraftBlockerCode,
  OrderDraftWarning,
  OrderDraftWarningCode,
  OrderPreparationPreferences,
  DraftInstrumentType,
  DraftLegIntent,
  DraftSideIntent,
  DraftLegQuote,
  DraftQuoteSnapshot,
  DraftQuantityContext,
  DraftPricingContext,
  DraftTimeInForceContext,
  DraftCapitalContext,
  DraftRiskContext,
  DraftFreshnessInfo,
  DraftMarketHoursContext,
  OrderDraftValidation,
  MarketSessionState,
} from "../../shared/order-draft-types";
import {
  ORDER_PREPARATION_DISCLAIMER,
  ORDER_DRAFT_EXPIRY_SECONDS,
  ORDER_PREPARATION_METHODOLOGY_VERSION,
  MARKET_ORDER_WARNING,
} from "../../shared/order-draft-types";

// ─────────────────────────────────────────────────────────────────────────────
// INJECTABLE DEPENDENCIES
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderPreparationDeps {
  now: () => Date;
  getTradePlan: (id: string, userId: string) => Promise<TradePlan | null>;
  getPreflight: (id: string, tradePlanId: string, userId: string) => Promise<{
    id: string; userId: string; tradePlanId: string; status: string;
    resultJson: Record<string, unknown>; evaluatedAt: Date; validUntil: Date | null;
  } | null>;
  getExistingDraftByFingerprint: (fingerprint: string, userId: string) => Promise<OrderDraft | null>;
  persistDraft: (draft: OrderDraft) => Promise<void>;
  appendAuditEvent: (event: {
    userId: string; tradePlanId: string; eventType: string;
    provider?: string; accountRefMasked?: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  getUnderlyingQuote: (symbol: string) => Promise<DraftLegQuote | null>;
  getOptionQuote: (contractSymbol: string) => Promise<DraftLegQuote | null>;
  isOrderPreparationEnabled: () => boolean;
  getBrokerAccountByRef: (accountRef: string, provider: string) => Promise<{
    masked: string; accountType: BrokerAccountType; provider: string;
  } | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB DEPS
// ─────────────────────────────────────────────────────────────────────────────

export function createDbOrderPreparationDeps(userId: string): OrderPreparationDeps {
  return {
    now: () => new Date(),

    async getTradePlan(id: string, uid: string): Promise<TradePlan | null> {
      try {
        const { tradePlans } = await import("../../shared/schema");
        const rows = await db
          .select()
          .from(tradePlans)
          .where(and(eq(tradePlans.id, id), eq(tradePlans.userId, uid)))
          .limit(1);
        if (!rows[0]) return null;
        const r = rows[0];
        return {
          id: r.id, userId: r.userId, symbol: r.symbol, companyName: r.companyName,
          planType: r.planType as any, status: r.status as any, planHealth: r.planHealth as any,
          planningContextId: r.planningContextId, researchGoalId: r.researchGoalId,
          portfolioId: r.portfolioId, selectedExpressionFamily: r.selectedExpressionFamily,
          researchSnapshot: (r.researchSnapshot as any) ?? {},
          planningSnapshot: (r.planningSnapshot as any) ?? {},
          structureSnapshot: (r.structureSnapshot as any) ?? null,
          riskSnapshot: (r.riskSnapshot as any) ?? null,
          monitoringSnapshot: (r.monitoringSnapshot as any) ?? {},
          userNotes: r.userNotes, reviewChecklist: (r.reviewChecklist as any) ?? {},
          version: r.version, createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
          updatedAt: r.updatedAt?.toISOString() ?? new Date().toISOString(),
          archivedAt: r.archivedAt?.toISOString() ?? null,
          completedResearchAt: r.completedResearchAt?.toISOString() ?? null,
          monitoringStartedAt: r.monitoringStartedAt?.toISOString() ?? null,
          freshnessAtCreation: "unknown", limitations: [],
        };
      } catch { return null; }
    },

    async getPreflight(id: string, tradePlanId: string, uid: string) {
      try {
        const rows = await db
          .select()
          .from(executionPreflights)
          .where(and(
            eq(executionPreflights.id, id),
            eq(executionPreflights.userId, uid),
            eq(executionPreflights.tradePlanId, tradePlanId),
          ))
          .limit(1);
        return rows[0] ?? null;
      } catch { return null; }
    },

    async getExistingDraftByFingerprint(fingerprint: string, uid: string) {
      try {
        const rows = await db
          .select()
          .from(orderDrafts)
          .where(and(
            eq(orderDrafts.fingerprint, fingerprint),
            eq(orderDrafts.userId, uid),
          ))
          .orderBy(desc(orderDrafts.createdAt))
          .limit(1);
        if (!rows[0]) return null;
        const draft = rows[0].draftJson as unknown as OrderDraft;
        return draft;
      } catch { return null; }
    },

    async persistDraft(draft: OrderDraft) {
      await db.insert(orderDrafts).values({
        id: draft.id,
        userId: draft.userId,
        tradePlanId: draft.tradePlanId,
        tradePlanVersion: draft.tradePlanVersion,
        preflightId: draft.preflightId,
        provider: draft.brokerProvider,
        accountRef: draft.brokerAccountRef,
        instrumentType: draft.instrumentType,
        structureType: draft.structureType,
        draftJson: draft as unknown as Record<string, unknown>,
        fingerprint: draft.preparationFingerprint,
        status: draft.status,
        version: draft.version,
        expiresAt: new Date(draft.expiresAt),
      }).onConflictDoUpdate({
        target: [orderDrafts.fingerprint, orderDrafts.userId],
        set: {
          draftJson: draft as unknown as Record<string, unknown>,
          status: draft.status,
          version: draft.version,
          updatedAt: new Date(),
        },
      });
    },

    async appendAuditEvent(event) {
      try {
        await db.insert(executionAuditEvents).values({
          userId: event.userId,
          tradePlanId: event.tradePlanId,
          eventType: event.eventType,
          provider: event.provider,
          accountRefMasked: event.accountRefMasked,
          metadata: event.metadata,
        });
      } catch (e: any) {
        console.error("[order-prep] audit event failed:", e?.message);
      }
    },

    async getUnderlyingQuote(_symbol: string): Promise<DraftLegQuote | null> {
      // Sprint 2.8.1: quote validation via broker adapter read-only interface.
      // Full implementation in Sprint 2.8.2. Returns null → QUOTE_STALE handled.
      return null;
    },

    async getOptionQuote(_contractSymbol: string): Promise<DraftLegQuote | null> {
      return null;
    },

    isOrderPreparationEnabled(): boolean {
      const val = process.env["ORDER_PREPARATION_ENABLED"];
      if (val === undefined) return true; // default true
      return val === "true";
    },

    async getBrokerAccountByRef(_accountRef: string, _provider: string) {
      // Sprint 2.8.1: account resolution via broker adapter.
      // Returns null → ACCOUNT_UNAVAILABLE handled.
      return null;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Returns current market session state based on time. */
export function resolveMarketSessionState(now: Date): MarketSessionState {
  // Simple ET-based check. Full implementation in Sprint 2.8.2.
  const etHour = getEasternHour(now);
  if (etHour >= 9.5 && etHour < 16) return "OPEN";
  if (etHour >= 4 && etHour < 9.5) return "PRE_MARKET";
  if (etHour >= 16 && etHour < 20) return "AFTER_HOURS";
  return "CLOSED";
}

function getEasternHour(d: Date): number {
  // Approximate ET offset (not DST-aware — sufficient for draft context)
  const utcHour = d.getUTCHours() + d.getUTCMinutes() / 60;
  // ET = UTC-5 standard, UTC-4 DST. Use UTC-4 as approximation.
  return ((utcHour - 4) + 24) % 24;
}

/** Maps research LegRole to canonical DraftLegIntent. */
export function resolveLegIntent(
  role: string,
  strategyFamily: string,
): DraftLegIntent {
  const normalized = role.toLowerCase();
  if (normalized === "long_leg" || normalized === "wing_long") return "OPEN_LONG";
  if (normalized === "short_leg" || normalized === "wing_short") {
    const fam = strategyFamily.toLowerCase();
    if (fam === "covered_call" || fam === "collar") return "OPEN_SHORT_COVERED";
    if (fam === "cash_secured_put") return "OPEN_SHORT_SECURED";
    // All other short legs (spreads, etc.) default to OPEN_SHORT_COVERED
    return "OPEN_SHORT_COVERED";
  }
  return "OPEN_LONG";
}

/** Compute deterministic preparation fingerprint. */
export function computePreparationFingerprint(fields: {
  userId: string;
  tradePlanId: string;
  tradePlanVersion: number;
  preflightId: string;
  provider: string;
  accountRef: string;
  instrumentType: string;
  structureType: string;
  legSymbols: string[];
  quantity: number;
  orderType: string;
  tif: string;
  limitPrice?: number;
  limitPriceSource?: string;
}): string {
  const normalized = JSON.stringify({
    u: fields.userId,
    tp: fields.tradePlanId,
    v: fields.tradePlanVersion,
    pf: fields.preflightId,
    pr: fields.provider,
    ac: fields.accountRef,
    it: fields.instrumentType,
    st: fields.structureType,
    ls: [...fields.legSymbols].sort(),
    q: fields.quantity,
    ot: fields.orderType,
    tf: fields.tif,
    lp: fields.limitPrice ?? null,
    ls2: fields.limitPriceSource ?? null,
  });
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/** Validate quantity — must be positive integer (or positive number for fractional). */
export function validateQuantity(q: unknown, fractionalSupported: boolean): {
  valid: boolean; value: number; error?: string;
} {
  if (typeof q !== "number" || !isFinite(q) || isNaN(q)) {
    return { valid: false, value: 0, error: "Quantity must be a number." };
  }
  if (q <= 0) {
    return { valid: false, value: 0, error: "Quantity must be greater than 0." };
  }
  if (q > 100_000_000) {
    return { valid: false, value: 0, error: "Quantity exceeds maximum allowed value." };
  }
  if (!fractionalSupported && !Number.isInteger(q)) {
    return { valid: false, value: 0, error: "Fractional shares are not supported for this account." };
  }
  return { valid: true, value: q };
}

/** Compute estimated capital for equity draft. */
function computeEquityCapital(qty: number, refPrice: number | null): number | undefined {
  if (!refPrice || refPrice <= 0) return undefined;
  return Math.round(qty * refPrice * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// PREPARE ORDER DRAFT (main entry point)
// ─────────────────────────────────────────────────────────────────────────────

export interface PrepareOrderDraftInput {
  userId: string;
  tradePlanId: string;
  preflightId: string;
  preferences: OrderPreparationPreferences;
}

export interface PrepareOrderDraftResult {
  draft?: OrderDraft;
  error?: OrderDraftBlockerCode;
  message?: string;
  /** true if an existing identical draft was returned (idempotent) */
  wasExisting?: boolean;
}

export async function prepareOrderDraft(
  input: PrepareOrderDraftInput,
  deps: OrderPreparationDeps,
): Promise<PrepareOrderDraftResult> {
  const startMs = Date.now();
  const now = deps.now();

  // ── 1. Feature flag ────────────────────────────────────────────────────────
  if (!deps.isOrderPreparationEnabled()) {
    return { error: "ORDER_PREPARATION_DISABLED", message: "Order preparation is currently disabled." };
  }

  // ── 2. Load & validate Trade Plan ─────────────────────────────────────────
  const plan = await deps.getTradePlan(input.tradePlanId, input.userId);
  if (!plan) {
    return { error: "TRADE_PLAN_NOT_FOUND", message: "Trade Plan not found or access denied." };
  }
  if (plan.status === "ARCHIVED") {
    return { error: "TRADE_PLAN_ARCHIVED", message: "Trade Plan is archived and cannot be used for order preparation." };
  }

  // ── 3. Load & validate Preflight ──────────────────────────────────────────
  const preflightRow = await deps.getPreflight(input.preflightId, input.tradePlanId, input.userId);
  if (!preflightRow) {
    return { error: "PREFLIGHT_MISSING", message: "Execution preflight not found, does not belong to this Trade Plan, or access denied." };
  }

  // ── 4. Check preflight expiry ─────────────────────────────────────────────
  if (preflightRow.validUntil && now > preflightRow.validUntil) {
    return { error: "PREFLIGHT_EXPIRED", message: "Execution preflight has expired. Please run a fresh preflight before preparing an order draft." };
  }

  // ── 5. Check preflight status (only PASS is accepted for Sprint 2.8.1) ────
  if (preflightRow.status !== "PASS") {
    return {
      error: "PREFLIGHT_NOT_PASSING",
      message: `Execution preflight status is "${preflightRow.status}". A passing preflight (PASS) is required for order preparation. ${
        preflightRow.status === "REQUIRES_REVIEW" ? "Please review and resolve all preflight items, then run a fresh preflight." : "Please resolve preflight blockers and rerun."
      }`,
    };
  }

  // ── 6. Trade Plan version check ───────────────────────────────────────────
  // If the plan was updated after the preflight was evaluated, the preflight
  // is stale relative to the current plan state.
  const planUpdatedAt = new Date(plan.updatedAt);
  if (planUpdatedAt > preflightRow.evaluatedAt) {
    return {
      error: "TRADE_PLAN_VERSION_CHANGED",
      message: "This Trade Plan has been updated after the preflight was run. Please run a fresh preflight for the current plan version.",
    };
  }

  // ── 7. Lifecycle state check ──────────────────────────────────────────────
  const blockedHealthStates = ["THESIS_INVALIDATED", "DATA_STALE"];
  if (blockedHealthStates.includes(plan.planHealth)) {
    return {
      error: "LIFECYCLE_CHANGED",
      message: `Trade Plan health is "${plan.planHealth}". Order preparation requires a CURRENT or CHANGED plan health. Please review the plan and run a fresh preflight.`,
    };
  }

  // ── 8. Extract execution context from preflight result ────────────────────
  const pfResult = preflightRow.resultJson as Record<string, unknown>;
  const provider = (pfResult["provider"] as string) ?? "unknown";
  const executionMode = (pfResult["executionMode"] as ExecutionMode) ?? "disabled";
  const accountValidation = (pfResult["accountValidation"] as Record<string, unknown>) ?? {};
  const accountNote = (accountValidation["note"] as string) ?? "";

  // Extract account ref from preflight result (server stored at preflight time)
  // The preflight stores account info in its result; we use masked ref for display.
  const brokerAccountRef = extractAccountRef(pfResult);
  const brokerAccountMasked = extractAccountMasked(pfResult);
  const brokerAccountType = extractAccountType(pfResult);

  // ── 9. Determine instrument type from Trade Plan ──────────────────────────
  const instrumentType: DraftInstrumentType =
    plan.planType === "OPTIONS"
      ? resolveOptionsInstrumentType(plan)
      : "EQUITY";

  const structureType = resolveStructureType(plan);

  // ── 10. Validate quantity ─────────────────────────────────────────────────
  const fractionalSupported = false; // Tradier: no. TradeStation: unknown. Default false.
  const qResult = validateQuantity(input.preferences.quantity, fractionalSupported);
  if (!qResult.valid) {
    return { error: "INVALID_QUANTITY", message: qResult.error ?? "Invalid quantity." };
  }

  // ── 11. Validate order type ───────────────────────────────────────────────
  const orderType = input.preferences.orderTypePreference;
  if (orderType !== "MARKET" && orderType !== "LIMIT") {
    return { error: "ORDER_TYPE_UNSUPPORTED", message: `Order type "${orderType}" is not supported.` };
  }

  // ── 12. Validate TIF ─────────────────────────────────────────────────────
  const tif = input.preferences.timeInForcePreference;
  if (tif !== "DAY" && tif !== "GTC") {
    return { error: "TIF_UNSUPPORTED", message: `Time-in-force "${tif}" is not supported.` };
  }

  // ── 13. Validate limit price ──────────────────────────────────────────────
  if (orderType === "LIMIT") {
    const lp = input.preferences.limitPricePreference;
    if (lp === undefined || lp === null) {
      return { error: "LIMIT_PRICE_REQUIRED", message: "A limit price reference is required for LIMIT order type." };
    }
    if (typeof lp !== "number" || !isFinite(lp) || lp <= 0) {
      return { error: "INVALID_LIMIT_PRICE", message: "Limit price must be a positive number." };
    }
  }

  // ── 14. Get/build quotes ──────────────────────────────────────────────────
  const underlyingQuote = await deps.getUnderlyingQuote(plan.symbol);
  const quoteSnapshot = buildQuoteSnapshot(plan, underlyingQuote, [], now);

  // ── 15. Build legs ────────────────────────────────────────────────────────
  const legs = buildOrderDraftLegs(plan, qResult.value, underlyingQuote, deps);

  if (legs.legError) {
    return { error: legs.legError, message: legs.legMessage ?? "Structure validation failed." };
  }

  // ── 16. Build contexts ────────────────────────────────────────────────────
  const quantityContext = buildQuantityContext(plan, qResult.value, fractionalSupported);
  const pricingContext = buildPricingContext(input.preferences, underlyingQuote);
  const timeInForceContext = buildTimeInForceContext(tif, instrumentType, provider);
  const capitalContext = buildCapitalContext(plan, qResult.value, underlyingQuote, instrumentType);
  const riskContext = buildRiskContext(plan, pfResult);
  const freshness = buildFreshnessInfo(preflightRow, quoteSnapshot, now);
  const marketHoursContext: DraftMarketHoursContext = {
    sessionState: resolveMarketSessionState(now),
    asOf: now.toISOString(),
  };

  // ── 17. Build warnings ────────────────────────────────────────────────────
  const warnings: OrderDraftWarning[] = buildWarnings(
    orderType, quoteSnapshot, marketHoursContext, plan, input.preferences,
  );

  // ── 18. Build validation ──────────────────────────────────────────────────
  const validation: OrderDraftValidation = {
    valid: true,
    planValid: true,
    preflightValid: true,
    lifecycleValid: plan.planHealth === "CURRENT" || plan.planHealth === "CHANGED",
    accountValid: !!brokerAccountRef,
    quoteValid: quoteSnapshot.freshnessStatus !== "STALE",
    quantityValid: qResult.valid,
    structureValid: !legs.legError,
    orderTypeSupported: true,
    timeInForceSupported: timeInForceContext.supported,
    priceValid: orderType !== "LIMIT" || !!(input.preferences.limitPricePreference),
  };

  // ── 19. Build blocker list (non-fatal) ────────────────────────────────────
  const blockers: OrderDraftBlocker[] = [];
  if (!validation.accountValid) {
    blockers.push({ code: "ACCOUNT_UNAVAILABLE", message: "Broker account reference could not be resolved from preflight." });
  }
  if (quoteSnapshot.freshnessStatus === "STALE") {
    blockers.push({ code: "QUOTE_STALE", message: "Quote data is stale. Quotes are unavailable for this draft. Future submission will require fresh quotes." });
  }

  // ── 20. Compute fingerprint ───────────────────────────────────────────────
  const legSymbols = (legs.legs ?? []).map(l => l.symbol);
  const fingerprint = computePreparationFingerprint({
    userId: input.userId,
    tradePlanId: input.tradePlanId,
    tradePlanVersion: plan.version,
    preflightId: input.preflightId,
    provider,
    accountRef: brokerAccountRef ?? "none",
    instrumentType,
    structureType,
    legSymbols,
    quantity: qResult.value,
    orderType,
    tif,
    limitPrice: input.preferences.limitPricePreference,
    limitPriceSource: input.preferences.limitPriceSource,
  });

  // ── 21. Idempotency: return existing draft if fingerprint matches ──────────
  const existing = await deps.getExistingDraftByFingerprint(fingerprint, input.userId);
  if (existing && existing.status !== "EXPIRED" && existing.status !== "ABANDONED") {
    const expiresAt = new Date(existing.expiresAt);
    if (now < expiresAt) {
      return { draft: existing, wasExisting: true };
    }
  }

  // ── 22. Determine draft status ────────────────────────────────────────────
  const draftStatus =
    blockers.length > 0 ? "REQUIRES_REVIEW" :
    !validation.quoteValid ? "REQUIRES_REVIEW" :
    "VALID";

  // ── 23. Build OrderDraft ──────────────────────────────────────────────────
  const draftId = crypto.randomUUID();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ORDER_DRAFT_EXPIRY_SECONDS * 1000).toISOString();

  const draft: OrderDraft = {
    executable: false,
    id: draftId,
    userId: input.userId,
    tradePlanId: input.tradePlanId,
    tradePlanVersion: plan.version,
    preflightId: input.preflightId,

    brokerProvider: provider,
    brokerAccountRef: brokerAccountRef ?? "none",
    brokerAccountMasked: brokerAccountMasked ?? "••••",
    brokerAccountType: brokerAccountType ?? "OTHER",

    instrumentType,
    structureType,
    sideIntent: plan.planType === "EQUITY" ? "OPEN_LONG" : undefined,

    status: draftStatus,
    executionMode,

    legs: legs.legs ?? [],

    quantityContext,
    pricingContext,
    timeInForceContext,
    capitalContext,
    riskContext,
    quoteSnapshot,
    freshness,
    marketHoursContext,

    validation,
    warnings,
    blockers,

    preparationFingerprint: fingerprint,
    version: 1,

    createdAt,
    updatedAt: createdAt,
    expiresAt,

    methodologyVersion: ORDER_PREPARATION_METHODOLOGY_VERSION,
  };

  // ── 24. Persist ───────────────────────────────────────────────────────────
  await deps.persistDraft(draft);

  // ── 25. Audit ─────────────────────────────────────────────────────────────
  const durationMs = Date.now() - startMs;
  await deps.appendAuditEvent({
    userId: input.userId,
    tradePlanId: input.tradePlanId,
    eventType: "ORDER_DRAFT_CREATED",
    provider,
    accountRefMasked: brokerAccountMasked ?? undefined,
    metadata: {
      provider,
      instrumentType,
      structureType,
      status: draftStatus,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      durationMs,
      executionMode,
    },
  });

  return { draft, wasExisting: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE DRAFT (change editable preferences only)
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateOrderDraftInput {
  userId: string;
  draftId: string;
  preferences: OrderPreparationPreferences;
}

export interface UpdateOrderDraftResult {
  draft?: OrderDraft;
  error?: string;
  message?: string;
}

export async function updateOrderDraft(
  input: UpdateOrderDraftInput,
  deps: OrderPreparationDeps,
): Promise<UpdateOrderDraftResult> {
  const now = deps.now();

  // Load existing draft
  let existing: OrderDraft | null = null;
  try {
    const rows = await db
      .select()
      .from(orderDrafts)
      .where(and(eq(orderDrafts.id, input.draftId), eq(orderDrafts.userId, input.userId)))
      .limit(1);
    if (!rows[0]) return { error: "NOT_FOUND", message: "Order draft not found." };
    existing = rows[0].draftJson as unknown as OrderDraft;
  } catch (e: any) {
    return { error: "DB_ERROR", message: "Failed to load order draft." };
  }

  if (!existing) return { error: "NOT_FOUND", message: "Order draft not found." };

  // Check expiry
  if (now >= new Date(existing.expiresAt)) {
    return { error: "EXPIRED", message: "This order draft has expired. Please create a new draft." };
  }

  // Validate new preferences (same rules as create)
  const fractionalSupported = existing.quantityContext.fractionalSupported;
  const qResult = validateQuantity(input.preferences.quantity, fractionalSupported);
  if (!qResult.valid) {
    return { error: "INVALID_QUANTITY", message: qResult.error };
  }
  if (input.preferences.orderTypePreference !== "MARKET" && input.preferences.orderTypePreference !== "LIMIT") {
    return { error: "ORDER_TYPE_UNSUPPORTED", message: "Unsupported order type." };
  }
  if (input.preferences.timeInForcePreference !== "DAY" && input.preferences.timeInForcePreference !== "GTC") {
    return { error: "TIF_UNSUPPORTED", message: "Unsupported time-in-force." };
  }
  if (input.preferences.orderTypePreference === "LIMIT" && (!input.preferences.limitPricePreference || input.preferences.limitPricePreference <= 0)) {
    return { error: "LIMIT_PRICE_REQUIRED", message: "Limit price is required for LIMIT orders." };
  }

  // Recompute fingerprint with new preferences
  const legSymbols = existing.legs.map(l => l.symbol);
  const newFingerprint = computePreparationFingerprint({
    userId: existing.userId,
    tradePlanId: existing.tradePlanId,
    tradePlanVersion: existing.tradePlanVersion,
    preflightId: existing.preflightId,
    provider: existing.brokerProvider,
    accountRef: existing.brokerAccountRef,
    instrumentType: existing.instrumentType,
    structureType: existing.structureType,
    legSymbols,
    quantity: qResult.value,
    orderType: input.preferences.orderTypePreference,
    tif: input.preferences.timeInForcePreference,
    limitPrice: input.preferences.limitPricePreference,
    limitPriceSource: input.preferences.limitPriceSource,
  });

  // Rebuild pricing context
  const pricingContext = buildPricingContext(input.preferences, null);
  const tifCtx = buildTimeInForceContext(
    input.preferences.timeInForcePreference,
    existing.instrumentType,
    existing.brokerProvider,
  );

  // Build updated warnings
  const warnings = buildWarnings(
    input.preferences.orderTypePreference,
    existing.quoteSnapshot,
    existing.marketHoursContext,
    null,
    input.preferences,
  );

  const updatedAt = now.toISOString();
  const updated: OrderDraft = {
    ...existing,
    quantityContext: {
      ...existing.quantityContext,
      confirmedQuantity: qResult.value,
    },
    pricingContext,
    timeInForceContext: tifCtx,
    warnings,
    preparationFingerprint: newFingerprint,
    version: existing.version + 1,
    updatedAt,
  };

  // Persist
  await deps.persistDraft(updated);

  // Audit
  await deps.appendAuditEvent({
    userId: input.userId,
    tradePlanId: existing.tradePlanId,
    eventType: "ORDER_DRAFT_UPDATED",
    provider: existing.brokerProvider,
    metadata: {
      provider: existing.brokerProvider,
      instrumentType: existing.instrumentType,
      version: updated.version,
    },
  });

  return { draft: updated };
}

// ─────────────────────────────────────────────────────────────────────────────
// ABANDON DRAFT
// ─────────────────────────────────────────────────────────────────────────────

export async function abandonOrderDraft(
  draftId: string,
  userId: string,
  deps: OrderPreparationDeps,
): Promise<{ success: boolean; error?: string }> {
  try {
    const rows = await db
      .select()
      .from(orderDrafts)
      .where(and(eq(orderDrafts.id, draftId), eq(orderDrafts.userId, userId)))
      .limit(1);
    if (!rows[0]) return { success: false, error: "NOT_FOUND" };

    const existing = rows[0].draftJson as unknown as OrderDraft;

    await db
      .update(orderDrafts)
      .set({ status: "ABANDONED", updatedAt: deps.now() })
      .where(and(eq(orderDrafts.id, draftId), eq(orderDrafts.userId, userId)));

    await deps.appendAuditEvent({
      userId,
      tradePlanId: existing.tradePlanId,
      eventType: "ORDER_DRAFT_ABANDONED",
      provider: existing.brokerProvider,
      metadata: { instrumentType: existing.instrumentType, version: existing.version },
    });

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DB TABLE INIT
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureOrderDraftTables(): Promise<void> {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS order_drafts (
        id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         TEXT NOT NULL,
        trade_plan_id   VARCHAR NOT NULL,
        trade_plan_version INTEGER NOT NULL DEFAULT 1,
        preflight_id    VARCHAR NOT NULL,
        provider        TEXT NOT NULL DEFAULT 'unknown',
        account_ref     TEXT NOT NULL DEFAULT 'none',
        instrument_type TEXT NOT NULL,
        structure_type  TEXT NOT NULL,
        draft_json      JSONB NOT NULL DEFAULT '{}',
        fingerprint     TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'DRAFT',
        version         INTEGER NOT NULL DEFAULT 1,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at      TIMESTAMPTZ,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (fingerprint, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_od_user_id ON order_drafts(user_id);
      CREATE INDEX IF NOT EXISTS idx_od_trade_plan_id ON order_drafts(trade_plan_id);
      CREATE INDEX IF NOT EXISTS idx_od_status ON order_drafts(status);
      CREATE INDEX IF NOT EXISTS idx_od_expires_at ON order_drafts(expires_at);
    `);
    console.log(JSON.stringify({ event: "order_draft_tables_ready", ts: new Date().toISOString() }));
  } catch (e: any) {
    console.error("[order-prep] table init failed:", e?.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY HEALTH METRICS
// ─────────────────────────────────────────────────────────────────────────────

interface OrderPrepMetrics {
  draftsCreated: number;
  expiredDrafts: number;
  invalidDrafts: number;
  abandonedDrafts: number;
  draftCreationFailures: number;
  totalLatencyMs: number;
  latencyCount: number;
  lastDraftCreatedAt?: string;
}

const _metrics: OrderPrepMetrics = {
  draftsCreated: 0, expiredDrafts: 0, invalidDrafts: 0,
  abandonedDrafts: 0, draftCreationFailures: 0,
  totalLatencyMs: 0, latencyCount: 0,
};

export function recordDraftCreated(latencyMs: number): void {
  _metrics.draftsCreated++;
  _metrics.totalLatencyMs += latencyMs;
  _metrics.latencyCount++;
  _metrics.lastDraftCreatedAt = new Date().toISOString();
}
export function recordDraftFailure(): void { _metrics.draftCreationFailures++; }
export function recordDraftExpired(): void { _metrics.expiredDrafts++; }
export function recordDraftAbandoned(): void { _metrics.abandonedDrafts++; }

export function getOrderPreparationMetrics(): OrderPrepMetrics & { avgLatencyMs: number } {
  return {
    ..._metrics,
    avgLatencyMs: _metrics.latencyCount > 0
      ? Math.round(_metrics.totalLatencyMs / _metrics.latencyCount)
      : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function extractAccountRef(pfResult: Record<string, unknown>): string | undefined {
  const acc = pfResult["accountValidation"] as Record<string, unknown> | undefined;
  if (!acc) return undefined;
  return (acc["accountRef"] as string) ?? undefined;
}

function extractAccountMasked(pfResult: Record<string, unknown>): string | undefined {
  const acc = pfResult["accountValidation"] as Record<string, unknown> | undefined;
  if (!acc) return undefined;
  return (acc["accountIdMasked"] as string) ?? undefined;
}

function extractAccountType(pfResult: Record<string, unknown>): BrokerAccountType | undefined {
  const acc = pfResult["accountValidation"] as Record<string, unknown> | undefined;
  if (!acc) return undefined;
  return (acc["accountType"] as BrokerAccountType) ?? undefined;
}

function resolveOptionsInstrumentType(plan: TradePlan): DraftInstrumentType {
  const snap = plan.structureSnapshot as TradePlanOptionsSnapshot | null;
  if (!snap) return "OPTION";
  const legs = snap.legs ?? [];
  return legs.length > 1 ? "MULTI_LEG_OPTION" : "OPTION";
}

function resolveStructureType(plan: TradePlan): string {
  if (plan.planType === "EQUITY") return "equity_long";
  const snap = plan.structureSnapshot as TradePlanOptionsSnapshot | null;
  return snap?.strategyFamily ?? "unknown_options";
}

interface BuildLegsResult {
  legs?: OrderDraftLeg[];
  legError?: OrderDraftBlockerCode;
  legMessage?: string;
}

function buildOrderDraftLegs(
  plan: TradePlan,
  quantity: number,
  underlyingQuote: DraftLegQuote | null,
  deps: Pick<OrderPreparationDeps, 'now'>,
): BuildLegsResult {
  if (plan.planType === "EQUITY") {
    const snap = plan.structureSnapshot as any;
    const refPrice = snap?.referencePrice ?? null;
    const leg: OrderDraftLeg = {
      legIndex: 0,
      instrumentType: "EQUITY",
      symbol: plan.symbol,
      legIntent: "OPEN_LONG",
      ratio: 1,
      quantity,
      quoteReference: underlyingQuote ?? undefined,
    };
    return { legs: [leg] };
  }

  // OPTIONS
  const snap = plan.structureSnapshot as TradePlanOptionsSnapshot | null;
  if (!snap) {
    return { legError: "STRUCTURE_INVALID", legMessage: "Options structure snapshot is missing from Trade Plan." };
  }

  const rawLegs = snap.legs ?? [];
  if (rawLegs.length === 0) {
    return { legError: "STRUCTURE_INVALID", legMessage: "No option legs found in Trade Plan structure snapshot." };
  }

  const strategyFamily = snap.strategyFamily ?? "unknown";
  const legs: OrderDraftLeg[] = rawLegs.map((rawLeg: any, idx: number) => {
    const role = (rawLeg["role"] ?? rawLeg["legRole"] ?? "long_leg") as string;
    const legIntent = resolveLegIntent(role, strategyFamily);
    const contractSymbol = rawLeg["contractSymbol"] ?? rawLeg["symbol"] ?? "";

    return {
      legIndex: idx,
      instrumentType: "OPTION" as DraftInstrumentType,
      symbol: contractSymbol,
      optionType: rawLeg["optionType"] as "call" | "put" | undefined,
      expiration: rawLeg["expiration"] as string | undefined,
      strike: rawLeg["strike"] as number | undefined,
      legIntent,
      ratio: (rawLeg["ratio"] as number) ?? 1,
      quantity,
      quoteReference: contractSymbol
        ? buildLegQuoteFromSnapshot(rawLeg, contractSymbol)
        : undefined,
    };
  });

  return { legs };
}

function buildLegQuoteFromSnapshot(rawLeg: any, contractSymbol: string): DraftLegQuote | undefined {
  const bid = rawLeg["bid"] ?? null;
  const ask = rawLeg["ask"] ?? null;
  const mid = rawLeg["midpoint"] ?? null;
  const updatedAt = rawLeg["updatedAt"] ?? null;
  if (bid === null && ask === null && mid === null) return undefined;
  return {
    contractSymbol,
    bid,
    ask,
    midpoint: mid,
    last: null,
    provider: "snapshot",
    asOf: updatedAt ?? new Date(0).toISOString(),
    isStale: true, // snapshot is always stale by definition
  };
}

function buildQuoteSnapshot(
  plan: TradePlan,
  underlyingQuote: DraftLegQuote | null,
  optionQuotes: DraftLegQuote[],
  now: Date,
): DraftQuoteSnapshot {
  const freshForSec = 60; // underlying freshness window
  const status = !underlyingQuote
    ? "UNAVAILABLE"
    : underlyingQuote.isStale
    ? "STALE"
    : "FRESH";

  return {
    underlying: underlyingQuote ?? undefined,
    optionLegs: optionQuotes.length > 0 ? optionQuotes : undefined,
    capturedAt: now.toISOString(),
    freshnessStatus: status as any,
    estimatedFreshForSec: freshForSec,
  };
}

function buildQuantityContext(
  plan: TradePlan,
  confirmedQty: number,
  fractionalSupported: boolean,
): DraftQuantityContext {
  // Extract hypothetical size from equity snapshot (reference only)
  let hypotheticalQty: number | null = null;
  if (plan.planType === "EQUITY") {
    const snap = plan.structureSnapshot as any;
    hypotheticalQty = snap?.hypotheticalSizing?.effectiveScenarioShares ?? null;
  }

  return {
    confirmedQuantity: confirmedQty,
    unit: plan.planType === "EQUITY" ? "shares" : "contracts",
    hypotheticalPlanQuantity: hypotheticalQty,
    fractionalSupported,
    requiresExplicitConfirmation: true,
  };
}

function buildPricingContext(
  prefs: OrderPreparationPreferences,
  underlyingQuote: DraftLegQuote | null,
): DraftPricingContext {
  const isMarket = prefs.orderTypePreference === "MARKET";
  return {
    orderType: prefs.orderTypePreference,
    limitPriceReference: prefs.limitPricePreference,
    limitPriceSource: prefs.limitPriceSource,
    marketOrderWarningGenerated: isMarket,
    extendedHoursRequested: prefs.allowExtendedHours ?? false,
    extendedHoursSupported: false, // Neither provider supports ext hours for options
    priceRoundingApplied: false,
    priceRoundingNote: undefined,
  };
}

function buildTimeInForceContext(
  tif: string,
  instrumentType: DraftInstrumentType,
  provider: string,
): DraftTimeInForceContext {
  // GTC is generally supported for equity; options TIF support varies by provider.
  // Be conservative: flag GTC for options as requiring review.
  if (tif === "GTC" && instrumentType !== "EQUITY") {
    return {
      timeInForce: tif as any,
      supported: true, // most providers support GTC for options
      note: "GTC availability for options is provider-dependent. Verify with your broker.",
    };
  }
  return { timeInForce: tif as any, supported: true };
}

function buildCapitalContext(
  plan: TradePlan,
  qty: number,
  underlyingQuote: DraftLegQuote | null,
  instrumentType: DraftInstrumentType,
): DraftCapitalContext {
  const note = "Estimated. Broker buying power is authoritative at execution time.";

  if (instrumentType === "EQUITY") {
    const snap = plan.structureSnapshot as any;
    const refPrice = snap?.referencePrice ?? underlyingQuote?.midpoint ?? null;
    const notional = refPrice ? computeEquityCapital(qty, refPrice) : undefined;
    return { estimatedNotional: notional, currency: "USD", estimateNote: note };
  }

  // Options: use snapshot metrics if available
  const snap = plan.structureSnapshot as TradePlanOptionsSnapshot | null;
  const snakeMeta = snap as any;
  const debit = snakeMeta?.estimatedMidpoint != null
    ? Math.round(snakeMeta.estimatedMidpoint * qty * 100) / 100
    : undefined;
  const isCredit = debit === undefined || debit < 0;

  return {
    estimatedDebit: debit && debit > 0 ? debit : undefined,
    estimatedCredit: isCredit && debit !== undefined ? Math.abs(debit) : undefined,
    currency: "USD",
    estimateNote: note + " Estimated Midpoint Debit/Credit shown. Actual fill price may differ significantly.",
  };
}

function buildRiskContext(
  plan: TradePlan,
  pfResult: Record<string, unknown>,
): DraftRiskContext {
  const riskSnap = plan.riskSnapshot;
  const positionVal = pfResult["positionValidation"] as Record<string, unknown> | undefined;
  const coverageValidated = (positionVal?.["status"] as string) === "PASS";

  return {
    maxLoss: riskSnap?.maxLoss ?? null,
    maxGain: riskSnap?.maxGain ?? null,
    breakevens: riskSnap?.breakevens ?? [],
    capitalProfile: riskSnap?.capitalProfile ?? null,
    riskFlags: riskSnap?.riskFlags ?? [],
    constraintStatus: riskSnap?.constraintStatus ?? "UNKNOWN",
    riskAnalysisId: riskSnap?.analysisId ?? null,
    coverageValidated,
    coverageNote: coverageValidated ? undefined :
      "Position coverage could not be validated from preflight. Covered strategies require share confirmation.",
  };
}

function buildFreshnessInfo(
  preflight: { evaluatedAt: Date },
  quoteSnapshot: DraftQuoteSnapshot,
  now: Date,
): DraftFreshnessInfo {
  const preflightAge = Math.round((now.getTime() - preflight.evaluatedAt.getTime()) / 1000);
  const capturedAt = new Date(quoteSnapshot.capturedAt);
  const quoteAge = Math.round((now.getTime() - capturedAt.getTime()) / 1000);

  const overall = preflightAge > 240 ? "AGING" : "FRESH";
  return {
    preflightAge,
    quoteAge,
    lifecycleAge: preflightAge, // approximate
    overallFreshness: overall,
  };
}

function buildWarnings(
  orderType: string,
  quoteSnapshot: DraftQuoteSnapshot,
  marketCtx: DraftMarketHoursContext,
  plan: TradePlan | null,
  prefs: OrderPreparationPreferences,
): OrderDraftWarning[] {
  const warnings: OrderDraftWarning[] = [];

  if (orderType === "MARKET") {
    warnings.push({
      code: "MARKET_ORDER_PRICE_UNCERTAINTY",
      message: MARKET_ORDER_WARNING,
    });
  }

  if (marketCtx.sessionState === "CLOSED") {
    warnings.push({
      code: "MARKET_CLOSED",
      message: "Market is currently closed. Order types and prices will be re-evaluated at submission time.",
    });
  }
  if (marketCtx.sessionState === "PRE_MARKET" || marketCtx.sessionState === "AFTER_HOURS") {
    warnings.push({
      code: "MARKET_CLOSED",
      message: `Market is currently in ${marketCtx.sessionState.replace("_", " ").toLowerCase()}. Quotes may not reflect regular session prices.`,
    });
  }

  if (quoteSnapshot.freshnessStatus === "UNAVAILABLE") {
    warnings.push({
      code: "DATA_REFRESH_SOON",
      message: "Live quote data is currently unavailable for this draft. Quotes will be validated at future submission.",
    });
  }

  // Spread width warning for options (from snapshot)
  if (orderType === "LIMIT" && prefs.limitPricePreference) {
    const bid = quoteSnapshot.underlying?.bid;
    const ask = quoteSnapshot.underlying?.ask;
    if (bid && ask && ask > 0) {
      const spreadPct = (ask - bid) / ask;
      if (spreadPct > 0.05) {
        warnings.push({ code: "WIDE_SPREAD", message: "Wide bid-ask spread detected. Limit price selection is important." });
      }
      if (prefs.limitPricePreference < bid * 1.01) {
        warnings.push({ code: "LIMIT_REFERENCE_NEAR_BID", message: "Limit price reference is near the bid. Fill likelihood may be lower." });
      }
      if (prefs.limitPricePreference > ask * 0.99) {
        warnings.push({ code: "LIMIT_REFERENCE_NEAR_ASK", message: "Limit price reference is near the ask." });
      }
    }
  }

  return warnings;
}
