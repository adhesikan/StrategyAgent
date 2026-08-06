// Tests for GET /api/internal/market/history (service-to-service API).
// The route now delegates to market-history-service.ts (database-first).
// Tests mock getHistoricalBars() instead of a raw DailyBarsFetcher.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import { registerInternalMarketRoutes } from "./internal-market";
import { MarketDataProviderError, type NormalizedDailyBar } from "../services/daily-market-data/types";

const { mockGetHistoricalBars } = vi.hoisted(() => ({
  mockGetHistoricalBars: vi.fn(),
}));

vi.mock("../services/market-history-service", () => ({
  getHistoricalBars: (...a: any[]) => mockGetHistoricalBars(...a),
  isDatabaseFirstEnabled: () => true,
  isExternalRefreshEnabled: () => true,
}));

const KEY = "test-internal-key";

function bar(tradeDate: string, close = 100): NormalizedDailyBar {
  return {
    symbol: "MU",
    tradeDate,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    adjustedClose: null,
    volume: 1_000_000,
    provider: "twelve_data",
    providerTimestamp: tradeDate,
    isComplete: true,
  };
}

function makeResult(bars: NormalizedDailyBar[], overrides: Record<string, any> = {}) {
  const latest = bars.length > 0 ? bars[bars.length - 1].tradeDate : null;
  return {
    bars,
    sourceType: "stored",
    provider: "twelve_data",
    freshnessStatus: "fresh",
    latestBarDate: latest,
    barCount: bars.length,
    retrievedAt: new Date().toISOString(),
    ...overrides,
  };
}

let server: Server;
let baseUrl: string;

async function startApp() {
  const app = express();
  registerInternalMarketRoutes(app);
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
  vi.clearAllMocks();
  process.env.VCP_INTERNAL_API_KEY = KEY;
  mockGetHistoricalBars.mockResolvedValue(
    makeResult([bar("2026-07-29", 100), bar("2026-07-30", 101)]),
  );
  await startApp();
});

afterEach(async () => {
  delete process.env.VCP_INTERNAL_API_KEY;
  await new Promise((r) => server.close(r));
  vi.restoreAllMocks();
});

describe("auth", () => {
  it("401 on missing Authorization header", async () => {
    const res = await get("/api/internal/market/history?symbol=MU", null);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("401 on invalid token", async () => {
    const res = await get("/api/internal/market/history?symbol=MU", "wrong-token");
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    expect(mockGetHistoricalBars).not.toHaveBeenCalled();
  });

  it("503 when VCP_INTERNAL_API_KEY is not configured (fail closed)", async () => {
    delete process.env.VCP_INTERNAL_API_KEY;
    const res = await get("/api/internal/market/history?symbol=MU");
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("INTERNAL_API_DISABLED");
  });
});

describe("validation", () => {
  it("400 on invalid symbol", async () => {
    for (const s of ["", "123ABC", "TOO_LONG_SYMBOL", "MU;DROP"]) {
      const res = await get(`/api/internal/market/history?symbol=${encodeURIComponent(s)}`);
      expect(res.status, s).toBe(400);
      expect((await res.json()).error.code).toBe("INVALID_SYMBOL");
    }
    expect(mockGetHistoricalBars).not.toHaveBeenCalled();
  });

  it("400 on bad interval", async () => {
    const res = await get("/api/internal/market/history?symbol=MU&interval=5min");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INTERVAL");
  });

  it("400 on outputSize out of bounds", async () => {
    for (const n of ["0", "-5", "501", "abc", "1.5"]) {
      const res = await get(`/api/internal/market/history?symbol=MU&outputSize=${n}`);
      expect(res.status, n).toBe(400);
      expect((await res.json()).error.code).toBe("INVALID_OUTPUT_SIZE");
    }
  });
});

describe("successful response", () => {
  it("returns normalized candles oldest→newest with additive metadata", async () => {
    const res = await get("/api/internal/market/history?symbol=mu&interval=1day&outputSize=120");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe("MU");
    expect(body.interval).toBe("1day");
    expect(body.candles).toHaveLength(2);
    expect(body.candles[0]).toEqual(
      { timestamp: "2026-07-29", open: 99, high: 101, low: 98, close: 100, volume: 1_000_000 },
    );
    expect(body.candles[1].timestamp).toBe("2026-07-30");
    // Additive metadata
    expect(body.sourceType).toBe("stored");
    expect(body.freshnessStatus).toBe("fresh");
    expect(body.latestBarDate).toBe("2026-07-30");
    expect(body.provider).toBe("twelve_data");
  });

  it("sorts candles ascending even when service returns them out of order", async () => {
    mockGetHistoricalBars.mockResolvedValue(
      makeResult([bar("2026-07-30", 101), bar("2026-07-28", 99), bar("2026-07-29", 100)]),
    );
    const res = await get("/api/internal/market/history?symbol=MU");
    const { candles } = await res.json();
    expect(candles.map((c: any) => c.timestamp)).toEqual(["2026-07-28", "2026-07-29", "2026-07-30"]);
  });

  it("candle shape contains only timestamp/open/high/low/close/volume — no provider fields", async () => {
    const res = await get("/api/internal/market/history?symbol=MU");
    const { candles } = await res.json();
    expect(Object.keys(candles[0]).sort()).toEqual(["close", "high", "low", "open", "timestamp", "volume"]);
    expect(candles[0].provider).toBeUndefined();
    expect(candles[0].tradeDate).toBeUndefined();
  });

  it("passes purpose=scan and allowExternalRefresh=false to the service", async () => {
    await get("/api/internal/market/history?symbol=MU&outputSize=60");
    expect(mockGetHistoricalBars).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "MU",
        outputSize: 60,
        purpose: "scan",
        allowExternalRefresh: false,
        caller: "internal_market_api",
      }),
    );
  });
});

describe("provider error mapping", () => {
  it.each<[MarketDataProviderError["code"], number, string]>([
    ["UNSUPPORTED_SYMBOL", 404, "SYMBOL_NOT_FOUND"],
    ["EMPTY",             404, "NO_DATA"],
    ["TIMEOUT",           504, "PROVIDER_TIMEOUT"],
    ["QUOTA",             503, "PROVIDER_QUOTA"],
    ["DISABLED",          503, "PROVIDER_UNAVAILABLE"],
    ["AUTH",              503, "PROVIDER_UNAVAILABLE"],
    // New explicit credit-error codes
    ["RATE_LIMITED",      429, "PROVIDER_RATE_LIMITED"],
    ["DAILY_LIMIT",       503, "PROVIDER_DAILY_LIMIT"],
    ["WAIT_TIMEOUT",      503, "PROVIDER_WAIT_TIMEOUT"],
    ["BAD_RESPONSE",      502, "PROVIDER_BAD_RESPONSE"],
    ["MALFORMED",         502, "PROVIDER_BAD_RESPONSE"],
    ["NETWORK",           502, "PROVIDER_ERROR"],
    ["UNKNOWN",           502, "PROVIDER_ERROR"],
  ])("MarketDataProviderError(%s) → HTTP %i %s", async (providerCode, status, apiCode) => {
    mockGetHistoricalBars.mockRejectedValue(new MarketDataProviderError("boom", providerCode));
    const res = await get("/api/internal/market/history?symbol=MU");
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(apiCode);
  });

  it("unexpected (non-provider) errors return 502 without leaking internals", async () => {
    mockGetHistoricalBars.mockRejectedValue(new Error("secret internal detail"));
    const res = await get("/api/internal/market/history?symbol=MU");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("PROVIDER_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret internal detail");
  });
});
