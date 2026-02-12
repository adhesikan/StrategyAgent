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
import { setupAuth, registerAuthRoutes, isAuthenticated, authStorage, verifyJwt } from "./replit_integrations/auth";
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
import { startFuturesWorker } from "./trading/futures/futuresWorker";

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

  startFuturesWorker().catch((err) => {
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

  app.post("/api/broker/connect", isAuthenticated, async (req, res) => {
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

  app.post("/api/broker/disconnect", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await storage.clearBrokerConnection(userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to disconnect broker" });
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

  app.post("/api/broker/test", isAuthenticated, async (req, res) => {
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

  app.get("/api/broker/accounts", isAuthenticated, async (req, res) => {
    try {
      const accounts = await brokerService.getBrokerAccounts(req.session.userId!);
      res.json(accounts);
    } catch (error: any) {
      console.error("[BrokerService] accounts error:", error.message);
      res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });

  app.patch("/api/broker/preferred-account", isAuthenticated, async (req, res) => {
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
  app.post("/api/trade/place-equity", isAuthenticated, async (req, res) => {
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
      try {
        const connection = await storage.getBrokerConnectionWithToken(userId);
        if (connection?.accessToken) {
          brokerToken = connection.accessToken;
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

      const result = await runOptionsScan(
        { universeId, strategyKey, symbols, riskSettings, scanPreferences: scanPreferences as any },
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
  
  function getTradierCallbackUrl(): string {
    // Build callback URL dynamically based on environment
    // Uses /tradier-callback to match the registered OAuth callback URL
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
  app.get("/api/tradier/oauth", isAuthenticated, async (req, res) => {
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

      // Build callback URL dynamically
      const callbackUrl = getTradierCallbackUrl();
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
      
      // Redirect to settings page with success message
      res.redirect("/settings?tradier_success=true");
    } catch (error: any) {
      console.error("Tradier OAuth callback error:", error);
      res.redirect("/settings?tradier_error=unknown");
    }
  }

  // Tradier OAuth callback routes - both point to the same handler
  // /tradier-callback matches the registered callback URL with Tradier
  app.get("/tradier-callback", handleTradierOAuthCallback);
  app.get("/api/tradier/callback", handleTradierOAuthCallback);

  // TradeStation OAuth routes
  const TRADESTATION_CLIENT_ID = process.env.TRADESTATION_CLIENT_ID;
  const TRADESTATION_CLIENT_SECRET = process.env.TRADESTATION_CLIENT_SECRET;
  
  function isTradeStationOAuthConfigured(): boolean {
    return !!(TRADESTATION_CLIENT_ID && TRADESTATION_CLIENT_SECRET);
  }
  
  function getTradeStationCallbackUrl(): string {
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
    return `${baseUrl}/tradestation-callback`;
  }

  app.get("/api/tradestation/oauth/status", (req, res) => {
    res.json({ configured: isTradeStationOAuthConfigured() });
  });

  // Initiate TradeStation OAuth flow
  app.get("/api/tradestation/oauth", isAuthenticated, async (req, res) => {
    try {
      if (!isTradeStationOAuthConfigured()) {
        return res.status(503).json({ error: "TradeStation OAuth is not configured" });
      }

      const userId = req.session.userId!;
      const state = crypto.randomBytes(16).toString("hex");
      
      req.session.tradestationOAuthState = state;
      req.session.tradestationOAuthUserId = userId;
      
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const callbackUrl = getTradeStationCallbackUrl();
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
    try {
      const { code, state } = req.query;
      
      if (!code || typeof code !== "string") {
        return res.redirect("/settings?tradestation_error=missing_code");
      }
      
      if (!state || typeof state !== "string") {
        return res.redirect("/settings?tradestation_error=missing_state");
      }

      if (state !== req.session.tradestationOAuthState) {
        console.error("TradeStation OAuth state mismatch");
        return res.redirect("/settings?tradestation_error=state_mismatch");
      }

      const userId = req.session.tradestationOAuthUserId;
      if (!userId) {
        console.error("No user ID found in session for TradeStation OAuth callback");
        return res.redirect("/settings?tradestation_error=session_expired");
      }

      delete req.session.tradestationOAuthState;
      delete req.session.tradestationOAuthUserId;

      // Exchange authorization code for access token
      const callbackUrl = getTradeStationCallbackUrl();
      
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
      
      res.redirect("/settings?tradestation_success=true");
    } catch (error: any) {
      console.error("TradeStation OAuth callback error:", error);
      res.redirect("/settings?tradestation_error=unknown");
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

  return httpServer;
}
