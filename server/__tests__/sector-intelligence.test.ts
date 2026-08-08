// Tests for Sector Intelligence Engine — Sprint 2.3.3

import { describe, it, expect } from "vitest";
import {
  scoreToLabel,
  computeSectorScore,
  computeMedian,
  buildSectorChangeSummary,
  detectSectorChanges,
  aggregateSector,
  type RankedSymbolSummary,
  type InstitutionalSignalSummary,
  type SymbolSectorInfo,
} from "../services/sector-intelligence-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRanked(
  symbol: string,
  overallScore: number,
  technicalScore = 70,
  confidence = "medium",
  category = "Top Growth",
  changeDirection: RankedSymbolSummary["changeDirection"] = null,
): RankedSymbolSummary {
  return {
    symbol,
    overallScore,
    technicalScore,
    institutionalScore: 60,
    fundamentalScore: 55,
    riskScore: 65,
    confidence,
    category,
    changeDirection,
  };
}

function makeInstSignal(
  symbol: string,
  label: string,
  score: number | null = 70,
): InstitutionalSignalSummary {
  return { symbol, label, score };
}

// ---------------------------------------------------------------------------
// scoreToLabel
// ---------------------------------------------------------------------------

describe("scoreToLabel", () => {
  it("returns Strong for >= 75", () => {
    expect(scoreToLabel(75)).toBe("Strong");
    expect(scoreToLabel(100)).toBe("Strong");
  });

  it("returns Improving for 60-74", () => {
    expect(scoreToLabel(60)).toBe("Improving");
    expect(scoreToLabel(74)).toBe("Improving");
  });

  it("returns Mixed for 40-59", () => {
    expect(scoreToLabel(40)).toBe("Mixed");
    expect(scoreToLabel(59)).toBe("Mixed");
  });

  it("returns Weakening for 25-39", () => {
    expect(scoreToLabel(25)).toBe("Weakening");
    expect(scoreToLabel(39)).toBe("Weakening");
  });

  it("returns Weak for < 25", () => {
    expect(scoreToLabel(0)).toBe("Weak");
    expect(scoreToLabel(24)).toBe("Weak");
  });
});

// ---------------------------------------------------------------------------
// computeMedian
// ---------------------------------------------------------------------------

describe("computeMedian", () => {
  it("returns 0 for empty array", () => {
    expect(computeMedian([])).toBe(0);
  });

  it("returns single value unchanged", () => {
    expect(computeMedian([75])).toBe(75);
  });

  it("computes median for odd-length array", () => {
    expect(computeMedian([10, 20, 30])).toBe(20);
  });

  it("computes median for even-length array", () => {
    expect(computeMedian([10, 20, 30, 40])).toBe(25);
  });

  it("handles unsorted input", () => {
    expect(computeMedian([40, 10, 30, 20])).toBe(25);
  });

  it("handles duplicates", () => {
    expect(computeMedian([50, 50, 50])).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// computeSectorScore
// ---------------------------------------------------------------------------

describe("computeSectorScore", () => {
  it("returns 0 for zero-data input", () => {
    expect(
      computeSectorScore({
        averageOpportunityScore: 0,
        eligibleSymbolCount: 0,
        rankedSymbolCount: 0,
        institutionalDataAvailableCount: 0,
        institutionalAccumulationCount: 0,
        strengtheningCount: 0,
        weakeningCount: 0,
      }),
    ).toBe(0);
  });

  it("returns score bounded 0-100", () => {
    const s = computeSectorScore({
      averageOpportunityScore: 100,
      eligibleSymbolCount: 10,
      rankedSymbolCount: 10,
      institutionalDataAvailableCount: 10,
      institutionalAccumulationCount: 10,
      strengtheningCount: 10,
      weakeningCount: 0,
    });
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });

  it("higher scores produce higher sector scores", () => {
    const high = computeSectorScore({
      averageOpportunityScore: 85,
      eligibleSymbolCount: 10,
      rankedSymbolCount: 8,
      institutionalDataAvailableCount: 8,
      institutionalAccumulationCount: 7,
      strengtheningCount: 5,
      weakeningCount: 1,
    });
    const low = computeSectorScore({
      averageOpportunityScore: 40,
      eligibleSymbolCount: 10,
      rankedSymbolCount: 2,
      institutionalDataAvailableCount: 4,
      institutionalAccumulationCount: 1,
      strengtheningCount: 1,
      weakeningCount: 3,
    });
    expect(high).toBeGreaterThan(low);
  });

  it("missing institutional data does not produce negative result", () => {
    const s = computeSectorScore({
      averageOpportunityScore: 70,
      eligibleSymbolCount: 5,
      rankedSymbolCount: 3,
      institutionalDataAvailableCount: 0,  // no institutional data
      institutionalAccumulationCount: 0,
      strengtheningCount: 1,
      weakeningCount: 0,
    });
    expect(s).toBeGreaterThanOrEqual(0);
  });

  it("strengthening produces higher score than weakening", () => {
    const base = {
      averageOpportunityScore: 65,
      eligibleSymbolCount: 10,
      rankedSymbolCount: 5,
      institutionalDataAvailableCount: 0,
      institutionalAccumulationCount: 0,
    };
    const strengthening = computeSectorScore({ ...base, strengtheningCount: 4, weakeningCount: 0 });
    const weakening     = computeSectorScore({ ...base, strengtheningCount: 0, weakeningCount: 4 });
    expect(strengthening).toBeGreaterThan(weakening);
  });

  it("score bounds: all-max inputs return <= 100", () => {
    const s = computeSectorScore({
      averageOpportunityScore: 100,
      eligibleSymbolCount: 1,
      rankedSymbolCount: 1,
      institutionalDataAvailableCount: 1,
      institutionalAccumulationCount: 1,
      strengtheningCount: 100,
      weakeningCount: 0,
    });
    expect(s).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// buildSectorChangeSummary
// ---------------------------------------------------------------------------

describe("buildSectorChangeSummary", () => {
  it("generates 'strengthened' sentence for positive delta", () => {
    const s = buildSectorChangeSummary("Technology", 12, "Strong", [], [], 3, 0);
    expect(s.toLowerCase()).toContain("strengthened");
    expect(s).toContain("Technology");
  });

  it("generates 'weakened' sentence for negative delta", () => {
    const s = buildSectorChangeSummary("Energy", -10, "Weakening", [], [], 0, 3);
    expect(s.toLowerCase()).toContain("weakened");
  });

  it("mentions new leaders when present", () => {
    const s = buildSectorChangeSummary("Technology", 0, "Mixed", ["NVDA", "AMD"], [], 0, 0);
    expect(s).toContain("NVDA");
    expect(s).toContain("AMD");
  });

  it("mentions lost leaders when present", () => {
    const s = buildSectorChangeSummary("Technology", 0, "Mixed", [], ["TSLA"], 0, 0);
    expect(s).toContain("TSLA");
  });

  it("returns valid string for all-zero inputs", () => {
    const s = buildSectorChangeSummary("Healthcare", 0, "Mixed", [], [], 0, 0);
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(0);
    expect(s).toContain("Healthcare");
  });

  it("does not contain forbidden language", () => {
    const s = buildSectorChangeSummary("Technology", 15, "Strong", ["NVDA"], [], 5, 0);
    const lower = s.toLowerCase();
    expect(lower).not.toContain("buy");
    expect(lower).not.toContain("sell");
    expect(lower).not.toContain("bullish");
    expect(lower).not.toContain("bearish");
  });
});

// ---------------------------------------------------------------------------
// detectSectorChanges
// ---------------------------------------------------------------------------

describe("detectSectorChanges", () => {
  it("returns null scoreDelta when no previous snapshot", () => {
    const changes = detectSectorChanges(
      "Technology", 65, "Improving", ["NVDA", "AMD"], ["NVDA"], [], null,
    );
    expect(changes.scoreDelta).toBeNull();
    expect(changes.newLeaders).toEqual([]);
    expect(changes.lostLeaders).toEqual([]);
  });

  it("computes scoreDelta from previous snapshot", () => {
    const changes = detectSectorChanges(
      "Technology", 70, "Improving", ["NVDA"], ["NVDA"], [],
      { score: 60, topSymbols: ["NVDA"], strengtheningSymbols: [] },
    );
    expect(changes.scoreDelta).toBe(10);
  });

  it("identifies new leaders correctly", () => {
    const changes = detectSectorChanges(
      "Technology", 70, "Improving", ["NVDA", "AMD", "AVGO", "TSM", "ASML"], [],  [],
      { score: 65, topSymbols: ["NVDA", "MSFT", "AVGO", "TSM", "ASML"], strengtheningSymbols: [] },
    );
    expect(changes.newLeaders).toContain("AMD");
    expect(changes.lostLeaders).toContain("MSFT");
  });

  it("passes strengthening symbols through", () => {
    const changes = detectSectorChanges(
      "Technology", 70, "Strong", ["NVDA"], ["NVDA", "AMD"], [],
      { score: 65, topSymbols: [], strengtheningSymbols: [] },
    );
    expect(changes.strengtheningSymbols).toEqual(["NVDA", "AMD"]);
  });
});

// ---------------------------------------------------------------------------
// aggregateSector
// ---------------------------------------------------------------------------

describe("aggregateSector", () => {
  it("returns rankedSymbolCount = 0 for empty ranking", () => {
    const result = aggregateSector(
      "Technology",
      ["NVDA", "AMD", "AVGO"],
      [],                // no ranked members
      new Map(),
      ["Semiconductors"],
      null,
    );
    expect(result.rankedSymbolCount).toBe(0);
    expect(result.eligibleSymbolCount).toBe(3);
    expect(result.averageOpportunityScore).toBe(0);
  });

  it("computes correct average score", () => {
    const ranked = [
      makeRanked("NVDA", 80),
      makeRanked("AMD", 70),
      makeRanked("AVGO", 60),
    ];
    const result = aggregateSector(
      "Technology",
      ["NVDA", "AMD", "AVGO"],
      ranked,
      new Map(),
      ["Semiconductors"],
      null,
    );
    expect(result.averageOpportunityScore).toBe(70);
    expect(result.rankedSymbolCount).toBe(3);
  });

  it("counts new and upgraded correctly", () => {
    const ranked = [
      makeRanked("NVDA", 80, 75, "high", "Top Growth", "new"),
      makeRanked("AMD", 70, 65, "medium", "Top Income", "upgraded"),
      makeRanked("AVGO", 60, 60, "medium", "Top Growth", "downgraded"),
    ];
    const result = aggregateSector("Technology", ["NVDA", "AMD", "AVGO"], ranked, new Map(), [], null);
    expect(result.newOpportunityCount).toBe(1);
    expect(result.upgradedCount).toBe(1);
    expect(result.downgradedCount).toBe(1);
    expect(result.strengtheningCount).toBe(2);
    expect(result.weakeningCount).toBe(1);
  });

  it("counts institutional evidence correctly", () => {
    const instMap = new Map([
      ["NVDA", makeInstSignal("NVDA", "Strong Accumulation", 88)],
      ["AMD", makeInstSignal("AMD", "Accumulation", 72)],
      ["AVGO", makeInstSignal("AVGO", "Distribution", 35)],
    ]);
    const result = aggregateSector(
      "Technology",
      ["NVDA", "AMD", "AVGO"],
      [],
      instMap,
      [],
      null,
    );
    expect(result.institutionalDataAvailableCount).toBe(3);
    expect(result.institutionalAccumulationCount).toBe(2);
    expect(result.institutionalDistributionCount).toBe(1);
  });

  it("missing institutional data does not penalize sector", () => {
    const ranked = [makeRanked("NVDA", 80)];
    const result = aggregateSector("Technology", ["NVDA"], ranked, new Map(), [], null);
    // Score should still be positive
    expect(result.score).toBeGreaterThan(0);
    expect(result.institutionalDataAvailableCount).toBe(0);
  });

  it("single-symbol sector is handled gracefully", () => {
    const ranked = [makeRanked("NVDA", 75)];
    const result = aggregateSector("Technology", ["NVDA"], ranked, new Map(), ["Semiconductors"], null);
    expect(result.eligibleSymbolCount).toBe(1);
    expect(result.rankedSymbolCount).toBe(1);
    expect(result.topSymbols).toHaveLength(1);
    expect(result.topSymbols[0].symbol).toBe("NVDA");
  });

  it("score is bounded 0-100", () => {
    const ranked = Array.from({ length: 20 }, (_, i) =>
      makeRanked(`SYM${i}`, 95, 90, "high", "Top Growth", "upgraded"),
    );
    const symbols = ranked.map(r => r.symbol);
    const result = aggregateSector("Technology", symbols, ranked, new Map(), [], null);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("deduplicates industries list", () => {
    const result = aggregateSector(
      "Technology",
      ["NVDA", "AMD"],
      [],
      new Map(),
      ["Semiconductors", "Semiconductors", "Software"],
      null,
    );
    const semCount = result.industries.filter(i => i === "Semiconductors").length;
    expect(semCount).toBe(1);
  });

  it("top symbols are sorted by overallScore descending", () => {
    const ranked = [
      makeRanked("AVGO", 60),
      makeRanked("NVDA", 90),
      makeRanked("AMD",  75),
    ];
    const result = aggregateSector("Technology", ["NVDA", "AMD", "AVGO"], ranked, new Map(), [], null);
    expect(result.topSymbols[0].symbol).toBe("NVDA");
    expect(result.topSymbols[1].symbol).toBe("AMD");
    expect(result.topSymbols[2].symbol).toBe("AVGO");
  });

  it("label thresholds match scoreToLabel output", () => {
    const ranked = [makeRanked("NVDA", 95, 90, "high", "Top Growth", "new")];
    const result = aggregateSector("Technology", ["NVDA"], ranked, new Map(), [], null);
    const expectedLabel = scoreToLabel(result.score);
    expect(result.label).toBe(expectedLabel);
  });

  it("no duplicate ranking formula — scores come from input, not recomputed", () => {
    const ranked = [makeRanked("NVDA", 42)]; // score 42 should be preserved
    const result = aggregateSector("Technology", ["NVDA"], ranked, new Map(), [], null);
    expect(result.topSymbols[0].overallScore).toBe(42);
  });

  it("empty sector returns score 0", () => {
    const result = aggregateSector("EmptySector", [], [], new Map(), [], null);
    expect(result.score).toBe(0);
    expect(result.rankedSymbolCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// No LLM / forbidden language
// ---------------------------------------------------------------------------

describe("no forbidden language in sector intelligence", () => {
  const forbidden = ["buy", "sell", "hot sector", "best sector", "guaranteed", "bullish", "bearish"];

  it("buildSectorChangeSummary output contains no forbidden terms", () => {
    const summaries = [
      buildSectorChangeSummary("Technology", 15, "Strong", ["NVDA"], [], 5, 0),
      buildSectorChangeSummary("Energy", -15, "Weak", [], ["CVX"], 0, 5),
      buildSectorChangeSummary("Healthcare", 0, "Mixed", [], [], 2, 2),
    ];
    for (const s of summaries) {
      const lower = s.toLowerCase();
      for (const term of forbidden) {
        expect(lower, `"${term}" found in: ${s}`).not.toContain(term);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Deterministic
// ---------------------------------------------------------------------------

describe("sector intelligence determinism", () => {
  it("same inputs always produce same score", () => {
    const ranked = [makeRanked("NVDA", 78), makeRanked("AMD", 65)];
    const r1 = aggregateSector("Technology", ["NVDA", "AMD"], ranked, new Map(), [], null);
    const r2 = aggregateSector("Technology", ["NVDA", "AMD"], ranked, new Map(), [], null);
    expect(r1.score).toBe(r2.score);
    expect(r1.label).toBe(r2.label);
  });
});
