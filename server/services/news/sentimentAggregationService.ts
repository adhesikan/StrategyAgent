/**
 * Aggregate per-article sentiment into a per-ticker snapshot.
 */

import type { AnalyzedArticle, ImpactLevel, SentimentLabel } from "./openAiSentimentService";

export interface AnalyzedRecord {
  symbol: string;
  analyzed: AnalyzedArticle;
  publishedAt: string;
}

export interface AggregatedSnapshot {
  symbol: string;
  sentimentLabel: SentimentLabel;
  sentimentScore: number; // -100..100, weighted
  confidence: number; // 0..100
  impactLevel: ImpactLevel;
  buzzScore: number; // 0..100
  articleCount: number;
  topThemes: string[];
  whyItMatters: string;
}

function recencyWeight(publishedAt: string): number {
  const ageMs = Date.now() - Date.parse(publishedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) return 1;
  const hours = ageMs / 3_600_000;
  // half-life ~24h
  return Math.max(0.15, Math.pow(0.5, hours / 24));
}

function impactWeight(level: ImpactLevel): number {
  return level === "high" ? 1.5 : level === "medium" ? 1 : 0.6;
}

function pickLabelFromScore(score: number, hasMixedSignals: boolean): SentimentLabel {
  if (hasMixedSignals && Math.abs(score) < 25) return "mixed";
  if (score >= 20) return "bullish";
  if (score <= -20) return "bearish";
  return "neutral";
}

function pickImpact(maxImpact: ImpactLevel, count: number): ImpactLevel {
  if (maxImpact === "high" || count >= 5) return "high";
  if (maxImpact === "medium" || count >= 2) return "medium";
  return "low";
}

function topThemes(records: AnalyzedRecord[]): string[] {
  const tally = new Map<string, number>();
  for (const r of records) {
    for (const d of r.analyzed.bullishDrivers) tally.set(d, (tally.get(d) ?? 0) + 1);
    for (const d of r.analyzed.bearishDrivers) tally.set(d, (tally.get(d) ?? 0) + 1);
    for (const d of r.analyzed.riskWarnings) tally.set(d, (tally.get(d) ?? 0) + 0.5);
  }
  return Array.from(tally.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([theme]) => theme);
}

function buzzScore(records: AnalyzedRecord[]): number {
  // Combine count and recency and impact into 0..100
  let raw = 0;
  for (const r of records) {
    raw += impactWeight(r.analyzed.impactLevel) * recencyWeight(r.publishedAt);
  }
  return Math.round(Math.min(100, raw * 14));
}

function whyItMattersSummary(label: SentimentLabel, impact: ImpactLevel, count: number): string {
  const adj =
    label === "bullish"
      ? "Positive"
      : label === "bearish"
        ? "Negative"
        : label === "mixed"
          ? "Mixed"
          : "Quiet";
  const energy = impact === "high" ? "elevated" : impact === "medium" ? "moderate" : "low";
  return `${adj} short-term sentiment with ${energy} attention across ${count} recent article${count === 1 ? "" : "s"}.`;
}

export function aggregateByTicker(records: AnalyzedRecord[]): AggregatedSnapshot[] {
  const bySymbol = new Map<string, AnalyzedRecord[]>();
  for (const r of records) {
    const sym = r.symbol.toUpperCase();
    if (!bySymbol.has(sym)) bySymbol.set(sym, []);
    bySymbol.get(sym)!.push(r);
  }

  const out: AggregatedSnapshot[] = [];
  const entries: Array<[string, AnalyzedRecord[]]> = [];
  bySymbol.forEach((v, k) => entries.push([k, v]));
  for (const [symbol, arr] of entries) {
    if (arr.length === 0) continue;

    let weightedSum = 0;
    let weightTotal = 0;
    let confSum = 0;
    let confWeight = 0;
    let bullCount = 0;
    let bearCount = 0;
    let maxImpact: ImpactLevel = "low";

    for (const r of arr) {
      const w = recencyWeight(r.publishedAt) * impactWeight(r.analyzed.impactLevel);
      weightedSum += r.analyzed.sentimentScore * w;
      weightTotal += w;
      confSum += r.analyzed.confidence * w;
      confWeight += w;
      if (r.analyzed.sentimentScore >= 25) bullCount++;
      else if (r.analyzed.sentimentScore <= -25) bearCount++;
      if (r.analyzed.impactLevel === "high" || maxImpact === "high") maxImpact = "high";
      else if (r.analyzed.impactLevel === "medium") maxImpact = "medium";
    }

    const score = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
    const confidence = confWeight > 0 ? Math.round(confSum / confWeight) : 50;
    const hasMixedSignals = bullCount > 0 && bearCount > 0;
    const label = pickLabelFromScore(score, hasMixedSignals);
    const impact = pickImpact(maxImpact, arr.length);
    const themes = topThemes(arr);
    const buzz = buzzScore(arr);

    out.push({
      symbol,
      sentimentLabel: label,
      sentimentScore: Math.max(-100, Math.min(100, score)),
      confidence,
      impactLevel: impact,
      buzzScore: buzz,
      articleCount: arr.length,
      topThemes: themes,
      whyItMatters: whyItMattersSummary(label, impact, arr.length),
    });
  }
  return out;
}
