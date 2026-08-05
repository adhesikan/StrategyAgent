// Sprint 5.5 — Dashboard route tests
//
// Tests cover: routing, dashboard states, market snapshot, opportunities,
// portfolio, research, and regression per §20 of the spec.
//
// Run with: npx vitest run --root . server/routes/dashboard.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock all external dependencies so unit tests run without a real DB
// ---------------------------------------------------------------------------

vi.mock("../storage", () => ({
  storage: {
    getBrokerConnection: vi.fn(),
    getWatchlists: vi.fn(),
  },
}));

vi.mock("../replit_integrations/auth", () => ({
  authStorage: {
    getUser: vi.fn(),
  },
}));

vi.mock("../services/research-record-service", () => ({
  ResearchRecordService: {
    listForUser: vi.fn(),
  },
}));

vi.mock("../services/opportunity-radar/radar-service", () => ({
  generateCandidateScenarios: vi.fn(),
}));

vi.mock("../services/daily-market-data/trial-entitlement", () => ({
  getTrialFeatureRestriction: vi.fn(),
}));

vi.mock("./home-snapshot", () => ({
  buildHomeSnapshot: vi.fn(),
  registerHomeSnapshotRoutes: vi.fn(),
}));

vi.mock("../broker/index", () => ({
  getBrokerPositions: vi.fn(),
}));

import { storage } from "../storage";
import { authStorage } from "../replit_integrations/auth";
import { ResearchRecordService } from "../services/research-record-service";
import { generateCandidateScenarios } from "../services/opportunity-radar/radar-service";
import { getTrialFeatureRestriction } from "../services/daily-market-data/trial-entitlement";
import { buildHomeSnapshot } from "./home-snapshot";

const mockStorage = storage as any;
const mockAuth = authStorage as any;
const mockResearch = ResearchRecordService as any;
const mockRadar = generateCandidateScenarios as any;
const mockTrial = getTrialFeatureRestriction as any;
const mockSnapshot = buildHomeSnapshot as any;

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeSnapshot() {
  return {
    marketTone: "bullish" as const,
    marketToneReason: "Indices broadly higher.",
    indices: [{ symbol: "SPY", name: "S&P 500", last: 510.5, changePercent: 0.75 }],
    topMovers: [{ symbol: "NVDA", last: 900, changePercent: 3.2 }],
    topNews: [
      {
        symbol: "AAPL",
        label: "bullish" as const,
        impact: "high" as const,
        buzz: 8.5,
        whyItMatters: "Services revenue beat estimates.",
        articleCount: 12,
      },
    ],
    bestIncome: { symbol: "SPY", headline: "Index covered calls — high IV rank." },
    topGrowth: { symbol: "NVDA", headline: "AI infrastructure spend tailwind." },
    dataMode: "live" as const,
    asOf: new Date().toISOString(),
    disclaimer: "Not investment advice.",
  };
}

function makeRadarResult(symbols: string[] = ["AAPL", "NVDA", "MSFT"]) {
  return {
    candidates: symbols.map((symbol, i) => ({
      id: `${symbol}-1`,
      rank: i + 1,
      symbol,
      strategyType: "stock_swing",
      bias: "bullish",
      finalGrade: "A",
      finalScore: 80,
      mainReason: `${symbol} technical setup looks solid.`,
      dataMode: "live",
    })),
    dataMode: "live",
  };
}

function makeResearchRecords() {
  return [
    {
      id: "rec-1",
      symbol: "NVDA",
      title: "NVDA swing trade analysis",
      domain: "stock_analysis",
      verdict: "A bullish technical setup is present.",
      confidence: "high",
      generatedAt: new Date().toISOString(),
    },
  ];
}

function makeWatchlists() {
  return [
    { id: "wl-1", name: "Tech Leaders", symbols: ["NVDA", "MSFT", "AAPL"] },
  ];
}

// ---------------------------------------------------------------------------
// Minimal Express-like mock for calling the route handler
// ---------------------------------------------------------------------------

function makeReqRes(userId: string | null = "user-123") {
  const req: any = {
    session: userId ? { userId } : {},
  };
  let sentStatus = 200;
  let sentBody: any = null;
  const res: any = {
    status: vi.fn().mockImplementation((code: number) => { sentStatus = code; return res; }),
    json: vi.fn().mockImplementation((body: any) => { sentBody = body; return res; }),
  };
  return { req, res, getStatus: () => sentStatus, getBody: () => sentBody };
}

// ---------------------------------------------------------------------------
// Pull the handler out of the route registration
// ---------------------------------------------------------------------------

let capturedHandler: ((req: any, res: any) => Promise<void>) | null = null;

vi.mock("express", () => ({
  default: {
    get: () => {},
  },
}));

import { registerDashboardRoutes } from "./dashboard";

function buildHandler(): (req: any, res: any) => Promise<void> {
  let handler: any = null;
  const fakeApp = {
    get: (_path: string, _auth: any, h: any) => { handler = h; },
  };
  const isAuthenticated = (_req: any, _res: any, next: any) => next();
  registerDashboardRoutes(fakeApp as any, isAuthenticated);
  return handler;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/dashboard — routing", () => {
  it("returns 401 when userId is absent from session", async () => {
    const handler = buildHandler();
    const { req, res, getStatus } = makeReqRes(null);
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("calls all data sources when userId is present", async () => {
    mockAuth.getUser.mockResolvedValue({ id: "user-123", planId: "trial" });
    mockTrial.mockResolvedValue({ restricted: false });
    mockSnapshot.mockResolvedValue(makeSnapshot());
    mockRadar.mockResolvedValue(makeRadarResult());
    mockStorage.getBrokerConnection.mockResolvedValue(null);
    mockResearch.listForUser.mockResolvedValue(makeResearchRecords());
    mockStorage.getWatchlists.mockResolvedValue(makeWatchlists());

    const handler = buildHandler();
    const { req, res } = makeReqRes();
    await handler(req, res);

    expect(mockSnapshot).toHaveBeenCalledWith("user-123");
    expect(mockRadar).toHaveBeenCalledWith("user-123", expect.any(Object));
    expect(mockResearch.listForUser).toHaveBeenCalledWith("user-123", expect.objectContaining({ limit: 5 }));
    expect(mockStorage.getWatchlists).toHaveBeenCalledWith("user-123");
  });
});

describe("GET /api/dashboard — market snapshot section", () => {
  beforeEach(() => {
    mockAuth.getUser.mockResolvedValue({ id: "user-123" });
    mockTrial.mockResolvedValue({ restricted: false });
    mockStorage.getBrokerConnection.mockResolvedValue(null);
    mockResearch.listForUser.mockResolvedValue([]);
    mockStorage.getWatchlists.mockResolvedValue([]);
    mockRadar.mockResolvedValue(makeRadarResult());
  });

  it('returns status "ok" with data when snapshot succeeds', async () => {
    mockSnapshot.mockResolvedValue(makeSnapshot());
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const body = getBody();
    expect(body.marketSnapshot.status).toBe("ok");
    expect(body.marketSnapshot.data).toBeDefined();
    expect(body.marketSnapshot.data.marketTone).toBe("bullish");
  });

  it("includes timestamp and data mode in snapshot response", async () => {
    mockSnapshot.mockResolvedValue(makeSnapshot());
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const snap = getBody().marketSnapshot.data;
    expect(snap.asOf).toBeTruthy();
    expect(["live", "simulated"]).toContain(snap.dataMode);
  });

  it('returns status "unavailable" when snapshot throws', async () => {
    mockSnapshot.mockRejectedValue(new Error("quote service down"));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().marketSnapshot.status).toBe("unavailable");
    expect(getBody().marketSnapshot.data).toBeUndefined();
  });

  it("does not fabricate index values when snapshot unavailable", async () => {
    mockSnapshot.mockRejectedValue(new Error("timeout"));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    // No data field when unavailable — client shows "Data currently unavailable"
    expect(getBody().marketSnapshot.data).toBeUndefined();
  });
});

describe("GET /api/dashboard — opportunities section", () => {
  beforeEach(() => {
    mockAuth.getUser.mockResolvedValue({ id: "user-123" });
    mockTrial.mockResolvedValue({ restricted: false });
    mockSnapshot.mockResolvedValue(makeSnapshot());
    mockStorage.getBrokerConnection.mockResolvedValue(null);
    mockResearch.listForUser.mockResolvedValue([]);
    mockStorage.getWatchlists.mockResolvedValue([]);
  });

  it("returns candidates in backend-ranking order (no reordering)", async () => {
    const candidates = ["NVDA", "AAPL", "MSFT", "AMZN", "TSLA"];
    mockRadar.mockResolvedValue(makeRadarResult(candidates));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const returned = getBody().opportunities.candidates.map((c: any) => c.symbol);
    expect(returned).toEqual(candidates.slice(0, 5));
  });

  it("caps candidates at 5", async () => {
    mockRadar.mockResolvedValue(makeRadarResult(["A", "B", "C", "D", "E", "F", "G"]));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().opportunities.candidates.length).toBeLessThanOrEqual(5);
  });

  it('returns status "unavailable" when radar throws', async () => {
    mockRadar.mockRejectedValue(new Error("radar failed"));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().opportunities.status).toBe("unavailable");
  });

  it("snapshot failure does not affect opportunities", async () => {
    mockSnapshot.mockRejectedValue(new Error("snapshot down"));
    mockRadar.mockResolvedValue(makeRadarResult());
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().marketSnapshot.status).toBe("unavailable");
    expect(getBody().opportunities.status).toBe("ok");
  });
});

describe("GET /api/dashboard — portfolio section", () => {
  beforeEach(() => {
    mockAuth.getUser.mockResolvedValue({ id: "user-123" });
    mockTrial.mockResolvedValue({ restricted: false });
    mockSnapshot.mockResolvedValue(makeSnapshot());
    mockRadar.mockResolvedValue(makeRadarResult());
    mockResearch.listForUser.mockResolvedValue([]);
    mockStorage.getWatchlists.mockResolvedValue([]);
  });

  it("shows not_connected when no broker", async () => {
    mockStorage.getBrokerConnection.mockResolvedValue(null);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().portfolio.brokerConnected).toBe(false);
    expect(getBody().portfolio.status).toBe("not_connected");
  });

  it("does not include account identifiers in portfolio response", async () => {
    mockStorage.getBrokerConnection.mockResolvedValue({
      isConnected: true,
      provider: "tradier",
    });
    const brokerModule = await import("../broker/index");
    (brokerModule.getBrokerPositions as any) = vi.fn().mockResolvedValue([
      { symbol: "NVDA", qty: 10, costBasis: 850, marketPrice: 900, unrealizedPnl: 500 },
    ]);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const body = getBody();
    // No account numbers in response
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("accountId");
    expect(bodyStr).not.toContain("account_id");
  });

  it("neutral language — no buy/sell in position data", async () => {
    mockStorage.getBrokerConnection.mockResolvedValue({ isConnected: true });
    const brokerModule = await import("../broker/index");
    (brokerModule.getBrokerPositions as any) = vi.fn().mockResolvedValue([]);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const body = JSON.stringify(getBody().portfolio);
    expect(body).not.toMatch(/\byou should buy\b/i);
    expect(body).not.toMatch(/\byou should sell\b/i);
  });

  it("portfolio failure does not blank saved research", async () => {
    mockStorage.getBrokerConnection.mockResolvedValue({ isConnected: true });
    const brokerModule = await import("../broker/index");
    (brokerModule.getBrokerPositions as any) = vi.fn().mockRejectedValue(new Error("broker down"));
    mockResearch.listForUser.mockResolvedValue(makeResearchRecords());
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().portfolio.status).toBe("unavailable");
    expect(getBody().savedResearch.status).toBe("ok");
  });
});

describe("GET /api/dashboard — saved research section", () => {
  beforeEach(() => {
    mockAuth.getUser.mockResolvedValue({ id: "user-123" });
    mockTrial.mockResolvedValue({ restricted: false });
    mockSnapshot.mockResolvedValue(makeSnapshot());
    mockRadar.mockResolvedValue(makeRadarResult());
    mockStorage.getBrokerConnection.mockResolvedValue(null);
    mockStorage.getWatchlists.mockResolvedValue([]);
  });

  it("returns recent records capped at 5", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `rec-${i}`,
      symbol: "NVDA",
      title: `Record ${i}`,
      domain: "stock_analysis",
      generatedAt: new Date().toISOString(),
    }));
    // listForUser is called with limit 5 — service enforces it
    mockResearch.listForUser.mockResolvedValue(many.slice(0, 5));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(mockResearch.listForUser).toHaveBeenCalledWith("user-123", expect.objectContaining({ limit: 5 }));
    expect(getBody().savedResearch.records.length).toBeLessThanOrEqual(5);
  });

  it("does not expose raw internal verdict enums", async () => {
    mockResearch.listForUser.mockResolvedValue([
      {
        id: "r1",
        symbol: "AAPL",
        title: "AAPL analysis",
        domain: "stock_analysis",
        verdict: "A bullish technical setup with high momentum.",
        generatedAt: new Date().toISOString(),
      },
    ]);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const verdicts = getBody().savedResearch.records.map((r: any) => r.verdict);
    // Raw enum values like NO_TRADE / TRADE_CANDIDATE must not appear
    expect(verdicts.every((v: any) => !v || !/^[A-Z_]+$/.test(v))).toBe(true);
  });

  it('returns status "unavailable" when research query fails', async () => {
    mockResearch.listForUser.mockRejectedValue(new Error("db error"));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().savedResearch.status).toBe("unavailable");
  });

  it("research failure does not affect Ask AI route (regression)", async () => {
    // The Ask AI panel is static — it always renders regardless of data
    // We verify the dashboard response is still returned (no 500)
    mockResearch.listForUser.mockRejectedValue(new Error("db error"));
    const handler = buildHandler();
    const { req, res } = makeReqRes();
    await handler(req, res);
    expect(res.json).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(500);
  });
});

describe("GET /api/dashboard — partial service failures", () => {
  beforeEach(() => {
    mockAuth.getUser.mockResolvedValue({ id: "user-123" });
    mockTrial.mockResolvedValue({ restricted: false });
    mockStorage.getBrokerConnection.mockResolvedValue(null);
  });

  it("all sections unavailable when all services fail — still returns 200", async () => {
    mockSnapshot.mockRejectedValue(new Error("down"));
    mockRadar.mockRejectedValue(new Error("down"));
    mockResearch.listForUser.mockRejectedValue(new Error("down"));
    mockStorage.getWatchlists.mockRejectedValue(new Error("down"));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(getBody().marketSnapshot.status).toBe("unavailable");
    expect(getBody().opportunities.status).toBe("unavailable");
    expect(getBody().savedResearch.status).toBe("unavailable");
    expect(getBody().watchlists.status).toBe("unavailable");
  });

  it("snapshot failure leaves opportunities section intact", async () => {
    mockSnapshot.mockRejectedValue(new Error("quote timeout"));
    mockRadar.mockResolvedValue(makeRadarResult());
    mockResearch.listForUser.mockResolvedValue([]);
    mockStorage.getWatchlists.mockResolvedValue([]);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().marketSnapshot.status).toBe("unavailable");
    expect(getBody().opportunities.status).toBe("ok");
    expect(getBody().opportunities.candidates.length).toBeGreaterThan(0);
  });

  it("research failure leaves market snapshot intact", async () => {
    mockSnapshot.mockResolvedValue(makeSnapshot());
    mockRadar.mockResolvedValue(makeRadarResult());
    mockResearch.listForUser.mockRejectedValue(new Error("db down"));
    mockStorage.getWatchlists.mockResolvedValue([]);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().savedResearch.status).toBe("unavailable");
    expect(getBody().marketSnapshot.status).toBe("ok");
  });
});

describe("GET /api/dashboard — regression", () => {
  beforeEach(() => {
    mockAuth.getUser.mockResolvedValue({ id: "user-123" });
    mockTrial.mockResolvedValue({ restricted: false });
    mockSnapshot.mockResolvedValue(makeSnapshot());
    mockRadar.mockResolvedValue(makeRadarResult());
    mockStorage.getBrokerConnection.mockResolvedValue(null);
    mockResearch.listForUser.mockResolvedValue(makeResearchRecords());
    mockStorage.getWatchlists.mockResolvedValue(makeWatchlists());
  });

  it("does not expose execution-related fields in response", async () => {
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const bodyStr = JSON.stringify(getBody());
    // No order placement or execution fields
    expect(bodyStr).not.toContain("orderId");
    expect(bodyStr).not.toContain("orderRequest");
    expect(bodyStr).not.toContain("brokerOrderId");
  });

  it("does not include MCP payloads or tokens in response", async () => {
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const bodyStr = JSON.stringify(getBody());
    expect(bodyStr).not.toContain("mcpToken");
    expect(bodyStr).not.toContain("accessToken");
    expect(bodyStr).not.toContain("portfolioToken");
  });

  it("broker filter restricts radar candidates for trial users", async () => {
    mockTrial.mockResolvedValue({
      restricted: true,
      allowedSymbols: ["AAPL", "MSFT"],
      radarResultLimit: 2,
    });
    mockRadar.mockResolvedValue(makeRadarResult(["AAPL", "MSFT", "NVDA", "TSLA"]));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const symbols = getBody().opportunities.candidates.map((c: any) => c.symbol);
    expect(symbols.every((s: string) => ["AAPL", "MSFT"].includes(s))).toBe(true);
    expect(getBody().opportunities.candidates.length).toBeLessThanOrEqual(2);
  });
});
