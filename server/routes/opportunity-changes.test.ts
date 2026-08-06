// opportunity-changes.test.ts — Sprint 2.0
//
// Tests for the /api/opportunities/changes route logic.
//
// The route is a thin wrapper:
//   getLatestValidSnapshot() + getPreviousValidSnapshot() → compareSnapshots() → JSON
//
// We test the integration by mocking the store and verifying the combined output
// shape, empty-diff behaviour, and firstSeen passthrough — no HTTP layer needed.
//
// Run with: npx vitest run --root . server/routes/opportunity-changes.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before the import of the module under test.
// ---------------------------------------------------------------------------

vi.mock("../services/opportunity-snapshot-store", () => ({
  getLatestValidSnapshot:   vi.fn(),
  getPreviousValidSnapshot: vi.fn(),
  getFirstSeenMap:          vi.fn(() => Promise.resolve(new Map())),
}));

import {
  getLatestValidSnapshot,
  getPreviousValidSnapshot,
  getFirstSeenMap,
} from "../services/opportunity-snapshot-store";
import { compareSnapshots } from "../services/opportunity-comparison-service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> };

function makeSnap(overrides: {
  id?: string;
  completedAt?: string;
  topGrowth?: Array<{ rank: number; symbol: string; strategy?: string }>;
  topIncome?: Array<{ rank: number; symbol: string; strategy?: string }>;
  topWatchlist?: Array<{ symbol: string; strategy?: string }>;
  approachingQualification?: Array<{ symbol: string; strategy?: string }>;
  unavailableCount?: number;
}) {
  return {
    id: overrides.id ?? "snap-001",
    status: "SUCCESS" as const,
    startedAt:  "2024-01-01T00:00:00Z",
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
      rank: c.rank, symbol: c.symbol, strategy: c.strategy,
      whySelected: ["setup"], warnings: [],
    })),
    topIncome: (overrides.topIncome ?? []).map(c => ({
      rank: c.rank, symbol: c.symbol, strategy: c.strategy,
      whySelected: [], warnings: [],
    })),
    topWatchlist: (overrides.topWatchlist ?? []).map(w => ({
      symbol: w.symbol, strategy: w.strategy, watchConditions: [],
    })),
    approachingQualification: (overrides.approachingQualification ?? []).map(w => ({
      symbol: w.symbol, strategy: w.strategy, watchConditions: [],
    })),
    warnings: [],
  };
}

/** Simulates the route's core logic (fetch → collect symbols → compare). */
async function callRoute(
  firstSeenMap?: Map<string, string>,
): Promise<ReturnType<typeof compareSnapshots> | ReturnType<typeof emptyComparison>> {
  const [latest, previous] = await Promise.all([
    getLatestValidSnapshot(),
    getPreviousValidSnapshot(),
  ]);

  if (!latest) return emptyComparison();

  const allSymbols = new Set<string>();
  const addSyms = (snap: typeof latest | null) => {
    if (!snap) return;
    for (const c of [...snap.topGrowth, ...snap.topIncome]) {
      allSymbols.add(c.symbol.toUpperCase());
    }
    for (const w of [...snap.topWatchlist, ...snap.approachingQualification]) {
      allSymbols.add(w.symbol.toUpperCase());
    }
  };
  addSyms(latest as any);
  addSyms(previous as any);

  const resolvedMap = firstSeenMap ?? await getFirstSeenMap([...allSymbols]);
  return compareSnapshots(latest as any, previous as any, resolvedMap);
}

function emptyComparison() {
  return {
    hasPreviousScan: false,
    summary: {
      newCount: 0,
      triggeredCount: 0,
      improvingCount: 0,
      weakeningCount: 0,
      removedCount: 0,
      approachingCount: 0,
      stillQualifiedCount: 0,
      latestScanTime: null,
      previousScanTime: null,
    },
    newOpportunities: [],
    triggered: [],
    improving: [],
    weakening: [],
    removed: [],
    approaching: [],
    stillQualified: [],
    all: [],
    statistics: { avgRankDelta: 0, topMover: null, mostStable: null },
  } as const;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Route logic — no snapshot available", () => {
  beforeEach(() => {
    vi.mocked(getLatestValidSnapshot).mockResolvedValue(null);
    vi.mocked(getPreviousValidSnapshot).mockResolvedValue(null);
    vi.mocked(getFirstSeenMap).mockResolvedValue(new Map());
  });

  it("returns empty diff shape when no snapshot exists", async () => {
    const result = await callRoute();

    expect(result.hasPreviousScan).toBe(false);
    expect(result.newOpportunities).toEqual([]);
    expect(result.triggered).toEqual([]);
    expect(result.improving).toEqual([]);
    expect(result.weakening).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.approaching).toEqual([]);
    expect(result.stillQualified).toEqual([]);
    expect(result.all).toEqual([]);
  });

  it("summary all-zero and times null when no snapshot", async () => {
    const result = await callRoute();
    const s = result.summary;

    expect(s.newCount).toBe(0);
    expect(s.triggeredCount).toBe(0);
    expect(s.latestScanTime).toBeNull();
    expect(s.previousScanTime).toBeNull();
  });

  it("statistics zeroed / null when no snapshot", async () => {
    const result = await callRoute();
    expect(result.statistics.topMover).toBeNull();
    expect(result.statistics.mostStable).toBeNull();
    expect(result.statistics.avgRankDelta).toBe(0);
  });

  it("does NOT call getFirstSeenMap when no snapshot", async () => {
    await callRoute();
    expect(vi.mocked(getFirstSeenMap)).not.toHaveBeenCalled();
  });
});

describe("Route logic — first scan only (no previous)", () => {
  beforeEach(() => {
    vi.mocked(getLatestValidSnapshot).mockResolvedValue(
      makeSnap({ topGrowth: [{ rank: 1, symbol: "AAPL" }, { rank: 2, symbol: "MSFT" }] }) as any,
    );
    vi.mocked(getPreviousValidSnapshot).mockResolvedValue(null);
    vi.mocked(getFirstSeenMap).mockResolvedValue(new Map());
  });

  it("hasPreviousScan is false (compareSnapshots gets null prev)", async () => {
    const result = await callRoute();
    expect(result.hasPreviousScan).toBe(false);
  });

  it("current symbols are classified as NEWLY_QUALIFIED", async () => {
    const result = await callRoute();
    const symbols = result.newOpportunities.map((i: any) => i.symbol);
    expect(symbols).toContain("AAPL");
    expect(symbols).toContain("MSFT");
  });

  it("summary.newCount matches newOpportunities array length", async () => {
    const result = await callRoute();
    expect(result.summary.newCount).toBe(result.newOpportunities.length);
  });

  it("getFirstSeenMap is called with the symbol set from latest", async () => {
    await callRoute();
    const [calledWith] = vi.mocked(getFirstSeenMap).mock.calls[0];
    const symSet = new Set(calledWith);
    expect(symSet.has("AAPL")).toBe(true);
    expect(symSet.has("MSFT")).toBe(true);
  });
});

describe("Route logic — two scans available", () => {
  const prev = makeSnap({
    id: "snap-prev",
    topGrowth: [{ rank: 3, symbol: "AAPL" }], // was #3
    topWatchlist: [{ symbol: "GOOG" }],         // was watch
    completedAt: "2024-01-01T00:00:00Z",
  });

  const latest = makeSnap({
    id: "snap-latest",
    topGrowth: [
      { rank: 1, symbol: "AAPL" },  // improved rank → STRENGTHENING
      { rank: 2, symbol: "NVDA" },  // brand new → NEWLY_QUALIFIED
    ],
    topWatchlist: [{ symbol: "AMD" }], // brand new watch → APPROACHING
    completedAt: "2024-01-02T00:00:00Z",
  });

  beforeEach(() => {
    vi.mocked(getLatestValidSnapshot).mockResolvedValue(latest as any);
    vi.mocked(getPreviousValidSnapshot).mockResolvedValue(prev as any);
    vi.mocked(getFirstSeenMap).mockResolvedValue(new Map());
  });

  it("hasPreviousScan is true", async () => {
    const result = await callRoute();
    expect(result.hasPreviousScan).toBe(true);
  });

  it("response shape has all required arrays", async () => {
    const result = await callRoute();
    expect(Array.isArray(result.newOpportunities)).toBe(true);
    expect(Array.isArray(result.triggered)).toBe(true);
    expect(Array.isArray(result.improving)).toBe(true);
    expect(Array.isArray(result.weakening)).toBe(true);
    expect(Array.isArray(result.removed)).toBe(true);
    expect(Array.isArray(result.approaching)).toBe(true);
    expect(Array.isArray(result.stillQualified)).toBe(true);
    expect(Array.isArray(result.all)).toBe(true);
  });

  it("lifecycle state classification is correct per symbol", async () => {
    const result = await callRoute();
    const bySymbol = new Map(result.all.map((i: any) => [i.symbol, i]));

    expect((bySymbol.get("AAPL") as any)?.lifecycleState).toBe("STRENGTHENING");
    expect((bySymbol.get("NVDA") as any)?.lifecycleState).toBe("NEWLY_QUALIFIED");
    expect((bySymbol.get("AMD") as any)?.lifecycleState).toBe("APPROACHING");
    expect((bySymbol.get("GOOG") as any)?.lifecycleState).toBe("DROPPED");
  });

  it("summary counts match bucket array lengths", async () => {
    const result = await callRoute();
    expect(result.summary.newCount).toBe(result.newOpportunities.length);
    expect(result.summary.improvingCount).toBe(result.improving.length);
    expect(result.summary.removedCount).toBe(result.removed.length);
    expect(result.summary.approachingCount).toBe(result.approaching.length);
  });

  it("LifecycleItem fields are all present", async () => {
    const result = await callRoute();
    const item = result.all[0] as any;

    expect(typeof item.symbol).toBe("string");
    expect(typeof item.lifecycleState).toBe("string");
    expect(typeof item.qualificationStatus).toBe("string");
    expect(typeof item.scoreCurrent).toBe("number");
    expect(typeof item.scoreDelta).toBe("number");
    expect(typeof item.lastUpdated).toBe("string");
  });

  it("summary.latestScanTime reflects latest snapshot completedAt", async () => {
    const result = await callRoute();
    expect(result.summary.latestScanTime).toBe("2024-01-02T00:00:00Z");
    expect(result.summary.previousScanTime).toBe("2024-01-01T00:00:00Z");
  });

  it("firstSeen from history table is passed through when available", async () => {
    const result = await callRoute(new Map([["AAPL", "2023-06-01T00:00:00Z"]]));
    const item = result.all.find((i: any) => i.symbol === "AAPL") as any;
    expect(item?.firstSeen).toBe("2023-06-01T00:00:00Z");
  });

  it("all contains every symbol from both snapshots", async () => {
    const result = await callRoute();
    const symbols = new Set(result.all.map((i: any) => i.symbol));
    expect(symbols.has("AAPL")).toBe(true);
    expect(symbols.has("NVDA")).toBe(true);
    expect(symbols.has("AMD")).toBe(true);
    expect(symbols.has("GOOG")).toBe(true);
  });
});

describe("Route logic — symbol appears in both topGrowth and topWatchlist in prev", () => {
  it("uses the qualified bucket (not watch) when symbol is in both", async () => {
    const prev = makeSnap({
      id: "prev",
      topGrowth: [{ rank: 2, symbol: "MULTI" }],
      topWatchlist: [{ symbol: "MULTI" }], // same symbol in watch too
    });
    const latest = makeSnap({
      topGrowth: [{ rank: 4, symbol: "MULTI" }], // still qualified but rank fell
    });

    vi.mocked(getLatestValidSnapshot).mockResolvedValue(latest as any);
    vi.mocked(getPreviousValidSnapshot).mockResolvedValue(prev as any);
    vi.mocked(getFirstSeenMap).mockResolvedValue(new Map());

    const result = await callRoute();
    const item = result.all.find((i: any) => i.symbol === "MULTI") as any;

    // Rank went from 2 to 4 (+2 positions worse) → WEAKENING
    expect(item?.lifecycleState).toBe("WEAKENING");
    expect(item?.rankPrev).toBe(2);
    expect(item?.rankCurrent).toBe(4);
  });
});
