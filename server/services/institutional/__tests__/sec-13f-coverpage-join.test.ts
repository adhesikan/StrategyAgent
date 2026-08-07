// Tests — SEC 13F Three-Table Join: SUBMISSION + COVERPAGE + INFOTABLE
//
// Sprint: Institutional 13F — Join COVERPAGE.tsv for Filing-Manager Identity
//
// Production failure: SUBMISSION.tsv (current SEC schema) has no manager-name
// column. Manager identity lives in COVERPAGE.tsv and must be joined by
// normalized ACCESSION_NUMBER.
//
// Test cases A–V cover: current schema join, legacy fallback, amendment detection,
// form-type filtering, COVERPAGE resolution variants, CIK precedence, duplicate
// handling, missing-manager failure, linear performance, and backward compat.

import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import {
  parseCoverPageTsv,
  parseBulkQuarterFromBuffer,
  parseSubmissionTsv,
  normalizeAccession,
} from "../sec-13f-bulk-parser";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build an in-memory ZIP buffer with the given files. */
function makeZip(files: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content, "utf8"));
  }
  return zip.toBuffer();
}

// ── Current SEC schema (post-2023 bare TSV) ──────────────────────────────

const ACC1_DASHED   = "0001234567-26-000001";
const ACC2_DASHED   = "0009876543-26-000002";
const ACC1_PLAIN    = "000123456726000001";  // 18-digit unhyphenated form of ACC1_DASHED
const CIK1          = "0001234567";
const CIK2          = "0009876543";

// SUBMISSION: current schema — no manager name column
const CURRENT_SUB_HEADER = "ACCESSION_NUMBER\tFILING_DATE\tSUBMISSIONTYPE\tCIK\tPERIODOFREPORT";
function subRow(acc: string, type = "13F-HR", cik = CIK1) {
  return `${acc}\t2026-02-15\t${type}\t${cik}\t20251231`;
}

// COVERPAGE: current schema — manager name lives here
const CURRENT_CP_HEADER  = "ACCESSION_NUMBER\tFILINGMANAGER_NAME\tISAMENDMENT\tAMENDMENTNO\tAMENDMENTTYPE\tREPORTTYPE\tREPORTCALENDAORQUARTER";
function cpRow(acc: string, name: string, isAmend = "N", rptType = "13F-HR") {
  return `${acc}\t${name}\t${isAmend}\t\t\t${rptType}\t`;
}

// INFOTABLE: current schema
const CURRENT_INFO_HEADER =
  "ACCESSION_NUMBER\tINFOTABLE_SK\tNAMEOFISSUER\tTITLEOFCLASS\tCUSIP\t" +
  "FIGI\tVALUE\tSSHPRNAMT\tSSHPRNAMTTYPE\tPUTCALL\tINVESTMENTDISCRETION\t" +
  "OTHERMANAGER\tVOTING_AUTH_SOLE\tVOTING_AUTH_SHARED\tVOTING_AUTH_NONE";
function infoRow(acc: string, cusip = "037833100", issuer = "APPLE INC", putCall = "") {
  return `${acc}\t1\t${issuer}\tCOM\t${cusip}\t\t1500\t10000\tSH\t${putCall}\tSOLE\t\t10000\t0\t0`;
}

// Legacy SEC schema (pre-2024 hyphenated)
const LEGACY_SUB_HEADER  = "ACCESSION-NUMBER\tCIK\tNAME\tFORM-TYPE\tFILING-DATE\tCONFORMED-PERIOD-OF-REPORT";
const LEGACY_CP_HEADER   = "ACCESSION-NUMBER\tFILINGMANAGER-NAME\tIS-AMENDMENT\tREPORT-TYPE";
const LEGACY_INFO_HEADER =
  "ACCESSION-NUMBER\tNAMEOFISSUER\tTITLEOFCLASS\tCUSIP\tVALUE\tSSHPRNAMT\t" +
  "SSHPRNAMTTYPE\tPUTCALL\tINVESTMENTDISCRETION\tOTHERMANAGER\t" +
  "VOTINGAUTHORITY-SOLE\tVOTINGAUTHORITY-SHARED\tVOTINGAUTHORITY-NONE";
function legacySubRow(acc: string, name: string, type = "13F-HR") {
  return `${acc}\t${CIK1}\t${name}\t${type}\t2026-02-15\t2025-12-31`;
}
function legacyInfoRow(acc: string, cusip = "037833100") {
  return `${acc}\tAPPLE INC\tCOM\t${cusip}\t1500\t10000\tSH\t\tSOLE\t\t10000\t0\t0`;
}

// ---------------------------------------------------------------------------
// A. Current schema: SUBMISSION has no manager-name column; COVERPAGE provides it
// ---------------------------------------------------------------------------

describe("A. Current schema — COVERPAGE supplies manager identity", () => {
  it("A01: successful three-table join with current SEC headers", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "TEST FUND LP")].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });

    const r = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.status).toBe("success");
    expect(r.holdings).toHaveLength(1);
    expect(r.holdings[0].filerName).toBe("TEST FUND LP");
    expect(r.holdings[0].filerCik).toBe(CIK1);
    expect(r.diagnostics.resolvedCoverPageEntry).toBe("COVERPAGE.tsv");
    expect(r.diagnostics.coverPageJoinCount).toBe(1);
    expect(r.diagnostics.joinedHoldingRows).toBe(1);
    expect(r.diagnostics.missingManagerIdentityCount).toBe(0);
  });

  it("A02: diagnostics include all COVERPAGE fields", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "TEST FUND LP")].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });

    const { diagnostics: d } = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(d.coverPageRows).toBe(1);
    expect(d.parsedCoverPageRows).toBe(1);
    expect(d.coverPageHeaderMapping["manager name"]).toBeTruthy();
    expect(d.coverPageUnmatchedSubmissionCount).toBe(0);
    expect(d.duplicateCoverPageAccessionCount).toBe(0);
    expect(d.managerCikConflictCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B. Current underscore-style headers are handled
// ---------------------------------------------------------------------------

describe("B. Current underscore-style headers", () => {
  it("B01: SUBMISSIONTYPE column is recognized as form type", () => {
    // SUBMISSION has SUBMISSIONTYPE (not FORM-TYPE or FORM_TYPE)
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED, "13F-HR")].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "FUND A")].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.holdings[0].filingType).toBe("13F-HR");
  });

  it("B02: VOTING_AUTH_SOLE/SHARED/NONE in INFOTABLE are resolved", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "FUND A")].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.holdings[0].votingSole).toBe(10000);
    expect(r.holdings[0].votingShared).toBe(0);
    expect(r.holdings[0].votingNone).toBe(0);
  });

  it("B03: FILINGMANAGER_NAME in COVERPAGE resolves via alias normalization", () => {
    const cp = parseCoverPageTsv(
      [CURRENT_CP_HEADER, cpRow(ACC1_DASHED, "MY FUND LLC")].join("\n"),
    );
    expect(cp.canonicalMapping["manager name"]).toBe("FILINGMANAGER_NAME");
    expect(cp.byAccession.get(ACC1_DASHED)?.managerName).toBe("MY FUND LLC");
  });
});

// ---------------------------------------------------------------------------
// C. Legacy hyphenated headers — SUBMISSION has manager name
// ---------------------------------------------------------------------------

describe("C. Legacy hyphenated headers (SUBMISSION has manager name)", () => {
  it("C01: legacy archive without COVERPAGE succeeds using SUBMISSION manager name", () => {
    const sub  = [LEGACY_SUB_HEADER, legacySubRow(ACC1_DASHED, "OLD FUND LP")].join("\n");
    const info = [LEGACY_INFO_HEADER, legacyInfoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "INFOTABLE.tsv": info });

    const r = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.status).toBe("success");
    expect(r.holdings).toHaveLength(1);
    expect(r.holdings[0].filerName).toBe("OLD FUND LP");
    expect(r.diagnostics.resolvedCoverPageEntry).toBeNull(); // not in archive
  });

  it("C02: legacy archive WITH COVERPAGE — COVERPAGE name takes precedence", () => {
    const sub  = [LEGACY_SUB_HEADER, legacySubRow(ACC1_DASHED, "OLD FUND LP")].join("\n");
    const cp   = [LEGACY_CP_HEADER,  `${ACC1_DASHED}\tNEW FUND NAME\tN\t13F-HR`].join("\n");
    const info = [LEGACY_INFO_HEADER, legacyInfoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });

    const r = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.status).toBe("success");
    // COVERPAGE name takes precedence when present
    expect(r.holdings[0].filerName).toBe("NEW FUND NAME");
  });
});

// ---------------------------------------------------------------------------
// D. Manager name present ONLY in COVERPAGE (current production case)
// ---------------------------------------------------------------------------

describe("D. Manager name only in COVERPAGE", () => {
  it("D01: SUBMISSION lacks name column; COVERPAGE provides it; holding is joined", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "COVERPAGE FUND")].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.holdings[0].filerName).toBe("COVERPAGE FUND");
    expect(r.diagnostics.missingManagerIdentityCount).toBe(0);
  });

  it("D02: canonicalMapping shows manager name field is absent in SUBMISSION", () => {
    const sub = parseSubmissionTsv(
      [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n"),
    );
    expect(sub.canonicalMapping["manager name"]).toBeNull();
    expect(sub.missingHeaders).not.toContain("manager name"); // optional
  });
});

// ---------------------------------------------------------------------------
// E. CIK present only in SUBMISSION (the normal current-schema case)
// ---------------------------------------------------------------------------

describe("E. CIK present only in SUBMISSION", () => {
  it("E01: CIK from SUBMISSION populates filerCik correctly", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED, "13F-HR", "12345")].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "MY FUND")].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    // CIK is padded to 10 digits
    expect(r.holdings[0].filerCik).toBe("0000012345");
    expect(r.diagnostics.managerCikConflictCount).toBe(0);
    expect(r.diagnostics.missingManagerCikCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F. CIK present only in COVERPAGE (not in SUBMISSION) — N/A in current schema
// COVERPAGE has no CIK field; if SUBMISSION CIK is missing, CIK is blank.
// ---------------------------------------------------------------------------

describe("F. CIK absent from SUBMISSION (COVERPAGE has no CIK field)", () => {
  it("F01: SUBMISSION without CIK column fails required-header validation", () => {
    const noCikHeader = "ACCESSION_NUMBER\tFILING_DATE\tSUBMISSIONTYPE\tPERIODOFREPORT"; // no CIK
    const sub = [noCikHeader, `${ACC1_DASHED}\t2026-02-15\t13F-HR\t20251231`].join("\n");
    const r   = parseSubmissionTsv(sub);
    expect(r.missingHeaders).toContain("CIK");
  });
});

// ---------------------------------------------------------------------------
// G. Matching CIK (same CIK across sources — from SUBMISSION only)
// ---------------------------------------------------------------------------

describe("G. CIK from SUBMISSION (single authoritative source)", () => {
  it("G01: managerCikConflictCount is always 0 (single CIK source)", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "FUND X")].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.diagnostics.managerCikConflictCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// H. Conflicting CIK — N/A since COVERPAGE has no CIK field; managerCikConflictCount = 0
// ---------------------------------------------------------------------------

describe("H. CIK conflict (N/A: COVERPAGE has no CIK; conflict count is always 0)", () => {
  it("H01: managerCikConflictCount is 0 when CIK source is SUBMISSION only", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "FUND X")].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    // COVERPAGE has no CIK field in current SEC schema → never a conflict
    expect(r.diagnostics.managerCikConflictCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// I. Missing COVERPAGE entry — filing counted as unresolved when no fallback
// ---------------------------------------------------------------------------

describe("I. Missing COVERPAGE entry", () => {
  it("I01: archive with no COVERPAGE and no SUBMISSION name → MANAGER_IDENTITY_SOURCE_MISSING", () => {
    // Current schema: SUBMISSION has no name column; COVERPAGE is missing
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.status).toBe("empty_parse_failure");
    expect(r.reason).toContain("MANAGER_IDENTITY_SOURCE_MISSING");
    expect(r.diagnostics.resolvedCoverPageEntry).toBeNull();
  });

  it("I02: no fabricated manager identity on COVERPAGE miss", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.holdings).toHaveLength(0);
  });

  it("I03: INFOTABLE rows with no COVERPAGE match counted as missingManagerIdentityCount", () => {
    // SUBMISSION has name column (legacy path); one INFOTABLE row has an accession
    // that is NOT in SUBMISSION → it's skipped (not a missing-manager case, just an
    // unmatched row). The missingManagerIdentityCount counts only rows where we found
    // a SUBMISSION row but could not resolve a name.
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "FUND A")].join("\n");
    // INFOTABLE row for a different accession — not in SUBMISSION, not in COVERPAGE
    const info = [CURRENT_INFO_HEADER, infoRow(ACC2_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    // Row skipped because ACC2 not in subMap — not a manager-identity failure
    expect(r.diagnostics.joinedHoldingRows).toBe(0);
    expect(r.diagnostics.missingManagerIdentityCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// J. Duplicate identical COVERPAGE rows — deterministic deduplication
// ---------------------------------------------------------------------------

describe("J. Duplicate identical COVERPAGE rows", () => {
  it("J01: two identical COVERPAGE rows produce one result row", () => {
    const row = cpRow(ACC1_DASHED, "FUND DUPE");
    const cp  = [CURRENT_CP_HEADER, row, row].join("\n");
    const r   = parseCoverPageTsv(cp);
    expect(r.parsedRows).toBe(1);
    expect(r.duplicateAccessionCount).toBe(1);
    expect(r.byAccession.get(ACC1_DASHED)?.managerName).toBe("FUND DUPE");
  });

  it("J02: three identical rows → one result, two counted as duplicates", () => {
    const row = cpRow(ACC1_DASHED, "FUND DUPE");
    const cp  = [CURRENT_CP_HEADER, row, row, row].join("\n");
    const r   = parseCoverPageTsv(cp);
    expect(r.parsedRows).toBe(1);
    expect(r.duplicateAccessionCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// K. Conflicting duplicate COVERPAGE rows — AMBIGUOUS_MANAGER_IDENTITY
// ---------------------------------------------------------------------------

describe("K. Conflicting duplicate COVERPAGE rows", () => {
  it("K01: two rows with same accession but different manager name → accession excluded from map", () => {
    const cp = [
      CURRENT_CP_HEADER,
      cpRow(ACC1_DASHED, "FUND ONE"),
      cpRow(ACC1_DASHED, "FUND TWO"),
    ].join("\n");
    const r = parseCoverPageTsv(cp);
    expect(r.byAccession.has(ACC1_DASHED)).toBe(false); // excluded — ambiguous
    expect(r.conflictingAccessionCount).toBe(1);
    expect(r.duplicateAccessionCount).toBe(1);
  });

  it("K02: ambiguous COVERPAGE accession causes missingManagerIdentityCount in full join", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const cp   = [
      CURRENT_CP_HEADER,
      cpRow(ACC1_DASHED, "FUND ONE"),
      cpRow(ACC1_DASHED, "FUND TWO"),
    ].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    // COVERPAGE has conflicting names → can't resolve manager → row skipped
    expect(r.diagnostics.missingManagerIdentityCount).toBe(1);
    expect(r.diagnostics.joinedHoldingRows).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// L. Hyphenated vs unhyphenated accession across all three files
// ---------------------------------------------------------------------------

describe("L. Accession normalization across SUBMISSION + COVERPAGE + INFOTABLE", () => {
  it("L01: ACC1_DASHED in SUBMISSION, ACC1_PLAIN in INFOTABLE — join succeeds", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "FUND A")].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_PLAIN)].join("\n"); // plain format
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.holdings).toHaveLength(1);
    expect(r.holdings[0].accessionNumber).toBe(ACC1_DASHED); // always normalized
  });

  it("L02: ACC1_PLAIN in COVERPAGE, ACC1_DASHED in SUBMISSION — join succeeds", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_PLAIN, "FUND A")].join("\n"); // plain in CP
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.holdings).toHaveLength(1);
    expect(r.holdings[0].filerName).toBe("FUND A");
  });

  it("L03: normalizeAccession is idempotent on dashed format", () => {
    expect(normalizeAccession(ACC1_DASHED)).toBe(ACC1_DASHED);
    expect(normalizeAccession(ACC1_PLAIN)).toBe(ACC1_DASHED);
  });
});

// ---------------------------------------------------------------------------
// M. Nested / bare / case-varied COVERPAGE archive resolution
// ---------------------------------------------------------------------------

describe("M. COVERPAGE archive resolution variants", () => {
  it("M01: bare root COVERPAGE.tsv resolves (current production)", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "FUND A")].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.diagnostics.resolvedCoverPageEntry).toBe("COVERPAGE.tsv");
  });

  it("M02: nested COVERPAGE.tsv (inside subdir) resolves via basename match", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "FUND A")].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({
      "data/SUBMISSION.tsv": sub,
      "data/COVERPAGE.tsv": cp,
      "data/INFOTABLE.tsv": info,
    });
    const r = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.diagnostics.resolvedCoverPageEntry).toBe("data/COVERPAGE.tsv");
    expect(r.holdings).toHaveLength(1);
  });

  it("M03: legacy-prefixed COVERPAGE (2023Q4_COVERPAGE.TSV) resolves", () => {
    const legacySub  = [LEGACY_SUB_HEADER, legacySubRow(ACC1_DASHED, "OLD FUND")].join("\n");
    const legacyCp   = [LEGACY_CP_HEADER,  `${ACC1_DASHED}\tOLD FUND\tN\t13F-HR`].join("\n");
    const legacyInfo = [LEGACY_INFO_HEADER, legacyInfoRow(ACC1_DASHED)].join("\n");
    // Legacy archive with quarter-prefixed names
    const buf = makeZip({
      "2023Q4_SUBMISSION.TSV": legacySub,
      "2023Q4_COVERPAGE.TSV": legacyCp,
      "2023Q4_INFOTABLE.TSV": legacyInfo,
    });
    const r = parseBulkQuarterFromBuffer(buf, 2023, 4);
    // Should resolve via legacy_prefixed tier
    expect(r.diagnostics.resolvedCoverPageEntry).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// N. 13F-HR included
// ---------------------------------------------------------------------------

describe("N. 13F-HR form type included", () => {
  it("N01: SUBMISSIONTYPE=13F-HR rows are included", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED, "13F-HR")].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "FUND HR")].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.holdings).toHaveLength(1);
    expect(r.holdings[0].isAmendment).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// O. 13F-HR/A included
// ---------------------------------------------------------------------------

describe("O. 13F-HR/A amendment included", () => {
  it("O01: SUBMISSIONTYPE=13F-HR/A rows are included with isAmendment=true", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED, "13F-HR/A")].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "FUND HRA", "Y")].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.holdings).toHaveLength(1);
    expect(r.holdings[0].isAmendment).toBe(true);
    expect(r.holdings[0].filingType).toBe("13F-HR/A");
  });
});

// ---------------------------------------------------------------------------
// P. 13F-NT excluded
// ---------------------------------------------------------------------------

describe("P. 13F-NT excluded", () => {
  it("P01: 13F-NT rows are excluded from SUBMISSION parse (no information table)", () => {
    const sub = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED, "13F-NT")].join("\n");
    const r   = parseSubmissionTsv(sub);
    expect(r.rows).toHaveLength(0); // filtered out
    expect(r.totalRows).toBe(1);    // seen but excluded
  });

  it("P02: parseBulkQuarterFromBuffer excludes 13F-NT from joined holdings", () => {
    const sub  = [
      CURRENT_SUB_HEADER,
      subRow(ACC1_DASHED, "13F-NT"),   // excluded
      subRow(ACC2_DASHED, "13F-HR"),   // included
    ].join("\n");
    const cp   = [
      CURRENT_CP_HEADER,
      cpRow(ACC1_DASHED, "NT FUND"),
      cpRow(ACC2_DASHED, "HR FUND"),
    ].join("\n");
    const info = [
      CURRENT_INFO_HEADER,
      infoRow(ACC1_DASHED, "037833100", "APPLE INC"),
      infoRow(ACC2_DASHED, "594918104", "MICROSOFT CORP"),
    ].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.holdings).toHaveLength(1);
    expect(r.holdings[0].filerName).toBe("HR FUND");
  });
});

// ---------------------------------------------------------------------------
// Q. 13F-NT/A excluded
// ---------------------------------------------------------------------------

describe("Q. 13F-NT/A excluded", () => {
  it("Q01: 13F-NT/A rows are excluded from SUBMISSION parse", () => {
    const sub = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED, "13F-NT/A")].join("\n");
    const r   = parseSubmissionTsv(sub);
    expect(r.rows).toHaveLength(0);
    expect(r.totalRows).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// R. Complete three-table join produces joinedHoldingRows > 0
// ---------------------------------------------------------------------------

describe("R. Complete three-table join → joinedHoldingRows > 0", () => {
  it("R01: two managers with multiple holdings each all join correctly", () => {
    const sub  = [
      CURRENT_SUB_HEADER,
      subRow(ACC1_DASHED, "13F-HR", CIK1),
      subRow(ACC2_DASHED, "13F-HR", CIK2),
    ].join("\n");
    const cp   = [
      CURRENT_CP_HEADER,
      cpRow(ACC1_DASHED, "FUND ONE"),
      cpRow(ACC2_DASHED, "FUND TWO"),
    ].join("\n");
    const info = [
      CURRENT_INFO_HEADER,
      infoRow(ACC1_DASHED, "037833100"),
      infoRow(ACC1_DASHED, "594918104"),
      infoRow(ACC2_DASHED, "023135106"),
    ].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.diagnostics.joinedHoldingRows).toBe(3);
    expect(r.holdings.filter((h) => h.filerName === "FUND ONE")).toHaveLength(2);
    expect(r.holdings.filter((h) => h.filerName === "FUND TWO")).toHaveLength(1);
    expect(r.diagnostics.coverPageJoinCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// S. Missing manager source → MANAGER_IDENTITY_SOURCE_MISSING
// ---------------------------------------------------------------------------

describe("S. Missing manager source → precise error", () => {
  it("S01: current SUBMISSION with no COVERPAGE → MANAGER_IDENTITY_SOURCE_MISSING", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.status).toBe("empty_parse_failure");
    expect(r.reason).toContain("MANAGER_IDENTITY_SOURCE_MISSING");
    expect(r.holdings).toHaveLength(0);
  });

  it("S02: COVERPAGE with missing manager-name header → MANAGER_IDENTITY_SOURCE_MISSING", () => {
    const sub   = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    // COVERPAGE exists but has no recognizable manager-name column
    const cp    = `ACCESSION_NUMBER\tSOME_OTHER_FIELD\n${ACC1_DASHED}\tvalue`;
    const info  = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf   = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r     = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.status).toBe("empty_parse_failure");
    expect(r.reason).toContain("MANAGER_IDENTITY_SOURCE_MISSING");
  });
});

// ---------------------------------------------------------------------------
// T. Large-row path remains linear (performance guard)
// ---------------------------------------------------------------------------

describe("T. Large-row path — linear complexity", () => {
  it("T01: 100 000 INFOTABLE rows join in well under 10 s", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "BIG FUND")].join("\n");
    // Build 100k info rows (same accession, varying CUSIP)
    const infoLines = [CURRENT_INFO_HEADER];
    for (let i = 0; i < 100_000; i++) {
      const cusip = String(i).padStart(9, "0");
      infoLines.push(infoRow(ACC1_DASHED, cusip, `ISSUER ${i}`));
    }
    const buf  = makeZip({
      "SUBMISSION.tsv": sub,
      "COVERPAGE.tsv": cp,
      "INFOTABLE.tsv": infoLines.join("\n"),
    });
    const t0 = Date.now();
    const r  = parseBulkQuarterFromBuffer(buf, 2026, 1);
    const ms = Date.now() - t0;
    expect(r.diagnostics.joinedHoldingRows).toBe(100_000);
    expect(ms).toBeLessThan(10_000);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// U. Existing INFOTABLE put/call and PRN handling remains unchanged
// ---------------------------------------------------------------------------

describe("U. INFOTABLE put/call and PRN handling (backward compat)", () => {
  it("U01: put/call rows are included but counted in putCallExcludedRows", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "FUND A")].join("\n");
    const info = [
      CURRENT_INFO_HEADER,
      infoRow(ACC1_DASHED, "037833100", "APPLE INC", "Put"),
      infoRow(ACC1_DASHED, "037833100", "APPLE INC", "Call"),
      infoRow(ACC1_DASHED, "594918104", "MSFT"),       // common stock
    ].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.holdings).toHaveLength(3); // all rows included
    expect(r.diagnostics.putCallExcludedRows).toBe(2);
    expect(r.diagnostics.eligibleCommonStockRows).toBe(1);
    expect(r.holdings[0].putCall).toBe("Put");
    expect(r.holdings[1].putCall).toBe("Call");
    expect(r.holdings[2].putCall).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// V. EMPTY_PARSE_FAILURE for genuinely incompatible archive schema
// ---------------------------------------------------------------------------

describe("V. EMPTY_PARSE_FAILURE for incompatible archive schema", () => {
  it("V01: completely unknown SUBMISSION headers → empty_parse_failure", () => {
    const sub  = "UNKNOWN_A\tUNKNOWN_B\nval1\tval2";
    const cp   = [CURRENT_CP_HEADER, cpRow(ACC1_DASHED, "FUND A")].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.status).toBe("empty_parse_failure");
  });

  it("V02: completely unknown INFOTABLE headers → empty_parse_failure", () => {
    const sub  = [CURRENT_SUB_HEADER, subRow(ACC1_DASHED)].join("\n");
    const cp   = [CURRENT_CP_HEADER,  cpRow(ACC1_DASHED, "FUND A")].join("\n");
    const info = "UNKNOWN_X\tUNKNOWN_Y\nval1\tval2";
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.status).toBe("empty_parse_failure");
    expect(r.reason).toMatch(/INFOTABLE.*missing|required.*missing/i);
  });

  it("V03: zero SUBMISSION rows → empty_parse_failure", () => {
    const sub  = [CURRENT_SUB_HEADER].join("\n"); // header only, no rows
    const cp   = [CURRENT_CP_HEADER].join("\n");
    const info = [CURRENT_INFO_HEADER, infoRow(ACC1_DASHED)].join("\n");
    const buf  = makeZip({ "SUBMISSION.tsv": sub, "COVERPAGE.tsv": cp, "INFOTABLE.tsv": info });
    const r    = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.status).toBe("empty_parse_failure");
  });
});

// ---------------------------------------------------------------------------
// Additional: parseCoverPageTsv unit tests
// ---------------------------------------------------------------------------

describe("parseCoverPageTsv — unit", () => {
  it("CP01: required fields present → parsedRows = 1", () => {
    const cp = [CURRENT_CP_HEADER, cpRow(ACC1_DASHED, "MY FUND")].join("\n");
    const r  = parseCoverPageTsv(cp);
    expect(r.missingHeaders).toHaveLength(0);
    expect(r.parsedRows).toBe(1);
    expect(r.byAccession.get(ACC1_DASHED)?.managerName).toBe("MY FUND");
  });

  it("CP02: isAmendment flag is parsed", () => {
    const cp = [CURRENT_CP_HEADER, cpRow(ACC1_DASHED, "MY FUND", "Y")].join("\n");
    const r  = parseCoverPageTsv(cp);
    expect(r.byAccession.get(ACC1_DASHED)?.isAmendment).toBe(true);
  });

  it("CP03: missing accession column → missingHeaders contains 'accession'", () => {
    const noAcc = `FILINGMANAGER_NAME\tISAMENDMENT\nFUND A\tN`;
    const r     = parseCoverPageTsv(noAcc);
    expect(r.missingHeaders).toContain("accession");
  });

  it("CP04: missing manager-name column → missingHeaders contains 'manager name'", () => {
    const noName = `ACCESSION_NUMBER\tISAMENDMENT\n${ACC1_DASHED}\tN`;
    const r      = parseCoverPageTsv(noName);
    expect(r.missingHeaders).toContain("manager name");
  });

  it("CP05: row with empty manager name is skipped", () => {
    const cp = `ACCESSION_NUMBER\tFILINGMANAGER_NAME\n${ACC1_DASHED}\t`;
    const r  = parseCoverPageTsv(cp);
    expect(r.parsedRows).toBe(0);
  });

  it("CP06: BOM on header line is stripped", () => {
    const cp = `\uFEFFACCESSION_NUMBER\tFILINGMANAGER_NAME\n${ACC1_DASHED}\tFUND A`;
    const r  = parseCoverPageTsv(cp);
    expect(r.missingHeaders).toHaveLength(0);
    expect(r.parsedRows).toBe(1);
  });
});
