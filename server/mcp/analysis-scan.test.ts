// Tests for the deterministic scan_vcp path used by stock-analysis asks.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ENV_KEYS = ["MCP_ENABLED", "MCP_BASE_URL", "MCP_SERVICE_TOKEN", "MCP_TIMEOUT_MS"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
  vi.doUnmock("./tools");
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

function enableMcp() {
  process.env.MCP_ENABLED = "true";
  process.env.MCP_BASE_URL = "https://mcp.example.com";
  process.env.MCP_SERVICE_TOKEN = "test-token";
}

async function withMockedScan(impl?: () => Promise<unknown>) {
  const scanVcp = vi.fn(impl ?? (async () => ({ symbol: "MU", score: 87, setupDetected: true })));
  vi.doMock("./tools", () => ({ scanVcp }));
  const mod = await import("./analysis-scan");
  return { mod, scanVcp };
}

describe("stock-analysis intent detection", () => {
  it("matches the spec's analysis phrasings", async () => {
    const { isStockAnalysisAsk } = await import("./analysis-scan");
    for (const q of [
      "Analyze MU",
      "Analyze NVDA",
      "How does CRDO look?",
      "Give me a technical analysis of AVGO",
      "What's the setup on MU?",
      "Evaluate MU",
    ]) {
      expect(isStockAnalysisAsk(q), q).toBe(true);
    }
  });

  it("does not match non-analysis questions", async () => {
    const { isStockAnalysisAsk } = await import("./analysis-scan");
    for (const q of [
      "What is a covered call?",
      "Any news on MU today?",
      "Find me a good option trade on NVDA",
      "Why is the market down?",
    ]) {
      expect(isStockAnalysisAsk(q), q).toBe(false);
    }
  });
});

describe("summarizeVcpScan (expanded scan_vcp presentation)", () => {
  const load = async () => (await import("./analysis-scan")).summarizeVcpScan;

  const strongResult = {
    symbol: "NVDA",
    score: 94,
    setupDetected: true,
    stage: "pivot-ready",
    trend: { classification: "Strong uptrend" },
    majorHigh: { price: 1274.55, date: "2026-05-12", distancePercent: 33 },
    base: { detected: true, durationDays: 42, depthPercent: 12.5, support: 92.1, resistance: 100.53 },
    actionablePivot: { detected: true, price: 100.53, source: "resistance", distancePercent: 0.75 },
    pivotPrice: 100.53,
    reasons: ["tightening contraction sequence"],
    warnings: [],
  };

  it("majorHigh is never labeled pivot/breakout/buy point/entry", async () => {
    const summarize = await load();
    const text = summarize(strongResult, "NVDA")!;
    const majorHighLine = text.split("\n").find((l) => l.startsWith("Major high"))!;
    expect(majorHighLine).toContain("$1,274.55");
    expect(majorHighLine).toContain("historical context, not an entry level");
    for (const banned of ["pivot", "breakout", "buy point", "actionable entry"]) {
      expect(majorHighLine.toLowerCase()).not.toContain(banned);
    }
  });

  it("pivot-ready uses actionablePivot for the pivot line", async () => {
    const summarize = await load();
    const text = summarize(strongResult, "NVDA")!;
    expect(text).toContain("Setup: Pivot-ready");
    expect(text).toContain("Actionable VCP pivot: $100.53");
    expect(text).toContain("0.75% away");
    expect(text).toContain("Trend: Strong uptrend");
  });

  it("null/undetected actionablePivot renders as 'None' (valid data, not error)", async () => {
    const summarize = await load();
    for (const ap of [
      { detected: false, price: null },
      { detected: true, price: null },
      { detected: false, price: 105.2 },
    ]) {
      const text = summarize(
        { symbol: "MU", score: 29, stage: "no-setup", actionablePivot: ap, reasons: ["price below key trend levels"] },
        "MU",
      )!;
      expect(text).toContain("Actionable VCP pivot: None");
      expect(text).toContain("VCP Score: 29/100");
      expect(text).toContain("Setup: No valid VCP setup");
    }
    // Legacy pivotPrice: null is equivalent to no actionable pivot.
    const legacy = summarize({ symbol: "MU", score: 29, stage: "no-setup", pivotPrice: null }, "MU")!;
    expect(legacy).toContain("Actionable VCP pivot: None");
  });

  it("handles early/developing stages; retired 'base-building' maps to developing", async () => {
    const summarize = await load();
    expect(summarize({ stage: "early", score: 40 }, "MU")).toContain("Setup: Early base formation");
    expect(summarize({ stage: "developing", score: 55 }, "MU")).toContain("Setup: Developing base");
    expect(summarize({ stage: "contraction", score: 70 }, "MU")).toContain("Setup: Contraction phase");
    expect(summarize({ stage: "base-building", score: 55 }, "MU")).toContain("Setup: Developing base");
  });

  it("base: summarizes when detected, 'No confirmed base' otherwise; Why uses reasons+warnings", async () => {
    const summarize = await load();
    const withBase = summarize(strongResult, "NVDA")!;
    expect(withBase).toContain("Base: 42 days, 12.5% deep, support $92.10, resistance $100.53");
    const noBase = summarize(
      { symbol: "MU", score: 29, stage: "no-setup", base: { detected: false }, reasons: ["no valid tightening contraction sequence"], warnings: ["recent action remains too volatile"] },
      "MU",
    )!;
    expect(noBase).toContain("Base: No confirmed base");
    expect(noBase).toContain("Why:\n- no valid tightening contraction sequence\n- recent action remains too volatile");
  });

  it("array payloads: picks the entry matching the symbol, else the first", async () => {
    const summarize = await load();
    const arr = [
      { symbol: "AMD", score: 50, stage: "early" },
      { symbol: "MU", score: 29, stage: "no-setup" },
    ];
    expect(summarize(arr, "MU")).toContain("VCP Score: 29/100");
    expect(summarize(arr, "ZZZZ")).toContain("VCP Score: 50/100");
    expect(summarize({ results: arr }, "MU")).toContain("VCP Score: 50/100"); // results wrapper takes first
  });

  it("returns null for unusable payloads (truncated, empty, non-object)", async () => {
    const summarize = await load();
    expect(summarize({ truncated: true, preview: "{}" }, "MU")).toBeNull();
    expect(summarize(null, "MU")).toBeNull();
    expect(summarize("weird", "MU")).toBeNull();
  });
});

describe("deriveVcpAnalysis / research-analysis structure", () => {
  const load = async () => import("./analysis-scan");

  const weakMu = {
    symbol: "MU",
    score: 18,
    setupDetected: false,
    stage: "no-setup",
    trend: { classification: "Weak" },
    majorHigh: { price: 1255, date: "2026-01-15", distancePercent: 33 },
    base: { detected: false },
    volatilityCompression: { detected: false },
    volumeContraction: { detected: true, percent: 19 },
    higherLows: { established: false },
    actionablePivot: { detected: false, price: null },
    reasons: ["price below key trend levels"],
    warnings: ["recent pullback remains too deep"],
  };

  const strongNvda = {
    symbol: "NVDA",
    score: 94,
    setupDetected: true,
    stage: "pivot-ready",
    trend: { classification: "Strong uptrend" },
    majorHigh: { price: 1274.55, date: "2026-05-12", distancePercent: 5 },
    base: { detected: true, durationDays: 42, depthPercent: 12.5, support: 92.1, resistance: 100.53 },
    volatilityCompression: { detected: true },
    volumeContraction: { detected: true, percent: 35 },
    higherLows: { established: true },
    actionablePivot: { detected: true, price: 100.53, source: "resistance", distancePercent: 0.75 },
  };

  it("no-setup: weaknesses + improvements derived from actual deficiencies, no entry level", async () => {
    const { deriveVcpAnalysis } = await load();
    const a = deriveVcpAnalysis(weakMu, "MU")!;
    expect(a.analysisSummary).toEqual({ vcpScore: 18, stage: "no-setup", trend: "Weak" });
    expect(a.setupAssessment.qualifies).toBe(false);
    expect(a.vcpStructure.base).toBe("No confirmed base");
    expect(a.vcpStructure.actionablePivot).toEqual({ detected: false, price: null, source: null, distancePercent: null });
    expect(a.vcpStructure.volume).toBe("Contracting 19%");
    // improvement conditions map 1:1 to deficiencies present in the scan
    const imp = a.setupAssessment.improvementConditions.join(" ");
    expect(imp).toContain("repair the trend structure");
    expect(imp).toContain("consolidation base");
    expect(imp).toContain("progressively shallower");
    expect(imp).toContain("ATR");
    expect(imp).not.toContain("Volume should generally decline"); // volume IS contracting
    // watch conditions never manufacture support/resistance
    expect(a.setupAssessment.watchConditions.join(" ")).not.toContain("Base support");
  });

  it("majorHigh carries the historical-context note and is never the pivot", async () => {
    const { deriveVcpAnalysis } = await load();
    const a = deriveVcpAnalysis(weakMu, "MU")!;
    expect(a.vcpStructure.majorHigh).toEqual({ price: 1255, date: "2026-01-15", distancePercent: 33, note: "historical context only" });
    expect(a.vcpStructure.actionablePivot.price).toBeNull();
  });

  it("pivot-ready: qualifies with strengths (not failure conditions) and real pivot data", async () => {
    const { deriveVcpAnalysis } = await load();
    const a = deriveVcpAnalysis(strongNvda, "NVDA")!;
    expect(a.setupAssessment.qualifies).toBe(true);
    expect(a.vcpStructure.actionablePivot).toEqual({ detected: true, price: 100.53, source: "resistance", distancePercent: 0.75 });
    // pivot comes from actionablePivot, never majorHigh
    expect(a.vcpStructure.actionablePivot.price).not.toBe(a.vcpStructure.majorHigh.price);
    const s = a.setupAssessment.strengths.join(" ");
    for (const expected of ["uptrend", "base", "tightening", "compressing", "Higher lows", "actionable pivot"]) {
      expect(s.toLowerCase()).toContain(expected.toLowerCase());
    }
    expect(a.setupAssessment.weaknesses).toEqual([]);
    expect(a.setupAssessment.watchConditions.join(" ")).toContain("$100.53");
    expect(a.setupAssessment.watchConditions.join(" ")).toContain("Base support: $92.10");
  });

  it("early/developing/contraction stages normalize and drive stage labels", async () => {
    const { deriveVcpAnalysis } = await load();
    expect(deriveVcpAnalysis({ ...weakMu, stage: "early" }, "MU")!.analysisSummary.stage).toBe("early");
    expect(deriveVcpAnalysis({ ...weakMu, stage: "developing" }, "MU")!.analysisSummary.stage).toBe("developing");
    expect(deriveVcpAnalysis({ ...weakMu, stage: "base-building" }, "MU")!.analysisSummary.stage).toBe("developing");
    const c = deriveVcpAnalysis({ ...weakMu, stage: "contraction" }, "MU")!;
    expect(c.analysisSummary.stage).toBe("contraction");
    expect(c.vcpStructure.contractions).toBe("Tightening");
  });

  it("unusable payloads return null (no fabricated analysis)", async () => {
    const { deriveVcpAnalysis } = await load();
    expect(deriveVcpAnalysis({ truncated: true, preview: "{}" }, "MU")).toBeNull();
    expect(deriveVcpAnalysis(null, "MU")).toBeNull();
  });
});

describe("suggestionsForVcpStage (context-aware next steps)", () => {
  it("no-setup/early: no Trade Builder emphasis", async () => {
    const { suggestionsForVcpStage } = await import("./analysis-scan");
    for (const stage of ["no-setup", "early", null] as const) {
      const labels = suggestionsForVcpStage(stage, "MU").map((s) => s.label).join("|");
      expect(labels, String(stage)).not.toContain("Trade Builder");
      expect(labels).toContain("ranked opportunities");
    }
  });

  it("pivot-ready: may show Trade Builder and View setup", async () => {
    const { suggestionsForVcpStage } = await import("./analysis-scan");
    const labels = suggestionsForVcpStage("pivot-ready", "NVDA").map((s) => s.label);
    expect(labels).toContain("Open Trade Builder");
    expect(labels).toContain("View NVDA setup");
  });

  it("developing/contraction: scanner + chart + ranked", async () => {
    const { suggestionsForVcpStage } = await import("./analysis-scan");
    const labels = suggestionsForVcpStage("contraction", "MU").map((s) => s.label).join("|");
    expect(labels).toContain("Open Scanner");
    expect(labels).toContain("View MU chart");
    expect(labels).not.toContain("Trade Builder");
  });
});

describe("confidenceForAnalysis (completeness, not bullishness)", () => {
  const mk = async (result: any) => (await import("./analysis-scan")).deriveVcpAnalysis(result, result.symbol);

  it("failed scan → low; bearish complete data → high; missing quote → medium", async () => {
    const { confidenceForAnalysis, deriveVcpAnalysis } = await import("./analysis-scan");
    expect(confidenceForAnalysis({ scanSucceeded: false, hasLiveQuote: true, analysis: null })).toBe("low");
    const bearish = deriveVcpAnalysis(
      { symbol: "MU", score: 18, stage: "no-setup", trend: { classification: "Downtrend" }, base: { detected: false }, actionablePivot: { detected: false, price: null } },
      "MU",
    );
    expect(confidenceForAnalysis({ scanSucceeded: true, hasLiveQuote: true, analysis: bearish })).toBe("high");
    expect(confidenceForAnalysis({ scanSucceeded: true, hasLiveQuote: false, analysis: bearish })).toBe("medium");
  });

  it("mixed structural evidence mid-stage → medium; pivot-ready with agreement → high", async () => {
    const { confidenceForAnalysis, deriveVcpAnalysis } = await import("./analysis-scan");
    const mixed = deriveVcpAnalysis(
      { symbol: "X", score: 55, stage: "developing", trend: { classification: "Uptrend" }, base: { detected: true, support: 10, resistance: 12 }, volatilityCompression: { detected: false }, volumeContraction: { detected: false }, higherLows: { established: false }, actionablePivot: { detected: false, price: null } },
      "X",
    );
    expect(confidenceForAnalysis({ scanSucceeded: true, hasLiveQuote: true, analysis: mixed })).toBe("medium");
    const strong = deriveVcpAnalysis(
      { symbol: "NVDA", score: 94, stage: "pivot-ready", trend: { classification: "Strong uptrend" }, base: { detected: true }, volatilityCompression: { detected: true }, volumeContraction: { detected: true }, higherLows: { established: true }, actionablePivot: { detected: true, price: 100.53, distancePercent: 0.75 } },
      "NVDA",
    );
    expect(confidenceForAnalysis({ scanSucceeded: true, hasLiveQuote: true, analysis: strong })).toBe("high");
  });
});

describe("fetchDeterministicVcpScan", () => {
  it("'Analyze MU' calls scan_vcp exactly once with lookbackDays 120 when MCP is enabled", async () => {
    enableMcp();
    const { mod, scanVcp } = await withMockedScan();
    const out = await mod.fetchDeterministicVcpScan("Analyze MU", ["MU"]);
    expect(scanVcp).toHaveBeenCalledTimes(1);
    expect(scanVcp).toHaveBeenCalledWith(["MU"], 120);
    // Structured result is preserved for the final model context.
    expect(out).toEqual({
      symbol: "MU",
      lookbackDays: 120,
      result: { symbol: "MU", score: 87, setupDetected: true },
    });
  });

  it("MCP disabled → zero MCP calls, null result (existing behavior preserved)", async () => {
    const { mod, scanVcp } = await withMockedScan();
    const out = await mod.fetchDeterministicVcpScan("Analyze MU", ["MU"]);
    expect(out).toBeNull();
    expect(scanVcp).not.toHaveBeenCalled();
  });

  it("scan failure falls back gracefully to null without throwing", async () => {
    enableMcp();
    const { mod, scanVcp } = await withMockedScan(async () => {
      throw Object.assign(new Error("down"), { code: "MCP_UNAVAILABLE" });
    });
    const out = await mod.fetchDeterministicVcpScan("Analyze MU", ["MU"]);
    expect(out).toBeNull();
    expect(scanVcp).toHaveBeenCalledTimes(1);
  });

  it("non-analysis questions do not trigger scan_vcp", async () => {
    enableMcp();
    const { mod, scanVcp } = await withMockedScan();
    const out = await mod.fetchDeterministicVcpScan("Any news on MU today?", ["MU"]);
    expect(out).toBeNull();
    expect(scanVcp).not.toHaveBeenCalled();
  });

  it("no ticker → no scan", async () => {
    enableMcp();
    const { mod, scanVcp } = await withMockedScan();
    const out = await mod.fetchDeterministicVcpScan("Analyze the market", []);
    expect(out).toBeNull();
    expect(scanVcp).not.toHaveBeenCalled();
  });
});
