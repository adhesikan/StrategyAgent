// Tests for GET /api/internal/market/history (service-to-service API).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import { registerInternalMarketRoutes, type DailyBarsFetcher } from "./internal-market";
import { MarketDataProviderError, type NormalizedDailyBar } from "../services/daily-market-data/types";

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

let server: Server;
let baseUrl: string;
let fetcher: ReturnType<typeof vi.fn>;

async function startApp(impl?: DailyBarsFetcher) {
  fetcher = vi.fn(impl ?? (async () => [bar("2026-07-29", 100), bar("2026-07-30", 101)]));
  const app = express();
  registerInternalMarketRoutes(app, fetcher as unknown as DailyBarsFetcher);
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
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
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("401 on invalid token", async () => {
    const res = await get("/api/internal/market/history?symbol=MU", "wrong-token");
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    expect(fetcher).not.toHaveBeenCalled();
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
    expect(fetcher).not.toHaveBeenCalled();
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

describe("valid request", () => {
  it("returns normalized candles oldest→newest and passes params to the real service", async () => {
    const res = await get("/api/internal/market/history?symbol=mu&interval=1day&outputSize=120");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      symbol: "MU",
      interval: "1day",
      candles: [
        { timestamp: "2026-07-29", open: 99, high: 101, low: 98, close: 100, volume: 1_000_000 },
        { timestamp: "2026-07-30", open: 100, high: 102, low: 99, close: 101, volume: 1_000_000 },
      ],
    });
    expect(fetcher).toHaveBeenCalledWith({ symbol: "MU", outputSize: 120, caller: "internal_market_api" });
  });

  it("normalizes provider bars: sorts ascending and strips provider-only fields", async () => {
    await new Promise((r) => server.close(r));
    await startApp(async () => [bar("2026-07-30", 101), bar("2026-07-28", 99), bar("2026-07-29", 100)]);
    const res = await get("/api/internal/market/history?symbol=MU");
    const body = await res.json();
    expect(body.candles.map((c: any) => c.timestamp)).toEqual(["2026-07-28", "2026-07-29", "2026-07-30"]);
    expect(Object.keys(body.candles[0]).sort()).toEqual(["close", "high", "low", "open", "timestamp", "volume"]);
  });
});

describe("provider failure", () => {
  it("maps provider errors to structured HTTP errors", async () => {
    const cases: Array<[MarketDataProviderError["code"], number, string]> = [
      ["UNSUPPORTED_SYMBOL", 404, "SYMBOL_NOT_FOUND"],
      ["EMPTY", 404, "NO_DATA"],
      ["TIMEOUT", 504, "PROVIDER_TIMEOUT"],
      ["QUOTA", 503, "PROVIDER_QUOTA"],
      ["DISABLED", 503, "PROVIDER_UNAVAILABLE"],
      ["NETWORK", 502, "PROVIDER_ERROR"],
    ];
    for (const [providerCode, status, apiCode] of cases) {
      await new Promise((r) => server.close(r));
      await startApp(async () => {
        throw new MarketDataProviderError("boom", providerCode);
      });
      const res = await get("/api/internal/market/history?symbol=MU");
      expect(res.status, providerCode).toBe(status);
      expect((await res.json()).error.code).toBe(apiCode);
    }
  });

  it("unexpected (non-provider) errors return 502 without leaking internals", async () => {
    await new Promise((r) => server.close(r));
    await startApp(async () => {
      throw new Error("secret internal detail");
    });
    const res = await get("/api/internal/market/history?symbol=MU");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("PROVIDER_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret internal detail");
  });
});
