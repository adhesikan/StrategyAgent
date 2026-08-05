// AI Infrastructure Watch — Sprint 5.5C / Task #58
//
// Tracks the 8 core AI-infrastructure semiconductors and networking stocks.
// Data comes from stored daily bars (Twelve Data, zero credits) + news sentiment.
// No fabricated data — missing fields are explicitly null.

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
  /** Latest known close price */
  last: number | null;
  /** Daily change % */
  changePercent: number | null;
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

export async function buildAiInfraWatch(
  userId: string,
): Promise<AiInfraWatchResult | AiInfraWatchUnavailable> {
  try {
    // 1. Stored daily bars — zero credits, concurrent fetch
    const snapshots = await getReferenceSnapshotsBulk(
      userId,
      [...AI_INFRA_SYMBOLS],
      { feature: "ai-infra-watch", barLimit: 60 },
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
      if (!snap || snap.bars.length === 0) {
        return {
          symbol: sym,
          companyName: COMPANY_NAMES[sym] ?? sym,
          trend: "flat",
          trendLabel: "No data",
          sentiment: sentimentBySymbol.get(sym) ?? "neutral",
          technicalScore: 50,
          last: null,
          changePercent: null,
        };
      }

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
        sentiment: sentimentBySymbol.get(sym) ?? "neutral",
        technicalScore,
        last: last !== null ? Math.round(last * 100) / 100 : null,
        changePercent,
      };
    });

    return { status: "ok", tickers };
  } catch (err: any) {
    console.warn("[ai-infra-watch] build failed:", err?.message ?? err);
    return { status: "unavailable" };
  }
}
