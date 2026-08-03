// Twelve Data real-time quote fallback (no-broker users).
//
// When a user has NO connected brokerage, real-time prices come from the
// Twelve Data `/quote` endpoint with `prepost=true`, so the quote is live
// during BOTH regular market hours and extended (pre/post) sessions:
// - regular session → `close` is the live last price;
// - pre/after hours  → Twelve Data returns extended_price/extended_change/
//   extended_percent_change, which we prefer when present.
//
// Safety rails (same regime as the daily-bars client):
// - Central access control: every user-facing caller must gate through
//   canAccessTwelveDataBackedAnalysis (env-first licensing — see
//   getRealtimeQuoteForUser below). No gate, no data.
// - Credit protection: 1 credit per /quote request, reserved through the
//   transactional credit manager, plus a short in-memory cache (default 30s)
//   and in-flight de-duplication so bursts of UI polling cannot burn the
//   7/min safety cap.
// - API-key redaction on every error path; the key never appears in logs.

import { getTwelveDataConfig, redactApiKey } from "./config";
import { MarketDataProviderError } from "./types";
import { reserveCreditsBlocking, logProviderRequest } from "./credit-manager";
import { getMarketSession, type MarketSession } from "@shared/market-session";

const BASE_URL = "https://api.twelvedata.com";
const QUOTE_CACHE_TTL_MS = 30_000;
const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export interface RealTimeQuote {
  symbol: string;
  last: number;
  change: number;
  changePercent: number;
  volume: number;
  previousClose: number | null;
  session: MarketSession;
  /** true when `last` came from Twelve Data's extended-hours fields. */
  extendedHours: boolean;
  isMarketOpen: boolean;
  asOf: string;
  source: "twelve_data_quote";
}

function parseNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

interface CacheEntry {
  quote: RealTimeQuote;
  fetchedAt: number;
}
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<RealTimeQuote>>();

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Map a raw Twelve Data /quote payload to a RealTimeQuote (exported for tests). */
export function normalizeQuotePayload(json: any, symbol: string, now: Date): RealTimeQuote {
  const close = parseNum(json?.close);
  if (close === null) {
    throw new MarketDataProviderError(`No price in quote for ${symbol}`, "EMPTY", true);
  }
  const previousClose = parseNum(json?.previous_close);
  const session = getMarketSession(now);

  // Extended-hours preference: during pre/after sessions (or whenever the
  // provider marks the market closed but supplies extended data), the
  // extended price is the real-time price.
  const extPrice = parseNum(json?.extended_price);
  const isMarketOpen = json?.is_market_open === true || json?.is_market_open === "true";
  const useExtended = extPrice !== null && extPrice > 0 && !isMarketOpen;

  const last = useExtended ? extPrice : close;
  const change = useExtended
    ? parseNum(json?.extended_change) ?? (previousClose != null ? +(last - previousClose).toFixed(4) : 0)
    : parseNum(json?.change) ?? (previousClose != null ? +(last - previousClose).toFixed(4) : 0);
  const changePercent = useExtended
    ? parseNum(json?.extended_percent_change) ?? (previousClose ? +((change / previousClose) * 100).toFixed(4) : 0)
    : parseNum(json?.percent_change) ?? (previousClose ? +((change / previousClose) * 100).toFixed(4) : 0);

  return {
    symbol,
    last,
    change,
    changePercent,
    volume: Math.max(0, Math.round(parseNum(json?.volume) ?? 0)),
    previousClose,
    session,
    extendedHours: useExtended,
    isMarketOpen,
    asOf: now.toISOString(),
    source: "twelve_data_quote",
  };
}

async function requestQuote(symbol: string, caller?: string): Promise<RealTimeQuote> {
  const cfg = getTwelveDataConfig();
  if (!cfg.enabled || cfg.licenseMode === "disabled") {
    throw new MarketDataProviderError("Twelve Data is disabled", "DISABLED", true);
  }
  if (!cfg.apiKey) {
    throw new MarketDataProviderError("Twelve Data API key not configured", "AUTH", true);
  }

  const qs = new URLSearchParams({
    symbol,
    timezone: cfg.timezone,
    prepost: "true", // extended-hours (pre/post) data — real-time outside RTH
    apikey: cfg.apiKey,
  });
  const url = `${BASE_URL}/quote?${qs.toString()}`;

  await reserveCreditsBlocking(1);
  const started = Date.now();
  try {
    const resp = await fetchWithTimeout(url, cfg.requestTimeoutMs);
    const text = await resp.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new MarketDataProviderError("Malformed JSON from provider", "MALFORMED");
    }
    if (json?.status === "error" || (typeof json?.code === "number" && json.code >= 400)) {
      const code = Number(json.code) || resp.status;
      const msg = redactApiKey(String(json.message || "provider error"));
      if (code === 401 || code === 403) throw new MarketDataProviderError(msg, "AUTH", true);
      if (code === 429) throw new MarketDataProviderError(msg, "QUOTA");
      if (code === 400 || code === 404) throw new MarketDataProviderError(msg, "UNSUPPORTED_SYMBOL", true);
      throw new MarketDataProviderError(msg, "UNKNOWN", code >= 400 && code < 500);
    }

    const quote = normalizeQuotePayload(json, symbol, new Date());
    await logProviderRequest({
      endpoint: "/quote",
      symbolsRequested: [symbol],
      creditsUsed: 1,
      status: "success",
      retryCount: 0,
      durationMs: Date.now() - started,
      caller,
    });
    return quote;
  } catch (err: any) {
    const e: MarketDataProviderError =
      err instanceof MarketDataProviderError
        ? err
        : err?.name === "AbortError"
          ? new MarketDataProviderError("Request timed out", "TIMEOUT")
          : new MarketDataProviderError(redactApiKey(String(err?.message || err)), "NETWORK");
    await logProviderRequest({
      endpoint: "/quote",
      symbolsRequested: [symbol],
      creditsUsed: 1,
      status: "error",
      retryCount: 0,
      durationMs: Date.now() - started,
      caller,
      errorCode: e.code,
    });
    throw e;
  }
}

/**
 * Fetch a real-time quote (cached ~30s, deduplicated). UNGATED — callers
 * exposing this to users MUST check Twelve Data access control first
 * (use getRealtimeQuoteForUser for user-facing paths).
 */
export async function getTwelveDataRealTimeQuote(rawSymbol: string, caller?: string): Promise<RealTimeQuote> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    throw new MarketDataProviderError(`Invalid symbol: ${symbol}`, "UNSUPPORTED_SYMBOL", true);
  }
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < QUOTE_CACHE_TTL_MS) return cached.quote;

  const existing = inFlight.get(symbol);
  if (existing) return existing;

  const p = requestQuote(symbol, caller)
    .then((quote) => {
      cache.set(symbol, { quote, fetchedAt: Date.now() });
      if (cache.size > 500) {
        // bounded cache: drop the oldest entries
        for (const key of Array.from(cache.keys()).slice(0, cache.size - 500)) cache.delete(key);
      }
      return quote;
    })
    .finally(() => inFlight.delete(symbol));
  inFlight.set(symbol, p);
  return p;
}

/**
 * User-facing gated variant: enforces the central Twelve Data access-control
 * decision (env-first licensing — prelaunch external users are denied) and
 * returns null instead of throwing, so callers can fall through to the
 * stored daily-close path.
 */
export async function getRealtimeQuoteForUser(
  userId: string,
  symbol: string,
  feature = "realtime_quote_fallback",
): Promise<RealTimeQuote | null> {
  try {
    const { canAccessTwelveDataBackedAnalysis } = await import("./access-control");
    const { authStorage } = await import("../../replit_integrations/auth/storage");
    const user = await authStorage.getUser(userId);
    const decision = canAccessTwelveDataBackedAnalysis({
      user: user ? { id: user.id, email: user.email, role: user.role } : null,
      feature,
    });
    if (!decision.allowed) return null;
    return await getTwelveDataRealTimeQuote(symbol, feature);
  } catch (err: any) {
    console.warn(`[RealtimeQuote] fallback unavailable for ${symbol}:`, redactApiKey(String(err?.message || err)));
    return null;
  }
}

/** Test-only helper. */
export function _clearRealtimeQuoteCache(): void {
  cache.clear();
  inFlight.clear();
}
