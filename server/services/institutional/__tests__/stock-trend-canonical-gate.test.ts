import { describe, expect, it } from "vitest";
import {
  classifyCanonicalCandidatePeriods,
  filterCanonicalCandidatePopulation,
} from "../analytics/stock-trend-repository";

const candidate = (overrides: Record<string, unknown> = {}) => ({
  accessionNumber: "effective-1",
  periodOfReport: "2026-06-30",
  mappingResolution: "reliably_mapped",
  metadata: { symbol: "NVDA" },
  putCall: null,
  sharesPrnType: "SH",
  reportedShares: 100,
  ...overrides,
});

describe("stock trend canonical candidate gate", () => {
  it("disqualifies a cached period when one target candidate conflicts", () => {
    const result = classifyCanonicalCandidatePeriods([
      candidate({ cusip: "111111111" }),
      candidate({ cusip: "222222222", mappingResolution: "ambiguous", metadata: null }),
    ] as any, "NVDA");
    expect(result.trustedPeriods.has("2026-06-30")).toBe(true);
    expect(result.disqualifiedPeriods.has("2026-06-30")).toBe(true);
  });

  it("allows independently trusted CUSIPs for the same symbol", () => {
    const result = classifyCanonicalCandidatePeriods([
      candidate({ cusip: "111111111" }),
      candidate({ cusip: "222222222" }),
    ] as any, "NVDA");
    expect(result.trustedPeriods.has("2026-06-30")).toBe(true);
    expect(result.disqualifiedPeriods.size).toBe(0);
  });

  it("ignores conflicting holdings from superseded filings", () => {
    const population = filterCanonicalCandidatePopulation([
      candidate(),
      candidate({
        accessionNumber: "superseded-1",
        mappingResolution: "ambiguous",
        metadata: null,
      }),
    ] as any, new Set(["effective-1"]));
    const result = classifyCanonicalCandidatePeriods(population, "NVDA");
    expect(result.trustedPeriods.has("2026-06-30")).toBe(true);
    expect(result.disqualifiedPeriods.size).toBe(0);
  });

  it("ignores conflicting PUT, CALL, and PRN holdings", () => {
    const population = filterCanonicalCandidatePopulation([
      candidate(),
      candidate({ putCall: "Put", mappingResolution: "ambiguous", metadata: null }),
      candidate({ putCall: "Call", mappingResolution: "ambiguous", metadata: null }),
      candidate({ sharesPrnType: "PRN", mappingResolution: "ambiguous", metadata: null }),
    ] as any, new Set(["effective-1"]));
    const result = classifyCanonicalCandidatePeriods(population, "NVDA");
    expect(result.trustedPeriods.has("2026-06-30")).toBe(true);
    expect(result.disqualifiedPeriods.size).toBe(0);
  });

  it("does not let a population of only aggregate-ineligible rows validate a period", () => {
    const population = filterCanonicalCandidatePopulation([
      candidate({ putCall: "Put" }),
      candidate({ sharesPrnType: "PRN" }),
      candidate({ reportedShares: 0 }),
    ] as any, new Set(["effective-1"]));
    const result = classifyCanonicalCandidatePeriods(population, "NVDA");
    expect(result.trustedPeriods.size).toBe(0);
    expect(result.disqualifiedPeriods.size).toBe(0);
  });

  it("retains valid effective common-equity candidates for resolver gating", () => {
    const population = filterCanonicalCandidatePopulation([
      candidate(),
      candidate({ mappingResolution: "ambiguous", metadata: null }),
    ] as any, new Set(["effective-1"]));
    const result = classifyCanonicalCandidatePeriods(population, "NVDA");
    expect(result.trustedPeriods.has("2026-06-30")).toBe(true);
    expect(result.disqualifiedPeriods.has("2026-06-30")).toBe(true);
  });
});