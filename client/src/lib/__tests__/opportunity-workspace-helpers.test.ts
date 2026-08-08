// Tests for opportunity-workspace-helpers.ts — Sprint 2.3.0
// Pure-function tests; no DOM, no React, no network.

import { describe, it, expect } from "vitest";
import {
  getScoreColor,
  getScoreBarBg,
  getConfidenceBadge,
  getCategoryBadge,
  buildRankedExplanation,
  buildRiskExplanation,
  findRelated,
  analyzeHistoryTrend,
  getAllRankedSymbols,
  findScoredCandidate,
  type OpportunityScore,
  type ScoredCandidate,
  type OpportunityRanking,
  type HistoryEntry,
} from "../opportunity-workspace-helpers";

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

function makeCandidate(sym: string, overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    rank: 1,
    symbol: sym,
    strategy: "stock_swing",
    rewardRisk: 3.5,
    maxRisk: 250,
    whySelected: ["Breakout pattern"],
    warnings: [],
    opportunityScore: makeScore({ symbol: sym }),
    ...overrides,
  };
}

function makeRanking(extra: Partial<OpportunityRanking> = {}): OpportunityRanking {
  return {
    generatedAt: "2026-08-08T00:00:00Z",
    snapshotId: "snap-1",
    regime: "Bullish Momentum",
    weights: { technical: 0.4, institutional: 0.2 },
    topGrowth: [
      makeCandidate("NVDA", { rank: 1, opportunityScore: makeScore({ symbol: "NVDA", category: "Top Growth", overallScore: 85 }) }),
      makeCandidate("AMD",  { rank: 2, opportunityScore: makeScore({ symbol: "AMD",  category: "Top Growth", overallScore: 72 }) }),
      makeCandidate("AAPL", { rank: 3, strategy: "covered_call", opportunityScore: makeScore({ symbol: "AAPL", category: "Top Growth", overallScore: 66 }) }),
    ],
    topIncome: [
      makeCandidate("MSFT", { rank: 1, strategy: "covered_call", opportunityScore: makeScore({ symbol: "MSFT", category: "Income", overallScore: 77 }) }),
    ],
    watchlist: [],
    approaching: [],
    changes: [],
    ...extra,
  };
}

function makeHistory(scores: number[]): HistoryEntry[] {
  return scores.map((score, i) => ({
    id: `h-${i}`,
    snapshotId: `snap-${i}`,
    scanTime: new Date(Date.now() - i * 86400000).toISOString(),
    rank: i + 1,
    score,
    qualificationStatus: "QUALIFIED",
    lifecycleState: "STILL_QUALIFIED",
    strategy: "stock_swing",
    marketRegime: "bullish",
    createdAt: new Date(Date.now() - i * 86400000).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// getScoreColor
// ---------------------------------------------------------------------------

describe("getScoreColor", () => {
  it("returns emerald for score >= 80", () => {
    expect(getScoreColor(80)).toContain("emerald");
    expect(getScoreColor(95)).toContain("emerald");
  });
  it("returns sky for score in [60, 79]", () => {
    expect(getScoreColor(60)).toContain("sky");
    expect(getScoreColor(79)).toContain("sky");
  });
  it("returns amber for score in [40, 59]", () => {
    expect(getScoreColor(40)).toContain("amber");
    expect(getScoreColor(59)).toContain("amber");
  });
  it("returns rose for score < 40", () => {
    expect(getScoreColor(0)).toContain("rose");
    expect(getScoreColor(39)).toContain("rose");
  });
});

// ---------------------------------------------------------------------------
// getScoreBarBg
// ---------------------------------------------------------------------------

describe("getScoreBarBg", () => {
  it("returns emerald-500 for >= 80", () => {
    expect(getScoreBarBg(80)).toBe("bg-emerald-500");
  });
  it("returns sky-500 for >= 60", () => {
    expect(getScoreBarBg(65)).toBe("bg-sky-500");
  });
  it("returns amber-500 for >= 40", () => {
    expect(getScoreBarBg(50)).toBe("bg-amber-500");
  });
  it("returns rose-500 for < 40", () => {
    expect(getScoreBarBg(20)).toBe("bg-rose-500");
  });
});

// ---------------------------------------------------------------------------
// getConfidenceBadge
// ---------------------------------------------------------------------------

describe("getConfidenceBadge", () => {
  it("high → emerald", () => expect(getConfidenceBadge("high")).toContain("emerald"));
  it("medium → amber",  () => expect(getConfidenceBadge("medium")).toContain("amber"));
  it("low → rose",      () => expect(getConfidenceBadge("low")).toContain("rose"));
  it("unknown → slate", () => expect(getConfidenceBadge("unknown")).toContain("slate"));
});

// ---------------------------------------------------------------------------
// getCategoryBadge
// ---------------------------------------------------------------------------

describe("getCategoryBadge", () => {
  it("Top Growth → emerald", () => expect(getCategoryBadge("Top Growth")).toContain("emerald"));
  it("Income → sky",         () => expect(getCategoryBadge("Income")).toContain("sky"));
  it("Watch → amber",        () => expect(getCategoryBadge("Watch")).toContain("amber"));
  it("Avoid → rose",         () => expect(getCategoryBadge("Avoid")).toContain("rose"));
});

// ---------------------------------------------------------------------------
// buildRankedExplanation
// ---------------------------------------------------------------------------

describe("buildRankedExplanation", () => {
  it("produces at least 2 bullets", () => {
    const { bullets } = buildRankedExplanation(makeScore(), makeCandidate("NVDA"), "Bullish");
    expect(bullets.length).toBeGreaterThanOrEqual(2);
  });

  it("mentions exceptional technical for score >= 80", () => {
    const score = makeScore({ technicalScore: 85 });
    const { bullets } = buildRankedExplanation(score);
    expect(bullets.some(b => b.toLowerCase().includes("exceptional"))).toBe(true);
  });

  it("mentions strong technical for score in [65,79]", () => {
    const score = makeScore({ technicalScore: 70 });
    const { bullets } = buildRankedExplanation(score);
    expect(bullets.some(b => b.toLowerCase().includes("strong"))).toBe(true);
  });

  it("mentions developing technical for score < 50", () => {
    const score = makeScore({ technicalScore: 40 });
    const { bullets } = buildRankedExplanation(score);
    expect(bullets.some(b => b.toLowerCase().includes("developing"))).toBe(true);
  });

  it("mentions institutional accumulation for high score", () => {
    const score = makeScore({ institutionalScore: 75 });
    const { bullets } = buildRankedExplanation(score);
    expect(bullets.some(b => b.toLowerCase().includes("institutional"))).toBe(true);
  });

  it("mentions risk/reward when available and >= 3", () => {
    const score = makeScore({ riskScore: 70 });
    const { bullets } = buildRankedExplanation(score, { rewardRisk: 3.8, strategy: "stock_swing" });
    expect(bullets.some(b => b.includes("3.8:1"))).toBe(true);
  });

  it("mentions regime when supportive", () => {
    const score = makeScore({ regimeScore: 80 });
    const { bullets } = buildRankedExplanation(score, null, "Bullish Momentum");
    expect(bullets.some(b => b.toLowerCase().includes("regime"))).toBe(true);
  });

  it("summary contains overall score", () => {
    const score = makeScore({ overallScore: 82 });
    const { summary } = buildRankedExplanation(score);
    expect(summary).toContain("82");
  });

  it("summary mentions high confidence", () => {
    const { summary } = buildRankedExplanation(makeScore({ confidence: "high" }));
    expect(summary.toLowerCase()).toContain("high");
  });

  it("summary indicates caution for low score", () => {
    const score = makeScore({ overallScore: 35 });
    const { summary } = buildRankedExplanation(score);
    expect(summary.toLowerCase()).toContain("caution");
  });

  it("handles missing candidate gracefully", () => {
    const { bullets } = buildRankedExplanation(makeScore(), null, null);
    expect(bullets.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildRiskExplanation
// ---------------------------------------------------------------------------

describe("buildRiskExplanation", () => {
  it("returns all 6 fields", () => {
    const exp = buildRiskExplanation(makeScore(), makeCandidate("NVDA"));
    expect(exp).toHaveProperty("rewardRisk");
    expect(exp).toHaveProperty("gapRisk");
    expect(exp).toHaveProperty("liquidity");
    expect(exp).toHaveProperty("volatility");
    expect(exp).toHaveProperty("earningsNote");
    expect(exp).toHaveProperty("riskBudget");
  });

  it("rr >= 3 → exceeds threshold", () => {
    const exp = buildRiskExplanation(makeScore(), { rewardRisk: 3.5, maxRisk: 200, warnings: [] });
    expect(exp.rewardRisk).toContain("exceeds");
  });

  it("rr < 2 → size conservatively", () => {
    const exp = buildRiskExplanation(makeScore(), { rewardRisk: 1.5, maxRisk: 200, warnings: [] });
    expect(exp.rewardRisk).toContain("conservatively");
  });

  it("no candidate → fallback message for riskBudget", () => {
    const exp = buildRiskExplanation(makeScore(), null);
    expect(exp.riskBudget).toContain("position-sizing rules");
  });

  it("earnings in warnings → elevated note", () => {
    const exp = buildRiskExplanation(makeScore(), { rewardRisk: 3, maxRisk: 100, warnings: ["Earnings next week"] });
    expect(exp.earningsNote).toContain("⚠");
  });

  it("no earnings → verify independently", () => {
    const exp = buildRiskExplanation(makeScore(), { rewardRisk: 3, maxRisk: 100, warnings: [] });
    expect(exp.earningsNote).toContain("verify");
  });

  it("low riskScore → elevated volatility warning", () => {
    const score = makeScore({ riskScore: 30 });
    const exp = buildRiskExplanation(score, null);
    expect(exp.volatility.toLowerCase()).toContain("elevated");
  });
});

// ---------------------------------------------------------------------------
// findRelated
// ---------------------------------------------------------------------------

describe("findRelated", () => {
  it("excludes the target symbol itself", () => {
    const ranking = makeRanking();
    const related = findRelated("NVDA", ranking);
    expect(related.every(r => r.symbol !== "NVDA")).toBe(true);
  });

  it("prefers same strategy", () => {
    const ranking = makeRanking();
    // AAPL has covered_call; MSFT also has covered_call; NVDA is stock_swing
    const related = findRelated("AAPL", ranking);
    const msftEntry = related.find(r => r.symbol === "MSFT");
    if (msftEntry) expect(msftEntry.reason).toBe("same_strategy");
  });

  it("respects limit", () => {
    const ranking = makeRanking();
    const related = findRelated("NVDA", ranking, 2);
    expect(related.length).toBeLessThanOrEqual(2);
  });

  it("returns empty when no matches", () => {
    const ranking = makeRanking({
      topGrowth: [makeCandidate("SOLO", { rank: 1 })],
      topIncome: [],
    });
    const related = findRelated("SOLO", ranking);
    expect(related).toHaveLength(0);
  });

  it("each result has symbol, rank, category, overallScore, reason", () => {
    const ranking = makeRanking();
    const related = findRelated("NVDA", ranking);
    for (const r of related) {
      expect(r).toHaveProperty("symbol");
      expect(r).toHaveProperty("rank");
      expect(r).toHaveProperty("category");
      expect(r).toHaveProperty("overallScore");
      expect(r).toHaveProperty("reason");
    }
  });
});

// ---------------------------------------------------------------------------
// analyzeHistoryTrend
// ---------------------------------------------------------------------------

describe("analyzeHistoryTrend", () => {
  it("insufficient for < 2 entries", () => {
    expect(analyzeHistoryTrend([]).direction).toBe("insufficient");
    expect(analyzeHistoryTrend(makeHistory([70])).direction).toBe("insufficient");
  });

  it("improving when latest > oldest by > 5", () => {
    // history[0] = latest. Oldest = last entry in array.
    const hist = makeHistory([80, 70, 60]);
    // latest=80, oldest=60, delta=+20
    expect(analyzeHistoryTrend(hist).direction).toBe("improving");
    expect(analyzeHistoryTrend(hist).deltaScore).toBeGreaterThan(0);
  });

  it("declining when latest < oldest by > 5", () => {
    const hist = makeHistory([50, 60, 70]);
    // latest=50, oldest=70, delta=-20
    expect(analyzeHistoryTrend(hist).direction).toBe("declining");
  });

  it("stable when delta <= 5", () => {
    const hist = makeHistory([72, 70, 71]);
    // latest=72, oldest=71, delta=1
    expect(analyzeHistoryTrend(hist).direction).toBe("stable");
  });

  it("reports session count", () => {
    const hist = makeHistory([80, 75, 70]);
    expect(analyzeHistoryTrend(hist).sessions).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// getAllRankedSymbols
// ---------------------------------------------------------------------------

describe("getAllRankedSymbols", () => {
  it("returns all unique symbols sorted", () => {
    const ranking = makeRanking();
    const syms = getAllRankedSymbols(ranking);
    expect(syms).toContain("NVDA");
    expect(syms).toContain("AMD");
    expect(syms).toContain("MSFT");
    // sorted
    for (let i = 1; i < syms.length; i++) {
      expect(syms[i] >= syms[i - 1]).toBe(true);
    }
  });

  it("no duplicates", () => {
    const ranking = makeRanking();
    const syms = getAllRankedSymbols(ranking);
    expect(new Set(syms).size).toBe(syms.length);
  });
});

// ---------------------------------------------------------------------------
// findScoredCandidate
// ---------------------------------------------------------------------------

describe("findScoredCandidate", () => {
  it("finds growth candidate", () => {
    const ranking = makeRanking();
    const c = findScoredCandidate("AMD", ranking);
    expect(c).not.toBeNull();
    expect(c?.symbol).toBe("AMD");
  });

  it("finds income candidate", () => {
    const ranking = makeRanking();
    const c = findScoredCandidate("MSFT", ranking);
    expect(c?.symbol).toBe("MSFT");
  });

  it("returns null for unknown symbol", () => {
    const ranking = makeRanking();
    expect(findScoredCandidate("UNKNOWN", ranking)).toBeNull();
  });
});
