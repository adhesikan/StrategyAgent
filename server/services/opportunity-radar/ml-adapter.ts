/**
 * ML Adapter Interface for Opportunity Radar.
 *
 * This is a pluggable interface for future ML models (Random Forest,
 * LSTM, TensorFlow.js, Python micro-services, etc.). The default
 * adapter returns null for every call so the rest of the scoring
 * engine can run without any model wired in.
 *
 * To add a real model later:
 *  1. Implement this interface (e.g. RandomForestAdapter)
 *  2. Export it as the default in this module or via DI
 *  3. The radar service will pick it up automatically
 */

export interface PredictedMove {
  expectedMovePct: number;
  horizonDays: number;
  confidence: number;
}

export interface PatternConfidence {
  patternName: string;
  confidence: number;
}

export interface VolatilityEdge {
  ivRank: number | null;
  ivPercentile: number | null;
  edge: "long_vol" | "short_vol" | "neutral" | null;
}

export interface MLAdapter {
  getPredictedMove(symbol: string, horizonDays: number): Promise<PredictedMove | null>;
  getPatternConfidence(symbol: string, timeframe: string): Promise<PatternConfidence | null>;
  getVolatilityEdge(symbol: string): Promise<VolatilityEdge | null>;
}

class NullMLAdapter implements MLAdapter {
  async getPredictedMove(): Promise<PredictedMove | null> {
    // TODO: wire to Random Forest / LSTM / TF.js model
    return null;
  }

  async getPatternConfidence(): Promise<PatternConfidence | null> {
    // TODO: wire to chart-pattern classifier
    return null;
  }

  async getVolatilityEdge(): Promise<VolatilityEdge | null> {
    // TODO: wire to IV-rank / IV-percentile calculator
    return null;
  }
}

export const defaultMLAdapter: MLAdapter = new NullMLAdapter();
