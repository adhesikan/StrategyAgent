// opportunity-comparison-service.test.ts — Sprint 2.0
//
// Tests for all 8 lifecycle state rules, edge cases, and the full
// compareSnapshots() function.
// No DB calls — all snapshots are mocked in-memory.

import { describe, it, expect } from "vitest";
import {
  computeLifecycleState,
  compareSnapshots,
  deriveScore,
  buildBucketMaps,
  type SnapshotComparison,
} from "./opportunity-comparison-service";
import type { PersistedOpportunitySnapshot } from "./opportunity-snapshot-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnap(overrides: {
  id?: string;
  topGrowth?: Array<{ rank: number; symbol: string; strategy?: string; whySelected?: string[]; warnings?: string[] }>;
  topIncome?: Array<{ rank: number; symbol: string; strategy?: string; whySelected?: string[]; warnings?: string[] }>;
  topWatchlist?: Array<{ symbol: string; strategy?: string; watchConditions?: string[] }>;
  approachingQualification?: Array<{ symbol: string; strategy?: string; watchConditions?: string[] }>;
  unavailableCount?: number;
  completedAt?: string;
}): PersistedOpportunitySnapshot {
  return {
    id: overrides.id ?? "snap-001",
    status: "SUCCESS",
    startedAt: "2024-01-01T00:00:00Z",
    completedAt: overrides.completedAt ?? "2024-01-01T00:00:00Z",
    generatedAt: "2024-01-01T00:00:00Z",
    scannerVersion: "mcp-v1",
    marketRegime: null,
    dataSource: "Twelve Data via MCP",
    dataQuality: "Latest daily market data",
    reviewedCount: 20,
    qualifiedCount: overrides.topGrowth?.length ?? 0,
    watchCount: overrides.topWatchlist?.length ?? 0,
    rejectedCount: 0,
    excludedCount: 0,
    unavailableCount: overrides.unavailableCount ?? 0,
    topGrowth: (overrides.topGrowth ?? []).map(c => ({
      rank: c.rank,
      symbol: c.symbol,
      strategy: c.strategy,
      whySelected: c.whySelected ?? ["Technical setup"],
      warnings: c.warnings ?? [],
    })),
    topIncome: (overrides.topIncome ?? []).map(c => ({
      rank: c.rank,
      symbol: c.symbol,
      strategy: c.strategy,
      whySelected: c.whySelected ?? [],
      warnings: c.warnings ?? [],
    })),
    topWatchlist: (overrides.topWatchlist ?? []).map(w => ({
      symbol: w.symbol,
      strategy: w.strategy,
      watchConditions: w.watchConditions ?? [],
    })),
    approachingQualification: (overrides.approachingQualification ?? []).map(w => ({
      symbol: w.symbol,
      strategy: w.strategy,
      watchConditions: w.watchConditions ?? [],
    })),
    warnings: [],
  };
}

// Build bucket maps helper for tests
function maps(snap: PersistedOpportunitySnapshot | null) {
  return buildBucketMaps(snap);
}

// ---------------------------------------------------------------------------
// Score derivation
// ---------------------------------------------------------------------------

describe("deriveScore", () => {
  it("rank 1 qualified = 100", () => {
    expect(deriveScore(1, true)).toBe(100);
  });
  it("rank 2 qualified = 95", () => {
    expect(deriveScore(2, true)).toBe(95);
  });
  it("rank 21 qualified = 0 (clamps at 0)", () => {
    expect(deriveScore(21, true)).toBe(0);
  });
  it("rank 100 qualified = 0 (never negative)", () => {
    expect(deriveScore(100, true)).toBe(0);
  });
  it("any rank watch = 0", () => {
    expect(deriveScore(1, false)).toBe(0);
    expect(deriveScore(5, false)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeLifecycleState — all 8 rules
// ---------------------------------------------------------------------------

describe("computeLifecycleState", () => {
  const latestWithAAPL = makeSnap({ topGrowth: [{ rank: 1, symbol: "AAPL" }] });
  const prevWithAAPL   = makeSnap({ topGrowth: [{ rank: 3, symbol: "AAPL" }], id: "snap-prev" });
  const prevWithAAPLW  = makeSnap({ topWatchlist: [{ symbol: "AAPL" }], id: "snap-prev" });
  const latestWithAAPLW = makeSnap({ topWatchlist: [{ symbol: "AAPL" }] });
  const emptyLatest    = makeSnap({});
  const emptyPrev      = makeSnap({ id: "snap-prev" });

  it("NEWLY_QUALIFIED: symbol in latest qualified, absent from ALL previous buckets", () => {
    const state = computeLifecycleState(
      "AAPL",
      maps(latestWithAAPL),
      maps(emptyPrev),
      0,
    );
    expect(state).toBe("NEWLY_QUALIFIED");
  });

  it("NEWLY_QUALIFIED: symbol in latest qualified, was in previous watch (promoted)", () => {
    const state = computeLifecycleState(
      "AAPL",
      maps(latestWithAAPL),
      maps(prevWithAAPLW),
      0,
    );
    expect(state).toBe("NEWLY_QUALIFIED");
  });

  it("STILL_QUALIFIED: rank delta is 0", () => {
    const snap1 = makeSnap({ topGrowth: [{ rank: 2, symbol: "AAPL" }] });
    const snap2 = makeSnap({ topGrowth: [{ rank: 2, symbol: "AAPL" }], id: "prev" });
    const state = computeLifecycleState("AAPL", maps(snap1), maps(snap2), 0);
    expect(state).toBe("STILL_QUALIFIED");
  });

  it("STILL_QUALIFIED: rank delta is +1 (slightly worse)", () => {
    const snap1 = makeSnap({ topGrowth: [{ rank: 3, symbol: "AAPL" }] });
    const snap2 = makeSnap({ topGrowth: [{ rank: 2, symbol: "AAPL" }], id: "prev" });
    const state = computeLifecycleState("AAPL", maps(snap1), maps(snap2), 0);
    expect(state).toBe("STILL_QUALIFIED");
  });

  it("STILL_QUALIFIED: rank delta is -1 (slightly better)", () => {
    const snap1 = makeSnap({ topGrowth: [{ rank: 2, symbol: "AAPL" }] });
    const snap2 = makeSnap({ topGrowth: [{ rank: 3, symbol: "AAPL" }], id: "prev" });
    const state = computeLifecycleState("AAPL", maps(snap1), maps(snap2), 0);
    expect(state).toBe("STILL_QUALIFIED");
  });

  it("STRENGTHENING: rank improved by exactly 2", () => {
    const snap1 = makeSnap({ topGrowth: [{ rank: 1, symbol: "AAPL" }] });
    const snap2 = makeSnap({ topGrowth: [{ rank: 3, symbol: "AAPL" }], id: "prev" });
    const state = computeLifecycleState("AAPL", maps(snap1), maps(snap2), 0);
    expect(state).toBe("STRENGTHENING");
  });

  it("STRENGTHENING: rank improved by 5", () => {
    const snap1 = makeSnap({ topGrowth: [{ rank: 1, symbol: "TSLA" }] });
    const snap2 = makeSnap({ topGrowth: [{ rank: 6, symbol: "TSLA" }], id: "prev" });
    const state = computeLifecycleState("TSLA", maps(snap1), maps(snap2), 0);
    expect(state).toBe("STRENGTHENING");
  });

  it("WEAKENING: rank worsened by exactly 2", () => {
    const snap1 = makeSnap({ topGrowth: [{ rank: 5, symbol: "MSFT" }] });
    const snap2 = makeSnap({ topGrowth: [{ rank: 3, symbol: "MSFT" }], id: "prev" });
    const state = computeLifecycleState("MSFT", maps(snap1), maps(snap2), 0);
    expect(state).toBe("WEAKENING");
  });

  it("WEAKENING: rank worsened by 4", () => {
    const snap1 = makeSnap({ topGrowth: [{ rank: 8, symbol: "NVDA" }] });
    const snap2 = makeSnap({ topGrowth: [{ rank: 4, symbol: "NVDA" }], id: "prev" });
    const state = computeLifecycleState("NVDA", maps(snap1), maps(snap2), 0);
    expect(state).toBe("WEAKENING");
  });

  it("APPROACHING: symbol in latest watch, regardless of previous", () => {
    const state = computeLifecycleState(
      "AAPL",
      maps(latestWithAAPLW),
      maps(emptyPrev),
      0,
    );
    expect(state).toBe("APPROACHING");
  });

  it("APPROACHING: symbol in latest watch, was in previous watch too", () => {
    const state = computeLifecycleState(
      "AAPL",
      maps(latestWithAAPLW),
      maps(prevWithAAPLW),
      0,
    );
    expect(state).toBe("APPROACHING");
  });

  it("TRIGGERED: symbol in previous qualified, absent from ALL latest buckets", () => {
    const state = computeLifecycleState(
      "AAPL",
      maps(emptyLatest),
      maps(prevWithAAPL),
      0,
    );
    expect(state).toBe("TRIGGERED");
  });

  it("DROPPED: symbol in previous watch only, absent from ALL latest buckets", () => {
    const state = computeLifecycleState(
      "AAPL",
      maps(emptyLatest),
      maps(prevWithAAPLW),
      0,
    );
    expect(state).toBe("DROPPED");
  });

  it("UNAVAILABLE overrides TRIGGERED when unavailableCount > 0", () => {
    const state = computeLifecycleState(
      "AAPL",
      maps(emptyLatest),
      maps(prevWithAAPL),
      3, // unavailableCount > 0
    );
    expect(state).toBe("UNAVAILABLE");
  });

  it("UNAVAILABLE overrides DROPPED when unavailableCount > 0", () => {
    const state = computeLifecycleState(
      "AAPL",
      maps(emptyLatest),
      maps(prevWithAAPLW),
      1,
    );
    expect(state).toBe("UNAVAILABLE");
  });

  it("TRIGGERED (not UNAVAILABLE) when unavailableCount is 0", () => {
    const state = computeLifecycleState(
      "AAPL",
      maps(emptyLatest),
      maps(prevWithAAPL),
      0, // no unavailable
    );
    expect(state).toBe("TRIGGERED");
  });
});

// ---------------------------------------------------------------------------
// compareSnapshots
// ---------------------------------------------------------------------------

describe("compareSnapshots — no previous scan", () => {
  it("all current symbols are treated as NEWLY_QUALIFIED", () => {
    const latest = makeSnap({
      topGrowth: [{ rank: 1, symbol: "AAPL" }, { rank: 2, symbol: "MSFT" }],
      topWatchlist: [{ symbol: "NVDA" }],
    });
    const result = compareSnapshots(latest, null);

    expect(result.hasPreviousScan).toBe(false);
    expect(result.newOpportunities.map(i => i.symbol)).toContain("AAPL");
    expect(result.newOpportunities.map(i => i.symbol)).toContain("MSFT");
    expect(result.approaching.map(i => i.symbol)).toContain("NVDA");
    expect(result.triggered).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.summary.previousScanTime).toBeNull();
  });

  it("summary counts match item arrays", () => {
    const latest = makeSnap({
      topGrowth: [{ rank: 1, symbol: "AAPL" }],
      topWatchlist: [{ symbol: "TSLA" }],
    });
    const result = compareSnapshots(latest, null);
    expect(result.summary.newCount).toBe(result.newOpportunities.length);
    expect(result.summary.approachingCount).toBe(result.approaching.length);
  });
});

describe("compareSnapshots — with previous scan", () => {
  it("correctly identifies NEWLY_QUALIFIED, STRENGTHENING, TRIGGERED, DROPPED", () => {
    const prev = makeSnap({
      id: "snap-prev",
      topGrowth: [
        { rank: 3, symbol: "AAPL" }, // was #3, now gone → TRIGGERED
        { rank: 1, symbol: "MSFT" }, // was #1, still here
      ],
      topWatchlist: [{ symbol: "GOOG" }], // was watch, now gone → DROPPED
      completedAt: "2024-01-01T00:00:00Z",
    });

    const latest = makeSnap({
      id: "snap-latest",
      topGrowth: [
        { rank: 1, symbol: "MSFT" }, // unchanged rank → STILL_QUALIFIED
        { rank: 2, symbol: "NVDA" }, // brand new → NEWLY_QUALIFIED
        { rank: 3, symbol: "TSLA" }, // brand new → NEWLY_QUALIFIED
      ],
      topWatchlist: [{ symbol: "AMD" }], // brand new watch → APPROACHING
      completedAt: "2024-01-02T00:00:00Z",
    });

    const result = compareSnapshots(latest, prev);
    expect(result.hasPreviousScan).toBe(true);

    const bySymbol = new Map(result.all.map(i => [i.symbol, i]));

    expect(bySymbol.get("MSFT")?.lifecycleState).toBe("STILL_QUALIFIED");
    expect(bySymbol.get("NVDA")?.lifecycleState).toBe("NEWLY_QUALIFIED");
    expect(bySymbol.get("TSLA")?.lifecycleState).toBe("NEWLY_QUALIFIED");
    expect(bySymbol.get("AMD")?.lifecycleState).toBe("APPROACHING");
    expect(bySymbol.get("AAPL")?.lifecycleState).toBe("TRIGGERED");
    expect(bySymbol.get("GOOG")?.lifecycleState).toBe("DROPPED");
  });

  it("STRENGTHENING detected when rank improved by ≥ 2", () => {
    const prev = makeSnap({ id: "prev", topGrowth: [{ rank: 5, symbol: "NVDA" }] });
    const latest = makeSnap({ topGrowth: [{ rank: 2, symbol: "NVDA" }] });
    const result = compareSnapshots(latest, prev);
    expect(result.improving[0]?.symbol).toBe("NVDA");
    expect(result.improving[0]?.lifecycleState).toBe("STRENGTHENING");
  });

  it("WEAKENING detected when rank worsened by ≥ 2", () => {
    const prev = makeSnap({ id: "prev", topGrowth: [{ rank: 1, symbol: "META" }] });
    const latest = makeSnap({ topGrowth: [{ rank: 4, symbol: "META" }] });
    const result = compareSnapshots(latest, prev);
    expect(result.weakening[0]?.symbol).toBe("META");
    expect(result.weakening[0]?.lifecycleState).toBe("WEAKENING");
  });

  it("scoreDelta is positive for STRENGTHENING, negative for WEAKENING", () => {
    const prev = makeSnap({ id: "prev", topGrowth: [{ rank: 6, symbol: "AAPL" }] });
    const latest = makeSnap({ topGrowth: [{ rank: 1, symbol: "AAPL" }] });
    const result = compareSnapshots(latest, prev);
    const item = result.all.find(i => i.symbol === "AAPL");
    expect(item?.scoreDelta).toBeGreaterThan(0);

    const prev2 = makeSnap({ id: "prev2", topGrowth: [{ rank: 1, symbol: "MSFT" }] });
    const latest2 = makeSnap({ topGrowth: [{ rank: 5, symbol: "MSFT" }] });
    const result2 = compareSnapshots(latest2, prev2);
    const item2 = result2.all.find(i => i.symbol === "MSFT");
    expect(item2?.scoreDelta).toBeLessThan(0);
  });

  it("summary counts match bucket arrays", () => {
    const prev = makeSnap({
      id: "prev",
      topGrowth: [{ rank: 1, symbol: "OLD" }],
      topWatchlist: [{ symbol: "WATCH_OLD" }],
    });
    const latest = makeSnap({
      topGrowth: [{ rank: 1, symbol: "NEW" }],
      topWatchlist: [{ symbol: "WATCH_NEW" }],
    });
    const result = compareSnapshots(latest, prev);
    expect(result.summary.newCount).toBe(result.newOpportunities.length);
    expect(result.summary.triggeredCount).toBe(result.triggered.length);
    expect(result.summary.removedCount).toBe(result.removed.length);
    expect(result.summary.approachingCount).toBe(result.approaching.length);
  });

  it("firstSeen map is used when provided", () => {
    const prev = makeSnap({ id: "prev", topGrowth: [{ rank: 2, symbol: "AAPL" }] });
    const latest = makeSnap({ topGrowth: [{ rank: 1, symbol: "AAPL" }] });
    const firstSeenMap = new Map([["AAPL", "2023-06-01T00:00:00Z"]]);
    const result = compareSnapshots(latest, prev, firstSeenMap);
    const item = result.all.find(i => i.symbol === "AAPL");
    expect(item?.firstSeen).toBe("2023-06-01T00:00:00Z");
  });

  it("symbol appearing in both topGrowth and topIncome uses lowest rank", () => {
    const snap = makeSnap({
      topGrowth: [{ rank: 3, symbol: "AAPL" }],
      topIncome: [{ rank: 1, symbol: "AAPL" }],
    });
    const mapsResult = buildBucketMaps(snap);
    expect(mapsResult.qualifiedBySymbol.get("AAPL")?.rank).toBe(1);
  });

  it("statistics: topMover is the symbol with the largest rank improvement", () => {
    const prev = makeSnap({
      id: "prev",
      topGrowth: [
        { rank: 10, symbol: "AAPL" },
        { rank: 5, symbol: "MSFT" },
      ],
    });
    const latest = makeSnap({
      topGrowth: [
        { rank: 2, symbol: "AAPL" }, // improved by 8
        { rank: 3, symbol: "MSFT" }, // improved by 2
      ],
    });
    const result = compareSnapshots(latest, prev);
    expect(result.statistics.topMover).toBe("AAPL");
  });

  it("statistics: mostStable is the first STILL_QUALIFIED symbol", () => {
    const prev = makeSnap({ id: "prev", topGrowth: [{ rank: 2, symbol: "STABLE" }] });
    const latest = makeSnap({ topGrowth: [{ rank: 2, symbol: "STABLE" }] });
    const result = compareSnapshots(latest, prev);
    expect(result.statistics.mostStable).toBe("STABLE");
  });
});

describe("compareSnapshots — partial/missing data", () => {
  it("handles empty latest snapshot (no candidates)", () => {
    const prev = makeSnap({
      id: "prev",
      topGrowth: [{ rank: 1, symbol: "AAPL" }],
    });
    const latest = makeSnap({}); // empty
    const result = compareSnapshots(latest, prev);
    // AAPL should be TRIGGERED (unavailableCount = 0)
    expect(result.triggered[0]?.symbol).toBe("AAPL");
    expect(result.newOpportunities).toHaveLength(0);
  });

  it("handles gracefully when previous and latest are identical", () => {
    const snap = makeSnap({ topGrowth: [{ rank: 1, symbol: "AAPL" }] });
    const prev = makeSnap({ topGrowth: [{ rank: 1, symbol: "AAPL" }], id: "prev" });
    const result = compareSnapshots(snap, prev);
    expect(result.stillQualified[0]?.symbol).toBe("AAPL");
    expect(result.summary.newCount).toBe(0);
    expect(result.summary.triggeredCount).toBe(0);
  });

  it("all: contains every symbol from both scans", () => {
    const prev = makeSnap({
      id: "prev",
      topGrowth: [{ rank: 1, symbol: "OLD" }],
    });
    const latest = makeSnap({ topGrowth: [{ rank: 1, symbol: "NEW" }] });
    const result = compareSnapshots(latest, prev);
    const symbols = result.all.map(i => i.symbol);
    expect(symbols).toContain("NEW");
    expect(symbols).toContain("OLD");
  });
});
