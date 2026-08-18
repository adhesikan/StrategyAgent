// AI Infrastructure Watch — Sprint 5.5C / Task #58
// Defect fix: AI-Infra-Price — stale bar gating and provenance fields.
//
// Tracks the 8 core AI-infrastructure semiconductors and networking stocks.
// Data comes from stored daily bars (Twelve Data, zero credits) + news sentiment.
//
// CANONICAL PRICE CONTRACT:
//   price  → AiInfraTicker.last (null when stale or unavailable)
//   asOf   → AiInfraTicker.asOf (YYYY-MM-DD of most recent stored bar)
//   source → AiInfraTicker.source ("stored_daily_bar" always for this path)
//   freshness → AiInfraTicker.freshness ("fresh" | "stale" | "unavailable")
//
// STALENESS RULE (permanent):
//   When freshnessStatus ≠ "fresh" → last = null (display "—")
//   Never display a stale close price as "Latest daily close".
//   Never fabricate a price.

import { getReferenceSnapshotsBulk } from "./daily-market-data/reference-snapshot";
import { storage } from "../storage";

export const AI_INFRA_SYMBOLS = [
  "NVDA", "AMD", "MU", "AVGO", "MRVL", "CRDO", "ANET", "TSM",
] as const;

export type AiInfraSymbol = (typeof AI_INFRA_SYMBOLS)[number];

const COMPANY_NAMES: Record<string, string> = {
  NVDA: "NVIDIA Corporation",
  AMD:  "Advanced Micro Devices",
  MU:   "Micron Technology",
  AVGO: "Broadcom Inc.",
  MRVL: "Marvell Technology",
  CRDO: "Credo Technology",
  ANET: "Arista Networks",
  TSM:  "Taiwan Semiconductor",
};

export interface AiInfraTicker {
  symbol: string;
  companyName: string;
  /** Price vs EMA21 direction */
  trend: "up" | "down" | "flat";
  /** Human-readable trend label */
  trendLabel: string;
  /** News sentiment for this ticker */
  sentiment: "bullish" | "bearish" | "neutral";
  /** 0–100 composite technical score (RSI + EMA alignment + RVOL) */
  technicalScore: number;
  /**
   * Latest known close price — null when data is stale or unavailable.
   * STALENESS RULE: null when freshnessStatus ≠ "fresh".
   * Never display a stale price — show "—" instead.
   */
  last: number | null;
  /** Daily change % — null when data is stale or unavailable. */
  changePercent: number | null;
  /**
   * Defect fix (AI-Infra-Price): provenance fields added.
   * Trade date of the most recent stored bar (YYYY-MM-DD), or null.
   */
  asOf: string | null;
  /** Data freshness: "fresh" | "stale" | "unavailable" */
  freshness: "fresh" | "stale" | "unavailable";
  /** Always "stored_daily_bar" for this data path. */
  source: "stored_daily_bar";
}

function deriveTrend(snap: {
  bars: { close: number }[];
  technicals: { ema21: number | null } | null;
}): { trend: "up" | "down" | "flat"; label: string } {
  const last = snap.bars.at(-1)?.close ?? null;
  const ema21 = snap.technicals?.ema21 ?? null;
  if (last === null || ema21 === null || ema21 === 0) {
    return { trend: "flat", label: "No EMA data" };
  }
  const pct = ((last - ema21) / ema21) * 100;
  if (pct > 1) return { trend: "up", label: `${pct.toFixed(1)}% above EMA21` };
  if (pct < -1) return { trend: "down", label: `${pct.toFixed(1)}% below EMA21` };
  return { trend: "flat", label: "Near EMA21" };
}

function computeTechnicalScore(snap: {
  bars: { close: number; volume: number }[];
  technicals: {
    rsi14: number | null;
    ema9: number | null;
    ema21: number | null;
    rvol: number | null;
  } | null;
}): number {
  const t = snap.technicals;
  if (!t) return 50;

  let score = 50;
  const last = snap.bars.at(-1)?.close ?? null;

  // RSI component (±20 pts)
  const rsi = t.rsi14;
  if (rsi != null) {
    if (rsi >= 55 && rsi <= 70) score += 20;       // strong momentum
    else if (rsi >= 45 && rsi < 55) score += 0;    // neutral
    else if (rsi > 70) score += 10;                // overbought — still positive but fading
    else if (rsi >= 30 && rsi < 45) score -= 10;   // weak
    else score -= 20;                              // oversold
  }

  // EMA alignment (±25 pts)
  if (last !== null && t.ema9 != null && t.ema21 != null) {
    const aboveEma9 = last > t.ema9;
    const aboveEma21 = last > t.ema21;
    const ema9AboveEma21 = t.ema9 > t.ema21;
    if (aboveEma9 && aboveEma21 && ema9AboveEma21) score += 25;  // bullish stack
    else if (aboveEma21) score += 10;                            // above medium-term
    else if (!aboveEma21 && !aboveEma9 && !ema9AboveEma21) score -= 20; // bearish stack
    else score -= 5;                                             // mixed
  }

  // RVOL component (±10 pts)
  const rvol = t.rvol;
  if (rvol != null) {
    if (rvol > 1.5) score += 10;
    else if (rvol > 1.0) score += 5;
    else if (rvol < 0.7) score -= 5;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export interface AiInfraWatchResult {
  status: "ok";
  tickers: AiInfraTicker[];
}

export interface AiInfraWatchUnavailable {
  status: "unavailable";
}

// ─────────────────────────────────────────────────────────────────────────────
// Observability — structured JSON events distinguishing data-path states.
//
// States:
//   STORED_FRESH           — stored bar was fresh; no provider request made
//   REFRESH_SUCCESS        — stored bar was stale/missing; Twelve Data refresh
//                            succeeded; result persisted for subsequent callers
//   STALE_FALLBACK_SUPPRESSED — stored bar was stale; refresh attempted but
//                            failed (or skipped by config); price suppressed (null)
//   NO_DATA                — no stored bars and no refresh result available
//
// Never log API keys or provider credentials.
// ─────────────────────────────────────────────────────────────────────────────

type AiInfraObsState =
  | "STORED_FRESH"
  | "REFRESH_SUCCESS"
  | "STALE_FALLBACK_SUPPRESSED"
  | "NO_DATA";

function emitAiInfraEvent(
  symbol: string,
  state: AiInfraObsState,
  asOf: string | null,
): void {
  process.stdout.write(
    JSON.stringify({
      event: "ai_infra_watch_symbol",
      symbol,
      state,
      asOf,
      ts: new Date().toISOString(),
    }) + "\n",
  );
}

/**
 * Build a fresh no-data ticker for a symbol when bars are unavailable.
 * Always uses `last: null` and `freshness: "unavailable"` — never fabricates.
 */
function buildUnavailableTicker(
  sym: string,
  sentiment: "bullish" | "bearish" | "neutral",
  asOf: string | null = null,
  freshness: "stale" | "unavailable" = "unavailable",
): AiInfraTicker {
  return {
    symbol: sym,
    companyName: COMPANY_NAMES[sym] ?? sym,
    trend: "flat",
    trendLabel: freshness === "stale" ? "Stale data" : "No data",
    sentiment,
    technicalScore: 50,
    last: null,    // NEVER fabricate — must be null when not fresh
    changePercent: null,
    asOf,
    freshness,
    source: "stored_daily_bar",
  };
}

export async function buildAiInfraWatch(
  userId: string,
): Promise<AiInfraWatchResult | AiInfraWatchUnavailable> {
  try {
    // 1. Stored daily bars — with external refresh enabled for this fixed 8-symbol widget.
    //
    //    Why allowExternalRefresh: true here:
    //    The AI Infrastructure Watch has exactly 8 symbols. Unlike the Opportunity Engine
    //    (100+ symbols, allowExternalRefresh: false to prevent request storms), 8 symbols
    //    is small enough that selective refresh is safe.
    //
    //    Rate-limit safety:
    //    - TwelveDataDailyProvider.inFlight Map deduplicates concurrent requests for the
    //      same symbol, so 100 simultaneous dashboard renders trigger at most 1 API call
    //      per stale symbol.
    //    - persistValidatedBars stores the result, so all subsequent callers hit Phase 2
    //      (stored fresh bars, zero credits) until the next staleness cycle.
    //    - Credit manager enforces 7/min and 750/day safety caps atomically.
    //    - Maximum credit cost per staleness event: 8 symbols × 1 credit = 8 credits.
    const snapshots = await getReferenceSnapshotsBulk(
      userId,
      [...AI_INFRA_SYMBOLS],
      { feature: "ai-infra-watch", barLimit: 60, allowExternalRefresh: true },
    );

    if (snapshots.size === 0) {
      // Access denied or no stored bars at all
      return { status: "unavailable" };
    }

    // 2. News sentiment — batch fetch from stored snapshots
    let sentimentBySymbol = new Map<string, "bullish" | "bearish" | "neutral">();
    try {
      const rows = await storage.getTickerSnapshotsForSymbols([...AI_INFRA_SYMBOLS]);
      for (const row of rows) {
        const label = (row as any).sentimentLabel as string | null;
        if (label === "bullish" || label === "bearish" || label === "neutral") {
          sentimentBySymbol.set(row.symbol.toUpperCase(), label);
        }
      }
    } catch {
      // Sentiment is optional — continue with neutral defaults
    }

    // 3. Build ticker data
    const tickers: AiInfraTicker[] = AI_INFRA_SYMBOLS.map((sym) => {
      const snap = snapshots.get(sym);
      const sentiment = sentimentBySymbol.get(sym) ?? "neutral";

      // CANONICAL PRICE CONTRACT:
      // Only use price when data is fresh. Stale or unavailable → null.
      // This prevents displaying old close prices with "Latest daily close" label.
      if (!snap || snap.bars.length === 0) {
        return buildUnavailableTicker(sym, sentiment, null, "unavailable");
      }

      const freshness = snap.freshnessStatus;
      const sourceType = snap.sourceType;

      // STALENESS GATE: never display a stale price as if it were current.
      // With allowExternalRefresh: true, freshnessStatus === "stale" means
      // the refresh was attempted but failed (or was disabled by env flags).
      if (freshness === "stale") {
        // sourceType === "stored_stale" confirms stale fallback was used
        emitAiInfraEvent(sym, "STALE_FALLBACK_SUPPRESSED", snap.latestBarDate);
        const { trend, label: trendLabel } = deriveTrend(snap);
        const technicalScore = computeTechnicalScore(snap);
        return {
          symbol: sym,
          companyName: COMPANY_NAMES[sym] ?? sym,
          trend,
          trendLabel,
          sentiment,
          technicalScore,
          last: null,         // null — never display stale price
          changePercent: null,
          asOf: snap.latestBarDate,
          freshness: "stale",
          source: "stored_daily_bar",
        };
      }

      // UNAVAILABLE gate
      if (freshness === "unavailable") {
        emitAiInfraEvent(sym, "NO_DATA", snap.latestBarDate);
        return buildUnavailableTicker(sym, sentiment, snap.latestBarDate, "unavailable");
      }

      // FRESH: price is safe to display.
      // Distinguish stored-fresh from just-refreshed for observability.
      const obsState: AiInfraObsState =
        sourceType === "external_refresh" ? "REFRESH_SUCCESS" : "STORED_FRESH";
      emitAiInfraEvent(sym, obsState, snap.latestBarDate);

      const { trend, label: trendLabel } = deriveTrend(snap);
      const technicalScore = computeTechnicalScore(snap);
      const last = snap.lastPrice;
      const prevClose = snap.prevClose;
      const changePercent =
        last !== null && prevClose !== null && prevClose > 0
          ? Math.round(((last - prevClose) / prevClose) * 10000) / 100
          : null;

      return {
        symbol: sym,
        companyName: COMPANY_NAMES[sym] ?? sym,
        trend,
        trendLabel,
        sentiment,
        technicalScore,
        last: last !== null ? Math.round(last * 100) / 100 : null,
        changePercent,
        asOf: snap.latestBarDate,
        freshness: "fresh",
        source: "stored_daily_bar",
      };
    });

    return { status: "ok", tickers };
  } catch (err: any) {
    console.warn("[ai-infra-watch] build failed:", err?.message ?? err);
    return { status: "unavailable" };
  }
}
