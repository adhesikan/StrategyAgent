// Daily-close strategy scanner (no-broker fallback).
// Scans ONLY the symbols configured in market_data_symbols using stored
// Twelve Data daily bars — no live provider calls. Access must be gated by
// canAccessTwelveDataBackedAnalysis before calling scanDailyBars.

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { marketDataSymbols } from "@shared/schema";
import { computeDailyIndicators, type DailyIndicatorSet } from "./indicators";
import { getHistoricalBars } from "../market-history-service";

export type DailyScanResult = {
  ticker: string;
  name: string;
  score: number;
  winProb: number;
  reason: string;
  price: number | null;
  changePercent: number | null;
  rvol: number | null;
  asOf: string;
};

function pct(n: number | null | undefined, digits = 1): string {
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

type StrategyEval = { score: number; reason: string } | null;

/**
 * Evaluate one backend strategy against a daily indicator set. Returns null
 * when the pattern clearly does not apply. Purely deterministic — computed
 * from stored daily bars only (no intraday data, so intraday-specific
 * strategies approximate with daily equivalents).
 */
function evaluateStrategy(strategy: string, ind: DailyIndicatorSet, lastClose: number): StrategyEval {
  const trend = ind.trendScore ?? 50;
  const momentum = ind.momentumScore ?? 50;
  const volume = ind.volumeScore ?? 50;
  const risk = ind.riskScore ?? 50;
  const emaUp = ind.ema8 != null && ind.ema21 != null && ind.ema8 > ind.ema21;
  const above20 = ind.sma20 != null && lastClose > ind.sma20;
  const above50 = ind.sma50 != null && lastClose > ind.sma50;
  const rsi = ind.rsi14;
  const relVol = ind.relativeVolume;
  const atrPct = ind.atr14 != null && lastClose > 0 ? ind.atr14 / lastClose : null;
  const hv = ind.historicalVolatility20;
  const nearHigh = ind.distanceFrom52WeekHigh != null && ind.distanceFrom52WeekHigh > -0.15;

  switch (strategy) {
    case "VCP":
    case "VCP_MULTIDAY": {
      // Uptrend + contracting volatility near highs.
      if (!emaUp || !above50) return null;
      let s = 0.45 * trend + 0.3 * momentum + 0.25 * risk;
      if (nearHigh) s += 6;
      if (atrPct != null && atrPct < 0.035) s += 5;
      return {
        score: s,
        reason: `EMA8 > EMA21 · ${pct(ind.distanceFrom52WeekHigh)} from 52w high · ATR ${atrPct != null ? (atrPct * 100).toFixed(1) + "%" : "—"}`,
      };
    }
    case "HIGH_RVOL": {
      if (relVol == null || relVol < 1.2) return null;
      const s = 0.55 * volume + 0.25 * momentum + 0.2 * trend;
      return { score: s, reason: `RVOL ${relVol.toFixed(1)}× · ${pct(ind.return1d, 2)} day` };
    }
    case "GAP_AND_GO": {
      if (ind.return1d == null || ind.return1d < 0.015) return null;
      const s = 0.4 * momentum + 0.35 * volume + 0.25 * trend;
      return { score: s, reason: `${pct(ind.return1d, 2)} last session · RVOL ${relVol != null ? relVol.toFixed(1) + "×" : "—"}` };
    }
    case "CLASSIC_PULLBACK": {
      // Uptrend, short-term dip.
      if (!above50 || ind.return5d == null || ind.return5d > 0.01) return null;
      let s = 0.45 * trend + 0.3 * risk + 0.25 * momentum;
      if (rsi != null && rsi >= 35 && rsi <= 55) s += 6;
      return { score: s, reason: `Above 50MA · ${pct(ind.return5d)} 5d pullback · RSI ${rsi != null ? Math.round(rsi) : "—"}` };
    }
    case "TREND_CONTINUATION": {
      if (!emaUp || !above20 || !above50) return null;
      const s = 0.55 * trend + 0.3 * momentum + 0.15 * volume;
      return { score: s, reason: `EMAs stacked · ${pct(ind.return20d)} 20d · above 20/50MA` };
    }
    case "VWAP_RECLAIM": {
      // Daily approximation: reclaim of the 20-day average on volume.
      if (!above20 || ind.return1d == null || ind.return1d <= 0) return null;
      const s = 0.4 * trend + 0.35 * volume + 0.25 * momentum;
      return { score: s, reason: `Reclaimed 20MA · ${pct(ind.return1d, 2)} · RVOL ${relVol != null ? relVol.toFixed(1) + "×" : "—"}` };
    }
    case "VOLATILITY_SQUEEZE": {
      if (atrPct == null || hv == null) return null;
      if (atrPct > 0.045) return null;
      const s = 0.4 * risk + 0.35 * trend + 0.25 * momentum;
      return { score: s, reason: `ATR ${(atrPct * 100).toFixed(1)}% · HV20 ${(hv * 100).toFixed(0)}% · compression` };
    }
    case "ORB5":
    case "ORB15": {
      // Intraday pattern — approximate with strong recent momentum + volume.
      if (ind.return1d == null || ind.return1d <= 0) return null;
      const s = 0.4 * momentum + 0.35 * volume + 0.25 * trend;
      return { score: s, reason: `${pct(ind.return1d, 2)} last session · daily momentum proxy` };
    }
    default: {
      const s = 0.4 * trend + 0.3 * momentum + 0.3 * volume;
      return { score: s, reason: `Trend ${Math.round(trend)} · momentum ${Math.round(momentum)}` };
    }
  }
}

/** Scan all configured symbols' stored daily bars against one strategy. */
export async function scanDailyBars(strategy: string, limit = 10): Promise<{ results: DailyScanResult[]; asOf: string | null }> {
  const symbols = await db
    .select({ symbol: marketDataSymbols.symbol, companyName: marketDataSymbols.companyName })
    .from(marketDataSymbols)
    .where(and(eq(marketDataSymbols.enabled, true), eq(marketDataSymbols.internalAnalysisEnabled, true)));

  const results: DailyScanResult[] = [];
  let asOf: string | null = null;

  for (const sym of symbols) {
    const { bars } = await getHistoricalBars({
      symbol: sym.symbol, outputSize: 320, purpose: "scan", caller: "daily_scanner",
    }).catch(() => ({ bars: [] as Awaited<ReturnType<typeof getHistoricalBars>>["bars"] }));
    if (bars.length < 50) continue;
    const ind = computeDailyIndicators(bars);
    if (!ind) continue;
    const last = bars[bars.length - 1];
    const lastClose = Number(last.close);
    if (!asOf || last.tradeDate > asOf) asOf = last.tradeDate;

    const evald = evaluateStrategy(strategy, ind, lastClose);
    if (!evald) continue;

    const score = Math.round(Math.max(0, Math.min(100, evald.score)));
    if (score < 50) continue;
    const winProb = Math.round(Math.max(45, Math.min(82, 45 + (score - 50) * 0.7)));
    results.push({
      ticker: sym.symbol,
      name: sym.companyName || sym.symbol,
      score,
      winProb,
      reason: evald.reason,
      price: Number.isFinite(lastClose) ? lastClose : null,
      changePercent: ind.return1d != null ? +(ind.return1d * 100).toFixed(2) : null,
      rvol: ind.relativeVolume != null ? +ind.relativeVolume.toFixed(2) : null,
      asOf: last.tradeDate,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return { results: results.slice(0, limit), asOf };
}
