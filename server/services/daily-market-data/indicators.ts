// Internal, deterministic daily-indicator calculations (Phase 12).
// Computed only from stored daily bars — never from Twelve Data indicator
// endpoints. Versioned via CALCULATION_VERSION; nulls are returned explicitly
// when there is insufficient history.

import type { NormalizedDailyBar } from "./types";

export const CALCULATION_VERSION = 1;

export type DailyIndicatorSet = {
  symbol: string;
  tradeDate: string;
  sma10: number | null;
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  ema8: number | null;
  ema21: number | null;
  rsi14: number | null;
  atr14: number | null;
  averageVolume20: number | null;
  relativeVolume: number | null;
  return1d: number | null;
  return5d: number | null;
  return20d: number | null;
  historicalVolatility20: number | null;
  distanceFrom52WeekHigh: number | null;
  trendScore: number | null;
  momentumScore: number | null;
  volumeScore: number | null;
  riskScore: number | null;
  calculationVersion: number;
};

export function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function ema(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let e = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
  return e;
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function atr(bars: Array<{ high: number; low: number; close: number }>, period = 14): number | null {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}

export function historicalVolatility(closes: number[], period = 20): number | null {
  if (closes.length < period + 1) return null;
  const rets: number[] = [];
  const slice = closes.slice(-(period + 1));
  for (let i = 1; i < slice.length; i++) rets.push(Math.log(slice[i] / slice[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252); // annualized
}

function pctReturn(closes: number[], lookback: number): number | null {
  if (closes.length < lookback + 1) return null;
  const prev = closes[closes.length - 1 - lookback];
  if (prev <= 0) return null;
  return (closes[closes.length - 1] - prev) / prev;
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Compute the full indicator set for the LAST bar of the provided ascending
 * history. Provide up to ~260 bars for 52-week metrics; fewer yields nulls.
 */
export function computeDailyIndicators(bars: NormalizedDailyBar[]): DailyIndicatorSet | null {
  if (bars.length === 0) return null;
  const last = bars[bars.length - 1];
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);

  const sma10v = sma(closes, 10);
  const sma20v = sma(closes, 20);
  const sma50v = sma(closes, 50);
  const sma100v = sma(closes, 100);
  const sma200v = sma(closes, 200);
  const ema8v = ema(closes, 8);
  const ema21v = ema(closes, 21);
  const rsi14v = rsi(closes, 14);
  const atr14v = atr(bars, 14);
  const avgVol20 = volumes.length >= 20 ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const relVol = avgVol20 && avgVol20 > 0 ? last.volume / avgVol20 : null;
  const r1 = pctReturn(closes, 1);
  const r5 = pctReturn(closes, 5);
  const r20 = pctReturn(closes, 20);
  const hv20 = historicalVolatility(closes, 20);
  const high52 = bars.length >= 20 ? Math.max(...bars.slice(-252).map((b) => b.high)) : null;
  const dist52 = high52 && high52 > 0 ? (last.close - high52) / high52 : null;

  // Composite sub-scores (0-100), deterministic.
  let trendScore: number | null = null;
  if (sma20v !== null && sma50v !== null) {
    let s = 50;
    if (last.close > sma20v) s += 15;
    if (last.close > sma50v) s += 15;
    if (sma200v !== null && last.close > sma200v) s += 10;
    if (sma200v !== null && sma50v > sma200v) s += 10;
    if (last.close < sma20v) s -= 15;
    if (last.close < sma50v) s -= 15;
    trendScore = clampScore(s);
  }
  let momentumScore: number | null = null;
  if (rsi14v !== null && r20 !== null) {
    let s = 50 + (rsi14v - 50) * 0.6 + Math.max(-25, Math.min(25, r20 * 200));
    momentumScore = clampScore(s);
  }
  let volumeScore: number | null = null;
  if (relVol !== null) {
    volumeScore = clampScore(50 + (relVol - 1) * 40);
  }
  let riskScore: number | null = null; // higher = lower historical risk
  if (hv20 !== null && atr14v !== null && last.close > 0) {
    const atrPct = atr14v / last.close;
    riskScore = clampScore(100 - hv20 * 100 - atrPct * 400);
  }

  return {
    symbol: last.symbol,
    tradeDate: last.tradeDate,
    sma10: sma10v,
    sma20: sma20v,
    sma50: sma50v,
    sma100: sma100v,
    sma200: sma200v,
    ema8: ema8v,
    ema21: ema21v,
    rsi14: rsi14v,
    atr14: atr14v,
    averageVolume20: avgVol20 !== null ? Math.round(avgVol20) : null,
    relativeVolume: relVol,
    return1d: r1,
    return5d: r5,
    return20d: r20,
    historicalVolatility20: hv20,
    distanceFrom52WeekHigh: dist52,
    trendScore,
    momentumScore,
    volumeScore,
    riskScore,
    calculationVersion: CALCULATION_VERSION,
  };
}
