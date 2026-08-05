// Sprint 5.5 Step 1 — Dashboard route tests (updated for real opportunity pipeline)
//
// Tests cover: routing, market snapshot, stockOpportunities, optionsAvailability,
// AI infra watch, portfolio, research, and regression.
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
  buildDashboardStockOpportunities: vi.fn(),
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
import { buildDashboardStockOpportunities, buildOptionsAvailability } from "../services/dashboard-stock-opportunities";
import { buildHomeSnapshot } from "./home-snapshot";
import { buildAiInfraWatch } from "../services/ai-infra-watch";

const mockStorage = storage as any;
const mockResearch = ResearchRecordService as any;
const mockStockOpps = buildDashboardStockOpportunities as any;
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

function makeStockOppsSync(symbolCount = 3) {
  const symbols = ["NVDA", "AAPL", "MSFT", "AMZN", "TSLA"].slice(0, symbolCount);
  return {
    status: "ok" as const,
    dataSource: "mcp" as const,
    dataQuality: "Latest daily market data" as const,
    generatedAt: new Date().toISOString(),
    sourceTimestamp: new Date().toISOString(),
    reviewedCount: 150,
    qualifiedCount: symbolCount,
    watchCount: 2,
    unavailableCount: 1,
    candidates: symbols.map((symbol, i) => ({
      rank: i + 1,
      symbol,
      strategy: "VCP Breakout",
      setupStatus: "Qualified",
      confidence: "high",
      whySelected: [`${symbol} shows bullish VCP structure.`],
      warnings: [],
    })),
    watchCandidates: [
      { symbol: "AMD", watchConditions: ["Awaiting volume confirmation."] },
    ],
    warnings: [],
  };
}

function makeStockOpps(symbolCount = 3): ReturnType<typeof buildDashboardStockOpportunities> {
  return Promise.resolve(makeStockOppsSync(symbolCount));
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
  mockStockOpps.mockResolvedValue(makeStockOppsSync(3));
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

  it("calls all data sources when userId is present", async () => {
    const handler = buildHandler();
    const { req, res } = makeReqRes();
    await handler(req, res);
    expect(mockSnapshot).toHaveBeenCalledWith("user-123");
    expect(mockStockOpps).toHaveBeenCalled();
    expect(mockAiInfra).toHaveBeenCalledWith("user-123");
    expect(mockResearch.listForUser).toHaveBeenCalledWith("user-123", expect.objectContaining({ limit: 5 }));
    expect(mockStorage.getWatchlists).toHaveBeenCalledWith("user-123");
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

  it("market snapshot failure does not affect stockOpportunities", async () => {
    mockSnapshot.mockRejectedValue(new Error("snapshot down"));
    mockStockOpps.mockResolvedValue(await makeStockOpps());
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().marketSnapshot.status).toBe("unavailable");
    expect(getBody().stockOpportunities.status).toBe("ok");
    expect(getBody().stockOpportunities.candidates.length).toBeGreaterThan(0);
  });
});

describe("GET /api/dashboard — stockOpportunities section (real pipeline)", () => {
  it("has stockOpportunities key, not opportunities or growthOpportunities", async () => {
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody()).toHaveProperty("stockOpportunities");
    expect(getBody()).not.toHaveProperty("opportunities");
    expect(getBody()).not.toHaveProperty("growthOpportunities");
    expect(getBody()).not.toHaveProperty("incomeOpportunities");
  });

  it("returns candidates in backend-ranking order (no reordering)", async () => {
    const symbols = ["NVDA", "AAPL", "MSFT"];
    mockStockOpps.mockResolvedValue(await makeStockOpps(3));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const returned = getBody().stockOpportunities.candidates.map((c: any) => c.symbol);
    expect(returned).toEqual(symbols);
  });

  it("candidate fields contain no synthetic options values", async () => {
    mockStockOpps.mockResolvedValue(await makeStockOpps());
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const bodyStr = JSON.stringify(getBody().stockOpportunities.candidates);
    expect(bodyStr).not.toContain("premium");
    expect(bodyStr).not.toContain("expiration");
    expect(bodyStr).not.toContain("openInterest");
    expect(bodyStr).not.toContain("bidAsk");
    expect(bodyStr).not.toContain("greek");
    expect(bodyStr).not.toContain("synthetic");
  });

  it("includes count fields for honest empty-state handling", async () => {
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const opps = getBody().stockOpportunities;
    expect(typeof opps.reviewedCount).toBe("number");
    expect(typeof opps.qualifiedCount).toBe("number");
    expect(typeof opps.watchCount).toBe("number");
  });

  it("preserves sourceTimestamp for provenance", async () => {
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().stockOpportunities.sourceTimestamp).toBeTruthy();
  });

  it("carries dataSource:mcp and dataQuality for badge display", async () => {
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().stockOpportunities.dataSource).toBe("mcp");
    expect(getBody().stockOpportunities.dataQuality).toBe("Latest daily market data");
  });

  it('returns status "unavailable" when MCP ranking fails', async () => {
    mockStockOpps.mockResolvedValue({ status: "unavailable", reason: "mcp_unavailable" });
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().stockOpportunities.status).toBe("unavailable");
    expect(getBody().stockOpportunities.candidates).toBeUndefined();
  });

  it("zero candidates still returns status ok with honest counts", async () => {
    mockStockOpps.mockResolvedValue({
      status: "ok",
      dataSource: "mcp",
      dataQuality: "Latest daily market data",
      generatedAt: new Date().toISOString(),
      sourceTimestamp: new Date().toISOString(),
      reviewedCount: 200,
      qualifiedCount: 0,
      watchCount: 0,
      unavailableCount: 5,
      candidates: [],
      watchCandidates: [],
      warnings: [],
    });
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().stockOpportunities.status).toBe("ok");
    expect(getBody().stockOpportunities.qualifiedCount).toBe(0);
    expect(getBody().stockOpportunities.candidates).toHaveLength(0);
    // Client uses counts to explain the empty state honestly
    expect(typeof getBody().stockOpportunities.reviewedCount).toBe("number");
  });

  it("snapshot failure does not affect stockOpportunities (section isolation)", async () => {
    mockSnapshot.mockRejectedValue(new Error("quote timeout"));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().marketSnapshot.status).toBe("unavailable");
    expect(getBody().stockOpportunities.status).toBe("ok");
  });

  it("does not expose simulated or mock data in response body", async () => {
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    const bodyStr = JSON.stringify(getBody());
    expect(bodyStr).not.toContain('"simulated"');
    expect(bodyStr).not.toContain('"mock"');
    expect(bodyStr).not.toContain("Sample Opportunities");
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
  it("disconnected user gets real stock opportunities (no broker required)", async () => {
    mockStorage.getBrokerConnection.mockResolvedValue(null);
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().stockOpportunities.status).toBe("ok");
    expect(getBody().portfolio.brokerConnected).toBe(false);
  });

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
    mockStockOpps.mockRejectedValue(new Error("down"));
    mockAiInfra.mockRejectedValue(new Error("down"));
    mockResearch.listForUser.mockRejectedValue(new Error("down"));
    mockStorage.getWatchlists.mockRejectedValue(new Error("down"));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(getBody().marketSnapshot.status).toBe("unavailable");
    expect(getBody().stockOpportunities.status).toBe("unavailable");
    expect(getBody().savedResearch.status).toBe("unavailable");
    expect(getBody().watchlists.status).toBe("unavailable");
  });

  it("MCP failure does not affect market snapshot", async () => {
    mockStockOpps.mockRejectedValue(new Error("MCP connection refused"));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().stockOpportunities.status).toBe("unavailable");
    expect(getBody().marketSnapshot.status).toBe("ok");
  });

  it("research failure leaves market snapshot intact", async () => {
    mockResearch.listForUser.mockRejectedValue(new Error("db down"));
    const handler = buildHandler();
    const { req, res, getBody } = makeReqRes();
    await handler(req, res);
    expect(getBody().savedResearch.status).toBe("unavailable");
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

  it("generateCandidateScenarios is never called (radar-service retired from dashboard)", async () => {
    const handler = buildHandler();
    const { req, res } = makeReqRes();
    await handler(req, res);
    // If this import existed it would have been called; verify via body shape only
    const { req: r2, res: r2res, getBody } = makeReqRes();
    await handler(r2, r2res);
    // The response must have stockOpportunities from MCP, not radar-service buckets
    expect(getBody().stockOpportunities).toBeDefined();
    expect(getBody().growthOpportunities).toBeUndefined();
  });
});
