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

// ---------------------------------------------------------------------------
// Live option candidate — produced ONLY when the full options pipeline
// (get_options_chain → analyze_options → select_option_contracts →
// calculate_trade_risk) succeeded against a live chain. Anything less is an
// ESTIMATED options strategy and must never be labeled live.
// ---------------------------------------------------------------------------

export interface LiveOptionLeg {
  action: "buy" | "sell";
  type: "call" | "put";
  strike: number;
  expiration?: string | null;
  /** Live quote at selection time. */
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
  delta?: number | null;
  theta?: number | null;
  iv?: number | null;
  volume?: number | null;
  openInterest?: number | null;
  optionSymbol?: string | null;
}

export interface LiveOptionCandidate {
  status: "live";
  strategy: string;
  expiration: string;
  dte?: number | null;
  legs: LiveOptionLeg[];
  /** "mid" when premiums are midpoint assumptions, "bid_ask" when NBBO used. */
  priceBasis: "mid" | "bid_ask";
  /** Net per contract: positive = credit received, negative = debit paid. */
  estimatedNet: number;
  netKind: "debit" | "credit";
  maxLoss?: number | null;
  /** Null/undefined when unlimited or not applicable. */
  maxProfit?: number | null;
  breakeven?: number[] | null;
  liquidityQuality?: string | null;
  liquidityNotes?: string[];
  /** Deterministic explanation of why this candidate ranked highly. */
  rankReasons: string[];
  warnings?: string[];
}

export interface RankedOpportunity {
  rank: number;
  setup: McpSetup;
  /** Null when build_trade_candidate failed for this symbol — shown honestly. */
  candidate: McpCandidate | null;
  riskEstimate?: RiskEstimate | null;
  /** Present ONLY when the live options pipeline fully succeeded. */
  liveOption?: LiveOptionCandidate | null;
}

export interface McpOpportunitySearch {
  intent: OpportunitySearchType;
  source: "mcp";
  generatedAt: string;
  brokerConnected: boolean;
  /** Risk budget parsed from the question, when present. */
  maxRiskDollars?: number | null;
  /** Explicit result count parsed from the question (clamped), when present. */
  requestedCount?: number | null;
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

const COUNT_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/**
 * Parses an explicit requested result count ("find 3 bullish trades",
 * "show 5 setups", "give me the top 2 opportunities"). Returns null when the
 * question doesn't name a count. Callers clamp to the platform safe maximum.
 */
export function parseRequestedCount(question: string): number | null {
  const q = question.toLowerCase();
  const m = q.match(
    /\b(?:top|best|find|show|give me|list|first)?\s*(?:me\s+)?(?:the\s+)?(?:top\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:[a-z-]+\s+){0,2}?(?:trades?|setups?|opportunit(?:y|ies)|candidates?|ideas?|plays?)\b/,
  );
  if (!m) return null;
  const n = COUNT_WORDS[m[1]] ?? Number.parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
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
  /**
   * Options pipeline tools (all optional — when absent or failing, candidates
   * degrade honestly to ESTIMATED options; live cards are never fabricated).
   */
  getOptionsChain?: (args: { symbol: string; optionsContextToken?: string }) => Promise<unknown>;
  analyzeOptions?: (args: {
    symbol: string;
    strategy?: string;
    direction?: "bullish" | "bearish";
    optionsContextToken?: string;
  }) => Promise<unknown>;
  selectOptionContracts?: (args: {
    symbol: string;
    strategy: string;
    direction?: "bullish" | "bearish";
    targetDte?: { min: number; max: number };
    maxRiskDollars?: number;
    optionsContextToken?: string;
  }) => Promise<unknown>;
  calculateTradeRisk?: (args: {
    symbol: string;
    strategy: string;
    legs: Array<{ action: string; type: string; strike: number; expiration?: string; premium?: number }>;
    quantity?: number;
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

// ---------------------------------------------------------------------------
// Live options pipeline (per candidate):
//   get_options_chain (when available) → analyze_options →
//   select_option_contracts → calculate_trade_risk → LiveOptionCandidate.
// Any missing tool, failure or unusable shape → null (estimated card only).
// ---------------------------------------------------------------------------

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function normalizeLeg(raw: any): LiveOptionLeg | null {
  const action = String(raw?.action ?? raw?.side ?? "").toLowerCase();
  const type = String(raw?.type ?? raw?.optionType ?? "").toLowerCase();
  const strike = num(raw?.strike);
  if ((action !== "buy" && action !== "sell") || (type !== "call" && type !== "put") || strike == null) return null;
  const bid = num(raw?.bid);
  const ask = num(raw?.ask);
  const mid = num(raw?.mid) ?? (bid != null && ask != null ? +((bid + ask) / 2).toFixed(2) : null);
  return {
    action: action as "buy" | "sell",
    type: type as "call" | "put",
    strike,
    expiration: typeof raw?.expiration === "string" ? raw.expiration : null,
    bid,
    ask,
    mid,
    delta: num(raw?.delta ?? raw?.greeks?.delta),
    theta: num(raw?.theta ?? raw?.greeks?.theta),
    iv: num(raw?.iv ?? raw?.impliedVolatility ?? raw?.greeks?.iv),
    volume: num(raw?.volume),
    openInterest: num(raw?.openInterest ?? raw?.open_interest ?? raw?.oi),
    optionSymbol: typeof raw?.optionSymbol === "string" ? raw.optionSymbol : typeof raw?.symbol === "string" ? raw.symbol : null,
  };
}

async function buildLiveOptionCandidate(
  setup: McpSetup,
  candidate: McpCandidate,
  deps: McpSearchDeps,
  direction: "bullish" | "bearish",
  maxRiskDollars: number | null,
): Promise<LiveOptionCandidate | null> {
  const opt = candidate.optionsCandidate;
  if (!opt?.strategy) return null;
  // Live contracts require the FULL pipeline (chain → analyze → select →
  // risk) AND a live-chain context. Partial pipelines never produce "live".
  if (
    !deps.optionsContextToken ||
    !deps.getOptionsChain ||
    !deps.analyzeOptions ||
    !deps.selectOptionContracts ||
    !deps.calculateTradeRisk
  ) {
    return null;
  }

  try {
    // 1) Chain availability check — cheap gate before deeper analysis.
    const chain = scrubUntrusted((await deps.getOptionsChain({
      symbol: setup.symbol,
      optionsContextToken: deps.optionsContextToken,
    })) as any);
    const chainOk =
      !!chain &&
      typeof chain === "object" &&
      (chain.available === true ||
        (Array.isArray(chain.expirations) && chain.expirations.length > 0) ||
        (Array.isArray(chain.contracts) && chain.contracts.length > 0) ||
        (Array.isArray(chain.options) && chain.options.length > 0));
    if (!chainOk) return null;

    // 2) Analysis pass (IV environment, liquidity screen). Required — a
    //    failure here means the pipeline did not fully succeed, so the
    //    candidate stays estimated (outer catch → null).
    const analysis = scrubUntrusted((await deps.analyzeOptions({
      symbol: setup.symbol,
      strategy: opt.strategy,
      direction,
      optionsContextToken: deps.optionsContextToken,
    })) as any);

    // 3) Contract selection — must yield real legs with strikes/premiums.
    const sel = scrubUntrusted((await deps.selectOptionContracts({
      symbol: setup.symbol,
      strategy: opt.strategy,
      direction,
      ...(opt.targetDte ? { targetDte: opt.targetDte } : {}),
      ...(maxRiskDollars != null ? { maxRiskDollars } : {}),
      optionsContextToken: deps.optionsContextToken,
    })) as any);
    const rawLegs: any[] = Array.isArray(sel?.legs) ? sel.legs : [];
    const legs = rawLegs.map(normalizeLeg).filter((l): l is LiveOptionLeg => l != null);
    if (legs.length === 0 || legs.length !== rawLegs.length) return null;
    // Every leg must carry a real live premium (bid/ask or mid). Aggregate
    // net figures alone are not evidence of live contract data.
    if (!legs.every((l) => l.mid != null)) return null;
    const expiration =
      (typeof sel?.expiration === "string" && sel.expiration) ||
      legs.find((l) => l.expiration)?.expiration ||
      null;
    if (!expiration) return null;

    // Net per contract from selection or from leg midpoints (sign: credit +).
    let estimatedNet = num(sel?.netCredit) ?? (num(sel?.netDebit) != null ? -(num(sel?.netDebit) as number) : null);
    if (estimatedNet == null) {
      let net = 0;
      for (const l of legs) net += (l.action === "sell" ? 1 : -1) * (l.mid as number);
      estimatedNet = +net.toFixed(2);
    }

    // 4) Risk math — the deterministic risk tool MUST succeed (its failure
    //    aborts the live candidate); selection-provided figures only fill
    //    fields the risk tool omitted. Without a max-loss figure the
    //    candidate cannot be risk-validated and is NOT presented as live.
    let maxLoss = num(sel?.maxLoss);
    let maxProfit = num(sel?.maxProfit ?? sel?.maxGain);
    let breakeven: number[] | null = Array.isArray(sel?.breakeven)
      ? sel.breakeven.map(num).filter((n: number | null): n is number => n != null)
      : num(sel?.breakeven) != null
        ? [num(sel?.breakeven) as number]
        : null;
    const riskWarnings: string[] = [];
    const risk = scrubUntrusted((await deps.calculateTradeRisk({
      symbol: setup.symbol,
      strategy: opt.strategy,
      legs: legs.map((l) => ({
        action: l.action,
        type: l.type,
        strike: l.strike,
        ...(l.expiration ? { expiration: l.expiration } : { expiration }),
        ...(l.mid != null ? { premium: l.mid } : {}),
      })),
      quantity: 1,
      ...(maxRiskDollars != null ? { maxRiskDollars } : {}),
    })) as any);
    maxLoss = num(risk?.maxLoss) ?? maxLoss;
    maxProfit = num(risk?.maxProfit ?? risk?.maxGain) ?? maxProfit;
    if (Array.isArray(risk?.breakeven)) {
      const b = risk.breakeven.map(num).filter((n: number | null): n is number => n != null);
      if (b.length > 0) breakeven = b;
    } else if (num(risk?.breakeven) != null) {
      breakeven = [num(risk?.breakeven) as number];
    }
    if (Array.isArray(risk?.warnings)) riskWarnings.push(...risk.warnings.map(String));
    if (maxLoss == null) return null;

    const dte = num(sel?.dte ?? sel?.daysToExpiration);
    const liquidityQuality =
      (typeof sel?.liquidity?.quality === "string" && sel.liquidity.quality) ||
      (typeof sel?.liquidityQuality === "string" && sel.liquidityQuality) ||
      (typeof analysis?.liquidity?.quality === "string" && analysis.liquidity.quality) ||
      null;
    const liquidityNotes = [
      ...(Array.isArray(sel?.liquidity?.notes) ? sel.liquidity.notes.map(String) : []),
      ...(Array.isArray(analysis?.liquidity?.notes) ? analysis.liquidity.notes.map(String) : []),
    ];
    const rankReasons = [
      ...(Array.isArray(sel?.reasons) ? sel.reasons.map(String) : []),
      ...(Array.isArray(analysis?.reasons) ? analysis.reasons.map(String) : []),
    ];

    return {
      status: "live",
      strategy: opt.strategy,
      expiration,
      dte,
      legs,
      priceBasis: legs.every((l) => l.bid != null && l.ask != null) ? "bid_ask" : "mid",
      estimatedNet,
      netKind: estimatedNet >= 0 ? "credit" : "debit",
      maxLoss,
      maxProfit,
      breakeven,
      liquidityQuality,
      ...(liquidityNotes.length ? { liquidityNotes } : {}),
      rankReasons,
      ...(riskWarnings.length ? { warnings: riskWarnings } : {}),
    };
  } catch {
    return null; // any pipeline failure → estimated card only, never fabricated
  }
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
  // Explicit count is the final visible limit, clamped to the platform safe max.
  const requestedCount = (() => {
    const n = parseRequestedCount(question);
    return n == null ? null : Math.min(n, CANDIDATE_DEPTH);
  })();
  const depth = requestedCount ?? CANDIDATE_DEPTH;

  const filters: { strategies?: string[]; direction?: "bullish" | "bearish"; limit?: number } = {
    // Retrieval honors the requested count with headroom for the direction
    // filter; the final visible slice below is exactly `depth`.
    limit: requestedCount != null ? Math.min(requestedCount + 5, 25) : 10,
    direction: type === "bearish" ? "bearish" : "bullish",
  };
  const strategies = strategyFilterFor(question, type);
  if (strategies) filters.strategies = strategies;

  const raw = scrubUntrusted((await deps.scanOpportunities(filters)) as any);
  const scanned: McpSetup[] = Array.isArray(raw?.opportunities) ? raw.opportunities.filter(isValidSetup) : [];

  // Preserve the MCP's returned ranking exactly; apply only honest hard
  // filters (direction must match what was asked — never repurpose).
  const wantDirection = type === "bearish" ? "bearish" : "bullish";
  const setups = scanned.filter((s) => !s.direction || s.direction === wantDirection).slice(0, depth);

  const ranked: RankedOpportunity[] = await Promise.all(
    setups.map(async (setup, i): Promise<RankedOpportunity> => {
      let candidate: McpCandidate | null = null;
      try {
        candidate = scrubUntrusted((await deps.buildTradeCandidate(setup.symbol, setup.strategy, deps.optionsContextToken)) as McpCandidate);
        if (!normVerdict(candidate?.verdict)) candidate = null; // unusable shape — honest null
      } catch {
        candidate = null;
      }

      // Live options pipeline — only for options-relevant candidates and only
      // when a live-chain context exists. Failure → estimated card, honestly.
      let liveOption: LiveOptionCandidate | null = null;
      if (candidate && candidate.optionsCandidate?.strategy && normVerdict(candidate.verdict) !== "NO_TRADE") {
        liveOption = await buildLiveOptionCandidate(setup, candidate, deps, wantDirection, maxRiskDollars);
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

      return { rank: i + 1, setup, candidate, riskEstimate, liveOption };
    }),
  );

  // Max-risk filtering: exclude stock candidates the budget cannot buy even
  // one share of (riskPerShare > budget). Disclosed via excludedByRisk.
  let excludedByRisk = 0;
  let final = ranked;
  if (maxRiskDollars != null) {
    // Strict enforcement: under a budgeted query, only candidates whose risk
    // was actually validated against the budget are surfaced. Candidates with
    // unverifiable risk (estimated options, failed builds, stock setups with
    // no risk figures) are excluded and disclosed — never shown as fitting.
    final = ranked.filter((o) => {
      const verdict = normVerdict(o.candidate?.verdict);
      // Live option candidates: validated max loss must fit the budget.
      if (o.liveOption) {
        if (typeof o.liveOption.maxLoss === "number" && o.liveOption.maxLoss <= maxRiskDollars) return true;
        excludedByRisk += 1;
        return false;
      }
      // NO_TRADE is a valid, honest verdict — not a trade, so no risk check.
      if (verdict === "NO_TRADE") return true;
      // Estimated options: no live premiums → risk cannot be validated.
      if (verdict === "ESTIMATED_OPTIONS") {
        excludedByRisk += 1;
        return false;
      }
      if (o.riskEstimate && typeof o.riskEstimate.suggestedMaxShares === "number") {
        if (o.riskEstimate.suggestedMaxShares < 1) {
          excludedByRisk += 1;
          return false;
        }
        return true;
      }
      const rps = o.candidate?.stockCandidate?.riskPlan?.riskPerShare;
      if (verdict === "STOCK" && typeof rps === "number") {
        if (rps > maxRiskDollars) {
          excludedByRisk += 1;
          return false;
        }
        return true;
      }
      // Risk unverifiable under a budget → excluded, disclosed.
      excludedByRisk += 1;
      return false;
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
    requestedCount,
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
  candidateState?: "stock" | "estimated_options" | "live_options" | "no_trade" | null;
  verdict?: CandidateVerdict | null;
  riskEstimate?: RiskEstimate | null;
  /** Present ONLY when the full live options pipeline succeeded. */
  liveOption?: LiveOptionCandidate | null;
  estimatedOptions?: {
    strategy: string;
    status: "estimated";
    targetDteMin: number;
    targetDteMax: number;
    shortStrikeZone?: { low: number; high: number } | null;
    longStrikeZone?: { low: number; high: number } | null;
    /** Explicit limitations of an estimated (no live chain) structure. */
    limitations?: string[];
    /** Deterministic risk style hint, e.g. "defined-risk" / "undefined-risk". */
    riskStyle?: string | null;
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

/** Deterministic risk-style hint from the strategy name. */
export function optionRiskStyle(strategy: string): string {
  const s = strategy.toLowerCase();
  if (/naked|short_call\b|uncovered/.test(s)) return "undefined-risk";
  if (/cash_secured|cash-secured|covered/.test(s)) return "collateralized";
  return "defined-risk";
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
  // Estimated structure only shown when there is NO live candidate — a card
  // is either LIVE (full pipeline succeeded) or ESTIMATED, never both.
  const opt = verdict === "ESTIMATED_OPTIONS" && !o.liveOption ? candidate?.optionsCandidate : null;
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
    candidateState: o.liveOption ? "live_options" : verdictToState(verdict),
    verdict,
    riskEstimate: o.riskEstimate ?? null,
    liveOption: o.liveOption ?? null,
    estimatedOptions:
      opt && opt.strategy
        ? {
            strategy: opt.strategy,
            status: "estimated",
            targetDteMin: opt.targetDte?.min ?? 0,
            targetDteMax: opt.targetDte?.max ?? 0,
            shortStrikeZone: opt.shortStrikeZone ?? null,
            longStrikeZone: opt.longStrikeZone ?? null,
            limitations:
              Array.isArray(opt.limitations) && opt.limitations.length > 0
                ? opt.limitations.map(String)
                : [
                    "Strike zones and DTE are estimates from technical levels — no live premiums, Greeks or liquidity were evaluated.",
                  ],
            riskStyle: optionRiskStyle(opt.strategy),
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

/** Direction/strategy adjective for headlines ("bullish setups", "VCP setups"). */
const TYPE_ADJECTIVES: Record<string, string> = {
  trade: "",
  bullish: "bullish ",
  bearish: "bearish ",
  vcp: "VCP ",
};

const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
function countWord(n: number): string {
  return n >= 0 && n <= 10 ? NUMBER_WORDS[n] : String(n);
}

/** A card counts as a qualified trade candidate only for real verdicts. */
function isQualifiedState(state: McpOpportunityCard["candidateState"]): boolean {
  return state === "stock" || state === "live_options" || state === "estimated_options";
}

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
  const adj = TYPE_ADJECTIVES[search.intent] ?? "";
  const cards = search.opportunities.map((o) => toMcpOpportunityCard(o, search.brokerConnected));
  const displayable = cards; // NO_TRADE stays visible — it is a valid result
  const qualifiedCount = displayable.filter((c) => isQualifiedState(c.candidateState)).length;
  const noTradeCount = displayable.filter((c) => c.candidateState === "no_trade").length;

  if (displayable.length === 0) {
    const riskNote =
      search.maxRiskDollars != null && (search.excludedByRisk ?? 0) > 0
        ? `Setups were found, but none fit a ${fmt(search.maxRiskDollars)} maximum risk budget — the minimum risk per share exceeded it. Widening the budget or waiting for tighter setups are the honest options.`
        : "Forcing a trade when no setup qualifies is a common way to give back gains. No trade is a valid position.";
    return {
      headline: `No qualifying ${adj}setups currently meet the criteria.`,
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
      c.liveOption
        ? `LIVE ${c.liveOption.strategy.replace(/_/g, " ").toLowerCase()} · exp ${c.liveOption.expiration}${
            c.liveOption.dte != null ? ` (${c.liveOption.dte} DTE)` : ""
          } · legs: ${c.liveOption.legs
            .map((l) => `${l.action.toUpperCase()} ${fmt(l.strike)} ${l.type}`)
            .join(" / ")} · est. ${c.liveOption.netKind} ${fmt(Math.abs(c.liveOption.estimatedNet))}/contract${
            c.liveOption.maxLoss != null ? ` · max loss ${fmt(c.liveOption.maxLoss)}` : ""
          }${c.liveOption.maxProfit != null ? ` · max profit ${fmt(c.liveOption.maxProfit)}` : ""}${
            c.liveOption.breakeven?.length ? ` · breakeven ${c.liveOption.breakeven.map(fmt).join(" / ")}` : ""
          }`
        : null,
      c.estimatedOptions
        ? `Estimated ${c.estimatedOptions.strategy.replace(/_/g, " ").toLowerCase()} · target DTE ${c.estimatedOptions.targetDteMin}–${c.estimatedOptions.targetDteMax} — estimated structure, not a live trade`
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

  // Headline distinguishes scanner setups from qualified trade candidates —
  // NO_TRADE results are never called trades.
  const n = displayable.length;
  let headline: string;
  if (qualifiedCount === 0) {
    headline = `${countWord(n)} ${adj}setup${n === 1 ? "" : "s"} found, but none currently qualify as trades.`;
  } else if (qualifiedCount === n) {
    headline = `${countWord(n)} ${adj}trade candidate${n === 1 ? "" : "s"} identified.`;
  } else {
    headline = `${countWord(n)} ${adj}setup${n === 1 ? "" : "s"} reviewed; ${countWord(qualifiedCount).toLowerCase()} currently ${
      qualifiedCount === 1 ? "qualifies as a trade" : "qualify as trades"
    }.`;
  }

  const countSummary = `Reviewed ${n} scanner setup${n === 1 ? "" : "s"}: ${qualifiedCount} qualified as trade candidate${
    qualifiedCount === 1 ? "" : "s"
  }${noTradeCount > 0 ? `, ${noTradeCount} did not qualify (NO TRADE)` : ""}${
    n - qualifiedCount - noTradeCount > 0 ? `, ${n - qualifiedCount - noTradeCount} could not be evaluated by the candidate engine` : ""
  }. Scanner detections are not recommendations.`;

  return {
    headline,
    answer: `${countSummary}\n\nHere are the current ${label}, in the scanner's own ranking:\n\n${lines.join("\n\n")}${exclusionNote}`,
    keyPoints: displayable.slice(0, 5).map((c) => `${c.symbol}${c.verdict ? ` — ${c.verdict.replace(/_/g, " ")}` : ""}${c.score != null ? ` (${c.score}/100)` : ""}`),
    riskNote:
      "These are software-detected candidates, not recommendations. Verdicts and levels are deterministic engine output — re-verify each setup in your own broker before acting.",
  };
}

/**
 * Deterministic confidence: data quality and completeness, never direction.
 * Mock-sourced data or missing underlying market data can never be "high".
 */
export function mcpOpportunityConfidence(search: McpOpportunitySearch): "low" | "medium" | "high" {
  const n = search.opportunities.length;
  if (n === 0) return "low";

  // Mock or synthetic source anywhere in the result set → low confidence.
  const hasMock = search.opportunities.some((o) => {
    const s = (o.setup.source ?? "").toLowerCase();
    const c = String((o.candidate as { source?: string } | null)?.source ?? "").toLowerCase();
    return s.includes("mock") || s.includes("synthetic") || c.includes("mock") || c.includes("synthetic");
  });
  if (hasMock) return "low";

  const withCandidates = search.opportunities.filter((o) => o.candidate != null);
  // Candidate engine failed for everything → low.
  if (withCandidates.length === 0) return "low";

  // "Complete" = candidate engine succeeded AND underlying market data (entry
  // trigger + invalidation, or an honest NO_TRADE verdict) is present.
  const complete = withCandidates.filter((o) => {
    if (normVerdict(o.candidate?.verdict) === "NO_TRADE") return true;
    const entry = o.candidate?.stockCandidate?.trigger?.price ?? o.setup.trigger?.price;
    const stop = o.candidate?.stockCandidate?.riskPlan?.suggestedStopZone?.low ?? o.setup.invalidation?.price;
    return typeof entry === "number" && typeof stop === "number";
  }).length;

  if (n >= 3 && withCandidates.length >= 3 && complete >= 3) return "high";
  return "medium";
}
