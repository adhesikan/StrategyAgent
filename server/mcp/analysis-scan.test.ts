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
