import { describe, it, expect } from "vitest";
import {
  askRoute,
  QUICK_ACTIONS,
  normalizeOppStage,
  stageCtas,
  summarizePositions,
  toHomeOpportunities,
  CANDIDATE_LABELS,
  radarInstrumentType,
  filterRadarCandidates,
  sortRadarCandidates,
  greetingForHour,
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
  it("core actions route into Ask AI / Scanner with the spec intents", () => {
    const byId = Object.fromEntries(QUICK_ACTIONS.map((a) => [a.id, a]));
    expect(byId["income"].href).toBe("/ask?q=Find%20income%20opportunities");
    expect(byId["scan"].href).toBe("/scanner");
    // Analyze a Stock prefills the command bar — no hardcoded ticker anywhere
    expect(byId["analyze"].href).toBe("");
    for (const a of QUICK_ACTIONS) expect(a.event.startsWith("home_")).toBe(true);
  });
  it("market-wide actions route into Ask AI with ranking intents (no hardcoded tickers)", () => {
    const byId = Object.fromEntries(QUICK_ACTIONS.map((a) => [a.id, a]));
    // These questions are market-wide (no symbol) so the server routes them
    // to the deterministic rank_market_trade_candidates flow.
    expect(byId["find-best"].href).toBe("/ask?q=Find%20the%20best%20trades%20today");
    expect(byId["find-bullish"].href).toBe("/ask?q=Find%20bullish%20trades");
    expect(byId["find-stock"].href).toBe("/ask?q=Find%20a%20stock%20trade");
    expect(byId["find-options"].href).toBe("/ask?q=Find%20an%20options%20trade");
    expect(byId["find-credit-spread"].href).toBe("/ask?q=Find%20a%20credit%20spread");
    expect(byId["find-small-risk"].href).toBe("/ask?q=Find%20a%20trade%20under%20%24500%20max%20loss");
    // no hardcoded ticker symbols in any quick-action query
    for (const a of QUICK_ACTIONS) expect(a.href).not.toMatch(/\b(NVDA|AAPL|TSLA|MU|SPY)\b/);
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
    expect(opps[0]).toEqual({ symbol: "CRDO", stage: "pivot-ready", price: 91.2, priceIsCurrent: false, note: "VCP Breakout", detectedAt: "2026-07-30T12:00:00Z" });
    expect(opps[2].stage).toBeNull(); // never inferred from score or invented
    expect(opps[2].price).toBeNull();
    expect(toHomeOpportunities(rows, 2)).toHaveLength(2);
    expect(toHomeOpportunities(undefined)).toEqual([]);
  });

  it("prefers server-enriched currentPrice over stale detectedPrice", () => {
    const rows = [
      { symbol: "MSFT", stageAtDetection: "pivot-ready", detectedPrice: 463.89, currentPrice: 484.95, strategyName: "Volume Surge", detectedAt: "2026-08-01T12:00:00Z" },
      { symbol: "OKTA", stageAtDetection: "contraction", detectedPrice: 140.66, currentPrice: 0, detectedAt: "2026-08-01T12:00:00Z" },
      { symbol: "PYPL", stageAtDetection: "contraction", detectedPrice: 57.27, currentPrice: "bad", detectedAt: "2026-08-01T12:00:00Z" },
    ];
    const opps = toHomeOpportunities(rows);
    expect(opps[0].price).toBe(484.95);
    expect(opps[0].priceIsCurrent).toBe(true);
    // zero / invalid enrichment values never override the labeled detection price
    expect(opps[1].price).toBe(140.66);
    expect(opps[1].priceIsCurrent).toBe(false);
    expect(opps[2].price).toBe(57.27);
    expect(opps[2].priceIsCurrent).toBe(false);
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

describe("home radar filter/sort", () => {
  const c = (symbol: string, strategyType: string, rank: number, entry: number, companyName?: string) =>
    ({ symbol, strategyType, rank, entry, companyName });
  const list = [
    c("NVDA", "stock_swing", 1, 180, "NVIDIA"),
    c("AAPL", "long_call", 2, 230, "Apple"),
    c("MU", "debit_spread", 3, 120, "Micron"),
    c("AMD", "cash_secured_put", 4, 160, "Advanced Micro Devices"),
  ];

  it("buckets instruments: stock vs options vs spreads", () => {
    expect(radarInstrumentType("stock_swing")).toBe("stock");
    expect(radarInstrumentType("debit_spread")).toBe("spreads");
    expect(radarInstrumentType("long_call")).toBe("options");
    expect(radarInstrumentType("covered_call")).toBe("options");
  });

  it("filters by type; 'all' passes everything through", () => {
    expect(filterRadarCandidates(list, "all")).toHaveLength(4);
    expect(filterRadarCandidates(list, "stock").map((x) => x.symbol)).toEqual(["NVDA"]);
    expect(filterRadarCandidates(list, "options").map((x) => x.symbol)).toEqual(["AAPL", "AMD"]);
    expect(filterRadarCandidates(list, "spreads").map((x) => x.symbol)).toEqual(["MU"]);
  });

  it("sorts by rank, price (both directions), and name", () => {
    expect(sortRadarCandidates(list, "rank").map((x) => x.symbol)).toEqual(["NVDA", "AAPL", "MU", "AMD"]);
    expect(sortRadarCandidates(list, "price_asc").map((x) => x.symbol)).toEqual(["MU", "AMD", "NVDA", "AAPL"]);
    expect(sortRadarCandidates(list, "price_desc").map((x) => x.symbol)).toEqual(["AAPL", "NVDA", "AMD", "MU"]);
    expect(sortRadarCandidates(list, "name").map((x) => x.symbol)).toEqual(["AMD", "AAPL", "MU", "NVDA"]);
  });

  it("candidates without a usable entry price sink to the end of price sorts", () => {
    const withBad = [...list, c("ZZZ", "long_put", 5, NaN)];
    expect(sortRadarCandidates(withBad, "price_asc").at(-1)!.symbol).toBe("ZZZ");
    expect(sortRadarCandidates(withBad, "price_desc").at(-1)!.symbol).toBe("ZZZ");
  });

  it("does not mutate the input array", () => {
    const copy = [...list];
    sortRadarCandidates(list, "price_asc");
    expect(list).toEqual(copy);
  });
});

describe("greetingForHour", () => {
  it("maps local hours to the right greeting", () => {
    expect(greetingForHour(5)).toBe("Good morning");
    expect(greetingForHour(9)).toBe("Good morning");
    expect(greetingForHour(11)).toBe("Good morning");
    expect(greetingForHour(12)).toBe("Good afternoon");
    expect(greetingForHour(16)).toBe("Good afternoon");
    expect(greetingForHour(17)).toBe("Good evening");
    expect(greetingForHour(23)).toBe("Good evening");
    expect(greetingForHour(0)).toBe("Good evening");
    expect(greetingForHour(4)).toBe("Good evening");
  });
});

describe("quick actions carry research-oriented descriptions", () => {
  it("every action has a concise description", () => {
    for (const a of QUICK_ACTIONS) {
      expect(a.description.length).toBeGreaterThan(10);
      expect(a.description.toLowerCase()).not.toContain("recommend");
    }
  });
});
