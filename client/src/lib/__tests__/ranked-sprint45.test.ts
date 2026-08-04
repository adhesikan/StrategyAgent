// Sprint 4.5 — Final UX Polish regression tests.
//
// Covers the 11 test categories from spec §13:
//  S01 — single source of truth for counts (buildDeterministicSummary)
//  S02 — no duplicate CTAs (zeroQualifiedCtas / exclusionCtas / unavailableCtas)
//  S03 — deterministic summary card data matches backend
//  S04 — correct section ordering (zero-qualified vs qualified)
//  S05 — standard terminology (no "setups", "records", "ideas" in display text)
//  S06 — status color mapping (DeterministicSummaryRow color)
//  S07 — AI explanation rule: present only, no count repetition (system prompt)
//  S08 — zero-qualified layout derived from backend only
//  S09 — qualified layout unchanged (buildEmptyState returns null)
//  S10 — watch layout unaffected by zero-qualified changes
//  S11 — unavailable layout unchanged (amber, correct count derivation)

import { describe, it, expect } from "vitest";
import {
  buildDeterministicSummary,
  buildEmptyState,
  exclusionCtas,
  unavailableCtas,
  zeroQualifiedCtas,
  shortExclusionLabel,
  rankedCountsLine,
  trueRejectionGroups,
  dataRejectionGroups,
  buildRankedHeadline,
  buildZeroQualifiedSummary,
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
// S01 — Single source of truth for counts
// ---------------------------------------------------------------------------

describe("S01: single source of truth — buildDeterministicSummary", () => {
  it("reads reviewedCount directly from backend (no derived value)", () => {
    const search = makeSearch({ reviewedCount: 50 });
    const rows = buildDeterministicSummary(search);
    const reviewedRow = rows.find((r) => r.label.includes("stored opportunities"));
    expect(reviewedRow?.value).toBe(50); // exact backend value
  });

  it("reads groupedCandidateCount directly when present", () => {
    const search = makeSearch({ groupedCandidateCount: 46 });
    const rows = buildDeterministicSummary(search);
    const postConf = rows.find((r) => r.label.includes("post-confluence"));
    expect(postConf?.show).toBe(true);
    expect(postConf?.value).toBe(46);
  });

  it("post-confluence row hidden when groupedCandidateCount is absent", () => {
    const search = makeSearch(); // no groupedCandidateCount
    const rows = buildDeterministicSummary(search);
    const postConf = rows.find((r) => r.label.includes("post-confluence"));
    expect(postConf?.show).toBe(false);
  });

  it("reads qualifiedCount directly from backend", () => {
    const search = makeSearch({ qualifiedCount: 0 });
    const rows = buildDeterministicSummary(search);
    const qualified = rows.find((r) => r.label.includes("satisfied every"));
    expect(qualified?.value).toBe(0);
    expect(qualified?.show).toBe(true);
  });

  it("reads excludedCount directly; row hidden when 0", () => {
    const zeroExcluded = makeSearch({ excludedCount: 0 });
    const nonZeroExcluded = makeSearch({ excludedCount: 43 });
    const rowsZero = buildDeterministicSummary(zeroExcluded);
    const rowsNon  = buildDeterministicSummary(nonZeroExcluded);
    const labelZero = rowsZero.find((r) => r.label.includes("excluded"));
    const labelNon  = rowsNon.find((r) => r.label.includes("excluded"));
    expect(labelZero?.show).toBe(false);
    expect(labelNon?.show).toBe(true);
    expect(labelNon?.value).toBe(43);
  });

  it("reads unavailableCount directly; row hidden when 0", () => {
    const zeroUnavail = makeSearch({ unavailableCount: 0 });
    const nonZeroUnavail = makeSearch({ unavailableCount: 3 });
    const rowsZero = buildDeterministicSummary(zeroUnavail);
    const rowsNon  = buildDeterministicSummary(nonZeroUnavail);
    expect(rowsZero.find((r) => r.label.includes("unavailable"))?.show).toBe(false);
    expect(rowsNon.find((r) => r.label.includes("unavailable"))?.show).toBe(true);
    expect(rowsNon.find((r) => r.label.includes("unavailable"))?.value).toBe(3);
  });

  it("does not mutate the search object", () => {
    const search = makeSearch({ reviewedCount: 50, qualifiedCount: 0, excludedCount: 43, unavailableCount: 3 });
    const before = { ...search };
    buildDeterministicSummary(search);
    expect(search.reviewedCount).toBe(before.reviewedCount);
    expect(search.qualifiedCount).toBe(before.qualifiedCount);
    expect(search.excludedCount).toBe(before.excludedCount);
  });
});

// ---------------------------------------------------------------------------
// S02 — No duplicate CTAs
// ---------------------------------------------------------------------------

describe("S02: no duplicate CTAs", () => {
  it("zeroQualifiedCtas returns exactly Run Fresh Scan and Review Watchlist", () => {
    const ctas = zeroQualifiedCtas();
    const labels = ctas.map((c) => c.label);
    expect(labels).toContain("Run Fresh Scan");
    expect(labels).toContain("Review Watchlist");
    expect(labels).toHaveLength(2); // exactly two — no extras
  });

  it("Run Fresh Scan is primary", () => {
    const primary = zeroQualifiedCtas().find((c) => c.label === "Run Fresh Scan");
    expect(primary?.primary).toBe(true);
  });

  it("Review Watchlist is secondary (not primary)", () => {
    const secondary = zeroQualifiedCtas().find((c) => c.label === "Review Watchlist");
    expect(secondary?.primary).toBeFalsy();
  });

  it("exclusionCtas does NOT contain Retry (no cross-section duplication)", () => {
    const labels = exclusionCtas().map((c) => c.label);
    expect(labels).not.toContain("Retry");
  });

  it("exclusionCtas contains Run Fresh Scan (consistent primary action)", () => {
    const labels = exclusionCtas().map((c) => c.label);
    expect(labels).toContain("Run Fresh Scan");
  });

  it("unavailableCtas contains Retry (data failure primary action)", () => {
    const labels = unavailableCtas("find trades").map((c) => c.label);
    expect(labels).toContain("Retry");
  });

  it("zeroQualifiedCtas does NOT include Open Scanner (deduplicated)", () => {
    const labels = zeroQualifiedCtas().map((c) => c.label);
    expect(labels).not.toContain("Open Scanner");
  });

  it("zeroQualifiedCtas hrefs point to correct routes", () => {
    const ctas = zeroQualifiedCtas();
    const scan = ctas.find((c) => c.label === "Run Fresh Scan");
    const watch = ctas.find((c) => c.label === "Review Watchlist");
    expect(scan?.href).toBe("/scanner?run=1");
    expect(watch?.href).toBe("/watchlist");
  });
});

// ---------------------------------------------------------------------------
// S03 — Deterministic summary card data matches backend
// ---------------------------------------------------------------------------

describe("S03: deterministic summary card — data integrity", () => {
  it("full scenario (50 reviewed, 46 post-conf, 0 qualified, 43 excluded, 3 unavailable)", () => {
    const search = makeSearch({
      reviewedCount: 50,
      groupedCandidateCount: 46,
      qualifiedCount: 0,
      excludedCount: 43,
      unavailableCount: 3,
    });
    const rows = buildDeterministicSummary(search).filter((r) => r.show);
    const values = rows.map((r) => r.value);
    expect(values).toContain(50);
    expect(values).toContain(46);
    expect(values).toContain(0);
    expect(values).toContain(43);
    expect(values).toContain(3);
    // No derived totals — exactly these backend values
    expect(values.length).toBe(5);
  });

  it("qualified > 0 shows green color on qualified row", () => {
    const search = makeSearch({ qualifiedCount: 2 });
    const rows = buildDeterministicSummary(search);
    const qualRow = rows.find((r) => r.label.includes("satisfied every"));
    expect(qualRow?.color).toBe("green");
  });

  it("qualified = 0 shows muted color on qualified row", () => {
    const search = makeSearch({ qualifiedCount: 0 });
    const rows = buildDeterministicSummary(search);
    const qualRow = rows.find((r) => r.label.includes("satisfied every"));
    expect(qualRow?.color).toBe("muted");
  });

  it("unavailable row shows amber color", () => {
    const search = makeSearch({ unavailableCount: 3 });
    const rows = buildDeterministicSummary(search);
    const unavailRow = rows.find((r) => r.label.includes("unavailable"));
    expect(unavailRow?.color).toBe("amber");
  });

  it("excluded row shows muted color (gray per §10)", () => {
    const search = makeSearch({ excludedCount: 10 });
    const rows = buildDeterministicSummary(search);
    const exclRow = rows.find((r) => r.label.includes("excluded"));
    expect(exclRow?.color).toBe("muted");
  });
});

// ---------------------------------------------------------------------------
// S04 — Correct section ordering
// ---------------------------------------------------------------------------

describe("S04: section ordering", () => {
  it("buildEmptyState returns null for qualified results (non-empty candidates)", () => {
    const search = makeSearch({
      qualifiedCount: 1,
      candidates: [{ rank: 1, symbol: "AAPL", whySelected: [], warnings: [] }],
    });
    expect(buildEmptyState(search, undefined, "find trades")).toBeNull();
  });

  it("buildEmptyState returns not-yet for zero-qualified with exclusions", () => {
    const search = makeSearch({
      reviewedCount: 50,
      qualifiedCount: 0,
      excludedCount: 43,
      unavailableCount: 3,
    });
    const state = buildEmptyState(search, undefined, "find trades");
    expect(state?.icon).toBe("not-yet");
  });

  it("zero-qualified Case C (data-only) fires only when excludedCount === 0", () => {
    const dataOnly = makeSearch({ unavailableCount: 3, excludedCount: 0, qualifiedCount: 0 });
    const mixed    = makeSearch({ unavailableCount: 3, excludedCount: 10, qualifiedCount: 0 });
    expect(buildEmptyState(dataOnly, undefined, "find")?.icon).toBe("market-unavailable");
    expect(buildEmptyState(mixed, undefined, "find")?.icon).toBe("not-yet");
  });

  it("buildEmptyState returns no-results for truly empty search", () => {
    const search = makeSearch({ reviewedCount: 0 });
    const state = buildEmptyState(search, undefined, "find trades");
    expect(state?.icon).toBe("no-results");
  });
});

// ---------------------------------------------------------------------------
// S05 — Standard terminology
// ---------------------------------------------------------------------------

describe("S05: standard terminology (§9)", () => {
  it("buildEmptyState Case B headline uses 'stored opportunities', not 'setups'", () => {
    const search = makeSearch({ reviewedCount: 5, rejectedCount: 3, qualifiedCount: 0 });
    const state = buildEmptyState(search, undefined, "find trades");
    expect(state?.headline).not.toMatch(/\bsetups\b/i);
    expect(state?.headline).toMatch(/stored opportunities/i);
  });

  it("buildEmptyState Case B subtitle uses 'qualification gates', not 'confirmation checks'", () => {
    const search = makeSearch({ reviewedCount: 5, rejectedCount: 3, qualifiedCount: 0 });
    const state = buildEmptyState(search, undefined, "find trades");
    expect(state?.subtitle).toMatch(/qualification gates/i);
    expect(state?.subtitle).not.toMatch(/confirmation checks/i);
  });

  it("buildEmptyState Case A subtitle uses 'stored opportunities', not 'stored setups'", () => {
    const search = makeSearch({ reviewedCount: 0 });
    const state = buildEmptyState(search, undefined, "find trades");
    expect(state?.subtitle).toMatch(/stored opportunities/i);
    expect(state?.subtitle).not.toMatch(/stored setups/i);
  });

  it("buildEmptyState Case C subtitle uses 'candidates', not 'setups'", () => {
    const search = makeSearch({ unavailableCount: 3, excludedCount: 0, qualifiedCount: 0, reviewedCount: 3 });
    const state = buildEmptyState(search, undefined, "find trades");
    expect(state?.subtitle).not.toMatch(/\bsetups?\b/i);
    expect(state?.subtitle).toMatch(/candidate/i);
  });

  it("shortExclusionLabel NOT_ACTIONABLE_NO_TRIGGER uses spec §9 wording", () => {
    expect(shortExclusionLabel("NOT_ACTIONABLE_NO_TRIGGER")).toBe("Waiting for breakout trigger");
  });

  it("shortExclusionLabel returns spec labels for all five spec-example codes", () => {
    expect(shortExclusionLabel("NOT_ACTIONABLE_NO_TRIGGER")).toBe("Waiting for breakout trigger");
    expect(shortExclusionLabel("STALE")).toBe("Outside freshness window");
    expect(shortExclusionLabel("REWARD_RISK_BELOW_THRESHOLD")).toBe("Reward/risk below threshold");
    expect(shortExclusionLabel("DUPLICATE_CONFLUENCE")).toBe("Duplicate confluence");
    expect(shortExclusionLabel("EARNINGS_RISK")).toBe("Earnings risk");
  });

  it("rankedCountsLine uses 'stored opportunities', not 'setups' or 'records'", () => {
    const search = makeSearch({ reviewedCount: 50, qualifiedCount: 0 });
    const line = rankedCountsLine(search);
    expect(line).toMatch(/stored opportunities/i);
    expect(line).not.toMatch(/\bsetups\b/i);
    expect(line).not.toMatch(/\brecords\b/i);
  });

  it("buildDeterministicSummary labels use standard terms", () => {
    const search = makeSearch({ reviewedCount: 10, qualifiedCount: 0, excludedCount: 5 });
    const rows = buildDeterministicSummary(search).filter((r) => r.show);
    for (const row of rows) {
      expect(row.label).not.toMatch(/\bsetup(s)?\b/i);
      expect(row.label).not.toMatch(/\brecord(s)?\b/i);
      expect(row.label).not.toMatch(/\bideas?\b/i);
    }
  });
});

// ---------------------------------------------------------------------------
// S06 — Status color mapping
// ---------------------------------------------------------------------------

describe("S06: status color mapping (§10)", () => {
  it("qualified row is green when count > 0", () => {
    const rows = buildDeterministicSummary(makeSearch({ qualifiedCount: 3 }));
    const q = rows.find((r) => r.label.includes("satisfied"));
    expect(q?.color).toBe("green");
  });

  it("qualified row is muted (gray) when count = 0", () => {
    const rows = buildDeterministicSummary(makeSearch({ qualifiedCount: 0 }));
    const q = rows.find((r) => r.label.includes("satisfied"));
    expect(q?.color).toBe("muted");
  });

  it("unavailable row is amber", () => {
    const rows = buildDeterministicSummary(makeSearch({ unavailableCount: 5 }));
    const u = rows.find((r) => r.label.includes("unavailable"));
    expect(u?.color).toBe("amber");
  });

  it("excluded row is muted (gray)", () => {
    const rows = buildDeterministicSummary(makeSearch({ excludedCount: 7 }));
    const e = rows.find((r) => r.label.includes("excluded"));
    expect(e?.color).toBe("muted");
  });

  it("reviewed row is default", () => {
    const rows = buildDeterministicSummary(makeSearch({ reviewedCount: 10 }));
    const r = rows.find((r) => r.label.includes("stored opportunities"));
    expect(r?.color).toBe("default");
  });

  it("post-confluence row is default", () => {
    const rows = buildDeterministicSummary(makeSearch({ groupedCandidateCount: 8 }));
    const p = rows.find((r) => r.label.includes("post-confluence"));
    expect(p?.color).toBe("default");
  });
});

// ---------------------------------------------------------------------------
// S07 — AI explanation rule (system prompt behaviour via data validation)
// ---------------------------------------------------------------------------

describe("S07: AI explanation — counts are not repeated in narrative helpers", () => {
  it("buildZeroQualifiedSummary does not produce a sentence that includes reviewedCount", () => {
    const search = makeSearch({ reviewedCount: 50, excludedCount: 43, unavailableCount: 3 });
    const summary = buildZeroQualifiedSummary(search)!;
    // Summary should reference excluded/unavailable counts, NOT reviewedCount (50)
    expect(summary).toContain("43");
    expect(summary).toContain("3");
    expect(summary).not.toContain("50"); // reviewedCount is already in DeterministicSummaryCard
  });

  it("buildRankedHeadline for Case C (exclusions dominate) does not mention specific counts", () => {
    const search = makeSearch({ excludedCount: 44, unavailableCount: 3, qualifiedCount: 0 });
    const headline = buildRankedHeadline(search, 500);
    // The headline should be qualitative, not count-repetition
    expect(headline).not.toMatch(/44/);
    expect(headline).not.toMatch(/3 /);
    expect(headline).toMatch(/currently qualifies/i);
  });

  it("buildEmptyState subtitle is qualitative (no specific counts embedded)", () => {
    const search = makeSearch({ reviewedCount: 50, excludedCount: 43, qualifiedCount: 0 });
    const state = buildEmptyState(search, undefined, "find trades");
    // The subtitle says "Review the details below" — no count numbers embedded
    expect(state?.subtitle).not.toMatch(/\d{2,}/); // no 2+ digit numbers in subtitle
  });
});

// ---------------------------------------------------------------------------
// S08 — Zero-qualified layout
// ---------------------------------------------------------------------------

describe("S08: zero-qualified layout — derived from backend only", () => {
  it("all DeterministicSummaryRow values are integers (no floating point)", () => {
    const search = makeSearch({
      reviewedCount: 50,
      groupedCandidateCount: 46,
      qualifiedCount: 0,
      excludedCount: 43,
      unavailableCount: 3,
    });
    for (const row of buildDeterministicSummary(search)) {
      expect(Number.isInteger(row.value)).toBe(true);
    }
  });

  it("zero-qualified emptyState CTA set uses Run Fresh Scan primary", () => {
    const search = makeSearch({ reviewedCount: 5, qualifiedCount: 0, rejectedCount: 3 });
    const state = buildEmptyState(search, undefined, "find trades");
    const primary = state?.cta.find((c) => c.primary);
    expect(primary?.label).toBe("Run Fresh Scan");
  });

  it("zero-qualified emptyState includes Review Watchlist secondary", () => {
    const search = makeSearch({ reviewedCount: 5, qualifiedCount: 0, rejectedCount: 3 });
    const state = buildEmptyState(search, undefined, "find trades");
    const labels = state?.cta.map((c) => c.label) ?? [];
    expect(labels).toContain("Review Watchlist");
  });

  it("zero-qualified with watch candidates still shows not-yet (no candidates)", () => {
    const search = makeSearch({
      qualifiedCount: 0,
      watchCount: 2,
      watchCandidates: [{ symbol: "MSFT", watchConditions: [] }],
    });
    // buildEmptyState returns null when watches exist (not an empty state)
    expect(buildEmptyState(search, undefined, "find trades")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// S09 — Qualified layout unchanged
// ---------------------------------------------------------------------------

describe("S09: qualified layout unchanged", () => {
  it("buildEmptyState returns null when candidates non-empty", () => {
    const search = makeSearch({
      qualifiedCount: 2,
      candidates: [
        { rank: 1, symbol: "AAPL", whySelected: [], warnings: [] },
        { rank: 2, symbol: "NVDA", whySelected: [], warnings: [] },
      ],
    });
    expect(buildEmptyState(search, undefined, "find trades")).toBeNull();
  });

  it("buildRankedHeadline Case A includes count and risk label when applicable", () => {
    const search = makeSearch({ qualifiedCount: 2 });
    const headline = buildRankedHeadline(search, 500);
    expect(headline).toContain("2 candidates qualify");
    expect(headline).toContain("$500");
  });

  it("buildRankedHeadline Case A singular form", () => {
    const search = makeSearch({ qualifiedCount: 1 });
    expect(buildRankedHeadline(search, 500)).toContain("1 candidate qualifies");
  });
});

// ---------------------------------------------------------------------------
// S10 — Watch layout unaffected
// ---------------------------------------------------------------------------

describe("S10: watch layout unaffected by zero-qualified changes", () => {
  it("buildEmptyState returns null when watchCandidates non-empty", () => {
    const search = makeSearch({
      watchCandidates: [{ symbol: "BA", watchConditions: ["Wait for trigger"] }],
    });
    expect(buildEmptyState(search, undefined, "find trades")).toBeNull();
  });

  it("rankedCountsLine includes watch count when > 0", () => {
    const search = makeSearch({ reviewedCount: 10, watchCount: 2, qualifiedCount: 0 });
    const line = rankedCountsLine(search);
    expect(line).toMatch(/worth watching/i);
  });

  it("rankedCountsLine omits watch when 0", () => {
    const search = makeSearch({ reviewedCount: 10, watchCount: 0, qualifiedCount: 0 });
    const line = rankedCountsLine(search);
    expect(line).not.toMatch(/worth watching/i);
  });
});

// ---------------------------------------------------------------------------
// S11 — Unavailable layout unchanged (amber, correct count derivation)
// ---------------------------------------------------------------------------

describe("S11: unavailable layout — amber color, count integrity", () => {
  it("dataRejectionGroups extracts data-unavailability reasons from rejectionSummary", () => {
    const summary = [
      makeRej("DATA_UNAVAILABLE", 2),
      makeRej("RISK_LIMIT_EXCEEDED", 3),
      makeRej("OPTIONS_DATA_UNAVAILABLE", 1),
    ];
    const groups = dataRejectionGroups(summary);
    const reasons = groups.map((g) => g.reason);
    expect(reasons).toContain("DATA_UNAVAILABLE");
    expect(reasons).toContain("OPTIONS_DATA_UNAVAILABLE");
    expect(reasons).not.toContain("RISK_LIMIT_EXCEEDED");
  });

  it("trueRejectionGroups excludes data-unavailability reasons", () => {
    const summary = [
      makeRej("DATA_UNAVAILABLE", 2),
      makeRej("RISK_LIMIT_EXCEEDED", 3),
    ];
    const groups = trueRejectionGroups(summary);
    expect(groups.map((g) => g.reason)).not.toContain("DATA_UNAVAILABLE");
    expect(groups.map((g) => g.reason)).toContain("RISK_LIMIT_EXCEEDED");
  });

  it("buildDeterministicSummary unavailable row only counts unavailableCount (not rejectionSummary)", () => {
    // The DeterministicSummaryCard reads unavailableCount directly — not the extra
    // data-unavailability rejection groups. Those appear in UnavailableCandidatesSection.
    const search = makeSearch({
      unavailableCount: 3,
      rejectionSummary: [makeRej("DATA_UNAVAILABLE", 2)],
    });
    const rows = buildDeterministicSummary(search);
    const unavailRow = rows.find((r) => r.label.includes("unavailable"))!;
    expect(unavailRow.value).toBe(3); // only unavailableCount, NOT 3+2
    expect(unavailRow.color).toBe("amber");
  });

  it("amber color is assigned to unavailable row regardless of count", () => {
    for (const n of [1, 5, 99]) {
      const rows = buildDeterministicSummary(makeSearch({ unavailableCount: n }));
      expect(rows.find((r) => r.label.includes("unavailable"))?.color).toBe("amber");
    }
  });
});
