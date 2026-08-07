// Tests P — SEC Form 13F Bulk Dataset Parser
//
// Covers: parseTsv, normalizeAccession, parseSubmissionTsv, parseInfoTableTsv,
//         findZipEntry, parseBulkQuarterFromBuffer, selectAvailableQuarters.
//
// Fixture ZIPs are created in-memory using adm-zip to mirror the actual SEC archive
// structure (uppercase .TSV entries, tab-delimited, UTF-8 with optional BOM).
//
// ROOT CAUSE DOCUMENTED:
//   parseQuarterlyIndex() in sec-client.ts checked line.includes("|")
//   but company.idx is fixed-width, not pipe-delimited → always 0 entries.
//   These tests validate the replacement bulk-ZIP parser.

import { describe, it, expect, vi } from "vitest";
import AdmZip from "adm-zip";
import {
  parseTsv,
  normalizeAccession,
  parseSubmissionTsv,
  parseInfoTableTsv,
  findZipEntry,
  parseBulkQuarterFromBuffer,
  entryPrefix,
  bulkDatasetUrl,
  selectAvailableQuarters,
} from "../sec-13f-bulk-parser";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const SUB_HEADERS =
  "ACCESSION-NUMBER\tFORM-TYPE\tCIK\tNAME\tFILING-DATE\tCONFORMED-PERIOD-OF-REPORT";

const INFO_HEADERS =
  "ACCESSION-NUMBER\tINFOTABLE-INDEX\tNAMEOFISSUER\tTITLEOFCLASS\tCUSIP\tFIGI\tVALUE\tSSHPRNAMT\tSSHPRNAMTTYPE\tPUTCALL\tINVESTMENTDISCRETION\tOTHERMANAGER\tVOTINGAUTHORITY-SOLE\tVOTINGAUTHORITY-SHARED\tVOTINGAUTHORITY-NONE";

function makeSubRow(
  accession = "0001234567-26-000001",
  formType = "13F-HR",
  cik = "0001234567",
  name = "VANGUARD GROUP INC",
  filingDate = "2026-02-14",
  period = "2025-12-31",
): string {
  return `${accession}\t${formType}\t${cik}\t${name}\t${filingDate}\t${period}`;
}

function makeInfoRow(
  accession = "0001234567-26-000001",
  issuer = "APPLE INC",
  classTitle = "COM",
  cusip = "037833100",
  figi = "",
  value = "5000000",
  shares = "25000000",
  type = "SH",
  putCall = "",
  discr = "SOLE",
  other = "",
  sole = "25000000",
  shared = "0",
  none = "0",
): string {
  return `${accession}\t1\t${issuer}\t${classTitle}\t${cusip}\t${figi}\t${value}\t${shares}\t${type}\t${putCall}\t${discr}\t${other}\t${sole}\t${shared}\t${none}`;
}

function makeZip(
  year: number,
  q: 1 | 2 | 3 | 4,
  submissionContent: string,
  infoTableContent: string,
  { upperCase = true }: { upperCase?: boolean } = {},
): Buffer {
  const prefix = entryPrefix(year, q);
  const ext = upperCase ? "TSV" : "tsv";
  const zip = new AdmZip();
  zip.addFile(`${prefix}_SUBMISSION.${ext}`, Buffer.from(submissionContent, "utf8"));
  zip.addFile(`${prefix}_INFOTABLE.${ext}`, Buffer.from(infoTableContent, "utf8"));
  return zip.toBuffer();
}

function makeZipWithDirectory(
  year: number,
  q: 1 | 2 | 3 | 4,
  submissionContent: string,
  infoTableContent: string,
): Buffer {
  const prefix = entryPrefix(year, q);
  const zip = new AdmZip();
  zip.addFile(`data/${prefix}_SUBMISSION.TSV`, Buffer.from(submissionContent, "utf8"));
  zip.addFile(`data/${prefix}_INFOTABLE.TSV`, Buffer.from(infoTableContent, "utf8"));
  return zip.toBuffer();
}

const VALID_SUB = `${SUB_HEADERS}\n${makeSubRow()}`;
const VALID_INFO = `${INFO_HEADERS}\n${makeInfoRow()}`;

// ---------------------------------------------------------------------------
// P1 — parseTsv
// ---------------------------------------------------------------------------

describe("P1 — parseTsv", () => {
  it("parses a basic TSV with headers and one row", () => {
    const { headers, rows } = parseTsv("A\tB\tC\nfoo\tbar\tbaz");
    expect(headers).toEqual(["A", "B", "C"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ A: "foo", B: "bar", C: "baz" });
  });

  it("strips UTF-8 BOM from the first character", () => {
    const bom = "\uFEFF";
    const { headers } = parseTsv(`${bom}ACCESSION-NUMBER\tCIK\nfoo\t123`);
    expect(headers[0]).toBe("ACCESSION-NUMBER"); // BOM removed
  });

  it("normalizes CRLF line endings to LF", () => {
    const { rows } = parseTsv("A\tB\r\nfoo\tbar\r\n");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ A: "foo", B: "bar" });
  });

  it("normalizes CR-only line endings", () => {
    const { rows } = parseTsv("A\tB\rfoo\tbar");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ A: "foo" });
  });

  it("skips blank lines", () => {
    const { rows } = parseTsv("A\tB\n\nfoo\tbar\n\nbaz\tqux");
    expect(rows).toHaveLength(2);
  });

  it("normalizes headers to uppercase", () => {
    const { headers } = parseTsv("accession-number\tcik\nval1\tval2");
    expect(headers).toEqual(["ACCESSION-NUMBER", "CIK"]);
  });

  it("handles missing trailing cells as empty string", () => {
    const { rows } = parseTsv("A\tB\tC\nfoo\tbar");
    expect(rows[0]["C"]).toBe("");
  });
});

// ---------------------------------------------------------------------------
// P2 — normalizeAccession
// ---------------------------------------------------------------------------

describe("P2 — normalizeAccession", () => {
  it("returns already-dashed format unchanged", () => {
    expect(normalizeAccession("0001234567-26-000001")).toBe("0001234567-26-000001");
  });

  it("converts 18-digit undashed to dashed", () => {
    expect(normalizeAccession("001234567226000001")).toBe("0012345672-26-000001");
  });

  it("trims whitespace", () => {
    expect(normalizeAccession("  0001234567-26-000001  ")).toBe("0001234567-26-000001");
  });

  it("returns short unknown format as-is (join will fail gracefully)", () => {
    const result = normalizeAccession("ABC");
    expect(result).toBe("ABC"); // Not crashed, join just finds no match
  });

  it("join is consistent: normalized forms of same accession are equal", () => {
    const dashed = "0001234567-26-000001";
    const undashed = "0001234567" + "26" + "000001"; // 18 chars
    expect(normalizeAccession(dashed)).toBe(normalizeAccession(undashed));
  });
});

// ---------------------------------------------------------------------------
// P3 — parseSubmissionTsv
// ---------------------------------------------------------------------------

describe("P3 — parseSubmissionTsv", () => {
  it("parses a valid SUBMISSION row", () => {
    const { rows, totalRows } = parseSubmissionTsv(VALID_SUB);
    expect(rows).toHaveLength(1);
    expect(totalRows).toBe(1);
    expect(rows[0].accessionNumber).toBe("0001234567-26-000001");
    expect(rows[0].cik).toBe("0001234567");
    expect(rows[0].name).toBe("VANGUARD GROUP INC");
    expect(rows[0].periodOfReport).toBe("2025-12-31");
    expect(rows[0].isAmendment).toBe(false);
  });

  it("filters out non-13F form types", () => {
    const sub = `${SUB_HEADERS}\n${makeSubRow("0001234567-26-000001", "10-K")}`;
    const { rows, totalRows } = parseSubmissionTsv(sub);
    expect(rows).toHaveLength(0);
    expect(totalRows).toBe(1);
  });

  it("accepts 13F-HR/A amendments and sets isAmendment=true", () => {
    const sub = `${SUB_HEADERS}\n${makeSubRow("0001234567-26-000002", "13F-HR/A")}`;
    const { rows } = parseSubmissionTsv(sub);
    expect(rows[0].isAmendment).toBe(true);
  });

  it("handles CONFORMED-PERIOD-OF-REPORT column alias", () => {
    const { rows } = parseSubmissionTsv(VALID_SUB);
    expect(rows[0].periodOfReport).toBe("2025-12-31");
  });

  it("falls back to REPORT-DATE alias if CONFORMED-PERIOD-OF-REPORT absent", () => {
    const altHeaders = "ACCESSION-NUMBER\tFORM-TYPE\tCIK\tNAME\tFILING-DATE\tREPORT-DATE";
    const sub = `${altHeaders}\n0001234567-26-000001\t13F-HR\t0001234567\tFOO\t2026-02-14\t2025-12-31`;
    const { rows } = parseSubmissionTsv(sub);
    expect(rows[0].periodOfReport).toBe("2025-12-31");
  });

  it("reports missing required headers using canonical labels", () => {
    const sub = "FORM-TYPE\tCIK\n13F-HR\t0001234567"; // missing accession and manager name
    const { missingHeaders } = parseSubmissionTsv(sub);
    // missingHeaders now reports canonical labels, not raw column names
    expect(missingHeaders).toContain("accession");
    expect(missingHeaders).toContain("manager name");
    expect(missingHeaders).not.toContain("ACCESSION-NUMBER"); // raw name never reported
    expect(missingHeaders).not.toContain("NAME");
  });

  it("accepts all rows when FORM-TYPE column is absent (pure 13F data set)", () => {
    const noFormType = "ACCESSION-NUMBER\tCIK\tNAME\tFILING-DATE\tCONFORMED-PERIOD-OF-REPORT";
    const sub = `${noFormType}\n0001234567-26-000001\t0001234567\tFOO\t2026-02-14\t2025-12-31`;
    const { rows } = parseSubmissionTsv(sub);
    expect(rows).toHaveLength(1); // No form-type filter applied
  });

  it("pads CIK to 10 digits", () => {
    const sub = `${SUB_HEADERS}\n${makeSubRow("0001234567-26-000001", "13F-HR", "12345")}`;
    const { rows } = parseSubmissionTsv(sub);
    expect(rows[0].cik).toBe("0000012345");
  });
});

// ---------------------------------------------------------------------------
// P4 — parseInfoTableTsv
// ---------------------------------------------------------------------------

describe("P4 — parseInfoTableTsv", () => {
  it("parses a valid INFOTABLE row", () => {
    const { rows, totalRows } = parseInfoTableTsv(
      `${INFO_HEADERS}\n${makeInfoRow()}`,
    );
    expect(rows).toHaveLength(1);
    expect(totalRows).toBe(1);
    expect(rows[0].issuerName).toBe("APPLE INC");
    expect(rows[0].cusip).toBe("037833100");
    expect(rows[0].reportedShares).toBe(25000000);
    expect(rows[0].sharesPrnType).toBe("SH");
    expect(rows[0].putCall).toBeNull();
  });

  it("preserves put/call rows with putCall set", () => {
    const { rows } = parseInfoTableTsv(
      `${INFO_HEADERS}\n${makeInfoRow("0001234567-26-000001", "APPLE INC", "CALL", "037833100", "", "100000", "500000", "SH", "Call")}`,
    );
    expect(rows[0].putCall).toBe("Call");
  });

  it("preserves PRN rows with sharesPrnType=PRN", () => {
    const { rows } = parseInfoTableTsv(
      `${INFO_HEADERS}\n${makeInfoRow("0001234567-26-000001", "CORP BOND", "BOND", "123456789", "", "50000", "100000", "PRN")}`,
    );
    expect(rows[0].sharesPrnType).toBe("PRN");
  });

  it("returns null for malformed numeric value (non-numeric string)", () => {
    const row = makeInfoRow(
      "0001234567-26-000001", "ISSUER", "COM", "037833100", "", "N/A",
    );
    const { rows } = parseInfoTableTsv(`${INFO_HEADERS}\n${row}`);
    expect(rows[0].reportedValue).toBeNull();
  });

  it("strips commas in numeric values (thousands separators)", () => {
    const row = makeInfoRow(
      "0001234567-26-000001", "ISSUER", "COM", "037833100", "", "5,000,000", "25,000,000",
    );
    const { rows } = parseInfoTableTsv(`${INFO_HEADERS}\n${row}`);
    expect(rows[0].reportedValue).toBe(5000000);
    expect(rows[0].reportedShares).toBe(25000000);
  });

  it("rejects rows with missing required fields and increments rejectedRows", () => {
    const row = `\t1\t\tCOM\t037833100\t\t5000000\t25000000\tSH\t\tSOLE\t\t25000000\t0\t0`;
    const { rows, rejectedRows } = parseInfoTableTsv(`${INFO_HEADERS}\n${row}`);
    expect(rows).toHaveLength(0);
    expect(rejectedRows).toBe(1);
  });

  it("normalizes CUSIP to 9 characters (pads short)", () => {
    const row = makeInfoRow("0001234567-26-000001", "ISSUER", "COM", "37833100"); // 8 chars
    const { rows } = parseInfoTableTsv(`${INFO_HEADERS}\n${row}`);
    expect(rows[0].cusip).toBe("037833100"); // padded to 9
  });

  it("reports missing required headers using canonical labels", () => {
    const { missingHeaders } = parseInfoTableTsv("NAMEOFISSUER\tTITLEOFCLASS\nFoo\tBar");
    // missingHeaders now reports canonical labels, not raw column names
    expect(missingHeaders).toContain("accession");
    expect(missingHeaders).toContain("CUSIP");
    expect(missingHeaders).not.toContain("ACCESSION-NUMBER"); // raw name never reported
  });
});

// ---------------------------------------------------------------------------
// P5 — findZipEntry
// ---------------------------------------------------------------------------

describe("P5 — findZipEntry", () => {
  it("finds an entry by exact uppercase name", () => {
    const zip = new AdmZip();
    zip.addFile("2026Q1_SUBMISSION.TSV", Buffer.from("data"));
    const entry = findZipEntry(zip, "2026Q1_SUBMISSION.TSV");
    expect(entry).not.toBeNull();
  });

  it("finds an entry case-insensitively (lowercase tsv in archive)", () => {
    const zip = new AdmZip();
    zip.addFile("2026q1_submission.tsv", Buffer.from("data"));
    const entry = findZipEntry(zip, "2026Q1_SUBMISSION.TSV");
    expect(entry).not.toBeNull();
  });

  it("finds an entry under a directory prefix", () => {
    const zip = new AdmZip();
    zip.addFile("data/2026Q1_SUBMISSION.TSV", Buffer.from("data"));
    const entry = findZipEntry(zip, "2026Q1_SUBMISSION.TSV");
    expect(entry).not.toBeNull();
  });

  it("returns null when entry does not exist", () => {
    const zip = new AdmZip();
    zip.addFile("OTHER_FILE.TSV", Buffer.from("data"));
    const entry = findZipEntry(zip, "2026Q1_SUBMISSION.TSV");
    expect(entry).toBeNull();
  });

  it("finds the correct entry when archive has multiple files", () => {
    const zip = new AdmZip();
    zip.addFile("2026Q1_COVERPAGE.TSV", Buffer.from("cover"));
    zip.addFile("2026Q1_SUBMISSION.TSV", Buffer.from("sub"));
    zip.addFile("2026Q1_INFOTABLE.TSV", Buffer.from("info"));
    expect(findZipEntry(zip, "2026Q1_INFOTABLE.TSV")).not.toBeNull();
    expect(findZipEntry(zip, "2026Q1_SUBMISSION.TSV")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// P6 — parseBulkQuarterFromBuffer
// ---------------------------------------------------------------------------

describe("P6 — parseBulkQuarterFromBuffer", () => {
  it("returns success for a valid archive with holdings", () => {
    const buf = makeZip(2026, 1, VALID_SUB, VALID_INFO);
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).toBe("success");
    expect(result.holdings).toHaveLength(1);
    expect(result.diagnostics.submissionRows).toBe(1);
    expect(result.diagnostics.informationTableRows).toBe(1);
    expect(result.diagnostics.joinedHoldingRows).toBe(1);
    expect(result.diagnostics.eligibleCommonStockRows).toBe(1);
    expect(result.diagnostics.putCallExcludedRows).toBe(0);
    expect(result.diagnostics.prnExcludedRows).toBe(0);
  });

  it("resolves filer metadata on each holding", () => {
    const buf = makeZip(2026, 1, VALID_SUB, VALID_INFO);
    const { holdings } = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(holdings[0].filerName).toBe("VANGUARD GROUP INC");
    expect(holdings[0].filerCik).toBe("0001234567");
    expect(holdings[0].periodOfReport).toBe("2025-12-31");
  });

  it("handles actual uppercase TSV entry names (2026Q1_SUBMISSION.TSV)", () => {
    // The real archive uses uppercase .TSV — confirm this is found
    const prefix = entryPrefix(2026, 1);
    expect(prefix).toBe("2026Q1");
    const zip = new AdmZip();
    zip.addFile(`${prefix}_SUBMISSION.TSV`, Buffer.from(VALID_SUB, "utf8"));
    zip.addFile(`${prefix}_INFOTABLE.TSV`, Buffer.from(VALID_INFO, "utf8"));
    const result = parseBulkQuarterFromBuffer(zip.toBuffer(), 2026, 1);
    expect(result.status).toBe("success");
  });

  it("handles entries with directory prefix inside archive", () => {
    const buf = makeZipWithDirectory(2026, 1, VALID_SUB, VALID_INFO);
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).toBe("success");
    expect(result.holdings).toHaveLength(1);
  });

  it("returns empty_parse_failure when SUBMISSION entry is missing", () => {
    const zip = new AdmZip();
    zip.addFile("2026Q1_INFOTABLE.TSV", Buffer.from(VALID_INFO, "utf8"));
    const result = parseBulkQuarterFromBuffer(zip.toBuffer(), 2026, 1);
    expect(result.status).toBe("empty_parse_failure");
    // New resolver emits REQUIRED_ARCHIVE_ENTRY_MISSING with canonical basename
    expect(result.reason).toContain("REQUIRED_ARCHIVE_ENTRY_MISSING");
    expect(result.reason).toMatch(/SUBMISSION\.tsv/i);
  });

  it("returns empty_parse_failure when INFOTABLE entry is missing", () => {
    const zip = new AdmZip();
    zip.addFile("2026Q1_SUBMISSION.TSV", Buffer.from(VALID_SUB, "utf8"));
    const result = parseBulkQuarterFromBuffer(zip.toBuffer(), 2026, 1);
    expect(result.status).toBe("empty_parse_failure");
    // New resolver emits REQUIRED_ARCHIVE_ENTRY_MISSING with canonical basename
    expect(result.reason).toContain("REQUIRED_ARCHIVE_ENTRY_MISSING");
    expect(result.reason).toMatch(/INFOTABLE\.tsv/i);
  });

  it("returns empty_parse_failure when valid archive has 0 parsed 13F-HR rows", () => {
    const nonF13Sub = `${SUB_HEADERS}\n${makeSubRow("0001234567-26-000001", "10-K")}`;
    const buf = makeZip(2026, 1, nonF13Sub, VALID_INFO);
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).toBe("empty_parse_failure");
    expect(result.diagnostics.submissionRows).toBe(1);
    expect(result.holdings).toHaveLength(0);
    expect(result.reason).toContain("0 parsed as 13F-HR/A");
  });

  it("returns empty_parse_failure when join rate is 0% (accession mismatch)", () => {
    // SUBMISSION has accession A, INFOTABLE has accession B → no join
    const subContent = `${SUB_HEADERS}\n${makeSubRow("0001234567-26-000001")}`;
    const infoContent = `${INFO_HEADERS}\n${makeInfoRow("0009999999-26-000001")}`;
    const buf = makeZip(2026, 1, subContent, infoContent);
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).toBe("empty_parse_failure");
    expect(result.reason).toContain("Join rate 0%");
  });

  it("put/call rows counted in putCallExcludedRows diagnostic", () => {
    const callRow = makeInfoRow(
      "0001234567-26-000001", "APPLE INC", "CALL", "037833100",
      "", "100000", "500000", "SH", "Call",
    );
    const buf = makeZip(2026, 1, VALID_SUB, `${INFO_HEADERS}\n${callRow}`);
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).toBe("success");
    expect(result.diagnostics.putCallExcludedRows).toBe(1);
    expect(result.diagnostics.eligibleCommonStockRows).toBe(0);
    // Put/call rows still included in holdings (preserved, not dropped)
    expect(result.holdings[0].putCall).toBe("Call");
  });

  it("PRN rows counted in prnExcludedRows diagnostic", () => {
    const prnRow = makeInfoRow(
      "0001234567-26-000001", "BOND", "BOND", "123456789",
      "", "50000", "100000", "PRN",
    );
    const buf = makeZip(2026, 1, VALID_SUB, `${INFO_HEADERS}\n${prnRow}`);
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.diagnostics.prnExcludedRows).toBe(1);
    expect(result.diagnostics.eligibleCommonStockRows).toBe(0);
    expect(result.holdings[0].sharesPrnType).toBe("PRN");
  });

  it("returns partial_success when some INFOTABLE rows are rejected", () => {
    // One valid row, one rejected (missing CUSIP)
    const badRow = `0001234567-26-000001\t2\tISSUER\tCOM\t\t\t1000\t5000\tSH\t\tSOLE\t\t5000\t0\t0`;
    const buf = makeZip(
      2026,
      1,
      VALID_SUB,
      `${INFO_HEADERS}\n${makeInfoRow()}\n${badRow}`,
    );
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).toBe("partial_success");
    expect(result.diagnostics.rejectedRows).toBe(1);
    expect(result.holdings).toHaveLength(1);
  });

  it("returns failed for a non-ZIP buffer", () => {
    const result = parseBulkQuarterFromBuffer(Buffer.from("not a zip"), 2026, 1);
    expect(result.status).toBe("failed");
  });

  it("handles BOM in SUBMISSION.tsv content", () => {
    const bom = "\uFEFF";
    const bomSub = `${bom}${VALID_SUB}`;
    const buf = makeZip(2026, 1, bomSub, VALID_INFO);
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).toBe("success");
    expect(result.holdings).toHaveLength(1);
  });

  it("handles CRLF line endings in INFOTABLE.tsv", () => {
    const crlfInfo = VALID_INFO.replace(/\n/g, "\r\n");
    const buf = makeZip(2026, 1, VALID_SUB, crlfInfo);
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).toBe("success");
  });

  it("join succeeds when accession numbers are in undashed format in INFOTABLE", () => {
    // SUBMISSION uses dashed; INFOTABLE uses undashed (18 digits) — both normalize to same key
    const undashed = "0001234567" + "26" + "000001"; // 18 chars
    const infoUndashed = `${INFO_HEADERS}\n${makeInfoRow(undashed)}`;
    const buf = makeZip(2026, 1, VALID_SUB, infoUndashed);
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).toBe("success");
    expect(result.holdings).toHaveLength(1);
  });

  it("parsing the same buffer twice gives the same result (idempotent)", () => {
    const buf = makeZip(2026, 1, VALID_SUB, VALID_INFO);
    const r1 = parseBulkQuarterFromBuffer(buf, 2026, 1);
    const r2 = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(r1.status).toBe(r2.status);
    expect(r1.holdings).toHaveLength(r2.holdings.length);
  });

  it("multiple filings in one archive — each accession groups separately", () => {
    const sub2 = `${SUB_HEADERS}\n${makeSubRow("0001234567-26-000001")}\n${makeSubRow("0007654321-26-000001", "13F-HR", "0007654321", "BLACKROCK INC")}`;
    const info2 = `${INFO_HEADERS}\n${makeInfoRow("0001234567-26-000001")}\n${makeInfoRow("0007654321-26-000001", "MSFT", "COM", "594918104")}`;
    const buf = makeZip(2026, 1, sub2, info2);
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).toBe("success");
    expect(result.holdings).toHaveLength(2);
    const accessions = new Set(result.holdings.map((h) => h.accessionNumber));
    expect(accessions.size).toBe(2);
  });

  it("Q1 period filtering uses CONFORMED-PERIOD-OF-REPORT not filing date", () => {
    // Period 2026-03-31 (Q1 2026) but filing date is 2026-05-15 (after quarter end)
    const sub = `${SUB_HEADERS}\n${makeSubRow("0001234567-26-000001", "13F-HR", "0001234567", "FILER", "2026-05-15", "2026-03-31")}`;
    const buf = makeZip(2026, 1, sub, VALID_INFO);
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).toBe("success");
    expect(result.holdings[0].periodOfReport).toBe("2026-03-31");
  });

  it("diagnostics archiveEntries lists the actual ZIP entry names", () => {
    const buf = makeZip(2026, 1, VALID_SUB, VALID_INFO);
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.diagnostics.archiveEntries).toContain("2026Q1_SUBMISSION.TSV");
    expect(result.diagnostics.archiveEntries).toContain("2026Q1_INFOTABLE.TSV");
  });
});

// ---------------------------------------------------------------------------
// P7 — selectAvailableQuarters
// ---------------------------------------------------------------------------

describe("P7 — selectAvailableQuarters", () => {
  it("skips unpublished quarter and returns two available quarters", async () => {
    // On 2026-08-06: current quarter is Q3 2026. Q3 not published, Q2 not published,
    // Q1 2026 published, Q4 2025 published.
    const probe = vi.fn(async (year: number, q: number) => {
      if (year === 2026 && (q === 3 || q === 2)) return { available: false };
      return { available: true };
    });

    const today = new Date("2026-08-06");
    const { available, skipped } = await selectAvailableQuarters(
      2,
      today,
      probe as any,
    );

    expect(available).toHaveLength(2);
    expect(available[0]).toMatchObject({ year: 2026, q: 1, label: "2026Q1" });
    expect(available[1]).toMatchObject({ year: 2025, q: 4, label: "2025Q4" });
    expect(skipped.some((s) => s.label === "2026Q3")).toBe(true);
    expect(skipped.some((s) => s.label === "2026Q2")).toBe(true);
  });

  it("returns immediately when first N quarters are available", async () => {
    const probe = vi.fn(async () => ({ available: true }));
    const today = new Date("2026-08-06");
    const { available, skipped } = await selectAvailableQuarters(2, today, probe as any);
    expect(available).toHaveLength(2);
    expect(skipped).toHaveLength(0);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("returns empty when maxSearch reached without finding requested N", async () => {
    const probe = vi.fn(async () => ({ available: false }));
    const today = new Date("2026-08-06");
    const { available, skipped } = await selectAvailableQuarters(
      2,
      today,
      probe as any,
      3,
    );
    expect(available).toHaveLength(0);
    expect(skipped).toHaveLength(3);
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("period ends are correctly computed for each quarter", async () => {
    const probe = vi.fn(async () => ({ available: true }));
    const today = new Date("2026-04-01"); // Q2 2026
    const { available } = await selectAvailableQuarters(4, today, probe as any);
    const periods = Object.fromEntries(available.map((a) => [a.label, a.periodEnd]));
    expect(periods["2026Q2"]).toBe("2026-06-30");
    expect(periods["2026Q1"]).toBe("2026-03-31");
    expect(periods["2025Q4"]).toBe("2025-12-31");
    expect(periods["2025Q3"]).toBe("2025-09-30");
  });

  it("probe error is treated as unavailable (skipped)", async () => {
    const probe = vi.fn(async (year: number, q: number) => {
      if (year === 2026 && q === 3) throw new Error("network error");
      return { available: true };
    });
    const today = new Date("2026-08-06");
    const { available, skipped } = await selectAvailableQuarters(1, today, probe as any);
    expect(skipped.some((s) => s.label === "2026Q3" && s.reason === "probe failed")).toBe(true);
    expect(available).toHaveLength(1);
    expect(available[0].label).toBe("2026Q2"); // next available
  });
});

// ---------------------------------------------------------------------------
// P8 — bulkDatasetUrl + entryPrefix
// ---------------------------------------------------------------------------

describe("P8 — URL and entry helpers", () => {
  it("bulkDatasetUrl produces the expected SEC URL", () => {
    expect(bulkDatasetUrl(2026, 1)).toBe(
      "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/2026q1_form13f.zip",
    );
    expect(bulkDatasetUrl(2025, 4)).toBe(
      "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/2025q4_form13f.zip",
    );
  });

  it("entryPrefix produces the correct uppercase prefix", () => {
    expect(entryPrefix(2026, 1)).toBe("2026Q1");
    expect(entryPrefix(2025, 4)).toBe("2025Q4");
    expect(entryPrefix(2023, 3)).toBe("2023Q3");
  });
});
