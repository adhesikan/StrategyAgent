import { describe, it, expect } from "vitest";
import {
  classifyPortfolioTradePlan,
  portfolioGoalToMcpArgs,
  validatePortfolioTradePlan,
  buildPortfolioTradePlanAnswer,
  type PortfolioTradePlan,
  type PortfolioTradePlanGoal,
} from "./portfolio-trade-plan";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<PortfolioTradePlan> = {}): PortfolioTradePlan {
  return {
    feasibility: { feasible: true, reason: "All constraints met." },
    portfolioConstraints: [
      { name: "Dollar risk", status: "met", detail: "Max $300" },
    ],
    qualifiedCandidates: [
      { rank: 1, symbol: "AAPL", strategy: "Long Stock", whySelected: ["VCP setup"], warnings: [] },
    ],
    generatedAt: "2026-08-04T12:00:00.000Z",
    warnings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifyPortfolioTradePlan
// ---------------------------------------------------------------------------

describe("classifyPortfolioTradePlan — trigger patterns", () => {
  it("detects dollar-risk constraint", () => {
    const goal = classifyPortfolioTradePlan("Find a trade risking less than $500");
    expect(goal).not.toBeNull();
    expect(goal!.kind).toBe("dollar_risk");
    expect(goal!.maxRiskDollars).toBe(500);
  });

  it("detects dollar-risk with comma formatting", () => {
    const goal = classifyPortfolioTradePlan("Find a setup with max risk $1,200");
    expect(goal).not.toBeNull();
    expect(goal!.kind).toBe("dollar_risk");
    expect(goal!.maxRiskDollars).toBe(1200);
  });

  it("detects percent-of-portfolio constraint", () => {
    const goal = classifyPortfolioTradePlan("Find a trade using less than 5% of my portfolio");
    expect(goal).not.toBeNull();
    expect(goal!.kind).toBe("percent_of_portfolio");
    expect(goal!.maxRiskPercent).toBe(5);
  });

  it("detects percent-of-portfolio with account phrasing", () => {
    const goal = classifyPortfolioTradePlan("Show me ideas under 3% of my account");
    expect(goal).not.toBeNull();
    expect(goal!.kind).toBe("percent_of_portfolio");
    expect(goal!.maxRiskPercent).toBe(3);
  });

  it("detects sector exclusion with known sector name", () => {
    const goal = classifyPortfolioTradePlan("Find something outside my semiconductor exposure");
    expect(goal).not.toBeNull();
    expect(goal!.kind).toBe("sector_exclusion");
    expect(goal!.excludeSectors).toContain("semiconductor");
  });

  it("detects require-existing-position for covered call ask", () => {
    const goal = classifyPortfolioTradePlan("Find a covered call from stocks I own");
    expect(goal).not.toBeNull();
    expect(goal!.kind).toBe("require_existing_position");
    expect(goal!.requireExistingPosition).toBe(true);
  });

  it("detects income-from-holdings", () => {
    const goal = classifyPortfolioTradePlan("Generate income from my holdings");
    expect(goal).not.toBeNull();
    expect(goal!.kind).toBe("income_from_holdings");
    expect(goal!.requireExistingPosition).toBe(true);
    expect(goal!.objective).toBe("income");
  });

  it("detects income-from-positions variant", () => {
    const goal = classifyPortfolioTradePlan("Earn some income from my positions");
    expect(goal).not.toBeNull();
    expect(goal!.kind).toBe("income_from_holdings");
  });
});

describe("classifyPortfolioTradePlan — educational exclusions", () => {
  it("returns null for 'how does a covered call work'", () => {
    expect(classifyPortfolioTradePlan("How does a covered call work?")).toBeNull();
  });

  it("returns null for 'what is a cash secured put'", () => {
    expect(classifyPortfolioTradePlan("What is a cash secured put?")).toBeNull();
  });

  it("returns null for 'explain sector diversification'", () => {
    expect(classifyPortfolioTradePlan("Explain sector diversification in a portfolio")).toBeNull();
  });

  it("returns null for 'tell me about portfolio risk'", () => {
    expect(classifyPortfolioTradePlan("Tell me about portfolio risk management")).toBeNull();
  });

  it("returns null for plain analysis questions", () => {
    expect(classifyPortfolioTradePlan("Why is NVDA dropping?")).toBeNull();
  });

  it("returns null for specific-ticker asks", () => {
    // Specific ticker → stays on recommend_trade_strategy
    expect(classifyPortfolioTradePlan("Find a trade for AAPL risking less than $300", ["AAPL"])).toBeNull();
  });

  it("returns null for empty question", () => {
    expect(classifyPortfolioTradePlan("")).toBeNull();
  });

  it("returns null for generic 'find a trade' with no portfolio constraint", () => {
    expect(classifyPortfolioTradePlan("Find me a good trade today")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// portfolioGoalToMcpArgs — arg safety
// ---------------------------------------------------------------------------

describe("portfolioGoalToMcpArgs", () => {
  it("maps dollar-risk goal", () => {
    const goal: PortfolioTradePlanGoal = { kind: "dollar_risk", maxRiskDollars: 500 };
    const args = portfolioGoalToMcpArgs(goal);
    expect(args.maxRiskDollars).toBe(500);
    expect(args.numberOfIdeas).toBe(3);
  });

  it("caps maxRiskDollars at 100000", () => {
    const goal: PortfolioTradePlanGoal = { kind: "dollar_risk", maxRiskDollars: 999_999 };
    const args = portfolioGoalToMcpArgs(goal);
    expect(args.maxRiskDollars).toBe(100_000);
  });

  it("maps percent-of-portfolio goal", () => {
    const goal: PortfolioTradePlanGoal = { kind: "percent_of_portfolio", maxRiskPercent: 5 };
    const args = portfolioGoalToMcpArgs(goal);
    expect(args.maxRiskPercent).toBe(5);
    expect(args.maxRiskDollars).toBeUndefined();
  });

  it("maps sector exclusion goal", () => {
    const goal: PortfolioTradePlanGoal = {
      kind: "sector_exclusion",
      excludeSectors: ["semiconductor", "tech"],
    };
    const args = portfolioGoalToMcpArgs(goal);
    expect(args.excludeSectors).toEqual(["semiconductor", "tech"]);
  });

  it("maps income objective to options instrument preference", () => {
    const goal: PortfolioTradePlanGoal = {
      kind: "income_from_holdings",
      requireExistingPosition: true,
      objective: "income",
    };
    const args = portfolioGoalToMcpArgs(goal);
    expect(args.requireExistingPosition).toBe(true);
    expect(args.instrumentPreference).toBe("options");
  });

  it("NEVER includes portfolioContextToken or optionsContextToken", () => {
    const goal: PortfolioTradePlanGoal = { kind: "dollar_risk", maxRiskDollars: 300 };
    const args = portfolioGoalToMcpArgs(goal) as Record<string, unknown>;
    expect(args["portfolioContextToken"]).toBeUndefined();
    expect(args["optionsContextToken"]).toBeUndefined();
  });

  it("caps excludeSectors array at 10 items", () => {
    const sectors = Array.from({ length: 15 }, (_, i) => `sector${i}`);
    const goal: PortfolioTradePlanGoal = { kind: "sector_exclusion", excludeSectors: sectors };
    const args = portfolioGoalToMcpArgs(goal);
    expect(args.excludeSectors!.length).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// validatePortfolioTradePlan — sanitizer
// ---------------------------------------------------------------------------

describe("validatePortfolioTradePlan", () => {
  const validRaw = {
    feasibility: { feasible: true, reason: "Constraints met." },
    portfolioConstraints: [{ name: "Dollar risk", status: "met", detail: "Under $500" }],
    qualifiedCandidates: [{ rank: 1, symbol: "MSFT", strategy: "Long Stock", whySelected: ["VCP"], warnings: [] }],
    generatedAt: "2026-08-04T12:00:00.000Z",
    warnings: [],
  };

  it("accepts a valid payload", () => {
    const plan = validatePortfolioTradePlan(validRaw);
    expect(plan.feasibility.feasible).toBe(true);
    expect(plan.qualifiedCandidates.length).toBe(1);
    expect(plan.qualifiedCandidates[0].symbol).toBe("MSFT");
  });

  it("unwraps MCP content blocks", () => {
    const wrapped = { content: [{ type: "text", text: JSON.stringify(validRaw) }] };
    const plan = validatePortfolioTradePlan(wrapped);
    expect(plan.feasibility.feasible).toBe(true);
  });

  it("throws on non-JSON content block", () => {
    const bad = { content: [{ type: "text", text: "NOT JSON {{" }] };
    expect(() => validatePortfolioTradePlan(bad)).toThrow();
  });

  it("throws when feasibility field is missing", () => {
    const { feasibility: _, ...withoutFeasibility } = validRaw as any;
    expect(() => validatePortfolioTradePlan(withoutFeasibility)).toThrow();
  });

  it("NEVER alters feasibility.feasible", () => {
    const infeasible = { ...validRaw, feasibility: { feasible: false, reason: "Budget exceeded." } };
    const plan = validatePortfolioTradePlan(infeasible);
    expect(plan.feasibility.feasible).toBe(false);
  });

  it("drops sensitive keys silently", () => {
    const withSecrets = {
      ...validRaw,
      portfolioContextToken: "secret-token",
      optionsContextToken: "another-secret",
      accountId: "acc-123",
    };
    const plan = validatePortfolioTradePlan(withSecrets) as any;
    expect(plan.portfolioContextToken).toBeUndefined();
    expect(plan.optionsContextToken).toBeUndefined();
    expect(plan.accountId).toBeUndefined();
  });

  it("drops candidates with invalid symbol", () => {
    const withBad = {
      ...validRaw,
      qualifiedCandidates: [
        { rank: 1, symbol: "!INVALID!", strategy: "Long Stock", whySelected: [], warnings: [] },
        { rank: 2, symbol: "AAPL", strategy: "Long Stock", whySelected: [], warnings: [] },
      ],
    };
    const plan = validatePortfolioTradePlan(withBad);
    expect(plan.qualifiedCandidates.length).toBe(1);
    expect(plan.qualifiedCandidates[0].symbol).toBe("AAPL");
  });

  it("caps qualifiedCandidates at 10", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      rank: i + 1,
      symbol: `SY${i}`.slice(0, 5),
      whySelected: [],
      warnings: [],
    }));
    const plan = validatePortfolioTradePlan({ ...validRaw, qualifiedCandidates: many });
    expect(plan.qualifiedCandidates.length).toBeLessThanOrEqual(10);
  });

  it("accepts infeasible plan with no candidates", () => {
    const infeasible = {
      feasibility: { feasible: false, reason: "No matching setups." },
      portfolioConstraints: [],
      qualifiedCandidates: [],
      generatedAt: "2026-08-04T12:00:00.000Z",
      warnings: ["Market conditions unsuitable"],
    };
    const plan = validatePortfolioTradePlan(infeasible);
    expect(plan.feasibility.feasible).toBe(false);
    expect(plan.qualifiedCandidates.length).toBe(0);
    expect(plan.warnings).toHaveLength(1);
  });

  it("sanitizes alternatives array", () => {
    const withAlts = {
      ...validRaw,
      alternatives: [
        { symbol: "TSLA", strategy: "Long Stock", whyFailed: "Exceeds sector limit" },
        { whyFailed: "Insufficient data" },
        { symbol: "!BAD!", whyFailed: "Invalid" },
      ],
    };
    const plan = validatePortfolioTradePlan(withAlts);
    expect(plan.alternatives!.length).toBe(3); // all have whyFailed
    expect(plan.alternatives![2].symbol).toBeUndefined(); // !BAD! dropped but entry kept (whyFailed present)
  });

  it("throws on null payload", () => {
    expect(() => validatePortfolioTradePlan(null)).toThrow();
  });

  it("throws on array payload", () => {
    expect(() => validatePortfolioTradePlan([{ feasibility: { feasible: true } }])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildPortfolioTradePlanAnswer — headline / confidence
// ---------------------------------------------------------------------------

describe("buildPortfolioTradePlanAnswer", () => {
  it("headline reflects feasibility when infeasible", () => {
    const plan = makePlan({
      feasibility: { feasible: false, reason: "Budget exceeded." },
      qualifiedCandidates: [],
    });
    const goal: PortfolioTradePlanGoal = { kind: "dollar_risk", maxRiskDollars: 300 };
    const { headline } = buildPortfolioTradePlanAnswer(plan, goal);
    expect(headline.toLowerCase()).toContain("not feasible");
  });

  it("headline mentions dollar amount for dollar-risk goal", () => {
    const plan = makePlan();
    const goal: PortfolioTradePlanGoal = { kind: "dollar_risk", maxRiskDollars: 500 };
    const { headline } = buildPortfolioTradePlanAnswer(plan, goal);
    expect(headline).toMatch(/\$500/);
  });

  it("headline mentions percent for percent-of-portfolio goal", () => {
    const plan = makePlan();
    const goal: PortfolioTradePlanGoal = { kind: "percent_of_portfolio", maxRiskPercent: 5 };
    const { headline } = buildPortfolioTradePlanAnswer(plan, goal);
    expect(headline).toMatch(/5%/);
  });

  it("headline mentions sector for sector-exclusion goal", () => {
    const plan = makePlan();
    const goal: PortfolioTradePlanGoal = {
      kind: "sector_exclusion",
      excludeSectors: ["semiconductor"],
    };
    const { headline } = buildPortfolioTradePlanAnswer(plan, goal);
    expect(headline.toLowerCase()).toContain("semiconductor");
  });

  it("headline mentions holdings for income-from-holdings", () => {
    const plan = makePlan({ feasibility: { feasible: true } });
    const goal: PortfolioTradePlanGoal = { kind: "income_from_holdings", requireExistingPosition: true, objective: "income" };
    const { headline } = buildPortfolioTradePlanAnswer(plan, goal);
    expect(headline.toLowerCase()).toMatch(/income|holdings/);
  });

  it("confidence is medium when feasible with candidates", () => {
    const plan = makePlan();
    const goal: PortfolioTradePlanGoal = { kind: "dollar_risk", maxRiskDollars: 500 };
    const { confidence } = buildPortfolioTradePlanAnswer(plan, goal);
    expect(confidence).toBe("medium");
  });

  it("confidence is low when feasible but no candidates", () => {
    const plan = makePlan({ qualifiedCandidates: [] });
    const goal: PortfolioTradePlanGoal = { kind: "dollar_risk", maxRiskDollars: 500 };
    const { confidence } = buildPortfolioTradePlanAnswer(plan, goal);
    expect(confidence).toBe("low");
  });

  it("confidence is low when infeasible", () => {
    const plan = makePlan({ feasibility: { feasible: false }, qualifiedCandidates: [] });
    const goal: PortfolioTradePlanGoal = { kind: "dollar_risk", maxRiskDollars: 500 };
    const { confidence } = buildPortfolioTradePlanAnswer(plan, goal);
    expect(confidence).toBe("low");
  });

  it("answer includes feasibility verdict", () => {
    const plan = makePlan();
    const goal: PortfolioTradePlanGoal = { kind: "dollar_risk", maxRiskDollars: 500 };
    const { answer } = buildPortfolioTradePlanAnswer(plan, goal);
    expect(answer.toLowerCase()).toContain("feasibility");
  });

  it("riskNote mentions not investment advice", () => {
    const plan = makePlan();
    const goal: PortfolioTradePlanGoal = { kind: "dollar_risk", maxRiskDollars: 500 };
    const { riskNote } = buildPortfolioTradePlanAnswer(plan, goal);
    expect(riskNote.toLowerCase()).toContain("not investment advice");
  });

  it("keyPoints include feasibility and candidate count", () => {
    const plan = makePlan();
    const goal: PortfolioTradePlanGoal = { kind: "dollar_risk", maxRiskDollars: 500 };
    const { keyPoints } = buildPortfolioTradePlanAnswer(plan, goal);
    expect(keyPoints.some((kp) => kp.toLowerCase().includes("feasible"))).toBe(true);
    expect(keyPoints.some((kp) => kp.includes("1"))).toBe(true);
  });
});
