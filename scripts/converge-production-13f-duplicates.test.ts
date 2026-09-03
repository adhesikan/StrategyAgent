import { describe, expect, it, vi } from "vitest";
import {
  buildSummaryOnlyReport,
  buildPublicPlanReport,
  createValidationCachedLoader,
  parseDuplicateConvergenceArgs,
  persistReplaySource,
  replayGroupsNeedingValidation,
  replayValidationMetadataFingerprint,
  replayValidationsFromCheckpoints,
  validateReplayGroups,
} from "./converge-production-13f-duplicates";
import {
  buildDuplicateConvergencePlan,
  type DuplicateGroup,
  type ReplaySourceFetcher,
} from "../server/services/institutional/production-duplicate-convergence";

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
      filerName: "Test Manager",
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
      filerName: "Test Manager",
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

  it("requires explicit validation and verbose flags", () => {
    expect(parseDuplicateConvergenceArgs(["--validate-replay", "--verbose"])).toMatchObject({
      validateReplay: true, verbose: true, apply: false,
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

  it("bounds replay validation to two concurrent loaders and checkpoints each result", async () => {
    const groups = ["1", "2", "3"].map((suffix) => ({
      ...duplicateGroup({ conflict: true }),
      canonicalAccession: `00000000012600000${suffix}`,
      authoritative: { ...authoritative, canonicalAccession: `00000000012600000${suffix}` },
    }));
    let active = 0;
    let maximum = 0;
    const checkpoints: string[] = [];
    const results = await validateReplayGroups(groups, async (operation) => {
      active += 1; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { indexUrl: "https://sec.example/index", sourceUrl: `https://sec.example/${operation.canonicalAccession}`,
        sourceChecksum: "a".repeat(64), holdings: [{}] as any };
    }, {
      checkpoint: async (group) => { checkpoints.push(group.canonicalAccession); },
    });
    expect(maximum).toBe(2);
    expect(results.size).toBe(3);
    expect(checkpoints).toHaveLength(3);
  });

  it("fail-closes a failed replay and records a failed checkpoint", async () => {
    const checkpoints: Array<{ source: unknown; code: string | null }> = [];
    const result = await validateReplayGroups([duplicateGroup({ conflict: true })], async () => {
      throw new Error("AUTHORITATIVE_INFOTABLE_INVALID:HTML");
    }, {
      checkpoint: async (_group, source, code) => { checkpoints.push({ source, code }); },
    });
    expect(result.get(authoritative.canonicalAccession)).toBeNull();
    expect(checkpoints).toEqual([{ source: null, code: "AUTHORITATIVE_INFOTABLE_INVALID" }]);
  });

  it("resumes by reusing completed current checkpoints and validates only remaining replay groups", () => {
    const first = duplicateGroup({ conflict: true });
    const second = duplicateGroup({ conflict: true });
    second.canonicalAccession = "000000000126000002";
    second.authoritative = { ...authoritative, canonicalAccession: second.canonicalAccession };
    const current = replayValidationsFromCheckpoints([first, second], new Map([
      [first.canonicalAccession, {
        metadataFingerprint: replayValidationMetadataFingerprint(first.authoritative),
        validatorVersion: "13f-replay-validator-v1",
        status: "VALID",
        sourceUrl: "https://www.sec.gov/one.xml",
        sourceChecksum: "a".repeat(64),
        holdingCount: 1,
      }],
    ]));
    expect(current.get(first.canonicalAccession)).toMatchObject({
      sourceUrl: "https://www.sec.gov/one.xml",
      holdingCount: 1,
    });
    expect(replayGroupsNeedingValidation([first, second], current).map((group) =>
      group.canonicalAccession)).toEqual([second.canonicalAccession]);
  });

  it("reuses validation-only SEC responses without changing the uncached default APPLY loader", async () => {
    const operation = buildDuplicateConvergencePlan(
      [duplicateGroup({ conflict: true })],
    ).operations[0];
    const xml = `<?xml version="1.0"?><informationTable><infoTable>` +
      `<nameOfIssuer>APPLE INC</nameOfIssuer><titleOfClass>COM</titleOfClass>` +
      `<cusip>037833100</cusip><value>10</value><shrsOrPrnAmt>` +
      `<sshPrnamt>20</sshPrnamt><sshPrnamtType>SH</sshPrnamtType>` +
      `</shrsOrPrnAmt><investmentDiscretion>SOLE</investmentDiscretion>` +
      `<votingAuthority><Sole>20</Sole><Shared>0</Shared><None>0</None>` +
      `</votingAuthority></infoTable></informationTable>`;
    const fetchCalls: string[] = [];
    const fetcher: ReplaySourceFetcher = async (url) => {
      fetchCalls.push(url);
      const text = url.endsWith("-index.html")
        ? `<a href="/Archives/edgar/data/1/000000000126000001/table.xml">Information Table</a>`
        : xml;
      return {
        text, legacyText: text, status: 200, contentType: "text/xml",
        byteLength: Buffer.byteLength(text), decodingError: false, detectedEncoding: "UTF-8",
      };
    };
    const loader = createValidationCachedLoader(fetcher);
    await loader(operation);
    await loader(operation);
    expect(fetchCalls).toHaveLength(2);
  });

  it("rejects source drift before issuing any destructive replay statement", async () => {
    const operation = buildDuplicateConvergencePlan(
      [{
        ...duplicateGroup({ conflict: true }),
        replayValidation: {
          sourceUrl: "https://www.sec.gov/expected.xml",
          sourceChecksum: "a".repeat(64),
          holdingCount: 1,
        },
      }],
      "APPLY",
      { requireReplayValidation: true },
    ).operations[0];
    const execute = vi.fn();
    await expect(persistReplaySource({ execute }, operation, {
      indexUrl: "https://www.sec.gov/index",
      sourceUrl: "https://www.sec.gov/drifted.xml",
      sourceChecksum: "b".repeat(64),
      holdings: [{}] as any,
    })).rejects.toThrow("AUTHORITATIVE_REPLAY_SOURCE_DRIFT");
    expect(execute).not.toHaveBeenCalled();
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

  it("keeps normal dry-run output compact unless verbose output is explicit", () => {
    const plan = buildDuplicateConvergencePlan([duplicateGroup()], "DRY_RUN");
    const compact = buildPublicPlanReport(plan, false);
    expect(compact).toMatchObject({
      affectedPeriodsCount: 1,
      affectedSymbolsCount: 1,
      downstreamTargetCount: 1,
    });
    expect(compact).not.toHaveProperty("affectedPeriods");
    expect(compact).not.toHaveProperty("affectedSymbols");
    expect(compact).not.toHaveProperty("downstreamTargets");
    expect(buildPublicPlanReport(plan, false, true)).toHaveProperty("downstreamTargets");
  });
});