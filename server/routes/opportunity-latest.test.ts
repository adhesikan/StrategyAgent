// GET /api/opportunities/latest — unit tests (Sprint 1.1)
//
// Tests cover:
//   D. Endpoint (all response shapes, freshness, refresh status, safety)
//
// Run with: npx vitest run --root . server/routes/opportunity-latest.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the engine so tests never touch MCP or PostgreSQL
// ---------------------------------------------------------------------------

const mockGetLatestSnapshot = vi.fn();
const mockGetRefreshState = vi.fn();
const mockGetIntervalMs = vi.fn();

vi.mock("../services/opportunity-engine", () => ({
  getLatestSnapshot: () => mockGetLatestSnapshot(),
  getRefreshState: () => mockGetRefreshState(),
  getIntervalMs: () => mockGetIntervalMs(),
}));

import { registerOpportunityLatestRoute } from "./opportunity-latest";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Record<string, any> = {}) {
  const now = new Date().toISOString();
  return {
    id: "snap-001",
    status: "SUCCESS" as const,
    startedAt: now,
    completedAt: now,
    generatedAt: now,
    dataSource: "Twelve Data via MCP",
    dataQuality: "Latest daily market data",
    scannerVersion: "mcp-v1",
    marketRegime: "TRENDING",
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

function makeIdleRefreshState() {
  return { status: "idle" as const, attemptedAt: null, errorSummary: null };
}

// ---------------------------------------------------------------------------
// Test harness — extract route handler from registration
// ---------------------------------------------------------------------------

vi.mock("express", () => ({ default: { get: () => {} } }));

function buildHandler(): (req: any, res: any) => void {
  let handler: any = null;
  const fakeApp = {
    get: (_path: string, _auth: any, h: any) => { handler = h; },
  };
  const isAuthenticated = (_r: any, _s: any, next: any) => next();
  registerOpportunityLatestRoute(fakeApp as any, isAuthenticated);
  return handler;
}

function makeReqRes() {
  const req: any = {};
  let sentBody: any = null;
  const res: any = {
    json: vi.fn().mockImplementation((body: any) => { sentBody = body; return res; }),
  };
  return { req, res, getBody: () => sentBody };
}

// ---------------------------------------------------------------------------
// D. Endpoint tests
// ---------------------------------------------------------------------------

describe("D. Endpoint — GET /api/opportunities/latest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRefreshState.mockReturnValue(makeIdleRefreshState());
    mockGetIntervalMs.mockReturnValue(240 * 60 * 1000);
  });

  // ── No snapshot ──────────────────────────────────────────────────────────

  it("returns { snapshot: null, lastRefresh } when no snapshot exists", () => {
    mockGetLatestSnapshot.mockReturnValue(null);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    handler(req, res);
    expect(getBody().snapshot).toBeNull();
    expect(getBody().lastRefresh).toBeDefined();
  });

  it("lastRefresh.status is idle when engine has not run", () => {
    mockGetLatestSnapshot.mockReturnValue(null);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    handler(req, res);
    expect(getBody().lastRefresh.status).toBe("idle");
  });

  it("includes safe errorSummary in lastRefresh when engine last failed and no snapshot", () => {
    mockGetLatestSnapshot.mockReturnValue(null);
    mockGetRefreshState.mockReturnValue({
      status: "failed",
      attemptedAt: new Date().toISOString(),
      errorSummary: "Scan failed. Previous snapshot remains available.",
    });
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    handler(req, res);
    expect(getBody().snapshot).toBeNull();
    expect(getBody().lastRefresh.status).toBe("failed");
    expect(typeof getBody().lastRefresh.errorSummary).toBe("string");
  });

  // ── Fresh snapshot ────────────────────────────────────────────────────────

  it("returns snapshot with freshnessStatus=fresh for a recent scan", () => {
    const snap = makeSnapshot({ completedAt: new Date().toISOString() });
    mockGetLatestSnapshot.mockReturnValue(snap);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    handler(req, res);
    expect(getBody().snapshot.freshnessStatus).toBe("fresh");
  });

  it("snapshot includes id, status, counts, topGrowth, topIncome, topWatchlist", () => {
    mockGetLatestSnapshot.mockReturnValue(makeSnapshot());
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    handler(req, res);
    const { snapshot } = getBody();
    expect(snapshot.id).toBe("snap-001");
    expect(snapshot.status).toBe("SUCCESS");
    expect(snapshot.counts).toEqual({ reviewed: 200, qualified: 5, watch: 3, rejected: 10, excluded: 12, unavailable: 0 });
    expect(Array.isArray(snapshot.topGrowth)).toBe(true);
    expect(Array.isArray(snapshot.topIncome)).toBe(true);
    expect(Array.isArray(snapshot.topWatchlist)).toBe(true);
    expect(Array.isArray(snapshot.approachingQualification)).toBe(true);
    expect(Array.isArray(snapshot.warnings)).toBe(true);
  });

  // ── Stale snapshot ────────────────────────────────────────────────────────

  it("freshnessStatus=stale when completedAt is older than 1.5× interval", () => {
    const oldDate = new Date(Date.now() - 400 * 60 * 1000).toISOString(); // 400 min ago; interval=240, threshold=360
    const snap = makeSnapshot({ completedAt: oldDate });
    mockGetLatestSnapshot.mockReturnValue(snap);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    handler(req, res);
    expect(getBody().snapshot.freshnessStatus).toBe("stale");
  });

  // ── Partial / empty snapshots ─────────────────────────────────────────────

  it("partial snapshot: status=PARTIAL_SUCCESS is forwarded", () => {
    const snap = makeSnapshot({ status: "PARTIAL_SUCCESS", unavailableCount: 3, warnings: ["3 symbols unavailable"] });
    mockGetLatestSnapshot.mockReturnValue(snap);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    handler(req, res);
    expect(getBody().snapshot.status).toBe("PARTIAL_SUCCESS");
    expect(getBody().snapshot.warnings).toContain("3 symbols unavailable");
  });

  it("empty snapshot: status=EMPTY_SUCCESS forwarded with empty candidate arrays", () => {
    const snap = makeSnapshot({
      status: "EMPTY_SUCCESS",
      qualifiedCount: 0,
      watchCount: 0,
      topGrowth: [],
      topIncome: [],
      topWatchlist: [],
      approachingQualification: [],
    });
    mockGetLatestSnapshot.mockReturnValue(snap);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    handler(req, res);
    expect(getBody().snapshot.status).toBe("EMPTY_SUCCESS");
    expect(getBody().snapshot.topGrowth).toHaveLength(0);
  });

  // ── Refresh status ────────────────────────────────────────────────────────

  it("refreshStatus=running when engine is scanning", () => {
    mockGetLatestSnapshot.mockReturnValue(makeSnapshot());
    mockGetRefreshState.mockReturnValue({ status: "running", attemptedAt: new Date().toISOString(), errorSummary: null });
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    handler(req, res);
    expect(getBody().snapshot.refreshStatus).toBe("running");
  });

  it("refreshStatus=failed when last scan failed but prior snapshot exists", () => {
    mockGetLatestSnapshot.mockReturnValue(makeSnapshot());
    mockGetRefreshState.mockReturnValue({ status: "failed", attemptedAt: new Date().toISOString(), errorSummary: "timeout" });
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    handler(req, res);
    expect(getBody().snapshot.refreshStatus).toBe("failed");
  });

  // ── Safety: no sensitive fields ──────────────────────────────────────────

  it("no sensitive fields in response body", () => {
    mockGetLatestSnapshot.mockReturnValue(makeSnapshot());
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    handler(req, res);
    const bodyStr = JSON.stringify(getBody());
    expect(bodyStr).not.toContain("accessToken");
    expect(bodyStr).not.toContain("sessionId");
    expect(bodyStr).not.toContain("accountId");
    expect(bodyStr).not.toContain("rawProviderResponse");
    expect(bodyStr).not.toContain("authorization");
    expect(bodyStr).not.toContain("mcpToken");
  });

  it("errorSummary is null in lastRefresh when a valid snapshot exists", () => {
    mockGetLatestSnapshot.mockReturnValue(makeSnapshot());
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    handler(req, res);
    // When a valid snapshot is served, we don't expose error details
    expect(getBody().lastRefresh.errorSummary).toBeNull();
  });

  it("no stack trace or internal URL in response", () => {
    mockGetLatestSnapshot.mockReturnValue(null);
    mockGetRefreshState.mockReturnValue({
      status: "failed",
      attemptedAt: new Date().toISOString(),
      errorSummary: "Scan failed.",
    });
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    handler(req, res);
    const bodyStr = JSON.stringify(getBody());
    expect(bodyStr).not.toContain("at Object.");
    expect(bodyStr).not.toContain("railway.internal");
    expect(bodyStr).not.toContain("mcp_base_url");
  });
});
