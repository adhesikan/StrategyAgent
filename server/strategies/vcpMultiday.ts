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

interface VCPContraction {
  startIndex: number;
  endIndex: number;
  highPrice: number;
  lowPrice: number;
  range: number;
  rangePercent: number;
}

function findContractions(candles: Candle[], minBars: number = 5): VCPContraction[] {
  if (candles.length < minBars * 2) return [];
  
  const contractions: VCPContraction[] = [];
  let i = 0;
  
  while (i < candles.length - minBars) {
    let highPrice = candles[i].high;
    let lowPrice = candles[i].low;
    let j = i + 1;
    
    while (j < candles.length && j - i < 30) {
      highPrice = Math.max(highPrice, candles[j].high);
      lowPrice = Math.min(lowPrice, candles[j].low);
      
      const range = highPrice - lowPrice;
      const rangePercent = (range / highPrice) * 100;
      
      if (j - i >= minBars && rangePercent < 15) {
        const isValidContraction = candles.slice(i, j + 1).every(c => 
          c.low >= lowPrice * 0.98 && c.high <= highPrice * 1.02
        );
        
        if (isValidContraction) {
          contractions.push({
            startIndex: i,
            endIndex: j,
            highPrice,
            lowPrice,
            range,
            rangePercent,
          });
          i = j;
          break;
        }
      }
      j++;
    }
    i++;
  }
  
  return contractions;
}

function isVolatilityContracting(contractions: VCPContraction[]): boolean {
  if (contractions.length < 2) return false;
  
  for (let i = 1; i < contractions.length; i++) {
    if (contractions[i].rangePercent >= contractions[i - 1].rangePercent * 0.95) {
      return false;
    }
  }
  return true;
}

function calcEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    ema.push(prices[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function computeMultidayLevels(quote: QuoteData, candles?: Candle[]): StrategyLevels {
  let resistance: number;
  let stopLevel: number;

  if (candles && candles.length >= 20) {
    resistance = Math.max(...candles.slice(-20).map(c => c.high));
    const recentLows = candles.slice(-10).map(c => c.low);
    stopLevel = Math.min(...recentLows) * 0.98;
  } else {
    const highPrice = quote.high && quote.high > 0 ? quote.high : quote.last;
    resistance = highPrice * 1.02;
    const lowPrice = quote.low && quote.low > 0 ? quote.low : quote.last * 0.97;
    stopLevel = Math.min(lowPrice * 0.995, quote.last * 0.97);
  }

  return {
    resistance: Number(resistance.toFixed(2)),
    entryTrigger: Number((resistance * 1.001).toFixed(2)),
    stopLevel: Number(stopLevel.toFixed(2)),
    exitRule: "Close below last contraction low or 21 EMA",
  };
}

function explainMultidayVCP(
  stage: string,
  numContractions: number,
  hasContractingVolatility: boolean,
  rvol: number,
  pivotPrice: number
): string {
  if (stage === PatternStage.BREAKOUT) {
    return `VCP breakout! ${numContractions} contractions detected with ${rvol.toFixed(1)}x volume. Pivot: $${pivotPrice.toFixed(2)}`;
  } else if (stage === PatternStage.READY) {
    return `VCP ready with ${numContractions} contracting bases (T1>T2${numContractions >= 3 ? '>T3' : ''}). Watching pivot at $${pivotPrice.toFixed(2)}`;
  } else if (hasContractingVolatility && numContractions >= 1) {
    return `VCP forming with ${numContractions} base${numContractions > 1 ? 's' : ''} detected. Volatility ${hasContractingVolatility ? 'is' : 'not yet'} contracting.`;
  } else {
    return "Early stage consolidation. Monitoring for VCP base development.";
  }
}

export const vcpMultidayStrategy: Strategy = {
  id: StrategyId.VCP_MULTIDAY,
  name: "Multi-timeframe VCP",
  description: "True VCP pattern detection using historical candles - identifies multiple contracting bases (T1>T2>T3) over days/weeks.",

  classify(quote: QuoteData, candles?: Candle[], _config?: StrategyConfig): StrategyClassification {
    const levels = computeMultidayLevels(quote, candles);
    
    if (!candles || candles.length < 30) {
      const volumeRatio = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
      const proximityBoost = quote.dayHigh
        ? Math.max(0, Math.min(10, (12 - ((quote.dayHigh - quote.last) / quote.dayHigh) * 100) * 0.8))
        : 4;
      const rvolBoost = Math.max(0, Math.min(12, (volumeRatio - 1) * 8));
      const momentumBoost = Math.max(0, Math.min(8, quote.changePercent * 2));
      const fallbackScore = Math.round(
        Math.max(50, Math.min(70, 50 + rvolBoost + proximityBoost + momentumBoost)),
      );
      return {
        stage: PatternStage.FORMING,
        levels,
        score: fallbackScore,
        ema9: quote.last * 0.99,
        ema21: quote.last * 0.97,
        rvol: volumeRatio,
        explanation: "Insufficient historical data for multi-timeframe VCP analysis. Connect a broker for full pattern detection.",
      };
    }

    const closes = candles.map(c => c.close);
    const ema9 = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);
    const lastEma9 = ema9[ema9.length - 1];
    const lastEma21 = ema21[ema21.length - 1];

    const contractions = findContractions(candles);
    const hasContractingVolatility = isVolatilityContracting(contractions);
    const numContractions = contractions.length;

    const recentHigh = Math.max(...candles.slice(-20).map(c => c.high));
    const priceFromHigh = ((recentHigh - quote.last) / recentHigh) * 100;

    const avgVolume = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    const volumeRatio = avgVolume > 0 ? quote.volume / avgVolume : 1;

    const inUptrend = lastEma9 > lastEma21 && quote.last > lastEma21;

    let stage: string;
    let score: number;

    const lastContraction = contractions[contractions.length - 1];
    const pivotPrice = lastContraction ? lastContraction.highPrice : recentHigh;
    const isBreakingOut = quote.last > pivotPrice && volumeRatio > 1.5 && quote.changePercent > 1;

    if (isBreakingOut && hasContractingVolatility && numContractions >= 2) {
      stage = PatternStage.BREAKOUT;
      score = Math.min(100, 85 + numContractions * 3 + Math.floor(volumeRatio * 2));
    } else if (hasContractingVolatility && numContractions >= 2 && priceFromHigh < 5 && inUptrend) {
      stage = PatternStage.READY;
      score = Math.min(95, 70 + numContractions * 5 + Math.floor((5 - priceFromHigh) * 3));
    } else if (numContractions >= 1 && inUptrend) {
      stage = PatternStage.FORMING;
      score = Math.min(100, Math.max(40, 55 + numContractions * 5 - Math.floor(priceFromHigh)));
    } else {
      stage = PatternStage.FORMING;
      // Even setups without contractions or uptrend deserve a signal-driven
      // score (rvol/proximity/momentum) instead of always flooring at 20-30.
      const rvolBoost = Math.max(0, Math.min(12, (volumeRatio - 1) * 8));
      const proximityBoost = Math.max(0, Math.min(10, (15 - priceFromHigh) * 0.7));
      const momentumBoost = Math.max(0, Math.min(8, quote.changePercent * 2));
      score = Math.round(
        Math.max(48, Math.min(68, 48 + rvolBoost + proximityBoost + momentumBoost)),
      );
    }

    return {
      stage,
      levels,
      score,
      ema9: Number(lastEma9.toFixed(2)),
      ema21: Number(lastEma21.toFixed(2)),
      rvol: Number(volumeRatio.toFixed(2)),
      explanation: explainMultidayVCP(stage, numContractions, hasContractingVolatility, volumeRatio, pivotPrice),
    };
  },

  computeLevels(quote: QuoteData, candles?: Candle[]): StrategyLevels {
    return computeMultidayLevels(quote, candles);
  },

  explain(classification: StrategyClassification): string {
    const { stage, rvol } = classification;
    if (stage === PatternStage.BREAKOUT) {
      return `Multi-day VCP breakout with ${rvol?.toFixed(1)}x volume surge.`;
    } else if (stage === PatternStage.READY) {
      return "Multi-day VCP pattern ready - watching for volume breakout.";
    }
    return "Multi-day VCP pattern forming - monitoring base development.";
  },
};
