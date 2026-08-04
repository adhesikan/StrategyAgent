// Deterministic market-wide ranked trade search (MCP rank_market_trade_candidates).
//
// This module owns:
//   1. ROUTING — deciding that a question is a market-wide trade search
//      (no validated symbol) rather than symbol analysis, a single-symbol
//      recommendation, or education. Reuses the central trade-goal
//      normalization so false-ticker protections (UNDER/MAX/LOSS/STOCK/RISK…)
//      are never re-implemented or regressed here.
//   2. INVOCATION — one MCP call per request, model-safe arguments only.
//      OpenAI never selects symbols before the call and never overrides the
//      returned buckets or verdicts.
//   3. DEFENSIVE VALIDATION — the raw MCP payload is normalized into a
//      strict, size-capped shape before it reaches the LLM or the client.
//      Unknown keys are dropped; sensitive-looking keys are always dropped.
//   4. DETERMINISTIC PRESENTATION — headline + server-generated summary
//      built from the validated buckets. Used verbatim when the LLM is
//      unavailable, and the headline always wins over LLM output.
//
// Count semantics (important): reviewedCount is the number of RAW STORED
// OPPORTUNITIES reviewed; qualified/watch/rejected/unavailable count
// POST-CONFLUENCE candidates. The buckets may therefore NOT sum to
// reviewedCount — never present them as the same population.

import {
  classifyTradeRequest,
  normalizeTradeGoal,
  type TradeGoal,
} from "../mcp/strategy-recommendation";
import type { RankMarketTradeCandidatesArgs } from "../mcp/tools";

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** Broad-search phrasings the recommendation classifier alone can miss. */
const BROAD_SEARCH_RE =
  /\b(best\s+trades?|top\s+trades?|trades?\s+worth\s+watching|what\s+should\s+i\s+trade|(?:income|trade|trading)\s+opportunit(?:y|ies))\b/;

/**
 * Returns the normalized market-wide trade goal when this question should
 * route to rank_market_trade_candidates, else null.
 *
 * Rules (spec §2):
 *  - Trade-seeking ask WITHOUT a validated symbol → market-wide ranking.
 *  - A validated symbol keeps the single-symbol recommendation flow.
 *  - Analysis ("Analyze BA"), education ("what is a credit spread"), and
 *    mixed education/analysis intents keep their existing flows.
 */
export function classifyRankedTradeSearch(question: string, tickers: string[] = []): TradeGoal | null {
  const intent = classifyTradeRequest(question, tickers);
  if (intent) {
    if (intent.kind !== "recommendation") return null; // education/combined keep existing flows
    if (intent.goal.symbol) return null; // symbol-specific → recommend_trade_strategy
    return intent.goal;
  }
  // Supplemental broad phrasings ("Show trades worth watching") — still only
  // when no validated symbol survived the central false-ticker protections.
  const lower = String(question ?? "").toLowerCase();
  if (BROAD_SEARCH_RE.test(lower)) {
    // Same central normalization — false-ticker protections and the explicit
    // "$SYM"/"ticker X" exception are never re-implemented here.
    const goal = normalizeTradeGoal(question, tickers);
    if (!goal.symbol) return goal;
  }
  return null;
}

/** Map a normalized TradeGoal onto model-safe ranking arguments ONLY. */
export function rankedGoalToMcpArgs(goal: TradeGoal): RankMarketTradeCandidatesArgs {
  const args: RankMarketTradeCandidatesArgs = {};
  if (goal.direction) args.direction = goal.direction;
  if (goal.instrumentPreference) args.instrumentPreference = goal.instrumentPreference;
  if (goal.objective) args.objective = goal.objective as RankMarketTradeCandidatesArgs["objective"];
  if (goal.requestedStrategy && goal.requestedStrategy !== "credit_spread") {
    args.requestedStrategy = goal.requestedStrategy as RankMarketTradeCandidatesArgs["requestedStrategy"];
  } else if (goal.requestedStrategy === "credit_spread") {
    args.requestedStrategy = goal.direction === "bearish" ? "bear_call_credit_spread" : "bull_put_credit_spread";
  }
  if (typeof goal.maxRiskDollars === "number") args.maxRiskDollars = goal.maxRiskDollars;
  if (typeof goal.maxRiskPercent === "number") args.maxRiskPercent = goal.maxRiskPercent;
  if (typeof goal.accountSize === "number") args.accountSize = goal.accountSize;
  args.numberOfIdeas = typeof goal.numberOfIdeas === "number" ? goal.numberOfIdeas : 1;
  // NEVER: symbol pre-selection, userId, accountId, connectionId, broker
  // tokens, API keys, or credentials of any kind.
  return args;
}

// ---------------------------------------------------------------------------
// Defensive validation of the MCP payload
// ---------------------------------------------------------------------------

/** Keys that must never pass through, wherever they appear. */
const SENSITIVE_KEY_RE = /token|secret|credential|password|apikey|api_key|authorization|cookie|session|userid|user_id|accountid|account_id|connectionid|connection_id/i;

const SYMBOL_RE = /^[A-Z][A-Z0-9.\-\/]{0,9}$/;

function str(v: unknown, max = 400): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function count(v: unknown): number {
  const n = num(v);
  return n != null && n >= 0 ? Math.floor(n) : 0;
}

function strArray(v: unknown, maxItems = 12, maxLen = 400): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim()).slice(0, maxItems).map((x) => String(x).trim().slice(0, maxLen));
}

function cleanSym(v: unknown): string | undefined {
  const s = str(v, 12)?.toUpperCase();
  return s && SYMBOL_RE.test(s) ? s : undefined;
}

export interface RankedTradeCandidate {
  rank: number;
  symbol: string;
  strategy?: string;
  setupStatus?: string;
  instrument?: string;
  structure?: string;
  trigger?: string;
  invalidation?: string;
  objective?: string;
  rewardRisk?: number;
  maxRisk?: number;
  /** true only when maxRisk derives from live, real contract/stop data. */
  maxRiskIsExact?: boolean;
  quantity?: number;
  confidence?: string;
  dataQuality?: string;
  fitsRiskBudget?: boolean;
  whySelected: string[];
  warnings: string[];
}

export interface RankedWatchCandidate {
  symbol: string;
  strategy?: string;
  currentStage?: string;
  missingConfirmation?: string;
  watchConditions: string[];
}

export interface RankedRejectionGroup {
  reason: string;
  count: number;
  symbols: string[];
}

/** Pre-confluence exclusion — happens BEFORE bucket assignment.
 *  Not a quality rejection; an excluded opportunity never reached qualification. */
export interface RankedExclusionGroup {
  reason: string;
  count: number;
}

export interface RankedTradeSearch {
  request: Record<string, unknown>;
  /** RAW STORED OPPORTUNITIES reviewed — not the post-confluence population. */
  reviewedCount: number;
  /** Confluence groups formed from stored opportunities (0 = nothing passed pre-qualification). */
  groupedCandidateCount?: number;
  qualifiedCount: number;
  watchCount: number;
  rejectedCount: number;
  unavailableCount: number;
  /** Opportunities excluded BEFORE confluence/qualification — not the same as rejection. */
  excludedCount?: number;
  /** Breakdown of why opportunities were excluded before qualification. */
  exclusionSummary?: RankedExclusionGroup[];
  candidates: RankedTradeCandidate[];
  watchCandidates: RankedWatchCandidate[];
  rejectionSummary: RankedRejectionGroup[];
  generatedAt: string;
  warnings: string[];
  /** Echo of the parsed risk budget so the UI can present fit honestly. */
  maxRiskDollars?: number;
}

function pickStr(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = str(o[k]);
    if (v !== undefined) return v;
  }
  return undefined;
}

function pickNum(o: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = num(o[k]);
    if (v !== undefined) return v;
  }
  return undefined;
}

function sanitizeCandidate(raw: unknown, index: number): RankedTradeCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const symbol = cleanSym(o.symbol ?? o.ticker);
  if (!symbol) return null; // a candidate with no valid symbol is unusable
  const rank = num(o.rank);
  // Data quality / structure fields — optional, rendered only when supplied.
  const instrument = pickStr(o, "instrument", "instrumentType", "recommendedInstrument");
  const structure = pickStr(o, "structure", "recommendedStructure", "strategyStructure");
  const dataQuality = pickStr(o, "dataQuality", "data_quality", "dataSource");
  const maxRisk = pickNum(o, "maxRisk", "maxRiskDollars", "maxLoss");
  // Exact-risk claims are permitted only for live/real data — estimated
  // candidates must never claim exact premium-derived risk (spec §8).
  const liveish = typeof dataQuality === "string" && /\b(live|real)\b/i.test(dataQuality) && !/estimat|partial|mock|stale/i.test(dataQuality);
  const fits = typeof o.fitsRiskBudget === "boolean" ? o.fitsRiskBudget : typeof o.fitsRiskLimit === "boolean" ? (o.fitsRiskLimit as boolean) : undefined;
  return {
    rank: rank != null && rank >= 1 ? Math.floor(rank) : index + 1,
    symbol,
    strategy: pickStr(o, "strategy", "strategyName"),
    setupStatus: pickStr(o, "setupStatus", "setup_status", "status"),
    ...(instrument ? { instrument } : {}),
    ...(structure ? { structure } : {}),
    trigger: pickStr(o, "trigger", "entryTrigger"),
    invalidation: pickStr(o, "invalidation", "stop", "invalidationLevel"),
    objective: pickStr(o, "objective", "target", "technicalObjective"),
    rewardRisk: pickNum(o, "rewardRisk", "rewardRiskRatio", "rr"),
    ...(maxRisk != null ? { maxRisk, maxRiskIsExact: liveish } : {}),
    quantity: pickNum(o, "quantity", "suggestedQuantity", "shares", "contracts"),
    confidence: pickStr(o, "confidence"),
    ...(dataQuality ? { dataQuality } : {}),
    ...(fits !== undefined ? { fitsRiskBudget: fits } : {}),
    whySelected: strArray(o.whySelected ?? o.reasons ?? o.rankReasons),
    warnings: strArray(o.warnings),
    // §5 — Strategy Score: raw scanner score, distinct from rank.
    // Multiple key aliases for forward-compat with MCP response variants.
    ...(() => {
      const s = pickNum(o, "strategyScore", "scannerScore", "patternScore", "score");
      return s != null && s >= 0 ? { strategyScore: Math.round(s) } : {};
    })(),
    // §3 — Current price: enables triggerStatusLabel to determine whether
    // the trigger has already been crossed. Present only when supplied by MCP.
    ...(() => {
      const p = pickNum(o, "currentPrice", "lastPrice", "price");
      return p != null && p > 0 ? { currentPrice: p } : {};
    })(),
    // §3 — Trigger type: "event" for session-based triggers (ORB, gap-up)
    // that require event confirmation rather than a price breakout.
    ...(() => {
      const t = pickStr(o, "triggerType", "trigger_type");
      return t === "price" || t === "event" ? { triggerType: t as "price" | "event" } : {};
    })(),
  };
}

function sanitizeWatch(raw: unknown): RankedWatchCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const symbol = cleanSym(o.symbol ?? o.ticker);
  if (!symbol) return null;
  return {
    symbol,
    strategy: pickStr(o, "strategy", "strategyName"),
    currentStage: pickStr(o, "currentStage", "stage", "setupStage"),
    missingConfirmation: pickStr(o, "missingConfirmation", "missing", "blockedBy"),
    watchConditions: strArray(o.watchConditions ?? o.conditions ?? o.watchFor),
  };
}

function sanitizeRejection(raw: unknown): RankedRejectionGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const reason = pickStr(o, "reason", "category", "rejectionReason");
  if (!reason) return null;
  const symbols = strArray(o.symbols, 25, 12).map((s) => s.toUpperCase()).filter((s) => SYMBOL_RE.test(s));
  const c = num(o.count);
  return { reason, count: c != null && c >= 0 ? Math.floor(c) : symbols.length, symbols };
}

function sanitizeExclusionSummary(raw: unknown): RankedExclusionGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 20)
    .map((e): RankedExclusionGroup | null => {
      if (!e || typeof e !== "object") return null;
      const o = e as Record<string, unknown>;
      const reason = str(o.reason ?? o.category, 120);
      if (!reason) return null;
      const c = num(o.count);
      return { reason, count: c != null && c >= 0 ? Math.floor(c) : 0 };
    })
    .filter((e): e is RankedExclusionGroup => e !== null);
}

/** Model-safe echo of the request the MCP service acted on. */
function sanitizeRequest(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 120);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[k] = strArray(v, 20, 60);
  }
  return out;
}

/**
 * Defensive normalization of the raw MCP payload. Throws on shapes that are
 * not credibly the ranking contract (so the caller falls back honestly) and
 * silently drops malformed entries inside otherwise-valid arrays.
 */
export function validateRankedTradeSearch(raw: unknown, goal?: TradeGoal): RankedTradeSearch {
  // Tool results may arrive as MCP content blocks; unwrap {content:[{text}]}.
  let payload: unknown = raw;
  if (payload && typeof payload === "object" && Array.isArray((payload as any).content)) {
    const text = (payload as any).content.find((c: any) => c?.type === "text" && typeof c.text === "string")?.text;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error("rank_market_trade_candidates returned non-JSON content");
      }
    }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("rank_market_trade_candidates returned an invalid payload");
  }
  const o = payload as Record<string, unknown>;
  if (!("reviewedCount" in o) || !("candidates" in o)) {
    throw new Error("rank_market_trade_candidates payload is missing required fields");
  }
  const candidates = (Array.isArray(o.candidates) ? o.candidates : [])
    .slice(0, 10)
    .map((c, i) => sanitizeCandidate(c, i))
    .filter((c): c is RankedTradeCandidate => c !== null);
  const watchCandidates = (Array.isArray(o.watchCandidates) ? o.watchCandidates : [])
    .slice(0, 10)
    .map(sanitizeWatch)
    .filter((c): c is RankedWatchCandidate => c !== null);
  const rejectionSummary = (Array.isArray(o.rejectionSummary) ? o.rejectionSummary : [])
    .slice(0, 12)
    .map(sanitizeRejection)
    .filter((g): g is RankedRejectionGroup => g !== null);
  const groupedRaw = num(o.groupedCandidateCount);
  const excludedRaw = num(o.excludedCount);
  return {
    request: sanitizeRequest(o.request),
    reviewedCount: count(o.reviewedCount),
    ...(groupedRaw != null ? { groupedCandidateCount: Math.max(0, Math.floor(groupedRaw)) } : {}),
    qualifiedCount: count(o.qualifiedCount),
    watchCount: count(o.watchCount),
    rejectedCount: count(o.rejectedCount),
    unavailableCount: count(o.unavailableCount),
    ...(excludedRaw != null ? { excludedCount: Math.max(0, Math.floor(excludedRaw)) } : {}),
    ...(Array.isArray(o.exclusionSummary) ? { exclusionSummary: sanitizeExclusionSummary(o.exclusionSummary) } : {}),
    candidates,
    watchCandidates,
    rejectionSummary,
    generatedAt: str(o.generatedAt, 40) ?? new Date().toISOString(),
    warnings: strArray(o.warnings),
    ...(typeof goal?.maxRiskDollars === "number" ? { maxRiskDollars: goal.maxRiskDollars } : {}),
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface RankedTradeSearchDeps {
  /** Wrapper around the rank_market_trade_candidates MCP tool. */
  rank: (args: RankMarketTradeCandidatesArgs) => Promise<unknown>;
}

/** One MCP call per request; validated defensively. Throws on failure. */
export async function runRankedTradeSearch(goal: TradeGoal, deps: RankedTradeSearchDeps): Promise<RankedTradeSearch> {
  const args = rankedGoalToMcpArgs(goal);
  const raw = await deps.rank(args);
  return validateRankedTradeSearch(raw, goal);
}

// ---------------------------------------------------------------------------
// Deterministic presentation (headline rules — spec §6, risk rules — §8)
// ---------------------------------------------------------------------------

const WORD_NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function wordCount(n: number): string {
  return n >= 0 && n <= 10 ? WORD_NUMBERS[n] : String(n);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function directionWord(goal?: TradeGoal): string {
  return goal?.direction ? `${goal.direction} ` : "";
}

/** Human-readable label for a known MCP exclusion reason code. */
export function translateExclusionReason(reason: string): string {
  switch (reason) {
    case "NOT_ACTIONABLE_NO_TRIGGER": return "No actionable trigger was available";
    case "STALE":                     return "Stored setup was stale";
    case "DIRECTION_MISMATCH":        return "Setup direction did not match the request";
    case "INVALID_SETUP":             return "Stored setup was not structurally valid";
    case "SIMULATED_DATA_NOT_ELIGIBLE": return "Only simulated data was available";
    default:
      // Humanize unknown/future codes conservatively — no invented meaning.
      // Lower-case first so title-casing works regardless of input case.
      return reason.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

/** Primary exclusion reason (highest count) from the summary, or undefined. */
function primaryExclusionReason(search: RankedTradeSearch): string | undefined {
  if (!search.exclusionSummary?.length) return undefined;
  return search.exclusionSummary.reduce((a, b) => b.count > a.count ? b : a).reason;
}

/** Headline for the "all excluded, no grouping" case. */
function exclusionHeadline(reason: string | undefined): string {
  switch (reason) {
    case "NOT_ACTIONABLE_NO_TRIGGER":
      return "Stored setups were reviewed, but none had an actionable entry trigger.";
    case "STALE":
      return "Stored setups were reviewed, but all were stale.";
    case "DIRECTION_MISMATCH":
      return "Stored setups were reviewed, but none matched the requested direction.";
    case "SIMULATED_DATA_NOT_ELIGIBLE":
      return "Stored setups were reviewed, but only simulated data was available.";
    case "INVALID_SETUP":
      return "Stored setups were reviewed, but none were structurally valid.";
    default:
      return "Stored setups were reviewed, but none formed actionable candidates.";
  }
}

/** True when all stored opportunities were excluded before confluence grouping. */
function allExcludedBeforeGrouping(search: RankedTradeSearch): boolean {
  return (
    (search.excludedCount ?? 0) > 0 &&
    (search.groupedCandidateCount ?? 0) === 0 &&
    search.candidates.length === 0 &&
    search.watchCandidates.length === 0 &&
    search.rejectedCount === 0 &&
    search.unavailableCount === 0
  );
}

/** Deterministic page headline. The LLM may never override this. */
export function rankedTradeSearchHeadline(search: RankedTradeSearch, goal?: TradeGoal): string {
  const q = search.candidates.length;
  const w = search.watchCandidates.length;
  const dir = directionWord(goal);
  if (q > 0 && w > 0) {
    return `${cap(wordCount(search.reviewedCount))} ${search.reviewedCount === 1 ? "opportunity was" : "opportunities were"} reviewed; ${wordCount(q)} qualified and ${wordCount(w)} ${w === 1 ? "is" : "are"} worth watching.`;
  }
  if (q > 0) {
    return `${cap(wordCount(q))} ${dir}trade ${q === 1 ? "candidate" : "candidates"} identified.`;
  }
  if (w > 0) {
    return `No trade candidates currently qualify, but ${wordCount(w)} ${w === 1 ? "setup is" : "setups are"} worth watching.`;
  }
  if (typeof search.maxRiskDollars === "number" && (search.rejectedCount > 0 || search.reviewedCount > 0)) {
    // Risk filtering was in play and nothing survived — say so explicitly
    // instead of a bare "no setup" (spec §8).
    return `No candidate met the $${search.maxRiskDollars.toLocaleString("en-US")} maximum-risk limit.`;
  }
  // Pre-confluence exclusion (no trigger, stale, etc.) — semantically distinct
  // from a quality rejection: the opportunities never reached qualification.
  if (allExcludedBeforeGrouping(search)) {
    return exclusionHeadline(primaryExclusionReason(search));
  }
  if (search.unavailableCount > 0 && search.rejectedCount === 0 && (search.excludedCount ?? 0) === 0) {
    return "Candidates could not be qualified because required data was unavailable.";
  }
  // Qualification ran but nothing passed — a genuine quality/risk verdict.
  if (search.rejectedCount > 0 || search.reviewedCount > 0) {
    return "Candidates were evaluated, but none currently qualify as trades.";
  }
  return `No qualifying ${dir}setups currently meet the criteria.`;
}

export interface RankedAnswer {
  headline: string;
  answer: string;
  keyPoints: string[];
  riskNote: string;
  confidence: "low" | "medium" | "high";
}

/**
 * Server-generated deterministic summary — the guaranteed-truthful fallback
 * used verbatim when the LLM is unavailable, and the count contract the LLM
 * must agree with when it does run.
 */
export function buildRankedTradeSearchAnswer(search: RankedTradeSearch, goal?: TradeGoal): RankedAnswer {
  const lines: string[] = [];
  // reviewedCount is RAW stored opportunities — never implied to be the
  // bucket population (buckets may not sum to it).
  // Count semantics block — never implies reviewed = post-confluence.
  const countLines = [
    `Stored opportunities reviewed: ${search.reviewedCount}`,
    ...(search.groupedCandidateCount !== undefined ? [`Post-confluence candidates: ${search.groupedCandidateCount}`] : []),
    `Qualified: ${search.qualifiedCount}`,
    `Worth watching: ${search.watchCount}`,
    `Rejected: ${search.rejectedCount}`,
    `Unavailable: ${search.unavailableCount}`,
    ...(search.excludedCount !== undefined ? [`Excluded before qualification: ${search.excludedCount}`] : []),
  ];
  lines.push(countLines.join(" · ") + ". (Stored opportunities are raw scanner records. Candidate buckets are formed after confluence and actionability checks.)");
  if (search.candidates.length > 0) {
    lines.push("Top trade candidates (deterministic ranking — order preserved):");
    for (const c of search.candidates) {
      const bits = [
        `${c.rank}. ${c.symbol}`,
        c.strategy,
        c.structure ?? c.instrument,
        c.trigger ? `trigger ${c.trigger}` : undefined,
        c.invalidation ? `invalidation ${c.invalidation}` : undefined,
        c.rewardRisk != null ? `R/R ${c.rewardRisk}` : undefined,
        c.maxRisk != null ? `${c.maxRiskIsExact ? "max risk" : "estimated max risk"} $${c.maxRisk.toLocaleString("en-US")}` : undefined,
        c.quantity != null ? `qty ${c.quantity}` : undefined,
      ].filter(Boolean);
      lines.push(`- ${bits.join(" — ")}`);
    }
  }
  if (search.watchCandidates.length > 0) {
    lines.push("Worth watching (not actionable yet — no trade should be placed):");
    for (const wc of search.watchCandidates) {
      const bits = [wc.symbol, wc.strategy, wc.currentStage ? `stage: ${wc.currentStage}` : undefined, wc.missingConfirmation ? `missing: ${wc.missingConfirmation}` : undefined].filter(Boolean);
      lines.push(`- ${bits.join(" — ")}`);
    }
  }
  if (search.exclusionSummary?.length) {
    // Exclusions are pre-confluence — they are NOT quality rejections.
    const parts = search.exclusionSummary.map((g) => `${translateExclusionReason(g.reason)} (${g.count})`).join("; ");
    lines.push(`Excluded before qualification: ${parts}. These were filtered out before any quality or risk assessment — they are not rejections.`);
  }
  if (search.rejectionSummary.length > 0) {
    const grouped = search.rejectionSummary.map((g) => `${g.reason} (${g.count})`).join(", ");
    lines.push(`Rejections by reason (post-confluence, quality/risk verdicts): ${grouped}.`);
  }
  if (typeof search.maxRiskDollars === "number") {
    lines.push(
      search.candidates.length > 0
        ? `Requested maximum risk: $${search.maxRiskDollars.toLocaleString("en-US")} — each candidate above shows its calculated risk and whether it fits.`
        : `No candidate met the $${search.maxRiskDollars.toLocaleString("en-US")} maximum-risk limit.`,
    );
  }
  if (search.unavailableCount > 0) {
    lines.push(`${search.unavailableCount} ${search.unavailableCount === 1 ? "setup" : "setups"} could not be evaluated because market data was unavailable.`);
  }
  if (search.warnings.length > 0) lines.push(`Warnings: ${search.warnings.join(" ")}`);

  const keyPoints = [
    `Stored opportunities reviewed: ${search.reviewedCount}`,
    ...(search.groupedCandidateCount !== undefined ? [`Post-confluence candidates: ${search.groupedCandidateCount}`] : []),
    `Qualified trade candidates: ${search.qualifiedCount}`,
    ...(search.excludedCount !== undefined && search.excludedCount > 0 ? [`Excluded before qualification: ${search.excludedCount}`] : []),
    ...(search.watchCount > 0 ? [`Worth watching: ${search.watchCount}`] : []),
    ...(search.rejectedCount > 0 ? [`Rejected (post-confluence): ${search.rejectedCount}`] : []),
    ...(search.unavailableCount > 0 ? [`Unavailable: ${search.unavailableCount}`] : []),
  ].slice(0, 6);

  const confidence: RankedAnswer["confidence"] =
    search.candidates.length > 0
      ? "medium"
      : (search.unavailableCount > 0 || (search.excludedCount ?? 0) > 0) && search.candidates.length === 0 && search.watchCandidates.length === 0
        ? "low"
        : "medium";

  return {
    headline: rankedTradeSearchHeadline(search, goal),
    answer: lines.join("\n"),
    keyPoints,
    riskNote: "Deterministic ranked research output — not investment advice. Nothing here places or prepares an order automatically.",
    confidence,
  };
}

/** Static, safe suggestions for the ranked-search response. */
export function rankedTradeSearchSuggestions(search: RankedTradeSearch): Array<{ label: string; href: string }> {
  // When all opportunities were excluded for missing triggers, direct the user
  // to scanner/watchlist flows — never to the Trade Builder (no candidate exists).
  const primaryExclusion = primaryExclusionReason(search);
  if (allExcludedBeforeGrouping(search) && primaryExclusion === "NOT_ACTIONABLE_NO_TRIGGER") {
    return [
      { label: "Open Scanner", href: "/scanner" },
      { label: "Review Watchlist", href: "/watchlist" },
      { label: "Run a Fresh Scan", href: "/scanner?run=1" },
      { label: "View Stored Setups", href: "/opportunities" },
    ];
  }
  const out: Array<{ label: string; href: string }> = [{ label: "Open Scanner", href: "/scanner" }];
  const first = search.candidates[0] ?? search.watchCandidates[0];
  if (first) out.unshift({ label: `Analyze ${first.symbol}`, href: `/ask?q=${encodeURIComponent(`Analyze ${first.symbol}`)}` });
  return out;
}
