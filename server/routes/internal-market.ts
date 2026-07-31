// Internal service-to-service market-data API.
//
// GET /api/internal/market/history?symbol=MU&interval=1day&outputSize=120
//
// Consumed by the external vcp-trader-mcp service. Reuses the existing
// production Twelve Data daily provider (server/services/daily-market-data)
// — no new market-data logic, no mock data. That provider already handles
// timeout/abort, bounded retries, credit reservation, provider error
// classification, and API-key redaction.
//
// Auth: Authorization: Bearer <VCP_INTERNAL_API_KEY> (constant-time compare).
// This endpoint deliberately does NOT use session/user auth — it is for
// backend services only. The key is never logged and never sent to a browser.
// It exposes only public OHLCV data: no broker credentials, no user accounts.

import { createHash, timingSafeEqual } from "crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { TwelveDataDailyProvider } from "../services/daily-market-data/twelve-data-client";
import { MarketDataProviderError, NormalizedDailyBar } from "../services/daily-market-data/types";

const SYMBOL_RE = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;
const SUPPORTED_INTERVALS = ["1day"] as const;
const OUTPUT_SIZE_MIN = 1;
const OUTPUT_SIZE_MAX = 500;
const OUTPUT_SIZE_DEFAULT = 120;
// Bounded end-to-end budget for this route, independent of provider retries.
const ROUTE_TIMEOUT_MS = 20_000;
// Cap concurrent provider fetches from this route so service-to-service
// traffic (including requests that outlive the route timeout) cannot drain
// the shared Twelve Data credit budget used by ingestion.
const MAX_CONCURRENT_FETCHES = 4;
let activeFetches = 0;

// Client-facing messages are stable per code; provider detail stays in logs.
const CLIENT_MESSAGES: Record<string, string> = {
  SYMBOL_NOT_FOUND: "Symbol not found or unsupported",
  NO_DATA: "No data available for symbol",
  PROVIDER_TIMEOUT: "Market data provider timed out",
  PROVIDER_QUOTA: "Market data quota exceeded, retry later",
  PROVIDER_UNAVAILABLE: "Market data provider unavailable",
  PROVIDER_ERROR: "Market data provider error",
  BUSY: "Too many concurrent requests, retry shortly",
};

export interface InternalMarketCandle {
  timestamp: string; // ISO trade date (YYYY-MM-DD) for 1day interval
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Injectable for tests; defaults to the real production provider.
export type DailyBarsFetcher = (params: {
  symbol: string;
  outputSize: number;
  caller: string;
}) => Promise<NormalizedDailyBar[]>;

function structuredError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

/**
 * Constant-time bearer-token check against VCP_INTERNAL_API_KEY.
 * Hashing both sides before timingSafeEqual removes the length side-channel
 * (timingSafeEqual requires equal lengths). The token is never logged.
 */
export function internalApiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.VCP_INTERNAL_API_KEY;
  if (!expected) {
    // Fail closed with a structured error; do not reveal configuration detail
    // beyond what a service integrator needs.
    return structuredError(res, 503, "INTERNAL_API_DISABLED", "Internal API is not configured");
  }
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) {
    return structuredError(res, 401, "UNAUTHORIZED", "Missing bearer token");
  }
  const provided = createHash("sha256").update(match[1]).digest();
  const wanted = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(provided, wanted)) {
    return structuredError(res, 401, "UNAUTHORIZED", "Invalid bearer token");
  }
  next();
}

function providerErrorToHttp(err: MarketDataProviderError): { status: number; code: string } {
  switch (err.code) {
    case "UNSUPPORTED_SYMBOL":
      return { status: 404, code: "SYMBOL_NOT_FOUND" };
    case "EMPTY":
      return { status: 404, code: "NO_DATA" };
    case "TIMEOUT":
      return { status: 504, code: "PROVIDER_TIMEOUT" };
    case "QUOTA":
      return { status: 503, code: "PROVIDER_QUOTA" };
    case "DISABLED":
    case "AUTH":
      return { status: 503, code: "PROVIDER_UNAVAILABLE" };
    default:
      return { status: 502, code: "PROVIDER_ERROR" };
  }
}

export function registerInternalMarketRoutes(
  app: Express,
  fetchDailyBars: DailyBarsFetcher = (p) => new TwelveDataDailyProvider().getDailyBars(p),
): void {
  app.get("/api/internal/market/history", internalApiKeyAuth, async (req, res) => {
    // --- validation (structured 400s) ---
    const rawSymbol = String(req.query.symbol ?? "").trim();
    if (!rawSymbol || !SYMBOL_RE.test(rawSymbol)) {
      return structuredError(res, 400, "INVALID_SYMBOL", "symbol must match [A-Z][A-Z0-9.-]{0,9}");
    }
    const symbol = rawSymbol.toUpperCase();

    const interval = String(req.query.interval ?? "1day");
    if (!(SUPPORTED_INTERVALS as readonly string[]).includes(interval)) {
      return structuredError(
        res,
        400,
        "INVALID_INTERVAL",
        `interval must be one of: ${SUPPORTED_INTERVALS.join(", ")}`,
      );
    }

    let outputSize = OUTPUT_SIZE_DEFAULT;
    if (req.query.outputSize !== undefined) {
      const n = Number(req.query.outputSize);
      if (!Number.isInteger(n) || n < OUTPUT_SIZE_MIN || n > OUTPUT_SIZE_MAX) {
        return structuredError(
          res,
          400,
          "INVALID_OUTPUT_SIZE",
          `outputSize must be an integer between ${OUTPUT_SIZE_MIN} and ${OUTPUT_SIZE_MAX}`,
        );
      }
      outputSize = n;
    }

    // --- fetch via the existing production provider, with a route-level cap ---
    if (activeFetches >= MAX_CONCURRENT_FETCHES) {
      return structuredError(res, 429, "BUSY", CLIENT_MESSAGES.BUSY);
    }
    activeFetches++;
    let timer: NodeJS.Timeout | undefined;
    try {
      const bars = await Promise.race([
        // The concurrency slot is held for the provider call's full lifetime
        // (even past the route timeout), so abandoned calls still count
        // against the cap and cannot drain the shared credit budget.
        fetchDailyBars({ symbol, outputSize, caller: "internal_market_api" }).finally(() => {
          activeFetches--;
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new MarketDataProviderError("Internal route timeout", "TIMEOUT")),
            ROUTE_TIMEOUT_MS,
          );
        }),
      ]);

      // Provider returns bars sorted ascending; enforce + document anyway.
      // Ordering contract: candles are OLDEST → NEWEST.
      const candles: InternalMarketCandle[] = bars
        .slice()
        .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
        .slice(-outputSize)
        .map((b) => ({
          timestamp: b.tradeDate,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        }));

      return res.json({ symbol, interval, candles });
    } catch (err: any) {
      const e =
        err instanceof MarketDataProviderError
          ? err
          : new MarketDataProviderError("Unexpected failure", "UNKNOWN");
      const { status, code } = providerErrorToHttp(e);
      // Log detail server-side (provider already redacts its API key from
      // messages); the client gets a stable sanitized message per code.
      console.error(
        JSON.stringify({
          event: "internal_market_history_error",
          symbol,
          code: e.code,
          message: e.message,
        }),
      );
      return structuredError(res, status, code, CLIENT_MESSAGES[code] ?? "Market data unavailable");
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
}
