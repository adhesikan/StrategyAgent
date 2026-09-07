import { describe, expect, it, vi } from "vitest";
import {
  applyManifestToGroups,
  buildManifestItems,
  buildSummaryOnlyReport,
  buildPublicPlanReport,
  computeCandidateSetHash,
  createValidationCachedLoader,
  deriveStoredIdentity,
  groupHoldingsFingerprint,
  manifestPublicationReady,
  parseDuplicateConvergenceArgs,
  persistReplaySource,
  publishValidationRun,
  readLatestCompleteValidationRun,
  replayFailureCode,
  SOURCE_REJECTION_CODES,
  replayGroupsNeedingValidation,
  replayValidationMetadataFingerprint,
  replayValidationsFromCheckpoints,
  validateReplayGroups,
  validationRunItemToAuthoritative,
  type ValidationRunItem,
} from "./converge-production-13f-duplicates";
import {
  buildDuplicateConvergencePlan,
  DUPLICATE_CONVERGENCE_CONFIRMATION,
  getDuplicateConvergenceApplyGuardIssues,
  loadAuthoritativeReplaySource,
  type ConvergenceExecutor,
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
        validatorVersion: "13f-replay-validator-v5",
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

  it("9. an older-generation checkpoint (v1, v2, v3, v4) is stale under validator v5 and must be revalidated", () => {
    const group = replayCandidateGroup({ accession: "000111111126000009", managerCik: "0009999999" });
    for (const staleVersion of ["13f-replay-validator-v1", "13f-replay-validator-v2", "13f-replay-validator-v3", "13f-replay-validator-v4"]) {
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

  it("10. a current v5 checkpoint with a matching fingerprint remains reusable", () => {
    const group = replayCandidateGroup({ accession: "000111111126000010", managerCik: "0009999999" });
    const current = replayValidationsFromCheckpoints([group], new Map([
      [group.canonicalAccession, {
        metadataFingerprint: replayValidationMetadataFingerprint(group.authoritative),
        validatorVersion: "13f-replay-validator-v5",
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

describe("frozen replay-validation manifest (validator v5)", () => {
  function dupGroup(opts: {
    accession: string;
    filerCik?: string;
    filingType?: string;
    amendmentFlag?: boolean;
    /** true → conflicting non-empty holdings (replay-shaped); false → identical (safe) */
    conflict?: boolean;
  }): DuplicateGroup {
    const cik = opts.filerCik ?? "0001234567";
    const filingType = opts.filingType ?? "13F-HR";
    const amendmentFlag = opts.amendmentFlag ?? false;
    const dashed = `${opts.accession.slice(0, 10)}-${opts.accession.slice(10, 12)}-${opts.accession.slice(12)}`;
    const raw = [opts.accession, dashed];
    const rows = raw.map((rawAccession, i) => ({
      id: i === 0 ? "canonical" : "dashed",
      rawAccession,
      filerCik: cik,
      filingDate: "2026-05-15",
      periodOfReport: "2026-03-31",
      filingType,
      amendmentFlag,
      isEffective: true,
      filerName: "Mgr",
    }));
    return {
      canonicalAccession: opts.accession,
      rows,
      fingerprints: new Map(raw.map((r, i) => [
        r,
        opts.conflict ? { count: 1, digest: i === 0 ? "a" : "b" } : { count: 1, digest: "same" },
      ])),
      authoritative: null,
      targets: [{ symbol: "ABC", periodOfReport: "2026-03-31" }],
    };
  }

  function itemFor(group: DuplicateGroup, overrides: Partial<ValidationRunItem> = {}): ValidationRunItem {
    const id = deriveStoredIdentity(group.rows)!;
    return {
      canonicalAccession: id.canonicalAccession,
      metadataFingerprint: replayValidationMetadataFingerprint(id),
      filerCik: id.filerCik,
      filingDate: id.filingDate,
      periodOfReport: id.periodOfReport,
      filingType: id.filingType,
      amendmentFlag: id.amendmentFlag,
      sourceUrl: `https://www.sec.gov/${id.canonicalAccession}.xml`,
      sourceChecksum: "c".repeat(64),
      holdingCount: 5,
      storedHoldingsFingerprint: groupHoldingsFingerprint(group),
      ...overrides,
    };
  }
  const confirm = DUPLICATE_CONVERGENCE_CONFIRMATION;

  it("deriveStoredIdentity requires row agreement", () => {
    const ok = dupGroup({ accession: "000123456726000000", conflict: true });
    expect(deriveStoredIdentity(ok.rows)).toMatchObject({ canonicalAccession: "000123456726000000", filerCik: "0001234567" });
    const conflicted = dupGroup({ accession: "000123456726000000", conflict: true });
    conflicted.rows[1] = { ...conflicted.rows[1], filerCik: "0009999999" };
    expect(deriveStoredIdentity(conflicted.rows)).toBeNull();
  });

  it("1. manifestPublicationReady is true only when every candidate validated; buildManifestItems + publishValidationRun write a COMPLETE run", async () => {
    const has = { sourceUrl: "u", sourceChecksum: "c", holdingCount: 1 };
    expect(manifestPublicationReady(["x", "y"], new Map([["x", has], ["y", has]]))).toBe(true);
    expect(manifestPublicationReady(["x", "y"], new Map([["x", has], ["y", null]]))).toBe(false);
    expect(manifestPublicationReady(["x", "y"], new Map([["x", has]]))).toBe(false);

    const g = dupGroup({ accession: "000123456726000101", conflict: true });
    const validated = { ...g, authoritative: deriveStoredIdentity(g.rows) };
    const items = buildManifestItems([validated], [g.canonicalAccession], new Map([[g.canonicalAccession, has]]));
    let inTransaction = false;
    let statements = 0;
    const rec = async () => { statements += 1; return { rows: [{ id: "run-1" }] }; };
    const executor = {
      execute: rec,
      transaction: async (fn: (t: ConvergenceExecutor) => unknown) => {
        inTransaction = true;
        return fn({ execute: rec } as ConvergenceExecutor);
      },
    } as unknown as ConvergenceExecutor;
    const { runId, candidateSetHash } = await publishValidationRun(executor, "13f-replay-validator-v5", items);
    expect(runId).toBe("run-1");
    expect(candidateSetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(inTransaction).toBe(true);            // atomic publication
    expect(statements).toBe(2);                  // one run INSERT + one items INSERT
  });

  it("2. interrupted validation publishes nothing (buildManifestItems fails closed on a missing validation)", () => {
    const g = dupGroup({ accession: "000123456726000102", conflict: true });
    const validated = { ...g, authoritative: deriveStoredIdentity(g.rows) };
    expect(() => buildManifestItems([validated], [g.canonicalAccession], new Map())).toThrow("MANIFEST_ITEM_INCOMPLETE");
    expect(manifestPublicationReady([g.canonicalAccession], new Map())).toBe(false);
  });

  it("3. a manifest candidate with intact identity + holdings authorizes AUTHORITATIVE_REPLAY", () => {
    const g = dupGroup({ accession: "000123456726000103", conflict: true });
    const items = new Map([[g.canonicalAccession, itemFor(g)]]);
    const { groups, manifestAccessions } = applyManifestToGroups([g], items);
    const plan = buildDuplicateConvergencePlan(groups, "APPLY", { requireReplayValidation: true, manifestAccessions });
    expect(plan.operations[0].action).toBe("AUTHORITATIVE_REPLAY");
    expect(plan.operations[0].replaySourceUrl).toBe(items.get(g.canonicalAccession)!.sourceUrl);
    expect(plan.operations[0].authoritative).toMatchObject({ filerCik: "0001234567" });
    expect(plan.productionApplyReady).toBe(true);
    expect(plan.planChangedGroups).toBe(0);
  });

  it("4 + 10. plan is deterministic for identical DB + manifest and ignores any live resolver output", () => {
    const planHashFor = (resolverCik: string) => {
      const g = dupGroup({ accession: "000123456726000104", conflict: true });
      g.authoritative = {
        canonicalAccession: g.canonicalAccession, filerCik: resolverCik,
        filingDate: "1990-01-01", periodOfReport: "1990-01-01", filingType: "13F-HR/A", amendmentFlag: true,
      };
      const items = new Map([[g.canonicalAccession, itemFor(dupGroup({ accession: "000123456726000104", conflict: true }))]]);
      const { groups, manifestAccessions } = applyManifestToGroups([g], items);
      return buildDuplicateConvergencePlan(groups, "DRY_RUN", { requireReplayValidation: true, manifestAccessions }).planHash;
    };
    expect(planHashFor("0000000001")).toBe(planHashFor("0000000009"));
  });

  it("5. stored identity drift for a manifest accession withholds authorization (fail closed)", () => {
    const validated = dupGroup({ accession: "000123456726000105", conflict: true, filerCik: "0001234567" });
    const items = new Map([[validated.canonicalAccession, itemFor(validated)]]);
    const mutated = dupGroup({ accession: "000123456726000105", conflict: true, filerCik: "0009999999" });
    const { groups, identityDrift, manifestAccessions } = applyManifestToGroups([mutated], items);
    expect(identityDrift).toEqual([mutated.canonicalAccession]);
    expect(groups[0].replayValidation).toBeNull();
    const plan = buildDuplicateConvergencePlan(groups, "APPLY", { requireReplayValidation: true, manifestAccessions });
    expect(plan.operations[0].action).toBe("BLOCKED");
    expect(plan.productionApplyReady).toBe(false);
  });

  it("6. relevant holdings change for a manifest accession withholds authorization", () => {
    const validated = dupGroup({ accession: "000123456726000106", conflict: true });
    const items = new Map([[validated.canonicalAccession, itemFor(validated)]]);
    const changed = dupGroup({ accession: "000123456726000106", conflict: true });
    changed.fingerprints = new Map(
      [...changed.fingerprints.keys()].map((k, i) => [k, { count: 3, digest: i === 0 ? "x" : "y" }]),
    );
    const { groups, holdingsChanged, manifestAccessions } = applyManifestToGroups([changed], items);
    expect(holdingsChanged).toEqual([changed.canonicalAccession]);
    expect(groups[0].replayValidation).toBeNull();
    const plan = buildDuplicateConvergencePlan(groups, "APPLY", { requireReplayValidation: true, manifestAccessions });
    expect(plan.operations[0].action).toBe("BLOCKED");
  });

  it("7. a new replay candidate absent from the manifest => PLAN_CHANGED_REVALIDATION_REQUIRED", () => {
    const known = dupGroup({ accession: "000123456726000107", conflict: true });
    const items = new Map([[known.canonicalAccession, itemFor(known)]]);
    const fresh = dupGroup({ accession: "000123456726000199", conflict: true });
    const { groups, manifestAccessions } = applyManifestToGroups([known, fresh], items);
    const plan = buildDuplicateConvergencePlan(groups, "DRY_RUN", { requireReplayValidation: true, manifestAccessions });
    const op = plan.operations.find((o) => o.canonicalAccession === "000123456726000199")!;
    expect(op.action).toBe("PLAN_CHANGED_REVALIDATION_REQUIRED");
    expect(op.blocker).toBe("PLAN_CHANGED_REVALIDATION_REQUIRED");
    expect(plan.planChangedGroups).toBe(1);
    expect(plan.productionApplyReady).toBe(false);
  });

  it("8. a manifest candidate that vanished or converged drops cleanly", () => {
    const gone = dupGroup({ accession: "000123456726000108", conflict: true });
    const goneItems = new Map([[gone.canonicalAccession, itemFor(gone)]]);
    const vanished = applyManifestToGroups([], goneItems);
    expect(vanished.groups).toEqual([]);
    expect(vanished.identityDrift).toEqual([]);
    const emptyPlan = buildDuplicateConvergencePlan(vanished.groups, "DRY_RUN", {
      requireReplayValidation: true, manifestAccessions: vanished.manifestAccessions,
    });
    expect(emptyPlan.operations).toEqual([]);
    expect(emptyPlan.blockedGroups).toBe(0);

    const converged = dupGroup({ accession: "000123456726000118", conflict: false });
    const convergedItems = new Map([[converged.canonicalAccession, itemFor(converged, {
      storedHoldingsFingerprint: "STALE_IRRELEVANT_ON_SAFE_PATH",
    })]]);
    const applied = applyManifestToGroups([converged], convergedItems);
    const plan = buildDuplicateConvergencePlan(applied.groups, "DRY_RUN", {
      requireReplayValidation: true, manifestAccessions: applied.manifestAccessions,
    });
    expect(plan.operations[0].action).toBe("SAFE_CLEANUP");
    expect(plan.blockedGroups).toBe(0);
    expect(plan.planChangedGroups).toBe(0);
  });

  it("9 + 14. no COMPLETE run for the current version => null (v4 manifest/checkpoint cannot authorize v5)", async () => {
    const empty = { execute: async () => ({ rows: [] }) } as unknown as ConvergenceExecutor;
    expect(await readLatestCompleteValidationRun(empty, "13f-replay-validator-v5")).toBeNull();

    // a v4 checkpoint is not honoured under v5 (validator-version gate).
    const g = dupGroup({ accession: "000123456726000109", conflict: true });
    const withId = { ...g, authoritative: deriveStoredIdentity(g.rows) };
    const current = replayValidationsFromCheckpoints([withId], new Map([
      [g.canonicalAccession, {
        metadataFingerprint: replayValidationMetadataFingerprint(withId.authoritative),
        validatorVersion: "13f-replay-validator-v4",
        status: "VALID",
        sourceUrl: "https://www.sec.gov/x.xml",
        sourceChecksum: "a".repeat(64),
        holdingCount: 1,
      }],
    ]));
    expect(current.get(g.canonicalAccession)).toBeNull();
  });

  it("11. APPLY requires the exact validation run the dry-run planHash used", () => {
    const g = dupGroup({ accession: "000123456726000111", conflict: true });
    const manifestAccessions = new Set([g.canonicalAccession]);
    const planA = buildDuplicateConvergencePlan(
      applyManifestToGroups([g], new Map([[g.canonicalAccession, itemFor(g)]])).groups,
      "APPLY", { requireReplayValidation: true, manifestAccessions },
    );
    const planB = buildDuplicateConvergencePlan(
      applyManifestToGroups([g], new Map([[g.canonicalAccession, itemFor(g, { holdingCount: 99, sourceChecksum: "d".repeat(64) })]])).groups,
      "APPLY", { requireReplayValidation: true, manifestAccessions },
    );
    expect(planA.planHash).not.toBe(planB.planHash);
    // dry-run produced planA.planHash; APPLY recomputed planB against the newer run → rejected.
    expect(getDuplicateConvergenceApplyGuardIssues(planB, { apply: true, planHash: planA.planHash, confirm }))
      .toContain("PLAN_HASH_MISMATCH");
  });

  it("12. APPLY replay still rejects authoritative source drift on a manifest-backed operation", async () => {
    const g = dupGroup({ accession: "000123456726000112", conflict: true });
    const item = itemFor(g);
    const op = buildDuplicateConvergencePlan(
      applyManifestToGroups([g], new Map([[g.canonicalAccession, item]])).groups,
      "APPLY", { requireReplayValidation: true, manifestAccessions: new Set([g.canonicalAccession]) },
    ).operations[0];
    expect(op.replaySourceChecksum).toBe(item.sourceChecksum);
    const execute = vi.fn();
    await expect(persistReplaySource({ execute } as never, op, {
      indexUrl: "https://www.sec.gov/i",
      sourceUrl: item.sourceUrl,
      sourceChecksum: "f".repeat(64),
      holdings: Array.from({ length: item.holdingCount }, () => ({})) as never,
    })).rejects.toThrow("AUTHORITATIVE_REPLAY_SOURCE_DRIFT");
    expect(execute).not.toHaveBeenCalled();
  });

  it("13. journal/apply gate: apply-ready only without BLOCKED/PLAN_CHANGED ops", () => {
    const g = dupGroup({ accession: "000123456726000113", conflict: true });
    const items = new Map([[g.canonicalAccession, itemFor(g)]]);
    const ready = buildDuplicateConvergencePlan(
      applyManifestToGroups([g], items).groups,
      "APPLY", { requireReplayValidation: true, manifestAccessions: new Set([g.canonicalAccession]) },
    );
    expect(ready.productionApplyReady).toBe(true);
    expect(ready.operations.every((o) => o.action === "AUTHORITATIVE_REPLAY" || o.action === "SAFE_CLEANUP")).toBe(true);

    const withNew = applyManifestToGroups([g, dupGroup({ accession: "000123456726000913", conflict: true })], items);
    const changedPlan = buildDuplicateConvergencePlan(withNew.groups, "APPLY", {
      requireReplayValidation: true, manifestAccessions: withNew.manifestAccessions,
    });
    expect(changedPlan.productionApplyReady).toBe(false);
    expect(getDuplicateConvergenceApplyGuardIssues(changedPlan, { apply: true, planHash: changedPlan.planHash, confirm }))
      .toContain("PLAN_NOT_APPLY_READY");
  });

  it("validationRunItemToAuthoritative + candidateSetHash are deterministic and order-independent", () => {
    const a = { canonicalAccession: "000000000126000001", metadataFingerprint: "f1" };
    const b = { canonicalAccession: "000000000126000002", metadataFingerprint: "f2" };
    expect(computeCandidateSetHash([a, b])).toBe(computeCandidateSetHash([b, a]));
    expect(validationRunItemToAuthoritative(itemFor(dupGroup({ accession: "000123456726000120", conflict: true }))))
      .toMatchObject({ canonicalAccession: "000123456726000120", filerCik: "0001234567", filingType: "13F-HR" });
  });
});