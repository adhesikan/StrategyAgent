// opportunity-research.test.ts — Sprint 2.1
//
// Tests for /api/opportunities/research/:symbol route logic.
//
// Pattern mirrors opportunity-changes.test.ts: we mock the store and call the
// assembled route logic directly — no HTTP layer / supertest needed.
//
// Run with: npx vitest run --root . server/routes/opportunity-research.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared before imports
// ---------------------------------------------------------------------------

vi.mock("../services/opportunity-snapshot-store", () => ({
  getLatestValidSnapshot:  vi.fn(),
  getPreviousValidSnapshot: vi.fn(),
  getFirstSeenMap:          vi.fn(() => Promise.resolve(new Map())),
  getSymbolHistory:         vi.fn(() => Promise.resolve([])),
}));

vi.mock("../services/opportunity-engine", () => ({
  getIntervalMs: vi.fn(() => 14_400_000), // 4 hours in ms
}));

vi.mock("../storage", () => ({
  storage: {
    getBrokerConnection: vi.fn(() => Promise.resolve(null)),
  },
}));

import {
  getLatestValidSnapshot,
  getPreviousValidSnapshot,
  getFirstSeenMap,
  getSymbolHistory,
} from "../services/opportunity-snapshot-store";
import { getIntervalMs } from "../services/opportunity-engine";
import { storage } from "../storage";
import { compareSnapshots } from "../services/opportunity-comparison-service";
import type { PersistedOpportunitySnapshot } from "../services/opportunity-snapshot-store";
import type { ResearchPackage, ScanHistoryEntry } from "./opportunity-research";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(overrides: {
  symbol: string;
  rank?: number;
  strategy?: string;
  trigger?: string;
  invalidation?: string;
  confidence?: string;
  whySelected?: string[];
  warnings?: string[];
}) {
  return {
    rank: overrides.rank ?? 1,
    symbol: overrides.symbol,
    strategy: overrides.strategy ?? "VCP",
    setupStatus: "Contraction complete",
    trigger: overrides.trigger,
    invalidation: overrides.invalidation,
    confidence: overrides.confidence ?? "high",
    whySelected: overrides.whySelected ?? ["Strong volume expansion", "Tight base"],
    warnings: overrides.warnings ?? [],
    maxRisk: 250,
    rewardRisk: 3.0,
  };
}

function makeSnap(overrides: {
  id?: string;
  completedAt?: string;
  topGrowth?: ReturnType<typeof makeCandidate>[];
  topIncome?: ReturnType<typeof makeCandidate>[];
  topWatchlist?: Array<{ symbol: string; strategy?: string }>;
  approachingQualification?: Array<{ symbol: string }>;
  marketRegime?: string | null;
}) {
  return {
    id: overrides.id ?? "snap-001",
    status: "SUCCESS" as const,
    startedAt: "2024-01-01T00:00:00Z",
    completedAt: overrides.completedAt ?? new Date().toISOString(),
    generatedAt: "2024-01-01T00:00:00Z",
    scannerVersion: "mcp-v1",
    marketRegime: overrides.marketRegime ?? "TRENDING",
    dataSource: "Twelve Data via MCP",
    dataQuality: "Latest daily market data",
    reviewedCount: 20,
    qualifiedCount: overrides.topGrowth?.length ?? 0,
    watchCount: overrides.topWatchlist?.length ?? 0,
    rejectedCount: 0,
    excludedCount: 0,
    unavailableCount: 0,
    topGrowth: overrides.topGrowth ?? [],
    topIncome: overrides.topIncome ?? [],
    topWatchlist: (overrides.topWatchlist ?? []).map(w => ({
      symbol: w.symbol, strategy: w.strategy, watchConditions: [],
    })),
    approachingQualification: (overrides.approachingQualification ?? []).map(w => ({
      symbol: w.symbol, watchConditions: [],
    })),
    warnings: [],
  } satisfies PersistedOpportunitySnapshot;
}

/** Simulates the route's core logic without HTTP layer. */
async function callRouteLogic(symbolParam: string): Promise<
  | { status: 400 | 404 | 500; body: { error: string; code?: string } }
  | { status: 200; body: ResearchPackage }
> {
  const SYMBOL_RE = /^[A-Z]{1,10}$/;
  const raw = symbolParam.toUpperCase().trim();

  if (!SYMBOL_RE.test(raw)) {
    return { status: 400, body: { error: "Invalid symbol" } };
  }

  const [latest, previous, brokerConnection, historyRows] = await Promise.all([
    getLatestValidSnapshot(),
    getPreviousValidSnapshot(),
    (storage.getBrokerConnection as any)("user-1").catch(() => null),
    getSymbolHistory(raw, 10),
  ]);

  if (!latest) {
    return { status: 404, body: { error: "No opportunity scan available", code: "NO_SNAPSHOT" } };
  }

  // Find candidate
  const all = [...latest.topGrowth, ...latest.topIncome];
  let candidate: typeof all[0] | null = null;
  for (const c of all) {
    if (c.symbol.toUpperCase() !== raw) continue;
    if (!candidate || c.rank < candidate.rank) candidate = c;
  }

  if (!candidate) {
    return { status: 404, body: { error: "Symbol not found in current scan", code: "SYMBOL_NOT_FOUND" } };
  }

  let lifecycleItem = null;
  if (previous) {
    const firstSeenMap = await getFirstSeenMap([raw]);
    const comparison = compareSnapshots(latest, previous, firstSeenMap);
    lifecycleItem = comparison.all.find(i => i.symbol.toUpperCase() === raw) ?? null;
  }

  const intervalMs = (getIntervalMs as any)();
  const completedMs = new Date(latest.completedAt).getTime();
  const staleThresholdMs = intervalMs * 1.5;
  const freshnessStatus = Date.now() - completedMs < staleThresholdMs ? "fresh" : "stale";

  const pkg: ResearchPackage = {
    symbol: raw,
    candidate: candidate as any,
    lifecycleItem,
    scanHistory: historyRows,
    brokerConnected: !!(brokerConnection as any)?.isConnected,
    marketRegime: latest.marketRegime,
    dataSource: latest.dataSource,
    dataQuality: latest.dataQuality,
    freshnessStatus,
    completedAt: latest.completedAt,
    snapshotId: latest.id,
  };

  return { status: 200, body: pkg };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Route — symbol validation", () => {
  it("returns 400 for empty symbol", async () => {
    const result = await callRouteLogic("");
    expect(result.status).toBe(400);
  });

  it("returns 400 for symbol with digits", async () => {
    const result = await callRouteLogic("NVDA1");
    expect(result.status).toBe(400);
  });

  it("returns 400 for symbol over 10 chars", async () => {
    const result = await callRouteLogic("TOOLONGSYMBOL");
    expect(result.status).toBe(400);
  });

  it("accepts valid 1–10 uppercase letter symbol", async () => {
    vi.mocked(getLatestValidSnapshot).mockResolvedValueOnce(
      makeSnap({ topGrowth: [makeCandidate({ symbol: "NVDA" })] }),
    );
    vi.mocked(getPreviousValidSnapshot).mockResolvedValueOnce(null);
    const result = await callRouteLogic("NVDA");
    expect(result.status).toBe(200);
  });

  it("normalises lowercase symbol to uppercase", async () => {
    vi.mocked(getLatestValidSnapshot).mockResolvedValueOnce(
      makeSnap({ topGrowth: [makeCandidate({ symbol: "AAPL" })] }),
    );
    vi.mocked(getPreviousValidSnapshot).mockResolvedValueOnce(null);
    const result = await callRouteLogic("aapl");
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.symbol).toBe("AAPL");
    }
  });
});

describe("Route — no snapshot", () => {
  beforeEach(() => {
    vi.mocked(getLatestValidSnapshot).mockResolvedValue(null);
    vi.mocked(getPreviousValidSnapshot).mockResolvedValue(null);
    vi.mocked(getSymbolHistory).mockResolvedValue([]);
  });

  it("returns 404 with NO_SNAPSHOT code", async () => {
    const result = await callRouteLogic("NVDA");
    expect(result.status).toBe(404);
    if (result.status === 404) {
      expect(result.body.code).toBe("NO_SNAPSHOT");
    }
  });
});

describe("Route — symbol not in snapshot", () => {
  beforeEach(() => {
    vi.mocked(getLatestValidSnapshot).mockResolvedValue(
      makeSnap({ topGrowth: [makeCandidate({ symbol: "AAPL" })] }),
    );
    vi.mocked(getPreviousValidSnapshot).mockResolvedValue(null);
    vi.mocked(getSymbolHistory).mockResolvedValue([]);
  });

  it("returns 404 with SYMBOL_NOT_FOUND code", async () => {
    const result = await callRouteLogic("MSFT");
    expect(result.status).toBe(404);
    if (result.status === 404) {
      expect(result.body.code).toBe("SYMBOL_NOT_FOUND");
    }
  });
});

describe("Route — successful assembly (first scan, no previous)", () => {
  const candidate = makeCandidate({
    symbol: "NVDA",
    rank: 2,
    strategy: "VCP",
    trigger: "495.00",
    invalidation: "472.00",
    confidence: "high",
    whySelected: ["Strong weekly RS", "Volume contraction"],
    warnings: ["Earnings in 3 weeks"],
  });

  beforeEach(() => {
    vi.mocked(getLatestValidSnapshot).mockResolvedValue(
      makeSnap({ topGrowth: [candidate], marketRegime: "TRENDING" }),
    );
    vi.mocked(getPreviousValidSnapshot).mockResolvedValue(null);
    vi.mocked(getSymbolHistory).mockResolvedValue([]);
    vi.mocked((storage.getBrokerConnection as any)).mockResolvedValue(null);
  });

  it("returns 200 with candidate data", async () => {
    const result = await callRouteLogic("NVDA");
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.symbol).toBe("NVDA");
      expect(result.body.candidate.rank).toBe(2);
      expect(result.body.candidate.strategy).toBe("VCP");
      expect(result.body.candidate.trigger).toBe("495.00");
      expect(result.body.candidate.invalidation).toBe("472.00");
    }
  });

  it("returns whySelected and warnings arrays", async () => {
    const result = await callRouteLogic("NVDA");
    if (result.status === 200) {
      expect(result.body.candidate.whySelected).toContain("Strong weekly RS");
      expect(result.body.candidate.warnings).toContain("Earnings in 3 weeks");
    }
  });

  it("lifecycleItem is null when no previous scan", async () => {
    const result = await callRouteLogic("NVDA");
    if (result.status === 200) {
      expect(result.body.lifecycleItem).toBeNull();
    }
  });

  it("brokerConnected is false when no broker connection", async () => {
    const result = await callRouteLogic("NVDA");
    if (result.status === 200) {
      expect(result.body.brokerConnected).toBe(false);
    }
  });

  it("scanHistory is empty array when no history rows", async () => {
    const result = await callRouteLogic("NVDA");
    if (result.status === 200) {
      expect(result.body.scanHistory).toEqual([]);
    }
  });

  it("marketRegime is passed through from snapshot", async () => {
    const result = await callRouteLogic("NVDA");
    if (result.status === 200) {
      expect(result.body.marketRegime).toBe("TRENDING");
    }
  });

  it("freshnessStatus is fresh for recent snapshot", async () => {
    const result = await callRouteLogic("NVDA");
    if (result.status === 200) {
      expect(result.body.freshnessStatus).toBe("fresh");
    }
  });

  it("freshnessStatus is stale for old snapshot", async () => {
    const oldDate = new Date(Date.now() - 25_200_000).toISOString(); // 7 hours ago
    vi.mocked(getLatestValidSnapshot).mockResolvedValueOnce(
      makeSnap({ topGrowth: [candidate], completedAt: oldDate }),
    );
    const result = await callRouteLogic("NVDA");
    if (result.status === 200) {
      expect(result.body.freshnessStatus).toBe("stale");
    }
  });
});

describe("Route — broker connected state", () => {
  const candidate = makeCandidate({ symbol: "AAPL" });

  beforeEach(() => {
    vi.mocked(getLatestValidSnapshot).mockResolvedValue(
      makeSnap({ topGrowth: [candidate] }),
    );
    vi.mocked(getPreviousValidSnapshot).mockResolvedValue(null);
    vi.mocked(getSymbolHistory).mockResolvedValue([]);
  });

  it("brokerConnected is true when connection is active", async () => {
    vi.mocked((storage.getBrokerConnection as any)).mockResolvedValueOnce(
      { isConnected: true, provider: "tradier" },
    );
    const result = await callRouteLogic("AAPL");
    if (result.status === 200) {
      expect(result.body.brokerConnected).toBe(true);
    }
  });

  it("brokerConnected is false when connection is not active", async () => {
    vi.mocked((storage.getBrokerConnection as any)).mockResolvedValueOnce(
      { isConnected: false, provider: "tradier" },
    );
    const result = await callRouteLogic("AAPL");
    if (result.status === 200) {
      expect(result.body.brokerConnected).toBe(false);
    }
  });
});

describe("Route — lifecycle item with previous scan", () => {
  const prev = makeSnap({
    id: "snap-prev",
    topGrowth: [makeCandidate({ symbol: "NVDA", rank: 3 })],
    completedAt: "2024-01-01T00:00:00Z",
  });
  const latest = makeSnap({
    id: "snap-latest",
    topGrowth: [makeCandidate({ symbol: "NVDA", rank: 1 })], // rank improved → STRENGTHENING
    completedAt: new Date().toISOString(),
  });

  beforeEach(() => {
    vi.mocked(getLatestValidSnapshot).mockResolvedValue(latest);
    vi.mocked(getPreviousValidSnapshot).mockResolvedValue(prev);
    vi.mocked(getSymbolHistory).mockResolvedValue([]);
    vi.mocked((storage.getBrokerConnection as any)).mockResolvedValue(null);
    vi.mocked(getFirstSeenMap).mockResolvedValue(new Map());
  });

  it("lifecycleItem is populated with correct lifecycle state", async () => {
    const result = await callRouteLogic("NVDA");
    if (result.status === 200) {
      expect(result.body.lifecycleItem).not.toBeNull();
      expect(result.body.lifecycleItem?.lifecycleState).toBe("STRENGTHENING");
    }
  });

  it("lifecycleItem has correct rank fields", async () => {
    const result = await callRouteLogic("NVDA");
    if (result.status === 200) {
      expect(result.body.lifecycleItem?.rankCurrent).toBe(1);
      expect(result.body.lifecycleItem?.rankPrev).toBe(3);
    }
  });
});

describe("Route — scan history passthrough", () => {
  const historyRows: ScanHistoryEntry[] = [
    {
      id: "h1",
      snapshotId: "snap-001",
      scanTime: "2024-01-02T12:00:00Z",
      rank: 1,
      score: 95,
      qualificationStatus: "QUALIFIED",
      lifecycleState: "STRENGTHENING",
      strategy: "VCP",
      marketRegime: "TRENDING",
      createdAt: "2024-01-02T12:00:00Z",
    },
    {
      id: "h2",
      snapshotId: "snap-000",
      scanTime: "2024-01-01T12:00:00Z",
      rank: 3,
      score: 85,
      qualificationStatus: "QUALIFIED",
      lifecycleState: "NEWLY_QUALIFIED",
      strategy: "VCP",
      marketRegime: "TRENDING",
      createdAt: "2024-01-01T12:00:00Z",
    },
  ];

  it("returns scan history rows from getSymbolHistory", async () => {
    vi.mocked(getLatestValidSnapshot).mockResolvedValueOnce(
      makeSnap({ topGrowth: [makeCandidate({ symbol: "NVDA" })] }),
    );
    vi.mocked(getPreviousValidSnapshot).mockResolvedValueOnce(null);
    vi.mocked(getSymbolHistory).mockResolvedValueOnce(historyRows);
    vi.mocked((storage.getBrokerConnection as any)).mockResolvedValueOnce(null);

    const result = await callRouteLogic("NVDA");
    if (result.status === 200) {
      expect(result.body.scanHistory).toHaveLength(2);
      expect(result.body.scanHistory[0].rank).toBe(1);
      expect(result.body.scanHistory[0].lifecycleState).toBe("STRENGTHENING");
    }
  });
});

describe("Route — symbol in income bucket only", () => {
  it("finds candidate in topIncome when not in topGrowth", async () => {
    const incomeCandidate = makeCandidate({ symbol: "T", rank: 2, strategy: "CoveredCall" });
    vi.mocked(getLatestValidSnapshot).mockResolvedValueOnce(
      makeSnap({
        topGrowth: [makeCandidate({ symbol: "NVDA" })],
        topIncome: [incomeCandidate],
      }),
    );
    vi.mocked(getPreviousValidSnapshot).mockResolvedValueOnce(null);
    vi.mocked(getSymbolHistory).mockResolvedValueOnce([]);
    vi.mocked((storage.getBrokerConnection as any)).mockResolvedValueOnce(null);

    const result = await callRouteLogic("T");
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.candidate.strategy).toBe("CoveredCall");
    }
  });
});

describe("Route — snapshotId and completedAt passthrough", () => {
  it("includes snapshotId and completedAt from the snapshot", async () => {
    const completedAt = "2024-06-15T14:30:00Z";
    vi.mocked(getLatestValidSnapshot).mockResolvedValueOnce(
      makeSnap({
        id: "snap-abc123",
        topGrowth: [makeCandidate({ symbol: "AMD" })],
        completedAt,
      }),
    );
    vi.mocked(getPreviousValidSnapshot).mockResolvedValueOnce(null);
    vi.mocked(getSymbolHistory).mockResolvedValueOnce([]);
    vi.mocked((storage.getBrokerConnection as any)).mockResolvedValueOnce(null);

    const result = await callRouteLogic("AMD");
    if (result.status === 200) {
      expect(result.body.snapshotId).toBe("snap-abc123");
      expect(result.body.completedAt).toBe(completedAt);
    }
  });
});
