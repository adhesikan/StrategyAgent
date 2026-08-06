// Opportunity Engine — unit tests (Sprint 1 production-hardened)
//
// Tests cover:
//   A. Startup (scheduler fires immediately, no unhandled rejections)
//   B. Runtime gates (MCP disabled, DB absent, load failure)
//   C. Locking (acquired, unavailable, lock exception, refreshStatus safety)
//   D. Lifecycle (triggered → exactly one terminal event per path)
//   E. Regression (dashboard unchanged, defaults unchanged)
//
// Run with: npx vitest run --root . server/services/opportunity-engine.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Capture structured logs emitted via process.stdout/stderr
// ---------------------------------------------------------------------------

const capturedLogs: Array<{ level: "stdout" | "stderr"; parsed: any }> = [];
let originalStdoutWrite: typeof process.stdout.write;
let originalStderrWrite: typeof process.stderr.write;

function startCapture() {
  capturedLogs.length = 0;
  originalStdoutWrite = process.stdout.write.bind(process.stdout);
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  (process.stdout as any).write = (chunk: any, ...args: any[]) => {
    try { capturedLogs.push({ level: "stdout", parsed: JSON.parse(chunk.toString().trim()) }); } catch {}
    return true;
  };
  (process.stderr as any).write = (chunk: any, ...args: any[]) => {
    try { capturedLogs.push({ level: "stderr", parsed: JSON.parse(chunk.toString().trim()) }); } catch {}
    return true;
  };
}

function stopCapture() {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
}

function events() {
  return capturedLogs.map((l) => l.parsed?.event).filter(Boolean);
}

function findLog(event: string) {
  return capturedLogs.find((l) => l.parsed?.event === event)?.parsed;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockSaveSuccessfulSnapshot,
  mockSaveFailedAttempt,
  mockGetLatestValidSnapshot,
  mockDeleteExpiredSnapshots,
  mockIsMcpEnabled,
  mockRunRankedTradeSearch,
  mockGetMarketRegime,
  mockRankMarketTradeCandidates,
  mockDbExecute,
} = vi.hoisted(() => ({
  mockSaveSuccessfulSnapshot: vi.fn(),
  mockSaveFailedAttempt: vi.fn(),
  mockGetLatestValidSnapshot: vi.fn(),
  mockDeleteExpiredSnapshots: vi.fn(),
  mockIsMcpEnabled: vi.fn(),
  mockRunRankedTradeSearch: vi.fn(),
  mockGetMarketRegime: vi.fn(),
  mockRankMarketTradeCandidates: vi.fn(),
  mockDbExecute: vi.fn(),
}));

vi.mock("./opportunity-snapshot-store", () => ({
  saveSuccessfulSnapshot: (...a: any[]) => mockSaveSuccessfulSnapshot(...a),
  saveFailedAttempt: (...a: any[]) => mockSaveFailedAttempt(...a),
  getLatestValidSnapshot: (...a: any[]) => mockGetLatestValidSnapshot(...a),
  getLatestAttempt: vi.fn(),
  deleteExpiredSnapshots: (...a: any[]) => mockDeleteExpiredSnapshots(...a),
  VALID_STATUSES: ["SUCCESS", "PARTIAL_SUCCESS", "EMPTY_SUCCESS"],
  FAILED_STATUS: "FAILED",
}));

vi.mock("../mcp/config", () => ({
  isMcpEnabled: () => mockIsMcpEnabled(),
}));

vi.mock("../routes/ranked-trade-search", () => ({
  runRankedTradeSearch: (...a: any[]) => mockRunRankedTradeSearch(...a),
}));

vi.mock("../mcp/tools", () => ({
  rankMarketTradeCandidates: (...a: any[]) => mockRankMarketTradeCandidates(...a),
  getMarketRegime: () => mockGetMarketRegime(),
}));

vi.mock("../db", () => ({
  db: { execute: (...a: any[]) => mockDbExecute(...a) },
}));

vi.mock("drizzle-orm", () => ({
  sql: new Proxy(Object.assign((s: any) => s, { raw: (s: any) => s }), {}),
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
    ],
    watchCandidates: [{ symbol: "AMD", watchConditions: ["Awaiting volume"] }],
    rejectionSummary: [],
    generatedAt: "2026-08-06T01:00:30.000Z",
    warnings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Re-import with fresh state between tests
// ---------------------------------------------------------------------------

async function getEngine() {
  const m = await import("./opportunity-engine");
  m._resetEngineState();
  return m;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockIsMcpEnabled.mockReturnValue(true);
  mockGetLatestValidSnapshot.mockResolvedValue(null);
  mockRunRankedTradeSearch.mockResolvedValue(makeSearchResult());
  mockGetMarketRegime.mockResolvedValue({ regime: "TRENDING" });
  mockSaveSuccessfulSnapshot.mockResolvedValue("new-snap-id");
  mockSaveFailedAttempt.mockResolvedValue(undefined);
  mockDeleteExpiredSnapshots.mockResolvedValue({ validDeleted: 0, failedDeleted: 0 });
  // Advisory lock: acquired by default
  mockDbExecute.mockResolvedValue({ rows: [{ locked: true }] });
  startCapture();
});

afterEach(async () => {
  stopCapture();
  const m = await import("./opportunity-engine");
  m._resetEngineState();
});

// ---------------------------------------------------------------------------
// A. Startup
// ---------------------------------------------------------------------------

describe("A. Startup", () => {
  it("scheduleOpportunityEngine fires initial scan without waiting for it", async () => {
    let resolveSearch!: (v: any) => void;
    const searchBarrier = new Promise<any>((res) => { resolveSearch = res; });
    mockRunRankedTradeSearch.mockReturnValue(searchBarrier);

    const engine = await getEngine();
    engine.scheduleOpportunityEngine();

    // scheduleOpportunityEngine() should return synchronously even though scan is in flight
    // The scan hasn't resolved yet but we can verify it started
    resolveSearch(makeSearchResult());
    await new Promise((r) => setTimeout(r, 50)); // let microtasks settle
    expect(events()).toContain("opportunity_scan_triggered");
  });

  it("initial scan receives trigger='startup'", async () => {
    const engine = await getEngine();
    await engine.initOpportunityEngine();
    await engine.runOpportunityEngine("startup");
    const log = findLog("opportunity_scan_triggered");
    expect(log?.trigger).toBe("startup");
  });

  it("startup does not block server (scheduleOpportunityEngine returns synchronously)", async () => {
    let resolveSearch!: (v: any) => void;
    mockRunRankedTradeSearch.mockReturnValue(new Promise((r) => { resolveSearch = r; }));
    const engine = await getEngine();
    const start = Date.now();
    engine.scheduleOpportunityEngine();
    expect(Date.now() - start).toBeLessThan(100); // synchronous return
    resolveSearch(makeSearchResult());
    await new Promise((r) => setTimeout(r, 50));
  });

  it("interval remains registered after startup scan", async () => {
    const engine = await getEngine();
    engine.scheduleOpportunityEngine();
    await new Promise((r) => setTimeout(r, 30));
    // stopOpportunityEngine clears the timer — should work without throwing
    expect(() => engine.stopOpportunityEngine()).not.toThrow();
  });

  it("initial scan failure is caught with a terminal log — no unhandled rejection", async () => {
    mockRunRankedTradeSearch.mockRejectedValue(new Error("MCP timeout"));
    const engine = await getEngine();
    // runOpportunityEngine catches internally, should not throw
    await expect(engine.runOpportunityEngine("startup")).resolves.not.toThrow();
    expect(events()).toContain("opportunity_scan_failed");
  });

  it("unhandled rejection is not produced when scan throws synchronously before async", async () => {
    // runOpportunityEngine is async — even a synchronous throw inside becomes a rejected promise
    // scheduleOpportunityEngine catches it via .catch()
    mockIsMcpEnabled.mockImplementation(() => { throw new Error("config error"); });
    const engine = await getEngine();
    // Should not throw synchronously or produce unhandled rejection
    await expect(engine.runOpportunityEngine("startup")).resolves.not.toThrow();
  });

  it("emits opportunity_engine_scheduled with intervalMinutes", async () => {
    delete process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES;
    const engine = await getEngine();
    engine.scheduleOpportunityEngine();
    await new Promise((r) => setTimeout(r, 20));
    const log = findLog("opportunity_engine_scheduled");
    expect(log?.intervalMinutes).toBe(240);
  });
});

// ---------------------------------------------------------------------------
// B. Runtime gates
// ---------------------------------------------------------------------------

describe("B. Runtime gates", () => {
  it("MCP disabled: emits opportunity_scan_skipped_disabled and does not scan", async () => {
    mockIsMcpEnabled.mockReturnValue(false);
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_skipped_disabled");
    expect(mockRunRankedTradeSearch).not.toHaveBeenCalled();
  });

  it("MCP disabled: skipped log includes gate=MCP_ENABLED and gateValue", async () => {
    process.env.MCP_ENABLED = "false";
    mockIsMcpEnabled.mockReturnValue(false);
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    const log = findLog("opportunity_scan_skipped_disabled");
    expect(log?.gate).toBe("MCP_ENABLED");
    expect(log?.gateValue).toBeDefined();
    delete process.env.MCP_ENABLED;
  });

  it("MCP disabled: opportunity_scan_triggered still fires before the gate check", async () => {
    mockIsMcpEnabled.mockReturnValue(false);
    const engine = await getEngine();
    await engine.runOpportunityEngine("interval");
    // triggered fires first, then skipped_disabled
    const evs = events();
    expect(evs.indexOf("opportunity_scan_triggered")).toBeLessThan(
      evs.indexOf("opportunity_scan_skipped_disabled"),
    );
  });

  it("MCP enabled: scan proceeds and emits opportunity_scan_started", async () => {
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_started");
  });

  it("DB snapshot absent (null): scan still starts — missing snapshot is not a gate", async () => {
    mockGetLatestValidSnapshot.mockResolvedValue(null);
    const engine = await getEngine();
    await engine.initOpportunityEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_started");
    expect(mockRunRankedTradeSearch).toHaveBeenCalled();
  });

  it("DB load failure: scan still starts — initOpportunityEngine failure is non-fatal", async () => {
    mockGetLatestValidSnapshot.mockRejectedValue(new Error("relation does not exist"));
    const engine = await getEngine();
    await engine.initOpportunityEngine();
    // Even after load failure, getLatestSnapshot() returns null (not throws)
    expect(engine.getLatestSnapshot()).toBeNull();
    // Engine should still accept a scan
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_started");
  });

  it("DB load failure: emits opportunity_snapshot_load_failed", async () => {
    mockGetLatestValidSnapshot.mockRejectedValue(new Error("DB down"));
    const engine = await getEngine();
    await engine.initOpportunityEngine();
    expect(events()).toContain("opportunity_snapshot_load_failed");
  });

  it("in-process guard: second concurrent call emits skipped_disabled", async () => {
    let resolveSearch!: (v: any) => void;
    mockRunRankedTradeSearch.mockReturnValue(new Promise((r) => { resolveSearch = r; }));
    const engine = await getEngine();
    const first = engine.runOpportunityEngine("startup");
    // Second call fires while first is still running
    await engine.runOpportunityEngine("startup");
    const skippedLogs = capturedLogs.filter(
      (l) => l.parsed?.event === "opportunity_scan_skipped_disabled" &&
              l.parsed?.gate === "in_process_guard"
    );
    expect(skippedLogs.length).toBeGreaterThan(0);
    resolveSearch(makeSearchResult());
    await first;
  });
});

// ---------------------------------------------------------------------------
// C. Locking
// ---------------------------------------------------------------------------

describe("C. Locking", () => {
  it("acquired lock: emits opportunity_scan_lock_acquired", async () => {
    mockDbExecute.mockResolvedValue({ rows: [{ locked: true }] });
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_lock_acquired");
  });

  it("acquired lock: scan proceeds to opportunity_scan_started", async () => {
    mockDbExecute.mockResolvedValue({ rows: [{ locked: true }] });
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    const evs = events();
    expect(evs.indexOf("opportunity_scan_lock_acquired")).toBeLessThan(
      evs.indexOf("opportunity_scan_started"),
    );
  });

  it("unavailable lock: emits opportunity_scan_skipped_locked", async () => {
    mockDbExecute.mockResolvedValue({ rows: [{ locked: false }] });
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_skipped_locked");
    expect(mockRunRankedTradeSearch).not.toHaveBeenCalled();
  });

  it("unavailable lock: refreshStatus returns to idle (not stuck at running)", async () => {
    mockDbExecute.mockResolvedValue({ rows: [{ locked: false }] });
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(engine.getRefreshState().status).toBe("idle");
  });

  it("lock exception: emits opportunity_scan_skipped_locked with error field", async () => {
    mockDbExecute.mockRejectedValue(new Error("pg connection lost"));
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    const log = findLog("opportunity_scan_skipped_locked");
    expect(log?.error).toContain("pg connection lost");
    expect(mockRunRankedTradeSearch).not.toHaveBeenCalled();
  });

  it("lock exception: refreshStatus returns to idle", async () => {
    mockDbExecute.mockRejectedValue(new Error("lock error"));
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(engine.getRefreshState().status).toBe("idle");
  });

  it("lock is released after successful scan", async () => {
    // First call is the advisory lock acquire, second call is the unlock
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ locked: true }] })  // acquire
      .mockResolvedValueOnce({});                             // release
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(mockDbExecute).toHaveBeenCalledTimes(2);
  });

  it("lock is released after failed scan", async () => {
    mockRunRankedTradeSearch.mockRejectedValue(new Error("MCP error"));
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ locked: true }] })  // acquire
      .mockResolvedValueOnce({});                             // release
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(mockDbExecute).toHaveBeenCalledTimes(2);
  });

  it("refreshStatus is not stuck at running after any exit path", async () => {
    const engine = await getEngine();
    // Test all paths: success, failure, lock-miss, MCP-disabled
    for (const setup of [
      () => { mockDbExecute.mockResolvedValue({ rows: [{ locked: true }] }); },
      () => { mockRunRankedTradeSearch.mockRejectedValue(new Error("fail")); },
      () => { mockDbExecute.mockResolvedValue({ rows: [{ locked: false }] }); },
      () => { mockIsMcpEnabled.mockReturnValue(false); },
    ]) {
      vi.clearAllMocks();
      mockIsMcpEnabled.mockReturnValue(true);
      mockRunRankedTradeSearch.mockResolvedValue(makeSearchResult());
      mockSaveSuccessfulSnapshot.mockResolvedValue("snap-id");
      mockDeleteExpiredSnapshots.mockResolvedValue({ validDeleted: 0, failedDeleted: 0 });
      mockSaveFailedAttempt.mockResolvedValue(undefined);
      mockDbExecute.mockResolvedValue({ rows: [{ locked: true }] });
      setup();
      engine._resetEngineState();
      await engine.runOpportunityEngine("startup");
      expect(engine.getRefreshState().status).not.toBe("running");
    }
  });
});

// ---------------------------------------------------------------------------
// D. Lifecycle — every attempt has triggered + exactly one terminal event
// ---------------------------------------------------------------------------

describe("D. Lifecycle events", () => {
  const TERMINAL_EVENTS = [
    "opportunity_scan_completed",
    "opportunity_scan_partial",
    "opportunity_scan_empty",
    "opportunity_scan_failed",
    "opportunity_scan_skipped_locked",
    "opportunity_scan_skipped_disabled",
  ];

  function countTerminalEvents() {
    return capturedLogs.filter((l) => TERMINAL_EVENTS.includes(l.parsed?.event)).length;
  }

  it("success path: triggered → lock_acquired → started → completed (exactly 1 terminal)", async () => {
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_triggered");
    expect(events()).toContain("opportunity_scan_lock_acquired");
    expect(events()).toContain("opportunity_scan_started");
    expect(events()).toContain("opportunity_scan_completed");
    expect(countTerminalEvents()).toBe(1);
  });

  it("partial path: triggered → started → partial (exactly 1 terminal)", async () => {
    mockRunRankedTradeSearch.mockResolvedValue(makeSearchResult({ unavailableCount: 3, warnings: ["warn"] }));
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_triggered");
    expect(events()).toContain("opportunity_scan_partial");
    expect(countTerminalEvents()).toBe(1);
  });

  it("empty path: triggered → started → empty (exactly 1 terminal)", async () => {
    mockRunRankedTradeSearch.mockResolvedValue(
      makeSearchResult({ qualifiedCount: 0, candidates: [], watchCandidates: [], warnings: [] }),
    );
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_triggered");
    expect(events()).toContain("opportunity_scan_empty");
    expect(countTerminalEvents()).toBe(1);
  });

  it("failed path: triggered → started → failed (exactly 1 terminal)", async () => {
    mockRunRankedTradeSearch.mockRejectedValue(new Error("MCP timeout"));
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_triggered");
    expect(events()).toContain("opportunity_scan_failed");
    expect(countTerminalEvents()).toBe(1);
  });

  it("skipped-locked path: triggered → skipped_locked (exactly 1 terminal)", async () => {
    mockDbExecute.mockResolvedValue({ rows: [{ locked: false }] });
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_triggered");
    expect(events()).toContain("opportunity_scan_skipped_locked");
    expect(countTerminalEvents()).toBe(1);
  });

  it("skipped-disabled path: triggered → skipped_disabled (exactly 1 terminal)", async () => {
    mockIsMcpEnabled.mockReturnValue(false);
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_triggered");
    expect(events()).toContain("opportunity_scan_skipped_disabled");
    expect(countTerminalEvents()).toBe(1);
  });

  it("all lifecycle events include scanId", async () => {
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    const coreEvents = ["opportunity_scan_triggered", "opportunity_scan_started", "opportunity_scan_completed"];
    for (const ev of coreEvents) {
      const log = findLog(ev);
      expect(log?.scanId).toBeTruthy();
    }
  });

  it("all lifecycle events include trigger field", async () => {
    const engine = await getEngine();
    await engine.runOpportunityEngine("interval");
    const log = findLog("opportunity_scan_triggered");
    expect(log?.trigger).toBe("interval");
  });

  it("snapshot_persisted follows scan_completed", async () => {
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    const evs = events();
    expect(evs.indexOf("opportunity_scan_completed")).toBeLessThan(
      evs.indexOf("opportunity_snapshot_persisted"),
    );
  });

  it("startup snapshot load emits load_started then loaded or not_found", async () => {
    mockGetLatestValidSnapshot.mockResolvedValue(null);
    const engine = await getEngine();
    await engine.initOpportunityEngine();
    const evs = events();
    expect(evs).toContain("opportunity_snapshot_load_started");
    expect(evs).toContain("opportunity_snapshot_not_found");
  });

  it("startup snapshot load emits loaded when a row exists", async () => {
    mockGetLatestValidSnapshot.mockResolvedValue(makeStoredSnapshot());
    const engine = await getEngine();
    await engine.initOpportunityEngine();
    expect(events()).toContain("opportunity_snapshot_loaded");
    expect(events()).not.toContain("opportunity_snapshot_not_found");
  });
});

// ---------------------------------------------------------------------------
// E. Regression
// ---------------------------------------------------------------------------

describe("E. Regression", () => {
  it("getLatestSnapshot() returns null before engine runs (safe for endpoint)", async () => {
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

  it("failed scan does not update latestSnapshot (previous preserved)", async () => {
    const stored = makeStoredSnapshot({ id: "keep-me" });
    mockGetLatestValidSnapshot.mockResolvedValue(stored);
    const engine = await getEngine();
    await engine.initOpportunityEngine();

    mockRunRankedTradeSearch.mockRejectedValue(new Error("MCP timeout"));
    await engine.runOpportunityEngine("startup");
    expect(engine.getLatestSnapshot()?.id).toBe("keep-me");
  });

  it("default interval remains 240 minutes", async () => {
    delete process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES;
    const engine = await import("./opportunity-engine");
    expect(engine.getIntervalMs()).toBe(240 * 60 * 1000);
  });

  it("MCP tools import does not happen when MCP is disabled", async () => {
    mockIsMcpEnabled.mockReturnValue(false);
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(mockRankMarketTradeCandidates).not.toHaveBeenCalled();
  });
});
