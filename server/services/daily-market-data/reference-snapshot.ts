// Reference market snapshot — the ONLY sanctioned way for non-broker
// surfaces (Advanced Trade Builder, Opportunity Radar / Best Picks) to pull
// real market data instead of synthetic placeholders.
//
// Data sources, in order of preference:
//   1. Twelve Data /quote (real-time, 1 credit, 30s cache) — single-symbol
//      callers only; NEVER used for multi-symbol scans (7/min credit cap).
//   2. Stored Twelve Data daily bars (already ingested — zero credits).
//
// Licensing: every call goes through canAccessTwelveDataBackedAnalysis
// (env-first — prelaunch external users are denied). When the gate denies,
// callers MUST fall back to their existing educational/mock behavior; this
// module returns null and never leaks data past the gate.

import { canAccessTwelveDataBackedAnalysis } from "./access-control";
import {
  getHistoricalBars,
  checkFreshness,
  checkSessionFreshness,
  mostRecentExpectedTradingSession,
  type FreshnessStatus,
} from "../market-history-service";
import { ema, rsi, atr } from "./indicators";
import { getRealtimeQuoteForUser, type RealTimeQuote } from "./realtime-quote";
import type { NormalizedDailyBar } from "./types";

export type { FreshnessStatus };

export interface ReferenceTechnicals {
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  rsi14: number | null;
  atr14: number | null;
  high20: number | null;
  low20: number | null;
  avgVolume20: number | null;
  /** last bar volume / 20-day average volume */
  rvol: number | null;
  changePct5d: number | null;
}

export interface ReferenceSnapshot {
  symbol: string;
  /** Live Twelve Data quote when requested and available (single-symbol paths only). */
  realtime: RealTimeQuote | null;
  /** Ascending real daily OHLCV bars (Twelve Data, stored — zero credits). */
  bars: NormalizedDailyBar[];
  technicals: ReferenceTechnicals | null;
  /** Best-known last price: realtime last, else last stored close. */
  lastPrice: number | null;
  prevClose: number | null;
  /**
   * Data provenance — Sprint Defect AI-Infra-Price:
   * freshness and last bar date must travel with the price so callers can
   * distinguish "Latest daily close" from "Stale" / "Unavailable".
   */
  freshnessStatus: FreshnessStatus;
  /** Trade date of the most recent stored bar (YYYY-MM-DD), or null. */
  latestBarDate: string | null;
  /**
   * How the bars were obtained.
   *   "stored"           — from PostgreSQL (no provider request)
   *   "external_refresh" — fetched live from Twelve Data and persisted
   *   "stored_stale"     — stored bars exist but are stale; refresh unavailable/failed
   */
  sourceType: "stored" | "external_refresh" | "stored_stale" | "unavailable";
}

async function isAllowed(userId: string, feature: string): Promise<boolean> {
  try {
    const { authStorage } = await import("../../replit_integrations/auth/storage");
    const user = await authStorage.getUser(userId);
    return canAccessTwelveDataBackedAnalysis({
      user: user ? { id: user.id, email: user.email, role: user.role } : null,
      feature,
    }).allowed;
  } catch {
    return false;
  }
}

export function computeReferenceTechnicals(bars: NormalizedDailyBar[]): ReferenceTechnicals | null {
  if (bars.length < 5) return null;
  const closes = bars.map((b) => b.close);
  const last = bars[bars.length - 1];
  const last20 = bars.slice(-20);
  const avgVolume20 =
    bars.length >= 20 ? last20.reduce((a, b) => a + b.volume, 0) / last20.length : null;
  const prev5 = closes.length >= 6 ? closes[closes.length - 6] : null;
  return {
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    ema50: ema(closes, 50),
    rsi14: rsi(closes, 14),
    atr14: atr(bars, 14),
    high20: bars.length >= 20 ? Math.max(...last20.map((b) => b.high)) : null,
    low20: bars.length >= 20 ? Math.min(...last20.map((b) => b.low)) : null,
    avgVolume20,
    rvol: avgVolume20 && avgVolume20 > 0 ? last.volume / avgVolume20 : null,
    changePct5d: prev5 && prev5 > 0 ? ((closes[closes.length - 1] - prev5) / prev5) * 100 : null,
  };
}

/**
 * Single-symbol snapshot for the Advanced Trade Builder fallback path.
 * `realtime: true` spends at most 1 Twelve Data credit (cached 30s).
 * Returns null when the license gate denies or no real data exists.
 */
export async function getReferenceSnapshot(
  userId: string,
  rawSymbol: string,
  opts: { realtime?: boolean; feature?: string; barLimit?: number } = {},
): Promise<ReferenceSnapshot | null> {
  const symbol = rawSymbol.trim().toUpperCase();
  const feature = opts.feature ?? "reference_snapshot";
  if (!(await isAllowed(userId, feature))) return null;

  let realtime: RealTimeQuote | null = null;
  if (opts.realtime) {
    // getRealtimeQuoteForUser re-checks the gate — harmless double check.
    // Bounded wait: credit reservation can block up to 180s under minute-cap
    // contention; a user-facing generate request must not stall on it. On
    // timeout we proceed bars-only (the fetch continues and warms the cache).
    const timeoutMs = 4000;
    realtime = await Promise.race([
      getRealtimeQuoteForUser(userId, symbol, feature),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  }
  let bars: NormalizedDailyBar[] = [];
  let barSourceType: ReferenceSnapshot["sourceType"] = "unavailable";
  try {
    const result = await getHistoricalBars({
      symbol, outputSize: opts.barLimit ?? 60, purpose: "user", caller: "reference_snapshot",
    });
    bars = result.bars;
    barSourceType = result.sourceType as ReferenceSnapshot["sourceType"];
  } catch (err: any) {
    console.warn(`[ReferenceSnapshot] stored bars unavailable for ${symbol}:`, err?.message ?? err);
  }
  if (!realtime && bars.length === 0) return null;

  const lastBar = bars.length > 0 ? bars[bars.length - 1] : null;
  const prevBar = bars.length > 1 ? bars[bars.length - 2] : null;
  const latestBarDate = lastBar?.tradeDate ?? null;
  const freshnessStatus: FreshnessStatus =
    realtime ? "fresh" : checkFreshness(latestBarDate, "user");
  return {
    symbol,
    realtime,
    bars,
    technicals: computeReferenceTechnicals(bars),
    lastPrice: realtime?.last ?? lastBar?.close ?? null,
    prevClose: realtime?.previousClose ?? (realtime ? lastBar?.close ?? null : prevBar?.close ?? null),
    freshnessStatus,
    latestBarDate,
    sourceType: realtime ? "stored" : barSourceType,
  };
}

/**
 * Bulk stored-bars snapshots for multi-symbol scans (Radar / Best Picks).
 * NEVER touches the real-time /quote endpoint — zero provider credits.
 * One license-gate check for the whole batch; empty map when denied.
 *
 * `allowExternalRefresh` (default false):
 *   When true, stale or missing symbols are refreshed from Twelve Data via
 *   getHistoricalBars Phase 3. The provider's inFlight deduplication collapses
 *   concurrent requests for the same symbol to one network call, and
 *   persistValidatedBars ensures subsequent callers read fresh stored bars.
 *   Keep false for large scans (100+ symbols) to avoid credit exhaustion.
 *   Safe to set true for small fixed-symbol widgets (≤10 symbols).
 *
 * `sessionAware` (default false):
 *   When true (and allowExternalRefresh is also true), passes the current
 *   mostRecentExpectedTradingSession() date to getHistoricalBars as
 *   expectedSessionDate. This ensures Phase 2 only fires when the stored bar
 *   covers the latest completed U.S. trading session — not merely within
 *   the weekday-distance tolerance. Use for widgets that must show the
 *   canonical daily close (e.g. AI Infra Watch), never for broad scans.
 */
export async function getReferenceSnapshotsBulk(
  userId: string,
  symbols: string[],
  opts: {
    feature?: string;
    barLimit?: number;
    allowExternalRefresh?: boolean;
    /** Use session-aware (ET market-close aware) freshness instead of weekday distance. */
    sessionAware?: boolean;
  } = {},
): Promise<Map<string, ReferenceSnapshot>> {
  const out = new Map<string, ReferenceSnapshot>();
  if (symbols.length === 0) return out;
  if (!(await isAllowed(userId, opts.feature ?? "reference_snapshot_bulk"))) return out;

  const limit = opts.barLimit ?? 60;
  const allowRefresh = opts.allowExternalRefresh ?? false;
  // Compute the expected session date ONCE for the whole batch when sessionAware.
  // mostRecentExpectedTradingSession() is a pure function of the current time —
  // safe to call once and reuse across all symbols in the batch.
  const expectedSessionDate: string | undefined =
    opts.sessionAware && allowRefresh ? mostRecentExpectedTradingSession() : undefined;

  const CONCURRENCY = 8;
  const queue = symbols.map((s) => s.trim().toUpperCase());
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const symbol = queue.shift()!;
        try {
          const result = await getHistoricalBars({
            symbol,
            outputSize: limit,
            purpose: "scan",
            caller: "reference_snapshot_bulk",
            allowExternalRefresh: allowRefresh,
            expectedSessionDate,
          }).catch(() => ({
            bars: [] as NormalizedDailyBar[],
            freshnessStatus: "unavailable" as FreshnessStatus,
            latestBarDate: null as string | null,
            sourceType: "unavailable" as ReferenceSnapshot["sourceType"],
          }));
          const { bars } = result;
          if (bars.length === 0) continue;
          const lastBar = bars[bars.length - 1];
          const prevBar = bars.length > 1 ? bars[bars.length - 2] : null;
          const latestBarDate: string | null = result.latestBarDate ?? lastBar.tradeDate;

          // Session-aware mode: use checkSessionFreshness for defense-in-depth.
          // This ensures that even if getHistoricalBars somehow returned a Phase 2
          // result that doesn't meet the session requirement, we still gate it.
          const freshnessStatus: FreshnessStatus = opts.sessionAware
            ? checkSessionFreshness(latestBarDate)
            : (result.freshnessStatus ?? checkFreshness(latestBarDate, "scan"));

          const sourceType: ReferenceSnapshot["sourceType"] =
            (result.sourceType as ReferenceSnapshot["sourceType"]) ?? "stored";
          out.set(symbol, {
            symbol,
            realtime: null,
            bars,
            technicals: computeReferenceTechnicals(bars),
            lastPrice: lastBar.close,
            prevClose: prevBar?.close ?? null,
            freshnessStatus,
            latestBarDate,
            sourceType,
          });
        } catch (err: any) {
          console.warn(`[ReferenceSnapshot] bulk bars failed for ${symbol}:`, err?.message ?? err);
        }
      }
    }),
  );
  return out;
}
