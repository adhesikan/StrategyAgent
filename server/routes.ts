import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import { storage } from "./storage";
import { insertAlertSchema, insertAlertRuleSchema, insertWatchlistSchema, insertAutomationSettingsSchema, scannerFilters, UserRole, RuleConditionType, PatternStage, StrategyType, userSettingsUpdateSchema } from "@shared/schema";
import { sendEntrySignal, sendExitSignal, createAutomationLogEntry, type EntrySignal, type ExitSignal } from "./algopilotx";
import { getStrategyList, classifyQuote, StrategyId, PullbackStage, runAllPluginScans, STRATEGY_PRESETS, getAllStrategyIds, StrategyIdType } from "./strategies";
import { classifyMarketRegime, getRegimeAdjustment } from "./engine/regime";
import { aggregateConfluence, rankByConfluence, filterByMinMatches, ConfluenceResult } from "./engine/confluence";
import { CandleData } from "./engine/indicators";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated, isAuthenticatedOrPartner, authStorage, verifyJwt } from "./replit_integrations/auth";
import { 
  fetchQuotesFromBroker, 
  quotesToScanResults, 
  runMultidayScan,
  verifyBullishTrend,
  fetchHistoryFromBroker,
  fetchHistoryWithDateRange,
  processChartData,
  DEFAULT_SCAN_SYMBOLS,
  DOW_30,
  NASDAQ_100,
  SP_500,
  ALL_MAJOR_INDICES,
  UNIVERSE_OPTIONS,
  getUniverseSymbols,
  LARGE_CAP_UNIVERSE
} from "./broker-service";
import { getTradeStationBaseUrl } from "./broker/providers/tradestation";
import { isPromoActive, PROMO_CONFIG, PROMO_CODE } from "@shared/promo";
import { 
  ingestOpportunitiesFromScan, 
  resolveOpportunities, 
  updateOpportunityPrices, 
  getOpportunities, 
  getOpportunity, 
  getOpportunitySummary,
  exportOpportunitiesCSV
} from "./opportunity-service";
import { runManualScheduledScan } from "./scheduled-scan-service";
import { fetchNews, checkRateLimit, isNewsConfigured } from "./news-service";
import { registerPlatformRoutes } from "./routes/platform";
import { registerFuturesRoutes } from "./routes/futures";
import { startFuturesWorker, switchToTradeStationFeed, getFeedInfo } from "./trading/futures/futuresWorker";

const isAdmin: RequestHandler = async (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const user = await authStorage.getUser(req.session.userId);
  if (!user || user.role !== UserRole.ADMIN) {
    return res.status(403).json({ message: "Forbidden: Admin access required" });
  }
  next();
};

// Map user-selected timeframe to broker API timeframe
// Returns the appropriate timeframe for broker API calls
function getBrokerTimeframe(userTimeframe: string): string {
  const tf = userTimeframe.toLowerCase();
  // Intraday timeframes - use the specific interval
  if (tf === "1m" || tf === "5m" || tf === "15m" || tf === "30m" || tf === "1h") {
    return tf;
  }
  // Daily timeframes - use 3 months of daily data
  return "3M";
}


export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/health", (_req, res) => {
    res.json({ ok: true, app: "vcptrader" });
  });

  const MAINTENANCE_ALLOWED_PATHS = [
    "/health",
    "/login",
    "/register",
    "/status",
    "/pricing",
    "/terms",
    "/legal",
    "/api/auth",
    "/api/promo",
    "/assets",
    "/@vite",
    "/@fs",
    "/src",
    "/node_modules",
  ];

  app.use((req, res, next) => {
    if (process.env.MAINTENANCE_MODE !== "true") return next();

    const path = req.path.toLowerCase();
    if (
      path === "/" ||
      path === "/favicon.ico" ||
      MAINTENANCE_ALLOWED_PATHS.some((p) => path.startsWith(p))
    ) {
      return next();
    }

    const accept = req.headers.accept || "";
    if (accept.includes("application/json")) {
      return res.status(503).json({
        error: "Service temporarily unavailable",
        message: "VCP Trader is undergoing scheduled maintenance. Please check back shortly.",
        maintenance: true,
      });
    }

    return res.status(503).send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VCP Trader - Maintenance</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#e5e5e5;min-height:100vh;display:flex;align-items:center;justify-content:center}
.wrap{text-align:center;padding:2rem;max-width:480px}
h1{font-size:1.5rem;margin-bottom:.75rem;color:#fff}
p{color:#a3a3a3;line-height:1.6;margin-bottom:1rem}
.badge{display:inline-block;padding:.25rem .75rem;border-radius:9999px;font-size:.75rem;font-weight:600;background:#1e3a5f;color:#60a5fa;margin-bottom:1.5rem}
</style></head>
<body><div class="wrap">
<div class="badge">Scheduled Maintenance</div>
<h1>VCP Trader is temporarily offline</h1>
<p>We're performing upgrades to improve your trading experience. This usually takes just a few minutes.</p>
<p style="font-size:.875rem">If you need immediate help, contact <a href="mailto:support@sunfishtech.com" style="color:#60a5fa">support@sunfishtech.com</a></p>
</div></body></html>`);
  });

  await setupAuth(app);
  app.use(verifyJwt);
  registerAuthRoutes(app);
  registerPlatformRoutes(app);
  registerFuturesRoutes(app);

  startFuturesWorker().then(async () => {
    try {
      const feedInfo = getFeedInfo();
      if (feedInfo.feedType === "tradestation") return;

      const activeConn = await storage.getAnyActiveBrokerConnection();
      if (activeConn && activeConn.provider === "tradestation" && activeConn.isConnected) {
        const connWithToken = await storage.getBrokerConnectionWithToken(activeConn.userId);
        if (connWithToken?.accessToken) {
          console.log("[FuturesWorker] TradeStation broker detected at startup, auto-switching futures feed...");
          await switchToTradeStationFeed({
            accessToken: connWithToken.accessToken,
            simMode: (connWithToken as any).simMode === true,
            accountId: undefined,
            userId: activeConn.userId,
          });
        }
      }
    } catch (err) {
      console.warn("[FuturesWorker] Startup auto-detect TradeStation failed (non-fatal):", err);
    }
  }).catch((err) => {
    console.error("[FuturesWorker] Failed to start:", err);
  });

  app.get("/api/promo/status", (req, res) => {
    const active = isPromoActive();
    res.json({
      active,
      code: active ? PROMO_CODE : null,
      config: active ? PROMO_CONFIG : null,
    });
  });

  app.get("/api/strategies", (req, res) => {
    const strategies = getStrategyList().map(s => ({
      ...s,
      stages: s.id === StrategyId.VCP 
        ? [PatternStage.FORMING, PatternStage.READY, PatternStage.BREAKOUT]
        : [PullbackStage.FORMING, PullbackStage.READY, PullbackStage.BREAKOUT],
    }));
    res.json(strategies);
  });

  app.get("/api/strategies/presets", (req, res) => {
    res.json({
      BREAKOUTS: STRATEGY_PRESETS.BREAKOUTS,
      INTRADAY: STRATEGY_PRESETS.INTRADAY,
      SWING: STRATEGY_PRESETS.SWING,
      ALL: STRATEGY_PRESETS.ALL,
    });
  });

  app.get("/api/universes", (req, res) => {
    res.json({
      dow30: { symbols: DOW_30, count: DOW_30.length, name: "Dow 30", description: "30 blue-chip stocks" },
      nasdaq100: { symbols: NASDAQ_100, count: NASDAQ_100.length, name: "Nasdaq 100", description: "100 largest Nasdaq stocks" },
      sp500: { symbols: SP_500, count: SP_500.length, name: "S&P 500", description: "500 largest US companies" },
      all: { symbols: ALL_MAJOR_INDICES, count: ALL_MAJOR_INDICES.length, name: "All Major Indices", description: "Combined unique stocks from all indices" },
      options: UNIVERSE_OPTIONS,
    });
  });

  app.get("/api/push/vapid-key", (req, res) => {
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      return res.status(500).json({ error: "Push notifications not configured" });
    }
    res.json({ publicKey: vapidPublicKey });
  });

  app.get("/api/market/regime", async (req, res) => {
    try {
      const userId = req.session?.userId;
      let candles: CandleData[] = [];
      
      if (userId) {
        const connection = await storage.getBrokerConnectionWithToken(userId);
        if (connection?.accessToken && connection?.isConnected) {
          try {
            const history = await fetchHistoryFromBroker(connection, "SPY", "3M");
            candles = history.map(c => ({
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
              time: c.time,
            }));
          } catch (e) {
            console.error("Failed to fetch SPY for regime:", e);
          }
        }
      }
      
      if (candles.length < 30) {
        return res.json({
          regime: "CHOPPY",
          strength: 0,
          ema21Slope: 0,
          priceVsEma21: 0,
          description: "Insufficient market data for regime classification",
        });
      }
      
      const regime = classifyMarketRegime(candles);
      res.json(regime);
    } catch (error) {
      console.error("Regime classification error:", error);
      res.status(500).json({ error: "Failed to classify market regime" });
    }
  });

  app.post("/api/scan/multi-strategy", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const connection = await storage.getBrokerConnectionWithToken(userId);
      
      const { symbols = DEFAULT_SCAN_SYMBOLS, strategyIds, timeframe = "1d" } = req.body;
      const selectedStrategies: StrategyIdType[] = strategyIds || getAllStrategyIds();
      
      // Try broker connection first
      if (connection && connection.accessToken) {
        const brokerTimeframe = getBrokerTimeframe(timeframe);
        const quotes = await fetchQuotesFromBroker(connection, symbols);
        const allResults: any[] = [];
        
        for (const quote of quotes) {
          try {
            const history = await fetchHistoryFromBroker(connection, quote.symbol, brokerTimeframe);
            const candles: CandleData[] = history.map(c => ({
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
              time: c.time,
            }));
            
            if (candles.length < 20) continue;
            
            const pluginResults = runAllPluginScans(
              quote.symbol,
              candles,
              timeframe,
              selectedStrategies.filter(id => 
                id !== StrategyId.VCP && 
                id !== StrategyId.VCP_MULTIDAY && 
                id !== StrategyId.CLASSIC_PULLBACK
              ) as StrategyIdType[],
              quote
            );
            
            allResults.push(...pluginResults);
          } catch (e) {
            console.error(`Failed to scan ${quote.symbol}:`, e);
          }
        }
        
        return res.json(allResults);
      }
      
      return res.status(400).json({ 
        error: "No data source available. Please connect a brokerage." 
      });
    } catch (error: any) {
      console.error("Multi-strategy scan error:", error);
      res.status(500).json({ error: error.message || "Failed to run multi-strategy scan" });
    }
  });

  app.get("/api/market/regime", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const connection = await storage.getBrokerConnectionWithToken(userId);
      
      // Try broker connection first
      if (connection && connection.accessToken) {
        const spyHistory = await fetchHistoryFromBroker(connection, "SPY", "3M");
        const spyCandles: CandleData[] = spyHistory.map(c => ({
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          time: c.time,
        }));
        
        const regime = classifyMarketRegime(spyCandles);
        return res.json(regime);
      }
      
      // Return neutral regime if no data source available
      return res.json({ regime: "NEUTRAL", confidence: 0.5, trend: 0 });
    } catch (error: any) {
      console.error("Market regime error:", error);
      res.status(500).json({ error: error.message || "Failed to get market regime" });
    }
  });

  app.post("/api/scan/confluence", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const connection = await storage.getBrokerConnectionWithToken(userId);

      const { 
        symbols = DEFAULT_SCAN_SYMBOLS, 
        minMatches = 2, 
        timeframe = "1d",
        strategies,
        minPrice,
        maxPrice,
        minVolume
      } = req.body;
      
      // Try broker connection first
      if (connection && connection.accessToken) {
        const brokerTimeframe = getBrokerTimeframe(timeframe);
        
        let marketRegime;
        try {
          const spyHistory = await fetchHistoryFromBroker(connection, "SPY", "3M");
          const spyCandles: CandleData[] = spyHistory.map(c => ({
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            time: c.time,
          }));
          marketRegime = classifyMarketRegime(spyCandles);
        } catch (e) {
          console.error("Failed to get market regime, using default:", e);
        }
        
        const quotes = await fetchQuotesFromBroker(connection, symbols);
        const confluenceResults: ConfluenceResult[] = [];
        
        for (const quote of quotes) {
          try {
            if (minPrice && quote.last < minPrice) continue;
            if (maxPrice && quote.last > maxPrice) continue;
            if (minVolume && quote.volume < minVolume) continue;
            
            const history = await fetchHistoryFromBroker(connection, quote.symbol, brokerTimeframe);
            const candles: CandleData[] = history.map(c => ({
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
              time: c.time,
            }));
            
            if (candles.length < 20) continue;
            
            const pluginResults = runAllPluginScans(
              quote.symbol,
              candles,
              timeframe,
              strategies,
              quote
            );
            
            if (pluginResults.length > 0) {
              const confluence = aggregateConfluence(
                quote.symbol, 
                pluginResults, 
                10, 
                marketRegime?.regime
              );
              if (confluence) {
                confluenceResults.push(confluence);
              }
            }
          } catch (e) {
            console.error(`Failed to confluence scan ${quote.symbol}:`, e);
          }
        }
        
        const filtered = filterByMinMatches(confluenceResults, minMatches);
        const ranked = rankByConfluence(filtered);
        
        return res.json({ results: ranked, marketRegime });
      }
      
      return res.status(400).json({ 
        error: "No data source available. Please connect a brokerage." 
      });
    } catch (error: any) {
      console.error("Confluence scan error:", error);
      res.status(500).json({ error: error.message || "Failed to run confluence scan" });
    }
  });

  app.get("/api/market/stats", async (req, res) => {
    try {
      const stats = await storage.getMarketStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to get market stats" });
    }
  });

  app.get("/api/scan/results", async (req, res) => {
    try {
      const includeMeta = req.query.meta === "true";
      
      const storedResults = await storage.getScanResults();
      if (includeMeta) {
        return res.json({ data: storedResults, isLive: false });
      }
      res.json(storedResults);
    } catch (error) {
      res.status(500).json({ error: "Failed to get scan results" });
    }
  });

  app.get("/api/scan/result/:ticker", async (req, res) => {
    try {
      const result = await storage.getScanResult(req.params.ticker);
      res.json(result || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to get scan result" });
    }
  });

  app.post("/api/scan/run", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const filters = scannerFilters.parse(req.body);
      const results = await storage.runScan();
      res.json(results);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to run scan" });
      }
    }
  });

  app.post("/api/scan/live", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const connection = await storage.getBrokerConnectionWithToken(userId);
      
      // Require broker connection
      if (!connection || !connection.accessToken) {
        return res.status(400).json({ 
          error: "No data source available. Please connect a brokerage." 
        });
      }

      const requestedSymbols = req.body.symbols || DEFAULT_SCAN_SYMBOLS;
      const strategy = req.body.strategy || StrategyType.VCP;
      const { minPrice, maxPrice, minVolume, minRvol, excludeEtfs, excludeOtc } = req.body.filters || {};
      const startTime = Date.now();
      const BATCH_SIZE = 200;

      const etNow = new Date();
      const etParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
        weekday: 'short',
      }).formatToParts(etNow);
      const etHour = parseInt(etParts.find(p => p.type === 'hour')?.value || '0');
      const etMinute = parseInt(etParts.find(p => p.type === 'minute')?.value || '0');
      const etTimeMin = etHour * 60 + etMinute;
      const isRegularHours = etTimeMin >= 570 && etTimeMin < 960; // 9:30 AM - 4:00 PM ET
      
      let allQuotes: any[] = [];
      const totalSymbols = requestedSymbols.length;
      
      if (totalSymbols > BATCH_SIZE) {
        for (let i = 0; i < totalSymbols; i += BATCH_SIZE) {
          const batch = requestedSymbols.slice(i, i + BATCH_SIZE);
          try {
            const batchQuotes = await fetchQuotesFromBroker(connection, batch);
            allQuotes = allQuotes.concat(batchQuotes);
          } catch (batchError: any) {
            console.error(`Batch ${i / BATCH_SIZE + 1} failed:`, batchError.message);
          }
          
          if (i + BATCH_SIZE < totalSymbols) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      } else {
        allQuotes = await fetchQuotesFromBroker(connection, requestedSymbols);
      }
      
      const effectiveMinVolume = isRegularHours ? minVolume : undefined;
      const effectiveMinRvol = isRegularHours ? minRvol : undefined;
      
      console.log(`[Scan] Received ${allQuotes.length} quotes from broker, session=${isRegularHours ? "regular" : "extended"}, applying filters: minPrice=${minPrice}, maxPrice=${maxPrice}, minVolume=${effectiveMinVolume ?? "skipped"}, minRvol=${effectiveMinRvol ?? "skipped"}`);
      
      const filteredQuotes = allQuotes.filter(quote => {
        // Skip quotes with no valid price (can happen during premarket)
        if (!quote.last || quote.last <= 0) return false;
        if (minPrice && quote.last < minPrice) return false;
        if (maxPrice && quote.last > maxPrice) return false;
        if (effectiveMinVolume && quote.volume < effectiveMinVolume) return false;
        if (effectiveMinRvol && quote.avgVolume) {
          const rvol = quote.volume / quote.avgVolume;
          if (rvol < effectiveMinRvol) return false;
        }
        return true;
      });
      
      console.log(`[Scan] ${filteredQuotes.length} quotes passed filters`);
      
      const rawResults = quotesToScanResults(filteredQuotes, strategy);
      console.log(`[Scan] Generated ${rawResults.length} raw scan results for strategy ${strategy}`);
      const results = await verifyBullishTrend(connection, rawResults);
      console.log(`[Scan] ${results.length} results passed bullish trend verification`);
      const scanTime = Date.now() - startTime;
      
      await storage.clearScanResults();
      for (const result of results) {
        await storage.createScanResult(result);
      }
      
      // Track first-seen timestamps for BREAKOUT opportunities (gracefully handle if table doesn't exist)
      const firstSeenMap: Record<string, Date> = {};
      try {
        const breakoutResults = results.filter(r => r.stage === "BREAKOUT");
        
        // Cleanup stale opportunities (those not seen in the last hour)
        await storage.cleanupStaleOpportunities();
        
        // Upsert first-seen records for current breakouts
        for (const result of breakoutResults) {
          const record = await storage.upsertOpportunityFirstSeen(result.ticker, result.stage, strategy);
          firstSeenMap[result.ticker] = record.firstSeenAt;
        }
      } catch (firstSeenError: any) {
        console.warn("First-seen tracking unavailable:", firstSeenError.message);
      }
      
      // Add firstSeenAt to results
      const resultsWithFirstSeen = results.map(r => ({
        ...r,
        firstSeenAt: firstSeenMap[r.ticker] || null,
      }));
      
      // Ingest opportunities for the Opportunity Outcome Report
      if (req.session?.userId) {
        ingestOpportunitiesFromScan(req.session.userId, results, strategy, "1d")
          .then(count => count > 0 && console.log(`[Opportunities] Ingested ${count} from live scan`))
          .catch(err => console.error("[Opportunities] Ingestion error:", err.message));
      }
      
      res.json({
        results: resultsWithFirstSeen,
        metadata: {
          isLive: true,
          provider: connection.provider,
          symbolsRequested: totalSymbols,
          symbolsReturned: allQuotes.length,
          batchCount: Math.ceil(totalSymbols / BATCH_SIZE),
          scanTimeMs: scanTime,
          timestamp: new Date().toISOString(),
          marketSession: isRegularHours ? "regular" : "extended",
        }
      });
    } catch (error: any) {
      console.error("Live scan error:", error);
      res.status(500).json({ error: error.message || "Failed to run live scan" });
    }
  });

  app.get("/api/charts/:ticker/:timeframe?", async (req, res) => {
    try {
      const { ticker, timeframe = "3M" } = req.params;
      const userId = req.session?.userId;
      
      if (userId) {
        const connection = await storage.getBrokerConnectionWithToken(userId);
        if (connection?.accessToken && connection?.isConnected) {
          try {
            const candles = await fetchHistoryFromBroker(connection, ticker.toUpperCase(), timeframe);
            const chartData = processChartData(candles, ticker.toUpperCase());
            return res.json({ ...chartData, isLive: true });
          } catch (brokerError: any) {
            console.error("Chart broker fetch failed, using stored data:", brokerError.message);
            const storedData = storage.getChartData(ticker.toUpperCase());
            return res.json({ ...storedData, isLive: false, error: brokerError.message });
          }
        }
      }
      
      const storedData = storage.getChartData(ticker.toUpperCase());
      res.json({ ...storedData, isLive: false, requiresBroker: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to get chart data" });
    }
  });

  app.get("/api/alerts", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const alerts = await storage.getAlerts();
      res.json(alerts);
    } catch (error) {
      res.status(500).json({ error: "Failed to get alerts" });
    }
  });

  app.post("/api/alerts", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const alertData = insertAlertSchema.parse(req.body);
      const alert = await storage.createAlert(alertData);
      res.json(alert);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create alert" });
      }
    }
  });

  app.patch("/api/alerts/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const alert = await storage.updateAlert(req.params.id, req.body);
      if (!alert) {
        return res.status(404).json({ error: "Alert not found" });
      }
      res.json(alert);
    } catch (error) {
      res.status(500).json({ error: "Failed to update alert" });
    }
  });

  app.delete("/api/alerts/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.deleteAlert(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete alert" });
    }
  });

  app.delete("/api/alerts", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.deleteAllAlerts();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete alerts" });
    }
  });

  app.post("/api/alerts/mark-all-read", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.markAllAlertsRead();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to mark alerts as read" });
    }
  });

  app.get("/api/alert-rules", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      const rules = await storage.getAlertRules(userId);
      res.json(rules);
    } catch (error) {
      res.status(500).json({ error: "Failed to get alert rules" });
    }
  });

  app.get("/api/alert-rules/:id", isAuthenticated, async (req, res) => {
    try {
      const rule = await storage.getAlertRule(req.params.id);
      if (!rule) {
        return res.status(404).json({ error: "Alert rule not found" });
      }
      if (rule.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      res.json(rule);
    } catch (error) {
      res.status(500).json({ error: "Failed to get alert rule" });
    }
  });

  app.post("/api/alert-rules", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const ruleData = insertAlertRuleSchema.parse({
        ...req.body,
        userId,
      });
      
      const rule = await storage.createAlertRule(ruleData);
      res.json(rule);
    } catch (error) {
      console.error("[alert-rules] Create error:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create alert rule" });
      }
    }
  });

  app.patch("/api/alert-rules/:id", isAuthenticated, async (req, res) => {
    try {
      const rule = await storage.getAlertRule(req.params.id);
      if (!rule) {
        return res.status(404).json({ error: "Alert rule not found" });
      }
      if (rule.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      
      const updated = await storage.updateAlertRule(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update alert rule" });
    }
  });

  app.delete("/api/alert-rules/:id", isAuthenticated, async (req, res) => {
    try {
      const rule = await storage.getAlertRule(req.params.id);
      if (!rule) {
        return res.status(404).json({ error: "Alert rule not found" });
      }
      if (rule.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      
      await storage.deleteAlertRule(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete alert rule" });
    }
  });

  app.get("/api/alert-events", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      const ruleId = req.query.ruleId as string | undefined;
      const events = await storage.getAlertEvents(userId, ruleId);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: "Failed to get alert events" });
    }
  });

  app.get("/api/alert-events/:id", isAuthenticated, async (req, res) => {
    try {
      const event = await storage.getAlertEvent(req.params.id);
      if (!event) {
        return res.status(404).json({ error: "Alert event not found" });
      }
      if (event.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      res.json(event);
    } catch (error) {
      res.status(500).json({ error: "Failed to get alert event" });
    }
  });

  app.patch("/api/alert-events/:id/read", isAuthenticated, async (req, res) => {
    try {
      const event = await storage.getAlertEvent(req.params.id);
      if (!event) {
        return res.status(404).json({ error: "Alert event not found" });
      }
      if (event.userId !== req.session.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      
      const updated = await storage.markAlertEventRead(req.params.id);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to mark event as read" });
    }
  });

  app.post("/api/alert-events/mark-all-read", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      await storage.markAllAlertEventsRead(userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to mark events as read" });
    }
  });

  // Opportunity Outcome Report endpoints
  app.get("/api/opportunities", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const sortBy = req.query.sortBy as string | undefined;
      const sortOrder = req.query.sortOrder as string | undefined;
      const filters = {
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        strategyId: req.query.strategyId as string | undefined,
        timeframe: req.query.timeframe as string | undefined,
        stageAtDetection: req.query.stage as string | undefined,
        resolutionOutcome: req.query.outcome as string | undefined,
        symbol: req.query.symbol as string | undefined,
        status: req.query.status as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
        sortBy: ["detectedAt", "symbol", "strategyName", "pnlPercent", "daysToResolution"].includes(sortBy || "") 
          ? sortBy as "detectedAt" | "symbol" | "strategyName" | "pnlPercent" | "daysToResolution"
          : undefined,
        sortOrder: (sortOrder === "asc" || sortOrder === "desc" ? sortOrder : undefined) as "asc" | "desc" | undefined,
      };
      const opportunities = await getOpportunities(userId, filters);
      
      // Calculate daysToResolution for each opportunity
      const opportunitiesWithDays = opportunities.map(opp => {
        let daysToResolution: number | null = null;
        if (opp.resolvedAt && opp.detectedAt) {
          const detectedDate = new Date(opp.detectedAt);
          const resolvedDate = new Date(opp.resolvedAt);
          const diffMs = resolvedDate.getTime() - detectedDate.getTime();
          daysToResolution = Math.round(diffMs / (1000 * 60 * 60 * 24));
        }
        return { ...opp, daysToResolution };
      });
      
      res.json(opportunitiesWithDays);
    } catch (error: any) {
      console.error("Error getting opportunities:", error);
      res.status(500).json({ error: "Failed to get opportunities" });
    }
  });

  app.get("/api/opportunities/summary", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const filters = {
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        strategyId: req.query.strategyId as string | undefined,
        timeframe: req.query.timeframe as string | undefined,
        stageAtDetection: req.query.stage as string | undefined,
        symbol: req.query.symbol as string | undefined,
      };
      const summary = await getOpportunitySummary(userId, filters);
      res.json(summary);
    } catch (error: any) {
      console.error("Error getting opportunity summary:", error);
      res.status(500).json({ error: "Failed to get opportunity summary" });
    }
  });

  app.get("/api/opportunities/export.csv", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const filters = {
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        strategyId: req.query.strategyId as string | undefined,
        timeframe: req.query.timeframe as string | undefined,
        stageAtDetection: req.query.stage as string | undefined,
        resolutionOutcome: req.query.outcome as string | undefined,
        symbol: req.query.symbol as string | undefined,
        status: req.query.status as string | undefined,
      };
      const csv = await exportOpportunitiesCSV(userId, filters);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=opportunities.csv");
      res.send(csv);
    } catch (error: any) {
      console.error("Error exporting opportunities:", error);
      res.status(500).json({ error: "Failed to export opportunities" });
    }
  });

  app.get("/api/opportunities/:id", isAuthenticated, async (req, res) => {
    try {
      const opportunity = await getOpportunity(req.params.id);
      if (!opportunity) {
        return res.status(404).json({ error: "Opportunity not found" });
      }
      if (opportunity.userId !== req.session.userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      // Calculate daysToResolution
      let daysToResolution: number | null = null;
      if (opportunity.resolvedAt && opportunity.detectedAt) {
        const detectedDate = new Date(opportunity.detectedAt);
        const resolvedDate = new Date(opportunity.resolvedAt);
        const diffMs = resolvedDate.getTime() - detectedDate.getTime();
        daysToResolution = Math.round(diffMs / (1000 * 60 * 60 * 24));
      }
      
      res.json({ ...opportunity, daysToResolution });
    } catch (error: any) {
      console.error("Error getting opportunity:", error);
      res.status(500).json({ error: "Failed to get opportunity" });
    }
  });

  // Auto Agent API Routes
  const { isEligible, getOrCreateAgentState, getOrCreatePolicy, recordDecision, authorizeOrder } = await import("./agent-service");
  const { AgentAction, AgentMode } = await import("@shared/schema");

  app.get("/api/agent/policy", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const policy = await getOrCreatePolicy(userId);
      res.json(policy);
    } catch (error: any) {
      console.error("Error getting agent policy:", error);
      res.status(500).json({ error: "Failed to get agent policy" });
    }
  });

  const updateAgentPolicySchema = z.object({
    brokerAccountId: z.string().nullable().optional(),
    strategyId: z.string().nullable().optional(),
    name: z.string().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
    mode: z.enum(["SUGGEST", "AUTO"]).optional(),
    allowedStages: z.array(z.enum(["FORMING", "READY", "BREAKOUT"])).min(1).optional(),
    minConfidencePct: z.number().int().min(0).max(100).optional(),
    minUpsidePct: z.number().min(0).max(100).optional(),
    minRvol: z.number().min(0).max(100).optional(),
    minRewardRisk: z.number().min(0).max(50).optional(),
    allowedMomentum: z.array(z.string()).optional(),
    priceMin: z.number().min(0).nullable().optional(),
    priceMax: z.number().min(0).nullable().optional(),
    minAvgDollarVolume: z.number().min(0).nullable().optional(),
    maxTradesPerDay: z.number().int().min(0).max(100).optional(),
    maxConcurrentPositions: z.number().int().min(0).max(100).optional(),
    riskPerTradeUsd: z.number().min(0).max(100000).optional(),
    maxDailyLossUsd: z.number().min(0).max(1000000).optional(),
    avoidFirstMinutes: z.number().int().min(0).max(240).optional(),
    cooldownMinutes: z.number().int().min(0).max(1440).optional(),
    scanIntervalMinutes: z.number().int().min(1).max(60).optional(),
    optionsEnabled: z.boolean().optional(),
    optionType: z.enum(["calls", "puts", "both"]).optional(),
    optionsStrategy: z.enum(["long_calls", "long_puts", "covered_calls", "credit_spreads", "cash_secured_puts"]).optional(),
    optionsDeltaMin: z.number().min(0.05).max(0.95).optional(),
    optionsDeltaMax: z.number().min(0.05).max(0.95).optional(),
    optionsDteMin: z.number().int().min(1).max(365).optional(),
    optionsDteMax: z.number().int().min(1).max(365).optional(),
    optionsPremiumMin: z.number().min(0).nullable().optional(),
    optionsPremiumMax: z.number().min(0).nullable().optional(),
    optionsMinOpenInterest: z.number().int().min(0).optional(),
    optionsMinVolume: z.number().int().min(0).optional(),
    optionsMaxRiskUsd: z.number().min(0).max(100000).optional(),
  }).strict();

  app.put("/api/agent/policy", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const parseResult = updateAgentPolicySchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Invalid policy data", 
          details: parseResult.error.flatten() 
        });
      }
      const policy = await getOrCreatePolicy(userId);
      const updated = await storage.updateAgentPolicy(policy.id, parseResult.data);
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating agent policy:", error);
      res.status(500).json({ error: "Failed to update agent policy" });
    }
  });

  app.get("/api/agent/state", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const state = await getOrCreateAgentState(userId);
      res.json(state);
    } catch (error: any) {
      console.error("Error getting agent state:", error);
      res.status(500).json({ error: "Failed to get agent state" });
    }
  });

  app.post("/api/agent/state/enable", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await getOrCreateAgentState(userId);
      const updated = await storage.updateAgentState(userId, { enabled: true, paused: false });
      res.json(updated);
    } catch (error: any) {
      console.error("Error enabling agent:", error);
      res.status(500).json({ error: "Failed to enable agent" });
    }
  });

  app.post("/api/agent/state/disable", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await getOrCreateAgentState(userId);
      const updated = await storage.updateAgentState(userId, { enabled: false });
      res.json(updated);
    } catch (error: any) {
      console.error("Error disabling agent:", error);
      res.status(500).json({ error: "Failed to disable agent" });
    }
  });

  app.post("/api/agent/state/pause", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await getOrCreateAgentState(userId);
      const updated = await storage.updateAgentState(userId, { paused: true });
      res.json(updated);
    } catch (error: any) {
      console.error("Error pausing agent:", error);
      res.status(500).json({ error: "Failed to pause agent" });
    }
  });

  app.post("/api/agent/state/resume", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await getOrCreateAgentState(userId);
      const updated = await storage.updateAgentState(userId, { paused: false });
      res.json(updated);
    } catch (error: any) {
      console.error("Error resuming agent:", error);
      res.status(500).json({ error: "Failed to resume agent" });
    }
  });

  app.post("/api/agent/state/emergency-stop", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await getOrCreateAgentState(userId);
      const updated = await storage.updateAgentState(userId, { emergencyStop: true, enabled: false });
      res.json(updated);
    } catch (error: any) {
      console.error("Error setting emergency stop:", error);
      res.status(500).json({ error: "Failed to set emergency stop" });
    }
  });

  app.post("/api/agent/state/clear-emergency-stop", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await getOrCreateAgentState(userId);
      const updated = await storage.updateAgentState(userId, { emergencyStop: false });
      res.json(updated);
    } catch (error: any) {
      console.error("Error clearing emergency stop:", error);
      res.status(500).json({ error: "Failed to clear emergency stop" });
    }
  });

  app.get("/api/agent/decisions", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const limit = parseInt(req.query.limit as string) || 100;
      const decisions = await storage.getAgentDecisions(userId, limit);
      res.json(decisions);
    } catch (error: any) {
      console.error("Error getting agent decisions:", error);
      res.status(500).json({ error: "Failed to get agent decisions" });
    }
  });

  app.get("/api/agent/skipped-trades", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const limit = parseInt(req.query.limit as string) || 5;
      const skipped = await storage.getRecentSkippedTrades(userId, limit);
      res.json(skipped);
    } catch (error: any) {
      console.error("Error getting skipped trades:", error);
      res.status(500).json({ error: "Failed to get skipped trades" });
    }
  });

  function normalizeTradeStatus(raw: string): string {
    const lower = raw.toLowerCase();
    if (lower === "ok" || lower === "executed" || lower === "ack" || lower === "opn" || lower === "open" || lower === "received" || lower === "queued" || lower === "sent" || lower === "snd") return "sent_to_broker";
    if (lower === "fll" || lower === "filled") return "filled";
    if (lower === "flp" || lower === "partially_filled" || lower === "partial_fill") return "partial_fill";
    if (lower === "can" || lower === "canceled" || lower === "cancelled" || lower === "expired" || lower === "exp" || lower === "tsc") return "cancelled";
    if (lower === "rej" || lower === "rejected" || lower === "ur" || lower === "uract") return "rejected";
    if (lower === "failed" || lower === "broken" || lower === "bro") return "error";
    return lower;
  }

  function mapAgentDecisionToTrade(d: any) {
    const payload = d.orderPayload as any;
    const metrics = d.metricsSnapshot as any;
    let rawStatus: string;
    if (d.action === "SKIP") rawStatus = "skipped";
    else if (d.action === "SUGGEST") rawStatus = "pending";
    else if (d.action === "ERROR") rawStatus = "error";
    else rawStatus = payload?.brokerStatus || "executed";
    return {
      id: d.id,
      symbol: d.symbol,
      source: "auto_agent" as const,
      action: d.action,
      side: payload?.action === "SELL" ? "sell" : "buy",
      quantity: payload?.quantity || 0,
      filledQty: 0,
      orderType: (payload?.orderType || "LIMIT").toLowerCase(),
      price: payload?.limitPrice || null,
      status: normalizeTradeStatus(rawStatus),
      brokerOrderId: payload?.brokerOrderId || d.brokerOrderId || null,
      isOptions: !!payload?.isOptionsOrder,
      optionDetails: payload?.isOptionsOrder ? {
        optionType: payload?.optionType,
        strike: payload?.strike,
        expiration: payload?.expiration,
      } : null,
      strategy: payload?.strategyName || payload?.strategyId || metrics?.strategyId || null,
      reasons: d.reasons,
      createdAt: d.createdAt,
      stopLoss: payload?.stopLoss || null,
      target: payload?.target || null,
    };
  }

  function mapInstaTradeToTrade(o: any) {
    return {
      id: o.id,
      symbol: o.symbol,
      source: "instatrade" as const,
      side: o.side,
      quantity: o.quantity,
      filledQty: 0,
      orderType: o.orderType,
      price: o.limitPrice || o.fillPrice || null,
      status: normalizeTradeStatus(o.status),
      brokerOrderId: o.brokerOrderId || null,
      isOptions: !!o.optionSymbol,
      optionDetails: o.optionSymbol ? {
        optionType: o.optionType,
        strike: o.strike,
        expiration: o.expiration,
      } : null,
      strategy: o.strategyKey || null,
      reasons: null,
      createdAt: o.createdAt,
    };
  }

  function mapExternalAlertToTrade(a: any) {
    const statusMap: Record<string, string> = {
      EXECUTED: "sent_to_broker",
      FILLED: "filled",
      CANCELLED: "cancelled",
      REJECTED: "rejected",
      PENDING: "pending",
      EVALUATING: "pending",
      SKIPPED: "cancelled",
      ERROR: "error",
    };
    const rawStatus = statusMap[a.status] || a.status?.toLowerCase() || "pending";
    return {
      id: a.id,
      symbol: a.symbol,
      source: "auto_agent" as const,
      action: a.status === "SKIPPED" || a.status === "ERROR" ? a.status : a.brokerOrderId ? "EXECUTE" : "SUGGEST",
      side: a.direction?.toLowerCase() === "short" ? "sell" : "buy",
      quantity: 0,
      filledQty: 0,
      orderType: "limit",
      price: a.executedPrice || a.entryPrice || null,
      status: rawStatus,
      brokerOrderId: a.brokerOrderId || null,
      isOptions: false,
      optionDetails: null,
      strategy: a.strategyName || null,
      reasons: a.skipReason ? [a.skipReason] : a.source ? [`External alert from ${a.source}: ${a.strategyName}`] : null,
      createdAt: a.createdAt,
      stopLoss: a.riskPrice || null,
      target: a.targetPrice || null,
    };
  }

  app.get("/api/today-trades", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { db } = await import("./db");
      const { agentDecisions, tradeOrders, externalAlerts } = await import("@shared/schema");
      const { gte, eq, and, sql, isNull } = await import("drizzle-orm");

      await syncOrderStatuses(userId);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const agentTrades = await db
        .select()
        .from(agentDecisions)
        .where(
          and(
            eq(agentDecisions.userId, userId),
            sql`${agentDecisions.action} IN ('EXECUTE', 'ERROR', 'SUGGEST')`,
            gte(agentDecisions.createdAt, todayStart)
          )
        )
        .orderBy(sql`${agentDecisions.createdAt} DESC`)
        .limit(200);

      const instaTradeOrders = await db
        .select()
        .from(tradeOrders)
        .where(
          and(
            eq(tradeOrders.userId, userId),
            gte(tradeOrders.createdAt, todayStart)
          )
        )
        .orderBy(sql`${tradeOrders.createdAt} DESC`)
        .limit(50);

      const externalAlertTrades = await db
        .select()
        .from(externalAlerts)
        .where(
          and(
            eq(externalAlerts.userId, userId),
            gte(externalAlerts.createdAt, todayStart),
            isNull(externalAlerts.agentDecisionId)
          )
        )
        .orderBy(sql`${externalAlerts.createdAt} DESC`)
        .limit(50);

      const combined = [
        ...agentTrades.map((d: any) => mapAgentDecisionToTrade(d)),
        ...instaTradeOrders.map((o: any) => mapInstaTradeToTrade(o)),
        ...externalAlertTrades.map((a: any) => mapExternalAlertToTrade(a)),
      ].sort((a, b) => {
        const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tB - tA;
      });

      res.json(combined);
    } catch (error: any) {
      console.error("Error getting today trades:", error);
      res.status(500).json({ error: "Failed to get today's trades" });
    }
  });

  const TERMINAL_STATUSES = new Set(["filled", "cancelled", "rejected", "error"]);
  const syncThrottleMap = new Map<string, number>();
  const SYNC_THROTTLE_MS = 30_000;

  async function syncOrderStatuses(userId: string): Promise<{ synced: number; brokerOrderCount: number }> {
    const now = Date.now();
    const lastSync = syncThrottleMap.get(userId) || 0;
    if (now - lastSync < SYNC_THROTTLE_MS) return { synced: 0, brokerOrderCount: 0 };
    syncThrottleMap.set(userId, now);

    let synced = 0;
    let brokerOrderCount = 0;

    try {
      const brokerService = await import("./broker/index");
      brokerService.invalidateBrokerCache(userId);
      const brokerOrders = await brokerService.getBrokerOrders(userId);
      brokerOrderCount = brokerOrders?.length || 0;
      if (!brokerOrders || brokerOrders.length === 0) {
        console.log(`[OrderSync] No broker orders returned for user ${userId.substring(0, 8)}...`);
        return { synced: 0, brokerOrderCount: 0 };
      }

      const brokerOrderMap = new Map<string, string>();
      for (const bo of brokerOrders) {
        if (bo.id) {
          brokerOrderMap.set(String(bo.id), bo.status);
        }
      }
      console.log(`[OrderSync] Fetched ${brokerOrderMap.size} broker orders for matching (sample: ${Array.from(brokerOrderMap.entries()).slice(0, 3).map(([id, s]) => `${id}=${s}`).join(", ")})`);
      if (brokerOrderMap.size === 0) return { synced: 0, brokerOrderCount };

      const { db } = await import("./db");
      const { agentDecisions, tradeOrders } = await import("@shared/schema");
      const { eq, and, sql, isNotNull } = await import("drizzle-orm");

      const pendingAgentTrades = await db
        .select()
        .from(agentDecisions)
        .where(
          and(
            eq(agentDecisions.userId, userId),
            eq(agentDecisions.action, "EXECUTE"),
            sql`(${agentDecisions.brokerOrderId} IS NOT NULL OR ${agentDecisions.orderPayload}->>'brokerOrderId' IS NOT NULL)`
          )
        )
        .limit(200);

      console.log(`[OrderSync] Found ${pendingAgentTrades.length} agent EXECUTE trades with broker order IDs`);

      for (const trade of pendingAgentTrades) {
        const orderId = String(trade.brokerOrderId || (trade.orderPayload as any)?.brokerOrderId || "");
        if (!orderId) continue;

        const brokerStatus = brokerOrderMap.get(orderId);
        if (!brokerStatus) {
          console.log(`[OrderSync] Agent trade ${trade.id} (${trade.symbol}): broker order ${orderId} not found in broker response`);
          continue;
        }

        const currentStatus = (trade.orderPayload as any)?.brokerStatus || "";
        const normalizedCurrent = normalizeTradeStatus(currentStatus);
        const normalizedNew = normalizeTradeStatus(brokerStatus);

        if (normalizedCurrent === normalizedNew) continue;
        if (TERMINAL_STATUSES.has(normalizedCurrent)) continue;

        console.log(`[OrderSync] Agent trade ${trade.id}: ${normalizedCurrent} -> ${normalizedNew} (broker: ${brokerStatus})`);
        const updatedPayload = { ...(trade.orderPayload as any), brokerStatus: brokerStatus };
        await db.update(agentDecisions)
          .set({ orderPayload: updatedPayload, brokerOrderId: orderId })
          .where(eq(agentDecisions.id, trade.id));
        synced++;
      }

      const pendingInstaTrades = await db
        .select()
        .from(tradeOrders)
        .where(
          and(
            eq(tradeOrders.userId, userId),
            isNotNull(tradeOrders.brokerOrderId),
            sql`${tradeOrders.status} NOT IN ('filled', 'cancelled', 'rejected', 'error')`
          )
        )
        .limit(200);

      console.log(`[OrderSync] Found ${pendingInstaTrades.length} pending InstaTrade orders to check`);

      for (const order of pendingInstaTrades) {
        if (!order.brokerOrderId) continue;

        const brokerStatus = brokerOrderMap.get(String(order.brokerOrderId));
        if (!brokerStatus) {
          console.log(`[OrderSync] InstaTrade #${order.brokerOrderId}: no match in broker orders`);
          continue;
        }

        const normalizedNew = normalizeTradeStatus(brokerStatus);
        const normalizedCurrent = normalizeTradeStatus(order.status);

        if (normalizedCurrent === normalizedNew) continue;
        if (TERMINAL_STATUSES.has(normalizedCurrent)) continue;

        console.log(`[OrderSync] InstaTrade #${order.brokerOrderId}: ${normalizedCurrent} -> ${normalizedNew} (broker: ${brokerStatus})`);
        const updates: any = { status: normalizedNew };
        if (normalizedNew === "filled") {
          updates.filledAt = new Date();
        }
        await db.update(tradeOrders)
          .set(updates)
          .where(eq(tradeOrders.id, order.id));
        synced++;
      }

      const { externalAlerts } = await import("@shared/schema");
      const pendingExternalAlerts = await db
        .select()
        .from(externalAlerts)
        .where(
          and(
            eq(externalAlerts.userId, userId),
            isNotNull(externalAlerts.brokerOrderId),
            sql`${externalAlerts.status} IN ('EXECUTED', 'PENDING')`
          )
        )
        .limit(200);

      for (const alert of pendingExternalAlerts) {
        if (!alert.brokerOrderId) continue;

        const brokerStatus = brokerOrderMap.get(String(alert.brokerOrderId));
        if (!brokerStatus) continue;

        const normalizedNew = normalizeTradeStatus(brokerStatus);
        if (normalizedNew === "filled") {
          await db.update(externalAlerts)
            .set({ status: "FILLED", updatedAt: new Date() })
            .where(eq(externalAlerts.id, alert.id));
          synced++;
        } else if (normalizedNew === "cancelled" || normalizedNew === "rejected") {
          await db.update(externalAlerts)
            .set({ status: normalizedNew === "cancelled" ? "CANCELLED" : "REJECTED", updatedAt: new Date() })
            .where(eq(externalAlerts.id, alert.id));
          synced++;
        }
      }

      if (synced > 0) {
        console.log(`[OrderSync] Updated ${synced} order statuses for user ${userId.substring(0, 8)}...`);
      }
    } catch (error: any) {
      console.error("[OrderSync] Error:", error.message);
    }
    return { synced, brokerOrderCount };
  }

  app.post("/api/trades/sync-statuses", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      syncThrottleMap.delete(userId);
      const result = await syncOrderStatuses(userId);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("[OrderSync] Manual sync error:", error.message);
      res.status(500).json({ error: "Failed to sync order statuses" });
    }
  });

  app.post("/api/orders/:orderId/cancel", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { orderId } = req.params;
      if (!orderId) {
        return res.status(400).json({ error: "Order ID is required" });
      }

      const brokerService = await import("./broker/index");
      const result = await brokerService.cancelBrokerOrder(userId, orderId);

      if (result.success) {
        brokerService.invalidateBrokerCache(userId);
        res.json({ success: true, message: result.message });
      } else {
        res.status(400).json({ success: false, error: result.message });
      }
    } catch (error: any) {
      console.error("[CancelOrder] Error:", error.message);
      res.status(500).json({ success: false, error: "Failed to cancel order" });
    }
  });

  app.get("/api/all-trades", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const limit = parseInt(req.query.limit as string) || 500;
      const sync = req.query.sync !== "false";
      const { db } = await import("./db");
      const { agentDecisions, tradeOrders, externalAlerts } = await import("@shared/schema");
      const { eq, and, sql, isNull } = await import("drizzle-orm");

      if (sync) {
        await syncOrderStatuses(userId);
      }

      const agentTrades = await db
        .select()
        .from(agentDecisions)
        .where(
          and(
            eq(agentDecisions.userId, userId),
            sql`${agentDecisions.action} IN ('EXECUTE', 'ERROR', 'SUGGEST')`
          )
        )
        .orderBy(sql`${agentDecisions.createdAt} DESC`)
        .limit(limit);

      const instaTradeOrders = await db
        .select()
        .from(tradeOrders)
        .where(eq(tradeOrders.userId, userId))
        .orderBy(sql`${tradeOrders.createdAt} DESC`)
        .limit(limit);

      const externalAlertTrades = await db
        .select()
        .from(externalAlerts)
        .where(
          and(
            eq(externalAlerts.userId, userId),
            isNull(externalAlerts.agentDecisionId)
          )
        )
        .orderBy(sql`${externalAlerts.createdAt} DESC`)
        .limit(limit);

      const combined = [
        ...agentTrades.map((d: any) => mapAgentDecisionToTrade(d)),
        ...instaTradeOrders.map((o: any) => mapInstaTradeToTrade(o)),
        ...externalAlertTrades.map((a: any) => mapExternalAlertToTrade(a)),
      ];

      const knownBrokerOrderIds = new Set<string>();
      for (const t of combined) {
        if (t.brokerOrderId) knownBrokerOrderIds.add(String(t.brokerOrderId));
      }

      try {
        const brokerService = await import("./broker/index");
        const connection = await storage.getBrokerConnectionWithToken(userId);
        const providerName = connection?.provider || "broker";
        const brokerOrders = await brokerService.getBrokerOrders(userId);
        console.log(`[AllTrades] Broker orders from ${providerName}: ${brokerOrders?.length ?? 0} total, ${knownBrokerOrderIds.size} already in local DB`);
        if (brokerOrders && brokerOrders.length > 0) {
          for (const bo of brokerOrders) {
            if (!bo.id || knownBrokerOrderIds.has(String(bo.id))) continue;

            const orderTypeLabel = bo.orderType || "market";
            const legLabel = bo.legType === "stop_loss" ? "Stop Loss"
              : bo.legType === "profit_target" ? "Profit Target"
              : bo.legType === "exit" ? "Exit"
              : null;

            const reasons: string[] = [];
            if (legLabel) {
              reasons.push(`${legLabel} order`);
              if (bo.groupOrderId) reasons.push(`Bracket group #${bo.groupOrderId}`);
            } else {
              reasons.push(`Order from ${providerName.charAt(0).toUpperCase() + providerName.slice(1)}`);
            }
            if (bo.stopPrice) reasons.push(`Stop: $${bo.stopPrice.toFixed(2)}`);
            if (bo.limitPrice && orderTypeLabel !== "market") reasons.push(`Limit: $${bo.limitPrice.toFixed(2)}`);

            combined.push({
              id: `broker-${bo.id}`,
              symbol: bo.symbol || "UNKNOWN",
              source: "broker" as any,
              action: undefined,
              side: bo.side || "buy",
              quantity: bo.qty || 0,
              filledQty: bo.filledQty || 0,
              orderType: orderTypeLabel,
              price: bo.price || null,
              status: normalizeTradeStatus(bo.status || "unknown"),
              brokerOrderId: String(bo.id),
              isOptions: false,
              optionDetails: null,
              strategy: legLabel || null,
              reasons,
              createdAt: bo.createdAt || new Date().toISOString(),
              stopLoss: bo.stopPrice || null,
              target: bo.limitPrice || null,
            });
          }
        }
      } catch (brokerError: any) {
        console.log(`[AllTrades] Could not fetch broker orders: ${brokerError.message}`);
      }

      combined.sort((a, b) => {
        const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tB - tA;
      });

      res.json(combined);
    } catch (error: any) {
      console.error("Error getting all trades:", error);
      res.status(500).json({ error: "Failed to get all trades" });
    }
  });

  app.get("/api/agent/evaluate/:opportunityId", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const opportunity = await storage.getOpportunity(req.params.opportunityId);
      
      if (!opportunity) {
        return res.status(404).json({ error: "Opportunity not found" });
      }
      
      if (opportunity.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const policy = await getOrCreatePolicy(userId);
      const eligibility = isEligible(opportunity, policy);
      const authorization = await authorizeOrder(userId, policy, opportunity.symbol);
      
      res.json({
        eligible: eligibility.pass,
        reasons: eligibility.reasons,
        metrics: eligibility.metrics,
        authorized: authorization.allowed,
        authorizationReasons: authorization.reasons,
      });
    } catch (error: any) {
      console.error("Error evaluating opportunity:", error);
      res.status(500).json({ error: "Failed to evaluate opportunity" });
    }
  });

  // Audit Events
  app.post("/api/audit-events", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { eventType, metadata } = req.body;
      
      if (!eventType) {
        return res.status(400).json({ error: "Event type is required" });
      }
      
      const event = await storage.createAuditEvent({
        userId,
        eventType,
        metadata: metadata || {},
      });
      
      res.json(event);
    } catch (error: any) {
      console.error("Error creating audit event:", error);
      res.status(500).json({ error: "Failed to create audit event" });
    }
  });

  app.get("/api/audit-events", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const limit = parseInt(req.query.limit as string) || 100;
      const events = await storage.getAuditEvents(userId, limit);
      res.json(events);
    } catch (error: any) {
      console.error("Error getting audit events:", error);
      res.status(500).json({ error: "Failed to get audit events" });
    }
  });

  app.get("/api/watchlists", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const watchlists = await storage.getWatchlists(userId);
      res.json(watchlists);
    } catch (error) {
      console.error("Error getting watchlists:", error);
      res.status(500).json({ error: "Failed to get watchlists" });
    }
  });

  app.get("/api/watchlists/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const watchlist = await storage.getWatchlist(req.params.id, userId);
      if (!watchlist) {
        return res.status(404).json({ error: "Watchlist not found" });
      }
      res.json(watchlist);
    } catch (error) {
      res.status(500).json({ error: "Failed to get watchlist" });
    }
  });

  app.get("/api/watchlists/:id/results", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const watchlist = await storage.getWatchlist(req.params.id, userId);
      if (!watchlist) {
        return res.status(404).json({ error: "Watchlist not found" });
      }
      const results = await storage.getWatchlistResults(req.params.id);
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Failed to get watchlist results" });
    }
  });

  app.post("/api/watchlists", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const watchlistData = insertWatchlistSchema.parse({ ...req.body, userId });
      const watchlist = await storage.createWatchlist(watchlistData);
      res.json(watchlist);
    } catch (error) {
      console.error("Error creating watchlist:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create watchlist" });
      }
    }
  });

  app.delete("/api/watchlists/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await storage.deleteWatchlist(req.params.id, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete watchlist" });
    }
  });

  app.post("/api/watchlists/:id/symbols", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { symbol } = req.body;
      if (!symbol) {
        return res.status(400).json({ error: "Symbol is required" });
      }
      const watchlist = await storage.addSymbolToWatchlist(req.params.id, userId, symbol);
      if (!watchlist) {
        return res.status(404).json({ error: "Watchlist not found" });
      }
      res.json(watchlist);
    } catch (error) {
      res.status(500).json({ error: "Failed to add symbol" });
    }
  });

  app.delete("/api/watchlists/:id/symbols/:symbol", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const watchlist = await storage.removeSymbolFromWatchlist(
        req.params.id,
        userId,
        req.params.symbol
      );
      if (!watchlist) {
        return res.status(404).json({ error: "Watchlist not found" });
      }
      res.json(watchlist);
    } catch (error) {
      res.status(500).json({ error: "Failed to remove symbol" });
    }
  });

  app.get("/api/broker/status", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const connection = await storage.getBrokerConnection(userId);
      if (!connection) {
        return res.json(null);
      }
      const sanitizedConnection = {
        id: connection.id,
        userId: connection.userId,
        provider: connection.provider,
        isConnected: connection.isConnected,
        lastSync: connection.lastSync,
        preferredAccountId: connection.preferredAccountId || null,
        autoReconnect: connection.autoReconnect ?? false,
      };
      res.json(sanitizedConnection);
    } catch (error) {
      res.status(500).json({ error: "Failed to get broker status" });
    }
  });

  app.get("/api/broker/token-health", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const brokerService = await import("./broker/index");
      const health = await brokerService.getTokenHealth(userId);
      res.json(health);
    } catch (error) {
      res.status(500).json({ error: "Failed to check token health" });
    }
  });

  const brokerPingCache = new Map<string, { ok: boolean; reason?: string; provider?: string | null; checkedAt: number }>();
  const BROKER_PING_LIVE_TTL = 5000;

  app.get("/api/broker/ping", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const connection = await storage.getBrokerConnectionWithToken(userId);
      if (!connection || !connection.isConnected) {
        return res.json({ ok: false, reason: "not_connected" });
      }

      const cached = brokerPingCache.get(userId);
      if (cached && Date.now() - cached.checkedAt < BROKER_PING_LIVE_TTL) {
        return res.json(cached);
      }

      const brokerService = await import("./broker/index");
      const health = await brokerService.getTokenHealth(userId);
      if (health.status === "expired") {
        const result = { ok: false, reason: "expired", provider: health.provider, checkedAt: Date.now() };
        brokerPingCache.set(userId, result);
        return res.json(result);
      }

      let liveOk = false;
      try {
        if (connection.provider === "tradier" && connection.accessToken) {
          const liveRes = await fetch("https://api.tradier.com/v1/user/profile", {
            headers: { "Authorization": `Bearer ${connection.accessToken}`, "Accept": "application/json" },
          });
          liveOk = liveRes.ok;
        } else if (connection.provider === "tradestation" && connection.accessToken) {
          const tsBase = getTradeStationBaseUrl(connection.simMode);
          const liveRes = await fetch(`${tsBase}/brokerage/accounts`, {
            headers: { "Authorization": `Bearer ${connection.accessToken}` },
          });
          liveOk = liveRes.ok;
        } else {
          liveOk = health.status === "valid" || health.status === "expiring";
        }
      } catch {
        liveOk = false;
      }

      const result = liveOk
        ? { ok: true, provider: health.provider, checkedAt: Date.now() }
        : { ok: false, reason: "access_failed", provider: health.provider, checkedAt: Date.now() };
      brokerPingCache.set(userId, result);
      return res.json(result);
    } catch (error) {
      return res.json({ ok: false, reason: "error" });
    }
  });

  app.get("/api/data-source/status", async (req, res) => {
    try {
      const userId = req.session?.userId;
      
      // Get user's preferred data source
      let preferredDataSource = "brokerage";
      let hasBrokerConnection = false;
      let brokerProvider: string | null = null;
      
      if (userId) {
        try {
          const userSettings = await storage.getUserSettings(userId);
          if (userSettings?.preferredDataSource) {
            preferredDataSource = userSettings.preferredDataSource;
          }
        } catch (settingsErr) {
          console.error("Error fetching user settings for data source:", settingsErr);
        }
        
        try {
          const connection = await storage.getBrokerConnection(userId);
          if (connection?.isConnected) {
            hasBrokerConnection = true;
            brokerProvider = connection.provider;
          }
        } catch (brokerErr) {
          console.error("Error fetching broker connection for data source:", brokerErr);
        }
      }
      
      // Determine active data source
      let activeSource = "mock";
      let activeProvider = null;
      
      if (hasBrokerConnection) {
        activeSource = "brokerage";
        activeProvider = brokerProvider;
      }
      
      res.json({
        activeSource,
        activeProvider,
        isLive: activeSource !== "mock",
        hasBrokerConnection,
        brokerProvider,
      });
    } catch (error) {
      console.error("Error in data-source/status:", error);
      // Return a safe default instead of 500 error
      res.json({
        activeSource: "mock",
        activeProvider: null,
        isLive: false,
        hasBrokerConnection: false,
        brokerProvider: null,
        error: "Failed to get data source status",
      });
    }
  });

  app.post("/api/broker/connect", isAuthenticatedOrPartner, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { provider, accessToken, secretKey } = req.body;
      if (!provider) {
        return res.status(400).json({ error: "Provider is required" });
      }
      if (!accessToken || typeof accessToken !== "string" || !accessToken.trim()) {
        return res.status(400).json({ error: "Access token is required" });
      }
      const connection = await storage.setBrokerConnectionWithTokens(
        userId,
        provider,
        accessToken.trim(),
        secretKey?.trim() || undefined
      );
      const sanitizedConnection = {
        id: connection.id,
        userId: connection.userId,
        provider: connection.provider,
        isConnected: connection.isConnected,
        lastSync: connection.lastSync,
      };
      res.json(sanitizedConnection);
    } catch (error: any) {
      console.error("Failed to connect broker:", error.message);
      res.status(500).json({ error: error.message || "Failed to connect broker" });
    }
  });

  app.post("/api/broker/disconnect", isAuthenticatedOrPartner, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await storage.clearBrokerConnection(userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to disconnect broker" });
    }
  });

  app.post("/api/broker/auto-reconnect", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }
      await storage.updateBrokerAutoReconnect(userId, enabled);
      res.json({ success: true, autoReconnect: enabled });
    } catch (error) {
      console.error("Error toggling auto-reconnect:", error);
      res.status(500).json({ error: "Failed to update auto-reconnect setting" });
    }
  });

  // Auto-connect endpoint - checks stored credentials and establishes connection
  app.post("/api/broker/auto-connect", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const connection = await storage.getBrokerConnectionWithToken(userId);
      
      if (!connection || !connection.accessToken) {
        return res.json({ connected: false, reason: "no_credentials" });
      }

      // Test the stored credentials
      let isValid = false;
      
      if (connection.provider === "tradier") {
        const response = await fetch("https://api.tradier.com/v1/markets/quotes?symbols=AAPL", {
          headers: {
            "Authorization": `Bearer ${connection.accessToken}`,
            "Accept": "application/json",
          },
        });
        isValid = response.ok;
      } else if (connection.provider === "alpaca") {
        const headers: Record<string, string> = {
          "APCA-API-KEY-ID": connection.accessToken,
        };
        if (connection.refreshToken) {
          headers["APCA-API-SECRET-KEY"] = connection.refreshToken;
        }
        const response = await fetch("https://paper-api.alpaca.markets/v2/account", { headers });
        isValid = response.ok;
      } else if (connection.provider === "polygon") {
        const response = await fetch(`https://api.polygon.io/v2/aggs/ticker/AAPL/prev?apiKey=${connection.accessToken}`);
        isValid = response.ok;
      }

      if (isValid) {
        // Update connection status to connected
        await storage.updateBrokerConnectionStatus(userId, true);
        res.json({ 
          connected: true, 
          provider: connection.provider,
          message: "Auto-connected successfully" 
        });
      } else {
        // Mark as disconnected if credentials are invalid
        await storage.updateBrokerConnectionStatus(userId, false);
        res.json({ connected: false, reason: "invalid_credentials" });
      }
    } catch (error: any) {
      console.error("Auto-connect error:", error.message);
      res.json({ connected: false, reason: "error", error: error.message });
    }
  });

  app.post("/api/broker/test", isAuthenticatedOrPartner, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const connection = await storage.getBrokerConnectionWithToken(userId);
      
      if (!connection || !connection.accessToken) {
        return res.status(400).json({ success: false, error: "No broker connection found" });
      }

      let testResult: { success: boolean; message: string; data?: any };

      if (connection.provider === "tradier") {
        console.log(`[Tradier Test] Testing connection with token length: ${connection.accessToken?.length || 0}`);
        const response = await fetch("https://api.tradier.com/v1/markets/quotes?symbols=AAPL", {
          headers: {
            "Authorization": `Bearer ${connection.accessToken}`,
            "Accept": "application/json",
          },
        });
        
        console.log(`[Tradier Test] Response status: ${response.status}`);
        
        if (response.ok) {
          const data = await response.json();
          const quote = data.quotes?.quote;
          testResult = {
            success: true,
            message: "Connection successful",
            data: quote ? {
              symbol: quote.symbol,
              last: quote.last,
              change: quote.change,
              volume: quote.volume,
            } : null,
          };
        } else {
          const errorText = await response.text();
          console.log(`[Tradier Test] Error response: ${errorText}`);
          let errorData: any = {};
          try {
            errorData = JSON.parse(errorText);
          } catch {}
          testResult = {
            success: false,
            message: errorData.fault?.faultstring || `API error: ${response.status} - ${errorText.substring(0, 200)}`,
          };
        }
      } else if (connection.provider === "alpaca") {
        const headers: Record<string, string> = {
          "APCA-API-KEY-ID": connection.accessToken,
        };
        if (connection.refreshToken) {
          headers["APCA-API-SECRET-KEY"] = connection.refreshToken;
        }
        const response = await fetch("https://data.alpaca.markets/v2/stocks/bars/latest?symbols=AAPL", {
          headers,
        });
        
        if (response.ok) {
          const data = await response.json();
          const bar = data.bars?.AAPL;
          testResult = {
            success: true,
            message: "Connection successful",
            data: bar ? { symbol: "AAPL", last: bar.c, volume: bar.v } : null,
          };
        } else {
          const errorText = await response.text().catch(() => "");
          testResult = { success: false, message: `API error: ${response.status} ${errorText}` };
        }
      } else if (connection.provider === "polygon") {
        const response = await fetch(`https://api.polygon.io/v2/aggs/ticker/AAPL/prev?apiKey=${connection.accessToken}`);
        
        if (response.ok) {
          const data = await response.json();
          const result = data.results?.[0];
          testResult = {
            success: true,
            message: "Connection successful",
            data: result ? { symbol: "AAPL", close: result.c, volume: result.v } : null,
          };
        } else {
          testResult = { success: false, message: `API error: ${response.status}` };
        }
      } else if (connection.provider === "schwab") {
        const response = await fetch("https://api.schwabapi.com/marketdata/v1/quotes?symbols=AAPL", {
          headers: {
            "Authorization": `Bearer ${connection.accessToken}`,
            "Accept": "application/json",
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          const quote = data.AAPL?.quote || data.AAPL;
          testResult = {
            success: true,
            message: "Connection successful",
            data: quote ? { symbol: "AAPL", last: quote.lastPrice || quote.mark, volume: quote.totalVolume } : null,
          };
        } else {
          testResult = { success: false, message: `API error: ${response.status}` };
        }
      } else if (connection.provider === "tradestation") {
        const tsBase = getTradeStationBaseUrl(connection.simMode);
        const response = await fetch(`${tsBase}/brokerage/accounts`, {
          headers: {
            "Authorization": `Bearer ${connection.accessToken}`,
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          const accounts = data.Accounts || data.accounts || [];
          const firstAccount = accounts[0];
          const accountName = firstAccount?.Name || firstAccount?.name || firstAccount?.DisplayName || firstAccount?.displayName || firstAccount?.AccountID || firstAccount?.accountId || `${accounts.length} account(s)`;
          
          let balanceInfo: string | null = null;
          if (firstAccount) {
            const acctId = firstAccount.AccountID || firstAccount.accountId;
            if (acctId) {
              try {
                const balResponse = await fetch(`${tsBase}/brokerage/accounts/${acctId}/balances`, {
                  headers: { "Authorization": `Bearer ${connection.accessToken}` },
                });
                if (balResponse.ok) {
                  const balData = await balResponse.json();
                  const bal = balData.Balances?.[0] || balData.balances?.[0] || balData;
                  const equity = bal?.Equity || bal?.equity || bal?.CashBalance || bal?.cashBalance || bal?.MarketValue || bal?.marketValue;
                  if (equity != null) {
                    balanceInfo = Number(equity).toLocaleString("en-US", { style: "currency", currency: "USD" });
                  }
                }
              } catch (e) {
                console.log(`[TradeStation Test] Balance fetch failed (non-fatal):`, (e as Error).message);
              }
            }
          }

          testResult = {
            success: true,
            message: "Connection successful",
            data: { 
              symbol: `TradeStation (${accountName})`,
              last: balanceInfo,
              accounts: accounts.length, 
              provider: "tradestation",
            },
          };
        } else {
          const errorText = await response.text().catch(() => "");
          testResult = { success: false, message: `API error: ${response.status} ${errorText.substring(0, 200)}` };
        }
      } else if (connection.provider === "ibkr") {
        testResult = { 
          success: false, 
          message: "Interactive Brokers requires Client Portal API setup. Please use Tradier, Alpaca, or Polygon instead." 
        };
      } else {
        testResult = { success: true, message: "Connection stored (API test not available for this provider)" };
      }

      res.json(testResult);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Failed to test broker connection" });
    }
  });

  // ─── Centralized Broker Service API ───────────────────────────────────
  const brokerService = await import("./broker/index");

  app.get("/api/broker/accounts", isAuthenticatedOrPartner, async (req, res) => {
    try {
      const accounts = await brokerService.getBrokerAccounts(req.session.userId!);
      res.json(accounts);
    } catch (error: any) {
      console.error("[BrokerService] accounts error:", error.message);
      res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });

  app.patch("/api/broker/preferred-account", isAuthenticatedOrPartner, async (req, res) => {
    try {
      const { accountId } = req.body;
      if (!accountId || typeof accountId !== "string") {
        return res.status(400).json({ error: "accountId is required" });
      }

      const userId = req.session.userId!;
      const connection = await storage.getBrokerConnection(userId);
      if (!connection || !connection.isConnected) {
        return res.status(400).json({ error: "No active broker connection" });
      }

      const accounts = await brokerService.getBrokerAccounts(userId);
      const validAccount = accounts.find((a: any) => a.id === accountId);
      if (!validAccount) {
        return res.status(400).json({ error: "Invalid account ID" });
      }

      const { brokerConnections } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const { db } = await import("./db");
      await db.update(brokerConnections)
        .set({ preferredAccountId: accountId, updatedAt: new Date() })
        .where(eq(brokerConnections.userId, userId));

      res.json({ success: true, preferredAccountId: accountId });
    } catch (error: any) {
      console.error("[BrokerService] preferred account error:", error.message);
      res.status(500).json({ error: "Failed to update preferred account" });
    }
  });

  app.post("/api/broker/sandbox-token", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { token } = req.body;
      if (!token || typeof token !== "string" || token.trim().length === 0) {
        return res.status(400).json({ error: "Sandbox API token is required" });
      }

      const connection = await storage.getBrokerConnection(userId);
      if (!connection || !connection.isConnected || connection.provider !== "tradier") {
        return res.status(400).json({ error: "Active Tradier connection required" });
      }

      await storage.setSandboxToken(userId, token.trim());
      brokerService.invalidateBrokerCache(userId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[BrokerService] sandbox token error:", error.message);
      res.status(500).json({ error: "Failed to save sandbox token" });
    }
  });

  app.delete("/api/broker/sandbox-token", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await storage.removeSandboxToken(userId);
      brokerService.invalidateBrokerCache(userId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[BrokerService] remove sandbox token error:", error.message);
      res.status(500).json({ error: "Failed to remove sandbox token" });
    }
  });

  app.get("/api/broker/sandbox-status", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const connection = await storage.getBrokerConnectionWithToken(userId);
      const hasSandbox = !!(connection?.sandboxAccessToken);
      res.json({ hasSandboxToken: hasSandbox });
    } catch (error: any) {
      res.json({ hasSandboxToken: false });
    }
  });

  app.post("/api/broker/sim-mode", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }
      const connection = await storage.getBrokerConnectionWithToken(userId);
      if (!connection || connection.provider !== "tradestation") {
        return res.status(400).json({ error: "Sim mode is only available for TradeStation connections" });
      }
      await storage.setSimMode(userId, enabled);
      brokerService.invalidateBrokerCache(userId);
      console.log(`[BrokerService] Sim mode ${enabled ? "enabled" : "disabled"} for user ${userId}`);
      res.json({ success: true, simMode: enabled });
    } catch (error: any) {
      console.error("[BrokerService] sim mode error:", error.message);
      res.status(500).json({ error: "Failed to update sim mode" });
    }
  });

  app.get("/api/broker/sim-mode", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const connection = await storage.getBrokerConnectionWithToken(userId);
      res.json({ 
        simMode: connection?.simMode === true,
        provider: connection?.provider || null,
        available: connection?.provider === "tradestation"
      });
    } catch (error: any) {
      res.json({ simMode: false, provider: null, available: false });
    }
  });

  app.get("/api/broker/positions", isAuthenticated, async (req, res) => {
    try {
      const positions = await brokerService.getBrokerPositions(req.session.userId!);
      res.json(positions);
    } catch (error: any) {
      console.error("[BrokerService] positions error:", error.message);
      res.status(500).json({ error: "Failed to fetch positions" });
    }
  });

  app.get("/api/broker/orders", isAuthenticated, async (req, res) => {
    try {
      const orders = await brokerService.getBrokerOrders(req.session.userId!);
      res.json(orders);
    } catch (error: any) {
      console.error("[BrokerService] orders error:", error.message);
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  app.post("/api/broker/orders", isAuthenticated, async (req, res) => {
    try {
      const { accountId, symbol, side, quantity, orderType, price, stopPrice, duration, orderClass, optionSymbol, optionSide } = req.body;

      if (!accountId || !symbol || !side || !quantity) {
        return res.status(400).json({ error: "Missing required fields: accountId, symbol, side, quantity" });
      }

      if (!["buy", "sell"].includes(side)) {
        return res.status(400).json({ error: "side must be 'buy' or 'sell'" });
      }

      if (typeof quantity !== "number" || quantity < 1) {
        return res.status(400).json({ error: "quantity must be a positive number" });
      }

      if (orderClass === "option" && !optionSymbol) {
        return res.status(400).json({ error: "optionSymbol is required for option orders" });
      }

      const accounts = await brokerService.getBrokerAccounts(req.session.userId!);
      if (!accounts.find((a: any) => a.id === accountId)) {
        return res.status(403).json({ error: "Invalid or unauthorized broker account" });
      }

      const orderRequest: any = {
        accountId,
        symbol: symbol.toUpperCase(),
        side,
        quantity: Math.floor(quantity),
        orderType: orderType || "limit",
        price: price ?? undefined,
        stopPrice: stopPrice ?? undefined,
        duration: duration || "day",
      };

      if (orderClass === "option") {
        orderRequest.orderClass = "option";
        orderRequest.optionSymbol = optionSymbol;
        orderRequest.optionSide = optionSide || "buy_to_open";
      }

      const result = await brokerService.placeBrokerOrder(req.session.userId!, orderRequest);

      if (result.orderId === "pending") {
        return res.status(502).json({ 
          error: "Order was sent to broker but no order ID was returned. The order may not have been placed. Please check your brokerage portal.",
          result,
        });
      }

      res.json(result);
    } catch (error: any) {
      console.error("[BrokerService] place order error:", error.message);
      // Detect insufficient scope error from Tradier
      if (error.message?.includes("InsufficientScope") || error.message?.includes("scope-trade")) {
        return res.status(403).json({ 
          error: "Your broker connection doesn't have trading permissions. Please disconnect and reconnect your broker in Settings to grant trading access.",
          code: "INSUFFICIENT_SCOPE",
        });
      }
      res.status(500).json({ error: error.message || "Failed to place order" });
    }
  });

  // ─── Stock Trade Ticket (Place Equity with optional OTOCO bracket) ──
  app.post("/api/trade/place-equity", isAuthenticatedOrPartner, async (req, res) => {
    try {
      const { accountId, symbol, side, quantity, orderType, price, duration, bracketTarget, bracketStop } = req.body;

      if (!accountId || !symbol || !quantity) {
        return res.status(400).json({ error: "Missing required fields: accountId, symbol, quantity" });
      }

      if (typeof quantity !== "number" || quantity < 1 || quantity > 10000) {
        return res.status(400).json({ error: "quantity must be between 1 and 10,000" });
      }

      const accounts = await brokerService.getBrokerAccounts(req.session.userId!);
      if (!accounts.find((a: any) => a.id === accountId)) {
        return res.status(403).json({ error: "Invalid or unauthorized broker account" });
      }

      const hasBracket = bracketTarget && bracketStop;
      const finalOrderType = orderType || "market";
      const finalDuration = duration || "day";
      const finalSide = side || "buy";

      const orderRequest: any = {
        accountId,
        symbol: symbol.toUpperCase(),
        side: finalSide,
        quantity: Math.floor(quantity),
        orderType: finalOrderType,
        duration: finalDuration,
        orderClass: hasBracket ? "otoco" : "equity",
      };

      if (price !== undefined && (finalOrderType === "limit" || finalOrderType === "stop_limit")) {
        orderRequest.price = price;
      }

      if (hasBracket) {
        orderRequest.bracketTarget = bracketTarget;
        orderRequest.bracketStop = bracketStop;
      }

      const result = await brokerService.placeBrokerOrder(req.session.userId!, orderRequest);

      if (result.orderId === "pending") {
        return res.status(502).json({
          error: "Order was sent to broker but no order ID was returned. Please check your brokerage portal.",
          result,
        });
      }

      res.json({
        orderId: result.orderId,
        symbol: result.symbol,
        side: result.side,
        quantity: result.quantity,
        status: result.status,
        hasBracket,
      });
    } catch (error: any) {
      console.error("[Trade] place equity error:", error.message);
      if (error.message?.includes("InsufficientScope") || error.message?.includes("scope-trade")) {
        return res.status(403).json({
          error: "Your broker connection doesn't have trading permissions. Please disconnect and reconnect your broker in Settings to grant trading access.",
          code: "INSUFFICIENT_SCOPE",
        });
      }
      if (error.message?.includes("Tradier order rejected")) {
        return res.status(422).json({ error: error.message });
      }
      res.status(500).json({ error: error.message || "Failed to place order" });
    }
  });

  app.get("/api/broker/quote/:symbol", isAuthenticatedOrPartner, async (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const userId = req.session.userId!;
      const connection = await storage.getBrokerConnectionWithToken(userId);
      if (!connection || !connection.isConnected || !connection.accessToken) {
        return res.status(400).json({ error: "No active broker connection" });
      }
      const quotes = await fetchQuotesFromBroker(connection, [symbol]);
      const q = quotes.find((qt: any) => qt.symbol === symbol);
      if (!q) {
        return res.status(404).json({ error: "Quote not found" });
      }
      res.json({ symbol: q.symbol, last: q.last, volume: q.volume, change: q.change, changePercent: q.changePercent });
    } catch (error: any) {
      console.error("[Quote] error:", error.message);
      res.status(500).json({ error: "Failed to fetch quote" });
    }
  });

  // ─── Trade Ticket API (Preview & Place) ──────────────────────────────
  const { tradeOrders, managedExits } = await import("@shared/schema");

  app.post("/api/trade/preview", isAuthenticated, async (req, res) => {
    try {
      const { optionSymbol, underlying, strike, expiration, optionType, strategyVariant, mid: candidateMid } = req.body;
      if (!optionSymbol || !underlying) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      let bid = 0, ask = 0, mid = candidateMid ?? 0, last = 0;
      try {
        const quote = await brokerService.getOptionQuote(req.session.userId!, optionSymbol);
        if (quote) {
          bid = quote.bid;
          ask = quote.ask;
          mid = quote.mid;
          last = quote.last;
        }
      } catch (e) {
        console.log("[TradePreview] Quote fetch failed, using candidate data");
      }

      const nat = bid > 0 ? bid : mid;
      const suggestedLimit = mid;

      const isCreditStrategy = (strategyVariant || "").toLowerCase().includes("put spread") ||
        (strategyVariant || "").toLowerCase().includes("call spread") ||
        (strategyVariant || "").toLowerCase().includes("covered") ||
        (strategyVariant || "").toLowerCase().includes("cash-secured");

      let suggestedTarget: number | null = null;
      let suggestedStop: number | null = null;

      if (isCreditStrategy) {
        suggestedTarget = parseFloat((mid * 0.5).toFixed(2));
        suggestedStop = parseFloat((mid * 2.0).toFixed(2));
      } else {
        suggestedTarget = parseFloat((mid * 1.5).toFixed(2));
        suggestedStop = parseFloat((mid * 0.5).toFixed(2));
      }

      res.json({
        bid,
        ask,
        mid,
        last,
        nat,
        suggestedLimit,
        suggestedTarget,
        suggestedStop,
        isCreditStrategy,
      });
    } catch (error: any) {
      console.error("[TradePreview] error:", error.message);
      res.status(500).json({ error: "Failed to generate preview" });
    }
  });

  app.post("/api/trade/place", isAuthenticated, async (req, res) => {
    try {
      const {
        accountId, symbol, optionSymbol, optionSide, quantity,
        orderType, limitPrice, duration, strike, expiration, optionType,
        strategyKey, strategyVariant,
        exitPlan,
      } = req.body;

      if (!accountId || !symbol || !quantity) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      if (typeof quantity !== "number" || quantity < 1 || quantity > 100) {
        return res.status(400).json({ error: "quantity must be between 1 and 100" });
      }

      const accounts = await brokerService.getBrokerAccounts(req.session.userId!);
      if (!accounts.find((a: any) => a.id === accountId)) {
        return res.status(403).json({ error: "Invalid or unauthorized broker account" });
      }

      let finalOptionSymbol = optionSymbol;
      if (strike && expiration && optionType && symbol) {
        const u = symbol.toUpperCase();
        const [ey, em, ed] = expiration.split("-");
        const yy = ey.slice(-2);
        const mm = em.padStart(2, "0");
        const dd = ed.padStart(2, "0");
        const cp = optionType === "call" ? "C" : "P";
        const si = Math.round(strike * 1000);
        const sp = String(si).padStart(8, "0");
        finalOptionSymbol = `${u}${yy}${mm}${dd}${cp}${sp}`;
      }

      if (!finalOptionSymbol) {
        return res.status(400).json({ error: "optionSymbol is required or must be derivable from strike/expiration/optionType" });
      }

      const side = (optionSide === "sell_to_open" || optionSide === "sell_to_close") ? "sell" : "buy";
      const finalOrderType = orderType || "limit";
      const finalDuration = duration || "day";

      const orderRequest: any = {
        accountId,
        symbol: symbol.toUpperCase(),
        side,
        quantity: Math.floor(quantity),
        orderType: finalOrderType,
        duration: finalDuration,
        orderClass: "option",
        optionSymbol: finalOptionSymbol,
        optionSide: optionSide || "buy_to_open",
      };

      if (limitPrice !== undefined && (finalOrderType === "limit" || finalOrderType === "stop_limit")) {
        orderRequest.price = limitPrice;
      }

      const brokerResult = await brokerService.placeBrokerOrder(req.session.userId!, orderRequest);

      const connInfo = await brokerService.getConnectionProviderForUser(req.session.userId!);
      const providerName = connInfo?.provider || "tradier";

      const { db } = await import("./db");
      const [tradeOrder] = await db.insert(tradeOrders).values({
        userId: req.session.userId!,
        brokerProvider: providerName,
        brokerAccountId: accountId,
        brokerOrderId: brokerResult.orderId,
        symbol: symbol.toUpperCase(),
        optionSymbol: finalOptionSymbol,
        orderClass: "option",
        side,
        optionSide: optionSide || "buy_to_open",
        quantity: Math.floor(quantity),
        orderType: finalOrderType,
        limitPrice: limitPrice ?? null,
        duration: finalDuration,
        status: brokerResult.status || "pending",
        strategyKey: strategyKey || null,
        strategyVariant: strategyVariant || null,
        strike: strike ?? null,
        expiration: expiration || null,
        optionType: optionType || null,
        ticketJson: req.body,
      }).returning();

      let managedExitId: string | null = null;

      if (exitPlan && (exitPlan.targetPrice || exitPlan.stopPrice)) {
        const closeSide = (optionSide === "buy_to_open") ? "sell_to_close" : "buy_to_close";
        const [managedExit] = await db.insert(managedExits).values({
          userId: req.session.userId!,
          tradeOrderId: tradeOrder.id,
          brokerProvider: providerName,
          brokerAccountId: accountId,
          symbol: symbol.toUpperCase(),
          optionSymbol: finalOptionSymbol,
          optionSide: closeSide,
          quantity: Math.floor(quantity),
          targetPrice: exitPlan.targetPrice ?? null,
          stopPrice: exitPlan.stopPrice ?? null,
          stopType: exitPlan.stopType || "stop",
          status: "active",
        }).returning();
        managedExitId = managedExit.id;
      }

      res.json({
        ...brokerResult,
        tradeOrderId: tradeOrder.id,
        managedExitId,
      });
    } catch (error: any) {
      console.error("[TradePlacement] error:", error.message);
      if (error.message?.includes("InsufficientScope") || error.message?.includes("scope-trade")) {
        return res.status(403).json({
          error: "Your broker connection doesn't have trading permissions. Please disconnect and reconnect your broker in Settings to grant trading access.",
          code: "INSUFFICIENT_SCOPE",
        });
      }
      res.status(500).json({ error: error.message || "Failed to place order" });
    }
  });

  // ─── Platform Risk Profile API ────────────────────────────────────────
  const { toRiskProfileResponse } = await import("@shared/platform-types");
  const { getDefaultRiskProfile: getOrCreateRiskProfile } = await import("./models/risk-profiles");

  app.get("/api/platform/risk-profile", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const profile = await getOrCreateRiskProfile(userId);
      res.json(toRiskProfileResponse(profile));
    } catch (error: any) {
      console.error("[Platform] risk-profile GET error:", error.message);
      res.status(500).json({ message: "Failed to load risk profile" });
    }
  });

  app.put("/api/platform/risk-profile", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const profile = await getOrCreateRiskProfile(userId);
      const body = req.body;

      const updateData: Record<string, unknown> = {};
      if (body.risk_mode !== undefined) updateData.riskMode = body.risk_mode;
      if (body.risk_per_trade !== undefined) updateData.riskPerTrade = Number(body.risk_per_trade);
      if (body.max_deploy !== undefined) updateData.maxDeploy = Number(body.max_deploy);
      if (body.protections_enabled !== undefined) updateData.protectionsEnabled = Boolean(body.protections_enabled);
      if (body.guardrails_json !== undefined) updateData.guardrailsJson = body.guardrails_json;
      if (body.protections_json !== undefined) updateData.protectionsJson = body.protections_json;
      if (body.delta_min !== undefined) updateData.deltaMin = Number(body.delta_min);
      if (body.delta_max !== undefined) updateData.deltaMax = Number(body.delta_max);
      if (body.loss_cutoff_mult !== undefined) updateData.lossCutoffMult = Number(body.loss_cutoff_mult);
      if (body.min_premium_pct !== undefined) updateData.minPremiumPct = Number(body.min_premium_pct);
      if (body.vix_pause !== undefined) updateData.vixPause = Number(body.vix_pause);

      const updated = await storage.updateRiskProfile(profile.id, updateData);
      if (!updated) {
        return res.status(500).json({ message: "Failed to update risk profile" });
      }
      res.json(toRiskProfileResponse(updated));
    } catch (error: any) {
      console.error("[Platform] risk-profile PUT error:", error.message);
      res.status(500).json({ message: "Failed to update risk profile" });
    }
  });

  // ─── Options Scanner API ──────────────────────────────────────────────
  const { runOptionsScan, STRATEGY_DEFINITIONS } = await import("./engines/options-scanner/index");
  const { getUserEntitlements } = await import("./replit_integrations/auth/routes");

  const scanPreferencesSchema = z.object({
    dteMin: z.number().min(1).max(365).optional(),
    dteMax: z.number().min(1).max(365).optional(),
    deltaMin: z.number().min(0).max(1).optional(),
    deltaMax: z.number().min(0).max(1).optional(),
    minPremiumPct: z.number().min(0).max(100).optional(),
  });

  const optionsScanRequestSchema = z.object({
    universeId: z.string().min(1),
    riskProfileId: z.string().optional(),
    strategyKey: z.string().min(1),
    scanPreferences: scanPreferencesSchema.optional(),
  });

  app.get("/api/options/strategies", isAuthenticated, (req, res) => {
    const userId = req.session.userId!;
    const entitlements = getUserEntitlements(userId);
    if (!entitlements.optionsScanner) {
      return res.status(403).json({ error: "Options Scanner is not available on your plan" });
    }
    res.json(STRATEGY_DEFINITIONS);
  });

  app.post("/api/options/scan", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const entitlements = getUserEntitlements(userId);
      if (!entitlements.optionsScanner) {
        return res.status(403).json({ error: "Options Scanner is not available on your plan" });
      }

      const parsed = optionsScanRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0].message });
      }
      const { universeId, riskProfileId, strategyKey, scanPreferences } = parsed.data;

      const { getUniverse } = await import("./models/ticker-universes");
      const { getDefaultRiskProfile } = await import("./models/risk-profiles");

      const BUILTIN_IDS = ["dow30", "nasdaq100", "sp500", "all"];
      let symbols: string[];

      if (BUILTIN_IDS.includes(universeId)) {
        symbols = getUniverseSymbols(universeId as any);
      } else {
        const universe = await getUniverse(universeId, userId);
        if (!universe || universe.members.length < 1) {
          return res.status(400).json({ error: "Universe empty" });
        }
        symbols = universe.members.map(m => m.symbol);
      }

      if (!symbols || symbols.length < 1) {
        return res.status(400).json({ error: "No stocks found in selected group" });
      }

      let brokerToken: string | undefined;
      let brokerProvider: string = "tradier";
      try {
        const connection = await storage.getBrokerConnectionWithToken(userId);
        if (connection?.accessToken) {
          brokerToken = connection.accessToken;
          brokerProvider = connection.provider || "tradier";
        } else {
          return res.status(409).json({ error: "Broker not connected" });
        }
      } catch {
        return res.status(409).json({ error: "Broker not connected" });
      }

      const riskProfile = await getDefaultRiskProfile(userId);

      const riskSettings = {
        deltaMin: riskProfile.deltaMin ?? 0.10,
        deltaMax: riskProfile.deltaMax ?? 0.30,
        minPremiumPct: riskProfile.minPremiumPct ?? 0.5,
        vixPause: riskProfile.vixPause ?? 35,
        lossCutoffMult: riskProfile.lossCutoffMult ?? 2.0,
        protectionsEnabled: riskProfile.protectionsEnabled,
        guardrails: (riskProfile.guardrailsJson as Record<string, unknown>) ?? {},
      };

      const optionsProvider = (brokerProvider === "tradestation" ? "tradestation" : "tradier") as import("./engines/options-scanner/index").OptionsProvider;

      const result = await runOptionsScan(
        { universeId, strategyKey, symbols, riskSettings, scanPreferences: scanPreferences as any, provider: optionsProvider },
        brokerToken,
      );

      await storage.createOptionsScan({
        userId,
        universeId,
        strategyKey,
        requestJson: { universeId, riskProfileId, strategyKey },
        resultJson: result,
      });

      res.json(result);
    } catch (error: any) {
      console.error("[OptionsScanner] scan error:", error.message);
      res.status(500).json({ error: "Scan failed" });
    }
  });

  const optionsScansQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });

  app.get("/api/options/scans", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const entitlements = getUserEntitlements(userId);
      if (!entitlements.optionsScanner) {
        return res.status(403).json({ error: "Options Scanner is not available on your plan" });
      }

      const parsed = optionsScansQuerySchema.safeParse(req.query);
      const limit = parsed.success ? parsed.data.limit : 20;
      const scans = await storage.getOptionsScans(userId, limit);
      res.json(scans);
    } catch (error: any) {
      console.error("[OptionsScanner] list error:", error.message);
      res.status(500).json({ error: "Failed to fetch scan history" });
    }
  });

  // Tradier OAuth routes
  const TRADIER_CLIENT_ID = process.env.TRADIER_CLIENT_ID;
  const TRADIER_CLIENT_SECRET = process.env.TRADIER_CLIENT_SECRET;
  
  function isTradierOAuthConfigured(): boolean {
    return !!(TRADIER_CLIENT_ID && TRADIER_CLIENT_SECRET);
  }
  
  function getTradierCallbackUrl(req?: any): string {
    if (req) {
      const host = req.get("host");
      const proto = req.get("x-forwarded-proto") || req.protocol || "https";
      if (host) {
        return `${proto}://${host}/tradier-callback`;
      }
    }
    let baseUrl: string;
    if (process.env.APP_URL) {
      baseUrl = process.env.APP_URL;
    } else if (process.env.RAILWAY_PUBLIC_DOMAIN) {
      baseUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    } else if (process.env.REPLIT_DEPLOYMENT_URL) {
      baseUrl = `https://${process.env.REPLIT_DEPLOYMENT_URL}`;
    } else if (process.env.REPLIT_DEV_DOMAIN) {
      baseUrl = `https://${process.env.REPLIT_DEV_DOMAIN}`;
    } else {
      baseUrl = "http://localhost:5000";
    }
    return `${baseUrl}/tradier-callback`;
  }

  app.get("/api/tradier/oauth/status", (req, res) => {
    res.json({ configured: isTradierOAuthConfigured() });
  });

  // Initiate Tradier OAuth flow
  app.get("/api/tradier/oauth", isAuthenticatedOrPartner, async (req, res) => {
    try {
      if (!isTradierOAuthConfigured()) {
        return res.status(503).json({ error: "Tradier OAuth is not configured" });
      }

      const userId = req.session.userId!;
      // Generate a random state to prevent CSRF attacks
      const state = crypto.randomBytes(16).toString("hex");
      
      // Store state in session for verification on callback
      req.session.tradierOAuthState = state;
      req.session.tradierOAuthUserId = userId;
      
      // Save session before redirecting to ensure state is persisted
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const callbackUrl = getTradierCallbackUrl(req);
      console.log(`[Tradier OAuth] Using callback URL: ${callbackUrl}`);

      // Redirect user to Tradier authorization page
      const authUrl = new URL("https://api.tradier.com/v1/oauth/authorize");
      authUrl.searchParams.set("client_id", TRADIER_CLIENT_ID!);
      authUrl.searchParams.set("scope", "read,write,market,trade");
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("redirect_uri", callbackUrl);

      res.json({ authUrl: authUrl.toString() });
    } catch (error: any) {
      console.error("Tradier OAuth initiation error:", error);
      res.status(500).json({ error: error.message || "Failed to initiate Tradier OAuth" });
    }
  });

  // Shared Tradier OAuth callback handler
  async function handleTradierOAuthCallback(req: any, res: any) {
    try {
      const { code, state } = req.query;
      
      if (!code || typeof code !== "string") {
        return res.redirect("/settings?tradier_error=missing_code");
      }
      
      if (!state || typeof state !== "string") {
        return res.redirect("/settings?tradier_error=missing_state");
      }

      // Verify state matches what we stored in session
      if (state !== req.session.tradierOAuthState) {
        console.error("Tradier OAuth state mismatch");
        return res.redirect("/settings?tradier_error=state_mismatch");
      }

      const userId = req.session.tradierOAuthUserId;
      if (!userId) {
        console.error("No user ID found in session for Tradier OAuth callback");
        return res.redirect("/settings?tradier_error=session_expired");
      }

      // Clear OAuth state from session
      delete req.session.tradierOAuthState;
      delete req.session.tradierOAuthUserId;

      // Exchange authorization code for access token
      const basicAuth = Buffer.from(`${TRADIER_CLIENT_ID}:${TRADIER_CLIENT_SECRET}`).toString("base64");
      
      const tokenResponse = await fetch("https://api.tradier.com/v1/oauth/accesstoken", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error("Tradier token exchange failed:", errorText);
        return res.redirect("/settings?tradier_error=token_exchange_failed");
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;
      
      if (!accessToken) {
        console.error("No access token in Tradier response:", tokenData);
        return res.redirect("/settings?tradier_error=no_access_token");
      }

      const tradierExpiresAt = tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : new Date(Date.now() + 24 * 60 * 60 * 1000);

      await storage.setBrokerConnectionWithTokens(
        userId,
        "tradier",
        accessToken,
        tokenData.refresh_token || undefined,
        tradierExpiresAt
      );

      // Mark connection as active
      await storage.updateBrokerConnectionStatus(userId, true);

      console.log(`[Tradier OAuth] User ${userId} successfully connected to Tradier`);
      
      const redirectBase = req.session.partnerUserId ? "/partner/dashboard?tab=broker" : "/settings";
      res.redirect(`${redirectBase}${redirectBase.includes("?") ? "&" : "?"}tradier_success=true`);
    } catch (error: any) {
      console.error("Tradier OAuth callback error:", error);
      const redirectBase = req.session?.partnerUserId ? "/partner/dashboard?tab=broker" : "/settings";
      res.redirect(`${redirectBase}${redirectBase.includes("?") ? "&" : "?"}tradier_error=unknown`);
    }
  }

  // Tradier OAuth callback routes - both point to the same handler
  // /tradier-callback matches the registered callback URL with Tradier
  app.get("/tradier-callback", handleTradierOAuthCallback);
  app.get("/api/tradier/callback", handleTradierOAuthCallback);

  // TradeStation OAuth routes
  const TRADESTATION_CLIENT_ID = process.env.TRADESTATION_CLIENT_ID?.trim();
  const TRADESTATION_CLIENT_SECRET = process.env.TRADESTATION_CLIENT_SECRET?.trim();
  
  function isTradeStationOAuthConfigured(): boolean {
    return !!(TRADESTATION_CLIENT_ID && TRADESTATION_CLIENT_SECRET);
  }
  
  function getTradeStationCallbackUrl(req?: any): string {
    if (req) {
      const host = req.get("host");
      const proto = req.get("x-forwarded-proto") || req.protocol || "https";
      if (host) {
        return `${proto}://${host}/api/tradestation/callback`;
      }
    }
    let baseUrl: string;
    if (process.env.APP_URL) {
      baseUrl = process.env.APP_URL;
    } else if (process.env.RAILWAY_PUBLIC_DOMAIN) {
      baseUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    } else if (process.env.REPLIT_DEPLOYMENT_URL) {
      baseUrl = `https://${process.env.REPLIT_DEPLOYMENT_URL}`;
    } else if (process.env.REPLIT_DEV_DOMAIN) {
      baseUrl = `https://${process.env.REPLIT_DEV_DOMAIN}`;
    } else {
      baseUrl = "http://localhost:5000";
    }
    return `${baseUrl}/api/tradestation/callback`;
  }

  app.get("/api/tradestation/oauth/status", (req, res) => {
    res.json({ configured: isTradeStationOAuthConfigured() });
  });

  // Initiate TradeStation OAuth flow
  app.get("/api/tradestation/oauth", isAuthenticatedOrPartner, async (req, res) => {
    try {
      if (!isTradeStationOAuthConfigured()) {
        return res.status(503).json({ error: "TradeStation OAuth is not configured" });
      }

      const userId = req.session.userId!;
      const state = crypto.randomBytes(16).toString("hex");
      
      req.session.tradestationOAuthState = state;
      req.session.tradestationOAuthUserId = userId;
      req.session.tradestationOAuthFromPartner = !!req.session.partnerUserId;
      
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const callbackUrl = getTradeStationCallbackUrl(req);
      console.log(`[TradeStation OAuth] Using callback URL: ${callbackUrl}`);

      // TradeStation v3 OAuth - requires audience parameter per API docs
      const authUrl = new URL("https://signin.tradestation.com/authorize");
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", TRADESTATION_CLIENT_ID!);
      authUrl.searchParams.set("audience", "https://api.tradestation.com");
      authUrl.searchParams.set("redirect_uri", callbackUrl);
      authUrl.searchParams.set("scope", "openid MarketData profile ReadAccount Trade Matrix OptionSpreads offline_access");
      authUrl.searchParams.set("state", state);

      res.json({ authUrl: authUrl.toString() });
    } catch (error: any) {
      console.error("TradeStation OAuth initiation error:", error);
      res.status(500).json({ error: error.message || "Failed to initiate TradeStation OAuth" });
    }
  });

  // TradeStation OAuth callback handler
  async function handleTradeStationOAuthCallback(req: any, res: any) {
    const isFromPartner = !!req.session?.tradestationOAuthFromPartner || !!req.session?.partnerUserId;
    const redirectBase = isFromPartner ? "/partner/dashboard?tab=broker" : "/settings";
    const buildRedirect = (params: string) => `${redirectBase}${redirectBase.includes("?") ? "&" : "?"}${params}`;
    try {
      const { code, state } = req.query;

      if (!code || typeof code !== "string") {
        return res.redirect(buildRedirect("tradestation_error=missing_code"));
      }
      
      if (!state || typeof state !== "string") {
        return res.redirect(buildRedirect("tradestation_error=missing_state"));
      }

      if (state !== req.session.tradestationOAuthState) {
        console.error("TradeStation OAuth state mismatch");
        return res.redirect(buildRedirect("tradestation_error=state_mismatch"));
      }

      const userId = req.session.tradestationOAuthUserId;
      if (!userId) {
        console.error("No user ID found in session for TradeStation OAuth callback");
        return res.redirect(buildRedirect("tradestation_error=session_expired"));
      }
      delete req.session.tradestationOAuthState;
      delete req.session.tradestationOAuthUserId;
      delete req.session.tradestationOAuthFromPartner;

      const callbackUrl = getTradeStationCallbackUrl(req);
      
      const tokenResponse = await fetch("https://signin.tradestation.com/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: TRADESTATION_CLIENT_ID!,
          client_secret: TRADESTATION_CLIENT_SECRET!,
          code: code,
          redirect_uri: callbackUrl,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error("TradeStation token exchange failed:", errorText);
        return res.redirect("/settings?tradestation_error=token_exchange_failed");
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;
      
      if (!accessToken) {
        console.error("No access token in TradeStation response:", tokenData);
        return res.redirect("/settings?tradestation_error=no_access_token");
      }

      const expiresAt = tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : undefined;

      await storage.setBrokerConnectionWithTokens(
        userId,
        "tradestation",
        accessToken,
        tokenData.refresh_token || undefined,
        expiresAt,
      );

      await storage.updateBrokerConnectionStatus(userId, true);

      console.log(`[TradeStation OAuth] User ${userId} successfully connected to TradeStation`);
      
      res.redirect(buildRedirect("tradestation_success=true"));
    } catch (error: any) {
      console.error("TradeStation OAuth callback error:", error);
      res.redirect(buildRedirect("tradestation_error=unknown"));
    }
  }

  // TradeStation OAuth callback routes
  app.get("/tradestation-callback", handleTradeStationOAuthCallback);
  app.get("/api/tradestation/callback", handleTradeStationOAuthCallback);

  // SnapTrade OAuth brokerage connection routes
  app.get("/api/snaptrade/status", (req, res) => {
    const { isSnaptradeConfigured } = require("./snaptrade");
    res.json({ configured: isSnaptradeConfigured() });
  });

  app.post("/api/snaptrade/register", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { isSnaptradeConfigured, registerSnaptradeUser } = require("./snaptrade");
      
      if (!isSnaptradeConfigured()) {
        return res.status(503).json({ error: "SnapTrade not configured" });
      }

      const credentials = await storage.getUserSnaptradeCredentials(userId);
      if (credentials?.snaptradeUserId && credentials?.snaptradeUserSecret) {
        return res.json({ 
          success: true, 
          message: "Already registered",
          snaptradeUserId: credentials.snaptradeUserId 
        });
      }

      const result = await registerSnaptradeUser(userId);
      if (!result) {
        return res.status(500).json({ error: "Failed to register with SnapTrade" });
      }

      await storage.updateUserSnaptradeCredentials(userId, result.userId, result.userSecret);

      res.json({ 
        success: true, 
        message: "Registered with SnapTrade",
        snaptradeUserId: result.userId 
      });
    } catch (error: any) {
      console.error("SnapTrade register error:", error);
      res.status(500).json({ error: error.message || "Failed to register with SnapTrade" });
    }
  });

  app.post("/api/snaptrade/auth-link", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { broker, connectionType, reconnect } = req.body;
      const { isSnaptradeConfigured, getSnaptradeAuthLink, registerSnaptradeUser } = require("./snaptrade");
      
      if (!isSnaptradeConfigured()) {
        return res.status(503).json({ error: "SnapTrade not configured" });
      }

      let credentials = await storage.getUserSnaptradeCredentials(userId);
      
      if (!credentials?.snaptradeUserId || !credentials?.snaptradeUserSecret) {
        const result = await registerSnaptradeUser(userId);
        if (!result) {
          return res.status(500).json({ error: "Failed to register with SnapTrade" });
        }
        await storage.updateUserSnaptradeCredentials(userId, result.userId, result.userSecret);
        credentials = { snaptradeUserId: result.userId, snaptradeUserSecret: result.userSecret };
      }

      // Build base URL for OAuth callback - check various deployment environments
      let baseUrl: string;
      if (process.env.APP_URL) {
        // Custom app URL (recommended for Railway)
        baseUrl = process.env.APP_URL;
      } else if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        // Railway deployment
        baseUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
      } else if (process.env.REPLIT_DEPLOYMENT_URL) {
        // Replit deployment
        baseUrl = `https://${process.env.REPLIT_DEPLOYMENT_URL}`;
      } else if (process.env.REPLIT_DEV_DOMAIN) {
        // Replit development
        baseUrl = `https://${process.env.REPLIT_DEV_DOMAIN}`;
      } else {
        // Local development
        baseUrl = `http://localhost:5000`;
      }
      
      const callbackUrl = `${baseUrl}/snaptrade/callback`;
      console.log(`[SnapTrade] Generating auth link with callback: ${callbackUrl}`);
      
      const authLink = await getSnaptradeAuthLink(
        credentials.snaptradeUserId!,
        credentials.snaptradeUserSecret!,
        {
          broker,
          connectionType: connectionType || "trade",
          customRedirect: callbackUrl,
          reconnect,
        }
      );

      console.log(`[SnapTrade] Auth link generated: ${authLink ? 'success' : 'failed'}`);

      if (!authLink) {
        return res.status(500).json({ error: "Failed to generate auth link" });
      }

      res.json({ authLink });
    } catch (error: any) {
      console.error("SnapTrade auth-link error:", error);
      res.status(500).json({ error: error.message || "Failed to get auth link" });
    }
  });

  app.get("/api/snaptrade/connections", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const connections = await storage.getSnaptradeConnections(userId);
      res.json(connections);
    } catch (error: any) {
      console.error("SnapTrade connections error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch connections" });
    }
  });

  app.post("/api/snaptrade/sync", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { getSnaptradeAccounts, listSnaptradeAuthorizations, isSnaptradeConfigured } = require("./snaptrade");
      
      if (!isSnaptradeConfigured()) {
        return res.status(503).json({ error: "SnapTrade not configured" });
      }

      const credentials = await storage.getUserSnaptradeCredentials(userId);
      if (!credentials?.snaptradeUserId || !credentials?.snaptradeUserSecret) {
        return res.status(400).json({ error: "Not registered with SnapTrade" });
      }

      const authorizations = await listSnaptradeAuthorizations(
        credentials.snaptradeUserId,
        credentials.snaptradeUserSecret
      );
      console.log(`[SnapTrade] Found ${authorizations.length} authorizations`);
      
      // Log authorization details for debugging
      for (const auth of authorizations) {
        console.log(`[SnapTrade] Authorization: id=${auth.id}, brokerage=${JSON.stringify(auth.brokerage)}, type=${auth.type}`);
      }

      const accounts = await getSnaptradeAccounts(
        credentials.snaptradeUserId,
        credentials.snaptradeUserSecret
      );
      console.log(`[SnapTrade] Found ${accounts.length} accounts`);
      
      // Log account details for debugging
      for (const account of accounts) {
        console.log(`[SnapTrade] Account: id=${account.id}, brokerName=${account.brokerName}, authId=${account.brokerageAuthorizationId}`);
      }

      const existingConnections = await storage.getSnaptradeConnections(userId);

      // Track which existing connections are still valid
      const validConnectionIds = new Set<string>();

      for (const account of accounts) {
        const existing = existingConnections.find(
          (c) => c.brokerageAuthorizationId === account.brokerageAuthorizationId && c.accountId === account.id
        );

        const auth = authorizations.find((a: any) => a.id === account.brokerageAuthorizationId);
        
        // Get broker name from authorization if account doesn't have it
        const brokerName = (account.brokerName && account.brokerName !== "Unknown") 
          ? account.brokerName 
          : (auth?.brokerage?.name || auth?.brokerage_name || auth?.name || null);
        const brokerSlug = auth?.brokerage?.slug || auth?.brokerage_slug || null;
        console.log(`[SnapTrade] Account ${account.id}: brokerName=${brokerName}, brokerSlug=${brokerSlug}`);

        // Skip accounts with unknown/missing broker info - don't create incomplete connections
        if (!brokerName || brokerName === "Unknown" || brokerName === "Unknown Broker") {
          console.log(`[SnapTrade] Skipping account ${account.id}: no valid broker name found`);
          // If there's an existing connection, keep it valid but don't update with bad data
          if (existing) {
            validConnectionIds.add(existing.id);
          }
          continue;
        }

        if (!existing) {
          const newConnection = await storage.createSnaptradeConnection({
            userId,
            brokerageAuthorizationId: account.brokerageAuthorizationId,
            brokerName,
            brokerSlug,
            accountId: account.id,
            accountName: account.name,
            accountNumber: account.number,
            accountType: account.type,
            isActive: true,
            isTradingEnabled: auth?.type === "trade",
            lastSyncAt: new Date(),
          });
          validConnectionIds.add(newConnection.id);
        } else {
          await storage.updateSnaptradeConnection(existing.id, {
            brokerName,
            accountName: account.name,
            accountNumber: account.number,
            accountType: account.type,
            isTradingEnabled: auth?.type === "trade",
            lastSyncAt: new Date(),
          });
          validConnectionIds.add(existing.id);
        }
      }

      // Remove connections that are no longer in SnapTrade (disconnected brokerages)
      // Only cleanup if we have at least one account OR no authorizations (user disconnected all)
      const shouldCleanup = accounts.length > 0 || authorizations.length === 0;
      if (shouldCleanup) {
        for (const existingConn of existingConnections) {
          if (!validConnectionIds.has(existingConn.id)) {
            console.log(`[SnapTrade] Removing stale connection: ${existingConn.id}`);
            await storage.deleteSnaptradeConnection(existingConn.id);
          }
        }
      } else {
        console.log(`[SnapTrade] Skipping cleanup - API returned 0 accounts but ${authorizations.length} authorizations (possible API issue)`);
      }

      const updatedConnections = await storage.getSnaptradeConnections(userId);
      res.json({ 
        success: true, 
        message: `Synced ${accounts.length} account(s), removed ${existingConnections.length - validConnectionIds.size} stale connection(s)`,
        connections: updatedConnections 
      });
    } catch (error: any) {
      console.error("SnapTrade sync error:", error);
      res.status(500).json({ error: error.message || "Failed to sync accounts" });
    }
  });

  app.delete("/api/snaptrade/connections/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { id } = req.params;
      const { removeSnaptradeAuthorization, isSnaptradeConfigured } = require("./snaptrade");
      
      const connection = await storage.getSnaptradeConnection(id);
      if (!connection || connection.userId !== userId) {
        return res.status(404).json({ error: "Connection not found" });
      }

      if (isSnaptradeConfigured()) {
        const credentials = await storage.getUserSnaptradeCredentials(userId);
        if (credentials?.snaptradeUserId && credentials?.snaptradeUserSecret) {
          await removeSnaptradeAuthorization(
            credentials.snaptradeUserId,
            credentials.snaptradeUserSecret,
            connection.brokerageAuthorizationId
          );
        }
      }

      await storage.deleteSnaptradeConnectionsByAuthId(connection.brokerageAuthorizationId);

      res.json({ success: true, message: "Connection removed" });
    } catch (error: any) {
      console.error("SnapTrade delete connection error:", error);
      res.status(500).json({ error: error.message || "Failed to delete connection" });
    }
  });

  app.get("/api/snaptrade/accounts/:accountId/balance", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { accountId } = req.params;
      const { getSnaptradeBalance, isSnaptradeConfigured } = require("./snaptrade");
      
      if (!isSnaptradeConfigured()) {
        return res.status(503).json({ error: "SnapTrade not configured" });
      }

      const credentials = await storage.getUserSnaptradeCredentials(userId);
      if (!credentials?.snaptradeUserId || !credentials?.snaptradeUserSecret) {
        return res.status(400).json({ error: "Not registered with SnapTrade" });
      }

      const balances = await getSnaptradeBalance(
        credentials.snaptradeUserId,
        credentials.snaptradeUserSecret,
        accountId
      );

      res.json(balances);
    } catch (error: any) {
      console.error("SnapTrade balance error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch balance" });
    }
  });

  app.get("/api/snaptrade/holdings", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { accountId } = req.query;
      const { getSnaptradeHoldings, isSnaptradeConfigured } = require("./snaptrade");
      
      if (!isSnaptradeConfigured()) {
        return res.status(503).json({ error: "SnapTrade not configured" });
      }

      const credentials = await storage.getUserSnaptradeCredentials(userId);
      if (!credentials?.snaptradeUserId || !credentials?.snaptradeUserSecret) {
        return res.status(400).json({ error: "Not registered with SnapTrade" });
      }

      const holdings = await getSnaptradeHoldings(
        credentials.snaptradeUserId,
        credentials.snaptradeUserSecret,
        accountId as string | undefined
      );

      res.json(holdings);
    } catch (error: any) {
      console.error("SnapTrade holdings error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch holdings" });
    }
  });

  app.post("/api/snaptrade/orders", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { accountId, symbol, action, orderType, quantity, price, stopPrice, timeInForce } = req.body;
      const { placeSnaptradeOrder, isSnaptradeConfigured } = require("./snaptrade");
      
      if (!isSnaptradeConfigured()) {
        return res.status(503).json({ error: "SnapTrade not configured" });
      }

      if (!accountId || !symbol || !action || !orderType || !quantity) {
        return res.status(400).json({ error: "Missing required order parameters" });
      }

      // Validate quantity is a positive number
      const parsedQuantity = parseInt(quantity);
      if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
        return res.status(400).json({ error: "Quantity must be a positive number" });
      }

      // Validate action
      if (!["BUY", "SELL"].includes(action.toUpperCase())) {
        return res.status(400).json({ error: "Action must be BUY or SELL" });
      }

      const credentials = await storage.getUserSnaptradeCredentials(userId);
      if (!credentials?.snaptradeUserId || !credentials?.snaptradeUserSecret) {
        return res.status(400).json({ error: "Not registered with SnapTrade" });
      }

      // Verify account ownership - check that this account belongs to the user
      const userConnections = await storage.getSnaptradeConnections(userId);
      const accountOwned = userConnections.some(conn => conn.accountId === accountId);
      if (!accountOwned) {
        return res.status(403).json({ error: "Account not found or not authorized" });
      }

      const orderResult = await placeSnaptradeOrder(
        credentials.snaptradeUserId,
        credentials.snaptradeUserSecret,
        {
          accountId,
          symbol,
          action: action.toUpperCase(),
          orderType,
          quantity: parsedQuantity,
          price,
          stopPrice,
          timeInForce,
        }
      );

      res.json(orderResult);
    } catch (error: any) {
      console.error("SnapTrade order error:", error);
      res.status(500).json({ error: error.message || "Failed to place order" });
    }
  });

  app.get("/api/snaptrade/brokers", async (req, res) => {
    try {
      const { getSupportedBrokers, isSnaptradeConfigured } = require("./snaptrade");
      
      if (!isSnaptradeConfigured()) {
        return res.status(503).json({ error: "SnapTrade not configured" });
      }

      const brokers = await getSupportedBrokers();
      res.json(brokers);
    } catch (error: any) {
      console.error("SnapTrade brokers error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch brokers" });
    }
  });

  app.post("/api/push/subscribe", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const { endpoint, keys } = req.body;
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: "Invalid subscription data" });
      }
      const subscription = await storage.createPushSubscription({
        userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      });
      res.json(subscription);
    } catch (error) {
      res.status(500).json({ error: "Failed to save subscription" });
    }
  });

  app.get("/api/backtest/results", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const results = await storage.getBacktestResults(userId);
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Failed to get backtest results" });
    }
  });

  // Admin endpoint to manually trigger scheduled scan (for testing)
  app.post("/api/scheduled-scan/run", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const result = await runManualScheduledScan();
      res.json(result);
    } catch (error: any) {
      console.error("Manual scheduled scan error:", error);
      res.status(500).json({ error: error.message || "Failed to run scheduled scan" });
    }
  });

  app.post("/api/backtest/run", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      
      const { ticker, startDate, endDate, initialCapital, positionSize, stopLossPercent, strategy = StrategyType.VCP } = req.body;
      
      if (!ticker) {
        return res.status(400).json({ error: "Ticker symbol is required" });
      }

      const connection = await storage.getBrokerConnectionWithToken(userId);
      let candles: any[] = [];
      
      const warmupStart = new Date(startDate);
      warmupStart.setDate(warmupStart.getDate() - 100);
      const warmupStartStr = warmupStart.toISOString().split('T')[0];
      
      if (connection?.accessToken && connection?.isConnected) {
        try {
          candles = await fetchHistoryWithDateRange(connection, ticker.toUpperCase(), warmupStartStr, endDate);
        } catch (brokerError: any) {
          console.error("Broker fetch failed for backtest:", brokerError.message);
        }
      }

      if (candles.length === 0) {
        return res.status(400).json({ error: "No historical data available. Connect a broker to run backtests." });
      }

      if (candles.length < 60) {
        return res.status(400).json({ error: "Not enough data available. Need at least 60 trading days for accurate analysis." });
      }
      
      const startIdx = candles.findIndex(c => c.time >= startDate);
      if (startIdx < 0) {
        return res.status(400).json({ error: "No data available in the requested date range. Try a different date range." });
      }
      
      const lastCandleDate = candles[candles.length - 1].time;
      if (lastCandleDate < startDate) {
        return res.status(400).json({ error: "Available data ends before the requested start date. Try an earlier date range." });
      }
      
      const ema50WarmupIdx = 55;
      const actualStartIdx = Math.max(startIdx, ema50WarmupIdx);
      
      if (actualStartIdx >= candles.length) {
        return res.status(400).json({ error: "Not enough warm-up data before the requested start date. Try a later start date." });
      }

      const trades: any[] = [];
      let inPosition = false;
      let entryPrice = 0;
      let entryDate = "";
      let stopPrice = 0;
      let holdingDays = 0;
      const maxHoldingDays = 60;

      const calcEMA = (data: number[], period: number): number[] => {
        const k = 2 / (period + 1);
        const emaArray: number[] = new Array(data.length).fill(0);
        
        if (data.length < period) {
          return emaArray;
        }
        
        let sum = 0;
        for (let i = 0; i < period; i++) {
          sum += data[i];
          emaArray[i] = sum / (i + 1);
        }
        emaArray[period - 1] = sum / period;
        
        for (let i = period; i < data.length; i++) {
          emaArray[i] = data[i] * k + emaArray[i - 1] * (1 - k);
        }
        return emaArray;
      };

      const closes = candles.map(c => c.close);
      const highs = candles.map(c => c.high);
      const lows = candles.map(c => c.low);
      const volumes = candles.map(c => c.volume);
      const ema9 = calcEMA(closes, 9);
      const ema21 = calcEMA(closes, 21);
      const ema50 = calcEMA(closes, 50);

      for (let i = actualStartIdx; i < candles.length; i++) {
        const candle = candles[i];
        const avgVol20 = volumes.slice(i - 20, i).reduce((s, v) => s + v, 0) / 20;
        
        if (!inPosition) {
          let shouldEnter = false;
          
          if (strategy === StrategyType.CLASSIC_PULLBACK) {
            const inUptrend = ema9[i] > ema21[i] && ema21[i] > ema50[i];
            const priceAboveEMAs = candle.close > ema9[i];
            const hadPullback = candles.slice(i - 10, i).some(c => c.low <= ema21[i - 5] * 1.02);
            const volumeSpike = candle.volume > avgVol20 * 1.3;
            const bullishCandle = candle.close > candle.open;
            shouldEnter = inUptrend && priceAboveEMAs && hadPullback && volumeSpike && bullishCandle;
          } else if (strategy === StrategyType.VCP_MULTIDAY) {
            const lookback = Math.min(30, i);
            const recentHighs = highs.slice(i - lookback, i);
            const recentLows = lows.slice(i - lookback, i);
            const pivotHigh = Math.max(...recentHighs);
            const consolidationLow = Math.min(...recentLows);
            
            const range1 = Math.max(...highs.slice(i - lookback, i - Math.floor(lookback * 0.66))) - 
                          Math.min(...lows.slice(i - lookback, i - Math.floor(lookback * 0.66)));
            const range2 = Math.max(...highs.slice(i - Math.floor(lookback * 0.66), i - Math.floor(lookback * 0.33))) - 
                          Math.min(...lows.slice(i - Math.floor(lookback * 0.66), i - Math.floor(lookback * 0.33)));
            const range3 = Math.max(...highs.slice(i - Math.floor(lookback * 0.33), i)) - 
                          Math.min(...lows.slice(i - Math.floor(lookback * 0.33), i));
            
            const volatilityContracting = range1 > range2 && range2 > range3;
            const breakingOut = candle.close > pivotHigh * 0.99;
            const volumeConfirm = candle.volume > avgVol20 * 1.5;
            const inUptrend = ema21[i] > ema50[i];
            
            shouldEnter = volatilityContracting && breakingOut && volumeConfirm && inUptrend;
          } else {
            if (i < 15) {
              shouldEnter = false;
            } else {
              const lookback = 20;
              const effectiveLookback = Math.min(lookback, i);
              const recentHigh = Math.max(...highs.slice(i - effectiveLookback, i));
              
              const rangeStartIdx = Math.max(0, i - 10);
              const priorRanges = highs.slice(rangeStartIdx, i - 1).map((h, idx) => h - lows.slice(rangeStartIdx, i - 1)[idx]);
              const avgPriorRange = priorRanges.length > 0 ? priorRanges.reduce((s, r) => s + r, 0) / priorRanges.length : candle.high - candle.low;
              const last3Ranges = priorRanges.slice(-3);
              const recentRangeMin = last3Ranges.length > 0 ? Math.min(...last3Ranges) : avgPriorRange;
              
              const hadTightConsolidation = recentRangeMin < avgPriorRange * 0.8;
              const breakingOut = candle.close > recentHigh * 0.995;
              const volumeConfirm = candle.volume > avgVol20 * 1.1;
              const inUptrend = ema9[i] > ema21[i];
              
              shouldEnter = hadTightConsolidation && breakingOut && volumeConfirm && inUptrend;
            }
          }
          
          if (shouldEnter) {
            inPosition = true;
            entryPrice = candle.close;
            entryDate = candle.time.split('T')[0];
            stopPrice = entryPrice * (1 - stopLossPercent / 100);
            holdingDays = 0;
          }
        } else {
          holdingDays++;
          const currentReturn = ((candle.close - entryPrice) / entryPrice) * 100;
          
          if (candle.low <= stopPrice) {
            trades.push({
              ticker,
              entryDate,
              exitDate: candle.time.split('T')[0],
              entryPrice: Number(entryPrice.toFixed(2)),
              exitPrice: Number(stopPrice.toFixed(2)),
              returnPercent: Number((((stopPrice - entryPrice) / entryPrice) * 100).toFixed(2)),
              exitReason: "Stop Loss",
            });
            inPosition = false;
          } else if (currentReturn >= 10) {
            trades.push({
              ticker,
              entryDate,
              exitDate: candle.time.split('T')[0],
              entryPrice: Number(entryPrice.toFixed(2)),
              exitPrice: Number(candle.close.toFixed(2)),
              returnPercent: Number(currentReturn.toFixed(2)),
              exitReason: "Target",
            });
            inPosition = false;
          } else if (holdingDays >= maxHoldingDays) {
            trades.push({
              ticker,
              entryDate,
              exitDate: candle.time.split('T')[0],
              entryPrice: Number(entryPrice.toFixed(2)),
              exitPrice: Number(candle.close.toFixed(2)),
              returnPercent: Number(currentReturn.toFixed(2)),
              exitReason: "Time Exit",
            });
            inPosition = false;
          } else if (currentReturn >= 5 && candle.close < ema9[i]) {
            trades.push({
              ticker,
              entryDate,
              exitDate: candle.time.split('T')[0],
              entryPrice: Number(entryPrice.toFixed(2)),
              exitPrice: Number(candle.close.toFixed(2)),
              returnPercent: Number(currentReturn.toFixed(2)),
              exitReason: "Trailing Stop",
            });
            inPosition = false;
          }
        }
      }

      if (inPosition && candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        const currentReturn = ((lastCandle.close - entryPrice) / entryPrice) * 100;
        trades.push({
          ticker,
          entryDate,
          exitDate: lastCandle.time.split('T')[0],
          entryPrice: Number(entryPrice.toFixed(2)),
          exitPrice: Number(lastCandle.close.toFixed(2)),
          returnPercent: Number(currentReturn.toFixed(2)),
          exitReason: "Open Position",
        });
      }

      const wins = trades.filter(t => t.returnPercent > 0).length;
      const avgReturn = trades.length > 0 ? trades.reduce((sum, t) => sum + t.returnPercent, 0) / trades.length : 0;
      const totalReturn = trades.reduce((sum, t) => sum + t.returnPercent, 0);
      const returns = trades.map(t => t.returnPercent);
      const maxDrawdown = returns.length > 0 ? Math.abs(Math.min(...returns, 0)) : 0;
      const stdDev = returns.length > 1 
        ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
        : 0;
      const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252 / Math.max(1, trades.length)) : 0;

      const result = await storage.createBacktestResult({
        userId,
        ticker: ticker.toUpperCase(),
        startDate,
        endDate,
        initialCapital,
        positionSize,
        stopLossPercent,
        totalTrades: trades.length,
        winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
        avgReturn,
        maxDrawdown,
        sharpeRatio: Number(sharpeRatio.toFixed(2)),
        totalReturn,
        trades,
      });

      res.json(result);
    } catch (error) {
      console.error("Backtest error:", error);
      res.status(500).json({ error: "Failed to run backtest" });
    }
  });

  app.delete("/api/backtest/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.deleteBacktestResult(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete backtest" });
    }
  });

  app.get("/api/automation/settings", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const settings = await storage.getAutomationSettings(userId);
      if (!settings) {
        return res.json({
          isEnabled: false,
          webhookUrl: null,
          hasApiKey: false,
          autoEntryEnabled: true,
          autoExitEnabled: true,
          minScore: 70,
          maxPositions: 5,
          defaultPositionSize: 1000,
        });
      }
      res.json({
        isEnabled: settings.isEnabled,
        webhookUrl: settings.webhookUrl,
        hasApiKey: !!settings.encryptedApiKey,
        autoEntryEnabled: settings.autoEntryEnabled,
        autoExitEnabled: settings.autoExitEnabled,
        minScore: settings.minScore,
        maxPositions: settings.maxPositions,
        defaultPositionSize: settings.defaultPositionSize,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get automation settings" });
    }
  });

  app.post("/api/automation/settings", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const { apiKey, ...settingsData } = req.body;
      
      const settings = await storage.setAutomationSettingsWithApiKey(
        userId,
        {
          ...settingsData,
          userId,
        },
        apiKey
      );
      
      res.json({
        isEnabled: settings.isEnabled,
        webhookUrl: settings.webhookUrl,
        hasApiKey: !!settings.encryptedApiKey,
        autoEntryEnabled: settings.autoEntryEnabled,
        autoExitEnabled: settings.autoExitEnabled,
        minScore: settings.minScore,
        maxPositions: settings.maxPositions,
        defaultPositionSize: settings.defaultPositionSize,
      });
    } catch (error) {
      console.error("Failed to save automation settings:", error);
      res.status(500).json({ error: "Failed to save automation settings" });
    }
  });

  app.get("/api/automation/logs", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await storage.getAutomationLogs(userId, limit);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to get automation logs" });
    }
  });

  app.post("/api/automation/test", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const settingsWithKey = await storage.getAutomationSettingsWithApiKey(userId);
      if (!settingsWithKey) {
        return res.status(400).json({ error: "Please configure automation settings first" });
      }
      
      if (!settingsWithKey.webhookUrl) {
        return res.status(400).json({ error: "Please enter a webhook URL before testing" });
      }
      
      if (!settingsWithKey.apiKey) {
        return res.status(400).json({ error: "Please enter an API key before testing" });
      }
      
      const testSignal: EntrySignal = {
        symbol: "TEST",
        lastPrice: 100.00,
        targetPrice: 110.00,
        stopLoss: 95.00,
      };
      
      const result = await sendEntrySignal(
        { ...settingsWithKey, isEnabled: true, autoEntryEnabled: true },
        testSignal,
        settingsWithKey.apiKey
      );
      
      const logEntry = createAutomationLogEntry(
        userId,
        "entry",
        "TEST",
        result.message,
        result
      );
      await storage.createAutomationLog(logEntry);
      
      res.json({
        success: result.success,
        message: result.message,
        error: result.error ? "Webhook request failed. Please check your URL and API key." : undefined,
      });
    } catch (error) {
      console.error("Automation test failed:", error);
      res.status(500).json({ error: "Test failed. Please check your settings and try again." });
    }
  });

  app.post("/api/automation/send-signal", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const { type, symbol, lastPrice, targetPrice, stopLoss, reason } = req.body;
      
      const settingsWithKey = await storage.getAutomationSettingsWithApiKey(userId);
      if (!settingsWithKey || !settingsWithKey.isEnabled) {
        return res.status(400).json({ error: "Automation not enabled" });
      }
      
      let result;
      if (type === "entry") {
        const signal: EntrySignal = { symbol, lastPrice, targetPrice, stopLoss };
        result = await sendEntrySignal(settingsWithKey, signal, settingsWithKey.apiKey);
      } else if (type === "exit") {
        const signal: ExitSignal = { symbol, reason, targetPrice };
        result = await sendExitSignal(settingsWithKey, signal, settingsWithKey.apiKey);
      } else {
        return res.status(400).json({ error: "Invalid signal type" });
      }
      
      const logEntry = createAutomationLogEntry(userId, type, symbol, result.message, result);
      await storage.createAutomationLog(logEntry);
      
      res.json({
        success: result.success,
        message: result.message,
        error: result.error,
      });
    } catch (error) {
      console.error("Failed to send signal:", error);
      res.status(500).json({ error: "Failed to send signal" });
    }
  });

  app.get("/api/automation-profiles", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const profiles = await storage.getAutomationProfiles(userId);
      const sanitizedProfiles = profiles.map(p => ({
        ...p,
        encryptedApiKey: undefined,
        apiKeyIv: undefined,
        apiKeyAuthTag: undefined,
        hasApiKey: !!p.encryptedApiKey,
      }));
      
      res.json(sanitizedProfiles);
    } catch (error) {
      console.error("Failed to get automation profiles:", error);
      res.status(500).json({ error: "Failed to get automation profiles" });
    }
  });

  app.post("/api/automation-profiles", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const { name, webhookUrl, apiKey, mode, isEnabled, guardrails } = req.body;
      
      if (!name || !webhookUrl) {
        return res.status(400).json({ error: "Name and webhook URL are required" });
      }
      
      const existingProfiles = await storage.getAutomationProfiles(userId);
      if (existingProfiles.some(p => p.name.toLowerCase() === name.toLowerCase())) {
        return res.status(400).json({ error: "A profile with this name already exists" });
      }
      
      const profile = await storage.createAutomationProfile({
        userId,
        name,
        webhookUrl,
        mode: mode || "NOTIFY_ONLY",
        isEnabled: isEnabled ?? true,
        guardrails: guardrails || null,
      }, apiKey);
      
      res.json({
        ...profile,
        encryptedApiKey: undefined,
        apiKeyIv: undefined,
        apiKeyAuthTag: undefined,
        hasApiKey: !!apiKey,
      });
    } catch (error) {
      console.error("Failed to create automation profile:", error);
      res.status(500).json({ error: "Failed to create automation profile" });
    }
  });

  app.put("/api/automation-profiles/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const { id } = req.params;
      const { name, webhookUrl, apiKey, mode, isEnabled, guardrails } = req.body;
      
      const existingProfile = await storage.getAutomationProfile(id);
      if (!existingProfile || existingProfile.userId !== userId) {
        return res.status(404).json({ error: "Profile not found" });
      }
      
      if (name) {
        const existingProfiles = await storage.getAutomationProfiles(userId);
        if (existingProfiles.some(p => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) {
          return res.status(400).json({ error: "A profile with this name already exists" });
        }
      }
      
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (webhookUrl !== undefined) updateData.webhookUrl = webhookUrl;
      if (mode !== undefined) updateData.mode = mode;
      if (isEnabled !== undefined) updateData.isEnabled = isEnabled;
      if (guardrails !== undefined) updateData.guardrails = guardrails;
      
      const updated = await storage.updateAutomationProfile(id, updateData, apiKey);
      
      res.json({
        ...updated,
        encryptedApiKey: undefined,
        apiKeyIv: undefined,
        apiKeyAuthTag: undefined,
        hasApiKey: !!(updated?.encryptedApiKey || apiKey),
      });
    } catch (error) {
      console.error("Failed to update automation profile:", error);
      res.status(500).json({ error: "Failed to update automation profile" });
    }
  });

  app.delete("/api/automation-profiles/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const { id } = req.params;
      
      const existingProfile = await storage.getAutomationProfile(id);
      if (!existingProfile || existingProfile.userId !== userId) {
        return res.status(404).json({ error: "Profile not found" });
      }
      
      await storage.deleteAutomationProfile(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to delete automation profile:", error);
      res.status(500).json({ error: "Failed to delete automation profile" });
    }
  });

  app.post("/api/automation-profiles/:id/test", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const { id } = req.params;
      
      const profileWithKey = await storage.getAutomationProfileWithApiKey(id);
      if (!profileWithKey || profileWithKey.userId !== userId) {
        return res.status(404).json({ error: "Profile not found" });
      }
      
      if (!profileWithKey.webhookUrl) {
        return res.status(400).json({ error: "Profile has no webhook URL configured" });
      }
      
      const testSignal: EntrySignal = {
        symbol: "TEST",
        lastPrice: 100.00,
        targetPrice: 110.00,
        stopLoss: 95.00,
      };
      
      const testSettings = {
        ...profileWithKey,
        id: profileWithKey.id,
        userId: profileWithKey.userId,
        isEnabled: true,
        autoEntryEnabled: true,
        autoExitEnabled: true,
        minScore: 0,
        maxPositions: 5,
        defaultPositionSize: 1000,
        createdAt: profileWithKey.createdAt,
        updatedAt: profileWithKey.updatedAt,
      };
      
      const result = await sendEntrySignal(testSettings, testSignal, profileWithKey.apiKey);
      
      await storage.updateProfileTestResult(id, result.success ? 200 : 500, result.message);
      
      res.json({
        success: result.success,
        message: result.message,
        error: result.error,
      });
    } catch (error) {
      console.error("Failed to test automation profile:", error);
      res.status(500).json({ error: "Failed to test automation profile" });
    }
  });

  app.get("/api/user-automation-settings", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const settings = await storage.getUserAutomationSettings(userId);
      res.json(settings || { userId, globalDefaultProfileId: null });
    } catch (error) {
      console.error("Failed to get user automation settings:", error);
      res.status(500).json({ error: "Failed to get user automation settings" });
    }
  });

  app.put("/api/user-automation-settings", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const { globalDefaultProfileId } = req.body;
      
      if (globalDefaultProfileId) {
        const profile = await storage.getAutomationProfile(globalDefaultProfileId);
        if (!profile || profile.userId !== userId) {
          return res.status(400).json({ error: "Invalid profile ID" });
        }
      }
      
      const settings = await storage.setUserAutomationSettings(userId, { 
        userId,
        globalDefaultProfileId: globalDefaultProfileId || null,
      });
      
      res.json(settings);
    } catch (error) {
      console.error("Failed to update user automation settings:", error);
      res.status(500).json({ error: "Failed to update user automation settings" });
    }
  });

  app.get("/api/user/opportunity-defaults", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const defaults = await storage.getOpportunityDefaults(userId);
      res.json(defaults);
    } catch (error) {
      console.error("Failed to get opportunity defaults:", error);
      res.status(500).json({ error: "Failed to get opportunity defaults" });
    }
  });

  const opportunityDefaultsSchema = z.object({
    defaultMode: z.enum(["single", "fusion"]).optional(),
    defaultStrategyId: z.string().optional(),
    defaultScanScope: z.enum(["watchlist", "symbol", "universe"]).optional(),
    defaultWatchlistId: z.string().nullable().optional(),
    defaultSymbol: z.string().nullable().optional(),
    defaultMarketIndex: z.string().nullable().optional(),
    defaultFilterPreset: z.string().optional(),
    autoRunOnLoad: z.boolean().optional(),
  });

  app.put("/api/user/opportunity-defaults", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const parsed = opportunityDefaultsSchema.parse(req.body);
      const defaults = await storage.setOpportunityDefaults(userId, parsed);
      res.json(defaults);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Failed to save opportunity defaults:", error);
      res.status(500).json({ error: "Failed to save opportunity defaults" });
    }
  });

  app.delete("/api/user/opportunity-defaults", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      await storage.deleteOpportunityDefaults(userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to delete opportunity defaults:", error);
      res.status(500).json({ error: "Failed to delete opportunity defaults" });
    }
  });

  app.get("/api/user/settings", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const settings = await storage.getUserSettings(userId);
      if (!settings) {
        return res.json({
          showTooltips: true,
          pushNotificationsEnabled: false,
          breakoutAlertsEnabled: true,
          stopAlertsEnabled: true,
          emaAlertsEnabled: true,
          approachingAlertsEnabled: true,
          hasSeenWelcomeTutorial: false,
          hasSeenScannerTutorial: false,
          hasSeenVcpTutorial: false,
          hasSeenAlertsTutorial: false,
          preferredDataSource: "brokerage",
          preferredStrategies: [],
          scanUniverse: "all",
          scanTimeframe: "1d",
          scanConfidenceMin: 75,
          actionMode: "ALERTS_ONLY",
          brokerPreference: null,
          safetyLimits: { maxTradesPerDay: 2, maxPositions: 3, riskPerTradeUsd: 500, maxDailyLossUsd: 1000 },
          setupCompleted: false,
          setupCompletedAt: null,
          autoAgentAcknowledged: false,
          autoAgentAcknowledgedAt: null,
          autoAgentAckVersion: null,
          automationMode: "ALERTS",
          automationEngine: "BUILT_IN",
          selectedAlgopilotxEndpointId: null,
          automationStatus: "DISABLED",
          traderType: "swing",
          onboardingStep: 0,
          positionSizingMethod: "fixed_dollar",
          positionSizingValue: 1000,
        });
      }
      
      res.json({
        showTooltips: settings.showTooltips === "true",
        pushNotificationsEnabled: settings.pushNotificationsEnabled === "true",
        breakoutAlertsEnabled: settings.breakoutAlertsEnabled === "true",
        stopAlertsEnabled: settings.stopAlertsEnabled === "true",
        emaAlertsEnabled: settings.emaAlertsEnabled === "true",
        approachingAlertsEnabled: settings.approachingAlertsEnabled === "true",
        hasSeenWelcomeTutorial: settings.hasSeenWelcomeTutorial === "true",
        hasSeenScannerTutorial: settings.hasSeenScannerTutorial === "true",
        hasSeenVcpTutorial: settings.hasSeenVcpTutorial === "true",
        hasSeenAlertsTutorial: settings.hasSeenAlertsTutorial === "true",
        preferredDataSource: settings.preferredDataSource || "brokerage",
        preferredStrategies: settings.preferredStrategies || [],
        scanUniverse: settings.scanUniverse || "all",
        scanTimeframe: settings.scanTimeframe || "1d",
        scanConfidenceMin: settings.scanConfidenceMin ?? 75,
        actionMode: settings.actionMode || "ALERTS_ONLY",
        brokerPreference: settings.brokerPreference || null,
        safetyLimits: settings.safetyLimits || { maxTradesPerDay: 2, maxPositions: 3, riskPerTradeUsd: 500, maxDailyLossUsd: 1000 },
        setupCompleted: settings.setupCompleted ?? false,
        setupCompletedAt: settings.setupCompletedAt || null,
        autoAgentAcknowledged: settings.autoAgentAcknowledged ?? false,
        autoAgentAcknowledgedAt: settings.autoAgentAcknowledgedAt || null,
        autoAgentAckVersion: settings.autoAgentAckVersion || null,
        automationMode: settings.automationMode || "ALERTS",
        automationEngine: settings.automationEngine || "BUILT_IN",
        selectedAlgopilotxEndpointId: settings.selectedAlgopilotxEndpointId || null,
        automationStatus: settings.automationStatus || "DISABLED",
        traderType: settings.traderType || "swing",
        onboardingStep: settings.onboardingStep ?? 0,
        positionSizingMethod: settings.positionSizingMethod || "fixed_dollar",
        positionSizingValue: settings.positionSizingValue ?? 1000,
      });
    } catch (error) {
      console.error("Failed to get user settings:", error);
      res.status(500).json({ error: "Failed to get user settings" });
    }
  });

  const handleUserSettingsUpdate: RequestHandler = async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      
      const parsed = userSettingsUpdateSchema.parse(req.body);
      const settings = await storage.setUserSettings(userId, parsed);
      
      res.json({
        showTooltips: settings.showTooltips === "true",
        pushNotificationsEnabled: settings.pushNotificationsEnabled === "true",
        breakoutAlertsEnabled: settings.breakoutAlertsEnabled === "true",
        stopAlertsEnabled: settings.stopAlertsEnabled === "true",
        emaAlertsEnabled: settings.emaAlertsEnabled === "true",
        approachingAlertsEnabled: settings.approachingAlertsEnabled === "true",
        hasSeenWelcomeTutorial: settings.hasSeenWelcomeTutorial === "true",
        hasSeenScannerTutorial: settings.hasSeenScannerTutorial === "true",
        hasSeenVcpTutorial: settings.hasSeenVcpTutorial === "true",
        hasSeenAlertsTutorial: settings.hasSeenAlertsTutorial === "true",
        preferredDataSource: settings.preferredDataSource || "brokerage",
        preferredStrategies: settings.preferredStrategies || [],
        scanUniverse: settings.scanUniverse || "all",
        scanTimeframe: settings.scanTimeframe || "1d",
        scanConfidenceMin: settings.scanConfidenceMin ?? 75,
        actionMode: settings.actionMode || "ALERTS_ONLY",
        brokerPreference: settings.brokerPreference || null,
        safetyLimits: settings.safetyLimits || { maxTradesPerDay: 2, maxPositions: 3, riskPerTradeUsd: 500, maxDailyLossUsd: 1000 },
        setupCompleted: settings.setupCompleted ?? false,
        setupCompletedAt: settings.setupCompletedAt || null,
        autoAgentAcknowledged: settings.autoAgentAcknowledged ?? false,
        autoAgentAcknowledgedAt: settings.autoAgentAcknowledgedAt || null,
        autoAgentAckVersion: settings.autoAgentAckVersion || null,
        automationMode: settings.automationMode || "ALERTS",
        automationEngine: settings.automationEngine || "BUILT_IN",
        selectedAlgopilotxEndpointId: settings.selectedAlgopilotxEndpointId || null,
        automationStatus: settings.automationStatus || "DISABLED",
        traderType: settings.traderType || "swing",
        onboardingStep: settings.onboardingStep ?? 0,
        positionSizingMethod: settings.positionSizingMethod || "fixed_dollar",
        positionSizingValue: settings.positionSizingValue ?? 1000,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.errors });
        return;
      }
      console.error("Failed to save user settings:", error);
      res.status(500).json({ error: "Failed to save user settings" });
    }
  };

  app.put("/api/user/settings", isAuthenticated, handleUserSettingsUpdate);
  app.patch("/api/user/settings", isAuthenticated, handleUserSettingsUpdate);

  app.get("/api/automation-events", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const limit = parseInt(req.query.limit as string) || 50;
      const events = await storage.getAutomationEvents(userId, limit);
      res.json(events);
    } catch (error) {
      console.error("Failed to get automation events:", error);
      res.status(500).json({ error: "Failed to get automation events" });
    }
  });

  app.get("/api/automation-events/pending", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const events = await storage.getPendingAutomationEvents(userId);
      res.json(events);
    } catch (error) {
      console.error("Failed to get pending automation events:", error);
      res.status(500).json({ error: "Failed to get pending events" });
    }
  });

  app.post("/api/automation-events/:id/approve", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const { id } = req.params;
      const events = await storage.getAutomationEvents(userId, 1000);
      const event = events.find(e => e.id === id);
      
      if (!event || event.userId !== userId) {
        return res.status(404).json({ error: "Event not found" });
      }
      
      if (event.action !== "QUEUED") {
        return res.status(400).json({ error: "Event is not pending approval" });
      }
      
      const profileWithKey = await storage.getAutomationProfileWithApiKey(event.profileId);
      if (!profileWithKey) {
        return res.status(400).json({ error: "Profile not found" });
      }
      
      const payload = event.payload as any;
      const testSettings = {
        ...profileWithKey,
        id: profileWithKey.id,
        userId: profileWithKey.userId,
        isEnabled: true,
        autoEntryEnabled: true,
        autoExitEnabled: true,
        minScore: 0,
        maxPositions: 5,
        defaultPositionSize: 1000,
        createdAt: profileWithKey.createdAt,
        updatedAt: profileWithKey.updatedAt,
      };
      
      const signal: EntrySignal = {
        symbol: event.symbol,
        lastPrice: payload?.lastPrice || 0,
        targetPrice: payload?.targetPrice || 0,
        stopLoss: payload?.stopLoss || 0,
      };
      
      const result = await sendEntrySignal(testSettings, signal, profileWithKey.apiKey);
      
      await storage.updateAutomationEvent(id, {
        action: result.success ? "APPROVED" : "BLOCKED",
        responseStatus: result.success ? 200 : 500,
        responseBody: result.message,
      });
      
      res.json({ success: result.success, message: result.message });
    } catch (error) {
      console.error("Failed to approve automation event:", error);
      res.status(500).json({ error: "Failed to approve event" });
    }
  });

  app.post("/api/automation-events/:id/reject", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const { id } = req.params;
      const events = await storage.getAutomationEvents(userId, 1000);
      const event = events.find(e => e.id === id);
      
      if (!event || event.userId !== userId) {
        return res.status(404).json({ error: "Event not found" });
      }
      
      if (event.action !== "QUEUED") {
        return res.status(400).json({ error: "Event is not pending approval" });
      }
      
      await storage.updateAutomationEvent(id, {
        action: "REJECTED",
        reason: "Manually rejected by user",
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to reject automation event:", error);
      res.status(500).json({ error: "Failed to reject event" });
    }
  });

  // AlgoPilotX Integration Endpoints
  app.get("/api/algo-pilotx/connection", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const connection = await storage.getAlgoPilotxConnection(userId);
      if (!connection) {
        return res.json({ connected: false });
      }

      res.json({
        connected: connection.isConnected,
        connectionType: connection.connectionType,
        webhookUrl: connection.webhookUrl,
        apiBaseUrl: connection.apiBaseUrl,
        lastTestedAt: connection.lastTestedAt,
        lastTestSuccess: connection.lastTestSuccess,
        createdAt: connection.createdAt,
      });
    } catch (error) {
      console.error("Failed to get AlgoPilotX connection:", error);
      res.status(500).json({ error: "Failed to get connection" });
    }
  });

  app.post("/api/algo-pilotx/connect", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { connectionType, webhookUrl, webhookSecret, apiBaseUrl } = req.body;

      if (!connectionType || !webhookUrl) {
        return res.status(400).json({ error: "Connection type and webhook URL are required" });
      }

      const connection = await storage.setAlgoPilotxConnection(
        userId,
        {
          connectionType,
          webhookUrl,
          apiBaseUrl: apiBaseUrl || "https://app.algopilotx.com",
          isConnected: true,
        },
        webhookSecret
      );

      res.json({
        success: true,
        connected: connection.isConnected,
        connectionType: connection.connectionType,
      });
    } catch (error) {
      console.error("Failed to connect AlgoPilotX:", error);
      res.status(500).json({ error: "Failed to connect" });
    }
  });

  app.post("/api/algo-pilotx/test", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const connectionWithSecrets = await storage.getAlgoPilotxConnectionWithSecrets(userId);
      if (!connectionWithSecrets) {
        return res.status(400).json({ error: "No AlgoPilotX connection found" });
      }

      if (!connectionWithSecrets.webhookUrl) {
        return res.status(400).json({ error: "Webhook URL not configured" });
      }

      // Send test ping to AlgoPilotX
      const testPayload = {
        type: "test",
        timestamp: new Date().toISOString(),
        message: "VCP Trader connection test",
      };

      try {
        const response = await fetch(connectionWithSecrets.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(connectionWithSecrets.webhookSecret && {
              "X-Webhook-Secret": connectionWithSecrets.webhookSecret,
            }),
          },
          body: JSON.stringify(testPayload),
        });

        const success = response.ok;
        await storage.updateAlgoPilotxConnectionTestResult(userId, success);

        if (success) {
          res.json({ success: true, message: "Connection test successful" });
        } else {
          res.json({ success: false, message: `Test failed: HTTP ${response.status}` });
        }
      } catch (fetchError: any) {
        await storage.updateAlgoPilotxConnectionTestResult(userId, false);
        res.json({ success: false, message: `Test failed: ${fetchError.message}` });
      }
    } catch (error) {
      console.error("Failed to test AlgoPilotX connection:", error);
      res.status(500).json({ error: "Failed to test connection" });
    }
  });

  app.delete("/api/algo-pilotx/disconnect", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      await storage.deleteAlgoPilotxConnection(userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to disconnect AlgoPilotX:", error);
      res.status(500).json({ error: "Failed to disconnect" });
    }
  });

  // Execution Requests (Send Setup to AlgoPilotX)
  app.get("/api/execution-requests", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const requests = await storage.getExecutionRequests(userId, limit);
      res.json(requests);
    } catch (error) {
      console.error("Failed to get execution requests:", error);
      res.status(500).json({ error: "Failed to get requests" });
    }
  });

  app.post("/api/execution/send", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { symbol, strategyId, timeframe, automationProfileId } = req.body;

      if (!symbol || !strategyId) {
        return res.status(400).json({ error: "Symbol and strategy ID are required" });
      }

      // Get user's AlgoPilotX connection
      const connectionWithSecrets = await storage.getAlgoPilotxConnectionWithSecrets(userId);
      if (!connectionWithSecrets || !connectionWithSecrets.isConnected) {
        return res.status(400).json({ error: "AlgoPilotX not connected" });
      }

      // Get latest scan result for this symbol
      const scanResult = await storage.getScanResult(symbol);
      if (!scanResult) {
        return res.status(404).json({ error: "No scan result found for symbol" });
      }

      // Build signed setup payload
      const nonce = crypto.randomUUID();
      const timestamp = new Date().toISOString();
      
      const setupPayload = {
        symbol: scanResult.ticker,
        strategyId,
        strategyName: strategyId,
        stage: scanResult.stage,
        price: scanResult.price,
        resistance: scanResult.resistance,
        stopLoss: scanResult.stopLoss,
        entryTrigger: scanResult.resistance,
        rvol: scanResult.rvol,
        patternScore: scanResult.patternScore,
        explanation: `${scanResult.stage} signal for ${scanResult.ticker} - Price: $${scanResult.price?.toFixed(2)}, Resistance: $${scanResult.resistance?.toFixed(2)}, Stop: $${scanResult.stopLoss?.toFixed(2)}`,
        timestamp,
        nonce,
      };

      // Create execution request record
      const executionRequest = await storage.createExecutionRequest({
        userId,
        symbol,
        strategyId,
        timeframe: timeframe || "1D",
        setupPayload,
        automationProfileId,
        status: "CREATED",
      });

      // Send to AlgoPilotX
      if (connectionWithSecrets.webhookUrl) {
        try {
          const webhookPayload = {
            type: "setup",
            executionRequestId: executionRequest.id,
            ...setupPayload,
          };

          const response = await fetch(connectionWithSecrets.webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(connectionWithSecrets.webhookSecret && {
                "X-Webhook-Secret": connectionWithSecrets.webhookSecret,
              }),
            },
            body: JSON.stringify(webhookPayload),
          });

          if (response.ok) {
            const responseData = await response.json().catch(() => ({}));
            await storage.updateExecutionRequest(executionRequest.id, {
              status: "SENT",
              algoPilotxReference: responseData.reference || responseData.id,
              redirectUrl: responseData.redirectUrl || `${connectionWithSecrets.apiBaseUrl}/instatrade?req=${executionRequest.id}`,
            });

            res.json({
              success: true,
              executionRequestId: executionRequest.id,
              redirectUrl: responseData.redirectUrl || `${connectionWithSecrets.apiBaseUrl}/instatrade?req=${executionRequest.id}`,
              message: "Setup sent to AlgoPilotX",
            });
          } else {
            await storage.updateExecutionRequest(executionRequest.id, {
              status: "FAILED",
              errorMessage: `HTTP ${response.status}`,
            });
            res.status(500).json({ error: "Failed to send to AlgoPilotX" });
          }
        } catch (fetchError: any) {
          await storage.updateExecutionRequest(executionRequest.id, {
            status: "FAILED",
            errorMessage: fetchError.message,
          });
          res.status(500).json({ error: `Failed to send: ${fetchError.message}` });
        }
      } else {
        res.status(400).json({ error: "No webhook URL configured" });
      }
    } catch (error) {
      console.error("Failed to send execution request:", error);
      res.status(500).json({ error: "Failed to send setup" });
    }
  });

  // Callback endpoint for AlgoPilotX to update execution status
  app.post("/api/execution/callback", async (req, res) => {
    try {
      const { execution_request_id, status, message, broker_order_ids, filled_price } = req.body;

      if (!execution_request_id || !status) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const request = await storage.getExecutionRequest(execution_request_id);
      if (!request) {
        return res.status(404).json({ error: "Execution request not found" });
      }

      // Update execution request status
      await storage.updateExecutionRequest(execution_request_id, {
        status: status.toUpperCase(),
        algoPilotxReference: broker_order_ids?.[0] || request.algoPilotxReference,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Failed to process execution callback:", error);
      res.status(500).json({ error: "Failed to process callback" });
    }
  });

  // Automation Endpoints CRUD
  app.get("/api/automation-endpoints", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const endpoints = await storage.getAutomationEndpoints(userId);
      res.json(endpoints);
    } catch (error) {
      console.error("Failed to get automation endpoints:", error);
      res.status(500).json({ error: "Failed to get endpoints" });
    }
  });

  app.get("/api/automation-endpoints/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const endpoint = await storage.getAutomationEndpoint(req.params.id);
      if (!endpoint || endpoint.userId !== userId) {
        return res.status(404).json({ error: "Endpoint not found" });
      }
      res.json(endpoint);
    } catch (error) {
      console.error("Failed to get automation endpoint:", error);
      res.status(500).json({ error: "Failed to get endpoint" });
    }
  });

  app.post("/api/automation-endpoints", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { name, webhookUrl, webhookSecret } = req.body;
      console.log("[Automation] Creating endpoint - webhookSecret provided:", !!webhookSecret, "length:", webhookSecret?.length || 0);
      if (!name || !webhookUrl) {
        return res.status(400).json({ error: "Name and webhook URL are required" });
      }

      const endpoint = await storage.createAutomationEndpoint(
        { userId, name, webhookUrl, isActive: true },
        webhookSecret
      );
      res.json(endpoint);
    } catch (error) {
      console.error("Failed to create automation endpoint:", error);
      res.status(500).json({ error: "Failed to create endpoint" });
    }
  });

  app.patch("/api/automation-endpoints/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const existing = await storage.getAutomationEndpoint(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Endpoint not found" });
      }

      const { name, webhookUrl, webhookSecret, isActive } = req.body;
      const endpoint = await storage.updateAutomationEndpoint(
        req.params.id,
        { name, webhookUrl, isActive },
        webhookSecret && webhookSecret.length > 0 ? webhookSecret : undefined
      );
      res.json(endpoint);
    } catch (error) {
      console.error("Failed to update automation endpoint:", error);
      res.status(500).json({ error: "Failed to update endpoint" });
    }
  });

  app.post("/api/automation-endpoints/:id/test", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const endpointWithSecret = await storage.getAutomationEndpointWithSecret(req.params.id);
      if (!endpointWithSecret || endpointWithSecret.userId !== userId) {
        return res.status(404).json({ error: "Endpoint not found" });
      }

      if (!endpointWithSecret.webhookUrl) {
        return res.status(400).json({ error: "Webhook URL not configured" });
      }

      const testPayload = {
        type: "test",
        timestamp: new Date().toISOString(),
        message: "VCP Trader connection test",
        endpointId: endpointWithSecret.id,
        endpointName: endpointWithSecret.name,
      };

      const response = await fetch(endpointWithSecret.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testPayload),
      });

      const success = response.ok;
      await storage.updateAutomationEndpointTestResult(req.params.id, success);

      res.json({ success, status: response.status });
    } catch (error: any) {
      console.error("Failed to test automation endpoint:", error);
      await storage.updateAutomationEndpointTestResult(req.params.id, false);
      res.json({ success: false, error: error.message });
    }
  });

  app.delete("/api/automation-endpoints/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const existing = await storage.getAutomationEndpoint(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Endpoint not found" });
      }

      await storage.deleteAutomationEndpoint(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to delete automation endpoint:", error);
      res.status(500).json({ error: "Failed to delete endpoint" });
    }
  });

  app.put("/api/automation-endpoints/:id/select", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const existing = await storage.getAutomationEndpoint(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Endpoint not found" });
      }

      await storage.setUserSettings(userId, { selectedAlgopilotxEndpointId: req.params.id });
      res.json({ success: true, selectedEndpointId: req.params.id });
    } catch (error) {
      console.error("Failed to select automation endpoint:", error);
      res.status(500).json({ error: "Failed to select endpoint" });
    }
  });

  // Trades CRUD
  app.get("/api/trades", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const status = req.query.status as string | undefined;
      const limit = parseInt(req.query.limit as string) || 50;
      const trades = await storage.getTrades(userId, status, limit);
      res.json(trades);
    } catch (error) {
      console.error("Failed to get trades:", error);
      res.status(500).json({ error: "Failed to get trades" });
    }
  });

  app.get("/api/trades/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const trade = await storage.getTrade(req.params.id);
      if (!trade || trade.userId !== userId) {
        return res.status(404).json({ error: "Trade not found" });
      }
      res.json(trade);
    } catch (error) {
      console.error("Failed to get trade:", error);
      res.status(500).json({ error: "Failed to get trade" });
    }
  });

  app.post("/api/trades", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { symbol, strategyId, endpointId, alertEventId, entryPrice, quantity, stopLoss, target, setupPayload } = req.body;
      if (!symbol || !strategyId) {
        return res.status(400).json({ error: "Symbol and strategyId are required" });
      }

      const trade = await storage.createTrade({
        userId,
        symbol,
        strategyId,
        endpointId,
        alertEventId,
        entryPrice,
        quantity,
        stopLoss,
        target,
        setupPayload,
        side: "LONG",
        status: "OPEN",
        source: "manual",
        entryTimestamp: new Date(),
      });
      res.json(trade);
    } catch (error) {
      console.error("Failed to create trade:", error);
      res.status(500).json({ error: "Failed to create trade" });
    }
  });

  app.patch("/api/trades/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const existing = await storage.getTrade(req.params.id);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Trade not found" });
      }

      const trade = await storage.updateTrade(req.params.id, req.body);
      res.json(trade);
    } catch (error) {
      console.error("Failed to update trade:", error);
      res.status(500).json({ error: "Failed to update trade" });
    }
  });

  // InstaTrade Entry - send to endpoint and create trade record
  app.post("/api/instatrade/entry", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { endpointId, symbol, strategyId, setupPayload, alertEventId } = req.body;
      if (!endpointId || !symbol || !strategyId) {
        return res.status(400).json({ error: "Endpoint, symbol, and strategyId are required" });
      }

      const endpointWithSecret = await storage.getAutomationEndpointWithSecret(endpointId);
      if (!endpointWithSecret || endpointWithSecret.userId !== userId) {
        return res.status(404).json({ error: "Endpoint not found" });
      }

      if (!endpointWithSecret.webhookUrl) {
        return res.status(400).json({ error: "Endpoint webhook URL not configured" });
      }

      const nonce = crypto.randomUUID();
      const entryPayload = {
        type: "entry",
        action: "BUY",
        symbol,
        strategyId,
        timestamp: new Date().toISOString(),
        nonce,
        ...setupPayload,
      };

      const executionRequest = await storage.createExecutionRequest({
        userId,
        symbol,
        strategyId,
        timeframe: setupPayload?.timeframe,
        setupPayload: entryPayload,
        automationProfileId: endpointId,
        endpointId,
        action: "BUY",
        status: "CREATED",
      });

      try {
        // AlgoPilotX stop-limit format for breakout entries
        // stop = trigger price (resistance/breakout level)
        // lp = limit price (slightly above stop to ensure fill after breakout)
        const entryPrice = setupPayload?.resistance || setupPayload?.entryTrigger || setupPayload?.price;
        const stopLoss = setupPayload?.stopLoss;
        const riskAmount = entryPrice && stopLoss ? entryPrice - stopLoss : 0;
        const targetPrice = entryPrice && riskAmount > 0 ? entryPrice + riskAmount : entryPrice;
        const stopPrice = entryPrice || 0;
        const limitPrice = stopPrice * 1.005; // 0.5% above stop for slippage buffer
        
        const webhookMessage = `enter sym=${symbol} type=STOP_LIMIT stop=${stopPrice.toFixed(2)} lp=${limitPrice.toFixed(2)} sl=${stopLoss?.toFixed(2) || 0} tp=${targetPrice?.toFixed(2) || 0}`;
        
        const response = await fetch(endpointWithSecret.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: webhookMessage,
        });

        if (response.ok) {
          const responseData = await response.json().catch(() => ({}));
          await storage.updateExecutionRequest(executionRequest.id, {
            status: "SENT",
            algoPilotxReference: responseData.reference || responseData.id,
          });

          const trade = await storage.createTrade({
            userId,
            symbol,
            strategyId,
            endpointId,
            alertEventId,
            entryExecutionId: executionRequest.id,
            side: "LONG",
            status: "OPEN",
            source: "instatrade",
            entryPrice: setupPayload?.price || setupPayload?.entryTrigger,
            stopLoss: setupPayload?.stopLoss,
            target: setupPayload?.resistance,
            setupPayload,
            entryTimestamp: new Date(),
          });

          res.json({
            success: true,
            executionRequestId: executionRequest.id,
            tradeId: trade.id,
            message: "Entry sent to AlgoPilotX",
          });
        } else {
          await storage.updateExecutionRequest(executionRequest.id, {
            status: "FAILED",
            errorMessage: `HTTP ${response.status}`,
          });
          res.status(500).json({ error: `Webhook returned ${response.status}` });
        }
      } catch (fetchError: any) {
        await storage.updateExecutionRequest(executionRequest.id, {
          status: "FAILED",
          errorMessage: fetchError.message,
        });
        res.status(500).json({ error: `Failed to send: ${fetchError.message}` });
      }
    } catch (error) {
      console.error("Failed to send entry:", error);
      res.status(500).json({ error: "Failed to send entry" });
    }
  });

  // News & Research - fetch headlines for a ticker (compliance-safe, no sentiment)
  app.get("/api/news", async (req, res) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || "unknown";
      
      if (!checkRateLimit(clientIp)) {
        return res.status(429).json({ ok: false, error: "Too many requests. Please wait a few minutes." });
      }
      
      const ticker = req.query.ticker as string;
      const items = parseInt(req.query.items as string) || 10;
      
      if (!ticker) {
        return res.status(400).json({ ok: false, error: "Please enter a ticker symbol" });
      }
      
      const result = await fetchNews(ticker, items);
      
      if (!result.ok) {
        return res.status(400).json(result);
      }
      
      res.json(result);
    } catch (error) {
      console.error("[News] Error:", error);
      res.status(500).json({ ok: false, error: "Couldn't load headlines right now. Try again." });
    }
  });

  app.get("/api/news/status", (req, res) => {
    res.json({ configured: isNewsConfigured() });
  });

  // InstaTrade Exit - send exit signal and close trade
  app.post("/api/instatrade/exit", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { tradeId, exitPrice } = req.body;
      if (!tradeId) {
        return res.status(400).json({ error: "Trade ID is required" });
      }

      const trade = await storage.getTrade(tradeId);
      if (!trade || trade.userId !== userId) {
        return res.status(404).json({ error: "Trade not found" });
      }

      if (trade.status !== "OPEN") {
        return res.status(400).json({ error: "Trade is not open" });
      }

      if (!trade.endpointId) {
        return res.status(400).json({ error: "Trade has no associated endpoint" });
      }

      const endpointWithSecret = await storage.getAutomationEndpointWithSecret(trade.endpointId);
      if (!endpointWithSecret || !endpointWithSecret.webhookUrl) {
        return res.status(400).json({ error: "Endpoint not found or webhook not configured" });
      }

      const nonce = crypto.randomUUID();
      const exitPayload = {
        type: "exit",
        action: "SELL",
        symbol: trade.symbol,
        strategyId: trade.strategyId,
        tradeId: trade.id,
        timestamp: new Date().toISOString(),
        nonce,
        entryPrice: trade.entryPrice,
        exitPrice,
      };

      const executionRequest = await storage.createExecutionRequest({
        userId,
        symbol: trade.symbol,
        strategyId: trade.strategyId,
        setupPayload: exitPayload,
        automationProfileId: trade.endpointId,
        endpointId: trade.endpointId,
        action: "SELL",
        status: "CREATED",
      });

      try {
        // AlgoPilotX format: exit sym=SYMBOL
        const webhookMessage = `exit sym=${trade.symbol}`;
        
        const response = await fetch(endpointWithSecret.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: webhookMessage,
        });

        if (response.ok) {
          await storage.updateExecutionRequest(executionRequest.id, { status: "SENT" });

          const finalExitPrice = exitPrice || trade.entryPrice;
          const pnl = trade.entryPrice && finalExitPrice ? (finalExitPrice - trade.entryPrice) * (trade.quantity || 1) : null;
          const pnlPercent = trade.entryPrice && finalExitPrice ? ((finalExitPrice - trade.entryPrice) / trade.entryPrice) * 100 : null;

          await storage.updateTrade(tradeId, {
            status: "CLOSED",
            exitExecutionId: executionRequest.id,
            exitPrice: finalExitPrice,
            exitTimestamp: new Date(),
            pnl,
            pnlPercent,
          });

          res.json({
            success: true,
            executionRequestId: executionRequest.id,
            message: "Exit sent to AlgoPilotX",
          });
        } else {
          await storage.updateExecutionRequest(executionRequest.id, {
            status: "FAILED",
            errorMessage: `HTTP ${response.status}`,
          });
          res.status(500).json({ error: `Webhook returned ${response.status}` });
        }
      } catch (fetchError: any) {
        await storage.updateExecutionRequest(executionRequest.id, {
          status: "FAILED",
          errorMessage: fetchError.message,
        });
        res.status(500).json({ error: `Failed to send: ${fetchError.message}` });
      }
    } catch (error) {
      console.error("Failed to send exit:", error);
      res.status(500).json({ error: "Failed to send exit" });
    }
  });

  // ─── External Trade Alerts (Strategy Fundamentals) ────────────────────

  // Parse Strategy Fundamentals rawText format
  // Entry: "enter sym=PWR lp=534.78 tp=584.9 sl=408.36"
  // Exit:  "exit sym=WDC reason=\"Profit Target1\" tp=307.96"
  // Exit:  "exit sym=XLY reason=\"Stop Loss\" sl=115.4"
  function parseSfRawText(rawText: string): {
    alertType: "entry" | "exit";
    symbol: string;
    entryPrice: number;
    riskPrice: number | null;
    targetPrice: number | null;
    exitReason: string | null;
  } | null {
    const text = rawText.trim();
    const actionMatch = text.match(/^(enter|exit)\s+/i);
    if (!actionMatch) return null;

    const alertType = actionMatch[1].toLowerCase() as "entry" | "exit";

    const symMatch = text.match(/sym=(\S+)/i);
    if (!symMatch) return null;
    const symbol = symMatch[1].toUpperCase();

    const lpMatch = text.match(/lp=([\d.]+)/i);
    const tpMatch = text.match(/tp=([\d.]+)/i);
    const slMatch = text.match(/sl=([\d.]+)/i);
    const reasonMatch = text.match(/reason="([^"]+)"/i)
      || text.match(/reason=(.+?)(?:\s+(?:tp|sl|sym|lp)=|$)/i);

    const targetPrice = tpMatch ? parseFloat(tpMatch[1]) : null;
    const riskPrice = slMatch ? parseFloat(slMatch[1]) : null;
    const exitReason = reasonMatch ? reasonMatch[1].trim() : null;

    if (alertType === "entry") {
      if (!lpMatch) return null;
      const entryPrice = parseFloat(lpMatch[1]);
      if (!entryPrice || entryPrice <= 0) return null;
      return { alertType, symbol, entryPrice, riskPrice, targetPrice, exitReason };
    } else {
      const exitPrice = tpMatch ? parseFloat(tpMatch[1]) : slMatch ? parseFloat(slMatch[1]) : 0;
      return { alertType, symbol, entryPrice: exitPrice, riskPrice, targetPrice, exitReason };
    }
  }

  // Webhook endpoint - authenticated via API key (not session)
  // Accepts either structured JSON or rawText from Strategy Fundamentals
  app.post("/api/external-alerts/webhook", async (req, res) => {
    try {
      const apiKey = (req.headers["x-api-key"] as string) || (req.query.token as string);
      if (!apiKey) {
        return res.status(401).json({ error: "Missing API key. Provide via X-API-Key header or ?token= query parameter" });
      }

      const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
      const apiKeyRecord = await storage.findExternalAlertApiKeyByHash(keyHash);
      if (!apiKeyRecord) {
        return res.status(401).json({ error: "Invalid API key" });
      }

      await storage.updateExternalAlertApiKeyLastUsed(apiKeyRecord.id);

      const body = req.body;
      let alertData: {
        alertType: "entry" | "exit";
        symbol: string;
        direction: string;
        strategyName: string;
        strategyGroup: string | null;
        entryPrice: number;
        riskPrice: number | null;
        targetPrice: number | null;
        exitReason: string | null;
      };

      if (body.rawText) {
        const parsed = parseSfRawText(body.rawText);
        if (!parsed) {
          return res.status(400).json({
            error: "Could not parse rawText",
            hint: 'Expected format: "enter sym=PWR lp=534.78 tp=584.9 sl=408.36" or "exit sym=WDC reason=\\"Stop Loss\\" sl=115.4"',
          });
        }
        alertData = {
          alertType: parsed.alertType,
          symbol: parsed.symbol,
          direction: parsed.alertType === "entry" ? "Long" : "Long",
          strategyName: body.strategy_name || "Strategy Fundamentals",
          strategyGroup: body.strategy_group || null,
          entryPrice: parsed.entryPrice,
          riskPrice: parsed.riskPrice,
          targetPrice: parsed.targetPrice,
          exitReason: parsed.exitReason,
        };
      } else {
        const { externalAlertWebhookSchema } = await import("@shared/schema");
        const parsed = externalAlertWebhookSchema.safeParse(body);
        if (!parsed.success) {
          return res.status(400).json({
            error: "Invalid alert payload",
            details: parsed.error.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`),
          });
        }
        const data = parsed.data;
        alertData = {
          alertType: "entry",
          symbol: data.symbol.toUpperCase(),
          direction: data.direction,
          strategyName: data.strategy_name,
          strategyGroup: data.strategy_group ?? null,
          entryPrice: data.entry_price,
          riskPrice: data.risk_price ?? null,
          targetPrice: data.target_price ?? null,
          exitReason: null,
        };
      }

      const alert = await storage.createExternalAlert({
        userId: apiKeyRecord.userId,
        source: "strategy_fundamentals",
        alertType: alertData.alertType,
        symbol: alertData.symbol,
        direction: alertData.direction,
        strategyName: alertData.strategyName,
        strategyGroup: alertData.strategyGroup,
        entryPrice: alertData.entryPrice,
        riskPrice: alertData.riskPrice,
        targetPrice: alertData.targetPrice,
        exitReason: alertData.exitReason,
        alertTimestamp: body.timestamp ? new Date(body.timestamp) : new Date(),
        status: "PENDING",
        rawPayload: body,
      });

      const typeLabel = alertData.alertType === "exit" ? "EXIT" : "ENTRY";
      console.log(`[ExternalAlerts] ${typeLabel}: ${alertData.symbol} ${alertData.exitReason ? `(${alertData.exitReason})` : ""} for user ${apiKeyRecord.userId}`);

      res.status(201).json({
        success: true,
        alertId: alert.id,
        alertType: alertData.alertType,
        message: `${typeLabel} alert received for ${alertData.symbol}`,
      });

      if (alertData.alertType === "entry") {
        try {
          const { processExternalAlerts } = await import("./agent-worker");
          processExternalAlerts(apiKeyRecord.userId).catch((err: any) =>
            console.error(`[ExternalAlerts] Background processing error for ${apiKeyRecord.userId}:`, err.message)
          );
        } catch (e) {}
      }
    } catch (error: any) {
      console.error("[ExternalAlerts] Webhook error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // List external alerts (authenticated)
  app.get("/api/external-alerts", isAuthenticated as RequestHandler, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const limit = parseInt(req.query.limit as string) || 50;
      const alerts = await storage.getExternalAlerts(userId, limit);
      res.json(alerts);
    } catch (error) {
      console.error("Failed to get external alerts:", error);
      res.status(500).json({ error: "Failed to get external alerts" });
    }
  });

  // Get single external alert
  app.get("/api/external-alerts/:id", isAuthenticated as RequestHandler, async (req, res) => {
    try {
      const alert = await storage.getExternalAlert(req.params.id);
      if (!alert) return res.status(404).json({ error: "Alert not found" });
      res.json(alert);
    } catch (error) {
      res.status(500).json({ error: "Failed to get alert" });
    }
  });

  // API Key management
  app.get("/api/external-alerts/api-keys/list", isAuthenticated as RequestHandler, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const keys = await storage.getExternalAlertApiKeys(userId);
      res.json(keys.map(k => ({
        id: k.id,
        prefix: k.keyPrefix,
        label: k.label,
        isActive: k.isActive,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
      })));
    } catch (error) {
      res.status(500).json({ error: "Failed to get API keys" });
    }
  });

  app.post("/api/external-alerts/api-keys", isAuthenticated as RequestHandler, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const label = req.body.label || "Default";
      const rawKey = `sfk_${crypto.randomBytes(32).toString("hex")}`;
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.substring(0, 12) + "...";

      const apiKey = await storage.createExternalAlertApiKey({
        userId,
        keyHash,
        keyPrefix,
        label,
        isActive: true,
      });

      res.status(201).json({
        id: apiKey.id,
        key: rawKey,
        prefix: keyPrefix,
        label,
        message: "Save this key - it won't be shown again",
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to create API key" });
    }
  });

  app.delete("/api/external-alerts/api-keys/:id", isAuthenticated as RequestHandler, async (req, res) => {
    try {
      await storage.deleteExternalAlertApiKey(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete API key" });
    }
  });

  // Test webhook endpoint (sends a test alert to yourself)
  app.post("/api/external-alerts/test", isAuthenticated as RequestHandler, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const alert = await storage.createExternalAlert({
        userId,
        source: "test",
        alertType: "entry",
        symbol: "AAPL",
        direction: "Long",
        strategyName: "Quick Range Breakout - Test",
        strategyGroup: "Test Signals",
        entryPrice: 185.50,
        riskPrice: 178.25,
        targetPrice: 198.00,
        alertTimestamp: new Date(),
        status: "PENDING",
        rawPayload: { rawText: "enter sym=AAPL lp=185.50 tp=198.00 sl=178.25", test: true },
      });

      res.json({ success: true, alertId: alert.id, message: "Test alert created" });
    } catch (error) {
      res.status(500).json({ error: "Failed to create test alert" });
    }
  });

  // =============================================
  // Partner Dashboard Routes
  // =============================================

  const isPartnerAuthenticated: RequestHandler = async (req, res, next) => {
    if (!req.session.partnerUserId) {
      return res.status(401).json({ error: "Partner authentication required" });
    }
    next();
  };

  // Partner login via signed token
  app.get("/api/partner/login", async (req, res) => {
    try {
      const { token, partner } = req.query as { token?: string; partner?: string };
      if (!token || !partner) {
        return res.status(400).json({ error: "Missing token or partner parameter" });
      }

      const partnerConfig = await storage.getPartnerConfig(partner);
      if (!partnerConfig) {
        return res.status(404).json({ error: "Unknown partner" });
      }

      let payload: { sub: string; email: string; name?: string; exp?: number; iat?: number };
      try {
        const jwt = await import("jsonwebtoken");
        payload = jwt.default.verify(token, partnerConfig.sharedSecret) as typeof payload;
      } catch (err: any) {
        return res.status(401).json({ error: "Invalid or expired token" });
      }

      if (!payload.sub || !payload.email) {
        return res.status(400).json({ error: "Token must contain sub and email claims" });
      }

      let partnerUser = await storage.getPartnerUser(partnerConfig.id, payload.sub);

      if (!partnerUser) {
        const randomPassword = crypto.randomBytes(32).toString("hex");
        const partnerEmail = `partner_${partner}_${payload.sub}@vcptrader.internal`;

        const linkedUser = await authStorage.createUser(
          partnerEmail,
          randomPassword,
          payload.name || payload.email.split("@")[0],
          ""
        );

        partnerUser = await storage.createPartnerUser({
          partnerId: partnerConfig.id,
          partnerSubscriberId: payload.sub,
          email: payload.email,
          name: payload.name || null,
          linkedUserId: linkedUser.id,
          isActive: true,
        });

        await storage.createExternalAlertApiKey({
          userId: linkedUser.id,
          keyHash: crypto.createHash("sha256").update(`auto_${linkedUser.id}`).digest("hex"),
          keyPrefix: "auto-provisioned",
          label: `${partnerConfig.name} Auto`,
          isActive: true,
        });
      } else {
        await storage.updatePartnerUser(partnerUser.id, { lastLoginAt: new Date() });
      }

      if ((payload as any)._admin_skip_checkout === true) {
        await storage.updatePartnerUser(partnerUser.id, {
          subscriptionStatus: "active",
        });
      }

      req.session.regenerate((err) => {
        if (err) {
          console.error("Session regenerate error:", err);
          return res.status(500).json({ error: "Login failed" });
        }
        req.session.partnerUserId = partnerUser!.id;
        req.session.partnerSlug = partner;
        req.session.userId = partnerUser!.linkedUserId || undefined;
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error("Session save error:", saveErr);
            return res.status(500).json({ error: "Login failed" });
          }
          res.redirect("/partner/dashboard");
        });
      });
    } catch (error) {
      console.error("Partner login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Admin: generate partner test login URL
  app.post("/api/admin/partners/:id/test-login", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const partnerConfig = await storage.getPartnerConfigById(req.params.id);
      if (!partnerConfig) {
        return res.status(404).json({ error: "Partner not found" });
      }

      const { email, name, subscriberId, skipCheckout } = req.body as {
        email?: string;
        name?: string;
        subscriberId?: string;
        skipCheckout?: boolean;
      };

      const sub = subscriberId || `test-${Date.now()}`;
      const testEmail = email || `test-${sub}@example.com`;
      const testName = name || "Test User";

      const jwt = await import("jsonwebtoken");
      const claims: Record<string, any> = { sub, email: testEmail, name: testName };
      if (skipCheckout) {
        claims._admin_skip_checkout = true;
      }
      const token = jwt.default.sign(
        claims,
        partnerConfig.sharedSecret,
        { expiresIn: "24h" }
      );

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const loginUrl = `${baseUrl}/api/partner/login?token=${token}&partner=${partnerConfig.slug}`;

      res.json({ loginUrl, token, expiresIn: "24h", subscriber: { sub, email: testEmail, name: testName } });
    } catch (error) {
      console.error("Generate test login error:", error);
      res.status(500).json({ error: "Failed to generate test login URL" });
    }
  });

  // Partner profile
  app.get("/api/partner/me", isPartnerAuthenticated as RequestHandler, async (req, res) => {
    try {
      const partnerUser = await storage.getPartnerUserById(req.session.partnerUserId!);
      if (!partnerUser) {
        return res.status(404).json({ error: "Partner user not found" });
      }

      const partnerConfig = await storage.getPartnerConfigById(partnerUser.partnerId);

      const isSubscribed = partnerUser.subscriptionStatus === 'active' || partnerUser.subscriptionStatus === 'trialing';
      res.json({
        id: partnerUser.id,
        email: partnerUser.email,
        name: partnerUser.name,
        partnerName: partnerConfig?.name || "Partner",
        partnerLogo: partnerConfig?.logoUrl || null,
        partnerColor: partnerConfig?.primaryColor || null,
        linkedUserId: partnerUser.linkedUserId,
        subscriptionActive: isSubscribed,
        subscriptionStatus: partnerUser.subscriptionStatus,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  // Partner logout
  app.post("/api/partner/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: "Logout failed" });
      res.json({ success: true });
    });
  });

  // Partner broker connection (reuses existing broker infrastructure)
  app.get("/api/partner/broker", isPartnerAuthenticated as RequestHandler, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(400).json({ error: "No linked account" });
      const connection = await storage.getBrokerConnection(userId);
      res.json(connection || { connected: false });
    } catch (error) {
      res.status(500).json({ error: "Failed to get broker status" });
    }
  });

  // Partner agent policy (reuses existing agent policy infrastructure)
  app.get("/api/partner/agent-policy", isPartnerAuthenticated as RequestHandler, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(400).json({ error: "No linked account" });
      const policy = await storage.getAgentPolicy(userId);
      res.json(policy || { exists: false });
    } catch (error) {
      res.status(500).json({ error: "Failed to get agent policy" });
    }
  });

  app.put("/api/partner/agent-policy", isPartnerAuthenticated as RequestHandler, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(400).json({ error: "No linked account" });

      const allowedFields = [
        "mode", "riskPerTradeUsd", "maxDailyLossUsd", "maxConcurrentPositions",
        "maxTradesPerDay", "priceMin", "priceMax", "minRewardRisk", "enabled"
      ];
      const filtered: Record<string, any> = {};
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) filtered[key] = req.body[key];
      }

      let policy = await storage.getAgentPolicy(userId);
      if (policy) {
        policy = await storage.updateAgentPolicy(userId, filtered);
      } else {
        policy = await storage.createAgentPolicy({
          userId,
          mode: "SUGGEST",
          riskPerTradeUsd: 500,
          maxDailyLossUsd: 1000,
          maxConcurrentPositions: 3,
          maxTradesPerDay: 2,
          priceMin: 5,
          priceMax: 500,
          minRewardRisk: 2,
          enabled: true,
          ...filtered,
        });
      }
      res.json(policy);
    } catch (error) {
      res.status(500).json({ error: "Failed to update agent policy" });
    }
  });

  // =============================================
  // AGENT SETTINGS (new comprehensive config)
  // =============================================

  const agentSettingsUpdateSchema = z.object({
    enabled: z.boolean().optional(),
    mode: z.enum(["suggest", "auto"]).optional(),
    assetTypes: z.array(z.enum(["stocks", "options", "futures"])).min(1).optional(),
    timezone: z.string().min(1).max(100).optional(),
    tradingWindowStart: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM or HH:MM:SS format").optional(),
    tradingWindowEnd: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM or HH:MM:SS format").optional(),
    riskPerTradeUsd: z.number().positive("Must be greater than 0").optional(),
    maxDailyLossUsd: z.number().positive("Must be greater than 0").optional(),
    maxTradesPerDay: z.number().int().min(0).max(50).optional(),
    maxConcurrentPositions: z.number().int().min(1).max(50).optional(),
    minPrice: z.number().min(0).optional(),
    maxPrice: z.number().min(0).optional(),
    minRr: z.number().min(0).optional(),
    entryOrderType: z.enum(["market", "limit"]).optional(),
    timeInForce: z.enum(["day", "gtc"]).optional(),
    limitOffsetPercent: z.number().min(0).max(5).optional(),
    missingStopsPolicy: z.enum(["skip", "suggest", "defaults"]).optional(),
    bracketEnabled: z.boolean().optional(),
    bracketStopMethod: z.enum(["signal", "percent", "dollar", "pct"]).optional(),
    bracketStopValue: z.number().positive().nullable().optional(),
    bracketTargetMethod: z.enum(["signal", "percent", "dollar", "rr", "pct"]).optional(),
    bracketTargetValue: z.number().positive().nullable().optional(),
    optionsBracketEnabled: z.boolean().optional(),
    optionsBracketStopMethod: z.enum(["pct", "dollar"]).optional(),
    optionsBracketStopValue: z.number().positive().nullable().optional(),
    optionsBracketTargetMethod: z.enum(["pct", "dollar"]).optional(),
    optionsBracketTargetValue: z.number().positive().nullable().optional(),
    requireStops: z.boolean().optional(),
    direction: z.enum(["long", "short", "both"]).optional(),
    sizingMethod: z.enum(["fixedQty", "fixedNotional", "riskBased"]).optional(),
    fixedQuantity: z.number().int().positive().nullable().optional(),
    fixedNotionalUsd: z.number().positive().nullable().optional(),
    symbolAllowlist: z.array(z.string().toUpperCase()).max(500).nullable().optional(),
    symbolBlocklist: z.array(z.string().toUpperCase()).max(500).nullable().optional(),
    duplicateSignalWindowMinutes: z.number().int().min(0).max(1440).optional(),
    cooldownMinutesAfterExit: z.number().int().min(0).max(1440).optional(),
    maxPositionsPerSymbol: z.number().int().min(1).max(50).optional(),
    scanSchedule: z.record(z.any()).optional(),
    optionsConstraints: z.record(z.any()).optional(),
    futuresConstraints: z.record(z.any()).optional(),
    reliability: z.record(z.any()).optional(),
  }).strict();

  function mapAgentPolicyToSettings(policy: any): Record<string, any> {
    return {
      enabled: policy.enabled ?? false,
      mode: (policy.mode || "SUGGEST").toLowerCase(),
      riskPerTradeUsd: policy.riskPerTradeUsd ?? 100,
      maxDailyLossUsd: policy.maxDailyLossUsd ?? 200,
      maxTradesPerDay: policy.maxTradesPerDay ?? 2,
      maxConcurrentPositions: policy.maxConcurrentPositions ?? 2,
      minPrice: policy.priceMin ?? 5,
      maxPrice: policy.priceMax ?? 500,
      minRr: policy.minRewardRisk ?? 2,
    };
  }

  async function getOrCreateAgentSettings(userId: string) {
    let settings = await storage.getAgentSettings(userId);
    if (!settings) {
      const existingPolicy = await storage.getAgentPolicy(userId);
      const mapped = existingPolicy ? mapAgentPolicyToSettings(existingPolicy) : {};
      settings = await storage.upsertAgentSettings(userId, mapped);
    }
    return settings;
  }

  app.get("/api/agent-settings", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const settings = await getOrCreateAgentSettings(userId);
      res.json(settings);
    } catch (error: any) {
      console.error("Error getting agent settings:", error);
      res.status(500).json({ error: "Failed to get agent settings" });
    }
  });

  app.put("/api/agent-settings", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const parseResult = agentSettingsUpdateSchema.safeParse(req.body);
      if (!parseResult.success) {
        console.error("[agent-settings] Validation failed:", JSON.stringify(parseResult.error.flatten()));
        return res.status(400).json({
          error: "Invalid settings",
          details: parseResult.error.flatten(),
        });
      }

      const data = parseResult.data;
      console.log("[agent-settings] PUT data:", JSON.stringify(data));
      if (data.maxDailyLossUsd !== undefined && data.riskPerTradeUsd !== undefined) {
        if (data.maxDailyLossUsd < data.riskPerTradeUsd) {
          return res.status(400).json({
            error: "Invalid settings",
            details: { fieldErrors: { maxDailyLossUsd: ["Must be >= risk per trade"] } },
          });
        }
      }
      if (data.maxPrice !== undefined && data.minPrice !== undefined) {
        if (data.maxPrice < data.minPrice) {
          return res.status(400).json({
            error: "Invalid settings",
            details: { fieldErrors: { maxPrice: ["Must be >= min price"] } },
          });
        }
      }
      if (data.sizingMethod === "fixedQty" && !data.fixedQuantity) {
        return res.status(400).json({
          error: "Invalid settings",
          details: { fieldErrors: { fixedQuantity: ["Required when sizing method is Fixed Qty"] } },
        });
      }
      if (data.sizingMethod === "fixedNotional" && !data.fixedNotionalUsd) {
        return res.status(400).json({
          error: "Invalid settings",
          details: { fieldErrors: { fixedNotionalUsd: ["Required when sizing method is Fixed Notional"] } },
        });
      }

      const before = await getOrCreateAgentSettings(userId);
      const updated = await storage.upsertAgentSettings(userId, data);

      if (data.mode !== undefined || data.enabled !== undefined || data.riskPerTradeUsd !== undefined ||
          data.maxDailyLossUsd !== undefined || data.maxTradesPerDay !== undefined ||
          data.maxConcurrentPositions !== undefined || data.minPrice !== undefined ||
          data.maxPrice !== undefined || data.minRr !== undefined) {
        const policySyncData: Record<string, any> = {};
        if (data.mode !== undefined) policySyncData.mode = data.mode.toUpperCase();
        if (data.enabled !== undefined) policySyncData.enabled = data.enabled;
        if (data.riskPerTradeUsd !== undefined) policySyncData.riskPerTradeUsd = data.riskPerTradeUsd;
        if (data.maxDailyLossUsd !== undefined) policySyncData.maxDailyLossUsd = data.maxDailyLossUsd;
        if (data.maxTradesPerDay !== undefined) policySyncData.maxTradesPerDay = data.maxTradesPerDay;
        if (data.maxConcurrentPositions !== undefined) policySyncData.maxConcurrentPositions = data.maxConcurrentPositions;
        if (data.minPrice !== undefined) policySyncData.priceMin = data.minPrice;
        if (data.maxPrice !== undefined) policySyncData.priceMax = data.maxPrice;
        if (data.minRr !== undefined) policySyncData.minRewardRisk = data.minRr;

        let existingPolicy = await storage.getAgentPolicy(userId);
        if (existingPolicy) {
          await storage.updateAgentPolicy(existingPolicy.id, policySyncData);
        } else {
          await storage.createAgentPolicy({
            userId,
            mode: (data.mode || "suggest").toUpperCase(),
            enabled: data.enabled ?? true,
            riskPerTradeUsd: data.riskPerTradeUsd ?? 500,
            maxDailyLossUsd: data.maxDailyLossUsd ?? 1000,
            maxConcurrentPositions: data.maxConcurrentPositions ?? 3,
            maxTradesPerDay: data.maxTradesPerDay ?? 2,
            priceMin: data.minPrice ?? 5,
            priceMax: data.maxPrice ?? 500,
            minRewardRisk: data.minRr ?? 2,
            ...policySyncData,
          });
        }

        if (data.enabled !== undefined) {
          const agentState = await storage.getAgentState(userId);
          if (agentState) {
            await storage.updateAgentState(userId, { enabled: data.enabled });
          } else {
            await storage.createAgentState(userId);
            await storage.updateAgentState(userId, { enabled: data.enabled });
          }
        }
      }

      storage.createAgentSettingsAudit({
        userId,
        changedBy: userId,
        before: before as any,
        after: updated as any,
        source: "ui",
      }).catch(auditErr => {
        console.error("[agent-settings] Audit log failed (non-fatal):", auditErr?.message);
      });

      res.json(updated);
    } catch (error: any) {
      console.error("[agent-settings] PUT error:", error?.message || error, error?.stack);
      res.status(500).json({ error: "Failed to update agent settings", detail: error?.message });
    }
  });

  // Partner agent settings endpoints
  app.get("/api/partner/agent-settings", isPartnerAuthenticated as RequestHandler, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(400).json({ error: "No linked account" });
      const settings = await getOrCreateAgentSettings(userId);
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: "Failed to get agent settings" });
    }
  });

  app.put("/api/partner/agent-settings", isPartnerAuthenticated as RequestHandler, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(400).json({ error: "No linked account" });

      const parseResult = agentSettingsUpdateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: "Invalid settings",
          details: parseResult.error.flatten(),
        });
      }

      const data = parseResult.data;
      if (data.maxDailyLossUsd !== undefined && data.riskPerTradeUsd !== undefined) {
        if (data.maxDailyLossUsd < data.riskPerTradeUsd) {
          return res.status(400).json({
            error: "Invalid settings",
            details: { fieldErrors: { maxDailyLossUsd: ["Must be >= risk per trade"] } },
          });
        }
      }
      if (data.maxPrice !== undefined && data.minPrice !== undefined) {
        if (data.maxPrice < data.minPrice) {
          return res.status(400).json({
            error: "Invalid settings",
            details: { fieldErrors: { maxPrice: ["Must be >= min price"] } },
          });
        }
      }
      if (data.sizingMethod === "fixedQty" && !data.fixedQuantity) {
        return res.status(400).json({
          error: "Invalid settings",
          details: { fieldErrors: { fixedQuantity: ["Required when sizing method is Fixed Qty"] } },
        });
      }
      if (data.sizingMethod === "fixedNotional" && !data.fixedNotionalUsd) {
        return res.status(400).json({
          error: "Invalid settings",
          details: { fieldErrors: { fixedNotionalUsd: ["Required when sizing method is Fixed Notional"] } },
        });
      }

      const before = await getOrCreateAgentSettings(userId);
      const updated = await storage.upsertAgentSettings(userId, data);

      if (data.mode !== undefined || data.enabled !== undefined || data.riskPerTradeUsd !== undefined ||
          data.maxDailyLossUsd !== undefined || data.maxTradesPerDay !== undefined ||
          data.maxConcurrentPositions !== undefined || data.minPrice !== undefined ||
          data.maxPrice !== undefined || data.minRr !== undefined) {
        const policySyncData: Record<string, any> = {};
        if (data.mode !== undefined) policySyncData.mode = data.mode.toUpperCase();
        if (data.enabled !== undefined) policySyncData.enabled = data.enabled;
        if (data.riskPerTradeUsd !== undefined) policySyncData.riskPerTradeUsd = data.riskPerTradeUsd;
        if (data.maxDailyLossUsd !== undefined) policySyncData.maxDailyLossUsd = data.maxDailyLossUsd;
        if (data.maxTradesPerDay !== undefined) policySyncData.maxTradesPerDay = data.maxTradesPerDay;
        if (data.maxConcurrentPositions !== undefined) policySyncData.maxConcurrentPositions = data.maxConcurrentPositions;
        if (data.minPrice !== undefined) policySyncData.priceMin = data.minPrice;
        if (data.maxPrice !== undefined) policySyncData.priceMax = data.maxPrice;
        if (data.minRr !== undefined) policySyncData.minRewardRisk = data.minRr;

        let existingPolicy = await storage.getAgentPolicy(userId);
        if (existingPolicy) {
          await storage.updateAgentPolicy(existingPolicy.id, policySyncData);
        } else {
          await storage.createAgentPolicy({
            userId,
            mode: (data.mode || "suggest").toUpperCase(),
            enabled: data.enabled ?? true,
            riskPerTradeUsd: data.riskPerTradeUsd ?? 500,
            maxDailyLossUsd: data.maxDailyLossUsd ?? 1000,
            maxConcurrentPositions: data.maxConcurrentPositions ?? 3,
            maxTradesPerDay: data.maxTradesPerDay ?? 2,
            priceMin: data.minPrice ?? 5,
            priceMax: data.maxPrice ?? 500,
            minRewardRisk: data.minRr ?? 2,
            ...policySyncData,
          });
        }

        if (data.enabled !== undefined) {
          const agentState = await storage.getAgentState(userId);
          if (agentState) {
            await storage.updateAgentState(userId, { enabled: data.enabled });
          } else {
            const newState = await storage.createAgentState(userId);
            await storage.updateAgentState(userId, { enabled: data.enabled });
          }
        }
      }

      await storage.createAgentSettingsAudit({
        userId,
        changedBy: req.session.partnerUserId || userId,
        before: before as any,
        after: updated as any,
        source: "ui",
      });

      res.json(updated);
    } catch (error: any) {
      console.error("[partner/agent-settings] PUT error:", error?.message || error, error?.stack);
      const detail = error?.message || "Unknown error";
      res.status(500).json({ error: `Failed to update agent settings: ${detail}` });
    }
  });

  app.post("/api/partner/auto-mode-consent", isPartnerAuthenticated as RequestHandler, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(400).json({ error: "No linked account" });

      const { consentText } = req.body;
      if (!consentText || typeof consentText !== "string") {
        return res.status(400).json({ error: "Consent text is required" });
      }

      const partnerUser = await storage.getPartnerUserById(req.session.partnerUserId!);
      if (!partnerUser) return res.status(400).json({ error: "Partner user not found" });

      const clientIp = req.headers["x-forwarded-for"]
        ? String(req.headers["x-forwarded-for"]).split(",")[0].trim()
        : req.socket.remoteAddress || "unknown";

      const consent = await storage.createAutoModeConsent({
        userId,
        email: partnerUser.email,
        clientIp,
        userAgent: req.headers["user-agent"] || null,
        consentText,
      });

      res.json(consent);
    } catch (error) {
      console.error("Error recording auto mode consent:", error);
      res.status(500).json({ error: "Failed to record consent" });
    }
  });

  // Partner trade history (reuses existing external alerts)
  app.get("/api/partner/trades", isPartnerAuthenticated as RequestHandler, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(400).json({ error: "No linked account" });
      await syncOrderStatuses(userId);
      const alerts = await storage.getExternalAlerts(userId, 100);

      try {
        const brokerService = await import("./broker/index");
        const brokerOrders = await brokerService.getBrokerOrders(userId);
        if (brokerOrders && brokerOrders.length > 0) {
          const knownBrokerOrderIds = new Set(alerts.filter(a => a.brokerOrderId).map(a => String(a.brokerOrderId)));
          const connection = await storage.getBrokerConnectionWithToken(userId);
          const providerName = connection?.provider || "broker";
          const brokerTrades = brokerOrders
            .filter(bo => bo.id && !knownBrokerOrderIds.has(String(bo.id)))
            .map(bo => {
              const normalizedStatus = normalizeTradeStatus(bo.status || "unknown");
              const statusUpper = normalizedStatus === "sent_to_broker" ? "EXECUTED" :
                normalizedStatus === "filled" ? "FILLED" :
                normalizedStatus === "rejected" ? "REJECTED" :
                normalizedStatus === "cancelled" ? "CANCELLED" :
                normalizedStatus === "error" ? "ERROR" : "PENDING";
              return {
                id: `broker-${bo.id}`,
                symbol: bo.symbol || "UNKNOWN",
                source: providerName,
                direction: bo.side === "sell" ? "SHORT" : "LONG",
                alertType: "entry",
                strategyName: `${providerName.charAt(0).toUpperCase() + providerName.slice(1)} Order`,
                entryPrice: 0,
                riskPrice: null,
                targetPrice: null,
                status: statusUpper,
                skipReason: statusUpper === "REJECTED" ? `Rejected by ${providerName}` : null,
                exitReason: null,
                executedPrice: null,
                executedAt: bo.createdAt || null,
                alertTimestamp: bo.createdAt || new Date().toISOString(),
                brokerOrderId: String(bo.id),
                createdAt: bo.createdAt ? new Date(bo.createdAt) : new Date(),
                updatedAt: new Date(),
                userId,
                agentDecisionId: null,
              };
            });
          res.json([...alerts, ...brokerTrades].sort((a: any, b: any) => {
            const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return tB - tA;
          }));
          return;
        }
      } catch (brokerError: any) {
        console.log(`[PartnerTrades] Could not fetch broker orders: ${brokerError.message}`);
      }

      res.json(alerts);
    } catch (error) {
      res.status(500).json({ error: "Failed to get trade history" });
    }
  });

  // Partner API key management
  app.get("/api/partner/api-keys", isPartnerAuthenticated as RequestHandler, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(400).json({ error: "No linked account" });
      const keys = await storage.getExternalAlertApiKeys(userId);
      res.json(keys.map(k => ({
        id: k.id,
        prefix: k.keyPrefix,
        label: k.label,
        isActive: k.isActive,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
      })));
    } catch (error) {
      res.status(500).json({ error: "Failed to get API keys" });
    }
  });

  // Partner subscription status
  app.get("/api/partner/subscription", isPartnerAuthenticated as RequestHandler, async (req, res) => {
    try {
      const partnerUser = await storage.getPartnerUserById(req.session.partnerUserId!);
      if (!partnerUser) return res.status(404).json({ error: "Partner user not found" });

      if (!partnerUser.stripeSubscriptionId) {
        return res.json({ active: false, status: null });
      }

      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const subResult = await db.execute(
        sql`SELECT id, status, current_period_end, cancel_at_period_end FROM stripe.subscriptions WHERE id = ${partnerUser.stripeSubscriptionId}`
      );
      const sub = subResult.rows[0];
      if (!sub) {
        return res.json({ active: false, status: partnerUser.subscriptionStatus });
      }

      const isActive = sub.status === 'active' || sub.status === 'trialing';
      res.json({
        active: isActive,
        status: sub.status,
        currentPeriodEnd: sub.current_period_end,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      });
    } catch (error) {
      console.error("Partner subscription check error:", error);
      res.status(500).json({ error: "Failed to check subscription" });
    }
  });

  // Partner create checkout session
  app.post("/api/partner/checkout", isPartnerAuthenticated as RequestHandler, async (req, res) => {
    try {
      const partnerUser = await storage.getPartnerUserById(req.session.partnerUserId!);
      if (!partnerUser) return res.status(404).json({ error: "Partner user not found" });

      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();

      let customerId = partnerUser.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: partnerUser.email,
          metadata: { partnerUserId: partnerUser.id, partnerId: partnerUser.partnerId },
        });
        customerId = customer.id;
        await storage.updatePartnerUser(partnerUser.id, { stripeCustomerId: customerId });
      }

      let priceId: string | null = null;

      try {
        const { db } = await import("./db");
        const { sql } = await import("drizzle-orm");
        const priceResult = await db.execute(
          sql`SELECT pr.id FROM stripe.prices pr
              JOIN stripe.products p ON pr.product = p.id
              WHERE p.metadata->>'type' = 'partner_subscription'
              AND pr.active = true
              AND pr.recurring IS NOT NULL
              LIMIT 1`
        );
        if (priceResult.rows[0]) {
          priceId = priceResult.rows[0].id as string;
        }
      } catch (dbErr) {
        console.log("[checkout] Local stripe tables query failed, falling back to API");
      }

      if (!priceId) {
        const products = await stripe.products.list({ active: true, limit: 100 });
        const partnerProduct = products.data.find(p => p.metadata?.type === 'partner_subscription');
        if (partnerProduct) {
          const prices = await stripe.prices.list({ product: partnerProduct.id, active: true, limit: 10 });
          const recurringPrice = prices.data.find(p => p.recurring);
          if (recurringPrice) {
            priceId = recurringPrice.id;
          }
        }
      }

      if (!priceId) {
        return res.status(500).json({ error: "Subscription product not configured. Contact support." });
      }
      const baseUrl = `${req.protocol}://${req.get("host")}`;

      const { TRIAL_DAYS } = await import("@shared/promo");

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        allow_promotion_codes: true,
        subscription_data: {
          trial_period_days: TRIAL_DAYS,
        },
        success_url: `${baseUrl}/api/partner/checkout-complete?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/partner/dashboard?checkout=cancel`,
        metadata: { partnerUserId: partnerUser.id },
      });

      res.json({ url: session.url });
    } catch (error) {
      console.error("Partner checkout error:", error);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  // Checkout complete redirect - syncs subscription immediately then redirects to dashboard
  app.get("/api/partner/checkout-complete", async (req, res) => {
    try {
      const sessionId = req.query.session_id as string;
      if (!sessionId) return res.redirect("/partner/dashboard");

      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });

      if (session.metadata?.partnerUserId && session.subscription) {
        let subId: string;
        let subStatus: string;

        if (typeof session.subscription === 'string') {
          subId = session.subscription;
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          subStatus = sub.status;
        } else {
          subId = session.subscription.id;
          subStatus = session.subscription.status;
        }

        await storage.updatePartnerUser(session.metadata.partnerUserId, {
          stripeSubscriptionId: subId,
          subscriptionStatus: subStatus,
        });
      }

      res.redirect("/partner/dashboard?checkout=success");
    } catch (error) {
      console.error("Checkout complete error:", error);
      res.redirect("/partner/dashboard?checkout=success");
    }
  });

  // Partner manage subscription (customer portal)
  app.post("/api/partner/billing-portal", isPartnerAuthenticated as RequestHandler, async (req, res) => {
    try {
      const partnerUser = await storage.getPartnerUserById(req.session.partnerUserId!);
      if (!partnerUser?.stripeCustomerId) {
        return res.status(400).json({ error: "No billing account found" });
      }

      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: partnerUser.stripeCustomerId,
        return_url: `${baseUrl}/partner/dashboard`,
      });

      res.json({ url: portalSession.url });
    } catch (error) {
      console.error("Partner billing portal error:", error);
      res.status(500).json({ error: "Failed to create billing portal session" });
    }
  });

  // Stripe webhook handler for subscription status sync
  app.post("/api/partner/stripe-sync", async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");

      const subs = await db.execute(
        sql`SELECT s.id, s.customer, s.status FROM stripe.subscriptions s
            WHERE s.status IN ('active', 'trialing', 'past_due', 'canceled', 'unpaid')`
      );

      for (const sub of subs.rows) {
        const customerId = sub.customer as string;
        const partnerUser = await storage.getPartnerUserByStripeCustomerId(customerId);
        if (partnerUser) {
          await storage.updatePartnerUser(partnerUser.id, {
            stripeSubscriptionId: sub.id as string,
            subscriptionStatus: sub.status as string,
          });
        }
      }

      res.json({ synced: subs.rows.length });
    } catch (error) {
      console.error("Stripe sync error:", error);
      res.status(500).json({ error: "Failed to sync subscriptions" });
    }
  });

  // Admin: list all partners
  app.get("/api/admin/partners", isAuthenticated as RequestHandler, isAdmin, async (req, res) => {
    try {
      const partners = await storage.getAllPartnerConfigs();
      const result = await Promise.all(partners.map(async (p) => {
        const users = await storage.getPartnerUsersByPartnerId(p.id);
        const activeSubscribers = users.filter(u => u.isActive && ['active', 'trialing'].includes(u.subscriptionStatus ?? ''));
        return {
          id: p.id,
          slug: p.slug,
          name: p.name,
          isActive: p.isActive,
          logoUrl: p.logoUrl,
          primaryColor: p.primaryColor,
          createdAt: p.createdAt,
          partnerApiKey: p.partnerApiKey,
          subscriberCount: activeSubscribers.length,
        };
      }));
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to list partners" });
    }
  });

  // Admin: update a partner
  app.patch("/api/admin/partners/:id", isAuthenticated as RequestHandler, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, isActive, logoUrl, primaryColor, sharedSecret } = req.body;
      const update: Record<string, any> = {};
      if (name !== undefined) update.name = name;
      if (isActive !== undefined) update.isActive = isActive;
      if (logoUrl !== undefined) update.logoUrl = logoUrl;
      if (primaryColor !== undefined) update.primaryColor = primaryColor;
      if (sharedSecret !== undefined) update.sharedSecret = sharedSecret;
      const result = await storage.updatePartnerConfig(id, update);
      if (!result) return res.status(404).json({ error: "Partner not found" });
      res.json({ id: result.id, slug: result.slug, name: result.name, isActive: result.isActive });
    } catch (error) {
      res.status(500).json({ error: "Failed to update partner" });
    }
  });

  // Admin: register a new partner
  app.post("/api/admin/partners", isAuthenticated as RequestHandler, isAdmin, async (req, res) => {
    try {
      const { slug, name, sharedSecret, logoUrl, primaryColor } = req.body;
      if (!slug || !name || !sharedSecret) {
        return res.status(400).json({ error: "slug, name, and sharedSecret are required" });
      }
      const partnerApiKey = `pk_${slug}_${crypto.randomBytes(24).toString("hex")}`;
      const config = await storage.createPartnerConfig({
        slug, name, sharedSecret, isActive: true,
        partnerApiKey,
        logoUrl: logoUrl || null,
        primaryColor: primaryColor || null,
      });
      res.status(201).json({ id: config.id, slug: config.slug, name: config.name, partnerApiKey });
    } catch (error) {
      res.status(500).json({ error: "Failed to create partner" });
    }
  });

  app.post("/api/admin/partners/:id/regenerate-key", isAuthenticated as RequestHandler, isAdmin, async (req, res) => {
    try {
      const partner = await storage.getPartnerConfigById(req.params.id);
      if (!partner) return res.status(404).json({ error: "Partner not found" });
      const newKey = `pk_${partner.slug}_${crypto.randomBytes(24).toString("hex")}`;
      await storage.updatePartnerConfig(partner.id, { partnerApiKey: newKey });
      res.json({ partnerApiKey: newKey });
    } catch (error) {
      res.status(500).json({ error: "Failed to regenerate key" });
    }
  });

  app.post("/api/partner/alerts/broadcast", async (req, res) => {
    try {
      const apiKey = (req.headers["x-api-key"] as string) || (req.query.token as string);
      if (!apiKey) {
        return res.status(401).json({ error: "Missing API key. Provide via X-API-Key header or ?token= query parameter" });
      }

      const partner = await storage.getPartnerConfigByApiKey(apiKey);
      if (!partner || !partner.isActive) {
        return res.status(401).json({ error: "Invalid or inactive partner API key" });
      }

      const body = req.body;
      let alertData: {
        alertType: "entry" | "exit";
        symbol: string;
        direction: string;
        strategyName: string;
        strategyGroup: string | null;
        entryPrice: number;
        riskPrice: number | null;
        targetPrice: number | null;
        exitReason: string | null;
      };

      if (body.rawText) {
        const parsed = parseSfRawText(body.rawText);
        if (!parsed) {
          return res.status(400).json({
            error: "Could not parse rawText",
            hint: 'Expected format: "enter sym=PWR lp=534.78 tp=584.9 sl=408.36" or "exit sym=WDC reason=\\"Stop Loss\\" sl=115.4"',
          });
        }
        alertData = {
          alertType: parsed.alertType,
          symbol: parsed.symbol,
          direction: "Long",
          strategyName: body.strategy_name || partner.name,
          strategyGroup: body.strategy_group || null,
          entryPrice: parsed.entryPrice,
          riskPrice: parsed.riskPrice,
          targetPrice: parsed.targetPrice,
          exitReason: parsed.exitReason,
        };
      } else {
        const { externalAlertWebhookSchema } = await import("@shared/schema");
        const parsed = externalAlertWebhookSchema.safeParse(body);
        if (!parsed.success) {
          return res.status(400).json({
            error: "Invalid alert payload",
            details: parsed.error.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`),
          });
        }
        const data = parsed.data;
        alertData = {
          alertType: data.alert_type,
          symbol: data.symbol.toUpperCase(),
          direction: data.direction,
          strategyName: data.strategy_name,
          strategyGroup: data.strategy_group ?? null,
          entryPrice: data.entry_price,
          riskPrice: data.risk_price ?? null,
          targetPrice: data.target_price ?? null,
          exitReason: data.exit_reason ?? null,
        };
      }

      const subscribers = await storage.getPartnerUsersByPartnerId(partner.id);
      const activeSubscribers = subscribers.filter((s) => s.isActive && s.linkedUserId && (s.subscriptionStatus === "active" || s.subscriptionStatus === "trialing"));

      let delivered = 0;
      let failed = 0;
      for (const sub of activeSubscribers) {
        try {
          await storage.createExternalAlert({
            userId: sub.linkedUserId!,
            source: partner.slug,
            alertType: alertData.alertType,
            symbol: alertData.symbol,
            direction: alertData.direction,
            strategyName: alertData.strategyName,
            strategyGroup: alertData.strategyGroup,
            entryPrice: alertData.entryPrice,
            riskPrice: alertData.riskPrice,
            targetPrice: alertData.targetPrice,
            exitReason: alertData.exitReason,
            alertTimestamp: new Date(),
            status: "PENDING",
          });
          delivered++;
        } catch {
          failed++;
        }
      }

      console.log(`[PartnerBroadcast] ${partner.slug}: ${alertData.symbol} ${alertData.alertType} delivered to ${delivered}/${activeSubscribers.length} subscribers`);
      res.json({
        success: true,
        symbol: alertData.symbol,
        alertType: alertData.alertType,
        totalSubscribers: activeSubscribers.length,
        delivered,
        failed,
      });

      if (delivered > 0) {
        const { processExternalAlerts } = await import("./agent-worker");
        for (const sub of activeSubscribers) {
          if (sub.linkedUserId) {
            processExternalAlerts(sub.linkedUserId).catch((err: any) =>
              console.error(`[PartnerBroadcast] Immediate processing failed for ${sub.linkedUserId}:`, err?.message)
            );
          }
        }
      }
    } catch (error: any) {
      console.error("[PartnerBroadcast] Error:", error?.message || error);
      res.status(500).json({ error: "Broadcast failed" });
    }
  });

  // ===== Trading System Setup API =====
  
  app.get("/api/system-profile", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const profile = await storage.getLatestSystemProfile(userId);
      const onboardingState = await storage.getOnboardingState(userId);
      res.json({ profile, onboardingState });
    } catch (error: any) {
      console.error("[SystemProfile] Error:", error.message);
      res.status(500).json({ error: "Failed to get system profile" });
    }
  });

  app.post("/api/system-profile/preview", isAuthenticated, async (req, res) => {
    try {
      const { computePersona } = await import("@shared/persona-engine");
      const { tradingStyle, marketScope, personaGoal, personaRisk } = req.body;
      const result = computePersona({ tradingStyle, marketScope, personaGoal, personaRisk });
      res.json(result);
    } catch (error: any) {
      console.error("[SystemProfile] Preview error:", error.message);
      res.status(500).json({ error: "Failed to preview profile" });
    }
  });

  app.post("/api/system-profile/apply", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { computePersona } = await import("@shared/persona-engine");
      const { 
        tradingStyle, marketScope, personaGoal, personaRisk,
        riskPerTradeUsd, maxTradesPerDay, minConfidenceThreshold,
        automationEnabled, strategyBundleId: overrideBundleId
      } = req.body;

      const persona = computePersona({ tradingStyle, marketScope, personaGoal, personaRisk });

      const existing = await storage.getLatestSystemProfile(userId);
      const nextVersion = (existing?.version || 0) + 1;

      const profile = await storage.createSystemProfile({
        userId,
        version: nextVersion,
        tradingStyle: tradingStyle || "AUTO",
        marketScope: marketScope || "STOCKS",
        personaGoal: personaGoal || null,
        personaRisk: personaRisk || null,
        personaLabel: persona.personaLabel,
        riskPerTradeUsd: riskPerTradeUsd ?? persona.riskPerTradeUsd,
        maxTradesPerDay: maxTradesPerDay ?? persona.maxTradesPerDay,
        minConfidenceThreshold: minConfidenceThreshold ?? persona.minConfidenceThreshold,
        strategyBundleId: overrideBundleId || persona.strategyBundleId,
        automationEnabled: automationEnabled ?? false,
        simpleMode: existing?.simpleMode ?? true,
      });

      await storage.upsertOnboardingState(userId, {
        wizardCompletedAt: new Date(),
        lastWizardVersionSeen: nextVersion,
      });

      const user = await authStorage.getUser(userId);
      await storage.setUserSettings(userId, {
        setupCompleted: true,
        setupCompletedAt: new Date(),
      });

      res.json({ profile, persona });
    } catch (error: any) {
      console.error("[SystemProfile] Apply error:", error.message);
      res.status(500).json({ error: "Failed to apply profile" });
    }
  });

  app.get("/api/onboarding-state", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const state = await storage.getOnboardingState(userId);
      res.json(state || { userId, wizardCompletedAt: null, firstTradeExecutedAt: null, firstTradeCelebrationSeen: false, lastWizardVersionSeen: 0 });
    } catch (error: any) {
      console.error("[OnboardingState] Error:", error.message);
      res.status(500).json({ error: "Failed to get onboarding state" });
    }
  });

  app.put("/api/onboarding-state", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const state = await storage.upsertOnboardingState(userId, req.body);
      res.json(state);
    } catch (error: any) {
      console.error("[OnboardingState] Update error:", error.message);
      res.status(500).json({ error: "Failed to update onboarding state" });
    }
  });

  app.put("/api/advanced-config", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const config = await storage.upsertAdvancedConfig(userId, req.body);
      res.json(config);
    } catch (error: any) {
      console.error("[AdvancedConfig] Error:", error.message);
      res.status(500).json({ error: "Failed to update advanced config" });
    }
  });

  app.get("/api/advanced-config", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const config = await storage.getAdvancedConfig(userId);
      res.json(config || { userId, strategyParamsJson: null, filtersJson: null, overridesJson: null });
    } catch (error: any) {
      console.error("[AdvancedConfig] Get error:", error.message);
      res.status(500).json({ error: "Failed to get advanced config" });
    }
  });

  app.get("/api/system-insights", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const profile = await storage.getLatestSystemProfile(userId);
      const { computePersona, STRATEGY_BUNDLES } = await import("@shared/persona-engine");

      const insights: Array<{ type: string; title: string; description: string }> = [];

      if (profile) {
        const bundle = STRATEGY_BUNDLES[profile.strategyBundleId || "AUTO_BALANCED"];
        insights.push({
          type: "info",
          title: "Active Strategies",
          description: `Running ${bundle?.strategies.length || 0} strategies from the ${bundle?.label || "Auto"} bundle.`,
        });

        if (profile.minConfidenceThreshold && profile.minConfidenceThreshold >= 85) {
          insights.push({
            type: "tip",
            title: "High Confidence Filter",
            description: "Your confidence threshold is set high. You'll see fewer but higher-quality signals.",
          });
        }

        if (!profile.automationEnabled) {
          insights.push({
            type: "action",
            title: "Automation Off",
            description: "Enable autopilot to let the system execute trades that meet your criteria automatically.",
          });
        }
      } else {
        insights.push({
          type: "action",
          title: "Set Up Your System",
          description: "Complete the Trading System Setup to configure your strategies and risk preferences.",
        });
      }

      res.json({ insights });
    } catch (error: any) {
      console.error("[SystemInsights] Error:", error.message);
      res.status(500).json({ error: "Failed to get insights" });
    }
  });

  app.post("/api/disclaimer/accept", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const user = await authStorage.getUser(userId);
      const { DISCLAIMER_VERSION, DISCLAIMER_FULL_TEXT, computeDisclaimerHash } = await import("@shared/persona-engine");
      const { acceptanceType, metadata } = req.body;

      const log = await storage.createDisclaimerAcceptance({
        userId,
        userEmail: user?.email || "",
        userName: user?.firstName || user?.email || "",
        acceptanceType: acceptanceType || "WIZARD_AUTOPILOT_ENABLE",
        disclaimerVersion: DISCLAIMER_VERSION,
        disclaimerHash: computeDisclaimerHash(DISCLAIMER_FULL_TEXT),
        accepted: true,
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        metadataJson: metadata || null,
      });

      res.json({ success: true, id: log.id });
    } catch (error: any) {
      console.error("[Disclaimer] Accept error:", error.message);
      res.status(500).json({ error: "Failed to record disclaimer acceptance" });
    }
  });

  app.get("/api/admin/disclaimer-logs", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { q, acceptanceType, version, startDate, endDate, page, pageSize } = req.query;
      const result = await storage.getDisclaimerAcceptanceLogs({
        query: q as string,
        acceptanceType: acceptanceType as string,
        version: version as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        page: page ? parseInt(page as string) : 1,
        pageSize: pageSize ? parseInt(pageSize as string) : 25,
      });
      res.json(result);
    } catch (error: any) {
      console.error("[Admin] Disclaimer logs error:", error.message);
      res.status(500).json({ error: "Failed to get disclaimer logs" });
    }
  });

  app.put("/api/system-profile/simple-mode", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { simpleMode } = req.body;
      const existing = await storage.getLatestSystemProfile(userId);
      if (!existing) {
        return res.status(404).json({ error: "No system profile found. Complete setup first." });
      }
      const profile = await storage.createSystemProfile({
        userId: existing.userId,
        version: (existing.version || 0) + 1,
        tradingStyle: existing.tradingStyle,
        marketScope: existing.marketScope,
        personaGoal: existing.personaGoal,
        personaRisk: existing.personaRisk,
        personaLabel: existing.personaLabel,
        riskPerTradeUsd: existing.riskPerTradeUsd,
        maxTradesPerDay: existing.maxTradesPerDay,
        minConfidenceThreshold: existing.minConfidenceThreshold,
        strategyBundleId: existing.strategyBundleId,
        automationEnabled: existing.automationEnabled,
        simpleMode: simpleMode ?? true,
      });
      res.json(profile);
    } catch (error: any) {
      console.error("[SystemProfile] Simple mode error:", error.message);
      res.status(500).json({ error: "Failed to update mode" });
    }
  });

  return httpServer;
}
