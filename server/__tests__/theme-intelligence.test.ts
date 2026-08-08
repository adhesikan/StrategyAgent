// Tests for Theme Intelligence Engine — Sprint 2.3.3

import { describe, it, expect } from "vitest";
import {
  computeThemeScore,
  computeThemeBreadth,
  detectThemeChanges,
  buildThemeChangeSummary,
  aggregateTheme,
  computeThemeDataQuality,
  type ThemeMemberEntry,
} from "../services/theme-intelligence-engine";
import {
  type RankedSymbolSummary,
  type InstitutionalSignalSummary,
  scoreToLabel,
} from "../services/sector-intelligence-engine";
import {
  getAllThemes,
  getTheme,
  getThemesForSymbol,
  isSymbolInTheme,
  getThemeSymbols,
} from "../config/theme-registry";

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

function makeInstSignal(symbol: string, label: string, score: number | null = 70): InstitutionalSignalSummary {
  return { symbol, label, score };
}

function mockTheme(themeId: string, symbols: string[]) {
  return {
    themeId,
    name: `Test Theme: ${themeId}`,
    description: "Test theme",
    active: true,
    symbols,
    classificationMethod: "curated" as const,
  };
}

// ---------------------------------------------------------------------------
// computeThemeScore
// ---------------------------------------------------------------------------

describe("computeThemeScore", () => {
  it("returns 0 for all-zero inputs", () => {
    expect(computeThemeScore(0, 0, 0, 0)).toBe(0);
  });

  it("returns 100 for all-max inputs", () => {
    expect(computeThemeScore(100, 100, 100, 100)).toBe(100);
  });

  it("is bounded 0-100 for any valid inputs", () => {
    for (const q of [0, 25, 50, 75, 100]) {
      for (const t of [0, 50, 100]) {
        const s = computeThemeScore(q, t, t, t);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    }
  });

  it("higher quality produces higher score", () => {
    const high = computeThemeScore(90, 80, 70, 60);
    const low  = computeThemeScore(30, 80, 70, 60);
    expect(high).toBeGreaterThan(low);
  });

  it("higher technical breadth produces higher score", () => {
    const high = computeThemeScore(70, 90, 60, 60);
    const low  = computeThemeScore(70, 20, 60, 60);
    expect(high).toBeGreaterThan(low);
  });

  it("zero institutional breadth does not zero out the score", () => {
    const s = computeThemeScore(70, 80, 0, 60);
    expect(s).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// computeThemeBreadth
// ---------------------------------------------------------------------------

describe("computeThemeBreadth", () => {
  it("returns zero breadths for no ranked members", () => {
    const b = computeThemeBreadth(["NVDA", "AMD"], [], new Map());
    expect(b.technicalBreadth).toBe(0);
    expect(b.institutionalBreadth).toBe(0);
    expect(b.opportunityBreadth).toBe(0);
    expect(b.technicalDenominator).toBe(0);
  });

  it("computes opportunity breadth correctly", () => {
    const members  = ["NVDA", "AMD", "AVGO", "TSM"];
    const ranked   = [makeRanked("NVDA", 80), makeRanked("AMD", 70)];
    const b = computeThemeBreadth(members, ranked, new Map());
    expect(b.opportunityBreadth).toBe(50);   // 2/4 * 100
    expect(b.opportunityNumerator).toBe(2);
    expect(b.opportunityDenominator).toBe(4);
  });

  it("computes technical breadth (technicalScore >= 65 threshold)", () => {
    const members = ["NVDA", "AMD", "AVGO"];
    const ranked  = [
      makeRanked("NVDA", 80, 70),  // >= 65: counts
      makeRanked("AMD",  70, 50),  // < 65: does not count
      makeRanked("AVGO", 60, 65),  // == 65: counts
    ];
    const b = computeThemeBreadth(members, ranked, new Map());
    expect(b.technicalNumerator).toBe(2);
    expect(b.technicalDenominator).toBe(3);
    expect(b.technicalBreadth).toBe(67); // round(2/3 * 100)
  });

  it("computes institutional breadth from signals map", () => {
    const members = ["NVDA", "AMD", "AVGO"];
    const instMap = new Map([
      ["NVDA", makeInstSignal("NVDA", "Strong Accumulation")],
      ["AMD",  makeInstSignal("AMD",  "Accumulation")],
      ["AVGO", makeInstSignal("AVGO", "Distribution")],
    ]);
    const b = computeThemeBreadth(members, [], instMap);
    expect(b.institutionalDenominator).toBe(3);
    expect(b.institutionalNumerator).toBe(2);
    expect(b.institutionalBreadth).toBe(67);
  });

  it("missing institutional data returns 0 breadth not error", () => {
    const b = computeThemeBreadth(["NVDA"], [makeRanked("NVDA", 80)], new Map());
    expect(b.institutionalBreadth).toBe(0);
    expect(b.institutionalDenominator).toBe(0);
  });

  it("all-max case returns 100% breadths", () => {
    const members = ["NVDA", "AMD"];
    const ranked  = [makeRanked("NVDA", 90, 75), makeRanked("AMD", 85, 70)];
    const instMap = new Map([
      ["NVDA", makeInstSignal("NVDA", "Strong Accumulation")],
      ["AMD",  makeInstSignal("AMD",  "Accumulation")],
    ]);
    const b = computeThemeBreadth(members, ranked, instMap);
    expect(b.technicalBreadth).toBe(100);
    expect(b.institutionalBreadth).toBe(100);
    expect(b.opportunityBreadth).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// buildThemeChangeSummary
// ---------------------------------------------------------------------------

describe("buildThemeChangeSummary", () => {
  it("strengthened for positive delta >= 8", () => {
    const s = buildThemeChangeSummary("AI Infrastructure", 10, "Strong", 3, 0, [], []);
    expect(s.toLowerCase()).toContain("strengthened");
    expect(s).toContain("AI Infrastructure");
  });

  it("weakened for negative delta <= -8", () => {
    const s = buildThemeChangeSummary("Cybersecurity", -12, "Weakening", 0, 2, [], []);
    expect(s.toLowerCase()).toContain("weakened");
  });

  it("remains for small delta", () => {
    const s = buildThemeChangeSummary("Cloud", 3, "Mixed", 1, 1, [], []);
    expect(s.toLowerCase()).toContain("remains");
  });

  it("mentions new leaders", () => {
    const s = buildThemeChangeSummary("Semiconductors", 0, "Mixed", 0, 0, ["NVDA"], []);
    expect(s).toContain("NVDA");
    expect(s.toLowerCase()).toContain("top positions");
  });

  it("does not contain forbidden language", () => {
    const forbidden = ["buy", "sell", "hot", "guaranteed", "best theme", "bullish", "bearish"];
    const summaries = [
      buildThemeChangeSummary("AI Infrastructure", 15, "Strong", 5, 0, ["NVDA"], []),
      buildThemeChangeSummary("Fintech", -10, "Weak", 0, 3, [], ["PYPL"]),
      buildThemeChangeSummary("Cloud", 2, "Mixed", 2, 1, [], []),
    ];
    for (const s of summaries) {
      const lower = s.toLowerCase();
      for (const term of forbidden) {
        expect(lower, `Found "${term}" in: ${s}`).not.toContain(term);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// detectThemeChanges
// ---------------------------------------------------------------------------

describe("detectThemeChanges", () => {
  it("null scoreDelta when no previous snapshot", () => {
    const c = detectThemeChanges("AI Infra", 65, "Improving", ["NVDA"], ["NVDA"], [], null);
    expect(c.scoreDelta).toBeNull();
    expect(c.newLeaders).toEqual([]);
    expect(c.lostLeaders).toEqual([]);
    expect(c.strengtheningSymbols).toEqual(["NVDA"]);
  });

  it("computes scoreDelta from previous", () => {
    const c = detectThemeChanges("AI Infra", 72, "Improving", ["NVDA"], [], [],
      { score: 60, topSymbols: ["AMD"] });
    expect(c.scoreDelta).toBe(12);
    expect(c.newLeaders).toContain("NVDA");
    expect(c.lostLeaders).toContain("AMD");
  });
});

// ---------------------------------------------------------------------------
// aggregateTheme
// ---------------------------------------------------------------------------

describe("aggregateTheme", () => {
  it("empty theme has all zero counts", () => {
    const theme = mockTheme("empty", []);
    const r = aggregateTheme(theme, new Map(), new Map(), null);
    expect(r.memberCount).toBe(0);
    expect(r.rankedMemberCount).toBe(0);
    expect(r.score).toBe(0);
  });

  it("single-member ranked theme computes valid score", () => {
    const theme = mockTheme("single", ["NVDA"]);
    const ranked = new Map([["NVDA", makeRanked("NVDA", 80, 72, "high", "Top Growth", "new")]]);
    const r = aggregateTheme(theme, ranked, new Map(), null);
    expect(r.memberCount).toBe(1);
    expect(r.rankedMemberCount).toBe(1);
    expect(r.score).toBeGreaterThan(0);
  });

  it("unranked members are included in allMembers with isRanked=false", () => {
    const theme = mockTheme("test", ["NVDA", "AMD"]);
    const ranked = new Map([["NVDA", makeRanked("NVDA", 80)]]);
    const r = aggregateTheme(theme, ranked, new Map(), null);
    expect(r.allMembers).toHaveLength(2);
    const nvda = r.allMembers.find(m => m.symbol === "NVDA");
    const amd  = r.allMembers.find(m => m.symbol === "AMD");
    expect(nvda?.isRanked).toBe(true);
    expect(amd?.isRanked).toBe(false);
    expect(amd?.overallScore).toBeNull();
  });

  it("multi-theme membership: same symbol in two themes", () => {
    const themeA = mockTheme("a", ["NVDA", "AMD"]);
    const themeB = mockTheme("b", ["NVDA", "TSLA"]);
    const ranked = new Map([
      ["NVDA", makeRanked("NVDA", 85)],
      ["AMD",  makeRanked("AMD",  70)],
      ["TSLA", makeRanked("TSLA", 65)],
    ]);
    const rA = aggregateTheme(themeA, ranked, new Map(), null);
    const rB = aggregateTheme(themeB, ranked, new Map(), null);
    expect(rA.rankedMemberCount).toBe(2);
    expect(rB.rankedMemberCount).toBe(2);
  });

  it("new + upgraded symbols go into strengtheningSymbols", () => {
    const theme = mockTheme("test", ["NVDA", "AMD", "AVGO"]);
    const ranked = new Map([
      ["NVDA", makeRanked("NVDA", 85, 75, "high", "Top Growth", "new")],
      ["AMD",  makeRanked("AMD",  70, 65, "medium", "Top Income", "upgraded")],
      ["AVGO", makeRanked("AVGO", 60, 55, "medium", "Top Growth", "downgraded")],
    ]);
    const r = aggregateTheme(theme, ranked, new Map(), null);
    expect(r.strengtheningCount).toBe(2);
    expect(r.weakeningCount).toBe(1);
    expect(r.newOpportunityCount).toBe(1);
    expect(r.upgradedCount).toBe(1);
    expect(r.downgradedCount).toBe(1);
  });

  it("missing institutional data does not penalize theme", () => {
    const theme = mockTheme("test", ["NVDA", "AMD"]);
    const ranked = new Map([["NVDA", makeRanked("NVDA", 80)]]);
    const r = aggregateTheme(theme, ranked, new Map(), null);
    // Score should still be positive even with no institutional data
    expect(r.score).toBeGreaterThan(0);
    expect(r.institutionalDataAvailableCount).toBe(0);
    expect(r.institutionalAccumulationCount).toBe(0);
  });

  it("institutional counts cover ALL members, not just ranked", () => {
    const theme = mockTheme("test", ["NVDA", "AMD", "AVGO"]);
    const ranked = new Map([["NVDA", makeRanked("NVDA", 80)]]);
    const instMap = new Map([
      ["NVDA", makeInstSignal("NVDA", "Accumulation")],
      ["AMD",  makeInstSignal("AMD",  "Strong Accumulation")],
      // AVGO: no signal
    ]);
    const r = aggregateTheme(theme, ranked, instMap, null);
    expect(r.institutionalDataAvailableCount).toBe(2);
    expect(r.institutionalAccumulationCount).toBe(2);
  });

  it("score is bounded 0-100", () => {
    const theme = mockTheme("test", Array.from({ length: 10 }, (_, i) => `SYM${i}`));
    const ranked = new Map(theme.symbols.map(s => [s, makeRanked(s, 95, 90, "high", "Top Growth", "new")]));
    const instMap = new Map(theme.symbols.map(s => [s, makeInstSignal(s, "Strong Accumulation", 95)]));
    const r = aggregateTheme(theme, ranked, instMap, null);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("label matches scoreToLabel output", () => {
    const theme = mockTheme("test", ["NVDA"]);
    const ranked = new Map([["NVDA", makeRanked("NVDA", 80)]]);
    const r = aggregateTheme(theme, ranked, new Map(), null);
    expect(r.label).toBe(scoreToLabel(r.score));
  });

  it("allMembers sorted by overallScore descending (ranked first)", () => {
    const theme = mockTheme("test", ["AVGO", "NVDA", "AMD"]);
    const ranked = new Map([
      ["NVDA", makeRanked("NVDA", 90)],
      ["AMD",  makeRanked("AMD",  60)],
    ]);
    const r = aggregateTheme(theme, ranked, new Map(), null);
    expect(r.allMembers[0].symbol).toBe("NVDA");
    expect(r.allMembers[1].symbol).toBe("AMD");
  });

  it("topSymbols are top 10 by overallScore", () => {
    const syms = Array.from({ length: 15 }, (_, i) => `SYM${i}`);
    const theme = mockTheme("test", syms);
    const ranked = new Map(syms.map((s, i) => [s, makeRanked(s, 50 + i)]));
    const r = aggregateTheme(theme, ranked, new Map(), null);
    expect(r.topSymbols.length).toBeLessThanOrEqual(10);
    // Highest scored should be first
    expect(r.topSymbols[0].overallScore).toBeGreaterThanOrEqual(r.topSymbols[1]?.overallScore ?? 0);
  });
});

// ---------------------------------------------------------------------------
// computeThemeDataQuality
// ---------------------------------------------------------------------------

describe("computeThemeDataQuality", () => {
  it("high confidence for 5+ ranked and good coverage", () => {
    const dq = computeThemeDataQuality(10, 6, 5);
    expect(dq.confidence).toBe("high");
  });

  it("limited confidence for few ranked members", () => {
    const dq = computeThemeDataQuality(10, 1, 0);
    expect(dq.confidence).toBe("limited");
  });

  it("returns classificationCoverage = 1 for curated themes", () => {
    const dq = computeThemeDataQuality(10, 5, 3);
    expect(dq.classificationCoverage).toBe(1);
  });

  it("handles zero member count gracefully", () => {
    const dq = computeThemeDataQuality(0, 0, 0);
    expect(dq.technicalCoverage).toBe(0);
    expect(dq.institutionalCoverage).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Theme Registry integration
// ---------------------------------------------------------------------------

describe("theme registry", () => {
  it("getAllThemes returns active themes only", () => {
    const themes = getAllThemes();
    expect(themes.length).toBeGreaterThan(0);
    expect(themes.every(t => t.active)).toBe(true);
  });

  it("getTheme returns a valid definition for known themeId", () => {
    const t = getTheme("ai-infrastructure");
    expect(t).toBeDefined();
    expect(t?.themeId).toBe("ai-infrastructure");
    expect(t?.symbols.length).toBeGreaterThan(0);
  });

  it("getTheme returns undefined for unknown themeId", () => {
    expect(getTheme("nonexistent-theme")).toBeUndefined();
  });

  it("NVDA is in AI Infrastructure theme", () => {
    expect(isSymbolInTheme("NVDA", "ai-infrastructure")).toBe(true);
  });

  it("NVDA is in multiple themes (many-to-many)", () => {
    const themes = getThemesForSymbol("NVDA");
    expect(themes.length).toBeGreaterThan(1);
    expect(themes).toContain("ai-infrastructure");
    expect(themes).toContain("semiconductors");
  });

  it("getThemesForSymbol is case-insensitive", () => {
    const upper = getThemesForSymbol("NVDA");
    const lower = getThemesForSymbol("nvda");
    expect(upper).toEqual(lower);
  });

  it("getThemeSymbols returns members for known theme", () => {
    const syms = getThemeSymbols("cybersecurity");
    expect(syms.length).toBeGreaterThan(0);
    expect(syms).toContain("PANW");
  });

  it("getThemeSymbols returns empty for unknown theme", () => {
    expect(getThemeSymbols("nonexistent")).toEqual([]);
  });

  it("all theme symbols are uppercase", () => {
    const themes = getAllThemes();
    for (const t of themes) {
      for (const sym of t.symbols) {
        expect(sym).toBe(sym.toUpperCase());
      }
    }
  });

  it("all themeIds use kebab-case (no spaces or underscores)", () => {
    const themes = getAllThemes();
    for (const t of themes) {
      expect(t.themeId).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("all themes have non-empty descriptions", () => {
    const themes = getAllThemes();
    for (const t of themes) {
      expect(t.description.length).toBeGreaterThan(10);
    }
  });

  it("classificationMethod is 'curated' for all themes", () => {
    const themes = getAllThemes();
    for (const t of themes) {
      expect(t.classificationMethod).toBe("curated");
    }
  });

  it("no duplicate themeIds", () => {
    const themes = getAllThemes();
    const ids = themes.map(t => t.themeId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// No LLM / no ranking formula duplication
// ---------------------------------------------------------------------------

describe("no LLM and no duplicate ranking formula", () => {
  it("computeThemeScore uses breadth metrics, not LLM", () => {
    // Score should be deterministic for same inputs
    const s1 = computeThemeScore(75, 80, 60, 70);
    const s2 = computeThemeScore(75, 80, 60, 70);
    expect(s1).toBe(s2);
  });

  it("aggregateTheme top symbols come from input scores, not recomputed", () => {
    const theme = mockTheme("test", ["NVDA"]);
    const ranked = new Map([["NVDA", makeRanked("NVDA", 42)]]);
    const r = aggregateTheme(theme, ranked, new Map(), null);
    expect(r.topSymbols[0].overallScore).toBe(42);
  });
});
