import { getRecentBars, getLastTick } from "./marketState";
import type { FuturesBar } from "../brokers/futures/types";

export interface FuturesOpportunity {
  symbol: string;
  setup: string;
  score: number;
  entry: number;
  stop: number;
  target: number;
  side: "buy" | "sell";
  timeframe: string;
  reason: string;
}

function computeRange(bars: FuturesBar[]): { high: number; low: number; avg: number } {
  let high = -Infinity;
  let low = Infinity;
  let sum = 0;
  for (const b of bars) {
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
    sum += b.close;
  }
  return { high, low, avg: sum / bars.length };
}

function computeTrend(bars: FuturesBar[]): number {
  if (bars.length < 10) return 0;
  const recent = bars.slice(-5);
  const older = bars.slice(-10, -5);
  const recentAvg = recent.reduce((s, b) => s + b.close, 0) / recent.length;
  const olderAvg = older.reduce((s, b) => s + b.close, 0) / older.length;
  return (recentAvg - olderAvg) / olderAvg;
}

export function scanFuturesOpportunities(symbol: string): FuturesOpportunity[] {
  const bars = getRecentBars(symbol, 120);
  if (bars.length < 30) return [];

  const tick = getLastTick(symbol);
  if (!tick) return [];

  const opportunities: FuturesOpportunity[] = [];
  const lastPrice = tick.price;
  const range = computeRange(bars.slice(-60));
  const rangeWidth = range.high - range.low;
  const trend = computeTrend(bars);

  if (lastPrice > range.high - rangeWidth * 0.05 && trend > 0.0005) {
    const score = Math.min(95, Math.round(50 + trend * 10000 + (rangeWidth > 2 ? 15 : 5)));
    opportunities.push({
      symbol,
      setup: "Range Breakout",
      score,
      entry: Math.round(range.high * 100) / 100,
      stop: Math.round((range.high - rangeWidth * 0.3) * 100) / 100,
      target: Math.round((range.high + rangeWidth * 0.5) * 100) / 100,
      side: "buy",
      timeframe: "1s",
      reason: `Price near ${range.high.toFixed(2)} resistance with upward trend`,
    });
  }

  if (lastPrice < range.low + rangeWidth * 0.05 && trend < -0.0005) {
    const score = Math.min(95, Math.round(50 + Math.abs(trend) * 10000 + (rangeWidth > 2 ? 15 : 5)));
    opportunities.push({
      symbol,
      setup: "Range Breakdown",
      score,
      entry: Math.round(range.low * 100) / 100,
      stop: Math.round((range.low + rangeWidth * 0.3) * 100) / 100,
      target: Math.round((range.low - rangeWidth * 0.5) * 100) / 100,
      side: "sell",
      timeframe: "1s",
      reason: `Price near ${range.low.toFixed(2)} support with downward trend`,
    });
  }

  if (trend > 0.001 && lastPrice > range.avg) {
    const score = Math.min(90, Math.round(45 + trend * 8000));
    opportunities.push({
      symbol,
      setup: "Momentum Long",
      score,
      entry: Math.round(lastPrice * 100) / 100,
      stop: Math.round((lastPrice - rangeWidth * 0.2) * 100) / 100,
      target: Math.round((lastPrice + rangeWidth * 0.4) * 100) / 100,
      side: "buy",
      timeframe: "1s",
      reason: `Strong upward momentum (${(trend * 100).toFixed(3)}%)`,
    });
  }

  if (trend < -0.001 && lastPrice < range.avg) {
    const score = Math.min(90, Math.round(45 + Math.abs(trend) * 8000));
    opportunities.push({
      symbol,
      setup: "Momentum Short",
      score,
      entry: Math.round(lastPrice * 100) / 100,
      stop: Math.round((lastPrice + rangeWidth * 0.2) * 100) / 100,
      target: Math.round((lastPrice - rangeWidth * 0.4) * 100) / 100,
      side: "sell",
      timeframe: "1s",
      reason: `Strong downward momentum (${(trend * 100).toFixed(3)}%)`,
    });
  }

  return opportunities.sort((a, b) => b.score - a.score);
}
