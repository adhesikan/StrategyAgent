// CTA gating + honest count/risk presentation for ranked trade search cards.
import { describe, expect, it } from "vitest";

import {
  qualifiedCtas,
  rankedCountsLine,
  riskFitLine,
  tradeBuilderEligible,
  unavailableCtas,
  watchCtas,
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
