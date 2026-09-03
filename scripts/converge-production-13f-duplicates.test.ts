import { describe, expect, it } from "vitest";
import {
  buildSummaryOnlyReport,
  parseDuplicateConvergenceArgs,
} from "./converge-production-13f-duplicates";
import type { DuplicateGroup } from "../server/services/institutional/production-duplicate-convergence";

const authoritative = {
  canonicalAccession: "000000000126000001",
  filerCik: "0000000001",
  filingDate: "2026-05-15",
  periodOfReport: "2026-03-31",
  filingType: "13F-HR",
  amendmentFlag: false,
};

function duplicateGroup(options: {
  authoritative?: boolean;
  conflict?: boolean;
} = {}): DuplicateGroup {
  const rows = [
    {
      id: "canonical",
      rawAccession: authoritative.canonicalAccession,
      filerCik: authoritative.filerCik,
      filingDate: authoritative.filingDate,
      periodOfReport: authoritative.periodOfReport,
      filingType: authoritative.filingType,
      amendmentFlag: authoritative.amendmentFlag,
      isEffective: true,
    },
    {
      id: "dashed",
      rawAccession: "0000000001-26-000001",
      filerCik: authoritative.filerCik,
      filingDate: authoritative.filingDate,
      periodOfReport: authoritative.periodOfReport,
      filingType: authoritative.filingType,
      amendmentFlag: authoritative.amendmentFlag,
      isEffective: true,
    },
  ];
  return {
    canonicalAccession: authoritative.canonicalAccession,
    rows,
    authoritative: options.authoritative === false ? null : authoritative,
    targets: [{ symbol: "ABC", periodOfReport: authoritative.periodOfReport }],
    fingerprints: new Map([
      [rows[0].rawAccession, { count: 1, digest: "one" }],
      [rows[1].rawAccession, { count: 1, digest: options.conflict ? "two" : "one" }],
    ]),
  };
}

describe("duplicate convergence summary-only mode", () => {
  it("parses summary-only without changing normal apply parsing", () => {
    expect(parseDuplicateConvergenceArgs(["--summary-only"])).toMatchObject({
      summaryOnly: true,
      apply: false,
    });
    expect(parseDuplicateConvergenceArgs(["--apply", "--plan-hash", "hash"])).toMatchObject({
      summaryOnly: false,
      apply: true,
    });
  });

  it("counts replay candidates separately from identity blockers", () => {
    const report = buildSummaryOnlyReport([
      duplicateGroup({ conflict: true }),
      duplicateGroup({ authoritative: false }),
    ], false);
    expect(report).toMatchObject({
      mode: "SUMMARY_ONLY",
      duplicateGroups: 2,
      safeCleanupGroups: 0,
      replayCandidateGroups: 1,
      blockedIdentityGroups: 1,
      replayValidationRequired: 1,
      productionApplyReady: false,
    });
    expect(report.downstreamTargetCount).toBe(1);
    expect(report.diagnosticPlanHash).not.toBe("");
  });

  it("cannot authorize APPLY and emits no expanded target list", () => {
    const report = buildSummaryOnlyReport([duplicateGroup({ conflict: true })], true);
    expect(report.productionApplyReady).toBe(false);
    expect(report).not.toHaveProperty("downstreamTargets");
    expect(report).toMatchObject({
      journalPresent: true,
      reason: "REPLAY_VALIDATION_REQUIRED",
    });
  });
});