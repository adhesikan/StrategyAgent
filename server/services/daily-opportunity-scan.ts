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
  if (c.strategyType === "long_call" || c.strategyType === "long_put") return "high";
  if (c.strategyType === "covered_call" || c.strategyType === "cash_secured_put" || c.strategyType === "debit_spread") {
    return "medium";
  }
  return c.finalScore >= 75 ? "low" : "medium";
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
  return {
    id: c.id,
    userId,
    symbol: c.symbol,
    companyName: c.companyName,
    category: category ?? classifyCategory(c.strategyType),
    instrumentType: classifyInstrument(c.strategyType),
    title: buildSimpleTitle(c),
    simpleSummary: buildSimpleSummary(c),
    whyItAppeared: c.mainReason,
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

export async function getDailyIdeasForUser(userId: string): Promise<DailyIdeasResult> {
  const r = await runScan(userId, { strategyType: "any", minGrade: "C", timeHorizon: "1_4w" });
  if (r.ideas.length > 0) return r;
  // Fallback: drop time-horizon constraint so simulated/no-watchlist users still see ideas.
  const broad = await runScan(userId, { strategyType: "any", minGrade: "C" });
  if (broad.ideas.length > 0) return broad;
  // Last resort: widen universe to high-volume liquid names.
  return runScan(userId, { strategyType: "any", universe: "high_volume", minGrade: "C" });
}

export async function getGrowthIdeas(userId: string): Promise<DailyIdeasResult> {
  return runScan(userId, { strategyType: "stock_swing", bias: "bullish", minGrade: "B" }, "growth");
}

export async function getIncomeIdeas(userId: string): Promise<DailyIdeasResult> {
  // Generate income-side from covered calls + CSPs
  const cc = await runScan(userId, { strategyType: "covered_call", minGrade: "C" }, "income");
  const csp = await runScan(userId, { strategyType: "cash_secured_put", minGrade: "C" }, "income");
  const merged = [...cc.ideas, ...csp.ideas].sort((a, b) => b.score - a.score).slice(0, 8);
  if (merged.length > 0) return { ...cc, ideas: merged };
  // Fallback to high-volume universe so the tab isn't blank for empty watchlists.
  const ccBroad = await runScan(userId, { strategyType: "covered_call", universe: "high_volume", minGrade: "C" }, "income");
  const cspBroad = await runScan(userId, { strategyType: "cash_secured_put", universe: "high_volume", minGrade: "C" }, "income");
  const broad = [...ccBroad.ideas, ...cspBroad.ideas].sort((a, b) => b.score - a.score).slice(0, 8);
  return { ...ccBroad, ideas: broad };
}

export async function getStockIdeas(userId: string): Promise<DailyIdeasResult> {
  // Default universe is the user's watchlist. If that yields nothing (empty
  // watchlist, all symbols filtered out, etc.) fall back to high-volume liquid
  // names so the Stocks tab isn't blank for a connected user.
  const r = await runScan(userId, { strategyType: "stock_swing", minGrade: "C" });
  if (r.ideas.length > 0) return r;
  return runScan(userId, { strategyType: "stock_swing", universe: "high_volume", minGrade: "C" });
}

export async function getOptionIdeas(userId: string): Promise<DailyIdeasResult> {
  const types: StrategyType[] = ["long_call", "long_put", "debit_spread"];
  const results = await Promise.all(types.map((t) => runScan(userId, { strategyType: t, minGrade: "C" })));
  const ideas = results.flatMap((r) => r.ideas).sort((a, b) => b.score - a.score).slice(0, 12);
  if (ideas.length > 0) return { ...results[0], ideas };
  // Fallback to high-volume universe if watchlist scan was empty.
  const broad = await Promise.all(
    types.map((t) => runScan(userId, { strategyType: t, universe: "high_volume", minGrade: "C" })),
  );
  const broadIdeas = broad.flatMap((r) => r.ideas).sort((a, b) => b.score - a.score).slice(0, 12);
  return { ...broad[0], ideas: broadIdeas };
}

export async function getWatchlistAlerts(userId: string): Promise<DailyIdeasResult> {
  const r = await runScan(userId, { strategyType: "any", universe: "watchlist", minGrade: "C" });
  return { ...r, ideas: r.ideas.slice(0, 12) };
}

export async function getMarketAlerts(userId: string): Promise<DailyIdeasResult> {
  // Market Alerts should surface items that warrant attention across instrument
  // types — bearish or weak setups, plus protective option ideas — not just one
  // narrow strategy. We pull from several strategies in parallel and mix them so
  // the tab doesn't collapse to all-vertical-spreads when the radar's instrument
  // selector happens to converge.
  const types: StrategyType[] = ["stock_swing", "long_put", "long_call", "debit_spread"];
  const results = await Promise.all(
    types.map((t) =>
      runScan(userId, { strategyType: t, universe: "watchlist", minGrade: "C" }, "market_alert"),
    ),
  );

  // Prefer risk-leaning items first (bearish / mixed sentiment, or weaker scores),
  // then fill with the highest-scoring items from the remaining strategies so
  // every instrument type gets a fair shot at appearing.
  const all = results.flatMap((r) => r.ideas).map((i) => ({ ...i, category: "market_alert" as const }));
  const riskLeaning = all.filter(
    (i) => i.sentimentLabel === "bearish" || i.sentimentLabel === "mixed" || i.score < 70,
  );

  // Round-robin across instrument types so the visible mix is varied.
  const byType = new Map<DailyIdeaInstrument, DailyIdea[]>();
  for (const i of riskLeaning.length > 0 ? riskLeaning : all) {
    const arr = byType.get(i.instrumentType) ?? [];
    arr.push(i);
    byType.set(i.instrumentType, arr);
  }
  for (const arr of byType.values()) arr.sort((a, b) => b.score - a.score);

  const mixed: DailyIdea[] = [];
  const seen = new Set<string>();
  let added = true;
  while (added && mixed.length < 8) {
    added = false;
    for (const arr of byType.values()) {
      const next = arr.shift();
      if (!next || seen.has(next.symbol)) continue;
      seen.add(next.symbol);
      mixed.push(next);
      added = true;
      if (mixed.length >= 8) break;
    }
  }

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
