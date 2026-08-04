// Centralized, deterministic ticker/symbol extraction for Ask AI routing.
//
// Root-cause context: the old extractor accepted any 1-5 letter token that
// wasn't in a tiny stopword list, so "Find a trade under $500 max loss"
// yielded UNDER / MAX / LOSS as "tickers". This module is the single source
// of truth for free-text symbol extraction. Precedence (§3 of the spec):
//   1. Explicit ticker syntax — $NVDA, NASDAQ:AMD, "ticker BA", "symbol ON"
//      (reserved-word denylist BYPASSED: explicit context wins).
//   2. Analysis/trade grammar — "Analyze NVDA", "trade for META",
//      "How does BA look?" (denylist applies).
//   3. Standalone UPPERCASE tokens (NVDA, AAPL) — denylist applies.
//   4. Case-insensitive fallback ("why is nvda moving") — denylist applies.
// Constraint phrases ("under $500 max loss", "risk no more than $250", …)
// are stripped BEFORE extraction so their words are never symbol candidates.

/**
 * Reserved-language denylist: request-grammar words that must never be
 * treated as tickers outside explicit ticker syntax. Superset of the spec's
 * minimum list plus the pre-existing stopwords and number words.
 */
export const RESERVED_TICKER_WORDS = new Set<string>([
  // --- spec-required minimum ---
  "A", "AN", "AND", "ARE", "AT", "BE", "BEST", "BUY", "CALL", "CASH", "CREDIT",
  "DAY", "DAYS", "DEFINED", "DOLLAR", "DOLLARS", "ETF", "FIND", "FOR", "FROM",
  "GIVE", "GROWTH", "IN", "INCOME", "INVEST", "LOSS", "LONG", "MAX", "MAXIMUM",
  "ME", "MIN", "MINIMUM", "MONTH", "MONTHS", "OPTION", "OPTIONS", "OR", "PUT",
  "RECOMMEND", "RISK", "SELL", "SETUP", "SHORT", "SPREAD", "STOCK", "STOCKS",
  "STOP", "STRATEGY", "THE", "TRADE", "TRADES", "TRADING", "UNDER", "USD",
  "WEEK", "WEEKS", "WITH",
  // --- pre-existing stopwords (behavior preserved) ---
  "I", "IS", "IT", "TO", "OF", "ON", "BY", "DO", "MY", "WHY", "HOW", "WHAT",
  "WHEN", "WHERE", "WHO", "CAN", "SHOULD", "WILL", "WOULD", "THIS", "THAT",
  "PRICE", "MARKET", "SHOW", "TELL", "MAKE", "GET", "USE", "TODAY", "NOW",
  "GOOD", "BAD", "UP", "DOWN", "OUT", "RUN", "ALL", "ANY", "MOVING", "GROW",
  "PRO", "PLAN", "AI",
  // --- number words / request qualifiers ---
  "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
  "BULL", "BEAR", "IDEA", "IDEAS", "HIGH", "LOW", "SAFE", "SOME", "MORE", "DOES", "WAS", "HAS", "HAVE",
  "LESS", "THAN", "ABOUT", "OVER", "BELOW", "ABOVE", "YEAR", "YEARS", "HELP",
  "LOOK", "LOOKS", "LIKE", "NEXT", "PICK", "PICKS", "TOP",
  // --- pronouns / command words / connectives (grammar+fallback tiers) ---
  "WE", "US", "YOU", "YOUR", "SO", "IF", "NO", "NOT", "YES", "NEW", "OLD",
  "JUST", "ONLY", "VERY", "MUCH", "MANY", "ALSO", "INTO", "THEN", "THEM",
  "THEY", "HERE", "WANT", "NEED", "THINK", "KNOW", "SEE", "TRY", "GOT",
  "WHICH", "COULD", "MIGHT", "MUST", "PLEAS", "SURE", "STILL", "AGAIN",
  "OTHER", "EVERY", "THESE", "THOSE", "AFTER", "FIRST", "LAST", "EACH",
  "OPEN", "CLOSE", "ENTRY", "EXIT", "TERM", "IDEAL", "PORTF", "WATCH",
  "LIST", "LISTS", "CHART", "ALERT", "ORDER", "SHARE", "MONEY", "PROFIT",
  // --- residual command verbs (grammar-tier objects must never self-match) ---
  "CHECK", "SCAN", "QUOTE", "PRICE", "SETUP", "LEVEL", "IDEAS", "WHERE",
]);

export function isReservedTickerWord(sym: string): boolean {
  return RESERVED_TICKER_WORDS.has(String(sym ?? "").toUpperCase());
}

/**
 * True when the question contains EXPLICIT ticker syntax for `sym`
 * ($META, NASDAQ:AMD, "ticker BA", "symbol ON"). Downstream validators use
 * this to accept a reserved-word-colliding symbol the user explicitly named —
 * mirroring extraction tier 1, so extraction and goal normalization can never
 * disagree about explicit symbols.
 */
export function hasExplicitSymbolContext(question: string, sym: string): boolean {
  const q = String(question ?? "");
  const s = String(sym ?? "").replace(/[^A-Za-z]/g, "");
  if (!s || s.length > 5) return false;
  const re = new RegExp(
    `(?:\\$${s}\\b|\\b(?:NASDAQ|NYSE|AMEX|ARCA|BATS|OTC)\\s*:\\s*${s}\\b|\\b(?:ticker|symbol)\\s+${s}\\b)`,
    "i",
  );
  return re.test(q);
}

const SYM_SHAPE = /^[A-Za-z]{1,5}$/;

/**
 * Removes risk/budget constraint phrases so their words never become symbol
 * candidates (§4): "under $500 max loss", "maximum loss of $1,000",
 * "risk no more than $250", "within a $500 budget", "under $300 risk".
 */
export function stripConstraintPhrases(text: string): string {
  return String(text ?? "")
    .replace(/\b(?:under|below|less\s+than|no\s+more\s+than|up\s+to|within)\s+(?:a\s+)?\$?[\d,]+(?:\.\d+)?\s*(?:max\s+loss|max\s+risk|of\s+risk|risk|loss|budget|dollars?)?/gi, " ")
    .replace(/\bmax(?:imum)?\s+(?:loss|risk)\s*(?:of\s+)?(?:\$?[\d,]+(?:\.\d+)?)?/gi, " ")
    .replace(/\brisk(?:ing)?\s+no\s+more\s+than\s+\$?[\d,]+(?:\.\d+)?/gi, " ")
    .replace(/\b\$?[\d,]+(?:\.\d+)?\s*(?:max\s+loss|max\s+risk|of\s+risk|risk\s+budget|budget)/gi, " ");
}

function addCandidate(found: Set<string>, tok: string, max: number, denylist: boolean): boolean {
  if (!SYM_SHAPE.test(tok)) return found.size >= max;
  const sym = tok.toUpperCase();
  if (denylist && RESERVED_TICKER_WORDS.has(sym)) return found.size >= max;
  found.add(sym);
  return found.size >= max;
}

/**
 * The single centralized ticker extractor. Returns up to `max` symbols in
 * precedence order. Broad market-wide asks ("Find a trade under $500 max
 * loss", "What should I trade today?") return [].
 */
export function extractTickers(text: string, max = 3): string[] {
  const found = new Set<string>();
  const raw = String(text ?? "");
  const cleaned = stripConstraintPhrases(raw);

  // --- Tier 1: explicit ticker syntax (denylist bypassed) ---
  for (const m of Array.from(raw.matchAll(/\$([A-Za-z]{1,5})\b/g))) {
    if (addCandidate(found, m[1], max, false)) return Array.from(found);
  }
  for (const m of Array.from(raw.matchAll(/\b(?:NASDAQ|NYSE|AMEX|ARCA|BATS|OTC)\s*:\s*([A-Za-z]{1,5})\b/gi))) {
    if (addCandidate(found, m[1], max, false)) return Array.from(found);
  }
  for (const m of Array.from(raw.matchAll(/\b(?:ticker|symbol)\s+([A-Za-z]{1,5})\b/gi))) {
    if (addCandidate(found, m[1], max, false)) return Array.from(found);
  }

  // --- Tier 2: analysis/trade grammar (denylist applies) ---
  const grammar = [
    /\b(?:analyz|analys)e?\s+([A-Za-z]{1,5})\b/gi,
    /\b(?:evaluate|check|scan|chart|quote)\s+([A-Za-z]{1,5})\b/gi,
    /\btrade\s+(?:for|on|in)\s+([A-Za-z]{1,5})\b/gi,
    /\bhow\s+does\s+([A-Za-z]{1,5})\s+look\b/gi,
  ];
  for (const re of grammar) {
    for (const m of Array.from(cleaned.matchAll(re))) {
      if (addCandidate(found, m[1], max, true)) return Array.from(found);
    }
  }

  // --- Tier 3: standalone UPPERCASE tokens (denylist applies) ---
  for (const m of Array.from(cleaned.matchAll(/\b([A-Z]{1,5})\b/g))) {
    if (addCandidate(found, m[1], max, true)) return Array.from(found);
  }

  // --- Tier 4: case-insensitive fallback ("why is nvda moving") ---
  for (const tok of cleaned.split(/[^A-Za-z$]+/).filter(Boolean)) {
    if (tok.length < 2 || tok.length > 5) continue;
    if (addCandidate(found, tok, max, true)) break;
  }
  return Array.from(found);
}
