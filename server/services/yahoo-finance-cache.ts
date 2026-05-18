/**
 * Yahoo Finance Daily Quote Cache
 *
 * Free, no-API-key source of daily prior-close + last regular-market price for
 * common US tickers. We use this ONLY as a reference anchor for simulated
 * (mock) data shown to trial users who don't have a broker connected, so that
 * "mock" prices on Opportunity Radar / Daily Ideas / Home snapshot are at
 * least in the right ballpark for the real stock.
 *
 * Important: whenever a broker IS connected, callers should bypass this cache
 * entirely and use live broker quotes. This file only exists to make the
 * trial experience look credible.
 *
 * Implementation:
 *   - Per-symbol fetch from Yahoo's public chart endpoint
 *     (`query1.finance.yahoo.com/v8/finance/chart/{SYM}?interval=1d&range=5d`).
 *     No API key required. Sends a browser-like User-Agent.
 *   - In-memory cache keyed by uppercase symbol, TTL ~24h.
 *   - Single-flight per symbol so concurrent calls share one network request.
 *   - All callers are wrapped in try/catch — if Yahoo is unreachable, callers
 *     fall back to the existing deterministic mock generators.
 */

export interface YahooQuote {
  symbol: string;
  regularMarketPrice: number;
  previousClose: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  fetchedAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 8000;
// Minimal UA — Yahoo's edge throttles full-browser UA strings from datacenter
// IP ranges much more aggressively than short opaque UAs.
const UA = "Mozilla/5.0";

const cache = new Map<string, YahooQuote>();
const inflight = new Map<string, Promise<YahooQuote | null>>();
let errLogCount = 0;

async function fetchYahoo(symbol: string): Promise<YahooQuote | null> {
  // Alternate between query1 and query2 — Yahoo's edge rate-limits per host.
  const host = Math.random() < 0.5 ? "query1" : "query2";
  const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=1d&range=5d`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== "number") return null;
    const prev =
      typeof meta.previousClose === "number"
        ? meta.previousClose
        : typeof meta.chartPreviousClose === "number"
          ? meta.chartPreviousClose
          : meta.regularMarketPrice;
    const last = meta.regularMarketPrice;
    return {
      symbol,
      regularMarketPrice: last,
      previousClose: prev,
      changePercent: prev > 0 ? ((last - prev) / prev) * 100 : 0,
      high: typeof meta.regularMarketDayHigh === "number" ? meta.regularMarketDayHigh : last * 1.01,
      low: typeof meta.regularMarketDayLow === "number" ? meta.regularMarketDayLow : last * 0.99,
      volume: typeof meta.regularMarketVolume === "number" ? meta.regularMarketVolume : 0,
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Stooq fallback — returns daily OHLCV CSV. Very reliable from datacenter
// IPs and requires no API key. We use this whenever Yahoo's edge throttles
// us (datacenter IPs hit Yahoo 429s aggressively).
//   CSV header: Symbol,Date,Time,Open,High,Low,Close,Volume
async function fetchStooq(symbol: string): Promise<YahooQuote | null> {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(
    symbol.toLowerCase(),
  )}.us&f=sd2t2ohlcv&h&e=csv`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/csv" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    const row = lines[1].split(",");
    if (row.length < 8) return null;
    const open = parseFloat(row[3]);
    const high = parseFloat(row[4]);
    const low = parseFloat(row[5]);
    const close = parseFloat(row[6]);
    const volume = parseInt(row[7], 10);
    if (!isFinite(close) || close <= 0) return null;
    // Stooq daily CSV only has today's bar — we approximate prevClose using
    // the open (well-correlated for stable daily refs). Good enough for
    // ballpark mock prices, which is the only use.
    const prev = isFinite(open) && open > 0 ? open : close;
    return {
      symbol: symbol.toUpperCase(),
      regularMarketPrice: close,
      previousClose: prev,
      changePercent: prev > 0 ? ((close - prev) / prev) * 100 : 0,
      high: isFinite(high) ? high : close * 1.01,
      low: isFinite(low) ? low : close * 0.99,
      volume: isFinite(volume) ? volume : 0,
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOne(symbol: string): Promise<YahooQuote | null> {
  // Try Yahoo first (more accurate metadata when reachable), then fall back
  // to Stooq (very reliable from datacenter IPs).
  const y = await fetchYahoo(symbol);
  if (y) return y;
  const s = await fetchStooq(symbol);
  if (s) return s;
  if (errLogCount++ < 8) {
    console.warn(`[yahoo-cache] ${symbol} unavailable from both Yahoo and Stooq`);
  }
  return null;
}

/** Get a cached daily quote for a symbol, or fetch if missing/stale. */
export async function getYahooQuote(symbol: string): Promise<YahooQuote | null> {
  const sym = symbol.toUpperCase();
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit;

  const existing = inflight.get(sym);
  if (existing) return existing;

  const p = fetchOne(sym).then((q) => {
    inflight.delete(sym);
    if (q) cache.set(sym, q);
    return q;
  });
  inflight.set(sym, p);
  return p;
}

/** Batched variant — best-effort, returns a map (missing symbols are absent). */
export async function getYahooQuotes(
  symbols: string[],
): Promise<Map<string, YahooQuote>> {
  const out = new Map<string, YahooQuote>();
  const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  await Promise.all(
    unique.map(async (s) => {
      const q = await getYahooQuote(s);
      if (q) out.set(s, q);
    }),
  );
  return out;
}

/**
 * Synchronous accessor — returns the cached price if we have one, otherwise
 * null. Use this from mock-data generators that can't await. The cache is
 * warmed lazily as queries come in (via {@link getYahooQuote}) and
 * proactively by {@link warmYahooCache}.
 */
export function getReferencePrice(symbol: string): number | null {
  const hit = cache.get(symbol.toUpperCase());
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > TTL_MS) return null;
  return hit.regularMarketPrice;
}

/** Sync accessor for the full cached daily quote (price + prev close + vol). */
export function getCachedYahooQuote(symbol: string): YahooQuote | null {
  const hit = cache.get(symbol.toUpperCase());
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > TTL_MS) return null;
  return hit;
}

/**
 * Pre-warm the cache for a set of common symbols. Sequentially (small batches
 * with a brief delay between them) to avoid Yahoo rate-limiting that hits us
 * when we fan out 30+ concurrent requests. Returns the number of symbols
 * successfully cached.
 */
export async function warmYahooCache(symbols: string[]): Promise<number> {
  const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  // Strictly serial with 500ms spacing — Yahoo's anonymous endpoint
  // aggressively 429s concurrent bursts. Total warm-up time for the default
  // 24-symbol universe is ~12s, which is fine since we run this once a day
  // in the background.
  for (const s of unique) {
    await getYahooQuote(s);
    await new Promise((r) => setTimeout(r, 500));
  }
  let n = 0;
  for (const s of unique) if (cache.has(s)) n++;
  return n;
}

/** Stable list of the most-shown tickers across the app's mock surfaces. */
export const DEFAULT_WARM_UNIVERSE = [
  "SPY", "QQQ", "DIA", "IWM",
  "AAPL", "MSFT", "NVDA", "AMD", "GOOGL", "META", "AMZN", "TSLA",
  "NFLX", "AVGO", "JPM", "XOM", "WMT", "COST", "JNJ", "MU",
  "INTC", "CRM", "DIS", "MCD",
];
