// Secure server-side Twelve Data client (REST /time_series only — no
// WebSockets, no indicator endpoints). Implements timeout/abort, bounded
// retries with exponential delay, provider error detection, safe number
// parsing, per-symbol request de-duplication, and API-key redaction.

import { getTwelveDataConfig, redactApiKey } from "./config";
import {
  DailyMarketDataProvider,
  MarketDataProviderError,
  NormalizedDailyBar,
  ProviderHealthResult,
} from "./types";
import { reserveCreditsBlocking, logProviderRequest } from "./credit-manager";

const BASE_URL = "https://api.twelvedata.com";

function parseNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

const inFlight = new Map<string, Promise<NormalizedDailyBar[]>>();

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function requestTimeSeries(params: {
  symbol: string;
  startDate?: string;
  endDate?: string;
  outputSize?: number;
  caller?: string;
  ingestionRunId?: string | null;
}): Promise<NormalizedDailyBar[]> {
  const cfg = getTwelveDataConfig();
  if (!cfg.enabled || cfg.licenseMode === "disabled") {
    throw new MarketDataProviderError("Twelve Data is disabled", "DISABLED", true);
  }
  if (!cfg.apiKey) {
    throw new MarketDataProviderError("Twelve Data API key not configured", "AUTH", true);
  }

  const symbol = params.symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) {
    throw new MarketDataProviderError(`Invalid symbol: ${symbol}`, "UNSUPPORTED_SYMBOL", true);
  }

  const qs = new URLSearchParams({
    symbol,
    interval: cfg.interval,
    timezone: cfg.timezone,
    order: "ASC",
    outputsize: String(Math.min(params.outputSize ?? cfg.defaultOutputSize, 5000)),
    apikey: cfg.apiKey,
  });
  if (params.startDate) qs.set("start_date", params.startDate);
  if (params.endDate) qs.set("end_date", params.endDate);
  const url = `${BASE_URL}/time_series?${qs.toString()}`;

  // 1 credit per symbol per /time_series request (configurable weight).
  await reserveCreditsBlocking(1);

  const started = Date.now();
  let lastError: MarketDataProviderError | null = null;
  let attempt = 0;

  for (attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
    try {
      const resp = await fetchWithTimeout(url, cfg.requestTimeoutMs);
      const text = await resp.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new MarketDataProviderError("Malformed JSON from provider", "MALFORMED");
      }

      // Twelve Data returns errors as { status: "error", code, message }
      if (json?.status === "error" || (typeof json?.code === "number" && json.code >= 400)) {
        const code = Number(json.code) || resp.status;
        const msg = redactApiKey(String(json.message || "provider error"));
        if (code === 401 || code === 403) throw new MarketDataProviderError(msg, "AUTH", true);
        if (code === 429) throw new MarketDataProviderError(msg, "QUOTA");
        if (code === 400 || code === 404) throw new MarketDataProviderError(msg, "UNSUPPORTED_SYMBOL", true);
        throw new MarketDataProviderError(msg, "UNKNOWN", code >= 400 && code < 500);
      }

      const values: any[] = Array.isArray(json?.values) ? json.values : [];
      if (values.length === 0) {
        throw new MarketDataProviderError(`Empty response for ${symbol}`, "EMPTY", true);
      }

      const metaSymbol = String(json?.meta?.symbol || symbol).toUpperCase();
      if (metaSymbol !== symbol) {
        throw new MarketDataProviderError(
          `Provider returned symbol ${metaSymbol}, expected ${symbol}`,
          "MALFORMED",
          true,
        );
      }
      const metaInterval = String(json?.meta?.interval || cfg.interval);
      if (metaInterval !== cfg.interval) {
        throw new MarketDataProviderError(`Unexpected interval ${metaInterval}`, "MALFORMED", true);
      }

      const bars: NormalizedDailyBar[] = [];
      for (const v of values) {
        const dt = String(v?.datetime || "").slice(0, 10);
        const open = parseNum(v?.open);
        const high = parseNum(v?.high);
        const low = parseNum(v?.low);
        const close = parseNum(v?.close);
        const volume = parseNum(v?.volume) ?? 0;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dt) || open === null || high === null || low === null || close === null) {
          continue; // reject malformed record, keep the rest
        }
        bars.push({
          symbol,
          tradeDate: dt,
          open,
          high,
          low,
          close,
          adjustedClose: null,
          volume: Math.max(0, Math.round(volume)),
          provider: "twelve_data",
          providerTimestamp: String(v?.datetime || null),
          isComplete: true,
        });
      }
      bars.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

      await logProviderRequest({
        endpoint: "/time_series",
        symbolsRequested: [symbol],
        creditsUsed: 1,
        status: "success",
        retryCount: attempt,
        durationMs: Date.now() - started,
        caller: params.caller,
        ingestionRunId: params.ingestionRunId,
      });
      return bars;
    } catch (err: any) {
      const e: MarketDataProviderError =
        err instanceof MarketDataProviderError
          ? err
          : err?.name === "AbortError"
            ? new MarketDataProviderError("Request timed out", "TIMEOUT")
            : new MarketDataProviderError(redactApiKey(String(err?.message || err)), "NETWORK");
      lastError = e;
      if (e.permanent) break; // never retry permanent 4xx-style failures
      if (attempt === cfg.maxRetries) break;
      // retry attempts each consume a credit reservation
      if (attempt < cfg.maxRetries) {
        try {
          await reserveCreditsBlocking(1);
        } catch {
          break;
        }
      }
    }
  }

  await logProviderRequest({
    endpoint: "/time_series",
    symbolsRequested: [symbol],
    creditsUsed: 1 + Math.min(attempt, cfg.maxRetries),
    status: "error",
    retryCount: attempt,
    durationMs: Date.now() - started,
    caller: params.caller,
    ingestionRunId: params.ingestionRunId,
    errorCode: lastError?.code ?? "UNKNOWN",
  });
  throw lastError ?? new MarketDataProviderError("Unknown provider failure", "UNKNOWN");
}

export class TwelveDataDailyProvider implements DailyMarketDataProvider {
  providerName = "twelve_data";

  async getDailyBars(params: {
    symbol: string;
    startDate?: string;
    endDate?: string;
    outputSize?: number;
    caller?: string;
    ingestionRunId?: string | null;
  }): Promise<NormalizedDailyBar[]> {
    const key = `${params.symbol.toUpperCase()}|${params.startDate || ""}|${params.endDate || ""}|${params.outputSize || ""}`;
    const existing = inFlight.get(key);
    if (existing) return existing; // prevent simultaneous duplicate requests
    const p = requestTimeSeries(params).finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }

  async getLatestDailyBar(params: { symbol: string }): Promise<NormalizedDailyBar | null> {
    const bars = await this.getDailyBars({ symbol: params.symbol, outputSize: 5 });
    return bars.length ? bars[bars.length - 1] : null;
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    const start = Date.now();
    try {
      const bar = await this.getLatestDailyBar({ symbol: "SPY" });
      return {
        ok: !!bar,
        provider: this.providerName,
        latencyMs: Date.now() - start,
        message: bar ? `Latest SPY bar: ${bar.tradeDate}` : "No data returned",
      };
    } catch (e: any) {
      return {
        ok: false,
        provider: this.providerName,
        latencyMs: Date.now() - start,
        message: redactApiKey(String(e?.message || e)),
      };
    }
  }
}

export const twelveDataProvider = new TwelveDataDailyProvider();
