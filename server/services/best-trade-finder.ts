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
