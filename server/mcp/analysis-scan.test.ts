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
