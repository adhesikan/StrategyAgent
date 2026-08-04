// Sprint 4.3 — Trade Goal Parser tests.
// Pure-function tests — no React, no DOM, no server calls, no API.
//
// Covers: parseTradeGoalInput, parseMaxRiskDollars, parseMaxRiskPercent,
//         parseNumberOfIdeas, goalQueryFromPrefs, TRADE_GOAL_DISCLAIMER,
//         STRATEGY_LABEL, OBJECTIVE_LABEL.

import { describe, it, expect, beforeAll } from "vitest";
import {
  goalQueryFromPrefs,
  OBJECTIVE_LABEL,
  parseMaxRiskDollars,
  parseMaxRiskPercent,
  parseNumberOfIdeas,
  parseTradeGoalInput,
  STRATEGY_LABEL,
  TRADE_GOAL_DISCLAIMER,
  type TradeGoalIntent,
} from "./trade-goal-parser";
import type { GoalModePrefs } from "@/components/goal-mode-shell";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePrefs(overrides: Partial<GoalModePrefs> = {}): GoalModePrefs {
  return {
    capital: 10_000,
    goalType: "monthly_income",
    maxRiskPerTrade: 200,
    activityLevel: "moderate",
    allowedInstruments: [],
    brokerConnected: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseMaxRiskDollars
// ---------------------------------------------------------------------------

describe("parseMaxRiskDollars", () => {
  it("extracts dollar amount from 'risking under $500'", () => {
    expect(parseMaxRiskDollars("Find a trade risking under $500")).toBe(500);
  });

  it("extracts from 'max $1000'", () => {
    expect(parseMaxRiskDollars("max $1000 risk per trade")).toBe(1000);
  });

  it("extracts from '$200 risk'", () => {
    expect(parseMaxRiskDollars("trades with $200 risk")).toBe(200);
  });

  it("extracts from 'risking $300'", () => {
    expect(parseMaxRiskDollars("Find trades risking $300")).toBe(300);
  });

  it("extracts from 'risk of $250'", () => {
    expect(parseMaxRiskDollars("looking for a risk of $250")).toBe(250);
  });

  it("ignores amounts ≥ 1,000,000", () => {
    expect(parseMaxRiskDollars("risking under $2,000,000")).toBeUndefined();
  });

  it("returns undefined when no dollar amount present", () => {
    expect(parseMaxRiskDollars("Find income opportunities")).toBeUndefined();
  });

  it("returns undefined for zero", () => {
    expect(parseMaxRiskDollars("risking $0")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseMaxRiskPercent
// ---------------------------------------------------------------------------

describe("parseMaxRiskPercent", () => {
  it("extracts from 'less than 5% of my portfolio'", () => {
    expect(parseMaxRiskPercent("Find a trade using less than 5% of my portfolio")).toBe(5);
  });

  it("extracts from '5% of account'", () => {
    expect(parseMaxRiskPercent("trades using 5% of account")).toBe(5);
  });

  it("extracts from '2% risk'", () => {
    expect(parseMaxRiskPercent("entries with 2% risk")).toBe(2);
  });

  it("extracts decimal percentage", () => {
    expect(parseMaxRiskPercent("under 2.5% of my portfolio")).toBe(2.5);
  });

  it("returns undefined when no percentage present", () => {
    expect(parseMaxRiskPercent("Find covered calls risking under $500")).toBeUndefined();
  });

  it("returns undefined for 0%", () => {
    expect(parseMaxRiskPercent("0% risk")).toBeUndefined();
  });

  it("returns undefined when percentage > 100", () => {
    expect(parseMaxRiskPercent("150% of portfolio")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseNumberOfIdeas
// ---------------------------------------------------------------------------

describe("parseNumberOfIdeas", () => {
  it("extracts from 'top 3 ideas'", () => {
    expect(parseNumberOfIdeas("Find top 3 trade ideas")).toBe(3);
  });

  it("extracts from 'show me 5'", () => {
    expect(parseNumberOfIdeas("show me 5 opportunities")).toBe(5);
  });

  it("extracts from '3 setups'", () => {
    expect(parseNumberOfIdeas("find 3 setups for me")).toBe(3);
  });

  it("returns undefined for 0", () => {
    expect(parseNumberOfIdeas("0 ideas")).toBeUndefined();
  });

  it("returns undefined when no count present", () => {
    expect(parseNumberOfIdeas("Find income opportunities")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// STRATEGY_LABEL — completeness
// ---------------------------------------------------------------------------

describe("STRATEGY_LABEL", () => {
  const strategies = [
    "stock", "long_call", "long_put", "covered_call", "cash_secured_put",
    "bull_put_credit_spread", "bear_call_credit_spread",
    "call_debit_spread", "put_debit_spread", "credit_spread",
  ] as const;

  it.each(strategies)("has non-empty label for %s", (s) => {
    expect(STRATEGY_LABEL[s]).toBeTruthy();
    expect(STRATEGY_LABEL[s].length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// OBJECTIVE_LABEL — completeness
// ---------------------------------------------------------------------------

describe("OBJECTIVE_LABEL", () => {
  const objectives = [
    "income", "growth", "capital_preservation",
    "hedging", "speculative", "diversification",
  ] as const;

  it.each(objectives)("has non-empty label for %s", (o) => {
    expect(OBJECTIVE_LABEL[o]).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// TRADE_GOAL_DISCLAIMER
// ---------------------------------------------------------------------------

describe("TRADE_GOAL_DISCLAIMER", () => {
  it("is a non-empty string", () => {
    expect(typeof TRADE_GOAL_DISCLAIMER).toBe("string");
    expect(TRADE_GOAL_DISCLAIMER.length).toBeGreaterThan(20);
  });

  it("contains 'risk' — must mention risk of loss", () => {
    expect(TRADE_GOAL_DISCLAIMER.toLowerCase()).toContain("risk");
  });

  it("does not contain profit guarantees", () => {
    const lower = TRADE_GOAL_DISCLAIMER.toLowerCase();
    expect(lower).not.toContain("guaranteed profit");
    expect(lower).not.toContain("guaranteed return");
  });
});

// ---------------------------------------------------------------------------
// parseTradeGoalInput — spec examples
// ---------------------------------------------------------------------------

describe("parseTradeGoalInput — spec example: 'Find a trade risking under $500'", () => {
  let intent: TradeGoalIntent;
  beforeAll(() => {
    intent = parseTradeGoalInput("Find a trade risking under $500");
  });

  it("rawGoal is preserved", () => {
    expect(intent.rawGoal).toBe("Find a trade risking under $500");
  });

  it("maxRiskDollars is 500", () => {
    expect(intent.maxRiskDollars).toBe(500);
  });

  it("maxRiskPercent is not set", () => {
    expect(intent.maxRiskPercent).toBeUndefined();
  });

  it("summary mentions '$500'", () => {
    expect(intent.summary).toContain("500");
  });

  it("constraintPhrases includes '$500'", () => {
    const phrase = intent.constraintPhrases.find((p) => p.includes("500"));
    expect(phrase).toBeTruthy();
  });

  it("always includes no-profit disclaimer in warnings", () => {
    expect(intent.warnings).toContain(TRADE_GOAL_DISCLAIMER);
  });
});

describe("parseTradeGoalInput — spec example: 'Find a trade using less than 5% of my portfolio'", () => {
  let intent: TradeGoalIntent;
  beforeAll(() => {
    intent = parseTradeGoalInput("Find a trade using less than 5% of my portfolio");
  });

  it("maxRiskPercent is 5", () => {
    expect(intent.maxRiskPercent).toBe(5);
  });

  it("maxRiskDollars is not set", () => {
    expect(intent.maxRiskDollars).toBeUndefined();
  });

  it("constraintPhrases includes '5%'", () => {
    const phrase = intent.constraintPhrases.find((p) => p.includes("5%"));
    expect(phrase).toBeTruthy();
  });

  it("summary mentions portfolio allocation", () => {
    expect(intent.summary).toContain("5%");
  });
});

describe("parseTradeGoalInput — spec example: 'Find covered calls from my holdings'", () => {
  let intent: TradeGoalIntent;
  beforeAll(() => {
    intent = parseTradeGoalInput("Find covered calls from my holdings");
  });

  it("requestedStrategy is 'covered_call'", () => {
    expect(intent.requestedStrategy).toBe("covered_call");
  });

  it("objective is 'income' (inferred from covered_call)", () => {
    expect(intent.objective).toBe("income");
  });

  it("instrumentPreference is 'options'", () => {
    expect(intent.instrumentPreference).toBe("options");
  });

  it("constraintPhrases includes 'Covered Call'", () => {
    expect(intent.constraintPhrases).toContain("Covered Call");
  });

  it("warns about needing an existing equity position", () => {
    const hasWarning = intent.warnings.some((w) =>
      /existing equity position|holdings/i.test(w),
    );
    expect(hasWarning).toBe(true);
  });

  it("always includes no-profit disclaimer", () => {
    expect(intent.warnings).toContain(TRADE_GOAL_DISCLAIMER);
  });
});

describe("parseTradeGoalInput — spec example: 'Find income opportunities'", () => {
  let intent: TradeGoalIntent;
  beforeAll(() => {
    intent = parseTradeGoalInput("Find income opportunities");
  });

  it("objective is 'income'", () => {
    expect(intent.objective).toBe("income");
  });

  it("requestedStrategy is undefined (no specific strategy mentioned)", () => {
    expect(intent.requestedStrategy).toBeUndefined();
  });

  it("summary mentions 'income'", () => {
    expect(intent.summary.toLowerCase()).toContain("income");
  });

  it("constraintPhrases includes income objective label", () => {
    expect(intent.constraintPhrases).toContain(OBJECTIVE_LABEL.income);
  });
});

describe("parseTradeGoalInput — spec example: 'Find diversification ideas'", () => {
  let intent: TradeGoalIntent;
  beforeAll(() => {
    intent = parseTradeGoalInput("Find diversification ideas");
  });

  it("objective is 'diversification'", () => {
    expect(intent.objective).toBe("diversification");
  });

  it("warns about needing broker for personalized diversification", () => {
    const hasWarning = intent.warnings.some((w) =>
      /diversif/i.test(w),
    );
    expect(hasWarning).toBe(true);
  });

  it("always includes no-profit disclaimer", () => {
    expect(intent.warnings).toContain(TRADE_GOAL_DISCLAIMER);
  });
});

// ---------------------------------------------------------------------------
// parseTradeGoalInput — additional strategy detection
// ---------------------------------------------------------------------------

describe("parseTradeGoalInput — strategy detection", () => {
  it("detects 'cash-secured put'", () => {
    expect(parseTradeGoalInput("Find cash-secured put ideas").requestedStrategy).toBe("cash_secured_put");
  });

  it("detects 'CSP' abbreviation", () => {
    expect(parseTradeGoalInput("Any good CSP opportunities?").requestedStrategy).toBe("cash_secured_put");
  });

  it("detects 'bull put credit spread'", () => {
    expect(parseTradeGoalInput("Find bull put credit spread setups").requestedStrategy).toBe("bull_put_credit_spread");
  });

  it("detects 'bear call spread'", () => {
    expect(parseTradeGoalInput("Find bear call credit spread ideas").requestedStrategy).toBe("bear_call_credit_spread");
  });

  it("detects 'long call'", () => {
    expect(parseTradeGoalInput("Find long call opportunities").requestedStrategy).toBe("long_call");
  });

  it("detects 'long put'", () => {
    expect(parseTradeGoalInput("Find long put ideas risking under $200").requestedStrategy).toBe("long_put");
  });

  it("detects 'credit spread'", () => {
    expect(parseTradeGoalInput("Show me credit spread opportunities").requestedStrategy).toBe("credit_spread");
  });
});

// ---------------------------------------------------------------------------
// parseTradeGoalInput — objective detection
// ---------------------------------------------------------------------------

describe("parseTradeGoalInput — objective detection", () => {
  it("detects 'growth' from 'account growth'", () => {
    expect(parseTradeGoalInput("Find trades for account growth").objective).toBe("growth");
  });

  it("detects 'capital_preservation' from 'conservative'", () => {
    expect(parseTradeGoalInput("Find conservative lower-risk trades").objective).toBe("capital_preservation");
  });

  it("detects 'hedging' from 'protection'", () => {
    expect(parseTradeGoalInput("Find put protection ideas").objective).toBe("hedging");
  });

  it("detects 'speculative' from 'high risk reward'", () => {
    expect(parseTradeGoalInput("high risk reward ideas").objective).toBe("speculative");
  });

  it("income from 'premium income'", () => {
    expect(parseTradeGoalInput("Find premium income trades").objective).toBe("income");
  });

  it("income from 'yield'", () => {
    expect(parseTradeGoalInput("Find yield-generating trades").objective).toBe("income");
  });
});

// ---------------------------------------------------------------------------
// parseTradeGoalInput — direction detection
// ---------------------------------------------------------------------------

describe("parseTradeGoalInput — direction detection", () => {
  it("detects 'bullish' direction", () => {
    expect(parseTradeGoalInput("Find bullish trade ideas").direction).toBe("bullish");
  });

  it("detects 'bearish' direction", () => {
    expect(parseTradeGoalInput("Find bearish income trades").direction).toBe("bearish");
  });

  it("detects 'neutral' direction", () => {
    expect(parseTradeGoalInput("Find neutral / sideways income ideas").direction).toBe("neutral");
  });

  it("no direction when not specified", () => {
    expect(parseTradeGoalInput("Find income trades under $300").direction).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseTradeGoalInput — warnings
// ---------------------------------------------------------------------------

describe("parseTradeGoalInput — warnings", () => {
  it("warns when maxRiskDollars < 100", () => {
    const intent = parseTradeGoalInput("Find a trade risking under $50");
    const hasTightWarning = intent.warnings.some((w) => /tight|limit|empty/i.test(w));
    expect(hasTightWarning).toBe(true);
  });

  it("does NOT warn for tight budget when maxRiskDollars >= 100", () => {
    const intent = parseTradeGoalInput("Find a trade risking under $100");
    const hasTightWarning = intent.warnings.some(
      (w) => /very tight risk budget/i.test(w),
    );
    expect(hasTightWarning).toBe(false);
  });

  it("warns when maxRiskPercent < 1", () => {
    const intent = parseTradeGoalInput("Find a trade using less than 0.5% of my portfolio");
    const hasTightWarning = intent.warnings.some((w) => /tight/i.test(w));
    expect(hasTightWarning).toBe(true);
  });

  it("always includes no-profit disclaimer regardless of goal type", () => {
    const intents = [
      parseTradeGoalInput("Find income opportunities"),
      parseTradeGoalInput("Find diversification ideas"),
      parseTradeGoalInput("Find covered calls"),
      parseTradeGoalInput("best trade today"),
    ];
    for (const intent of intents) {
      expect(intent.warnings).toContain(TRADE_GOAL_DISCLAIMER);
    }
  });
});

// ---------------------------------------------------------------------------
// parseTradeGoalInput — constraintPhrases
// ---------------------------------------------------------------------------

describe("parseTradeGoalInput — constraintPhrases", () => {
  it("empty constraintPhrases for fully open query", () => {
    const intent = parseTradeGoalInput("Find some trades");
    // No strategy, objective, direction, or risk specified
    expect(intent.constraintPhrases.length).toBe(0);
  });

  it("multiple constraints combine correctly", () => {
    const intent = parseTradeGoalInput(
      "Find bullish covered call income trades risking under $300",
    );
    expect(intent.constraintPhrases).toContain("Covered Call");
    expect(intent.constraintPhrases.some((p) => p.includes("300"))).toBe(true);
    // Direction shows as bullish bias
    expect(intent.constraintPhrases.some((p) => /bullish/i.test(p))).toBe(true);
  });

  it("numberOfIdeas shows in constraintPhrases", () => {
    const intent = parseTradeGoalInput("Find top 3 income trade ideas");
    expect(intent.constraintPhrases.some((p) => p.includes("3"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseTradeGoalInput — summary
// ---------------------------------------------------------------------------

describe("parseTradeGoalInput — summary", () => {
  it("non-empty for any input", () => {
    const intents = [
      "Find income opportunities",
      "best trades today",
      "",
      "Find covered calls risking under $500",
    ].map(parseTradeGoalInput);
    for (const intent of intents) {
      expect(intent.summary.trim().length).toBeGreaterThan(0);
    }
  });

  it("mentions strategy when detected", () => {
    const intent = parseTradeGoalInput("Find covered call opportunities");
    expect(intent.summary.toLowerCase()).toContain("covered call");
  });

  it("mentions dollar risk when detected", () => {
    const intent = parseTradeGoalInput("Find trades risking under $400");
    expect(intent.summary).toContain("400");
  });

  it("mentions percent risk when detected", () => {
    const intent = parseTradeGoalInput("Find ideas using under 3% of my portfolio");
    expect(intent.summary).toContain("3%");
  });
});

// ---------------------------------------------------------------------------
// goalQueryFromPrefs — spec examples from GoalModePrefs
// ---------------------------------------------------------------------------

describe("goalQueryFromPrefs", () => {
  it("monthly_income → includes 'income'", () => {
    const q = goalQueryFromPrefs(makePrefs({ goalType: "monthly_income" }));
    expect(q.toLowerCase()).toContain("income");
  });

  it("account_growth → includes 'growth'", () => {
    const q = goalQueryFromPrefs(makePrefs({ goalType: "account_growth" }));
    expect(q.toLowerCase()).toContain("growth");
  });

  it("lower_risk → includes 'risk'", () => {
    const q = goalQueryFromPrefs(makePrefs({ goalType: "lower_risk" }));
    expect(q.toLowerCase()).toContain("risk");
  });

  it("learn_practice → includes 'learn'", () => {
    const q = goalQueryFromPrefs(makePrefs({ goalType: "learn_practice" }));
    expect(q.toLowerCase()).toContain("learn");
  });

  it("maxRiskPerTrade > 0 → includes dollar amount in query", () => {
    const q = goalQueryFromPrefs(makePrefs({ maxRiskPerTrade: 500 }));
    expect(q).toContain("500");
  });

  it("maxRiskPerTrade = 0 → no dollar amount in query", () => {
    const q = goalQueryFromPrefs(makePrefs({ maxRiskPerTrade: 0 }));
    // Should not inject "$0"
    expect(q).not.toContain("$0");
  });

  it("allowedInstruments includes covered_call → query includes 'covered calls'", () => {
    const q = goalQueryFromPrefs(
      makePrefs({ allowedInstruments: ["covered_call"] }),
    );
    expect(q.toLowerCase()).toContain("covered call");
  });

  it("allowedInstruments includes cash_secured_put → query includes 'cash-secured puts'", () => {
    const q = goalQueryFromPrefs(
      makePrefs({ allowedInstruments: ["cash_secured_put"] }),
    );
    expect(q.toLowerCase()).toContain("cash-secured put");
  });

  it("capital > 0 → includes account size in query", () => {
    const q = goalQueryFromPrefs(makePrefs({ capital: 25_000 }));
    expect(q).toContain("25,000");
  });

  it("capital >= 1,000,000 → not included (guard against bogus values)", () => {
    const q = goalQueryFromPrefs(makePrefs({ capital: 1_000_000 }));
    expect(q).not.toContain("1,000,000");
  });

  it("returns a non-empty string for any valid prefs", () => {
    const q = goalQueryFromPrefs(makePrefs());
    expect(q.trim().length).toBeGreaterThan(0);
  });

  it("returns a parseable natural language string (re-parseable by parseTradeGoalInput)", () => {
    const prefs = makePrefs({
      goalType: "monthly_income",
      maxRiskPerTrade: 300,
      allowedInstruments: ["covered_call"],
      capital: 15_000,
    });
    const q = goalQueryFromPrefs(prefs);
    const intent = parseTradeGoalInput(q);
    // The re-parsed intent should reflect the prefs
    expect(intent.maxRiskDollars).toBe(300);
    expect(intent.requestedStrategy).toBe("covered_call");
  });
});

// ---------------------------------------------------------------------------
// No fabrication / no profit guarantee — regression guard
// ---------------------------------------------------------------------------

describe("no fabrication / honest output", () => {
  it("parseTradeGoalInput never produces a non-empty 'opportunities found' count", () => {
    // Parser produces display-only intent — never a count of trades
    const intent = parseTradeGoalInput("Find income trades risking under $200");
    // There is no 'opportunitiesFound' field on TradeGoalIntent
    expect("opportunitiesFound" in intent).toBe(false);
  });

  it("constraintPhrases never contains 'guaranteed'", () => {
    const intent = parseTradeGoalInput("Find guaranteed income trades");
    for (const phrase of intent.constraintPhrases) {
      expect(phrase.toLowerCase()).not.toContain("guaranteed");
    }
  });

  it("summary never says 'will profit' or 'guaranteed'", () => {
    const testGoals = [
      "Find a sure-win trade",
      "Find guaranteed income",
      "100% win rate trades",
    ];
    for (const goal of testGoals) {
      const intent = parseTradeGoalInput(goal);
      expect(intent.summary.toLowerCase()).not.toContain("guaranteed");
      expect(intent.summary.toLowerCase()).not.toContain("will profit");
    }
  });
});
