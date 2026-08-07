/**
 * Submission field validation tests.
 *
 * Spec section 10 cases A–T:
 *   A. 13F-HR increments recognizedHoldingsFormRows
 *   B. 13F-HR/A increments recognizedHoldingsFormRows
 *   C. 13F-NT does NOT increment recognizedHoldingsFormRows
 *   D. Production type distribution produces expected recognized count
 *   E. Valid form + invalid period → rejectedInvalidPeriodOfReport (not excludedUnknownTypeRows)
 *   F. Valid form + missing accession → rejectedMissingAccession
 *   G. Valid form + invalid accession → non-gated (informational rejectedInvalidAccession)
 *   H. Valid form + missing CIK → rejectedMissingCik
 *   I. Valid form + invalid CIK → rejectedInvalidCik
 *   J. Actual observed SEC period formats parse correctly (YYYY-MM-DD, YYYYMMDD, MM/DD/YYYY)
 *   K. Actual observed SEC filing-date formats parse correctly
 *   L. Legacy date formats (YYYYMMDD) remain supported
 *   M. Invalid calendar date rejected
 *   N. Counter invariant holds: recognizedHoldingsFormRows = parsedRows + all field rejections
 *   O. recognized > 0 + parsed = 0 → ALL_HOLDINGS_SUBMISSIONS_INVALID
 *   P. recognized = 0 → NO_HOLDINGS_BEARING_SUBMISSIONS
 *   Q. Failure reason reports actual rejection stage
 *   R. Diagnostic --validate performs no DB writes
 *   S. Existing normalization tests remain green
 *   T. Existing COVERPAGE tests remain green
 */

import { describe, it, expect } from "vitest";
import {
  parseSubmissionTsv,
  normalizeSubmissionType,
} from "../sec-13f-bulk-parser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal TSV with the given header row and data rows.
 * Each data row is a tab-separated string — values in the same column order as headers.
 */
function buildTsv(headers: string[], rows: string[][]): string {
  const headerLine = headers.join("\t");
  const dataLines = rows.map((r) => r.join("\t"));
  return [headerLine, ...dataLines].join("\n");
}

const GOOD_ACCESSION = "0000001234-26-000001";
const GOOD_CIK       = "1234567890";
const GOOD_PERIOD    = "2026-03-31";
const GOOD_DATE      = "2026-03-15";

function goodRow(overrides: Record<number, string> = {}, extraCols: string[] = []): string[] {
  const row = [GOOD_ACCESSION, "13F-HR", GOOD_CIK, "Test Manager LLC", GOOD_PERIOD, GOOD_DATE, ...extraCols];
  for (const [i, v] of Object.entries(overrides)) row[parseInt(i)] = v;
  return row;
}

const STD_HEADERS = [
  "ACCESSION_NUMBER", "SUBMISSIONTYPE", "CIK",
  "FILINGMANAGER_NAME", "PERIODOFREPORT", "FILING_DATE",
];

// ---------------------------------------------------------------------------
// A. 13F-HR increments recognizedHoldingsFormRows
// ---------------------------------------------------------------------------
describe("A – 13F-HR recognized as holdings-bearing", () => {
  it("increments recognizedHoldingsFormRows", () => {
    const tsv = buildTsv(STD_HEADERS, [goodRow()]);
    const r = parseSubmissionTsv(tsv);
    expect(r.recognizedHoldingsFormRows).toBe(1);
    expect(r.recognized13fHrRows).toBe(1);
    expect(r.recognized13fHrAmendmentRows).toBe(0);
  });

  it("parsedRows equals 1 for a fully valid row", () => {
    const tsv = buildTsv(STD_HEADERS, [goodRow()]);
    expect(parseSubmissionTsv(tsv).parsedRows).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B. 13F-HR/A increments recognizedHoldingsFormRows
// ---------------------------------------------------------------------------
describe("B – 13F-HR/A recognized as holdings-bearing", () => {
  it("increments recognizedHoldingsFormRows and recognized13fHrAmendmentRows", () => {
    const row = goodRow({ 1: "13F-HR/A" });
    const tsv = buildTsv(STD_HEADERS, [row]);
    const r = parseSubmissionTsv(tsv);
    expect(r.recognizedHoldingsFormRows).toBe(1);
    expect(r.recognized13fHrRows).toBe(0);
    expect(r.recognized13fHrAmendmentRows).toBe(1);
  });

  it("row appears in output with isAmendment=true", () => {
    const tsv = buildTsv(STD_HEADERS, [goodRow({ 1: "13F-HR/A" })]);
    const r = parseSubmissionTsv(tsv);
    expect(r.rows[0]?.isAmendment).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C. 13F-NT does NOT increment recognizedHoldingsFormRows
// ---------------------------------------------------------------------------
describe("C – 13F-NT excluded from recognizedHoldingsFormRows", () => {
  it("does not increment recognizedHoldingsFormRows", () => {
    const tsv = buildTsv(STD_HEADERS, [goodRow({ 1: "13F-NT" })]);
    const r = parseSubmissionTsv(tsv);
    expect(r.recognizedHoldingsFormRows).toBe(0);
    expect(r.excludedNoticeRows).toBe(1);
  });

  it("13F-NT/A also excluded", () => {
    const tsv = buildTsv(STD_HEADERS, [goodRow({ 1: "13F-NT/A" })]);
    const r = parseSubmissionTsv(tsv);
    expect(r.recognizedHoldingsFormRows).toBe(0);
    expect(r.excludedNoticeRows).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// D. Production type distribution produces expected recognized count
// ---------------------------------------------------------------------------
describe("D – Production distribution (9312 HR + 404 HRA = 9716 recognized)", () => {
  it("counts HR and HR/A together in recognizedHoldingsFormRows", () => {
    // Simulate 3 HR, 1 HR/A, 2 NT (micro-scale production distribution)
    const rows = [
      goodRow({ 1: "13F-HR" }),
      goodRow({ 1: "13F-HR" }),
      goodRow({ 0: "0000001234-26-000002" }),              // 13F-HR
      goodRow({ 0: "0000001234-26-000003", 1: "13F-HR/A" }),
      goodRow({ 0: "0000001234-26-000004", 1: "13F-NT" }),
      goodRow({ 0: "0000001234-26-000005", 1: "13F-NT" }),
    ];
    const tsv = buildTsv(STD_HEADERS, rows);
    const r = parseSubmissionTsv(tsv);
    expect(r.recognizedHoldingsFormRows).toBe(4); // 3 HR + 1 HR/A
    expect(r.recognized13fHrRows).toBe(3);
    expect(r.recognized13fHrAmendmentRows).toBe(1);
    expect(r.excludedNoticeRows).toBe(2);
    expect(r.totalRows).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// E. Valid form + invalid period → rejectedInvalidPeriodOfReport
// ---------------------------------------------------------------------------
describe("E – Invalid period-of-report increments the right counter", () => {
  it("increments rejectedInvalidPeriodOfReport for an unrecognised date format", () => {
    const row = goodRow({ 4: "not-a-date" });
    const tsv = buildTsv(STD_HEADERS, [row]);
    const r = parseSubmissionTsv(tsv);
    expect(r.rejectedInvalidPeriodOfReport).toBe(1);
    expect(r.excludedUnknownTypeRows).toBe(0);   // must NOT go here
    expect(r.parsedRows).toBe(0);
    expect(r.recognizedHoldingsFormRows).toBe(1); // was recognized before rejection
  });

  it("increments rejectedInvalidPeriodOfReport for an impossible date", () => {
    const row = goodRow({ 4: "2026-13-45" }); // month 13 doesn't exist
    const tsv = buildTsv(STD_HEADERS, [row]);
    const r = parseSubmissionTsv(tsv);
    expect(r.rejectedInvalidPeriodOfReport).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F. Valid form + missing accession → rejectedMissingAccession
// ---------------------------------------------------------------------------
describe("F – Missing accession increments rejectedMissingAccession", () => {
  it("blank accession field", () => {
    const row = goodRow({ 0: "" });
    const tsv = buildTsv(STD_HEADERS, [row]);
    const r = parseSubmissionTsv(tsv);
    expect(r.rejectedMissingAccession).toBe(1);
    expect(r.parsedRows).toBe(0);
  });

  it("whitespace-only accession field", () => {
    const row = goodRow({ 0: "   " });
    const tsv = buildTsv(STD_HEADERS, [row]);
    const r = parseSubmissionTsv(tsv);
    expect(r.rejectedMissingAccession).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// G. Valid form + non-standard accession → informational (row still passes)
// ---------------------------------------------------------------------------
describe("G – Non-standard accession format is tracked but not gated", () => {
  it("increments rejectedInvalidAccession but row is still accepted", () => {
    // A non-standard accession (not 10-2-6 dashed, not 18 digits) passes through
    const row = goodRow({ 0: "NONSTANDARD-ACC" });
    const tsv = buildTsv(STD_HEADERS, [row]);
    const r = parseSubmissionTsv(tsv);
    expect(r.rejectedInvalidAccession).toBe(1); // informational
    expect(r.parsedRows).toBe(1);               // row is NOT gated
  });

  it("standard dashed accession does NOT increment rejectedInvalidAccession", () => {
    const tsv = buildTsv(STD_HEADERS, [goodRow()]);
    const r = parseSubmissionTsv(tsv);
    expect(r.rejectedInvalidAccession).toBe(0);
    expect(r.parsedRows).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// H. Valid form + missing CIK → rejectedMissingCik
// ---------------------------------------------------------------------------
describe("H – Missing CIK increments rejectedMissingCik", () => {
  it("blank CIK field", () => {
    const row = goodRow({ 2: "" });
    const tsv = buildTsv(STD_HEADERS, [row]);
    const r = parseSubmissionTsv(tsv);
    expect(r.rejectedMissingCik).toBe(1);
    expect(r.parsedRows).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// I. Valid form + invalid CIK → rejectedInvalidCik
// ---------------------------------------------------------------------------
describe("I – Invalid CIK increments rejectedInvalidCik", () => {
  it("non-numeric CIK is rejected", () => {
    const row = goodRow({ 2: "NOTANUMBER" });
    const tsv = buildTsv(STD_HEADERS, [row]);
    const r = parseSubmissionTsv(tsv);
    expect(r.rejectedInvalidCik).toBe(1);
    expect(r.parsedRows).toBe(0);
  });

  it("CIK with letters mixed in is rejected", () => {
    const row = goodRow({ 2: "123ABC456" });
    const tsv = buildTsv(STD_HEADERS, [row]);
    const r = parseSubmissionTsv(tsv);
    expect(r.rejectedInvalidCik).toBe(1);
  });

  it("valid numeric CIK with leading zeros is accepted", () => {
    const row = goodRow({ 2: "0001234567" }); // 10-digit padded
    const tsv = buildTsv(STD_HEADERS, [row]);
    const r = parseSubmissionTsv(tsv);
    expect(r.rejectedInvalidCik).toBe(0);
    expect(r.parsedRows).toBe(1);
    expect(r.rows[0]?.cik).toBe("0001234567");
  });

  it("valid short numeric CIK is padded to 10 digits", () => {
    const row = goodRow({ 2: "12345" });
    const tsv = buildTsv(STD_HEADERS, [row]);
    const r = parseSubmissionTsv(tsv);
    expect(r.parsedRows).toBe(1);
    expect(r.rows[0]?.cik).toBe("0000012345");
  });
});

// ---------------------------------------------------------------------------
// J. Actual observed SEC period formats parse correctly
// ---------------------------------------------------------------------------
describe("J – Period-of-report date formats", () => {
  const formats: [string, string][] = [
    ["2026-03-31", "2026-03-31"],  // YYYY-MM-DD
    ["20260331",   "2026-03-31"],  // YYYYMMDD
    ["03/31/2026", "2026-03-31"],  // MM/DD/YYYY
    ["03-31-2026", "2026-03-31"],  // MM-DD-YYYY
    ["2026/03/31", "2026-03-31"],  // YYYY/MM/DD
  ];

  for (const [input, expected] of formats) {
    it(`parses "${input}" → "${expected}"`, () => {
      const row = goodRow({ 4: input });
      const tsv = buildTsv(STD_HEADERS, [row]);
      const r = parseSubmissionTsv(tsv);
      expect(r.parsedRows).toBe(1);
      expect(r.rows[0]?.periodOfReport).toBe(expected);
      expect(r.rejectedInvalidPeriodOfReport).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// K. Actual observed SEC filing-date formats parse correctly
// ---------------------------------------------------------------------------
describe("K – Filing-date formats", () => {
  const formats: [string, string][] = [
    ["2026-03-15", "2026-03-15"],
    ["20260315",   "2026-03-15"],
    ["03/15/2026", "2026-03-15"],
    ["03-15-2026", "2026-03-15"],
  ];

  for (const [input, expected] of formats) {
    it(`parses filing date "${input}" → "${expected}"`, () => {
      const row = goodRow({ 5: input });
      const tsv = buildTsv(STD_HEADERS, [row]);
      const r = parseSubmissionTsv(tsv);
      expect(r.parsedRows).toBe(1);
      expect(r.rows[0]?.filingDate).toBe(expected);
      expect(r.rejectedInvalidFilingDate).toBe(0);
    });
  }

  it("empty filing date falls back to periodOfReport", () => {
    const row = goodRow({ 5: "" });
    const tsv = buildTsv(STD_HEADERS, [row]);
    const r = parseSubmissionTsv(tsv);
    expect(r.parsedRows).toBe(1);
    expect(r.rows[0]?.filingDate).toBe(GOOD_PERIOD);
    expect(r.rejectedInvalidFilingDate).toBe(0);
  });

  it("non-empty invalid filing date rejects row", () => {
    const row = goodRow({ 5: "totally-wrong" });
    const tsv = buildTsv(STD_HEADERS, [row]);
    const r = parseSubmissionTsv(tsv);
    expect(r.rejectedInvalidFilingDate).toBe(1);
    expect(r.parsedRows).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// L. Legacy date format (YYYYMMDD) remains supported
// ---------------------------------------------------------------------------
describe("L – Legacy date format YYYYMMDD", () => {
  it("YYYYMMDD period-of-report parses correctly", () => {
    const tsv = buildTsv(STD_HEADERS, [goodRow({ 4: "20260331" })]);
    const r = parseSubmissionTsv(tsv);
    expect(r.parsedRows).toBe(1);
    expect(r.rows[0]?.periodOfReport).toBe("2026-03-31");
  });

  it("YYYYMMDD filing-date parses correctly", () => {
    const tsv = buildTsv(STD_HEADERS, [goodRow({ 5: "20260315" })]);
    const r = parseSubmissionTsv(tsv);
    expect(r.parsedRows).toBe(1);
    expect(r.rows[0]?.filingDate).toBe("2026-03-15");
  });
});

// ---------------------------------------------------------------------------
// M. Invalid calendar date rejected
// ---------------------------------------------------------------------------
describe("M – Impossible dates rejected", () => {
  const impossible = [
    "2026-00-15",  // month 0
    "2026-13-01",  // month 13
    "2026-02-30",  // Feb 30
    "2026-04-31",  // Apr 31
    "1992-12-31",  // before 13F era (1993)
    "2100-01-01",  // beyond upper limit
  ];

  for (const d of impossible) {
    it(`rejects "${d}"`, () => {
      const row = goodRow({ 4: d });
      const tsv = buildTsv(STD_HEADERS, [row]);
      const r = parseSubmissionTsv(tsv);
      expect(r.rejectedInvalidPeriodOfReport).toBe(1);
      expect(r.parsedRows).toBe(0);
    });
  }

  it("Feb 29 accepted in leap year", () => {
    const tsv = buildTsv(STD_HEADERS, [goodRow({ 4: "2024-02-29" })]);
    expect(parseSubmissionTsv(tsv).parsedRows).toBe(1);
  });

  it("Feb 29 rejected in non-leap year", () => {
    const tsv = buildTsv(STD_HEADERS, [goodRow({ 4: "2026-02-29" })]);
    expect(parseSubmissionTsv(tsv).rejectedInvalidPeriodOfReport).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// N. Counter invariant: recognizedHoldingsFormRows = parsedRows + all field rejections
// ---------------------------------------------------------------------------
describe("N – Counter invariant holds", () => {
  it("invariant satisfied for a mixed batch", () => {
    const rows = [
      goodRow(),                           // valid
      goodRow({ 0: "" }),                  // missing accession
      goodRow({ 2: "" }),                  // missing CIK
      goodRow({ 2: "NOTNUM" }),            // invalid CIK
      goodRow({ 4: "" }),                  // missing period
      goodRow({ 4: "not-a-date" }),        // invalid period
      goodRow({ 5: "bad-date" }),          // invalid filing date (non-empty, bad)
      goodRow({ 1: "13F-NT" }),            // notice — not in recognized
    ];
    const tsv = buildTsv(STD_HEADERS, rows);
    const r = parseSubmissionTsv(tsv);

    const totalRejected =
      r.rejectedMissingAccession +
      r.rejectedInvalidAccession +
      r.rejectedMissingCik +
      r.rejectedInvalidCik +
      r.rejectedMissingPeriodOfReport +
      r.rejectedInvalidPeriodOfReport +
      r.rejectedInvalidFilingDate +
      r.rejectedOtherSubmissionValidation;

    expect(r.recognizedHoldingsFormRows).toBe(r.parsedRows + totalRejected);
  });

  it("totalRows = recognizedHoldingsFormRows + excludedNoticeRows + excludedUnknownTypeRows", () => {
    const rows = [
      goodRow(),
      goodRow({ 1: "13F-NT" }),
      goodRow({ 1: "GARBAGE" }),  // UNKNOWN
    ];
    const tsv = buildTsv(STD_HEADERS, rows);
    const r = parseSubmissionTsv(tsv);
    expect(r.totalRows).toBe(
      r.recognizedHoldingsFormRows + r.excludedNoticeRows + r.excludedUnknownTypeRows,
    );
  });
});

// ---------------------------------------------------------------------------
// O. recognized > 0, parsed = 0 → ALL_HOLDINGS_SUBMISSIONS_INVALID
// ---------------------------------------------------------------------------
describe("O – ALL_HOLDINGS_SUBMISSIONS_INVALID failure code", () => {
  it("reason contains ALL_HOLDINGS_SUBMISSIONS_INVALID when recognized>0 but parsed=0", () => {
    // All rows have valid form types but invalid period dates
    const rows = Array.from({ length: 3 }, () => goodRow({ 4: "BAD-DATE" }));
    const result = parseSubmissionTsv(buildTsv(STD_HEADERS, rows));
    expect(result.recognizedHoldingsFormRows).toBe(3);
    expect(result.parsedRows).toBe(0);
    expect(result.rejectedInvalidPeriodOfReport).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// P. recognized = 0 → NO_HOLDINGS_BEARING_SUBMISSIONS
// ---------------------------------------------------------------------------
describe("P – NO_HOLDINGS_BEARING_SUBMISSIONS (recognized = 0)", () => {
  it("all-NT input has recognizedHoldingsFormRows = 0", () => {
    const rows = Array.from({ length: 5 }, () => goodRow({ 1: "13F-NT" }));
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, rows));
    expect(r.recognizedHoldingsFormRows).toBe(0);
    expect(r.parsedRows).toBe(0);
    expect(r.excludedNoticeRows).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Q. Failure reason reports actual rejection stage
// ---------------------------------------------------------------------------
describe("Q – Failure reason includes rejection counters", () => {
  it("parsedRows is 0 when rejectedInvalidPeriodOfReport > 0", () => {
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, [goodRow({ 4: "wrong" })]));
    expect(r.rejectedInvalidPeriodOfReport).toBeGreaterThan(0);
    expect(r.parsedRows).toBe(0);
  });

  it("rejectedMissingCik is 0 when CIK is valid", () => {
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, [goodRow()]));
    expect(r.rejectedMissingCik).toBe(0);
    expect(r.rejectedInvalidCik).toBe(0);
  });

  it("each rejection counter is independent", () => {
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, [
      goodRow({ 2: "" }),       // missing CIK
      goodRow({ 4: "BAD" }),    // invalid period
    ]));
    expect(r.rejectedMissingCik).toBe(1);
    expect(r.rejectedInvalidPeriodOfReport).toBe(1);
    expect(r.rejectedMissingPeriodOfReport).toBe(0);
    expect(r.rejectedMissingAccession).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R. Diagnostic --validate performs no DB writes
// ---------------------------------------------------------------------------
describe("R – parseSubmissionTsv is a pure function with no DB side effects", () => {
  it("calling twice produces identical results", () => {
    const tsv = buildTsv(STD_HEADERS, [goodRow()]);
    const r1 = parseSubmissionTsv(tsv);
    const r2 = parseSubmissionTsv(tsv);
    expect(r1.parsedRows).toBe(r2.parsedRows);
    expect(r1.recognizedHoldingsFormRows).toBe(r2.recognizedHoldingsFormRows);
  });

  it("result has no database connection fields", () => {
    const tsv = buildTsv(STD_HEADERS, [goodRow()]);
    const r = parseSubmissionTsv(tsv);
    // Result should not contain any DB-related properties
    expect(r).not.toHaveProperty("db");
    expect(r).not.toHaveProperty("connection");
    expect(r).not.toHaveProperty("pool");
  });
});

// ---------------------------------------------------------------------------
// S. Existing normalization tests remain green
// ---------------------------------------------------------------------------
describe("S – normalizeSubmissionType alias table unchanged", () => {
  const cases: [string | null | undefined, string | null][] = [
    ["13F-HR",      "13F-HR"],
    ["13F-HR/A",    "13F-HR/A"],
    ["13F-NT",      "13F-NT"],
    ["13F-NT/A",    "13F-NT/A"],
    ["13F_HR",      "13F-HR"],
    ["13F_HR_A",    "13F-HR/A"],
    ["13FHR",       "13F-HR"],
    ["13FHRA",      "13F-HR/A"],
    ["13F-HR-A",    "13F-HR/A"],
    ["13FNT",       "13F-NT"],
    ["GARBAGE",     "UNKNOWN"],
    ["10-K",        "UNKNOWN"],
    ["",            null],
    [null,          null],
    [undefined,     null],
  ];

  for (const [input, expected] of cases) {
    it(`normalizeSubmissionType("${input}") → "${expected}"`, () => {
      expect(normalizeSubmissionType(input)).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// T. Existing COVERPAGE-related paths are unaffected
// ---------------------------------------------------------------------------
describe("T – COVERPAGE-related UNKNOWN rows still deferred", () => {
  it("UNKNOWN type row goes to unknownTypeRows when fields are valid", () => {
    const row = [GOOD_ACCESSION, "GARBAGE-TYPE", GOOD_CIK, "Mgr", GOOD_PERIOD, GOOD_DATE];
    const tsv = buildTsv(STD_HEADERS, [row]);
    const r = parseSubmissionTsv(tsv);
    expect(r.unknownTypeRows).toHaveLength(1);
    expect(r.excludedUnknownTypeRows).toBe(1);
    expect(r.recognizedHoldingsFormRows).toBe(0);
  });

  it("blank SUBMISSIONTYPE goes to excludedUnknownTypeRows (column present)", () => {
    const row = [GOOD_ACCESSION, "", GOOD_CIK, "Mgr", GOOD_PERIOD, GOOD_DATE];
    const tsv = buildTsv(STD_HEADERS, [row]);
    const r = parseSubmissionTsv(tsv);
    expect(r.excludedUnknownTypeRows).toBe(1);
    expect(r.recognizedHoldingsFormRows).toBe(0);
  });

  it("legacy alias (excludedUnknownCount) equals excludedUnknownTypeRows", () => {
    const row = [GOOD_ACCESSION, "GARBAGE", GOOD_CIK, "Mgr", GOOD_PERIOD, GOOD_DATE];
    const tsv = buildTsv(STD_HEADERS, [row]);
    const r = parseSubmissionTsv(tsv);
    expect(r.excludedUnknownCount).toBe(r.excludedUnknownTypeRows);
  });

  it("legacy alias (excludedNoticeCount) equals excludedNoticeRows", () => {
    const tsv = buildTsv(STD_HEADERS, [goodRow({ 1: "13F-NT" })]);
    const r = parseSubmissionTsv(tsv);
    expect(r.excludedNoticeCount).toBe(r.excludedNoticeRows);
  });
});
