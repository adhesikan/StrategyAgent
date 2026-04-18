import type { TradeSetup } from "../agent/strategy-engine";

export type Grade = "A+" | "A" | "B" | "C";

export interface ScoreBreakdown {
  technicalScore: number;
  realtimeScore: number;
  newsScore: number;
  analystScore: number;
  riskScore: number;
}

export interface ProbabilityResult {
  finalScore: number;
  grade: Grade;
  breakdown: ScoreBreakdown;
  reasons: string[];
  warnings: string[];
}

export interface NewsContext {
  positiveCount?: number;
  negativeCount?: number;
  neutralCount?: number;
  headlineVelocity?: number;
  hasCatalyst?: boolean;
  catalystAlignsWithBias?: boolean;
}

export interface AnalystContext {
  rating?: number; // 1 (strong sell) - 5 (strong buy)
  upgradesLast30d?: number;
  downgradesLast30d?: number;
  upsidePercent?: number;
}

export interface ScoreInput {
  setup: TradeSetup;
  news?: NewsContext | null;
  analyst?: AnalystContext | null;
}

const clamp = (n: number, min = 0, max = 100): number => Math.max(min, Math.min(max, n));

function computeTechnicalScore(setup: TradeSetup): { score: number; notes: string[]; warnings: string[] } {
  const notes: string[] = [];
  const warnings: string[] = [];
  let score = 50;

  const pattern = setup.modelScore ?? 0;
  if (pattern >= 80) { score += 25; notes.push(`Strong pattern confidence (${pattern})`); }
  else if (pattern >= 65) { score += 15; notes.push(`Solid pattern confidence (${pattern})`); }
  else if (pattern >= 50) { score += 5; }
  else if (pattern > 0) { warnings.push(`Pattern confidence is low (${pattern})`); score -= 10; }

  const trend = (setup.metrics?.trend || "").toLowerCase();
  if (trend.includes("bullish") && setup.bias === "bullish") { score += 10; notes.push("Trend aligns with bullish bias"); }
  else if (trend.includes("bearish") && setup.bias === "bearish") { score += 10; notes.push("Trend aligns with bearish bias"); }
  else if (trend && !trend.includes(setup.bias)) { warnings.push("Trend does not confirm setup bias"); score -= 8; }

  if (setup.setupType === "BREAKOUT") { score += 8; notes.push("Pattern in breakout stage"); }
  else if (setup.setupType === "READY") { score += 4; }

  return { score: clamp(score), notes, warnings };
}

function computeRealtimeScore(setup: TradeSetup): { score: number; notes: string[]; warnings: string[] } {
  const notes: string[] = [];
  const warnings: string[] = [];
  let score = 50;

  const rvol = setup.metrics?.rvol;
  if (rvol !== undefined) {
    if (rvol >= 2.5) { score += 25; notes.push(`Very high relative volume (${rvol.toFixed(1)}x)`); }
    else if (rvol >= 1.5) { score += 15; notes.push(`Elevated relative volume (${rvol.toFixed(1)}x)`); }
    else if (rvol >= 1.0) { score += 5; }
    else { warnings.push(`Below-average volume (${rvol.toFixed(1)}x)`); score -= 10; }
  } else {
    warnings.push("No live volume data available");
    score -= 5;
  }

  const price = setup.metrics?.currentPrice ?? setup.entry;
  const vwap = setup.metrics?.vwap;
  if (price && vwap) {
    if (setup.bias === "bullish" && price > vwap) { score += 10; notes.push("Price holding above VWAP"); }
    else if (setup.bias === "bearish" && price < vwap) { score += 10; notes.push("Price below VWAP"); }
    else { warnings.push("Price not on the right side of VWAP"); score -= 8; }
  }

  if (price && setup.entry) {
    const distFromEntry = Math.abs(price - setup.entry) / setup.entry;
    if (distFromEntry > 0.02) { warnings.push("Price already extended from entry"); score -= 8; }
  }

  return { score: clamp(score), notes, warnings };
}

function computeNewsScore(news?: NewsContext | null): { score: number; notes: string[]; warnings: string[] } {
  const notes: string[] = [];
  const warnings: string[] = [];
  if (!news) {
    return { score: 50, notes: [], warnings: [] };
  }
  let score = 50;
  const pos = news.positiveCount ?? 0;
  const neg = news.negativeCount ?? 0;
  const total = pos + neg + (news.neutralCount ?? 0);
  if (total > 0) {
    const ratio = (pos - neg) / Math.max(1, total);
    score += ratio * 30;
    if (ratio > 0.3) notes.push("Recent news is net positive");
    else if (ratio < -0.3) warnings.push("Recent news is net negative");
  }
  if (news.hasCatalyst) {
    if (news.catalystAlignsWithBias) { score += 10; notes.push("Active catalyst aligns with trade bias"); }
    else { warnings.push("Catalyst present but not aligned with bias"); score -= 10; }
  }
  if ((news.headlineVelocity ?? 0) > 5) {
    notes.push("Above-average news flow");
  }
  return { score: clamp(score), notes, warnings };
}

function computeAnalystScore(analyst?: AnalystContext | null): { score: number; notes: string[]; warnings: string[] } {
  const notes: string[] = [];
  const warnings: string[] = [];
  if (!analyst) {
    return { score: 50, notes: [], warnings: [] };
  }
  let score = 50;
  if (typeof analyst.rating === "number") {
    score += (analyst.rating - 3) * 10; // 5 -> +20, 1 -> -20
    if (analyst.rating >= 4) notes.push("Analyst consensus is bullish");
    if (analyst.rating <= 2) warnings.push("Analyst consensus is bearish");
  }
  const ups = analyst.upgradesLast30d ?? 0;
  const downs = analyst.downgradesLast30d ?? 0;
  if (ups > downs) { score += 5; notes.push("Recent net analyst upgrades"); }
  if (downs > ups) { warnings.push("Recent net analyst downgrades"); score -= 5; }
  if (typeof analyst.upsidePercent === "number") {
    if (analyst.upsidePercent > 10) { score += 5; notes.push(`Average target implies ~${analyst.upsidePercent.toFixed(0)}% upside`); }
    if (analyst.upsidePercent < -5) { warnings.push("Average target implies downside"); score -= 5; }
  }
  return { score: clamp(score), notes, warnings };
}

function computeRiskScore(setup: TradeSetup): { score: number; notes: string[]; warnings: string[] } {
  const notes: string[] = [];
  const warnings: string[] = [];
  let score = 50;

  const rr = setup.rewardRisk;
  if (rr !== null && rr !== undefined) {
    if (rr >= 3) { score += 25; notes.push(`Excellent reward/risk (${rr.toFixed(2)})`); }
    else if (rr >= 2) { score += 18; notes.push(`Strong reward/risk (${rr.toFixed(2)})`); }
    else if (rr >= 1.5) { score += 10; notes.push(`Acceptable reward/risk (${rr.toFixed(2)})`); }
    else if (rr >= 1) { score += 0; warnings.push(`Reward/risk below 1.5 (${rr.toFixed(2)})`); }
    else { warnings.push(`Poor reward/risk ratio (${rr.toFixed(2)})`); score -= 15; }
  }

  if (setup.entry && setup.stop) {
    const riskPct = (Math.abs(setup.entry - setup.stop) / setup.entry) * 100;
    if (riskPct > 5) { warnings.push(`Stop is wide (${riskPct.toFixed(1)}% from entry)`); score -= 10; }
    else if (riskPct < 0.5) { warnings.push("Stop may be too tight"); score -= 5; }
    else { notes.push(`Stop distance ${riskPct.toFixed(1)}% — reasonable`); score += 5; }
  } else {
    warnings.push("Stop level not clearly defined");
    score -= 10;
  }

  return { score: clamp(score), notes, warnings };
}

function computeGrade(score: number): Grade {
  if (score >= 85) return "A+";
  if (score >= 75) return "A";
  if (score >= 65) return "B";
  return "C";
}

export function scoreSetup(input: ScoreInput): ProbabilityResult {
  const tech = computeTechnicalScore(input.setup);
  const real = computeRealtimeScore(input.setup);
  const news = computeNewsScore(input.news);
  const analyst = computeAnalystScore(input.analyst);
  const risk = computeRiskScore(input.setup);

  const finalScore = Math.round(
    0.30 * tech.score +
    0.25 * real.score +
    0.15 * news.score +
    0.15 * analyst.score +
    0.15 * risk.score
  );

  const allReasons = [...tech.notes, ...real.notes, ...risk.notes, ...news.notes, ...analyst.notes];
  const allWarnings = [...tech.warnings, ...real.warnings, ...risk.warnings, ...news.warnings, ...analyst.warnings];

  const reasons = allReasons.slice(0, 5);
  if (reasons.length < 3) {
    if (input.setup.bias) reasons.push(`Setup direction: ${input.setup.bias}`);
    if (input.setup.strategyName) reasons.push(`Strategy: ${input.setup.strategyName}`);
  }
  const warnings = allWarnings.slice(0, 4);

  return {
    finalScore,
    grade: computeGrade(finalScore),
    breakdown: {
      technicalScore: tech.score,
      realtimeScore: real.score,
      newsScore: news.score,
      analystScore: analyst.score,
      riskScore: risk.score,
    },
    reasons,
    warnings,
  };
}
