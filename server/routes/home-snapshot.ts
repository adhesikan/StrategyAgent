import type { Express, RequestHandler } from "express";
import { storage } from "../storage";

interface SnapshotItem {
  symbol: string;
  name?: string;
  headline: string;
}

interface WatchlistAlert {
  symbol: string;
  message: string;
}

export interface HomeSnapshotResponse {
  marketTone: "bullish" | "mixed" | "defensive";
  marketToneReason: string;
  bestIncome: SnapshotItem;
  topGrowth: SnapshotItem;
  watchlistAlert: WatchlistAlert | null;
  asOf: string;
  disclaimer: string;
}

const DISCLAIMER =
  "Snapshot is software-generated informational context — not investment advice.";

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

function pickByDay<T>(arr: T[]): T {
  const dayIdx = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  return arr[dayIdx % arr.length];
}

function deriveTone(): { tone: "bullish" | "mixed" | "defensive"; reason: string } {
  const dayIdx = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  const tones: Array<{ tone: "bullish" | "mixed" | "defensive"; reason: string }> = [
    { tone: "bullish", reason: "Breadth firm, leaders extending — risk-on bias." },
    { tone: "mixed", reason: "Index strength but rotation under the surface." },
    { tone: "defensive", reason: "Defensives leading — stay selective on entries." },
  ];
  return tones[dayIdx % tones.length];
}

export function registerHomeSnapshotRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
) {
  app.get("/api/home/snapshot", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;

      // Try to derive top growth/income from existing sentiment snapshots when present
      let topGrowth: SnapshotItem | null = null;
      let bestIncome: SnapshotItem | null = null;
      let watchlistAlert: WatchlistAlert | null = null;

      try {
        const trending = await storage.getTrendingNewsSentiment?.(20).catch(() => []);
        if (Array.isArray(trending) && trending.length > 0) {
          const positives = trending.filter((s: any) => s.sentimentLabel === "bullish");
          const negatives = trending.filter((s: any) => s.sentimentLabel === "bearish");
          if (positives[0]) {
            topGrowth = {
              symbol: positives[0].symbol,
              headline:
                positives[0].whyItMatters ??
                `${positives[0].symbol} — bullish news flow this session.`,
            };
          }
          if (negatives[0] && userId) {
            watchlistAlert = {
              symbol: negatives[0].symbol,
              message:
                negatives[0].whyItMatters ??
                `${negatives[0].symbol} — bearish news flow worth reviewing.`,
            };
          }
        }
      } catch {
        // fall through to mock
      }

      const tone = deriveTone();
      const fallbackGrowth = pickByDay(FALLBACK_GROWTH);
      const fallbackIncome = pickByDay(FALLBACK_INCOME);

      const payload: HomeSnapshotResponse = {
        marketTone: tone.tone,
        marketToneReason: tone.reason,
        bestIncome: bestIncome ?? fallbackIncome,
        topGrowth: topGrowth ?? fallbackGrowth,
        watchlistAlert,
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
