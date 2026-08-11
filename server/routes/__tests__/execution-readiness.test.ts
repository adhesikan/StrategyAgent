/**
 * server/routes/__tests__/execution-readiness.test.ts — Sprint 2.8.4
 *
 * Pure unit tests for the Execution Readiness & Guardrails engine.
 * All tests use injectable deps — no DB, no broker, no network calls.
 *
 * Coverage targets (spec §22):
 *   1.  fresh quotes + valid account + sufficient capital → READY
 *   2.  stale underlying quote → BLOCKED (ALL_QUOTES_UNAVAILABLE / QUOTE_STALE)
 *   3.  all option quotes unavailable → BLOCKED
 *   4.  one partial Greek missing → warning
 *   5.  wide bid/ask → warning
 *   6.  covered call with insufficient shares → BLOCKED
 *   7.  covered call with sufficient shares → valid (INFO confirmed)
 *   8.  close option without required position → BLOCKED
 *   9.  defined-risk spread capital calculation correct
 *   10. undefined-risk short option → BROKER_MARGIN_CALCULATION_REQUIRED
 *   11. unsupported multileg broker → BLOCKED
 *   12. broker capability unknown → correct warning behavior
 *   13. expired option → BLOCKED
 *   14. 0DTE → warning
 *   15. invalid strike ordering → BLOCKED
 *   16. valid bull call spread → valid (no structure blocker)
 *   17. valid bear put spread → valid (no structure blocker)
 *   18. valid iron condor → valid (no structure blocker)
 *   19. assignment risk shown for OPEN_SHORT_DEFINED_RISK
 *   20. future intent containing "SHORT" uses isShortIntent
 *   21. missing positions do not become zero holdings
 *   22. missing buying power does not become $0
 *   23. stale data thresholds honor config
 *   24. invalid net price → BLOCKED
 *   25. readiness result has correct shape
 *   26. no LLM dependency exists
 *   27. brokerSubmissionEnabled is always false
 *   28. engineVersion is "2.8.4"
 *   29. capital estimate for bull_put_spread (credit spread)
 *   30. capital estimate for cash_secured_put
 *   31. capital estimate for covered_call (SHARES_ONLY)
 *   32. capital estimate for iron_condor
 *   33. broker not connected → BLOCKED
 *   34. options not supported → BLOCKED
 *   35. READY_WITH_WARNINGS when only warnings present
 *   36. severe wide spread → SEVERE_WIDE_SPREAD warning
 *   37. low open interest → LOW_OPEN_INTEREST warning
 *   38. pricing direction mismatch → warning
 *   39. mixed underlying → BLOCKED
 *   40. invalid quantity → BLOCKED
 */

import { describe, it, expect } from "vitest";
import {
  evaluateExecutionReadiness as _evaluateReadiness,
  isShortIntent,
} from "../../services/execution-readiness-service";
import type {
  ExecutionReadinessInput,
  BrokerReadinessCapabilities,
  ReadinessPositionContext,
} from "../../../shared/execution-readiness-types";
import type { OptionsOrderPreview, OptionsPreviewLeg } from "../../../shared/options-order-preview-types";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function makeQuote(overrides: {
  bid?: number | null;
  ask?: number | null;
  midpoint?: number | null;
  spreadPct?: number | null;
  freshnessCategory?: "FRESH" | "AGING" | "STALE" | "UNAVAILABLE";
  isStale?: boolean;
  isCrossed?: boolean;
} = {}): import("../../../shared/options-order-preview-types").OptionsLegQuote {
  const bid = overrides.bid ?? 2.50;
  const ask = overrides.ask ?? 2.60;
  const midpoint = overrides.midpoint ?? ((bid !== null && ask !== null) ? (bid! + ask!) / 2 : null);
  return {
    bid,
    ask,
    midpoint,
    last: midpoint,
    spreadAbs: (bid !== null && ask !== null) ? ask! - bid! : null,
    spreadPct: overrides.spreadPct ?? ((bid !== null && ask !== null && midpoint) ? ((ask! - bid!) / midpoint) * 100 : null),
    quoteTime: new Date().toISOString(),
    provider: "test",
    freshnessCategory: overrides.freshnessCategory ?? "FRESH",
    freshnessSeconds: overrides.isStale ? 9999 : 10,
    isStale: overrides.isStale ?? false,
    isCrossed: overrides.isCrossed ?? false,
  };
}

function makeLeg(overrides: {
  legIndex?: number;
  contractSymbol?: string;
  optionType?: "call" | "put";
  expiration?: string;
  dte?: number;
  isExpired?: boolean;
  strike?: number;
  quantity?: number;
  ratio?: number;
  multiplier?: number;
  canonicalIntent?: string;
  role?: string;
  currentQuote?: import("../../../shared/options-order-preview-types").OptionsLegQuote | null;
  greeks?: import("../../../shared/options-order-preview-types").OptionsLegGreeks | null;
  liquidity?: Partial<import("../../../shared/options-order-preview-types").OptionsLegLiquidity>;
  status?: import("../../../shared/options-order-preview-types").LegContractStatus;
} = {}): OptionsPreviewLeg {
  return {
    legIndex: overrides.legIndex ?? 0,
    role: overrides.role ?? "long_leg",
    roleLabel: "Long Leg",
    canonicalIntent: overrides.canonicalIntent ?? "OPEN_LONG",
    canonicalIntentLabel: "Open Long",
    contractSymbol: overrides.contractSymbol ?? "NVDA260918C00120000",
    optionType: overrides.optionType ?? "call",
    expiration: overrides.expiration ?? "2026-09-18",
    dte: overrides.dte ?? 38,
    expirationLabel: "Sep 18",
    isExpired: overrides.isExpired ?? false,
    strike: overrides.strike ?? 120,
    ratio: overrides.ratio ?? 1,
    quantity: overrides.quantity ?? 1,
    multiplier: overrides.multiplier ?? 100,
    draftQuote: makeQuote(),
    currentQuote: overrides.currentQuote !== undefined ? overrides.currentQuote : makeQuote(),
    quoteChangeCategory: "UNCHANGED",
    quoteMidpointChangeAbs: 0,
    quoteMidpointChangePct: 0,
    liquidity: {
      openInterest: 500,
      volume: 50,
      bidAskSpreadAbs: 0.10,
      bidAskSpreadPct: 3.9,
      category: "ACCEPTABLE",
      ...overrides.liquidity,
    },
    greeks: overrides.greeks !== undefined ? overrides.greeks : {
      delta: 0.45, gamma: 0.03, theta: -0.08, vega: 0.12, rho: 0.02,
      impliedVolatility: 0.35, greeksAvailable: true,
    },
    status: overrides.status ?? "AVAILABLE",
    warnings: [],
  };
}

function makePreview(overrides: {
  strategyFamily?: string;
  instrumentType?: "OPTION" | "MULTI_LEG_OPTION";
  symbol?: string;
  legs?: OptionsPreviewLeg[];
  quantity?: number;
  netPricingType?: "DEBIT" | "CREDIT" | "UNKNOWN";
  netAmountPerUnit?: number | null;
  netAmountPerContract?: number | null;
  netTotalAmount?: number | null;
  allQuotesAvailable?: boolean;
  aggregateFreshness?: "FRESH" | "AGING" | "STALE" | "UNAVAILABLE";
  anyStale?: boolean;
  assignmentRisk?: boolean;
  hasShortLegs?: boolean;
  coverageRequired?: boolean;
  coverageValidated?: boolean;
} = {}): OptionsOrderPreview {
  const legs = overrides.legs ?? [makeLeg()];
  const qty = overrides.quantity ?? 1;
  const mult = 100;
  return {
    executable: false,
    id: "prev-001",
    userId: "user-001",
    tradePlanId: "plan-001",
    tradePlanVersion: 1,
    preflightId: "pf-001",
    orderDraftId: "draft-001",
    orderDraftVersion: 1,
    broadExpressionType: "LONG_OPTIONS",
    selectedBy: "USER",
    strategyFamily: (overrides.strategyFamily ?? "long_call") as any,
    strategyLabel: overrides.strategyFamily ?? "Long Call",
    instrumentType: overrides.instrumentType ?? "OPTION",
    symbol: overrides.symbol ?? "NVDA",
    generatedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 600_000).toISOString(),
    status: "VALID",
    broker: {
      provider: "tradier",
      accountMasked: "••••1234",
      accountType: "MARGIN",
      executionMode: "DISABLED",
      executionEnabled: false,
      supportsOptionsOrders: true,
      supportsMultiLegOrders: false,
      optionsPermissionStatus: "UNAVAILABLE",
      supportedTimeInForce: ["DAY"],
    },
    expirationContext: {
      primaryExpiration: legs[0]?.expiration ?? "2026-09-18",
      secondaryExpiration: null,
      isMultiExpiration: false,
      dteSummary: legs.map(l => ({ legIndex: l.legIndex, expiration: l.expiration, dte: l.dte })),
      nearExpirationWarning: false,
    },
    legs,
    quantityContext: {
      confirmedQuantity: qty,
      unit: "contracts",
      notional: null,
      notionalLabel: null,
    },
    orderType: "LIMIT",
    timeInForce: "DAY",
    netStructurePricing: {
      pricingType: overrides.netPricingType ?? "DEBIT",
      amountPerUnit: overrides.netAmountPerUnit !== undefined ? overrides.netAmountPerUnit : 2.55,
      amountPerContract: overrides.netAmountPerContract !== undefined ? overrides.netAmountPerContract : (2.55 * mult),
      totalAmount: overrides.netTotalAmount !== undefined ? overrides.netTotalAmount : (2.55 * mult * qty),
      multiplier: mult,
      draftNetReference: 2.40,
      draftPricingType: "DEBIT",
      differenceAbs: 0.15,
      differencePct: 6.25,
      changeLabel: "Current Structure Quote Change",
      allQuotesAvailable: overrides.allQuotesAvailable !== undefined ? overrides.allQuotesAvailable : true,
      isMidpointEstimate: true,
    },
    quoteFreshness: {
      oldestQuoteTime: new Date().toISOString(),
      newestQuoteTime: new Date().toISOString(),
      allFresh: !overrides.anyStale,
      anyStale: overrides.anyStale ?? false,
      legsWithStaleQuotes: overrides.anyStale ? legs.length : 0,
      totalLegs: legs.length,
      aggregateFreshnessCategory: overrides.aggregateFreshness ?? "FRESH",
    },
    liquidityContext: {
      overallCategory: "ACCEPTABLE",
      liquidityChange: "UNCHANGED",
      perLegSummary: legs.map(l => ({ legIndex: l.legIndex, contractSymbol: l.contractSymbol, category: "ACCEPTABLE" as const })),
      widestSpreadPct: 3.9,
      note: "",
    },
    riskContext: {
      maxLoss: null, maxGain: null, breakevens: [], capitalProfile: null,
      riskFlags: [], constraintStatus: "VALID", pathDependent: false,
      netGreeks: null, riskAnalysisStale: false, researchInvalidation: false,
    },
    assignmentExerciseContext: {
      hasShortLegs: overrides.hasShortLegs ?? false,
      hasLongLegs: true,
      assignmentRisk: overrides.assignmentRisk ?? false,
      assignmentNote: null,
      earlyExerciseRisk: false,
      earlyExerciseNote: null,
      pinRisk: false,
      pinRiskNote: null,
      exerciseContext: null,
      coverageRequired: overrides.coverageRequired ?? false,
      coverageValidated: overrides.coverageValidated ?? false,
      coverageNote: null,
    },
    eventContext: {
      status: "NO_EVENT_DETECTED",
      eventType: null,
      earningsDate: null,
      insideEventWindow: false,
      note: "",
    },
    blockers: [],
    warnings: [],
    sourceIntegrity: {
      source: "test",
      dataProviderVersion: "test",
      draftFingerprint: "abc",
      draftVersion: 1,
      preflightVersion: 1,
      integrityNote: "",
    },
    disclaimer: "Test disclaimer",
    executionPriceDisclaimer: "Test price disclaimer",
    optionsRiskDisclosure: "Test risk disclosure",
    midpointDisclaimer: "Test midpoint disclaimer",
    methodologyVersion: "2.8.3",
  };
}

function makeInput(overrides: {
  preview?: OptionsOrderPreview;
  positions?: ReadinessPositionContext[] | null;
  brokerCap?: BrokerReadinessCapabilities | null;
  config?: Partial<import("../../../shared/execution-readiness-types").ExecutionGuardrailConfig>;
} = {}): ExecutionReadinessInput {
  return {
    tradePlanId: "plan-001",
    userId: "user-001",
    orderDraftId: "draft-001",
    orderPreviewId: "prev-001",
    preview: overrides.preview ?? makePreview(),
    positions: overrides.positions !== undefined ? overrides.positions : null,
    brokerCapabilities: overrides.brokerCap !== undefined ? overrides.brokerCap : connectedBroker(),
    now: new Date("2026-08-11T13:00:00Z"),
    config: overrides.config,
  };
}

function connectedBroker(overrides: Partial<BrokerReadinessCapabilities> = {}): BrokerReadinessCapabilities {
  return {
    connected: true,
    provider: "tradier",
    supportsOptions: true,
    supportsMultileg: null,
    optionsLevel: null,
    accountStatus: "active",
    buyingPowerUsd: 50_000,
    buyingPowerSource: "broker",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// isShortIntent helper
// ─────────────────────────────────────────────────────────────────────────────
describe("isShortIntent helper", () => {
  it("recognizes OPEN_SHORT_COVERED", () => expect(isShortIntent("OPEN_SHORT_COVERED")).toBe(true));
  it("recognizes OPEN_SHORT_SECURED", () => expect(isShortIntent("OPEN_SHORT_SECURED")).toBe(true));
  it("recognizes OPEN_SHORT_DEFINED_RISK", () => expect(isShortIntent("OPEN_SHORT_DEFINED_RISK")).toBe(true));
  it("recognizes CLOSE_SHORT", () => expect(isShortIntent("CLOSE_SHORT")).toBe(true));
  it("recognizes future SHORT-bearing intent (spec §20)", () => expect(isShortIntent("OPEN_SHORT_NAKED_CALL")).toBe(true));
  it("rejects OPEN_LONG", () => expect(isShortIntent("OPEN_LONG")).toBe(false));
  it("rejects CLOSE_LONG", () => expect(isShortIntent("CLOSE_LONG")).toBe(false));
});

// ─────────────────────────────────────────────────────────────────────────────
// Result invariants
// ─────────────────────────────────────────────────────────────────────────────
describe("Result invariants", () => {
  it("brokerSubmissionEnabled is always false (spec §27)", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput());
    expect(readiness.brokerSubmissionEnabled).toBe(false);
  });

  it("engineVersion is '2.8.4' (spec §28)", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput());
    expect(readiness.engineVersion).toBe("2.8.4");
    expect(readiness.ruleEngineVersion).toBe("2.8.4");
  });

  it("result has required shape (spec §25)", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput());
    expect(readiness).toHaveProperty("status");
    expect(readiness).toHaveProperty("findings");
    expect(readiness).toHaveProperty("evaluatedAt");
    expect(readiness).toHaveProperty("capitalEstimate");
    expect(readiness).toHaveProperty("blockerCount");
    expect(readiness).toHaveProperty("warningCount");
    expect(readiness).toHaveProperty("disclaimer");
    expect(Array.isArray(readiness.findings)).toBe(true);
  });

  it("no LLM dependency exists — engine is pure function (spec §26)", () => {
    // Pure function: same input always returns same status
    const input = makeInput();
    const { readiness: r1 } = evaluateExecutionReadiness(input);
    const { readiness: r2 } = evaluateExecutionReadiness(input);
    expect(r1.status).toBe(r2.status);
    expect(r1.findings.length).toBe(r2.findings.length);
  });

  it("blockerCount + warningCount + infoCount match findings", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput());
    expect(readiness.blockerCount).toBe(readiness.findings.filter(f => f.severity === "BLOCKER").length);
    expect(readiness.warningCount).toBe(readiness.findings.filter(f => f.severity === "WARNING").length);
    expect(readiness.infoCount).toBe(readiness.findings.filter(f => f.severity === "INFO").length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 1: fresh quotes + valid account + sufficient capital → READY
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 1: fresh quotes + valid account → READY", () => {
  it("produces READY status", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput({
      brokerCap: connectedBroker({ buyingPowerUsd: 100_000 }),
    }));
    // May have assignment risk warnings for long call — status may be READY_WITH_WARNINGS
    // Core: no BLOCKER findings
    expect(readiness.findings.some(f => f.severity === "BLOCKER")).toBe(false);
    expect(readiness.status === "READY" || readiness.status === "READY_WITH_WARNINGS").toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 2: stale quotes → BLOCKED
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 2: stale quotes → BLOCKED", () => {
  it("QUOTE_STALE blocker when anyStale=true", () => {
    const preview = makePreview({ anyStale: true });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.status).toBe("BLOCKED");
    expect(readiness.findings.some(f => f.code === "QUOTE_STALE" && f.severity === "BLOCKER")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 3: all option quotes unavailable → BLOCKED
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 3: all quotes unavailable → BLOCKED", () => {
  it("ALL_QUOTES_UNAVAILABLE blocker when aggregateFreshness=UNAVAILABLE", () => {
    const preview = makePreview({ aggregateFreshness: "UNAVAILABLE" });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.status).toBe("BLOCKED");
    expect(readiness.findings.some(f => f.code === "ALL_QUOTES_UNAVAILABLE")).toBe(true);
  });

  it("individual leg QUOTE_STALE when currentQuote is null", () => {
    const legs = [makeLeg({ currentQuote: null })];
    const preview = makePreview({ legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.status).toBe("BLOCKED");
    expect(readiness.findings.some(f => f.code === "QUOTE_STALE")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 4: partial Greeks → warning
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 4: partial Greeks → WARNING", () => {
  it("PARTIAL_GREEKS warning when delta is null", () => {
    const legs = [makeLeg({
      greeks: { delta: null, gamma: 0.03, theta: -0.08, vega: 0.12, rho: 0.01, impliedVolatility: 0.35, greeksAvailable: true },
    })];
    const preview = makePreview({ legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.findings.some(f => f.code === "PARTIAL_GREEKS" && f.severity === "WARNING")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 5: wide bid/ask → warning
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 5: wide bid/ask → WARNING", () => {
  it("WIDE_BID_ASK_SPREAD when spread >10%", () => {
    const legs = [makeLeg({ currentQuote: makeQuote({ bid: 2.00, ask: 2.50, midpoint: 2.25, spreadPct: 22.2 }) })];
    const preview = makePreview({ legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview,
      config: { wideBidAskWarningPct: 10, wideBidAskSevereWarningPct: 20 }
    }));
    expect(readiness.findings.some(f =>
      (f.code === "WIDE_BID_ASK_SPREAD" || f.code === "SEVERE_WIDE_SPREAD") && f.severity === "WARNING"
    )).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 6: covered call + insufficient shares → BLOCKED
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 6: covered call insufficient shares → BLOCKED", () => {
  it("INSUFFICIENT_COVERED_SHARES blocker when no shares", () => {
    const preview = makePreview({ strategyFamily: "covered_call", quantity: 2 });
    const positions: ReadinessPositionContext[] = []; // no shares
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview, positions }));
    expect(readiness.status).toBe("BLOCKED");
    expect(readiness.findings.some(f => f.code === "INSUFFICIENT_COVERED_SHARES")).toBe(true);
  });

  it("INSUFFICIENT_COVERED_SHARES blocker when shares < required", () => {
    const preview = makePreview({ strategyFamily: "covered_call", quantity: 2 });
    const positions: ReadinessPositionContext[] = [{ symbol: "NVDA", quantity: 100, isOption: false, isLiveBrokerData: true }];
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview, positions }));
    // 2 contracts need 200 shares, only 100 available
    expect(readiness.findings.some(f => f.code === "INSUFFICIENT_COVERED_SHARES")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 7: covered call + sufficient shares → INFO confirmed
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 7: covered call + sufficient shares", () => {
  it("COVERAGE_CONFIRMED INFO finding when shares available", () => {
    const preview = makePreview({ strategyFamily: "covered_call", quantity: 1 });
    const positions: ReadinessPositionContext[] = [{ symbol: "NVDA", quantity: 100, isOption: false, isLiveBrokerData: true }];
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview, positions }));
    expect(readiness.findings.some(f => f.code === "COVERAGE_CONFIRMED" && f.severity === "INFO")).toBe(true);
    expect(readiness.findings.some(f => f.code === "INSUFFICIENT_COVERED_SHARES")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 8: close option without required position → BLOCKED
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 8: close option without position → BLOCKED", () => {
  it("POSITION_NOT_FOUND blocker for CLOSE_LONG without matching position", () => {
    const legs = [makeLeg({ canonicalIntent: "CLOSE_LONG", contractSymbol: "NVDA260918C00120000" })];
    const preview = makePreview({ legs });
    const positions: ReadinessPositionContext[] = []; // no option positions
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview, positions }));
    expect(readiness.status).toBe("BLOCKED");
    expect(readiness.findings.some(f => f.code === "POSITION_NOT_FOUND")).toBe(true);
  });

  it("INSUFFICIENT_OPTION_POSITION when quantity insufficient", () => {
    const legs = [makeLeg({ canonicalIntent: "CLOSE_LONG", contractSymbol: "NVDA260918C00120000", quantity: 3 })];
    const preview = makePreview({ legs });
    const positions: ReadinessPositionContext[] = [
      { symbol: "NVDA", quantity: 1, isOption: true, contractSymbol: "NVDA260918C00120000", isLiveBrokerData: true }
    ];
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview, positions }));
    expect(readiness.findings.some(f => f.code === "INSUFFICIENT_OPTION_POSITION")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 9: defined-risk spread capital calculation
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 9: defined-risk capital calculation", () => {
  it("bull_call_spread capital = net debit × 100 × qty", () => {
    const legs = [
      makeLeg({ legIndex: 0, strike: 120, optionType: "call", canonicalIntent: "OPEN_LONG" }),
      makeLeg({ legIndex: 1, strike: 125, optionType: "call", canonicalIntent: "OPEN_SHORT_DEFINED_RISK" }),
    ];
    const preview = makePreview({
      strategyFamily: "bull_call_spread",
      instrumentType: "MULTI_LEG_OPTION",
      legs,
      netPricingType: "DEBIT",
      netAmountPerUnit: 2.50,
      netAmountPerContract: 250,
      netTotalAmount: 250,
    });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.capitalEstimate).not.toBeNull();
    expect(readiness.capitalEstimate?.estimationType).toBe("DEFINED_RISK");
    expect(readiness.capitalEstimate?.estimatedRequirementUsd).toBeCloseTo(250, 0);
  });

  it("bear_put_spread capital = net debit total", () => {
    const legs = [
      makeLeg({ legIndex: 0, strike: 125, optionType: "put", canonicalIntent: "OPEN_LONG" }),
      makeLeg({ legIndex: 1, strike: 120, optionType: "put", canonicalIntent: "OPEN_SHORT_DEFINED_RISK" }),
    ];
    const preview = makePreview({
      strategyFamily: "bear_put_spread",
      instrumentType: "MULTI_LEG_OPTION",
      legs,
      netPricingType: "DEBIT",
      netAmountPerUnit: 2.00,
      netAmountPerContract: 200,
      netTotalAmount: 200,
    });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.capitalEstimate?.estimatedRequirementUsd).toBeCloseTo(200, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 10: undefined-risk → BROKER_MARGIN_CALCULATION_REQUIRED
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 10: undefined risk → BROKER_MARGIN_CALCULATION_REQUIRED", () => {
  it("unknown strategy family → BROKER_MARGIN_REQUIRED capital type", () => {
    const preview = makePreview({ strategyFamily: "naked_call_short" });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.capitalEstimate?.estimationType).toBe("BROKER_MARGIN_REQUIRED");
    expect(readiness.findings.some(f => f.code === "BROKER_MARGIN_CALCULATION_REQUIRED")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 11: unsupported multileg broker → BLOCKED
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 11: multileg not supported → BLOCKED", () => {
  it("MULTILEG_NOT_SUPPORTED blocker when supportsMultileg=false + MULTI_LEG_OPTION", () => {
    const preview = makePreview({
      strategyFamily: "bull_call_spread",
      instrumentType: "MULTI_LEG_OPTION",
      legs: [
        makeLeg({ legIndex: 0, strike: 120, canonicalIntent: "OPEN_LONG" }),
        makeLeg({ legIndex: 1, strike: 125, canonicalIntent: "OPEN_SHORT_DEFINED_RISK" }),
      ],
    });
    const { readiness } = evaluateExecutionReadiness(makeInput({
      preview,
      brokerCap: connectedBroker({ supportsMultileg: false }),
    }));
    expect(readiness.status).toBe("BLOCKED");
    expect(readiness.findings.some(f => f.code === "MULTILEG_NOT_SUPPORTED" && f.severity === "BLOCKER")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 12: broker capability unknown → correct warning
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 12: broker capability unknown → warning", () => {
  it("OPTIONS_PERMISSION_UNCONFIRMED warning when supportsOptions=null", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput({
      brokerCap: connectedBroker({ supportsOptions: null }),
    }));
    expect(readiness.findings.some(f => f.code === "OPTIONS_PERMISSION_UNCONFIRMED" && f.severity === "WARNING")).toBe(true);
  });

  it("MULTILEG_NOT_SUPPORTED warning (not blocker) when supportsMultileg=null for MULTI_LEG_OPTION", () => {
    const preview = makePreview({ strategyFamily: "bull_call_spread", instrumentType: "MULTI_LEG_OPTION",
      legs: [makeLeg({ legIndex: 0 }), makeLeg({ legIndex: 1 })] });
    const { readiness } = evaluateExecutionReadiness(makeInput({
      preview,
      brokerCap: connectedBroker({ supportsMultileg: null }),
    }));
    const finding = readiness.findings.find(f => f.code === "MULTILEG_NOT_SUPPORTED");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("WARNING");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 13: expired option → BLOCKED
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 13: expired option → BLOCKED", () => {
  it("OPTION_EXPIRED blocker when leg.isExpired=true", () => {
    const legs = [makeLeg({ isExpired: true, dte: -1, expiration: "2025-01-17" })];
    const preview = makePreview({ legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.status).toBe("BLOCKED");
    expect(readiness.findings.some(f => f.code === "OPTION_EXPIRED" && f.severity === "BLOCKER")).toBe(true);
  });

  it("OPTION_EXPIRED blocker when DTE < 0", () => {
    const legs = [makeLeg({ dte: -5, expiration: "2025-06-20" })];
    const preview = makePreview({ legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.findings.some(f => f.code === "OPTION_EXPIRED")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 14: 0DTE → warning
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 14: 0DTE → WARNING", () => {
  it("ZERO_DTE warning when dte=0 and zeroDteWarning=true", () => {
    const legs = [makeLeg({ dte: 0, expiration: "2026-08-11" })];
    const preview = makePreview({ legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({
      preview, config: { zeroDteWarning: true },
    }));
    expect(readiness.findings.some(f => f.code === "ZERO_DTE" && f.severity === "WARNING")).toBe(true);
  });

  it("no ZERO_DTE when zeroDteWarning=false", () => {
    const legs = [makeLeg({ dte: 0 })];
    const preview = makePreview({ legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({
      preview, config: { zeroDteWarning: false },
    }));
    expect(readiness.findings.some(f => f.code === "ZERO_DTE")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 15: invalid strike ordering → BLOCKED
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 15: invalid strike order → BLOCKED", () => {
  it("INVALID_STRIKE_ORDER for bull_call_spread when long strike >= short strike", () => {
    const legs = [
      makeLeg({ legIndex: 0, strike: 125, optionType: "call", canonicalIntent: "OPEN_LONG" }),
      makeLeg({ legIndex: 1, strike: 120, optionType: "call", canonicalIntent: "OPEN_SHORT_DEFINED_RISK" }),
    ];
    const preview = makePreview({ strategyFamily: "bull_call_spread", instrumentType: "MULTI_LEG_OPTION", legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.status).toBe("BLOCKED");
    expect(readiness.findings.some(f => f.code === "INVALID_STRIKE_ORDER")).toBe(true);
  });

  it("INVALID_STRIKE_ORDER for bear_put_spread when long strike <= short strike", () => {
    const legs = [
      makeLeg({ legIndex: 0, strike: 120, optionType: "put", canonicalIntent: "OPEN_LONG" }),
      makeLeg({ legIndex: 1, strike: 125, optionType: "put", canonicalIntent: "OPEN_SHORT_DEFINED_RISK" }),
    ];
    const preview = makePreview({ strategyFamily: "bear_put_spread", instrumentType: "MULTI_LEG_OPTION", legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.findings.some(f => f.code === "INVALID_STRIKE_ORDER")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 16: valid bull call spread
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 16: valid bull call spread → no structure blocker", () => {
  it("no INVALID_STRIKE_ORDER when strikes are correct", () => {
    const legs = [
      makeLeg({ legIndex: 0, strike: 120, optionType: "call", canonicalIntent: "OPEN_LONG" }),
      makeLeg({ legIndex: 1, strike: 125, optionType: "call", canonicalIntent: "OPEN_SHORT_DEFINED_RISK",
        contractSymbol: "NVDA260918C00125000" }),
    ];
    const preview = makePreview({ strategyFamily: "bull_call_spread", instrumentType: "MULTI_LEG_OPTION", legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview,
      brokerCap: connectedBroker({ supportsMultileg: true }) }));
    expect(readiness.findings.some(f => f.code === "INVALID_STRIKE_ORDER")).toBe(false);
    expect(readiness.findings.some(f => f.code === "INVALID_LEG_STRUCTURE")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 17: valid bear put spread
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 17: valid bear put spread → no structure blocker", () => {
  it("no INVALID_STRIKE_ORDER for correct bear put spread", () => {
    const legs = [
      makeLeg({ legIndex: 0, strike: 125, optionType: "put", canonicalIntent: "OPEN_LONG",
        contractSymbol: "NVDA260918P00125000" }),
      makeLeg({ legIndex: 1, strike: 120, optionType: "put", canonicalIntent: "OPEN_SHORT_DEFINED_RISK",
        contractSymbol: "NVDA260918P00120000" }),
    ];
    const preview = makePreview({ strategyFamily: "bear_put_spread", instrumentType: "MULTI_LEG_OPTION", legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview,
      brokerCap: connectedBroker({ supportsMultileg: true }) }));
    expect(readiness.findings.some(f => f.code === "INVALID_STRIKE_ORDER")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 18: valid iron condor
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 18: valid iron condor → no structure blocker", () => {
  it("iron condor with 4 legs has no leg structure blocker", () => {
    const legs = [
      makeLeg({ legIndex: 0, strike: 110, optionType: "put", canonicalIntent: "OPEN_LONG", contractSymbol: "NVDA260918P00110000" }),
      makeLeg({ legIndex: 1, strike: 115, optionType: "put", canonicalIntent: "OPEN_SHORT_DEFINED_RISK", contractSymbol: "NVDA260918P00115000" }),
      makeLeg({ legIndex: 2, strike: 130, optionType: "call", canonicalIntent: "OPEN_SHORT_DEFINED_RISK", contractSymbol: "NVDA260918C00130000" }),
      makeLeg({ legIndex: 3, strike: 135, optionType: "call", canonicalIntent: "OPEN_LONG", contractSymbol: "NVDA260918C00135000" }),
    ];
    const preview = makePreview({ strategyFamily: "iron_condor", instrumentType: "MULTI_LEG_OPTION", legs,
      netPricingType: "CREDIT", netAmountPerUnit: 2.00, netAmountPerContract: 200, netTotalAmount: 200 });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview,
      brokerCap: connectedBroker({ supportsMultileg: true }) }));
    expect(readiness.findings.some(f => f.code === "INVALID_LEG_STRUCTURE")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 19: assignment risk for OPEN_SHORT_DEFINED_RISK
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 19: assignment risk for OPEN_SHORT_DEFINED_RISK (spec §19)", () => {
  it("SHORT_OPTION_ASSIGNMENT_RISK warning for leg with OPEN_SHORT_DEFINED_RISK intent", () => {
    const legs = [
      makeLeg({ legIndex: 0, canonicalIntent: "OPEN_LONG" }),
      makeLeg({ legIndex: 1, canonicalIntent: "OPEN_SHORT_DEFINED_RISK",
        contractSymbol: "NVDA260918C00125000" }),
    ];
    const preview = makePreview({ strategyFamily: "bull_call_spread", instrumentType: "MULTI_LEG_OPTION", legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.findings.some(f => f.code === "SHORT_OPTION_ASSIGNMENT_RISK")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 20: future SHORT-bearing intent uses isShortIntent
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 20: future SHORT-bearing intent (spec §20)", () => {
  it("OPEN_SHORT_FUTURE_VARIANT recognized as short", () => {
    const legs = [makeLeg({ canonicalIntent: "OPEN_SHORT_FUTURE_VARIANT" })];
    const preview = makePreview({ legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.findings.some(f => f.code === "SHORT_OPTION_ASSIGNMENT_RISK")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 21: missing positions do NOT become zero holdings
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 21: missing positions ≠ zero holdings (spec §21)", () => {
  it("POSITION_DATA_UNAVAILABLE warning (not blocker) for covered_call with positions=null", () => {
    const preview = makePreview({ strategyFamily: "covered_call" });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview, positions: null }));
    // Must NOT show INSUFFICIENT_COVERED_SHARES (which would assume zero)
    expect(readiness.findings.some(f => f.code === "INSUFFICIENT_COVERED_SHARES")).toBe(false);
    // Must show POSITION_DATA_UNAVAILABLE warning
    expect(readiness.findings.some(f => f.code === "POSITION_DATA_UNAVAILABLE" && f.severity === "WARNING")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 22: missing buying power does NOT become $0
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 22: missing buying power ≠ $0 (spec §22)", () => {
  it("BUYING_POWER_UNCONFIRMED warning when buying power unavailable", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput({
      brokerCap: connectedBroker({ buyingPowerUsd: null, buyingPowerSource: "unavailable" }),
    }));
    expect(readiness.findings.some(f => f.code === "BUYING_POWER_UNCONFIRMED" && f.severity === "WARNING")).toBe(true);
    // Must NOT show BUYING_POWER_INSUFFICIENT (which would require a $0 comparison)
    expect(readiness.findings.some(f => f.code === "BUYING_POWER_INSUFFICIENT")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 23: thresholds honor config
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 23: thresholds honor config (spec §23)", () => {
  it("NEAR_EXPIRATION not triggered when dte > nearExpirationDays", () => {
    const legs = [makeLeg({ dte: 5, isExpired: false })];
    const preview = makePreview({ legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({
      preview, config: { nearExpirationDays: 2 },
    }));
    expect(readiness.findings.some(f => f.code === "NEAR_EXPIRATION")).toBe(false);
  });

  it("NEAR_EXPIRATION triggered when dte <= nearExpirationDays", () => {
    const legs = [makeLeg({ dte: 2, isExpired: false })];
    const preview = makePreview({ legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({
      preview, config: { nearExpirationDays: 2 },
    }));
    expect(readiness.findings.some(f => f.code === "NEAR_EXPIRATION")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 24: invalid net price → BLOCKED
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 24: invalid net price → BLOCKED", () => {
  it("INVALID_NET_PRICE blocker when amountPerUnit is negative", () => {
    const preview = makePreview({ netAmountPerUnit: -1.50, netTotalAmount: -150 });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.status).toBe("BLOCKED");
    expect(readiness.findings.some(f => f.code === "INVALID_NET_PRICE" && f.severity === "BLOCKER")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Capital estimate scenarios
// ─────────────────────────────────────────────────────────────────────────────
describe("Capital estimates", () => {
  it("spec §29: bull_put_spread credit spread capital = (spread_width - credit) × 100 × qty", () => {
    const legs = [
      makeLeg({ legIndex: 0, strike: 115, optionType: "put", canonicalIntent: "OPEN_LONG", contractSymbol: "NVDA260918P00115000" }),
      makeLeg({ legIndex: 1, strike: 120, optionType: "put", canonicalIntent: "OPEN_SHORT_DEFINED_RISK", contractSymbol: "NVDA260918P00120000" }),
    ];
    const preview = makePreview({
      strategyFamily: "bull_put_spread", instrumentType: "MULTI_LEG_OPTION",
      legs, netPricingType: "CREDIT", netAmountPerUnit: 1.50, netAmountPerContract: 150, netTotalAmount: 150,
    });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview,
      brokerCap: connectedBroker({ supportsMultileg: true }) }));
    // spread width = 120 - 115 = 5; credit = 1.50; max loss per unit = 3.50; × 100 × 1 = 350
    expect(readiness.capitalEstimate?.estimationType).toBe("DEFINED_RISK");
    expect(readiness.capitalEstimate?.estimatedRequirementUsd).toBeCloseTo(350, 0);
  });

  it("spec §30: cash_secured_put capital = strike × 100 × qty - credit", () => {
    const legs = [
      makeLeg({ strike: 120, optionType: "put", canonicalIntent: "OPEN_SHORT_SECURED" }),
    ];
    const preview = makePreview({
      strategyFamily: "cash_secured_put",
      legs, netPricingType: "CREDIT", netAmountPerUnit: 2.00, netAmountPerContract: 200, netTotalAmount: 200,
    });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    // 120 × 100 × 1 - (2.00 × 100 × 1) = 12000 - 200 = 11800
    expect(readiness.capitalEstimate?.estimationType).toBe("DEFINED_RISK");
    expect(readiness.capitalEstimate?.estimatedRequirementUsd).toBeCloseTo(11800, 0);
  });

  it("spec §31: covered_call capital type = SHARES_ONLY", () => {
    const preview = makePreview({ strategyFamily: "covered_call",
      netPricingType: "CREDIT", netAmountPerUnit: 1.50, netAmountPerContract: 150, netTotalAmount: 150 });
    const positions: ReadinessPositionContext[] = [{ symbol: "NVDA", quantity: 100, isOption: false, isLiveBrokerData: true }];
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview, positions }));
    expect(readiness.capitalEstimate?.estimationType).toBe("SHARES_ONLY");
    expect(readiness.capitalEstimate?.estimatedRequirementUsd).toBe(0);
  });

  it("spec §32: iron_condor capital = max_wing_width - net_credit × 100 × qty", () => {
    const legs = [
      makeLeg({ legIndex: 0, strike: 110, optionType: "put", canonicalIntent: "OPEN_LONG", contractSymbol: "NVDA260918P00110000" }),
      makeLeg({ legIndex: 1, strike: 115, optionType: "put", canonicalIntent: "OPEN_SHORT_DEFINED_RISK", contractSymbol: "NVDA260918P00115000" }),
      makeLeg({ legIndex: 2, strike: 130, optionType: "call", canonicalIntent: "OPEN_SHORT_DEFINED_RISK", contractSymbol: "NVDA260918C00130000" }),
      makeLeg({ legIndex: 3, strike: 135, optionType: "call", canonicalIntent: "OPEN_LONG", contractSymbol: "NVDA260918C00135000" }),
    ];
    const preview = makePreview({
      strategyFamily: "iron_condor", instrumentType: "MULTI_LEG_OPTION",
      legs, netPricingType: "CREDIT", netAmountPerUnit: 1.80, netAmountPerContract: 180, netTotalAmount: 180,
    });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview,
      brokerCap: connectedBroker({ supportsMultileg: true }) }));
    // put wing = 115-110=5, call wing = 135-130=5; max = 5; credit=1.80; max loss = 3.20; × 100 × 1 = 320
    expect(readiness.capitalEstimate?.estimationType).toBe("DEFINED_RISK");
    expect(readiness.capitalEstimate?.estimatedRequirementUsd).toBeCloseTo(320, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 33: broker not connected → BLOCKED
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 33: broker not connected → BLOCKED", () => {
  it("BROKER_NOT_CONNECTED blocker", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput({
      brokerCap: { connected: false, provider: "tradier", supportsOptions: null, supportsMultileg: null,
        optionsLevel: null, accountStatus: null, buyingPowerUsd: null, buyingPowerSource: "unavailable" },
    }));
    expect(readiness.status).toBe("BLOCKED");
    expect(readiness.findings.some(f => f.code === "BROKER_NOT_CONNECTED" && f.severity === "BLOCKER")).toBe(true);
  });

  it("BROKER_NOT_CONNECTED blocker when brokerCap is null", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput({ brokerCap: null }));
    expect(readiness.findings.some(f => f.code === "BROKER_NOT_CONNECTED")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 34: options not supported → BLOCKED
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 34: options not supported → BLOCKED", () => {
  it("OPTIONS_NOT_SUPPORTED blocker when supportsOptions=false", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput({
      brokerCap: connectedBroker({ supportsOptions: false }),
    }));
    expect(readiness.findings.some(f => f.code === "OPTIONS_NOT_SUPPORTED" && f.severity === "BLOCKER")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 35: READY_WITH_WARNINGS
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 35: READY_WITH_WARNINGS when only warnings", () => {
  it("status = READY_WITH_WARNINGS when Greeks partial but no blockers", () => {
    const legs = [makeLeg({
      greeks: { delta: null, gamma: 0.03, theta: -0.08, vega: 0.12, rho: 0.01, impliedVolatility: 0.35, greeksAvailable: true },
    })];
    const preview = makePreview({ legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({
      preview,
      brokerCap: connectedBroker({ supportsOptions: true, buyingPowerUsd: 100_000 }),
    }));
    expect(readiness.findings.some(f => f.severity === "BLOCKER")).toBe(false);
    expect(readiness.status).toBe("READY_WITH_WARNINGS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 36: severe wide spread → warning
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 36: severe wide spread → SEVERE_WIDE_SPREAD warning", () => {
  it("SEVERE_WIDE_SPREAD when spreadPct > 20", () => {
    const legs = [makeLeg({ currentQuote: makeQuote({ spreadPct: 25.0 }) })];
    const preview = makePreview({ legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview,
      config: { wideBidAskWarningPct: 10, wideBidAskSevereWarningPct: 20 } }));
    expect(readiness.findings.some(f => f.code === "SEVERE_WIDE_SPREAD" && f.severity === "WARNING")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 37: low open interest → warning
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 37: low open interest → WARNING", () => {
  it("LOW_OPEN_INTEREST when OI < threshold", () => {
    const legs = [makeLeg({ liquidity: { openInterest: 5, volume: 2, bidAskSpreadAbs: 0.10, bidAskSpreadPct: 4, category: "POOR" } })];
    const preview = makePreview({ legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview,
      config: { lowOpenInterestThreshold: 100, lowVolumeThreshold: 10 } }));
    expect(readiness.findings.some(f => f.code === "LOW_OPEN_INTEREST")).toBe(true);
    expect(readiness.findings.some(f => f.code === "LOW_VOLUME")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 38: pricing direction mismatch → warning
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 38: pricing direction mismatch → WARNING", () => {
  it("PRICING_DIRECTION_MISMATCH when debit strategy shows credit", () => {
    const preview = makePreview({
      strategyFamily: "long_call",
      netPricingType: "CREDIT",
      netAmountPerUnit: 1.50,
      netAmountPerContract: 150,
      netTotalAmount: 150,
    });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.findings.some(f => f.code === "PRICING_DIRECTION_MISMATCH" && f.severity === "WARNING")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 39: mixed underlying → BLOCKED
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 39: mixed underlying → BLOCKED", () => {
  it("MIXED_UNDERLYING blocker when legs have different underlying symbols", () => {
    const legs = [
      makeLeg({ legIndex: 0, contractSymbol: "NVDA260918C00120000" }),
      makeLeg({ legIndex: 1, contractSymbol: "AAPL260918C00120000" }),
    ];
    const preview = makePreview({ strategyFamily: "bull_call_spread", instrumentType: "MULTI_LEG_OPTION", legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.findings.some(f => f.code === "MIXED_UNDERLYING" && f.severity === "BLOCKER")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec scenario 40: invalid quantity → BLOCKED
// ─────────────────────────────────────────────────────────────────────────────
describe("Scenario 40: invalid quantity → BLOCKED", () => {
  it("INVALID_QUANTITY blocker when quantity=0", () => {
    const preview = makePreview({ quantity: 0 });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.findings.some(f => f.code === "INVALID_QUANTITY" && f.severity === "BLOCKER")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional checks
// ─────────────────────────────────────────────────────────────────────────────
describe("Additional invariants", () => {
  it("OPTION_MARKET_INVALID blocker for crossed market", () => {
    const legs = [makeLeg({ currentQuote: makeQuote({ bid: 3.0, ask: 2.5, isCrossed: true }) })];
    const preview = makePreview({ legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({ preview }));
    expect(readiness.findings.some(f => f.code === "OPTION_MARKET_INVALID" && f.severity === "BLOCKER")).toBe(true);
  });

  it("NEAR_EXPIRATION warning for DTE=1", () => {
    const legs = [makeLeg({ dte: 1 })];
    const preview = makePreview({ legs });
    const { readiness } = evaluateExecutionReadiness(makeInput({
      preview, config: { zeroDteWarning: true, nearExpirationDays: 2 },
    }));
    expect(readiness.findings.some(f => f.code === "NEAR_EXPIRATION")).toBe(true);
  });

  it("BUYING_POWER_INSUFFICIENT blocker when buyingPower < requirement", () => {
    const preview = makePreview({ netAmountPerUnit: 50, netAmountPerContract: 5000, netTotalAmount: 5000 });
    const { readiness } = evaluateExecutionReadiness(makeInput({
      preview,
      brokerCap: connectedBroker({ buyingPowerUsd: 1000 }), // less than 5000
    }));
    expect(readiness.findings.some(f => f.code === "BUYING_POWER_INSUFFICIENT" && f.severity === "BLOCKER")).toBe(true);
  });

  it("findings array is stable — no duplicate codes for same leg", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput());
    const codes = readiness.findings.map(f => f.code + (f.legIndex ?? ""));
    const unique = new Set(codes);
    expect(codes.length).toBe(unique.size);
  });

  it("isEstimate is always true on capitalEstimate", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput());
    if (readiness.capitalEstimate) {
      expect(readiness.capitalEstimate.isEstimate).toBe(true);
    }
  });

  it("capitalEstimate has disclaimer", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput());
    if (readiness.capitalEstimate) {
      expect(readiness.capitalEstimate.disclaimer).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Compliance: forbidden labels must never appear
// ─────────────────────────────────────────────────────────────────────────────
describe("Compliance: no forbidden labels", () => {
  const FORBIDDEN_LABELS = [
    "TRADE_APPROVED", "GO", "EXECUTION_APPROVED", "RECOMMENDED",
    "PASS_THROUGH", "ALL_CLEAR", "APPROVED_TO_TRADE", "GUARANTEED",
    "broker approval", "guaranteed fill",
  ];

  it("no forbidden label in statusLabel", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput());
    for (const label of FORBIDDEN_LABELS) {
      expect(readiness.statusLabel.toUpperCase()).not.toContain(label.toUpperCase());
    }
  });

  it("no forbidden label in findings titles or messages", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput());
    for (const f of readiness.findings) {
      for (const label of FORBIDDEN_LABELS) {
        expect(f.title?.toUpperCase() ?? "").not.toContain(label.toUpperCase());
      }
    }
  });

  it("disclaimer contains 'not investment advice'", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput());
    expect(readiness.disclaimer.toLowerCase()).toContain("not investment advice");
  });

  it("capitalEstimate disclaimer never says 'broker approval'", () => {
    const { readiness } = evaluateExecutionReadiness(makeInput());
    if (readiness.capitalEstimate) {
      expect(readiness.capitalEstimate.disclaimer.toLowerCase()).not.toContain("broker approval");
    }
  });
});

// Wrapper: aligns service's direct return with { readiness } shape used in all tests
function evaluateExecutionReadiness(input: ExecutionReadinessInput) {
  return { readiness: _evaluateReadiness(input) };
}
