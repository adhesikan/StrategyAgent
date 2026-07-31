// Deterministic opportunity-search workflows for Ask AI.
//
// High-value opportunity intents ("Find high-quality trade opportunities",
// "Find income opportunities", ...) are routed here BEFORE any LLM call.
// Candidates come only from stored production scanner detections
// (opportunity-service getOpportunities — the same data behind
// GET /api/opportunities). The LLM may EXPLAIN these candidates; it never
// invents them.
//
// Source abstraction: runOpportunitySearch takes a fetch function, so when
// the Sprint 1B MCP `scan_opportunities` / `build_trade_candidate` tools are
// deployed the source can switch without touching intent routing or the
// response contract. Those tools are NOT in the current MCP allowlist
// (server/mcp/tools.ts), so candidateState is never fabricated here.

export type OpportunitySearchType = "trade" | "bullish" | "bearish" | "vcp" | "income";

/** Deterministic intent detection — regex first, never LLM inference. */
export function classifyOpportunitySearch(question: string): OpportunitySearchType | null {
  const q = question.toLowerCase();

  // Income first — "income opportunities" would otherwise match the generic
  // opportunity patterns below.
  if (
    /(find|show|get|generate|any|what).*(income|covered call|cash[- ]secured|premium).*(opportunit|trade|idea|candidate)/.test(q) ||
    /\bgenerate income\b/.test(q) ||
    /\bfind (option )?income\b/.test(q) ||
    /(covered call|cash[- ]secured put) (opportunit|candidate|trade|idea)/.test(q)
  ) {
    return "income";
  }
  if (/(find|show|any|what).*(bullish).*(opportunit|setup|trade|swing|candidate|idea)/.test(q)) return "bullish";
  if (/(find|show|any|what).*(bearish|short).*(opportunit|setup|trade|candidate|idea)/.test(q)) return "bearish";
  if (
    /(find|show|any|what).*(vcp).*(setup|opportunit|name|stock|candidate)/.test(q) ||
    /\bpivot[- ]ready (stock|setup|name)s?\b/.test(q)
  ) {
    return "vcp";
  }
  if (
    /(find|show|scan for|look for|search for|any|got any).*\b(opportunit(y|ies)|setups?)\b/.test(q) ||
    /\bfind (me )?(good |quality |high[- ]quality )?trades?\b/.test(q) ||
    /\bshow me (some )?(good |quality )?trades?\b/.test(q) ||
    /\bwhat are the best setups\b/.test(q) ||
    /\bwhat should i trade today\b/.test(q)
  ) {
    return "trade";
  }
  return null;
}

// Words that appear uppercase in opportunity phrasings but are never tickers
// in this context (finance jargon + phrase words).
const NON_TICKER_UPPER = new Set([
  "VCP", "CSP", "CC", "DTE", "AI", "ETF", "OTM", "ITM", "ATM", "IV", "OI", "PL", "PNL",
  "FIND", "SHOW", "ME", "THE", "BEST", "GOOD", "HIGH", "TOP", "WHAT", "ARE", "ANY",
  "TRADE", "TRADES", "SETUP", "SETUPS", "STOCK", "STOCKS", "OPTION", "OPTIONS",
  "INCOME", "TODAY", "NOW", "I", "A", "AN", "OF", "ON", "IN", "TO", "FOR", "AND", "OR",
]);

/**
 * True when the question explicitly names a ticker ($MU or an uppercase
 * 1–5 letter token that isn't opportunity-phrase jargon). Used to keep
 * ticker-specific asks ("covered call on NVDA") on their existing flows —
 * deliberately much stricter than the general extractTickers heuristic,
 * which false-positives on plain-English words like "high" or "pivot".
 */
export function hasExplicitTicker(question: string): boolean {
  if (/\$[A-Za-z]{1,5}\b/.test(question)) return true;
  const upper = question.match(/\b[A-Z]{1,5}\b/g) ?? [];
  return upper.some((t) => !NON_TICKER_UPPER.has(t));
}

/**
 * The single routing gate used by /api/ask: intent-first, then an explicit
 * ticker check (NOT the aggressive general ticker extractor).
 */
export function shouldRouteOpportunitySearch(question: string): OpportunitySearchType | null {
  const type = classifyOpportunitySearch(question);
  if (!type) return null;
  return hasExplicitTicker(question) ? null : type;
}

/** Subset of the stored opportunity row this module reads (shared/schema.ts). */
export interface OpportunityRow {
  symbol: string;
  strategyName?: string | null;
  timeframe?: string | null;
  stageAtDetection?: string | null;
  detectedAt?: string | Date | null;
  detectedPrice?: number | null;
  lastPrice?: number | null;
  entryTriggerPrice?: number | null;
  stopReferencePrice?: number | null;
  resistancePrice?: number | null;
  rvol?: number | null;
  score?: number | null;
  status?: string | null;
  resolutionOutcome?: string | null;
}

export interface OpportunityCard {
  symbol: string;
  strategy?: string;
  score?: number;
  stage?: string;
  direction?: string;
  timeframe?: string;
  price?: number;
  trigger?: number | null;
  reasons: string[];
  warnings: string[];
  freshness?: string;
  /** Only set by a deterministic candidate engine — never inferred client- or LLM-side. */
  candidateState?: "stock" | "estimated_options" | "no_trade" | null;
  estimatedOptions?: {
    strategy: string;
    status: "estimated";
    targetDteMin: number;
    targetDteMax: number;
    shortStrikeZone?: { low: number; high: number } | null;
    connectionRequiredForLiveContracts: boolean;
  } | null;
}

export interface OpportunitySearchResult {
  type: OpportunitySearchType;
  source: string;
  generatedAt: string;
  brokerConnected: boolean;
  opportunities: OpportunityCard[];
}

const SUPPORTED_STAGES = new Set(["early", "developing", "contraction", "pivot-ready", "base-building", "base_building"]);
const MAX_AGE_DAYS = 14;
const FRESH_DAYS = 7;

function ageDays(detectedAt: OpportunityRow["detectedAt"], now: Date): number | null {
  if (!detectedAt) return null;
  const d = new Date(detectedAt as any);
  if (Number.isNaN(d.getTime())) return null;
  return (now.getTime() - d.getTime()) / 86_400_000;
}

/**
 * Conservative quality filter over stored detections (spec: not every ACTIVE
 * row qualifies). Preserves the incoming order — the backend already returns
 * detectedAt DESC and scores are not normalized across strategies, so we do
 * NOT invent a cross-strategy re-ranking.
 */
export function qualifyOpportunities(
  rows: OpportunityRow[],
  type: OpportunitySearchType,
  now: Date = new Date(),
): OpportunityRow[] {
  const base = rows.filter((r) => {
    if (!r || typeof r.symbol !== "string" || !r.symbol) return false;
    if ((r.status ?? "").toUpperCase() !== "ACTIVE") return false;
    if (r.resolutionOutcome) return false; // resolved/invalidated
    const age = ageDays(r.detectedAt, now);
    if (age === null || age > MAX_AGE_DAYS) return false; // stale or unknown freshness
    const stage = (r.stageAtDetection ?? "").toLowerCase().replace(/\s+/g, "-");
    if (stage && !SUPPORTED_STAGES.has(stage) && stage !== "no-setup") return false;
    if (stage === "no-setup") return false;
    return true;
  });

  switch (type) {
    case "bearish":
      // The production scanner only stores long/breakout-style detections —
      // there is no bearish direction field. Honest empty result, never a
      // repurposed bullish list.
      return [];
    case "vcp":
      return base.filter(
        (r) =>
          /vcp/i.test(r.strategyName ?? "") ||
          ["contraction", "pivot-ready"].includes((r.stageAtDetection ?? "").toLowerCase()),
      );
    default:
      // trade / bullish / income all draw from the same long-setup pool.
      return base;
  }
}

function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Build a card from a stored row using ONLY fields that actually exist. */
export function toOpportunityCard(row: OpportunityRow, now: Date = new Date()): OpportunityCard {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const stage = (row.stageAtDetection ?? "").toLowerCase().replace(/\s+/g, "-") || undefined;
  if (stage) reasons.push(`Setup stage at detection: ${stage}`);
  if (typeof row.rvol === "number" && Number.isFinite(row.rvol)) reasons.push(`Relative volume ${row.rvol.toFixed(1)}x at detection`);
  if (typeof row.entryTriggerPrice === "number") reasons.push(`Entry trigger identified at ${fmt(row.entryTriggerPrice)}`);
  if (typeof row.stopReferencePrice === "number") warnings.push(`Setup weakens below the stop reference at ${fmt(row.stopReferencePrice)}`);
  const age = ageDays(row.detectedAt, now);
  let freshness: string | undefined;
  if (age !== null) {
    const d = Math.floor(age);
    freshness = d <= 0 ? "Detected today" : `Detected ${d} day${d === 1 ? "" : "s"} ago`;
    if (age > FRESH_DAYS) warnings.push(`Detection is ${d} days old — re-verify the structure before acting`);
  }
  return {
    symbol: row.symbol.toUpperCase(),
    ...(row.strategyName ? { strategy: row.strategyName } : {}),
    ...(typeof row.score === "number" ? { score: row.score } : {}),
    ...(stage ? { stage } : {}),
    direction: "bullish", // all stored detections are long setups
    ...(row.timeframe ? { timeframe: row.timeframe } : {}),
    ...(typeof row.detectedPrice === "number" ? { price: row.detectedPrice } : {}),
    trigger: typeof row.entryTriggerPrice === "number" ? row.entryTriggerPrice : null,
    reasons,
    warnings,
    ...(freshness ? { freshness } : {}),
    // No deterministic candidate engine deployed (MCP build_trade_candidate
    // is not in the allowlist) → candidate state stays null, never guessed.
    candidateState: null,
  };
}

export interface PositionLike {
  symbol: string;
  qty: number;
}

/**
 * Income candidates. Two modes (spec §8):
 *  A. Broker connected: covered-call candidates ONLY for symbols with >=100
 *     actually-owned shares; plus estimated CSP candidates on qualifying
 *     bullish setups.
 *  B. No broker: estimated, underlying-based candidates only.
 * Never fabricates premiums, strikes-as-contracts, Greeks, OI, or bid/ask —
 * the only numbers used are real technical levels from the stored detection.
 */
export function buildIncomeCandidates(opts: {
  rows: OpportunityRow[];
  positions: PositionLike[];
  brokerConnected: boolean;
  now?: Date;
  max?: number;
}): OpportunityCard[] {
  const { rows, positions, brokerConnected } = opts;
  const now = opts.now ?? new Date();
  const max = opts.max ?? 5;
  const cards: OpportunityCard[] = [];
  const connectionRequired = !brokerConnected;

  // Covered calls — ownership is a hard requirement.
  if (brokerConnected) {
    for (const p of positions) {
      if (cards.length >= max) break;
      if (!p || typeof p.qty !== "number" || p.qty < 100) continue;
      const sym = p.symbol.toUpperCase();
      const row = rows.find((r) => r.symbol?.toUpperCase() === sym);
      cards.push({
        symbol: sym,
        strategy: "Covered Call",
        direction: "neutral-bullish",
        reasons: [
          `You own ${Math.floor(p.qty)} shares — enough to cover ${Math.floor(p.qty / 100)} contract${Math.floor(p.qty / 100) === 1 ? "" : "s"}`,
        ],
        warnings: ["Covered calls cap upside above the short strike and do not protect against a meaningful drop in the shares"],
        trigger: null,
        candidateState: "estimated_options",
        estimatedOptions: {
          strategy: "COVERED_CALL",
          status: "estimated",
          targetDteMin: 20,
          targetDteMax: 45,
          // Zone only when a real technical level exists for this symbol.
          shortStrikeZone:
            row && typeof row.resistancePrice === "number"
              ? { low: row.resistancePrice, high: round2(row.resistancePrice * 1.05) }
              : null,
          connectionRequiredForLiveContracts: false,
        },
      });
    }
  }

  // Estimated cash-secured puts on qualifying bullish setups.
  for (const row of rows) {
    if (cards.length >= max) break;
    if (cards.some((c) => c.symbol === row.symbol?.toUpperCase() && c.estimatedOptions?.strategy === "CASH_SECURED_PUT")) continue;
    const hasZone = typeof row.stopReferencePrice === "number" && typeof row.detectedPrice === "number" && row.stopReferencePrice < row.detectedPrice;
    const card = toOpportunityCard(row, now);
    card.strategy = "Cash-Secured Put";
    card.direction = "neutral-bullish";
    card.candidateState = "estimated_options";
    card.reasons = [
      "Bullish/neutral technical structure from an active scanner detection",
      "Candidate entry below the current market via short put assignment",
      ...card.reasons.filter((r) => r.startsWith("Setup stage")),
    ];
    card.warnings = [
      "Requires cash set aside to buy 100 shares per contract at the strike",
      ...(card.warnings.length ? [card.warnings[0]] : []),
    ];
    card.estimatedOptions = {
      strategy: "CASH_SECURED_PUT",
      status: "estimated",
      targetDteMin: 20,
      targetDteMax: 45,
      shortStrikeZone: hasZone ? { low: round2(row.stopReferencePrice as number), high: round2(row.detectedPrice as number) } : null,
      connectionRequiredForLiveContracts: connectionRequired,
    };
    cards.push(card);
  }

  return cards.slice(0, max);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Confidence reflects data freshness/completeness — never direction (spec §19). */
export function opportunityConfidence(
  search: OpportunitySearchResult | null,
  failed: boolean,
  now: Date = new Date(),
): "low" | "medium" | "high" {
  if (failed || !search) return "low";
  const n = search.opportunities.length;
  if (n === 0) return "low";
  const freshCount = search.opportunities.filter((o) => o.freshness && !/\d{2,} days/.test(o.freshness) && !o.warnings.some((w) => w.includes("re-verify"))).length;
  if (n >= 3 && freshCount >= 3) return "high";
  return "medium";
}

const TYPE_LABELS: Record<OpportunitySearchType, string> = {
  trade: "trade opportunities",
  bullish: "bullish opportunities",
  bearish: "bearish opportunities",
  vcp: "VCP setups",
  income: "income opportunities",
};

/**
 * Deterministic prose built ONLY from the candidates. Used verbatim when
 * OpenAI is unavailable, and as the required grounding when it is — the model
 * may restate these candidates but never replace them with generic education.
 */
export function buildOpportunityAnswer(
  search: OpportunitySearchResult | null,
  failed: boolean,
): { headline: string; answer: string; keyPoints: string[]; riskNote: string } {
  if (failed || !search) {
    return {
      headline: "Live opportunity data is temporarily unavailable.",
      answer:
        "Live opportunity data is temporarily unavailable. You can open the Scanner to run a fresh scan, or ask about a specific ticker (for example \"Analyze MU\") for a live structural analysis.",
      keyPoints: ["Open the Scanner for a fresh scan", "Ask about a specific ticker instead"],
      riskNote: "No candidates are shown because no verified data was available — nothing here is fabricated.",
    };
  }
  const label = TYPE_LABELS[search.type];
  if (search.opportunities.length === 0) {
    const bearishNote =
      search.type === "bearish"
        ? " The production scanner currently tracks long (bullish) setups only, so bearish candidates are not available from stored detections."
        : "";
    return {
      headline: "No high-quality setups currently meet the criteria.",
      answer: `No high-quality setups currently meet the criteria.${bearishNote} This is a valid result — it means nothing in the tracked universe currently passes the quality filters, not that data is missing. You can run a fresh scan, review your watchlist, or ask about a specific symbol.`,
      keyPoints: ["Open the Scanner to run a fresh scan", "Review your watchlist", "Ask about a specific symbol"],
      riskNote: "Forcing a trade when no setup qualifies is a common way to give back gains. No trade is a valid position.",
    };
  }
  const lines = search.opportunities.map((o, i) => {
    const bits = [
      `${i + 1}. ${o.symbol}${o.strategy ? ` — ${o.strategy}` : ""}`,
      o.score != null ? `Score: ${o.score}/100` : null,
      o.stage ? `Stage: ${o.stage}` : null,
      o.trigger != null ? `Entry trigger: ${fmt(o.trigger)}` : null,
      o.estimatedOptions
        ? `Estimated ${o.estimatedOptions.strategy.replace(/_/g, " ").toLowerCase()} · target DTE ${o.estimatedOptions.targetDteMin}–${o.estimatedOptions.targetDteMax}${
            o.estimatedOptions.shortStrikeZone ? ` · strike zone ${fmt(o.estimatedOptions.shortStrikeZone.low)}–${fmt(o.estimatedOptions.shortStrikeZone.high)}` : ""
          }`
        : null,
      o.reasons.length ? `Why: ${o.reasons.join("; ")}` : null,
      o.warnings.length ? `Risk: ${o.warnings.join("; ")}` : null,
    ].filter(Boolean);
    return bits.join("\n   ");
  });
  const incomeNote =
    search.type === "income" && !search.brokerConnected
      ? "\n\nLive option contracts, premiums, Greeks, liquidity and exact strikes require a Tradier or TradeStation connection."
      : "";
  return {
    headline: `Top ${label} from the live scanner detections (${search.opportunities.length}).`,
    answer: `Here are the current ${label}, ranked by the production scanner's own ordering:\n\n${lines.join("\n\n")}${incomeNote}`,
    keyPoints: search.opportunities.slice(0, 5).map((o) => `${o.symbol}${o.stage ? ` — ${o.stage}` : ""}${o.score != null ? ` (${o.score}/100)` : ""}`),
    riskNote:
      "These are software-detected setups, not recommendations. Structures change fast — re-verify each setup and confirm levels in your own broker before acting.",
  };
}

/** Post-search CTAs (research navigation only — never auto-opens Trade Builder). */
export function suggestionsForOpportunitySearch(
  search: OpportunitySearchResult | null,
  failed: boolean,
): { label: string; href: string }[] {
  if (failed || !search || search.opportunities.length === 0) {
    return [
      { label: "Open Scanner", href: "/scanner" },
      { label: "Review Watchlist", href: "/watchlists" },
      { label: "Ask about a symbol", href: "/ask" },
    ];
  }
  const first = search.opportunities[0];
  const out: { label: string; href: string }[] = [{ label: `Analyze ${first.symbol}`, href: `/ask?q=${encodeURIComponent(`Analyze ${first.symbol}`)}` }];
  if (search.type === "income") {
    out.push({ label: "Open Income Mode", href: "/income-mode" });
    if (!search.brokerConnected) out.push({ label: "Connect Broker", href: "/settings" });
  } else {
    out.push({ label: "Open Scanner", href: "/scanner" });
    out.push({ label: "See ranked opportunities", href: "/opportunity-radar" });
  }
  return out;
}

export interface RunOpportunitySearchDeps {
  fetchRows: () => Promise<OpportunityRow[]>;
  fetchPositions: () => Promise<PositionLike[]>;
  brokerConnected: boolean;
  now?: Date;
}

/**
 * Orchestrates one opportunity search. Any retrieval failure → { failed: true }
 * and no candidates (never fabricated). Positions failure only degrades the
 * covered-call portion of income searches.
 */
export async function runOpportunitySearch(
  type: OpportunitySearchType,
  deps: RunOpportunitySearchDeps,
): Promise<{ search: OpportunitySearchResult | null; failed: boolean }> {
  const now = deps.now ?? new Date();
  let rows: OpportunityRow[];
  try {
    rows = await deps.fetchRows();
  } catch {
    return { search: null, failed: true };
  }
  const qualified = qualifyOpportunities(rows, type, now);
  let opportunities: OpportunityCard[];
  if (type === "income") {
    let positions: PositionLike[] = [];
    if (deps.brokerConnected) {
      try {
        positions = await deps.fetchPositions();
      } catch {
        positions = []; // degrade: no covered calls, CSPs still estimated
      }
    }
    opportunities = buildIncomeCandidates({ rows: qualified, positions, brokerConnected: deps.brokerConnected, now });
  } else {
    opportunities = qualified.slice(0, 5).map((r) => toOpportunityCard(r, now));
  }
  return {
    search: {
      type,
      source: "opportunity-service", // switches to "mcp:scan_opportunities" when Sprint 1B tools deploy
      generatedAt: now.toISOString(),
      brokerConnected: deps.brokerConnected,
      opportunities,
    },
    failed: false,
  };
}
