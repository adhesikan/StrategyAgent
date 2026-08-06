// Tests for Sprint 2.1.1 — Evidence Engine
//
// Covers: scorecard star ratings, deterministic AI summary bullets,
// catalysts derivation, tab navigation structure, and provider isolation.

import { describe, it, expect } from "vitest";
import {
  computeEvidenceStars,
  buildAiSummaryBullets,
  type EvidenceStars,
  type SentimentResponse,
} from "./opportunity-research";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<{
  confidence: string;
  whySelected: string[];
  warnings: string[];
  strategy: string;
  trigger: string;
  invalidation: string | undefined;
  maxRisk: number;
  rank: number;
  setupStatus: string;
}> = {}) {
  return {
    rank: overrides.rank ?? 1,
    symbol: "NVDA",
    strategy: overrides.strategy ?? "VCP",
    setupStatus: overrides.setupStatus,
    confidence: overrides.confidence ?? "high",
    whySelected: overrides.whySelected ?? ["Strong RS", "Volume dry-up", "Near pivot"],
    warnings: overrides.warnings ?? [],
    trigger: overrides.trigger ?? "135.50",
    // Use `in` check so callers can explicitly pass undefined to suppress the default
    invalidation: "invalidation" in overrides ? overrides.invalidation : "128.00",
    maxRisk: overrides.maxRisk ?? 500,
  };
}

function makePkg(candidateOverrides = {}, pkgOverrides: Partial<{
  marketRegime: string | null;
  lifecycleItem: any;
  scanHistory: any[];
  brokerConnected: boolean;
  freshnessStatus: "fresh" | "stale";
}> = {}) {
  return {
    symbol: "NVDA",
    candidate: makeCandidate(candidateOverrides),
    lifecycleItem: pkgOverrides.lifecycleItem ?? null,
    scanHistory: pkgOverrides.scanHistory ?? [],
    brokerConnected: pkgOverrides.brokerConnected ?? false,
    marketRegime: pkgOverrides.marketRegime !== undefined ? pkgOverrides.marketRegime : "TRENDING",
    dataSource: "mcp-v1",
    dataQuality: "good",
    freshnessStatus: pkgOverrides.freshnessStatus ?? "fresh",
    completedAt: new Date().toISOString(),
    snapshotId: "snap-001",
  };
}

function makeLifecycleItem(overrides: Partial<{
  lifecycleState: string;
  rankCurrent: number | null;
  rankPrev: number | null;
  scoreCurrent: number;
  scorePrev: number;
  scoreDelta: number;
  firstSeen: string | null;
}> = {}) {
  return {
    symbol: "NVDA",
    lifecycleState: overrides.lifecycleState ?? "NEWLY_QUALIFIED",
    qualificationStatus: "QUALIFIED" as const,
    rankCurrent: overrides.rankCurrent !== undefined ? overrides.rankCurrent : 1,
    rankPrev: overrides.rankPrev !== undefined ? overrides.rankPrev : null,
    scoreCurrent: overrides.scoreCurrent ?? 85,
    scorePrev: overrides.scorePrev ?? 0,
    scoreDelta: overrides.scoreDelta ?? 85,
    firstSeen: overrides.firstSeen !== undefined ? overrides.firstSeen : new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

function makeSentimentResponse(articleCount: number): SentimentResponse {
  return {
    symbol: "NVDA",
    snapshot: {
      overallSentiment: articleCount > 0 ? "bullish" : undefined,
      sentimentScore: articleCount > 0 ? 0.72 : undefined,
      articleCount,
    },
    articles: Array.from({ length: articleCount }, (_, i) => ({
      id: `art-${i}`,
      headline: `Article headline ${i}`,
      source: "Reuters",
      url: `https://example.com/${i}`,
      publishedAt: new Date().toISOString(),
      summary: "Summary text",
      whyItMatters: "Why it matters text",
      sentimentLabel: "bullish",
      sentimentScore: 0.8,
      impactLevel: "medium",
      bullishDrivers: [],
      bearishDrivers: [],
      riskWarnings: [],
    })),
    stale: false,
    disclaimer: "Not investment advice",
  };
}

function makeSnapshot(regime: string, highImpact = false) {
  return {
    marketRegime: { regime, strength: 0.8, description: `${regime} regime` },
    topNews: highImpact
      ? [{ symbol: "SPY", label: "bearish", impact: "high", whyItMatters: "Fed risk", buzz: 80, articleCount: 12 }]
      : [],
    asOf: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// computeEvidenceStars — Technical scoring
// ---------------------------------------------------------------------------

describe("computeEvidenceStars — technical", () => {
  it("returns 5 stars for high confidence + ≥3 whySelected", () => {
    const pkg = makePkg({ confidence: "high", whySelected: ["A", "B", "C"] });
    const stars = computeEvidenceStars(pkg as any, null, undefined);
    expect(stars.technical).toBe(5);
  });

  it("returns 4 stars for high confidence + 1 whySelected", () => {
    const pkg = makePkg({ confidence: "high", whySelected: ["A"] });
    const stars = computeEvidenceStars(pkg as any, null, undefined);
    expect(stars.technical).toBe(4);
  });

  it("returns 3 stars for medium confidence", () => {
    const pkg = makePkg({ confidence: "medium", whySelected: ["A", "B", "C"] });
    const stars = computeEvidenceStars(pkg as any, null, undefined);
    expect(stars.technical).toBe(3);
  });

  it("returns 2 stars for low confidence", () => {
    const pkg = makePkg({ confidence: "low", whySelected: ["A", "B", "C"] });
    const stars = computeEvidenceStars(pkg as any, null, undefined);
    expect(stars.technical).toBe(2);
  });

  it("returns 1 star when confidence is missing", () => {
    const pkg = makePkg({ confidence: "" });
    const stars = computeEvidenceStars(pkg as any, null, undefined);
    expect(stars.technical).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeEvidenceStars — Congress (always 3)
// ---------------------------------------------------------------------------

describe("computeEvidenceStars — congress", () => {
  it("always returns 3 regardless of other data", () => {
    const pkg = makePkg();
    expect(computeEvidenceStars(pkg as any, null, undefined).congress).toBe(3);
  });

  it("returns 3 even with no lifecycle or news data", () => {
    const pkg = makePkg({ confidence: "low", whySelected: [] }, { marketRegime: null });
    expect(computeEvidenceStars(pkg as any, null, undefined).congress).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// computeEvidenceStars — News scoring
// ---------------------------------------------------------------------------

describe("computeEvidenceStars — news", () => {
  it("returns 5 stars for ≥5 articles", () => {
    const stars = computeEvidenceStars(makePkg() as any, makeSentimentResponse(5), undefined);
    expect(stars.news).toBe(5);
  });

  it("returns 4 stars for 3–4 articles", () => {
    expect(computeEvidenceStars(makePkg() as any, makeSentimentResponse(3), undefined).news).toBe(4);
    expect(computeEvidenceStars(makePkg() as any, makeSentimentResponse(4), undefined).news).toBe(4);
  });

  it("returns 3 stars for exactly 1 article", () => {
    expect(computeEvidenceStars(makePkg() as any, makeSentimentResponse(1), undefined).news).toBe(3);
  });

  it("returns 1 star when news data is null", () => {
    expect(computeEvidenceStars(makePkg() as any, null, undefined).news).toBe(1);
  });

  it("returns 1 star when 0 articles", () => {
    expect(computeEvidenceStars(makePkg() as any, makeSentimentResponse(0), undefined).news).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeEvidenceStars — Institutional (always 0)
// ---------------------------------------------------------------------------

describe("computeEvidenceStars — institutional", () => {
  it("always returns 0 (unavailable)", () => {
    const stars = computeEvidenceStars(makePkg() as any, null, undefined);
    expect(stars.institutional).toBe(0);
  });

  it("returns 0 even with full data", () => {
    const stars = computeEvidenceStars(makePkg() as any, makeSentimentResponse(10), makeSnapshot("TRENDING") as any);
    expect(stars.institutional).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeEvidenceStars — Catalysts scoring
// ---------------------------------------------------------------------------

describe("computeEvidenceStars — catalysts", () => {
  it("returns 3 when ≥2 warnings", () => {
    const pkg = makePkg({ warnings: ["Earnings risk", "Low volume"] });
    expect(computeEvidenceStars(pkg as any, null, undefined).catalysts).toBe(3);
  });

  it("returns 3 when high-impact market news exists", () => {
    const pkg = makePkg({ warnings: [] });
    const snapshot = makeSnapshot("TRENDING", true);
    expect(computeEvidenceStars(pkg as any, null, snapshot as any).catalysts).toBe(3);
  });

  it("returns 2 when exactly 1 warning", () => {
    const pkg = makePkg({ warnings: ["Earnings risk"] });
    expect(computeEvidenceStars(pkg as any, null, undefined).catalysts).toBe(2);
  });

  it("returns 1 when no warnings and no high-impact news", () => {
    const pkg = makePkg({ warnings: [] });
    const snapshot = makeSnapshot("TRENDING", false);
    expect(computeEvidenceStars(pkg as any, null, snapshot as any).catalysts).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeEvidenceStars — Market Regime scoring
// ---------------------------------------------------------------------------

describe("computeEvidenceStars — regime", () => {
  it("returns 5 for TRENDING", () => {
    const pkg = makePkg({}, { marketRegime: "TRENDING" });
    expect(computeEvidenceStars(pkg as any, null, undefined).regime).toBe(5);
  });

  it("returns 3 for CHOPPY", () => {
    const pkg = makePkg({}, { marketRegime: "CHOPPY" });
    expect(computeEvidenceStars(pkg as any, null, undefined).regime).toBe(3);
  });

  it("returns 2 for RISK_OFF", () => {
    const pkg = makePkg({}, { marketRegime: "RISK_OFF" });
    expect(computeEvidenceStars(pkg as any, null, undefined).regime).toBe(2);
  });

  it("returns 1 when regime is null", () => {
    const pkg = makePkg({}, { marketRegime: null });
    expect(computeEvidenceStars(pkg as any, null, undefined).regime).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildAiSummaryBullets — always produces exactly 5 bullets
// ---------------------------------------------------------------------------

describe("buildAiSummaryBullets — bullet count", () => {
  it("always produces exactly 5 bullets", () => {
    const pkg = makePkg();
    const bullets = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(bullets).toHaveLength(5);
  });

  it("produces 5 bullets with no optional data", () => {
    const pkg = makePkg({ whySelected: [], warnings: [], confidence: "" }, { lifecycleItem: null, marketRegime: null });
    const bullets = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(bullets).toHaveLength(5);
  });

  it("produces 5 bullets with full data including lifecycle and news", () => {
    const pkg = makePkg(
      { whySelected: ["Strong RS"], warnings: ["Earnings risk"], confidence: "high" },
      { lifecycleItem: makeLifecycleItem({ lifecycleState: "STRENGTHENING", rankPrev: 3, rankCurrent: 1, scoreDelta: 12 }), marketRegime: "TRENDING" },
    );
    const bullets = buildAiSummaryBullets(pkg as any, makeSnapshot("TRENDING") as any, makeSentimentResponse(5));
    expect(bullets).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// buildAiSummaryBullets — bullet 1: technical posture
// ---------------------------------------------------------------------------

describe("buildAiSummaryBullets — technical bullet", () => {
  it("includes strategy name in bullet 1", () => {
    const pkg = makePkg({ strategy: "VCP", confidence: "high", whySelected: ["Strong RS"] });
    const [b1] = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(b1).toContain("VCP");
    expect(b1).toContain("high confidence");
  });

  it("includes first whySelected item in bullet 1", () => {
    const pkg = makePkg({ whySelected: ["Near 52-week pivot", "Volume dry-up"] });
    const [b1] = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(b1).toContain("Near 52-week pivot");
  });

  it("falls back gracefully when whySelected is empty", () => {
    const pkg = makePkg({ whySelected: [] });
    const [b1] = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(b1).toContain("scanner criteria");
  });
});

// ---------------------------------------------------------------------------
// buildAiSummaryBullets — bullet 2: market regime
// ---------------------------------------------------------------------------

describe("buildAiSummaryBullets — regime bullet", () => {
  it("includes TRENDING label in bullet 2", () => {
    const pkg = makePkg({}, { marketRegime: "TRENDING" });
    const bullets = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(bullets[1]).toContain("Strong Bull");
  });

  it("includes RISK_OFF label in bullet 2", () => {
    const pkg = makePkg({}, { marketRegime: "RISK_OFF" });
    const bullets = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(bullets[1]).toContain("Risk-Off");
  });

  it("says Unavailable when regime is null", () => {
    const pkg = makePkg({}, { marketRegime: null });
    const bullets = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(bullets[1]).toContain("Unavailable");
  });

  it("uses snapshot regime description when available", () => {
    const pkg = makePkg({}, { marketRegime: "TRENDING" });
    const snapshot = {
      marketRegime: { regime: "TRENDING", strength: 0.9, description: "All sectors advancing" },
      topNews: [],
    };
    const bullets = buildAiSummaryBullets(pkg as any, snapshot as any, null);
    expect(bullets[1]).toContain("All sectors advancing");
  });
});

// ---------------------------------------------------------------------------
// buildAiSummaryBullets — bullet 3: news/sentiment
// ---------------------------------------------------------------------------

describe("buildAiSummaryBullets — news bullet", () => {
  it("prompts user to open News tab when newsData is null", () => {
    const pkg = makePkg();
    const bullets = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(bullets[2]).toContain("News tab");
  });

  it("includes article count when news is loaded", () => {
    const pkg = makePkg();
    const news = makeSentimentResponse(7);
    const bullets = buildAiSummaryBullets(pkg as any, undefined, news);
    expect(bullets[2]).toContain("7 articles");
  });

  it("includes aggregate sentiment label when available", () => {
    const pkg = makePkg();
    const news = makeSentimentResponse(3);
    news.snapshot!.overallSentiment = "bearish";
    const bullets = buildAiSummaryBullets(pkg as any, undefined, news);
    expect(bullets[2]).toContain("bearish");
  });

  it("handles single article grammatically (article, not articles)", () => {
    const pkg = makePkg();
    const news = makeSentimentResponse(1);
    const bullets = buildAiSummaryBullets(pkg as any, undefined, news);
    expect(bullets[2]).toContain("1 article");
    expect(bullets[2]).not.toContain("1 articles");
  });
});

// ---------------------------------------------------------------------------
// buildAiSummaryBullets — bullet 4: risk
// ---------------------------------------------------------------------------

describe("buildAiSummaryBullets — risk bullet", () => {
  it("includes first warning in bullet 4", () => {
    const pkg = makePkg({ warnings: ["Earnings in 3 days", "Low liquidity"] });
    const bullets = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(bullets[3]).toContain("Earnings in 3 days");
  });

  it("includes invalidation level when no warnings", () => {
    const pkg = makePkg({ warnings: [], invalidation: "128.00" });
    const bullets = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(bullets[3]).toContain("128.00");
  });

  it("says no flags when warnings and invalidation are both absent", () => {
    const pkg = makePkg({ warnings: [], invalidation: undefined });
    const bullets = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(bullets[3]).toContain("No specific scanner warning flags");
  });

  it("includes invalidation in same bullet as warning when both present", () => {
    const pkg = makePkg({ warnings: ["Earnings risk"], invalidation: "128.00" });
    const bullets = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(bullets[3]).toContain("Earnings risk");
    expect(bullets[3]).toContain("128.00");
  });
});

// ---------------------------------------------------------------------------
// buildAiSummaryBullets — bullet 5: lifecycle
// ---------------------------------------------------------------------------

describe("buildAiSummaryBullets — lifecycle bullet", () => {
  it("says first appearance when lifecycleItem is null", () => {
    const pkg = makePkg({}, { lifecycleItem: null });
    const bullets = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(bullets[4]).toContain("first time");
  });

  it("includes lifecycle state label when item is present", () => {
    const lifecycle = makeLifecycleItem({ lifecycleState: "STRENGTHENING", rankCurrent: 2, scoreDelta: 15 });
    const pkg = makePkg({}, { lifecycleItem: lifecycle });
    const bullets = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(bullets[4]).toContain("strengthening");
  });

  it("includes current rank when present", () => {
    const lifecycle = makeLifecycleItem({ rankCurrent: 3, scoreDelta: 5 });
    const pkg = makePkg({}, { lifecycleItem: lifecycle });
    const bullets = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(bullets[4]).toContain("#3");
  });

  it("includes score delta in bullet 5", () => {
    const lifecycle = makeLifecycleItem({ scoreDelta: -8 });
    const pkg = makePkg({}, { lifecycleItem: lifecycle });
    const bullets = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(bullets[4]).toContain("-8");
  });

  it("handles null rankCurrent gracefully", () => {
    const lifecycle = makeLifecycleItem({ rankCurrent: null, scoreDelta: 0 });
    const pkg = makePkg({}, { lifecycleItem: lifecycle });
    const bullets = buildAiSummaryBullets(pkg as any, undefined, null);
    expect(bullets).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Compliance: prohibited language must not appear in any bullet
// ---------------------------------------------------------------------------

describe("buildAiSummaryBullets — compliance", () => {
  const prohibited = ["buy", "sell", "strong buy", "expected return", "recommended trade", "target price"];

  it("never contains prohibited language in any bullet", () => {
    const pkg = makePkg(
      { warnings: ["Earnings in 3 days"], whySelected: ["Strong RS", "Volume dry-up"] },
      { lifecycleItem: makeLifecycleItem(), marketRegime: "TRENDING" },
    );
    const bullets = buildAiSummaryBullets(pkg as any, makeSnapshot("TRENDING") as any, makeSentimentResponse(3));
    const full = bullets.join(" ").toLowerCase();
    for (const word of prohibited) {
      expect(full).not.toContain(word);
    }
  });
});

// ---------------------------------------------------------------------------
// EvidenceStars shape invariants
// ---------------------------------------------------------------------------

describe("computeEvidenceStars — shape", () => {
  it("always returns an object with all 6 keys", () => {
    const stars = computeEvidenceStars(makePkg() as any, null, undefined);
    expect(stars).toHaveProperty("technical");
    expect(stars).toHaveProperty("congress");
    expect(stars).toHaveProperty("news");
    expect(stars).toHaveProperty("institutional");
    expect(stars).toHaveProperty("catalysts");
    expect(stars).toHaveProperty("regime");
  });

  it("technical is always 1–5", () => {
    const cases = ["high", "medium", "low", ""];
    for (const conf of cases) {
      const stars = computeEvidenceStars(makePkg({ confidence: conf }) as any, null, undefined);
      expect(stars.technical).toBeGreaterThanOrEqual(1);
      expect(stars.technical).toBeLessThanOrEqual(5);
    }
  });

  it("news is always 1–5", () => {
    const counts = [0, 1, 2, 3, 5, 10];
    for (const count of counts) {
      const news = count === 0 ? null : makeSentimentResponse(count);
      const stars = computeEvidenceStars(makePkg() as any, news, undefined);
      expect(stars.news).toBeGreaterThanOrEqual(1);
      expect(stars.news).toBeLessThanOrEqual(5);
    }
  });

  it("catalysts is always 1–3", () => {
    const cases = [
      makePkg({ warnings: [] }),
      makePkg({ warnings: ["One warning"] }),
      makePkg({ warnings: ["Warning 1", "Warning 2"] }),
    ];
    for (const pkg of cases) {
      const stars = computeEvidenceStars(pkg as any, null, undefined);
      expect(stars.catalysts).toBeGreaterThanOrEqual(1);
      expect(stars.catalysts).toBeLessThanOrEqual(3);
    }
  });
});
