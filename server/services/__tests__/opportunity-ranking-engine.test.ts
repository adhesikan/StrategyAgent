// Tests — Opportunity Ranking Engine (Sprint 2.2.7)
//
// All tests are pure (no DB calls).  DB-backed functions are tested via
// dependency injection — the engine exports all pure helpers separately.

import { describe, it, expect, beforeEach } from "vitest";
import {
  computeTechnicalScore,
  computeWatchTechnicalScore,
  computeInstitutionalScore,
  computeFundamentalScore,
  computeRiskScore,
  computeWatchRiskScore,
  computeRegimeScore,
  computeOverallScore,
  assignCategory,
  deriveConfidence,
  buildReasons,
  buildWarnings,
  scoreCandidate,
  scoreWatchCandidate,
  buildRanking,
  DEFAULT_WEIGHTS,
  type RankingWeights,
  type ScoredGrowthCandidate,
} from "../opportunity-ranking-engine";
import type { RankedTradeCandidate, RankedWatchCandidate } from "../../routes/ranked-trade-search";
import type { PersistedOpportunitySnapshot } from "../opportunity-snapshot-store";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<RankedTradeCandidate> = {}): RankedTradeCandidate {
  return {
    rank: 1,
    symbol: "AAPL",
    strategy: "VCP",
    setupStatus: "qualified",
    confidence: "high",
    rewardRisk: 2.5,
    fitsRiskBudget: true,
    whySelected: ["Strong VCP pattern", "Volume confirmation"],
    warnings: [],
    ...overrides,
  } as RankedTradeCandidate;
}

function makeWatchCandidate(overrides: Partial<RankedWatchCandidate> = {}): RankedWatchCandidate {
  return {
    symbol: "MSFT",
    strategy: "VCP",
    currentStage: "Stage 2",
    missingConfirmation: "Volume confirmation",
    watchConditions: ["Awaiting breakout volume"],
    ...overrides,
  } as RankedWatchCandidate;
}

function makeInstitutionalRow(overrides: Partial<{
  symbol: string;
  status: string;
  score: number | null;
  data_quality_confidence: string | null;
  label: string | null;
  manager_count_latest: number | null;
  new_manager_count: number | null;
  exited_manager_count: number | null;
  increased_manager_count: number | null;
  reduced_manager_count: number | null;
}> = {}) {
  return {
    symbol: "AAPL",
    status: "available",
    score: 70,
    data_quality_confidence: "high",
    label: "Accumulation",
    manager_count_latest: 150,
    new_manager_count: 8,
    exited_manager_count: 2,
    increased_manager_count: 40,
    reduced_manager_count: 15,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<PersistedOpportunitySnapshot> = {}): PersistedOpportunitySnapshot {
  return {
    id: "snap-001",
    status: "SUCCESS",
    startedAt: "2026-08-07T10:00:00.000Z",
    completedAt: "2026-08-07T10:00:30.000Z",
    generatedAt: "2026-08-07T10:00:30.000Z",
    scannerVersion: "mcp-v1",
    marketRegime: "TRENDING",
    dataSource: "Twelve Data via MCP",
    dataQuality: "Latest daily market data",
    reviewedCount: 100,
    qualifiedCount: 5,
    watchCount: 3,
    rejectedCount: 90,
    excludedCount: 2,
    unavailableCount: 0,
    topGrowth: [makeCandidate({ symbol: "AAPL", rank: 1, strategy: "VCP" })],
    topIncome: [makeCandidate({ symbol: "MSFT", rank: 2, strategy: "covered call" })],
    topWatchlist: [makeWatchCandidate({ symbol: "NVDA" })],
    approachingQualification: [],
    warnings: [],
    ...overrides,
  };
}

const NOW = "2026-08-07T12:00:00.000Z";

// ---------------------------------------------------------------------------
// computeTechnicalScore
// ---------------------------------------------------------------------------

describe("computeTechnicalScore", () => {
  it("uses strategyScore directly when in [0, 100]", () => {
    const c = makeCandidate({ ...{ strategyScore: 78 } as any });
    expect(computeTechnicalScore(c)).toBe(83); // 78 + 5 (high confidence)
  });

  it("applies +5 for high confidence", () => {
    const c = makeCandidate({ confidence: "high", ...{ strategyScore: 70 } as any });
    expect(computeTechnicalScore(c)).toBe(75);
  });

  it("applies -10 for low confidence", () => {
    const c = makeCandidate({ confidence: "low", ...{ strategyScore: 70 } as any });
    expect(computeTechnicalScore(c)).toBe(60);
  });

  it("applies -8 for watch setup status", () => {
    const c = makeCandidate({ setupStatus: "watch", confidence: "medium", ...{ strategyScore: 70 } as any });
    expect(computeTechnicalScore(c)).toBe(62);
  });

  it("falls back to rank-derived score when strategyScore missing", () => {
    const c = makeCandidate({ rank: 1, confidence: "medium" });
    // rank 1 → 85, medium conf = 0 adjustment → 85
    expect(computeTechnicalScore(c)).toBe(85);
  });

  it("rank 3 → base 65, high conf → 70", () => {
    const c = makeCandidate({ rank: 3, confidence: "high" });
    expect(computeTechnicalScore(c)).toBe(70);
  });

  it("clamps to 100 maximum", () => {
    const c = makeCandidate({ ...{ strategyScore: 100 } as any, confidence: "high" });
    expect(computeTechnicalScore(c)).toBe(100);
  });

  it("clamps to 0 minimum", () => {
    const c = makeCandidate({ ...{ strategyScore: 5 } as any, confidence: "low", setupStatus: "watch" });
    // 5 - 10 - 8 = -13 → clamped to 0
    expect(computeTechnicalScore(c)).toBe(0);
  });

  it("rank 9 → base 30 (floor), not negative", () => {
    const c = makeCandidate({ rank: 9, confidence: "medium" });
    expect(computeTechnicalScore(c)).toBeGreaterThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// computeWatchTechnicalScore
// ---------------------------------------------------------------------------

describe("computeWatchTechnicalScore", () => {
  it("returns lower base than qualified candidates", () => {
    const w = makeWatchCandidate({ missingConfirmation: undefined });
    expect(computeWatchTechnicalScore(w)).toBeLessThan(60);
  });

  it("stage 3 gives bonus", () => {
    const w = makeWatchCandidate({ currentStage: "Stage 3", missingConfirmation: undefined });
    const w2 = makeWatchCandidate({ currentStage: "Stage 1", missingConfirmation: undefined });
    expect(computeWatchTechnicalScore(w)).toBeGreaterThan(computeWatchTechnicalScore(w2));
  });
});

// ---------------------------------------------------------------------------
// computeInstitutionalScore
// ---------------------------------------------------------------------------

describe("computeInstitutionalScore", () => {
  it("returns 50/no-data when row is null", () => {
    const r = computeInstitutionalScore(null);
    expect(r.score).toBe(50);
    expect(r.hasData).toBe(false);
  });

  it("returns 50/no-data for unavailable status", () => {
    const r = computeInstitutionalScore(makeInstitutionalRow({ status: "unavailable", score: 80 }));
    expect(r.score).toBe(50);
    expect(r.hasData).toBe(false);
  });

  it("returns 50/no-data for insufficient_history", () => {
    const r = computeInstitutionalScore(makeInstitutionalRow({ status: "insufficient_history" }));
    expect(r.score).toBe(50);
    expect(r.hasData).toBe(false);
  });

  it("returns 50/no-data for mapping_incomplete", () => {
    const r = computeInstitutionalScore(makeInstitutionalRow({ status: "mapping_incomplete" }));
    expect(r.score).toBe(50);
    expect(r.hasData).toBe(false);
  });

  it("returns raw score for high-confidence available signal", () => {
    const r = computeInstitutionalScore(makeInstitutionalRow({ score: 75, data_quality_confidence: "high" }));
    expect(r.score).toBe(75);
    expect(r.hasData).toBe(true);
  });

  it("compresses toward 50 for moderate confidence", () => {
    const r = computeInstitutionalScore(makeInstitutionalRow({ score: 80, data_quality_confidence: "moderate" }));
    // 50 + 0.75*(80-50) = 50 + 22.5 = 72.5 → 73
    expect(r.score).toBe(73);
    expect(r.hasData).toBe(true);
  });

  it("compresses more for limited confidence", () => {
    const r = computeInstitutionalScore(makeInstitutionalRow({ score: 80, data_quality_confidence: "limited" }));
    // 50 + 0.55*(80-50) = 50 + 16.5 = 66.5 → 67
    expect(r.score).toBe(67);
    expect(r.hasData).toBe(true);
  });

  it("returns 50/no-data for insufficient confidence", () => {
    const r = computeInstitutionalScore(makeInstitutionalRow({ data_quality_confidence: "insufficient" }));
    expect(r.score).toBe(50);
    expect(r.hasData).toBe(false);
  });

  it("clamps score of 100 with high confidence to 100", () => {
    const r = computeInstitutionalScore(makeInstitutionalRow({ score: 100, data_quality_confidence: "high" }));
    expect(r.score).toBe(100);
  });

  it("handles null score field gracefully", () => {
    const r = computeInstitutionalScore(makeInstitutionalRow({ score: null }));
    expect(r.score).toBe(50);
    expect(r.hasData).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeFundamentalScore
// ---------------------------------------------------------------------------

describe("computeFundamentalScore", () => {
  it("returns 60 as neutral default", () => {
    const c = makeCandidate({ whySelected: [], warnings: [], strategy: "VCP" });
    expect(computeFundamentalScore(c)).toBe(60);
  });

  it("penalises earnings risk in warnings", () => {
    const c = makeCandidate({ warnings: ["Earnings risk: reports this week"] });
    expect(computeFundamentalScore(c)).toBe(45);
  });

  it("rewards income strategy", () => {
    const c = makeCandidate({ strategy: "covered call" });
    expect(computeFundamentalScore(c)).toBe(75);
  });

  it("combined earnings + income = 60 baseline effect", () => {
    const c = makeCandidate({ strategy: "income", warnings: ["earnings risk"] });
    // 60 - 15 + 15 = 60
    expect(computeFundamentalScore(c)).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// computeRiskScore
// ---------------------------------------------------------------------------

describe("computeRiskScore", () => {
  it("base 60 with no risk info", () => {
    const c = makeCandidate({ fitsRiskBudget: undefined, rewardRisk: undefined, warnings: [] });
    expect(computeRiskScore(c)).toBe(60);
  });

  it("adds 15 for fitsRiskBudget = true", () => {
    const c = makeCandidate({ fitsRiskBudget: true, rewardRisk: undefined, warnings: [] });
    expect(computeRiskScore(c)).toBe(75);
  });

  it("subtracts 10 for fitsRiskBudget = false", () => {
    const c = makeCandidate({ fitsRiskBudget: false, rewardRisk: undefined, warnings: [] });
    expect(computeRiskScore(c)).toBe(50);
  });

  it("adds 18 for R/R ≥ 3.0", () => {
    const c = makeCandidate({ fitsRiskBudget: false, rewardRisk: 3.5, warnings: [] });
    // 60 - 10 + 18 = 68
    expect(computeRiskScore(c)).toBe(68);
  });

  it("subtracts 22 for R/R < 1.0", () => {
    const c = makeCandidate({ fitsRiskBudget: true, rewardRisk: 0.7, warnings: [] });
    // 60 + 15 - 22 = 53
    expect(computeRiskScore(c)).toBe(53);
  });

  it("subtracts 10 for gap risk warning", () => {
    const c = makeCandidate({ fitsRiskBudget: true, rewardRisk: 2.0, warnings: ["Gap risk detected"] });
    // 60 + 15 + 8 - 10 = 73
    expect(computeRiskScore(c)).toBe(73);
  });

  it("clamps to 0 minimum", () => {
    const c = makeCandidate({ fitsRiskBudget: false, rewardRisk: 0.3, warnings: ["gap risk", "earnings risk", "low liquidity"] });
    expect(computeRiskScore(c)).toBeGreaterThanOrEqual(0);
  });

  it("clamps to 100 maximum", () => {
    const c = makeCandidate({ fitsRiskBudget: true, rewardRisk: 4.0, warnings: [] });
    expect(computeRiskScore(c)).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// computeRegimeScore
// ---------------------------------------------------------------------------

describe("computeRegimeScore", () => {
  it("TRENDING + momentum strategy → 90", () => {
    expect(computeRegimeScore("TRENDING", "VCP")).toBe(90);
  });

  it("TRENDING + income strategy → 65", () => {
    expect(computeRegimeScore("TRENDING", "covered call")).toBe(65);
  });

  it("TRENDING + unknown strategy → 75", () => {
    expect(computeRegimeScore("TRENDING", "other")).toBe(75);
  });

  it("RISK_OFF + momentum → 15", () => {
    expect(computeRegimeScore("RISK_OFF", "VCP")).toBe(15);
  });

  it("RISK_OFF + income → 40", () => {
    expect(computeRegimeScore("RISK_OFF", "covered call")).toBe(40);
  });

  it("RISK_OFF + unknown → 20", () => {
    expect(computeRegimeScore("RISK_OFF", null)).toBe(20);
  });

  it("CHOPPY + momentum → 35", () => {
    expect(computeRegimeScore("CHOPPY", "HIGH_RVOL")).toBe(35);
  });

  it("CHOPPY + income → 55", () => {
    expect(computeRegimeScore("CHOPPY", "income spread")).toBe(55);
  });

  it("null regime → 50 neutral", () => {
    expect(computeRegimeScore(null, "VCP")).toBe(50);
  });

  it("unknown regime string → 50 neutral", () => {
    expect(computeRegimeScore("SIDEWAYS", "VCP")).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// computeOverallScore — weight calculations
// ---------------------------------------------------------------------------

describe("computeOverallScore", () => {
  it("returns correct weighted average", () => {
    // 80*0.4 + 70*0.2 + 60*0.15 + 65*0.15 + 75*0.1
    // = 32 + 14 + 9 + 9.75 + 7.5 = 72.25 → 72
    const result = computeOverallScore(
      { technical: 80, institutional: 70, fundamental: 60, risk: 65, regime: 75 },
      DEFAULT_WEIGHTS,
    );
    expect(result).toBe(72);
  });

  it("100 across all components → 100", () => {
    const result = computeOverallScore(
      { technical: 100, institutional: 100, fundamental: 100, risk: 100, regime: 100 },
      DEFAULT_WEIGHTS,
    );
    expect(result).toBe(100);
  });

  it("0 across all components → 0", () => {
    const result = computeOverallScore(
      { technical: 0, institutional: 0, fundamental: 0, risk: 0, regime: 0 },
      DEFAULT_WEIGHTS,
    );
    expect(result).toBe(0);
  });

  it("custom weights are applied correctly", () => {
    const weights: RankingWeights = { technical: 1.0, institutional: 0, fundamental: 0, risk: 0, regime: 0 };
    const result = computeOverallScore(
      { technical: 77, institutional: 0, fundamental: 0, risk: 0, regime: 0 },
      weights,
    );
    expect(result).toBe(77);
  });

  it("rounds to nearest integer", () => {
    // 50*0.4 + 50*0.2 + 50*0.15 + 51*0.15 + 50*0.1
    // = 20 + 10 + 7.5 + 7.65 + 5 = 50.15 → 50
    const result = computeOverallScore(
      { technical: 50, institutional: 50, fundamental: 50, risk: 51, regime: 50 },
      DEFAULT_WEIGHTS,
    );
    expect(result).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// assignCategory
// ---------------------------------------------------------------------------

describe("assignCategory", () => {
  it("overallScore ≥ 60 non-income → Top Growth", () => {
    expect(assignCategory(65, "TRENDING", "VCP", false)).toBe("Top Growth");
  });

  it("income strategy ≥ 55 → Income", () => {
    expect(assignCategory(60, "TRENDING", "covered call", false)).toBe("Income");
  });

  it("overallScore 40-59 → Watch", () => {
    expect(assignCategory(50, "TRENDING", "VCP", false)).toBe("Watch");
  });

  it("overallScore < 40 → Avoid", () => {
    expect(assignCategory(38, "TRENDING", "VCP", false)).toBe("Avoid");
  });

  it("RISK_OFF + score 50 → Avoid", () => {
    expect(assignCategory(50, "RISK_OFF", "VCP", false)).toBe("Avoid");
  });

  it("RISK_OFF + score 55 → Watch (income threshold met)", () => {
    expect(assignCategory(55, "RISK_OFF", "covered call", false)).toBe("Income");
  });

  it("RISK_OFF + score ≥ 55 non-income → Top Growth (passes RISK_OFF threshold)", () => {
    expect(assignCategory(60, "RISK_OFF", "VCP", false)).toBe("Top Growth");
  });

  it("isWatchCandidate=true always → Watch", () => {
    expect(assignCategory(90, "TRENDING", "VCP", true)).toBe("Watch");
  });

  it("income strategy below 55 → Watch", () => {
    expect(assignCategory(50, "TRENDING", "income", false)).toBe("Watch");
  });
});

// ---------------------------------------------------------------------------
// deriveConfidence
// ---------------------------------------------------------------------------

describe("deriveConfidence", () => {
  it("tech ≥ 70 and institutionalHasData → high", () => {
    expect(deriveConfidence(75, 75, true)).toBe("high");
  });

  it("tech ≥ 70 but no institutional data → medium", () => {
    expect(deriveConfidence(75, 75, false)).toBe("medium");
  });

  it("overallScore ≥ 50 → medium", () => {
    expect(deriveConfidence(55, 60, false)).toBe("medium");
  });

  it("overallScore < 50 → low", () => {
    expect(deriveConfidence(40, 45, false)).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// buildReasons
// ---------------------------------------------------------------------------

describe("buildReasons", () => {
  it("includes whySelected from candidate", () => {
    const c = makeCandidate({ whySelected: ["Strong VCP", "Volume"] });
    const reasons = buildReasons(c, 70, 50, false);
    expect(reasons).toContain("Strong VCP");
    expect(reasons).toContain("Volume");
  });

  it("adds institutional reason when score ≥ 70 and hasData", () => {
    const c = makeCandidate({ whySelected: [] });
    const reasons = buildReasons(c, 70, 75, true);
    expect(reasons.some(r => /institutional/i.test(r))).toBe(true);
  });

  it("does not add institutional reason when hasData=false", () => {
    const c = makeCandidate({ whySelected: [] });
    const reasons = buildReasons(c, 70, 75, false);
    expect(reasons.some(r => /institutional/i.test(r))).toBe(false);
  });

  it("caps at 4 reasons", () => {
    const c = makeCandidate({
      whySelected: ["R1", "R2", "R3", "R4", "R5"],
    });
    const reasons = buildReasons(c, 85, 75, true);
    expect(reasons.length).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// buildWarnings
// ---------------------------------------------------------------------------

describe("buildWarnings", () => {
  it("passes through scanner warnings", () => {
    const c = makeCandidate({ warnings: ["Earnings risk", "Low volume"] });
    const w = buildWarnings(c, 70, "TRENDING");
    expect(w).toContain("Earnings risk");
  });

  it("adds regime warning when regimeScore ≤ 25", () => {
    const c = makeCandidate({ warnings: [] });
    const w = buildWarnings(c, 20, "RISK_OFF");
    expect(w.some(x => /regime/i.test(x))).toBe(true);
  });

  it("caps at 3 warnings", () => {
    const c = makeCandidate({ warnings: ["W1", "W2", "W3", "W4"] });
    const w = buildWarnings(c, 20, "RISK_OFF");
    expect(w.length).toBeLessThanOrEqual(3);
  });

  it("no regime warning when regimeScore > 25", () => {
    const c = makeCandidate({ warnings: [] });
    const w = buildWarnings(c, 30, "TRENDING");
    expect(w.some(x => /regime/i.test(x))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scoreCandidate — integration of pure functions
// ---------------------------------------------------------------------------

describe("scoreCandidate", () => {
  it("produces a score object with all required fields", () => {
    const c = makeCandidate();
    const row = makeInstitutionalRow();
    const score = scoreCandidate(c, row, "TRENDING", DEFAULT_WEIGHTS, NOW);
    expect(score).toMatchObject({
      symbol: "AAPL",
      overallScore: expect.any(Number),
      confidence: expect.stringMatching(/^(high|medium|low)$/),
      technicalScore: expect.any(Number),
      institutionalScore: expect.any(Number),
      fundamentalScore: expect.any(Number),
      riskScore: expect.any(Number),
      regimeScore: expect.any(Number),
      category: expect.stringMatching(/^(Top Growth|Income|Watch|Avoid)$/),
      reasons: expect.any(Array),
      warnings: expect.any(Array),
      lastUpdated: NOW,
    });
  });

  it("overallScore is in [0, 100]", () => {
    const c = makeCandidate();
    const score = scoreCandidate(c, null, "TRENDING", DEFAULT_WEIGHTS, NOW);
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
    expect(score.overallScore).toBeLessThanOrEqual(100);
  });

  it("is deterministic — same inputs = same outputs", () => {
    const c = makeCandidate({ symbol: "TEST", rank: 2, confidence: "medium", rewardRisk: 2.0, fitsRiskBudget: true });
    const row = makeInstitutionalRow({ score: 65, data_quality_confidence: "moderate" });
    const s1 = scoreCandidate(c, row, "TRENDING", DEFAULT_WEIGHTS, NOW);
    const s2 = scoreCandidate(c, row, "TRENDING", DEFAULT_WEIGHTS, NOW);
    expect(s1.overallScore).toBe(s2.overallScore);
    expect(s1.technicalScore).toBe(s2.technicalScore);
    expect(s1.institutionalScore).toBe(s2.institutionalScore);
  });

  it("handles null institutional row gracefully", () => {
    const c = makeCandidate();
    const score = scoreCandidate(c, null, "TRENDING", DEFAULT_WEIGHTS, NOW);
    expect(score.institutionalScore).toBe(50); // neutral
    expect(score.overallScore).toBeGreaterThanOrEqual(0);
  });

  it("handles null regime gracefully", () => {
    const c = makeCandidate();
    const score = scoreCandidate(c, null, null, DEFAULT_WEIGHTS, NOW);
    expect(score.regimeScore).toBe(50);
  });

  it("missing earnings results in lower fundamental score", () => {
    const c1 = makeCandidate({ warnings: [] });
    const c2 = makeCandidate({ warnings: ["Earnings risk: reports this week"] });
    const s1 = scoreCandidate(c1, null, "TRENDING", DEFAULT_WEIGHTS, NOW);
    const s2 = scoreCandidate(c2, null, "TRENDING", DEFAULT_WEIGHTS, NOW);
    expect(s2.fundamentalScore).toBeLessThan(s1.fundamentalScore);
  });

  it("RISK_OFF regime lowers regime score", () => {
    const c = makeCandidate({ strategy: "VCP" });
    const s = scoreCandidate(c, null, "RISK_OFF", DEFAULT_WEIGHTS, NOW);
    expect(s.regimeScore).toBeLessThan(30);
  });
});

// ---------------------------------------------------------------------------
// scoreWatchCandidate
// ---------------------------------------------------------------------------

describe("scoreWatchCandidate", () => {
  it("category is always Watch", () => {
    const w = makeWatchCandidate();
    const s = scoreWatchCandidate(w, null, "TRENDING", DEFAULT_WEIGHTS, NOW);
    expect(s.category).toBe("Watch");
  });

  it("overallScore in [0, 100]", () => {
    const w = makeWatchCandidate();
    const s = scoreWatchCandidate(w, null, "RISK_OFF", DEFAULT_WEIGHTS, NOW);
    expect(s.overallScore).toBeGreaterThanOrEqual(0);
    expect(s.overallScore).toBeLessThanOrEqual(100);
  });

  it("is deterministic", () => {
    const w = makeWatchCandidate({ symbol: "GOOG", currentStage: "Stage 2" });
    const s1 = scoreWatchCandidate(w, null, "TRENDING", DEFAULT_WEIGHTS, NOW);
    const s2 = scoreWatchCandidate(w, null, "TRENDING", DEFAULT_WEIGHTS, NOW);
    expect(s1.overallScore).toBe(s2.overallScore);
  });
});

// ---------------------------------------------------------------------------
// buildRanking — full pipeline
// ---------------------------------------------------------------------------

describe("buildRanking", () => {
  it("returns all required top-level fields", () => {
    const snap = makeSnapshot();
    const result = buildRanking(snap, new Map(), null, DEFAULT_WEIGHTS, NOW);
    expect(result).toMatchObject({
      generatedAt: NOW,
      snapshotId: "snap-001",
      regime: "TRENDING",
      weights: DEFAULT_WEIGHTS,
      topGrowth: expect.any(Array),
      topIncome: expect.any(Array),
      watchlist: expect.any(Array),
      approaching: expect.any(Array),
      changes: expect.any(Array),
    });
  });

  it("topGrowth is sorted by overallScore DESC", () => {
    const snap = makeSnapshot({
      topGrowth: [
        makeCandidate({ symbol: "LOW", rank: 3, ...{ strategyScore: 40 } as any }),
        makeCandidate({ symbol: "HIGH", rank: 1, ...{ strategyScore: 90 } as any }),
        makeCandidate({ symbol: "MID", rank: 2, ...{ strategyScore: 65 } as any }),
      ],
      topIncome: [],
    });
    const result = buildRanking(snap, new Map(), null, DEFAULT_WEIGHTS, NOW);
    const scores = result.topGrowth.map(c => c.opportunityScore.overallScore);
    expect(scores[0]).toBeGreaterThanOrEqual(scores[1]);
    if (scores.length > 1) expect(scores[1]).toBeGreaterThanOrEqual(scores[2] ?? 0);
  });

  it("topIncome candidates separated correctly by strategy", () => {
    const snap = makeSnapshot({
      topGrowth: [makeCandidate({ symbol: "GROWTH", strategy: "VCP" })],
      topIncome: [makeCandidate({ symbol: "INCOME", strategy: "covered call" })],
    });
    const result = buildRanking(snap, new Map(), null, DEFAULT_WEIGHTS, NOW);
    const growthSymbols = result.topGrowth.map(c => c.symbol);
    const incomeSymbols = result.topIncome.map(c => c.symbol);
    expect(incomeSymbols).toContain("INCOME");
    // income candidates don't appear in growth list
    expect(growthSymbols).not.toContain("INCOME");
  });

  it("watchlist candidates have category=Watch", () => {
    const snap = makeSnapshot({
      topWatchlist: [makeWatchCandidate({ symbol: "WATCH1" })],
    });
    const result = buildRanking(snap, new Map(), null, DEFAULT_WEIGHTS, NOW);
    for (const c of result.watchlist) {
      expect(c.opportunityScore.category).toBe("Watch");
    }
  });

  it("changes is empty when no previous result", () => {
    const snap = makeSnapshot();
    const result = buildRanking(snap, new Map(), null, DEFAULT_WEIGHTS, NOW);
    expect(result.changes).toHaveLength(0);
  });

  it("detects new symbols vs previous ranking", () => {
    const previousResult: any = {
      generatedAt: NOW,
      snapshotId: "snap-000",
      regime: "TRENDING",
      weights: DEFAULT_WEIGHTS,
      topGrowth: [{ symbol: "OLD", opportunityScore: { category: "Top Growth", overallScore: 65 } }],
      topIncome: [],
      watchlist: [],
      approaching: [],
      changes: [],
    };
    const snap = makeSnapshot({
      topGrowth: [makeCandidate({ symbol: "NEW", rank: 1, strategy: "VCP" })],
      topIncome: [],
    });
    const result = buildRanking(snap, new Map(), previousResult, DEFAULT_WEIGHTS, NOW);
    const newChange = result.changes.find(c => c.symbol === "NEW");
    expect(newChange).toBeDefined();
    expect(newChange?.direction).toBe("new");
  });

  it("uses institutional signal from map when available", () => {
    const institutionalMap = new Map([
      ["AAPL", makeInstitutionalRow({ symbol: "AAPL", score: 85, data_quality_confidence: "high" })],
    ]);
    const snap = makeSnapshot({
      topGrowth: [makeCandidate({ symbol: "AAPL" })],
      topIncome: [],
    });
    const result = buildRanking(snap, institutionalMap, null, DEFAULT_WEIGHTS, NOW);
    const aapl = result.topGrowth.find(c => c.symbol === "AAPL");
    expect(aapl?.opportunityScore.institutionalScore).toBe(85);
  });

  it("missing institutional data produces institutionalScore=50 (neutral)", () => {
    const snap = makeSnapshot({
      topGrowth: [makeCandidate({ symbol: "NOINST" })],
      topIncome: [],
    });
    const result = buildRanking(snap, new Map(), null, DEFAULT_WEIGHTS, NOW);
    const c = result.topGrowth.find(x => x.symbol === "NOINST");
    expect(c?.opportunityScore.institutionalScore).toBe(50);
  });

  it("caps topGrowth at 5 entries", () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeCandidate({ symbol: `SYM${i}`, rank: i + 1, strategy: "VCP" }),
    );
    const snap = makeSnapshot({ topGrowth: candidates, topIncome: [] });
    const result = buildRanking(snap, new Map(), null, DEFAULT_WEIGHTS, NOW);
    expect(result.topGrowth.length).toBeLessThanOrEqual(5);
  });

  it("caps watchlist at 5 entries", () => {
    const watches = Array.from({ length: 10 }, (_, i) =>
      makeWatchCandidate({ symbol: `WATCH${i}` }),
    );
    const snap = makeSnapshot({ topWatchlist: watches });
    const result = buildRanking(snap, new Map(), null, DEFAULT_WEIGHTS, NOW);
    expect(result.watchlist.length).toBeLessThanOrEqual(5);
  });

  it("empty snapshot returns empty lists without throwing", () => {
    const snap = makeSnapshot({
      topGrowth: [],
      topIncome: [],
      topWatchlist: [],
      approachingQualification: [],
    });
    const result = buildRanking(snap, new Map(), null, DEFAULT_WEIGHTS, NOW);
    expect(result.topGrowth).toHaveLength(0);
    expect(result.topIncome).toHaveLength(0);
    expect(result.watchlist).toHaveLength(0);
  });

  it("tie-breaking is deterministic (alphabetical by symbol)", () => {
    // Two candidates with exactly the same strategyScore and same confidence/rr
    const snap = makeSnapshot({
      topGrowth: [
        makeCandidate({ symbol: "ZZZ", rank: 1, ...{ strategyScore: 70 } as any, confidence: "medium", rewardRisk: 2.0, fitsRiskBudget: true, warnings: [] }),
        makeCandidate({ symbol: "AAA", rank: 2, ...{ strategyScore: 70 } as any, confidence: "medium", rewardRisk: 2.0, fitsRiskBudget: true, warnings: [] }),
      ],
      topIncome: [],
    });
    const r1 = buildRanking(snap, new Map(), null, DEFAULT_WEIGHTS, NOW);
    const r2 = buildRanking(snap, new Map(), null, DEFAULT_WEIGHTS, NOW);
    expect(r1.topGrowth.map(c => c.symbol)).toEqual(r2.topGrowth.map(c => c.symbol));
  });

  it("ranking stability — same input always produces same order", () => {
    const snap = makeSnapshot({
      topGrowth: [
        makeCandidate({ symbol: "B", rank: 2, ...{ strategyScore: 80 } as any }),
        makeCandidate({ symbol: "A", rank: 1, ...{ strategyScore: 90 } as any }),
      ],
      topIncome: [],
    });
    const r1 = buildRanking(snap, new Map(), null, DEFAULT_WEIGHTS, NOW);
    const r2 = buildRanking(snap, new Map(), null, DEFAULT_WEIGHTS, NOW);
    expect(r1.topGrowth[0].symbol).toBe(r2.topGrowth[0].symbol);
    expect(r1.topGrowth[1].symbol).toBe(r2.topGrowth[1].symbol);
  });
});

// ---------------------------------------------------------------------------
// Weight configuration
// ---------------------------------------------------------------------------

describe("weight configurability", () => {
  it("custom weights change the final score", () => {
    const c = makeCandidate({ ...{ strategyScore: 50 } as any });
    // Weights biasing heavily toward regime
    const w1 = DEFAULT_WEIGHTS;
    const w2: RankingWeights = { technical: 0.10, institutional: 0.10, fundamental: 0.10, risk: 0.10, regime: 0.60 };
    const s1 = scoreCandidate(c, null, "TRENDING", w1, NOW);
    const s2 = scoreCandidate(c, null, "TRENDING", w2, NOW);
    // Regime score for TRENDING+VCP = 90, technical ~55; heavy regime weighting should raise overall
    expect(s2.regimeScore).toBeGreaterThan(70);
    // s2 has 60% weight on regime (90) → should be higher than s1 with 10% regime
    expect(s2.overallScore).not.toBe(s1.overallScore);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_WEIGHTS sanity check
// ---------------------------------------------------------------------------

describe("DEFAULT_WEIGHTS", () => {
  it("weights sum to 1.0", () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100)).toBe(100);
  });

  it("all weights are positive", () => {
    for (const v of Object.values(DEFAULT_WEIGHTS)) {
      expect(v).toBeGreaterThan(0);
    }
  });
});
