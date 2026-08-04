// Tests for the deterministic multi-strategy symbol analysis (spec §13).
import { describe, test, expect, beforeEach } from "vitest";
import {
  classifyAnalysisIntent,
  runMultiStrategyAnalysis,
  multiStrategyConfidence,
  suggestionsForMultiStrategy,
  getCachedStrategyRegistry,
  _clearRegistryCache,
  mapBounded,
  buildMultiStrategyFallbackAnswer,
  type StrategyMeta,
  type MultiStrategyDeps,
} from "./multi-strategy-analysis";

const REGISTRY: StrategyMeta[] = [
  { id: "VCP", displayName: "Momentum Breakout", supportedTimeframes: ["1d"], targetedScan: true, enabled: true },
  { id: "HIGH_RVOL", displayName: "Volume Surge", supportedTimeframes: ["1d"], targetedScan: true, enabled: true },
  { id: "VCP_MULTIDAY", displayName: "Power Breakout", supportedTimeframes: ["1d"], targetedScan: true, enabled: true },
  { id: "CLASSIC_PULLBACK", displayName: "Precision Pullback", supportedTimeframes: ["1d"], targetedScan: true, enabled: true },
  { id: "VWAP_RECLAIM", displayName: "Institutional Reclaim", supportedTimeframes: ["1d"], targetedScan: true, enabled: true },
  // Ineligible entries — must never be scanned:
  { id: "DISABLED_ONE", displayName: "Disabled One", supportedTimeframes: ["1d"], targetedScan: true, enabled: false },
  { id: "NO_TARGET", displayName: "No Target", supportedTimeframes: ["1d"], targetedScan: false, enabled: true },
  { id: "WEEKLY_ONLY", displayName: "Weekly Only", supportedTimeframes: ["1w"], targetedScan: true, enabled: true },
];

const NOW = new Date("2026-08-03T12:00:00Z");
const FRESH = "2026-08-01T00:00:00Z";
const STALE = "2026-06-01T00:00:00Z";

function setup(strategy: string, extra: Record<string, unknown> = {}) {
  return {
    symbol: "MU",
    strategy,
    direction: "bullish",
    status: "forming",
    detectedAt: FRESH,
    source: "production",
    ...extra,
  };
}

function deps(overrides: Partial<MultiStrategyDeps> & { scans?: Record<string, unknown> } = {}): MultiStrategyDeps {
  const scans = overrides.scans ?? {};
  return {
    listStrategies: async () => REGISTRY,
    scanStrategy: async (_s, st) => {
      const v = scans[st];
      if (v instanceof Error) throw v;
      return v !== undefined ? v : { setup: null };
    },
    buildTradeCandidate: async () => ({ verdict: "NO_TRADE", noTradeReasons: ["no trigger"] }),
    now: NOW,
    ...overrides,
  };
}

beforeEach(() => _clearRegistryCache());

// ---------------------------------------------------------------------------
// Intent routing (§2, tests 1-3)
// ---------------------------------------------------------------------------

describe("classifyAnalysisIntent", () => {
  test("generic asks route to multi-strategy analysis", () => {
    for (const q of ["Analyze MU", "Evaluate NVDA", "How does CRDO look?", "Technical analysis of AMD", "What is the setup on TSLA?"]) {
      expect(classifyAnalysisIntent(q, REGISTRY)?.kind, q).toBe("GENERIC_MULTI_STRATEGY");
    }
  });

  test("explicit VCP asks stay on the VCP path", () => {
    for (const q of [
      "Analyze MU using VCP",
      "Run a VCP scan on NVDA",
      "Is CRDO pivot-ready?",
      "Show MU's VCP structure",
      "Analyze MU's contractions and pivot",
    ]) {
      expect(classifyAnalysisIntent(q, REGISTRY)?.kind, q).toBe("EXPLICIT_VCP");
    }
  });

  test("explicit strategy asks resolve exactly one strategy", () => {
    const a = classifyAnalysisIntent("Analyze MU using Volume Surge", REGISTRY);
    expect(a).toMatchObject({ kind: "EXPLICIT_STRATEGY", strategyId: "HIGH_RVOL" });
    const b = classifyAnalysisIntent("Check NVDA for Power Breakout", REGISTRY);
    expect(b).toMatchObject({ kind: "EXPLICIT_STRATEGY", strategyId: "VCP_MULTIDAY" });
    const c = classifyAnalysisIntent("Run Institutional Reclaim on TSLA", REGISTRY);
    expect(c).toMatchObject({ kind: "EXPLICIT_STRATEGY", strategyId: "VWAP_RECLAIM" });
  });

  test("unknown explicit strategy is flagged, not guessed", () => {
    const a = classifyAnalysisIntent("Analyze MU using Quantum Flux", REGISTRY);
    expect(a?.kind).toBe("EXPLICIT_STRATEGY");
    expect(a?.strategyId).toBeUndefined();
    expect(a?.unresolvedStrategy).toBeTruthy();
  });

  test("non-analysis questions return null", () => {
    expect(classifyAnalysisIntent("What's the weather like?", REGISTRY)).toBeNull();
  });

  test("news/general asks that merely name a strategy are NOT hijacked into a scan", () => {
    expect(classifyAnalysisIntent("Why is there a volume surge in MU today?", REGISTRY)).toBeNull();
    expect(classifyAnalysisIntent("What does Precision Pullback mean?", REGISTRY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Eligibility + resilience (tests 4-7, 17)
// ---------------------------------------------------------------------------

describe("runMultiStrategyAnalysis eligibility & resilience", () => {
  test("only enabled targetedScan strategies with the timeframe are called", async () => {
    const called: string[] = [];
    const d = deps({
      scanStrategy: async (_s, st) => {
        called.push(st);
        return { setup: null };
      },
    });
    const a = await runMultiStrategyAnalysis("MU", d);
    expect(called.sort()).toEqual(["CLASSIC_PULLBACK", "HIGH_RVOL", "VCP", "VCP_MULTIDAY", "VWAP_RECLAIM"]);
    expect(called).not.toContain("DISABLED_ONE");
    expect(called).not.toContain("NO_TARGET");
    expect(called).not.toContain("WEEKLY_ONLY"); // unsupported timeframe skipped safely
    expect(a.strategiesChecked).toBe(5);
  });

  test("one strategy failure does not fail the analysis (partial success)", async () => {
    const a = await runMultiStrategyAnalysis(
      "MU",
      deps({ scans: { VCP: new Error("boom"), HIGH_RVOL: { setup: setup("HIGH_RVOL") } } }),
    );
    expect(a.strategiesFailed).toBe(1);
    expect(a.strategiesMatched).toBe(1);
    expect(a.failedStrategies?.[0]).toMatchObject({ strategy: "Momentum Breakout", safeErrorCode: "SCAN_FAILED" });
    expect(a.overallVerdict).not.toBe("INSUFFICIENT_DATA");
  });

  test("setup:null is handled safely as a no-match", async () => {
    const a = await runMultiStrategyAnalysis("MU", deps({ scans: {} }));
    expect(a.strategiesMatched).toBe(0);
    expect(a.strategiesFailed).toBe(0);
    expect(a.noMatchStrategies).toHaveLength(5);
    expect(a.overallVerdict).toBe("NO_TRADE");
  });

  test("bounded concurrency never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapBounded(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  test("all scans failing yields INSUFFICIENT_DATA and low confidence", async () => {
    const a = await runMultiStrategyAnalysis(
      "MU",
      deps({
        scanStrategy: async () => {
          throw new Error("down");
        },
      }),
    );
    expect(a.overallVerdict).toBe("INSUFFICIENT_DATA");
    expect(multiStrategyConfidence(a)).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// Multiple matches, ranking, verdicts (tests 8-14)
// ---------------------------------------------------------------------------

describe("primary selection & verdicts", () => {
  test("multiple matching strategies are all preserved independently", async () => {
    const a = await runMultiStrategyAnalysis(
      "MU",
      deps({ scans: { VCP: { setup: setup("VCP") }, HIGH_RVOL: { setup: setup("HIGH_RVOL") }, CLASSIC_PULLBACK: { setup: setup("CLASSIC_PULLBACK") } } }),
    );
    expect(a.strategiesMatched).toBe(3);
    const strategies = [a.primarySetup!.setup.strategy, ...a.supportingSetups.map((e) => e.setup.strategy)].sort();
    expect(strategies).toEqual(["CLASSIC_PULLBACK", "HIGH_RVOL", "VCP"]);
  });

  test("raw cross-strategy scores are NOT simply sorted", async () => {
    // HIGH_RVOL has a huge raw score but is only forming with no trigger;
    // CLASSIC_PULLBACK is ready with a valid trigger and a tiny score.
    const a = await runMultiStrategyAnalysis(
      "MU",
      deps({
        scans: {
          HIGH_RVOL: { setup: setup("HIGH_RVOL", { score: 99, status: "forming" }) },
          CLASSIC_PULLBACK: { setup: setup("CLASSIC_PULLBACK", { score: 12, status: "ready", trigger: { price: 100, basis: "pivot" } }) },
        },
      }),
    );
    expect(a.primarySetup!.setup.strategy).toBe("CLASSIC_PULLBACK");
  });

  test("ready/triggered setup with trigger outranks forming setup", async () => {
    const a = await runMultiStrategyAnalysis(
      "MU",
      deps({
        scans: {
          VCP: { setup: setup("VCP", { status: "forming" }) },
          VWAP_RECLAIM: { setup: setup("VWAP_RECLAIM", { status: "triggered", trigger: { price: 55.5, basis: "vwap" } }) },
        },
      }),
    );
    expect(a.primarySetup!.setup.strategy).toBe("VWAP_RECLAIM");
    expect(a.primarySetup!.selectionReasons.join(" ")).toMatch(/triggered/i);
    expect(a.primarySetup!.selectionReasons.join(" ")).toMatch(/trigger present at \$55\.50/);
  });

  test("build_trade_candidate determines the trade verdict", async () => {
    const a = await runMultiStrategyAnalysis(
      "MU",
      deps({
        scans: { HIGH_RVOL: { setup: setup("HIGH_RVOL", { status: "ready", trigger: { price: 10, basis: "x" } }) } },
        buildTradeCandidate: async () => ({ verdict: "STOCK", stockCandidate: { trigger: { price: 10 } } }),
      }),
    );
    expect(a.overallVerdict).toBe("TRADE_CANDIDATE");
  });

  test("qualified candidate promotes a supporting setup to primary", async () => {
    const a = await runMultiStrategyAnalysis(
      "MU",
      deps({
        scans: {
          VCP: { setup: setup("VCP", { status: "triggered", trigger: { price: 5, basis: "x" } }) },
          HIGH_RVOL: { setup: setup("HIGH_RVOL", { status: "ready", trigger: { price: 6, basis: "x" } }) },
        },
        buildTradeCandidate: async (_s, st) =>
          st === "HIGH_RVOL" ? { verdict: "ESTIMATED_OPTIONS" } : { verdict: "NO_TRADE" },
      }),
    );
    expect(a.overallVerdict).toBe("TRADE_CANDIDATE");
    expect(a.primarySetup!.setup.strategy).toBe("HIGH_RVOL");
    expect(a.primarySetup!.selectionReasons[0]).toMatch(/candidate engine/i);
  });

  test("all rejected setups → NO_TRADE", async () => {
    const a = await runMultiStrategyAnalysis(
      "MU",
      deps({
        scans: {
          VCP: { setup: setup("VCP", { status: "invalid", detectedAt: STALE }) },
          HIGH_RVOL: { setup: setup("HIGH_RVOL", { status: "invalid", detectedAt: STALE }) },
        },
        buildTradeCandidate: async () => ({ verdict: "NO_TRADE", noTradeReasons: ["rejected"] }),
      }),
    );
    expect(a.overallVerdict).toBe("NO_TRADE");
  });

  test("comparator ties resolve deterministically in registry order despite scan completion order", async () => {
    // VCP finishes LAST but appears first in the registry; identical setups
    // must rank in registry order, not completion order.
    const a = await runMultiStrategyAnalysis(
      "MU",
      deps({
        concurrency: 3,
        scanStrategy: async (_s, st) => {
          if (st === "VCP") await new Promise((r) => setTimeout(r, 30));
          if (st === "VCP" || st === "HIGH_RVOL" || st === "CLASSIC_PULLBACK") return { setup: setup(st) };
          return { setup: null };
        },
      }),
    );
    expect(a.primarySetup!.setup.strategy).toBe("VCP");
  });

  test("forming evidence without a qualified trade → WATCH", async () => {
    const a = await runMultiStrategyAnalysis(
      "MU",
      deps({ scans: { HIGH_RVOL: { setup: setup("HIGH_RVOL", { status: "forming" }) } } }),
    );
    expect(a.overallVerdict).toBe("WATCH");
  });

  test("no fabricated triggers: missing levels stay absent", async () => {
    const a = await runMultiStrategyAnalysis(
      "MU",
      deps({ scans: { HIGH_RVOL: { setup: setup("HIGH_RVOL") } } }),
    );
    expect(a.primarySetup!.setup.trigger).toBeUndefined();
    expect(a.primarySetup!.selectionReasons.join(" ")).not.toMatch(/trigger present/i);
    const fallback = buildMultiStrategyFallbackAnswer(a);
    expect(fallback.answer).not.toMatch(/trigger \$/);
  });

  test("explicit single-strategy flow scans only that strategy", async () => {
    const called: string[] = [];
    const d = deps({
      scanStrategy: async (_s, st) => {
        called.push(st);
        return { setup: setup(st) };
      },
    });
    const a = await runMultiStrategyAnalysis("MU", d, "HIGH_RVOL");
    expect(called).toEqual(["HIGH_RVOL"]);
    expect(a.strategiesChecked).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Registry caching (test 18)
// ---------------------------------------------------------------------------

describe("strategy registry caching", () => {
  test("registry loader is called once within the TTL", async () => {
    let loads = 0;
    const loader = async () => {
      loads++;
      return REGISTRY;
    };
    await getCachedStrategyRegistry(loader, 1_000);
    await getCachedStrategyRegistry(loader, 2_000);
    await getCachedStrategyRegistry(loader, 60_000);
    expect(loads).toBe(1);
    await getCachedStrategyRegistry(loader, 1_000 + 6 * 60 * 1000); // past TTL
    expect(loads).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Confidence (§11, test 19) and suggestions (§12)
// ---------------------------------------------------------------------------

describe("confidence", () => {
  async function full(scans: Record<string, unknown>, extra: Partial<MultiStrategyDeps> = {}) {
    return runMultiStrategyAnalysis("MU", deps({ scans, ...extra }));
  }

  test("complete fresh NO_TRADE is not automatically low confidence", async () => {
    const a = await full(
      Object.fromEntries(["VCP", "HIGH_RVOL", "VCP_MULTIDAY", "CLASSIC_PULLBACK", "VWAP_RECLAIM"].map((s) => [s, { setup: setup(s, { status: "forming" }) }])),
      { buildTradeCandidate: async () => ({ verdict: "NO_TRADE", noTradeReasons: ["rejected"] }) },
    );
    expect(a.overallVerdict).toBe("WATCH");
    expect(multiStrategyConfidence(a)).toBe("high");
  });

  test("mock/synthetic source anywhere forces low", async () => {
    const a = await full({ HIGH_RVOL: { setup: setup("HIGH_RVOL", { source: "mock" }) } });
    expect(multiStrategyConfidence(a)).toBe("low");
  });

  test("mostly failed scans force low", async () => {
    const a = await full({
      HIGH_RVOL: { setup: setup("HIGH_RVOL") },
      VCP: new Error("x"),
      VCP_MULTIDAY: new Error("x"),
      CLASSIC_PULLBACK: new Error("x"),
      VWAP_RECLAIM: new Error("x"),
    });
    expect(multiStrategyConfidence(a)).toBe("low");
  });

  test("stale/unknown freshness degrades confidence to at most medium", async () => {
    const a = await full({ HIGH_RVOL: { setup: setup("HIGH_RVOL", { detectedAt: STALE }) } });
    expect(a.dataQuality.fresh).toBe(false);
    expect(multiStrategyConfidence(a)).not.toBe("high");
  });
});

describe("suggestions", () => {
  test("verdict-specific CTAs and no execution behavior", async () => {
    const trade = await runMultiStrategyAnalysis(
      "MU",
      deps({
        scans: { HIGH_RVOL: { setup: setup("HIGH_RVOL", { status: "ready", trigger: { price: 10, basis: "x" } }) } },
        buildTradeCandidate: async () => ({ verdict: "STOCK" }),
      }),
    );
    const tradeLinks = suggestionsForMultiStrategy(trade);
    expect(tradeLinks.map((l) => l.label)).toContain("Open Trade Builder");
    // Navigation only — hrefs are app routes, never order/submit endpoints.
    for (const l of tradeLinks) expect(l.href).toMatch(/^\/(charts|trade-finder|opportunity-radar|watchlist)/);

    const watch = await runMultiStrategyAnalysis(
      "MU",
      deps({ scans: { HIGH_RVOL: { setup: setup("HIGH_RVOL", { status: "forming" }) } } }),
    );
    expect(suggestionsForMultiStrategy(watch).map((l) => l.label)).toContain("Add to Watchlist");
    // Forming with no trigger is not actionable → no Trade Builder CTA.
    expect(suggestionsForMultiStrategy(watch).map((l) => l.label)).not.toContain("Open Trade Builder");

    const noTrade = await runMultiStrategyAnalysis("MU", deps({ scans: {} }));
    expect(suggestionsForMultiStrategy(noTrade).map((l) => l.label)).toContain("Open Scanner");
  });
});
