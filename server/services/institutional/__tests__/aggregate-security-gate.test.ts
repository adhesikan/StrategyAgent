import { describe, expect, it } from "vitest";
import {
  evaluateAggregateCandidatePopulation,
  trustedAggregateHoldingsForSymbol,
} from "../ingestion-service";

const holding = (overrides: Record<string, unknown> = {}) => ({
  cusip: "111111111",
  mappedSymbol: "NVDA",
  mappingStatus: "exact",
  mappingSymbol: "NVDA",
  mappingMappingStatus: "reviewed",
  masterTicker: null,
  masterReviewStatus: null,
  reportedShares: 100,
  putCall: null,
  sharesPrnType: "SH",
  ...overrides,
});

describe("aggregate security resolver gate", () => {
  it("excludes conflicting trusted evidence so it cannot create numeric aggregates", () => {
    const eligible = trustedAggregateHoldingsForSymbol([
      holding({ mappingSymbol: "AMD", mappingMappingStatus: "reviewed" }),
    ], "NVDA");
    expect(eligible).toEqual([]);
  });

  it("excludes ambiguous, weak, and insufficient records from aggregate inputs", () => {
    expect(trustedAggregateHoldingsForSymbol([
      holding({ mappingStatus: "ambiguous", mappingSymbol: null, mappingMappingStatus: null }),
      holding({ mappedSymbol: "NVDA", mappingStatus: "probable", mappingSymbol: null, mappingMappingStatus: null }),
      holding({ mappedSymbol: null, mappingStatus: null, mappingSymbol: null, mappingMappingStatus: null }),
    ], "NVDA")).toEqual([]);
  });

  it("excludes a trusted target when another source explicitly marks it ambiguous", () => {
    expect(trustedAggregateHoldingsForSymbol([
      holding({ mappingSymbol: null, mappingMappingStatus: "ambiguous" }),
    ], "NVDA")).toEqual([]);
  });

  it("retains multiple CUSIPs when each independently resolves to the requested symbol", () => {
    const eligible = trustedAggregateHoldingsForSymbol([
      holding({ cusip: "111111111" }),
      holding({ cusip: "222222222", mappedSymbol: "NVDA", mappingStatus: "reviewed", mappingSymbol: null, mappingMappingStatus: null }),
    ], "NVDA");
    expect(eligible.map((item) => item.cusip)).toEqual(["111111111", "222222222"]);
  });

  it("fails the whole eligible population when trusted and disqualified CUSIPs mix", () => {
    const population = evaluateAggregateCandidatePopulation([
      holding({ cusip: "111111111" }),
      holding({
        cusip: "222222222",
        mappingSymbol: "AMD",
        mappingMappingStatus: "reviewed",
      }),
    ], "NVDA");
    expect(population.trusted.map((item) => item.cusip)).toEqual(["111111111"]);
    expect(population.hasDisqualifyingEvidence).toBe(true);
  });

  it("does not count aggregate-ineligible conflicts as disqualifying", () => {
    const population = evaluateAggregateCandidatePopulation([
      holding({ cusip: "111111111" }),
      holding({ cusip: "put", putCall: "Put", mappingSymbol: "AMD" }),
      holding({ cusip: "call", putCall: "Call", mappingSymbol: "AMD" }),
      holding({ cusip: "prn", sharesPrnType: "PRN", mappingSymbol: "AMD" }),
      holding({ cusip: "zero", reportedShares: 0, mappingSymbol: "AMD" }),
    ], "NVDA");
    expect(population.trusted.map((item) => item.cusip)).toEqual(["111111111"]);
    expect(population.hasDisqualifyingEvidence).toBe(false);
  });

  it("preserves an all-trusted multi-CUSIP aggregate population", () => {
    const population = evaluateAggregateCandidatePopulation([
      holding({ cusip: "111111111" }),
      holding({ cusip: "222222222" }),
    ], "NVDA");
    expect(population.trusted).toHaveLength(2);
    expect(population.hasDisqualifyingEvidence).toBe(false);
  });
});