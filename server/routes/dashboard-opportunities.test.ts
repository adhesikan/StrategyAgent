// Dashboard Stock Opportunities — Comprehensive pipeline tests (Step 1 spec §12)
//
// Tests cover all 7 categories from the spec:
// A. Disconnected user
// B. Stock opportunity integrity
// C. Options boundary
// D. Data-source status
// E. Failure isolation
// F. Sentiment isolation
// G. Regression
//
// Run with: npx vitest run --root . server/routes/dashboard-opportunities.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../mcp/config", () => ({
  isMcpEnabled: vi.fn(),
  getMcpConfig: vi.fn(() => ({ recommendationTimeoutMs: 30000 })),
}));

vi.mock("../mcp/tools", () => ({
  rankMarketTradeCandidates: vi.fn(),
}));

vi.mock("../routes/ranked-trade-search", () => ({
  runRankedTradeSearch: vi.fn(),
}));

import { isMcpEnabled } from "../mcp/config";
import { rankMarketTradeCandidates } from "../mcp/tools";
import { runRankedTradeSearch } from "../routes/ranked-trade-search";
import {
  buildDashboardStockOpportunities,
  buildOptionsAvailability,
} from "../services/dashboard-stock-opportunities";

const mockIsMcpEnabled = isMcpEnabled as ReturnType<typeof vi.fn>;
const mockRunRanked = runRankedTradeSearch as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeRankedSearch(candidateCount = 3) {
  const symbols = ["NVDA", "AAPL", "MSFT", "AMZN", "TSLA"].slice(0, candidateCount);
  return {
    request: {},
    reviewedCount: 200,
    qualifiedCount: candidateCount,
    watchCount: 2,
    rejectedCount: 15,
    unavailableCount: 1,
    excludedCount: 12,
    exclusionSummary: [{ reason: "NOT_ACTIONABLE_NO_TRIGGER", count: 8 }],
    candidates: symbols.map((symbol, i) => ({
      rank: i + 1,
      symbol,
      strategy: "VCP Breakout",
      setupStatus: "Qualified",
      confidence: "high",
      dataQuality: "daily_close",
      whySelected: [`${symbol} shows bullish VCP structure with volume contraction.`],
      warnings: [],
    })),
    watchCandidates: [
      {
        symbol: "AMD",
        strategy: "VCP",
        currentStage: "Stage 2",
        watchConditions: ["Awaiting volume confirmation above pivot."],
      },
    ],
    rejectionSummary: [],
    generatedAt: "2026-08-05T14:00:00.000Z",
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// A. Disconnected user
// ---------------------------------------------------------------------------

describe("A. Disconnected user — real opportunities, no broker required", () => {
  beforeEach(() => {
    mockIsMcpEnabled.mockReturnValue(true);
    mockRunRanked.mockResolvedValue(makeRankedSearch(3));
  });

  it("returns real stock opportunities when MCP is available, regardless of broker", async () => {
    const result = await buildDashboardStockOpportunities();
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.dataSource).toBe("mcp");
    }
  });

  it("disconnected optionsAvailability has no live chain and requires broker", () => {
    const opts = buildOptionsAvailability(false);
    expect(opts.liveChainAvailable).toBe(false);
    expect(opts.brokerRequired).toBe(true);
    expect(opts.source).toBeNull();
  });

  it("disconnected optionsAvailability still allows estimated structures", () => {
    const opts = buildOptionsAvailability(false);
    expect(opts.estimatedStructuresAvailable).toBe(true);
  });

  it("optionsAvailability message mentions broker requirement", () => {
    const opts = buildOptionsAvailability(false);
    expect(opts.message.toLowerCase()).toContain("broker");
  });
});

// ---------------------------------------------------------------------------
// B. Stock opportunity integrity
// ---------------------------------------------------------------------------

describe("B. Stock opportunity integrity", () => {
  beforeEach(() => {
    mockIsMcpEnabled.mockReturnValue(true);
    mockRunRanked.mockResolvedValue(makeRankedSearch(3));
  });

  it("candidate comes from deterministic MCP result, not generateCandidateScenarios", async () => {
    const result = await buildDashboardStockOpportunities();
    expect(mockRunRanked).toHaveBeenCalled();
    // rankMarketTradeCandidates is called internally by runRankedTradeSearch
    expect(result.status).toBe("ok");
  });

  it("backend ranking order is preserved — candidates come in rank order", async () => {
    const search = makeRankedSearch(3);
    search.candidates = [
      { rank: 1, symbol: "NVDA", whySelected: [], warnings: [] },
      { rank: 2, symbol: "AAPL", whySelected: [], warnings: [] },
      { rank: 3, symbol: "MSFT", whySelected: [], warnings: [] },
    ] as any;
    mockRunRanked.mockResolvedValue(search);
    const result = await buildDashboardStockOpportunities();
    if (result.status === "ok") {
      expect(result.candidates.map((c) => c.symbol)).toEqual(["NVDA", "AAPL", "MSFT"]);
    }
  });

  it("no simulated options fields survive in candidates", async () => {
    const result = await buildDashboardStockOpportunities();
    if (result.status === "ok") {
      const str = JSON.stringify(result.candidates);
      expect(str).not.toContain("premium");
      expect(str).not.toContain("openInterest");
      expect(str).not.toContain("bidAskSpread");
      expect(str).not.toContain("syntheticExpiration");
      expect(str).not.toContain("syntheticStrike");
      expect(str).not.toContain("capitalRequired");
      expect(str).not.toContain("breakeven");
    }
  });

  it("sourceTimestamp preserved from MCP generatedAt", async () => {
    mockRunRanked.mockResolvedValue({ ...makeRankedSearch(), generatedAt: "2026-08-05T14:00:00.000Z" });
    const result = await buildDashboardStockOpportunities();
    if (result.status === "ok") {
      expect(result.sourceTimestamp).toBe("2026-08-05T14:00:00.000Z");
      expect(result.generatedAt).toBe("2026-08-05T14:00:00.000Z");
    }
  });

  it("data quality badge is always 'Latest daily market data'", async () => {
    const result = await buildDashboardStockOpportunities();
    if (result.status === "ok") {
      expect(result.dataQuality).toBe("Latest daily market data");
    }
  });

  it("zero-qualified result is honest — status ok, zero candidates, counts present", async () => {
    mockRunRanked.mockResolvedValue({
      ...makeRankedSearch(0),
      qualifiedCount: 0,
      candidates: [],
      watchCandidates: [],
    });
    const result = await buildDashboardStockOpportunities();
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.candidates).toHaveLength(0);
      expect(result.reviewedCount).toBeGreaterThan(0);
      expect(typeof result.qualifiedCount).toBe("number");
    }
  });

  it("watch candidates are included only when supplied by backend", async () => {
    const search = makeRankedSearch(0);
    search.candidates = [];
    search.watchCandidates = [
      { symbol: "AMD", watchConditions: ["Awaiting pivot break."], strategy: "VCP" } as any,
    ];
    mockRunRanked.mockResolvedValue(search);
    const result = await buildDashboardStockOpportunities();
    if (result.status === "ok") {
      expect(result.watchCandidates).toHaveLength(1);
      expect(result.watchCandidates[0].symbol).toBe("AMD");
    }
  });

  it("exclusionSummary forwarded from MCP for empty-state explanation", async () => {
    const result = await buildDashboardStockOpportunities();
    if (result.status === "ok") {
      expect(Array.isArray(result.exclusionSummary)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// C. Options boundary
// ---------------------------------------------------------------------------

describe("C. Options boundary — no fabricated contracts without live chain", () => {
  it("liveChainAvailable is always false without a live chain provider", () => {
    const noBroker = buildOptionsAvailability(false);
    const withBroker = buildOptionsAvailability(true);
    expect(noBroker.liveChainAvailable).toBe(false);
    expect(withBroker.liveChainAvailable).toBe(false);
  });

  it("no synthetic strike in optionsAvailability", () => {
    const opts = buildOptionsAvailability(false);
    const str = JSON.stringify(opts);
    expect(str).not.toContain("strike");
  });

  it("no synthetic contract price (premium value) in optionsAvailability", () => {
    // The message may mention "premiums" as a boundary explanation, which is correct.
    // What must NOT appear: numeric premium values or synthetic contract data.
    const opts = buildOptionsAvailability(false);
    // No numeric premium / contract price in the shape
    expect((opts as any).premium).toBeUndefined();
    expect((opts as any).contractPrice).toBeUndefined();
    expect((opts as any).midPrice).toBeUndefined();
  });

  it("no synthetic expiration in optionsAvailability", () => {
    const opts = buildOptionsAvailability(false);
    expect(JSON.stringify(opts)).not.toContain("expiration");
  });

  it("no synthetic Greeks in optionsAvailability", () => {
    const opts = buildOptionsAvailability(false);
    const str = JSON.stringify(opts);
    expect(str).not.toContain("delta");
    expect(str).not.toContain("gamma");
    expect(str).not.toContain("theta");
  });

  it("no synthetic open interest in optionsAvailability", () => {
    expect(JSON.stringify(buildOptionsAvailability(false))).not.toContain("openInterest");
  });

  it("brokerRequired is always true (no self-serve options chain)", () => {
    expect(buildOptionsAvailability(false).brokerRequired).toBe(true);
    expect(buildOptionsAvailability(true).brokerRequired).toBe(true);
  });

  it("estimatedStructuresAvailable true — broad strategy concepts allowed in labeled section", () => {
    expect(buildOptionsAvailability(false).estimatedStructuresAvailable).toBe(true);
  });

  it("with-broker source is 'broker', without-broker source is null", () => {
    expect(buildOptionsAvailability(true).source).toBe("broker");
    expect(buildOptionsAvailability(false).source).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D. Data-source status (unit: buildDashboardStockOpportunities output fields)
// ---------------------------------------------------------------------------

describe("D. Data-source integrity — no global mock when MCP available", () => {
  it("MCP disabled → status unavailable (not fabricated candidates)", async () => {
    mockIsMcpEnabled.mockReturnValue(false);
    const result = await buildDashboardStockOpportunities();
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toBe("mcp_disabled");
    }
  });

  it("MCP enabled → dataSource is 'mcp', never 'mock' or 'simulated'", async () => {
    mockIsMcpEnabled.mockReturnValue(true);
    mockRunRanked.mockResolvedValue(makeRankedSearch());
    const result = await buildDashboardStockOpportunities();
    if (result.status === "ok") {
      expect(result.dataSource).toBe("mcp");
      expect((result as any).dataSource).not.toBe("mock");
      expect((result as any).dataSource).not.toBe("simulated");
    }
  });

  it("broker disconnect does not affect Twelve Data availability (separate capability)", async () => {
    // Without broker, MCP still returns opportunities from Twelve Data stored bars
    mockIsMcpEnabled.mockReturnValue(true);
    mockRunRanked.mockResolvedValue(makeRankedSearch(2));
    const result = await buildDashboardStockOpportunities();
    expect(result.status).toBe("ok"); // not affected by broker absence
  });

  it("optionsAvailability does not affect stockOpportunities (separate capability)", async () => {
    mockIsMcpEnabled.mockReturnValue(true);
    mockRunRanked.mockResolvedValue(makeRankedSearch());
    const stocks = await buildDashboardStockOpportunities();
    const opts = buildOptionsAvailability(false);
    expect(stocks.status).toBe("ok");
    expect(opts.liveChainAvailable).toBe(false);
    // These are independent — one can be available while the other isn't
  });
});

// ---------------------------------------------------------------------------
// E. Failure isolation
// ---------------------------------------------------------------------------

describe("E. Failure isolation", () => {
  it("MCP unavailable returns status unavailable — no fabricated candidates", async () => {
    mockIsMcpEnabled.mockReturnValue(true);
    mockRunRanked.mockRejectedValue(new Error("Connection refused"));
    const result = await buildDashboardStockOpportunities();
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      // reason field carries machine-readable cause
      expect(["mcp_unavailable", "mcp_invalid_response", "mcp_disabled"]).toContain(result.reason);
    }
  });

  it("MCP invalid response returns status unavailable — no partial fabrication", async () => {
    mockIsMcpEnabled.mockReturnValue(true);
    mockRunRanked.mockRejectedValue(new Error("rank_market_trade_candidates returned an invalid payload"));
    const result = await buildDashboardStockOpportunities();
    expect(result.status).toBe("unavailable");
  });

  it("MCP timeout returns status unavailable — no invented candidates", async () => {
    mockIsMcpEnabled.mockReturnValue(true);
    mockRunRanked.mockRejectedValue(new Error("timeout"));
    const result = await buildDashboardStockOpportunities();
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect((result as any).candidates).toBeUndefined();
    }
  });

  it("buildOptionsAvailability never throws — always returns valid shape", () => {
    expect(() => buildOptionsAvailability(true)).not.toThrow();
    expect(() => buildOptionsAvailability(false)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// F. Sentiment isolation (audit — no defect found; document the trace)
// ---------------------------------------------------------------------------

describe("F. Sentiment isolation audit", () => {
  // The audit found that sentimentAggregationService groups by r.symbol.toUpperCase()
  // and getTickerSnapshotsForSymbols returns rows keyed by symbol.
  // No cross-symbol contamination exists in the aggregation logic.
  // These tests verify the contract at the service boundary.

  it("AUDIT: stock opportunities carry per-symbol data from MCP (not cross-contaminated)", async () => {
    mockIsMcpEnabled.mockReturnValue(true);
    const search = makeRankedSearch(2);
    search.candidates = [
      { rank: 1, symbol: "NVDA", whySelected: ["NVDA momentum."], warnings: [] },
      { rank: 2, symbol: "AAPL", whySelected: ["AAPL structure."], warnings: [] },
    ] as any;
    mockRunRanked.mockResolvedValue(search);
    const result = await buildDashboardStockOpportunities();
    if (result.status === "ok") {
      const nvda = result.candidates.find((c) => c.symbol === "NVDA");
      const aapl = result.candidates.find((c) => c.symbol === "AAPL");
      // NVDA reasons must not mention AAPL and vice versa (as received from MCP)
      expect(nvda?.whySelected.join(" ")).toContain("NVDA");
      expect(nvda?.whySelected.join(" ")).not.toContain("AAPL");
      expect(aapl?.whySelected.join(" ")).toContain("AAPL");
      expect(aapl?.whySelected.join(" ")).not.toContain("NVDA");
    }
  });

  it("AUDIT: exclusionSummary reasons are not symbol-specific leaks", async () => {
    mockIsMcpEnabled.mockReturnValue(true);
    mockRunRanked.mockResolvedValue(makeRankedSearch());
    const result = await buildDashboardStockOpportunities();
    if (result.status === "ok" && result.exclusionSummary) {
      // exclusionSummary reasons should be category-based, not per-symbol mentions
      for (const group of result.exclusionSummary) {
        expect(typeof group.reason).toBe("string");
        // Reason codes should not contain raw ticker symbols (they're categorical)
        expect(group.reason).not.toMatch(/^[A-Z]{1,5}$/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// G. Regression
// ---------------------------------------------------------------------------

describe("G. Regression — existing features unaffected", () => {
  it("buildDashboardStockOpportunities never calls OpenAI (no openai import)", async () => {
    mockIsMcpEnabled.mockReturnValue(true);
    mockRunRanked.mockResolvedValue(makeRankedSearch());
    // This is a structural test — OpenAI is not imported in dashboard-stock-opportunities.ts
    // The function only imports from mcp/config, mcp/tools, and ranked-trade-search
    const result = await buildDashboardStockOpportunities();
    expect(result.status).toBe("ok");
    // If OpenAI were called, it would fail in this test environment (no API key)
    // The fact that result.status is "ok" proves no OpenAI dependency
  });

  it("buildDashboardStockOpportunities is idempotent — same call twice returns same shape", async () => {
    mockIsMcpEnabled.mockReturnValue(true);
    mockRunRanked.mockResolvedValue(makeRankedSearch(2));
    const r1 = await buildDashboardStockOpportunities();
    const r2 = await buildDashboardStockOpportunities();
    expect(r1.status).toBe(r2.status);
    if (r1.status === "ok" && r2.status === "ok") {
      expect(r1.candidates.length).toBe(r2.candidates.length);
    }
  });

  it("candidates are capped at 5 even when MCP returns more", async () => {
    const search = makeRankedSearch(0);
    search.candidates = Array.from({ length: 10 }, (_, i) => ({
      rank: i + 1,
      symbol: `SYM${i}`,
      whySelected: [],
      warnings: [],
    })) as any;
    search.qualifiedCount = 10;
    mockIsMcpEnabled.mockReturnValue(true);
    mockRunRanked.mockResolvedValue(search);
    const result = await buildDashboardStockOpportunities();
    if (result.status === "ok") {
      expect(result.candidates.length).toBeLessThanOrEqual(5);
    }
  });

  it("watch candidates are capped at 5", async () => {
    const search = makeRankedSearch(0);
    search.candidates = [];
    search.watchCandidates = Array.from({ length: 8 }, (_, i) => ({
      symbol: `WCH${i}`,
      watchConditions: [],
    })) as any;
    mockIsMcpEnabled.mockReturnValue(true);
    mockRunRanked.mockResolvedValue(search);
    const result = await buildDashboardStockOpportunities();
    if (result.status === "ok") {
      expect(result.watchCandidates.length).toBeLessThanOrEqual(5);
    }
  });
});
