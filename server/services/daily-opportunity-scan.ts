/**
 * Daily AI Opportunity Scan — Invisible Intelligence Layer
 *
 * Wraps existing engines (Opportunity Radar, News Sentiment, Probability)
 * to surface simple normalized "DailyIdea" objects for novice-facing UIs
 * across Home, Grow, Income, Trade, and Markets.
 *
 * No autonomous trading. Output is informational candidate scenarios
 * for self-directed user review.
 */

import {
  generateCandidateScenarios,
  type CandidateScenario,
  type RadarFilters,
  type StrategyType,
} from "./opportunity-radar/radar-service";
import type { RadarUniverseId } from "./opportunity-radar/universe-service";

export interface ScanOverrides {
  universe?: RadarUniverseId;
  customSymbols?: string[];
}

function withOverrides(filters: RadarFilters, overrides?: ScanOverrides): RadarFilters {
  if (!overrides) return filters;
  const merged: RadarFilters = { ...filters };
  if (overrides.universe) merged.universe = overrides.universe;
  if (overrides.customSymbols && overrides.customSymbols.length > 0) {
    merged.customSymbols = overrides.customSymbols;
    merged.universe = "custom";
  }
  return merged;
}

export type DailyIdeaCategory = "growth" | "income" | "trade" | "market_alert";
export type DailyIdeaInstrument =
  | "stock"
  | "long_call"
  | "long_put"
  | "spread"
  | "covered_call"
  | "cash_secured_put";
export type DailyIdeaRisk = "low" | "medium" | "high";

export interface DailyIdea {
  id: string;
  userId: string;
  symbol: string;
  companyName?: string;
  category: DailyIdeaCategory;
  instrumentType: DailyIdeaInstrument;
  title: string;
  simpleSummary: string;
  whyItAppeared: string;
  riskLevel: DailyIdeaRisk;
  grade: string;
  score: number;
  maxRisk: number;
  capitalNeeded: number;
  potentialReward: number | null;
  timeHorizon: string;
  sentimentLabel: string | null;
  brokerConnected: boolean;
  dataMode: "live" | "simulated" | "mixed";
  sourceEngine: string;
  createdAt: string;
}

export interface DailyIdeasResult {
  ideas: DailyIdea[];
  brokerConnected: boolean;
  dataMode: "live" | "simulated" | "mixed";
  liveQuoteCount?: number;
  quoteFetchError?: string | null;
  asOf: string;
  disclaimer: string;
}

const DISCLAIMER =
  "Software-generated candidate scenarios for informational use only. Not investment advice. Review before acting — nothing is sent without your explicit approval.";

function classifyInstrument(strategy: CandidateScenario["strategyType"]): DailyIdeaInstrument {
  switch (strategy) {
    case "stock_swing":
      return "stock";
    case "long_call":
      return "long_call";
    case "long_put":
      return "long_put";
    case "debit_spread":
      return "spread";
    case "covered_call":
      return "covered_call";
    case "cash_secured_put":
      return "cash_secured_put";
  }
}

function classifyCategory(strategy: CandidateScenario["strategyType"]): DailyIdeaCategory {
  if (strategy === "covered_call" || strategy === "cash_secured_put") return "income";
  if (strategy === "stock_swing") return "growth";
  return "trade";
}

function classifyRisk(c: CandidateScenario): DailyIdeaRisk {
  // Long single-leg options can lose 100% of premium quickly — always high.
  if (c.strategyType === "long_call" || c.strategyType === "long_put") return "high";

  // Defined-risk spreads cap loss at the debit paid. Treat small-debit, well-graded
  // spreads as low so the home feed isn't dominated by medium/high.
  if (c.strategyType === "debit_spread") {
    if (c.maxLoss <= 250 || c.finalScore >= 75) return "low";
    return "medium";
  }

  // Income strategies: covered calls and cash-secured puts are conservative when
  // the underlying is well-graded.
  if (c.strategyType === "covered_call" || c.strategyType === "cash_secured_put") {
    return c.finalScore >= 70 ? "low" : "medium";
  }

  // Stock swing: lower the threshold so high-quality A/A+ ideas show as low.
  return c.finalScore >= 70 ? "low" : "medium";
}

function buildSimpleTitle(c: CandidateScenario): string {
  const labelMap: Record<string, string> = {
    stock_swing: "Stock idea",
    long_call: "Bullish option (long call)",
    long_put: "Bearish option (long put)",
    debit_spread: "Defined-risk spread",
    covered_call: "Covered-call income",
    cash_secured_put: "Cash-secured put income",
  };
  const label = labelMap[c.strategyType] ?? "Candidate scenario";
  return `${c.symbol} — ${label}`;
}

function buildAlertTitle(c: CandidateScenario): string {
  const sent = c.sentiment;
  if (sent?.available && (sent.impactLevel === "high" || sent.impactLevel === "medium")) {
    const tone = sent.label === "bearish" ? "bearish" : sent.label === "bullish" ? "bullish" : "mixed";
    return `${c.symbol} — ${tone} news catalyst`;
  }
  if (sent?.available && sent.label === "bearish") return `${c.symbol} — bearish headlines`;
  if (sent?.biasAlignment === "opposed") return `${c.symbol} — headlines run against the setup`;
  if (c.bias === "bearish") return `${c.symbol} — downside risk flagged`;
  return `${c.symbol} — watchlist alert`;
}

function buildAlertSummary(c: CandidateScenario): string {
  const sent = c.sentiment;
  if (sent?.available) {
    const articles = sent.articleCount ?? 0;
    const impact = sent.impactLevel;
    if (sent.label === "bearish") {
      return `${articles} recent ${articles === 1 ? "headline" : "headlines"} skew bearish (impact: ${impact}). Review before holding or adding exposure.`;
    }
    if (sent.label === "mixed") {
      return `Mixed news flow on ${c.symbol} (${articles} articles, impact ${impact}). Watch for direction confirmation.`;
    }
    if (sent.biasAlignment === "opposed") {
      return `Headline tone on ${c.symbol} runs against the current setup. Confirm thesis before acting.`;
    }
    return `${articles} recent ${articles === 1 ? "headline" : "headlines"} (${sent.label}, impact ${impact}). Heads-up on ${c.symbol}.`;
  }
  return `${c.symbol} flagged on your watchlist with elevated risk signals. Informational only — review before any action.`;
}

function buildSimpleSummary(c: CandidateScenario): string {
  const directionWord =
    c.bias === "bullish" ? "leans higher" : c.bias === "bearish" ? "leans lower" : "looks range-bound";
  if (c.strategyType === "stock_swing") {
    return `${c.symbol} ${directionWord}. Approx max risk $${Math.round(c.maxLoss)} based on your limits.`;
  }
  if (c.strategyType === "covered_call") {
    return `${c.symbol} income candidate using a covered-call structure. Premium collection while holding shares.`;
  }
  if (c.strategyType === "cash_secured_put") {
    return `${c.symbol} income candidate using a cash-secured-put structure with a defined assignment price.`;
  }
  if (c.strategyType === "debit_spread") {
    return `${c.symbol} defined-risk spread candidate. Max risk $${Math.round(c.maxLoss)}, potential reward ~$${Math.round(c.maxGain ?? 0)}.`;
  }
  return `${c.symbol} ${directionWord}. Defined-risk option candidate with premium paid up front.`;
}

function toDailyIdea(c: CandidateScenario, userId: string, brokerConnected: boolean, category?: DailyIdeaCategory): DailyIdea {
  const isAlert = category === "market_alert";
  return {
    id: c.id,
    userId,
    symbol: c.symbol,
    companyName: c.companyName,
    category: category ?? classifyCategory(c.strategyType),
    instrumentType: classifyInstrument(c.strategyType),
    title: isAlert ? buildAlertTitle(c) : buildSimpleTitle(c),
    simpleSummary: isAlert ? buildAlertSummary(c) : buildSimpleSummary(c),
    whyItAppeared: isAlert
      ? (c.sentiment?.available
          ? `News-driven alert: ${c.sentiment.label} tone, impact ${c.sentiment.impactLevel}.`
          : "Risk signal flagged on your watchlist.")
      : c.mainReason,
    riskLevel: classifyRisk(c),
    grade: c.finalGrade,
    score: c.finalScore,
    maxRisk: Math.round(c.maxLoss),
    capitalNeeded: Math.round(c.capitalRequired),
    potentialReward: c.maxGain != null ? Math.round(c.maxGain) : null,
    timeHorizon: c.timeHorizon,
    sentimentLabel: c.sentiment?.available ? c.sentiment.label : null,
    brokerConnected,
    dataMode: c.dataMode,
    sourceEngine: "opportunity_radar",
    createdAt: new Date().toISOString(),
  };
}

// Per-user scan cache. Each radar scan touches broker quotes + sentiment, which is
// expensive; the home page hits multiple buckets back-to-back, so we memoize each
// (user, filters) pair for a short window. TTL is small enough that real changes
// surface within a minute.
const SCAN_TTL_MS = 60_000;
type CacheEntry = { expires: number; promise: Promise<DailyIdeasResult> };
const scanCache = new Map<string, CacheEntry>();

function cacheKey(userId: string, filters: RadarFilters, category?: DailyIdeaCategory): string {
  return `${userId}::${category ?? ""}::${JSON.stringify(filters)}`;
}

async function runScan(userId: string, filters: RadarFilters, category?: DailyIdeaCategory): Promise<DailyIdeasResult> {
  const key = cacheKey(userId, filters, category);
  const now = Date.now();
  const cached = scanCache.get(key);
  if (cached && cached.expires > now) {
    return cached.promise;
  }
  const promise = (async () => {
    const radar = await generateCandidateScenarios(userId, filters);
    const ideas = radar.candidates.map((c) => toDailyIdea(c, userId, radar.brokerConnected, category));
    return {
      ideas,
      brokerConnected: radar.brokerConnected,
      dataMode: radar.dataMode,
      liveQuoteCount: radar.liveQuoteCount,
      quoteFetchError: radar.quoteFetchError,
      asOf: radar.lastRefresh,
      disclaimer: DISCLAIMER,
    };
  })();
  // Drop the entry if the underlying scan rejects so callers can retry.
  promise.catch(() => scanCache.delete(key));
  scanCache.set(key, { expires: now + SCAN_TTL_MS, promise });
  return promise;
}

// ---------- Public API ----------

// Quality-first helper: try B+ first, fall back to C only if no B-grade ideas surface.
async function scanQualityFirst(
  userId: string,
  base: RadarFilters,
  overrides: ScanOverrides | undefined,
  category?: DailyIdeaCategory,
): Promise<DailyIdeasResult> {
  const high = await runScan(userId, withOverrides({ ...base, minGrade: "B" }, overrides), category);
  if (high.ideas.length > 0) return high;
  return runScan(userId, withOverrides({ ...base, minGrade: "C" }, overrides), category);
}

export async function getDailyIdeasForUser(userId: string, overrides?: ScanOverrides): Promise<DailyIdeasResult> {
  const r = await scanQualityFirst(userId, { strategyType: "any", timeHorizon: "1_4w" }, overrides);
  if (r.ideas.length > 0) return r;
  const broad = await scanQualityFirst(userId, { strategyType: "any" }, overrides);
  if (broad.ideas.length > 0) return broad;
  if (overrides?.universe || (overrides?.customSymbols?.length ?? 0) > 0) return broad;
  return runScan(userId, { strategyType: "any", universe: "high_volume", minGrade: "C" });
}

export async function getGrowthIdeas(userId: string, overrides?: ScanOverrides): Promise<DailyIdeasResult> {
  return scanQualityFirst(userId, { strategyType: "stock_swing", bias: "bullish" }, overrides, "growth");
}

export async function getIncomeIdeas(userId: string, overrides?: ScanOverrides): Promise<DailyIdeasResult> {
  const cc = await scanQualityFirst(userId, { strategyType: "covered_call" }, overrides, "income");
  const csp = await scanQualityFirst(userId, { strategyType: "cash_secured_put" }, overrides, "income");
  const merged = [...cc.ideas, ...csp.ideas].sort((a, b) => b.score - a.score).slice(0, 8);
  if (merged.length > 0) return { ...cc, ideas: merged };
  if (overrides?.universe || (overrides?.customSymbols?.length ?? 0) > 0) return { ...cc, ideas: merged };
  const ccBroad = await runScan(userId, { strategyType: "covered_call", universe: "high_volume", minGrade: "C" }, "income");
  const cspBroad = await runScan(userId, { strategyType: "cash_secured_put", universe: "high_volume", minGrade: "C" }, "income");
  const broad = [...ccBroad.ideas, ...cspBroad.ideas].sort((a, b) => b.score - a.score).slice(0, 8);
  return { ...ccBroad, ideas: broad };
}

export async function getStockIdeas(userId: string, overrides?: ScanOverrides): Promise<DailyIdeasResult> {
  const r = await scanQualityFirst(userId, { strategyType: "stock_swing" }, overrides);
  if (r.ideas.length > 0) return r;
  if (overrides?.universe || (overrides?.customSymbols?.length ?? 0) > 0) return r;
  return runScan(userId, { strategyType: "stock_swing", universe: "high_volume", minGrade: "C" });
}

export async function getOptionIdeas(userId: string, overrides?: ScanOverrides): Promise<DailyIdeasResult> {
  const types: StrategyType[] = ["long_call", "long_put", "debit_spread"];
  const results = await Promise.all(types.map((t) => scanQualityFirst(userId, { strategyType: t }, overrides)));
  const ideas = results.flatMap((r) => r.ideas).sort((a, b) => b.score - a.score).slice(0, 12);
  if (ideas.length > 0) return { ...results[0], ideas };
  if (overrides?.universe || (overrides?.customSymbols?.length ?? 0) > 0) return { ...results[0], ideas };
  const broad = await Promise.all(
    types.map((t) => runScan(userId, { strategyType: t, universe: "high_volume", minGrade: "C" })),
  );
  const broadIdeas = broad.flatMap((r) => r.ideas).sort((a, b) => b.score - a.score).slice(0, 12);
  return { ...broad[0], ideas: broadIdeas };
}

export async function getWatchlistAlerts(userId: string, overrides?: ScanOverrides): Promise<DailyIdeasResult> {
  // Watchlist tab keeps watchlist semantics unless caller pins custom symbols.
  const filters: RadarFilters = (overrides?.customSymbols?.length ?? 0) > 0
    ? { strategyType: "any", universe: "custom", customSymbols: overrides!.customSymbols }
    : { strategyType: "any", universe: "watchlist" };
  const r = await scanQualityFirst(userId, filters, undefined);
  return { ...r, ideas: r.ideas.slice(0, 12) };
}

export async function getMarketAlerts(userId: string, overrides?: ScanOverrides): Promise<DailyIdeasResult> {
  // Market Alerts is a heads-up feed, NOT a trade-idea list. We pull a wide pool
  // of watchlist scenarios and keep ONLY those with a real news-driven trigger
  // (bearish or mixed sentiment). Items are then re-titled as alerts so they
  // read as informational warnings rather than buy ideas.
  const types: StrategyType[] = ["stock_swing", "long_put", "long_call", "debit_spread"];
  const results = await Promise.all(
    types.map((t) =>
      runScan(userId, withOverrides({ strategyType: t, universe: "watchlist", minGrade: "C" }, overrides), "market_alert"),
    ),
  );

  const all = results.flatMap((r) => r.ideas);

  // Primary trigger: real news-driven alerts (bearish or mixed sentiment).
  let filtered = all.filter(
    (i) => i.sentimentLabel === "bearish" || i.sentimentLabel === "mixed",
  );

  // Fallback when news data isn't available for any candidate (e.g., no
  // STOCKNEWS_API_KEY): show bearish-bias setups (long puts) as risk alerts so
  // the tab isn't empty. The alert title/summary builders already handle the
  // "no sentiment" case with sensible copy ("downside risk flagged").
  if (filtered.length === 0) {
    filtered = all.filter((i) => i.instrumentType === "long_put" || i.title.toLowerCase().includes("bearish"));
  }

  // Dedupe by symbol — keep the highest-scoring per ticker so each shows once.
  const bySymbol = new Map<string, DailyIdea>();
  for (const i of filtered) {
    const prev = bySymbol.get(i.symbol);
    if (!prev || i.score > prev.score) bySymbol.set(i.symbol, i);
  }

  const mixed = Array.from(bySymbol.values())
    .sort((a, b) => {
      const tone = (x: DailyIdea) =>
        x.sentimentLabel === "bearish" ? 2 : x.sentimentLabel === "mixed" ? 1 : 0;
      return tone(b) - tone(a) || b.score - a.score;
    })
    .slice(0, 8);

  return { ...results[0], ideas: mixed };
}

export async function getMarketSnapshot(userId: string): Promise<DailyIdeasResult> {
  return runScan(userId, { strategyType: "any", minGrade: "B" });
}

export async function getBeginnerFriendlyIdeaCards(userId: string): Promise<DailyIdeasResult> {
  // Bias toward defined-risk and lower-risk instruments — fall back if too strict.
  const r = await runScan(userId, { strategyType: "any", minGrade: "B", minRewardRisk: 1.2 });
  const filtered = r.ideas
    .filter((i) => i.riskLevel !== "high")
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  if (filtered.length > 0) return { ...r, ideas: filtered };
  // Fallback: relax to any C+ ideas so the panel isn't blank for new users.
  const broad = await runScan(userId, { strategyType: "any", minGrade: "C" });
  return { ...broad, ideas: broad.ideas.slice(0, 8) };
}
