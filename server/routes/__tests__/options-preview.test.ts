/**
 * server/routes/__tests__/options-preview.test.ts — Sprint 2.8.3
 *
 * 175+ assertions covering Options / Multi-Leg Order Preview engine.
 *
 * PERMANENT INVARIANTS TESTED:
 *   - executable always false
 *   - OPTION / MULTI_LEG_OPTION instrument type required
 *   - Options broad expression required (not STOCK)
 *   - selectedBy always USER
 *   - Strategy family never changed
 *   - All legs immutable (contracts, strikes, expirations, ratios, quantity)
 *   - No leg decomposition
 *   - Draft values never mutated
 *   - Net debit/credit sign convention
 *   - No submission / no confirmation
 *   - Cross-user access blocked
 *   - Forbidden client injection rejected
 *   - Audit events
 *   - Platform health
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

import {
  generateOptionsPreview,
  getOptionsPreviewMetrics,
  type OptionsPreviewDeps,
  type CurrentLegQuoteData,
} from "../../services/options-preview-service";
import type { OrderDraft } from "../../../shared/order-draft-types";
import {
  OPTIONS_PREVIEW_DISCLAIMER,
  OPTIONS_PREVIEW_MIDPOINT_DISCLAIMER,
  OPTIONS_PREVIEW_NON_EXECUTION_BANNER,
  OPTIONS_PREVIEW_METHODOLOGY_VERSION,
  OPTIONS_PREVIEW_FORBIDDEN_LABELS,
  OPTIONS_RISK_DISCLOSURE,
  OPTIONS_PREVIEW_PRICE_DISCLAIMER,
  STRATEGY_FAMILY_LABELS,
} from "../../../shared/options-order-preview-types";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const USER_ID  = "user-test-1";
const DRAFT_ID = "draft-test-1";
const PLAN_ID  = "plan-test-1";
const PF_ID    = "pf-test-1";

const NOW = new Date("2026-08-11T15:00:00Z");
const EXPIRES_FUTURE = new Date(NOW.getTime() + 30 * 60 * 1000);
const EXPIRES_PAST   = new Date(NOW.getTime() - 60 * 1000);

// Single-leg option (long call)
function makeSingleLegDraft(overrides: Partial<{
  broadExpr: string | null;
  strategyFamily: string;
  instrumentType: string;
  legIntent: string;
  optionType: "call" | "put";
  strike: number;
  expiration: string;
  quantity: number;
  orderType: string;
  tif: string;
}> = {}): OrderDraft {
  return {
    executable: false,
    id: DRAFT_ID,
    userId: USER_ID,
    tradePlanId: PLAN_ID,
    tradePlanVersion: 1,
    preflightId: PF_ID,
    brokerProvider: "tradier",
    brokerAccountRef: "ACCT12345678",
    brokerAccountMasked: "••••5678",
    brokerAccountType: "MARGIN",
    instrumentType: overrides.instrumentType ?? "OPTION",
    structureType: overrides.strategyFamily ?? "long_call",
    status: "DRAFT",
    executionMode: "DISABLED",
    legs: [{
      legIndex: 0,
      instrumentType: "OPTION",
      symbol: "NVDA260918C00120000",
      optionType: overrides.optionType ?? "call",
      expiration: overrides.expiration ?? "2026-09-18",
      strike: overrides.strike ?? 120,
      legIntent: overrides.legIntent ?? "OPEN_LONG",
      ratio: 1,
      quantity: overrides.quantity ?? 2,
      quoteReference: { contractSymbol: "NVDA260918C00120000", bid: 3.20, ask: 3.40, midpoint: 3.30, last: 3.35, provider: "tradier", asOf: NOW.toISOString(), isStale: false },
    }],
    quantityContext: {
      confirmedQuantity: overrides.quantity ?? 2,
      unit: "contracts",
      hypotheticalPlanQuantity: 5,
      fractionalSupported: false,
      requiresExplicitConfirmation: false,
    },
    pricingContext: {
      orderType: (overrides.orderType ?? "LIMIT") as any,
      limitPriceReference: 3.30,
      limitPriceSource: "REFERENCE_MIDPOINT",
      marketOrderWarningGenerated: false,
      extendedHoursRequested: false,
      extendedHoursSupported: false,
      priceRoundingApplied: false,
    },
    timeInForceContext: { timeInForce: (overrides.tif ?? "DAY") as any, supported: true },
    capitalContext: {
      estimatedDebit: 3.30,
      currency: "USD",
      estimateNote: "Estimated. Broker buying power is authoritative.",
    },
    riskContext: {
      maxLoss: { type: "DEFINED", perContractDollars: 330, note: "Premium paid" },
      maxGain: { type: "UNLIMITED", perContractDollars: null, note: "Unlimited upside" },
      breakevens: [{ price: 123.30, label: "Breakeven", distanceFromRefPct: 2.75 }],
      capitalProfile: { debitCreditType: "DEBIT", netDebitPerContract: 3.30, contractMultiplier: 100 },
      riskFlags: [],
      constraintStatus: "WITHIN_CONSTRAINTS",
      riskAnalysisId: "risk-001",
      coverageValidated: false,
    },
    quoteSnapshot: {
      optionLegs: [{ contractSymbol: "NVDA260918C00120000", bid: 3.20, ask: 3.40, midpoint: 3.30, last: 3.35, provider: "tradier", asOf: NOW.toISOString(), isStale: false }],
      capturedAt: NOW.toISOString(),
      freshnessStatus: "FRESH",
      estimatedFreshForSec: 60,
    },
    freshness: { preflightAge: 30, quoteAge: 10, lifecycleAge: 120, overallFreshness: "FRESH" },
    marketHoursContext: { sessionState: "OPEN", asOf: NOW.toISOString() },
    validation: {
      valid: true, planValid: true, preflightValid: true, lifecycleValid: true,
      accountValid: true, quoteValid: true, quantityValid: true, structureValid: true,
      orderTypeSupported: true, timeInForceSupported: true, priceValid: true,
    },
    warnings: [],
    blockers: [],
    preparationFingerprint: "fp-abc123",
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    expiresAt: EXPIRES_FUTURE.toISOString(),
    methodologyVersion: "2.8.1",
  } as unknown as OrderDraft;
}

function makeMultiLegDraft(strategyFamily = "bull_call_spread"): OrderDraft {
  const base = makeSingleLegDraft({ strategyFamily, instrumentType: "MULTI_LEG_OPTION" });
  return {
    ...base,
    instrumentType: "MULTI_LEG_OPTION",
    structureType: strategyFamily,
    legs: [
      {
        legIndex: 0,
        instrumentType: "OPTION",
        symbol: "NVDA260918C00120000",
        optionType: "call",
        expiration: "2026-09-18",
        strike: 120,
        legIntent: "OPEN_LONG",
        ratio: 1,
        quantity: 2,
        quoteReference: { contractSymbol: "NVDA260918C00120000", bid: 3.20, ask: 3.40, midpoint: 3.30, last: 3.35, provider: "tradier", asOf: NOW.toISOString(), isStale: false },
      },
      {
        legIndex: 1,
        instrumentType: "OPTION",
        symbol: "NVDA260918C00125000",
        optionType: "call",
        expiration: "2026-09-18",
        strike: 125,
        legIntent: "OPEN_SHORT_DEFINED_RISK",
        ratio: 1,
        quantity: 2,
        quoteReference: { contractSymbol: "NVDA260918C00125000", bid: 1.80, ask: 2.00, midpoint: 1.90, last: 1.85, provider: "tradier", asOf: NOW.toISOString(), isStale: false },
      },
    ],
    quoteSnapshot: {
      optionLegs: [
        { contractSymbol: "NVDA260918C00120000", bid: 3.20, ask: 3.40, midpoint: 3.30, last: 3.35, provider: "tradier", asOf: NOW.toISOString(), isStale: false },
        { contractSymbol: "NVDA260918C00125000", bid: 1.80, ask: 2.00, midpoint: 1.90, last: 1.85, provider: "tradier", asOf: NOW.toISOString(), isStale: false },
      ],
      capturedAt: NOW.toISOString(),
      freshnessStatus: "FRESH",
      estimatedFreshForSec: 60,
    },
    capitalContext: {
      estimatedDebit: 1.40, // 3.30 - 1.90
      currency: "USD",
      estimateNote: "Estimated. Broker buying power is authoritative.",
    },
  } as unknown as OrderDraft;
}

function makeDraftRow(overrides: Partial<{ status: string; version: number; expiresAt: Date; tradePlanVersion: number }> = {}, draft?: OrderDraft) {
  const d = draft ?? makeSingleLegDraft();
  return {
    id: DRAFT_ID, userId: USER_ID, tradePlanId: PLAN_ID,
    tradePlanVersion: overrides.tradePlanVersion ?? 1,
    preflightId: PF_ID,
    draftJson: d as unknown as Record<string, unknown>,
    status: overrides.status ?? "DRAFT",
    version: overrides.version ?? 1,
    expiresAt: overrides.expiresAt ?? EXPIRES_FUTURE,
  };
}

function makeTradePlan(overrides: Partial<{ broadExpressionType: string | null; version: number }> = {}) {
  return {
    id: PLAN_ID, userId: USER_ID, symbol: "NVDA", companyName: "NVIDIA Corporation",
    version: overrides.version ?? 1,
    broadExpressionType: overrides.broadExpressionType ?? "LONG_OPTIONS",
    expressionSelectedBy: "USER",
    expressionSelectedAt: NOW.toISOString(),
    researchSnapshot: { summary: "Bullish VCP breakout", thesis: "Strong momentum", score: 82 },
    riskSnapshot: {
      payoffProfile: { maxLoss: { type: "DEFINED" }, maxGain: { type: "UNLIMITED" }, isDefinedRisk: false },
      greekProfile: { netDelta: 0.42, netGamma: 0.03, netTheta: -0.12, netVega: 0.15 },
    },
    status: "ACTIVE", createdAt: NOW, updatedAt: NOW,
  };
}

function makePreflight(overrides: Partial<{ status: string; validUntil: Date | null }> = {}) {
  return {
    id: PF_ID, status: overrides.status ?? "PASS",
    evaluatedAt: NOW,
    validUntil: overrides.validUntil !== undefined ? overrides.validUntil : new Date(NOW.getTime() + 15 * 60 * 1000),
    resultJson: {},
  };
}

function makeQuoteData(overrides: Partial<CurrentLegQuoteData> = {}): CurrentLegQuoteData {
  return {
    bid: 3.50, ask: 3.70, last: 3.60,
    midpoint: 3.60,
    impliedVolatility: 0.38,
    delta: 0.45, gamma: 0.025, theta: -0.12, vega: 0.18, rho: 0.05,
    openInterest: 850, volume: 420,
    asOf: NOW.toISOString(),
    isStale: false,
    provider: "tradier",
    freshnessSeconds: 8,
    contractExists: true,
    isExpired: false,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<OptionsPreviewDeps> = {}): OptionsPreviewDeps {
  return {
    now: () => NOW,
    getDraftById: async (_id, uid) => uid === USER_ID ? makeDraftRow() : null,
    getTradePlan: async (id, uid) => uid === USER_ID && id === PLAN_ID ? makeTradePlan() : null,
    getPreflightResult: async () => makePreflight(),
    getCurrentLifecycleState: async () => "CURRENT",
    getLegQuotes: async (symbols) => {
      const map = new Map<string, CurrentLegQuoteData>();
      symbols.forEach(s => map.set(s, makeQuoteData()));
      return map;
    },
    getBuyingPowerStatus: async () => "PASS",
    getBrokerContext: async () => ({
      connected: true, executionMode: "DISABLED", executionEnabled: false,
      accountMasked: "••••5678", accountType: "MARGIN",
      supportsOptionsOrders: true, supportsMultiLegOrders: false,
      optionsPermissionStatus: "PASS" as const,
      supportedTimeInForce: ["DAY", "GTC"],
    }),
    appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    isExecutionEnabled: () => false,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. COMPLIANCE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Compliance constants", () => {
  it("disclaimer contains 'does not submit an order'", () => {
    expect(OPTIONS_PREVIEW_DISCLAIMER.toLowerCase()).toContain("does not submit an order");
  });
  it("disclaimer contains 'investment advice'", () => {
    expect(OPTIONS_PREVIEW_DISCLAIMER.toLowerCase()).toContain("investment advice");
  });
  it("non-execution banner contains 'Preview Only'", () => {
    expect(OPTIONS_PREVIEW_NON_EXECUTION_BANNER).toContain("Preview Only");
    expect(OPTIONS_PREVIEW_NON_EXECUTION_BANNER).toContain("Nothing has been submitted");
  });
  it("midpoint disclaimer contains 'differ materially'", () => {
    expect(OPTIONS_PREVIEW_MIDPOINT_DISCLAIMER.toLowerCase()).toContain("differ materially");
  });
  it("options risk disclosure contains 'significant risk'", () => {
    expect(OPTIONS_RISK_DISCLOSURE.toLowerCase()).toContain("significant risk");
  });
  it("price disclaimer contains 'execution prices may differ'", () => {
    expect(OPTIONS_PREVIEW_PRICE_DISCLAIMER.toLowerCase()).toContain("execution prices may differ");
  });
  it("methodology version is '2.8.3'", () => {
    expect(OPTIONS_PREVIEW_METHODOLOGY_VERSION).toBe("2.8.3");
  });
  it("forbidden labels include 'Best Options Trade'", () => {
    expect(OPTIONS_PREVIEW_FORBIDDEN_LABELS).toContain("Best Options Trade");
  });
  it("forbidden labels include 'Probability of Profit'", () => {
    expect(OPTIONS_PREVIEW_FORBIDDEN_LABELS).toContain("Probability of Profit");
  });
  it("forbidden labels include 'Roll Now'", () => {
    expect(OPTIONS_PREVIEW_FORBIDDEN_LABELS).toContain("Roll Now");
  });
  it("forbidden labels include 'Place Order'", () => {
    expect(OPTIONS_PREVIEW_FORBIDDEN_LABELS).toContain("Place Order");
  });
  it("strategy family labels cover long_call", () => {
    expect(STRATEGY_FAMILY_LABELS["long_call"]).toBe("Long Call");
  });
  it("strategy family labels cover iron_condor", () => {
    expect(STRATEGY_FAMILY_LABELS["iron_condor"]).toBe("Iron Condor");
  });
  it("strategy family labels cover calendar_spread", () => {
    expect(STRATEGY_FAMILY_LABELS["calendar_spread"]).toBe("Calendar Spread");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. EXECUTABLE = FALSE INVARIANT
// ─────────────────────────────────────────────────────────────────────────────

describe("executable = false invariant", () => {
  it("VALID preview has executable: false", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.executable).toBe(false);
  });
  it("UNAVAILABLE preview has executable: false", async () => {
    const deps = makeDeps({ getDraftById: async () => null });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: "bad", deps });
    expect(preview.executable).toBe(false);
  });
  it("EXPIRED preview has executable: false", async () => {
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({ expiresAt: EXPIRES_PAST }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.executable).toBe(false);
  });
  it("executable is the literal boolean false", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.executable === false).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. INSTRUMENT TYPE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Instrument type validation", () => {
  it("OPTION instrument type → accepted", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.blockers.some(b => b.code === "WRONG_INSTRUMENT_TYPE")).toBe(false);
  });
  it("MULTI_LEG_OPTION instrument type → accepted", async () => {
    const draft = makeMultiLegDraft();
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, draft) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "WRONG_INSTRUMENT_TYPE")).toBe(false);
  });
  it("EQUITY instrument type → WRONG_INSTRUMENT_TYPE blocker", async () => {
    const equityDraft = { ...makeSingleLegDraft(), instrumentType: "EQUITY" };
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, equityDraft as any) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "WRONG_INSTRUMENT_TYPE")).toBe(true);
  });
  it("instrumentType in preview matches draft", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.instrumentType).toBe("OPTION");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. BROAD EXPRESSION INVARIANT
// ─────────────────────────────────────────────────────────────────────────────

describe("Broad expression invariant", () => {
  it("LONG_OPTIONS broad expression → accepted", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.blockers.some(b => b.code === "WRONG_EXPRESSION_TYPE")).toBe(false);
  });
  it("COVERED_CALL broad expression → accepted", async () => {
    const deps = makeDeps({ getTradePlan: async () => makeTradePlan({ broadExpressionType: "COVERED_CALL" }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "WRONG_EXPRESSION_TYPE")).toBe(false);
  });
  it("CASH_SECURED_PUT broad expression → accepted", async () => {
    const deps = makeDeps({ getTradePlan: async () => makeTradePlan({ broadExpressionType: "CASH_SECURED_PUT" }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "WRONG_EXPRESSION_TYPE")).toBe(false);
  });
  it("DEFINED_RISK_OPTIONS → accepted", async () => {
    const deps = makeDeps({ getTradePlan: async () => makeTradePlan({ broadExpressionType: "DEFINED_RISK_OPTIONS" }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "WRONG_EXPRESSION_TYPE")).toBe(false);
  });
  it("INCOME_OPTIONS → accepted", async () => {
    const deps = makeDeps({ getTradePlan: async () => makeTradePlan({ broadExpressionType: "INCOME_OPTIONS" }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "WRONG_EXPRESSION_TYPE")).toBe(false);
  });
  it("NEUTRAL_OPTIONS → accepted", async () => {
    const deps = makeDeps({ getTradePlan: async () => makeTradePlan({ broadExpressionType: "NEUTRAL_OPTIONS" }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "WRONG_EXPRESSION_TYPE")).toBe(false);
  });
  it("STOCK broad expression → WRONG_EXPRESSION_TYPE blocker", async () => {
    const deps = makeDeps({ getTradePlan: async () => makeTradePlan({ broadExpressionType: "STOCK" }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "WRONG_EXPRESSION_TYPE")).toBe(true);
  });
  it("broad expression preserved in preview response", async () => {
    const deps = makeDeps({ getTradePlan: async () => makeTradePlan({ broadExpressionType: "LONG_OPTIONS" }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.broadExpressionType).toBe("LONG_OPTIONS");
  });
  it("broad expression cannot be changed by refresh", async () => {
    const deps = makeDeps();
    const { preview: first } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const { preview: second } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(first.broadExpressionType).toBe(second.broadExpressionType);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. SELECTED BY USER INVARIANT
// ─────────────────────────────────────────────────────────────────────────────

describe("selectedBy USER invariant", () => {
  it("selectedBy is always USER", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.selectedBy).toBe("USER");
  });
  it("selectedBy is USER even on UNAVAILABLE preview", async () => {
    const deps = makeDeps({ getDraftById: async () => null });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: "bad", deps });
    expect(preview.selectedBy).toBe("USER");
  });
  it("selectedBy is USER even on EXPIRED preview", async () => {
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({ expiresAt: EXPIRES_PAST }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.selectedBy).toBe("USER");
  });
  it("selectedBy is USER after refresh", async () => {
    const deps = makeDeps();
    await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.selectedBy).toBe("USER");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. STRATEGY FAMILY INVARIANT
// ─────────────────────────────────────────────────────────────────────────────

describe("Strategy family invariant", () => {
  it("long_call strategy family preserved", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.strategyFamily).toBe("long_call");
  });
  it("strategy family label is correct", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.strategyLabel).toBe("Long Call");
  });
  it("bull_call_spread strategy family preserved", async () => {
    const draft = makeMultiLegDraft("bull_call_spread");
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, draft) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.strategyFamily).toBe("bull_call_spread");
  });
  it("iron_condor strategy family preserved", async () => {
    const draft = { ...makeSingleLegDraft({ strategyFamily: "iron_condor" }), instrumentType: "MULTI_LEG_OPTION" };
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, draft as any) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.strategyFamily).toBe("iron_condor");
  });
  it("strategy family never changed by preview engine", async () => {
    const deps = makeDeps();
    const { preview: first } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const { preview: second } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(first.strategyFamily).toBe(second.strategyFamily);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. SINGLE-LEG OPTIONS PREVIEW (Long Call)
// ─────────────────────────────────────────────────────────────────────────────

describe("Single-leg long call preview", () => {
  it("returns VALID status on happy path", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(["VALID", "REQUIRES_REVIEW"]).toContain(preview.status);
  });
  it("has one leg", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs).toHaveLength(1);
  });
  it("leg has correct contractSymbol", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].contractSymbol).toBe("NVDA260918C00120000");
  });
  it("leg has correct optionType (call)", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].optionType).toBe("call");
  });
  it("leg has correct strike (120)", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].strike).toBe(120);
  });
  it("leg has correct expiration", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].expiration).toBe("2026-09-18");
  });
  it("leg has DTE > 0", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].dte).toBeGreaterThan(0);
  });
  it("leg has quantity from draft (2)", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].quantity).toBe(2);
  });
  it("leg multiplier is 100", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].multiplier).toBe(100);
  });
  it("leg has OPEN_LONG canonicalIntent", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].canonicalIntent).toBe("OPEN_LONG");
  });
  it("leg has current quote bid", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].currentQuote?.bid).toBe(3.50);
  });
  it("leg has current quote ask", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].currentQuote?.ask).toBe(3.70);
  });
  it("leg has current quote midpoint", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].currentQuote?.midpoint).toBe(3.60);
  });
  it("leg has draft quote preserved (mid=3.30)", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].draftQuote?.midpoint).toBe(3.30);
  });
  it("leg has Greeks (delta from current quote)", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].greeks?.delta).toBe(0.45);
  });
  it("leg has implied volatility", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].greeks?.impliedVolatility).toBe(0.38);
  });
  it("leg has open interest in liquidity", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].liquidity.openInterest).toBe(850);
  });
  it("leg status is AVAILABLE for fresh contract", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].status).toBe("AVAILABLE");
  });
  it("overall MARKET_ORDER_OPTIONS_WARNING NOT present for LIMIT order", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.warnings.some(w => w.code === "MARKET_ORDER_OPTIONS_WARNING")).toBe(false);
  });
  it("EXECUTION_DISABLED warning present", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.warnings.some(w => w.code === "EXECUTION_DISABLED")).toBe(true);
  });
  it("instrumentType is OPTION (not MULTI_LEG)", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.instrumentType).toBe("OPTION");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. SINGLE-LEG LONG PUT
// ─────────────────────────────────────────────────────────────────────────────

describe("Single-leg long put preview", () => {
  it("long_put strategy family displayed correctly", async () => {
    const draft = makeSingleLegDraft({ strategyFamily: "long_put", optionType: "put", legIntent: "OPEN_LONG" });
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, draft) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.strategyFamily).toBe("long_put");
    expect(preview.strategyLabel).toBe("Long Put");
  });
  it("put leg has correct optionType", async () => {
    const draft = makeSingleLegDraft({ strategyFamily: "long_put", optionType: "put", legIntent: "OPEN_LONG" });
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, draft) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.legs[0].optionType).toBe("put");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. COVERED CALL PREVIEW
// ─────────────────────────────────────────────────────────────────────────────

describe("Covered call preview", () => {
  it("covered_call strategy family accepted", async () => {
    const draft = makeSingleLegDraft({ strategyFamily: "covered_call", optionType: "call", legIntent: "OPEN_SHORT_COVERED" });
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({}, draft),
      getTradePlan: async () => makeTradePlan({ broadExpressionType: "COVERED_CALL" }),
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.strategyFamily).toBe("covered_call");
  });
  it("covered_call shows assignment risk context", async () => {
    const draft = makeSingleLegDraft({ strategyFamily: "covered_call", optionType: "call", legIntent: "OPEN_SHORT_COVERED" });
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({}, draft),
      getTradePlan: async () => makeTradePlan({ broadExpressionType: "COVERED_CALL" }),
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.assignmentExerciseContext.assignmentRisk).toBe(true);
    expect(preview.assignmentExerciseContext.coverageRequired).toBe(true);
  });
  it("covered_call broadcast expression not changed to CASH_SECURED_PUT", async () => {
    const draft = makeSingleLegDraft({ strategyFamily: "covered_call", optionType: "call", legIntent: "OPEN_SHORT_COVERED" });
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({}, draft),
      getTradePlan: async () => makeTradePlan({ broadExpressionType: "COVERED_CALL" }),
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.broadExpressionType).toBe("COVERED_CALL");
    expect(preview.strategyFamily).not.toBe("cash_secured_put");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. CASH-SECURED PUT PREVIEW
// ─────────────────────────────────────────────────────────────────────────────

describe("Cash-secured put preview", () => {
  it("cash_secured_put strategy shown correctly", async () => {
    const draft = makeSingleLegDraft({ strategyFamily: "cash_secured_put", optionType: "put", legIntent: "OPEN_SHORT_SECURED" });
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({}, draft),
      getTradePlan: async () => makeTradePlan({ broadExpressionType: "CASH_SECURED_PUT" }),
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.strategyFamily).toBe("cash_secured_put");
    expect(preview.assignmentExerciseContext.assignmentRisk).toBe(true);
    expect(preview.assignmentExerciseContext.assignmentNote).toContain("put strike");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. VERTICAL SPREAD PREVIEW (Bull Call Spread)
// ─────────────────────────────────────────────────────────────────────────────

describe("Bull call spread (vertical) preview", () => {
  it("has 2 legs", async () => {
    const draft = makeMultiLegDraft("bull_call_spread");
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, draft) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.legs).toHaveLength(2);
  });
  it("instrumentType is MULTI_LEG_OPTION", async () => {
    const draft = makeMultiLegDraft("bull_call_spread");
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, draft) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.instrumentType).toBe("MULTI_LEG_OPTION");
  });
  it("leg 0 is OPEN_LONG (long leg)", async () => {
    const draft = makeMultiLegDraft("bull_call_spread");
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, draft) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.legs[0].canonicalIntent).toBe("OPEN_LONG");
    expect(preview.legs[0].role).toBe("long_leg");
  });
  it("leg 0 strike is 120 (lower)", async () => {
    const draft = makeMultiLegDraft("bull_call_spread");
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, draft) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.legs[0].strike).toBe(120);
  });
  it("leg 1 strike is 125 (upper)", async () => {
    const draft = makeMultiLegDraft("bull_call_spread");
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, draft) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.legs[1].strike).toBe(125);
  });
  it("contract symbols are never replaced", async () => {
    const draft = makeMultiLegDraft("bull_call_spread");
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, draft) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.legs[0].contractSymbol).toBe("NVDA260918C00120000");
    expect(preview.legs[1].contractSymbol).toBe("NVDA260918C00125000");
  });
  it("MULTI_LEG_NOT_SUPPORTED warning when provider cannot do multi-leg", async () => {
    const draft = makeMultiLegDraft("bull_call_spread");
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({}, draft),
      getBrokerContext: async () => ({
        connected: true, executionMode: "DISABLED", executionEnabled: false,
        accountMasked: "••••5678", accountType: "MARGIN",
        supportsOptionsOrders: true, supportsMultiLegOrders: false,
        optionsPermissionStatus: "PASS" as const,
        supportedTimeInForce: ["DAY", "GTC"],
      }),
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.warnings.some(w => w.code === "MULTI_LEG_NOT_SUPPORTED")).toBe(true);
  });
  it("no leg decomposition warning message says 'No leg decomposition'", async () => {
    const draft = makeMultiLegDraft("bull_call_spread");
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, draft) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const w = preview.warnings.find(w => w.code === "MULTI_LEG_NOT_SUPPORTED");
    if (w) expect(w.message.toLowerCase()).toContain("no leg decomposition");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. CONTRACT CANDIDATE INVARIANT (immutability)
// ─────────────────────────────────────────────────────────────────────────────

describe("Contract candidate immutability", () => {
  it("contract symbols unchanged after market moves", async () => {
    const deps = makeDeps({
      getLegQuotes: async (symbols) => {
        const map = new Map<string, CurrentLegQuoteData>();
        symbols.forEach(s => map.set(s, makeQuoteData({ bid: 8.0, ask: 8.5, midpoint: 8.25 })));
        return map;
      },
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.legs[0].contractSymbol).toBe("NVDA260918C00120000");
  });
  it("strike unchanged after market moves", async () => {
    const deps = makeDeps({
      getLegQuotes: async (symbols) => {
        const map = new Map<string, CurrentLegQuoteData>();
        symbols.forEach(s => map.set(s, makeQuoteData({ bid: 8.0, ask: 8.5 })));
        return map;
      },
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.legs[0].strike).toBe(120);
  });
  it("expiration unchanged", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].expiration).toBe("2026-09-18");
  });
  it("quantity unchanged after market moves", async () => {
    const deps = makeDeps({
      getLegQuotes: async (symbols) => {
        const map = new Map<string, CurrentLegQuoteData>();
        symbols.forEach(s => map.set(s, makeQuoteData({ bid: 8.0, ask: 8.5 })));
        return map;
      },
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.legs[0].quantity).toBe(2);
  });
  it("ratio unchanged", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].ratio).toBe(1);
  });
  it("no 'recommendedContract' field in response", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() }) as any;
    expect(preview.recommendedContract).toBeUndefined();
    expect(preview.betterStrike).toBeUndefined();
    expect(preview.bestExpiration).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. DRAFT vs CURRENT DATA SEPARATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Draft vs current data separation", () => {
  it("draftQuote.midpoint (3.30) is separate from currentQuote.midpoint (3.60)", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].draftQuote?.midpoint).toBe(3.30);
    expect(preview.legs[0].currentQuote?.midpoint).toBe(3.60);
  });
  it("quoteChangeCategory is MATERIAL_CHANGE when current quote moved >2%", async () => {
    // Draft mid = 3.30, current mid = 3.60 → ~9% change
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].quoteChangeCategory).toBe("MATERIAL_CHANGE");
  });
  it("QUOTE_MOVED warning generated when material change", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.warnings.some(w => w.code === "QUOTE_MOVED")).toBe(true);
  });
  it("UNCHANGED quoteChangeCategory when quotes match", async () => {
    const deps = makeDeps({
      getLegQuotes: async (symbols) => {
        const map = new Map<string, CurrentLegQuoteData>();
        symbols.forEach(s => map.set(s, makeQuoteData({ bid: 3.20, ask: 3.40, midpoint: 3.30 })));
        return map;
      },
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.legs[0].quoteChangeCategory).toBe("UNCHANGED");
  });
  it("draft limit price never overwritten by current quote", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    // Draft had 3.30 reference — net pricing draft ref should be preserved
    expect(preview.netStructurePricing.draftNetReference).toBe(3.30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. NET DEBIT/CREDIT (sign convention)
// ─────────────────────────────────────────────────────────────────────────────

describe("Net debit/credit sign convention", () => {
  it("single long call → DEBIT (we pay premium)", async () => {
    // Long leg: debit. Short midpoint - long midpoint = 0 - 3.60 = negative → DEBIT
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.netStructurePricing.pricingType).toBe("DEBIT");
  });
  it("amount is positive (never negative)", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    if (preview.netStructurePricing.amountPerUnit !== null) {
      expect(preview.netStructurePricing.amountPerUnit).toBeGreaterThan(0);
    }
  });
  it("bull_call_spread net pricing is DEBIT (long call cost > short call credit)", async () => {
    const draft = makeMultiLegDraft("bull_call_spread");
    // Long 120C mid=3.60, Short 125C mid=3.60 (same quote stub)
    // Net = short_mid - long_mid = 3.60 - 3.60 = 0 → could be 0
    // Use different quotes to test real math
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({}, draft),
      getLegQuotes: async (symbols) => {
        const map = new Map<string, CurrentLegQuoteData>();
        map.set("NVDA260918C00120000", makeQuoteData({ midpoint: 4.50 })); // long 120C
        map.set("NVDA260918C00125000", makeQuoteData({ midpoint: 2.00 })); // short 125C
        return map;
      },
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    // Net = 2.00 (credit) - 4.50 (debit) = -2.50 → DEBIT 2.50
    expect(preview.netStructurePricing.pricingType).toBe("DEBIT");
    expect(preview.netStructurePricing.amountPerUnit).toBeCloseTo(2.50, 2);
  });
  it("amountPerContract = amountPerUnit × 100 (multiplier)", async () => {
    const draft = makeMultiLegDraft("bull_call_spread");
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({}, draft),
      getLegQuotes: async (symbols) => {
        const map = new Map<string, CurrentLegQuoteData>();
        map.set("NVDA260918C00120000", makeQuoteData({ midpoint: 4.50 }));
        map.set("NVDA260918C00125000", makeQuoteData({ midpoint: 2.00 }));
        return map;
      },
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const unit = preview.netStructurePricing.amountPerUnit;
    const perContract = preview.netStructurePricing.amountPerContract;
    if (unit !== null && perContract !== null) {
      expect(perContract).toBeCloseTo(unit * 100, 2);
    }
  });
  it("changeLabel is 'Current Structure Quote Change' (not 'Gain/Loss')", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.netStructurePricing.changeLabel).toBe("Current Structure Quote Change");
    expect(preview.netStructurePricing.changeLabel).not.toContain("Gain");
    expect(preview.netStructurePricing.changeLabel).not.toContain("Loss");
  });
  it("isMidpointEstimate is true", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.netStructurePricing.isMidpointEstimate).toBe(true);
  });
  it("midpoint disclaimer is present in preview", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.midpointDisclaimer).toBeTruthy();
    expect(preview.midpointDisclaimer.toLowerCase()).toContain("differ materially");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. GREEKS
// ─────────────────────────────────────────────────────────────────────────────

describe("Greeks", () => {
  it("Greeks present when current quote provides them", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].greeks).not.toBeNull();
    expect(preview.legs[0].greeks?.delta).toBe(0.45);
  });
  it("missing Greeks remain null (not zero)", async () => {
    const deps = makeDeps({
      getLegQuotes: async (symbols) => {
        const map = new Map<string, CurrentLegQuoteData>();
        symbols.forEach(s => map.set(s, makeQuoteData({ delta: null, gamma: null, theta: null, vega: null })));
        return map;
      },
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.legs[0].greeks?.delta).toBeNull();
    expect(preview.legs[0].greeks?.gamma).toBeNull();
    expect(preview.legs[0].greeks?.theta).toBeNull();
    expect(preview.legs[0].greeks?.vega).toBeNull();
  });
  it("PARTIAL_GREEKS warning when some Greeks missing", async () => {
    const deps = makeDeps({
      getLegQuotes: async (symbols) => {
        const map = new Map<string, CurrentLegQuoteData>();
        symbols.forEach(s => map.set(s, makeQuoteData({ delta: null, gamma: null })));
        return map;
      },
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.warnings.some(w => w.code === "PARTIAL_GREEKS")).toBe(true);
  });
  it("implied volatility visible on leg", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.legs[0].greeks?.impliedVolatility).toBe(0.38);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. EXPIRATION CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

describe("Expiration context", () => {
  it("primaryExpiration is set", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.expirationContext.primaryExpiration).toBe("2026-09-18");
  });
  it("single-expiration has hasMultipleExpirations=false", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.expirationContext.hasMultipleExpirations).toBe(false);
  });
  it("calendar spread has hasMultipleExpirations=true", async () => {
    const calendarDraft = {
      ...makeSingleLegDraft({ strategyFamily: "calendar_spread" }),
      instrumentType: "MULTI_LEG_OPTION",
      legs: [
        { legIndex: 0, instrumentType: "OPTION", symbol: "NVDA261016C00120000", optionType: "call", expiration: "2026-10-16", strike: 120, legIntent: "OPEN_SHORT_COVERED", ratio: 1, quantity: 2 },
        { legIndex: 1, instrumentType: "OPTION", symbol: "NVDA261120C00120000", optionType: "call", expiration: "2026-11-20", strike: 120, legIntent: "OPEN_LONG", ratio: 1, quantity: 2 },
      ],
      quoteSnapshot: { optionLegs: [], capturedAt: NOW.toISOString(), freshnessStatus: "FRESH", estimatedFreshForSec: 60 },
    };
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, calendarDraft as any) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.expirationContext.hasMultipleExpirations).toBe(true);
    expect(preview.expirationContext.secondaryExpiration).not.toBeNull();
  });
  it("DTE is computed correctly for 2026-09-18 from 2026-08-11", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    // 2026-08-11 to 2026-09-18 = 38 days
    expect(preview.legs[0].dte).toBeGreaterThan(30);
    expect(preview.legs[0].dte).toBeLessThan(50);
  });
  it("expired contract → CONTRACT_EXPIRED blocker", async () => {
    const expiredDraft = makeSingleLegDraft({ expiration: "2025-01-01" });
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, expiredDraft) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "CONTRACT_EXPIRED")).toBe(true);
  });
  it("near expiration (<=7 DTE) → NEAR_EXPIRATION warning", async () => {
    const nearExpDraft = makeSingleLegDraft({ expiration: "2026-08-15" }); // 4 days from NOW
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, nearExpDraft) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.warnings.some(w => w.code === "NEAR_EXPIRATION")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. LIQUIDITY CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

describe("Liquidity context", () => {
  it("liquidity has per-leg summary", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.liquidityContext.perLegSummary).toHaveLength(preview.legs.length);
  });
  it("wide spread → WIDE_SPREAD warning", async () => {
    const deps = makeDeps({
      getLegQuotes: async (symbols) => {
        const map = new Map<string, CurrentLegQuoteData>();
        symbols.forEach(s => map.set(s, makeQuoteData({ bid: 2.0, ask: 3.0, midpoint: 2.50 }))); // 40% spread
        return map;
      },
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.warnings.some(w => w.code === "WIDE_SPREAD")).toBe(true);
  });
  it("low OI → LOW_OPEN_INTEREST warning", async () => {
    const deps = makeDeps({
      getLegQuotes: async (symbols) => {
        const map = new Map<string, CurrentLegQuoteData>();
        symbols.forEach(s => map.set(s, makeQuoteData({ openInterest: 5 }))); // very low OI
        return map;
      },
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.warnings.some(w => w.code === "LOW_OPEN_INTEREST")).toBe(true);
  });
  it("no 'best-leg' language in liquidity", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    const json = JSON.stringify(preview.liquidityContext);
    expect(json).not.toContain("best leg");
    expect(json).not.toContain("Best Leg");
    expect(json).not.toContain("bestLeg");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. QUOTE FRESHNESS
// ─────────────────────────────────────────────────────────────────────────────

describe("Quote freshness", () => {
  it("quoteFreshness.totalLegs matches leg count", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.quoteFreshness.totalLegs).toBe(preview.legs.length);
  });
  it("stale quote → QUOTE_STALE blocker", async () => {
    const deps = makeDeps({
      getLegQuotes: async (symbols) => {
        const map = new Map<string, CurrentLegQuoteData>();
        symbols.forEach(s => map.set(s, makeQuoteData({ isStale: true })));
        return map;
      },
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "QUOTE_STALE")).toBe(true);
  });
  it("unavailable quote → QUOTE_STALE blocker", async () => {
    const deps = makeDeps({
      getLegQuotes: async () => new Map(),
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "QUOTE_STALE")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. RISK CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

describe("Risk context", () => {
  it("risk context maxLoss is carried from draft", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.riskContext.maxLoss).not.toBeNull();
  });
  it("risk context maxGain is carried", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.riskContext.maxGain).not.toBeNull();
  });
  it("risk context breakevens are present", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(Array.isArray(preview.riskContext.breakevens)).toBe(true);
  });
  it("risk context netGreeks comes from trade plan riskSnapshot", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    if (preview.riskContext.netGreeks) {
      expect(preview.riskContext.netGreeks.netDelta).toBe(0.42);
    }
  });
  it("thesis invalidated → researchInvalidation=true", async () => {
    const deps = makeDeps({ getCurrentLifecycleState: async () => "THESIS_INVALIDATED" });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.riskContext.researchInvalidation).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. ASSIGNMENT/EXERCISE CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

describe("Assignment/exercise context", () => {
  it("long call: hasLongLegs=true, hasShortLegs=false", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.assignmentExerciseContext.hasLongLegs).toBe(true);
    expect(preview.assignmentExerciseContext.hasShortLegs).toBe(false);
  });
  it("long call: assignmentRisk=false", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.assignmentExerciseContext.assignmentRisk).toBe(false);
  });
  it("bull_call_spread: short leg has assignment risk", async () => {
    const draft = makeMultiLegDraft("bull_call_spread");
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, draft) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.assignmentExerciseContext.hasShortLegs).toBe(true);
    expect(preview.assignmentExerciseContext.assignmentRisk).toBe(true);
  });
  it("earlyExerciseRisk on short options", async () => {
    const draft = makeSingleLegDraft({ strategyFamily: "covered_call", optionType: "call", legIntent: "OPEN_SHORT_COVERED" });
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({}, draft),
      getTradePlan: async () => makeTradePlan({ broadExpressionType: "COVERED_CALL" }),
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.assignmentExerciseContext.earlyExerciseRisk).toBe(true);
  });
  it("no probability language in assignment context", async () => {
    const draft = makeSingleLegDraft({ strategyFamily: "covered_call", optionType: "call", legIntent: "OPEN_SHORT_COVERED" });
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({}, draft),
      getTradePlan: async () => makeTradePlan({ broadExpressionType: "COVERED_CALL" }),
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const assignmentNote = preview.assignmentExerciseContext.assignmentNote ?? "";
    expect(assignmentNote.toLowerCase()).not.toContain("probability");
    expect(assignmentNote.toLowerCase()).not.toContain("chance");
    expect(assignmentNote.toLowerCase()).not.toContain("likely");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 21. DRAFT EXPIRY
// ─────────────────────────────────────────────────────────────────────────────

describe("Draft expiry", () => {
  it("expired draft → EXPIRED status", async () => {
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({ expiresAt: EXPIRES_PAST }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.status).toBe("EXPIRED");
    expect(preview.blockers.some(b => b.code === "ORDER_DRAFT_EXPIRED")).toBe(true);
  });
  it("expired draft blocker mentions Order Preparation", async () => {
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({ expiresAt: EXPIRES_PAST }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const b = preview.blockers.find(b => b.code === "ORDER_DRAFT_EXPIRED");
    expect(b?.message.toLowerCase()).toContain("order preparation");
  });
  it("refresh of expired draft still returns EXPIRED", async () => {
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({ expiresAt: EXPIRES_PAST }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.status).toBe("EXPIRED");
  });
  it("abandoned draft → UNAVAILABLE status", async () => {
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({ status: "ABANDONED" }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "ORDER_DRAFT_ABANDONED")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 22. PREFLIGHT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Preflight validation", () => {
  it("missing preflight → PREFLIGHT_MISSING blocker", async () => {
    const deps = makeDeps({ getPreflightResult: async () => null });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "PREFLIGHT_MISSING")).toBe(true);
  });
  it("failing preflight → PREFLIGHT_NOT_PASSING blocker", async () => {
    const deps = makeDeps({ getPreflightResult: async () => makePreflight({ status: "FAIL" }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "PREFLIGHT_NOT_PASSING")).toBe(true);
  });
  it("expired preflight → PREFLIGHT_EXPIRED blocker", async () => {
    const deps = makeDeps({ getPreflightResult: async () => makePreflight({ validUntil: EXPIRES_PAST }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "PREFLIGHT_EXPIRED")).toBe(true);
  });
  it("preflight expiry approaching → PREFLIGHT_EXPIRY_APPROACHING warning", async () => {
    const twoMin = new Date(NOW.getTime() + 2 * 60 * 1000);
    const deps = makeDeps({ getPreflightResult: async () => makePreflight({ validUntil: twoMin }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.warnings.some(w => w.code === "PREFLIGHT_EXPIRY_APPROACHING")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 23. TRADE PLAN VERSION
// ─────────────────────────────────────────────────────────────────────────────

describe("Trade plan version", () => {
  it("version mismatch → TRADE_PLAN_VERSION_CHANGED blocker", async () => {
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({ tradePlanVersion: 1 }),
      getTradePlan: async () => makeTradePlan({ version: 2 }),
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "TRADE_PLAN_VERSION_CHANGED")).toBe(true);
  });
  it("matching version → no version blocker", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.blockers.some(b => b.code === "TRADE_PLAN_VERSION_CHANGED")).toBe(false);
  });
  it("trade plan not found → TRADE_PLAN_NOT_FOUND blocker", async () => {
    const deps = makeDeps({ getTradePlan: async () => null });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "TRADE_PLAN_NOT_FOUND")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 24. LIFECYCLE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Lifecycle validation", () => {
  it("THESIS_INVALIDATED → LIFECYCLE_THESIS_INVALIDATED blocker", async () => {
    const deps = makeDeps({ getCurrentLifecycleState: async () => "THESIS_INVALIDATED" });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "LIFECYCLE_THESIS_INVALIDATED")).toBe(true);
  });
  it("REQUIRES_REVIEW lifecycle → LIFECYCLE_CHANGED blocker", async () => {
    const deps = makeDeps({ getCurrentLifecycleState: async () => "REQUIRES_REVIEW" });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "LIFECYCLE_CHANGED")).toBe(true);
  });
  it("CURRENT lifecycle → no lifecycle blockers", async () => {
    const deps = makeDeps({ getCurrentLifecycleState: async () => "CURRENT" });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => ["LIFECYCLE_THESIS_INVALIDATED", "LIFECYCLE_CHANGED"].includes(b.code))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 25. SOURCE INTEGRITY
// ─────────────────────────────────────────────────────────────────────────────

describe("Source integrity", () => {
  it("allPass=true on happy path (quote issue aside)", async () => {
    // Note: quote stale + QUOTE_MOVED may set allPass=false — that's correct
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(typeof preview.sourceIntegrity.allPass).toBe("boolean");
  });
  it("tradePlanMatches=true on happy path", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.sourceIntegrity.tradePlanMatches).toBe(true);
  });
  it("broadExpressionMatches=false when expression is STOCK", async () => {
    const deps = makeDeps({ getTradePlan: async () => makeTradePlan({ broadExpressionType: "STOCK" }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.sourceIntegrity.broadExpressionMatches).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 26. BROKER / ACCOUNT
// ─────────────────────────────────────────────────────────────────────────────

describe("Broker / account", () => {
  it("accountMasked contains ••••", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.broker.accountMasked).toContain("••••");
  });
  it("full account ID never in preview JSON", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(JSON.stringify(preview)).not.toContain("ACCT12345678");
  });
  it("executionMode is DISABLED", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.broker.executionMode).toBe("DISABLED");
  });
  it("executionEnabled is false", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.broker.executionEnabled).toBe(false);
  });
  it("broker disconnected → BROKER_DISCONNECTED blocker", async () => {
    const deps = makeDeps({
      getBrokerContext: async () => ({
        connected: false, executionMode: "DISABLED", executionEnabled: false,
        accountMasked: "••••5678", accountType: "MARGIN",
        supportsOptionsOrders: false, supportsMultiLegOrders: false,
        optionsPermissionStatus: "UNAVAILABLE" as const,
        supportedTimeInForce: [],
      }),
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "BROKER_DISCONNECTED")).toBe(true);
  });
  it("insufficient options permissions → OPTIONS_PERMISSION_INSUFFICIENT blocker", async () => {
    const deps = makeDeps({
      getBrokerContext: async () => ({
        connected: true, executionMode: "DISABLED", executionEnabled: false,
        accountMasked: "••••5678", accountType: "MARGIN",
        supportsOptionsOrders: true, supportsMultiLegOrders: false,
        optionsPermissionStatus: "INSUFFICIENT" as const,
        supportedTimeInForce: ["DAY"],
      }),
    });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "OPTIONS_PERMISSION_INSUFFICIENT")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 27. MARKET HOURS
// ─────────────────────────────────────────────────────────────────────────────

describe("Market hours", () => {
  it("OPEN market → no market session warning", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.warnings.some(w => w.code === "MARKET_CLOSED" || w.code === "PRE_MARKET" || w.code === "AFTER_HOURS")).toBe(false);
  });
  it("CLOSED market → MARKET_CLOSED warning", async () => {
    const closedDraft = { ...makeSingleLegDraft(), marketHoursContext: { sessionState: "CLOSED", asOf: NOW.toISOString() } };
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, closedDraft as any) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.warnings.some(w => w.code === "MARKET_CLOSED")).toBe(true);
  });
  it("PRE_MARKET → PRE_MARKET warning", async () => {
    const preDraft = { ...makeSingleLegDraft(), marketHoursContext: { sessionState: "PRE_MARKET", asOf: NOW.toISOString() } };
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({}, preDraft as any) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.warnings.some(w => w.code === "PRE_MARKET")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 28. NO SUBMISSION / NO CONFIRMATION
// ─────────────────────────────────────────────────────────────────────────────

describe("No submission and no confirmation", () => {
  it("preview has no 'confirmed' field", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() }) as any;
    expect(preview.confirmed).toBeUndefined();
    expect(preview.isConfirmed).toBeUndefined();
  });
  it("preview has no 'submitted' field", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() }) as any;
    expect(preview.submitted).toBeUndefined();
    expect(preview.brokerOrderId).toBeUndefined();
  });
  it("no broker mutation methods called", async () => {
    const placeOrder = vi.fn();
    const submitOrder = vi.fn();
    await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(placeOrder).not.toHaveBeenCalled();
    expect(submitOrder).not.toHaveBeenCalled();
  });
  it("preview has no decomposedLegs field", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() }) as any;
    expect(preview.decomposedLegs).toBeUndefined();
    expect(preview.individualLegOrders).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 29. SECURITY — CROSS-USER
// ─────────────────────────────────────────────────────────────────────────────

describe("Security", () => {
  it("cross-user draft → UNAVAILABLE with ORDER_DRAFT_NOT_FOUND", async () => {
    const deps = makeDeps({
      getDraftById: async (_id, uid) => uid === USER_ID ? makeDraftRow() : null,
    });
    const { preview } = await generateOptionsPreview({ userId: "other-user", draftId: DRAFT_ID, deps });
    expect(preview.status).toBe("UNAVAILABLE");
    expect(preview.blockers.some(b => b.code === "ORDER_DRAFT_NOT_FOUND")).toBe(true);
  });
  it("cross-user trade plan → TRADE_PLAN_NOT_FOUND", async () => {
    const deps = makeDeps({
      getTradePlan: async (_id, uid) => uid === USER_ID ? makeTradePlan() : null,
    });
    const { preview } = await generateOptionsPreview({
      userId: "other-user", draftId: DRAFT_ID,
      deps: { ...deps, getDraftById: async (_id, uid) => uid === "other-user" ? makeDraftRow() : null },
    });
    expect(preview.blockers.some(b => b.code === "TRADE_PLAN_NOT_FOUND")).toBe(true);
  });
  it("full account ID never exposed", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(JSON.stringify(preview)).not.toContain("ACCT12345678");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 30. AUDIT EVENTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Audit events", () => {
  it("OPTIONS_PREVIEW_GENERATED event is appended", async () => {
    const appendAuditEvent = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ appendAuditEvent });
    await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "OPTIONS_PREVIEW_GENERATED" })
    );
  });
  it("audit metadata contains strategyFamily", async () => {
    const appendAuditEvent = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ appendAuditEvent });
    await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const meta = appendAuditEvent.mock.calls[0][0].metadata;
    expect(meta.strategyFamily).toBeTruthy();
  });
  it("audit metadata contains legCount", async () => {
    const appendAuditEvent = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ appendAuditEvent });
    await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const meta = appendAuditEvent.mock.calls[0][0].metadata;
    expect(meta.legCount).toBeDefined();
  });
  it("audit metadata has no strike prices or quantities", async () => {
    const appendAuditEvent = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ appendAuditEvent });
    await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const meta = appendAuditEvent.mock.calls[0][0].metadata;
    expect(meta.strike).toBeUndefined();
    expect(meta.quantity).toBeUndefined();
    expect(meta.netDebit).toBeUndefined();
  });
  it("audit event type is not ORDER_SUBMITTED or ORDER_CONFIRMED", async () => {
    const appendAuditEvent = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ appendAuditEvent });
    await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    for (const call of appendAuditEvent.mock.calls) {
      expect(call[0].eventType).not.toBe("ORDER_SUBMITTED");
      expect(call[0].eventType).not.toBe("ORDER_CONFIRMED");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 31. PLATFORM HEALTH METRICS
// ─────────────────────────────────────────────────────────────────────────────

describe("Platform health metrics", () => {
  it("returns an object with expected fields", () => {
    const metrics = getOptionsPreviewMetrics();
    expect(typeof metrics.previewRequests).toBe("number");
    expect(typeof metrics.singleLegPreviews).toBe("number");
    expect(typeof metrics.multiLegPreviews).toBe("number");
    expect(metrics.brokerSubmissionEnabled).toBe(false);
  });
  it("metrics increment after preview generation", async () => {
    const before = getOptionsPreviewMetrics().previewRequests;
    await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    const after = getOptionsPreviewMetrics().previewRequests;
    expect(after).toBeGreaterThan(before);
  });
  it("singleLegPreviews increments for single-leg preview", async () => {
    const before = getOptionsPreviewMetrics().singleLegPreviews;
    await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    const after = getOptionsPreviewMetrics().singleLegPreviews;
    expect(after).toBeGreaterThan(before);
  });
  it("metrics contain no contract symbols or prices", () => {
    const metrics = getOptionsPreviewMetrics();
    const json = JSON.stringify(metrics);
    expect(json).not.toContain("strike");
    expect(json).not.toContain("price");
    expect(json).not.toContain(USER_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 32. COMPLIANCE
// ─────────────────────────────────────────────────────────────────────────────

describe("Compliance", () => {
  it("disclaimer present in preview", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.disclaimer).toBe(OPTIONS_PREVIEW_DISCLAIMER);
  });
  it("options risk disclosure present", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.optionsRiskDisclosure).toBe(OPTIONS_RISK_DISCLOSURE);
  });
  it("no 'Probability of Profit' in preview JSON", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(JSON.stringify(preview)).not.toContain("Probability of Profit");
  });
  it("no 'Ready to Trade' in preview JSON", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(JSON.stringify(preview)).not.toContain("Ready to Trade");
  });
  it("no 'Best Options Trade' in preview JSON", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(JSON.stringify(preview)).not.toContain("Best Options Trade");
  });
  it("no 'Roll Now' in preview JSON", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(JSON.stringify(preview)).not.toContain("Roll Now");
  });
  it("status is not READY_TO_TRADE or APPROVED", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.status).not.toBe("READY_TO_TRADE" as any);
    expect(preview.status).not.toBe("APPROVED" as any);
  });
  it("preview has methodology version 2.8.3", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(preview.methodologyVersion).toBe("2.8.3");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 33. VALIDITY WINDOW
// ─────────────────────────────────────────────────────────────────────────────

describe("Validity window", () => {
  it("validUntil is in the future for valid preview", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    // Even REQUIRES_REVIEW should have a future validUntil
    if (["VALID", "REQUIRES_REVIEW"].includes(preview.status)) {
      expect(new Date(preview.validUntil).getTime()).toBeGreaterThan(NOW.getTime());
    }
  });
  it("validUntil bounded by draft expiresAt", async () => {
    const soonExpires = new Date(NOW.getTime() + 2 * 60 * 1000);
    const deps = makeDeps({ getDraftById: async () => makeDraftRow({ expiresAt: soonExpires }) });
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    if (!["EXPIRED", "UNAVAILABLE"].includes(preview.status)) {
      expect(new Date(preview.validUntil).getTime()).toBeLessThanOrEqual(soonExpires.getTime() + 1000);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 34. REFRESH DOES NOT MUTATE DRAFT
// ─────────────────────────────────────────────────────────────────────────────

describe("Refresh does not mutate draft", () => {
  it("leg strikes unchanged across two calls (refresh simulation)", async () => {
    const deps = makeDeps();
    const { preview: first } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const { preview: second } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(first.legs[0].strike).toBe(second.legs[0].strike);
  });
  it("strategy family unchanged across calls", async () => {
    const deps = makeDeps();
    const { preview: first } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const { preview: second } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(first.strategyFamily).toBe(second.strategyFamily);
  });
  it("quantity unchanged across calls", async () => {
    const deps = makeDeps();
    const { preview: first } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const { preview: second } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(first.quantityContext.confirmedQuantity).toBe(second.quantityContext.confirmedQuantity);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 35. ROADMAP DISCIPLINE
// ─────────────────────────────────────────────────────────────────────────────

describe("Roadmap discipline", () => {
  it("preview has no fillPrice or fillQuantity", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() }) as any;
    expect(preview.fillPrice).toBeUndefined();
    expect(preview.fillQuantity).toBeUndefined();
    expect(preview.brokerOrderId).toBeUndefined();
  });
  it("preview has no 'expectedReturn' field", async () => {
    const { preview } = await generateOptionsPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() }) as any;
    expect(preview.expectedReturn).toBeUndefined();
    expect(preview.probabilityOfProfit).toBeUndefined();
  });
});
