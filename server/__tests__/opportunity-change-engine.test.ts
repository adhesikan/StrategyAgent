// Comprehensive deterministic tests for opportunity-change-engine.ts — Sprint 2.3.1
// Run with: npx vitest run --root . server/__tests__/opportunity-change-engine.test.ts

import { describe, it, expect } from "vitest";
import {
  classifyImportance,
  inferDrivers,
  inferWarnings,
  buildSummary,
  classifyConfidence,
  explainSymbolChange,
  explainRemovedSymbol,
  buildChangeIntelligenceReport,
  type SymbolHistoryRow,
  type OpportunityChangeExplanation,
} from "../services/opportunity-change-engine";
import type {
  OpportunityRankingResult,
  ScoredGrowthCandidate,
  OpportunityScore,
} from "../services/opportunity-ranking-engine";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeScore(overrides: Partial<OpportunityScore> = {}): OpportunityScore {
  return {
    symbol: "NVDA",
    overallScore: 75,
    confidence: "high",
    technicalScore: 78,
    institutionalScore: 72,
    fundamentalScore: 68,
    riskScore: 65,
    regimeScore: 70,
    category: "Top Growth",
    reasons: ["Strong VCP pattern", "Volume confirmed"],
    warnings: [],
    lastUpdated: "2026-08-08T00:00:00Z",
    ...overrides,
  };
}

function makeCandidate(sym: string, overrides: Partial<ScoredGrowthCandidate> = {}): ScoredGrowthCandidate {
  return {
    rank: 1,
    symbol: sym,
    strategy: "stock_swing",
    rewardRisk: 3.5,
    maxRisk: 250,
    whySelected: ["Breakout near resistance", "Volume confirmed"],
    warnings: [],
    opportunityScore: makeScore({ symbol: sym }),
    ...overrides,
  } as ScoredGrowthCandidate;
}

function makeHistoryRow(sym: string, score: number, rank: number | null, daysAgo: number, overrides: Partial<SymbolHistoryRow> = {}): SymbolHistoryRow {
  return {
    symbol: sym,
    score,
    rank,
    qualificationStatus: "QUALIFIED",
    lifecycleState: "STILL_QUALIFIED",
    strategy: "stock_swing",
    marketRegime: "Bullish Momentum",
    scanTime: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    ...overrides,
  };
}

function makeRanking(overrides: Partial<OpportunityRankingResult> = {}): OpportunityRankingResult {
  return {
    generatedAt: "2026-08-08T00:00:00Z",
    snapshotId: "snap-1",
    regime: "Bullish Momentum",
    weights: { technical: 0.4, institutional: 0.2, fundamental: 0.15, risk: 0.15, regime: 0.1 },
    topGrowth: [
      makeCandidate("NVDA", { rank: 1 }),
      makeCandidate("AMD",  { rank: 2, opportunityScore: makeScore({ symbol: "AMD", overallScore: 72 }) }),
    ],
    topIncome: [
      makeCandidate("MSFT", { rank: 1, opportunityScore: makeScore({ symbol: "MSFT", category: "Income" as any, overallScore: 77 }) }),
    ],
    watchlist: [],
    approaching: [],
    changes: [
      { symbol: "NVDA", from: "New", to: "Top Growth", direction: "new" },
      { symbol: "AMD",  from: "Watch",    to: "Top Growth", direction: "upgraded" },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifyImportance
// ---------------------------------------------------------------------------

describe("classifyImportance", () => {
  it("new direction → Major", () => {
    expect(classifyImportance(null, null, "new")).toBe("Major");
  });
  it("removed direction → Major", () => {
    expect(classifyImportance(null, null, "removed")).toBe("Major");
  });
  it("|scoreDelta| >= 20 → Critical", () => {
    expect(classifyImportance(20, 0, "upgraded")).toBe("Critical");
    expect(classifyImportance(-25, 0, "downgraded")).toBe("Critical");
  });
  it("|rankDelta| >= 5 → Critical", () => {
    expect(classifyImportance(0, 5, "upgraded")).toBe("Critical");
  });
  it("|scoreDelta| >= 10 → Major", () => {
    expect(classifyImportance(10, 0, "upgraded")).toBe("Major");
    expect(classifyImportance(-12, 0, "downgraded")).toBe("Major");
  });
  it("|rankDelta| >= 3 → Major", () => {
    expect(classifyImportance(0, 3, "upgraded")).toBe("Major");
  });
  it("|scoreDelta| >= 5 → Moderate", () => {
    expect(classifyImportance(7, 0, "unchanged")).toBe("Moderate");
  });
  it("|rankDelta| >= 1 → Moderate", () => {
    expect(classifyImportance(0, 1, "unchanged")).toBe("Moderate");
  });
  it("small changes → Minor", () => {
    expect(classifyImportance(2, 0, "unchanged")).toBe("Minor");
    expect(classifyImportance(0, 0, "unchanged")).toBe("Minor");
  });
  it("null deltas + unchanged → Minor", () => {
    expect(classifyImportance(null, null, "unchanged")).toBe("Minor");
  });
});

// ---------------------------------------------------------------------------
// inferDrivers
// ---------------------------------------------------------------------------

describe("inferDrivers", () => {
  it("new entry → introduces new-entry driver", () => {
    const c = makeCandidate("NVDA");
    const drivers = inferDrivers(c, null, "new", null, "Bullish");
    expect(drivers[0]).toContain("entered the ranking");
  });

  it("removed → introduces removed driver", () => {
    const c = makeCandidate("NVDA");
    const drivers = inferDrivers(c, null, "removed", null, null);
    expect(drivers[0]).toContain("no longer in the ranking");
  });

  it("high technical + improving → breakout/technical driver", () => {
    const c = makeCandidate("NVDA", { opportunityScore: makeScore({ technicalScore: 82 }) });
    const drivers = inferDrivers(c, 10, "upgraded", null, null);
    expect(drivers.some(d => d.toLowerCase().includes("technical"))).toBe(true);
  });

  it("low technical + declining → weakened driver", () => {
    const c = makeCandidate("NVDA", { opportunityScore: makeScore({ technicalScore: 45 }) });
    const drivers = inferDrivers(c, -8, "downgraded", null, null);
    expect(drivers.some(d => d.toLowerCase().includes("pattern weakened") || d.toLowerCase().includes("no longer fully"))).toBe(true);
  });

  it("volume in whySelected → volume driver", () => {
    const c = makeCandidate("NVDA", {
      whySelected: ["Volume confirmed the breakout"],
      opportunityScore: makeScore({ technicalScore: 72 }),
    });
    const drivers = inferDrivers(c, 5, "upgraded", null, null);
    expect(drivers.some(d => d.toLowerCase().includes("volume"))).toBe(true);
  });

  it("high institutional + improving → institutional driver", () => {
    const c = makeCandidate("NVDA", { opportunityScore: makeScore({ institutionalScore: 75 }) });
    const drivers = inferDrivers(c, 5, "upgraded", null, null);
    expect(drivers.some(d => d.toLowerCase().includes("institutional"))).toBe(true);
  });

  it("regime change → regime driver", () => {
    const c = makeCandidate("NVDA");
    const drivers = inferDrivers(c, 5, "upgraded", "Neutral", "Bullish Momentum");
    expect(drivers.some(d => d.toLowerCase().includes("regime"))).toBe(true);
  });

  it("upgraded direction → promotion driver", () => {
    const c = makeCandidate("AMD", { opportunityScore: makeScore({ symbol: "AMD", category: "Top Growth" as any }) });
    const drivers = inferDrivers(c, 8, "upgraded", null, null);
    expect(drivers.some(d => d.toLowerCase().includes("promoted"))).toBe(true);
  });

  it("downgraded direction → demotion driver", () => {
    const c = makeCandidate("AMD", { opportunityScore: makeScore({ symbol: "AMD", category: "Watch" as any }) });
    const drivers = inferDrivers(c, -8, "downgraded", null, null);
    expect(drivers.some(d => d.toLowerCase().includes("demoted"))).toBe(true);
  });

  it("caps at 5 drivers", () => {
    const c = makeCandidate("NVDA", {
      whySelected: ["Volume confirmed", "Breakout near resistance", "Resistance breakout"],
      opportunityScore: makeScore({ technicalScore: 82, institutionalScore: 76, riskScore: 72, regimeScore: 75 }),
    });
    const drivers = inferDrivers(c, 15, "upgraded", "Neutral", "Bullish");
    expect(drivers.length).toBeLessThanOrEqual(5);
  });

  it("deduplicates identical drivers", () => {
    const c = makeCandidate("NVDA");
    const drivers = inferDrivers(c, 5, "unchanged", null, null);
    const unique = new Set(drivers);
    expect(unique.size).toBe(drivers.length);
  });
});

// ---------------------------------------------------------------------------
// inferWarnings
// ---------------------------------------------------------------------------

describe("inferWarnings", () => {
  it("removed → no warnings", () => {
    const c = makeCandidate("NVDA");
    expect(inferWarnings(c, "removed")).toHaveLength(0);
  });

  it("earnings in candidate warnings → earnings warning", () => {
    const c = makeCandidate("NVDA", {
      warnings: ["Earnings next week — binary risk elevated"],
      opportunityScore: makeScore({ warnings: [] }),
    });
    const w = inferWarnings(c, "upgraded");
    expect(w.some(x => x.toLowerCase().includes("earnings"))).toBe(true);
  });

  it("earnings in opportunityScore.warnings → earnings warning", () => {
    const c = makeCandidate("NVDA", {
      warnings: [],
      opportunityScore: makeScore({ warnings: ["Earnings this week"] }),
    });
    const w = inferWarnings(c, "upgraded");
    expect(w.some(x => x.toLowerCase().includes("earnings"))).toBe(true);
  });

  it("low riskScore → risk warning", () => {
    const c = makeCandidate("NVDA", { opportunityScore: makeScore({ riskScore: 35 }) });
    const w = inferWarnings(c, "unchanged");
    expect(w.some(x => x.toLowerCase().includes("risk score"))).toBe(true);
  });

  it("low confidence → confidence warning", () => {
    const c = makeCandidate("NVDA", { opportunityScore: makeScore({ confidence: "low" }) });
    const w = inferWarnings(c, "unchanged");
    expect(w.some(x => x.toLowerCase().includes("confidence"))).toBe(true);
  });

  it("caps at 3 warnings", () => {
    const c = makeCandidate("NVDA", {
      warnings: ["Earnings approaching", "Liquidity thin", "Gap risk detected"],
      opportunityScore: makeScore({ riskScore: 30, institutionalScore: 30, confidence: "low" }),
    });
    const w = inferWarnings(c, "unchanged");
    expect(w.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// buildSummary
// ---------------------------------------------------------------------------

describe("buildSummary", () => {
  it("new → entry sentence", () => {
    const s = buildSummary("NVDA", null, null, [], "new", "Major", "Top Growth");
    expect(s).toContain("entered the ranking");
    expect(s).toContain("Top Growth");
  });

  it("removed → removal sentence", () => {
    const s = buildSummary("NVDA", null, null, [], "removed", "Major", "Removed");
    expect(s).toContain("dropped out");
  });

  it("score increased + top driver → combined sentence", () => {
    const s = buildSummary("AMD", 12, 2, ["Technical breakout confirmed"], "upgraded", "Major", "Top Growth");
    expect(s).toContain("increased 12 points");
    expect(s.toLowerCase()).toContain("technical breakout confirmed");
  });

  it("score fell + top 2 drivers → combined sentence", () => {
    const s = buildSummary("AMD", -8, -1, ["Pattern weakened", "Volume softened"], "downgraded", "Moderate", "Watch");
    expect(s).toContain("fell 8 points");
    expect(s.toLowerCase()).toContain("pattern weakened");
    expect(s.toLowerCase()).toContain("volume softened");
  });

  it("no drivers → minimal sentence", () => {
    const s = buildSummary("AMD", 5, 0, [], "unchanged", "Minor", "Top Growth");
    expect(s).toContain("5 points");
  });

  it("zero delta + upgraded → promotion sentence", () => {
    const s = buildSummary("AMD", 0, 0, [], "upgraded", "Minor", "Top Growth");
    expect(s.toLowerCase()).toContain("promoted");
  });

  it("null delta + unchanged → remains sentence", () => {
    const s = buildSummary("AMD", null, null, [], "unchanged", "Minor", "Top Growth");
    expect(s).toContain("AMD");
  });
});

// ---------------------------------------------------------------------------
// classifyConfidence
// ---------------------------------------------------------------------------

describe("classifyConfidence", () => {
  it("no history → low", () => {
    const c = makeCandidate("NVDA");
    expect(classifyConfidence(c, false)).toBe("low");
  });

  it("high confidence + high score → high", () => {
    const c = makeCandidate("NVDA", { opportunityScore: makeScore({ confidence: "high", overallScore: 80 }) });
    expect(classifyConfidence(c, true)).toBe("high");
  });

  it("low confidence → low", () => {
    const c = makeCandidate("NVDA", { opportunityScore: makeScore({ confidence: "low" }) });
    expect(classifyConfidence(c, true)).toBe("low");
  });

  it("low overall score → low", () => {
    const c = makeCandidate("NVDA", { opportunityScore: makeScore({ overallScore: 45 }) });
    expect(classifyConfidence(c, true)).toBe("low");
  });

  it("medium conditions → medium", () => {
    const c = makeCandidate("NVDA", { opportunityScore: makeScore({ confidence: "medium", overallScore: 65 }) });
    expect(classifyConfidence(c, true)).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// explainSymbolChange
// ---------------------------------------------------------------------------

describe("explainSymbolChange", () => {
  it("new symbol with no history → direction=new, importance=Major", () => {
    const c = makeCandidate("NVDA");
    const change = { symbol: "NVDA", from: "New", to: "Top Growth", direction: "new" as const };
    const exp = explainSymbolChange(c, [], change, 1, "Bullish");
    expect(exp.direction).toBe("new");
    expect(exp.importance).toBe("Major");
    expect(exp.previousScore).toBeNull();
    expect(exp.currentScore).toBe(75);
    expect(exp.scoreDelta).toBeNull();
  });

  it("with history → computes score delta", () => {
    const c = makeCandidate("NVDA");
    const history = [
      makeHistoryRow("NVDA", 70, 2, 0),  // latest (index 0 = most recent)
      makeHistoryRow("NVDA", 60, 3, 1),  // previous
    ];
    const exp = explainSymbolChange(c, history, null, 1, "Bullish");
    // scoreDelta = currentScore (75) - previousScore (60) = 15
    expect(exp.previousScore).toBe(60);
    expect(exp.scoreDelta).toBe(15);
    expect(exp.importance).toBe("Major"); // abs(15) >= 10
  });

  it("rank delta computed correctly (lower rank number = better)", () => {
    const c = makeCandidate("NVDA");
    const history = [
      makeHistoryRow("NVDA", 70, 3, 0), // current in history
      makeHistoryRow("NVDA", 65, 5, 1), // previous rank was 5
    ];
    const exp = explainSymbolChange(c, history, null, 2, "Bullish");
    // rankDelta = previousRank - currentRank = 5 - 2 = 3
    expect(exp.rankDelta).toBe(3);
  });

  it("score unchanged → Moderate or Minor", () => {
    const c = makeCandidate("NVDA");
    const history = [
      makeHistoryRow("NVDA", 72, 1, 0),
      makeHistoryRow("NVDA", 71, 1, 1),
    ];
    const exp = explainSymbolChange(c, history, null, 1, "Bullish");
    // delta = 75 - 71 = 4 → Minor
    expect(["Minor", "Moderate"]).toContain(exp.importance);
  });

  it("summary is a non-empty string", () => {
    const c = makeCandidate("NVDA");
    const exp = explainSymbolChange(c, [], null, 1, null);
    expect(typeof exp.summary).toBe("string");
    expect(exp.summary.length).toBeGreaterThan(10);
  });

  it("drivers is a non-empty array", () => {
    const c = makeCandidate("NVDA");
    const exp = explainSymbolChange(c, [], { symbol: "NVDA", from: "New", to: "Top Growth", direction: "new" }, 1, null);
    expect(exp.drivers.length).toBeGreaterThan(0);
  });

  it("confidence=low when no history", () => {
    const c = makeCandidate("NVDA");
    const exp = explainSymbolChange(c, [], null, 1, null);
    expect(exp.confidence).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// explainRemovedSymbol
// ---------------------------------------------------------------------------

describe("explainRemovedSymbol", () => {
  it("direction is removed", () => {
    const history = [makeHistoryRow("PLTR", 65, 3, 1)];
    const exp = explainRemovedSymbol("PLTR", history, null);
    expect(exp.direction).toBe("removed");
  });

  it("currentScore is 0", () => {
    const exp = explainRemovedSymbol("PLTR", [], null);
    expect(exp.currentScore).toBe(0);
  });

  it("previousScore from history", () => {
    const history = [makeHistoryRow("PLTR", 62, 4, 1)];
    const exp = explainRemovedSymbol("PLTR", history, null);
    expect(exp.previousScore).toBe(62);
  });

  it("no history → null previousScore", () => {
    const exp = explainRemovedSymbol("PLTR", [], null);
    expect(exp.previousScore).toBeNull();
  });

  it("category is Removed", () => {
    const exp = explainRemovedSymbol("PLTR", [], null);
    expect(exp.category).toBe("Removed");
  });

  it("summary mentions removal", () => {
    const exp = explainRemovedSymbol("PLTR", [], null);
    expect(exp.summary.toLowerCase()).toContain("dropped out");
  });
});

// ---------------------------------------------------------------------------
// buildChangeIntelligenceReport
// ---------------------------------------------------------------------------

describe("buildChangeIntelligenceReport", () => {
  it("generatedAt is ISO string", () => {
    const ranking = makeRanking();
    const report  = buildChangeIntelligenceReport(ranking, new Map(), []);
    expect(() => new Date(report.generatedAt)).not.toThrow();
  });

  it("newEntries contains symbols with direction=new from ranking.changes", () => {
    const ranking = makeRanking();
    const historyMap = new Map<string, SymbolHistoryRow[]>();
    const report = buildChangeIntelligenceReport(ranking, historyMap, []);
    const nvda = report.newEntries.find(e => e.symbol === "NVDA");
    expect(nvda).toBeDefined();
    expect(nvda?.direction).toBe("new");
  });

  it("upgrades contains symbols with direction=upgraded", () => {
    const ranking = makeRanking();
    const report  = buildChangeIntelligenceReport(ranking, new Map(), []);
    const amd = report.upgrades.find(e => e.symbol === "AMD");
    expect(amd).toBeDefined();
    expect(amd?.direction).toBe("upgraded");
  });

  it("removed is populated with removed symbols", () => {
    const ranking = makeRanking();
    const historyMap = new Map([
      ["PLTR", [makeHistoryRow("PLTR", 65, 3, 1)]],
    ]);
    const report = buildChangeIntelligenceReport(ranking, historyMap, ["PLTR"]);
    expect(report.removed.length).toBe(1);
    expect(report.removed[0].symbol).toBe("PLTR");
    expect(report.removed[0].direction).toBe("removed");
  });

  it("majorMovers contains Major and Critical items only", () => {
    const ranking = makeRanking();
    const historyMap = new Map<string, SymbolHistoryRow[]>([
      ["NVDA", []],   // new → Major
      ["AMD",  [makeHistoryRow("AMD", 55, 5, 1), makeHistoryRow("AMD", 50, 6, 2)]],   // upgraded, big delta → at least Major
    ]);
    const report = buildChangeIntelligenceReport(ranking, historyMap, []);
    for (const m of report.majorMovers) {
      expect(["Major", "Critical"]).toContain(m.importance);
    }
  });

  it("downgrades contains symbols with direction=downgraded", () => {
    const ranking = makeRanking({
      changes: [
        { symbol: "NVDA", from: "Top Growth", to: "Watch", direction: "downgraded" },
      ],
    });
    const report = buildChangeIntelligenceReport(ranking, new Map(), []);
    const nvda = report.downgrades.find(e => e.symbol === "NVDA");
    expect(nvda?.direction).toBe("downgraded");
  });

  it("empty ranking → empty report", () => {
    const ranking = makeRanking({ topGrowth: [], topIncome: [], changes: [] });
    const report  = buildChangeIntelligenceReport(ranking, new Map(), []);
    expect(report.newEntries).toHaveLength(0);
    expect(report.upgrades).toHaveLength(0);
    expect(report.downgrades).toHaveLength(0);
    expect(report.majorMovers).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
  });

  it("all explanations have required fields", () => {
    const ranking = makeRanking();
    const report  = buildChangeIntelligenceReport(ranking, new Map(), []);
    const all = [...report.majorMovers, ...report.upgrades, ...report.downgrades, ...report.newEntries];
    for (const exp of all) {
      expect(exp).toHaveProperty("symbol");
      expect(exp).toHaveProperty("currentScore");
      expect(exp).toHaveProperty("importance");
      expect(exp).toHaveProperty("summary");
      expect(Array.isArray(exp.drivers)).toBe(true);
      expect(Array.isArray(exp.warnings)).toBe(true);
      expect(exp).toHaveProperty("confidence");
      expect(exp).toHaveProperty("direction");
    }
  });
});
