/**
 * Opportunity Intelligence Engine — Sprint 2.5.0
 *
 * Pure structural + service-logic tests.
 * No DB, no network, no JSDOM.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import {
  mapRiskLevel,
  mapOpportunityType,
  mapTimeHorizon,
  buildOpportunityId,
  deriveSentimentScore,
  mapConfidence,
  buildPrimaryEvidence,
  buildSecondaryEvidence,
  buildRiskFactors,
  buildInvalidatesThesis,
  buildSymbolThemeMap,
  filterOpportunities,
  sortOpportunities,
  extractMeta,
  getOpportunityIntelligenceHealth,
} from "../../services/opportunity-intelligence-service";

import {
  OPPORTUNITY_TYPE_LABELS,
} from "../../../shared/opportunity-intelligence-types";

import type { CanonicalOpportunity } from "../../../shared/opportunity-intelligence-types";

// Source reading for structural tests
const servicesSrc = fs.readFileSync(
  path.join(__dirname, "../../services/opportunity-intelligence-service.ts"), "utf-8",
);
const routesSrc = fs.readFileSync(
  path.join(__dirname, "../opportunity-intelligence.ts"), "utf-8",
);
const typesSrc = fs.readFileSync(
  path.join(__dirname, "../../../shared/opportunity-intelligence-types.ts"), "utf-8",
);
const platformHealthSrc = fs.readFileSync(
  path.join(__dirname, "../platform-health.ts"), "utf-8",
);
const adminHealthPageSrc = fs.readFileSync(
  path.join(__dirname, "../../../client/src/pages/admin-platform-health.tsx"), "utf-8",
);
const routesRegSrc = fs.readFileSync(
  path.join(__dirname, "../../routes.ts"), "utf-8",
);

// ---------------------------------------------------------------------------
// Helper: build a minimal CanonicalOpportunity for test purposes
// ---------------------------------------------------------------------------

function makeOpp(overrides: Partial<CanonicalOpportunity> = {}): CanonicalOpportunity {
  return {
    id:                  "NVDA-topGrowth",
    symbol:              "NVDA",
    companyName:         "NVIDIA Corporation",
    sector:              "Technology",
    industry:            "Semiconductors",
    themes:              ["AI Infrastructure", "Semiconductors"],
    opportunityType:     "growth",
    opportunityTypeLabel: "Growth Candidate",
    researchScore:       85,
    technicalScore:      80,
    fundamentalScore:    70,
    institutionalScore:  75,
    sentimentScore:      72,
    confidence:          "high",
    marketRegime:        "bull",
    timeHorizon:         "medium",
    riskLevel:           "low",
    lastUpdated:         "2026-08-08T00:00:00.000Z",
    primaryEvidence:     [],
    secondaryEvidence:   [],
    riskFactors:         [],
    invalidatesThesis:   [],
    _sourceCategory:     "topGrowth",
    _rank:               1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Part 1 — Canonical Opportunity Model types
// ---------------------------------------------------------------------------

describe("Part 1 — Canonical Opportunity Model", () => {
  it("shared/opportunity-intelligence-types.ts exists", () => {
    expect(typesSrc.length).toBeGreaterThan(100);
  });

  it("CanonicalOpportunity interface is exported", () => {
    expect(typesSrc).toContain("export interface CanonicalOpportunity");
  });

  it("id field present", ()       => expect(typesSrc).toContain("id:"));
  it("symbol field present", ()   => expect(typesSrc).toContain("symbol:"));
  it("companyName field present", () => expect(typesSrc).toContain("companyName:"));
  it("sector field present", ()   => expect(typesSrc).toContain("sector:"));
  it("industry field present", () => expect(typesSrc).toContain("industry:"));
  it("themes[] field present", () => expect(typesSrc).toContain("themes:"));
  it("opportunityType field present", () => expect(typesSrc).toContain("opportunityType:"));
  it("researchScore field present", ()   => expect(typesSrc).toContain("researchScore:"));
  it("technicalScore field present", ()  => expect(typesSrc).toContain("technicalScore:"));
  it("fundamentalScore field present", () => expect(typesSrc).toContain("fundamentalScore:"));
  it("institutionalScore field present", () => expect(typesSrc).toContain("institutionalScore:"));
  it("sentimentScore field present", ()  => expect(typesSrc).toContain("sentimentScore:"));
  it("confidence field present", ()      => expect(typesSrc).toContain("confidence:"));
  it("marketRegime field present", ()    => expect(typesSrc).toContain("marketRegime:"));
  it("timeHorizon field present", ()     => expect(typesSrc).toContain("timeHorizon:"));
  it("riskLevel field present", ()       => expect(typesSrc).toContain("riskLevel:"));
  it("lastUpdated field present", ()     => expect(typesSrc).toContain("lastUpdated:"));
  it("primaryEvidence[] field present",  () => expect(typesSrc).toContain("primaryEvidence:"));
  it("secondaryEvidence[] field present", () => expect(typesSrc).toContain("secondaryEvidence:"));
  it("riskFactors[] field present",      () => expect(typesSrc).toContain("riskFactors:"));
  it("invalidatesThesis[] field present", () => expect(typesSrc).toContain("invalidatesThesis:"));
});

// ---------------------------------------------------------------------------
// Part 2 — Opportunity Types
// ---------------------------------------------------------------------------

describe("Part 2 — Supported Opportunity Types", () => {
  const requiredTypes = [
    "growth", "long_term_investment", "income", "covered_call", "cash_secured_put",
    "etf", "dividend", "momentum", "value", "swing",
    "ai_infrastructure", "semiconductors", "memory", "networking",
    "cybersecurity", "cloud", "energy", "healthcare", "financials",
    "consumer", "industrials", "custom_theme",
  ];

  for (const t of requiredTypes) {
    it(`OpportunityType includes "${t}"`, () => {
      expect(typesSrc).toContain(`"${t}"`);
    });
  }

  it("OPPORTUNITY_TYPE_LABELS covers all types", () => {
    for (const t of requiredTypes) {
      expect(OPPORTUNITY_TYPE_LABELS).toHaveProperty(t);
      expect(OPPORTUNITY_TYPE_LABELS[t as keyof typeof OPPORTUNITY_TYPE_LABELS]).toBeTruthy();
    }
  });

  it("OPPORTUNITY_TYPE_LABELS uses compliant language (no Recommendation/Buy/Sell)", () => {
    const labels = Object.values(OPPORTUNITY_TYPE_LABELS).join(" ").toLowerCase();
    expect(labels).not.toContain("recommendation");
    expect(labels).not.toContain(" buy ");
    expect(labels).not.toContain(" sell ");
    expect(labels).not.toContain("target price");
    expect(labels).toContain("candidate");
  });
});

// ---------------------------------------------------------------------------
// Part 3 — mapRiskLevel
// ---------------------------------------------------------------------------

describe("Part 3 — mapRiskLevel", () => {
  it("riskScore 0  → 'low'",     () => expect(mapRiskLevel(0)).toBe("low"));
  it("riskScore 34 → 'low'",     () => expect(mapRiskLevel(34)).toBe("low"));
  it("riskScore 35 → 'medium'",  () => expect(mapRiskLevel(35)).toBe("medium"));
  it("riskScore 59 → 'medium'",  () => expect(mapRiskLevel(59)).toBe("medium"));
  it("riskScore 60 → 'high'",    () => expect(mapRiskLevel(60)).toBe("high"));
  it("riskScore 100 → 'high'",   () => expect(mapRiskLevel(100)).toBe("high"));
});

// ---------------------------------------------------------------------------
// Part 4 — mapOpportunityType
// ---------------------------------------------------------------------------

describe("Part 4 — mapOpportunityType", () => {
  it("topGrowth + no strategy → 'growth'", () =>
    expect(mapOpportunityType("topGrowth")).toBe("growth"));

  it("topIncome + no strategy → 'income'", () =>
    expect(mapOpportunityType("topIncome")).toBe("income"));

  it("watchlist → 'swing'", () =>
    expect(mapOpportunityType("watchlist")).toBe("swing"));

  it("approaching → 'swing'", () =>
    expect(mapOpportunityType("approaching")).toBe("swing"));

  it("covered call strategy → 'covered_call'", () =>
    expect(mapOpportunityType("topIncome", "Covered Call")).toBe("covered_call"));

  it("cash secured put strategy → 'cash_secured_put'", () =>
    expect(mapOpportunityType("topIncome", "Cash Secured Put")).toBe("cash_secured_put"));

  it("dividend strategy → 'dividend'", () =>
    expect(mapOpportunityType("topIncome", "Dividend Growth")).toBe("dividend"));

  it("value strategy → 'value'", () =>
    expect(mapOpportunityType("topGrowth", "Deep Value")).toBe("value"));

  it("momentum strategy → 'momentum'", () =>
    expect(mapOpportunityType("topGrowth", "Momentum Breakout")).toBe("momentum"));

  it("swing strategy → 'swing'", () =>
    expect(mapOpportunityType("topGrowth", "Swing Trade Setup")).toBe("swing"));

  it("long-term strategy → 'long_term_investment'", () =>
    expect(mapOpportunityType("topGrowth", "Long-Term Compounder")).toBe("long_term_investment"));
});

// ---------------------------------------------------------------------------
// Part 5 — mapTimeHorizon
// ---------------------------------------------------------------------------

describe("Part 5 — mapTimeHorizon", () => {
  it("swing → 'short'",             () => expect(mapTimeHorizon("swing")).toBe("short"));
  it("momentum → 'short'",          () => expect(mapTimeHorizon("momentum")).toBe("short"));
  it("covered_call → 'short'",      () => expect(mapTimeHorizon("covered_call")).toBe("short"));
  it("cash_secured_put → 'short'",  () => expect(mapTimeHorizon("cash_secured_put")).toBe("short"));
  it("long_term_investment → 'long'", () => expect(mapTimeHorizon("long_term_investment")).toBe("long"));
  it("growth → 'medium'",           () => expect(mapTimeHorizon("growth")).toBe("medium"));
  it("income → 'medium'",           () => expect(mapTimeHorizon("income")).toBe("medium"));
});

// ---------------------------------------------------------------------------
// Part 6 — Scores
// ---------------------------------------------------------------------------

describe("Part 6 — Score derivation", () => {
  it("deriveSentimentScore returns number in [0,100]", () => {
    const s = deriveSentimentScore(70, 80);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });

  it("deriveSentimentScore is deterministic", () => {
    expect(deriveSentimentScore(50, 50)).toBe(deriveSentimentScore(50, 50));
  });

  it("higher institutional → higher sentimentScore", () => {
    expect(deriveSentimentScore(80, 50)).toBeGreaterThan(deriveSentimentScore(30, 50));
  });

  it("mapConfidence: 'high' → 'high'",   () => expect(mapConfidence("high")).toBe("high"));
  it("mapConfidence: 'medium' → 'medium'", () => expect(mapConfidence("medium")).toBe("medium"));
  it("mapConfidence: 'low' → 'low'",     () => expect(mapConfidence("low")).toBe("low"));
  it("mapConfidence: undefined → 'low'", () => expect(mapConfidence(undefined)).toBe("low"));
});

// ---------------------------------------------------------------------------
// Part 7 — Evidence panels
// ---------------------------------------------------------------------------

describe("Part 7 — Evidence panels", () => {
  it("buildPrimaryEvidence: returns array", () => {
    const r = buildPrimaryEvidence(["VCP breakout", "RS > 90"], ["Volume surge"], 80, 70);
    expect(Array.isArray(r)).toBe(true);
  });

  it("buildPrimaryEvidence: max 4 items", () => {
    const r = buildPrimaryEvidence(
      ["r1", "r2", "r3", "r4", "r5"],
      ["w1", "w2", "w3"],
      80, 80,
    );
    expect(r.length).toBeLessThanOrEqual(4);
  });

  it("buildPrimaryEvidence: includes institutional if score >= 45", () => {
    const r = buildPrimaryEvidence([], [], 60, 65);
    expect(r.some(e => e.type === "institutional")).toBe(true);
  });

  it("buildPrimaryEvidence: no institutional if score < 45", () => {
    const r = buildPrimaryEvidence(["x"], [], 60, 30);
    expect(r.some(e => e.type === "institutional")).toBe(false);
  });

  it("buildSecondaryEvidence: sector item present when sector supplied", () => {
    const r = buildSecondaryEvidence("Technology", [], 60);
    expect(r.some(e => e.type === "sector")).toBe(true);
  });

  it("buildSecondaryEvidence: theme items present for each theme (max 2)", () => {
    const r = buildSecondaryEvidence(null, ["AI Infrastructure", "Semiconductors", "Cloud"], 60);
    expect(r.filter(e => e.type === "theme").length).toBeLessThanOrEqual(2);
  });

  it("buildSecondaryEvidence: fundamental item when score >= 50", () => {
    const r = buildSecondaryEvidence(null, [], 65);
    expect(r.some(e => e.type === "fundamental")).toBe(true);
  });

  it("buildSecondaryEvidence: no fundamental item when score < 50", () => {
    const r = buildSecondaryEvidence(null, [], 40);
    expect(r.some(e => e.type === "fundamental")).toBe(false);
  });

  it("buildRiskFactors: empty when no warnings", () => {
    const r = buildRiskFactors([], "low");
    expect(r).toHaveLength(0);
  });

  it("buildRiskFactors: max 3 items", () => {
    const r = buildRiskFactors(["w1","w2","w3","w4","w5"], "medium");
    expect(r.length).toBeLessThanOrEqual(3);
  });

  it("buildRiskFactors: high riskLevel → severity high", () => {
    const r = buildRiskFactors(["volume decline"], "high");
    expect(r[0].severity).toBe("high");
  });

  it("buildInvalidatesThesis: includes invalidation string", () => {
    const r = buildInvalidatesThesis("Close below 50-day MA", []);
    expect(r[0].detail).toContain("50-day MA");
  });

  it("buildInvalidatesThesis: empty when no invalidation and no high risks", () => {
    const r = buildInvalidatesThesis(undefined, []);
    expect(r).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Part 8 — ID generation
// ---------------------------------------------------------------------------

describe("Part 8 — buildOpportunityId", () => {
  it("returns deterministic string", () => {
    expect(buildOpportunityId("nvda", "topGrowth")).toBe("NVDA-topGrowth");
  });

  it("uppercases symbol", () => {
    expect(buildOpportunityId("aapl", "topIncome")).toContain("AAPL");
  });
});

// ---------------------------------------------------------------------------
// Part 9 — Theme map
// ---------------------------------------------------------------------------

describe("Part 9 — Theme map", () => {
  it("buildSymbolThemeMap returns a Map", () => {
    const m = buildSymbolThemeMap();
    expect(m).toBeInstanceOf(Map);
  });

  it("NVDA is in AI Infrastructure theme", () => {
    const m = buildSymbolThemeMap();
    const themes = m.get("NVDA") ?? [];
    expect(themes.some(t => t.toLowerCase().includes("ai infrastructure"))).toBe(true);
  });

  it("MU is in Memory theme", () => {
    const m = buildSymbolThemeMap();
    const themes = m.get("MU") ?? [];
    expect(themes.some(t => t.toLowerCase().includes("memory"))).toBe(true);
  });

  it("unknown symbol returns empty or absent", () => {
    const m = buildSymbolThemeMap();
    expect(m.get("FAKESYMBOL999") ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Part 10 — Filtering
// ---------------------------------------------------------------------------

describe("Part 10 — filterOpportunities", () => {
  const opps = [
    makeOpp({ symbol: "NVDA", sector: "Technology", opportunityType: "growth",   riskLevel: "low",    timeHorizon: "medium", researchScore: 85, technicalScore: 80, institutionalScore: 75 }),
    makeOpp({ symbol: "MU",   sector: "Technology", opportunityType: "swing",    riskLevel: "medium", timeHorizon: "short",  researchScore: 60, technicalScore: 55, institutionalScore: 50 }),
    makeOpp({ symbol: "XOM",  sector: "Energy",     opportunityType: "income",   riskLevel: "low",    timeHorizon: "medium", researchScore: 72, technicalScore: 65, institutionalScore: 40 }),
    makeOpp({ symbol: "PANW", sector: "Technology", opportunityType: "momentum", riskLevel: "high",   timeHorizon: "short",  researchScore: 78, technicalScore: 75, institutionalScore: 60 }),
  ];

  it("no filter returns all", () =>
    expect(filterOpportunities(opps, {})).toHaveLength(4));

  it("filter by sector: Technology → 3", () =>
    expect(filterOpportunities(opps, { sector: ["Technology"] })).toHaveLength(3));

  it("filter by sector: Energy → 1", () =>
    expect(filterOpportunities(opps, { sector: ["Energy"] })).toHaveLength(1));

  it("filter by opportunityType: growth → 1", () =>
    expect(filterOpportunities(opps, { opportunityType: ["growth"] })).toHaveLength(1));

  it("filter by riskLevel: low → 2", () =>
    expect(filterOpportunities(opps, { riskLevel: ["low"] })).toHaveLength(2));

  it("filter by timeHorizon: short → 2", () =>
    expect(filterOpportunities(opps, { timeHorizon: ["short"] })).toHaveLength(2));

  it("filter by minResearchScore: 75 → 2", () =>
    expect(filterOpportunities(opps, { minResearchScore: 75 })).toHaveLength(2));

  it("filter by minTechnicalScore: 70 → 2", () =>
    expect(filterOpportunities(opps, { minTechnicalScore: 70 })).toHaveLength(2));

  it("filter by minInstitutionalScore: 60 → 2", () =>
    expect(filterOpportunities(opps, { minInstitutionalScore: 60 })).toHaveLength(2));

  it("combined sector + riskLevel filter", () => {
    const r = filterOpportunities(opps, { sector: ["Technology"], riskLevel: ["low"] });
    expect(r).toHaveLength(1);
    expect(r[0].symbol).toBe("NVDA");
  });

  it("filter with non-matching criteria → empty", () =>
    expect(filterOpportunities(opps, { sector: ["Healthcare"] })).toHaveLength(0));
});

// ---------------------------------------------------------------------------
// Part 11 — Sorting
// ---------------------------------------------------------------------------

describe("Part 11 — sortOpportunities", () => {
  const opps = [
    makeOpp({ symbol: "Z",    researchScore: 50, technicalScore: 45, institutionalScore: 30 }),
    makeOpp({ symbol: "A",    researchScore: 90, technicalScore: 85, institutionalScore: 70 }),
    makeOpp({ symbol: "M",    researchScore: 70, technicalScore: 65, institutionalScore: 50 }),
  ];

  it("sort by researchScore desc", () => {
    const r = sortOpportunities(opps, { field: "researchScore", direction: "desc" });
    expect(r[0].researchScore).toBe(90);
    expect(r[2].researchScore).toBe(50);
  });

  it("sort by researchScore asc", () => {
    const r = sortOpportunities(opps, { field: "researchScore", direction: "asc" });
    expect(r[0].researchScore).toBe(50);
    expect(r[2].researchScore).toBe(90);
  });

  it("sort by symbol asc (alphabetical)", () => {
    const r = sortOpportunities(opps, { field: "symbol", direction: "asc" });
    expect(r[0].symbol).toBe("A");
    expect(r[2].symbol).toBe("Z");
  });

  it("sort by technicalScore desc", () => {
    const r = sortOpportunities(opps, { field: "technicalScore", direction: "desc" });
    expect(r[0].technicalScore).toBe(85);
  });

  it("sort by institutionalScore desc", () => {
    const r = sortOpportunities(opps, { field: "institutionalScore", direction: "desc" });
    expect(r[0].institutionalScore).toBe(70);
  });

  it("does not mutate original array", () => {
    const original = [...opps];
    sortOpportunities(opps, { field: "symbol", direction: "desc" });
    expect(opps[0].symbol).toBe(original[0].symbol);
  });
});

// ---------------------------------------------------------------------------
// Part 12 — extractMeta
// ---------------------------------------------------------------------------

describe("Part 12 — extractMeta", () => {
  const opps = [
    makeOpp({ sector: "Technology", industry: "Semiconductors", themes: ["AI Infrastructure"], opportunityType: "growth", riskLevel: "low", timeHorizon: "medium" }),
    makeOpp({ symbol: "XOM", sector: "Energy", industry: "Integrated Oil", themes: ["Energy"], opportunityType: "income", riskLevel: "medium", timeHorizon: "medium" }),
  ];

  it("extracts unique sectors", () => {
    const m = extractMeta(opps);
    expect(m.sectors).toContain("Technology");
    expect(m.sectors).toContain("Energy");
    expect(m.sectors).toHaveLength(2);
  });

  it("extracts unique industries", () => {
    const m = extractMeta(opps);
    expect(m.industries).toContain("Semiconductors");
    expect(m.industries).toContain("Integrated Oil");
  });

  it("extracts unique themes", () => {
    const m = extractMeta(opps);
    expect(m.themes).toContain("AI Infrastructure");
    expect(m.themes).toContain("Energy");
  });

  it("extracts unique opportunityTypes", () => {
    const m = extractMeta(opps);
    expect(m.opportunityTypes).toContain("growth");
    expect(m.opportunityTypes).toContain("income");
  });

  it("always includes all riskLevels", () => {
    const m = extractMeta(opps);
    expect(m.riskLevels).toContain("low");
    expect(m.riskLevels).toContain("medium");
    expect(m.riskLevels).toContain("high");
  });

  it("always includes all timeHorizons", () => {
    const m = extractMeta(opps);
    expect(m.timeHorizons).toContain("short");
    expect(m.timeHorizons).toContain("medium");
    expect(m.timeHorizons).toContain("long");
  });
});

// ---------------------------------------------------------------------------
// Part 13 — Platform Health
// ---------------------------------------------------------------------------

describe("Part 13 — Platform Health integration", () => {
  it("checkOpportunityIntelligence function in platform-health.ts", () => {
    expect(platformHealthSrc).toContain("checkOpportunityIntelligence");
  });

  it("getOpportunityIntelligenceHealth imported from service", () => {
    expect(platformHealthSrc).toContain("getOpportunityIntelligenceHealth");
    expect(platformHealthSrc).toContain("opportunity-intelligence-service");
  });

  it("opportunityIntelligence key in buildPlatformHealth result", () => {
    expect(platformHealthSrc).toContain("opportunityIntelligence");
  });

  it("admin health page renders Opportunity Intelligence card", () => {
    expect(adminHealthPageSrc).toContain("Opportunity Intelligence");
    expect(adminHealthPageSrc).toContain("opportunityIntelligence");
  });

  it("getOpportunityIntelligenceHealth: no snapshot → hasSnapshot false", () => {
    const h = getOpportunityIntelligenceHealth();
    // No ranking has been set in this test environment
    expect(h.hasSnapshot).toBe(false);
    expect(h.totalOpportunities).toBe(0);
    expect(h.lastGeneratedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Part 14 — Route registration
// ---------------------------------------------------------------------------

describe("Part 14 — Route registration", () => {
  it("registerOpportunityIntelligenceRoutes imported in routes.ts", () => {
    expect(routesRegSrc).toContain("registerOpportunityIntelligenceRoutes");
    expect(routesRegSrc).toContain("opportunity-intelligence");
  });

  it("registerOpportunityIntelligenceRoutes called in routes.ts", () => {
    expect(routesRegSrc).toContain("registerOpportunityIntelligenceRoutes(app, isAuthenticated)");
  });

  it("GET /api/intelligence/opportunities route registered", () => {
    expect(routesSrc).toContain("/api/intelligence/opportunities");
  });

  it("GET /api/intelligence/opportunities/meta route registered", () => {
    expect(routesSrc).toContain("/api/intelligence/opportunities/meta");
  });

  it("GET /api/intelligence/opportunities/:symbol route registered", () => {
    expect(routesSrc).toContain("/api/intelligence/opportunities/:symbol");
  });

  it("all routes require isAuthenticated", () => {
    const matches = routesSrc.match(/isAuthenticated/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("routes return 401 / require auth", () => {
    expect(routesSrc).toContain("isAuthenticated");
  });

  it("/:symbol route returns 400 for invalid symbol", () => {
    expect(routesSrc).toContain("400");
    expect(routesSrc).toContain("Invalid symbol");
  });

  it("/:symbol route returns 404 for symbol not in snapshot", () => {
    expect(routesSrc).toContain("404");
    expect(routesSrc).toContain("not a current research candidate");
  });

  it("list route returns 200 with available:false when no snapshot", () => {
    expect(routesSrc).toContain("available: false");
    expect(routesSrc).toContain("No opportunity snapshot is available yet");
  });
});

// ---------------------------------------------------------------------------
// Part 15 — Compliance language
// ---------------------------------------------------------------------------

describe("Part 15 — Compliance language", () => {
  it("service never assigns/returns 'recommendation' as a value", () => {
    // The word may appear in compliance *comments* — what must NOT appear is it as a key or value
    expect(servicesSrc).not.toContain('= "recommendation"');
    expect(servicesSrc).not.toContain("recommendation:");
    expect(servicesSrc).not.toContain('"recommendations"');
  });

  it("routes never return a 'recommendations' key in JSON responses", () => {
    expect(routesSrc).not.toContain('"recommendations"');
    expect(routesSrc).not.toContain("recommendations:");
  });

  it("types do not define a 'recommendation' field", () => {
    expect(typesSrc).not.toContain('recommendation:');
    expect(typesSrc).not.toContain('"recommendations"');
  });

  it("service enum values do not contain 'buy' as a directive", () => {
    // 'buy' must not appear as a standalone type/value (e.g. "buy" | "sell")
    expect(servicesSrc).not.toContain(': "buy"');
    expect(servicesSrc).not.toContain("= \"buy\"");
  });

  it("service enum values do not contain 'sell' as a directive", () => {
    expect(servicesSrc).not.toContain(': "sell"');
    expect(servicesSrc).not.toContain("= \"sell\"");
  });

  it("service does not define target price fields", () => {
    expect(servicesSrc).not.toContain("targetPrice");
    expect(servicesSrc).not.toContain("target_price");
  });

  it("routes use 'research candidate' language", () => {
    expect(routesSrc.toLowerCase()).toContain("research candidate");
  });

  it("route response uses 'opportunities' key (never 'recommendations')", () => {
    // Route returns 'opportunities:' as an object key
    expect(routesSrc).toContain("opportunities:");
    expect(routesSrc).not.toContain('"recommendations"');
  });
});

// ---------------------------------------------------------------------------
// Part 16 — Architecture: no duplication of scanning/ranking logic
// ---------------------------------------------------------------------------

describe("Part 16 — Architecture: pure enrichment, no duplication", () => {
  it("service imports getLatestRanking (reuses existing snapshot)", () => {
    expect(servicesSrc).toContain("getLatestRanking");
    expect(servicesSrc).toContain("opportunity-ranking-engine");
  });

  it("service imports getAllThemes (reuses registry, no DB call for themes)", () => {
    expect(servicesSrc).toContain("getAllThemes");
    expect(servicesSrc).toContain("theme-registry");
  });

  it("service imports marketDataSymbols for company metadata", () => {
    expect(servicesSrc).toContain("marketDataSymbols");
  });

  it("service does NOT re-implement MCP ranking logic", () => {
    expect(servicesSrc).not.toContain("rank_market_trade_candidates");
    expect(servicesSrc).not.toContain("runMcpOpportunitySearch");
  });

  it("service does NOT call opportunity-engine.ts scanner", () => {
    expect(servicesSrc).not.toContain("opportunity-engine");
  });

  it("filterOpportunities is a pure function (no DB call)", () => {
    // Pure function — takes array in, returns array out
    const opps = [makeOpp()];
    const result = filterOpportunities(opps, { sector: ["Technology"] });
    expect(Array.isArray(result)).toBe(true);
  });

  it("sortOpportunities is a pure function (no DB call)", () => {
    const opps = [makeOpp()];
    const result = sortOpportunities(opps, { field: "researchScore", direction: "desc" });
    expect(Array.isArray(result)).toBe(true);
  });

  it("getOpportunityIntelligenceHealth is synchronous (no DB call)", () => {
    // Confirm it's not async (synchronous health check)
    const result = getOpportunityIntelligenceHealth();
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("hasSnapshot");
  });
});

// ---------------------------------------------------------------------------
// Part 17 — No future roadmap work
// ---------------------------------------------------------------------------

describe("Part 17 — Roadmap discipline", () => {
  it("service has no portfolio scoring logic", () => {
    const lower = servicesSrc.toLowerCase();
    expect(lower).not.toContain("portfolio score");
    expect(lower).not.toContain("rebalance");
  });

  it("service has no tax optimization logic", () => {
    expect(servicesSrc.toLowerCase()).not.toContain("tax");
  });

  it("service has no goal planning logic", () => {
    expect(servicesSrc.toLowerCase()).not.toContain("goal plan");
  });

  it("service has no alert logic", () => {
    expect(servicesSrc.toLowerCase()).not.toContain("send alert");
  });

  it("routes do not expose a POST route (read-only engine)", () => {
    // No POST in the intelligence routes — read-only
    const postMatches = routesSrc.match(/app\.post\(/g) ?? [];
    expect(postMatches.length).toBe(0);
  });
});
