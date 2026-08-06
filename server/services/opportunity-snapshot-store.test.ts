// Opportunity Snapshot Store — unit tests (Sprint 1.1)
//
// Tests cover:
//   A. Persistence (SUCCESS, PARTIAL_SUCCESS, EMPTY_SUCCESS, FAILED, validation)
//   F. Retention (deleteExpiredSnapshots)
//
// Run with: npx vitest run --root . server/services/opportunity-snapshot-store.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted so factory closures can reference them
// ---------------------------------------------------------------------------

const { mockInsertValues, mockInsertReturning, mockSelectLimit, mockExecute, mockGroupBy } = vi.hoisted(() => {
  const mockInsertReturning = vi.fn();
  const mockInsertValues = vi.fn().mockReturnThis();
  const mockSelectLimit = vi.fn();
  const mockExecute = vi.fn();
  const mockGroupBy = vi.fn();

  return { mockInsertValues, mockInsertReturning, mockSelectLimit, mockExecute, mockGroupBy };
});

vi.mock("../db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    groupBy: mockGroupBy,
    limit: mockSelectLimit,
    select: vi.fn().mockReturnThis(),
  };
  const insertChain = {
    values: mockInsertValues,
    returning: mockInsertReturning,
  };
  mockInsertValues.mockImplementation(() => insertChain);

  return {
    db: {
      insert: vi.fn(() => insertChain),
      select: vi.fn(() => selectChain),
      execute: mockExecute,
    },
  };
});

vi.mock("@shared/schema", () => ({
  opportunityScanSnapshots: {
    id: { name: "id" },
    status: { name: "status" },
    completedAt: { name: "completed_at" },
    createdAt: { name: "created_at" },
    requestFingerprint: { name: "request_fingerprint" },
  },
  opportunityHistory: {
    symbol:   { name: "symbol" },
    scanTime: { name: "scan_time" },
  },
}));

vi.mock("drizzle-orm", () => ({
  desc: (col: any) => ({ __desc: col }),
  sql: new Proxy(Object.assign((_s: any) => _s, { raw: (s: any) => s }), {}),
  inArray: (col: any, vals: any[]) => ({ __inArray: { col, vals } }),
  lt: (col: any, val: any) => ({ __lt: { col, val } }),
  and: (...args: any[]) => ({ __and: args }),
}));

import {
  saveSuccessfulSnapshot,
  saveFailedAttempt,
  getLatestValidSnapshot,
  deleteExpiredSnapshots,
  getFirstSeenMap,
  VALID_STATUSES,
} from "./opportunity-snapshot-store";

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeResultPayload() {
  return {
    marketRegime: "TRENDING",
    topGrowth: [{ rank: 1, symbol: "NVDA", strategy: "VCP Breakout", whySelected: ["Strong"], warnings: [] }],
    topIncome: [],
    topWatchlist: [{ symbol: "AMD", watchConditions: ["Awaiting volume"] }],
    approachingQualification: [],
  };
}

function makeSuccessArgs(overrides: Partial<Parameters<typeof saveSuccessfulSnapshot>[0]> = {}) {
  return {
    status: "SUCCESS" as const,
    startedAt: new Date("2026-08-06T02:00:00Z"),
    completedAt: new Date("2026-08-06T02:01:00Z"),
    generatedAt: new Date("2026-08-06T02:00:30Z"),
    dataSource: "Twelve Data via MCP",
    dataQuality: "Latest daily market data",
    scannerVersion: "mcp-v1",
    requestFingerprint: "mcp-v1-2026-08-06T02",
    requestSummary: { numberOfIdeas: 10 },
    reviewedCount: 200,
    qualifiedCount: 5,
    watchCount: 3,
    rejectedCount: 10,
    excludedCount: 12,
    unavailableCount: 0,
    resultPayload: makeResultPayload(),
    warnings: [],
    durationMs: 4200,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A. Persistence — saveSuccessfulSnapshot
// ---------------------------------------------------------------------------

describe("A. Persistence — saveSuccessfulSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertValues.mockReturnThis();
    mockInsertReturning.mockResolvedValue([{ id: "snap-123" }]);
  });

  it("SUCCESS: inserts a row and returns the generated id", async () => {
    const id = await saveSuccessfulSnapshot(makeSuccessArgs({ status: "SUCCESS" }));
    expect(id).toBe("snap-123");
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUCCESS", scanType: "MARKET_RANKING" }),
    );
  });

  it("PARTIAL_SUCCESS: inserts with status PARTIAL_SUCCESS", async () => {
    const id = await saveSuccessfulSnapshot(
      makeSuccessArgs({ status: "PARTIAL_SUCCESS", unavailableCount: 3, warnings: ["Some unavailable"] }),
    );
    expect(id).toBe("snap-123");
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PARTIAL_SUCCESS" }),
    );
  });

  it("EMPTY_SUCCESS: inserts with status EMPTY_SUCCESS and zero counts", async () => {
    const id = await saveSuccessfulSnapshot(
      makeSuccessArgs({ status: "EMPTY_SUCCESS", qualifiedCount: 0, watchCount: 0 }),
    );
    expect(id).toBe("snap-123");
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "EMPTY_SUCCESS", qualifiedCount: 0, watchCount: 0 }),
    );
  });

  it("throws when INSERT does not return an id", async () => {
    mockInsertReturning.mockResolvedValue([]);
    await expect(saveSuccessfulSnapshot(makeSuccessArgs())).rejects.toThrow(
      /INSERT did not return an id/,
    );
  });

  it("preserves candidate order in resultPayload (rank order)", async () => {
    const payload = {
      ...makeResultPayload(),
      topGrowth: [
        { rank: 1, symbol: "NVDA", whySelected: [], warnings: [] },
        { rank: 2, symbol: "AMD", whySelected: [], warnings: [] },
        { rank: 3, symbol: "AAPL", whySelected: [], warnings: [] },
      ],
    };
    await saveSuccessfulSnapshot(makeSuccessArgs({ resultPayload: payload }));
    const inserted = mockInsertValues.mock.calls[0][0];
    expect(inserted.resultPayload.topGrowth.map((c: any) => c.symbol)).toEqual(["NVDA", "AMD", "AAPL"]);
  });

  it("preserves all counts in the inserted row", async () => {
    await saveSuccessfulSnapshot(
      makeSuccessArgs({ reviewedCount: 250, qualifiedCount: 7, watchCount: 4, rejectedCount: 15, excludedCount: 20, unavailableCount: 2 }),
    );
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ reviewedCount: 250, qualifiedCount: 7, watchCount: 4, rejectedCount: 15, excludedCount: 20, unavailableCount: 2 }),
    );
  });
});

// ---------------------------------------------------------------------------
// A. Persistence — saveFailedAttempt
// ---------------------------------------------------------------------------

describe("A. Persistence — saveFailedAttempt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertValues.mockResolvedValue(undefined);
  });

  it("inserts a FAILED row with safe error metadata", async () => {
    await saveFailedAttempt({
      startedAt: new Date(),
      completedAt: new Date(),
      errorCode: "MCP_TIMEOUT",
      errorSummary: "MCP timed out after 30s",
      durationMs: 30000,
    });
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED", errorCode: "MCP_TIMEOUT" }),
    );
  });

  it("truncates errorSummary to 500 chars", async () => {
    const longSummary = "X".repeat(1000);
    await saveFailedAttempt({ startedAt: new Date(), completedAt: new Date(), errorCode: "ERR", errorSummary: longSummary, durationMs: 1000 });
    const inserted = mockInsertValues.mock.calls[0][0];
    expect(inserted.errorSummary.length).toBe(500);
  });

  it("truncates errorCode to 64 chars", async () => {
    const longCode = "CODE_".repeat(20);
    await saveFailedAttempt({ startedAt: new Date(), completedAt: new Date(), errorCode: longCode, errorSummary: "error", durationMs: 500 });
    const inserted = mockInsertValues.mock.calls[0][0];
    expect(inserted.errorCode.length).toBe(64);
  });

  it("never sets resultPayload on FAILED rows", async () => {
    await saveFailedAttempt({ startedAt: new Date(), completedAt: new Date(), errorCode: "ERR", errorSummary: "error", durationMs: 500 });
    const inserted = mockInsertValues.mock.calls[0][0];
    expect(inserted.resultPayload).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// A. Persistence — getLatestValidSnapshot
// ---------------------------------------------------------------------------

describe("A. Persistence — getLatestValidSnapshot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when no valid snapshots exist", async () => {
    mockSelectLimit.mockResolvedValue([]);
    const result = await getLatestValidSnapshot();
    expect(result).toBeNull();
  });

  it("reconstructs snapshot from DB row + resultPayload", async () => {
    const now = new Date("2026-08-06T03:00:00Z");
    mockSelectLimit.mockResolvedValue([{
      id: "snap-abc",
      status: "SUCCESS",
      startedAt: now,
      completedAt: now,
      generatedAt: now,
      scannerVersion: "mcp-v1",
      dataSource: "Twelve Data via MCP",
      dataQuality: "Latest daily market data",
      reviewedCount: 200,
      qualifiedCount: 5,
      watchCount: 3,
      rejectedCount: 10,
      excludedCount: 12,
      unavailableCount: 0,
      resultPayload: { marketRegime: "TRENDING", topGrowth: [{ rank: 1, symbol: "NVDA", whySelected: [], warnings: [] }], topIncome: [], topWatchlist: [{ symbol: "AMD", watchConditions: [] }], approachingQualification: [] },
      warnings: ["one warning"],
      createdAt: now,
    }]);
    const snap = await getLatestValidSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.id).toBe("snap-abc");
    expect(snap!.status).toBe("SUCCESS");
    expect(snap!.topGrowth[0].symbol).toBe("NVDA");
    expect(snap!.marketRegime).toBe("TRENDING");
    expect(snap!.warnings).toEqual(["one warning"]);
  });

  it("defaults empty arrays when resultPayload is null", async () => {
    const now = new Date();
    mockSelectLimit.mockResolvedValue([{
      id: "snap-empty",
      status: "EMPTY_SUCCESS",
      startedAt: now, completedAt: now, generatedAt: now,
      scannerVersion: "mcp-v1",
      dataSource: "Twelve Data via MCP",
      dataQuality: "Latest daily market data",
      reviewedCount: 100, qualifiedCount: 0, watchCount: 0,
      rejectedCount: 5, excludedCount: 8, unavailableCount: 0,
      resultPayload: null,
      warnings: [],
      createdAt: now,
    }]);
    const snap = await getLatestValidSnapshot();
    expect(snap!.topGrowth).toEqual([]);
    expect(snap!.topIncome).toEqual([]);
    expect(snap!.topWatchlist).toEqual([]);
    expect(snap!.approachingQualification).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F. Retention — deleteExpiredSnapshots
// ---------------------------------------------------------------------------

describe("F. Retention — deleteExpiredSnapshots", () => {
  beforeEach(() => vi.clearAllMocks());

  it("issues two DELETE statements (valid + failed)", async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 3 }).mockResolvedValueOnce({ rowCount: 1 });
    const result = await deleteExpiredSnapshots();
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(result.validDeleted).toBe(3);
    expect(result.failedDeleted).toBe(1);
  });

  it("returns zero counts when nothing is expired", async () => {
    mockExecute.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rowCount: 0 });
    const result = await deleteExpiredSnapshots();
    expect(result.validDeleted).toBe(0);
    expect(result.failedDeleted).toBe(0);
  });

  it("handles rowCount undefined gracefully", async () => {
    mockExecute.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const result = await deleteExpiredSnapshots();
    expect(result.validDeleted).toBe(0);
    expect(result.failedDeleted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// VALID_STATUSES guard
// ---------------------------------------------------------------------------

describe("VALID_STATUSES constant", () => {
  it("includes SUCCESS, PARTIAL_SUCCESS, EMPTY_SUCCESS", () => {
    expect(VALID_STATUSES).toContain("SUCCESS");
    expect(VALID_STATUSES).toContain("PARTIAL_SUCCESS");
    expect(VALID_STATUSES).toContain("EMPTY_SUCCESS");
  });

  it("does NOT include FAILED", () => {
    expect(VALID_STATUSES).not.toContain("FAILED");
  });
});

// ---------------------------------------------------------------------------
// G. getFirstSeenMap — regression tests for ANY() → inArray() fix
//
// Root cause: the previous implementation used
//   WHERE symbol = ANY(${upperSymbols})
// Drizzle's sql template serialises a JS array as its .toString() string
// representation (e.g. "PLTR"), not a PostgreSQL array literal. PostgreSQL then
// rejects the query with:
//   "op ANY/ALL (array) requires array on right side"
//
// Fix: replaced with db.select().from().where(inArray(...)).groupBy() which
// generates a correct IN (...) clause via Drizzle's query builder.
// ---------------------------------------------------------------------------

describe("G. getFirstSeenMap — ANY() regression + edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty Map immediately for an empty symbols array (no DB call)", async () => {
    const result = await getFirstSeenMap([]);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    // No DB call should have been made
    expect(mockGroupBy).not.toHaveBeenCalled();
  });

  it("single symbol — builds Map with correct uppercase key", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { symbol: "PLTR", firstSeen: "2024-06-01T00:00:00.000Z" },
    ]);
    const result = await getFirstSeenMap(["PLTR"]);
    expect(result.size).toBe(1);
    expect(result.has("PLTR")).toBe(true);
    expect(result.get("PLTR")).toBe("2024-06-01T00:00:00.000Z");
  });

  it("single symbol lowercase input — normalised to uppercase key", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { symbol: "PLTR", firstSeen: "2024-06-01T00:00:00.000Z" },
    ]);
    const result = await getFirstSeenMap(["pltr"]);
    expect(result.has("PLTR")).toBe(true);
  });

  it("multiple symbols — all entries present in the returned Map", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { symbol: "PLTR", firstSeen: "2024-06-01T00:00:00.000Z" },
      { symbol: "NVDA", firstSeen: "2024-05-15T00:00:00.000Z" },
      { symbol: "AAPL", firstSeen: "2024-04-01T00:00:00.000Z" },
    ]);
    const result = await getFirstSeenMap(["PLTR", "NVDA", "AAPL"]);
    expect(result.size).toBe(3);
    expect(result.get("PLTR")).toBe("2024-06-01T00:00:00.000Z");
    expect(result.get("NVDA")).toBe("2024-05-15T00:00:00.000Z");
    expect(result.get("AAPL")).toBe("2024-04-01T00:00:00.000Z");
  });

  it("DB returns empty rows for known symbols — Map is empty", async () => {
    mockGroupBy.mockResolvedValueOnce([]);
    const result = await getFirstSeenMap(["PLTR"]);
    expect(result.size).toBe(0);
  });

  it("DB returns a Date object for firstSeen — converted to ISO string", async () => {
    const d = new Date("2024-06-01T00:00:00.000Z");
    mockGroupBy.mockResolvedValueOnce([
      { symbol: "PLTR", firstSeen: d },
    ]);
    const result = await getFirstSeenMap(["PLTR"]);
    expect(result.get("PLTR")).toBe("2024-06-01T00:00:00.000Z");
  });

  it("DB returns lowercase symbol — Map key is uppercased", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { symbol: "pltr", firstSeen: "2024-06-01T00:00:00.000Z" },
    ]);
    const result = await getFirstSeenMap(["pltr"]);
    expect(result.has("PLTR")).toBe(true);
    expect(result.has("pltr")).toBe(false);
  });

  it("row with null symbol is skipped", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { symbol: null, firstSeen: "2024-06-01T00:00:00.000Z" },
      { symbol: "NVDA", firstSeen: "2024-05-01T00:00:00.000Z" },
    ]);
    const result = await getFirstSeenMap(["NVDA"]);
    expect(result.size).toBe(1);
    expect(result.has("NVDA")).toBe(true);
  });

  it("row with null firstSeen is skipped", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { symbol: "PLTR", firstSeen: null },
      { symbol: "NVDA", firstSeen: "2024-05-01T00:00:00.000Z" },
    ]);
    const result = await getFirstSeenMap(["PLTR", "NVDA"]);
    expect(result.size).toBe(1);
    expect(result.has("NVDA")).toBe(true);
    expect(result.has("PLTR")).toBe(false);
  });

  it("uses inArray (not raw ANY) — mockGroupBy receives the call", async () => {
    mockGroupBy.mockResolvedValueOnce([]);
    await getFirstSeenMap(["PLTR"]);
    // Confirm the query builder path was taken (groupBy called, execute was not)
    expect(mockGroupBy).toHaveBeenCalledTimes(1);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
