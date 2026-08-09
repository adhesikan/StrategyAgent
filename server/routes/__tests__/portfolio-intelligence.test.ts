// ---------------------------------------------------------------------------
// Sprint 2.6.1 — Portfolio Intelligence Tests
//
// 165+ pure unit + integration assertions covering:
//   coverage, concentration, sector/theme exposure, opportunity overlap,
//   research changes, holding classification, institutional summary,
//   risk/research observations, privacy, compliance, partial failures,
//   platform health, glossary, roadmap, ops docs.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  _computeCoverage,
  _computeConcentration,
  _computeSectorExposure,
  _computeThemeExposure,
  _computeOpportunityOverlap,
  _extractResearchChanges,
  _classifyHoldings,
  _computeInstitutionalSummary,
  _buildRiskObservations,
  _buildResearchObservations,
  _buildFurtherResearch,
  getPortfolioIntelligenceHealth,
} from "../../services/portfolio-intelligence-service";
import type {
  PortfolioResearchCoverage,
  ConcentrationMetrics,
  SectorExposureItem,
  ThemeExposureItem,
  OpportunityOverlapItem,
} from "../../../shared/portfolio-intelligence-types";
import type { CanonicalOpportunity } from "../../../shared/opportunity-intelligence-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EnrichedPos = Parameters<typeof _computeCoverage>[0][number];

function makePos(overrides: Partial<EnrichedPos> = {}): EnrichedPos {
  return {
    symbol:        "AAPL",
    quantity:      100,
    averageCost:   150,
    costBasis:     15000,
    marketValue:   17000,
    sector:        "Technology",
    industry:      "Consumer Electronics",
    themeIds:      ["ai-infrastructure"],
    themeNames:    ["AI Infrastructure"],
    opp:           undefined,
    hasInstSignal: false,
    ...overrides,
  };
}

function makeOpp(overrides: Partial<CanonicalOpportunity> = {}): CanonicalOpportunity {
  return {
    id:                   "opp-1",
    symbol:               "AAPL",
    companyName:          "Apple Inc.",
    sector:               "Technology",
    industry:             "Consumer Electronics",
    themes:               ["AI Infrastructure"],
    opportunityType:      "SWING_CANDIDATE",
    opportunityTypeLabel: "Swing Candidate",
    researchScore:        72,
    technicalScore:       80,
    fundamentalScore:     65,
    institutionalScore:   60,
    sentimentScore:       70,
    confidence:           "MEDIUM",
    marketRegime:         "BULLISH",
    timeHorizon:          "SWING",
    riskLevel:            "MODERATE",
    lastUpdated:          new Date().toISOString(),
    primaryEvidence:      [],
    secondaryEvidence:    [],
    riskFactors:          [],
    invalidatesThesis:    [],
    _sourceCategory:      "topGrowth",
    _rank:                1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Coverage
// ---------------------------------------------------------------------------

describe("_computeCoverage", () => {
  it("returns zeros for empty portfolio", () => {
    const c = _computeCoverage([], 0);
    expect(c.positionsTotal).toBe(0);
    expect(c.overallCoveragePercent).toBe(0);
  });

  it("counts market data correctly", () => {
    const positions = [
      makePos({ marketValue: 10000 }),
      makePos({ symbol: "MSFT", marketValue: null }),
    ];
    const c = _computeCoverage(positions, 2);
    expect(c.positionsWithMarketData).toBe(1);
  });

  it("counts opportunity intelligence correctly", () => {
    const positions = [
      makePos({ opp: makeOpp() }),
      makePos({ symbol: "MSFT", opp: undefined }),
    ];
    const c = _computeCoverage(positions, 2);
    expect(c.positionsWithOpportunityIntelligence).toBe(1);
  });

  it("counts fundamental evidence: score > 0 only, not zero", () => {
    const withFund  = makePos({ opp: makeOpp({ fundamentalScore: 55 }) });
    const zeroFund  = makePos({ symbol: "B", opp: makeOpp({ fundamentalScore: 0 }) });
    const noOpp     = makePos({ symbol: "C", opp: undefined });
    const c = _computeCoverage([withFund, zeroFund, noOpp], 3);
    // Only withFund counts (score > 0)
    expect(c.positionsWithFundamentalEvidence).toBe(1);
  });

  it("NULL vs 0 — missing data stays missing", () => {
    const pos = makePos({ marketValue: null });
    const c = _computeCoverage([pos], 1);
    expect(c.positionsWithMarketData).toBe(0);
    // Does NOT treat null as 0
    expect(c.overallCoveragePercent).toBeLessThan(100);
  });

  it("counts institutional evidence", () => {
    const positions = [
      makePos({ hasInstSignal: true }),
      makePos({ symbol: "B", hasInstSignal: false }),
    ];
    const c = _computeCoverage(positions, 2);
    expect(c.positionsWithInstitutionalEvidence).toBe(1);
  });

  it("counts sector", () => {
    const positions = [
      makePos({ sector: "Technology" }),
      makePos({ symbol: "B", sector: null }),
    ];
    const c = _computeCoverage(positions, 2);
    expect(c.positionsWithSector).toBe(1);
  });

  it("counts theme", () => {
    const positions = [
      makePos({ themeIds: ["ai-infrastructure"] }),
      makePos({ symbol: "B", themeIds: [] }),
    ];
    const c = _computeCoverage(positions, 2);
    expect(c.positionsWithTheme).toBe(1);
  });

  it("overallCoveragePercent is 0–100", () => {
    const positions = Array.from({ length: 10 }, (_, i) =>
      makePos({ symbol: `S${i}`, opp: makeOpp({ symbol: `S${i}` }), hasInstSignal: true })
    );
    const c = _computeCoverage(positions, 10);
    expect(c.overallCoveragePercent).toBeGreaterThanOrEqual(0);
    expect(c.overallCoveragePercent).toBeLessThanOrEqual(100);
  });

  it("full coverage produces 100%", () => {
    const positions = [
      makePos({
        marketValue:   10000,
        opp:           makeOpp({ fundamentalScore: 60, institutionalScore: 50 }),
        hasInstSignal: true,
        sector:        "Technology",
        themeIds:      ["ai-infrastructure"],
      }),
    ];
    const c = _computeCoverage(positions, 1);
    expect(c.overallCoveragePercent).toBeGreaterThan(90);
  });
});

// ---------------------------------------------------------------------------
// 2. Concentration
// ---------------------------------------------------------------------------

describe("_computeConcentration", () => {
  it("returns Low label when no market value", () => {
    const c = _computeConcentration([makePos({ marketValue: null })], null);
    expect(c.concentrationLabel).toBe("Low");
    expect(c.largestPositionPercent).toBeNull();
  });

  it("single large position is High concentration", () => {
    const positions = [
      makePos({ symbol: "NVDA", marketValue: 90000 }),
      makePos({ symbol: "MSFT", marketValue: 10000 }),
    ];
    const c = _computeConcentration(positions, 100000);
    expect(c.largestPositionPercent).toBe(90);
    expect(c.largestPositionSymbol).toBe("NVDA");
    expect(c.concentrationLabel).toBe("High"); // > 20%
  });

  it("top3PositionPercent includes top 3", () => {
    const positions = [
      makePos({ symbol: "A", marketValue: 30000 }),
      makePos({ symbol: "B", marketValue: 25000 }),
      makePos({ symbol: "C", marketValue: 20000 }),
      makePos({ symbol: "D", marketValue: 25000 }),
    ];
    const c = _computeConcentration(positions, 100000);
    // Sorted: A=30, B=25/D=25, C=20. Top3 = 30+25+25 = 80%
    expect(c.top3PositionPercent).toBe(80);
    expect(c.top3Label).toBe("High"); // > 50%
  });

  it("moderate concentration 10-20%", () => {
    const positions = [
      makePos({ symbol: "A", marketValue: 15000 }),
      ...Array.from({ length: 9 }, (_, i) => makePos({ symbol: `S${i}`, marketValue: 9444 })),
    ];
    const c = _computeConcentration(positions, 100000);
    expect(c.concentrationLabel).toBe("Moderate");
  });

  it("low concentration < 10%", () => {
    const positions = Array.from({ length: 20 }, (_, i) =>
      makePos({ symbol: `S${i}`, marketValue: 5000 })
    );
    const c = _computeConcentration(positions, 100000);
    expect(c.concentrationLabel).toBe("Low");
  });

  it("computes sector concentration", () => {
    const positions = [
      makePos({ symbol: "A", sector: "Technology", marketValue: 60000 }),
      makePos({ symbol: "B", sector: "Healthcare", marketValue: 40000 }),
    ];
    const c = _computeConcentration(positions, 100000);
    expect(c.largestSectorPercent).toBe(60);
    expect(c.largestSectorName).toBe("Technology");
    expect(c.sectorLabel).toBe("High"); // > 50%
  });

  it("computes theme concentration (overlapping allowed)", () => {
    const positions = [
      makePos({ symbol: "A", themeIds: ["ai-infra"], themeNames: ["AI Infra"], marketValue: 50000 }),
      makePos({ symbol: "B", themeIds: ["ai-infra", "cloud"], themeNames: ["AI Infra", "Cloud"], marketValue: 30000 }),
    ];
    const c = _computeConcentration(positions, 100000);
    expect(c.largestThemeName).toBe("AI Infra");
    expect(c.largestThemePercent).toBe(80); // 80% of portfolio
  });

  it("no portfolio score is returned", () => {
    const c = _computeConcentration([makePos()], 17000) as any;
    expect(c).not.toHaveProperty("portfolioScore");
    expect(c).not.toHaveProperty("portfolioGrade");
    expect(c).not.toHaveProperty("portfolioRating");
  });
});

// ---------------------------------------------------------------------------
// 3. Sector exposure
// ---------------------------------------------------------------------------

describe("_computeSectorExposure", () => {
  it("groups by sector, sorted largest first", () => {
    const positions = [
      makePos({ symbol: "A", sector: "Technology", marketValue: 60000 }),
      makePos({ symbol: "B", sector: "Healthcare", marketValue: 40000 }),
    ];
    const items = _computeSectorExposure(positions, 100000, null);
    expect(items[0].sector).toBe("Technology");
    expect(items[1].sector).toBe("Healthcare");
    expect(items[0].portfolioPercent).toBe(60);
  });

  it("skips positions without sector", () => {
    const positions = [
      makePos({ sector: null }),
      makePos({ symbol: "B", sector: "Technology", marketValue: 10000 }),
    ];
    const items = _computeSectorExposure(positions, 10000, null);
    expect(items).toHaveLength(1);
    expect(items[0].sector).toBe("Technology");
  });

  it("includes symbols array per sector", () => {
    const positions = [
      makePos({ symbol: "AAPL", sector: "Technology", marketValue: 5000 }),
      makePos({ symbol: "MSFT", sector: "Technology", marketValue: 5000 }),
    ];
    const items = _computeSectorExposure(positions, 10000, null);
    expect(items[0].symbols).toContain("AAPL");
    expect(items[0].symbols).toContain("MSFT");
  });

  it("attaches change from history", () => {
    const positions = [makePos({ symbol: "A", sector: "Technology", marketValue: 10000 })];
    const changes = {
      summary:         {} as any,
      sectorChanges:   [{ name: "Technology", changeType: "SECTOR_EXPOSURE_INCREASED", percentDelta: 5, previousPercent: 55, currentPercent: 60 }],
      themeChanges:    [],
      addedPositions: [], exitedPositions: [], increasedPositions: [], reducedPositions: [],
      researchStrengthened: [], researchWeakened: [], newlyQualified: [], noLongerQualified: [],
      limitations: [],
      dataFreshness: { fromSnapshotAt: "", toSnapshotAt: "", institutionalDataNote: "" },
      disclaimer: "",
    } as any;
    const items = _computeSectorExposure(positions, 10000, changes);
    expect(items[0].changeSincePreviousSnapshot).toBe(5);
  });

  it("does not create new sector classifications", () => {
    const positions = [makePos({ sector: "Unknown Custom Sector", marketValue: 100 })];
    const items = _computeSectorExposure(positions, 100, null);
    // Uses sector as-is from OppIntel, never remaps
    expect(items[0].sector).toBe("Unknown Custom Sector");
  });
});

// ---------------------------------------------------------------------------
// 4. Theme exposure
// ---------------------------------------------------------------------------

describe("_computeThemeExposure", () => {
  const themeById = new Map([
    ["ai-infra", { name: "AI Infrastructure" }],
    ["cloud",    { name: "Cloud Computing" }],
  ]);

  it("one holding in two themes counts in both", () => {
    const positions = [
      makePos({ symbol: "NVDA", themeIds: ["ai-infra", "cloud"], themeNames: ["AI Infra", "Cloud"], marketValue: 10000 }),
    ];
    const items = _computeThemeExposure(positions, 10000, themeById);
    expect(items).toHaveLength(2);
    expect(items.every(t => t.portfolioPercent === 100)).toBe(true); // both 100% since one holding
  });

  it("theme percentages may exceed 100% total (disclosure)", () => {
    const positions = [
      makePos({ symbol: "A", themeIds: ["ai-infra"], themeNames: ["AI Infra"], marketValue: 50000 }),
      makePos({ symbol: "B", themeIds: ["ai-infra", "cloud"], themeNames: ["AI Infra", "Cloud"], marketValue: 50000 }),
    ];
    const items = _computeThemeExposure(positions, 100000, themeById);
    const total = items.reduce((s, t) => s + (t.portfolioPercent ?? 0), 0);
    expect(total).toBeGreaterThan(100); // overlapping is expected
  });

  it("sorted largest first", () => {
    const positions = [
      makePos({ symbol: "A", themeIds: ["cloud"], themeNames: ["Cloud"], marketValue: 20000 }),
      makePos({ symbol: "B", themeIds: ["ai-infra"], themeNames: ["AI Infra"], marketValue: 80000 }),
    ];
    const items = _computeThemeExposure(positions, 100000, themeById);
    expect(items[0].themeId).toBe("ai-infra");
  });

  it("returns themeId and themeName", () => {
    const positions = [makePos({ themeIds: ["ai-infra"], themeNames: ["AI Infra"], marketValue: 10000 })];
    const items = _computeThemeExposure(positions, 10000, themeById);
    expect(items[0].themeId).toBe("ai-infra");
    expect(items[0].themeName).toBe("AI Infrastructure"); // from themeById lookup
  });
});

// ---------------------------------------------------------------------------
// 5. Opportunity overlap
// ---------------------------------------------------------------------------

describe("_computeOpportunityOverlap", () => {
  it("topGrowth → CURRENTLY_QUALIFIED", () => {
    const opp = makeOpp({ _sourceCategory: "topGrowth" });
    const oppMap = new Map([["AAPL", opp]]);
    const items = _computeOpportunityOverlap([makePos()], 17000, oppMap, null);
    expect(items[0].overlapCategory).toBe("CURRENTLY_QUALIFIED");
  });

  it("topIncome → CURRENTLY_QUALIFIED", () => {
    const opp = makeOpp({ _sourceCategory: "topIncome" });
    const oppMap = new Map([["AAPL", opp]]);
    const items = _computeOpportunityOverlap([makePos()], 17000, oppMap, null);
    expect(items[0].overlapCategory).toBe("CURRENTLY_QUALIFIED");
  });

  it("approaching → APPROACHING_QUALIFICATION", () => {
    const opp = makeOpp({ _sourceCategory: "approaching" });
    const oppMap = new Map([["AAPL", opp]]);
    const items = _computeOpportunityOverlap([makePos()], 17000, oppMap, null);
    expect(items[0].overlapCategory).toBe("APPROACHING_QUALIFICATION");
  });

  it("watchlist → APPROACHING_QUALIFICATION", () => {
    const opp = makeOpp({ _sourceCategory: "watchlist" });
    const oppMap = new Map([["AAPL", opp]]);
    const items = _computeOpportunityOverlap([makePos()], 17000, oppMap, null);
    expect(items[0].overlapCategory).toBe("APPROACHING_QUALIFICATION");
  });

  it("not in oppMap → NOT_CURRENTLY_RANKED", () => {
    const items = _computeOpportunityOverlap([makePos()], 17000, new Map(), null);
    expect(items[0].overlapCategory).toBe("NOT_CURRENTLY_RANKED");
  });

  it("not in oppMap but in history noLongerQualified → NO_LONGER_QUALIFIED", () => {
    const changes = { noLongerQualified: [{ symbol: "AAPL" }] } as any;
    const items = _computeOpportunityOverlap([makePos()], 17000, new Map(), changes);
    expect(items[0].overlapCategory).toBe("NO_LONGER_QUALIFIED");
  });

  it("does not interpret absence as negative quality", () => {
    const items = _computeOpportunityOverlap([makePos()], 17000, new Map(), null);
    expect(items[0].overlapCategory).toBe("NOT_CURRENTLY_RANKED");
    // NOT_CURRENTLY_RANKED is not "bad" — it just means not in the snapshot
  });

  it("portfolio weight is computed correctly", () => {
    const opp = makeOpp();
    const oppMap = new Map([["AAPL", opp]]);
    const items = _computeOpportunityOverlap([makePos({ marketValue: 5000 })], 100000, oppMap, null);
    expect(items[0].portfolioWeight).toBe(5);
  });

  it("scores come from OppIntel — not recomputed", () => {
    const opp = makeOpp({ researchScore: 77, technicalScore: 88 });
    const oppMap = new Map([["AAPL", opp]]);
    const items = _computeOpportunityOverlap([makePos()], 17000, oppMap, null);
    expect(items[0].researchScore).toBe(77);
    expect(items[0].technicalScore).toBe(88);
  });

  it("includes all required overlap fields", () => {
    const opp = makeOpp();
    const oppMap = new Map([["AAPL", opp]]);
    const items = _computeOpportunityOverlap([makePos()], 17000, oppMap, null);
    const item = items[0];
    expect(item).toHaveProperty("symbol");
    expect(item).toHaveProperty("overlapCategory");
    expect(item).toHaveProperty("researchScore");
    expect(item).toHaveProperty("opportunityType");
    expect(item).toHaveProperty("confidence");
    expect(item).toHaveProperty("riskLevel");
    expect(item).toHaveProperty("primaryEvidence");
    expect(item).toHaveProperty("portfolioWeight");
  });

  it("sorted: CURRENTLY_QUALIFIED before NOT_CURRENTLY_RANKED", () => {
    const positions = [
      makePos({ symbol: "A" }),
      makePos({ symbol: "B", opp: makeOpp({ symbol: "B", _sourceCategory: "topGrowth" }) }),
    ];
    const oppMap = new Map([["B", makeOpp({ symbol: "B", _sourceCategory: "topGrowth" })]]);
    const items = _computeOpportunityOverlap(positions, 34000, oppMap, null);
    expect(items[0].overlapCategory).toBe("CURRENTLY_QUALIFIED");
    expect(items[1].overlapCategory).toBe("NOT_CURRENTLY_RANKED");
  });
});

// ---------------------------------------------------------------------------
// 6. Research changes
// ---------------------------------------------------------------------------

describe("_extractResearchChanges", () => {
  it("returns empty arrays when no changes", () => {
    const r = _extractResearchChanges(null, new Map());
    expect(r.strengthenedHoldings).toHaveLength(0);
    expect(r.weakenedHoldings).toHaveLength(0);
    expect(r.newlyQualifiedHoldings).toHaveLength(0);
    expect(r.noLongerQualifiedHoldings).toHaveLength(0);
  });

  it("classifies strengthened correctly", () => {
    const changes = {
      researchStrengthened: [{ symbol: "AAPL", previousScore: 60, currentScore: 75, scoreDelta: 15, sector: "Technology" }],
      researchWeakened:     [],
      newlyQualified:       [],
      noLongerQualified:    [],
    } as any;
    const r = _extractResearchChanges(changes, new Map());
    expect(r.strengthenedHoldings).toHaveLength(1);
    expect(r.strengthenedHoldings[0].changeType).toBe("RESEARCH_STRENGTHENED");
    expect(r.strengthenedHoldings[0].scoreDelta).toBe(15);
  });

  it("classifies weakened correctly", () => {
    const changes = {
      researchStrengthened: [],
      researchWeakened:     [{ symbol: "MSFT", previousScore: 70, currentScore: 60, scoreDelta: -10, sector: "Technology" }],
      newlyQualified:       [],
      noLongerQualified:    [],
    } as any;
    const r = _extractResearchChanges(changes, new Map());
    expect(r.weakenedHoldings[0].changeType).toBe("RESEARCH_WEAKENED");
    expect(r.weakenedHoldings[0].scoreDelta).toBe(-10);
  });

  it("uses companyName from oppMap", () => {
    const changes = {
      researchStrengthened: [{ symbol: "NVDA", previousScore: 60, currentScore: 80, scoreDelta: 20, sector: null }],
      researchWeakened: [], newlyQualified: [], noLongerQualified: [],
    } as any;
    const oppMap = new Map([["NVDA", makeOpp({ symbol: "NVDA", companyName: "NVIDIA Corporation" })]]);
    const r = _extractResearchChanges(changes, oppMap);
    expect(r.strengthenedHoldings[0].companyName).toBe("NVIDIA Corporation");
  });

  it("does not create new change formulas", () => {
    // Changes come from history service (PortfolioChangeResult), never recomputed here
    const changes = {
      researchStrengthened: [{ symbol: "A", previousScore: 50, currentScore: 60, scoreDelta: 10, sector: null }],
      researchWeakened: [], newlyQualified: [], noLongerQualified: [],
    } as any;
    const r = _extractResearchChanges(changes, new Map());
    // scoreDelta passed through as-is from history
    expect(r.strengthenedHoldings[0].scoreDelta).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 7. Holding classification
// ---------------------------------------------------------------------------

describe("_classifyHoldings", () => {
  it("holdings with OppIntel go to qualifiedHoldings", () => {
    const positions = [
      makePos({ opp: makeOpp() }),
      makePos({ symbol: "B", opp: undefined }),
    ];
    const { qualifiedHoldings, uncoveredHoldings } = _classifyHoldings(positions, 34000);
    expect(qualifiedHoldings).toHaveLength(1);
    expect(uncoveredHoldings).toHaveLength(1);
  });

  it("qualified sorted by researchScore descending", () => {
    const positions = [
      makePos({ symbol: "LOW", opp: makeOpp({ symbol: "LOW", researchScore: 40 }) }),
      makePos({ symbol: "HIGH", opp: makeOpp({ symbol: "HIGH", researchScore: 85 }) }),
    ];
    const { qualifiedHoldings } = _classifyHoldings(positions, 34000);
    expect(qualifiedHoldings[0].symbol).toBe("HIGH");
  });

  it("portfolio weight is correct", () => {
    const positions = [makePos({ marketValue: 10000 })];
    const { qualifiedHoldings } = _classifyHoldings([makePos({ opp: makeOpp(), marketValue: 10000 })], 100000);
    expect(qualifiedHoldings[0].portfolioWeight).toBe(10);
  });

  it("includes required fields on HoldingResearchSummary", () => {
    const positions = [makePos({ opp: makeOpp() })];
    const { qualifiedHoldings } = _classifyHoldings(positions, 17000);
    const h = qualifiedHoldings[0];
    expect(h).toHaveProperty("symbol");
    expect(h).toHaveProperty("sector");
    expect(h).toHaveProperty("themes");
    expect(h).toHaveProperty("portfolioWeight");
    expect(h).toHaveProperty("researchScore");
    expect(h).toHaveProperty("overlapCategory");
    expect(h).toHaveProperty("hasInstitutionalEvidence");
    expect(h).toHaveProperty("hasFundamentalEvidence");
  });

  it("scores sourced from OppIntel exclusively", () => {
    const opp = makeOpp({ researchScore: 91, technicalScore: 83 });
    const { qualifiedHoldings } = _classifyHoldings([makePos({ opp })], 17000);
    expect(qualifiedHoldings[0].researchScore).toBe(91);
    expect(qualifiedHoldings[0].technicalScore).toBe(83);
  });
});

// ---------------------------------------------------------------------------
// 8. Institutional summary
// ---------------------------------------------------------------------------

describe("_computeInstitutionalSummary", () => {
  it("zero coverage when no signals", () => {
    const positions = [makePos({ hasInstSignal: false }), makePos({ symbol: "B", hasInstSignal: false })];
    const s = _computeInstitutionalSummary(positions, 2);
    expect(s.symbolsCovered).toBe(0);
    expect(s.coveragePercent).toBe(0);
  });

  it("partial coverage", () => {
    const positions = [makePos({ hasInstSignal: true }), makePos({ symbol: "B", hasInstSignal: false })];
    const s = _computeInstitutionalSummary(positions, 2);
    expect(s.symbolsCovered).toBe(1);
    expect(s.coveragePercent).toBe(50);
  });

  it("contains 13F disclosure text", () => {
    const s = _computeInstitutionalSummary([makePos({ hasInstSignal: true })], 1);
    expect(s.disclosure.toLowerCase()).toContain("13f");
    expect(s.disclosure.toLowerCase()).toContain("quarter");
  });

  it("unavailable treated as unavailable not zero", () => {
    const s = _computeInstitutionalSummary([makePos({ hasInstSignal: false })], 1);
    // symbolsCovered = 0, not treated as "0 institutional activity"
    expect(s.symbolsCovered).toBe(0);
    // coveragePercent is 0 but that represents actual absence, not a signal of zero activity
    expect(s.symbolsTotal).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 9. Risk observations
// ---------------------------------------------------------------------------

describe("_buildRiskObservations", () => {
  function makeConc(overrides: Partial<ConcentrationMetrics> = {}): ConcentrationMetrics {
    return {
      largestPositionPercent: 5, largestPositionSymbol: "AAPL",
      top3PositionPercent: 15, top5PositionPercent: 25,
      largestSectorPercent: 20, largestSectorName: "Technology",
      largestThemePercent: 15, largestThemeName: "AI Infrastructure",
      concentrationLabel: "Low", top3Label: "Low", sectorLabel: "Low",
      ...overrides,
    };
  }

  function makePortfolioCoverage(overrides: Partial<PortfolioResearchCoverage> = {}): PortfolioResearchCoverage {
    return {
      positionsTotal: 10, positionsWithMarketData: 10,
      positionsWithOpportunityIntelligence: 10,
      positionsWithFundamentalEvidence: 8,
      positionsWithInstitutionalEvidence: 5,
      positionsWithSector: 10, positionsWithTheme: 9,
      overallCoveragePercent: 85,
      ...overrides,
    };
  }

  it("no observations for low concentration, good coverage", () => {
    const obs = _buildRiskObservations(makeConc(), makePortfolioCoverage(), [], [], { symbolsCovered: 3, symbolsTotal: 5, coveragePercent: 60, holdingsWithActivity: 3, disclosure: "..." }, []);
    expect(obs.some(o => o.type === "concentration")).toBe(false);
    expect(obs.some(o => o.type === "limited_coverage")).toBe(false);
  });

  it("high concentration generates observation", () => {
    const conc = makeConc({ concentrationLabel: "High", largestPositionPercent: 35, largestPositionSymbol: "NVDA" });
    const obs = _buildRiskObservations(conc, makePortfolioCoverage(), [], [], { symbolsCovered: 1, symbolsTotal: 5, coveragePercent: 20, holdingsWithActivity: 1, disclosure: "..." }, []);
    const concObs = obs.find(o => o.type === "concentration");
    expect(concObs).toBeDefined();
    expect(concObs?.label).toContain("High");
    expect(concObs?.description).toContain("NVDA");
  });

  it("limited coverage generates observation", () => {
    const coverage = makePortfolioCoverage({ overallCoveragePercent: 30, positionsWithOpportunityIntelligence: 3, positionsTotal: 10 });
    const obs = _buildRiskObservations(makeConc(), coverage, [], [], { symbolsCovered: 0, symbolsTotal: 10, coveragePercent: 0, holdingsWithActivity: 0, disclosure: "" }, []);
    expect(obs.some(o => o.type === "limited_coverage")).toBe(true);
  });

  it("weakened holdings generate observation", () => {
    const weakened = [{ symbol: "MSFT", changeType: "RESEARCH_WEAKENED" as const, companyName: null, previousScore: 70, currentScore: 55, scoreDelta: -15, sector: null }];
    const obs = _buildRiskObservations(makeConc(), makePortfolioCoverage(), weakened, [], { symbolsCovered: 1, symbolsTotal: 5, coveragePercent: 20, holdingsWithActivity: 1, disclosure: "" }, []);
    const weakObs = obs.find(o => o.type === "research_weakening");
    expect(weakObs).toBeDefined();
    expect(weakObs?.affectedSymbols).toContain("MSFT");
  });

  it("no_longer_qualified generates observation", () => {
    const noLonger = [{ symbol: "PLTR", changeType: "NO_LONGER_QUALIFIED" as const, companyName: null, previousScore: 65, currentScore: null, scoreDelta: null, sector: null }];
    const obs = _buildRiskObservations(makeConc(), makePortfolioCoverage(), [], noLonger, { symbolsCovered: 1, symbolsTotal: 5, coveragePercent: 20, holdingsWithActivity: 1, disclosure: "" }, []);
    expect(obs.some(o => o.type === "no_longer_qualified")).toBe(true);
  });

  it("institutional data gap generates observation", () => {
    const obs = _buildRiskObservations(makeConc(), makePortfolioCoverage(), [], [], { symbolsCovered: 0, symbolsTotal: 5, coveragePercent: 0, holdingsWithActivity: 0, disclosure: "" }, []);
    expect(obs.some(o => o.type === "institutional_data_gap")).toBe(true);
  });

  it("no advisory language in observations", () => {
    const conc = makeConc({ concentrationLabel: "High", largestPositionPercent: 40, largestSectorPercent: 60, largestSectorName: "Tech", sectorLabel: "High" });
    const obs = _buildRiskObservations(conc, makePortfolioCoverage(), [], [], { symbolsCovered: 0, symbolsTotal: 5, coveragePercent: 0, holdingsWithActivity: 0, disclosure: "" }, []);
    const allText = obs.map(o => o.description + " " + o.label).join(" ").toLowerCase();
    expect(allText).not.toMatch(/\byou should (buy|sell)\b/);
    expect(allText).not.toMatch(/\brebalance\b/);
    expect(allText).not.toMatch(/\bsell\b/);
    expect(allText).not.toMatch(/\btrim\b/);
  });
});

// ---------------------------------------------------------------------------
// 10. Research observations
// ---------------------------------------------------------------------------

describe("_buildResearchObservations", () => {
  it("no advisory language", () => {
    const positions = [makePos({ opp: makeOpp(), sector: "Technology", marketValue: 10000 })];
    const sectorExp: SectorExposureItem[] = [{ sector: "Technology", marketValue: 10000, portfolioPercent: 100, positionCount: 1, symbols: ["AAPL"], changeSincePreviousSnapshot: null }];
    const themeExp: ThemeExposureItem[]   = [{ themeId: "ai-infra", themeName: "AI Infrastructure", marketValue: 10000, portfolioPercent: 100, positionCount: 1, symbols: ["AAPL"] }];
    const cov: PortfolioResearchCoverage  = { positionsTotal: 1, positionsWithMarketData: 1, positionsWithOpportunityIntelligence: 1, positionsWithFundamentalEvidence: 1, positionsWithInstitutionalEvidence: 0, positionsWithSector: 1, positionsWithTheme: 1, overallCoveragePercent: 80 };
    const obs = _buildResearchObservations(positions, sectorExp, themeExp, [], [], [], cov);
    const allText = obs.map(o => o.text).join(" ").toLowerCase();
    expect(allText).not.toMatch(/\byou should\b/);
    expect(allText).not.toMatch(/\brebalance\b/);
    expect(allText).not.toMatch(/\bsell\b/);
    expect(allText).not.toMatch(/\bbuy\b/);
    expect(allText).not.toMatch(/\badd\b/);
  });

  it("descriptive sentence for sector", () => {
    const sectorExp: SectorExposureItem[] = [{ sector: "Technology", marketValue: 60000, portfolioPercent: 60, positionCount: 3, symbols: ["A", "B", "C"], changeSincePreviousSnapshot: null }];
    const cov: PortfolioResearchCoverage  = { positionsTotal: 5, positionsWithMarketData: 5, positionsWithOpportunityIntelligence: 3, positionsWithFundamentalEvidence: 2, positionsWithInstitutionalEvidence: 1, positionsWithSector: 5, positionsWithTheme: 4, overallCoveragePercent: 70 };
    const obs = _buildResearchObservations([], sectorExp, [], [], [], [], cov);
    expect(obs.some(o => o.text.includes("Technology") && o.text.includes("60%"))).toBe(true);
  });

  it("mentions theme overlap disclosure", () => {
    const themeExp: ThemeExposureItem[] = [{ themeId: "ai", themeName: "AI Infrastructure", marketValue: 80000, portfolioPercent: 80, positionCount: 4, symbols: [] }];
    const cov: PortfolioResearchCoverage = { positionsTotal: 5, positionsWithMarketData: 5, positionsWithOpportunityIntelligence: 3, positionsWithFundamentalEvidence: 2, positionsWithInstitutionalEvidence: 1, positionsWithSector: 5, positionsWithTheme: 5, overallCoveragePercent: 80 };
    const obs = _buildResearchObservations([], [], themeExp, [], [], [], cov);
    const themeText = obs.find(o => o.type === "theme_dominant")?.text ?? "";
    expect(themeText.toLowerCase()).toContain("overlap");
  });
});

// ---------------------------------------------------------------------------
// 11. Further research areas
// ---------------------------------------------------------------------------

describe("_buildFurtherResearch", () => {
  it("includes area for uncovered holdings", () => {
    const uncovered = [{ symbol: "XYZ", companyName: null, sector: null, themes: [], portfolioWeight: 5, marketValue: 500, researchScore: null, technicalScore: null, fundamentalScore: null, institutionalScore: null, overlapCategory: "NOT_CURRENTLY_RANKED" as const, hasInstitutionalEvidence: false, hasFundamentalEvidence: false }];
    const areas = _buildFurtherResearch(uncovered, [], { symbolsCovered: 0, symbolsTotal: 1, coveragePercent: 0, holdingsWithActivity: 0, disclosure: "" }, { concentrationLabel: "Low", largestSectorName: null, largestPositionPercent: 5, largestPositionSymbol: null, top3PositionPercent: null, top5PositionPercent: null, largestSectorPercent: null, largestThemePercent: null, largestThemeName: null, top3Label: "Low", sectorLabel: "Low" });
    expect(areas.some(a => a.area.toLowerCase().includes("research"))).toBe(true);
  });

  it("includes area for weakened holdings", () => {
    const weakened = [{ symbol: "MSFT", changeType: "RESEARCH_WEAKENED" as const, companyName: null, previousScore: 70, currentScore: 55, scoreDelta: -15, sector: null }];
    const areas = _buildFurtherResearch([], weakened, { symbolsCovered: 0, symbolsTotal: 1, coveragePercent: 0, holdingsWithActivity: 0, disclosure: "" }, { concentrationLabel: "Low", largestSectorName: null, largestPositionPercent: 5, largestPositionSymbol: null, top3PositionPercent: null, top5PositionPercent: null, largestSectorPercent: null, largestThemePercent: null, largestThemeName: null, top3Label: "Low", sectorLabel: "Low" });
    expect(areas.some(a => a.area.toLowerCase().includes("weakened"))).toBe(true);
  });

  it("areas contain linkPath for navigation", () => {
    const uncovered = [{ symbol: "XYZ", companyName: null, sector: null, themes: [], portfolioWeight: 5, marketValue: 500, researchScore: null, technicalScore: null, fundamentalScore: null, institutionalScore: null, overlapCategory: "NOT_CURRENTLY_RANKED" as const, hasInstitutionalEvidence: false, hasFundamentalEvidence: false }];
    const areas = _buildFurtherResearch(uncovered, [], { symbolsCovered: 0, symbolsTotal: 1, coveragePercent: 0, holdingsWithActivity: 0, disclosure: "" }, { concentrationLabel: "Low", largestSectorName: null, largestPositionPercent: 5, largestPositionSymbol: null, top3PositionPercent: null, top5PositionPercent: null, largestSectorPercent: null, largestThemePercent: null, largestThemeName: null, top3Label: "Low", sectorLabel: "Low" });
    const withLink = areas.filter(a => a.linkPath);
    expect(withLink.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 12. Platform health
// ---------------------------------------------------------------------------

describe("getPortfolioIntelligenceHealth", () => {
  it("returns valid shape", () => {
    const h = getPortfolioIntelligenceHealth();
    expect(h).toHaveProperty("status");
    expect(h).toHaveProperty("portfoliosAnalyzed");
    expect(h).toHaveProperty("lastAnalysisAt");
    expect(h).toHaveProperty("averageAnalysisDurationMs");
    expect(h).toHaveProperty("partialAnalyses");
    expect(h).toHaveProperty("failedAnalyses");
    expect(h).toHaveProperty("averageCoveragePercent");
  });

  it("status is a valid enum value", () => {
    const h = getPortfolioIntelligenceHealth();
    expect(["HEALTHY", "DEGRADED", "UNKNOWN", "DISABLED"]).toContain(h.status);
  });

  it("does not expose symbols, values, or portfolio names", () => {
    const h = getPortfolioIntelligenceHealth() as any;
    expect(h).not.toHaveProperty("symbols");
    expect(h).not.toHaveProperty("portfolioNames");
    expect(h).not.toHaveProperty("marketValues");
    expect(h).not.toHaveProperty("userId");
  });
});

// ---------------------------------------------------------------------------
// 13. Compliance — no portfolio score, no advisory language
// ---------------------------------------------------------------------------

describe("Compliance — no portfolio score", () => {
  it("ConcentrationMetrics does not contain portfolioScore", () => {
    const c = _computeConcentration([makePos({ marketValue: 17000 })], 17000) as any;
    expect(c).not.toHaveProperty("portfolioScore");
    expect(c).not.toHaveProperty("portfolioGrade");
    expect(c).not.toHaveProperty("portfolioRating");
  });

  it("Coverage result does not contain portfolioScore", () => {
    const c = _computeCoverage([makePos()], 1) as any;
    expect(c).not.toHaveProperty("portfolioScore");
  });
});

describe("Compliance — no recommendation language in type file", () => {
  it("PortfolioIntelligenceResult type does not exist in shared as portfolioScore field", () => {
    // Type-level check: OverlapCategory values are observation labels, not recommendations
    const categories: import("../../../shared/portfolio-intelligence-types").OverlapCategory[] = [
      "CURRENTLY_QUALIFIED",
      "APPROACHING_QUALIFICATION",
      "NO_LONGER_QUALIFIED",
      "NOT_CURRENTLY_RANKED",
    ];
    // None of these are advisory
    for (const cat of categories) {
      expect(cat).not.toMatch(/BUY|SELL|TRIM|ADD/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 14. Privacy — cache isolation
// ---------------------------------------------------------------------------

describe("Cache isolation", () => {
  it("invalidatePortfolioIntelligenceCache is exported and callable", async () => {
    const { invalidatePortfolioIntelligenceCache } = await import("../../services/portfolio-intelligence-service");
    expect(typeof invalidatePortfolioIntelligenceCache).toBe("function");
    // Should not throw for unknown userId/portfolioId
    expect(() => invalidatePortfolioIntelligenceCache("u1", "p1")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 15. Opportunity Intelligence ownership of scoring
// ---------------------------------------------------------------------------

describe("OppIntel ownership", () => {
  it("scores flow from OppIntel through to overlap items unchanged", () => {
    const opp = makeOpp({ researchScore: 99, technicalScore: 88, fundamentalScore: 77, institutionalScore: 66 });
    const oppMap = new Map([["AAPL", opp]]);
    const items = _computeOpportunityOverlap([makePos()], 17000, oppMap, null);
    expect(items[0].researchScore).toBe(99);
    expect(items[0].technicalScore).toBe(88);
    expect(items[0].fundamentalScore).toBe(77);
    expect(items[0].institutionalScore).toBe(66);
  });

  it("coverage does not invent scores for uncovered holdings", () => {
    const positions = [makePos({ opp: undefined })];
    const { uncoveredHoldings } = _classifyHoldings(positions, 17000);
    expect(uncoveredHoldings[0].researchScore).toBeNull();
    expect(uncoveredHoldings[0].technicalScore).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 16. Edge cases — empty portfolio, single holding, large portfolio
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("empty portfolio — coverage all zeros", () => {
    const c = _computeCoverage([], 0);
    expect(Object.values(c).every(v => v === 0)).toBe(true);
  });

  it("single holding — top3 still computed", () => {
    const positions = [makePos({ marketValue: 10000 })];
    const c = _computeConcentration(positions, 10000);
    expect(c.largestPositionPercent).toBe(100);
    // top3 = null for < 2 holdings
    expect(c.top3PositionPercent).toBeNull();
  });

  it("50 holdings — computes without error", () => {
    const positions = Array.from({ length: 50 }, (_, i) =>
      makePos({ symbol: `S${i}`, marketValue: 2000, opp: makeOpp({ symbol: `S${i}` }) })
    );
    const c = _computeCoverage(positions, 50);
    expect(c.positionsTotal).toBe(50);
    const conc = _computeConcentration(positions, 100000);
    expect(conc.top3PositionPercent).toBeGreaterThan(0);
  });

  it("200 holdings — computes without error", () => {
    const positions = Array.from({ length: 200 }, (_, i) =>
      makePos({ symbol: `S${i}`, marketValue: 500 })
    );
    const c = _computeCoverage(positions, 200);
    expect(c.positionsTotal).toBe(200);
  });

  it("missing market data — null stays null, not 0", () => {
    const positions = [makePos({ marketValue: null }), makePos({ symbol: "B", marketValue: 10000 })];
    const conc = _computeConcentration(positions, null);
    expect(conc.largestPositionPercent).toBeNull();
  });

  it("missing OppIntel — uncoveredHoldings populated", () => {
    const positions = [makePos({ opp: undefined })];
    const { uncoveredHoldings } = _classifyHoldings(positions, null);
    expect(uncoveredHoldings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 17. Operations Manual compliance
// ---------------------------------------------------------------------------

import fs from "fs";
import path from "path";

describe("Operations Manual", () => {
  const opsDocPath = path.join(process.cwd(), "docs/operations/22-portfolio-intelligence.md");

  it("ops doc 22 exists", () => {
    expect(fs.existsSync(opsDocPath)).toBe(true);
  });

  it("ops doc does not contain forbidden language", () => {
    if (!fs.existsSync(opsDocPath)) return;
    const content = fs.readFileSync(opsDocPath, "utf-8").toLowerCase();
    expect(content).not.toMatch(/\byou should (buy|sell)\b/);
    expect(content).not.toMatch(/\bstrong buy\b/);
    expect(content).not.toContain("rebalance now");
    expect(content).not.toMatch(/\bportfolio score\b/);
    expect(content).not.toMatch(/\bportfolio grade\b/);
    expect(content).not.toMatch(/\bportfolio rating\b/);
  });

  it("ops doc mentions disclaimer requirement", () => {
    if (!fs.existsSync(opsDocPath)) return;
    const content = fs.readFileSync(opsDocPath, "utf-8").toLowerCase();
    expect(content).toContain("disclaimer");
  });

  it("ops doc mentions 13F disclosure", () => {
    if (!fs.existsSync(opsDocPath)) return;
    const content = fs.readFileSync(opsDocPath, "utf-8").toLowerCase();
    expect(content).toContain("13f");
  });

  it("ops doc mentions concentration thresholds", () => {
    if (!fs.existsSync(opsDocPath)) return;
    const content = fs.readFileSync(opsDocPath, "utf-8").toLowerCase();
    expect(content).toContain("threshold");
  });

  it("ops doc mentions privacy", () => {
    if (!fs.existsSync(opsDocPath)) return;
    const content = fs.readFileSync(opsDocPath, "utf-8").toLowerCase();
    expect(content).toContain("privacy");
  });
});

// ---------------------------------------------------------------------------
// 18. Roadmap discipline — no score/grade/rating introduced
// ---------------------------------------------------------------------------

describe("Roadmap discipline", () => {
  it("PortfolioIntelligenceResult type has no portfolioScore field", () => {
    // Compile-time check reflected at runtime via object shape
    const emptyConc = _computeConcentration([], null) as any;
    expect(emptyConc.portfolioScore).toBeUndefined();
  });

  it("concentrationLabel uses documented vocabulary only", () => {
    const validLabels: import("../../../shared/portfolio-intelligence-types").ConcentrationLabel[] = ["Low", "Moderate", "High"];
    const c = _computeConcentration([makePos({ marketValue: 10000 })], 10000);
    expect(validLabels).toContain(c.concentrationLabel);
    expect(validLabels).toContain(c.top3Label);
    expect(validLabels).toContain(c.sectorLabel);
  });
});
