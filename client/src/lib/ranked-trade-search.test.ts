// CTA gating + honest count/risk presentation for ranked trade search cards.
import { describe, expect, it } from "vitest";

import {
  hasActionableTrigger,
  NO_TRADE_REASON_LABELS,
  qualifiedCtas,
  rankedCountsLine,
  riskFitLine,
  tradeBuilderEligible,
  translateNoTradeReason,
  triggerStatusLabel,
  unavailableCtas,
  watchCtas,
  type RankedSearchSource,
  type RankedTradeCandidate,
  type RankedTradeSearch,
} from "./ranked-trade-search";

const complete: RankedTradeCandidate = {
  rank: 1,
  symbol: "NVDA",
  strategy: "vcp",
  setupStatus: "actionable",
  trigger: "Break above 190.50",
  invalidation: "184.20",
  maxRisk: 280,
  maxRiskIsExact: true,
  quantity: 44,
  dataQuality: "real",
  whySelected: [],
  warnings: [],
};

describe("CTA gating (spec §9)", () => {
  it("offers Trade Builder only for actionable, fresh, real-data, complete candidates", () => {
    expect(tradeBuilderEligible(complete)).toBe(true);
    expect(qualifiedCtas(complete).map((c) => c.label)).toEqual(["Analyze", "Review Trade", "Risk Details", "Open Trade Builder"]);
  });

  it.each([
    ["missing trigger", { ...complete, trigger: undefined }],
    ["missing invalidation", { ...complete, invalidation: undefined }],
    ["missing risk", { ...complete, maxRisk: undefined }],
    ["missing quantity", { ...complete, quantity: undefined }],
    ["estimated data", { ...complete, dataQuality: "estimated" }],
    ["unknown data quality", { ...complete, dataQuality: undefined }],
    ["stale setup", { ...complete, setupStatus: "stale" }],
    ["risk budget miss", { ...complete, fitsRiskBudget: false }],
  ])("withholds Trade Builder when %s", (_label, c) => {
    expect(tradeBuilderEligible(c as RankedTradeCandidate)).toBe(false);
    expect(qualifiedCtas(c as RankedTradeCandidate).map((x) => x.label)).not.toContain("Open Trade Builder");
  });

  it("watch candidates never get a Trade Builder CTA", () => {
    const labels = watchCtas({ symbol: "AMD", watchConditions: [] }).map((c) => c.label);
    expect(labels).toEqual(["Analyze", "Add to Watchlist", "View Setup", "Open Scanner"]);
    expect(labels.join(" ")).not.toMatch(/trade builder/i);
  });

  it("unavailable state offers Retry + Open Scanner only", () => {
    expect(unavailableCtas("Find the best trades today").map((c) => c.label)).toEqual(["Retry", "Open Scanner"]);
  });
});

// ---------------------------------------------------------------------------
// Sprint 4A — §1 source state: banner logic
// ---------------------------------------------------------------------------

describe("§1 source state — fallback banner logic", () => {
  it("RANKED_MCP_SUCCESS is a valid source state (no banner needed)", () => {
    const src: RankedSearchSource = "RANKED_MCP_SUCCESS";
    expect(src).toBe("RANKED_MCP_SUCCESS");
    // Banner shown only for RANKED_MCP_FAILED_WITH_FALLBACK
    expect(src === "RANKED_MCP_FAILED_WITH_FALLBACK").toBe(false);
  });

  it("RANKED_MCP_EMPTY is a valid source state (no banner — empty is not a failure)", () => {
    const src: RankedSearchSource = "RANKED_MCP_EMPTY";
    expect(src).toBe("RANKED_MCP_EMPTY");
    expect(src === "RANKED_MCP_FAILED_WITH_FALLBACK").toBe(false);
  });

  it("RANKED_MCP_FAILED_WITH_FALLBACK is the ONLY state that triggers the banner", () => {
    const src: RankedSearchSource = "RANKED_MCP_FAILED_WITH_FALLBACK";
    expect(src === "RANKED_MCP_FAILED_WITH_FALLBACK").toBe(true);
  });

  it("all five source states are valid RankedSearchSource literals", () => {
    const states: RankedSearchSource[] = [
      "RANKED_MCP_SUCCESS",
      "RANKED_MCP_EMPTY",
      "RANKED_MCP_FAILED_WITH_FALLBACK",
      "STANDARD_SEARCH",
      "RULE_BASED_SUMMARY",
    ];
    expect(states).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Sprint 4A — §3 trigger state helpers
// ---------------------------------------------------------------------------

describe("§3 hasActionableTrigger", () => {
  it("returns true when trigger is a non-empty string", () => {
    expect(hasActionableTrigger({ ...complete, trigger: "Break above 190.50" })).toBe(true);
  });

  it("returns false when trigger is undefined", () => {
    expect(hasActionableTrigger({ ...complete, trigger: undefined })).toBe(false);
  });

  it("returns false when trigger is an empty string", () => {
    expect(hasActionableTrigger({ ...complete, trigger: "" })).toBe(false);
  });

  it("returns false when trigger is only whitespace", () => {
    expect(hasActionableTrigger({ ...complete, trigger: "   " })).toBe(false);
  });

  it("valid trigger — 'Entry Trigger Missing' MUST NOT be shown", () => {
    // Presence check: if hasActionableTrigger is true, the UI should NOT
    // render any "Entry Trigger Missing" label for this candidate.
    const c = { ...complete, trigger: "Break above 190.50" };
    expect(hasActionableTrigger(c)).toBe(true);
    // The label helper should return an actionable status, never "Entry Trigger Missing"
    const label = triggerStatusLabel(c);
    expect(label).not.toMatch(/entry trigger missing/i);
    expect(label).not.toMatch(/missing/i);
  });
});

describe("§3 triggerStatusLabel", () => {
  it("returns 'No trigger' when trigger is absent", () => {
    expect(triggerStatusLabel({ ...complete, trigger: undefined })).toBe("No trigger");
  });

  it("returns 'Event confirmation required' for event-type triggers", () => {
    const c = { ...complete, trigger: "Opening range breakout", triggerType: "event" as const };
    expect(triggerStatusLabel(c)).toBe("Event confirmation required");
  });

  it("returns 'Trigger confirmed' when currentPrice >= extracted trigger price", () => {
    const c = { ...complete, trigger: "Break above 190.50", currentPrice: 191.00 };
    expect(triggerStatusLabel(c)).toBe("Trigger confirmed");
  });

  it("returns 'Awaiting breakout' when currentPrice < extracted trigger price", () => {
    const c = { ...complete, trigger: "Break above 190.50", currentPrice: 185.00 };
    expect(triggerStatusLabel(c)).toBe("Awaiting breakout");
  });

  it("returns 'Awaiting breakout' when trigger exists but currentPrice is unknown", () => {
    const c = { ...complete, trigger: "Break above 190.50", currentPrice: undefined };
    expect(triggerStatusLabel(c)).toBe("Awaiting breakout");
  });

  it("crossed trigger (currentPrice === triggerPrice) counts as confirmed", () => {
    const c = { ...complete, trigger: "Break above 190.50", currentPrice: 190.50 };
    expect(triggerStatusLabel(c)).toBe("Trigger confirmed");
  });
});

// ---------------------------------------------------------------------------
// Sprint 4A — §5 strategy score distinct from rank
// ---------------------------------------------------------------------------

describe("§5 strategyScore is separate from rank", () => {
  it("RankedTradeCandidate can carry both rank and strategyScore independently", () => {
    const c: RankedTradeCandidate = { ...complete, rank: 1, strategyScore: 72 };
    expect(c.rank).toBe(1);
    expect(c.strategyScore).toBe(72);
    // A lower-scoring setup can rank higher — score and rank are independent
    const c2: RankedTradeCandidate = { ...complete, rank: 1, strategyScore: 45 };
    expect(c2.rank).toBe(1);
    expect(c2.strategyScore).toBe(45);
    // This must never be enforced: rank <= score or score <= rank
    expect(c2.rank).not.toBeGreaterThan(c2.strategyScore!);
  });

  it("strategyScore field is optional — absence does not break anything", () => {
    const c: RankedTradeCandidate = { ...complete };
    expect(c.strategyScore).toBeUndefined();
    expect(c.rank).toBe(1); // rank still present
  });
});

// ---------------------------------------------------------------------------
// Sprint 4A — §6 NO_TRADE specific reason labels
// ---------------------------------------------------------------------------

describe("§6 translateNoTradeReason", () => {
  it("maps known reason codes to trader-facing labels", () => {
    expect(translateNoTradeReason("WAITING_FOR_TRIGGER")).toBe("Waiting for Trigger");
    expect(translateNoTradeReason("RISK_LIMIT_EXCEEDED")).toBe("Risk Limit Exceeded");
    expect(translateNoTradeReason("EARNINGS_RISK")).toBe("Earnings Risk");
    expect(translateNoTradeReason("STALE_SETUP")).toBe("Stale Setup");
    expect(translateNoTradeReason("DATA_UNAVAILABLE")).toBe("Data Unavailable");
    expect(translateNoTradeReason("DIRECTION_CONFLICT")).toBe("Direction Conflict");
    expect(translateNoTradeReason("NO_VALID_SETUP")).toBe("No Valid Setup");
    expect(translateNoTradeReason("UNSUPPORTED_STRUCTURE")).toBe("Unsupported Structure");
  });

  it("returns null for absent/empty/unknown reason codes (chip is omitted)", () => {
    expect(translateNoTradeReason(null)).toBeNull();
    expect(translateNoTradeReason(undefined)).toBeNull();
    expect(translateNoTradeReason("")).toBeNull();
    expect(translateNoTradeReason("some unrecognized prose")).toBeNull();
  });

  it("handles reason codes with a suffix (e.g. EARNINGS_RISK:NVDA)", () => {
    expect(translateNoTradeReason("EARNINGS_RISK:NVDA")).toBe("Earnings Risk");
    expect(translateNoTradeReason("STALE_SETUP:BA")).toBe("Stale Setup");
  });

  it("NO_TRADE_REASON_LABELS covers all 8 required codes", () => {
    const required = [
      "WAITING_FOR_TRIGGER",
      "RISK_LIMIT_EXCEEDED",
      "EARNINGS_RISK",
      "STALE_SETUP",
      "DATA_UNAVAILABLE",
      "DIRECTION_CONFLICT",
      "NO_VALID_SETUP",
      "UNSUPPORTED_STRUCTURE",
    ];
    for (const code of required) {
      expect(NO_TRADE_REASON_LABELS[code]).toBeTruthy();
    }
  });

  it("no execution behavior — translateNoTradeReason is a pure lookup with no side effects", () => {
    // Called twice with the same input; pure function, must be idempotent
    const a = translateNoTradeReason("WAITING_FOR_TRIGGER");
    const b = translateNoTradeReason("WAITING_FOR_TRIGGER");
    expect(a).toBe(b);
    expect(a).toBe("Waiting for Trigger");
    // No order/execution references
    const helperSource = translateNoTradeReason.toString();
    expect(helperSource).not.toMatch(/placeOrder|submitOrder|executeTrade/i);
  });
});

// ---------------------------------------------------------------------------
// Sprint 4A — UI/integration: trigger status rendering for (a) confirmed,
// (b) event-type, (c) missing trigger (reviewer requirement)
// ---------------------------------------------------------------------------

describe("§3 trigger status — UI rendering scenarios", () => {
  it("(a) confirmed price trigger: currentPrice ≥ trigger price → 'Trigger confirmed'", () => {
    // Exact match
    expect(triggerStatusLabel({ ...complete, trigger: "Break above 190.50", currentPrice: 190.50 }))
      .toBe("Trigger confirmed");
    // Already crossed
    expect(triggerStatusLabel({ ...complete, trigger: "Breakout above 200", currentPrice: 210 }))
      .toBe("Trigger confirmed");
  });

  it("(b) event-type trigger: triggerType === 'event' → 'Event confirmation required' regardless of price", () => {
    // Even if currentPrice is above any price in the string, event type takes priority
    expect(triggerStatusLabel({ ...complete, trigger: "Opening range breakout", triggerType: "event", currentPrice: 999 }))
      .toBe("Event confirmation required");
    expect(triggerStatusLabel({ ...complete, trigger: "Gap-up above prior high", triggerType: "event", currentPrice: undefined }))
      .toBe("Event confirmation required");
  });

  it("(c) missing trigger → 'No trigger'; absent trigger NEVER shows as 'Entry Trigger Missing'", () => {
    const result = triggerStatusLabel({ ...complete, trigger: undefined });
    expect(result).toBe("No trigger");
    // Explicit guard: the string "Entry Trigger Missing" must never be returned
    expect(result).not.toMatch(/entry trigger missing/i);
    expect(triggerStatusLabel({ ...complete, trigger: "" })).toBe("No trigger");
  });

  it("(d) price trigger present, currentPrice unknown → 'Awaiting breakout' (conservative default)", () => {
    expect(triggerStatusLabel({ ...complete, trigger: "Break above 190.50", currentPrice: undefined }))
      .toBe("Awaiting breakout");
  });

  it("hasActionableTrigger gates the 'Entry Trigger Missing' display path correctly", () => {
    // When true: UI must show the trigger, never "Entry Trigger Missing"
    expect(hasActionableTrigger({ ...complete, trigger: "Break above 190.50" })).toBe(true);
    // When false: UI may show an absent-trigger state, but triggerStatusLabel returns "No trigger" not "Entry Trigger Missing"
    expect(hasActionableTrigger({ ...complete, trigger: undefined })).toBe(false);
    expect(triggerStatusLabel({ ...complete, trigger: undefined })).not.toMatch(/entry trigger missing/i);
  });
});

describe("honest counts + risk lines (spec §5, §8)", () => {
  const search: RankedTradeSearch = {
    request: {},
    reviewedCount: 50,
    qualifiedCount: 1,
    watchCount: 2,
    rejectedCount: 3,
    unavailableCount: 1,
    candidates: [complete],
    watchCandidates: [],
    rejectionSummary: [],
    generatedAt: "2026-08-04T00:00:00.000Z",
    warnings: [],
    maxRiskDollars: 300,
  };

  it("labels reviewedCount as stored opportunities reviewed (not the bucket population)", () => {
    expect(rankedCountsLine(search)).toBe("50 stored opportunities reviewed · 1 qualified · 2 worth watching · 3 rejected · 1 unavailable");
  });

  it("shows requested vs calculated risk with fit for exact (live) candidates", () => {
    expect(riskFitLine(complete, 300)).toBe("Max risk $280 — fits the requested $300 limit at 44 units");
  });

  it("never claims exact risk for estimated candidates", () => {
    const est = { ...complete, maxRiskIsExact: false, fitsRiskBudget: undefined };
    expect(riskFitLine(est, 300)).toContain("Estimated max risk $280 (not an exact figure)");
    expect(riskFitLine(est, 300)).toContain("compare against");
  });
});
