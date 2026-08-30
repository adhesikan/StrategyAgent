import { describe, expect, it } from "vitest";
import {
  EXPECTED_SECURITY_CUSIPS,
  inferMappingPipelineState,
} from "./audit-institutional-production-data";

describe("institutional production data audit helpers", () => {
  it("uses the canonical expected CUSIPs for the requested symbols", () => {
    expect(EXPECTED_SECURITY_CUSIPS).toEqual({
      AAPL: "037833100",
      NVDA: "67066G104",
      MSFT: "594918104",
      COST: "22160K105",
    });
  });

  it("does not claim mapping execution when raw holdings only have defaults", () => {
    expect(
      inferMappingPipelineState({
        effectiveHoldings: 562_552,
        mappedEffectiveHoldings: 0,
        nonDefaultHoldingStatuses: 0,
        mappingRows: 0,
        runsWithMappingCounts: 0,
      }),
    ).toBe("NO_MAPPING_REFERENCE_ROWS; EXECUTION_NOT_PROVABLE_FROM_STORED_DATA");
  });

  it("identifies unapplied mapping-table evidence", () => {
    expect(
      inferMappingPipelineState({
        effectiveHoldings: 562_552,
        mappedEffectiveHoldings: 0,
        nonDefaultHoldingStatuses: 0,
        mappingRows: 4,
        runsWithMappingCounts: 0,
      }),
    ).toBe("MAPPING_ROWS_EXIST_BUT_NO_APPLICATION_EVIDENCE");
  });

  it("recognizes evidence that mapping was executed", () => {
    expect(
      inferMappingPipelineState({
        effectiveHoldings: 100,
        mappedEffectiveHoldings: 1,
        nonDefaultHoldingStatuses: 1,
        mappingRows: 1,
        runsWithMappingCounts: 1,
      }),
    ).toBe("EXECUTION_EVIDENCE_PRESENT");
  });
});