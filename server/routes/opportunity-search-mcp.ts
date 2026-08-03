// MCP-backed deterministic opportunity orchestration for Ask AI (Sprint 2).
//
// Flow (spec):
//   intent → scan_opportunities → preserve returned ranking
//   → build_trade_candidate for the top 3–5
//   → calculate_position_risk when the user provides a risk budget
//   → structured candidates → the AI EXPLAINS them (never invents/overrides).
//
// Every symbol, strategy, level, score and verdict comes from the MCP tools.
// The LLM never picks symbols or strategies. On MCP failure the caller falls
// back to the stored-detection search (opportunity-search.ts) — candidates
// are never fabricated.

import type { OpportunitySearchType } from "./opportunity-search";

// ---------------------------------------------------------------------------
// Contracts (verified against the deployed vcp-trader-mcp responses)
// ---------------------------------------------------------------------------

export interface McpPriceLevel {
  price: number;
  basis: string;
}

export interface McpSetup {
  symbol: string;
  strategy: string;
  strategyDisplayName?: string;
  direction?: string;
  score?: number | null;
  status?: string | null;
  timeframe?: string | null;
  trigger?: McpPriceLevel | null;
  invalidation?: McpPriceLevel | null;
  technicalObjective?: McpPriceLevel | null;
  currentPrice?: number | null;
  reasons?: string[];
  warnings?: string[];
  detectedAt?: string | null;
  source?: string;
}

export type CandidateVerdict = "STOCK" | "ESTIMATED_OPTIONS" | "NO_TRADE";

export interface McpCandidate {
  symbol?: string;
  verdict?: string;
  direction?: string;
  setup?: McpSetup;
  marketRegime?: { regime?: string; riskEnvironment?: string; volatility?: string } | null;
  earningsRisk?: { status?: string; nextEarningsDate?: string | null; daysUntilEarnings?: number | null } | null;
  dataQuality?: Record<string, string> | null;
  stockCandidate?: {
    trigger?: { price?: number; basis?: string } | null;
    riskPlan?: {
      suggestedStopZone?: { low: number; high: number; basis?: string } | null;
      riskPerShare?: number | null;
    } | null;
    technicalObjective?: McpPriceLevel | null;
  } | null;
  optionsCandidate?: {
    strategy?: string;
    status?: string;
    targetDte?: { min: number; max: number } | null;
    shortStrikeZone?: { low: number; high: number; basis?: string } | null;
    longStrikeZone?: { low: number; high: number; basis?: string } | null;
    limitations?: string[];
    connectionRequiredForLiveContracts?: boolean;
    liveContractDataAvailable?: boolean;
  } | null;
  noTradeReasons?: string[];
}

export interface RiskEstimate {
  riskPerShare?: number | null;
  suggestedMaxShares?: number | null;
  maxRiskDollars?: number | null;
  stopPrice?: number | null;
  stopBasis?: string | null;
  warnings?: string[];
}

export interface RankedOpportunity {
  rank: number;
  setup: McpSetup;
  /** Null when build_trade_candidate failed for this symbol — shown honestly. */
  candidate: McpCandidate | null;
  riskEstimate?: RiskEstimate | null;
}

export interface McpOpportunitySearch {
  intent: OpportunitySearchType;
  source: "mcp";
  generatedAt: string;
  brokerConnected: boolean;
  /** Risk budget parsed from the question, when present. */
  maxRiskDollars?: number | null;
  opportunities: RankedOpportunity[];
  /** Count excluded by the user's risk budget (honest disclosure). */
  excludedByRisk?: number;
}

// ---------------------------------------------------------------------------
// Risk-budget parsing ("Find trades under $500 maximum risk")
// ---------------------------------------------------------------------------

export function parseMaxRisk(question: string): number | null {
  const q = question.toLowerCase();
  const patterns = [
    /under\s+\$?\s?([\d,]+(?:\.\d+)?)(?:\s*(?:dollars|bucks))?\s+(?:max(?:imum)?\s+)?risk/,
    /(?:max(?:imum)?|risking|risk(?:\s+of)?|risk budget(?:\s+of)?)\s+\$\s?([\d,]+(?:\.\d+)?)/,
    /\$\s?([\d,]+(?:\.\d+)?)\s+(?:max(?:imum)?\s+)?risk/,
  ];
  for (const p of patterns) {
    const m = q.match(p);
    if (m) {
      const n = Number.parseFloat(m[1].replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

/** Optional strategy filter derived from the question (deterministic). */
export function strategyFilterFor(question: string, type: OpportunitySearchType): string[] | undefined {
  const q = question.toLowerCase();
  if (type === "vcp" || /\bvcp\b/.test(q)) return ["vcp"];
  if (/momentum[- ]breakout/.test(q)) return ["momentum_breakout"];
  return undefined;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const CANDIDATE_DEPTH = 5; // build_trade_candidate for the top 3–5 (spec)

export interface McpSearchDeps {
  scanOpportunities: (filters: {
    strategies?: string[];
    direction?: "bullish" | "bearish";
    limit?: number;
  }) => Promise<unknown>;
  buildTradeCandidate: (symbol: string, strategy: string, optionsContextToken?: string) => Promise<unknown>;
  calculatePositionRisk: (args: {
    symbol: string;
    entryPrice: number;
    stopPrice: number;
    targetPrice?: number;
    maxRiskDollars?: number;
  }) => Promise<unknown>;
  brokerConnected: boolean;
  /**
   * Short-lived OPAQUE options-context token (server/services/options-context.ts)
   * minted only when the user has a connected options-capable broker. It is
   * forwarded to build_trade_candidate so the MCP service can call back into
   * /api/internal/options/* for a live chain. NEVER a broker OAuth token; the
   * LLM never sees this value (backend orchestration only).
   */
  optionsContextToken?: string;
  now?: Date;
}

function normVerdict(v: unknown): CandidateVerdict | null {
  const s = String(v ?? "").toUpperCase();
  return s === "STOCK" || s === "ESTIMATED_OPTIONS" || s === "NO_TRADE" ? (s as CandidateVerdict) : null;
}

/**
 * Deep-scrub untrusted MCP responses before they can reach the browser or
 * the LLM: recursively drop any key that looks like a context/credential
 * echo. Defense-in-depth — even if the MCP service ever echoes request
 * arguments (e.g. optionsContextToken) or debug fields, they are removed
 * here, at the trust boundary, not by convention.
 */
const SCRUB_KEY_RE = /(optionscontext|token|apikey|api_key|authorization|secret|credential|password)/i;

export function scrubUntrusted<T>(value: T, depth = 0): T {
  if (depth > 8 || value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrubUntrusted(v, depth + 1)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SCRUB_KEY_RE.test(k)) continue;
    out[k] = scrubUntrusted(v, depth + 1);
  }
  return out as T;
}

function isValidSetup(s: unknown): s is McpSetup {
  return !!s && typeof s === "object" && typeof (s as any).symbol === "string" && !!(s as any).symbol && typeof (s as any).strategy === "string";
}

/**
 * Runs one MCP-backed opportunity search. Throws on scan failure (caller
 * decides fallback). Individual candidate/risk failures degrade per-item,
 * never fabricate.
 */
export async function runMcpOpportunitySearch(
  type: Exclude<OpportunitySearchType, "income">,
  question: string,
  deps: McpSearchDeps,
): Promise<McpOpportunitySearch> {
  const now = deps.now ?? new Date();
  const maxRiskDollars = parseMaxRisk(question);

  const filters: { strategies?: string[]; direction?: "bullish" | "bearish"; limit?: number } = {
    limit: 10,
    direction: type === "bearish" ? "bearish" : "bullish",
  };
  const strategies = strategyFilterFor(question, type);
  if (strategies) filters.strategies = strategies;

  const raw = scrubUntrusted((await deps.scanOpportunities(filters)) as any);
  const scanned: McpSetup[] = Array.isArray(raw?.opportunities) ? raw.opportunities.filter(isValidSetup) : [];

  // Preserve the MCP's returned ranking exactly; apply only honest hard
  // filters (direction must match what was asked — never repurpose).
  const wantDirection = type === "bearish" ? "bearish" : "bullish";
  const setups = scanned.filter((s) => !s.direction || s.direction === wantDirection).slice(0, CANDIDATE_DEPTH);

  const ranked: RankedOpportunity[] = await Promise.all(
    setups.map(async (setup, i): Promise<RankedOpportunity> => {
      let candidate: McpCandidate | null = null;
      try {
        candidate = scrubUntrusted((await deps.buildTradeCandidate(setup.symbol, setup.strategy, deps.optionsContextToken)) as McpCandidate);
        if (!normVerdict(candidate?.verdict)) candidate = null; // unusable shape — honest null
      } catch {
        candidate = null;
      }

      // Risk validation only when the user supplied a budget and the
      // deterministic candidate gives a real entry+stop.
      let riskEstimate: RiskEstimate | null = null;
      if (maxRiskDollars != null && candidate && normVerdict(candidate.verdict) === "STOCK") {
        const entry = candidate.stockCandidate?.trigger?.price ?? setup.trigger?.price;
        const stop =
          candidate.stockCandidate?.riskPlan?.suggestedStopZone?.low ?? setup.invalidation?.price;
        if (typeof entry === "number" && typeof stop === "number" && stop < entry) {
          try {
            const r = (await deps.calculatePositionRisk({
              symbol: setup.symbol,
              entryPrice: entry,
              stopPrice: stop,
              ...(typeof setup.technicalObjective?.price === "number" ? { targetPrice: setup.technicalObjective.price } : {}),
              maxRiskDollars,
            })) as any;
            riskEstimate = {
              riskPerShare: typeof r?.riskPerShare === "number" ? r.riskPerShare : null,
              suggestedMaxShares: typeof r?.suggestedMaxShares === "number" ? r.suggestedMaxShares : null,
              maxRiskDollars: typeof r?.maxRiskDollars === "number" ? r.maxRiskDollars : maxRiskDollars,
              stopPrice: stop,
              stopBasis: candidate.stockCandidate?.riskPlan?.suggestedStopZone?.basis ?? setup.invalidation?.basis ?? null,
              warnings: Array.isArray(r?.warnings) ? r.warnings.map(String) : [],
            };
          } catch {
            riskEstimate = null; // risk tool failure → no estimate, never invented
          }
        }
      }

      return { rank: i + 1, setup, candidate, riskEstimate };
    }),
  );

  // Max-risk filtering: exclude stock candidates the budget cannot buy even
  // one share of (riskPerShare > budget). Disclosed via excludedByRisk.
  let excludedByRisk = 0;
  let final = ranked;
  if (maxRiskDollars != null) {
    final = ranked.filter((o) => {
      if (o.riskEstimate && typeof o.riskEstimate.suggestedMaxShares === "number" && o.riskEstimate.suggestedMaxShares < 1) {
        excludedByRisk += 1;
        return false;
      }
      const rps = o.candidate?.stockCandidate?.riskPlan?.riskPerShare;
      if (normVerdict(o.candidate?.verdict) === "STOCK" && typeof rps === "number" && rps > maxRiskDollars) {
        excludedByRisk += 1;
        return false;
      }
      return true;
    });
    // Re-rank sequentially after exclusion (order otherwise preserved).
    final = final.map((o, i) => ({ ...o, rank: i + 1 }));
  }

  return {
    intent: type,
    source: "mcp",
    generatedAt: now.toISOString(),
    brokerConnected: deps.brokerConnected,
    maxRiskDollars,
    opportunities: final,
    ...(excludedByRisk > 0 ? { excludedByRisk } : {}),
  };
}

// ---------------------------------------------------------------------------
// Card + answer building (deterministic; the LLM only explains)
// ---------------------------------------------------------------------------

/** Card shape shared with the frontend (superset of the stored-search card). */
export interface McpOpportunityCard {
  rank: number;
  symbol: string;
  strategy?: string;
  score?: number;
  stage?: string;
  status?: string;
  direction?: string;
  timeframe?: string;
  price?: number;
  trigger?: number | null;
  invalidation?: McpPriceLevel | null;
  technicalObjective?: McpPriceLevel | null;
  reasons: string[];
  warnings: string[];
  freshness?: string;
  candidateState?: "stock" | "estimated_options" | "no_trade" | null;
  verdict?: CandidateVerdict | null;
  riskEstimate?: RiskEstimate | null;
  estimatedOptions?: {
    strategy: string;
    status: "estimated";
    targetDteMin: number;
    targetDteMax: number;
    shortStrikeZone?: { low: number; high: number } | null;
    connectionRequiredForLiveContracts: boolean;
  } | null;
  /** Raw deterministic objects (spec response contract). */
  setup: McpSetup;
  candidate: McpCandidate | null;
}

function verdictToState(v: CandidateVerdict | null): McpOpportunityCard["candidateState"] {
  if (v === "STOCK") return "stock";
  if (v === "ESTIMATED_OPTIONS") return "estimated_options";
  if (v === "NO_TRADE") return "no_trade";
  return null;
}

export function toMcpOpportunityCard(o: RankedOpportunity, brokerConnected: boolean): McpOpportunityCard {
  const { setup, candidate } = o;
  const verdict = normVerdict(candidate?.verdict);
  const warnings = [...(setup.warnings ?? [])];
  if (candidate?.earningsRisk?.status === "within_horizon" && candidate.earningsRisk.nextEarningsDate) {
    warnings.push(
      `Earnings on ${candidate.earningsRisk.nextEarningsDate}${
        typeof candidate.earningsRisk.daysUntilEarnings === "number" ? ` (${candidate.earningsRisk.daysUntilEarnings} days)` : ""
      } — event risk`,
    );
  }
  if (verdict === "NO_TRADE" && candidate?.noTradeReasons?.length) {
    warnings.push(...candidate.noTradeReasons.map(String));
  }
  const opt = verdict === "ESTIMATED_OPTIONS" ? candidate?.optionsCandidate : null;
  return {
    rank: o.rank,
    symbol: setup.symbol.toUpperCase(),
    ...(setup.strategyDisplayName || setup.strategy ? { strategy: setup.strategyDisplayName ?? setup.strategy } : {}),
    ...(typeof setup.score === "number" ? { score: setup.score } : {}),
    ...(setup.status ? { stage: setup.status, status: setup.status } : {}),
    direction: setup.direction ?? "bullish",
    ...(setup.timeframe ? { timeframe: setup.timeframe } : {}),
    ...(typeof setup.currentPrice === "number" ? { price: setup.currentPrice } : {}),
    trigger: typeof setup.trigger?.price === "number" ? setup.trigger.price : null,
    invalidation: setup.invalidation ?? null,
    technicalObjective: setup.technicalObjective ?? null,
    reasons: [...(setup.reasons ?? [])],
    warnings,
    candidateState: verdictToState(verdict),
    verdict,
    riskEstimate: o.riskEstimate ?? null,
    estimatedOptions:
      opt && opt.strategy
        ? {
            strategy: opt.strategy,
            status: "estimated",
            targetDteMin: opt.targetDte?.min ?? 0,
            targetDteMax: opt.targetDte?.max ?? 0,
            shortStrikeZone: opt.shortStrikeZone ?? null,
            connectionRequiredForLiveContracts: opt.connectionRequiredForLiveContracts ?? !brokerConnected,
          }
        : null,
    setup,
    candidate,
  };
}

const TYPE_LABELS: Record<string, string> = {
  trade: "trade opportunities",
  bullish: "bullish opportunities",
  bearish: "bearish opportunities",
  vcp: "VCP setups",
};

function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Deterministic prose built ONLY from the MCP candidates. Used verbatim when
 * OpenAI is unavailable, and as grounding otherwise. Zero-candidate wording is
 * the spec's exact sentence — never generic educational prose.
 */
export function buildMcpOpportunityAnswer(search: McpOpportunitySearch): {
  headline: string;
  answer: string;
  keyPoints: string[];
  riskNote: string;
} {
  const label = TYPE_LABELS[search.intent] ?? "opportunities";
  const cards = search.opportunities.map((o) => toMcpOpportunityCard(o, search.brokerConnected));
  const displayable = cards; // NO_TRADE stays visible — it is a valid result

  if (displayable.length === 0) {
    const riskNote =
      search.maxRiskDollars != null && (search.excludedByRisk ?? 0) > 0
        ? `Setups were found, but none fit a ${fmt(search.maxRiskDollars)} maximum risk budget — the minimum risk per share exceeded it. Widening the budget or waiting for tighter setups are the honest options.`
        : "Forcing a trade when no setup qualifies is a common way to give back gains. No trade is a valid position.";
    return {
      headline: "No high-quality setups currently meet your criteria.",
      answer: `No high-quality setups currently meet your criteria.${
        search.intent === "bearish" ? " The deterministic scanners currently track long (bullish) setups only, so bearish candidates are not available." : ""
      }${
        (search.excludedByRisk ?? 0) > 0
          ? ` ${search.excludedByRisk} candidate${search.excludedByRisk === 1 ? " was" : "s were"} excluded because the risk per share exceeded your ${fmt(search.maxRiskDollars ?? 0)} budget.`
          : ""
      } This is a valid result — nothing in the live scan currently passes the quality filters.`,
      keyPoints: ["Open the Scanner to run a fresh scan", "Review your watchlist", "Ask about a specific symbol"],
      riskNote,
    };
  }

  const lines = displayable.map((c) => {
    const bits = [
      `${c.rank}. ${c.symbol}${c.strategy ? ` — ${c.strategy}` : ""}`,
      c.verdict ? `Verdict: ${c.verdict.replace(/_/g, " ")}` : null,
      c.score != null ? `Score: ${c.score}/100` : null,
      c.status ? `Status: ${c.status}` : null,
      c.trigger != null ? `Entry trigger: ${fmt(c.trigger)}` : null,
      c.invalidation ? `Invalidation: ${fmt(c.invalidation.price)}` : null,
      c.technicalObjective ? `Objective: ${fmt(c.technicalObjective.price)}` : null,
      c.riskEstimate?.suggestedMaxShares != null && c.riskEstimate.maxRiskDollars != null
        ? `Risk: ~${c.riskEstimate.suggestedMaxShares} share${c.riskEstimate.suggestedMaxShares === 1 ? "" : "s"} max within ${fmt(c.riskEstimate.maxRiskDollars)} budget${
            c.riskEstimate.riskPerShare != null ? ` (${fmt(c.riskEstimate.riskPerShare)}/share)` : ""
          }`
        : null,
      c.estimatedOptions
        ? `Estimated ${c.estimatedOptions.strategy.replace(/_/g, " ").toLowerCase()} · target DTE ${c.estimatedOptions.targetDteMin}–${c.estimatedOptions.targetDteMax}`
        : null,
      c.reasons.length ? `Why: ${c.reasons.join("; ")}` : null,
      c.warnings.length ? `Risk: ${c.warnings.join("; ")}` : null,
    ].filter(Boolean);
    return bits.join("\n   ");
  });

  const exclusionNote =
    (search.excludedByRisk ?? 0) > 0 && search.maxRiskDollars != null
      ? `\n\n${search.excludedByRisk} additional candidate${search.excludedByRisk === 1 ? "" : "s"} excluded: risk per share exceeded your ${fmt(search.maxRiskDollars)} budget.`
      : "";

  return {
    headline: `Top ${label} from the live multi-strategy scan (${displayable.length}).`,
    answer: `Here are the current ${label}, in the scanner's own ranking:\n\n${lines.join("\n\n")}${exclusionNote}`,
    keyPoints: displayable.slice(0, 5).map((c) => `${c.symbol}${c.verdict ? ` — ${c.verdict.replace(/_/g, " ")}` : ""}${c.score != null ? ` (${c.score}/100)` : ""}`),
    riskNote:
      "These are software-detected candidates, not recommendations. Verdicts and levels are deterministic engine output — re-verify each setup in your own broker before acting.",
  };
}

/** Deterministic confidence: data completeness, never direction. */
export function mcpOpportunityConfidence(search: McpOpportunitySearch): "low" | "medium" | "high" {
  const n = search.opportunities.length;
  if (n === 0) return "low";
  const withCandidates = search.opportunities.filter((o) => o.candidate != null).length;
  if (n >= 3 && withCandidates >= 3) return "high";
  return "medium";
}
