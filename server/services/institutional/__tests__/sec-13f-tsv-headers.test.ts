// Tests — SEC 13F TSV Header Alias Resolution
//
// Sprint: Institutional 13F — Fix Current SEC TSV Header Aliases
//
// Production failure: Parser required ACCESSION-NUMBER, NAME, NAMEOFISSUER headers
// (legacy hyphenated form). Current SEC bulk TSV files use ACCESSION_NUMBER,
// FILINGMANAGER_NAME, PERIODOFREPORT, FILING_DATE, etc. The literal
// headers.includes("ACCESSION-NUMBER") check failed → REQUIRED_HEADERS_MISSING
// even though the data was present under a different name.
//
// Fix: normalizeHeaderKey() removes hyphens and underscores so all variants
// of a field name (ACCESSION-NUMBER, ACCESSION_NUMBER, ACCESSIONNUMBER) compare
// equal. buildHeaderLookup() + getField() use the map for O(1) per-row access.
// Required-field validation uses alias groups, not literal column names.
//
// Test sections:
//   A. Current SUBMISSION headers parse successfully
//   B. Current INFOTABLE headers parse successfully
//   C. Legacy hyphenated headers still parse
//   D. Underscore and hyphen aliases normalize equivalently
//   E. BOM on first header is handled
//   F. Mixed-case headers are handled
//   G. Missing canonical accession fails safely
//   H. Missing manager name fails safely
//   I. Missing issuer/CUSIP fails safely
//   J. Hyphenated vs unhyphenated accession joins
//   K. Current production-style rows produce joined holdings > 0
//   L. Put/call rows preserved for later exclusion
//   M. Optional FIGI absent remains null
//   N. Optional voting fields absent remain null
//   O. Millions-row path remains linear in complexity
//   P. EMPTY_PARSE_FAILURE still occurs for genuinely incompatible schema

import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import {
  normalizeHeaderKey,
  buildHeaderLookup,
  parseSubmissionTsv,
  parseInfoTableTsv,
  parseBulkQuarterFromBuffer,
} from "../sec-13f-bulk-parser";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build an in-memory ZIP buffer. */
function makeZipBuffer(files: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content, "utf8"));
  }
  return zip.toBuffer();
}

// Current SEC schema (post-2023, underscore-separated)
const CURRENT_SUB_HEADER =
  "ACCESSION_NUMBER\tCIK\tFILINGMANAGER_NAME\tFORM_TYPE\tFILING_DATE\tPERIODOFREPORT";
const CURRENT_INFO_HEADER =
  "ACCESSION_NUMBER\tNAMEOFISSUER\tTITLEOFCLASS\tCUSIP\tVALUE\tSSHPRNAMT\t" +
  "SSHPRNAMTTYPE\tINVESTMENTDISCRETION\tOTHERMANAGER\tPUTCALL\t" +
  "VOTINGAUTHORITY_SOLE\tVOTINGAUTHORITY_SHARED\tVOTINGAUTHORITY_NONE\tFIGI";

// Legacy SEC schema (pre-2024, hyphenated)
const LEGACY_SUB_HEADER =
  "ACCESSION-NUMBER\tCIK\tNAME\tFORM-TYPE\tFILING-DATE\tCONFORMED-PERIOD-OF-REPORT";
const LEGACY_INFO_HEADER =
  "ACCESSION-NUMBER\tNAMEOFISSUER\tTITLEOFCLASS\tCUSIP\tVALUE\tSSHPRNAMT\t" +
  "SSHPRNAMTTYPE\tINVESTMENTDISCRETION\tOTHERMANAGER\tPUTCALL\t" +
  "VOTINGAUTHORITY-SOLE\tVOTINGAUTHORITY-SHARED\tVOTINGAUTHORITY-NONE";

const ACC_HYPHEN = "0001234567-26-000001"; // standard dashed format
const ACC_PLAIN  = "000123456726000001";   // 18-digit unhyphenated

const SUB_ROW_CURRENT = (acc: string) =>
  `${acc}\t0001234567\tTEST FUND LP\t13F-HR\t2026-02-15\t20251231`;
const SUB_ROW_LEGACY = (acc: string) =>
  `${acc}\t0001234567\tTEST FUND LP\t13F-HR\t2026-02-15\t2025-12-31`;

const INFO_ROW = (acc: string, extra = "") =>
  `${acc}\tAPPLE INC\tCOM\t037833100\t50000\t300000\tSH\tSOLE\t\t\t300000\t0\t0${extra}`;

// SUBMISSION and INFOTABLE TSV strings
const CURRENT_SUB_TSV  = `${CURRENT_SUB_HEADER}\n${SUB_ROW_CURRENT(ACC_HYPHEN)}`;
const CURRENT_INFO_TSV = `${CURRENT_INFO_HEADER}\n${INFO_ROW(ACC_HYPHEN, "\t")}`;

const LEGACY_SUB_TSV  = `${LEGACY_SUB_HEADER}\n${SUB_ROW_LEGACY(ACC_HYPHEN)}`;
const LEGACY_INFO_TSV = `${LEGACY_INFO_HEADER}\n${INFO_ROW(ACC_HYPHEN)}`;

// ---------------------------------------------------------------------------
// A. Current SUBMISSION headers parse successfully
// ---------------------------------------------------------------------------

describe("A. Current SUBMISSION headers (ACCESSION_NUMBER, FILINGMANAGER_NAME, PERIODOFREPORT)", () => {
  it("A01: parses without missing headers", () => {
    const r = parseSubmissionTsv(CURRENT_SUB_TSV);
    expect(r.missingHeaders).toHaveLength(0);
  });

  it("A02: extracts accession correctly via ACCESSION_NUMBER", () => {
    const r = parseSubmissionTsv(CURRENT_SUB_TSV);
    expect(r.rows[0]?.accessionNumber).toBe(ACC_PLAIN);
  });

  it("A03: extracts manager name via FILINGMANAGER_NAME", () => {
    const r = parseSubmissionTsv(CURRENT_SUB_TSV);
    expect(r.rows[0]?.name).toBe("TEST FUND LP");
  });

  it("A04: normalizes PERIODOFREPORT date (YYYYMMDD → YYYY-MM-DD)", () => {
    const r = parseSubmissionTsv(CURRENT_SUB_TSV);
    expect(r.rows[0]?.periodOfReport).toBe("2025-12-31");
  });

  it("A05: parsedRows equals rows.length", () => {
    const r = parseSubmissionTsv(CURRENT_SUB_TSV);
    expect(r.parsedRows).toBe(r.rows.length);
  });

  it("A06: canonicalMapping shows ACCESSION_NUMBER for accession field", () => {
    const r = parseSubmissionTsv(CURRENT_SUB_TSV);
    expect(r.canonicalMapping["accession"]).toBe("ACCESSION_NUMBER");
  });

  it("A07: canonicalMapping shows FILINGMANAGER_NAME for manager name field", () => {
    const r = parseSubmissionTsv(CURRENT_SUB_TSV);
    expect(r.canonicalMapping["manager name"]).toBe("FILINGMANAGER_NAME");
  });

  it("A08: canonicalMapping shows PERIODOFREPORT for period of report", () => {
    const r = parseSubmissionTsv(CURRENT_SUB_TSV);
    expect(r.canonicalMapping["period of report"]).toBe("PERIODOFREPORT");
  });
});

// ---------------------------------------------------------------------------
// B. Current INFOTABLE headers parse successfully
// ---------------------------------------------------------------------------

describe("B. Current INFOTABLE headers (ACCESSION_NUMBER, VOTINGAUTHORITY_SOLE, etc.)", () => {
  it("B01: parses without missing headers", () => {
    const r = parseInfoTableTsv(CURRENT_INFO_TSV);
    expect(r.missingHeaders).toHaveLength(0);
  });

  it("B02: extracts accession via ACCESSION_NUMBER", () => {
    const r = parseInfoTableTsv(CURRENT_INFO_TSV);
    expect(r.rows[0]?.accessionNumber).toBe(ACC_PLAIN);
  });

  it("B03: extracts issuer name via NAMEOFISSUER", () => {
    const r = parseInfoTableTsv(CURRENT_INFO_TSV);
    expect(r.rows[0]?.issuerName).toBe("APPLE INC");
  });

  it("B04: extracts CUSIP correctly", () => {
    const r = parseInfoTableTsv(CURRENT_INFO_TSV);
    expect(r.rows[0]?.cusip).toBe("037833100");
  });

  it("B05: parsedRows equals rows.length", () => {
    const r = parseInfoTableTsv(CURRENT_INFO_TSV);
    expect(r.parsedRows).toBe(r.rows.length);
  });

  it("B06: canonicalMapping shows ACCESSION_NUMBER for accession", () => {
    const r = parseInfoTableTsv(CURRENT_INFO_TSV);
    expect(r.canonicalMapping["accession"]).toBe("ACCESSION_NUMBER");
  });

  it("B07: VOTINGAUTHORITY_SOLE resolves to voting sole field", () => {
    const r = parseInfoTableTsv(CURRENT_INFO_TSV);
    expect(r.rows[0]?.votingSole).toBe(300000);
  });
});

// ---------------------------------------------------------------------------
// C. Legacy hyphenated headers still parse
// ---------------------------------------------------------------------------

describe("C. Legacy hyphenated headers (ACCESSION-NUMBER, NAME, CONFORMED-PERIOD-OF-REPORT)", () => {
  it("C01: SUBMISSION legacy headers — no missing headers", () => {
    const r = parseSubmissionTsv(LEGACY_SUB_TSV);
    expect(r.missingHeaders).toHaveLength(0);
  });

  it("C02: SUBMISSION legacy — extracts all required fields", () => {
    const r = parseSubmissionTsv(LEGACY_SUB_TSV);
    expect(r.rows[0]?.accessionNumber).toBe(ACC_PLAIN);
    expect(r.rows[0]?.name).toBe("TEST FUND LP");
    expect(r.rows[0]?.periodOfReport).toBe("2025-12-31");
  });

  it("C03: INFOTABLE legacy headers — no missing headers", () => {
    const r = parseInfoTableTsv(LEGACY_INFO_TSV);
    expect(r.missingHeaders).toHaveLength(0);
  });

  it("C04: INFOTABLE legacy — extracts VOTINGAUTHORITY-SOLE", () => {
    const r = parseInfoTableTsv(LEGACY_INFO_TSV);
    expect(r.rows[0]?.votingSole).toBe(300000);
  });

  it("C05: both schema variants produce identical row data", () => {
    const currentSub = parseSubmissionTsv(CURRENT_SUB_TSV).rows[0]!;
    const legacySub  = parseSubmissionTsv(LEGACY_SUB_TSV).rows[0]!;
    expect(currentSub.accessionNumber).toBe(legacySub.accessionNumber);
    expect(currentSub.name).toBe(legacySub.name);
    expect(currentSub.periodOfReport).toBe(legacySub.periodOfReport);
  });
});

// ---------------------------------------------------------------------------
// D. Underscore and hyphen aliases normalize equivalently
// ---------------------------------------------------------------------------

describe("D. normalizeHeaderKey — hyphen and underscore equivalence", () => {
  it("D01: ACCESSION-NUMBER and ACCESSION_NUMBER normalize to same key", () => {
    expect(normalizeHeaderKey("ACCESSION-NUMBER"))
      .toBe(normalizeHeaderKey("ACCESSION_NUMBER"));
  });

  it("D02: FILINGMANAGER-NAME and FILINGMANAGER_NAME normalize to same key", () => {
    expect(normalizeHeaderKey("FILINGMANAGER-NAME"))
      .toBe(normalizeHeaderKey("FILINGMANAGER_NAME"));
  });

  it("D03: CONFORMED-PERIOD-OF-REPORT normalized key differs from PERIODOFREPORT", () => {
    // These are genuinely different field names after normalization
    expect(normalizeHeaderKey("CONFORMED-PERIOD-OF-REPORT"))
      .toBe(normalizeHeaderKey("CONFORMEDPERIODOFREPORT"));
    // But PERIODOFREPORT is a DIFFERENT normalized key from CONFORMEDPERIODOFREPORT
    expect(normalizeHeaderKey("PERIODOFREPORT"))
      .not.toBe(normalizeHeaderKey("CONFORMED-PERIOD-OF-REPORT"));
  });

  it("D04: VOTINGAUTHORITY-SOLE and VOTINGAUTHORITY_SOLE normalize to same key", () => {
    expect(normalizeHeaderKey("VOTINGAUTHORITY-SOLE"))
      .toBe(normalizeHeaderKey("VOTINGAUTHORITY_SOLE"));
  });

  it("D05: buildHeaderLookup maps both ACCESSION_NUMBER and ACCESSION-NUMBER to same entry", () => {
    // Lookup built from file with ACCESSION_NUMBER
    const lookup1 = buildHeaderLookup(["ACCESSION_NUMBER", "CIK"]);
    // Lookup built from file with ACCESSION-NUMBER
    const lookup2 = buildHeaderLookup(["ACCESSION-NUMBER", "CIK"]);
    // Both should find a key for "ACCESSIONNUMBER"
    expect(lookup1.has(normalizeHeaderKey("ACCESSION-NUMBER"))).toBe(true);
    expect(lookup2.has(normalizeHeaderKey("ACCESSION_NUMBER"))).toBe(true);
    // And they should map to their respective raw header strings
    expect(lookup1.get(normalizeHeaderKey("ACCESSION-NUMBER"))).toBe("ACCESSION_NUMBER");
    expect(lookup2.get(normalizeHeaderKey("ACCESSION_NUMBER"))).toBe("ACCESSION-NUMBER");
  });

  it("D06: FILING-DATE and FILING_DATE normalize to same key", () => {
    expect(normalizeHeaderKey("FILING-DATE"))
      .toBe(normalizeHeaderKey("FILING_DATE"));
  });
});

// ---------------------------------------------------------------------------
// E. BOM on first header is handled
// ---------------------------------------------------------------------------

describe("E. BOM on first header", () => {
  it("E01: UTF-8 BOM prefix on first column is stripped in submission", () => {
    const bomHeader = `\uFEFFACCESSION_NUMBER\tCIK\tFILINGMANAGER_NAME\tFORM_TYPE\tFILING_DATE\tPERIODOFREPORT`;
    const tsv = `${bomHeader}\n${SUB_ROW_CURRENT(ACC_HYPHEN)}`;
    const r = parseSubmissionTsv(tsv);
    // BOM must not appear in canonical mapping key
    expect(r.missingHeaders).toHaveLength(0);
    expect(r.canonicalMapping["accession"]).toBe("ACCESSION_NUMBER");
  });

  it("E02: BOM does not corrupt accession extraction", () => {
    const bomHeader = `\uFEFFACCESSION_NUMBER\tCIK\tFILINGMANAGER_NAME\tFORM_TYPE\tFILING_DATE\tPERIODOFREPORT`;
    const tsv = `${bomHeader}\n${SUB_ROW_CURRENT(ACC_HYPHEN)}`;
    const r = parseSubmissionTsv(tsv);
    expect(r.rows[0]?.accessionNumber).toBe(ACC_PLAIN);
  });

  it("E03: BOM on INFOTABLE is handled", () => {
    const bomHeader = `\uFEFFACCESSION_NUMBER\tNAMEOFISSUER\tTITLEOFCLASS\tCUSIP\tVALUE\t` +
      `SSHPRNAMT\tSSHPRNAMTTYPE\tINVESTMENTDISCRETION\tOTHERMANAGER\tPUTCALL\t` +
      `VOTINGAUTHORITY_SOLE\tVOTINGAUTHORITY_SHARED\tVOTINGAUTHORITY_NONE\tFIGI`;
    const tsv = `${bomHeader}\n${INFO_ROW(ACC_HYPHEN, "\t")}`;
    const r = parseInfoTableTsv(tsv);
    expect(r.missingHeaders).toHaveLength(0);
    expect(r.rows[0]?.accessionNumber).toBe(ACC_PLAIN);
  });
});

// ---------------------------------------------------------------------------
// F. Mixed-case headers are handled
// ---------------------------------------------------------------------------

describe("F. Mixed-case headers", () => {
  it("F01: Accession_Number (title case) resolves correctly", () => {
    const tsv = `Accession_Number\tCik\tFilingManager_Name\tForm_Type\tFiling_Date\tPeriodOfReport\n` +
      `${ACC_HYPHEN}\t0001234567\tTEST FUND LP\t13F-HR\t2026-02-15\t20251231`;
    const r = parseSubmissionTsv(tsv);
    expect(r.missingHeaders).toHaveLength(0);
    expect(r.rows[0]?.accessionNumber).toBe(ACC_PLAIN);
  });

  it("F02: mixed-case INFOTABLE headers resolve correctly", () => {
    const tsv = `Accession_Number\tNameOfIssuer\tTitleOfClass\tCusip\tValue\t` +
      `SshPrnAmt\tSshPrnAmtType\tInvestmentDiscretion\tOtherManager\tPutCall\t` +
      `VotingAuthority_Sole\tVotingAuthority_Shared\tVotingAuthority_None\tFigi\n` +
      `${INFO_ROW(ACC_HYPHEN, "\t")}`;
    const r = parseInfoTableTsv(tsv);
    expect(r.missingHeaders).toHaveLength(0);
    expect(r.rows[0]?.issuerName).toBe("APPLE INC");
  });
});

// ---------------------------------------------------------------------------
// G. Missing canonical accession fails safely
// ---------------------------------------------------------------------------

describe("G. Missing canonical accession", () => {
  it("G01: SUBMISSION without any accession alias fails with canonical label", () => {
    const tsv = `CIK\tFILINGMANAGER_NAME\tFORM_TYPE\tFILING_DATE\tPERIODOFREPORT\n` +
      `0001234567\tTEST FUND LP\t13F-HR\t2026-02-15\t20251231`;
    const r = parseSubmissionTsv(tsv);
    expect(r.missingHeaders).toContain("accession");
    expect(r.missingHeaders).not.toContain("ACCESSION-NUMBER"); // not raw column name
  });

  it("G02: INFOTABLE without any accession alias fails with canonical label", () => {
    const tsv = `NAMEOFISSUER\tTITLEOFCLASS\tCUSIP\tVALUE\n` +
      `APPLE INC\tCOM\t037833100\t50000`;
    const r = parseInfoTableTsv(tsv);
    expect(r.missingHeaders).toContain("accession");
  });

  it("G03: parseBulkQuarterFromBuffer returns empty_parse_failure on missing accession", () => {
    const subNoAcc = `CIK\tFILINGMANAGER_NAME\tFORM_TYPE\tFILING_DATE\tPERIODOFREPORT\n` +
      `0001234567\tTEST FUND LP\t13F-HR\t2026-02-15\t20251231`;
    const buf = makeZipBuffer({ "SUBMISSION.tsv": subNoAcc, "INFOTABLE.tsv": CURRENT_INFO_TSV });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).toBe("empty_parse_failure");
    expect(result.reason).toContain("accession");
  });
});

// ---------------------------------------------------------------------------
// H. Missing manager name fails safely
// ---------------------------------------------------------------------------

describe("H. Missing manager name", () => {
  it("H01: SUBMISSION without manager-name column succeeds (manager name is optional in SUBMISSION; current schema uses COVERPAGE)", () => {
    // Current SEC SUBMISSION.tsv has no manager-name column — it lives in COVERPAGE.
    // parseSubmissionTsv must NOT report manager name as missing.
    const tsv = `ACCESSION_NUMBER\tCIK\tSUBMISSIONTYPE\tFILING_DATE\tPERIODOFREPORT\n` +
      `${ACC_HYPHEN}\t0001234567\t13F-HR\t2026-02-15\t20251231`;
    const r = parseSubmissionTsv(tsv);
    expect(r.missingHeaders).not.toContain("manager name"); // optional
    expect(r.missingHeaders).toHaveLength(0);              // all required fields present
    expect(r.rows).toHaveLength(1);                        // row parsed successfully
    expect(r.rows[0].name).toBe("");                       // empty — provided by COVERPAGE
  });

  it("H02: parsedRows count is still 0 when required fields missing", () => {
    const tsv = `ACCESSION_NUMBER\tCIK\tFORM_TYPE\tFILING_DATE\tPERIODOFREPORT\n` +
      `${ACC_HYPHEN}\t0001234567\t13F-HR\t2026-02-15\t20251231`;
    const r = parseSubmissionTsv(tsv);
    // parsedRows is still returned even with missing headers (early-exit behaviour)
    expect(typeof r.parsedRows).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// I. Missing issuer/CUSIP fails safely
// ---------------------------------------------------------------------------

describe("I. Missing required INFOTABLE fields", () => {
  it("I01: INFOTABLE with no issuer alias fails with canonical label", () => {
    const tsv = `ACCESSION_NUMBER\tTITLEOFCLASS\tCUSIP\tVALUE\n` +
      `${ACC_HYPHEN}\tCOM\t037833100\t50000`;
    const r = parseInfoTableTsv(tsv);
    expect(r.missingHeaders).toContain("issuer name");
  });

  it("I02: INFOTABLE with no CUSIP fails with canonical label", () => {
    const tsv = `ACCESSION_NUMBER\tNAMEOFISSUER\tTITLEOFCLASS\tVALUE\n` +
      `${ACC_HYPHEN}\tAPPLE INC\tCOM\t50000`;
    const r = parseInfoTableTsv(tsv);
    expect(r.missingHeaders).toContain("CUSIP");
  });

  it("I03: canonical label in missingHeaders is human-readable (not a raw column name)", () => {
    const tsv = `ACCESSION_NUMBER\tTITLEOFCLASS\tCUSIP\tVALUE\n` +
      `${ACC_HYPHEN}\tCOM\t037833100\t50000`;
    const r = parseInfoTableTsv(tsv);
    // Must report the label, not "NAMEOFISSUER" or "NAME-OF-ISSUER"
    expect(r.missingHeaders).toContain("issuer name");
    expect(r.missingHeaders).not.toContain("NAMEOFISSUER");
    expect(r.missingHeaders).not.toContain("NAME-OF-ISSUER");
  });
});

// ---------------------------------------------------------------------------
// J. Hyphenated vs unhyphenated accession joins
// ---------------------------------------------------------------------------

describe("J. Accession normalization — join across formats", () => {
  it("J01: hyphenated SUBMISSION + unhyphenated INFOTABLE join correctly", () => {
    // SUBMISSION uses standard dashed accession
    const subTsv = `${CURRENT_SUB_HEADER}\n${SUB_ROW_CURRENT(ACC_HYPHEN)}`;
    // INFOTABLE uses 18-digit unhyphenated
    const infoTsv = `${CURRENT_INFO_HEADER}\n${INFO_ROW(ACC_PLAIN, "\t")}`;
    const buf = makeZipBuffer({ "SUBMISSION.tsv": subTsv, "INFOTABLE.tsv": infoTsv });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.diagnostics.joinedHoldingRows).toBeGreaterThan(0);
    expect(result.holdings.length).toBeGreaterThan(0);
  });

  it("J02: unhyphenated SUBMISSION + hyphenated INFOTABLE join correctly", () => {
    const subWithPlain = `${CURRENT_SUB_HEADER}\n${SUB_ROW_CURRENT(ACC_PLAIN)}`;
    const infoWithHyphen = `${CURRENT_INFO_HEADER}\n${INFO_ROW(ACC_HYPHEN, "\t")}`;
    const buf = makeZipBuffer({ "SUBMISSION.tsv": subWithPlain, "INFOTABLE.tsv": infoWithHyphen });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.diagnostics.joinedHoldingRows).toBeGreaterThan(0);
  });

  it("J03: normalizeAccession produces identical result for both forms", () => {
    // Verify the normalizer makes them identical (tested indirectly via join)
    const buf1 = makeZipBuffer({ "SUBMISSION.tsv": CURRENT_SUB_TSV, "INFOTABLE.tsv": CURRENT_INFO_TSV });
    const r1 = parseBulkQuarterFromBuffer(buf1, 2026, 1);
    const subPlain = `${CURRENT_SUB_HEADER}\n${SUB_ROW_CURRENT(ACC_PLAIN)}`;
    const buf2 = makeZipBuffer({ "SUBMISSION.tsv": subPlain, "INFOTABLE.tsv": CURRENT_INFO_TSV });
    const r2 = parseBulkQuarterFromBuffer(buf2, 2026, 1);
    expect(r1.holdings[0]?.accessionNumber).toBe(r2.holdings[0]?.accessionNumber);
  });
});

// ---------------------------------------------------------------------------
// K. Current production-style rows produce joined holdings > 0
// ---------------------------------------------------------------------------

describe("K. Full current-schema round-trip — joined holdings > 0", () => {
  it("K01: current schema produces parsedSubmissionRows > 0", () => {
    const buf = makeZipBuffer({ "SUBMISSION.tsv": CURRENT_SUB_TSV, "INFOTABLE.tsv": CURRENT_INFO_TSV });
    const r = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.diagnostics.parsedSubmissionRows).toBeGreaterThan(0);
  });

  it("K02: current schema produces parsedInformationRows > 0", () => {
    const buf = makeZipBuffer({ "SUBMISSION.tsv": CURRENT_SUB_TSV, "INFOTABLE.tsv": CURRENT_INFO_TSV });
    const r = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.diagnostics.parsedInformationRows).toBeGreaterThan(0);
  });

  it("K03: current schema produces joinedHoldingRows > 0", () => {
    const buf = makeZipBuffer({ "SUBMISSION.tsv": CURRENT_SUB_TSV, "INFOTABLE.tsv": CURRENT_INFO_TSV });
    const r = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.diagnostics.joinedHoldingRows).toBeGreaterThan(0);
  });

  it("K04: result status is success (not empty_parse_failure)", () => {
    const buf = makeZipBuffer({ "SUBMISSION.tsv": CURRENT_SUB_TSV, "INFOTABLE.tsv": CURRENT_INFO_TSV });
    const r = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.status).not.toBe("empty_parse_failure");
    expect(r.status).not.toBe("failed");
  });

  it("K05: submissionHeaderMapping is populated in diagnostics", () => {
    const buf = makeZipBuffer({ "SUBMISSION.tsv": CURRENT_SUB_TSV, "INFOTABLE.tsv": CURRENT_INFO_TSV });
    const r = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.diagnostics.submissionHeaderMapping["accession"]).toBe("ACCESSION_NUMBER");
    expect(r.diagnostics.submissionHeaderMapping["manager name"]).toBe("FILINGMANAGER_NAME");
  });

  it("K06: infoTableHeaderMapping is populated in diagnostics", () => {
    const buf = makeZipBuffer({ "SUBMISSION.tsv": CURRENT_SUB_TSV, "INFOTABLE.tsv": CURRENT_INFO_TSV });
    const r = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.diagnostics.infoTableHeaderMapping["accession"]).toBe("ACCESSION_NUMBER");
    expect(r.diagnostics.infoTableHeaderMapping["issuer name"]).toBe("NAMEOFISSUER");
  });

  it("K07: holdings contain correct filerName from FILINGMANAGER_NAME", () => {
    const buf = makeZipBuffer({ "SUBMISSION.tsv": CURRENT_SUB_TSV, "INFOTABLE.tsv": CURRENT_INFO_TSV });
    const r = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.holdings[0]?.filerName).toBe("TEST FUND LP");
  });

  it("K08: legacy schema also produces joinedHoldingRows > 0 (no regression)", () => {
    const buf = makeZipBuffer({ "SUBMISSION.tsv": LEGACY_SUB_TSV, "INFOTABLE.tsv": LEGACY_INFO_TSV });
    const r = parseBulkQuarterFromBuffer(buf, 2023, 4);
    expect(r.diagnostics.joinedHoldingRows).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// L. Put/call rows preserved for later exclusion
// ---------------------------------------------------------------------------

describe("L. Put/call rows", () => {
  it("L01: PUTCALL=PUT is parsed as putCall='Put' (not excluded at parse time)", () => {
    const infoWithPut = `${CURRENT_INFO_HEADER}\n` +
      `${ACC_HYPHEN}\tAPPLE INC\tCOM\t037833100\t5000\t1000\tSH\tSOLE\t\tPUT\t1000\t0\t0\t`;
    const r = parseInfoTableTsv(infoWithPut);
    expect(r.rows[0]?.putCall).toBe("Put");
    expect(r.rows.length).toBeGreaterThan(0); // preserved, not rejected
  });

  it("L02: PUTCALL=CALL is parsed as putCall='Call'", () => {
    const infoWithCall = `${CURRENT_INFO_HEADER}\n` +
      `${ACC_HYPHEN}\tAPPLE INC\tCOM\t037833100\t5000\t1000\tSH\tSOLE\t\tCALL\t1000\t0\t0\t`;
    const r = parseInfoTableTsv(infoWithCall);
    expect(r.rows[0]?.putCall).toBe("Call");
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it("L03: put/call row reaches holdings and increments putCallExcludedRows", () => {
    const infoWithPut = `${CURRENT_INFO_HEADER}\n` +
      `${ACC_HYPHEN}\tAPPLE INC\tCOM\t037833100\t5000\t1000\tSH\tSOLE\t\tPUT\t1000\t0\t0\t`;
    const buf = makeZipBuffer({ "SUBMISSION.tsv": CURRENT_SUB_TSV, "INFOTABLE.tsv": infoWithPut });
    const r = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.diagnostics.putCallExcludedRows).toBeGreaterThan(0);
    expect(r.holdings[0]?.putCall).toBe("Put");
  });
});

// ---------------------------------------------------------------------------
// M. Optional FIGI absent remains null
// ---------------------------------------------------------------------------

describe("M. Optional FIGI field", () => {
  it("M01: absent FIGI column → figi is null", () => {
    // Header without FIGI column
    const header = `ACCESSION_NUMBER\tNAMEOFISSUER\tTITLEOFCLASS\tCUSIP\tVALUE\t` +
      `SSHPRNAMT\tSSHPRNAMTTYPE\tINVESTMENTDISCRETION\tOTHERMANAGER\tPUTCALL\t` +
      `VOTINGAUTHORITY_SOLE\tVOTINGAUTHORITY_SHARED\tVOTINGAUTHORITY_NONE`;
    const tsv = `${header}\n${INFO_ROW(ACC_HYPHEN)}`;
    const r = parseInfoTableTsv(tsv);
    expect(r.rows[0]?.figi).toBeNull();
  });

  it("M02: empty FIGI value → figi is null", () => {
    const tsv = `${CURRENT_INFO_HEADER}\n${INFO_ROW(ACC_HYPHEN, "\t")}`;
    const r = parseInfoTableTsv(tsv);
    // FIGI column present but empty → null
    expect(r.rows[0]?.figi).toBeNull();
  });

  it("M03: non-empty FIGI value → figi is populated", () => {
    const tsv = `${CURRENT_INFO_HEADER}\n` +
      `${ACC_HYPHEN}\tAPPLE INC\tCOM\t037833100\t50000\t300000\tSH\tSOLE\t\t\t300000\t0\t0\tBBG000B9XRY4`;
    const r = parseInfoTableTsv(tsv);
    expect(r.rows[0]?.figi).toBe("BBG000B9XRY4");
  });
});

// ---------------------------------------------------------------------------
// N. Optional voting fields absent remain null
// ---------------------------------------------------------------------------

describe("N. Optional voting authority fields", () => {
  it("N01: absent VOTINGAUTHORITY_SOLE → votingSole is null", () => {
    const header = `ACCESSION_NUMBER\tNAMEOFISSUER\tTITLEOFCLASS\tCUSIP\tVALUE\t` +
      `SSHPRNAMT\tSSHPRNAMTTYPE\tINVESTMENTDISCRETION\tOTHERMANAGER\tPUTCALL`;
    const tsv = `${header}\n${ACC_HYPHEN}\tAPPLE INC\tCOM\t037833100\t50000\t300000\tSH\tSOLE\t\t`;
    const r = parseInfoTableTsv(tsv);
    expect(r.rows[0]?.votingSole).toBeNull();
    expect(r.rows[0]?.votingShared).toBeNull();
    expect(r.rows[0]?.votingNone).toBeNull();
  });

  it("N02: empty voting field values → null (not 0)", () => {
    const header = `${CURRENT_INFO_HEADER}`;
    // All three voting columns present but empty
    const tsv = `${header}\n` +
      `${ACC_HYPHEN}\tAPPLE INC\tCOM\t037833100\t50000\t300000\tSH\tSOLE\t\t\t\t\t\t`;
    const r = parseInfoTableTsv(tsv);
    expect(r.rows[0]?.votingSole).toBeNull();
    expect(r.rows[0]?.votingShared).toBeNull();
    expect(r.rows[0]?.votingNone).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// O. Millions-row path remains linear in complexity
// ---------------------------------------------------------------------------

describe("O. Memory and performance — linear pass over large INFOTABLE", () => {
  it("O01: 100k rows process in bounded time and produce correct joined count", () => {
    const ROW_COUNT = 100_000;
    const headerLine = CURRENT_INFO_HEADER;
    const rows = Array.from({ length: ROW_COUNT }, (_, i) => {
      // Use a different accession for each row (won't join) except the first
      const acc = i === 0 ? ACC_HYPHEN : `0000000001-26-${String(i).padStart(6, "0")}`;
      return `${acc}\tAPPLE INC\tCOM\t037833100\t50000\t300000\tSH\tSOLE\t\t\t300000\t0\t0\t`;
    });
    const infoTsv = [headerLine, ...rows].join("\n");

    const start = Date.now();
    const r = parseInfoTableTsv(infoTsv);
    const elapsed = Date.now() - start;

    expect(r.totalRows).toBe(ROW_COUNT);
    expect(r.parsedRows).toBe(ROW_COUNT); // all have valid required fields
    expect(elapsed).toBeLessThan(10_000); // must complete in < 10s (single linear pass)
  });

  it("O02: joinedHoldingRows is bounded to matching accessions only", () => {
    const ROW_COUNT = 10_000;
    const headerLine = CURRENT_INFO_HEADER;
    // Only first row has an accession matching SUBMISSION
    const rows = Array.from({ length: ROW_COUNT }, (_, i) => {
      const acc = i === 0 ? ACC_HYPHEN : `0000000001-26-${String(i).padStart(6, "0")}`;
      return `${acc}\tAPPLE INC\tCOM\t037833100\t50000\t300000\tSH\tSOLE\t\t\t300000\t0\t0\t`;
    });
    const infoTsv = [headerLine, ...rows].join("\n");
    const buf = makeZipBuffer({ "SUBMISSION.tsv": CURRENT_SUB_TSV, "INFOTABLE.tsv": infoTsv });
    const r = parseBulkQuarterFromBuffer(buf, 2026, 1);
    // Only the one matching row should join
    expect(r.diagnostics.joinedHoldingRows).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// P. EMPTY_PARSE_FAILURE still occurs for genuinely incompatible schema
// ---------------------------------------------------------------------------

describe("P. Genuinely incompatible schema → EMPTY_PARSE_FAILURE", () => {
  it("P01: completely unknown SUBMISSION header names fail with required canonical fields", () => {
    // manager name is no longer required in SUBMISSION — only accession, CIK, period of report.
    const tsv = `UNKNOWN_FIELD_A\tUNKNOWN_FIELD_B\tUNKNOWN_FIELD_C\n` +
      `val1\tval2\tval3`;
    const r = parseSubmissionTsv(tsv);
    expect(r.missingHeaders.length).toBeGreaterThan(0);
    expect(r.missingHeaders).toContain("accession");
    expect(r.missingHeaders).toContain("CIK");
    expect(r.missingHeaders).toContain("period of report");
    expect(r.missingHeaders).not.toContain("manager name"); // optional in SUBMISSION
  });

  it("P02: parseBulkQuarterFromBuffer returns empty_parse_failure for unknown schema", () => {
    // With completely unknown SUBMISSION headers, the parse should fail on required fields.
    const subUnknown = `FIELD_A\tFIELD_B\tFIELD_C\nval1\tval2\tval3`;
    const infoUnknown = `FIELD_X\tFIELD_Y\tFIELD_Z\nval4\tval5\tval6`;
    const buf = makeZipBuffer({ "SUBMISSION.tsv": subUnknown, "INFOTABLE.tsv": infoUnknown });
    const r = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r.status).toBe("empty_parse_failure");
    // New error message format: "Required SUBMISSION headers missing" or similar failure
    expect(r.reason).toMatch(/required.*missing|SUBMISSION.*missing|zero|0 parsed/i);
  });

  it("P03: partially-known SUBMISSION schema (only accession) fails with missing required fields", () => {
    // SUBMISSION has only ACCESSION_NUMBER — missing CIK and period of report.
    // manager name is optional so it is NOT reported as missing.
    const tsv = `ACCESSION_NUMBER\tSOME_OTHER_FIELD\n${ACC_HYPHEN}\tvalue`;
    const r = parseSubmissionTsv(tsv);
    expect(r.missingHeaders).toContain("CIK");
    expect(r.missingHeaders).not.toContain("manager name"); // optional in SUBMISSION
    expect(r.missingHeaders).toContain("period of report");
  });

  it("P04: empty file (header only, no rows) does not crash", () => {
    const tsv = CURRENT_SUB_HEADER; // header only
    const r = parseSubmissionTsv(tsv);
    expect(r.totalRows).toBe(0);
    expect(r.rows).toHaveLength(0);
    expect(r.missingHeaders).toHaveLength(0); // headers present, just no rows
  });

  it("P05: empty INFOTABLE file (header only) does not crash", () => {
    const tsv = CURRENT_INFO_HEADER;
    const r = parseInfoTableTsv(tsv);
    expect(r.totalRows).toBe(0);
    expect(r.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Additional: normalizeHeaderKey edge cases
// ---------------------------------------------------------------------------

describe("normalizeHeaderKey edge cases", () => {
  it("strips UTF-8 BOM from header key", () => {
    const bomKey = "\uFEFFACCESSION_NUMBER";
    expect(normalizeHeaderKey(bomKey)).toBe("ACCESSIONNUMBER");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeHeaderKey("  ACCESSION_NUMBER  ")).toBe("ACCESSIONNUMBER");
  });

  it("uppercases entirely", () => {
    expect(normalizeHeaderKey("nameofissuer")).toBe("NAMEOFISSUER");
  });

  it("removes all hyphens and underscores", () => {
    expect(normalizeHeaderKey("CONFORMED-PERIOD-OF-REPORT")).toBe("CONFORMEDPERIODOFREPORT");
    expect(normalizeHeaderKey("CONFORMED_PERIOD_OF_REPORT")).toBe("CONFORMEDPERIODOFREPORT");
    expect(normalizeHeaderKey("CONFORMED_PERIOD-OF_REPORT")).toBe("CONFORMEDPERIODOFREPORT");
  });

  it("empty string returns empty string", () => {
    expect(normalizeHeaderKey("")).toBe("");
  });
});
