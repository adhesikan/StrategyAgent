/**
 * Adapter that converts a per-ticker sentiment snapshot from the News service
 * into the Radar's 0–100 sentiment score, plus narrative factors and a
 * compact UI block for the Radar card.
 *
 * Normalization: snapshot.sentimentScore in [-100, +100] → score in [0, 100]
 *   -100 → 0, 0 → 50, +100 → 100
 *
 * Bias adjustment: when a candidate is bullish-biased we lean into bullish news
 * and discount bearish news; vice versa for bearish. Neutral bias compresses
 * extremes toward 50.
 */

import type { AggregatedSnapshot } from "../news/sentimentAggregationService";
import { snapshotRowToAgg } from "../news";
import { storage } from "../../storage";
import type { Bias } from "./scoring";

export interface RadarSentimentBlock {
  available: boolean;
  label: "bullish" | "bearish" | "neutral" | "mixed";
  rawScore: number; // -100..100 from snapshot
  normalizedScore: number; // 0..100 used in Radar composite
  confidence: number;
  impactLevel: "low" | "medium" | "high";
  buzzScore: number;
  articleCount: number;
  topThemes: string[];
  whyItMatters: string;
  biasAlignment: "aligned" | "opposed" | "neutral";
  miniReason: string;
  source: "live" | "stale" | "missing";
}

const SNAPSHOT_TTL_MS = 15 * 60 * 1000;

function rawToNormalized(raw: number): number {
  const clamped = Math.max(-100, Math.min(100, raw));
  return Math.round(((clamped + 100) / 200) * 100);
}

function biasAdjusted(normalized: number, bias: Bias): number {
  // Compress around 50 for neutral, lean toward direction for bullish/bearish
  if (bias === "neutral") {
    return Math.round(50 + (normalized - 50) * 0.6);
  }
  if (bias === "bullish") return normalized;
  // bearish: invert around 50 so bearish news boosts the bearish thesis
  return Math.round(100 - normalized);
}

function alignment(label: RadarSentimentBlock["label"], bias: Bias): RadarSentimentBlock["biasAlignment"] {
  if (label === "neutral" || label === "mixed" || bias === "neutral") return "neutral";
  if (bias === "bullish" && label === "bullish") return "aligned";
  if (bias === "bearish" && label === "bearish") return "aligned";
  return "opposed";
}

function buildMiniReason(snap: AggregatedSnapshot, bias: Bias): string {
  if (snap.articleCount === 0) {
    return "No recent headline coverage in the lookback window.";
  }
  const aligned = alignment(snap.sentimentLabel, bias);
  const intensifier =
    snap.impactLevel === "high" ? "strong" : snap.impactLevel === "medium" ? "moderate" : "light";
  const directionWord =
    snap.sentimentLabel === "bullish"
      ? "positive"
      : snap.sentimentLabel === "bearish"
        ? "negative"
        : snap.sentimentLabel === "mixed"
          ? "mixed"
          : "neutral";
  const tail =
    aligned === "aligned"
      ? "supports the candidate thesis"
      : aligned === "opposed"
        ? "runs against the candidate thesis"
        : "informational only";
  return `${intensifier} ${directionWord} flow across ${snap.articleCount} article${snap.articleCount === 1 ? "" : "s"} — ${tail}.`;
}

function isFreshSnapshotTime(lastUpdated: Date | null | undefined): boolean {
  if (!lastUpdated) return false;
  const ts = lastUpdated instanceof Date ? lastUpdated.getTime() : Date.parse(String(lastUpdated));
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < SNAPSHOT_TTL_MS;
}

export function adaptSnapshotToRadar(
  snap: AggregatedSnapshot | null,
  bias: Bias,
  meta: { fresh: boolean } = { fresh: true },
): RadarSentimentBlock {
  if (!snap || snap.articleCount === 0) {
    return {
      available: false,
      label: "neutral",
      rawScore: 0,
      normalizedScore: 50,
      confidence: 30,
      impactLevel: "low",
      buzzScore: 0,
      articleCount: 0,
      topThemes: [],
      whyItMatters: snap?.whyItMatters ?? "No recent articles found.",
      biasAlignment: "neutral",
      miniReason: "No recent headline coverage.",
      source: snap ? "stale" : "missing",
    };
  }
  const normalized = biasAdjusted(rawToNormalized(snap.sentimentScore), bias);
  return {
    available: true,
    label: snap.sentimentLabel,
    rawScore: snap.sentimentScore,
    normalizedScore: normalized,
    confidence: snap.confidence,
    impactLevel: snap.impactLevel,
    buzzScore: snap.buzzScore,
    articleCount: snap.articleCount,
    topThemes: snap.topThemes,
    whyItMatters: snap.whyItMatters,
    biasAlignment: alignment(snap.sentimentLabel, bias),
    miniReason: buildMiniReason(snap, bias),
    source: meta.fresh ? "live" : "stale",
  };
}

/**
 * Fetch existing snapshots for a list of symbols from storage. Does NOT trigger
 * remote fetches — Radar uses already-cached snapshots so we don't slow ranking.
 * The Sentiment service refresh path is the place to populate them.
 */
export async function loadSnapshotsForRadar(
  symbols: string[],
): Promise<Map<string, { snapshot: AggregatedSnapshot; fresh: boolean }>> {
  const out = new Map<string, { snapshot: AggregatedSnapshot; fresh: boolean }>();
  if (symbols.length === 0) return out;
  const rows = await storage.getTickerSnapshotsForSymbols(symbols);
  for (const row of rows) {
    out.set(row.symbol.toUpperCase(), {
      snapshot: snapshotRowToAgg(row),
      fresh: isFreshSnapshotTime(row.lastUpdated as any),
    });
  }
  return out;
}
