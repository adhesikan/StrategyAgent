import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { parsePrompt } from "../agent/prompt-interpreter";
import { generateMockSetup, generateSetupFromScanResult, getBuiltInStrategies, type TradeSetup } from "../agent/strategy-engine";
import { getStrategyPlugin, getStrategy, StrategyId } from "../strategies";
import { storage } from "../storage";
import { fetchQuotesFromBroker, fetchHistoryFromBroker } from "../broker-service";

const conditionSchema = z.object({
  conditionType: z.string(),
  operator: z.string(),
  value: z.string(),
});

const generateSchema = z.object({
  prompt: z.string().optional(),
  symbol: z.string().optional(),
  strategy: z.string().optional(),
  assetType: z.enum(["stock", "option", "future"]).optional(),
  timeframe: z.string().optional(),
  conditions: z.array(conditionSchema).optional(),
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

      if (body.conditions && body.conditions.length > 0) {
        setup.appliedConditions = body.conditions.map((c: any) => ({
          type: c.conditionType,
          operator: c.operator,
          value: c.value,
          passed: evaluateCondition(c, setup),
        }));

        const failedConditions = setup.appliedConditions.filter((c: any) => !c.passed);
        if (failedConditions.length > 0) {
          setup.conditionWarnings = failedConditions.map(
            (c: any) => `Condition not met: ${c.type} ${c.operator} ${c.value}`
          );
        }
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

  app.get("/api/agent/conditions", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const conditions = await storage.getAnalysisConditions(userId);
      res.json(conditions);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/agent/conditions", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { label, category, conditionType, operator, value } = req.body;
      if (!label || !conditionType || !value) {
        return res.status(400).json({ error: "label, conditionType, and value are required" });
      }
      const condition = await storage.createAnalysisCondition({
        userId,
        label,
        category: category || "custom",
        conditionType,
        operator: operator || "gte",
        value: String(value),
        isBuiltIn: false,
        isEnabled: true,
      });
      res.json(condition);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/agent/conditions/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const updated = await storage.updateAnalysisCondition(req.params.id, userId, req.body);
      if (!updated) {
        return res.status(404).json({ error: "Condition not found" });
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/agent/conditions/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await storage.deleteAnalysisCondition(req.params.id, userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/agent/built-in-conditions", isAuthenticated, (_req, res) => {
    res.json(getBuiltInConditions());
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

function getBuiltInConditions() {
  return [
    {
      id: "rvol_min",
      label: "Min Relative Volume (RVOL)",
      category: "volume",
      conditionType: "rvol",
      operator: "gte",
      defaultValue: "1.5",
      description: "Relative volume vs 20-day average. Higher = more interest.",
    },
    {
      id: "volume_surge",
      label: "Volume Surge",
      category: "volume",
      conditionType: "volume_ratio",
      operator: "gte",
      defaultValue: "2.0",
      description: "Current bar volume vs average bar volume multiplier.",
    },
    {
      id: "ema_trend",
      label: "EMA Trend Alignment",
      category: "trend",
      conditionType: "ema_trend",
      operator: "eq",
      defaultValue: "bullish",
      description: "Price above EMA 9 > EMA 21 > EMA 50 stack.",
    },
    {
      id: "above_vwap",
      label: "Price Above VWAP",
      category: "trend",
      conditionType: "vwap_position",
      operator: "eq",
      defaultValue: "above",
      description: "Price trading above the session VWAP.",
    },
    {
      id: "min_price_change",
      label: "Min Price Change %",
      category: "momentum",
      conditionType: "price_change_pct",
      operator: "gte",
      defaultValue: "1.0",
      description: "Minimum intraday price change percentage.",
    },
    {
      id: "min_gap_pct",
      label: "Min Gap %",
      category: "momentum",
      conditionType: "gap_pct",
      operator: "gte",
      defaultValue: "2.0",
      description: "Minimum opening gap percentage from prior close.",
    },
    {
      id: "min_score",
      label: "Min Pattern Score",
      category: "pattern",
      conditionType: "pattern_score",
      operator: "gte",
      defaultValue: "60",
      description: "Minimum strategy pattern confidence score (0-100).",
    },
    {
      id: "min_rr",
      label: "Min Reward/Risk Ratio",
      category: "risk",
      conditionType: "reward_risk",
      operator: "gte",
      defaultValue: "1.5",
      description: "Minimum reward-to-risk ratio for the setup.",
    },
    {
      id: "max_risk_pct",
      label: "Max Risk % from Entry",
      category: "risk",
      conditionType: "risk_pct",
      operator: "lte",
      defaultValue: "3.0",
      description: "Maximum percentage distance from entry to stop loss.",
    },
    {
      id: "near_support",
      label: "Near Support Level",
      category: "price_level",
      conditionType: "near_support",
      operator: "lte",
      defaultValue: "2.0",
      description: "Price within X% of a support level.",
    },
    {
      id: "below_resistance",
      label: "Below Resistance",
      category: "price_level",
      conditionType: "below_resistance",
      operator: "lte",
      defaultValue: "1.0",
      description: "Price within X% below resistance / breakout level.",
    },
    {
      id: "squeeze",
      label: "Volatility Squeeze Active",
      category: "volatility",
      conditionType: "squeeze",
      operator: "eq",
      defaultValue: "true",
      description: "Bollinger Bands inside Keltner Channels (TTM Squeeze).",
    },
    {
      id: "pullback_depth",
      label: "Max Pullback Depth %",
      category: "pattern",
      conditionType: "pullback_depth",
      operator: "lte",
      defaultValue: "3.0",
      description: "Maximum percentage pullback from recent high.",
    },
    {
      id: "consolidation_tightness",
      label: "Consolidation Tightness %",
      category: "pattern",
      conditionType: "consolidation_tightness",
      operator: "lte",
      defaultValue: "5.0",
      description: "Max price range as % of high within the consolidation.",
    },
  ];
}

function evaluateCondition(condition: { conditionType: string; operator: string; value: string }, setup: any): boolean {
  const val = parseFloat(condition.value);
  const op = condition.operator;

  const compare = (actual: number | undefined | null): boolean => {
    if (actual === undefined || actual === null) return false;
    switch (op) {
      case "gte": return actual >= val;
      case "lte": return actual <= val;
      case "gt": return actual > val;
      case "lt": return actual < val;
      case "eq": return actual === val;
      default: return false;
    }
  };

  const metrics = setup.metrics || {};

  switch (condition.conditionType) {
    case "rvol":
      return compare(metrics.rvol ?? metrics.volume);
    case "volume_ratio":
      return compare(metrics.rvol ?? metrics.volume);
    case "pattern_score":
      return compare(setup.modelScore);
    case "reward_risk": {
      if (setup.entry && setup.stop && setup.targets?.[0]) {
        const risk = Math.abs(setup.entry - setup.stop);
        const reward = Math.abs(setup.targets[0] - setup.entry);
        return risk > 0 ? compare(reward / risk) : false;
      }
      return false;
    }
    case "risk_pct": {
      if (setup.entry && setup.stop) {
        const riskPct = Math.abs(setup.entry - setup.stop) / setup.entry * 100;
        return compare(riskPct);
      }
      return false;
    }
    case "price_change_pct":
      return compare(metrics.changePercent ?? metrics.change);
    case "gap_pct":
      return compare(metrics.gapPercent ?? metrics.gap);
    case "ema_trend": {
      const trend = metrics.trend || metrics.emaTrend;
      if (!trend) return false;
      return condition.value === trend;
    }
    case "vwap_position": {
      const price = metrics.currentPrice || setup.entry;
      const vwap = metrics.vwap;
      if (!price || !vwap) return false;
      return condition.value === "above" ? price > vwap : price < vwap;
    }
    case "squeeze": {
      const sq = metrics.squeezeActive ?? metrics.squeeze;
      if (sq === undefined || sq === null) return false;
      return condition.value === "true" ? !!sq : !sq;
    }
    case "pullback_depth":
      return compare(metrics.pullbackDepth);
    case "consolidation_tightness":
      return compare(metrics.consolidationTightness ?? metrics.tightness);
    case "near_support":
      return compare(metrics.distanceToSupport);
    case "below_resistance":
      return compare(metrics.distanceToResistance);
    case "custom_numeric":
      return false;
    default:
      return false;
  }
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
