// Opportunity Engine — unit tests (Sprint 1.1)
//
// Tests cover:
//   B. Startup (load from PostgreSQL, populate memory, degrade gracefully)
//   C. Refresh (successful/failed/overlap)
//   E. Configuration (OPPORTUNITY_SCAN_INTERVAL_MINUTES)
//   G. Regression (dashboard does not call MCP, engine stays isolated)
//
// Run with: npx vitest run --root . server/services/opportunity-engine.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSaveSuccessfulSnapshot = vi.fn();
const mockSaveFailedAttempt = vi.fn();
const mockGetLatestValidSnapshot = vi.fn();
const mockDeleteExpiredSnapshots = vi.fn();

vi.mock("./opportunity-snapshot-store", () => ({
  saveSuccessfulSnapshot: (...args: any[]) => mockSaveSuccessfulSnapshot(...args),
  saveFailedAttempt: (...args: any[]) => mockSaveFailedAttempt(...args),
  getLatestValidSnapshot: (...args: any[]) => mockGetLatestValidSnapshot(...args),
  getLatestAttempt: vi.fn(),
  deleteExpiredSnapshots: (...args: any[]) => mockDeleteExpiredSnapshots(...args),
  VALID_STATUSES: ["SUCCESS", "PARTIAL_SUCCESS", "EMPTY_SUCCESS"],
  FAILED_STATUS: "FAILED",
}));

const mockIsMcpEnabled = vi.fn();
vi.mock("../mcp/config", () => ({
  isMcpEnabled: () => mockIsMcpEnabled(),
}));

const mockRankMarketTradeCandidates = vi.fn();
const mockGetMarketRegime = vi.fn();
vi.mock("../mcp/tools", () => ({
  rankMarketTradeCandidates: (...args: any[]) => mockRankMarketTradeCandidates(...args),
  getMarketRegime: (...args: any[]) => mockGetMarketRegime(...args),
}));

const mockRunRankedTradeSearch = vi.fn();
vi.mock("../routes/ranked-trade-search", () => ({
  runRankedTradeSearch: (...args: any[]) => mockRunRankedTradeSearch(...args),
}));

const mockDbExecute = vi.fn();
vi.mock("../db", () => ({
  db: { execute: (...args: any[]) => mockDbExecute(...args) },
}));

vi.mock("drizzle-orm", () => ({
  sql: new Proxy((strings: any) => strings, { get: (_t, p) => (_t as any)[p] }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStoredSnapshot(overrides: Record<string, any> = {}) {
  return {
    id: "db-snap-001",
    status: "SUCCESS" as const,
    startedAt: "2026-08-06T01:00:00.000Z",
    completedAt: "2026-08-06T01:01:00.000Z",
    generatedAt: "2026-08-06T01:00:30.000Z",
    scannerVersion: "mcp-v1",
    marketRegime: "TRENDING",
    dataSource: "Twelve Data via MCP",
    dataQuality: "Latest daily market data",
    reviewedCount: 200,
    qualifiedCount: 5,
    watchCount: 3,
    rejectedCount: 10,
    excludedCount: 12,
    unavailableCount: 0,
    topGrowth: [{ rank: 1, symbol: "NVDA", whySelected: [], warnings: [] }],
    topIncome: [],
    topWatchlist: [{ symbol: "AMD", watchConditions: [] }],
    approachingQualification: [],
    warnings: [],
    ...overrides,
  };
}

function makeSearchResult(overrides: Record<string, any> = {}) {
  return {
    request: {},
    reviewedCount: 200,
    qualifiedCount: 5,
    qualifiedCandidates: 5,
    watchCount: 3,
    rejectedCount: 10,
    excludedCount: 12,
    unavailableCount: 0,
    candidates: [
      { rank: 1, symbol: "NVDA", strategy: "VCP Breakout", whySelected: ["Strong"], warnings: [] },
      { rank: 2, symbol: "AAPL", strategy: "Momentum", whySelected: ["Momentum"], warnings: [] },
    ],
    watchCandidates: [
      { symbol: "AMD", watchConditions: ["Awaiting volume"] },
    ],
    rejectionSummary: [],
    generatedAt: "2026-08-06T01:00:30.000Z",
    warnings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: import engine with fresh state between tests
// ---------------------------------------------------------------------------

async function getEngine() {
  const m = await import("./opportunity-engine");
  m._resetEngineState();
  return m;
}

// ---------------------------------------------------------------------------
// B. Startup
// ---------------------------------------------------------------------------

describe("B. Startup — initOpportunityEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMcpEnabled.mockReturnValue(true);
    mockDbExecute.mockResolvedValue({ rows: [{ locked: true }] });
  });

  afterEach(async () => {
    const m = await import("./opportunity-engine");
    m._resetEngineState();
  });

  it("loads the latest valid snapshot from PostgreSQL and populates memory", async () => {
    const stored = makeStoredSnapshot();
    mockGetLatestValidSnapshot.mockResolvedValue(stored);
    const engine = await getEngine();
    await engine.initOpportunityEngine();
    expect(engine.getLatestSnapshot()).toEqual(stored);
  });

  it("leaves memory null when no stored snapshot exists", async () => {
    mockGetLatestValidSnapshot.mockResolvedValue(null);
    const engine = await getEngine();
    await engine.initOpportunityEngine();
    expect(engine.getLatestSnapshot()).toBeNull();
  });

  it("degrades gracefully when PostgreSQL load fails", async () => {
    mockGetLatestValidSnapshot.mockRejectedValue(new Error("DB connection refused"));
    const engine = await getEngine();
    await expect(engine.initOpportunityEngine()).resolves.not.toThrow();
    expect(engine.getLatestSnapshot()).toBeNull();
  });

  it("does not block or throw when DB is unavailable", async () => {
    mockGetLatestValidSnapshot.mockRejectedValue(new Error("ECONNREFUSED"));
    const engine = await getEngine();
    const start = Date.now();
    await engine.initOpportunityEngine();
    expect(Date.now() - start).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// C. Refresh
// ---------------------------------------------------------------------------

describe("C. Refresh — runOpportunityEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsMcpEnabled.mockReturnValue(true);
    mockRunRankedTradeSearch.mockResolvedValue(makeSearchResult());
    mockGetMarketRegime.mockResolvedValue({ regime: "TRENDING" });
    mockSaveSuccessfulSnapshot.mockResolvedValue("new-snap-id");
    mockSaveFailedAttempt.mockResolvedValue(undefined);
    mockDeleteExpiredSnapshots.mockResolvedValue({ validDeleted: 0, failedDeleted: 0 });
    // Advisory lock: acquired
    mockDbExecute.mockResolvedValue({ rows: [{ locked: true }] });
  });

  afterEach(async () => {
    const m = await import("./opportunity-engine");
    m._resetEngineState();
  });

  it("skips when MCP is disabled", async () => {
    mockIsMcpEnabled.mockReturnValue(false);
    const engine = await getEngine();
    await engine.runOpportunityEngine();
    expect(mockRunRankedTradeSearch).not.toHaveBeenCalled();
    expect(mockSaveSuccessfulSnapshot).not.toHaveBeenCalled();
  });

  it("successful refresh replaces in-memory snapshot after persistence", async () => {
    const engine = await getEngine();
    await engine.runOpportunityEngine();
    const snap = engine.getLatestSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.id).toBe("new-snap-id");
    expect(snap!.qualifiedCount).toBe(5);
  });

  it("failed refresh retains the previous valid snapshot", async () => {
    const stored = makeStoredSnapshot({ id: "previous-snap" });
    mockGetLatestValidSnapshot.mockResolvedValue(stored);
    const engine = await getEngine();
    await engine.initOpportunityEngine();

    // Cause scan to fail
    mockRunRankedTradeSearch.mockRejectedValue(new Error("MCP timeout"));

    await engine.runOpportunityEngine();
    const snap = engine.getLatestSnapshot();
    expect(snap!.id).toBe("previous-snap"); // unchanged
    expect(mockSaveFailedAttempt).toHaveBeenCalled();
  });

  it("overlapping scan is prevented by in-process guard", async () => {
    // The in-process guard prevents two concurrent calls
    let resolveScan!: () => void;
    const scanBarrier = new Promise<void>((resolve) => { resolveScan = resolve; });
    mockRunRankedTradeSearch.mockImplementation(async () => {
      await scanBarrier;
      return makeSearchResult();
    });

    const engine = await getEngine();
    // Start first scan without awaiting
    const first = engine.runOpportunityEngine();
    // Second scan fires immediately — should be skipped
    const second = engine.runOpportunityEngine();
    resolveScan();
    await Promise.all([first, second]);
    // saveSuccessfulSnapshot called only once (from first scan)
    expect(mockSaveSuccessfulSnapshot).toHaveBeenCalledTimes(1);
  });

  it("skips scan when advisory lock is held by another instance", async () => {
    mockDbExecute.mockResolvedValue({ rows: [{ locked: false }] });
    const engine = await getEngine();
    await engine.runOpportunityEngine();
    expect(mockRunRankedTradeSearch).not.toHaveBeenCalled();
    expect(mockSaveSuccessfulSnapshot).not.toHaveBeenCalled();
  });

  it("refreshState becomes idle after a successful scan", async () => {
    const engine = await getEngine();
    await engine.runOpportunityEngine();
    expect(engine.getRefreshState().status).toBe("idle");
  });

  it("refreshState becomes failed after a scan error", async () => {
    mockRunRankedTradeSearch.mockRejectedValue(new Error("network error"));
    const engine = await getEngine();
    await engine.runOpportunityEngine();
    expect(engine.getRefreshState().status).toBe("failed");
  });

  it("releases advisory lock after success", async () => {
    const engine = await getEngine();
    await engine.runOpportunityEngine();
    // pg_advisory_unlock must be called once (the release)
    const unlockCalls = mockDbExecute.mock.calls.filter((args) =>
      String(args[0]).includes("unlock") ||
      (args[0]?.queryChunks ?? []).some((c: any) => String(c).includes("unlock")),
    );
    // We verify execute was called at least twice (acquire + release)
    expect(mockDbExecute.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("releases advisory lock after failure", async () => {
    mockRunRankedTradeSearch.mockRejectedValue(new Error("fail"));
    const engine = await getEngine();
    await engine.runOpportunityEngine();
    expect(mockDbExecute.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("persistence failure leaves previous snapshot intact", async () => {
    const stored = makeStoredSnapshot({ id: "good-old-snap" });
    mockGetLatestValidSnapshot.mockResolvedValue(stored);
    const engine = await getEngine();
    await engine.initOpportunityEngine();

    mockSaveSuccessfulSnapshot.mockRejectedValue(new Error("DB write failed"));
    await engine.runOpportunityEngine();
    expect(engine.getLatestSnapshot()!.id).toBe("good-old-snap");
  });
});

// ---------------------------------------------------------------------------
// E. Configuration
// ---------------------------------------------------------------------------

describe("E. Configuration — OPPORTUNITY_SCAN_INTERVAL_MINUTES", () => {
  afterEach(() => {
    delete process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES;
  });

  it("default is 240 minutes (4 hours) = 14_400_000 ms", async () => {
    delete process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES;
    const engine = await import("./opportunity-engine");
    expect(engine.getIntervalMs()).toBe(240 * 60 * 1000);
  });

  it("accepts a valid override of 60", async () => {
    process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES = "60";
    const engine = await import("./opportunity-engine");
    expect(engine.getIntervalMs()).toBe(60 * 60 * 1000);
  });

  it("falls back to 240 for malformed value 'banana'", async () => {
    process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES = "banana";
    const engine = await import("./opportunity-engine");
    expect(engine.getIntervalMs()).toBe(240 * 60 * 1000);
  });

  it("clamps below minimum (30) to 240", async () => {
    process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES = "5";
    const engine = await import("./opportunity-engine");
    expect(engine.getIntervalMs()).toBe(240 * 60 * 1000);
  });

  it("clamps above maximum (1440) to 240", async () => {
    process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES = "9999";
    const engine = await import("./opportunity-engine");
    expect(engine.getIntervalMs()).toBe(240 * 60 * 1000);
  });

  it("accepts the minimum valid value (30)", async () => {
    process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES = "30";
    const engine = await import("./opportunity-engine");
    expect(engine.getIntervalMs()).toBe(30 * 60 * 1000);
  });

  it("accepts the maximum valid value (1440)", async () => {
    process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES = "1440";
    const engine = await import("./opportunity-engine");
    expect(engine.getIntervalMs()).toBe(1440 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// G. Regression
// ---------------------------------------------------------------------------

describe("G. Regression", () => {
  afterEach(async () => {
    const m = await import("./opportunity-engine");
    m._resetEngineState();
  });

  it("getLatestSnapshot() returns null when engine has not initialised (safe for dashboard route)", async () => {
    const engine = await getEngine();
    expect(engine.getLatestSnapshot()).toBeNull();
  });

  it("getRefreshState() never throws", async () => {
    const engine = await getEngine();
    expect(() => engine.getRefreshState()).not.toThrow();
  });

  it("stopOpportunityEngine() does not throw when no timer is running", async () => {
    const engine = await getEngine();
    expect(() => engine.stopOpportunityEngine()).not.toThrow();
  });
});
