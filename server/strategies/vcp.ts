import { QuoteData } from "../broker-service";
import { 
  Strategy, 
  StrategyId, 
  StrategyClassification, 
  StrategyLevels,
  Candle,
  StrategyConfig 
} from "./types";
import { PatternStage } from "@shared/schema";

export const vcpStrategy: Strategy = {
  id: StrategyId.VCP,
  name: "Intraday VCP",
  description: "Same-day VCP detection using intraday quote data - identifies momentum breakouts with volume confirmation.",

  classify(quote: QuoteData, _candles?: Candle[], _config?: StrategyConfig): StrategyClassification {
    const priceFromHigh = ((quote.high - quote.last) / quote.high) * 100;
    const volumeRatio = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
    
    let stage: string;
    let score: number;
    
    if (quote.change > 0 && quote.changePercent > 2 && volumeRatio > 1.5) {
      stage = PatternStage.BREAKOUT;
      score = Math.min(100, 80 + Math.floor(volumeRatio * 5));
    } else if (priceFromHigh < 5 && quote.change > 0) {
      stage = PatternStage.READY;
      score = Math.min(95, 65 + Math.floor((5 - priceFromHigh) * 6));
    } else {
      stage = PatternStage.FORMING;
      // Forming setups still vary by RVOL, proximity to high, and intraday move.
      // Old formula floored at 30 for every quote >15% off the high — too flat.
      const rvolBoost = Math.max(0, Math.min(14, (volumeRatio - 1) * 10));
      const proximityBoost = Math.max(0, Math.min(10, (12 - priceFromHigh) * 0.8));
      const momentumBoost = Math.max(0, Math.min(8, quote.changePercent * 2));
      score = Math.round(
        Math.max(50, Math.min(72, 50 + rvolBoost + proximityBoost + momentumBoost)),
      );
    }
    
    const levels = this.computeLevels(quote);
    
    return {
      stage,
      levels,
      score,
      ema9: quote.last * 0.99,
      ema21: quote.last * 0.97,
      rvol: volumeRatio,
      explanation: this.explain({ stage, levels, score, rvol: volumeRatio, explanation: "" }),
    };
  },

  computeLevels(quote: QuoteData): StrategyLevels {
    const highPrice = quote.high && quote.high > 0 ? quote.high : quote.last;
    const resistance = highPrice * 1.02;
    const lowPrice = quote.low && quote.low > 0 ? quote.low : quote.last * 0.97;
    const stopLevel = Math.min(lowPrice * 0.995, quote.last * 0.97);
    
    return {
      resistance: Number(resistance.toFixed(2)),
      entryTrigger: Number(resistance.toFixed(2)),
      stopLevel: Number(stopLevel.toFixed(2)),
      exitRule: "Close below 21 EMA or stop hit",
    };
  },

  explain(classification: StrategyClassification): string {
    const { stage, rvol } = classification;
    
    if (stage === PatternStage.BREAKOUT) {
      return `VCP breakout detected with ${rvol?.toFixed(1)}x relative volume. Pattern has contracted and is now expanding.`;
    } else if (stage === PatternStage.READY) {
      return "VCP pattern is tightening near resistance. Watch for volume confirmation on breakout.";
    } else {
      return "VCP pattern is forming. Waiting for volatility contraction and base tightening.";
    }
  },
};
