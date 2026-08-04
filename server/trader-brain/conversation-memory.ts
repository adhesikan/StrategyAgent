// TraderBrain — Conversation Memory (Sprint 5.2).
//
// Per-chat execution memory. Scope: single server process, keyed by userId.
// No DB persistence. No cross-chat leakage. Auto-expires after 30 min idle.
//
// Privacy rules (same as the rest of TraderBrain):
//   - userId is the only sensitive key; it is NEVER logged externally.
//   - No account IDs, balances, positions, or broker tokens are stored here.
//   - Candidate/recommendation/plan data stored is already-scrubbed safe data
//     produced by the existing domain modules.
//
// Lifetime: destroyed when the server process restarts or after TTL_MS of
// inactivity. No explicit database writes.

import type { NormalizedBrainRequest, BrainPortfolioConstraints, TraderBrainIntent } from "./types";
import type { RankedTradeSearch } from "../routes/ranked-trade-search";
import type { PortfolioTradePlan } from "../routes/portfolio-trade-plan";
import type { StrategyRecommendation } from "../mcp/strategy-recommendation";
import type { MultiStrategyAnalysis } from "../mcp/multi-strategy-analysis";
import type { VcpAnalysis } from "../mcp/analysis-scan";

// ---------------------------------------------------------------------------
// TTL
// ---------------------------------------------------------------------------

/** 30 minutes of inactivity → memory expires. */
const TTL_MS = 30 * 60 * 1_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Risk budget captured from a trade goal or portfolio constraint. */
export interface RiskSnapshot {
  dollars?: number;
  percent?: number;
}

/** A single item from a ranked or portfolio candidate list. */
export type CandidateSnapshot = Record<string, unknown>;

/**
 * Conversation memory for one user's active chat session.
 * All fields are nullable — only set after the relevant intent completes.
 */
export interface ConversationMemory {
  /** Server-side timestamp of last write. Used for TTL. */
  lastUpdated: number;

  // --- What was last done ---
  lastIntent: TraderBrainIntent | null;
  lastNormalizedRequest: NormalizedBrainRequest | null;

  // --- Domain results ---
  lastSearch: RankedTradeSearch | null;
  lastRecommendation: StrategyRecommendation | null;
  lastAnalysis: MultiStrategyAnalysis | VcpAnalysis | null;
  lastPortfolioTradePlan: PortfolioTradePlan | null;
  lastAnalyzedSymbol: string | null;

  // --- Goal parameters (carry-forward for follow-ups) ---
  lastPortfolioFilters: BrainPortfolioConstraints | null;
  lastRiskBudget: RiskSnapshot | null;
  lastStrategyPreference: string | null;
  lastMarketDirection: "bullish" | "bearish" | "neutral" | "either" | null;
  lastWatchlistReference: string[] | null;
  lastObjective: "growth" | "income" | "capital_preservation" | "hedging" | "speculative" | null;

  // --- Outcome tracking ---
  lastRejectedReasons: string[];
  lastUnavailableReasons: string[];

  // --- Ordered candidate list for positional references ---
  lastRankedCandidates: CandidateSnapshot[];

  // --- Contextual note set on context-hit; shown in response ---
  pendingContextNote: string | null;
}

// ---------------------------------------------------------------------------
// Store — module singleton
// ---------------------------------------------------------------------------

const store = new Map<string, ConversationMemory>();

// Periodic sweep: remove expired entries every 10 minutes.
const SWEEP_INTERVAL_MS = 10 * 60 * 1_000;
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [uid, mem] of store.entries()) {
      if (now - mem.lastUpdated > TTL_MS) {
        store.delete(uid);
      }
    }
  }, SWEEP_INTERVAL_MS).unref?.();
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

function empty(): ConversationMemory {
  return {
    lastUpdated: Date.now(),
    lastIntent: null,
    lastNormalizedRequest: null,
    lastSearch: null,
    lastRecommendation: null,
    lastAnalysis: null,
    lastPortfolioTradePlan: null,
    lastAnalyzedSymbol: null,
    lastPortfolioFilters: null,
    lastRiskBudget: null,
    lastStrategyPreference: null,
    lastMarketDirection: null,
    lastWatchlistReference: null,
    lastObjective: null,
    lastRejectedReasons: [],
    lastUnavailableReasons: [],
    lastRankedCandidates: [],
    pendingContextNote: null,
  };
}

/** Get a copy of memory for the given user, or a fresh empty snapshot. */
export function getMemory(userId: string): ConversationMemory {
  const m = store.get(userId);
  if (!m) return empty();
  // Return expired as empty (but don't delete here — sweep handles it)
  if (Date.now() - m.lastUpdated > TTL_MS) return empty();
  return { ...m };
}

/** Overwrite memory for the user with the given snapshot. */
export function setMemory(userId: string, mem: ConversationMemory): void {
  store.set(userId, { ...mem, lastUpdated: Date.now() });
}

/** Clear all memory for the user (explicit reset). */
export function clearMemory(userId: string): void {
  store.delete(userId);
}

/** True if the user has any active memory. */
export function hasMemory(userId: string): boolean {
  const m = store.get(userId);
  if (!m) return false;
  return Date.now() - m.lastUpdated <= TTL_MS;
}

/** Number of active (non-expired) entries — for tests and diagnostics. */
export function activeEntryCount(): number {
  const now = Date.now();
  let count = 0;
  for (const m of store.values()) {
    if (now - m.lastUpdated <= TTL_MS) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Writer: called after a successful Brain result
// ---------------------------------------------------------------------------

import type { TraderBrainResult } from "./types";

/**
 * Extract and store context from a Brain result.
 * Idempotent; never throws.
 */
export function storeResult(userId: string, result: TraderBrainResult): void {
  try {
    const prev = getMemory(userId);
    const req = result.normalizedRequest;
    const sections = result.sections;

    const next: ConversationMemory = {
      ...prev,
      lastUpdated: Date.now(),
      pendingContextNote: null,   // always reset — set by resolver, not writer

      lastIntent: result.intent,
      lastNormalizedRequest: req,

      // Domain results — only update when section is present
      lastSearch:            sections.rankedSearch       ?? prev.lastSearch,
      lastRecommendation:    sections.recommendation     ?? prev.lastRecommendation,
      lastAnalysis:          sections.analysis           ?? prev.lastAnalysis,
      lastPortfolioTradePlan: sections.portfolioTradePlan ?? prev.lastPortfolioTradePlan,

      // Symbol from recommend / analyze intent
      lastAnalyzedSymbol:
        req.symbol ??
        req.tickers[0] ??
        prev.lastAnalyzedSymbol,

      // Goal parameters — carry forward only if explicitly set in this request
      lastPortfolioFilters:    req.portfolioConstraints  ?? prev.lastPortfolioFilters,
      lastRiskBudget: (req.maxRiskDollars != null || req.maxRiskPercent != null)
        ? { dollars: req.maxRiskDollars, percent: req.maxRiskPercent }
        : prev.lastRiskBudget,
      lastStrategyPreference:  req.requestedStrategy     ?? prev.lastStrategyPreference,
      lastMarketDirection:     req.direction              ?? prev.lastMarketDirection,
      lastObjective:           req.objective              ?? prev.lastObjective,
      lastWatchlistReference: req.tickers.length > 0 ? req.tickers : prev.lastWatchlistReference,

      // Extract candidate list from ranked search results
      lastRankedCandidates: sections.rankedSearch?.candidates
        ? (sections.rankedSearch.candidates as CandidateSnapshot[])
        : prev.lastRankedCandidates,

      // Carry rejection/unavailability reasons from warnings
      lastRejectedReasons: result.warnings.length > 0
        ? result.warnings.slice(0, 10)
        : prev.lastRejectedReasons,
      lastUnavailableReasons: result.limitations.length > 0
        ? result.limitations.slice(0, 10)
        : prev.lastUnavailableReasons,
    };

    setMemory(userId, next);
  } catch {
    // Never let memory writes break the request
  }
}
