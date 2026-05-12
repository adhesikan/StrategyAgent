export interface Bar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return +(sum / period).toFixed(4);
}

function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(ema);
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

function ema(values: number[], period: number): number | null {
  const series = emaSeries(values, period);
  return series.length ? +series[series.length - 1].toFixed(4) : null;
}

function rsi(values: number[], period: number = 14): number | null {
  if (values.length < period + 1) return null;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return +(100 - 100 / (1 + rs)).toFixed(2);
}

function macd(values: number[]): { macd: number; signal: number; histogram: number } | null {
  if (values.length < 35) return null;
  const ema12 = emaSeries(values, 12);
  const ema26 = emaSeries(values, 26);
  if (!ema12.length || !ema26.length) return null;
  const offset = ema12.length - ema26.length;
  const macdLine: number[] = [];
  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[i + offset] - ema26[i]);
  }
  const signalSeries = emaSeries(macdLine, 9);
  if (!signalSeries.length) return null;
  const m = macdLine[macdLine.length - 1];
  const s = signalSeries[signalSeries.length - 1];
  return { macd: +m.toFixed(4), signal: +s.toFixed(4), histogram: +(m - s).toFixed(4) };
}

function bollinger(values: number[], period: number = 20, stdDev: number = 2): { upper: number; middle: number; lower: number } | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return {
    upper: +(mean + stdDev * sd).toFixed(4),
    middle: +mean.toFixed(4),
    lower: +(mean - stdDev * sd).toFixed(4),
  };
}

function atr(bars: Bar[], period: number = 14): number | null {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period;
  }
  return +atrVal.toFixed(4);
}

function vwap(bars: Bar[]): number | null {
  if (!bars.length) return null;
  let pvSum = 0;
  let vSum = 0;
  for (const b of bars) {
    const tp = (b.high + b.low + b.close) / 3;
    pvSum += tp * b.volume;
    vSum += b.volume;
  }
  if (vSum === 0) return null;
  return +(pvSum / vSum).toFixed(4);
}

// Restrict VWAP to bars within the latest trading session (same calendar date as
// the most recent bar). Falls back to null if dates can't be parsed.
function sessionVwap(bars: Bar[]): number | null {
  if (!bars.length) return null;
  const lastTs = bars[bars.length - 1].timestamp;
  if (!lastTs) return vwap(bars);
  const sessionDate = String(lastTs).slice(0, 10);
  const sessionBars = bars.filter((b) => String(b.timestamp).slice(0, 10) === sessionDate);
  return sessionBars.length ? vwap(sessionBars) : null;
}

function relativeVolume(bars: Bar[], period: number = 20): { current: number; avg: number; relative: number } | null {
  if (bars.length < period + 1) return null;
  const recent = bars.slice(-period - 1, -1);
  const avg = recent.reduce((a, b) => a + b.volume, 0) / period;
  const current = bars[bars.length - 1].volume;
  if (avg === 0) return { current, avg: 0, relative: 0 };
  return { current, avg: Math.round(avg), relative: +(current / avg).toFixed(2) };
}

function supportResistance(bars: Bar[], lookback: number = 60, swingWindow: number = 3): { support: number[]; resistance: number[] } {
  const window = bars.slice(-lookback);
  if (window.length < swingWindow * 2 + 1) return { support: [], resistance: [] };
  const supports: number[] = [];
  const resistances: number[] = [];
  for (let i = swingWindow; i < window.length - swingWindow; i++) {
    const left = window.slice(i - swingWindow, i);
    const right = window.slice(i + 1, i + 1 + swingWindow);
    const isSwingHigh = left.every((b) => b.high <= window[i].high) && right.every((b) => b.high <= window[i].high);
    const isSwingLow = left.every((b) => b.low >= window[i].low) && right.every((b) => b.low >= window[i].low);
    if (isSwingHigh) resistances.push(+window[i].high.toFixed(2));
    if (isSwingLow) supports.push(+window[i].low.toFixed(2));
  }
  const dedupe = (arr: number[]) =>
    Array.from(new Set(arr)).sort((a, b) => a - b).slice(0, 3);
  return { support: dedupe(supports), resistance: dedupe(resistances).reverse() };
}

export interface IndicatorBundle {
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema9: number | null;
  ema21: number | null;
  rsi14: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  bollinger: { upper: number; middle: number; lower: number } | null;
  atr14: number | null;
  vwapSession: number | null;
  volume: { current: number; avg: number; relative: number } | null;
  supportResistance: { support: number[]; resistance: number[] };
  trend: "up" | "down" | "sideways" | "unknown";
}

export function computeIndicators(bars: Bar[], intradayBars?: Bar[]): IndicatorBundle {
  const closes = bars.map((b) => b.close);
  const sma20v = sma(closes, 20);
  const sma50v = sma(closes, 50);
  const sma200v = sma(closes, 200);
  const last = closes[closes.length - 1];

  let trend: IndicatorBundle["trend"] = "unknown";
  if (sma20v != null && sma50v != null) {
    if (last > sma20v && sma20v > sma50v) trend = "up";
    else if (last < sma20v && sma20v < sma50v) trend = "down";
    else trend = "sideways";
  }

  return {
    sma20: sma20v,
    sma50: sma50v,
    sma200: sma200v,
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    bollinger: bollinger(closes, 20, 2),
    atr14: atr(bars, 14),
    vwapSession: intradayBars && intradayBars.length ? sessionVwap(intradayBars) : null,
    volume: relativeVolume(bars, 20),
    supportResistance: supportResistance(bars, 60, 3),
    trend,
  };
}
