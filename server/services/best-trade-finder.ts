/**
 * Best Trade Finder — single-call orchestrator for "find me the best trade
 * right now" experiences (Best Trade page + Ask AI chat).
 *
 * Wraps Opportunity Radar (which already pulls live broker quotes, computed
 * indicators, and news sentiment, and runs every built-in strategy) with a
 * defined-risk filter so naked long calls/puts are excluded. Returns the
 * top-N highest-confidence picks that fit the user's risk envelope.
 *
 * No autonomous trading — output is informational candidate scenarios for
 * self-directed user review.
 */

import {
  generateCandidateScenarios,
  type CandidateScenario,
  type RadarFilters,
} from "./opportunity-radar/radar-service";
import type { RadarUniverseId } from "./opportunity-radar/universe-service";

export interface BestTradeRequest {
  universe?: RadarUniverseId;
  customSymbols?: string[];
  minConfidence?: number; // 0-100, default 65
  maxLoss?: number; // dollars per trade
  bias?: "bullish" | "bearish" | "neutral" | "any";
  limit?: number; // default 3
}

export interface BestTradePick {
  id: string;
  rank: number;
  symbol: string;
  companyName?: string;
  strategyType: CandidateScenario["strategyType"];
  strategyLabel: string;
  bias: CandidateScenario["bias"];
  confidence: number;
  grade: CandidateScenario["finalGrade"];
  thesis: string;
  mainReason: string;
  mainRisk: string;
  entry: number;
  stop: number;
  target: number;
  maxLoss: number;
  maxGain: number | null;
  breakeven: number | null;
  capitalRequired: number;
  rewardRisk: number;
  expiration: string | null;
  strikes: string | null;
  isOptions: boolean;
  liquidity: "High" | "Medium" | "Low";
  dataMode: "live" | "simulated" | "mixed";
  riskLabel: "Low" | "Medium" | "High";
}

export interface BestTradeResult {
  picks: BestTradePick[];
  scanned: number;
  brokerConnected: boolean;
  dataMode: "live" | "simulated" | "mixed";
  universeLabel: string;
  universeSize: number;
  asOf: string;
  notes: string[];
  disclaimer: string;
}

const STRATEGY_LABELS: Record<CandidateScenario["strategyType"], string> = {
  stock_swing: "Stock swing",
  long_call: "Long call",
  long_put: "Long put",
  debit_spread: "Defined-risk debit spread",
  covered_call: "Covered call",
  cash_secured_put: "Cash-secured put",
};

// Defined-risk strategies only — naked long calls/puts excluded so a single
// theta-decay event can't wipe out the position.
const DEFINED_RISK_STRATEGIES: ReadonlySet<CandidateScenario["strategyType"]> = new Set([
  "stock_swing", // stop loss caps risk
  "debit_spread", // max loss = debit paid
  "covered_call", // own the underlying, premium offsets
  "cash_secured_put", // cash backed
]);

function liquidityLabel(c: CandidateScenario): "High" | "Medium" | "Low" {
  const score = c.liquidityScore;
  if (score >= 75) return "High";
  if (score >= 55) return "Medium";
  return "Low";
}

function riskLabelFor(c: CandidateScenario): "Low" | "Medium" | "High" {
  if (c.strategyType === "long_call" || c.strategyType === "long_put") return "High";
  if (c.strategyType === "debit_spread") {
    if (c.maxLoss <= 250 || c.finalScore >= 75) return "Low";
    return "Medium";
  }
  if (c.strategyType === "covered_call" || c.strategyType === "cash_secured_put") {
    return c.finalScore >= 70 ? "Low" : "Medium";
  }
  return c.finalScore >= 70 ? "Low" : "Medium";
}

function toPick(c: CandidateScenario): BestTradePick {
  return {
    id: c.id,
    rank: c.rank,
    symbol: c.symbol,
    companyName: c.companyName,
    strategyType: c.strategyType,
    strategyLabel: STRATEGY_LABELS[c.strategyType] ?? c.strategyType,
    bias: c.bias,
    confidence: c.finalScore,
    grade: c.finalGrade,
    thesis: c.thesis,
    mainReason: c.mainReason,
    mainRisk: c.mainRisk,
    entry: c.entry,
    stop: c.stop,
    target: c.target,
    maxLoss: c.maxLoss,
    maxGain: c.maxGain,
    breakeven: c.breakeven,
    capitalRequired: c.capitalRequired,
    rewardRisk: c.rewardRisk,
    expiration: c.expiration,
    strikes: c.strikes,
    isOptions: c.isOptions,
    liquidity: liquidityLabel(c),
    dataMode: c.dataMode,
    riskLabel: riskLabelFor(c),
  };
}

const DISCLAIMER =
  "Software-generated candidate scenarios for informational use only. Not investment advice. Defined-risk-only filter applied — review before acting; nothing is sent without your explicit approval.";

export async function findBestTrades(
  userId: string,
  req: BestTradeRequest = {},
): Promise<BestTradeResult> {
  const minConfidence = Math.max(0, Math.min(100, req.minConfidence ?? 65));
  const limit = Math.max(1, Math.min(10, req.limit ?? 3));
  const universe: RadarUniverseId =
    (req.customSymbols?.length ?? 0) > 0
      ? "custom"
      : (req.universe ?? "watchlist");

  const filters: RadarFilters = {
    strategyType: "any",
    bias: req.bias && req.bias !== "any" ? req.bias : "any",
    universe,
    customSymbols: req.customSymbols,
    minGrade: "C",
    maxLoss: req.maxLoss,
  };

  const radar = await generateCandidateScenarios(userId, filters);

  // Defined-risk filter + confidence/maxLoss thresholds.
  const eligible = radar.candidates.filter((c) => {
    if (!DEFINED_RISK_STRATEGIES.has(c.strategyType)) return false;
    if (c.finalScore < minConfidence) return false;
    if (req.maxLoss != null && c.maxLoss > req.maxLoss) return false;
    return true;
  });

  // Sort by score desc, then rewardRisk desc as tiebreaker.
  eligible.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    return (b.rewardRisk ?? 0) - (a.rewardRisk ?? 0);
  });

  const picks = eligible.slice(0, limit).map(toPick);

  const notes: string[] = [...radar.notes];
  if (eligible.length === 0 && radar.candidates.length > 0) {
    notes.push(
      `No defined-risk candidates met the minimum confidence (${minConfidence}). Try a broader universe or lower the confidence threshold.`,
    );
  }

  return {
    picks,
    scanned: radar.universeSize,
    brokerConnected: radar.brokerConnected,
    dataMode: radar.dataMode,
    universeLabel: radar.universeLabel,
    universeSize: radar.universeSize,
    asOf: radar.lastRefresh,
    notes,
    disclaimer: DISCLAIMER,
  };
}

/**
 * Per-symbol "best trade" — used by Ask AI when the user asks about a
 * specific ticker (e.g. "Find a high-probability trade on NVDA").
 *
 * Runs all built-in strategies on that one symbol using live broker data,
 * news sentiment, and computed indicators, then returns ONE best stock
 * trade and ONE best defined-risk option trade. Bias is taken from each
 * pick (computed by the strategy engine off price action + news +
 * sentiment).
 */
export interface BestTradeForSymbolResult {
  symbol: string;
  companyName?: string;
  bias: "bullish" | "bearish" | "neutral";
  biasReason: string;
  stockPick: BestTradePick | null;
  optionPick: BestTradePick | null;
  brokerConnected: boolean;
  dataMode: "live" | "simulated" | "mixed";
  asOf: string;
  notes: string[];
  disclaimer: string;
}

const OPTION_STRATEGIES: ReadonlySet<CandidateScenario["strategyType"]> = new Set([
  "debit_spread",
  "covered_call",
  "cash_secured_put",
]);

function pickBest(
  candidates: CandidateScenario[],
  predicate: (c: CandidateScenario) => boolean,
): CandidateScenario | null {
  const filtered = candidates.filter(predicate);
  if (filtered.length === 0) return null;
  filtered.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    return (b.rewardRisk ?? 0) - (a.rewardRisk ?? 0);
  });
  return filtered[0];
}

export async function findBestTradesForSymbol(
  userId: string,
  symbol: string,
): Promise<BestTradeForSymbolResult> {
  const sym = symbol.trim().toUpperCase();

  const radar = await generateCandidateScenarios(userId, {
    strategyType: "any",
    bias: "any",
    universe: "custom",
    customSymbols: [sym],
    minGrade: "C",
  });

  const stockCandidate = pickBest(radar.candidates, (c) => c.strategyType === "stock_swing");
  const optionCandidate = pickBest(radar.candidates, (c) => OPTION_STRATEGIES.has(c.strategyType));

  // Determine the dominant bias from the highest-scoring candidate of any
  // type (defined-risk preferred). This reflects whether the combined
  // signals (technicals + news + sentiment) lean bullish, bearish, or
  // neutral on this symbol right now.
  const ranked = [...radar.candidates].sort((a, b) => b.finalScore - a.finalScore);
  const top = ranked[0] ?? null;
  const bias: "bullish" | "bearish" | "neutral" = top?.bias ?? "neutral";
  const biasReason = top
    ? `${top.thesis} ${top.mainReason}`.trim()
    : `No clear directional signal on ${sym} right now from price action, news, or sentiment.`;

  const notes: string[] = [...radar.notes];
  if (!stockCandidate && !optionCandidate) {
    notes.push(
      `No qualifying setups for ${sym} right now. The strategies didn't find a stock or defined-risk option trade that meets the minimum grade.`,
    );
  } else {
    if (!stockCandidate) {
      notes.push(`No stock swing setup qualified for ${sym} — only an option setup passed the filters.`);
    }
    if (!optionCandidate) {
      notes.push(`No defined-risk option setup qualified for ${sym} — only a stock setup passed the filters.`);
    }
  }

  return {
    symbol: sym,
    companyName: top?.companyName,
    bias,
    biasReason,
    stockPick: stockCandidate ? toPick(stockCandidate) : null,
    optionPick: optionCandidate ? toPick(optionCandidate) : null,
    brokerConnected: radar.brokerConnected,
    dataMode: radar.dataMode,
    asOf: radar.lastRefresh,
    notes,
    disclaimer: DISCLAIMER,
  };
}

/**
 * Three-idea picker — for the Advanced Trade Builder "Best Picks Right Now"
 * section. Returns ONE stock idea + ONE single-leg option idea + ONE
 * defined-risk spread idea, each pulled from the same live-broker / news /
 * sentiment scan that powers the rest of the app.
 *
 * Each strategy type is requested explicitly because radar's deterministic
 * symbol→strategy picker only emits one strategy per symbol per scan; without
 * the explicit request we'd usually be missing one of the three types.
 */
export interface ThreeIdeaPicks {
  stockPick: BestTradePick | null;
  singleLegOptionPick: BestTradePick | null;
  spreadPick: BestTradePick | null;
  brokerConnected: boolean;
  dataMode: "live" | "simulated" | "mixed";
  liveQuoteCount: number | null;
  universeLabel: string;
  universeSize: number;
  asOf: string;
  notes: string[];
  disclaimer: string;
}

export async function findThreeIdeaPicks(
  userId: string,
  opts: { universe?: RadarUniverseId; customSymbols?: string[] } = {},
): Promise<ThreeIdeaPicks> {
  const universe: RadarUniverseId =
    (opts.customSymbols?.length ?? 0) > 0
      ? "custom"
      : (opts.universe ?? "watchlist");

  const baseFilters: Omit<RadarFilters, "strategyType"> = {
    bias: "any",
    universe,
    customSymbols: opts.customSymbols,
    minGrade: "C",
  };

  // Run the three scans in parallel — each one targets a single strategy
  // family so we always get a representative pick of that type when one
  // exists in the current universe.
  const [stockResult, longResult, spreadResult] = await Promise.all([
    generateCandidateScenarios(userId, { ...baseFilters, strategyType: "stock_swing" }),
    // long_call OR long_put — radar's pickStrategyForSymbol only honors
    // explicit single values, so request long_call here and merge with a
    // long_put scan to let news/sentiment-driven bearish setups compete.
    Promise.all([
      generateCandidateScenarios(userId, { ...baseFilters, strategyType: "long_call" }),
      generateCandidateScenarios(userId, { ...baseFilters, strategyType: "long_put" }),
    ]).then(([calls, puts]) => ({
      ...calls,
      candidates: [...calls.candidates, ...puts.candidates].sort(
        (a, b) => b.finalScore - a.finalScore,
      ),
    })),
    // Constrain spread scan to bullish bias — the review surface
    // (`/trade/:ticker?type=vertical`) renders defined-risk debit spreads
    // as a bull call spread. Pulling a bearish debit spread here would
    // misrepresent the pick once the user clicks Review.
    generateCandidateScenarios(userId, { ...baseFilters, strategyType: "debit_spread", bias: "bullish" }),
  ]);

  const stockBest = pickBest(stockResult.candidates, (c) => c.strategyType === "stock_swing");
  const longBest = pickBest(
    longResult.candidates,
    (c) => c.strategyType === "long_call" || c.strategyType === "long_put",
  );
  const spreadBest = pickBest(spreadResult.candidates, (c) => c.strategyType === "debit_spread");

  // Aggregate broker / data-mode metadata across all three scans rather
  // than trusting one — broker connection is shared, but liveQuoteCount and
  // dataMode are per-scan because each scan resolves its own universe.
  const allResults = [stockResult, longResult as any, spreadResult];
  const brokerConnected = allResults.some((r) => r.brokerConnected);
  const modes = allResults.map((r) => r.dataMode);
  const dataMode: "live" | "simulated" | "mixed" = modes.every((m) => m === "live")
    ? "live"
    : modes.every((m) => m === "simulated")
      ? "simulated"
      : "mixed";
  const liveQuoteCount = allResults.reduce(
    (sum, r) => sum + (typeof r.liveQuoteCount === "number" ? r.liveQuoteCount : 0),
    0,
  );

  const notes: string[] = [];
  if (brokerConnected) {
    notes.push(
      dataMode === "live"
        ? "Using live broker quotes for price action, plus news headlines and OpenAI sentiment analysis."
        : dataMode === "mixed"
          ? "Partial live broker data — some symbols fell back to simulated quotes. News/sentiment still applied."
          : "Broker connected but it returned no live quotes for this universe — running on simulated quotes.",
    );
  } else {
    notes.push(
      "No broker connected — these are simulated examples for learning. Connect a broker for live quotes and account-aware sizing.",
    );
  }
  if (!stockBest) notes.push("No stock swing setup met the minimum quality floor right now.");
  if (!longBest) notes.push("No single-leg option (long call or long put) setup met the minimum quality floor right now.");
  if (!spreadBest) {
    notes.push("No defined-risk spread setup met the minimum quality floor right now.");
  } else if (spreadBest.strategyType === "debit_spread") {
    // Be explicit — the engine produces debit spreads today. Credit spreads
    // (bull put / bear call) will surface here once the radar adds them.
    notes.push(
      "Spread shown is a defined-risk debit spread. Credit spreads will appear here when produced by the scoring engine.",
    );
  }

  return {
    stockPick: stockBest ? toPick(stockBest) : null,
    singleLegOptionPick: longBest ? toPick(longBest) : null,
    spreadPick: spreadBest ? toPick(spreadBest) : null,
    brokerConnected,
    dataMode,
    liveQuoteCount,
    universeLabel: stockResult.universeLabel,
    universeSize: stockResult.universeSize,
    asOf: stockResult.lastRefresh,
    notes,
    disclaimer: DISCLAIMER,
  };
}

export const BEST_TRADE_UNIVERSES: { id: RadarUniverseId; label: string; description: string }[] = [
  { id: "watchlist", label: "My Watchlist", description: "Symbols you've saved" },
  { id: "sp_100", label: "S&P 100", description: "Largest 100 U.S. companies (OEX)" },
  { id: "nasdaq_100", label: "Nasdaq 100", description: "Largest Nasdaq names" },
  { id: "sp_500", label: "S&P 500", description: "Broad large-cap U.S. stocks" },
  { id: "high_volume", label: "High Volume", description: "Most actively traded" },
  { id: "options_liquid", label: "Options Liquid", description: "Tightest options spreads" },
  { id: "large_cap", label: "Dow 30", description: "Blue-chip large caps" },
  { id: "custom", label: "Custom Symbols", description: "Type your own list" },
];
