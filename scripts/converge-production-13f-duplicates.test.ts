import { describe, expect, it, vi } from "vitest";
import {
  buildSummaryOnlyReport,
  buildPublicPlanReport,
  createValidationCachedLoader,
  parseDuplicateConvergenceArgs,
  persistReplaySource,
  replayFailureCode,
  SOURCE_REJECTION_CODES,
  replayGroupsNeedingValidation,
  replayValidationMetadataFingerprint,
  replayValidationsFromCheckpoints,
  validateReplayGroups,
} from "./converge-production-13f-duplicates";
import {
  buildDuplicateConvergencePlan,
  loadAuthoritativeReplaySource,
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
      throw new Error("AUTHORITATIVE_INFOTABLE_INVALID:WRONG_DOCUMENT_SELECTED");
    }, {
      checkpoint: async (_group, source, code) => { checkpoints.push({ source, code }); },
    });
    expect(result.get(authoritative.canonicalAccession)).toBeNull();
    expect(checkpoints).toEqual([
      { source: null, code: "AUTHORITATIVE_INFOTABLE_INVALID_WRONG_DOCUMENT_SELECTED" },
    ]);
  });

  it("resumes by reusing completed current checkpoints and validates only remaining replay groups", () => {
    const first = duplicateGroup({ conflict: true });
    const second = duplicateGroup({ conflict: true });
    second.canonicalAccession = "000000000126000002";
    second.authoritative = { ...authoritative, canonicalAccession: second.canonicalAccession };
    const current = replayValidationsFromCheckpoints([first, second], new Map([
      [first.canonicalAccession, {
        metadataFingerprint: replayValidationMetadataFingerprint(first.authoritative),
        validatorVersion: "13f-replay-validator-v4",
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

describe("authoritative replay identity (validator v2)", () => {
  const REPLAY_AUTH = {
    filingDate: "2026-05-15",
    periodOfReport: "2026-03-31",
    filingType: "13F-HR",
    amendmentFlag: false,
  };

  function replayCandidateGroup(options: {
    accession: string;
    managerCik: string;
    authoritative?: boolean;
    authoritativeAccession?: string;
  }): DuplicateGroup {
    const { accession, managerCik } = options;
    const dashed = `${accession.slice(0, 10)}-${accession.slice(10, 12)}-${accession.slice(12)}`;
    const rows = [accession, dashed].map((rawAccession, index) => ({
      id: index === 0 ? "canonical" : "dashed",
      rawAccession,
      filerCik: managerCik,
      filingDate: REPLAY_AUTH.filingDate,
      periodOfReport: REPLAY_AUTH.periodOfReport,
      filingType: REPLAY_AUTH.filingType,
      amendmentFlag: REPLAY_AUTH.amendmentFlag,
      isEffective: true,
      filerName: "Test Manager",
    }));
    return {
      canonicalAccession: accession,
      rows,
      authoritative: options.authoritative === false ? null : {
        canonicalAccession: options.authoritativeAccession ?? accession,
        filerCik: managerCik,
        ...REPLAY_AUTH,
      },
      targets: [{ symbol: "ABC", periodOfReport: REPLAY_AUTH.periodOfReport }],
      // Conflicting non-empty holding fingerprints route the group to
      // AUTHORITATIVE_REPLAY (not SAFE_CLEANUP).
      fingerprints: new Map([
        [rows[0].rawAccession, { count: 1, digest: "one" }],
        [rows[1].rawAccession, { count: 1, digest: "two" }],
      ]),
    };
  }

  function replayOperation(options: Parameters<typeof replayCandidateGroup>[0]) {
    const operation = buildDuplicateConvergencePlan([replayCandidateGroup(options)]).operations[0];
    expect(operation.action).toBe("AUTHORITATIVE_REPLAY");
    return operation;
  }

  function fakeSecFetcher(managerCik: string): ReplaySourceFetcher {
    const managerCikTrimmed = managerCik.replace(/^0+/, "");
    const xml =
      `<?xml version="1.0"?><informationTable><infoTable>` +
      `<nameOfIssuer>APPLE INC</nameOfIssuer><titleOfClass>COM</titleOfClass>` +
      `<cusip>037833100</cusip><value>10</value><shrsOrPrnAmt>` +
      `<sshPrnamt>20</sshPrnamt><sshPrnamtType>SH</sshPrnamtType>` +
      `</shrsOrPrnAmt><investmentDiscretion>SOLE</investmentDiscretion>` +
      `<votingAuthority><Sole>20</Sole><Shared>0</Shared><None>0</None>` +
      `</votingAuthority></infoTable></informationTable>`;
    return async (url: string) => {
      const accessionInUrl = url.match(/\/(\d{18})\//)?.[1] ?? "";
      const text = url.endsWith("-index.html")
        ? `<a href="/Archives/edgar/data/${managerCikTrimmed}/${accessionInUrl}/table.xml">Information Table</a>`
        : xml;
      return {
        text,
        legacyText: text,
        status: 200,
        contentType: "text/xml",
        byteLength: Buffer.byteLength(text),
        decodingError: false,
        detectedEncoding: "UTF-8",
      };
    };
  }

  it("1. agent-filed: manager CIK differs from accession prefix -> replay succeeds", async () => {
    const managerCik = "0009999999";
    const op = replayOperation({ accession: "000111111126000001", managerCik });
    expect(op.canonicalAccession.slice(0, 10)).not.toBe(managerCik);
    const source = await loadAuthoritativeReplaySource(op, fakeSecFetcher(managerCik));
    expect(source.holdings).toHaveLength(1);
    expect(source.sourceChecksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("2. self-filed: manager CIK equals accession prefix -> replay still succeeds", async () => {
    const managerCik = "0009999999";
    const op = replayOperation({ accession: "000999999926000001", managerCik });
    expect(op.canonicalAccession.slice(0, 10)).toBe(managerCik);
    const source = await loadAuthoritativeReplaySource(op, fakeSecFetcher(managerCik));
    expect(source.holdings).toHaveLength(1);
  });

  it("3. missing authoritative metadata -> fail closed without fetching", async () => {
    const op = {
      ...replayOperation({ accession: "000111111126000003", managerCik: "0009999999" }),
      authoritative: null,
    };
    const fetcher = vi.fn();
    await expect(loadAuthoritativeReplaySource(op, fetcher as unknown as ReplaySourceFetcher))
      .rejects.toThrow("AUTHORITATIVE_REPLAY_IDENTITY_INVALID");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("4. authoritative accession mismatch -> fail closed without fetching", async () => {
    const op = replayOperation({
      accession: "000111111126000004",
      managerCik: "0009999999",
      authoritativeAccession: "000111111126000099",
    });
    const fetcher = vi.fn();
    await expect(loadAuthoritativeReplaySource(op, fetcher as unknown as ReplaySourceFetcher))
      .rejects.toThrow("AUTHORITATIVE_REPLAY_IDENTITY_INVALID");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("5. malformed manager CIK -> fail closed without fetching", async () => {
    const base = replayOperation({ accession: "000111111126000005", managerCik: "0009999999" });
    const fetcher = vi.fn();
    for (const filerCik of ["99", "00009999XX", "00099999990"]) {
      await expect(loadAuthoritativeReplaySource(
        { ...base, authoritative: { ...base.authoritative!, filerCik } },
        fetcher as unknown as ReplaySourceFetcher,
      )).rejects.toThrow("AUTHORITATIVE_REPLAY_IDENTITY_INVALID");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("6. replay source lookup uses authoritative manager CIK, not the accession prefix", async () => {
    const managerCik = "0009999999";
    const op = replayOperation({ accession: "000111111126000006", managerCik });
    const urls: string[] = [];
    const inner = fakeSecFetcher(managerCik);
    const source = await loadAuthoritativeReplaySource(op, async (url, cacheKey, signal) => {
      urls.push(url);
      return inner(url, cacheKey, signal);
    });
    expect(urls[0]).toContain("/Archives/edgar/data/9999999/000111111126000006/");
    expect(urls.join(" ")).not.toContain("/data/1111111/");
    expect(source.indexUrl).toContain("/data/9999999/");
    expect(source.sourceUrl).toContain("/Archives/edgar/data/9999999/000111111126000006/table.xml");
  });

  it("7. bulk-recovered agent-filed metadata flows through validateReplayGroups with no identity rejection", async () => {
    const managerCik = "0009999999";
    const group = replayCandidateGroup({ accession: "000111111126000007", managerCik });
    const validations = await validateReplayGroups(
      [group],
      (operation) => loadAuthoritativeReplaySource(operation, fakeSecFetcher(managerCik)),
    );
    expect(validations.get("000111111126000007")).toMatchObject({ holdingCount: 1 });
  });

  it("8. info-table sub-codes expand ONLY for exact SourceRejectionCode values; everything else collapses safely", () => {
    // Every real SourceRejectionCode is preserved, joined onto the prefix.
    expect(SOURCE_REJECTION_CODES.length).toBe(16);
    for (const code of SOURCE_REJECTION_CODES) {
      const out = replayFailureCode(new Error(`AUTHORITATIVE_INFOTABLE_INVALID:${code}`));
      expect(out).toBe(`AUTHORITATIVE_INFOTABLE_INVALID_${code}`);
      expect(out.length).toBeLessThanOrEqual(100);
      expect(out).toMatch(/^[A-Z0-9_]+$/);
    }

    // Anything that is NOT an exact SourceRejectionCode -> bare prefix only.
    for (const rejected of [
      "ABC123SECRET",                    // unknown alphanumeric token / possible secret
      "HTML",                            // not a SourceRejectionCode
      "https://sec.gov/foo",             // URL
      "https://sec.gov/x?token=SECRET",  // URL carrying a credential
      "wrong_document_selected",         // lowercase form of a real code
      "some free form text",             // free-form exception text
      "UNKNOWN_UPPERCASE_TOKEN",         // well-formed but not in the enum
      "",                                // empty sub-code
    ]) {
      expect(replayFailureCode(new Error(`AUTHORITATIVE_INFOTABLE_INVALID:${rejected}`)))
        .toBe("AUTHORITATIVE_INFOTABLE_INVALID");
    }

    // Non-whitelisted families: only a bare top-level code token survives, never later segments.
    expect(replayFailureCode(new Error("SOME_ERROR:ABC123SECRET"))).toBe("SOME_ERROR");
    expect(replayFailureCode(new Error("AUTHORITATIVE_REPLAY_SOURCE_DRIFT")))
      .toBe("AUTHORITATIVE_REPLAY_SOURCE_DRIFT");

    // URLs / raw exception text / empty -> safe constant.
    expect(replayFailureCode(new Error("https://example.com/foo"))).toBe("REPLAY_VALIDATION_FAILED");
    expect(replayFailureCode(new Error("fetch failed: connection reset by peer")))
      .toBe("REPLAY_VALIDATION_FAILED");
    expect(replayFailureCode(new Error(""))).toBe("REPLAY_VALIDATION_FAILED");

    // Deterministic, charset- and length-bounded, no secret leakage.
    for (const input of [
      "AUTHORITATIVE_INFOTABLE_INVALID:WRONG_DOCUMENT_SELECTED",
      "AUTHORITATIVE_INFOTABLE_INVALID:ABC123SECRET",
      "AUTHORITATIVE_INFOTABLE_INVALID:https://sec.gov/x?token=SECRET",
      "SOME_ERROR:ABC123SECRET",
      "https://example.com/foo",
      `${"X".repeat(200)}:${"Y".repeat(200)}`,
    ]) {
      const code = replayFailureCode(new Error(input));
      expect(replayFailureCode(new Error(input))).toBe(code);
      expect(code.length).toBeLessThanOrEqual(100);
      expect(code).toMatch(/^[A-Z0-9_]+$/);
      expect(code).not.toContain("SECRET");
    }
  });

  it("9. an older-generation checkpoint (v1, v2, v3) is stale under validator v4 and must be revalidated", () => {
    const group = replayCandidateGroup({ accession: "000111111126000009", managerCik: "0009999999" });
    for (const staleVersion of ["13f-replay-validator-v1", "13f-replay-validator-v2", "13f-replay-validator-v3"]) {
      const current = replayValidationsFromCheckpoints([group], new Map([
        [group.canonicalAccession, {
          metadataFingerprint: replayValidationMetadataFingerprint(group.authoritative),
          validatorVersion: staleVersion,
          status: "VALID",
          sourceUrl: "https://www.sec.gov/one.xml",
          sourceChecksum: "a".repeat(64),
          holdingCount: 1,
        }],
      ]));
      expect(current.get(group.canonicalAccession)).toBeNull();
      expect(replayGroupsNeedingValidation([group], current).map((g) => g.canonicalAccession))
        .toEqual([group.canonicalAccession]);
    }
  });

  it("10. a current v4 checkpoint with a matching fingerprint remains reusable", () => {
    const group = replayCandidateGroup({ accession: "000111111126000010", managerCik: "0009999999" });
    const current = replayValidationsFromCheckpoints([group], new Map([
      [group.canonicalAccession, {
        metadataFingerprint: replayValidationMetadataFingerprint(group.authoritative),
        validatorVersion: "13f-replay-validator-v4",
        status: "VALID",
        sourceUrl: "https://www.sec.gov/one.xml",
        sourceChecksum: "a".repeat(64),
        holdingCount: 1,
      }],
    ]));
    expect(current.get(group.canonicalAccession)).toMatchObject({
      sourceUrl: "https://www.sec.gov/one.xml",
      holdingCount: 1,
    });
    expect(replayGroupsNeedingValidation([group], current)).toEqual([]);
  });
});