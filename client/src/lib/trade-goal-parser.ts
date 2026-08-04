// Sprint 4.3 — Goal-Based Trade Planner: client-side goal parser.
//
// Pure functions only — no API calls, no server imports, no React.
// Mirrors a subset of server/mcp/strategy-recommendation.ts normalizeTradeGoal
// for display purposes only. The server is the authoritative source for all
// execution decisions; this module produces human-readable summaries and
// constraint phrases for the UI.
//
// Rules:
//   • Never fabricate opportunities — this module only parses intent.
//   • No profit guarantees — any output mentioning upside must be accompanied
//     by a risk disclosure (tradeGoalDisclaimer).
//   • "covered calls from my holdings" is a valid goal even without a broker;
//     show an honest advisory instead of silently failing.

import type { GoalModePrefs } from "@/components/goal-mode-shell";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TradeObjective =
  | "income"
  | "growth"
  | "capital_preservation"
  | "hedging"
  | "speculative"
  | "diversification";

export type TradeStrategy =
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

export type TradeDirection = "bullish" | "bearish" | "neutral" | "either";
export type InstrumentPreference = "stock" | "options" | "either";

/**
 * Client-side parsed representation of a natural-language trade goal.
 * Mirrors server/mcp/strategy-recommendation.ts TradeGoal for display only.
 * Never used to execute trades — passed back to the server as a query string.
 */
export interface TradeGoalIntent {
  /** Original user text. */
  rawGoal: string;
  // Parsed filters — undefined means "not specified in the query"
  objective?: TradeObjective;
  requestedStrategy?: TradeStrategy;
  direction?: TradeDirection;
  instrumentPreference?: InstrumentPreference;
  maxRiskDollars?: number;
  maxRiskPercent?: number;
  numberOfIdeas?: number;
  // Display outputs (always populated)
  /** Short one-liner, e.g. "Income opportunities — max $500 risk" */
  summary: string;
  /** Bullet phrases listing active constraints, e.g. ["Max $500 risk", "Covered calls"] */
  constraintPhrases: string[];
  /** Advisory warnings — honest about unknowns, never imply profit */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Strategy alias map (mirrors server normalizeTradeGoal strategy aliases)
// ---------------------------------------------------------------------------

const STRATEGY_ALIASES: Array<[RegExp, TradeStrategy]> = [
  [/covered[\s-]?call/i, "covered_call"],
  [/cash[\s-]?secured[\s-]?put|csp\b/i, "cash_secured_put"],
  [/bull[\s-]?put[\s-]?(?:credit[\s-]?)?spread/i, "bull_put_credit_spread"],
  [/bear[\s-]?call[\s-]?(?:credit[\s-]?)?spread/i, "bear_call_credit_spread"],
  [/call[\s-]?debit[\s-]?spread/i, "call_debit_spread"],
  [/put[\s-]?debit[\s-]?spread/i, "put_debit_spread"],
  [/credit[\s-]?spread/i, "credit_spread"],
  [/long[\s-]?call/i, "long_call"],
  [/long[\s-]?put/i, "long_put"],
  [/\b(stock|shares?|equity|equities)\b/i, "stock"],
];

/** Human-readable strategy label keyed by TradeStrategy. */
export const STRATEGY_LABEL: Record<TradeStrategy, string> = {
  stock:                    "Stock / Shares",
  long_call:                "Long Call",
  long_put:                 "Long Put",
  covered_call:             "Covered Call",
  cash_secured_put:         "Cash-Secured Put",
  bull_put_credit_spread:   "Bull Put Credit Spread",
  bear_call_credit_spread:  "Bear Call Credit Spread",
  call_debit_spread:        "Call Debit Spread",
  put_debit_spread:         "Put Debit Spread",
  credit_spread:            "Credit Spread",
};

/** Human-readable objective label. */
export const OBJECTIVE_LABEL: Record<TradeObjective, string> = {
  income:               "Income",
  growth:               "Growth",
  capital_preservation: "Capital preservation",
  hedging:              "Hedging / Protection",
  speculative:          "Speculative",
  diversification:      "Diversification",
};

// ---------------------------------------------------------------------------
// Dollar / percentage risk parsers
// ---------------------------------------------------------------------------

/**
 * Extracts a max-risk dollar amount from natural language.
 * Matches: "under $500", "risking $200", "max $1000", "risk of $250"
 */
export function parseMaxRiskDollars(text: string): number | undefined {
  const patterns = [
    /(?:under|below|less than|max(?:imum)?|risking?)\s*\$\s*(\d{1,6}(?:[,.]\d{3})*)/i,
    /\$\s*(\d{1,6}(?:[,.]\d{3})*)\s*(?:risk|max(?:imum)?|or less|limit)/i,
    /(?:a\s+)?risk\s+of\s+\$\s*(\d{1,6}(?:[,.]\d{3})*)/i,
    /(?:risk(?:ing)?|max)\s+(\d{1,6}(?:[,.]\d{3})*)\s*(?:dollar|usd|bucks?)?/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const raw = m[1].replace(/[,.]/g, "");
      const n = parseInt(raw, 10);
      if (n > 0 && n < 1_000_000) return n;
    }
  }
  return undefined;
}

/**
 * Extracts a max-risk portfolio percentage.
 * Matches: "less than 5% of my portfolio", "5% risk", "2% of account"
 */
export function parseMaxRiskPercent(text: string): number | undefined {
  // Use (?<!\d) negative lookbehind to prevent matching "50" inside "150%"
  const patterns = [
    /(?:under|below|less than|max(?:imum)?|using?)\s+(?<!\d)(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:of\s+(?:my\s+)?(?:portfolio|account|capital))?/i,
    /(?<!\d)(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:of\s+(?:my\s+)?(?:portfolio|account))/i,
    /(?<!\d)(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:risk|max|limit)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = parseFloat(m[1]);
      if (n > 0 && n <= 100) return n;
    }
  }
  return undefined;
}

/**
 * Extracts a number-of-ideas request.
 * Matches: "top 3", "3 ideas", "show me 5"
 */
export function parseNumberOfIdeas(text: string): number | undefined {
  const patterns = [
    // "top 3", "best 5", "show me 3", "find me 2" — number right after keyword
    /(?:top|best|show\s+me|find\s+me?)\s+(\d{1,2})\b/i,
    // "3 trade ideas", "3 setups", "3 opportunities" — number before noun
    /\b(\d{1,2})\s+(?:\w+\s+)*?(?:trade|idea|setup|opportunit)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 20) return n;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Objective / strategy / direction detection
// ---------------------------------------------------------------------------

function detectObjective(lower: string): TradeObjective | undefined {
  if (/\b(income|premium|yield|dividend)\b/.test(lower)) return "income";
  if (/\b(growth|grow|capital gain|appreciation|momentum)\b/.test(lower)) return "growth";
  if (/\b(capital.?preserv|protect|low.?risk|conservative|safe)\b/.test(lower)) return "capital_preservation";
  if (/\b(hedge|hedging|protection|put.?protect)\b/.test(lower)) return "hedging";
  if (/\b(speculative|specul|lottery|high.?risk.?reward|yolo)\b/.test(lower)) return "speculative";
  if (/\b(diversif|diversif\w+|diversif[yi]|new sector|spread.?across|spread risk)\b/.test(lower)) return "diversification";
  return undefined;
}

function detectStrategy(lower: string): TradeStrategy | undefined {
  for (const [re, strategy] of STRATEGY_ALIASES) {
    if (re.test(lower)) return strategy;
  }
  return undefined;
}

function detectDirection(lower: string): TradeDirection | undefined {
  if (/\b(bullish|upside|long.?bias|going up|uptrend)\b/.test(lower)) return "bullish";
  if (/\b(bearish|downside|short.?bias|going down|downtrend)\b/.test(lower)) return "bearish";
  if (/\b(neutral|sideways|range.?bound|no direction)\b/.test(lower)) return "neutral";
  return undefined;
}

function detectInstrumentPreference(lower: string, strategy?: TradeStrategy): InstrumentPreference | undefined {
  if (/\b(stock|shares?|equity|equities)\b/.test(lower) && !strategy) return "stock";
  if (strategy === "stock") return "stock";
  if (
    /\b(option|options|call|put|spread|contract)\b/.test(lower) ||
    (strategy && strategy !== "stock")
  ) return "options";
  return undefined;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parses natural-language trade goal text into a TradeGoalIntent.
 * Deterministic — same input always produces the same output.
 * No API calls, no side effects.
 *
 * @example
 *   parseTradeGoalInput("Find covered calls risking under $500")
 *   // → { requestedStrategy: "covered_call", maxRiskDollars: 500, ... }
 */
export function parseTradeGoalInput(rawGoal: string): TradeGoalIntent {
  const lower = rawGoal.toLowerCase().trim();

  const objective       = detectObjective(lower);
  const requestedStrategy = detectStrategy(lower);
  const direction       = detectDirection(lower);
  const maxRiskDollars  = parseMaxRiskDollars(rawGoal);
  const maxRiskPercent  = parseMaxRiskPercent(rawGoal);
  const numberOfIdeas   = parseNumberOfIdeas(rawGoal);

  // Instrument preference: infer from strategy or explicit wording
  const instrumentPreference = detectInstrumentPreference(lower, requestedStrategy);

  // Override objective from strategy when not already set
  const effectiveObjective: TradeObjective | undefined =
    objective ??
    (requestedStrategy === "covered_call" || requestedStrategy === "cash_secured_put"
      ? "income"
      : requestedStrategy === "long_call" || requestedStrategy === "long_put"
        ? "speculative"
        : undefined);

  // Build constraint phrases (shown as bullets in the goal banner)
  const constraintPhrases: string[] = [];
  if (requestedStrategy) constraintPhrases.push(STRATEGY_LABEL[requestedStrategy]);
  if (effectiveObjective && !requestedStrategy) constraintPhrases.push(OBJECTIVE_LABEL[effectiveObjective]);
  if (direction && direction !== "either") {
    constraintPhrases.push(direction.charAt(0).toUpperCase() + direction.slice(1) + " bias");
  }
  if (maxRiskDollars != null) constraintPhrases.push(`Max $${maxRiskDollars.toLocaleString()} risk per trade`);
  if (maxRiskPercent != null) constraintPhrases.push(`Max ${maxRiskPercent}% of portfolio per trade`);
  if (numberOfIdeas != null) constraintPhrases.push(`${numberOfIdeas} idea${numberOfIdeas !== 1 ? "s" : ""} requested`);
  if (instrumentPreference === "stock") constraintPhrases.push("Stocks / shares only");
  if (instrumentPreference === "options") constraintPhrases.push("Options strategies");

  // Build summary one-liner
  let summary = "Find trade opportunities";
  if (requestedStrategy) {
    summary = `Find ${STRATEGY_LABEL[requestedStrategy].toLowerCase()} opportunities`;
  } else if (effectiveObjective) {
    summary = `Find ${OBJECTIVE_LABEL[effectiveObjective].toLowerCase()} opportunities`;
  }
  if (maxRiskDollars != null) summary += ` — max $${maxRiskDollars.toLocaleString()} risk`;
  else if (maxRiskPercent != null) summary += ` — under ${maxRiskPercent}% of portfolio`;

  // Compute honest advisory warnings
  const warnings: string[] = [];

  if (maxRiskDollars != null && maxRiskDollars < 100) {
    warnings.push(
      `Very tight risk budget ($${maxRiskDollars}) — few setups qualify under this limit. Results may be empty.`,
    );
  }
  if (maxRiskPercent != null && maxRiskPercent < 1) {
    warnings.push(
      `Very tight portfolio allocation (${maxRiskPercent}%) — few setups qualify under this limit.`,
    );
  }
  if (requestedStrategy === "covered_call") {
    warnings.push(
      "Covered calls require an existing equity position. Connect a broker so portfolio context can filter to your holdings.",
    );
  }
  if (effectiveObjective === "diversification") {
    warnings.push(
      "Diversification analysis is most accurate with a connected broker. Without one, results are based on general market setups only.",
    );
  }
  // Always-on: no profit guarantee — must use the exported constant so tests
  // and the GoalTradePlanner can identify and filter it reliably.
  warnings.push(TRADE_GOAL_DISCLAIMER);

  return {
    rawGoal,
    objective: effectiveObjective,
    requestedStrategy,
    direction,
    instrumentPreference,
    maxRiskDollars,
    maxRiskPercent,
    numberOfIdeas,
    summary,
    constraintPhrases,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// GoalModePrefs → query string
// ---------------------------------------------------------------------------

/**
 * Translates a structured GoalModePrefs (from the GoalModeWizard) into an
 * optimised natural-language query string for /api/ask.
 *
 * The server's normalizeTradeGoal will re-parse this string server-side;
 * this function ensures the most important filters are phrased in ways the
 * server parser reliably detects.
 */
export function goalQueryFromPrefs(prefs: GoalModePrefs): string {
  const parts: string[] = [];

  // Base intent from goal type
  switch (prefs.goalType) {
    case "monthly_income":
      parts.push("Find income trade opportunities");
      break;
    case "account_growth":
      parts.push("Find the best trade opportunities for account growth");
      break;
    case "lower_risk":
      parts.push("Find lower-risk conservative trade ideas");
      break;
    case "learn_practice":
      parts.push("Show me trade examples to learn from");
      break;
    default:
      parts.push("Find trade opportunities");
  }

  // Risk budget
  if (prefs.maxRiskPerTrade > 0) {
    parts.push(`risking under $${prefs.maxRiskPerTrade.toLocaleString()}`);
  }

  // Instrument preferences
  const instruments = prefs.allowedInstruments ?? [];
  const instrumentLabels: string[] = [];
  if (instruments.includes("covered_call") || instruments.includes("covered_calls")) {
    instrumentLabels.push("covered calls");
  }
  if (instruments.includes("cash_secured_put") || instruments.includes("cash-secured-puts")) {
    instrumentLabels.push("cash-secured puts");
  }
  if (instruments.includes("credit_spread") || instruments.includes("credit-spreads")) {
    instrumentLabels.push("credit spreads");
  }
  if (instruments.includes("debit_spread") || instruments.includes("debit-spreads")) {
    instrumentLabels.push("debit spreads");
  }
  if (instrumentLabels.length > 0) {
    parts.push(`using ${instrumentLabels.join(" or ")}`);
  } else if (instruments.includes("stocks") || instruments.includes("stock")) {
    parts.push("stocks only");
  }

  // Account context (helps the server set accountSize)
  if (prefs.capital > 0 && prefs.capital < 1_000_000) {
    parts.push(`account size $${prefs.capital.toLocaleString()}`);
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Standalone disclaimer (always shown in the risk section)
// ---------------------------------------------------------------------------

/**
 * Returns the mandatory no-profit-guarantee disclaimer string.
 * Every risk section MUST include this text.
 */
export const TRADE_GOAL_DISCLAIMER =
  "Past performance of any screened setup does not guarantee future results. " +
  "All trade ideas carry risk of partial or total loss of capital. " +
  "This tool provides informational analysis only — not financial advice.";
