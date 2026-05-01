/**
 * Opportunity Radar — Scoring Engine
 *
 * Pure scoring functions with no IO. Each scorer takes already-fetched
 * inputs and returns a 0–100 score. The composite score is a weighted
 * combination per the product spec.
 */

export interface TechnicalInputs {
  price: number;
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  rsi: number | null;
  high20: number | null;
  low20: number | null;
  volume: number | null;
  avgVolume: number | null;
}

export interface MomentumInputs {
  changePct1d: number | null;
  changePct5d: number | null;
  rvol: number | null;
  gapPct: number | null;
}

export interface SentimentInputs {
  bullishHeadlines: number;
  neutralHeadlines: number;
  bearishHeadlines: number;
  available: boolean;
}

export interface OptionsLiquidityInputs {
  openInterest: number | null;
  optionVolume: number | null;
  bidAskSpreadPct: number | null;
  hasDelta: boolean;
  hasExpiration: boolean;
  isOptionsStrategy: boolean;
}

export interface RiskInputs {
  maxLoss: number;
  userMaxLossLimit: number;
  capitalRequired: number;
  buyingPower: number | null;
  earningsInDays: number | null;
  avoidEarningsDays: number;
  existingExposureSameTicker: number;
  strategyRiskLevel: "low" | "medium" | "high";
}

export type Bias = "bullish" | "bearish" | "neutral";
export type Grade = "A+" | "A" | "B" | "C";

const clamp = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, v));

export function scoreTechnical(inputs: TechnicalInputs, bias: Bias): number {
  const { price, ema9, ema21, ema50, rsi, high20, low20, volume, avgVolume } = inputs;
  let score = 50;

  if (ema9 != null && ema21 != null && ema50 != null) {
    const stacked = ema9 > ema21 && ema21 > ema50;
    const inverseStacked = ema9 < ema21 && ema21 < ema50;
    if (bias === "bullish" && stacked) score += 15;
    else if (bias === "bearish" && inverseStacked) score += 15;
    else if (bias === "neutral" && Math.abs(ema9 - ema21) / ema21 < 0.01) score += 10;
    if (bias === "bullish" && price > ema21) score += 5;
    if (bias === "bearish" && price < ema21) score += 5;
  }

  if (rsi != null) {
    if (bias === "bullish" && rsi >= 50 && rsi <= 70) score += 10;
    else if (bias === "bearish" && rsi <= 50 && rsi >= 30) score += 10;
    else if (bias === "neutral" && rsi >= 40 && rsi <= 60) score += 8;
    else if (rsi > 80 || rsi < 20) score -= 10;
  }

  if (high20 != null && low20 != null) {
    const range = high20 - low20;
    if (range > 0) {
      const pos = (price - low20) / range;
      if (bias === "bullish" && pos > 0.7) score += 8; // breakout proximity
      if (bias === "bearish" && pos < 0.3) score += 8;
      if (bias === "neutral" && pos >= 0.4 && pos <= 0.6) score += 6;
    }
  }

  if (volume != null && avgVolume != null && avgVolume > 0) {
    const rvol = volume / avgVolume;
    if (rvol >= 1.2) score += 5;
    if (rvol >= 2.0) score += 5;
  }

  return clamp(score);
}

export function scoreMomentum(inputs: MomentumInputs, bias: Bias): number {
  const { changePct1d, changePct5d, rvol, gapPct } = inputs;
  let score = 50;

  if (rvol != null) {
    if (rvol >= 2.5) score += 15;
    else if (rvol >= 1.5) score += 10;
    else if (rvol >= 1.0) score += 5;
    else score -= 5;
  }

  if (changePct1d != null) {
    const pos = bias === "bullish" ? changePct1d : bias === "bearish" ? -changePct1d : -Math.abs(changePct1d);
    if (pos > 3) score += 12;
    else if (pos > 1) score += 7;
    else if (pos < -3) score -= 10;
  }

  if (changePct5d != null) {
    const pos = bias === "bullish" ? changePct5d : bias === "bearish" ? -changePct5d : -Math.abs(changePct5d);
    if (pos > 5) score += 10;
    else if (pos > 2) score += 5;
    else if (pos < -5) score -= 10;
  }

  if (gapPct != null && Math.abs(gapPct) > 4) {
    score -= 5; // outsized gap penalty for risk-aware ranking
  }

  return clamp(score);
}

export function scoreSentiment(inputs: SentimentInputs, bias: Bias): number {
  if (!inputs.available) return 50; // neutral when unavailable
  const total = inputs.bullishHeadlines + inputs.neutralHeadlines + inputs.bearishHeadlines;
  if (total === 0) return 50;
  const bullPct = inputs.bullishHeadlines / total;
  const bearPct = inputs.bearishHeadlines / total;

  let score = 50;
  if (bias === "bullish") score = 30 + 70 * bullPct - 30 * bearPct;
  else if (bias === "bearish") score = 30 + 70 * bearPct - 30 * bullPct;
  else score = 60 - 30 * Math.abs(bullPct - bearPct);

  return clamp(Math.round(score));
}

export function scoreOptionsLiquidity(inputs: OptionsLiquidityInputs): number {
  if (!inputs.isOptionsStrategy) return 100; // n/a — full credit for stock strategies
  let score = 30;
  const { openInterest, optionVolume, bidAskSpreadPct, hasDelta, hasExpiration } = inputs;

  if (openInterest != null) {
    if (openInterest >= 1000) score += 25;
    else if (openInterest >= 500) score += 18;
    else if (openInterest >= 200) score += 10;
    else if (openInterest >= 50) score += 4;
  }

  if (optionVolume != null) {
    if (optionVolume >= 500) score += 15;
    else if (optionVolume >= 100) score += 10;
    else if (optionVolume >= 25) score += 5;
  }

  if (bidAskSpreadPct != null) {
    if (bidAskSpreadPct <= 2) score += 15;
    else if (bidAskSpreadPct <= 5) score += 8;
    else if (bidAskSpreadPct <= 10) score += 2;
    else score -= 10;
  }

  if (hasDelta) score += 5;
  if (hasExpiration) score += 5;

  return clamp(score);
}

export function scoreRisk(inputs: RiskInputs): number {
  const {
    maxLoss,
    userMaxLossLimit,
    capitalRequired,
    buyingPower,
    earningsInDays,
    avoidEarningsDays,
    existingExposureSameTicker,
    strategyRiskLevel,
  } = inputs;

  let score = 80;

  if (userMaxLossLimit > 0) {
    const lossPct = maxLoss / userMaxLossLimit;
    if (lossPct > 1) score -= 60;
    else if (lossPct > 0.75) score -= 15;
    else if (lossPct > 0.5) score -= 5;
    else score += 5;
  }

  if (buyingPower != null && buyingPower > 0) {
    const usePct = capitalRequired / buyingPower;
    if (usePct > 0.5) score -= 20;
    else if (usePct > 0.25) score -= 8;
    else score += 3;
  }

  if (earningsInDays != null && avoidEarningsDays > 0) {
    if (earningsInDays >= 0 && earningsInDays <= avoidEarningsDays) score -= 25;
  }

  if (existingExposureSameTicker > 0) score -= 5 * Math.min(existingExposureSameTicker, 3);

  if (strategyRiskLevel === "high") score -= 10;
  else if (strategyRiskLevel === "low") score += 5;

  return clamp(score);
}

export function computeFinalScore(parts: {
  technical: number;
  sentiment: number;
  momentum: number;
  liquidity: number;
  risk: number;
}): number {
  const composite =
    parts.technical * 0.28 +
    parts.momentum * 0.20 +
    parts.sentiment * 0.22 +
    parts.liquidity * 0.15 +
    parts.risk * 0.15;
  return Math.round(clamp(composite));
}

export function gradeScore(finalScore: number): Grade | null {
  if (finalScore >= 90) return "A+";
  if (finalScore >= 80) return "A";
  if (finalScore >= 70) return "B";
  if (finalScore >= 60) return "C";
  return null;
}

export function gradeAtLeast(grade: Grade | null, minimum: Grade): boolean {
  if (!grade) return false;
  const order: Grade[] = ["C", "B", "A", "A+"];
  return order.indexOf(grade) >= order.indexOf(minimum);
}
