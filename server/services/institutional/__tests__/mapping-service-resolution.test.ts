import { describe, expect, it } from "vitest";
import {
  resolveTrustedFigiMapping,
  resolveTrustedMappingRecord,
  type MappingRow,
} from "../mapping-service";

const row = (overrides: Partial<MappingRow>): MappingRow => ({
  cusip: "111111111",
  figi: "BBG00000001",
  mappedSymbol: "NVDA",
  mappingStatus: "reviewed",
  mappingMethod: "manual",
  ...overrides,
});

describe("institutional mapping trusted resolution", () => {
  it("returns a direct symbol only from reviewed/exact records", () => {
    expect(resolveTrustedMappingRecord("111111111", row({ mappingStatus: "probable" }))).toBeNull();
    expect(resolveTrustedMappingRecord("111111111", row({ mappingStatus: "exact" })))
      .toMatchObject({ mappedSymbol: "NVDA", mappingStatus: "exact" });
  });

  it("derives a FIGI mapping only from one trusted symbol and identifies its source", () => {
    const source = row({});
    const resolved = resolveTrustedFigiMapping(
      "222222222",
      "BBG00000001",
      new Map([[source.cusip, source]]),
    );
    expect(resolved.result).toMatchObject({
      mappedSymbol: "NVDA", mappingStatus: "exact", mappingMethod: "figi_exact",
    });
    expect(resolved.derivedFrom?.cusip).toBe("111111111");
  });

  it("leaves conflicting FIGI evidence unresolved", () => {
    const one = row({});
    const two = row({
      cusip: "333333333",
      mappedSymbol: "AMD",
      mappingStatus: "exact",
    });
    const resolved = resolveTrustedFigiMapping(
      "222222222",
      "BBG00000001",
      new Map([[one.cusip, one], [two.cusip, two]]),
    );
    expect(resolved.result.mappedSymbol).toBeNull();
    expect(resolved.derivedFrom).toBeNull();
  });
});