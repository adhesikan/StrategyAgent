import { describe, it, expect } from "vitest";
import {
  askRoute,
  QUICK_ACTIONS,
  normalizeOppStage,
  stageCtas,
  summarizePositions,
  toHomeOpportunities,
  CANDIDATE_LABELS,
} from "./command-center";

describe("askRoute — AI command routes into the existing Ask AI page", () => {
  it("encodes the query", () => {
    expect(askRoute("Analyze MU")).toBe("/ask?q=Analyze%20MU");
    expect(askRoute("  Find income opportunities  ")).toBe("/ask?q=Find%20income%20opportunities");
  });
  it("empty query goes to bare /ask", () => {
    expect(askRoute("")).toBe("/ask");
    expect(askRoute("   ")).toBe("/ask");
  });
});

describe("QUICK_ACTIONS", () => {
  it("Find Trades and Generate Income route into Ask AI with the spec intents", () => {
    const byId = Object.fromEntries(QUICK_ACTIONS.map((a) => [a.id, a]));
    expect(byId["find-trades"].href).toBe("/ask?q=Find%20high-quality%20trade%20opportunities");
    expect(byId["income"].href).toBe("/ask?q=Find%20income%20opportunities");
    expect(byId["scan"].href).toBe("/scanner");
    // Analyze a Stock prefills the command bar — no hardcoded ticker anywhere
    expect(byId["analyze"].href).toBe("");
    for (const a of QUICK_ACTIONS) expect(a.event.startsWith("home_")).toBe(true);
  });
});

describe("normalizeOppStage", () => {
  it("maps stored stage variants to standard stages", () => {
    expect(normalizeOppStage("pivot-ready")).toBe("pivot-ready");
    expect(normalizeOppStage("Pivot Ready")).toBe("pivot-ready");
    expect(normalizeOppStage("base_building")).toBe("developing");
    expect(normalizeOppStage("no-setup")).toBe("no-setup");
    expect(normalizeOppStage("unknown-thing")).toBeNull();
    expect(normalizeOppStage(null)).toBeNull();
  });
});

describe("stageCtas — setup-aware actions", () => {
  const labels = (stage: Parameters<typeof stageCtas>[0]) => stageCtas(stage, "mu").map((c) => c.label);

  it("no-setup / early / unknown never emphasize Trade Builder", () => {
    for (const stage of ["no-setup", "early", null] as const) {
      const l = labels(stage);
      expect(l.join("|")).not.toContain("Trade Builder");
      expect(l).toContain("Analyze");
      expect(l).toContain("Watch");
      expect(l).toContain("Open Scanner");
    }
  });
  it("developing: Analyze / View Chart / Open Scanner", () => {
    expect(labels("developing")).toEqual(["Analyze", "View Chart", "Open Scanner"]);
  });
  it("contraction: Analyze / View Setup / View Chart, no Trade Builder", () => {
    expect(labels("contraction")).toEqual(["Analyze", "View Setup", "View Chart"]);
  });
  it("pivot-ready may expose Trade Builder navigation", () => {
    const ctas = stageCtas("pivot-ready", "NVDA");
    expect(ctas.map((c) => c.label)).toEqual(["Analyze", "View Setup", "Open Trade Builder"]);
    expect(ctas[2].href).toBe("/trade/NVDA");
    expect(ctas[0].href).toBe("/ask?q=Analyze%20NVDA");
  });
});

describe("summarizePositions — defensive, never fabricates totals", () => {
  it("sums only when every position reports the field", () => {
    const s = summarizePositions([
      { symbol: "A", marketValue: 100, unrealizedPnl: 5 },
      { symbol: "B", marketValue: 200, unrealizedPnl: -2 },
    ]);
    expect(s).toEqual({ positionCount: 2, totalMarketValue: 300, totalUnrealizedPnl: 3 });
  });
  it("returns null totals when data is partial or empty", () => {
    expect(summarizePositions([{ symbol: "A", marketValue: 100 }, { symbol: "B" }]).totalMarketValue).toBeNull();
    expect(summarizePositions([]).totalMarketValue).toBeNull();
    expect(summarizePositions(undefined).positionCount).toBe(0);
  });
});

describe("toHomeOpportunities — real scanner data only", () => {
  it("maps rows and caps the list", () => {
    const rows = [
      { symbol: "crdo", stageAtDetection: "pivot-ready", detectedPrice: 91.2, strategyName: "VCP Breakout", detectedAt: "2026-07-30T12:00:00Z" },
      { symbol: "NVDA", stageAtDetection: "contraction", detectedPrice: 182.4, strategyName: "VCP", detectedAt: "2026-07-30T12:00:00Z" },
      { symbol: "MU", stageAtDetection: "weird", detectedPrice: null },
    ];
    const opps = toHomeOpportunities(rows);
    expect(opps).toHaveLength(3);
    expect(opps[0]).toEqual({ symbol: "CRDO", stage: "pivot-ready", price: 91.2, note: "VCP Breakout", detectedAt: "2026-07-30T12:00:00Z" });
    expect(opps[2].stage).toBeNull(); // never inferred from score or invented
    expect(opps[2].price).toBeNull();
    expect(toHomeOpportunities(rows, 2)).toHaveLength(2);
    expect(toHomeOpportunities(undefined)).toEqual([]);
  });
});

describe("future trade-candidate readiness", () => {
  it("exposes the three future states without generating them", () => {
    expect(CANDIDATE_LABELS.stockCandidate).toBe("Stock Candidate");
    expect(CANDIDATE_LABELS.optionsCandidate).toBe("Options Candidate");
    expect(CANDIDATE_LABELS.noTrade).toBe("No Trade");
    // toHomeOpportunities never sets candidateState from current data
    const opps = toHomeOpportunities([{ symbol: "X", stageAtDetection: "pivot-ready" }]);
    expect(opps[0]).not.toHaveProperty("candidateState");
  });
});
