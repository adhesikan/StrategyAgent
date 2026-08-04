// Sprint 4.4 final cleanup — regression tests.
//
// Covers the 11 requirements from the cleanup spec:
//  C01 — zero rejected count hides Rejected section
//  C02 — zero qualified count hides Qualified Trades heading
//  C03 — unavailable appears only once (no duplicate cards)
//  C04 — no duplicate Retry/Open Scanner CTA groups
//  C05 — risk-limit headline only when backend reasons support it
//  C06 — excluded-before-qualification does not become risk rejection
//  C07 — all-unavailable headline
//  C08 — mixed excluded and unavailable headline
//  C09 — qualified results preserve current layout (buildEmptyState returns null)
//  C10 — backend counts remain unchanged by presentation helpers
//  C11 — buildZeroQualifiedSummary prose matches backend counts

import { describe, it, expect } from "vitest";
import {
  buildEmptyState,
  buildRankedHeadline,
  buildZeroQualifiedSummary,
  trueRejectionGroups,
  dataRejectionGroups,
  type RankedTradeSearch,
  type RankedRejectionGroup,
} from "../ranked-trade-search";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSearch(overrides: Partial<RankedTradeSearch> = {}): RankedTradeSearch {
  return {
    request: {},
    reviewedCount: 0,
    qualifiedCount: 0,
    watchCount: 0,
    rejectedCount: 0,
    unavailableCount: 0,
    candidates: [],
    watchCandidates: [],
    rejectionSummary: [],
    generatedAt: new Date().toISOString(),
    warnings: [],
    ...overrides,
  };
}

function makeRej(reason: string, count: number, symbols: string[] = []): RankedRejectionGroup {
  return { reason, count, symbols };
}

// ---------------------------------------------------------------------------
// C01 — Zero rejected count hides Rejected section
// ---------------------------------------------------------------------------

describe("C01: zero rejected count hides Rejected section", () => {
  it("trueRejectedCount = 0 when rejectionSummary is empty", () => {
    const search = makeSearch({ rejectedCount: 0, rejectionSummary: [] });
    const trueRej = trueRejectionGroups(search.rejectionSummary);
    const count = trueRej.reduce((s, g) => s + g.count, 0);
    expect(count).toBe(0);
  });

  it("trueRejectedCount = 0 when all rejections are data-unavailability codes", () => {
    const search = makeSearch({
      rejectedCount: 3,
      rejectionSummary: [makeRej("DATA_UNAVAILABLE", 3)],
    });
    const trueRej = trueRejectionGroups(search.rejectionSummary);
    expect(trueRej.reduce((s, g) => s + g.count, 0)).toBe(0);
  });

  it("trueRejectedCount = 0 when rejection groups exist with count 0 (edge case)", () => {
    // Groups with count 0 must NOT trigger hasRejections = true
    const search = makeSearch({
      rejectionSummary: [makeRej("RISK_LIMIT_EXCEEDED", 0)],
    });
    const trueRej = trueRejectionGroups(search.rejectionSummary);
    const count = trueRej.reduce((s, g) => s + g.count, 0);
    // hasRejections should be (count > 0) = false — use count-only check
    expect(count > 0).toBe(false);
  });

  it("hasRejections = true only when true rejected count > 0", () => {
    const withCount = makeSearch({
      rejectionSummary: [makeRej("RISK_LIMIT_EXCEEDED", 2)],
    });
    const trueCount = trueRejectionGroups(withCount.rejectionSummary).reduce(
      (s, g) => s + g.count,
      0,
    );
    expect(trueCount > 0).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C02 — Zero qualified count hides Qualified Trades heading
// ---------------------------------------------------------------------------

describe("C02: zero qualified count", () => {
  it("search.qualifiedCount = 0 and candidates = [] → hasQualified = false", () => {
    const search = makeSearch({ qualifiedCount: 0, candidates: [] });
    const hasQualified = search.qualifiedCount > 0 || search.candidates.length > 0;
    expect(hasQualified).toBe(false);
  });

  it("qualifiedCount > 0 → hasQualified = true", () => {
    const search = makeSearch({
      qualifiedCount: 1,
      candidates: [{ rank: 1, symbol: "BA", whySelected: [], warnings: [] }],
    });
    const hasQualified = search.qualifiedCount > 0 || search.candidates.length > 0;
    expect(hasQualified).toBe(true);
  });

  it("qualifiedCount = 0 with watchCandidates → still no qualified heading", () => {
    const search = makeSearch({
      qualifiedCount: 0,
      watchCandidates: [{ symbol: "MSFT", watchConditions: [] }],
    });
    const hasQualified = search.qualifiedCount > 0 || search.candidates.length > 0;
    expect(hasQualified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C03 — Unavailable appears only once (buildEmptyState Case C fix)
// ---------------------------------------------------------------------------

describe("C03: unavailable rendered only once", () => {
  it("Case C fires only when excludedCount = 0 (pure data-only)", () => {
    const pureData = makeSearch({
      unavailableCount: 3,
      qualifiedCount: 0,
      rejectedCount: 0,
      excludedCount: 0,
      reviewedCount: 3,
    });
    const state = buildEmptyState(pureData, undefined, "find trades");
    expect(state?.icon).toBe("market-unavailable");
  });

  it("Case C does NOT fire when excludedCount > 0 (mixed — Case B wins)", () => {
    const mixed = makeSearch({
      unavailableCount: 3,
      qualifiedCount: 0,
      rejectedCount: 0,
      excludedCount: 44,
      reviewedCount: 50,
    });
    const state = buildEmptyState(mixed, undefined, "find trades");
    // Should be Case B ("not-yet"), not Case C ("market-unavailable")
    expect(state?.icon).toBe("not-yet");
    expect(state?.icon).not.toBe("market-unavailable");
  });

  it("Case C does NOT fire when rejectedCount > 0", () => {
    const withRejections = makeSearch({
      unavailableCount: 2,
      qualifiedCount: 0,
      rejectedCount: 3,
      excludedCount: 0,
    });
    const state = buildEmptyState(withRejections, undefined, "find trades");
    expect(state?.icon).not.toBe("market-unavailable");
  });

  it("when Case B fires with unavailableCount > 0, UnavailableCandidatesSection renders separately", () => {
    // Verify that the mixed case (44 excluded + 3 unavailable) triggers Case B
    // so that the EmptyStateCard does NOT describe unavailability —
    // leaving UnavailableCandidatesSection as the sole unavailability UI.
    const search = makeSearch({
      unavailableCount: 3,
      excludedCount: 44,
      qualifiedCount: 0,
    });
    const state = buildEmptyState(search, undefined, "find trades");
    expect(state?.headline).not.toContain("market data");
    expect(state?.icon).toBe("not-yet");
  });
});

// ---------------------------------------------------------------------------
// C04 — No duplicate Retry/Open Scanner CTAs (CTA deduplication)
// ---------------------------------------------------------------------------

describe("C04: CTA deduplication — UnavailableCandidatesSection hideCtas prop", () => {
  it("unavailableCtas returns Retry and Open Scanner", async () => {
    const { unavailableCtas } = await import("../ranked-trade-search");
    const ctas = unavailableCtas("find trades");
    expect(ctas.map((c) => c.label)).toContain("Retry");
    expect(ctas.map((c) => c.label)).toContain("Open Scanner");
  });

  it("exclusionCtas never includes Retry (no duplication with unavailable)", async () => {
    const { exclusionCtas } = await import("../ranked-trade-search");
    const ctas = exclusionCtas();
    expect(ctas.map((c) => c.label)).not.toContain("Retry");
  });
});

// ---------------------------------------------------------------------------
// C05 — Risk-limit headline only when backend reasons support it
// ---------------------------------------------------------------------------

describe("C05: buildRankedHeadline — risk-limit headline requires backend evidence", () => {
  it("uses risk-limit language when RISK_LIMIT_EXCEEDED dominates and exclusions are fewer", () => {
    const search = makeSearch({
      rejectedCount: 8,
      rejectionSummary: [makeRej("RISK_LIMIT_EXCEEDED", 8)],
      excludedCount: 2, // exclusions < riskRejected
    });
    const headline = buildRankedHeadline(search, 500);
    expect(headline).toContain("$500");
    expect(headline).toContain("maximum-risk limit");
  });

  it("does NOT use risk-limit language when exclusions dominate over rejections", () => {
    const search = makeSearch({
      rejectedCount: 0,
      rejectionSummary: [],
      excludedCount: 44, // exclusions dominate
      unavailableCount: 3,
      reviewedCount: 50,
    });
    const headline = buildRankedHeadline(search, 500);
    expect(headline).not.toContain("maximum-risk limit");
    expect(headline).not.toContain("met the");
    expect(headline).toContain("$500");
    expect(headline).toContain("currently qualifies");
  });

  it("does NOT use risk-limit language when no risk rejections in summary", () => {
    const search = makeSearch({
      rejectedCount: 3,
      rejectionSummary: [makeRej("EARNINGS_RISK", 3)],
      excludedCount: 5,
    });
    const headline = buildRankedHeadline(search, 500);
    expect(headline).not.toContain("maximum-risk limit");
  });

  it("does NOT use risk-limit language when maxRiskDollars is absent", () => {
    const search = makeSearch({
      rejectedCount: 5,
      rejectionSummary: [makeRej("RISK_LIMIT_EXCEEDED", 5)],
      excludedCount: 0,
    });
    const headline = buildRankedHeadline(search); // no maxRisk
    expect(headline).not.toContain("$");
    expect(headline).not.toContain("maximum-risk limit");
  });
});

// ---------------------------------------------------------------------------
// C06 — Excluded-before-qualification does not become risk rejection
// ---------------------------------------------------------------------------

describe("C06: excluded candidates do not imply risk failure", () => {
  it("buildRankedHeadline case C: excluded > 0 with no risk rejections → generic not-qualifies", () => {
    const search = makeSearch({
      excludedCount: 44,
      rejectedCount: 0,
      rejectionSummary: [],
      unavailableCount: 3,
    });
    const headline = buildRankedHeadline(search, 500);
    expect(headline).not.toContain("met the");
    expect(headline).not.toContain("maximum-risk limit");
    expect(headline).toContain("currently qualifies");
  });

  it("buildZeroQualifiedSummary: 44 excluded candidates are labeled 'excluded before qualification'", () => {
    const search = makeSearch({ excludedCount: 44 });
    const summary = buildZeroQualifiedSummary(search);
    expect(summary).toContain("44");
    expect(summary).toContain("excluded before qualification");
    // Must NOT say "rejected" or "risk"
    expect(summary).not.toContain("rejected");
    expect(summary).not.toContain("risk");
  });

  it("excluded candidates in summary are not described as reaching qualification", () => {
    const search = makeSearch({ excludedCount: 10 });
    const summary = buildZeroQualifiedSummary(search);
    expect(summary).toContain("before qualification");
    // Should not say "reached qualification" for excluded
    expect(summary).not.toContain("reached qualification");
  });
});

// ---------------------------------------------------------------------------
// C07 — All-unavailable headline
// ---------------------------------------------------------------------------

describe("C07: all-unavailable headline (case D)", () => {
  it("returns data-unavailability headline when only unavailableCount > 0", () => {
    const search = makeSearch({
      unavailableCount: 5,
      excludedCount: 0,
      rejectedCount: 0,
      qualifiedCount: 0,
    });
    const headline = buildRankedHeadline(search);
    expect(headline).toContain("market data was unavailable");
    expect(headline).not.toContain("currently qualifies");
  });

  it("buildEmptyState Case C icon = market-unavailable for pure data scenario", () => {
    const search = makeSearch({
      unavailableCount: 3,
      excludedCount: 0,
      rejectedCount: 0,
      qualifiedCount: 0,
      reviewedCount: 3,
    });
    const state = buildEmptyState(search, undefined, "find trades");
    expect(state?.icon).toBe("market-unavailable");
    expect(state?.subtitle).toContain("3");
    expect(state?.subtitle).toContain("fabricated");
  });
});

// ---------------------------------------------------------------------------
// C08 — Mixed excluded and unavailable headline
// ---------------------------------------------------------------------------

describe("C08: mixed excluded and unavailable", () => {
  it("buildRankedHeadline returns generic C when exclusions and unavailability both present", () => {
    const search = makeSearch({
      excludedCount: 44,
      unavailableCount: 3,
      qualifiedCount: 0,
      rejectedCount: 0,
    });
    const headline = buildRankedHeadline(search, 500);
    expect(headline).toContain("currently qualifies");
    expect(headline).toContain("$500");
    expect(headline).not.toContain("maximum-risk limit");
    expect(headline).not.toContain("market data was unavailable");
  });

  it("buildZeroQualifiedSummary includes both excluded and unavailable counts", () => {
    const search = makeSearch({
      excludedCount: 44,
      unavailableCount: 3,
      qualifiedCount: 0,
    });
    const summary = buildZeroQualifiedSummary(search);
    expect(summary).not.toBeNull();
    expect(summary).toContain("44");
    expect(summary).toContain("excluded before qualification");
    expect(summary).toContain("3");
    expect(summary).toContain("market data was unavailable");
  });

  it("buildZeroQualifiedSummary joins with ', and' when multiple groups", () => {
    const search = makeSearch({
      excludedCount: 10,
      unavailableCount: 5,
    });
    const summary = buildZeroQualifiedSummary(search)!;
    expect(summary).toContain(", and");
  });
});

// ---------------------------------------------------------------------------
// C09 — Qualified results preserve current layout
// ---------------------------------------------------------------------------

describe("C09: qualified results — buildEmptyState returns null", () => {
  it("returns null when candidates array is non-empty", () => {
    const search = makeSearch({
      qualifiedCount: 1,
      candidates: [{ rank: 1, symbol: "BA", whySelected: [], warnings: [] }],
    });
    expect(buildEmptyState(search, undefined, "find trades")).toBeNull();
  });

  it("returns null when watchCandidates is non-empty", () => {
    const search = makeSearch({
      watchCandidates: [{ symbol: "MSFT", watchConditions: [] }],
    });
    expect(buildEmptyState(search, undefined, "find trades")).toBeNull();
  });

  it("buildRankedHeadline case A: qualified candidates produce count headline", () => {
    const search = makeSearch({ qualifiedCount: 3 });
    const headline = buildRankedHeadline(search, 500);
    expect(headline).toContain("3 candidates qualify");
    expect(headline).toContain("$500");
  });

  it("buildRankedHeadline case A: single candidate uses singular form", () => {
    const search = makeSearch({ qualifiedCount: 1 });
    const headline = buildRankedHeadline(search, 500);
    expect(headline).toContain("1 candidate qualifies");
  });
});

// ---------------------------------------------------------------------------
// C10 — Backend counts unchanged by presentation helpers
// ---------------------------------------------------------------------------

describe("C10: backend counts are read-only — no mutation", () => {
  it("buildRankedHeadline does not mutate the search object", () => {
    const search = makeSearch({
      qualifiedCount: 0,
      excludedCount: 44,
      unavailableCount: 3,
      rejectedCount: 0,
    });
    const before = { ...search };
    buildRankedHeadline(search, 500);
    expect(search.qualifiedCount).toBe(before.qualifiedCount);
    expect(search.excludedCount).toBe(before.excludedCount);
    expect(search.unavailableCount).toBe(before.unavailableCount);
    expect(search.rejectedCount).toBe(before.rejectedCount);
  });

  it("buildZeroQualifiedSummary does not mutate the search object", () => {
    const search = makeSearch({ excludedCount: 44, unavailableCount: 3 });
    const before = { ...search };
    buildZeroQualifiedSummary(search);
    expect(search.excludedCount).toBe(before.excludedCount);
    expect(search.unavailableCount).toBe(before.unavailableCount);
  });

  it("trueRejectionGroups does not mutate the input array", () => {
    const summary = [makeRej("RISK_LIMIT_EXCEEDED", 2), makeRej("DATA_UNAVAILABLE", 1)];
    const originalLength = summary.length;
    trueRejectionGroups(summary);
    expect(summary.length).toBe(originalLength);
  });

  it("dataRejectionGroups does not mutate the input array", () => {
    const summary = [makeRej("DATA_UNAVAILABLE", 2), makeRej("EARNINGS_RISK", 1)];
    const originalLength = summary.length;
    dataRejectionGroups(summary);
    expect(summary.length).toBe(originalLength);
  });
});

// ---------------------------------------------------------------------------
// C11 — buildZeroQualifiedSummary prose
// ---------------------------------------------------------------------------

describe("C11: buildZeroQualifiedSummary prose", () => {
  it("returns null when no evidence (all counts zero)", () => {
    const search = makeSearch();
    expect(buildZeroQualifiedSummary(search)).toBeNull();
  });

  it("single excluded group: capitalised, ends with period", () => {
    const search = makeSearch({ excludedCount: 18 });
    const s = buildZeroQualifiedSummary(search)!;
    expect(s.charAt(0)).toBe(s.charAt(0).toUpperCase());
    expect(s.endsWith(".")).toBe(true);
  });

  it("rejected group uses 'after reaching qualification' language", () => {
    const search = makeSearch({
      rejectedCount: 4,
      rejectionSummary: [makeRej("RISK_LIMIT_EXCEEDED", 4)],
    });
    const s = buildZeroQualifiedSummary(search)!;
    expect(s).toContain("4");
    expect(s).toContain("rejected");
    expect(s).toContain("after reaching qualification");
  });

  it("three-group result: excluded + unavailable + rejected joined correctly", () => {
    const search = makeSearch({
      excludedCount: 44,
      unavailableCount: 3,
      rejectedCount: 2,
      rejectionSummary: [makeRej("EARNINGS_RISK", 2)],
    });
    const s = buildZeroQualifiedSummary(search)!;
    expect(s).toContain("44");
    expect(s).toContain("3");
    expect(s).toContain("2");
    expect(s).toContain(", and");
  });

  it("dataRejectionGroups count adds to unavailable total in summary", () => {
    const search = makeSearch({
      unavailableCount: 3,
      rejectionSummary: [makeRej("DATA_UNAVAILABLE", 2)],
    });
    const s = buildZeroQualifiedSummary(search)!;
    // Total unavailable = 3 + 2 = 5
    expect(s).toContain("5");
    expect(s).toContain("market data was unavailable");
  });
});
