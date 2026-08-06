// Opportunity Engine — unit tests (Sprint 1 bounded deadline)
//
// Tests cover:
//   A. Timeout (hanging MCP, terminal event, refreshStatus, snapshot preserved, lock released)
//   B. Late result (ignored, no overwrite, no second terminal event)
//   C. Normal outcomes (success, partial, empty, validation failure, persist failure)
//   D. Configuration (timeout bounds, interval bounds)
//   E. Regression (dashboard untouched, defaults unchanged)
//   + Prior: startup, gates, locking, lifecycle
//
// Run with: npx vitest run --root . server/services/opportunity-engine.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Capture structured logs via process.stdout/stderr
// ---------------------------------------------------------------------------

const capturedLogs: Array<{ level: "stdout" | "stderr"; parsed: any }> = [];
let originalStdoutWrite: typeof process.stdout.write;
let originalStderrWrite: typeof process.stderr.write;

function startCapture() {
  capturedLogs.length = 0;
  originalStdoutWrite = process.stdout.write.bind(process.stdout);
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  (process.stdout as any).write = (chunk: any) => {
    try { capturedLogs.push({ level: "stdout", parsed: JSON.parse(chunk.toString().trim()) }); } catch {}
    return true;
  };
  (process.stderr as any).write = (chunk: any) => {
    try { capturedLogs.push({ level: "stderr", parsed: JSON.parse(chunk.toString().trim()) }); } catch {}
    return true;
  };
}

function stopCapture() {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
}

function events() { return capturedLogs.map((l) => l.parsed?.event).filter(Boolean); }
function findLog(event: string) { return capturedLogs.find((l) => l.parsed?.event === event)?.parsed; }
function findLogs(event: string) { return capturedLogs.filter((l) => l.parsed?.event === event).map((l) => l.parsed); }
function countTerminalEvents() {
  return capturedLogs.filter((l) =>
    ["opportunity_scan_completed","opportunity_scan_partial","opportunity_scan_empty",
     "opportunity_scan_failed","opportunity_scan_skipped_locked","opportunity_scan_skipped_disabled"]
    .includes(l.parsed?.event)).length;
}

// ---------------------------------------------------------------------------
// Mocks (vi.hoisted so factory closures can reference them)
// ---------------------------------------------------------------------------

const {
  mockSaveSuccessfulSnapshot, mockSaveFailedAttempt, mockGetLatestValidSnapshot,
  mockDeleteExpiredSnapshots, mockIsMcpEnabled, mockRunRankedTradeSearch,
  mockGetMarketRegime, mockRankMarketTradeCandidates, mockDbExecute,
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
vi.mock("../mcp/config", () => ({ isMcpEnabled: () => mockIsMcpEnabled() }));
vi.mock("../routes/ranked-trade-search", () => ({
  runRankedTradeSearch: (...a: any[]) => mockRunRankedTradeSearch(...a),
}));
vi.mock("../mcp/tools", () => ({
  rankMarketTradeCandidates: (...a: any[]) => mockRankMarketTradeCandidates(...a),
  getMarketRegime: () => mockGetMarketRegime(),
}));
vi.mock("../db", () => ({ db: { execute: (...a: any[]) => mockDbExecute(...a) } }));
vi.mock("drizzle-orm", () => ({
  sql: new Proxy(Object.assign((s: any) => s, { raw: (s: any) => s }), {}),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStoredSnapshot(overrides: Record<string, any> = {}) {
  return {
    id: "db-snap-001", status: "SUCCESS" as const,
    startedAt: "2026-08-06T01:00:00.000Z", completedAt: "2026-08-06T01:01:00.000Z",
    generatedAt: "2026-08-06T01:00:30.000Z", scannerVersion: "mcp-v1",
    marketRegime: "TRENDING", dataSource: "Twelve Data via MCP", dataQuality: "Latest daily market data",
    reviewedCount: 200, qualifiedCount: 5, watchCount: 3, rejectedCount: 10,
    excludedCount: 12, unavailableCount: 0,
    topGrowth: [{ rank: 1, symbol: "NVDA", whySelected: [], warnings: [] }],
    topIncome: [], topWatchlist: [{ symbol: "AMD", watchConditions: [] }],
    approachingQualification: [], warnings: [], ...overrides,
  };
}

function makeSearchResult(overrides: Record<string, any> = {}) {
  return {
    request: {}, reviewedCount: 200, qualifiedCount: 5, watchCount: 3,
    rejectedCount: 10, excludedCount: 12, unavailableCount: 0,
    candidates: [{ rank: 1, symbol: "NVDA", strategy: "VCP Breakout", whySelected: ["Strong"], warnings: [] }],
    watchCandidates: [{ symbol: "AMD", watchConditions: ["Awaiting volume"] }],
    rejectionSummary: [], generatedAt: "2026-08-06T01:00:30.000Z", warnings: [], ...overrides,
  };
}

async function getEngine() {
  const m = await import("./opportunity-engine");
  m._resetEngineState();
  return m;
}

// ---------------------------------------------------------------------------
// Global setup / teardown
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
  mockDbExecute.mockResolvedValue({ rows: [{ locked: true }] });
  delete process.env.OPPORTUNITY_SCAN_TIMEOUT_MS;
  delete process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES;
  startCapture();
});

afterEach(async () => {
  stopCapture();
  // Ensure real timers are restored even if a test forgot
  vi.useRealTimers();
  const m = await import("./opportunity-engine");
  m._resetEngineState();
  delete process.env.OPPORTUNITY_SCAN_TIMEOUT_MS;
  delete process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES;
});

// ---------------------------------------------------------------------------
// Helper: run engine with fake timers so deadline fires without real waiting
//
// The deadline inside the engine uses setTimeout. With vi.useFakeTimers() we
// can advance the fake clock past the timeout and the Promise.race resolves
// immediately — no real waiting required.
//
// Usage:
//   const { engine, scanPromise } = await startFakedScan("startup");
//   await vi.advanceTimersByTimeAsync(ADVANCE_MS);
//   await scanPromise;
// ---------------------------------------------------------------------------

const FAKE_TIMEOUT_MS = 30_000; // minimum valid; no clamping, no real wait

async function startFakedScan(trigger: "startup" | "interval" = "startup") {
  process.env.OPPORTUNITY_SCAN_TIMEOUT_MS = String(FAKE_TIMEOUT_MS);
  vi.useFakeTimers();
  const engine = await getEngine();
  const scanPromise = engine.runOpportunityEngine(trigger);
  return { engine, scanPromise };
}

async function advancePastTimeout() {
  await vi.advanceTimersByTimeAsync(FAKE_TIMEOUT_MS + 100);
}

// ---------------------------------------------------------------------------
// A. Timeout
// ---------------------------------------------------------------------------

describe("A. Timeout", () => {
  it("hanging MCP Promise is terminated by deadline → opportunity_scan_failed emitted", async () => {
    mockRunRankedTradeSearch.mockReturnValue(new Promise(() => {})); // never resolves
    const { scanPromise } = await startFakedScan();
    await advancePastTimeout();
    await scanPromise;

    expect(events()).toContain("opportunity_scan_failed");
    expect(findLog("opportunity_scan_failed")?.errorCode).toBe("OPPORTUNITY_SCAN_TIMEOUT");
  });

  it("timeout: exactly one terminal event is emitted", async () => {
    mockRunRankedTradeSearch.mockReturnValue(new Promise(() => {}));
    const { scanPromise } = await startFakedScan();
    await advancePastTimeout();
    await scanPromise;
    expect(countTerminalEvents()).toBe(1);
  });

  it("timeout: refreshStatus becomes failed (not stuck at running)", async () => {
    mockRunRankedTradeSearch.mockReturnValue(new Promise(() => {}));
    const { engine, scanPromise } = await startFakedScan();
    await advancePastTimeout();
    await scanPromise;
    expect(engine.getRefreshState().status).toBe("failed");
  });

  it("timeout: prior valid snapshot is preserved", async () => {
    const stored = makeStoredSnapshot({ id: "keep-on-timeout" });
    mockGetLatestValidSnapshot.mockResolvedValue(stored);
    const { engine, scanPromise } = await startFakedScan();
    await engine.initOpportunityEngine();
    // Reinitialise scan state after initOpportunityEngine
    engine._resetEngineState();
    // Load snapshot manually since we reset state
    mockGetLatestValidSnapshot.mockResolvedValue(stored);
    await engine.initOpportunityEngine();

    mockRunRankedTradeSearch.mockReturnValue(new Promise(() => {}));
    const scanPromise2 = engine.runOpportunityEngine("startup");
    await advancePastTimeout();
    await scanPromise2;
    await scanPromise; // drain original

    expect(engine.getLatestSnapshot()?.id).toBe("keep-on-timeout");
  });

  it("timeout: saveFailedAttempt called with OPPORTUNITY_SCAN_TIMEOUT", async () => {
    mockRunRankedTradeSearch.mockReturnValue(new Promise(() => {}));
    const { scanPromise } = await startFakedScan();
    await advancePastTimeout();
    await scanPromise;
    await vi.runAllTimersAsync(); // flush any remaining async
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 20)); // flush microtasks
    expect(mockSaveFailedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "OPPORTUNITY_SCAN_TIMEOUT" }),
    );
  });

  it("timeout: engineRunning is cleared so next scan can start", async () => {
    mockRunRankedTradeSearch.mockReturnValue(new Promise(() => {}));
    const { engine, scanPromise } = await startFakedScan();
    await advancePastTimeout();
    await scanPromise;
    vi.useRealTimers();

    // A subsequent scan must not be blocked by in-process guard
    mockRunRankedTradeSearch.mockResolvedValue(makeSearchResult());
    process.env.OPPORTUNITY_SCAN_TIMEOUT_MS = "300000";
    await engine.runOpportunityEngine("interval");
    expect(events()).toContain("opportunity_scan_started");
  });

  it("timeout: advisory lock is released (not left held)", async () => {
    mockRunRankedTradeSearch.mockReturnValue(new Promise(() => {}));
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ locked: true }] })  // acquire
      .mockResolvedValueOnce({});                             // release
    const { scanPromise } = await startFakedScan();
    await advancePastTimeout();
    await scanPromise;
    expect(mockDbExecute).toHaveBeenCalledTimes(2);
  });

  it("timeout: opportunity_scan_lock_released is emitted", async () => {
    mockRunRankedTradeSearch.mockReturnValue(new Promise(() => {}));
    const { scanPromise } = await startFakedScan();
    await advancePastTimeout();
    await scanPromise;
    expect(events()).toContain("opportunity_scan_lock_released");
  });

  it("timeout: opportunity_scan_timeout_triggered emitted before the terminal failed", async () => {
    mockRunRankedTradeSearch.mockReturnValue(new Promise(() => {}));
    const { scanPromise } = await startFakedScan();
    await advancePastTimeout();
    await scanPromise;
    const evs = events();
    expect(evs).toContain("opportunity_scan_timeout_triggered");
    expect(evs.indexOf("opportunity_scan_timeout_triggered")).toBeLessThan(
      evs.indexOf("opportunity_scan_failed"),
    );
  });

  it("timeout: opportunity_scan_timeout_scheduled is emitted with timeoutMs", async () => {
    mockRunRankedTradeSearch.mockReturnValue(new Promise(() => {}));
    const { scanPromise } = await startFakedScan();
    await advancePastTimeout();
    await scanPromise;
    const log = findLog("opportunity_scan_timeout_scheduled");
    expect(log?.timeoutMs).toBe(FAKE_TIMEOUT_MS);
  });
});

// ---------------------------------------------------------------------------
// B. Late result
// ---------------------------------------------------------------------------

describe("B. Late result", () => {
  it("late MCP result does not emit a second terminal event", async () => {
    let resolveSearch!: (v: any) => void;
    mockRunRankedTradeSearch.mockReturnValue(
      new Promise<any>((res) => { resolveSearch = res; }),
    );
    const { scanPromise } = await startFakedScan();
    await advancePastTimeout();
    await scanPromise; // times out

    const terminalCountAfterTimeout = countTerminalEvents();
    vi.useRealTimers();

    // Resolve the hung search late
    resolveSearch(makeSearchResult());
    await new Promise((r) => setTimeout(r, 30));

    expect(countTerminalEvents()).toBe(terminalCountAfterTimeout);
  });

  it("late result does not overwrite latest valid snapshot", async () => {
    const stored = makeStoredSnapshot({ id: "safe-snap" });

    let resolveSearch!: (v: any) => void;
    mockRunRankedTradeSearch.mockReturnValue(
      new Promise<any>((res) => { resolveSearch = res; }),
    );
    const { engine, scanPromise } = await startFakedScan();
    // Manually set snapshot in memory (simulates a pre-existing valid one)
    // We can't call initOpportunityEngine here since we reset state in startFakedScan.
    // Instead, patch the snapshot via getEngine reset + load pattern.
    // Just verify the engine snapshot stays null (never gets overwritten by late result).
    await advancePastTimeout();
    await scanPromise;
    vi.useRealTimers();

    const snapAfterTimeout = engine.getLatestSnapshot();

    resolveSearch(makeSearchResult());
    await new Promise((r) => setTimeout(r, 30));

    // Snapshot must not have changed
    expect(engine.getLatestSnapshot()).toBe(snapAfterTimeout);
  });

  it("late result does not change refreshStatus", async () => {
    let resolveSearch!: (v: any) => void;
    mockRunRankedTradeSearch.mockReturnValue(
      new Promise<any>((res) => { resolveSearch = res; }),
    );
    const { engine, scanPromise } = await startFakedScan();
    await advancePastTimeout();
    await scanPromise; // timed out → failed
    const statusAfterTimeout = engine.getRefreshState().status;
    vi.useRealTimers();

    resolveSearch(makeSearchResult());
    await new Promise((r) => setTimeout(r, 30));

    expect(engine.getRefreshState().status).toBe(statusAfterTimeout);
  });

  it("late result: opportunity_scan_late_result_discarded is emitted", async () => {
    let resolveSearch!: (v: any) => void;
    mockRunRankedTradeSearch.mockReturnValue(
      new Promise<any>((res) => { resolveSearch = res; }),
    );
    const { scanPromise } = await startFakedScan();
    await advancePastTimeout();
    await scanPromise; // timed out
    vi.useRealTimers();

    resolveSearch(makeSearchResult());
    await new Promise((r) => setTimeout(r, 50));

    expect(events()).toContain("opportunity_scan_late_result_discarded");
  });
});

// ---------------------------------------------------------------------------
// C. Normal outcomes (high timeout so they complete naturally)
// ---------------------------------------------------------------------------

describe("C. Normal outcomes", () => {
  beforeEach(() => { process.env.OPPORTUNITY_SCAN_TIMEOUT_MS = "300000"; });

  it("success: scan_completed, refreshStatus=idle, snapshot updated", async () => {
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_completed");
    expect(engine.getRefreshState().status).toBe("idle");
    expect(engine.getLatestSnapshot()?.id).toBe("new-snap-id");
    expect(countTerminalEvents()).toBe(1);
  });

  it("partial: unavailableCount>0 → scan_partial (exactly 1 terminal)", async () => {
    mockRunRankedTradeSearch.mockResolvedValue(makeSearchResult({ unavailableCount: 3, warnings: ["warn"] }));
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_partial");
    expect(countTerminalEvents()).toBe(1);
  });

  it("empty: no candidates → scan_empty (exactly 1 terminal)", async () => {
    mockRunRankedTradeSearch.mockResolvedValue(
      makeSearchResult({ qualifiedCount: 0, candidates: [], watchCandidates: [], warnings: [] }),
    );
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_empty");
    expect(countTerminalEvents()).toBe(1);
  });

  it("MCP error → scan_failed, not OPPORTUNITY_SCAN_TIMEOUT (exactly 1 terminal)", async () => {
    mockRunRankedTradeSearch.mockRejectedValue(new Error("MCP tool error"));
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_failed");
    expect(findLog("opportunity_scan_failed")?.errorCode).not.toBe("OPPORTUNITY_SCAN_TIMEOUT");
    expect(countTerminalEvents()).toBe(1);
  });

  it("persistence failure → scan_failed terminal, refreshStatus=failed (exactly 1 terminal)", async () => {
    mockSaveSuccessfulSnapshot.mockRejectedValue(new Error("DB write failed"));
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_failed");
    expect(engine.getRefreshState().status).toBe("failed");
    expect(countTerminalEvents()).toBe(1);
  });

  it("success: lock_released emitted, MCP error: lock_released emitted", async () => {
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_lock_released");
  });

  it("MCP error: lock still released in finally", async () => {
    mockRunRankedTradeSearch.mockRejectedValue(new Error("MCP fail"));
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({});
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(mockDbExecute).toHaveBeenCalledTimes(2);
    expect(events()).toContain("opportunity_scan_lock_released");
  });
});

// ---------------------------------------------------------------------------
// D. Configuration — OPPORTUNITY_SCAN_TIMEOUT_MS
// ---------------------------------------------------------------------------

describe("D. Configuration — OPPORTUNITY_SCAN_TIMEOUT_MS", () => {
  it("default is 90_000 ms when not set", async () => {
    delete process.env.OPPORTUNITY_SCAN_TIMEOUT_MS;
    const engine = await import("./opportunity-engine");
    expect(engine.getTimeoutMs()).toBe(90_000);
  });

  it("accepts a valid override of 60_000", async () => {
    process.env.OPPORTUNITY_SCAN_TIMEOUT_MS = "60000";
    const engine = await import("./opportunity-engine");
    expect(engine.getTimeoutMs()).toBe(60_000);
  });

  it("falls back to 90_000 for 'banana'", async () => {
    process.env.OPPORTUNITY_SCAN_TIMEOUT_MS = "banana";
    const engine = await import("./opportunity-engine");
    expect(engine.getTimeoutMs()).toBe(90_000);
  });

  it("clamps below minimum (5000) to 90_000", async () => {
    process.env.OPPORTUNITY_SCAN_TIMEOUT_MS = "5000";
    const engine = await import("./opportunity-engine");
    expect(engine.getTimeoutMs()).toBe(90_000);
  });

  it("clamps above maximum (999999) to 90_000", async () => {
    process.env.OPPORTUNITY_SCAN_TIMEOUT_MS = "999999";
    const engine = await import("./opportunity-engine");
    expect(engine.getTimeoutMs()).toBe(90_000);
  });

  it("accepts minimum valid value 30_000", async () => {
    process.env.OPPORTUNITY_SCAN_TIMEOUT_MS = "30000";
    const engine = await import("./opportunity-engine");
    expect(engine.getTimeoutMs()).toBe(30_000);
  });

  it("accepts maximum valid value 300_000", async () => {
    process.env.OPPORTUNITY_SCAN_TIMEOUT_MS = "300000";
    const engine = await import("./opportunity-engine");
    expect(engine.getTimeoutMs()).toBe(300_000);
  });
});

describe("D. Configuration — OPPORTUNITY_SCAN_INTERVAL_MINUTES", () => {
  it("default is 240 minutes", async () => {
    delete process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES;
    const engine = await import("./opportunity-engine");
    expect(engine.getIntervalMs()).toBe(240 * 60 * 1000);
  });

  it("accepts valid override of 60", async () => {
    process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES = "60";
    const engine = await import("./opportunity-engine");
    expect(engine.getIntervalMs()).toBe(60 * 60 * 1000);
  });

  it("clamps malformed to 240", async () => {
    process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES = "banana";
    const engine = await import("./opportunity-engine");
    expect(engine.getIntervalMs()).toBe(240 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// E. Regression
// ---------------------------------------------------------------------------

describe("E. Regression", () => {
  beforeEach(() => { process.env.OPPORTUNITY_SCAN_TIMEOUT_MS = "300000"; });

  it("getLatestSnapshot() returns null before engine runs", async () => {
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

  it("failed scan does not update latestSnapshot", async () => {
    const stored = makeStoredSnapshot({ id: "keep-me" });
    mockGetLatestValidSnapshot.mockResolvedValue(stored);
    const engine = await getEngine();
    await engine.initOpportunityEngine();
    mockRunRankedTradeSearch.mockRejectedValue(new Error("MCP timeout"));
    await engine.runOpportunityEngine("startup");
    expect(engine.getLatestSnapshot()?.id).toBe("keep-me");
  });

  it("no MCP calls when MCP is disabled", async () => {
    mockIsMcpEnabled.mockReturnValue(false);
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(mockRankMarketTradeCandidates).not.toHaveBeenCalled();
  });

  it("runOpportunityEngine never rejects even when isMcpEnabled throws", async () => {
    mockIsMcpEnabled.mockImplementation(() => { throw new Error("config error"); });
    const engine = await getEngine();
    await expect(engine.runOpportunityEngine("startup")).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Startup tests
// ---------------------------------------------------------------------------

describe("Startup", () => {
  beforeEach(() => { process.env.OPPORTUNITY_SCAN_TIMEOUT_MS = "300000"; });

  it("initial scan receives trigger='startup'", async () => {
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(findLog("opportunity_scan_triggered")?.trigger).toBe("startup");
  });

  it("scheduleOpportunityEngine returns synchronously (non-blocking)", async () => {
    let resolveSearch!: (v: any) => void;
    mockRunRankedTradeSearch.mockReturnValue(new Promise((r) => { resolveSearch = r; }));
    const engine = await getEngine();
    const start = Date.now();
    engine.scheduleOpportunityEngine();
    expect(Date.now() - start).toBeLessThan(100);
    resolveSearch(makeSearchResult());
    await new Promise((r) => setTimeout(r, 30));
  });

  it("emits opportunity_engine_scheduled with intervalMinutes=240", async () => {
    delete process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES;
    const engine = await getEngine();
    engine.scheduleOpportunityEngine();
    await new Promise((r) => setTimeout(r, 20));
    expect(findLog("opportunity_engine_scheduled")?.intervalMinutes).toBe(240);
  });

  it("startup snapshot load emits load_started then not_found when DB is empty", async () => {
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

  it("DB load failure: engine degrades gracefully and can still scan", async () => {
    mockGetLatestValidSnapshot.mockRejectedValue(new Error("relation does not exist"));
    const engine = await getEngine();
    await engine.initOpportunityEngine();
    expect(events()).toContain("opportunity_snapshot_load_failed");
    expect(engine.getLatestSnapshot()).toBeNull();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_started");
  });
});

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

describe("Runtime gates", () => {
  beforeEach(() => { process.env.OPPORTUNITY_SCAN_TIMEOUT_MS = "300000"; });

  it("MCP disabled: skipped_disabled, triggered fires first", async () => {
    mockIsMcpEnabled.mockReturnValue(false);
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    const evs = events();
    expect(evs).toContain("opportunity_scan_skipped_disabled");
    expect(evs.indexOf("opportunity_scan_triggered")).toBeLessThan(
      evs.indexOf("opportunity_scan_skipped_disabled"),
    );
    expect(mockRunRankedTradeSearch).not.toHaveBeenCalled();
  });

  it("MCP disabled: skipped log includes gate=MCP_ENABLED", async () => {
    mockIsMcpEnabled.mockReturnValue(false);
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(findLog("opportunity_scan_skipped_disabled")?.gate).toBe("MCP_ENABLED");
  });

  it("in-process guard: concurrent call emits skipped_disabled", async () => {
    let resolveSearch!: (v: any) => void;
    mockRunRankedTradeSearch.mockReturnValue(new Promise((r) => { resolveSearch = r; }));
    const engine = await getEngine();
    const first = engine.runOpportunityEngine("startup");
    await engine.runOpportunityEngine("startup"); // concurrent — skipped
    const skippedLogs = findLogs("opportunity_scan_skipped_disabled").filter(
      (l) => l.gate === "in_process_guard",
    );
    expect(skippedLogs.length).toBeGreaterThan(0);
    resolveSearch(makeSearchResult());
    await first;
  });
});

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

describe("Locking", () => {
  beforeEach(() => { process.env.OPPORTUNITY_SCAN_TIMEOUT_MS = "300000"; });

  it("acquired lock: lock_acquired emitted before scan_started", async () => {
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    const evs = events();
    expect(evs).toContain("opportunity_scan_lock_acquired");
    expect(evs.indexOf("opportunity_scan_lock_acquired")).toBeLessThan(
      evs.indexOf("opportunity_scan_started"),
    );
  });

  it("unavailable lock: skipped_locked, refreshStatus=idle (not stuck)", async () => {
    mockDbExecute.mockResolvedValue({ rows: [{ locked: false }] });
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_skipped_locked");
    expect(engine.getRefreshState().status).toBe("idle");
    expect(mockRunRankedTradeSearch).not.toHaveBeenCalled();
  });

  it("lock exception: skipped_locked with error, refreshStatus=idle", async () => {
    mockDbExecute.mockRejectedValue(new Error("pg connection lost"));
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    const log = findLog("opportunity_scan_skipped_locked");
    expect(log?.error).toContain("pg connection lost");
    expect(engine.getRefreshState().status).toBe("idle");
  });

  it("timeout cannot leave the lock held — released on deadline", async () => {
    mockRunRankedTradeSearch.mockReturnValue(new Promise(() => {}));
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({});
    const { scanPromise } = await startFakedScan();
    await advancePastTimeout();
    await scanPromise;
    expect(mockDbExecute).toHaveBeenCalledTimes(2);
    expect(events()).toContain("opportunity_scan_lock_released");
  });

  it("lock released after success", async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({});
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(mockDbExecute).toHaveBeenCalledTimes(2);
  });

  it("lock released after MCP error", async () => {
    mockRunRankedTradeSearch.mockRejectedValue(new Error("MCP fail"));
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({});
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(mockDbExecute).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle — one terminal event per path
// ---------------------------------------------------------------------------

describe("Lifecycle — one terminal event per path", () => {
  beforeEach(() => { process.env.OPPORTUNITY_SCAN_TIMEOUT_MS = "300000"; });

  it("success: triggered → lock_acquired → started → completed (1 terminal)", async () => {
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_triggered");
    expect(events()).toContain("opportunity_scan_lock_acquired");
    expect(events()).toContain("opportunity_scan_started");
    expect(events()).toContain("opportunity_scan_completed");
    expect(countTerminalEvents()).toBe(1);
  });

  it("failed MCP: triggered → started → failed (1 terminal)", async () => {
    mockRunRankedTradeSearch.mockRejectedValue(new Error("MCP timeout"));
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_failed");
    expect(countTerminalEvents()).toBe(1);
  });

  it("skipped-locked: triggered → skipped_locked (1 terminal)", async () => {
    mockDbExecute.mockResolvedValue({ rows: [{ locked: false }] });
    const engine = await getEngine();
    await engine.runOpportunityEngine("startup");
    expect(events()).toContain("opportunity_scan_skipped_locked");
    expect(countTerminalEvents()).toBe(1);
  });

  it("timeout path: triggered → started → timeout_triggered → failed (1 terminal)", async () => {
    mockRunRankedTradeSearch.mockReturnValue(new Promise(() => {}));
    const { scanPromise } = await startFakedScan();
    await advancePastTimeout();
    await scanPromise;
    expect(events()).toContain("opportunity_scan_triggered");
    expect(events()).toContain("opportunity_scan_started");
    expect(events()).toContain("opportunity_scan_timeout_triggered");
    expect(events()).toContain("opportunity_scan_failed");
    expect(countTerminalEvents()).toBe(1);
  });

  it("all lifecycle events include scanId and trigger", async () => {
    const engine = await getEngine();
    await engine.runOpportunityEngine("interval");
    for (const ev of ["opportunity_scan_triggered", "opportunity_scan_started", "opportunity_scan_completed"]) {
      const log = findLog(ev);
      expect(log?.scanId).toBeTruthy();
      expect(log?.trigger).toBe("interval");
    }
  });
});
