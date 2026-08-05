// Home Snapshot — server module providing real market data.
//
// Data sources (in priority order):
//   1. Connected broker (live quotes when user has a broker connection)
//   2. Twelve Data /quote (latest-day close; NOT streaming real-time)
//   3. Error state — no fabricated or hardcoded fallback values
//
// All simulated/demo/fallback constants have been removed. When data is
// unavailable, sections return explicit null/empty values with dataMode "error".

import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { fetchQuotesFromBroker } from "../broker-service";
import { getRealtimeQuoteForUser } from "../services/daily-market-data/realtime-quote";
import { getReferenceSnapshotsBulk } from "../services/daily-market-data/reference-snapshot";
import { classifyMarketRegime } from "../engine/regime";

interface SnapshotItem {
  symbol: string;
  name?: string;
  headline: string;
}

interface IndexQuote {
  symbol: string;
  name: string;
  last: number;
  changePercent: number;
}

interface VixQuote {
  last: number;
  changePercent: number;
}

interface SectorQuote {
  symbol: string;
  name: string;
  changePercent: number;
}

interface MoverQuote {
  symbol: string;
  last: number;
  changePercent: number;
}

interface NewsItem {
  symbol: string;
  label: "bullish" | "bearish" | "neutral";
  impact: "high" | "medium" | "low";
  buzz: number;
  whyItMatters: string;
  articleCount: number;
}

interface WatchlistAlert {
  symbol: string;
  message: string;
}

interface MarketRegimeSummary {
  regime: "TRENDING" | "CHOPPY" | "RISK_OFF";
  strength: number;
  description: string;
}

export interface HomeSnapshotResponse {
  marketTone: "bullish" | "mixed" | "defensive" | null;
  marketToneReason: string;
  indices: IndexQuote[];
  /** VIX quote — null when unavailable; never fabricated */
  vix: VixQuote | null;
  /** Top-3 sector ETFs by daily % change (leaders) + bottom-3 (laggards) */
  sectorLeadership: SectorQuote[];
  /** Market regime from EMA/price analysis — null when insufficient bar history */
  marketRegime: MarketRegimeSummary | null;
  topMovers: MoverQuote[];
  topNews: NewsItem[];
  /** Highest-buzz bullish story from news sentiment — null when no data */
  topGrowth: SnapshotItem | null;
  watchlistAlert: WatchlistAlert | null;
  /**
   * "live"    — real-time or broker quotes
   * "partial" — some symbols had data, others did not
   * "error"   — no usable market data available
   */
  dataMode: "live" | "partial" | "error";
  /**
   * Precise provenance of index / mover price data:
   *   "broker"      — connected broker (may be real-time or delayed per plan)
   *   "twelve_data" — Twelve Data latest-day close (NOT streaming real-time)
   *   "unavailable" — no live data source available
   */
  dataSource: "broker" | "twelve_data" | "unavailable";
  /** Source of topGrowth: "sentiment" = news-buzz leader; null = not available */
  growthSource: "sentiment" | null;
  asOf: string;
  disclaimer: string;
}

const DISCLAIMER =
  "Snapshot is AI-generated informational context — not investment advice.";

const INDEX_SYMBOLS = [
  { symbol: "SPY", name: "S&P 500" },
  { symbol: "QQQ", name: "Nasdaq 100" },
  { symbol: "IWM", name: "Russell 2000" },
];

const SECTOR_ETFS: Record<string, string> = {
  XLK: "Technology",
  XLE: "Energy",
  XLF: "Financials",
  XLV: "Health Care",
  XLC: "Comm Services",
  XLI: "Industrials",
  XLB: "Materials",
  XLU: "Utilities",
  XLRE: "Real Estate",
  XLP: "Consumer Staples",
  XLY: "Consumer Discret.",
};

const DEFAULT_MOVER_UNIVERSE = [
  "NVDA", "META", "AMD", "TSLA", "AAPL", "MSFT", "GOOGL", "AMZN", "PLTR", "CRWD",
  "AVGO", "NFLX", "SHOP", "SMCI", "COIN", "UBER", "ARM", "ORCL", "QCOM", "MU",
];

function deriveToneFromIndices(
  indices: IndexQuote[],
): { tone: "bullish" | "mixed" | "defensive" | null; reason: string } {
  const live = indices.filter((i) => i.last > 0);
  if (live.length === 0) return { tone: null, reason: "Market data unavailable." };
  const up = live.filter((i) => i.changePercent > 0).length;
  const avg = live.reduce((s, i) => s + i.changePercent, 0) / live.length;
  const parts = live
    .map((i) => `${i.symbol} ${i.changePercent >= 0 ? "+" : ""}${i.changePercent.toFixed(2)}%`)
    .join(" · ");
  if (up === live.length && avg > 0.4) {
    return { tone: "bullish", reason: `${parts}. Indices broadly higher — risk-on bias.` };
  }
  if (up === 0 && avg < -0.4) {
    return { tone: "defensive", reason: `${parts}. Indices broadly lower — defensive bias.` };
  }
  return { tone: "mixed", reason: `${parts}. Indices mixed — rotation under the surface.` };
}

/**
 * Build the home snapshot payload for a given userId.
 * Real data only — no hardcoded fallback values.
 * Missing sections are explicitly marked as null / empty / error.
 */
export async function buildHomeSnapshot(userId: string): Promise<HomeSnapshotResponse> {
  let dataMode: "live" | "partial" | "error" = "error";
  let dataSource: "broker" | "twelve_data" | "unavailable" = "unavailable";

  let indices: IndexQuote[] = [];
  let vix: VixQuote | null = null;
  let sectorLeadership: SectorQuote[] = [];
  let marketRegime: MarketRegimeSummary | null = null;
  let topMovers: MoverQuote[] = [];
  let watchlistSymbols: string[] = [];

  // Gather watchlist symbols for movers / alerts
  try {
    const lists = await storage.getWatchlists(userId);
    watchlistSymbols = Array.from(
      new Set(
        lists
          .flatMap((l: any) => (Array.isArray(l.symbols) ? l.symbols : []))
          .map((s: string) => String(s).toUpperCase()),
      ),
    ).slice(0, 25);
  } catch { /* ignore */ }

  // ── 1. Broker path (live quotes) ───────────────────────────────────────
  const connection = await storage.getBrokerConnectionWithToken(userId).catch(() => null);
  if (connection?.accessToken) {
    const indexSyms = INDEX_SYMBOLS.map((i) => i.symbol);
    const moverSyms = (watchlistSymbols.length > 0 ? watchlistSymbols : DEFAULT_MOVER_UNIVERSE).slice(0, 20);
    try {
      const allSyms = Array.from(new Set([...indexSyms, ...moverSyms]));
      const quotes = await fetchQuotesFromBroker(connection as any, allSyms);
      const byUpper = new Map<string, any>();
      for (const q of quotes) {
        if (q?.symbol) byUpper.set(String(q.symbol).toUpperCase(), q);
      }

      const built: IndexQuote[] = INDEX_SYMBOLS.map(({ symbol, name }) => {
        const q = byUpper.get(symbol);
        if (!q || !q.last) return { symbol, name, last: 0, changePercent: 0 };
        const changePct =
          typeof q.changePercent === "number"
            ? q.changePercent
            : q.change && q.last
            ? (q.change / (q.last - q.change)) * 100
            : 0;
        return { symbol, name, last: q.last, changePercent: Number(changePct.toFixed(2)) };
      });

      topMovers = moverSyms
        .map((sym) => {
          const q = byUpper.get(sym);
          if (!q || !q.last) return null;
          const changePct =
            typeof q.changePercent === "number"
              ? q.changePercent
              : q.change && q.last
              ? (q.change / (q.last - q.change)) * 100
              : 0;
          return { symbol: sym, last: q.last, changePercent: Number(changePct.toFixed(2)) };
        })
        .filter((m): m is MoverQuote => m !== null)
        .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
        .slice(0, 5);

      if (built.some((i) => i.last > 0) || topMovers.length > 0) {
        indices = built;
        dataMode = "live";
        dataSource = "broker";
      }
    } catch (e: any) {
      console.warn("[home-snapshot] broker quote fetch failed:", e?.message);
    }
  }

  // ── 2. Twelve Data path (latest-day close) ─────────────────────────────
  // Fetch: SPY, QQQ, IWM, VIX, and all 11 sector ETFs in parallel.
  // Each call is cached 30s; in-flight de-duplicated; rate-limited by credit manager.
  const needsTwelveData = !indices.some((i) => i.last > 0);

  const sectorSymbols = Object.keys(SECTOR_ETFS);
  const twelveDataBatch: string[] = needsTwelveData
    ? ["SPY", "QQQ", "IWM", "VIX", ...sectorSymbols]
    : ["VIX", ...sectorSymbols];

  // 6-second timeout for the entire Twelve Data batch
  const twelveResults = await Promise.race([
    Promise.allSettled(
      twelveDataBatch.map((sym) =>
        getRealtimeQuoteForUser(userId, sym, "home-snapshot").then((q) => ({ sym, q })),
      ),
    ),
    new Promise<PromiseSettledResult<{ sym: string; q: any }>[]>((resolve) =>
      setTimeout(
        () => resolve(twelveDataBatch.map((sym) => ({ status: "rejected" as const, reason: "timeout", sym }))),
        6000,
      ),
    ),
  ]);

  const twelveBySymbol = new Map<string, any>();
  for (const r of twelveResults) {
    if (r.status === "fulfilled") {
      const { sym, q } = r.value;
      if (q && q.last > 0) twelveBySymbol.set(sym, q);
    }
  }

  // Indices from Twelve Data (if broker didn't supply them)
  if (needsTwelveData && twelveBySymbol.size > 0) {
    const built: IndexQuote[] = INDEX_SYMBOLS.map(({ symbol, name }) => {
      const q = twelveBySymbol.get(symbol);
      if (!q) return { symbol, name, last: 0, changePercent: 0 };
      return {
        symbol,
        name,
        last: q.last,
        changePercent: Number(q.changePercent.toFixed(2)),
      };
    });
    if (built.some((i) => i.last > 0)) {
      indices = built;
      dataMode = "live";
      dataSource = "twelve_data";
    }
  }

  // VIX
  const vixQ = twelveBySymbol.get("VIX");
  if (vixQ) {
    vix = {
      last: Math.round(vixQ.last * 100) / 100,
      changePercent: Math.round(vixQ.changePercent * 100) / 100,
    };
  }

  // Sector leadership — sort by changePercent, return top 3 gainers + top 3 losers
  const sectorQuotes: SectorQuote[] = [];
  for (const sym of sectorSymbols) {
    const q = twelveBySymbol.get(sym);
    if (q && q.last > 0) {
      sectorQuotes.push({
        symbol: sym,
        name: SECTOR_ETFS[sym] ?? sym,
        changePercent: Math.round(q.changePercent * 100) / 100,
      });
    }
  }
  if (sectorQuotes.length > 0) {
    const sorted = [...sectorQuotes].sort((a, b) => b.changePercent - a.changePercent);
    const leaders = sorted.slice(0, 3);
    const laggards = sorted.slice(-3).reverse();
    // Deduplicate (possible when fewer than 6 sectors have data)
    const seen = new Set<string>();
    sectorLeadership = [...leaders, ...laggards].filter((s) => {
      if (seen.has(s.symbol)) return false;
      seen.add(s.symbol);
      return true;
    });
  }

  // ── 3. Market Regime from stored SPY bars (zero credits) ──────────────
  try {
    const snapMap = await Promise.race([
      getReferenceSnapshotsBulk(userId, ["SPY"], { feature: "market-regime", barLimit: 60 }),
      new Promise<Map<string, any>>((resolve) =>
        setTimeout(() => resolve(new Map()), 3000),
      ),
    ]);
    const spySnap = snapMap.get("SPY");
    if (spySnap && spySnap.bars.length >= 30) {
      const regime = classifyMarketRegime(
        spySnap.bars.map((b: any) => ({
          open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
        })),
      );
      marketRegime = {
        regime: regime.regime as "TRENDING" | "CHOPPY" | "RISK_OFF",
        strength: regime.strength,
        description: regime.description,
      };
    }
  } catch { /* regime is optional */ }

  // If we have partial data (some indices loaded, some didn't), mark as partial
  if (dataMode === "live" && indices.length > 0 && indices.some((i) => i.last === 0)) {
    dataMode = "partial";
  }

  // ── 4. News-derived growth / alerts ───────────────────────────────────
  let topGrowth: SnapshotItem | null = null;
  let growthSource: "sentiment" | null = null;
  let watchlistAlert: WatchlistAlert | null = null;
  let topNews: NewsItem[] = [];

  try {
    const trending = await storage.getTrendingNewsSentiment?.(30).catch(() => []);
    if (Array.isArray(trending) && trending.length > 0) {
      topNews = trending
        .slice(0, 6)
        .filter((s: any) => s.sentimentLabel && s.whyItMatters)
        .map((s: any) => ({
          symbol: s.symbol,
          label: (s.sentimentLabel ?? "neutral") as "bullish" | "bearish" | "neutral",
          impact: (s.impactLevel ?? "medium") as "high" | "medium" | "low",
          buzz: typeof s.buzzScore === "number" ? Number(s.buzzScore.toFixed(1)) : 0,
          whyItMatters: s.whyItMatters,
          articleCount: s.articleCount ?? 0,
        }))
        .slice(0, 4);

      const positives = trending.filter((s: any) => s.sentimentLabel === "bullish");
      const negatives = trending.filter((s: any) => s.sentimentLabel === "bearish");

      if (positives[0]) {
        topGrowth = {
          symbol: positives[0].symbol,
          headline:
            positives[0].whyItMatters ??
            `${positives[0].symbol} — bullish news flow this session.`,
        };
        growthSource = "sentiment";
      }

      if (watchlistSymbols.length > 0) {
        const onList = negatives.find((s: any) =>
          watchlistSymbols.includes(String(s.symbol).toUpperCase()),
        );
        if (onList) {
          watchlistAlert = {
            symbol: onList.symbol,
            message:
              onList.whyItMatters ?? `${onList.symbol} — bearish news flow worth reviewing.`,
          };
        }
      }
    }
  } catch { /* fall through — topGrowth stays null */ }

  const { tone, reason: marketToneReason } = deriveToneFromIndices(indices);

  return {
    marketTone: tone,
    marketToneReason,
    indices,
    vix,
    sectorLeadership,
    marketRegime,
    topMovers,
    topNews,
    topGrowth,
    watchlistAlert,
    dataMode,
    dataSource,
    growthSource,
    asOf: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  };
}

export function registerHomeSnapshotRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
) {
  app.get("/api/home/snapshot", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "unauthorized" });
      const payload = await buildHomeSnapshot(userId);
      res.json(payload);
    } catch (err) {
      console.error("[home-snapshot] error:", err);
      res.status(500).json({ error: "Failed to load snapshot" });
    }
  });
}
