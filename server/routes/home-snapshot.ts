import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { fetchQuotesFromBroker } from "../broker-service";

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

export interface HomeSnapshotResponse {
  marketTone: "bullish" | "mixed" | "defensive";
  marketToneReason: string;
  indices: IndexQuote[];
  topMovers: MoverQuote[];
  topNews: NewsItem[];
  bestIncome: SnapshotItem;
  topGrowth: SnapshotItem;
  watchlistAlert: WatchlistAlert | null;
  dataMode: "live" | "simulated";
  asOf: string;
  disclaimer: string;
}

const DISCLAIMER =
  "Snapshot is software-generated informational context — not investment advice.";

const FALLBACK_INDICES: IndexQuote[] = [
  { symbol: "SPY", name: "S&P 500", last: 0, changePercent: 0 },
  { symbol: "QQQ", name: "Nasdaq 100", last: 0, changePercent: 0 },
  { symbol: "IWM", name: "Russell 2000", last: 0, changePercent: 0 },
];

const FALLBACK_GROWTH: SnapshotItem[] = [
  { symbol: "NVDA", name: "NVIDIA", headline: "AI infrastructure spend remains a multi-quarter tailwind." },
  { symbol: "MSFT", name: "Microsoft", headline: "Cloud + Copilot expansion supports continued earnings growth." },
  { symbol: "AAPL", name: "Apple", headline: "Services revenue mix continues to widen margins." },
  { symbol: "AMZN", name: "Amazon", headline: "AWS reacceleration plus retail efficiency gains in focus." },
];

const FALLBACK_INCOME: SnapshotItem[] = [
  { symbol: "SPY", name: "S&P 500 ETF", headline: "Index covered calls — high IV rank, defined risk." },
  { symbol: "QQQ", name: "Nasdaq 100 ETF", headline: "Cash-secured puts at support — collect premium." },
  { symbol: "T", name: "AT&T", headline: "Dividend + monthly call write candidate." },
  { symbol: "XLE", name: "Energy Select Sector", headline: "Energy IV elevated — premium-selling environment." },
];

const DEFAULT_MOVER_UNIVERSE = [
  "NVDA", "META", "AMD", "TSLA", "AAPL", "MSFT", "GOOGL", "AMZN", "PLTR", "CRWD",
  "AVGO", "NFLX", "SHOP", "SMCI", "COIN", "UBER", "ARM", "ORCL", "QCOM", "MU",
];

function pickByDay<T>(arr: T[]): T {
  const dayIdx = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  return arr[dayIdx % arr.length];
}

function deriveToneFromIndices(indices: IndexQuote[]): { tone: "bullish" | "mixed" | "defensive"; reason: string } {
  const live = indices.filter((i) => i.last > 0);
  if (live.length === 0) {
    const dayIdx = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
    const tones: Array<{ tone: "bullish" | "mixed" | "defensive"; reason: string }> = [
      { tone: "bullish", reason: "Breadth firm, leaders extending — risk-on bias." },
      { tone: "mixed", reason: "Index strength but rotation under the surface." },
      { tone: "defensive", reason: "Defensives leading — stay selective on entries." },
    ];
    return tones[dayIdx % tones.length];
  }
  const up = live.filter((i) => i.changePercent > 0).length;
  const avg = live.reduce((s, i) => s + i.changePercent, 0) / live.length;
  const parts = live.map((i) => `${i.symbol} ${i.changePercent >= 0 ? "+" : ""}${i.changePercent.toFixed(2)}%`).join(" · ");
  if (up === live.length && avg > 0.4) {
    return { tone: "bullish", reason: `${parts}. Indices broadly higher — risk-on bias.` };
  }
  if (up === 0 && avg < -0.4) {
    return { tone: "defensive", reason: `${parts}. Indices broadly lower — defensive bias.` };
  }
  return { tone: "mixed", reason: `${parts}. Indices mixed — rotation under the surface.` };
}

export function registerHomeSnapshotRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
) {
  app.get("/api/home/snapshot", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      let dataMode: "live" | "simulated" = "simulated";

      // 1) Indices + movers via broker quotes when connected
      let indices: IndexQuote[] = FALLBACK_INDICES;
      let topMovers: MoverQuote[] = [];
      let watchlistSymbols: string[] = [];

      if (userId) {
        try {
          const lists = await storage.getWatchlists(userId);
          watchlistSymbols = Array.from(
            new Set(
              lists.flatMap((l: any) => (Array.isArray(l.symbols) ? l.symbols : [])).map((s: string) => String(s).toUpperCase()),
            ),
          ).slice(0, 25);
        } catch {
          // ignore
        }

        const connection = await storage.getBrokerConnectionWithToken(userId).catch(() => null);
        if (connection?.accessToken) {
          const indexSymbols = ["SPY", "QQQ", "IWM"];
          const moverSymbols = (watchlistSymbols.length > 0 ? watchlistSymbols : DEFAULT_MOVER_UNIVERSE).slice(0, 20);
          try {
            const allSymbols = Array.from(new Set([...indexSymbols, ...moverSymbols]));
            const quotes = await fetchQuotesFromBroker(connection as any, allSymbols);
            const byUpper = new Map<string, any>();
            for (const q of quotes) {
              if (q?.symbol) byUpper.set(String(q.symbol).toUpperCase(), q);
            }
            indices = indexSymbols.map((sym) => {
              const q = byUpper.get(sym);
              const name = sym === "SPY" ? "S&P 500" : sym === "QQQ" ? "Nasdaq 100" : "Russell 2000";
              if (!q || !q.last) return { symbol: sym, name, last: 0, changePercent: 0 };
              const changePct = typeof q.changePercent === "number"
                ? q.changePercent
                : q.change && q.last
                ? (q.change / (q.last - q.change)) * 100
                : 0;
              return { symbol: sym, name, last: q.last, changePercent: Number(changePct.toFixed(2)) };
            });
            topMovers = moverSymbols
              .map((sym) => {
                const q = byUpper.get(sym);
                if (!q || !q.last) return null;
                const changePct = typeof q.changePercent === "number"
                  ? q.changePercent
                  : q.change && q.last
                  ? (q.change / (q.last - q.change)) * 100
                  : 0;
                return { symbol: sym, last: q.last, changePercent: Number(changePct.toFixed(2)) };
              })
              .filter((m): m is MoverQuote => m !== null)
              .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
              .slice(0, 5);
            if (topMovers.length > 0 || indices.some((i) => i.last > 0)) {
              dataMode = "live";
            }
          } catch (e: any) {
            console.warn("[home-snapshot] broker quote fetch failed:", e?.message);
          }
        }
      }

      // 2) News-derived growth/income/alerts
      let topGrowth: SnapshotItem | null = null;
      let bestIncome: SnapshotItem | null = null;
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
              headline: positives[0].whyItMatters ?? `${positives[0].symbol} — bullish news flow this session.`,
            };
          }
          // Watchlist alert: prefer a negative on the user's watchlist
          if (userId && watchlistSymbols.length > 0) {
            const onList = negatives.find((s: any) => watchlistSymbols.includes(String(s.symbol).toUpperCase()));
            if (onList) {
              watchlistAlert = {
                symbol: onList.symbol,
                message: onList.whyItMatters ?? `${onList.symbol} — bearish news flow worth reviewing.`,
              };
            }
          }
          if (!watchlistAlert && negatives[0] && userId) {
            watchlistAlert = {
              symbol: negatives[0].symbol,
              message: negatives[0].whyItMatters ?? `${negatives[0].symbol} — bearish news flow worth reviewing.`,
            };
          }
        }
      } catch {
        // fall through to mock
      }

      const tone = deriveToneFromIndices(indices);
      const fallbackGrowth = pickByDay(FALLBACK_GROWTH);
      const fallbackIncome = pickByDay(FALLBACK_INCOME);

      const payload: HomeSnapshotResponse = {
        marketTone: tone.tone,
        marketToneReason: tone.reason,
        indices,
        topMovers,
        topNews,
        bestIncome: bestIncome ?? fallbackIncome,
        topGrowth: topGrowth ?? fallbackGrowth,
        watchlistAlert,
        dataMode,
        asOf: new Date().toISOString(),
        disclaimer: DISCLAIMER,
      };

      res.json(payload);
    } catch (err) {
      console.error("[home-snapshot] error:", err);
      res.status(500).json({ error: "Failed to load snapshot" });
    }
  });
}
