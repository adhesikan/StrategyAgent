// Ranked market trade search (rank_market_trade_candidates integration).
// Covers routing, goal normalization (false-ticker safety), defensive
// validation, count semantics, deterministic headlines, risk presentation,
// failure safety, and secret hygiene.
import { describe, expect, it } from "vitest";

import {
  buildRankedTradeSearchAnswer,
  classifyRankedTradeSearch,
  rankedGoalToMcpArgs,
  rankedTradeSearchHeadline,
  runRankedTradeSearch,
  validateRankedTradeSearch,
  type RankedTradeSearch,
} from "./ranked-trade-search";

function payload(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    request: { direction: "bullish", numberOfIdeas: 3 },
    reviewedCount: 50,
    qualifiedCount: 0,
    watchCount: 0,
    rejectedCount: 0,
    unavailableCount: 0,
    candidates: [],
    watchCandidates: [],
    rejectionSummary: [],
    generatedAt: "2026-08-04T00:00:00.000Z",
    warnings: [],
    ...overrides,
  };
}

const candidate = (over: Record<string, unknown> = {}) => ({
  rank: 1,
  symbol: "NVDA",
  strategy: "vcp",
  setupStatus: "actionable",
  trigger: "Break above 190.50",
  invalidation: "184.20",
  objective: "205",
  rewardRisk: 2.4,
  maxRisk: 280,
  quantity: 44,
  dataQuality: "real",
  whySelected: ["Tight contraction", "Volume dry-up"],
  warnings: [],
  ...over,
});

describe("routing (spec §2)", () => {
  it("routes 'Find three bullish trades' to the market-wide ranking flow with the exact count", () => {
    const goal = classifyRankedTradeSearch("Find three bullish trades", []);
    expect(goal).not.toBeNull();
    expect(goal!.direction).toBe("bullish");
    expect(goal!.numberOfIdeas).toBe(3);
    expect(goal!.symbol).toBeUndefined();
    expect(rankedGoalToMcpArgs(goal!).numberOfIdeas).toBe(3);
  });

  it("parses 'Find a stock trade under $300 risk' with NO symbol (STOCK/UNDER/RISK never become tickers)", () => {
    const goal = classifyRankedTradeSearch("Find a stock trade under $300 risk", ["STOCK", "UNDER", "RISK"]);
    expect(goal).not.toBeNull();
    expect(goal!.symbol).toBeUndefined();
    expect(goal!.instrumentPreference).toBe("stock");
    expect(goal!.maxRiskDollars).toBe(300);
  });

  it("parses 'Find an options trade under $500 max loss' with no false ticker (MAX/LOSS)", () => {
    const goal = classifyRankedTradeSearch("Find an options trade under $500 max loss", ["MAX", "LOSS"]);
    expect(goal).not.toBeNull();
    expect(goal!.symbol).toBeUndefined();
    expect(goal!.instrumentPreference).toBe("options");
    expect(goal!.maxRiskDollars).toBe(500);
  });

  it("keeps 'Find a trade for NVDA' on the single-symbol recommendation flow", () => {
    expect(classifyRankedTradeSearch("Find a trade for NVDA", ["NVDA"])).toBeNull();
  });

  it("keeps 'Analyze BA' on the analysis flow", () => {
    expect(classifyRankedTradeSearch("Analyze BA", ["BA"])).toBeNull();
  });

  it("keeps education asks ('What is a credit spread?') educational", () => {
    expect(classifyRankedTradeSearch("What is a credit spread?", [])).toBeNull();
  });

  it("routes broad phrasings: what should I trade today / best trades / worth watching / income", () => {
    expect(classifyRankedTradeSearch("What should I trade today?", [])).not.toBeNull();
    expect(classifyRankedTradeSearch("Find the best trades today", [])).not.toBeNull();
    expect(classifyRankedTradeSearch("Show trades worth watching", [])).not.toBeNull();
    const income = classifyRankedTradeSearch("Find income opportunities", []);
    expect(income).not.toBeNull();
    expect(income!.objective).toBe("income");
  });
});

describe("MCP argument mapping (spec §4 — model-safe args only)", () => {
  it("never passes identity, account, connection, or credential fields", () => {
    const goal = classifyRankedTradeSearch("Find three bullish trades under $500 max loss", [])!;
    const args = rankedGoalToMcpArgs(goal) as Record<string, unknown>;
    const keys = Object.keys(args).join(" ").toLowerCase();
    for (const banned of ["user", "account", "connection", "token", "key", "credential", "secret", "broker"]) {
      expect(keys).not.toContain(banned);
    }
  });

  it("calls the rank dependency exactly once per request", async () => {
    let calls = 0;
    await runRankedTradeSearch({ direction: "bullish", numberOfIdeas: 2 }, {
      rank: async () => {
        calls += 1;
        return payload();
      },
    });
    expect(calls).toBe(1);
  });
});

describe("defensive validation (spec §5)", () => {
  it("normalizes a valid payload and preserves candidate/watch buckets separately", () => {
    const s = validateRankedTradeSearch(
      payload({
        qualifiedCount: 1,
        watchCount: 1,
        rejectedCount: 2,
        candidates: [candidate()],
        watchCandidates: [{ symbol: "AMD", strategy: "vcp", currentStage: "contraction", missingConfirmation: "volume", watchConditions: ["Hold above 150"] }],
        rejectionSummary: [{ reason: "missing trigger", count: 2, symbols: ["BA", "DIS"] }],
      }),
    );
    expect(s.candidates).toHaveLength(1);
    expect(s.candidates[0].symbol).toBe("NVDA");
    expect(s.watchCandidates).toHaveLength(1);
    expect(s.watchCandidates[0].symbol).toBe("AMD");
    expect(s.rejectionSummary[0]).toEqual({ reason: "missing trigger", count: 2, symbols: ["BA", "DIS"] });
  });

  it("unwraps MCP content blocks and rejects garbage payloads", () => {
    const wrapped = { content: [{ type: "text", text: JSON.stringify(payload()) }] };
    expect(validateRankedTradeSearch(wrapped).reviewedCount).toBe(50);
    expect(() => validateRankedTradeSearch(null)).toThrow();
    expect(() => validateRankedTradeSearch({ nonsense: true })).toThrow();
    expect(() => validateRankedTradeSearch({ content: [{ type: "text", text: "not json" }] })).toThrow();
  });

  it("drops candidates with invalid symbols and strips sensitive-looking request keys", () => {
    const s = validateRankedTradeSearch(
      payload({
        candidates: [candidate(), { ...candidate(), symbol: "UNDER-$300!" }, { ...candidate(), symbol: undefined }],
        request: { direction: "bullish", optionsContextToken: "leak-me", userId: "u1", accountId: "a1", apiKey: "k" },
      }),
    );
    expect(s.candidates).toHaveLength(1);
    expect(JSON.stringify(s.request)).not.toMatch(/leak-me|u1|a1|apiKey|Token/i);
  });

  it("clamps counts to non-negative integers and tolerates missing arrays", () => {
    const s = validateRankedTradeSearch(payload({ reviewedCount: -3, qualifiedCount: "x", watchCandidates: undefined, rejectionSummary: "bad" }));
    expect(s.reviewedCount).toBe(0);
    expect(s.qualifiedCount).toBe(0);
    expect(s.watchCandidates).toEqual([]);
    expect(s.rejectionSummary).toEqual([]);
  });
});

describe("count semantics (spec §5 — buckets need not sum to reviewedCount)", () => {
  it("accepts bucket counts that do not sum to reviewedCount and labels reviewedCount as raw stored opportunities", () => {
    const s = validateRankedTradeSearch(payload({ reviewedCount: 50, qualifiedCount: 1, watchCount: 1, rejectedCount: 3, unavailableCount: 0, candidates: [candidate()] }));
    // 1+1+3+0 = 5 !== 50 — must be preserved untouched, never "fixed".
    expect(s.reviewedCount).toBe(50);
    expect(s.qualifiedCount + s.watchCount + s.rejectedCount + s.unavailableCount).not.toBe(s.reviewedCount);
    const a = buildRankedTradeSearchAnswer(s);
    expect(a.answer).toContain("Stored opportunities reviewed: 50");
    expect(a.answer).toContain("Candidate buckets are formed after confluence and actionability checks");
    expect(a.keyPoints[0]).toBe("Stored opportunities reviewed: 50");
  });
});

describe("deterministic headlines (spec §6)", () => {
  const base = (over: Partial<RankedTradeSearch>) => validateRankedTradeSearch(payload()) && ({ ...validateRankedTradeSearch(payload()), ...over } as RankedTradeSearch);

  it("qualified-only: 'Three bullish trade candidates identified.'", () => {
    const s = base({ candidates: [1, 2, 3].map((r) => ({ ...validateRankedTradeSearch(payload({ candidates: [candidate({ rank: r })] })).candidates[0], rank: r })), qualifiedCount: 3 });
    expect(rankedTradeSearchHeadline(s, { direction: "bullish" })).toBe("Three bullish trade candidates identified.");
  });

  it("mixed: reviewed; qualified and worth watching", () => {
    const s = base({
      reviewedCount: 8,
      candidates: [validateRankedTradeSearch(payload({ candidates: [candidate()] })).candidates[0], validateRankedTradeSearch(payload({ candidates: [candidate({ symbol: "AMD" })] })).candidates[0]],
      watchCandidates: [
        { symbol: "BA", watchConditions: [] },
        { symbol: "DIS", watchConditions: [] },
        { symbol: "MU", watchConditions: [] },
      ],
    });
    expect(rankedTradeSearchHeadline(s)).toBe("Eight opportunities were reviewed; two qualified and three are worth watching.");
  });

  it("watch-only: no candidates qualify but setups are worth watching", () => {
    const s = base({ watchCandidates: [{ symbol: "BA", watchConditions: [] }, { symbol: "DIS", watchConditions: [] }, { symbol: "MU", watchConditions: [] }] });
    expect(rankedTradeSearchHeadline(s)).toBe("No trade candidates currently qualify, but three setups are worth watching.");
  });

  it("all rejected: candidates evaluated but none qualify", () => {
    const s = base({ reviewedCount: 5, rejectedCount: 5 });
    expect(rankedTradeSearchHeadline(s)).toBe("Candidates were evaluated, but none currently qualify as trades.");
  });

  it("unavailable-dominated: data unavailable headline", () => {
    const s = base({ reviewedCount: 0, unavailableCount: 4 });
    expect(rankedTradeSearchHeadline(s)).toBe("Candidates could not be qualified because required data was unavailable.");
  });

  it("risk-constrained no-result headline names the limit (spec §8)", () => {
    const s = base({ reviewedCount: 10, rejectedCount: 10, maxRiskDollars: 300 });
    expect(rankedTradeSearchHeadline(s)).toBe("No candidate met the $300 maximum-risk limit.");
    const a = buildRankedTradeSearchAnswer(s);
    expect(a.answer).toContain("No candidate met the $300 maximum-risk limit.");
  });
});

describe("risk presentation (spec §8)", () => {
  it("shows requested risk + calculated risk for qualified stock candidates", () => {
    const s = validateRankedTradeSearch(payload({ qualifiedCount: 1, candidates: [candidate()] }), { maxRiskDollars: 300 });
    const a = buildRankedTradeSearchAnswer(s);
    expect(a.answer).toContain("Requested maximum risk: $300");
    expect(a.answer).toContain("max risk $280");
    expect(a.answer).toContain("qty 44");
  });

  it("never claims exact premium-derived risk for estimated options candidates", () => {
    const s = validateRankedTradeSearch(payload({ qualifiedCount: 1, candidates: [candidate({ dataQuality: "estimated", instrument: "options" })] }));
    expect(s.candidates[0].maxRiskIsExact).toBe(false);
    const a = buildRankedTradeSearchAnswer(s);
    expect(a.answer).toContain("estimated max risk $280");
    expect(a.answer).not.toContain("— max risk $280");
  });

  it("marks live/real data candidates as exact", () => {
    const s = validateRankedTradeSearch(payload({ candidates: [candidate({ dataQuality: "live" })] }));
    expect(s.candidates[0].maxRiskIsExact).toBe(true);
  });
});

describe("deterministic order + failure safety (spec §10, §1)", () => {
  it("preserves the MCP ranking order verbatim in the server summary", () => {
    const s = validateRankedTradeSearch(
      payload({ candidates: [candidate({ rank: 1, symbol: "NVDA" }), candidate({ rank: 2, symbol: "AMD" }), candidate({ rank: 3, symbol: "MU" })] }),
    );
    const a = buildRankedTradeSearchAnswer(s);
    const order = ["NVDA", "AMD", "MU"].map((x) => a.answer.indexOf(`. ${x}`));
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it("MCP failure propagates as an error (caller falls back to the safe flow) — never fabricated candidates", async () => {
    await expect(
      runRankedTradeSearch({ direction: "bullish" }, { rank: async () => { throw new Error("MCP unavailable"); } }),
    ).rejects.toThrow("MCP unavailable");
  });

  it("all-zero buckets with a nonzero review count stays honest (live edge case)", () => {
    const s = validateRankedTradeSearch(payload());
    const a = buildRankedTradeSearchAnswer(s, { direction: "bullish" });
    expect(a.headline).toBe("Candidates were evaluated, but none currently qualify as trades.");
    expect(a.answer).toContain("Stored opportunities reviewed: 50");
  });

  it("ranked LLM containment: callOpenAi hard-disables tools for rankedTradeSearch (regression guard)", async () => {
    // The enforcement lives inside callOpenAi (not exported); guard the
    // pattern at source level the same way the other deterministic flows
    // (opportunitySearch/strategyRec/multiStrategy) are enforced.
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("./ask.ts", import.meta.url), "utf8");
    const branch = src.slice(src.indexOf("if (opts.rankedTradeSearch) {"));
    const upToRules = branch.slice(0, branch.indexOf("mcpSystemRules"));
    expect(upToRules).toContain("mcpTools = []");
  });

  it("contract drift guard: alternate live field names still populate candidates and watch cards", () => {
    const s = validateRankedTradeSearch(
      payload({
        qualifiedCount: 1,
        watchCount: 1,
        candidates: [{
          rank: 1,
          ticker: "NVDA", // alternate for symbol
          strategyName: "vcp", // alternate for strategy
          status: "actionable", // alternate for setupStatus
          entryTrigger: "Break above 190.50",
          stop: "184.20",
          target: "205",
          rewardRiskRatio: 2.4,
          maxRiskDollars: 280,
          suggestedQuantity: 44,
          dataSource: "live",
          rankReasons: ["Tight contraction"],
        }],
        watchCandidates: [{ ticker: "AMD", strategyName: "vcp", stage: "contraction", blockedBy: "volume", watchFor: ["Hold above 150"] }],
      }),
    );
    expect(s.candidates).toHaveLength(1);
    const c = s.candidates[0];
    expect(c.symbol).toBe("NVDA");
    expect(c.strategy).toBe("vcp");
    expect(c.setupStatus).toBe("actionable");
    expect(c.trigger).toBe("Break above 190.50");
    expect(c.invalidation).toBe("184.20");
    expect(c.rewardRisk).toBe(2.4);
    expect(c.maxRisk).toBe(280);
    expect(c.maxRiskIsExact).toBe(true);
    expect(c.quantity).toBe(44);
    expect(c.whySelected).toEqual(["Tight contraction"]);
    const w = s.watchCandidates[0];
    expect(w.symbol).toBe("AMD");
    expect(w.currentStage).toBe("contraction");
    expect(w.missingConfirmation).toBe("volume");
    expect(w.watchConditions).toEqual(["Hold above 150"]);
  });

  it("no execution: output contains no order-placement language or endpoints", () => {
    const s = validateRankedTradeSearch(payload({ qualifiedCount: 1, candidates: [candidate()] }));
    const a = buildRankedTradeSearchAnswer(s);
    expect(a.riskNote).toContain("Nothing here places or prepares an order automatically");
    expect(JSON.stringify(a)).not.toMatch(/place\s+order|submit\s+order|execute\s+trade/i);
  });
});

// ---------------------------------------------------------------------------
// Exclusion accounting — new MCP contract fields
// ---------------------------------------------------------------------------

import { rankedTradeSearchSuggestions, translateExclusionReason } from "./ranked-trade-search";

describe("exclusion accounting (MCP exclusion-accounting contract)", () => {
  // 1. All excluded due to missing trigger
  it("1. all excluded NOT_ACTIONABLE_NO_TRIGGER — correct headline, exclusion count preserved, no bucket counts", () => {
    const s = validateRankedTradeSearch(payload({
      groupedCandidateCount: 0,
      excludedCount: 50,
      exclusionSummary: [{ reason: "NOT_ACTIONABLE_NO_TRIGGER", count: 50 }],
    }));
    expect(s.excludedCount).toBe(50);
    expect(s.groupedCandidateCount).toBe(0);
    expect(s.exclusionSummary).toEqual([{ reason: "NOT_ACTIONABLE_NO_TRIGGER", count: 50 }]);
    const h = rankedTradeSearchHeadline(s);
    expect(h).toBe("Stored setups were reviewed, but none had an actionable entry trigger.");
    expect(h).not.toMatch(/qualify|criteria|rejected|nothing/i);
  });

  // 2. Mixed exclusions
  it("2. mixed exclusions — primary reason drives headline, all groups preserved", () => {
    const s = validateRankedTradeSearch(payload({
      groupedCandidateCount: 0,
      excludedCount: 30,
      exclusionSummary: [
        { reason: "NOT_ACTIONABLE_NO_TRIGGER", count: 20 },
        { reason: "STALE", count: 10 },
      ],
    }));
    expect(s.exclusionSummary).toHaveLength(2);
    expect(s.excludedCount).toBe(30);
    // Primary = NOT_ACTIONABLE_NO_TRIGGER (count 20 > 10)
    const h = rankedTradeSearchHeadline(s);
    expect(h).toContain("actionable entry trigger");
  });

  // 3. groupedCandidateCount zero, no exclusions in summary — fallback headline
  it("3. groupedCandidateCount zero with no exclusionSummary — generic 'no actionable candidates' headline", () => {
    const s = validateRankedTradeSearch(payload({
      groupedCandidateCount: 0,
      excludedCount: 5,
      exclusionSummary: [], // empty — no reason given
    }));
    const h = rankedTradeSearchHeadline(s);
    expect(h).toBe("Stored setups were reviewed, but none formed actionable candidates.");
  });

  // 4. Qualified buckets after grouping — normal headline, exclusions still surfaced
  it("4. qualified buckets with some exclusions — qualification headline takes priority", () => {
    const s = validateRankedTradeSearch(payload({
      qualifiedCount: 1,
      groupedCandidateCount: 3,
      excludedCount: 47,
      exclusionSummary: [{ reason: "STALE", count: 47 }],
      candidates: [candidate()],
    }));
    const h = rankedTradeSearchHeadline(s);
    expect(h).toContain("One");
    // Exclusion info still present in the answer narrative
    const a = buildRankedTradeSearchAnswer(s);
    expect(a.answer).toContain("Excluded before qualification");
    expect(a.answer).toContain("Stored setup was stale");
    expect(a.answer).toContain("not rejections");
  });

  // 5. All unavailable — specific unavailable headline
  it("5. all unavailable, no exclusions — 'data unavailable' headline", () => {
    const s = validateRankedTradeSearch(payload({ unavailableCount: 10 }));
    const h = rankedTradeSearchHeadline(s);
    expect(h).toBe("Candidates could not be qualified because required data was unavailable.");
  });

  // 6. All rejected (qualification occurred) — evaluation headline
  it("6. all rejected — 'candidates evaluated' headline, NOT exclusion headline", () => {
    const s = validateRankedTradeSearch(payload({
      rejectedCount: 50,
      rejectionSummary: [{ reason: "LOW_SCORE", count: 50, symbols: [] }],
    }));
    const h = rankedTradeSearchHeadline(s);
    expect(h).toBe("Candidates were evaluated, but none currently qualify as trades.");
    expect(h).not.toContain("trigger");
  });

  // 7. reviewedCount > groupedCandidateCount — counts preserved correctly
  it("7. reviewedCount > groupedCandidateCount — both counts independent in output", () => {
    const s = validateRankedTradeSearch(payload({
      reviewedCount: 100,
      groupedCandidateCount: 5,
      excludedCount: 95,
      exclusionSummary: [{ reason: "DIRECTION_MISMATCH", count: 95 }],
    }));
    expect(s.reviewedCount).toBe(100);
    expect(s.groupedCandidateCount).toBe(5);
    expect(s.excludedCount).toBe(95);
    const a = buildRankedTradeSearchAnswer(s);
    expect(a.answer).toContain("Stored opportunities reviewed: 100");
    expect(a.answer).toContain("Post-confluence candidates: 5");
    expect(a.answer).toContain("Excluded before qualification: 95");
  });

  // 8. Unknown exclusion reason — humanized conservatively
  it("8. unknown exclusion reason — humanized without inventing meaning", () => {
    expect(translateExclusionReason("NOT_ACTIONABLE_NO_TRIGGER")).toBe("No actionable trigger was available");
    expect(translateExclusionReason("STALE")).toBe("Stored setup was stale");
    expect(translateExclusionReason("DIRECTION_MISMATCH")).toBe("Setup direction did not match the request");
    expect(translateExclusionReason("INVALID_SETUP")).toBe("Stored setup was not structurally valid");
    expect(translateExclusionReason("SIMULATED_DATA_NOT_ELIGIBLE")).toBe("Only simulated data was available");
    const unknown = translateExclusionReason("FUTURE_UNKNOWN_CODE");
    expect(unknown).toBe("Future Unknown Code");
    expect(unknown).not.toMatch(/rejected|failed|poor|bad|invalid/i);
  });

  // 9. Malformed exclusion entries — dropped without crashing
  it("9. malformed exclusionSummary entries — silently dropped, valid entries kept", () => {
    const s = validateRankedTradeSearch(payload({
      excludedCount: 10,
      exclusionSummary: [
        null,
        { count: 5 },                          // missing reason
        { reason: "", count: 5 },              // empty reason
        { reason: "STALE", count: -1 },        // negative count → clamped to 0
        { reason: "NOT_ACTIONABLE_NO_TRIGGER", count: 10 },  // valid
      ],
    }));
    expect(s.exclusionSummary).toHaveLength(2); // STALE(0) + NOT_ACTIONABLE(10)
    const stale = s.exclusionSummary!.find((e) => e.reason === "STALE")!;
    expect(stale.count).toBe(0); // clamped
  });

  // 10. Headline semantics — three headlines semantically distinct
  it("10. three empty-result headlines are semantically distinct", () => {
    const excluded = validateRankedTradeSearch(payload({
      groupedCandidateCount: 0,
      excludedCount: 10,
      exclusionSummary: [{ reason: "NOT_ACTIONABLE_NO_TRIGGER", count: 10 }],
    }));
    const unavailable = validateRankedTradeSearch(payload({ unavailableCount: 10 }));
    const rejected = validateRankedTradeSearch(payload({ rejectedCount: 10 }));

    const hExcluded = rankedTradeSearchHeadline(excluded);
    const hUnavail = rankedTradeSearchHeadline(unavailable);
    const hRejected = rankedTradeSearchHeadline(rejected);

    expect(hExcluded).toContain("actionable entry trigger");
    expect(hUnavail).toContain("unavailable");
    expect(hRejected).toContain("evaluated");
    // All three must differ
    expect(new Set([hExcluded, hUnavail, hRejected]).size).toBe(3);
    // None should use the forbidden phrase
    for (const h of [hExcluded, hUnavail, hRejected]) {
      expect(h).not.toMatch(/nothing meets the quality criteria/i);
    }
  });

  // 11. No Trade Builder in suggestions for NOT_ACTIONABLE_NO_TRIGGER
  it("11. NOT_ACTIONABLE_NO_TRIGGER suggestions exclude Trade Builder, include scanner/watchlist", () => {
    const s = validateRankedTradeSearch(payload({
      groupedCandidateCount: 0,
      excludedCount: 50,
      exclusionSummary: [{ reason: "NOT_ACTIONABLE_NO_TRIGGER", count: 50 }],
    }));
    const suggs = rankedTradeSearchSuggestions(s);
    const labels = suggs.map((x) => x.label);
    expect(labels).toContain("Open Scanner");
    expect(labels).toContain("Review Watchlist");
    expect(labels).toContain("Run a Fresh Scan");
    expect(labels).toContain("View Stored Setups");
    expect(labels.join(" ")).not.toMatch(/trade builder/i);
  });

  // 12. Backward compatibility — old payloads without new fields
  it("12. backward compatibility — old payload without groupedCandidateCount/excludedCount/exclusionSummary still validates", () => {
    const s = validateRankedTradeSearch(payload()); // plain old payload
    expect(s.groupedCandidateCount).toBeUndefined();
    expect(s.excludedCount).toBeUndefined();
    expect(s.exclusionSummary).toBeUndefined();
    expect(s.reviewedCount).toBe(50);
    expect(s.qualifiedCount).toBe(0);
    // Headline falls through to the post-rejection path (reviewedCount > 0)
    const h = rankedTradeSearchHeadline(s);
    expect(h).toBe("Candidates were evaluated, but none currently qualify as trades.");
  });

  // 13. OpenAI cannot call exclusions qualified rejections — system rule present
  it("13. LLM system rule distinguishes exclusion from rejection (source-level guard)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("./ask.ts", import.meta.url), "utf8");
    expect(src).toContain("exclusionSummary");
    expect(src).toContain("pre-qualification filtering");
    expect(src).toContain("NOT quality rejections");
    expect(src).toContain("not a quality verdict");
  });
});
