/**
 * server/services/broker-translation-service.ts — Sprint 2.8.6
 *
 * Provider-specific order translation adapters.
 * Converts ExecutionIntent + mode into the canonical OrderRequest
 * for each broker provider.
 *
 * INVARIANTS:
 *   - No raw broker credentials, tokens, or account IDs from client.
 *   - Client order tag added where provider supports it.
 *   - Multi-leg orders: blocked in TEST_LIVE (see final validation).
 *   - Market orders: blocked in TEST_LIVE (see final validation).
 *   - Pure functions — no network calls, no side effects.
 */

import type { ExecutionIntent, ExecutionIntentOrderDetails } from "../../shared/execution-intent-types";
import type { OrderRequest } from "../broker/types";

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT ORDER TAG
// Client-side tag (VCP_<shortId>) attached to orders for reconciliation.
// ─────────────────────────────────────────────────────────────────────────────

export function buildClientOrderTag(intentId: string): string {
  return `VCP_${intentId.substring(0, 8).toUpperCase()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// EQUITY ORDER TRANSLATION
// ─────────────────────────────────────────────────────────────────────────────

export function translateEquityOrder(
  intent: ExecutionIntent,
  provider: "tradier" | "tradestation" | string,
): OrderRequest {
  const order = intent.intentJson;

  const base: OrderRequest = {
    accountId: intent.accountRef,
    symbol: intent.symbol,
    side: order.side,
    quantity: order.quantity,
    orderType: order.orderType as OrderRequest["orderType"],
    duration: order.duration as OrderRequest["duration"],
    orderClass: "equity",
  };

  if (order.orderType === "limit" || order.orderType === "stop_limit") {
    if (order.limitPrice !== null) base.price = order.limitPrice;
  }
  if (order.orderType === "stop" || order.orderType === "stop_limit") {
    if (order.stopPrice !== null) base.stopPrice = order.stopPrice;
  }

  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE-LEG OPTION ORDER TRANSLATION
// ─────────────────────────────────────────────────────────────────────────────

export function translateSingleLegOptionOrder(
  intent: ExecutionIntent,
  provider: "tradier" | "tradestation" | string,
): OrderRequest {
  const order = intent.intentJson;

  if (!order.optionSymbol) {
    throw new Error(`[broker-translation] Intent ${intent.id} is missing optionSymbol for single-leg option`);
  }

  const base: OrderRequest = {
    accountId: intent.accountRef,
    symbol: intent.symbol,          // underlying
    side: order.side,
    quantity: order.quantity,
    orderType: order.orderType as OrderRequest["orderType"],
    duration: order.duration as OrderRequest["duration"],
    orderClass: "option",
    optionSymbol: order.optionSymbol,
    optionSide: order.optionSide as OrderRequest["optionSide"],
  };

  if (order.orderType === "limit" || order.orderType === "stop_limit") {
    if (order.limitPrice !== null) base.price = order.limitPrice;
  }

  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-LEG OPTION ORDER TRANSLATION
// (Blocked in TEST_LIVE — only available in SANDBOX for supported providers)
// ─────────────────────────────────────────────────────────────────────────────

export interface MultiLegTranslationResult {
  supported: boolean;
  blockerCode?: string;
  blockerMessage?: string;
  orders?: OrderRequest[];
}

export function translateMultiLegOrder(
  intent: ExecutionIntent,
  provider: "tradier" | "tradestation" | string,
): MultiLegTranslationResult {
  // Multi-leg is banned in TEST_LIVE (enforced also in final validation)
  if (intent.executionMode === "TEST_LIVE") {
    return {
      supported: false,
      blockerCode: "EI_MULTI_LEG_BANNED_IN_TEST_LIVE",
      blockerMessage: "Multi-leg option orders are not permitted in TEST_LIVE mode.",
    };
  }

  const order = intent.intentJson;
  if (!order.legs || order.legs.length === 0) {
    return {
      supported: false,
      blockerCode: "EI_MULTI_LEG_MISSING_LEGS",
      blockerMessage: "Multi-leg intent has no legs defined.",
    };
  }

  // For SANDBOX, decompose into individual single-leg orders
  // (Native multi-leg spread submission is provider-specific and out of scope for v1)
  const orders: OrderRequest[] = order.legs.map((leg) => ({
    accountId: intent.accountRef,
    symbol: intent.symbol,
    side: leg.optionSide.startsWith("buy") ? "buy" as const : "sell" as const,
    quantity: leg.quantity,
    orderType: "limit" as const,
    duration: order.duration as "day" | "gtc",
    orderClass: "option" as const,
    optionSymbol: leg.contractSymbol,
    optionSide: leg.optionSide as OrderRequest["optionSide"],
    price: leg.limitPrice ?? undefined,
  }));

  return { supported: true, orders };
}

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL TRANSLATOR (dispatches by instrument type)
// ─────────────────────────────────────────────────────────────────────────────

export interface TranslationResult {
  ok: boolean;
  orderRequests?: OrderRequest[];
  errorCode?: string;
  errorMessage?: string;
}

export function translateIntentToOrderRequests(
  intent: ExecutionIntent,
  provider: string,
): TranslationResult {
  try {
    const type = intent.instrumentType;

    if (type === "equity") {
      const req = translateEquityOrder(intent, provider);
      return { ok: true, orderRequests: [req] };
    }

    if (type === "single_leg_option") {
      const req = translateSingleLegOptionOrder(intent, provider);
      return { ok: true, orderRequests: [req] };
    }

    if (type === "multi_leg_option") {
      const result = translateMultiLegOrder(intent, provider);
      if (!result.supported) {
        return { ok: false, errorCode: result.blockerCode, errorMessage: result.blockerMessage };
      }
      return { ok: true, orderRequests: result.orders };
    }

    return {
      ok: false,
      errorCode: "EI_UNKNOWN_INSTRUMENT_TYPE",
      errorMessage: `Unknown instrument type: ${type}`,
    };
  } catch (e: any) {
    return { ok: false, errorCode: "EI_TRANSLATION_ERROR", errorMessage: e?.message ?? "Translation error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRADESTATION SIM MODE URL HELPER
// Used by the submission service to ensure SIM accounts hit the SIM API.
// ─────────────────────────────────────────────────────────────────────────────

export function isSimModeProvider(provider: string, executionMode: string): boolean {
  // SANDBOX mode → always use sandbox/SIM endpoints
  if (executionMode === "SANDBOX") return true;
  // TEST_LIVE → use live endpoints
  return false;
}
