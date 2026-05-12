import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";
import {
  refreshSentimentForSymbols,
  isStockNewsConfigured,
  isOpenAiConfigured,
  fetchTrendingNews,
  isSnapshotFresh,
  snapshotRowToAgg,
} from "../services/news";
import { analyzeArticle } from "../services/news/openAiSentimentService";
import { dedupeArticles } from "../services/news/newsDedupService";
import { fetchLatestNews } from "../services/news/stockNewsService";

const symbolParam = z.object({ symbol: z.string().min(1).max(10) });
const refreshBody = z.object({
  symbols: z.array(z.string().min(1)).min(1).max(50),
  force: z.boolean().optional(),
});

const COMPLIANCE_FOOTER =
  "News sentiment is software-generated informational analysis based on public articles. It is not investment advice.";

export function registerNewsSentimentRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  isAdmin: RequestHandler,
) {
  // Per-symbol sentiment with article context. Reject the literal
  // "watchlist" so the dynamic route doesn't shadow /api/sentiment/watchlist.
  app.get("/api/sentiment/:symbol", isAuthenticated, async (req, res, next) => {
    try {
      if ((req.params.symbol ?? "").toLowerCase() === "watchlist") {
        return next();
      }
      const parsed = symbolParam.safeParse(req.params);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid symbol" });
      }
      const symbol = parsed.data.symbol.toUpperCase();
      const existing = await storage.getTickerSnapshot(symbol);
      let snapshot = existing;
      if (!snapshot || !isSnapshotFresh(snapshot)) {
        const refreshed = await refreshSentimentForSymbols([symbol], { force: true });
        snapshot = await storage.getTickerSnapshot(symbol);
        if (!snapshot && refreshed.snapshots[0]) {
          // Fallback to in-memory aggregate if persist failed
          const agg = refreshed.snapshots[0];
          return res.json({
            symbol,
            snapshot: agg,
            articles: [],
            stale: false,
            sources: refreshed.source,
            disclaimer: COMPLIANCE_FOOTER,
          });
        }
      }

      const articles = await storage.getRecentNewsSentimentForSymbol(symbol, 10);
      res.json({
        symbol,
        snapshot: snapshot ? snapshotRowToAgg(snapshot) : null,
        articles: articles.map((a) => ({
          id: a.id,
          headline: a.headline,
          source: a.source,
          url: a.url,
          publishedAt: a.publishedAt,
          summary: a.aiSummary ?? a.rawSummary,
          whyItMatters: a.whyItMatters,
          sentimentLabel: a.sentimentLabel,
          sentimentScore: a.sentimentScore,
          impactLevel: a.impactLevel,
          bullishDrivers: a.bullishDrivers ?? [],
          bearishDrivers: a.bearishDrivers ?? [],
          riskWarnings: a.riskWarnings ?? [],
        })),
        stale: snapshot ? !isSnapshotFresh(snapshot) : false,
        sources: {
          news: isStockNewsConfigured() ? "live" : "mock",
          sentiment: isOpenAiConfigured() ? "openai" : "rule_based",
        },
        disclaimer: COMPLIANCE_FOOTER,
      });
    } catch (err) {
      console.error("[GET /api/sentiment/:symbol]", err);
      res.status(500).json({ error: "Failed to load sentiment" });
    }
  });

  // Watchlist sentiment for the authenticated user.
  // If the user has no saved watchlist symbols, fall back to a curated
  // set of popular, highly-traded names so the panel always shows useful
  // sentiment context. The response flags the source so the UI can label
  // it as a fallback.
  app.get("/api/sentiment/watchlist", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const watchlists = await storage.getWatchlists(userId);
      const userSymbols = Array.from(
        new Set(
          watchlists
            .flatMap((w) => (w.symbols ?? []) as string[])
            .map((s) => s.toUpperCase())
            .filter((s) => s.length > 0),
        ),
      ).slice(0, 25);

      const POPULAR_FALLBACK = [
        "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN",
        "META", "TSLA", "AMD", "SPY", "QQQ",
      ];
      const usingFallback = userSymbols.length === 0;
      const symbols = usingFallback ? POPULAR_FALLBACK : userSymbols;

      const result = await refreshSentimentForSymbols(symbols);
      res.json({
        symbols,
        snapshots: result.snapshots,
        sources: result.source,
        source: usingFallback ? "popular_fallback" : "user_watchlist",
        disclaimer: COMPLIANCE_FOOTER,
      });
    } catch (err) {
      console.error("[GET /api/sentiment/watchlist]", err);
      res.status(500).json({ error: "Failed to load watchlist sentiment" });
    }
  });

  // Manual refresh — admin only, capped at 50 symbols
  app.post("/api/admin/run-sentiment-refresh", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const parsed = refreshBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      }
      const result = await refreshSentimentForSymbols(parsed.data.symbols, { force: parsed.data.force });
      res.json({
        ok: true,
        analyzed: result.analyzed,
        cached: result.cached,
        snapshots: result.snapshots,
        sources: result.source,
        disclaimer: COMPLIANCE_FOOTER,
      });
    } catch (err) {
      console.error("[POST /api/admin/run-sentiment-refresh]", err);
      res.status(500).json({ error: "Refresh failed" });
    }
  });

  // Trending news with sentiment context
  app.get("/api/news/trending", isAuthenticated, async (req, res) => {
    try {
      const limit = Math.min(50, Math.max(5, Number(req.query.limit) || 25));
      const articles = await fetchTrendingNews(limit);
      const deduped = dedupeArticles(articles);
      const top = deduped.slice(0, limit);
      const analyzed = await Promise.all(
        top.map(async (a) => {
          const result = await analyzeArticle(a);
          return {
            headline: a.headline,
            summary: result.summary,
            source: a.source,
            url: a.url,
            publishedAt: a.publishedAt,
            symbols: a.symbols,
            sentimentLabel: result.sentimentLabel,
            sentimentScore: result.sentimentScore,
            impactLevel: result.impactLevel,
            whyItMatters: result.whyItMatters,
          };
        }),
      );
      res.json({
        articles: analyzed,
        sources: {
          news: isStockNewsConfigured() ? "live" : "mock",
          sentiment: isOpenAiConfigured() ? "openai" : "rule_based",
        },
        disclaimer: COMPLIANCE_FOOTER,
      });
    } catch (err) {
      console.error("[GET /api/news/trending]", err);
      res.status(500).json({ error: "Failed to load trending news" });
    }
  });
}

// Re-export for compatibility
export { fetchLatestNews };
