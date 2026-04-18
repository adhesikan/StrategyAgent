import { type ParsedRequest } from "./prompt-interpreter";
import { getStrategyPlugin, getStrategy, StrategyId, type StrategyIdType } from "../strategies";
import type { ScanResultOutput } from "../strategies/types";

export interface TradeSetup {
  id: string;
  symbol: string;
  assetType: "stock" | "option" | "future";
  strategyName: string;
  timeframe: string;
  setupType: string;
  bias: "bullish" | "bearish" | "neutral";
  entry: number;
  stop: number;
  targets: number[];
  rewardRisk: number | null;
  modelScore: number | null;
  reasoning: string[];
  invalidation: string[];
  metrics: {
    trend?: string;
    volume?: string;
    volatility?: string;
    openingRangeHigh?: number;
    openingRangeLow?: number;
    currentPrice?: number;
    rvol?: number;
    ema9?: number;
    ema21?: number;
    vwap?: number;
  };
  dataSource: string;
  generatedAt: string;
  appliedConditions?: Array<{ type: string; operator: string; value: string; passed: boolean }>;
  conditionWarnings?: string[];
}

const STRATEGY_DISPLAY_NAMES: Record<string, string> = {
  [StrategyId.ORB15]: "15-Minute Opening Range Breakout",
  [StrategyId.ORB5]: "5-Minute Opening Range Breakout",
  [StrategyId.VWAP_RECLAIM]: "VWAP Reclaim",
  [StrategyId.CLASSIC_PULLBACK]: "EMA Pullback",
  [StrategyId.VOLATILITY_SQUEEZE]: "Volatility Breakout",
  [StrategyId.VCP]: "VCP-Style Breakout",
  [StrategyId.VCP_MULTIDAY]: "VCP Multi-Day",
  [StrategyId.HIGH_RVOL]: "High Relative Volume",
  [StrategyId.GAP_AND_GO]: "Gap and Go",
  [StrategyId.TREND_CONTINUATION]: "Trend Continuation",
};

function generateId(): string {
  return `setup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function generateSetupFromScanResult(
  scanResult: ScanResultOutput,
  request: ParsedRequest
): TradeSetup {
  const entry = scanResult.levels.entryTrigger;
  const stop = scanResult.levels.stopLevel;
  const risk = Math.abs(entry - stop);

  const target1 = entry + risk * 1.5;
  const target2 = entry + risk * 2.5;
  const targets = [parseFloat(target1.toFixed(2)), parseFloat(target2.toFixed(2))];
  const rewardRisk = risk > 0 ? parseFloat(((target1 - entry) / risk).toFixed(2)) : null;

  const reasoning: string[] = [];
  const invalidation: string[] = [];

  if (scanResult.strategyId === StrategyId.ORB15 || scanResult.strategyId === StrategyId.ORB5) {
    const mins = scanResult.strategyId === StrategyId.ORB15 ? 15 : 5;
    if (scanResult.levels.openingRangeHigh && scanResult.levels.openingRangeLow) {
      reasoning.push(`Opening range established: $${scanResult.levels.openingRangeLow.toFixed(2)} - $${scanResult.levels.openingRangeHigh.toFixed(2)}`);
    }
    if (scanResult.stage === "BREAKOUT") {
      reasoning.push(`Price broke above ${mins}-minute opening range high with volume confirmation`);
    } else if (scanResult.stage === "READY") {
      reasoning.push(`Price above opening range high, awaiting volume confirmation`);
    }
    if (scanResult.rvol && scanResult.rvol >= 1.5) {
      reasoning.push(`Relative volume is elevated at ${scanResult.rvol.toFixed(1)}x average`);
    }
    reasoning.push(`Pattern stage: ${scanResult.stage}`);

    invalidation.push(`Price closes below opening range low ($${scanResult.levels.openingRangeLow?.toFixed(2) || stop.toFixed(2)})`);
    invalidation.push(`Volume dries up significantly below average`);
    invalidation.push(`Setup invalidated if price reverses and holds below entry`);
  } else {
    reasoning.push(`Strategy conditions met for ${STRATEGY_DISPLAY_NAMES[scanResult.strategyId] || scanResult.strategyId}`);
    reasoning.push(`Pattern stage: ${scanResult.stage}`);
    if (scanResult.rvol && scanResult.rvol >= 1.5) {
      reasoning.push(`Elevated relative volume: ${scanResult.rvol.toFixed(1)}x`);
    }
    if (scanResult.explanation) {
      reasoning.push(scanResult.explanation.replace(/This alert is informational only.*$/, "").trim());
    }
    invalidation.push(`Price breaks below stop level ($${stop.toFixed(2)})`);
    invalidation.push(`Pattern structure breaks down`);
  }

  const volumeDesc = scanResult.rvol
    ? scanResult.rvol >= 2 ? "High" : scanResult.rvol >= 1.5 ? "Above Average" : "Normal"
    : "N/A";

  return {
    id: generateId(),
    symbol: scanResult.symbol,
    assetType: request.assetType,
    strategyName: STRATEGY_DISPLAY_NAMES[scanResult.strategyId] || scanResult.strategyId,
    timeframe: request.timeframe || "15m",
    setupType: scanResult.stage,
    bias: request.bias || "bullish",
    entry: parseFloat(entry.toFixed(2)),
    stop: parseFloat(stop.toFixed(2)),
    targets,
    rewardRisk,
    modelScore: scanResult.score,
    reasoning,
    invalidation,
    metrics: {
      trend: scanResult.ema9 && scanResult.ema21
        ? scanResult.ema9 > scanResult.ema21 ? "Bullish (EMA9 > EMA21)" : "Bearish"
        : undefined,
      volume: volumeDesc,
      volatility: undefined,
      openingRangeHigh: scanResult.levels.openingRangeHigh,
      openingRangeLow: scanResult.levels.openingRangeLow,
      currentPrice: scanResult.price,
      rvol: scanResult.rvol || undefined,
      ema9: scanResult.ema9,
      ema21: scanResult.ema21,
      vwap: scanResult.vwap,
    },
    dataSource: "broker",
    generatedAt: new Date().toISOString(),
  };
}

export function generateMockSetup(request: ParsedRequest): TradeSetup {
  const symbol = request.symbol || "TSLA";
  const strategyId = request.strategy || StrategyId.ORB15;
  const basePrice = getDefaultPrice(symbol);

  const orHigh = parseFloat((basePrice * 1.005).toFixed(2));
  const orLow = parseFloat((basePrice * 0.995).toFixed(2));
  const entry = orHigh;
  const stop = orLow;
  const risk = entry - stop;
  const target1 = parseFloat((entry + risk * 1.5).toFixed(2));
  const target2 = parseFloat((entry + risk * 2.5).toFixed(2));

  const reasoning: string[] = [];
  const invalidation: string[] = [];

  if (strategyId === StrategyId.ORB15 || strategyId === StrategyId.ORB5) {
    const mins = strategyId === StrategyId.ORB15 ? 15 : 5;
    reasoning.push(`Opening range established: $${orLow.toFixed(2)} - $${orHigh.toFixed(2)}`);
    reasoning.push(`Price broke above ${mins}-minute opening range high`);
    reasoning.push(`Relative volume elevated at 2.1x average`);
    reasoning.push(`Pattern stage: BREAKOUT`);
    invalidation.push(`Price closes below opening range low ($${orLow.toFixed(2)})`);
    invalidation.push(`Volume drops significantly below average`);
    invalidation.push(`Setup invalidated if price reverses below entry`);
  } else if (strategyId === StrategyId.VWAP_RECLAIM) {
    reasoning.push(`Price reclaimed VWAP from below`);
    reasoning.push(`Volume confirmed on reclaim candle`);
    reasoning.push(`EMA9 crossing above EMA21`);
    invalidation.push(`Price loses VWAP again on increased volume`);
    invalidation.push(`Price breaks below stop level`);
  } else {
    reasoning.push(`Strategy conditions met for ${STRATEGY_DISPLAY_NAMES[strategyId] || strategyId}`);
    reasoning.push(`Pattern identified with qualifying metrics`);
    reasoning.push(`Volume and price action confirm setup`);
    invalidation.push(`Price breaks below stop level ($${stop.toFixed(2)})`);
    invalidation.push(`Pattern structure breaks down`);
  }

  return {
    id: generateId(),
    symbol,
    assetType: request.assetType,
    strategyName: STRATEGY_DISPLAY_NAMES[strategyId] || strategyId,
    timeframe: request.timeframe || "15m",
    setupType: "BREAKOUT",
    bias: request.bias || "bullish",
    entry,
    stop,
    targets: [target1, target2],
    rewardRisk: parseFloat(((target1 - entry) / risk).toFixed(2)),
    modelScore: 78,
    reasoning,
    invalidation,
    metrics: {
      trend: "Bullish (EMA9 > EMA21)",
      volume: "Above Average",
      volatility: "Moderate",
      openingRangeHigh: orHigh,
      openingRangeLow: orLow,
      currentPrice: basePrice,
      rvol: 2.1,
    },
    dataSource: "simulated",
    generatedAt: new Date().toISOString(),
  };
}

function getDefaultPrice(symbol: string): number {
  const prices: Record<string, number> = {
    TSLA: 248.50,
    AAPL: 192.30,
    NVDA: 875.40,
    MSFT: 415.20,
    AMZN: 185.60,
    META: 505.80,
    GOOGL: 155.90,
    AMD: 165.30,
    SPY: 520.40,
    QQQ: 445.60,
    ES: 5280.00,
    NQ: 18450.00,
  };
  return prices[symbol] || 150.00;
}

export function getBuiltInStrategies() {
  return [
    {
      id: StrategyId.ORB15,
      name: "15-Minute ORB",
      displayName: "15-Minute Opening Range Breakout",
      description: "Trades the breakout of the first 15-minute candle's high/low range",
      category: "intraday",
      timeframes: ["5m", "15m"],
    },
    {
      id: StrategyId.ORB5,
      name: "5-Minute ORB",
      displayName: "5-Minute Opening Range Breakout",
      description: "Trades the breakout of the first 5-minute candle's range",
      category: "intraday",
      timeframes: ["1m", "5m"],
    },
    {
      id: StrategyId.VWAP_RECLAIM,
      name: "VWAP Reclaim",
      displayName: "VWAP Reclaim",
      description: "Identifies when price reclaims VWAP from below with volume confirmation",
      category: "intraday",
      timeframes: ["5m", "15m"],
    },
    {
      id: StrategyId.CLASSIC_PULLBACK,
      name: "EMA Pullback",
      displayName: "EMA Pullback",
      description: "Finds pullbacks to key EMAs in an established uptrend",
      category: "swing",
      timeframes: ["15m", "1h", "1D"],
    },
    {
      id: StrategyId.VOLATILITY_SQUEEZE,
      name: "Volatility Breakout",
      displayName: "Volatility Breakout",
      description: "Detects volatility compression setups before expansion moves",
      category: "breakout",
      timeframes: ["15m", "1h", "1D"],
    },
    {
      id: StrategyId.VCP,
      name: "VCP Breakout",
      displayName: "VCP-Style Breakout",
      description: "Identifies Volatility Contraction Pattern setups for breakout entries",
      category: "breakout",
      timeframes: ["1D"],
    },
    {
      id: StrategyId.GAP_AND_GO,
      name: "Gap and Go",
      displayName: "Gap and Go",
      description: "Identifies gap-up stocks with continuation momentum",
      category: "intraday",
      timeframes: ["5m", "15m"],
    },
    {
      id: StrategyId.HIGH_RVOL,
      name: "High RVOL",
      displayName: "High Relative Volume",
      description: "Finds stocks with unusually high relative volume for momentum setups",
      category: "intraday",
      timeframes: ["5m", "15m"],
    },
    {
      id: StrategyId.TREND_CONTINUATION,
      name: "Trend Continuation",
      displayName: "Trend Continuation",
      description: "Identifies continuation patterns within established trends",
      category: "swing",
      timeframes: ["15m", "1h", "1D"],
    },
  ];
}
