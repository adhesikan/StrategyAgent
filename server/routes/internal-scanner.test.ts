// Tests for the internal scanner API (service-to-service, Sprint 1B).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import {
  registerInternalScannerRoutes,
  listInternalStrategies,
  resolveStrategyId,
  normalizeStatus,
  toInternalSetup,
  dedupeAcrossUsers,
  isRowFresh,
  type InternalScannerDeps,
} from "./internal-scanner";
import type { Opportunity } from "@shared/schema";

const KEY = "test-internal-key";
const NOW = new Date("2026-07-31T12:00:00Z");

const ALL_IDS = [
  "VCP", "VCP_MULTIDAY", "CLASSIC_PULLBACK", "VWAP_RECLAIM", "ORB5",
  "ORB15", "HIGH_RVOL", "GAP_AND_GO", "TREND_CONTINUATION", "VOLATILITY_SQUEEZE",
];

function row(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "row-internal-id",
    userId: "user-secret-id",
    symbol: "NVDA",
    strategyId: "VCP",
    strategyName: "Momentum Breakout",
    timeframe: "1d",
    stageAtDetection: "READY",
    detectedAt: new Date("2026-07-30T14:00:00Z"),
    detectedPrice: 120.5,
    resistancePrice: 125,
    stopReferencePrice: 117.2,
    entryTriggerPrice: null,
    rvol: 2.1,
    score: 82,
    status: "ACTIVE",
    resolvedAt: null,
    resolutionOutcome: null,
    resolutionReason: null,
    resolutionPrice: null,
    pnlPercent: null,
    maxPriceAfter: null,
    minPriceAfter: null,
    lastPrice: 121.3,
    maxFavorableMovePercent: null,
    maxAdverseMovePercent: null,
    barsTracked: 3,
    activeDurationMinutes: null,
    dedupeKey: "user-secret-id:NVDA:VCP:1d:20666",
    createdAt: new Date("2026-07-30T14:00:00Z"),
    updatedAt: new Date("2026-07-30T14:00:00Z"),
    ...overrides,
  } as Opportunity;
}

let server: Server;
let baseUrl: string;
let setupRows: Opportunity[] = [];
let oppRows: Opportunity[] = [];
let fetchSetupRows: ReturnType<typeof vi.fn>;
let fetchOpportunityRows: ReturnType<typeof vi.fn>;

async function startApp() {
  fetchSetupRows = vi.fn(async () => setupRows);
  fetchOpportunityRows = vi.fn(async () => oppRows);
  const deps: InternalScannerDeps = {
    fetchSetupRows: fetchSetupRows as any,
    fetchOpportunityRows: fetchOpportunityRows as any,
  };
  const app = express();
  registerInternalScannerRoutes(app, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

function get(path: string, token?: string | null) {
  const headers: Record<string, string> = {};
  if (token !== null) headers.Authorization = `Bearer ${token ?? KEY}`;
  return fetch(`${baseUrl}${path}`, { headers });
}

beforeEach(async () => {
  process.env.VCP_INTERNAL_API_KEY = KEY;
  setupRows = [];
  oppRows = [];
  await startApp();
});

afterEach(async () => {
  delete process.env.VCP_INTERNAL_API_KEY;
  await new Promise((r) => server.close(r));
  vi.restoreAllMocks();
});

describe("auth", () => {
  it("401 on missing Authorization header for all three routes", async () => {
    for (const path of [
      "/api/internal/scanner/strategies",
      "/api/internal/scanner/setup?symbol=NVDA&strategy=VCP",
      "/api/internal/scanner/opportunities",
    ]) {
      const res = await get(path, null);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    }
    expect(fetchSetupRows).not.toHaveBeenCalled();
    expect(fetchOpportunityRows).not.toHaveBeenCalled();
  });

  it("401 on invalid token; no storage access", async () => {
    const res = await get("/api/internal/scanner/opportunities", "wrong-token");
    expect(res.status).toBe(401);
    expect(fetchOpportunityRows).not.toHaveBeenCalled();
  });
});

describe("GET /api/internal/scanner/strategies", () => {
  it("returns all 10 production strategy IDs with metadata", async () => {
    const res = await get("/api/internal/scanner/strategies");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategies.map((s: any) => s.id).sort()).toEqual([...ALL_IDS].sort());
    expect(body.generatedAt).toBeTruthy();
    for (const s of body.strategies) {
      expect(s.direction).toBe("bullish");
      expect(s.displayName).toBeTruthy();
      expect(s.category).toBeTruthy();
      expect(s.supportedTimeframes).toEqual(["1d"]);
      expect(s.targetedScan).toBe(true);
      expect(s.rankedOpportunities).toBe(true);
      expect(s.enabled).toBe(true);
    }
  });

  it("no disabled strategies are exposed (all registered strategies are implemented)", () => {
    expect(listInternalStrategies().every((s) => s.enabled)).toBe(true);
  });
});

describe("strategy alias resolution", () => {
  it("accepts real IDs any case, guide slugs, and slugified display names", () => {
    expect(resolveStrategyId("VCP")).toBe("VCP");
    expect(resolveStrategyId("vcp")).toBe("VCP");
    expect(resolveStrategyId("momentum_breakout")).toBe("VCP");
    expect(resolveStrategyId("momentum-breakout")).toBe("VCP");
    expect(resolveStrategyId("power_breakout")).toBe("VCP_MULTIDAY");
    expect(resolveStrategyId("gap_and_go")).toBe("GAP_AND_GO");
    expect(resolveStrategyId("nonsense")).toBeNull();
  });
});

describe("GET /api/internal/scanner/setup", () => {
  it("returns the latest stored setup with normalized fields, no sensitive data", async () => {
    setupRows = [row()];
    const res = await get("/api/internal/scanner/setup?symbol=NVDA&strategy=momentum_breakout&timeframe=1d");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.setup).toMatchObject({
      symbol: "NVDA",
      strategy: "VCP",
      strategyDisplayName: "Momentum Breakout",
      direction: "bullish",
      score: 82,
      status: "ready",
      timeframe: "1d",
      trigger: null, // entryTriggerPrice not stored — truthfully null
      invalidation: 117.2,
      technicalObjective: 125,
      currentPrice: 121.3,
      source: "scheduled-scan-store",
    });
    expect(body.setup.details.rawStage).toBe("READY");
    const text = JSON.stringify(body);
    expect(text).not.toContain("user-secret-id");
    expect(text).not.toContain("row-internal-id");
    expect(text).not.toContain("dedupeKey");
    expect(fetchSetupRows).toHaveBeenCalledWith("NVDA", "VCP", "1d");
  });

  it("400 on invalid symbol", async () => {
    const res = await get("/api/internal/scanner/setup?symbol=**&strategy=VCP");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_SYMBOL");
  });

  it("400 on unknown strategy", async () => {
    const res = await get("/api/internal/scanner/setup?symbol=NVDA&strategy=iron_condor");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("UNSUPPORTED_STRATEGY");
  });

  it("400 on unsupported timeframe", async () => {
    const res = await get("/api/internal/scanner/setup?symbol=NVDA&strategy=VCP&timeframe=5m");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("UNSUPPORTED_TIMEFRAME");
  });

  it("missing setup returns setup:null, fresh:false (200)", async () => {
    setupRows = [];
    const res = await get("/api/internal/scanner/setup?symbol=ZZZZ&strategy=VCP");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.setup).toBeNull();
    expect(body.fresh).toBe(false);
  });

  it("skips malformed stored rows instead of crashing or fabricating", async () => {
    setupRows = [row({ symbol: "" as any }), row({ detectedAt: new Date("2026-07-29T14:00:00Z") })];
    const res = await get("/api/internal/scanner/setup?symbol=NVDA&strategy=VCP");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.setup.detectedAt).toBe("2026-07-29T14:00:00.000Z");
  });
});

describe("GET /api/internal/scanner/opportunities", () => {
  it("returns stored opportunities in production order, no re-ranking", async () => {
    oppRows = [
      row({ symbol: "NVDA", score: 60, detectedAt: new Date("2026-07-31T10:00:00Z") }),
      row({ symbol: "AMD", score: 95, detectedAt: new Date("2026-07-30T10:00:00Z"), dedupeKey: "k2" }),
      row({ symbol: "MU", score: 80, detectedAt: new Date("2026-07-29T10:00:00Z"), dedupeKey: "k3" }),
    ];
    const res = await get("/api/internal/scanner/opportunities");
    const body = await res.json();
    // detectedAt DESC preserved — NOT sorted by score
    expect(body.opportunities.map((o: any) => o.symbol)).toEqual(["NVDA", "AMD", "MU"]);
    expect(body.source).toBe("scheduled-scan-store");
    const req = fetchOpportunityRows.mock.calls[0][0];
    // default: ACTIVE lifecycle only; never triggers a scan — reads store only
    expect(req.branches).toEqual([{ status: "ACTIVE" }]);
  });

  it("status=triggered includes ACTIVE/BREAKOUT and RESOLVED/BROKE_RESISTANCE branches", async () => {
    oppRows = [
      row({ symbol: "AMD", stageAtDetection: "BREAKOUT", dedupeKey: "a" }),
      row({ symbol: "MU", status: "RESOLVED", resolutionOutcome: "BROKE_RESISTANCE", dedupeKey: "b" }),
    ];
    const res = await get("/api/internal/scanner/opportunities?status=triggered");
    const body = await res.json();
    expect(body.opportunities.map((o: any) => o.symbol)).toEqual(["AMD", "MU"]);
    const req = fetchOpportunityRows.mock.calls[0][0];
    expect(req.branches).toEqual([
      { status: "ACTIVE", stages: ["BREAKOUT"] },
      { status: "RESOLVED", outcomes: ["BROKE_RESISTANCE"] },
    ]);
  });

  it("status=extended is truthfully empty without a storage read", async () => {
    oppRows = [row()];
    const res = await get("/api/internal/scanner/opportunities?status=extended");
    expect((await res.json()).opportunities).toEqual([]);
    expect(fetchOpportunityRows).not.toHaveBeenCalled();
  });

  it("paginates past heavy cross-user duplication until limit is met", async () => {
    // Page 1: 500 duplicates of the same symbol+strategy; page 2 has distinct rows.
    const page1 = Array.from({ length: 500 }, (_, i) => row({ userId: `u${i}`, dedupeKey: `d${i}` }));
    const page2 = [row({ symbol: "AMD", dedupeKey: "p2a" }), row({ symbol: "MU", dedupeKey: "p2b" })];
    fetchOpportunityRows.mockImplementation(async ({ offset }: any) => (offset === 0 ? page1 : page2));
    const res = await get("/api/internal/scanner/opportunities?limit=3");
    const body = await res.json();
    expect(body.opportunities.map((o: any) => o.symbol)).toEqual(["NVDA", "AMD", "MU"]);
    expect(fetchOpportunityRows).toHaveBeenCalledTimes(2);
    expect(fetchOpportunityRows.mock.calls[1][0].offset).toBe(500);
  });

  it("keeps multiple strategies for the same symbol as separate entries", async () => {
    oppRows = [
      row({ symbol: "NVDA", strategyId: "VCP", dedupeKey: "a" }),
      row({ symbol: "NVDA", strategyId: "GAP_AND_GO", strategyName: "Gap Force", dedupeKey: "b" }),
    ];
    const res = await get("/api/internal/scanner/opportunities");
    const body = await res.json();
    expect(body.opportunities).toHaveLength(2);
    expect(body.opportunities.map((o: any) => o.strategy).sort()).toEqual(["GAP_AND_GO", "VCP"]);
  });

  it("collapses duplicate symbol+strategy rows across users to the latest", async () => {
    oppRows = [
      row({ userId: "u1", detectedAt: new Date("2026-07-31T10:00:00Z"), dedupeKey: "a" }),
      row({ userId: "u2", detectedAt: new Date("2026-07-30T10:00:00Z"), dedupeKey: "b" }),
    ];
    const res = await get("/api/internal/scanner/opportunities");
    const body = await res.json();
    expect(body.opportunities).toHaveLength(1);
    expect(body.opportunities[0].detectedAt).toBe("2026-07-31T10:00:00.000Z");
  });

  it("strategy filter validates and passes resolved IDs to storage", async () => {
    await get("/api/internal/scanner/opportunities?strategies=vcp,momentum_breakout,gap_and_go");
    const req = fetchOpportunityRows.mock.calls[0][0];
    expect(req.strategyIds).toEqual(["VCP", "GAP_AND_GO"]); // deduped after alias resolution
    const bad = await get("/api/internal/scanner/opportunities?strategies=vcp,unknown_thing");
    expect(bad.status).toBe(400);
  });

  it("direction=bearish returns an empty list (no bearish strategies exist)", async () => {
    oppRows = [row()];
    const res = await get("/api/internal/scanner/opportunities?direction=bearish");
    const body = await res.json();
    expect(body.opportunities).toEqual([]);
    expect(fetchOpportunityRows).not.toHaveBeenCalled();
  });

  it("status filter uses normalized vocabulary", async () => {
    oppRows = [
      row({ stageAtDetection: "READY", dedupeKey: "a" }),
      row({ symbol: "AMD", stageAtDetection: "BREAKOUT", dedupeKey: "b" }),
    ];
    const res = await get("/api/internal/scanner/opportunities?status=triggered");
    const body = await res.json();
    expect(body.opportunities.map((o: any) => o.symbol)).toEqual(["AMD"]);
    const bad = await get("/api/internal/scanner/opportunities?status=BREAKOUT");
    expect(bad.status).toBe(400);
  });

  it("minScore filters and rejects out-of-range values", async () => {
    oppRows = [
      row({ score: 90, dedupeKey: "a" }),
      row({ symbol: "AMD", score: 50, dedupeKey: "b" }),
      row({ symbol: "MU", score: null as any, dedupeKey: "c" }),
    ];
    const res = await get("/api/internal/scanner/opportunities?minScore=60");
    expect(res.status).toBe(200);
    // minScore is pushed into the DB filter (score not null AND >= minScore)
    expect(fetchOpportunityRows.mock.calls[0][0].minScore).toBe(60);
    expect((await get("/api/internal/scanner/opportunities?minScore=101")).status).toBe(400);
  });

  it("enforces limit bounds", async () => {
    oppRows = Array.from({ length: 30 }, (_, i) => row({ symbol: `SYM${i}`, dedupeKey: `k${i}` }));
    const res = await get("/api/internal/scanner/opportunities?limit=5");
    expect((await res.json()).opportunities).toHaveLength(5);
    expect((await get("/api/internal/scanner/opportunities?limit=0")).status).toBe(400);
    expect((await get("/api/internal/scanner/opportunities?limit=101")).status).toBe(400);
  });

  it("skips malformed stored rows and exposes no sensitive fields", async () => {
    oppRows = [row({ strategyId: "" as any, dedupeKey: "a" }), row({ symbol: "AMD", dedupeKey: "b" })];
    const res = await get("/api/internal/scanner/opportunities");
    const body = await res.json();
    expect(body.opportunities).toHaveLength(1);
    const text = JSON.stringify(body);
    expect(text).not.toContain("user-secret-id");
    expect(text).not.toContain("userId");
    expect(text).not.toContain("dedupeKey");
  });
});

describe("normalization + freshness (pure)", () => {
  it("maps stages and lifecycle to the MCP vocabulary; raw preserved in details", () => {
    expect(normalizeStatus(row({ stageAtDetection: "FORMING" }))).toBe("forming");
    expect(normalizeStatus(row({ stageAtDetection: "READY" }))).toBe("ready");
    expect(normalizeStatus(row({ stageAtDetection: "BREAKOUT" }))).toBe("triggered");
    expect(normalizeStatus(row({ status: "RESOLVED", resolutionOutcome: "BROKE_RESISTANCE" }))).toBe("triggered");
    expect(normalizeStatus(row({ status: "RESOLVED", resolutionOutcome: "INVALIDATED" }))).toBe("invalid");
    expect(normalizeStatus(row({ status: "RESOLVED", resolutionOutcome: "EXPIRED" }))).toBe("invalid");
    expect(normalizeStatus(row({ stageAtDetection: "WEIRD" as any }))).toBe("unknown");
    expect(toInternalSetup(row({ stageAtDetection: "BREAKOUT" }))!.details.rawStage).toBe("BREAKOUT");
  });

  it("fresh mirrors the production 10-day expiration rule", () => {
    expect(isRowFresh(row({ detectedAt: new Date("2026-07-30T00:00:00Z") }), NOW)).toBe(true);
    expect(isRowFresh(row({ detectedAt: new Date("2026-07-10T00:00:00Z") }), NOW)).toBe(false);
    expect(isRowFresh(row({ status: "RESOLVED" }), NOW)).toBe(false);
  });

  it("dedupeAcrossUsers preserves input order", () => {
    const rows = [
      row({ symbol: "B", dedupeKey: "1" }),
      row({ symbol: "A", dedupeKey: "2" }),
      row({ symbol: "B", dedupeKey: "3", userId: "u2" }),
    ];
    expect(dedupeAcrossUsers(rows).map((r) => r.symbol)).toEqual(["B", "A"]);
  });
});
