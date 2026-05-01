/**
 * News Sentiment orchestrator.
 *
 * `refreshSentimentForSymbols`:
 *   1. Fetches recent articles for each symbol (StockNews or mock)
 *   2. Dedupes
 *   3. Looks up cached per-article analysis by hash; only analyzes new ones
 *   4. Persists per-article analysis
 *   5. Aggregates → upserts ticker snapshots
 *   6. Returns the fresh snapshots
 */

import { storage } from "../../storage";
import { fetchLatestNews, type NormalizedArticle } from "./stockNewsService";
import { articleHash, dedupeArticles } from "./newsDedupService";
import { analyzeArticle, type AnalyzedArticle } from "./openAiSentimentService";
import { aggregateByTicker, type AnalyzedRecord, type AggregatedSnapshot } from "./sentimentAggregationService";
import type { TickerSentimentSnapshot } from "@shared/schema";

export { isStockNewsConfigured, fetchLatestNews, fetchTrendingNews } from "./stockNewsService";
export { isOpenAiConfigured } from "./openAiSentimentService";

const SNAPSHOT_TTL_MS = 15 * 60 * 1000;

export function isSnapshotFresh(snap: TickerSentimentSnapshot | undefined | null): boolean {
  if (!snap?.lastUpdated) return false;
  const ts = snap.lastUpdated instanceof Date ? snap.lastUpdated.getTime() : Date.parse(String(snap.lastUpdated));
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < SNAPSHOT_TTL_MS;
}

export interface RefreshResult {
  snapshots: AggregatedSnapshot[];
  analyzed: number;
  cached: number;
  source: { news: "live" | "mock"; sentiment: "openai" | "rule_based" | "mixed" };
}

async function getOrAnalyze(
  article: NormalizedArticle,
  primarySymbol: string,
): Promise<{ analyzed: AnalyzedArticle; cached: boolean }> {
  const hash = articleHash(article);
  const existing = await storage.getNewsSentimentByHash(hash);
  if (existing && existing.sentimentLabel) {
    return {
      analyzed: {
        sentimentLabel: existing.sentimentLabel as AnalyzedArticle["sentimentLabel"],
        sentimentScore: existing.sentimentScore ?? 0,
        confidence: existing.confidence ?? 50,
        impactLevel: (existing.impactLevel as AnalyzedArticle["impactLevel"]) ?? "low",
        timeHorizon: (existing.timeHorizon as AnalyzedArticle["timeHorizon"]) ?? "swing",
        summary: existing.aiSummary ?? article.headline,
        whyItMatters: existing.whyItMatters ?? "",
        bullishDrivers: (existing.bullishDrivers as string[] | null) ?? [],
        bearishDrivers: (existing.bearishDrivers as string[] | null) ?? [],
        riskWarnings: (existing.riskWarnings as string[] | null) ?? [],
        affectedSymbols: (existing.affectedSymbols as string[] | null) ?? [],
        source: "openai",
      },
      cached: true,
    };
  }
  const analyzed = await analyzeArticle(article);
  try {
    await storage.createNewsSentimentRecord({
      articleHash: hash,
      symbol: primarySymbol,
      headline: article.headline,
      source: article.source,
      url: article.url,
      publishedAt: new Date(article.publishedAt),
      rawSummary: article.summary,
      aiSummary: analyzed.summary,
      sentimentLabel: analyzed.sentimentLabel,
      sentimentScore: analyzed.sentimentScore,
      confidence: analyzed.confidence,
      impactLevel: analyzed.impactLevel,
      timeHorizon: analyzed.timeHorizon,
      whyItMatters: analyzed.whyItMatters,
      bullishDrivers: analyzed.bullishDrivers,
      bearishDrivers: analyzed.bearishDrivers,
      riskWarnings: analyzed.riskWarnings,
      affectedSymbols: analyzed.affectedSymbols,
    });
  } catch (err) {
    console.warn("[news] failed to persist article sentiment:", err);
  }
  return { analyzed, cached: false };
}

// Single-flight: coalesce concurrent refresh requests for the same symbol-set
// to prevent thundering-herd OpenAI calls on a cold/stale cache.
const inflightRefreshes = new Map<string, Promise<RefreshResult>>();

export async function refreshSentimentForSymbols(
  symbols: string[],
  opts: { force?: boolean; itemsPerSymbol?: number } = {},
): Promise<RefreshResult> {
  const cleaned = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).filter(Boolean);
  if (cleaned.length === 0) {
    return { snapshots: [], analyzed: 0, cached: 0, source: { news: "mock", sentiment: "rule_based" } };
  }

  const flightKey = `${opts.force ? "F" : "S"}:${opts.itemsPerSymbol ?? 6}:${cleaned.slice().sort().join(",")}`;
  const existing = inflightRefreshes.get(flightKey);
  if (existing) return existing;

  const promise = doRefreshSentimentForSymbols(cleaned, opts).finally(() => {
    inflightRefreshes.delete(flightKey);
  });
  inflightRefreshes.set(flightKey, promise);
  return promise;
}

async function doRefreshSentimentForSymbols(
  cleaned: string[],
  opts: { force?: boolean; itemsPerSymbol?: number },
): Promise<RefreshResult> {

  const toRefresh: string[] = [];
  const reuse: AggregatedSnapshot[] = [];
  if (!opts.force) {
    for (const sym of cleaned) {
      const existing = await storage.getTickerSnapshot(sym);
      if (existing && isSnapshotFresh(existing)) {
        reuse.push(snapshotRowToAgg(existing));
      } else {
        toRefresh.push(sym);
      }
    }
  } else {
    toRefresh.push(...cleaned);
  }

  if (toRefresh.length === 0) {
    return {
      snapshots: reuse,
      analyzed: 0,
      cached: reuse.length,
      source: { news: process.env.STOCKNEWS_API_KEY || process.env.STOCKNEWSAPI_TOKEN ? "live" : "mock", sentiment: process.env.OPENAI_API_KEY ? "openai" : "rule_based" },
    };
  }

  const articles = await fetchLatestNews(toRefresh, opts.itemsPerSymbol ?? 6);
  const deduped = dedupeArticles(articles);

  const records: AnalyzedRecord[] = [];
  let cached = 0;
  let analyzedCount = 0;
  let openAiUsed = 0;

  for (const a of deduped) {
    const symList = a.symbols.length > 0 ? a.symbols : toRefresh;
    const primary = symList.find((s) => toRefresh.includes(s)) ?? symList[0] ?? toRefresh[0];
    const { analyzed, cached: wasCached } = await getOrAnalyze(a, primary);
    if (wasCached) cached++;
    else {
      analyzedCount++;
      if (analyzed.source === "openai") openAiUsed++;
    }

    for (const sym of symList) {
      if (!toRefresh.includes(sym) && !cleaned.includes(sym)) continue;
      records.push({ symbol: sym, analyzed, publishedAt: a.publishedAt });
    }
  }

  const aggregated = aggregateByTicker(records);
  for (const sym of toRefresh) {
    const agg = aggregated.find((a) => a.symbol === sym) ?? emptySnapshot(sym);
    try {
      await storage.upsertTickerSnapshot({
        symbol: agg.symbol,
        sentimentLabel: agg.sentimentLabel,
        sentimentScore: agg.sentimentScore,
        confidence: agg.confidence,
        impactLevel: agg.impactLevel,
        buzzScore: agg.buzzScore,
        articleCount: agg.articleCount,
        topThemes: agg.topThemes,
        whyItMatters: agg.whyItMatters,
      });
    } catch (err) {
      console.warn(`[news] failed to upsert snapshot for ${sym}:`, err);
    }
  }

  const merged: AggregatedSnapshot[] = [...reuse];
  for (const sym of toRefresh) {
    const agg = aggregated.find((a) => a.symbol === sym) ?? emptySnapshot(sym);
    merged.push(agg);
  }

  let sentimentSource: "openai" | "rule_based" | "mixed" = "rule_based";
  if (analyzedCount > 0) {
    if (openAiUsed === analyzedCount) sentimentSource = "openai";
    else if (openAiUsed === 0) sentimentSource = "rule_based";
    else sentimentSource = "mixed";
  } else if (process.env.OPENAI_API_KEY) {
    sentimentSource = "openai";
  }

  return {
    snapshots: merged,
    analyzed: analyzedCount,
    cached,
    source: {
      news: process.env.STOCKNEWS_API_KEY || process.env.STOCKNEWSAPI_TOKEN ? "live" : "mock",
      sentiment: sentimentSource,
    },
  };
}

export function snapshotRowToAgg(row: TickerSentimentSnapshot): AggregatedSnapshot {
  return {
    symbol: row.symbol,
    sentimentLabel: row.sentimentLabel as AggregatedSnapshot["sentimentLabel"],
    sentimentScore: row.sentimentScore,
    confidence: row.confidence,
    impactLevel: row.impactLevel as AggregatedSnapshot["impactLevel"],
    buzzScore: row.buzzScore,
    articleCount: row.articleCount,
    topThemes: (row.topThemes as string[] | null) ?? [],
    whyItMatters: row.whyItMatters ?? "",
  };
}

function emptySnapshot(symbol: string): AggregatedSnapshot {
  return {
    symbol,
    sentimentLabel: "neutral",
    sentimentScore: 0,
    confidence: 30,
    impactLevel: "low",
    buzzScore: 0,
    articleCount: 0,
    topThemes: [],
    whyItMatters: "No recent articles found in the lookback window.",
  };
}
