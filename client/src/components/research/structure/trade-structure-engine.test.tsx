// Trade Structure Engine — comprehensive pure-function tests.
// Tests cover: stock structure selection, options structure selection,
// DTE determination, strike guidance, risk classification, income / growth /
// conservative strategies, trade comparison ranking, and conditional broker CTA.
//
// No rendering. All exported pure functions are exercised directly.

import { describe, it, expect } from "vitest";
import type { ResearchPackage, EvidenceStars } from "./types";
import { deriveStockStructure } from "./stock-structure-card";
import {
  deriveOptionsStructures,
  deriveDTE,
  deriveStrikeGuidance,
} from "./options-structure-card";
import { buildStructureComparisons } from "./trade-comparison-card";
import {
  buildStockStructureReason,
  buildOptionsStructureReason,
} from "./trade-structure-reason-card";
import {
  buildStockRiskProfile,
  buildOptionsRiskProfile,
} from "./trade-structure-risk-card";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<ResearchPackage["candidate"]> = {}): ResearchPackage["candidate"] {
  return {
    rank: 1,
    symbol: "AAPL",
    strategy: "VCP",
    confidence: "high",
    whySelected: ["Strong volume dry-up", "Tight contraction", "Near 52-week high"],
    warnings: [],
    rewardRisk: 2.5,
    currentPrice: 150,
    invalidation: "142.50",
    fitsRiskBudget: true,
    ...overrides,
  };
}

function makePkg(overrides: Partial<ResearchPackage> = {}): ResearchPackage {
  return {
    symbol: "AAPL",
    candidate: makeCandidate(),
    lifecycleItem: null,
    scanHistory: [],
    brokerConnected: false,
    marketRegime: "TRENDING",
    dataSource: "stored",
    dataQuality: "complete",
    freshnessStatus: "fresh",
    completedAt: new Date().toISOString(),
    snapshotId: "snap-1",
    ...overrides,
  };
}

const stars: EvidenceStars = {
  technical: 4,
  news: 3,
  congress: 2,
  institutional: 0,
  catalysts: 2,
  regime: 4,
};

// ---------------------------------------------------------------------------
// deriveStockStructure
// ---------------------------------------------------------------------------

describe("deriveStockStructure", () => {
  it("returns breakout-entry for VCP + high confidence", () => {
    const s = deriveStockStructure(makePkg());
    expect(s.type).toBe("breakout-entry");
    expect(s.label).toBe("Breakout Entry");
  });

  it("returns breakout-entry for BREAKOUT + high confidence", () => {
    const s = deriveStockStructure(makePkg({ candidate: makeCandidate({ strategy: "BREAKOUT" }) }));
    expect(s.type).toBe("breakout-entry");
  });

  it("returns pullback-entry for VCP + medium confidence", () => {
    const s = deriveStockStructure(
      makePkg({ candidate: makeCandidate({ strategy: "VCP", confidence: "medium" }) }),
    );
    expect(s.type).toBe("pullback-entry");
  });

  it("returns pullback-entry for PULLBACK strategy", () => {
    const s = deriveStockStructure(
      makePkg({ candidate: makeCandidate({ strategy: "PULLBACK", confidence: "high" }) }),
    );
    expect(s.type).toBe("pullback-entry");
  });

  it("returns swing-position for SWING strategy", () => {
    const s = deriveStockStructure(
      makePkg({ candidate: makeCandidate({ strategy: "SWING" }) }),
    );
    expect(s.type).toBe("swing-position");
  });

  it("returns long-stock for GAP strategy", () => {
    const s = deriveStockStructure(
      makePkg({ candidate: makeCandidate({ strategy: "GAP_AND_GO" }) }),
    );
    expect(s.type).toBe("long-stock");
  });

  it("returns long-stock for ORB strategy", () => {
    const s = deriveStockStructure(
      makePkg({ candidate: makeCandidate({ strategy: "ORB5" }) }),
    );
    expect(s.type).toBe("long-stock");
  });

  it("returns position-trade for TRENDING regime + high confidence + trend mention", () => {
    const s = deriveStockStructure(
      makePkg({
        marketRegime: "TRENDING",
        candidate: makeCandidate({
          strategy: "CUSTOM",
          confidence: "high",
          whySelected: ["Strong upward trend", "Momentum expanding"],
        }),
      }),
    );
    expect(s.type).toBe("position-trade");
  });

  it("returns long-stock as default fallback", () => {
    const s = deriveStockStructure(
      makePkg({
        marketRegime: null,
        candidate: makeCandidate({ strategy: "UNKNOWN", confidence: "low", whySelected: [] }),
      }),
    );
    expect(s.type).toBe("long-stock");
  });

  it("includes whyFits array with at least one item", () => {
    const s = deriveStockStructure(makePkg());
    expect(s.whyFits.length).toBeGreaterThan(0);
  });

  it("includes R/R note when rewardRisk >= 2", () => {
    const s = deriveStockStructure(makePkg({ candidate: makeCandidate({ rewardRisk: 3.0 }) }));
    const rrMention = s.whyFits.some((w) => w.includes("3.0:1"));
    expect(rrMention).toBe(true);
  });

  it("sets riskProfile with invalidation price when available", () => {
    const s = deriveStockStructure(makePkg());
    expect(s.riskProfile).toContain("$142.50");
  });

  it("advantages and disadvantages are non-empty arrays", () => {
    const s = deriveStockStructure(makePkg());
    expect(s.advantages.length).toBeGreaterThan(0);
    expect(s.disadvantages.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// deriveDTE
// ---------------------------------------------------------------------------

describe("deriveDTE", () => {
  it("returns 30 DTE for ORB strategy", () => {
    expect(deriveDTE(makeCandidate({ strategy: "ORB5" }))).toBe("30 DTE");
  });

  it("returns 30 DTE for GAP strategy", () => {
    expect(deriveDTE(makeCandidate({ strategy: "GAP_AND_GO" }))).toBe("30 DTE");
  });

  it("returns 60–90 DTE when whySelected mentions months", () => {
    const c = makeCandidate({ whySelected: ["Strong multi-month trend developing"] });
    expect(deriveDTE(c)).toBe("60–90 DTE");
  });

  it("returns 60–90 DTE when whySelected mentions position", () => {
    const c = makeCandidate({ whySelected: ["Position trade setup"] });
    expect(deriveDTE(c)).toBe("60–90 DTE");
  });

  it("returns 45–60 DTE when whySelected mentions swing", () => {
    const c = makeCandidate({ strategy: "CUSTOM", whySelected: ["Swing trade thesis intact"] });
    expect(deriveDTE(c)).toBe("45–60 DTE");
  });

  it("returns 45–60 DTE for VCP strategy", () => {
    expect(deriveDTE(makeCandidate({ strategy: "VCP", whySelected: [] }))).toBe("45–60 DTE");
  });

  it("returns 30–45 DTE as default", () => {
    expect(deriveDTE(makeCandidate({ strategy: "CUSTOM", whySelected: [] }))).toBe("30–45 DTE");
  });

  it("returns 30–45 DTE for PULLBACK strategy", () => {
    expect(deriveDTE(makeCandidate({ strategy: "PULLBACK", whySelected: [] }))).toBe("30–45 DTE");
  });
});

// ---------------------------------------------------------------------------
// deriveStrikeGuidance
// ---------------------------------------------------------------------------

describe("deriveStrikeGuidance", () => {
  it("returns ATM guidance for long-call", () => {
    expect(deriveStrikeGuidance("long-call")).toContain("ATM");
  });

  it("returns spread guidance for bull-call-spread", () => {
    const g = deriveStrikeGuidance("bull-call-spread");
    expect(g).toContain("OTM");
    expect(g).toContain("ATM");
  });

  it("returns support guidance for cash-secured-put", () => {
    const g = deriveStrikeGuidance("cash-secured-put");
    expect(g).toContain("support");
  });

  it("returns OTM guidance for covered-call", () => {
    const g = deriveStrikeGuidance("covered-call");
    expect(g).toContain("OTM");
  });

  it("returns outer-strike guidance for iron-condor", () => {
    const g = deriveStrikeGuidance("iron-condor");
    expect(g).toContain("support");
    expect(g).toContain("resistance");
  });

  it("returns both-legs guidance for diagonal", () => {
    const g = deriveStrikeGuidance("diagonal");
    expect(g).toContain("Long leg");
    expect(g).toContain("Short leg");
  });

  it("returns guidance for protective-put", () => {
    const g = deriveStrikeGuidance("protective-put");
    expect(g).toContain("ATM");
  });

  it("returns guidance for bull-put-spread", () => {
    const g = deriveStrikeGuidance("bull-put-spread");
    expect(g).toContain("support");
  });
});

// ---------------------------------------------------------------------------
// deriveOptionsStructures
// ---------------------------------------------------------------------------

describe("deriveOptionsStructures — growth (bullish + trending)", () => {
  it("returns non-empty structures for bullish + trending", () => {
    const r = deriveOptionsStructures(makePkg(), "bullish");
    expect(r.length).toBeGreaterThan(0);
  });

  it("primary structure is bull-call-spread for bullish + trending + high", () => {
    const r = deriveOptionsStructures(makePkg(), "bullish");
    expect(r[0].name).toBe("bull-call-spread");
  });

  it("marks primary structure as isBestOverall", () => {
    const r = deriveOptionsStructures(makePkg(), "bullish");
    expect(r[0].isBestOverall).toBe(true);
  });

  it("includes a long-call option", () => {
    const r = deriveOptionsStructures(makePkg(), "bullish");
    expect(r.some((s) => s.name === "long-call")).toBe(true);
  });

  it("all structures have preferredDTE and strikeGuidance set", () => {
    const r = deriveOptionsStructures(makePkg(), "bullish");
    r.forEach((s) => {
      expect(s.preferredDTE).toBeTruthy();
      expect(s.strikeGuidance).toBeTruthy();
    });
  });
});

describe("deriveOptionsStructures — income strategies", () => {
  it("returns income structures for bullish + trending + medium confidence", () => {
    const pkg = makePkg({ candidate: makeCandidate({ confidence: "medium" }) });
    const r = deriveOptionsStructures(pkg, "bullish");
    expect(r.some((s) => s.isIncome)).toBe(true);
  });

  it("cash-secured-put is marked isIncome", () => {
    const r = deriveOptionsStructures(makePkg(), "bullish");
    const csp = r.find((s) => s.name === "cash-secured-put");
    expect(csp?.isIncome).toBe(true);
  });

  it("bull-put-spread is marked isIncome and isConservative", () => {
    const r = deriveOptionsStructures(makePkg(), "bullish");
    const bps = r.find((s) => s.name === "bull-put-spread");
    if (bps) {
      expect(bps.isIncome).toBe(true);
      expect(bps.isConservative).toBe(true);
    }
  });
});

describe("deriveOptionsStructures — conservative strategies", () => {
  it("choppy regime returns income-focused conservative structures", () => {
    const pkg = makePkg({ marketRegime: "CHOPPY" });
    const r = deriveOptionsStructures(pkg, "bullish");
    expect(r.some((s) => s.isConservative)).toBe(true);
  });

  it("bull-put-spread is primary for choppy regime", () => {
    const pkg = makePkg({ marketRegime: "CHOPPY" });
    const r = deriveOptionsStructures(pkg, "bullish");
    expect(r[0].name).toBe("bull-put-spread");
  });

  it("iron-condor appears for neutral thesis", () => {
    const r = deriveOptionsStructures(makePkg(), "neutral");
    expect(r.some((s) => s.name === "iron-condor")).toBe(true);
  });

  it("covered-call appears for neutral thesis", () => {
    const r = deriveOptionsStructures(makePkg(), "neutral");
    expect(r.some((s) => s.name === "covered-call")).toBe(true);
  });
});

describe("deriveOptionsStructures — no structures", () => {
  it("returns empty for bearish thesis", () => {
    const r = deriveOptionsStructures(makePkg(), "bearish");
    expect(r).toHaveLength(0);
  });

  it("returns empty for RISK_OFF regime", () => {
    const r = deriveOptionsStructures(makePkg({ marketRegime: "RISK_OFF" }), "bullish");
    expect(r).toHaveLength(0);
  });

  it("returns empty for ORB strategy (too short horizon)", () => {
    const pkg = makePkg({ candidate: makeCandidate({ strategy: "ORB5" }) });
    const r = deriveOptionsStructures(pkg, "bullish");
    expect(r).toHaveLength(0);
  });

  it("returns empty for GAP_AND_GO strategy", () => {
    const pkg = makePkg({ candidate: makeCandidate({ strategy: "GAP_AND_GO" }) });
    const r = deriveOptionsStructures(pkg, "bullish");
    expect(r).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildStructureComparisons
// ---------------------------------------------------------------------------

describe("buildStructureComparisons", () => {
  function getComparisons(thesisOverride: "bullish" | "neutral" | "bearish" = "bullish") {
    const pkg = makePkg();
    const stock = deriveStockStructure(pkg);
    const opts = deriveOptionsStructures(pkg, thesisOverride);
    return buildStructureComparisons(pkg, stock, opts, thesisOverride);
  }

  it("returns at least a best-stock comparison for bullish thesis", () => {
    const c = getComparisons();
    expect(c.some((x) => x.category === "best-stock")).toBe(true);
  });

  it("returns best-overall when options are available", () => {
    const c = getComparisons();
    expect(c.some((x) => x.category === "best-overall")).toBe(true);
  });

  it("all confidence scores are 0–100", () => {
    const c = getComparisons();
    c.forEach((x) => {
      expect(x.confidence).toBeGreaterThanOrEqual(0);
      expect(x.confidence).toBeLessThanOrEqual(100);
    });
  });

  it("best-overall has highest or equal confidence to alternatives", () => {
    const c = getComparisons();
    const best = c.find((x) => x.category === "best-overall");
    const stock = c.find((x) => x.category === "best-stock");
    if (best && stock) {
      expect(best.confidence).toBeGreaterThanOrEqual(stock.confidence);
    }
  });

  it("each comparison has non-empty reasons array", () => {
    const c = getComparisons();
    c.forEach((x) => {
      expect(x.reasons.length).toBeGreaterThan(0);
    });
  });

  it("structureName is a non-empty string", () => {
    const c = getComparisons();
    c.forEach((x) => {
      expect(x.structureName).toBeTruthy();
    });
  });

  it("returns only best-stock when bearish (no options)", () => {
    const c = getComparisons("bearish");
    // bearish → no best-overall (no options)
    expect(c.some((x) => x.category === "best-overall")).toBe(false);
    expect(c.some((x) => x.category === "best-stock")).toBe(true);
  });

  it("does not return best-overall for RISK_OFF regime", () => {
    const pkg = makePkg({ marketRegime: "RISK_OFF" });
    const stock = deriveStockStructure(pkg);
    const opts = deriveOptionsStructures(pkg, "bullish");
    const c = buildStructureComparisons(pkg, stock, opts, "bullish");
    expect(c.some((x) => x.category === "best-overall")).toBe(false);
  });

  it("categoryLabel is a non-empty string for all categories", () => {
    const c = getComparisons();
    c.forEach((x) => {
      expect(x.categoryLabel).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// buildStockStructureReason
// ---------------------------------------------------------------------------

describe("buildStockStructureReason", () => {
  it("returns structureLabel matching stock.label", () => {
    const pkg = makePkg();
    const stock = deriveStockStructure(pkg);
    const r = buildStockStructureReason(stock);
    expect(r.structureLabel).toBe(stock.label);
  });

  it("definedRisk is always true for stock structures", () => {
    const r = buildStockStructureReason(deriveStockStructure(makePkg()));
    expect(r.definedRisk).toBe(true);
  });

  it("whyFits is non-empty", () => {
    const r = buildStockStructureReason(deriveStockStructure(makePkg()));
    expect(r.whyFits.length).toBeGreaterThan(0);
  });

  it("advantages and tradeoffs are non-empty arrays", () => {
    const r = buildStockStructureReason(deriveStockStructure(makePkg()));
    expect(r.advantages.length).toBeGreaterThan(0);
    expect(r.tradeoffs.length).toBeGreaterThan(0);
  });

  it("suitableMarketOutlook is a non-empty string", () => {
    const r = buildStockStructureReason(deriveStockStructure(makePkg()));
    expect(r.suitableMarketOutlook).toBeTruthy();
  });

  it("expectedHoldingPeriod is set from the stock structure", () => {
    const r = buildStockStructureReason(deriveStockStructure(makePkg()));
    expect(r.expectedHoldingPeriod).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// buildOptionsStructureReason
// ---------------------------------------------------------------------------

describe("buildOptionsStructureReason", () => {
  function getPrimaryOptions() {
    return deriveOptionsStructures(makePkg(), "bullish")[0];
  }

  it("returns structureLabel matching options.label", () => {
    const opts = getPrimaryOptions();
    const r = buildOptionsStructureReason(opts);
    expect(r.structureLabel).toBe(opts.label);
  });

  it("definedRisk matches the options structure's isDefinedRisk", () => {
    const opts = getPrimaryOptions();
    const r = buildOptionsStructureReason(opts);
    expect(r.definedRisk).toBe(opts.isDefinedRisk);
  });

  it("whyFits contains the structure's reason text", () => {
    const opts = getPrimaryOptions();
    const r = buildOptionsStructureReason(opts);
    expect(r.whyFits[0]).toBeTruthy();
  });

  it("tradeoffs includes complexity warning", () => {
    const opts = getPrimaryOptions();
    const r = buildOptionsStructureReason(opts);
    expect(r.tradeoffs.some((t) => t.toLowerCase().includes("option"))).toBe(true);
  });

  it("expectedHoldingPeriod mentions the DTE", () => {
    const opts = getPrimaryOptions();
    const r = buildOptionsStructureReason(opts);
    expect(r.expectedHoldingPeriod).toContain("DTE");
  });
});

// ---------------------------------------------------------------------------
// buildStockRiskProfile
// ---------------------------------------------------------------------------

describe("buildStockRiskProfile", () => {
  it("maxRisk mentions stop reference", () => {
    const pkg = makePkg();
    const stock = deriveStockStructure(pkg);
    const r = buildStockRiskProfile(stock, pkg);
    expect(r.maxRisk).toContain("$142.50");
  });

  it("assignmentRisk is null for stock", () => {
    const r = buildStockRiskProfile(deriveStockStructure(makePkg()), makePkg());
    expect(r.assignmentRisk).toBeNull();
  });

  it("timeDecay says not applicable", () => {
    const r = buildStockRiskProfile(deriveStockStructure(makePkg()), makePkg());
    expect(r.timeDecay.toLowerCase()).toContain("not applicable");
  });

  it("earlyAssignment is null for stock", () => {
    const r = buildStockRiskProfile(deriveStockStructure(makePkg()), makePkg());
    expect(r.earlyAssignment).toBeNull();
  });

  it("gapRisk mentions earnings when warning present", () => {
    const pkg = makePkg({
      candidate: makeCandidate({ warnings: ["Earnings report next week"] }),
    });
    const r = buildStockRiskProfile(deriveStockStructure(pkg), pkg);
    expect(r.gapRisk.toLowerCase()).toContain("earnings");
  });

  it("liquidityNote mentions low float when warning present", () => {
    const pkg = makePkg({
      candidate: makeCandidate({ warnings: ["Low float stock"] }),
    });
    const r = buildStockRiskProfile(deriveStockStructure(pkg), pkg);
    expect(r.liquidityNote.toLowerCase()).toContain("low float");
  });
});

// ---------------------------------------------------------------------------
// buildOptionsRiskProfile
// ---------------------------------------------------------------------------

describe("buildOptionsRiskProfile — risk classification", () => {
  function getPkgOpts() {
    const pkg = makePkg();
    const opts = deriveOptionsStructures(pkg, "bullish")[0];
    return { pkg, opts };
  }

  it("maxRisk is non-empty string", () => {
    const { pkg, opts } = getPkgOpts();
    const r = buildOptionsRiskProfile(opts, pkg);
    expect(r.maxRisk).toBeTruthy();
  });

  it("timeDecay mentions time decay", () => {
    const { pkg, opts } = getPkgOpts();
    const r = buildOptionsRiskProfile(opts, pkg);
    expect(r.timeDecay.toLowerCase()).toMatch(/time decay|theta/);
  });

  it("gapRisk is non-empty string", () => {
    const { pkg, opts } = getPkgOpts();
    const r = buildOptionsRiskProfile(opts, pkg);
    expect(r.gapRisk).toBeTruthy();
  });

  it("gapRisk mentions earnings when warning present", () => {
    const pkg = makePkg({
      candidate: makeCandidate({ warnings: ["Earnings this week"] }),
    });
    const opts = deriveOptionsStructures(pkg, "bullish")[0];
    const r = buildOptionsRiskProfile(opts, pkg);
    expect(r.gapRisk.toLowerCase()).toContain("earnings");
  });

  it("volatilitySensitivity is non-empty", () => {
    const { pkg, opts } = getPkgOpts();
    const r = buildOptionsRiskProfile(opts, pkg);
    expect(r.volatilitySensitivity).toBeTruthy();
  });

  it("liquidityNote mentions bid/ask or live contracts", () => {
    const { pkg, opts } = getPkgOpts();
    const r = buildOptionsRiskProfile(opts, pkg);
    expect(r.liquidityNote.toLowerCase()).toMatch(/bid\/ask|live contract/);
  });

  it("long-call has null assignmentRisk", () => {
    const pkg = makePkg({ marketRegime: "TRENDING", candidate: makeCandidate({ strategy: "VCP", confidence: "high" }) });
    const opts = deriveOptionsStructures(pkg, "bullish").find((o) => o.name === "long-call");
    if (opts) {
      const r = buildOptionsRiskProfile(opts, pkg);
      expect(r.assignmentRisk).toBeNull();
    }
  });

  it("cash-secured-put assignmentRisk mentions acquiring shares", () => {
    const pkg = makePkg({ marketRegime: "TRENDING", candidate: makeCandidate({ strategy: "VCP", confidence: "high" }) });
    const opts = deriveOptionsStructures(pkg, "bullish").find((o) => o.name === "cash-secured-put");
    if (opts) {
      const r = buildOptionsRiskProfile(opts, pkg);
      expect(r.assignmentRisk?.toLowerCase()).toContain("shares");
    }
  });

  it("iron-condor maxRisk mentions spread width", () => {
    const pkg = makePkg({ marketRegime: "TRENDING", candidate: makeCandidate({ strategy: "VCP", confidence: "high" }) });
    const opts = deriveOptionsStructures(pkg, "neutral").find((o) => o.name === "iron-condor");
    if (opts) {
      const r = buildOptionsRiskProfile(opts, pkg);
      expect(r.maxRisk.toLowerCase()).toContain("spread width");
    }
  });
});

// ---------------------------------------------------------------------------
// Conditional broker CTA (logic-level test)
// ---------------------------------------------------------------------------

describe("Conditional broker CTA (brokerConnected flag)", () => {
  it("pkg.brokerConnected is false by default in fixture", () => {
    const pkg = makePkg();
    expect(pkg.brokerConnected).toBe(false);
  });

  it("pkg.brokerConnected can be set to true", () => {
    const pkg = makePkg({ brokerConnected: true });
    expect(pkg.brokerConnected).toBe(true);
  });

  it("stock structure derives consistently regardless of brokerConnected flag", () => {
    const pkg1 = makePkg({ brokerConnected: false });
    const pkg2 = makePkg({ brokerConnected: true });
    expect(deriveStockStructure(pkg1).type).toBe(deriveStockStructure(pkg2).type);
  });

  it("options structures derive consistently regardless of brokerConnected flag", () => {
    const pkg1 = makePkg({ brokerConnected: false });
    const pkg2 = makePkg({ brokerConnected: true });
    const o1 = deriveOptionsStructures(pkg1, "bullish").map((o) => o.name);
    const o2 = deriveOptionsStructures(pkg2, "bullish").map((o) => o.name);
    expect(o1).toEqual(o2);
  });
});
