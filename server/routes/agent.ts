import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { parsePrompt } from "../agent/prompt-interpreter";
import { generateMockSetup, generateSetupFromScanResult, getBuiltInStrategies, type TradeSetup } from "../agent/strategy-engine";
import { getStrategyPlugin, getStrategy, StrategyId } from "../strategies";
import { storage } from "../storage";
import { fetchQuotesFromBroker, fetchHistoryFromBroker } from "../broker-service";

const generateSchema = z.object({
  prompt: z.string().optional(),
  symbol: z.string().optional(),
  strategy: z.string().optional(),
  assetType: z.enum(["stock", "option", "future"]).optional(),
  timeframe: z.string().optional(),
});

export function registerAgentRoutes(app: Express, isAuthenticated: RequestHandler) {
  app.post("/api/agent/generate", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const body = generateSchema.parse(req.body);

      const promptText = body.prompt || `Generate a setup for ${body.symbol || "SPY"} using ${body.strategy || "ORB15"}`;
      const parsed = parsePrompt(promptText);

      if (body.symbol) parsed.symbol = body.symbol.toUpperCase();
      if (body.strategy) parsed.strategy = body.strategy as any;
      if (body.assetType) parsed.assetType = body.assetType;
      if (body.timeframe) parsed.timeframe = body.timeframe;

      if (!parsed.symbol) {
        return res.status(400).json({
          error: "Could not identify a symbol. Please specify a ticker symbol.",
          parsed,
        });
      }

      if (!parsed.strategy) {
        parsed.strategy = StrategyId.ORB15;
      }

      await storage.createPromptRequestLog({
        userId,
        prompt: promptText,
        resolvedIntent: parsed.intent,
        resolvedSymbol: parsed.symbol,
        resolvedStrategy: parsed.strategy,
        requestJson: parsed as any,
      });

      let setup: TradeSetup;

      try {
        const brokerConn = await storage.getBrokerConnection(userId);
        if (brokerConn?.isConnected) {
          const plugin = getStrategyPlugin(parsed.strategy);
          const strategy = getStrategy(parsed.strategy);

          if (plugin) {
            const quotes = await fetchQuotesFromBroker(userId, [parsed.symbol]);
            const quote = quotes?.[0];
            const history = await fetchHistoryFromBroker(userId, parsed.symbol, parsed.timeframe || "15m");

            if (quote && history && history.length > 0) {
              const candles = history.map((c: any) => ({
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume,
                timestamp: new Date(c.timestamp).getTime(),
              }));

              const result = plugin.scan({
                symbol: parsed.symbol,
                candles,
                timeframe: parsed.timeframe || "15m",
                params: plugin.defaultParams,
                quote: {
                  symbol: parsed.symbol,
                  last: quote.last || quote.close || 0,
                  change: quote.change || 0,
                  changePercent: quote.changePercent || quote.change_percent || 0,
                  volume: quote.volume || 0,
                  avgVolume: quote.avgVolume || quote.average_volume || 0,
                  high: quote.high || 0,
                  low: quote.low || 0,
                  open: quote.open || 0,
                  prevClose: quote.prevClose || quote.previous_close || 0,
                  bid: quote.bid || 0,
                  ask: quote.ask || 0,
                },
              });

              if (result) {
                setup = generateSetupFromScanResult(result, parsed);
              } else {
                setup = generateMockSetup(parsed);
                setup.dataSource = "simulated (no valid setup from live data)";
              }
            } else {
              setup = generateMockSetup(parsed);
              setup.dataSource = "simulated (limited market data)";
            }
          } else {
            setup = generateMockSetup(parsed);
            setup.dataSource = "simulated";
          }
        } else {
          setup = generateMockSetup(parsed);
          setup.dataSource = "simulated (no broker connected)";
        }
      } catch (err) {
        setup = generateMockSetup(parsed);
        setup.dataSource = "simulated (data fetch error)";
      }

      await storage.createTradeSetupHistory({
        userId,
        symbol: setup.symbol,
        strategyName: setup.strategyName,
        assetType: setup.assetType,
        timeframe: setup.timeframe,
        setupJson: setup as any,
        modelScore: setup.modelScore,
        status: "generated",
        sentToInstatrade: false,
      });

      await storage.createActivityLog({
        userId,
        eventType: "setup_generated",
        description: `Generated ${setup.strategyName} setup for ${setup.symbol}`,
        metadataJson: { setupId: setup.id, symbol: setup.symbol, strategy: setup.strategyName } as any,
      });

      res.json({ setup, parsed });
    } catch (err: any) {
      console.error("Agent generate error:", err);
      res.status(500).json({ error: err.message || "Failed to generate setup" });
    }
  });

  app.get("/api/agent/strategies", isAuthenticated, (_req, res) => {
    res.json(getBuiltInStrategies());
  });

  app.get("/api/agent/setups", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const setups = await storage.getTradeSetupHistoryList(userId, {
        symbol: req.query.symbol as string,
        strategy: req.query.strategy as string,
        status: req.query.status as string,
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json(setups);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/agent/setups/:id/status", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { status, sentToInstatrade } = req.body;
      const updated = await storage.updateTradeSetupHistory(req.params.id, userId, {
        status,
        sentToInstatrade,
      });
      if (!updated) {
        return res.status(404).json({ error: "Setup not found" });
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/agent/custom-strategies", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const strategies = await storage.getCustomStrategies(userId);
      res.json(strategies);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/agent/custom-strategies", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const strategy = await storage.createCustomStrategy({
        userId,
        name: req.body.name,
        description: req.body.description,
        assetType: req.body.assetType || "stock",
        timeframe: req.body.timeframe,
        rulesJson: req.body.rulesJson,
        sourceText: req.body.sourceText,
        validationStatus: "draft",
        isEnabled: true,
      });

      await storage.createActivityLog({
        userId,
        eventType: "strategy_created",
        description: `Created custom strategy: ${req.body.name}`,
        metadataJson: { strategyId: strategy.id } as any,
      });

      res.json(strategy);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/agent/custom-strategies/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const updated = await storage.updateCustomStrategy(req.params.id, userId, req.body);
      if (!updated) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/agent/custom-strategies/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await storage.deleteCustomStrategy(req.params.id, userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/agent/activity", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await storage.getActivityLogs(userId, limit);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/agent/parse-strategy", isAuthenticated, async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: "Strategy text is required" });
      }

      const rules = parseStrategyText(text);
      res.json({ rules, validationStatus: rules.isComplete ? "validated" : "needs_review" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

function parseStrategyText(text: string) {
  const lower = text.toLowerCase();
  const rules: any = {
    entryLogic: null,
    stopLogic: null,
    targetLogic: null,
    timeframe: null,
    assetClass: null,
    filters: [],
    isComplete: false,
  };

  if (lower.includes("buy when") || lower.includes("enter when") || lower.includes("go long when")) {
    const entryMatch = text.match(/(?:buy|enter|go long) when (.+?)(?:\.|stop|exit|$)/i);
    if (entryMatch) rules.entryLogic = entryMatch[1].trim();
  }

  if (lower.includes("stop") || lower.includes("stop loss")) {
    const stopMatch = text.match(/stop (?:loss )?(?:at |below |is )?(.+?)(?:\.|exit|target|$)/i);
    if (stopMatch) rules.stopLogic = stopMatch[1].trim();
  }

  if (lower.includes("exit") || lower.includes("target") || lower.includes("take profit")) {
    const targetMatch = text.match(/(?:exit|target|take profit) (?:at )?(.+?)(?:\.|$)/i);
    if (targetMatch) rules.targetLogic = targetMatch[1].trim();
  }

  for (const [key, val] of Object.entries({ "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", daily: "1D" })) {
    if (lower.includes(key)) {
      rules.timeframe = val;
      break;
    }
  }

  if (lower.includes("stock")) rules.assetClass = "stock";
  else if (lower.includes("option")) rules.assetClass = "option";
  else if (lower.includes("future")) rules.assetClass = "future";

  if (lower.includes("volume")) rules.filters.push("volume_filter");
  if (lower.includes("ema") || lower.includes("moving average")) rules.filters.push("ema_filter");

  rules.isComplete = !!(rules.entryLogic && rules.stopLogic);

  return rules;
}
