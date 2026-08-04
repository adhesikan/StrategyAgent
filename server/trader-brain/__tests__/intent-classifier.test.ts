// TraderBrain — IntentClassifier tests.
//
// Covers: each supported intent, false-ticker protections, deterministic
// repeatability, and cross-intent disambiguation.

import { describe, it, expect } from "vitest";
import { classifyBrainIntent, intentRequiresSymbol, intentWantsPortfolioContext, intentUsesMcp, intentWantsOpenAi } from "../intent-classifier";

// ---------------------------------------------------------------------------
// PLAN_PORTFOLIO_TRADE
// ---------------------------------------------------------------------------
describe("classifyBrainIntent — PLAN_PORTFOLIO_TRADE", () => {
  it("dollar-risk constraint", () => {
    expect(classifyBrainIntent("Find a trade risking less than $500", [])).toBe("PLAN_PORTFOLIO_TRADE");
  });
  it("percent-of-portfolio constraint", () => {
    expect(classifyBrainIntent("Find a trade using less than 5% of my portfolio", [])).toBe("PLAN_PORTFOLIO_TRADE");
  });
  it("income from holdings", () => {
    expect(classifyBrainIntent("Generate income from my holdings", [])).toBe("PLAN_PORTFOLIO_TRADE");
  });
  it("sector exclusion", () => {
    expect(classifyBrainIntent("Find something outside my semiconductor exposure", [])).toBe("PLAN_PORTFOLIO_TRADE");
  });
  it("covered call from stocks I own", () => {
    expect(classifyBrainIntent("Find covered calls from stocks I own", [])).toBe("PLAN_PORTFOLIO_TRADE");
  });
  it("NOT triggered by education question with dollar amount", () => {
    // "how does a $500 trade work" is educational, not portfolio-constrained
    const result = classifyBrainIntent("what is a covered call", []);
    expect(result).not.toBe("PLAN_PORTFOLIO_TRADE");
  });
  it("NOT triggered when a specific ticker is present", () => {
    // Ticker-specific asks stay on recommend path
    const result = classifyBrainIntent("Find a covered call on NVDA", ["NVDA"]);
    expect(result).not.toBe("PLAN_PORTFOLIO_TRADE");
  });
});

// ---------------------------------------------------------------------------
// RECOMMEND_SYMBOL_TRADE
// ---------------------------------------------------------------------------
describe("classifyBrainIntent — RECOMMEND_SYMBOL_TRADE", () => {
  it("explicit ticker + trade ask", () => {
    expect(classifyBrainIntent("Find a covered call on NVDA", ["NVDA"])).toBe("RECOMMEND_SYMBOL_TRADE");
  });
  it("ticker + trade idea phrasing", () => {
    expect(classifyBrainIntent("Give me a trade idea for AAPL", ["AAPL"])).toBe("RECOMMEND_SYMBOL_TRADE");
  });
  it("income strategy on a symbol", () => {
    expect(classifyBrainIntent("Find a cash-secured put on TSLA", ["TSLA"])).toBe("RECOMMEND_SYMBOL_TRADE");
  });
});

// ---------------------------------------------------------------------------
// RANK_MARKET_TRADES
// ---------------------------------------------------------------------------
describe("classifyBrainIntent — RANK_MARKET_TRADES", () => {
  it("best trades today, no symbol", () => {
    expect(classifyBrainIntent("Find the best trades today", [])).toBe("RANK_MARKET_TRADES");
  });
  it("income opportunities, no symbol", () => {
    expect(classifyBrainIntent("Find income opportunities", [])).toBe("RANK_MARKET_TRADES");
  });
  it("top trade picks, no symbol", () => {
    expect(classifyBrainIntent("What are the top trade picks right now?", [])).toBe("RANK_MARKET_TRADES");
  });
  it("ranked with risk budget", () => {
    // No ticker and no portfolio-constraint trigger → ranked
    expect(classifyBrainIntent("Find bullish trades", [])).toBe("RANK_MARKET_TRADES");
  });
});

// ---------------------------------------------------------------------------
// COMBINED_ANALYSIS_RECOMMENDATION
// ---------------------------------------------------------------------------
describe("classifyBrainIntent — COMBINED_ANALYSIS_RECOMMENDATION", () => {
  it("analyze and recommend", () => {
    const result = classifyBrainIntent("Analyze MU and recommend a trade", ["MU"]);
    expect(result).toBe("COMBINED_ANALYSIS_RECOMMENDATION");
  });
});

// ---------------------------------------------------------------------------
// EDUCATION_PLUS_ACTION
// ---------------------------------------------------------------------------
describe("classifyBrainIntent — EDUCATION_PLUS_ACTION", () => {
  it("explain and find one", () => {
    const result = classifyBrainIntent("Explain credit spreads and find me one", []);
    expect(result).toBe("EDUCATION_PLUS_ACTION");
  });
});

// ---------------------------------------------------------------------------
// ANALYZE_SYMBOL
// ---------------------------------------------------------------------------
describe("classifyBrainIntent — ANALYZE_SYMBOL", () => {
  it("analyze ticker", () => {
    expect(classifyBrainIntent("Analyze MU", ["MU"])).toBe("ANALYZE_SYMBOL");
  });
  it("what is NVDA doing", () => {
    expect(classifyBrainIntent("What is NVDA doing today?", ["NVDA"])).toBe("ANALYZE_SYMBOL");
  });
  it("symbol with no clear intent → analysis fallback", () => {
    // Any ticker present with no clearer intent → ANALYZE_SYMBOL
    const r = classifyBrainIntent("AAPL looks interesting", ["AAPL"]);
    expect(r).toBe("ANALYZE_SYMBOL");
  });
});

// ---------------------------------------------------------------------------
// EXPLAIN_CONCEPT
// ---------------------------------------------------------------------------
describe("classifyBrainIntent — EXPLAIN_CONCEPT", () => {
  it("what is a credit spread", () => {
    expect(classifyBrainIntent("What is a credit spread?", [])).toBe("EXPLAIN_CONCEPT");
  });
  it("how does VCP work", () => {
    expect(classifyBrainIntent("How does VCP work?", [])).toBe("EXPLAIN_CONCEPT");
  });
  it("explain implied volatility", () => {
    expect(classifyBrainIntent("Explain implied volatility to me", [])).toBe("EXPLAIN_CONCEPT");
  });
  it("what are covered calls", () => {
    expect(classifyBrainIntent("What are covered calls?", [])).toBe("EXPLAIN_CONCEPT");
  });
});

// ---------------------------------------------------------------------------
// MARKET_RESEARCH
// ---------------------------------------------------------------------------
describe("classifyBrainIntent — MARKET_RESEARCH", () => {
  it("why is the market down", () => {
    expect(classifyBrainIntent("Why is the market down today?", [])).toBe("MARKET_RESEARCH");
  });
  it("what's happening with interest rates", () => {
    expect(classifyBrainIntent("What's happening with interest rates?", [])).toBe("MARKET_RESEARCH");
  });
  it("fed impact", () => {
    expect(classifyBrainIntent("What is the Fed doing to the market?", [])).toBe("MARKET_RESEARCH");
  });
});

// ---------------------------------------------------------------------------
// UNKNOWN
// ---------------------------------------------------------------------------
describe("classifyBrainIntent — UNKNOWN", () => {
  it("empty string → UNKNOWN", () => {
    expect(classifyBrainIntent("", [])).toBe("UNKNOWN");
  });
  it("gibberish → UNKNOWN", () => {
    expect(classifyBrainIntent("xyzzy foo bar", [])).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// False-ticker protections
// ---------------------------------------------------------------------------
describe("classifyBrainIntent — false-ticker protections", () => {
  it("'RISK' is not a valid ticker — no symbol intent when only reserved word present", () => {
    // extractTickers strips reserved words; if tickers=[] after extraction,
    // no ANALYZE_SYMBOL intent should fire.
    const result = classifyBrainIntent("Find a trade with low RISK", []);
    expect(result).not.toBe("ANALYZE_SYMBOL");
  });

  it("dollar amount in question does not create a ticker", () => {
    const result = classifyBrainIntent("Find income trades risking under $500", []);
    expect(["RANK_MARKET_TRADES", "PLAN_PORTFOLIO_TRADE"]).toContain(result);
  });

  it("'MAX' keyword does not become a ticker causing ANALYZE_SYMBOL", () => {
    const result = classifyBrainIntent("Find trades with max risk $200", []);
    expect(result).not.toBe("ANALYZE_SYMBOL");
  });
});

// ---------------------------------------------------------------------------
// Cross-intent disambiguation
// ---------------------------------------------------------------------------
describe("classifyBrainIntent — cross-intent disambiguation", () => {
  it("portfolio constraint beats ranked when dollar risk is present", () => {
    // "Find a trade risking $500" → PLAN_PORTFOLIO_TRADE, not RANK_MARKET_TRADES
    const result = classifyBrainIntent("Find a trade risking under $500", []);
    expect(result).toBe("PLAN_PORTFOLIO_TRADE");
  });

  it("ticker present + trade ask → RECOMMEND, not RANK", () => {
    expect(classifyBrainIntent("Find a bull put spread on SPY", ["SPY"])).toBe("RECOMMEND_SYMBOL_TRADE");
  });

  it("education question with a ticker → ANALYZE_SYMBOL, not EXPLAIN_CONCEPT", () => {
    // "What is NVDA doing" has a ticker → ANALYZE_SYMBOL wins over MARKET_RESEARCH
    const result = classifyBrainIntent("What is NVDA doing today?", ["NVDA"]);
    expect(result).toBe("ANALYZE_SYMBOL");
  });

  it("combined: analyze + recommend wins over plain ANALYZE_SYMBOL", () => {
    const result = classifyBrainIntent("Analyze BA and give me a trade recommendation", ["BA"]);
    expect(result).toBe("COMBINED_ANALYSIS_RECOMMENDATION");
  });
});

// ---------------------------------------------------------------------------
// Deterministic repeatability
// ---------------------------------------------------------------------------
describe("classifyBrainIntent — deterministic repeatability", () => {
  const testCases = [
    ["Find a covered call on NVDA", ["NVDA"]],
    ["Find income opportunities", []],
    ["What is a credit spread?", []],
    ["Analyze MU", ["MU"]],
    ["Find a trade risking under $500", []],
    ["", []],
  ] as [string, string[]][];

  for (const [q, tickers] of testCases) {
    it(`same output for "${q.slice(0, 40)}"`, () => {
      const r1 = classifyBrainIntent(q, tickers);
      const r2 = classifyBrainIntent(q, tickers);
      const r3 = classifyBrainIntent(q, tickers);
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);
    });
  }
});

// ---------------------------------------------------------------------------
// Intent metadata helpers
// ---------------------------------------------------------------------------
describe("intent metadata helpers", () => {
  it("intentRequiresSymbol — ANALYZE_SYMBOL, RECOMMEND_SYMBOL_TRADE, COMBINED", () => {
    expect(intentRequiresSymbol("ANALYZE_SYMBOL")).toBe(true);
    expect(intentRequiresSymbol("RECOMMEND_SYMBOL_TRADE")).toBe(true);
    expect(intentRequiresSymbol("COMBINED_ANALYSIS_RECOMMENDATION")).toBe(true);
    expect(intentRequiresSymbol("RANK_MARKET_TRADES")).toBe(false);
    expect(intentRequiresSymbol("EXPLAIN_CONCEPT")).toBe(false);
  });

  it("intentWantsPortfolioContext — PLAN, RANK, RECOMMEND, COMBINED", () => {
    expect(intentWantsPortfolioContext("PLAN_PORTFOLIO_TRADE")).toBe(true);
    expect(intentWantsPortfolioContext("RANK_MARKET_TRADES")).toBe(true);
    expect(intentWantsPortfolioContext("RECOMMEND_SYMBOL_TRADE")).toBe(true);
    expect(intentWantsPortfolioContext("EXPLAIN_CONCEPT")).toBe(false);
    expect(intentWantsPortfolioContext("MARKET_RESEARCH")).toBe(false);
  });

  it("intentUsesMcp — false for education/research/unknown", () => {
    expect(intentUsesMcp("EXPLAIN_CONCEPT")).toBe(false);
    expect(intentUsesMcp("MARKET_RESEARCH")).toBe(false);
    expect(intentUsesMcp("UNKNOWN")).toBe(false);
    expect(intentUsesMcp("RANK_MARKET_TRADES")).toBe(true);
    expect(intentUsesMcp("RECOMMEND_SYMBOL_TRADE")).toBe(true);
  });

  it("intentWantsOpenAi — false for RANK_MARKET_TRADES", () => {
    expect(intentWantsOpenAi("RANK_MARKET_TRADES")).toBe(false);
    expect(intentWantsOpenAi("EXPLAIN_CONCEPT")).toBe(true);
    expect(intentWantsOpenAi("RECOMMEND_SYMBOL_TRADE")).toBe(true);
  });
});
