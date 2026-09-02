import { describe, expect, it } from "vitest";
import { deriveParsedFilingIdentity } from "../filing-metadata-integrity";
import {
  buildHistoricalFilingRepairPlan,
  classifyStoredFilings,
  decideDuplicateHoldingDisposition,
  summarizeFilingAudit,
  type AuthoritativeFilingMetadata,
  type StoredFilingMetadata,
} from "../historical-filing-period-repair";
import type { ParsedBulkHolding } from "../sec-13f-bulk-parser";

function holding(overrides: Partial<ParsedBulkHolding> = {}): ParsedBulkHolding {
  return {
    accessionNumber: "000000000126000001",
    filerCik: "0000000001",
    filerName: "Manager",
    filingType: "13F-HR",
    filingDate: "2026-05-15",
    periodOfReport: "2026-03-31",
    isAmendment: false,
    issuerName: "Issuer",
    classTitle: "COM",
    cusip: "000000001",
    figi: null,
    reportedValue: 100,
    reportedShares: 10,
    sharesPrnType: "SH",
    putCall: null,
    investmentDiscretion: "SOLE",
    otherManager: null,
    votingSole: 10,
    votingShared: 0,
    votingNone: 0,
    ...overrides,
  };
}

function stored(overrides: Partial<StoredFilingMetadata> = {}): StoredFilingMetadata {
  return {
    id: "row-1",
    rawAccession: "000000000126000001",
    filerCik: "0000000001",
    filingDate: "2026-05-15",
    periodOfReport: "2024-03-31",
    filingType: "13F-HR",
    amendmentFlag: false,
    isEffective: true,
    ...overrides,
  };
}

const authoritative: AuthoritativeFilingMetadata = {
  canonicalAccession: "000000000126000001",
  filerCik: "0000000001",
  filingDate: "2026-05-15",
  periodOfReport: "2026-03-31",
  filingType: "13F-HR",
  amendmentFlag: false,
};

describe("historical filing-period integrity", () => {
  it("never accepts a requested quarter as filing metadata", () => {
    const identity = deriveParsedFilingIdentity("000000000126000001", [
      holding({ periodOfReport: "2026-03-31" }),
    ]);
    expect(identity.periodOfReport).toBe("2026-03-31");
    expect(identity.periodOfReport).not.toBe("2024-03-31");
  });

  it("prevents a 2026 accession from silently inheriting a requested 2024 period", () => {
    expect(() => deriveParsedFilingIdentity("000000000126000001", [
      holding({ periodOfReport: "2026-03-31" }),
      holding({ periodOfReport: "2024-03-31", cusip: "000000002" }),
    ])).toThrow("ACCESSION_BATCH_METADATA_CONFLICT");
  });

  it("keeps accession/header identity scoped and rejects batch-period leakage", () => {
    expect(() => deriveParsedFilingIdentity("000000000126000001", [
      holding(),
      holding({ accessionNumber: "000000000226000002" }),
    ])).toThrow("ACCESSION_BATCH_METADATA_CONFLICT");
  });

  it("classifies verified contamination and summarizes authoritative mismatches", () => {
    const source = new Map([[authoritative.canonicalAccession, [authoritative]]]);
    const classified = classifyStoredFilings([stored()], source);
    expect(classified[0].classification).toBe("PERIOD_MISMATCH");
    expect(classified[0].mismatches).toEqual(["PERIOD"]);
    expect(summarizeFilingAudit(classified)).toMatchObject({
      totalRows: 1,
      verifiedAgainstSEC: 1,
      periodMismatchesSEC: 1,
      periodMismatchesByStoredReportQuarter: { "2024-03-31": 1 },
    });
  });

  it("plans dashed/undashed duplicate repair around one canonical survivor", () => {
    const rows = [
      stored({ id: "dashed", rawAccession: "0000000001-26-000001" }),
      stored({ id: "canonical", rawAccession: "000000000126000001" }),
    ];
    const plan = buildHistoricalFilingRepairPlan(
      rows,
      new Map([[authoritative.canonicalAccession, [authoritative]]]),
    );
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toMatchObject({
      survivorId: "canonical",
      duplicateIds: ["dashed"],
      canonicalAccession: "000000000126000001",
    });
  });

  it("fails closed for ambiguous and unverified SEC metadata", () => {
    const ambiguous = buildHistoricalFilingRepairPlan(
      [stored()],
      new Map([[authoritative.canonicalAccession, [
        authoritative,
        { ...authoritative, filingDate: "2026-05-16" },
      ]]]),
    );
    expect(ambiguous.operations).toHaveLength(0);
    expect(ambiguous.blocked[0].reason).toBe("AMBIGUOUS_SEC_IDENTITY");

    const unverified = buildHistoricalFilingRepairPlan([stored()], new Map());
    expect(unverified.operations).toHaveLength(0);
    expect(unverified.blocked[0].reason).toBe("UNVERIFIED");
  });

  it("merges only empty or byte-equivalent duplicate holding sets", () => {
    expect(decideDuplicateHoldingDisposition(
      { count: 0, digest: "empty" },
      { count: 5, digest: "source" },
    )).toBe("MOVE_DUPLICATE_TO_EMPTY_SURVIVOR");
    expect(decideDuplicateHoldingDisposition(
      { count: 5, digest: "same" },
      { count: 5, digest: "same" },
    )).toBe("DELETE_IDENTICAL_DUPLICATE");
    expect(decideDuplicateHoldingDisposition(
      { count: 5, digest: "left" },
      { count: 5, digest: "right" },
    )).toBe("REPLAY_REQUIRED");
  });

  it("is idempotent after canonical metadata is corrected", () => {
    const corrected = stored({
      rawAccession: authoritative.canonicalAccession,
      periodOfReport: authoritative.periodOfReport,
    });
    const plan = buildHistoricalFilingRepairPlan(
      [corrected],
      new Map([[authoritative.canonicalAccession, [authoritative]]]),
    );
    expect(plan.operations).toEqual([]);
    expect(plan.affectedPeriods).toEqual([]);
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
  });
});