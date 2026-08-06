// Sprint 5.5 — Dashboard route tests (Opportunity Engine migration)
//
// Stock opportunities are no longer served by GET /api/dashboard.
// They live at GET /api/opportunities/latest (opportunity-engine.ts).
//
// Tests cover: routing, market snapshot, optionsAvailability,
// AI infra watch, portfolio, saved research, failure isolation, regression.
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

vi.mock("../services/dashboard-stock-opportunities", () => ({
  buildOptionsAvailability: vi.fn(),
}));

vi.mock("./home-snapshot", () => ({
  buildHomeSnapshot: vi.fn(),
  registerHomeSnapshotRoutes: vi.fn(),
}));

vi.mock("../services/ai-infra-watch", () => ({
  buildAiInfraWatch: vi.fn(),
}));

vi.mock("../broker/index", () => ({
  getBrokerPositions: vi.fn(),
}));

import { storage } from "../storage";
import { ResearchRecordService } from "../services/research-record-service";
import { buildOptionsAvailability } from "../services/dashboard-stock-opportunities";
import { buildHomeSnapshot } from "./home-snapshot";
import { buildAiInfraWatch } from "../services/ai-infra-watch";

const mockStorage = storage as any;
const mockResearch = ResearchRecordService as any;
const mockOptionsAvail = buildOptionsAvailability as any;
const mockSnapshot = buildHomeSnapshot as any;
const mockAiInfra = buildAiInfraWatch as any;

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeSnapshot() {
  return {
    marketTone: "bullish" as const,
    marketToneReason: "Indices broadly higher.",
    indices: [{ symbol: "SPY", name: "S&P 500", last: 510.5, changePercent: 0.75 }],
    vix: { last: 16.5, changePercent: -0.8 },
    sectorLeadership: [{ symbol: "XLK", name: "Technology", changePercent: 1.2 }],
    marketRegime: { regime: "TRENDING" as const, strength: 72, description: "Trending upward." },
    topMovers: [{ symbol: "NVDA", last: 900, changePercent: 3.2 }],
    topNews: [],
    topGrowth: { symbol: "NVDA", headline: "AI infrastructure." },
    dataMode: "live" as const,
    dataSource: "twelve_data" as const,
    growthSource: "sentiment" as const,
    asOf: new Date().toISOString(),
    disclaimer: "Not investment advice.",
  };
}

function makeOptionsAvail(hasBroker = false) {
  return {
    liveChainAvailable: false as false,
    source: hasBroker ? "broker" : (null as null),
    brokerRequired: true as true,
    estimatedStructuresAvailable: true,
    message: "Live options chain unavailable.",
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
  return [{ id: "wl-1", name: "Tech Leaders", symbols: ["NVDA", "MSFT", "AAPL"] }];
}

// ---------------------------------------------------------------------------
// Minimal Express-like mock for calling the route handler
// ---------------------------------------------------------------------------

function makeReqRes(userId: string | null = "user-123") {
  const req: any = { session: userId ? { userId } : {} };
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

vi.mock("express", () => ({ default: { get: () => {} } }));

import { registerDashboardRoutes } from "./dashboard";

function buildHandler(): (req: any, res: any) => Promise<void> {
  let handler: any = null;
  const fakeApp = { get: (_path: string, _auth: any, h: any) => { handler = h; } };
  const isAuthenticated = (_req: any, _res: any, next: any) => next();
  registerDashboardRoutes(fakeApp as any, isAuthenticated);
  return handler;
}

// ---------------------------------------------------------------------------
// Default beforeEach setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockStorage.getBrokerConnection.mockResolvedValue(null);
  mockStorage.getWatchlists.mockResolvedValue([]);
  mockResearch.listForUser.mockResolvedValue([]);
  mockSnapshot.mockResolvedValue(makeSnapshot());
  mockOptionsAvail.mockReturnValue(makeOptionsAvail(false));
  mockAiInfra.mockResolvedValue({ status: "unavailable" });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/dashboard — routing", () => {
  it("returns 401 when userId is absent from session", async () => {
    const handler = buildHandler();
    const { req, res } = makeReqRes(null);
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("calls market snapshot, ai infra, research and watchlists when userId is present", async () => {
    const handler = buildHandler();
    const { req, res } = makeReqRes();
    await handler(req, res);
    expect(mockSnapshot).toHaveBeenCalledWith("user-123");
    expect(mockAiInfra).toHaveBeenCalledWith("user-123");
    expect(mockResearch.listForUser).toHaveBeenCalledWith("user-123", expect.objectContaining({ limit: 5 }));
    expect(mockStorage.getWatchlists).toHaveBeenCalledWith("user-123");
  });

  it("does NOT call buildDashboardStockOpportunities (moved to opportunity engine)", async () => {
    // Stock opportunities are now served by GET /api/opportunities/latest —
    // the dashboard route must not call MCP for them.
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody()).not.toHaveProperty("stockOpportunities");
    expect(getBody()).not.toHaveProperty("growthOpportunities");
    expect(getBody()).not.toHaveProperty("incomeOpportunities");
  });
});

describe("GET /api/dashboard — market snapshot section", () => {
  it('returns status "ok" with data when snapshot succeeds', async () => {
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().marketSnapshot.status).toBe("ok");
    expect(getBody().marketSnapshot.data.marketTone).toBe("bullish");
  });

  it("includes vix, sectorLeadership and marketRegime", async () => {
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const snap = getBody().marketSnapshot.data;
    expect(snap.vix).toBeDefined();
    expect(Array.isArray(snap.sectorLeadership)).toBe(true);
    expect(snap.marketRegime.regime).toBe("TRENDING");
  });

  it('returns status "unavailable" when snapshot throws', async () => {
    mockSnapshot.mockRejectedValue(new Error("quote service down"));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().marketSnapshot.status).toBe("unavailable");
    expect(getBody().marketSnapshot.data).toBeUndefined();
  });

  it("market snapshot failure does not affect other sections", async () => {
    mockSnapshot.mockRejectedValue(new Error("snapshot down"));
    mockResearch.listForUser.mockResolvedValue(makeResearchRecords());
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().marketSnapshot.status).toBe("unavailable");
    expect(getBody().savedResearch.status).toBe("ok");
    expect(getBody().optionsAvailability).toBeDefined();
  });
});

describe("GET /api/dashboard — optionsAvailability section", () => {
  it("has optionsAvailability key in response", async () => {
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody()).toHaveProperty("optionsAvailability");
  });

  it("liveChainAvailable is false when no broker connected", async () => {
    mockOptionsAvail.mockReturnValue(makeOptionsAvail(false));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().optionsAvailability.liveChainAvailable).toBe(false);
    expect(getBody().optionsAvailability.brokerRequired).toBe(true);
  });

  it("no synthetic strike/premium/expiration/greeks in optionsAvailability", async () => {
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const bodyStr = JSON.stringify(getBody().optionsAvailability);
    expect(bodyStr).not.toContain("strike");
    expect(bodyStr).not.toContain("premium");
    expect(bodyStr).not.toContain("delta");
    expect(bodyStr).not.toContain("expiration");
  });

  it("estimatedStructuresAvailable is true (concepts may show in labeled section)", async () => {
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().optionsAvailability.estimatedStructuresAvailable).toBe(true);
  });

  it("broker-connected optionsAvailability still reports liveChainAvailable:false without chain", async () => {
    mockStorage.getBrokerConnection.mockResolvedValue({ isConnected: true, provider: "tradier" });
    mockOptionsAvail.mockReturnValue(makeOptionsAvail(true));
    const brokerModule = await import("../broker/index");
    (brokerModule.getBrokerPositions as any) = vi.fn().mockResolvedValue([]);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().optionsAvailability.liveChainAvailable).toBe(false);
    expect(getBody().optionsAvailability.source).toBe("broker");
  });
});

describe("GET /api/dashboard — disconnected user flow", () => {
  it("disconnected user portfolio is not_connected (no positions shown)", async () => {
    mockStorage.getBrokerConnection.mockResolvedValue(null);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().portfolio.status).toBe("not_connected");
    expect(getBody().portfolio.positions).toBeUndefined();
  });

  it("disconnected user options section reports no live chain and requires broker", async () => {
    mockStorage.getBrokerConnection.mockResolvedValue(null);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().optionsAvailability.liveChainAvailable).toBe(false);
    expect(getBody().optionsAvailability.brokerRequired).toBe(true);
  });

  it("disconnected user still receives market snapshot and ai infra sections", async () => {
    mockStorage.getBrokerConnection.mockResolvedValue(null);
    mockAiInfra.mockResolvedValue({ status: "unavailable" });
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().marketSnapshot.status).toBe("ok");
    expect(getBody().portfolio.brokerConnected).toBe(false);
    expect(getBody()).toHaveProperty("aiInfraWatch");
  });
});

describe("GET /api/dashboard — portfolio section", () => {
  it("does not include account identifiers in portfolio response", async () => {
    mockStorage.getBrokerConnection.mockResolvedValue({ isConnected: true, provider: "tradier" });
    const brokerModule = await import("../broker/index");
    (brokerModule.getBrokerPositions as any) = vi.fn().mockResolvedValue([
      { symbol: "NVDA", qty: 10, costBasis: 850, marketPrice: 900, unrealizedPnl: 500 },
    ]);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const bodyStr = JSON.stringify(getBody());
    expect(bodyStr).not.toContain("accountId");
    expect(bodyStr).not.toContain("account_id");
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

describe("GET /api/dashboard — failure isolation", () => {
  it("all sections unavailable when all services fail — still returns 200", async () => {
    mockSnapshot.mockRejectedValue(new Error("down"));
    mockAiInfra.mockRejectedValue(new Error("down"));
    mockResearch.listForUser.mockRejectedValue(new Error("down"));
    mockStorage.getWatchlists.mockRejectedValue(new Error("down"));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(getBody().marketSnapshot.status).toBe("unavailable");
    expect(getBody().savedResearch.status).toBe("unavailable");
    expect(getBody().watchlists.status).toBe("unavailable");
  });

  it("research failure leaves market snapshot intact", async () => {
    mockResearch.listForUser.mockRejectedValue(new Error("db down"));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().savedResearch.status).toBe("unavailable");
    expect(getBody().marketSnapshot.status).toBe("ok");
  });

  it("ai infra failure leaves market snapshot intact", async () => {
    mockAiInfra.mockRejectedValue(new Error("service down"));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().aiInfraWatch.status).toBe("unavailable");
    expect(getBody().marketSnapshot.status).toBe("ok");
  });
});

describe("GET /api/dashboard — regression", () => {
  it("does not expose execution-related fields in response", async () => {
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const bodyStr = JSON.stringify(getBody());
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

  it("no simulated or sample data anywhere in response", async () => {
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const bodyStr = JSON.stringify(getBody());
    expect(bodyStr).not.toContain('"simulated"');
    expect(bodyStr).not.toContain("Sample Opportunities");
    expect(bodyStr).not.toContain("Demo data");
  });

  it("generateCandidateScenarios and MCP ranking are never called from this route", async () => {
    // Stock opportunities are now served by the Opportunity Engine at
    // /api/opportunities/latest — this route must not trigger any MCP call.
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    // Dashboard must not include any opportunity buckets
    expect(getBody().stockOpportunities).toBeUndefined();
    expect(getBody().growthOpportunities).toBeUndefined();
    expect(getBody().incomeOpportunities).toBeUndefined();
  });

  it("response includes all expected section keys", async () => {
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const keys = Object.keys(getBody());
    expect(keys).toContain("marketSnapshot");
    expect(keys).toContain("optionsAvailability");
    expect(keys).toContain("aiInfraWatch");
    expect(keys).toContain("portfolio");
    expect(keys).toContain("savedResearch");
    expect(keys).toContain("watchlists");
    // stockOpportunities must NOT be present — served by /api/opportunities/latest
    expect(keys).not.toContain("stockOpportunities");
  });
});
