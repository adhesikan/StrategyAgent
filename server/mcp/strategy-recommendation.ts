// Deterministic trade-strategy recommendation orchestration for Ask AI.
//
// This module is the SINGLE home for:
//   1. Trade-request intent classification (recommendation vs analysis vs
//      education vs combined) — phrase aliases are centralized here, never
//      scattered across route handlers.
//   2. Trade-goal normalization (symbol/objective/strategy/direction/
//      instrument/risk/DTE/count parsing).
//   3. The recommend_trade_strategy MCP call + defensive validation of its
//      response into the additive `strategyRecommendation` payload.
//   4. Deterministic headline / confidence / suggestion (CTA) derivation —
//      the MCP verdict is the source of truth; the LLM only explains it.
//
// Boundaries: recommendation policies live in the MCP service (never
// duplicated here); no execution behavior; no broker credentials or account
// identifiers are ever passed; a failed deterministic recommendation is never
// replaced with a GPT-invented trade.

import { scrubUntrusted } from "../routes/opportunity-search-mcp";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecommendationVerdict =
  | "LIVE_OPTIONS"
  | "ESTIMATED_OPTIONS"
  | "STOCK"
  | "WATCH"
  | "NO_TRADE"
  | "UNSUPPORTED";

const KNOWN_VERDICTS: readonly RecommendationVerdict[] = [
  "LIVE_OPTIONS",
  "ESTIMATED_OPTIONS",
  "STOCK",
  "WATCH",
  "NO_TRADE",
  "UNSUPPORTED",
];

export interface TradeGoal {
  symbol?: string;
  objective?: "growth" | "income" | "capital_preservation" | "hedging" | "speculative";
  /** Normalized strategy. "credit_spread" is our generic form; it is resolved
   *  to a concrete MCP enum value at call time based on direction. */
  requestedStrategy?:
    | "stock"
    | "long_call"
    | "long_put"
    | "covered_call"
    | "cash_secured_put"
    | "bull_put_credit_spread"
    | "bear_call_credit_spread"
    | "call_debit_spread"
    | "put_debit_spread"
    | "credit_spread";
  direction?: "bullish" | "bearish" | "neutral" | "either";
  instrumentPreference?: "stock" | "options" | "either";
  maxRiskDollars?: number;
  maxRiskPercent?: number;
  accountSize?: number;
  targetDTE?: number;
  numberOfIdeas?: number;
}

export type TradeRequestKind =
  | "recommendation"
  | "combined" // analysis + recommendation ("Analyze NVDA and recommend a trade")
  | "education_plus_search"; // "Explain credit spreads and find one"

export interface TradeRequestIntent {
  kind: TradeRequestKind;
  goal: TradeGoal;
}

/** One validated recommendation idea (fields preserved from MCP, unknown
 *  extras dropped-through untouched after scrubbing). */
export interface RecommendationIdea {
  overallVerdict: RecommendationVerdict;
  recommendedStrategy?: string | null;
  primaryStrategy?: unknown;
  supportingStrategies?: unknown[];
  strategySummary?: string | null;
  setup?: unknown;
  tradeCandidate?: unknown;
  riskAssessment?: unknown;
  optionAnalysis?: unknown;
  recommendedPosition?: unknown;
  alternatives?: unknown[];
  reasons?: string[];
  warnings?: string[];
  confidence?: number | null;
  dataQuality?: Record<string, unknown> | null;
  [k: string]: unknown;
}

export interface StrategyRecommendation {
  source: "mcp";
  generatedAt: string;
  tradeGoal?: unknown;
  request?: unknown;
  recommendations: RecommendationIdea[];
  warnings?: string[];
  /** True when any idea's data quality indicates mock/synthetic/fixture/simulated data. */
  simulatedData: boolean;
}

// ---------------------------------------------------------------------------
// Intent classification + goal normalization (centralized aliases)
// ---------------------------------------------------------------------------

const RECO_VERB_RE =
  /\b(find|recommend|suggest|give\s+me|show\s+me|get\s+me|look\s+for|search\s+for|what\s+should\s+i\s+trade|any\s+good)\b/;
const TRADE_NOUN_RE =
  /\b(trade|trades|trade\s+idea|ideas?|strategy|strategies|spread|spreads|covered\s+call|cash[- ]secured\s+put|csp|option|options|call|calls|put|puts|stock\s+trade|setup\s+to\s+trade)\b/;
const ANALYSIS_VERB_RE = /\b(analyz\w*|analys\w*|evaluate|assess|review|technical\s+analysis|how\s+does\s+\S+\s+look)\b/;
const EDUCATION_RE =
  /\b(what\s+is|what's|what\s+are|explain|how\s+do(?:es)?\s+.{0,40}\bwork|define|definition\s+of|teach\s+me|meaning\s+of)\b/;

// Strategy phrase aliases → normalized requestedStrategy. Order matters:
// longest, most specific phrases first.
const STRATEGY_ALIASES: Array<[RegExp, NonNullable<TradeGoal["requestedStrategy"]>]> = [
  [/\bbull\s+put\s+(credit\s+)?spread\b|\bput\s+credit\s+spread\b/, "bull_put_credit_spread"],
  [/\bbear\s+call\s+(credit\s+)?spread\b|\bcall\s+credit\s+spread\b/, "bear_call_credit_spread"],
  [/\bcall\s+debit\s+spread\b|\bbull\s+call\s+spread\b/, "call_debit_spread"],
  [/\bput\s+debit\s+spread\b|\bbear\s+put\s+spread\b/, "put_debit_spread"],
  [/\bcredit\s+spreads?\b/, "credit_spread"],
  [/\bcovered\s+calls?\b/, "covered_call"],
  [/\bcash[- ]secured\s+puts?\b|\bcsp\b/, "cash_secured_put"],
  [/\blong\s+calls?\b|\bbuy(?:ing)?\s+(?:a\s+)?calls?\b/, "long_call"],
  [/\blong\s+puts?\b|\bbuy(?:ing)?\s+(?:a\s+)?puts?\b/, "long_put"],
  [/\bstock\s+trade\b|\bshares?\s+trade\b|\bequity\s+trade\b/, "stock"],
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseIdeaCount(lower: string): number | undefined {
  const m = lower.match(/\b(?:find|show|give\s+me|recommend|suggest|get\s+me)\s+(?:me\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+/);
  if (!m) return undefined;
  const raw = m[1];
  const n = NUMBER_WORDS[raw] ?? Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(10, n) : undefined;
}

function parseMoney(raw: string): number | undefined {
  const n = Number.parseFloat(raw.replace(/[$,]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseRiskDollars(lower: string): number | undefined {
  // "under $500 max loss", "under $300 risk", "less than $500", "risking $250",
  // "$500 max loss", "max risk of $400", "with $300 of risk"
  const patterns = [
    /(?:under|below|less\s+than|no\s+more\s+than|up\s+to|within)\s+\$?([\d,]+(?:\.\d+)?)\s*(?:max\s+loss|max\s+risk|risk|loss|dollars?\s+(?:of\s+)?risk)?/,
    /\$?([\d,]+(?:\.\d+)?)\s*(?:max\s+loss|max\s+risk|of\s+risk|risk\s+budget)/,
    /(?:risk(?:ing)?|lose)\s+(?:at\s+most\s+)?\$([\d,]+(?:\.\d+)?)/,
  ];
  for (const re of patterns) {
    const m = lower.match(re);
    if (m) {
      // Require a risk/loss cue OR an explicit $ to avoid grabbing prices like "under $300" ambiguously —
      // spec examples treat "under $300 risk" and "under $500 max loss" as risk budgets, and a bare
      // "under $X" on a trade ask is conventionally a risk cap, so accept it.
      const v = parseMoney(m[1]);
      if (v) return v;
    }
  }
  return undefined;
}

function parseRiskPercent(lower: string): number | undefined {
  const m = lower.match(/\brisk(?:ing)?\s+(?:at\s+most\s+)?([\d.]+)\s*%|([\d.]+)\s*%\s+(?:of\s+(?:my\s+)?account\s+)?risk/);
  if (!m) return undefined;
  const n = Number.parseFloat(m[1] ?? m[2]);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : undefined;
}

function parseAccountSize(lower: string): number | undefined {
  const m = lower.match(/\baccount(?:\s+size)?\s+(?:of\s+|is\s+)?\$?([\d,]+(?:\.\d+)?)(k)?\b/);
  if (!m) return undefined;
  const v = parseMoney(m[1]);
  return v ? (m[2] ? v * 1000 : v) : undefined;
}

function parseTargetDte(lower: string): number | undefined {
  const m = lower.match(/\b(\d{1,3})\s*(?:dte\b|days?\s+(?:to|until)\s+expir)/);
  if (!m) return undefined;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Normalize a raw question into a TradeGoal. `tickers` should come from the
 * caller's existing ticker extraction (never re-guessed by the model).
 */
export function normalizeTradeGoal(question: string, tickers: string[] = []): TradeGoal {
  const lower = String(question ?? "").toLowerCase();
  const goal: TradeGoal = {};

  if (tickers[0]) goal.symbol = tickers[0].toUpperCase();

  for (const [re, strat] of STRATEGY_ALIASES) {
    if (re.test(lower)) {
      goal.requestedStrategy = strat;
      break;
    }
  }

  // Direction
  if (/\bbullish|upside|long\s+bias|to\s+the\s+upside\b/.test(lower)) goal.direction = "bullish";
  else if (/\bbearish|downside|short\s+bias|to\s+the\s+downside\b/.test(lower)) goal.direction = "bearish";
  else if (/\bneutral\b/.test(lower)) goal.direction = "neutral";
  else if (goal.requestedStrategy === "long_call" || goal.requestedStrategy === "call_debit_spread" || goal.requestedStrategy === "bull_put_credit_spread") goal.direction = "bullish";
  else if (goal.requestedStrategy === "long_put" || goal.requestedStrategy === "put_debit_spread" || goal.requestedStrategy === "bear_call_credit_spread") goal.direction = "bearish";

  // Instrument preference
  const optionStrategies = new Set(["long_call", "long_put", "covered_call", "cash_secured_put", "bull_put_credit_spread", "bear_call_credit_spread", "call_debit_spread", "put_debit_spread", "credit_spread"]);
  if (goal.requestedStrategy === "stock" || /\bstock\s+trade|shares?\b/.test(lower)) goal.instrumentPreference = "stock";
  else if ((goal.requestedStrategy && optionStrategies.has(goal.requestedStrategy)) || /\boptions?\s+trade|\boption\b|\bspread\b/.test(lower)) goal.instrumentPreference = "options";

  // Objective
  if (/\bincome|premium|yield\b/.test(lower) || goal.requestedStrategy === "credit_spread" || goal.requestedStrategy === "covered_call" || goal.requestedStrategy === "cash_secured_put") goal.objective = "income";
  else if (/\bhedge|hedging|protect(?:ion)?\b/.test(lower)) goal.objective = "hedging";
  else if (/\bspeculat/.test(lower)) goal.objective = "speculative";
  else if (/\bpreserve\s+capital|capital\s+preservation|conservative\b/.test(lower)) goal.objective = "capital_preservation";

  const maxRiskDollars = parseRiskDollars(lower);
  if (maxRiskDollars != null) goal.maxRiskDollars = maxRiskDollars;
  const maxRiskPercent = parseRiskPercent(lower);
  if (maxRiskPercent != null) goal.maxRiskPercent = maxRiskPercent;
  const accountSize = parseAccountSize(lower);
  if (accountSize != null) goal.accountSize = accountSize;
  const targetDTE = parseTargetDte(lower);
  if (targetDTE != null) goal.targetDTE = targetDTE;
  const numberOfIdeas = parseIdeaCount(lower);
  if (numberOfIdeas != null) goal.numberOfIdeas = numberOfIdeas;

  return goal;
}

/**
 * Classify a question as a trade-seeking request. Returns null when this is
 * NOT a recommendation ask (plain analysis, pure education, news, etc.) —
 * those keep their existing flows.
 */
export function classifyTradeRequest(question: string, tickers: string[] = []): TradeRequestIntent | null {
  const lower = String(question ?? "").toLowerCase();
  if (!lower.trim()) return null;

  const isEducation = EDUCATION_RE.test(lower);
  const hasRecoVerb = RECO_VERB_RE.test(lower) || /\bwhat\s+should\s+i\s+trade\b/.test(lower);
  const hasTradeNoun = TRADE_NOUN_RE.test(lower);
  const hasStrategyPhrase = STRATEGY_ALIASES.some(([re]) => re.test(lower));
  const isAnalysis = ANALYSIS_VERB_RE.test(lower);

  // Trade-seeking: a recommendation verb + trade noun, or an explicit
  // "find/recommend" of a known strategy phrase.
  const wantsTrade =
    (hasRecoVerb && (hasTradeNoun || hasStrategyPhrase)) || /\bwhat\s+should\s+i\s+trade\b/.test(lower);
  if (!wantsTrade) return null;

  // Pure education ("what is a credit spread?") — the education wording with
  // no find/recommend verb never routes here (hasRecoVerb false). Education
  // wording PLUS a find verb ("explain credit spreads and find one") is the
  // mixed flow.
  const goal = normalizeTradeGoal(question, tickers);
  if (isEducation) return { kind: "education_plus_search", goal };
  if (isAnalysis) return { kind: "combined", goal };
  return { kind: "recommendation", goal };
}

// ---------------------------------------------------------------------------
// MCP call + defensive validation
// ---------------------------------------------------------------------------

export interface StrategyRecommendationDeps {
  /** Wrapper around the recommend_trade_strategy MCP tool. */
  recommend: (args: Record<string, unknown>) => Promise<unknown>;
  /** Backend-minted opaque options-context token (trusted context mechanism). */
  optionsContextToken?: string;
  timeoutMs?: number;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      const err: any = new Error("Recommendation timed out");
      err.code = "TIMEOUT";
      reject(err);
    }, ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** Map a normalized TradeGoal onto model-safe MCP arguments only. */
export function tradeGoalToMcpArgs(goal: TradeGoal, optionsContextToken?: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (goal.symbol) args.symbol = goal.symbol;
  if (goal.objective) args.objective = goal.objective;
  if (goal.instrumentPreference) args.instrumentPreference = goal.instrumentPreference;
  if (goal.direction) args.direction = goal.direction;
  if (goal.requestedStrategy) {
    // Generic "credit spread" resolves deterministically by direction:
    // bearish → bear_call, otherwise bull_put (both currently resolve to
    // UNSUPPORTED on the MCP side, which surfaces safer alternatives).
    args.requestedStrategy =
      goal.requestedStrategy === "credit_spread"
        ? goal.direction === "bearish"
          ? "bear_call_credit_spread"
          : "bull_put_credit_spread"
        : goal.requestedStrategy;
  }
  if (typeof goal.maxRiskDollars === "number") args.maxRiskDollars = goal.maxRiskDollars;
  if (typeof goal.maxRiskPercent === "number") args.maxRiskPercent = goal.maxRiskPercent;
  if (typeof goal.accountSize === "number") args.accountSize = goal.accountSize;
  if (typeof goal.targetDTE === "number") args.targetDTE = goal.targetDTE;
  if (typeof goal.numberOfIdeas === "number") args.numberOfIdeas = goal.numberOfIdeas;
  if (optionsContextToken) args.optionsContextToken = optionsContextToken;
  // NEVER: accountId, userId, connectionId, broker credentials, access
  // tokens, internal API keys.
  return args;
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 20) : [];
}

const MOCK_RE = /\b(mock|synthetic|fixture|simulated)\b/i;

function detectSimulated(raw: unknown): boolean {
  try {
    return MOCK_RE.test(JSON.stringify(raw ?? "").slice(0, 200_000));
  } catch {
    return false;
  }
}

/** Defensive validation: a malformed payload must never crash Ask AI. */
export function validateRecommendationPayload(raw: unknown): StrategyRecommendation {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawRecs = Array.isArray(obj.recommendations)
    ? obj.recommendations
    : obj.recommendation && typeof obj.recommendation === "object"
      ? [obj.recommendation]
      : [];

  const recommendations: RecommendationIdea[] = [];
  for (const r of rawRecs.slice(0, 10)) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const verdictRaw = String(rec.overallVerdict ?? rec.verdict ?? "").toUpperCase();
    const overallVerdict = (KNOWN_VERDICTS as readonly string[]).includes(verdictRaw)
      ? (verdictRaw as RecommendationVerdict)
      : "NO_TRADE"; // unknown verdicts degrade safely — never invent a trade
    recommendations.push({
      ...rec,
      overallVerdict,
      reasons: toStringArray(rec.reasons),
      warnings: toStringArray(rec.warnings),
      strategySummary: typeof rec.strategySummary === "string" ? rec.strategySummary : null,
      recommendedStrategy: typeof rec.recommendedStrategy === "string" ? rec.recommendedStrategy : null,
      confidence: typeof rec.confidence === "number" ? rec.confidence : null,
      dataQuality: rec.dataQuality && typeof rec.dataQuality === "object" ? (rec.dataQuality as Record<string, unknown>) : null,
    });
  }

  return {
    source: "mcp",
    generatedAt: typeof obj.generatedAt === "string" ? obj.generatedAt : new Date().toISOString(),
    tradeGoal: obj.tradeGoal,
    request: obj.request,
    recommendations,
    warnings: toStringArray(obj.warnings),
    simulatedData: detectSimulated(raw),
  };
}

/**
 * One deterministic recommend_trade_strategy call per normalized request.
 * The MCP contract supports multiple candidates internally (numberOfIdeas),
 * so we never fan out multiple calls.
 */
export async function runStrategyRecommendation(
  goal: TradeGoal,
  deps: StrategyRecommendationDeps,
): Promise<StrategyRecommendation> {
  const args = tradeGoalToMcpArgs(goal, deps.optionsContextToken);
  const raw = scrubUntrusted(await withTimeout(deps.recommend(args), deps.timeoutMs ?? 25_000));
  const validated = validateRecommendationPayload(raw);
  if (validated.recommendations.length === 0) {
    const err: any = new Error("Recommendation payload contained no recommendations");
    err.code = "MALFORMED_RECOMMENDATION";
    throw err;
  }
  return validated;
}

// ---------------------------------------------------------------------------
// Deterministic presentation: headline / confidence / suggestions
// ---------------------------------------------------------------------------

export function recommendationHeadline(rec: StrategyRecommendation): string {
  const ideas = rec.recommendations;
  if (ideas.length > 1) {
    const n = ideas.filter((i) => i.overallVerdict !== "NO_TRADE" && i.overallVerdict !== "UNSUPPORTED").length;
    if (n === 0) return "Setups were reviewed, but none currently qualify for this request.";
    return `${n} trade candidate${n === 1 ? "" : "s"} identified.`;
  }
  const v = ideas[0]?.overallVerdict ?? "NO_TRADE";
  switch (v) {
    case "LIVE_OPTIONS":
      return rec.simulatedData
        ? "One simulated options candidate generated for development testing."
        : "One live options trade candidate identified.";
    case "ESTIMATED_OPTIONS":
      return "One estimated options strategy identified.";
    case "STOCK":
      return "One stock trade candidate identified.";
    case "WATCH":
      return "One potential setup is worth watching, but it is not actionable yet.";
    case "UNSUPPORTED":
      return "This strategy is not yet supported by the current recommendation engine.";
    default:
      return "Setups were reviewed, but none currently qualify for this request.";
  }
}

export function recommendationConfidence(rec: StrategyRecommendation): "low" | "medium" | "high" {
  if (rec.simulatedData) return "low";
  const best = rec.recommendations[0];
  if (!best) return "low";
  if (best.overallVerdict === "NO_TRADE" || best.overallVerdict === "UNSUPPORTED") return "low";
  const c = typeof best.confidence === "number" ? best.confidence : 0;
  if (best.overallVerdict === "WATCH") return c >= 60 ? "medium" : "low";
  if (c >= 70) return "high";
  if (c >= 40) return "medium";
  return "low";
}

function ideaSymbol(idea: RecommendationIdea): string | null {
  const setup = idea.setup as Record<string, unknown> | null | undefined;
  const cand = idea.tradeCandidate as Record<string, unknown> | null | undefined;
  const s = (setup?.symbol ?? cand?.symbol) as string | undefined;
  return typeof s === "string" && /^[A-Z][A-Z0-9.\-\/]{0,9}$/.test(s.toUpperCase()) ? s.toUpperCase() : null;
}

/** True when a Trade Builder handoff is allowed for this idea (spec §9). */
export function tradeBuilderEligible(idea: RecommendationIdea, simulatedData: boolean): boolean {
  if (simulatedData) return false;
  if (idea.overallVerdict === "STOCK") {
    // Fresh, actionable, risk-complete: require a candidate with entry/stop.
    const cand = idea.tradeCandidate as Record<string, unknown> | null | undefined;
    const pos = idea.recommendedPosition as Record<string, unknown> | null | undefined;
    return !!(cand || pos);
  }
  if (idea.overallVerdict === "LIVE_OPTIONS") {
    const oa = idea.optionAnalysis as Record<string, unknown> | null | undefined;
    const pos = idea.recommendedPosition as Record<string, unknown> | null | undefined;
    return !!(oa || pos);
  }
  return false; // ESTIMATED_OPTIONS / WATCH / NO_TRADE / UNSUPPORTED never get a ticket CTA
}

export function suggestionsForRecommendation(rec: StrategyRecommendation): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  const best = rec.recommendations[0];
  const sym = best ? ideaSymbol(best) : null;
  const v = best?.overallVerdict;

  if (sym) out.push({ label: `Analyze ${sym}`, href: `/ask?q=${encodeURIComponent(`Analyze ${sym}`)}` });
  if (sym && (v === "STOCK" || v === "LIVE_OPTIONS" || v === "ESTIMATED_OPTIONS")) {
    out.push({ label: "View Setup", href: `/trade/${sym}` });
  }
  if (v === "ESTIMATED_OPTIONS") out.push({ label: "Connect Broker", href: "/settings" });
  if (sym && v === "WATCH") out.push({ label: "Add to Watchlist", href: `/watchlist?add=${sym}` });
  if (v === "NO_TRADE" || v === "UNSUPPORTED" || !best) out.push({ label: "Open Scanner", href: "/scanner" });
  out.push({ label: "Opportunity Radar", href: "/opportunity-radar" });
  return out.slice(0, 4);
}

/** Deterministic server-generated summary when OpenAI is unavailable after a
 *  successful MCP recommendation — the MCP result is never discarded. */
export function buildRecommendationFallbackAnswer(rec: StrategyRecommendation): {
  headline: string;
  answer: string;
  keyPoints: string[];
  riskNote: string;
} {
  const headline = recommendationHeadline(rec);
  const lines: string[] = [];
  const keyPoints: string[] = [];
  for (const idea of rec.recommendations.slice(0, 5)) {
    const sym = ideaSymbol(idea);
    const parts: string[] = [];
    if (sym) parts.push(sym);
    parts.push(idea.overallVerdict.replace(/_/g, " "));
    if (idea.recommendedStrategy) parts.push(idea.recommendedStrategy.replace(/_/g, " "));
    if (idea.strategySummary) parts.push(idea.strategySummary);
    lines.push(parts.join(" — "));
    if (idea.reasons?.[0]) keyPoints.push(idea.reasons[0]);
  }
  return {
    headline,
    answer: lines.join("\n") || headline,
    keyPoints: keyPoints.slice(0, 4),
    riskNote:
      "Deterministic recommendation engine output. AI-generated research, not investment advice — verify every level in your own broker before acting.",
  };
}

/**
 * Deterministic key points derived ONLY from MCP reasons/warnings (spec:
 * when strategyRecommendation exists, keyPoints must come from the payload —
 * never from model-generated market sentiment that could imply a trade).
 */
export function recommendationKeyPoints(rec: StrategyRecommendation): string[] {
  const points: string[] = [];
  for (const idea of rec.recommendations.slice(0, 3)) {
    for (const r of idea.reasons ?? []) if (typeof r === "string" && r.trim()) points.push(r.trim());
  }
  for (const idea of rec.recommendations.slice(0, 3)) {
    for (const w of idea.warnings ?? []) if (typeof w === "string" && w.trim()) points.push(w.trim());
  }
  for (const w of rec.warnings ?? []) if (typeof w === "string" && w.trim()) points.push(w.trim());
  // De-dupe, cap at 5 (UI limit).
  return Array.from(new Set(points)).slice(0, 5);
}

/** Deterministic verdict-driven risk note — never model-generated. */
export function recommendationRiskNote(rec: StrategyRecommendation): string {
  const v = rec.recommendations[0]?.overallVerdict ?? "NO_TRADE";
  const base =
    v === "NO_TRADE"
      ? "No trade is recommended from the available evidence."
      : v === "WATCH"
        ? "Not actionable yet — no trade is recommended until the watch conditions are met."
        : v === "UNSUPPORTED"
          ? "The requested strategy isn't supported by the recommendation engine — only the listed safer alternatives were evaluated."
          : v === "ESTIMATED_OPTIONS"
            ? "Estimated structure only — no live options chain was used. Confirm real contracts, premiums, and liquidity with a connected provider before acting."
            : "Deterministic recommendation engine output — verify every level in your own broker before acting.";
  const sim = rec.simulatedData ? " Data source is simulated development data — not live market data." : "";
  return `${base}${sim} AI-generated research, not investment advice.`.slice(0, 280);
}

// Actionable-trade language that must never accompany a non-actionable
// verdict. Kept deliberately narrow: educational mentions of a strategy name
// are fine; claiming a concrete "best trade" with numbers is not.
const CONTRADICTION_RES: RegExp[] = [
  /\bbest (stock|option) trade\b/i,
  /\bhere (are|is) the best\b/i,
  /\blooks (bullish|bearish)\s*[—-]/i,
  /\bmax loss\s*(of|is|:)?\s*\$\d/i,
  /\bexpir(es|ation|y)\b[^.\n]{0,20}\d{4}-\d{2}-\d{2}/i,
  /\b\d{1,3}%\s*(confidence|probability)\b/i,
  /\brecommended (entry|buy|sell|trade)\b/i,
  /\bgrade\s*[ABC]\b/i,
];

const ACTIONABLE_VERDICTS: ReadonlySet<string> = new Set(["LIVE_OPTIONS", "ESTIMATED_OPTIONS", "STOCK"]);

/**
 * True when model prose asserts an actionable trade that the deterministic
 * verdicts do not support (spec §3C: discard contradictory prose and use the
 * deterministic shell instead).
 */
export function answerContradictsRecommendation(text: string, rec: StrategyRecommendation): boolean {
  if (!text) return false;
  const anyActionable = rec.recommendations.some((i) => ACTIONABLE_VERDICTS.has(i.overallVerdict));
  if (anyActionable) return false; // actionable verdicts may legitimately carry trade language
  return CONTRADICTION_RES.some((re) => re.test(text));
}

/** Safe deterministic answer when the recommendation engine is unavailable. */
export function buildRecommendationUnavailableAnswer(): {
  headline: string;
  answer: string;
  keyPoints: string[];
  riskNote: string;
} {
  return {
    headline: "Trade recommendations are temporarily unavailable.",
    answer:
      "The deterministic recommendation engine could not be reached, so no trade recommendation was generated. Nothing was invented in its place — please try again shortly, or use the Scanner and Opportunity Radar for current setups.",
    keyPoints: [
      "No recommendation was fabricated while the engine is unavailable.",
      "The Scanner and Opportunity Radar remain available for setup research.",
    ],
    riskNote: "AI-generated research, not investment advice.",
  };
}
