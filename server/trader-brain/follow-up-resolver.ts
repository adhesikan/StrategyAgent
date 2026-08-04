// TraderBrain — Follow-up Resolver (Sprint 5.2).
//
// Detects follow-up questions and resolves them against conversation memory.
// Pure functions — no I/O, no side-effects, no state.
//
// The resolver answers three questions:
//   1. Is this a reset?   → caller clears memory and starts fresh.
//   2. Is this a follow-up? → caller enriches the Brain request from memory.
//   3. Is it a fresh question? → caller proceeds normally.
//
// NEVER fabricates trade data. Only carries forward what was already produced
// by the deterministic engine in a prior turn.

import type { ConversationMemory } from "./conversation-memory";
import type { NormalizedBrainRequest, BrainPortfolioConstraints } from "./types";

// ---------------------------------------------------------------------------
// Reset detection
// ---------------------------------------------------------------------------

const RESET_RE =
  /\b(?:start\s+over|new\s+search|new\s+question|fresh\s+start|clear\s+(?:context|memory|history|results?)|ignore\s+(?:previous|prior|last|my\s+last)\s+(?:search|results?|context|question)|reset(?:\s+context)?|forget\s+(?:that|previous|last|everything))\b/i;

/** Returns true when the user explicitly wants to start fresh. */
export function isExplicitReset(question: string): boolean {
  return RESET_RE.test(question);
}

// ---------------------------------------------------------------------------
// Follow-up type classification
// ---------------------------------------------------------------------------

export type FollowUpKind =
  | "ordinal_reference"      // "show me the second one", "the third candidate"
  | "options_pivot"          // "what about options", "show options version"
  | "risk_refinement"        // "make it lower risk", "less risky", "more conservative"
  | "income_filter"          // "show only income ideas", "income version"
  | "exclusion_refinement"   // "remove earnings risk", "avoid tech"
  | "account_context"        // "use my account", "with my account"
  | "tone_refinement"        // "show conservative ideas", "more aggressive"
  | "exclusion_inquiry"      // "why wasn't NVDA included", "where is AAPL"
  | "direction_flip"         // "show bearish version", "what about bearish"
  | "symbol_reference"       // "what about that first stock", "use that symbol"
  | "count_refinement"       // "show me 5 more", "just 3 ideas"
  | "none";                  // not a follow-up

const ORDINAL_RE =
  /\b(?:show\s+me\s+|give\s+me\s+|what(?:'s|\s+is)\s+|tell\s+me\s+about\s+)?(?:the\s+)?(?:first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|top|best)(?:\s+one|\s+option|\s+idea|\s+trade|\s+candidate|\s+result|\s+pick)?\b/i;

const OPTIONS_PIVOT_RE =
  /\b(?:what\s+about\s+options?|show\s+(?:me\s+)?options?\s+(?:version|trade|ideas?|for\s+(?:that|those|them))?|options?\s+version|use\s+options?|options?\s+only|options?\s+trade\s+instead|can\s+i\s+do\s+options?)\b/i;

const RISK_REFINE_RE =
  /\b(?:(?:make\s+it|more|be\s+more|something\s+more)\s+(?:lower[- ]risk|less\s+risky|conservative|cautious|safe|safer)|lower\s+(?:the\s+)?risk|reduce\s+(?:the\s+)?risk|less\s+risk(?:y)?|smaller\s+(?:position|risk|size))\b/i;

const INCOME_FILTER_RE =
  /\b(?:show\s+(?:me\s+)?(?:only\s+)?income|income\s+(?:only|version|ideas?|ones?|trades?)|income[- ]generating|premium[- ]collecting|only\s+income)\b/i;

const EXCLUSION_REFINE_RE =
  /\b(?:remove|exclude|without|no\s+more|avoid|skip|filter\s+out)\s+(?:earnings?|the\s+)?(?:risk|stocks?|sector|exposure|ones?|tech|semis?|energy|finance|biotech|pharma)?\b/i;

const ACCOUNT_CONTEXT_RE =
  /\b(?:use\s+my\s+(?:account|portfolio|positions?|holdings?|balance)|with\s+my\s+(?:account|portfolio)|apply\s+(?:to\s+)?my\s+(?:account|portfolio)|factor\s+in\s+my\s+(?:account|portfolio))\b/i;

const CONSERVATIVE_RE =
  /\b(?:show\s+(?:me\s+)?(?:more\s+)?conservative|more\s+conservative|conservative\s+(?:ones?|ideas?|trades?|version)|lower\s+(?:beta|volatility))\b/i;

const AGGRESSIVE_RE =
  /\b(?:show\s+(?:me\s+)?(?:more\s+)?aggressive|more\s+aggressive|aggressive\s+(?:ones?|ideas?|trades?|version)|higher\s+(?:risk|beta|conviction)|riskier|more\s+risk)\b/i;

const EXCLUSION_INQUIRY_RE =
  /\b(?:why\s+(?:wasn't|was\s+not|isn't|is\s+not|didn't|did\s+not)\s+(?:\$?[A-Z]{1,5})\s+(?:included|shown|there|listed)|where\s+is\s+(?:\$?[A-Z]{1,5})|why\s+no\s+(?:\$?[A-Z]{1,5}))\b/i;

const DIRECTION_FLIP_RE =
  /\b(?:show\s+(?:me\s+)?(?:the\s+)?bearish|what\s+about\s+(?:the\s+)?bearish|bearish\s+version|show\s+(?:me\s+)?(?:the\s+)?bullish|what\s+about\s+(?:the\s+)?bullish|bullish\s+version|flip\s+(?:to\s+)?(?:bearish|bullish))\b/i;

const COUNT_REFINE_RE =
  /\b(?:show\s+(?:me\s+)?(?:just\s+)?(\d+)(?:\s+more|\s+ideas?|\s+trades?|\s+candidates?)|give\s+me\s+(?:just\s+)?(\d+)(?:\s+more)?|(?:just\s+)?(\d+)\s+(?:ideas?|picks?|trades?)|more\s+ideas?|more\s+results?|more\s+candidates?)\b/i;

// Short/ambiguous follow-ups that only make sense with prior context
const IMPLICIT_FOLLOWUP_RE =
  /^(?:what\s+about\s+(?:the\s+)?(?:next|others?|rest)|(?:show\s+(?:me\s+)?)?(?:the\s+)?(?:next|others?|rest)(?:\s+ones?|\s+ideas?|\s+trades?)?|(?:and\s+)?(?:the\s+)?(?:second|third|fourth|next)\s+one|any\s+(?:more|others?)|what\s+else|show\s+(?:me\s+)?(?:more|the\s+rest)|more\s+like\s+(?:that|this|these)|similar\s+(?:trades?|ideas?|ones?))$/i;

/** Classify what kind of follow-up this question is. */
export function classifyFollowUp(question: string, hasMemory: boolean): FollowUpKind {
  if (!hasMemory) return "none";
  const q = question.trim();

  if (ORDINAL_RE.test(q)) return "ordinal_reference";
  if (IMPLICIT_FOLLOWUP_RE.test(q)) return "ordinal_reference";
  if (OPTIONS_PIVOT_RE.test(q)) return "options_pivot";
  if (RISK_REFINE_RE.test(q)) return "risk_refinement";
  if (INCOME_FILTER_RE.test(q)) return "income_filter";
  if (EXCLUSION_INQUIRY_RE.test(q)) return "exclusion_inquiry";
  if (EXCLUSION_REFINE_RE.test(q)) return "exclusion_refinement";
  if (ACCOUNT_CONTEXT_RE.test(q)) return "account_context";
  if (CONSERVATIVE_RE.test(q)) return "tone_refinement";
  if (AGGRESSIVE_RE.test(q)) return "tone_refinement";
  if (DIRECTION_FLIP_RE.test(q)) return "direction_flip";
  if (COUNT_REFINE_RE.test(q)) return "count_refinement";

  return "none";
}

// ---------------------------------------------------------------------------
// Resolution result
// ---------------------------------------------------------------------------

export interface ResolvedFollowUp {
  /** "none" when the question is not a follow-up. */
  kind: FollowUpKind;
  /** True when memory was used to enrich the request. */
  contextHit: boolean;
  /**
   * Merged overrides to apply on top of the freshly-normalized request.
   * Empty when kind is "none" or when memory has no relevant data.
   */
  overrides: Partial<NormalizedBrainRequest>;
  /**
   * Human-readable note to surface to the user (§5).
   * null when kind is "none" or there is nothing meaningful to note.
   */
  contextNote: string | null;
  /**
   * For "ordinal_reference": the specific candidate resolved, if available.
   * null otherwise.
   */
  resolvedCandidate: Record<string, unknown> | null;
  /**
   * For "exclusion_inquiry": the symbol the user is asking about.
   * null otherwise.
   */
  inquiredSymbol: string | null;
}

// ---------------------------------------------------------------------------
// Ordinal parsing
// ---------------------------------------------------------------------------

const ORDINAL_MAP: Record<string, number> = {
  first: 0, "1st": 0,
  second: 1, "2nd": 1,
  third: 2, "3rd": 2,
  fourth: 3, "4th": 3,
  fifth: 4, "5th": 4,
  top: 0, best: 0,
};

function parseOrdinalIndex(question: string): number {
  const lower = question.toLowerCase();
  for (const [word, idx] of Object.entries(ORDINAL_MAP)) {
    if (lower.includes(word)) return idx;
  }
  return 0; // default: first
}

// ---------------------------------------------------------------------------
// Direction flip parsing
// ---------------------------------------------------------------------------

function parseDirectionFlip(question: string): "bullish" | "bearish" | null {
  const lower = question.toLowerCase();
  if (/bearish/.test(lower)) return "bearish";
  if (/bullish/.test(lower)) return "bullish";
  return null;
}

// ---------------------------------------------------------------------------
// Exclusion inquiry symbol extraction
// ---------------------------------------------------------------------------

const TICKER_RE = /\b\$?([A-Z]{1,5})\b/g;

// Matches only sequences that are ALREADY all-uppercase in the original string
// (i.e. explicit ticker symbols like NVDA, AAPL — not sentence-start words).
const UPPERCASE_TICKER_RE = /\$([A-Z]{2,5})\b|\b([A-Z]{2,5})\b/g;

function extractInquiredSymbol(question: string): string | null {
  // Search the ORIGINAL question (not uppercased) so common English words
  // that happen to be short (e.g. "WHY", "WAS") are never matched.
  const matches = [...question.matchAll(UPPERCASE_TICKER_RE)];
  // Pick the first all-caps token (group 1 if $-prefixed, else group 2)
  for (const m of matches) {
    const sym = m[1] ?? m[2];
    if (sym) return sym;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Context note builder
// ---------------------------------------------------------------------------

function buildContextNote(mem: ConversationMemory, kind: FollowUpKind): string | null {
  const parts: string[] = [];

  // What was the previous search about?
  if (mem.lastIntent === "RANK_MARKET_TRADES" && mem.lastSearch) {
    const count = mem.lastSearch.candidates?.length ?? 0;
    const dir = mem.lastMarketDirection;
    const obj = mem.lastObjective;
    parts.push(
      `Using your previous ${dir ? `${dir} ` : ""}trade search${obj === "income" ? " (income focus)" : ""}${count > 0 ? ` with ${count} candidate${count === 1 ? "" : "s"}` : ""}`,
    );
  } else if (mem.lastIntent === "PLAN_PORTFOLIO_TRADE" && mem.lastPortfolioTradePlan) {
    const budget = mem.lastRiskBudget;
    if (budget?.dollars) {
      parts.push(`Using your previous trade plan with a $${budget.dollars.toLocaleString("en-US")} risk limit`);
    } else if (budget?.percent) {
      parts.push(`Using your previous trade plan with a ${budget.percent}% portfolio risk limit`);
    } else {
      parts.push("Using your previous portfolio-constrained trade plan");
    }
  } else if (mem.lastIntent === "RECOMMEND_SYMBOL_TRADE" && mem.lastAnalyzedSymbol) {
    parts.push(`Using your previous ${mem.lastAnalyzedSymbol} recommendation`);
  } else if (mem.lastAnalyzedSymbol) {
    parts.push(`Using your previous analysis of ${mem.lastAnalyzedSymbol}`);
  }

  // Refinement hint
  if (kind === "options_pivot") parts.push("filtering for options trades");
  if (kind === "risk_refinement") parts.push("with lower risk parameters");
  if (kind === "income_filter") parts.push("filtering for income strategies");
  if (kind === "tone_refinement") parts.push("adjusting trade aggressiveness");
  if (kind === "direction_flip") {
    const dir = mem.lastMarketDirection;
    parts.push(dir ? `switching direction from ${dir}` : "switching market direction");
  }

  if (parts.length === 0) return null;
  return parts.join(", ") + ".";
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a question against conversation memory.
 *
 * Returns a ResolvedFollowUp describing:
 *   - What kind of follow-up this is (or "none")
 *   - Overrides to merge into the NormalizedBrainRequest
 *   - A user-facing context note (spec §5)
 *   - Any resolved candidate or symbol
 *
 * The caller is responsible for applying overrides and displaying contextNote.
 */
export function resolveFollowUp(
  question: string,
  mem: ConversationMemory,
): ResolvedFollowUp {
  const noMemory = !mem.lastIntent;

  const base: ResolvedFollowUp = {
    kind: "none",
    contextHit: false,
    overrides: {},
    contextNote: null,
    resolvedCandidate: null,
    inquiredSymbol: null,
  };

  const kind = classifyFollowUp(question, !noMemory);
  if (kind === "none") return base;

  const overrides: Partial<NormalizedBrainRequest> = {};
  let contextHit = false;
  let resolvedCandidate: Record<string, unknown> | null = null;
  let inquiredSymbol: string | null = null;

  // Carry forward the most recent goal parameters
  const lastReq = mem.lastNormalizedRequest;

  switch (kind) {
    case "ordinal_reference": {
      const idx = parseOrdinalIndex(question);
      const candidates = mem.lastRankedCandidates;
      if (candidates.length > 0) {
        resolvedCandidate = (candidates[idx] ?? candidates[0]) as Record<string, unknown>;
        contextHit = true;
      }
      // Carry forward all prior goal parameters
      if (lastReq) {
        if (lastReq.direction) overrides.direction = lastReq.direction;
        if (lastReq.objective) overrides.objective = lastReq.objective;
        if (lastReq.maxRiskDollars) overrides.maxRiskDollars = lastReq.maxRiskDollars;
        if (lastReq.maxRiskPercent) overrides.maxRiskPercent = lastReq.maxRiskPercent;
        if (lastReq.portfolioConstraints) overrides.portfolioConstraints = lastReq.portfolioConstraints;
      }
      break;
    }

    case "options_pivot": {
      overrides.instrumentPreference = "options";
      contextHit = true;
      // Carry prior direction + risk
      if (lastReq?.direction) overrides.direction = lastReq.direction;
      if (lastReq?.maxRiskDollars) overrides.maxRiskDollars = lastReq.maxRiskDollars;
      if (lastReq?.maxRiskPercent) overrides.maxRiskPercent = lastReq.maxRiskPercent;
      if (lastReq?.portfolioConstraints) overrides.portfolioConstraints = lastReq.portfolioConstraints;
      break;
    }

    case "risk_refinement": {
      // Lower the risk: if there's a dollar budget, reduce it by 30%; otherwise flag conservative
      const budget = mem.lastRiskBudget;
      if (budget?.dollars) {
        overrides.maxRiskDollars = Math.round(budget.dollars * 0.7);
        contextHit = true;
      } else if (budget?.percent) {
        overrides.maxRiskPercent = Math.max(0.5, +(budget.percent * 0.7).toFixed(1));
        contextHit = true;
      }
      if (lastReq?.direction) overrides.direction = lastReq.direction;
      if (lastReq?.instrumentPreference) overrides.instrumentPreference = lastReq.instrumentPreference;
      if (lastReq?.portfolioConstraints) overrides.portfolioConstraints = lastReq.portfolioConstraints;
      break;
    }

    case "income_filter": {
      overrides.objective = "income";
      overrides.instrumentPreference = "options"; // income strategies are typically options-based
      contextHit = true;
      if (lastReq?.maxRiskDollars) overrides.maxRiskDollars = lastReq.maxRiskDollars;
      if (lastReq?.maxRiskPercent) overrides.maxRiskPercent = lastReq.maxRiskPercent;
      if (lastReq?.portfolioConstraints) overrides.portfolioConstraints = lastReq.portfolioConstraints;
      break;
    }

    case "exclusion_refinement": {
      // Carry existing constraints; caller will re-run the search
      if (lastReq) {
        if (lastReq.direction) overrides.direction = lastReq.direction;
        if (lastReq.maxRiskDollars) overrides.maxRiskDollars = lastReq.maxRiskDollars;
        if (lastReq.maxRiskPercent) overrides.maxRiskPercent = lastReq.maxRiskPercent;
        if (lastReq.portfolioConstraints) overrides.portfolioConstraints = lastReq.portfolioConstraints;
      }
      contextHit = true;
      break;
    }

    case "account_context": {
      // The portfolio token is assembled in ask.ts; here we signal that
      // portfolio context should be attached (broker accounts + positions).
      // We use the existing portfolioConstraints or require_existing_position.
      const existingFilters = mem.lastPortfolioFilters;
      overrides.portfolioConstraints = existingFilters ?? { kind: "require_existing_position", requireExistingPosition: true };
      if (lastReq?.direction) overrides.direction = lastReq.direction;
      if (lastReq?.maxRiskDollars) overrides.maxRiskDollars = lastReq.maxRiskDollars;
      contextHit = true;
      break;
    }

    case "tone_refinement": {
      const lower = question.toLowerCase();
      const isConservative = /conservati|lower\s+risk|safer|cautious|less\s+risk/.test(lower);
      if (isConservative) {
        // For stocks/equities, conservative means smaller position or lower beta
        if (lastReq?.maxRiskDollars) overrides.maxRiskDollars = Math.round(lastReq.maxRiskDollars * 0.6);
        else if (lastReq?.maxRiskPercent) overrides.maxRiskPercent = Math.max(0.5, +(lastReq.maxRiskPercent * 0.6).toFixed(1));
      } else {
        // Aggressive: widen the risk budget slightly
        if (lastReq?.maxRiskDollars) overrides.maxRiskDollars = Math.round(lastReq.maxRiskDollars * 1.4);
        else if (lastReq?.maxRiskPercent) overrides.maxRiskPercent = +(Math.min(10, lastReq.maxRiskPercent! * 1.4)).toFixed(1);
      }
      if (lastReq?.direction) overrides.direction = lastReq.direction;
      if (lastReq?.instrumentPreference) overrides.instrumentPreference = lastReq.instrumentPreference;
      if (lastReq?.portfolioConstraints) overrides.portfolioConstraints = lastReq.portfolioConstraints;
      contextHit = true;
      break;
    }

    case "exclusion_inquiry": {
      // Return the symbol the user is asking about; the response builder can
      // reference lastRejectedReasons / lastUnavailableReasons to explain it.
      inquiredSymbol = extractInquiredSymbol(question);
      contextHit = inquiredSymbol != null;
      break;
    }

    case "direction_flip": {
      const dir = parseDirectionFlip(question);
      if (dir) {
        overrides.direction = dir;
        contextHit = true;
      }
      if (lastReq?.instrumentPreference) overrides.instrumentPreference = lastReq.instrumentPreference;
      if (lastReq?.maxRiskDollars) overrides.maxRiskDollars = lastReq.maxRiskDollars;
      if (lastReq?.maxRiskPercent) overrides.maxRiskPercent = lastReq.maxRiskPercent;
      if (lastReq?.portfolioConstraints) overrides.portfolioConstraints = lastReq.portfolioConstraints;
      break;
    }

    case "count_refinement": {
      const countMatch = question.match(/(\d+)/);
      if (countMatch) {
        overrides.numberOfIdeas = Math.min(10, Math.max(1, parseInt(countMatch[1], 10)));
      }
      if (lastReq?.direction) overrides.direction = lastReq.direction;
      if (lastReq?.objective) overrides.objective = lastReq.objective;
      if (lastReq?.maxRiskDollars) overrides.maxRiskDollars = lastReq.maxRiskDollars;
      if (lastReq?.portfolioConstraints) overrides.portfolioConstraints = lastReq.portfolioConstraints;
      contextHit = !!lastReq;
      break;
    }
  }

  const contextNote = contextHit ? buildContextNote(mem, kind) : null;

  return {
    kind,
    contextHit,
    overrides,
    contextNote,
    resolvedCandidate,
    inquiredSymbol,
  };
}

// ---------------------------------------------------------------------------
// Apply overrides to a NormalizedBrainRequest
// ---------------------------------------------------------------------------

/**
 * Merge resolver overrides into a NormalizedBrainRequest.
 * The caller must pass the freshly-produced request from normalizeBrainRequest();
 * this function only adds/replaces fields that were explicitly set by the resolver.
 */
export function applyFollowUpOverrides(
  req: NormalizedBrainRequest,
  overrides: Partial<NormalizedBrainRequest>,
): NormalizedBrainRequest {
  return { ...req, ...overrides };
}
