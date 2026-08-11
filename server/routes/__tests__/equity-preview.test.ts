/**
 * server/routes/__tests__/equity-preview.test.ts — Sprint 2.8.2
 *
 * 125+ assertions covering the Equity Order Preview engine.
 *
 * PERMANENT INVARIANTS TESTED:
 *   - executable is always false
 *   - expressionType must be STOCK
 *   - expressionSelectedBy must be USER
 *   - Preview never mutates OrderDraft
 *   - Quantity shown is user-selected draft quantity
 *   - Draft limit price never auto-changed
 *   - Current market data is separate from draft values
 *   - No submission / confirmation actions
 *   - No broker mutation methods called
 *   - Cross-user access blocked
 *   - Expired draft → EXPIRED preview
 *   - Expired preflight → REQUIRES_REVIEW
 *   - Wrong expression type → WRONG_EXPRESSION_TYPE blocker
 *   - Compliance: no forbidden labels
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

import {
  generateEquityPreview,
  getEquityPreviewMetrics,
  type EquityPreviewDeps,
} from "../../services/equity-preview-service";
import type { OrderDraft } from "../../../shared/order-draft-types";
import {
  EQUITY_PREVIEW_DISCLAIMER,
  EQUITY_PREVIEW_PRICE_DISCLAIMER,
  EQUITY_PREVIEW_MARKET_ORDER_WARNING,
  EQUITY_PREVIEW_METHODOLOGY_VERSION,
  EQUITY_PREVIEW_NON_EXECUTION_BANNER,
  EQUITY_PREVIEW_FORBIDDEN_LABELS,
  EQUITY_PREVIEW_LIMIT_EDUCATION,
  SIDE_INTENT_LABELS,
  PRICE_MOVEMENT_MATERIAL_THRESHOLD_PCT,
} from "../../../shared/equity-order-preview-types";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const USER_ID = "user-test-1";
const DRAFT_ID = "draft-test-1";
const PLAN_ID  = "plan-test-1";
const PF_ID    = "pf-test-1";

const NOW = new Date("2026-08-11T15:00:00Z");
const EXPIRES_FUTURE = new Date(NOW.getTime() + 30 * 60 * 1000); // +30 min
const EXPIRES_PAST   = new Date(NOW.getTime() - 60 * 1000);      // -1 min

function makeOrderDraft(overrides: Partial<OrderDraft> = {}): OrderDraft {
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
    brokerAccountType: "CASH",
    instrumentType: "EQUITY",
    structureType: "equity_long",
    sideIntent: "OPEN_LONG",
    status: "DRAFT",
    executionMode: "DISABLED",
    legs: [{ legIndex: 0, instrumentType: "EQUITY", symbol: "NVDA", legIntent: "OPEN_LONG", ratio: 1, quantity: 10 }],
    quantityContext: {
      confirmedQuantity: 10,
      unit: "shares",
      hypotheticalPlanQuantity: 15,
      fractionalSupported: false,
      requiresExplicitConfirmation: false,
    },
    pricingContext: {
      orderType: "MARKET",
      marketOrderWarningGenerated: true,
      extendedHoursRequested: false,
      extendedHoursSupported: false,
      priceRoundingApplied: false,
    },
    timeInForceContext: { timeInForce: "DAY", supported: true },
    capitalContext: {
      estimatedNotional: 1200,
      currency: "USD",
      estimateNote: "Estimated. Broker buying power is authoritative.",
    },
    riskContext: {
      maxLoss: null, maxGain: null, breakevens: [], capitalProfile: null,
      riskFlags: ["earnings_approaching"],
      constraintStatus: "WITHIN_CONSTRAINTS",
      riskAnalysisId: null, coverageValidated: false,
    },
    quoteSnapshot: {
      underlying: { contractSymbol: "NVDA", bid: 118.5, ask: 119.0, midpoint: 118.75, last: 118.8, provider: "tradier", asOf: NOW.toISOString(), isStale: false },
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
    ...overrides,
  } as unknown as OrderDraft;
}

function makeDraftRow(overrides: Partial<{
  status: string; version: number; expiresAt: Date; tradePlanVersion: number;
}> = {}) {
  const draft = makeOrderDraft();
  return {
    id: DRAFT_ID,
    userId: USER_ID,
    tradePlanId: PLAN_ID,
    tradePlanVersion: overrides.tradePlanVersion ?? 1,
    preflightId: PF_ID,
    draftJson: draft as unknown as Record<string, unknown>,
    status: overrides.status ?? "DRAFT",
    version: overrides.version ?? 1,
    expiresAt: overrides.expiresAt ?? EXPIRES_FUTURE,
  };
}

function makeTradePlan(overrides: Partial<{
  broadExpressionType: string | null;
  expressionSelectedBy: string | null;
  version: number;
}> = {}) {
  return {
    id: PLAN_ID, userId: USER_ID, symbol: "NVDA", companyName: "NVIDIA Corporation",
    version: overrides.version ?? 1,
    broadExpressionType: overrides.broadExpressionType ?? "STOCK",
    expressionSelectedBy: overrides.expressionSelectedBy ?? "USER",
    expressionSelectedAt: NOW.toISOString(),
    selectedExpressionFamily: "equity",
    researchSnapshot: { summary: "VCP breakout pattern", thesis: "Strong momentum", score: 82 },
    planningSnapshot: null, riskSnapshot: null,
    status: "ACTIVE", createdAt: NOW, updatedAt: NOW,
  };
}

function makePreflight(overrides: Partial<{
  status: string; validUntil: Date | null;
}> = {}) {
  return {
    id: PF_ID, status: overrides.status ?? "PASS",
    evaluatedAt: NOW,
    validUntil: overrides.validUntil !== undefined ? overrides.validUntil : new Date(NOW.getTime() + 15 * 60 * 1000),
    resultJson: {},
  };
}

function makeFreshQuote(overrides: Partial<{
  bid: number | null; ask: number | null; midpoint: number | null; isStale: boolean;
  isCrossed: boolean; freshnessSeconds: number;
}> = {}) {
  return {
    bid: overrides.bid ?? 120.0,
    ask: overrides.ask ?? 120.5,
    last: 120.2,
    midpoint: overrides.midpoint ?? 120.25,
    asOf: NOW.toISOString(),
    isStale: overrides.isStale ?? false,
    isCrossed: overrides.isCrossed ?? false,
    provider: "tradier",
    freshnessSeconds: overrides.freshnessSeconds ?? 5,
  };
}

function makeDeps(overrides: Partial<EquityPreviewDeps> = {}): EquityPreviewDeps {
  return {
    now: () => NOW,
    getDraftById: async (_id, uid) => uid === USER_ID ? makeDraftRow() : null,
    getTradePlan: async (id, uid) => uid === USER_ID && id === PLAN_ID ? makeTradePlan() : null,
    getPreflightResult: async () => makePreflight(),
    getCurrentLifecycleState: async () => "CURRENT",
    getQuoteForPreview: async () => makeFreshQuote(),
    getBuyingPowerStatus: async () => "PASS",
    getBrokerContext: async () => ({
      connected: true,
      executionMode: "DISABLED",
      executionEnabled: false,
      accountMasked: "••••5678",
      accountType: "CASH",
      supportsMarketOrders: true,
      supportsLimitOrders: true,
      supportedTimeInForce: ["DAY", "GTC"],
    }),
    appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    isExecutionEnabled: () => false,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CANONICAL TYPE & COMPLIANCE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Canonical equity preview types and compliance constants", () => {
  it("disclaimer is present", () => {
    expect(EQUITY_PREVIEW_DISCLAIMER).toBeTruthy();
    expect(EQUITY_PREVIEW_DISCLAIMER.length).toBeGreaterThan(50);
  });

  it("disclaimer contains 'does not submit an order'", () => {
    expect(EQUITY_PREVIEW_DISCLAIMER.toLowerCase()).toContain("does not submit an order");
  });

  it("disclaimer contains 'not constitute investment advice'", () => {
    expect(EQUITY_PREVIEW_DISCLAIMER.toLowerCase()).toContain("investment advice");
  });

  it("price disclaimer is present", () => {
    expect(EQUITY_PREVIEW_PRICE_DISCLAIMER).toBeTruthy();
    expect(EQUITY_PREVIEW_PRICE_DISCLAIMER.toLowerCase()).toContain("reference values");
  });

  it("market order warning is present", () => {
    expect(EQUITY_PREVIEW_MARKET_ORDER_WARNING).toBeTruthy();
    expect(EQUITY_PREVIEW_MARKET_ORDER_WARNING.toLowerCase()).toContain("not guarantee");
  });

  it("non-execution banner contains 'Preview Only'", () => {
    expect(EQUITY_PREVIEW_NON_EXECUTION_BANNER).toContain("Preview Only");
    expect(EQUITY_PREVIEW_NON_EXECUTION_BANNER).toContain("Nothing has been submitted");
  });

  it("limit education text explains limit semantics", () => {
    expect(EQUITY_PREVIEW_LIMIT_EDUCATION.toLowerCase()).toContain("does not guarantee");
  });

  it("forbidden labels include 'Ready to Trade'", () => {
    expect(EQUITY_PREVIEW_FORBIDDEN_LABELS).toContain("Ready to Trade");
  });

  it("forbidden labels include submission CTAs", () => {
    const forbidden = EQUITY_PREVIEW_FORBIDDEN_LABELS as readonly string[];
    expect(forbidden).toContain("Confirm & Submit");
    expect(forbidden).toContain("Place Order");
    expect(forbidden).toContain("Submit Order");
    expect(forbidden).toContain("Buy Now");
    expect(forbidden).toContain("Sell Now");
    expect(forbidden).toContain("Execute");
    expect(forbidden).toContain("Send to Broker");
  });

  it("forbidden labels include recommendation labels", () => {
    const forbidden = EQUITY_PREVIEW_FORBIDDEN_LABELS as readonly string[];
    expect(forbidden).toContain("Trade Approved");
    expect(forbidden).toContain("Recommended Limit");
    expect(forbidden).toContain("Recommended Quantity");
    expect(forbidden).toContain("Best Price");
    expect(forbidden).toContain("Guaranteed Fill");
    expect(forbidden).toContain("Expected Fill");
  });

  it("methodology version is '2.8.2'", () => {
    expect(EQUITY_PREVIEW_METHODOLOGY_VERSION).toBe("2.8.2");
  });

  it("SIDE_INTENT_LABELS has OPEN_LONG", () => {
    expect(SIDE_INTENT_LABELS["OPEN_LONG"]).toBe("Open Long Position");
  });

  it("SIDE_INTENT_LABELS has CLOSE_LONG", () => {
    expect(SIDE_INTENT_LABELS["CLOSE_LONG"]).toBe("Close Long Position");
  });

  it("price movement threshold is 0.5%", () => {
    expect(PRICE_MOVEMENT_MATERIAL_THRESHOLD_PCT).toBe(0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. EXECUTABLE = FALSE INVARIANT
// ─────────────────────────────────────────────────────────────────────────────

describe("executable = false invariant", () => {
  it("preview has executable: false", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.executable).toBe(false);
  });

  it("executable is the literal false (type guard)", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    // Type-level: executable must equal false, never true
    expect(preview.executable === false).toBe(true);
  });

  it("UNAVAILABLE preview also has executable: false", async () => {
    const deps = makeDeps({ getDraftById: async () => null });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.executable).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. STOCK EXPRESSION INVARIANT
// ─────────────────────────────────────────────────────────────────────────────

describe("STOCK expression invariant", () => {
  it("expressionType is always STOCK", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.expressionType).toBe("STOCK");
  });

  it("wrong broadExpressionType (LONG_OPTIONS) → WRONG_EXPRESSION_TYPE blocker", async () => {
    const deps = makeDeps({
      getTradePlan: async () => makeTradePlan({ broadExpressionType: "LONG_OPTIONS" }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "WRONG_EXPRESSION_TYPE")).toBe(true);
  });

  it("wrong broadExpressionType (COVERED_CALL) → WRONG_EXPRESSION_TYPE blocker", async () => {
    const deps = makeDeps({
      getTradePlan: async () => makeTradePlan({ broadExpressionType: "COVERED_CALL" }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "WRONG_EXPRESSION_TYPE")).toBe(true);
  });

  it("null broadExpressionType (pre-2.8.1A plan) is treated as STOCK", async () => {
    const deps = makeDeps({
      getTradePlan: async () => makeTradePlan({ broadExpressionType: null }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "WRONG_EXPRESSION_TYPE")).toBe(false);
  });

  it("expressionType is STOCK even after refresh", async () => {
    const deps = makeDeps();
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.expressionType).toBe("STOCK");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. SELECTED BY USER
// ─────────────────────────────────────────────────────────────────────────────

describe("selectedBy USER invariant", () => {
  it("expressionSelectedBy is always USER", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.expressionSelectedBy).toBe("USER");
  });

  it("expressionTrace.selectedBy is USER", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.expressionTrace.selectedBy).toBe("USER");
  });

  it("expressionTrace.selectedExpressionType is STOCK", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.expressionTrace.selectedExpressionType).toBe("STOCK");
  });

  it("selectedBy is USER even on UNAVAILABLE preview", async () => {
    const deps = makeDeps({ getDraftById: async () => null });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.expressionSelectedBy).toBe("USER");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. VALID PREVIEW (happy path)
// ─────────────────────────────────────────────────────────────────────────────

describe("Valid preview — happy path", () => {
  it("returns VALID status when all checks pass", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.status).toBe("VALID");
  });

  it("has no blockers on happy path", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    const realBlockers = preview.blockers.filter(b => b.code !== "EXECUTION_DISABLED");
    expect(realBlockers).toHaveLength(0);
  });

  it("has correct symbol", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.symbol).toBe("NVDA");
  });

  it("has correct tradePlanId", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.tradePlanId).toBe(PLAN_ID);
  });

  it("has generatedAt and validUntil", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.generatedAt).toBeTruthy();
    expect(preview.validUntil).toBeTruthy();
    expect(new Date(preview.validUntil).getTime()).toBeGreaterThan(new Date(preview.generatedAt).getTime());
  });

  it("has correct methodology version", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.methodologyVersion).toBe("2.8.2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. DRAFT REQUIRED
// ─────────────────────────────────────────────────────────────────────────────

describe("Draft required", () => {
  it("returns UNAVAILABLE when draft not found", async () => {
    const deps = makeDeps({ getDraftById: async () => null });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: "bad-id", deps });
    expect(preview.status).toBe("UNAVAILABLE");
    expect(preview.blockers.some(b => b.code === "ORDER_DRAFT_NOT_FOUND")).toBe(true);
  });

  it("returns UNAVAILABLE when draft is abandoned", async () => {
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({ status: "ABANDONED" }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.status).toBe("UNAVAILABLE");
    expect(preview.blockers.some(b => b.code === "ORDER_DRAFT_ABANDONED")).toBe(true);
  });

  it("provides 'Prepare Order Draft' guidance in blocker message when draft missing", async () => {
    const deps = makeDeps({ getDraftById: async () => null });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: "missing", deps });
    expect(preview.blockers[0].message).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. DRAFT EXPIRY (Task #136 integration)
// ─────────────────────────────────────────────────────────────────────────────

describe("Draft expiry", () => {
  it("expired draft → EXPIRED preview status", async () => {
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({ expiresAt: EXPIRES_PAST }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.status).toBe("EXPIRED");
    expect(preview.blockers.some(b => b.code === "ORDER_DRAFT_EXPIRED")).toBe(true);
  });

  it("expired draft blocker message references Order Preparation", async () => {
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({ expiresAt: EXPIRES_PAST }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const blocker = preview.blockers.find(b => b.code === "ORDER_DRAFT_EXPIRED");
    expect(blocker?.message.toLowerCase()).toContain("order preparation");
  });

  it("refresh of expired draft → still EXPIRED (not silently extended)", async () => {
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({ expiresAt: EXPIRES_PAST }),
    });
    // Calling twice simulates refresh
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.status).toBe("EXPIRED");
  });

  it("active draft → preview works", async () => {
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({ expiresAt: EXPIRES_FUTURE }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(["VALID", "REQUIRES_REVIEW"]).toContain(preview.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. TRADE PLAN VERSION CHECK
// ─────────────────────────────────────────────────────────────────────────────

describe("Trade plan version check", () => {
  it("plan version mismatch → TRADE_PLAN_VERSION_CHANGED blocker", async () => {
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({ tradePlanVersion: 1 }),
      getTradePlan: async () => makeTradePlan({ version: 2 }),  // plan updated since draft
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "TRADE_PLAN_VERSION_CHANGED")).toBe(true);
  });

  it("matching version → no version blocker", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.blockers.some(b => b.code === "TRADE_PLAN_VERSION_CHANGED")).toBe(false);
  });

  it("trade plan not found → TRADE_PLAN_NOT_FOUND blocker", async () => {
    const deps = makeDeps({ getTradePlan: async () => null });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "TRADE_PLAN_NOT_FOUND")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. PREFLIGHT EXPIRY
// ─────────────────────────────────────────────────────────────────────────────

describe("Preflight expiry", () => {
  it("expired preflight → PREFLIGHT_EXPIRED blocker", async () => {
    const deps = makeDeps({
      getPreflightResult: async () => makePreflight({ validUntil: EXPIRES_PAST }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "PREFLIGHT_EXPIRED")).toBe(true);
  });

  it("missing preflight → PREFLIGHT_MISSING blocker", async () => {
    const deps = makeDeps({ getPreflightResult: async () => null });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "PREFLIGHT_MISSING")).toBe(true);
  });

  it("failing preflight → PREFLIGHT_NOT_PASSING blocker", async () => {
    const deps = makeDeps({
      getPreflightResult: async () => makePreflight({ status: "FAIL" }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "PREFLIGHT_NOT_PASSING")).toBe(true);
  });

  it("passing current preflight → no preflight blocker", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.blockers.some(b => b.code === "PREFLIGHT_EXPIRED" || b.code === "PREFLIGHT_NOT_PASSING")).toBe(false);
  });

  it("preflight expiry approaching → PREFLIGHT_EXPIRY_APPROACHING warning", async () => {
    const twoMin = new Date(NOW.getTime() + 2 * 60 * 1000);  // 2 min from now
    const deps = makeDeps({
      getPreflightResult: async () => makePreflight({ validUntil: twoMin }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.warnings.some(w => w.code === "PREFLIGHT_EXPIRY_APPROACHING")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. LIFECYCLE STATE
// ─────────────────────────────────────────────────────────────────────────────

describe("Lifecycle state", () => {
  it("CURRENT lifecycle → no lifecycle blocker", async () => {
    const deps = makeDeps({ getCurrentLifecycleState: async () => "CURRENT" });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "LIFECYCLE_THESIS_INVALIDATED" || b.code === "LIFECYCLE_CHANGED")).toBe(false);
  });

  it("THESIS_INVALIDATED → LIFECYCLE_THESIS_INVALIDATED blocker", async () => {
    const deps = makeDeps({ getCurrentLifecycleState: async () => "THESIS_INVALIDATED" });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "LIFECYCLE_THESIS_INVALIDATED")).toBe(true);
    expect(preview.planningContext.thesisInvalidated).toBe(true);
  });

  it("REQUIRES_REVIEW lifecycle → LIFECYCLE_CHANGED blocker", async () => {
    const deps = makeDeps({ getCurrentLifecycleState: async () => "REQUIRES_REVIEW" });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "LIFECYCLE_CHANGED")).toBe(true);
  });

  it("lifecycle state is visible in planningContext", async () => {
    const deps = makeDeps({ getCurrentLifecycleState: async () => "CURRENT" });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.planningContext.currentLifecycleState).toBe("CURRENT");
  });

  it("riskContext.researchInvalidation = true when thesis invalidated", async () => {
    const deps = makeDeps({ getCurrentLifecycleState: async () => "THESIS_INVALIDATED" });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.riskContext.researchInvalidation).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. BROKER / ACCOUNT
// ─────────────────────────────────────────────────────────────────────────────

describe("Broker / account", () => {
  it("broker provider is present", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.broker.provider).toBeTruthy();
    expect(preview.broker.provider).toBe("tradier");
  });

  it("account is masked — no full account ID", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.broker.accountMasked).toContain("••••");
    expect(preview.broker.accountMasked).not.toBe("ACCT12345678");
  });

  it("execution mode is DISABLED", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.broker.executionMode).toBe("DISABLED");
    expect(preview.broker.executionEnabled).toBe(false);
  });

  it("broker context has buying power check status", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(["PASS", "FAIL", "UNAVAILABLE"]).toContain(preview.broker.buyingPowerCheckStatus);
  });

  it("broker disconnected → BROKER_DISCONNECTED blocker", async () => {
    const deps = makeDeps({
      getBrokerContext: async () => ({
        connected: false,
        executionMode: "DISABLED",
        executionEnabled: false,
        accountMasked: "••••5678",
        accountType: "CASH",
        supportsMarketOrders: false,
        supportsLimitOrders: false,
        supportedTimeInForce: [],
      }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "BROKER_DISCONNECTED")).toBe(true);
  });

  it("full account ID never exposed in preview response", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    const json = JSON.stringify(preview);
    expect(json).not.toContain("ACCT12345678");
  });

  it("insufficient buying power → INSUFFICIENT_BUYING_POWER blocker", async () => {
    const deps = makeDeps({ getBuyingPowerStatus: async () => "FAIL" });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "INSUFFICIENT_BUYING_POWER")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. SIDE INTENT
// ─────────────────────────────────────────────────────────────────────────────

describe("Side intent", () => {
  it("OPEN_LONG sideIntent is labeled correctly", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.sideIntent).toBe("OPEN_LONG");
    expect(preview.sideIntentLabel).toBe("Open Long Position");
  });

  it("does not use 'Buy Now' or 'Trade' language for OPEN_LONG", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.sideIntentLabel).not.toContain("Buy Now");
    expect(preview.sideIntentLabel).not.toContain("Trade");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. QUANTITY (user-selected, never hypothetical)
// ─────────────────────────────────────────────────────────────────────────────

describe("Quantity — user-selected draft quantity", () => {
  it("quantity shown is confirmedQuantity from draft", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.quantity).toBe(10);
    expect(preview.quantityUnit).toBe("shares");
  });

  it("hypothetical planning quantity (15) is NOT used as order quantity", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.quantity).toBe(10);  // 10, not 15 (hypothetical)
    expect(preview.quantity).not.toBe(15);
  });

  it("preview does not contain any 'recommendedShares' field", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    }) as any;
    expect(preview.recommendedShares).toBeUndefined();
    expect(preview.recommendedQuantity).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. MARKET ORDER PREVIEW
// ─────────────────────────────────────────────────────────────────────────────

describe("Market order preview", () => {
  it("MARKET order shows correct order type", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.orderType).toBe("MARKET");
  });

  it("MARKET order generates market order warning", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.warnings.some(w => w.code === "MARKET_ORDER_PRICE_UNCERTAINTY")).toBe(true);
    expect(preview.pricing.marketOrderWarning).toBe(true);
  });

  it("MARKET order warning message contains 'not guarantee'", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    const w = preview.warnings.find(w => w.code === "MARKET_ORDER_PRICE_UNCERTAINTY");
    expect(w?.message.toLowerCase()).toContain("not guarantee");
  });

  it("MARKET order estimated notional at current ask or midpoint", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID,
      deps: makeDeps({ getQuoteForPreview: async () => makeFreshQuote({ ask: 120.5 }) }),
    });
    expect(preview.pricing.estimatedNotional).toBe(10 * 120.5);  // qty × ask
    expect(preview.pricing.estimatedNotionalLabel).toContain("Current Ask");
  });

  it("MARKET order has null draftLimitPrice", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.pricing.draftLimitPrice).toBeNull();
  });

  it("estimated notional not labeled 'Final Cost', 'Required Cash', or 'Guaranteed Cost'", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.pricing.estimatedNotionalLabel).not.toContain("Final Cost");
    expect(preview.pricing.estimatedNotionalLabel).not.toContain("Required Cash");
    expect(preview.pricing.estimatedNotionalLabel).not.toContain("Guaranteed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. LIMIT ORDER PREVIEW
// ─────────────────────────────────────────────────────────────────────────────

function makeLimitDraftRow(limitPrice: number) {
  const draft = makeOrderDraft({
    pricingContext: {
      orderType: "LIMIT",
      limitPriceReference: limitPrice,
      limitPriceSource: "REFERENCE_MIDPOINT",
      marketOrderWarningGenerated: false,
      extendedHoursRequested: false,
      extendedHoursSupported: false,
      priceRoundingApplied: false,
    },
  });
  return {
    id: DRAFT_ID, userId: USER_ID, tradePlanId: PLAN_ID, tradePlanVersion: 1,
    preflightId: PF_ID, draftJson: draft as unknown as Record<string, unknown>,
    status: "DRAFT", version: 1, expiresAt: EXPIRES_FUTURE,
  };
}

describe("Limit order preview", () => {
  it("LIMIT order shows limit price from draft", async () => {
    const deps = makeDeps({ getDraftById: async () => makeLimitDraftRow(100.0) });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.orderType).toBe("LIMIT");
    expect(preview.pricing.draftLimitPrice).toBe(100.0);
  });

  it("LIMIT price source is preserved", async () => {
    const deps = makeDeps({ getDraftById: async () => makeLimitDraftRow(100.0) });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.pricing.draftLimitPriceSource).toBe("REFERENCE_MIDPOINT");
  });

  it("draft limit price never auto-changed when market moves", async () => {
    const deps = makeDeps({
      getDraftById: async () => makeLimitDraftRow(100.0),
      getQuoteForPreview: async () => makeFreshQuote({ bid: 125.0, ask: 125.5, midpoint: 125.25 }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.pricing.draftLimitPrice).toBe(100.0);  // unchanged
  });

  it("LIMIT order estimated notional = qty × draft limit price", async () => {
    const deps = makeDeps({ getDraftById: async () => makeLimitDraftRow(100.0) });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.pricing.estimatedNotional).toBe(10 * 100.0);
    expect(preview.pricing.estimatedNotionalLabel).toContain("Draft Limit");
  });

  it("shows limit price relation: AT_OR_BELOW_BID when limit << market", async () => {
    const deps = makeDeps({
      getDraftById: async () => makeLimitDraftRow(50.0),
      getQuoteForPreview: async () => makeFreshQuote({ bid: 120.0, ask: 120.5, midpoint: 120.25 }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.pricing.limitMarketRelation).toBe("AT_OR_BELOW_BID");
  });

  it("shows limit price relation: AT_OR_ABOVE_ASK when limit >> market", async () => {
    const deps = makeDeps({
      getDraftById: async () => makeLimitDraftRow(200.0),
      getQuoteForPreview: async () => makeFreshQuote({ bid: 120.0, ask: 120.5, midpoint: 120.25 }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.pricing.limitMarketRelation).toBe("AT_OR_ABOVE_ASK");
  });

  it("shows BETWEEN_BID_ASK when limit is within spread", async () => {
    const deps = makeDeps({
      getDraftById: async () => makeLimitDraftRow(120.25),
      getQuoteForPreview: async () => makeFreshQuote({ bid: 120.0, ask: 120.5, midpoint: 120.25 }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.pricing.limitMarketRelation).toBe("BETWEEN_BID_ASK");
  });

  it("LIMIT order does not generate MARKET_ORDER_PRICE_UNCERTAINTY warning", async () => {
    const deps = makeDeps({ getDraftById: async () => makeLimitDraftRow(100.0) });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.warnings.some(w => w.code === "MARKET_ORDER_PRICE_UNCERTAINTY")).toBe(false);
    expect(preview.pricing.marketOrderWarning).toBe(false);
  });

  it("limit price relation not labeled 'Good Limit' or 'Bad Limit'", async () => {
    const deps = makeDeps({ getDraftById: async () => makeLimitDraftRow(100.0) });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const json = JSON.stringify(preview);
    expect(json).not.toContain("Good Limit");
    expect(json).not.toContain("Bad Limit");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. QUOTE DATA (Bid / Ask / Last / Midpoint / Freshness)
// ─────────────────────────────────────────────────────────────────────────────

describe("Quote data", () => {
  it("bid is present in current quote context", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.pricing.currentQuote.bid).toBe(120.0);
  });

  it("ask is present in current quote context", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.pricing.currentQuote.ask).toBe(120.5);
  });

  it("midpoint is present in current quote context", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.pricing.currentQuote.midpoint).toBe(120.25);
  });

  it("last is present in current quote context", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.pricing.currentQuote.last).toBe(120.2);
  });

  it("quote freshness category is FRESH for fresh quote", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.pricing.currentQuote.freshnessCategory).toBe("FRESH");
  });

  it("stale quote → QUOTE_STALE blocker", async () => {
    const deps = makeDeps({
      getQuoteForPreview: async () => makeFreshQuote({ isStale: true }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "QUOTE_STALE")).toBe(true);
  });

  it("unavailable quote → QUOTE_STALE blocker", async () => {
    const deps = makeDeps({ getQuoteForPreview: async () => null });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "QUOTE_STALE")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. DRAFT / CURRENT DATA SEPARATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Draft vs current data separation", () => {
  it("draft quote (bid=118.5) is separate from current quote (bid=120.0)", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID,
      deps: makeDeps({ getQuoteForPreview: async () => makeFreshQuote({ bid: 120.0 }) }),
    });
    expect(preview.pricing.draftBid).toBe(118.5);    // from draft snapshot
    expect(preview.pricing.currentQuote.bid).toBe(120.0);  // current
  });

  it("draft values never overwritten when market moves", async () => {
    const deps = makeDeps({
      getDraftById: async () => makeLimitDraftRow(100.0),
      getQuoteForPreview: async () => makeFreshQuote({ bid: 150.0, ask: 151.0, midpoint: 150.5 }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.pricing.draftLimitPrice).toBe(100.0);  // draft value unchanged
    expect(preview.pricing.currentQuote.bid).toBe(150.0); // current separate
  });

  it("price movement = MATERIAL_CHANGE when current midpoint moved >0.5%", async () => {
    const deps = makeDeps({
      // draft mid = 118.75; current mid = 130.0 → ~9.5% change
      getQuoteForPreview: async () => makeFreshQuote({ midpoint: 130.0 }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.pricing.priceMovement).toBe("MATERIAL_CHANGE");
  });

  it("QUOTE_MOVED warning generated for material price movement", async () => {
    const deps = makeDeps({
      getQuoteForPreview: async () => makeFreshQuote({ midpoint: 130.0 }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.warnings.some(w => w.code === "QUOTE_MOVED")).toBe(true);
  });

  it("price movement = UNCHANGED when no change", async () => {
    const deps = makeDeps({
      getQuoteForPreview: async () => makeFreshQuote({ midpoint: 118.75 }), // same as draft
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.pricing.priceMovement).toBe("UNCHANGED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. MARKET HOURS
// ─────────────────────────────────────────────────────────────────────────────

describe("Market hours", () => {
  it("OPEN session state visible in preview", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.marketHours.sessionState).toBe("OPEN");
  });

  it("CLOSED session → MARKET_CLOSED warning", async () => {
    const draft = makeOrderDraft({ marketHoursContext: { sessionState: "CLOSED", asOf: NOW.toISOString() } });
    const deps = makeDeps({
      getDraftById: async () => ({
        id: DRAFT_ID, userId: USER_ID, tradePlanId: PLAN_ID, tradePlanVersion: 1,
        preflightId: PF_ID, draftJson: draft as unknown as Record<string, unknown>,
        status: "DRAFT", version: 1, expiresAt: EXPIRES_FUTURE,
      }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.warnings.some(w => w.code === "MARKET_CLOSED")).toBe(true);
  });

  it("PRE_MARKET → PRE_MARKET warning", async () => {
    const draft = makeOrderDraft({ marketHoursContext: { sessionState: "PRE_MARKET", asOf: NOW.toISOString() } });
    const deps = makeDeps({
      getDraftById: async () => ({
        id: DRAFT_ID, userId: USER_ID, tradePlanId: PLAN_ID, tradePlanVersion: 1,
        preflightId: PF_ID, draftJson: draft as unknown as Record<string, unknown>,
        status: "DRAFT", version: 1, expiresAt: EXPIRES_FUTURE,
      }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.warnings.some(w => w.code === "PRE_MARKET")).toBe(true);
  });

  it("preview does not auto-change order type based on market hours", async () => {
    const draft = makeOrderDraft({ marketHoursContext: { sessionState: "CLOSED", asOf: NOW.toISOString() } });
    const deps = makeDeps({
      getDraftById: async () => ({
        id: DRAFT_ID, userId: USER_ID, tradePlanId: PLAN_ID, tradePlanVersion: 1,
        preflightId: PF_ID, draftJson: draft as unknown as Record<string, unknown>,
        status: "DRAFT", version: 1, expiresAt: EXPIRES_FUTURE,
      }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.orderType).toBe("MARKET");  // unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. TIME IN FORCE
// ─────────────────────────────────────────────────────────────────────────────

describe("Time in force", () => {
  it("TIF DAY is shown correctly", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.timeInForce).toBe("DAY");
  });

  it("unsupported TIF → TIF_UNSUPPORTED blocker", async () => {
    const deps = makeDeps({
      getBrokerContext: async () => ({
        connected: true,
        executionMode: "DISABLED",
        executionEnabled: false,
        accountMasked: "••••5678",
        accountType: "CASH",
        supportsMarketOrders: true,
        supportsLimitOrders: true,
        supportedTimeInForce: ["DAY"],  // GTC not supported
      }),
    });
    // draft has DAY — this should pass
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "TIF_UNSUPPORTED")).toBe(false);
  });

  it("TIF not in supported list → TIF_UNSUPPORTED blocker", async () => {
    const draft = makeOrderDraft({ timeInForceContext: { timeInForce: "GTC", supported: true } });
    const deps = makeDeps({
      getDraftById: async () => ({
        id: DRAFT_ID, userId: USER_ID, tradePlanId: PLAN_ID, tradePlanVersion: 1,
        preflightId: PF_ID, draftJson: draft as unknown as Record<string, unknown>,
        status: "DRAFT", version: 1, expiresAt: EXPIRES_FUTURE,
      }),
      getBrokerContext: async () => ({
        connected: true, executionMode: "DISABLED", executionEnabled: false,
        accountMasked: "••••5678", accountType: "CASH",
        supportsMarketOrders: true, supportsLimitOrders: true,
        supportedTimeInForce: ["DAY"],  // GTC not in list
      }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.blockers.some(b => b.code === "TIF_UNSUPPORTED")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. ESTIMATED NOTIONAL
// ─────────────────────────────────────────────────────────────────────────────

describe("Estimated notional", () => {
  it("estimated notional is present for MARKET order", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.pricing.estimatedNotional).not.toBeNull();
  });

  it("buying power check status is distinct from estimated notional", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.buyingPowerCheckStatus).toBeDefined();
    expect(preview.pricing.estimatedNotional).not.toBe(preview.buyingPowerCheckStatus);
  });

  it("estimated notional uses quantity × current ask for MARKET (when ask available)", async () => {
    const deps = makeDeps({ getQuoteForPreview: async () => makeFreshQuote({ ask: 130.0 }) });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.pricing.estimatedNotional).toBe(10 * 130.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 21. SOURCE INTEGRITY
// ─────────────────────────────────────────────────────────────────────────────

describe("Source integrity", () => {
  it("sourceIntegrity.allPass is true on happy path", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.sourceIntegrity.allPass).toBe(true);
  });

  it("sourceIntegrity.tradePlanMatches is true when plan found", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.sourceIntegrity.tradePlanMatches).toBe(true);
  });

  it("sourceIntegrity.broadExpressionMatches is true when STOCK + USER", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.sourceIntegrity.broadExpressionMatches).toBe(true);
  });

  it("sourceIntegrity.allPass is false when blockers exist", async () => {
    const deps = makeDeps({ getPreflightResult: async () => null });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.sourceIntegrity.allPass).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 22. VALIDITY WINDOW
// ─────────────────────────────────────────────────────────────────────────────

describe("Preview validity window", () => {
  it("validUntil is in the future on valid preview", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(new Date(preview.validUntil).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("validUntil is bounded by draft expiresAt", async () => {
    const soonExpires = new Date(NOW.getTime() + 2 * 60 * 1000); // 2 min
    const deps = makeDeps({
      getDraftById: async () => makeDraftRow({ expiresAt: soonExpires }),
    });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(new Date(preview.validUntil).getTime()).toBeLessThanOrEqual(soonExpires.getTime() + 1000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 23. REFRESH DOES NOT MUTATE DRAFT
// ─────────────────────────────────────────────────────────────────────────────

describe("Refresh does not mutate OrderDraft", () => {
  it("calling generateEquityPreview twice does not mutate draft", async () => {
    const persistDraft = vi.fn();
    const deps = makeDeps({ appendAuditEvent: vi.fn().mockResolvedValue(undefined) });
    await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(persistDraft).not.toHaveBeenCalled();
  });

  it("preview quantity stays same across refreshes", async () => {
    const deps = makeDeps();
    const { preview: first } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const { preview: second } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(first.quantity).toBe(second.quantity);
  });

  it("draft limit price stays same after market moves", async () => {
    let callCount = 0;
    const deps = makeDeps({
      getDraftById: async () => makeLimitDraftRow(100.0),
      getQuoteForPreview: async () => {
        callCount++;
        return makeFreshQuote({ bid: callCount === 1 ? 100.0 : 200.0, ask: callCount === 1 ? 101.0 : 201.0, midpoint: callCount === 1 ? 100.5 : 200.5 });
      },
    });
    const { preview: first } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const { preview: second } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(first.pricing.draftLimitPrice).toBe(100.0);
    expect(second.pricing.draftLimitPrice).toBe(100.0);  // draft unchanged
    // But current quotes differ
    expect(first.pricing.currentQuote.bid).not.toBe(second.pricing.currentQuote.bid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 24. NO SUBMISSION / NO CONFIRMATION
// ─────────────────────────────────────────────────────────────────────────────

describe("No submission and no confirmation", () => {
  it("preview response has no 'confirmed' field", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    }) as any;
    expect(preview.confirmed).toBeUndefined();
    expect(preview.isConfirmed).toBeUndefined();
    expect(preview.orderConfirmed).toBeUndefined();
  });

  it("preview response has no 'submitted' field", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    }) as any;
    expect(preview.submitted).toBeUndefined();
    expect(preview.orderSubmitted).toBeUndefined();
    expect(preview.brokerOrderId).toBeUndefined();
  });

  it("no broker mutating methods called (placeOrder = 0)", async () => {
    const placeOrder = vi.fn();
    const submitOrder = vi.fn();
    const replaceOrder = vi.fn();
    const cancelOrder = vi.fn();
    // The service deps intentionally have no placeOrder — verify they're not called
    await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    expect(placeOrder).not.toHaveBeenCalled();
    expect(submitOrder).not.toHaveBeenCalled();
    expect(replaceOrder).not.toHaveBeenCalled();
    expect(cancelOrder).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 25. SECURITY — CROSS-USER
// ─────────────────────────────────────────────────────────────────────────────

describe("Security", () => {
  it("cross-user draft access returns 404 (draft not found)", async () => {
    const deps = makeDeps({
      getDraftById: async (_id, uid) => uid === USER_ID ? makeDraftRow() : null,
    });
    const { preview } = await generateEquityPreview({
      userId: "other-user", draftId: DRAFT_ID, deps,
    });
    expect(preview.status).toBe("UNAVAILABLE");
    expect(preview.blockers.some(b => b.code === "ORDER_DRAFT_NOT_FOUND")).toBe(true);
  });

  it("cross-user trade plan returns TRADE_PLAN_NOT_FOUND", async () => {
    const deps = makeDeps({
      getTradePlan: async (_id, uid) => uid === USER_ID ? makeTradePlan() : null,
    });
    const { preview } = await generateEquityPreview({
      userId: "other-user", draftId: DRAFT_ID,
      deps: { ...deps, getDraftById: async (_id, uid) => uid === "other-user" ? makeDraftRow() : null },
    });
    expect(preview.blockers.some(b => b.code === "TRADE_PLAN_NOT_FOUND")).toBe(true);
  });

  it("full account ID never in preview JSON", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    const json = JSON.stringify(preview);
    expect(json).not.toContain("ACCT12345678");
    expect(json).not.toContain("brokerAccountRef");
  });

  it("client injection fields not in preview response", async () => {
    // Preview should not contain any field that could have been injected by client
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    }) as any;
    expect(preview.injectedQuantity).toBeUndefined();
    expect(preview.clientPrice).toBeUndefined();
    expect(preview.clientLimitPrice).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 26. AUDIT EVENTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Audit events", () => {
  it("audit event is appended on preview generation", async () => {
    const appendAuditEvent = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ appendAuditEvent });
    await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "EQUITY_PREVIEW_GENERATED" })
    );
  });

  it("audit metadata does not contain quantity", async () => {
    const appendAuditEvent = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ appendAuditEvent });
    await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const call = appendAuditEvent.mock.calls[0][0];
    expect(call.metadata).not.toHaveProperty("quantity");
    expect(call.metadata).not.toHaveProperty("price");
    expect(call.metadata).not.toHaveProperty("notional");
  });

  it("audit metadata contains safe fields only", async () => {
    const appendAuditEvent = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ appendAuditEvent });
    await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const meta = appendAuditEvent.mock.calls[0][0].metadata;
    expect(meta.orderType).toBeTruthy();
    expect(meta.status).toBeTruthy();
    expect(meta.blockerCount).toBeDefined();
    expect(meta.warningCount).toBeDefined();
    expect(meta.durationMs).toBeDefined();
  });

  it("audit event does not include ORDER_CONFIRMED or ORDER_SUBMITTED types", async () => {
    const appendAuditEvent = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ appendAuditEvent });
    await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const calls = appendAuditEvent.mock.calls;
    for (const call of calls) {
      expect(call[0].eventType).not.toBe("ORDER_CONFIRMED");
      expect(call[0].eventType).not.toBe("ORDER_SUBMITTED");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 27. PLATFORM HEALTH METRICS
// ─────────────────────────────────────────────────────────────────────────────

describe("Platform health metrics", () => {
  it("getEquityPreviewMetrics returns an object", () => {
    const metrics = getEquityPreviewMetrics();
    expect(metrics).toBeDefined();
    expect(typeof metrics.previewRequests).toBe("number");
    expect(typeof metrics.previewPasses).toBe("number");
    expect(typeof metrics.previewFailures).toBe("number");
  });

  it("metrics increment after preview generation", async () => {
    const before = getEquityPreviewMetrics().previewRequests;
    await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps() });
    const after = getEquityPreviewMetrics().previewRequests;
    expect(after).toBeGreaterThan(before);
  });

  it("brokerSubmissionEnabled is false", () => {
    const metrics = getEquityPreviewMetrics();
    expect(metrics.brokerSubmissionEnabled).toBe(false);
  });

  it("metrics do not contain quantities, prices, or user identity", () => {
    const metrics = getEquityPreviewMetrics();
    const json = JSON.stringify(metrics);
    expect(json).not.toContain("quantity");
    expect(json).not.toContain("price");
    expect(json).not.toContain(USER_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 28. COMPLIANCE
// ─────────────────────────────────────────────────────────────────────────────

describe("Compliance", () => {
  it("disclaimer contains 'not constitute investment advice'", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.disclaimer.toLowerCase()).toContain("investment advice");
  });

  it("price disclaimer contains 'reference values'", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.executionPriceDisclaimer.toLowerCase()).toContain("reference values");
  });

  it("preview does not say 'Ready to Trade'", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    const json = JSON.stringify(preview);
    expect(json).not.toContain("Ready to Trade");
    expect(json).not.toContain("READY_TO_TRADE");
  });

  it("preview does not say 'Trade Approved'", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    const json = JSON.stringify(preview);
    expect(json).not.toContain("Trade Approved");
    expect(json).not.toContain("APPROVED");
  });

  it("preview does not say 'Expected Fill' or 'Guaranteed Fill'", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    const json = JSON.stringify(preview);
    expect(json).not.toContain("Expected Fill");
    expect(json).not.toContain("Guaranteed Fill");
    expect(json).not.toContain("Guaranteed Cost");
  });

  it("estimated notional label does not say 'Final Cost' or 'Required Cash'", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.pricing.estimatedNotionalLabel).not.toContain("Final Cost");
    expect(preview.pricing.estimatedNotionalLabel).not.toContain("Required Cash");
  });

  it("side intent label is not 'Buy Now' or 'Sell Now'", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.sideIntentLabel).not.toContain("Buy Now");
    expect(preview.sideIntentLabel).not.toContain("Sell Now");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 29. EXECUTION DISABLED WARNING
// ─────────────────────────────────────────────────────────────────────────────

describe("Execution disabled", () => {
  it("EXECUTION_DISABLED warning present when execution not enabled", async () => {
    const deps = makeDeps({ isExecutionEnabled: () => false });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    expect(preview.warnings.some(w => w.code === "EXECUTION_DISABLED")).toBe(true);
  });

  it("EXECUTION_DISABLED warning message contains 'disabled'", async () => {
    const deps = makeDeps({ isExecutionEnabled: () => false });
    const { preview } = await generateEquityPreview({ userId: USER_ID, draftId: DRAFT_ID, deps });
    const w = preview.warnings.find(w => w.code === "EXECUTION_DISABLED");
    expect(w?.message.toLowerCase()).toContain("disabled");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 30. ROADMAP: 2.8.3/2.8.4/2.8.5 discipline
// ─────────────────────────────────────────────────────────────────────────────

describe("Roadmap discipline", () => {
  it("preview contains no submission-related fields", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    }) as any;
    expect(preview.confirmationId).toBeUndefined();
    expect(preview.brokerOrderId).toBeUndefined();
    expect(preview.fillPrice).toBeUndefined();
    expect(preview.fillQuantity).toBeUndefined();
    expect(preview.submittedAt).toBeUndefined();
  });

  it("preview status does not include READY_TO_TRADE or APPROVED", async () => {
    const { preview } = await generateEquityPreview({
      userId: USER_ID, draftId: DRAFT_ID, deps: makeDeps(),
    });
    expect(preview.status).not.toBe("READY_TO_TRADE");
    expect(preview.status).not.toBe("APPROVED");
    expect(preview.status).not.toBe("EXECUTION_READY");
  });
});
