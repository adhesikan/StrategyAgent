import { Strategy, StrategyPlugin, StrategyId, StrategyIdType, ScanResultItem, StrategyConfig, Candle, ScanInput, ScanResultOutput } from "./types";
import { vcpStrategy } from "./vcp";
import { vcpMultidayStrategy } from "./vcpMultiday";
import { classicPullbackStrategy } from "./classicPullback";
import { vwapReclaimStrategy } from "./vwapReclaim";
import { orb5Strategy, orb15Strategy } from "./orb";
import { highRvolStrategy } from "./highRvol";
import { gapAndGoStrategy } from "./gapAndGo";
import { trendContinuationStrategy } from "./trendContinuation";
import { volatilitySqueezeStrategy } from "./volatilitySqueeze";
import { QuoteData } from "../broker-service";
import { CandleData } from "../engine/indicators";
import { getStrategyConfig, STRATEGY_CONFIGS, type StrategyCategory } from "@shared/strategies";

export * from "./types";

const strategies: Map<StrategyIdType, Strategy> = new Map([
  [StrategyId.VCP, vcpStrategy],
  [StrategyId.VCP_MULTIDAY, vcpMultidayStrategy],
  [StrategyId.CLASSIC_PULLBACK, classicPullbackStrategy],
]);

const strategyPlugins: Map<StrategyIdType, StrategyPlugin> = new Map([
  [StrategyId.VWAP_RECLAIM, vwapReclaimStrategy],
  [StrategyId.ORB5, orb5Strategy],
  [StrategyId.ORB15, orb15Strategy],
  [StrategyId.HIGH_RVOL, highRvolStrategy],
  [StrategyId.GAP_AND_GO, gapAndGoStrategy],
  [StrategyId.TREND_CONTINUATION, trendContinuationStrategy],
  [StrategyId.VOLATILITY_SQUEEZE, volatilitySqueezeStrategy],
]);

export function getStrategy(id: StrategyIdType): Strategy | undefined {
  return strategies.get(id);
}

export function getStrategyPlugin(id: StrategyIdType): StrategyPlugin | undefined {
  return strategyPlugins.get(id);
}

export function getAllStrategies(): Strategy[] {
  return Array.from(strategies.values());
}

export function getAllStrategyPlugins(): StrategyPlugin[] {
  return Array.from(strategyPlugins.values());
}

export function getAllStrategyIds(): StrategyIdType[] {
  return [
    ...Array.from(strategies.keys()),
    ...Array.from(strategyPlugins.keys()),
  ];
}

export interface StrategyListItem {
  id: StrategyIdType;
  name: string;
  displayName: string;
  description: string;
  shortDescription: string;
  category: StrategyCategory;
  legacyName: string;
}

export function getStrategyList(): StrategyListItem[] {
  return STRATEGY_CONFIGS.map(config => ({
    id: config.id as StrategyIdType,
    name: config.displayName,
    displayName: config.displayName,
    description: config.shortDescription,
    shortDescription: config.shortDescription,
    category: config.category,
    legacyName: config.legacyName,
  }));
}

export const STRATEGY_PRESETS = {
  BREAKOUTS: [StrategyId.VCP, StrategyId.VCP_MULTIDAY, StrategyId.HIGH_RVOL, StrategyId.VOLATILITY_SQUEEZE],
  INTRADAY: [StrategyId.VWAP_RECLAIM, StrategyId.ORB5, StrategyId.ORB15, StrategyId.GAP_AND_GO],
  SWING: [StrategyId.VCP_MULTIDAY, StrategyId.CLASSIC_PULLBACK, StrategyId.TREND_CONTINUATION],
  ALL: Object.values(StrategyId),
};

export function classifyQuote(
  strategyId: StrategyIdType,
  quote: QuoteData,
  candles?: Candle[],
  config?: StrategyConfig
): ScanResultItem | null {
  const strategy = strategies.get(strategyId);
  if (strategy) {
    const classification = strategy.classify(quote, candles, config);
    
    return {
      symbol: quote.symbol,
      name: quote.symbol,
      price: Number(quote.last.toFixed(2)),
      change: Number(quote.change.toFixed(2)),
      changePercent: Number(quote.changePercent.toFixed(2)),
      volume: quote.volume,
      avgVolume: quote.avgVolume || null,
      rvol: classification.rvol ? Number(classification.rvol.toFixed(2)) : null,
      stage: classification.stage,
      strategyId,
      resistance: classification.levels.resistance || 0,
      stopLevel: classification.levels.stopLevel,
      entryTrigger: classification.levels.entryTrigger,
      exitRule: classification.levels.exitRule,
      score: classification.score,
      ema9: Number((classification.ema9 || quote.last * 0.99).toFixed(2)),
      ema21: Number((classification.ema21 || quote.last * 0.97).toFixed(2)),
      vwap: classification.vwap,
      explanation: classification.explanation,
    };
  }

  const plugin = strategyPlugins.get(strategyId);
  if (plugin) {
    if (candles && candles.length >= 20) {
      const candleData: CandleData[] = candles.map(c => ({
        time: String(typeof c.timestamp === "number" ? c.timestamp : new Date(c.timestamp).getTime() / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));
      const result = plugin.scan({
        symbol: quote.symbol,
        candles: candleData,
        timeframe: "1d",
        params: config || plugin.defaultParams,
        quote,
      });
      if (result) {
        return {
          symbol: result.symbol,
          name: result.name || quote.symbol,
          price: result.price,
          change: Number(quote.change.toFixed(2)),
          changePercent: Number(quote.changePercent.toFixed(2)),
          volume: quote.volume,
          avgVolume: quote.avgVolume || null,
          rvol: result.rvol ? Number(result.rvol.toFixed(2)) : null,
          stage: result.stage,
          strategyId,
          resistance: result.levels.resistance || result.levels.entryTrigger || quote.last * 1.02,
          stopLevel: result.levels.stopLevel,
          entryTrigger: result.levels.entryTrigger,
          exitRule: result.levels.exitRule,
          score: Math.min(100, Math.round(result.score)),
          ema9: Number((quote.last * 0.99).toFixed(2)),
          ema21: Number((quote.last * 0.97).toFixed(2)),
          explanation: result.explanation,
        };
      }
    }

    return classifyQuoteFromPlugin(strategyId, quote);
  }

  return null;
}

function classifyQuoteFromPlugin(
  strategyId: StrategyIdType,
  quote: QuoteData
): ScanResultItem | null {
  const volumeRatio = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
  const priceFromOpen = quote.open ? ((quote.last - quote.open) / quote.open) * 100 : 0;
  const gapPercent = quote.prevClose ? ((quote.open - quote.prevClose) / quote.prevClose) * 100 : quote.changePercent;

  let stage = "FORMING";
  let score = 40;
  let qualifies = false;
  let resistance = quote.high || quote.last * 1.02;
  let stopLevel = quote.last * 0.95;

  switch (strategyId) {
    case StrategyId.ORB5:
    case StrategyId.ORB15: {
      qualifies = Math.abs(priceFromOpen) > 0.5 && volumeRatio > 1.0;
      if (priceFromOpen > 1.5 && volumeRatio > 1.5) { stage = "BREAKOUT"; score = 80 + Math.min(20, Math.floor(volumeRatio * 5)); }
      else if (priceFromOpen > 0.5 && volumeRatio > 1.2) { stage = "READY"; score = 60 + Math.min(20, Math.floor(volumeRatio * 5)); }
      else { score = 40 + Math.min(20, Math.floor(Math.abs(priceFromOpen) * 10)); }
      resistance = quote.last * 1.015;
      stopLevel = quote.open || quote.last * 0.985;
      break;
    }
    case StrategyId.GAP_AND_GO: {
      qualifies = gapPercent > 2 && priceFromOpen >= 0 && volumeRatio > 1.2;
      if (gapPercent > 3 && priceFromOpen > 1 && volumeRatio > 2) { stage = "BREAKOUT"; score = 80 + Math.min(20, Math.floor(gapPercent * 3)); }
      else if (gapPercent > 2 && priceFromOpen >= 0 && volumeRatio > 1.5) { stage = "READY"; score = 60 + Math.min(20, Math.floor(gapPercent * 4)); }
      else { score = 40 + Math.min(20, Math.floor(gapPercent * 5)); }
      stopLevel = quote.open || quote.last * 0.97;
      break;
    }
    case StrategyId.VWAP_RECLAIM: {
      const vwapProxy = (quote.high + quote.low + quote.last) / 3;
      const priceFromVWAP = vwapProxy ? ((quote.last - vwapProxy) / vwapProxy) * 100 : 0;
      qualifies = Math.abs(priceFromVWAP) < 1 && volumeRatio > 0.8;
      if (priceFromVWAP > 0.3 && priceFromVWAP < 1 && volumeRatio > 1.3) { stage = "BREAKOUT"; score = 75 + Math.min(25, Math.floor(volumeRatio * 8)); }
      else if (Math.abs(priceFromVWAP) < 0.5 && volumeRatio > 1.0) { stage = "READY"; score = 60 + Math.min(20, Math.floor(volumeRatio * 8)); }
      else { score = 45 + Math.min(15, Math.floor(volumeRatio * 5)); }
      resistance = quote.high || quote.last * 1.015;
      stopLevel = vwapProxy * 0.99;
      break;
    }
    case StrategyId.HIGH_RVOL: {
      qualifies = volumeRatio > 2.0 && quote.change > 0;
      if (volumeRatio > 3.0 && quote.changePercent > 2) { stage = "BREAKOUT"; score = 80 + Math.min(20, Math.floor(volumeRatio * 4)); }
      else if (volumeRatio > 2.5 && quote.changePercent > 0.5) { stage = "READY"; score = 65 + Math.min(20, Math.floor(volumeRatio * 4)); }
      else { score = 40 + Math.min(20, Math.floor(volumeRatio * 8)); }
      break;
    }
    default: {
      qualifies = quote.changePercent > 2 && volumeRatio > 1.5;
      if (qualifies) { stage = "BREAKOUT"; score = 75; }
      else if (quote.changePercent > 0 && volumeRatio > 1.0) { qualifies = true; stage = "READY"; score = 55; }
      break;
    }
  }

  if (!qualifies) return null;

  score = Math.min(100, Math.max(0, Math.round(score)));

  return {
    symbol: quote.symbol,
    name: quote.symbol,
    price: Number(quote.last.toFixed(2)),
    change: Number(quote.change.toFixed(2)),
    changePercent: Number(quote.changePercent.toFixed(2)),
    volume: quote.volume,
    avgVolume: quote.avgVolume || null,
    rvol: volumeRatio > 0 ? Number(volumeRatio.toFixed(2)) : null,
    stage,
    strategyId,
    resistance: Number(resistance.toFixed(2)),
    stopLevel: Number(stopLevel.toFixed(2)),
    score,
    ema9: Number((quote.last * 0.99).toFixed(2)),
    ema21: Number((quote.last * 0.97).toFixed(2)),
  };
}

export function runPluginScan(
  strategyId: StrategyIdType,
  input: ScanInput
): ScanResultOutput | null {
  const plugin = strategyPlugins.get(strategyId);
  if (!plugin) return null;
  
  return plugin.scan(input);
}

export function runAllPluginScans(
  symbol: string,
  candles: CandleData[],
  timeframe: string,
  strategyIds?: StrategyIdType[],
  quote?: QuoteData
): ScanResultOutput[] {
  const results: ScanResultOutput[] = [];
  const idsToScan = strategyIds || Array.from(strategyPlugins.keys());
  
  for (const id of idsToScan) {
    const plugin = strategyPlugins.get(id);
    if (!plugin) continue;
    
    const result = plugin.scan({
      symbol,
      candles,
      timeframe,
      params: plugin.defaultParams,
      quote,
    });
    
    if (result) {
      results.push(result);
    }
  }
  
  return results;
}

export { 
  vcpStrategy, 
  vcpMultidayStrategy, 
  classicPullbackStrategy,
  vwapReclaimStrategy,
  orb5Strategy,
  orb15Strategy,
  highRvolStrategy,
  gapAndGoStrategy,
  trendContinuationStrategy,
  volatilitySqueezeStrategy,
};
