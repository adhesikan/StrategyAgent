// Internal service-to-service market-data API.
//
// GET /api/internal/market/history?symbol=MU&interval=1day&outputSize=120
//
// Consumed by the external vcp-trader-mcp service. Routes through the canonical
// market-history-service (database-first) so stored PostgreSQL bars are served
// immediately when fresh, with controlled Twelve Data refresh only when needed.
//
// Provider precedence (MARKET_HISTORY_DATABASE_FIRST=true, default):
//   1. Fresh validated PostgreSQL bars  → 200, sourceType:"stored"
//   2. Twelve Data refresh              → 200, sourceType:"external_refresh"
//   3. Stale stored bars                → 200, sourceType:"stored_stale", freshnessStatus:"stale"
//   4. Unavailable                      → 502/503/504 per error code
//
// Emergency rollback (MARKET_HISTORY_DATABASE_FIRST=false):
//   Falls through directly to Twelve Data (legacy behavior — no DB read).
//
// Auth: Authorization: Bearer <VCP_INTERNAL_API_KEY> (constant-time compare).
// This endpoint deliberately does NOT use session/user auth — it is for
// backend services only. The key is never logged and never sent to a browser.
// It exposes only public OHLCV data: no broker credentials, no user accounts.

import { createHash, timingSafeEqual } from "crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { getHistoricalBars } from "../services/market-history-service";
import { MarketDataProviderError, type NormalizedDailyBar } from "../services/daily-market-data/types";

const SYMBOL_RE = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;
const SUPPORTED_INTERVALS = ["1day"] as const;
const OUTPUT_SIZE_MIN = 1;
const OUTPUT_SIZE_MAX = 500;
const OUTPUT_SIZE_DEFAULT = 120;
// Bounded end-to-end budget for this route, independent of provider retries.
const ROUTE_TIMEOUT_MS = 25_000;
// Cap concurrent provider fetches from this route so service-to-service
// traffic (including requests that outlive the route timeout) cannot drain
// the shared Twelve Data credit budget used by ingestion.
const MAX_CONCURRENT_FETCHES = 4;
let activeFetches = 0;

// ---------------------------------------------------------------------------
// Error code → HTTP mapping
//
// Every MarketDataProviderError code must be listed here so the default
// branch (502 PROVIDER_ERROR) is never reached for known credit/rate errors.
// ---------------------------------------------------------------------------

const CLIENT_MESSAGES: Record<string, string> = {
  SYMBOL_NOT_FOUND:      "Symbol not found or unsupported",
  NO_DATA:               "No data available for symbol",
  PROVIDER_TIMEOUT:      "Market data provider timed out",
  PROVIDER_RATE_LIMITED: "Per-minute request limit reached, retry in a few seconds",
  PROVIDER_DAILY_LIMIT:  "Daily market-data quota exhausted, retry after UTC midnight",
  PROVIDER_WAIT_TIMEOUT: "Credit reservation timed out waiting for rate window",
  PROVIDER_QUOTA:        "Market data quota exceeded, retry later",
  PROVIDER_UNAVAILABLE:  "Market data provider unavailable",
  PROVIDER_BAD_RESPONSE: "Provider returned an unreadable response",
  PROVIDER_ERROR:        "Market data provider error",
  BUSY:                  "Too many concurrent requests, retry shortly",
};

export interface InternalMarketCandle {
  timestamp: string; // ISO trade date (YYYY-MM-DD) for 1day interval
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

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
    // Specific credit / rate-limit codes — must NOT collapse to generic 502.
    case "RATE_LIMITED":
      return { status: 429, code: "PROVIDER_RATE_LIMITED" };
    case "DAILY_LIMIT":
      return { status: 503, code: "PROVIDER_DAILY_LIMIT" };
    case "WAIT_TIMEOUT":
      return { status: 503, code: "PROVIDER_WAIT_TIMEOUT" };
    case "QUOTA":
      return { status: 503, code: "PROVIDER_QUOTA" };
    case "DISABLED":
    case "AUTH":
      return { status: 503, code: "PROVIDER_UNAVAILABLE" };
    case "BAD_RESPONSE":
    case "MALFORMED":
      return { status: 502, code: "PROVIDER_BAD_RESPONSE" };
    default:
      return { status: 502, code: "PROVIDER_ERROR" };
  }
}

export function registerInternalMarketRoutes(app: Express): void {
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
        res, 400, "INVALID_INTERVAL",
        `interval must be one of: ${SUPPORTED_INTERVALS.join(", ")}`,
      );
    }

    let outputSize = OUTPUT_SIZE_DEFAULT;
    if (req.query.outputSize !== undefined) {
      const n = Number(req.query.outputSize);
      if (!Number.isInteger(n) || n < OUTPUT_SIZE_MIN || n > OUTPUT_SIZE_MAX) {
        return structuredError(
          res, 400, "INVALID_OUTPUT_SIZE",
          `outputSize must be an integer between ${OUTPUT_SIZE_MIN} and ${OUTPUT_SIZE_MAX}`,
        );
      }
      outputSize = n;
    }

    // --- concurrency cap ---
    if (activeFetches >= MAX_CONCURRENT_FETCHES) {
      return structuredError(res, 429, "BUSY", CLIENT_MESSAGES.BUSY);
    }
    activeFetches++;

    let timer: NodeJS.Timeout | undefined;
    try {
      // The canonical service handles database-first logic, freshness checking,
      // and controlled external refresh. The route timeout is independent of
      // provider retry budgets — a hung provider call can still be aborted here.
      const fetchPromise = getHistoricalBars({
        symbol,
        outputSize,
        // MCP scans use "scan" purpose: stored bars only, no external request storm.
        // When MARKET_HISTORY_DATABASE_FIRST=false (legacy rollback), the service
        // falls through to Twelve Data automatically.
        purpose: "scan",
        allowExternalRefresh: false, // prevent scan-time request storms
        caller: "internal_market_api",
      }).finally(() => {
        activeFetches--;
      });

      const result = await Promise.race([
        fetchPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new MarketDataProviderError("Internal route timeout", "TIMEOUT")),
            ROUTE_TIMEOUT_MS,
          );
        }),
      ]);

      // Sort ascending and trim — service guarantees ascending order but route
      // enforces it again for defense-in-depth.
      const candles: InternalMarketCandle[] = result.bars
        .slice()
        .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
        .slice(-outputSize)
        .map((b: NormalizedDailyBar) => ({
          timestamp: b.tradeDate,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        }));

      // Additive metadata — MCP consumers may ignore these fields; they do not
      // change the candles array shape or break existing contract consumers.
      return res.json({
        symbol,
        interval,
        candles,
        // Source provenance (added in database-first sprint):
        sourceType: result.sourceType,
        freshnessStatus: result.freshnessStatus,
        latestBarDate: result.latestBarDate,
        provider: result.provider,
      });
    } catch (err: any) {
      // Decrement counter only if fetchDailyBars threw before its own finally().
      // If the route timeout won the race, the fetch promise's .finally() will
      // decrement when it eventually settles — do not double-decrement here.
      const e =
        err instanceof MarketDataProviderError
          ? err
          : new MarketDataProviderError("Unexpected failure", "UNKNOWN");
      const { status, code } = providerErrorToHttp(e);
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
