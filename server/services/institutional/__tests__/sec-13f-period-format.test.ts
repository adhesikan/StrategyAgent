/**
 * PERIODOFREPORT diagnostic infrastructure tests.
 *
 * Spec sections E–R from the inspection task:
 *   E. Existing YYYY-MM-DD still works
 *   F. Existing YYYYMMDD still works
 *   G. Existing MM/DD/YYYY still works
 *   H. Existing MM-DD-YYYY still works
 *   I. Existing YYYY/MM/DD still works
 *   J. New format does not create ambiguity with existing formats
 *   N. detectDateFormat identifies each existing format
 *   O. Diagnostic prints maximum 10 sample values (rawPeriodSamples)
 *   P. Diagnostic performs no DB writes (pure function)
 *   Q. Failure remains ALL_HOLDINGS_SUBMISSIONS_INVALID if unsupported format
 *   R. All counter invariants remain valid
 *
 * Tests K, L, M are placeholders — they require the actual production format
 * to be known. They will be enabled once the raw sample output is reported.
 */

import { describe, it, expect } from "vitest";
import {
  parseSubmissionTsv,
  detectDateFormat,
  normalizeDateField,
  type DateFormatLabel,
} from "../sec-13f-bulk-parser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTsv(headers: string[], rows: string[][]): string {
  return [headers.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");
}

const STD_HEADERS = [
  "ACCESSION_NUMBER", "SUBMISSIONTYPE", "CIK",
  "FILINGMANAGER_NAME", "PERIODOFREPORT", "FILING_DATE",
];
const GOOD_ACCESSION = "0000001234-26-000001";
const GOOD_CIK       = "1234567890";
const GOOD_DATE      = "2026-03-15";

function goodRow(period: string, overrides: Record<number, string> = {}): string[] {
  const row = [GOOD_ACCESSION, "13F-HR", GOOD_CIK, "Mgr", period, GOOD_DATE];
  for (const [i, v] of Object.entries(overrides)) row[parseInt(i)] = v;
  return row;
}

// ---------------------------------------------------------------------------
// E. Existing YYYY-MM-DD still works
// ---------------------------------------------------------------------------
describe("E – YYYY-MM-DD (existing format)", () => {
  const cases: [string, string][] = [
    ["2026-03-31", "2026-03-31"],
    ["1993-01-01", "1993-01-01"],
    ["2099-12-31", "2099-12-31"],
    ["2024-02-29", "2024-02-29"], // leap year
  ];

  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => {
      expect(normalizeDateField(input)).toBe(expected);
      const r = parseSubmissionTsv(buildTsv(STD_HEADERS, [goodRow(input)]));
      expect(r.parsedRows).toBe(1);
      expect(r.rows[0]?.periodOfReport).toBe(expected);
      expect(r.detectedPeriodFormats.ISO_DASH).toBe(1);
    });
  }

  it("invalid calendar date is rejected", () => {
    expect(normalizeDateField("2026-02-29")).toBeNull(); // non-leap
    expect(normalizeDateField("2026-13-01")).toBeNull();
    expect(normalizeDateField("1992-12-31")).toBeNull(); // too early
  });
});

// ---------------------------------------------------------------------------
// F. Existing YYYYMMDD still works
// ---------------------------------------------------------------------------
describe("F – YYYYMMDD (existing compact format)", () => {
  const cases: [string, string][] = [
    ["20260331", "2026-03-31"],
    ["20241231", "2024-12-31"],
    ["20240229", "2024-02-29"], // leap year
  ];

  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => {
      expect(normalizeDateField(input)).toBe(expected);
      const r = parseSubmissionTsv(buildTsv(STD_HEADERS, [goodRow(input)]));
      expect(r.parsedRows).toBe(1);
      expect(r.rows[0]?.periodOfReport).toBe(expected);
      expect(r.detectedPeriodFormats.ISO_COMPACT).toBe(1);
    });
  }

  it("invalid 8-digit date is rejected", () => {
    expect(normalizeDateField("20261331")).toBeNull(); // month 13
    expect(normalizeDateField("20260229")).toBeNull(); // not leap year
    expect(normalizeDateField("19921231")).toBeNull(); // before 1993
  });
});

// ---------------------------------------------------------------------------
// G. Existing MM/DD/YYYY still works
// ---------------------------------------------------------------------------
describe("G – MM/DD/YYYY (US slash format)", () => {
  const cases: [string, string][] = [
    ["03/31/2026", "2026-03-31"],
    ["12/31/2024", "2024-12-31"],
    ["1/5/2026",   "2026-01-05"], // single-digit month/day
  ];

  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => {
      expect(normalizeDateField(input)).toBe(expected);
      const r = parseSubmissionTsv(buildTsv(STD_HEADERS, [goodRow(input)]));
      expect(r.parsedRows).toBe(1);
      expect(r.rows[0]?.periodOfReport).toBe(expected);
      expect(r.detectedPeriodFormats.US_SLASH).toBe(1);
    });
  }

  it("invalid MM/DD/YYYY date is rejected", () => {
    expect(normalizeDateField("13/01/2026")).toBeNull(); // month 13
    expect(normalizeDateField("02/30/2026")).toBeNull(); // Feb 30
  });
});

// ---------------------------------------------------------------------------
// H. Existing MM-DD-YYYY still works
// ---------------------------------------------------------------------------
describe("H – MM-DD-YYYY (US hyphen format)", () => {
  const cases: [string, string][] = [
    ["03-31-2026", "2026-03-31"],
    ["12-31-2024", "2024-12-31"],
    ["1-5-2026",   "2026-01-05"],
  ];

  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => {
      expect(normalizeDateField(input)).toBe(expected);
      const r = parseSubmissionTsv(buildTsv(STD_HEADERS, [goodRow(input)]));
      expect(r.parsedRows).toBe(1);
      expect(r.rows[0]?.periodOfReport).toBe(expected);
      expect(r.detectedPeriodFormats.US_DASH).toBe(1);
    });
  }

  it("invalid MM-DD-YYYY is rejected", () => {
    expect(normalizeDateField("13-01-2026")).toBeNull();
    expect(normalizeDateField("02-30-2026")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// I. Existing YYYY/MM/DD still works
// ---------------------------------------------------------------------------
describe("I – YYYY/MM/DD (ISO slash format)", () => {
  const cases: [string, string][] = [
    ["2026/03/31", "2026-03-31"],
    ["2024/12/31", "2024-12-31"],
    ["2024/02/29", "2024-02-29"], // leap year
  ];

  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => {
      expect(normalizeDateField(input)).toBe(expected);
      const r = parseSubmissionTsv(buildTsv(STD_HEADERS, [goodRow(input)]));
      expect(r.parsedRows).toBe(1);
      expect(r.rows[0]?.periodOfReport).toBe(expected);
      expect(r.detectedPeriodFormats.ISO_SLASH).toBe(1);
    });
  }

  it("invalid YYYY/MM/DD is rejected", () => {
    expect(normalizeDateField("2026/13/01")).toBeNull();
    expect(normalizeDateField("2026/02/30")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// J. No ambiguity between formats
// ---------------------------------------------------------------------------
describe("J – No ambiguity between formats", () => {
  it("YYYY-MM-DD is not mistaken for MM-DD-YYYY (year > 99)", () => {
    // 2026-03-31: first segment is 2026 → must be YYYY
    expect(detectDateFormat("2026-03-31")).toBe("ISO_DASH");
    expect(normalizeDateField("2026-03-31")).toBe("2026-03-31");
  });

  it("YYYYMMDD is not mistaken for another 8-digit interpretation", () => {
    // 8-digit string → always treated as YYYYMMDD
    expect(detectDateFormat("20260331")).toBe("ISO_COMPACT");
    expect(normalizeDateField("20260331")).toBe("2026-03-31");
  });

  it("YYYY/MM/DD is not confused with MM/DD/YYYY (first segment length)", () => {
    // First segment is 4 digits → YYYY/MM/DD (ISO_SLASH)
    expect(detectDateFormat("2026/03/31")).toBe("ISO_SLASH");
    // First segment is ≤2 digits → US_SLASH
    expect(detectDateFormat("03/31/2026")).toBe("US_SLASH");
  });

  it("MM-DD-YYYY first segment is ≤2 digits; YYYY-MM-DD first segment is 4 digits", () => {
    expect(detectDateFormat("03-31-2026")).toBe("US_DASH");
    expect(detectDateFormat("2026-03-31")).toBe("ISO_DASH");
  });

  it("unknown/unsupported format returns UNKNOWN", () => {
    expect(detectDateFormat("not-a-date")).toBe("UNKNOWN");
    expect(detectDateFormat("2026-03-31 00:00:00")).toBe("UNKNOWN");
    expect(detectDateFormat("20260331000000")).toBe("UNKNOWN"); // 14-digit timestamp
    expect(detectDateFormat('"2026-03-31"')).toBe("UNKNOWN");  // quoted value
  });
});

// ---------------------------------------------------------------------------
// N. detectDateFormat identifies each existing format correctly
// ---------------------------------------------------------------------------
describe("N – detectDateFormat classifies all supported formats", () => {
  const cases: [string, DateFormatLabel][] = [
    ["2026-03-31",   "ISO_DASH"],
    ["20260331",     "ISO_COMPACT"],
    ["03/31/2026",   "US_SLASH"],
    ["3/1/2026",     "US_SLASH"],  // single-digit month/day
    ["03-31-2026",   "US_DASH"],
    ["2026/03/31",   "ISO_SLASH"],
    ["",             "UNKNOWN"],
    ["   ",          "UNKNOWN"],  // whitespace only
    ["not-a-date",   "UNKNOWN"],
    ["2026-03",      "UNKNOWN"],  // truncated ISO
    ["20261",        "UNKNOWN"],  // 5 digits
    ["2026-03-31T00:00:00", "UNKNOWN"], // ISO datetime
    ["2026-03-31 00:00:00", "UNKNOWN"], // SQL datetime
    ["20260331000000",      "UNKNOWN"], // 14-digit YYYYMMDDHHMMSS
  ];

  for (const [input, expected] of cases) {
    it(`detectDateFormat("${input}") → "${expected}"`, () => {
      expect(detectDateFormat(input)).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// O. rawPeriodSamples is bounded to 10 distinct values
// ---------------------------------------------------------------------------
describe("O – rawPeriodSamples capped at 10 distinct values", () => {
  it("collects up to 10 distinct raw period values from holdings-bearing rows", () => {
    // Generate 15 distinct valid period values
    const rows = Array.from({ length: 15 }, (_, i) => {
      const acc = `000000${String(i + 1).padStart(4, "0")}-26-000001`;
      // Each row has a different valid period (different day)
      const day = String(i + 1).padStart(2, "0");
      return [acc, "13F-HR", GOOD_CIK, "Mgr", `2026-03-${day}`, GOOD_DATE];
    });
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, rows));
    expect(r.rawPeriodSamples.length).toBeLessThanOrEqual(10);
  });

  it("collects samples even when all rows are rejected by field validation", () => {
    // Valid period format but invalid CIK → rejected, but samples are still collected
    const rows = Array.from({ length: 5 }, (_, i) => {
      const acc = `000000${String(i + 1).padStart(4, "0")}-26-000001`;
      return [acc, "13F-HR", "NOTNUM", "Mgr", `2026-0${i + 1}-28`, GOOD_DATE];
    });
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, rows));
    expect(r.parsedRows).toBe(0);
    expect(r.rejectedInvalidCik).toBe(5);
    // Samples are still populated (period format check happens before CIK rejection)
    // Note: period format is sampled only after accession check passes (missing accession checked first)
    // Actually looking at the code: period sampling is done after recognizedHoldingsFormRows++
    // but before the accession check. Wait, let me re-read the code...
    // The period sampling is done AFTER the accession check and AFTER the CIK check?
    // No - looking at the order: 
    // 1. getField for all fields
    // 2. period format sampling (before any gate)
    // 3. accession missing check
    // 4. accession format check (informational)
    // 5. CIK missing check
    // 6. CIK invalid check
    // 7. period missing check
    // 8. period invalid check (normalizeDateField)
    // So samples ARE collected before the CIK rejection gate
    expect(r.rawPeriodSamples.length).toBeGreaterThan(0);
    expect(r.rawPeriodSamples.length).toBeLessThanOrEqual(10);
  });

  it("empty input produces empty rawPeriodSamples", () => {
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, []));
    expect(r.rawPeriodSamples).toHaveLength(0);
  });

  it("all-NT input produces empty rawPeriodSamples (samples only from holdings-bearing rows)", () => {
    const rows = Array.from({ length: 5 }, () =>
      [GOOD_ACCESSION, "13F-NT", GOOD_CIK, "Mgr", "2026-03-31", GOOD_DATE]
    );
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, rows));
    // NT rows are excluded before the period-format sampling block
    expect(r.rawPeriodSamples).toHaveLength(0);
    expect(r.detectedPeriodFormats.ISO_DASH).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P. parseSubmissionTsv is a pure function — no DB writes
// ---------------------------------------------------------------------------
describe("P – parseSubmissionTsv is pure (no DB side effects)", () => {
  it("calling twice with the same input produces identical results", () => {
    const tsv = buildTsv(STD_HEADERS, [goodRow("2026-03-31")]);
    const r1 = parseSubmissionTsv(tsv);
    const r2 = parseSubmissionTsv(tsv);
    expect(r1.parsedRows).toBe(r2.parsedRows);
    expect(r1.detectedPeriodFormats).toEqual(r2.detectedPeriodFormats);
    expect(r1.rawPeriodSamples).toEqual(r2.rawPeriodSamples);
  });

  it("result has no database-related properties", () => {
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, [goodRow("2026-03-31")]));
    expect(r).not.toHaveProperty("db");
    expect(r).not.toHaveProperty("connection");
    expect(r).not.toHaveProperty("pool");
  });
});

// ---------------------------------------------------------------------------
// Q. Failure remains ALL_HOLDINGS_SUBMISSIONS_INVALID when format is unsupported
// ---------------------------------------------------------------------------
describe("Q – ALL_HOLDINGS_SUBMISSIONS_INVALID emitted for unsupported period format", () => {
  it("recognizedHoldingsFormRows > 0 and parsedRows = 0 when all periods unrecognized", () => {
    const rows = Array.from({ length: 3 }, (_, i) => {
      const acc = `000000${String(i + 1).padStart(4, "0")}-26-000001`;
      return [acc, "13F-HR", GOOD_CIK, "Mgr", "UNSUPPORTED-FORMAT", GOOD_DATE];
    });
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, rows));
    expect(r.recognizedHoldingsFormRows).toBe(3);
    expect(r.parsedRows).toBe(0);
    expect(r.rejectedInvalidPeriodOfReport).toBe(3);
    // detectedPeriodFormats should show UNKNOWN for all
    expect(r.detectedPeriodFormats.UNKNOWN).toBe(3);
    expect(r.detectedPeriodFormats.ISO_DASH).toBe(0);
  });

  it("future format (e.g. timestamp) is currently UNKNOWN and causes rejection", () => {
    const rows = [
      [GOOD_ACCESSION, "13F-HR", GOOD_CIK, "Mgr", "2026-03-31 00:00:00", GOOD_DATE],
    ];
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, rows));
    expect(r.parsedRows).toBe(0);
    expect(r.rejectedInvalidPeriodOfReport).toBe(1);
    expect(r.detectedPeriodFormats.UNKNOWN).toBe(1);
  });

  it("future format (14-digit YYYYMMDDHHMMSS) is currently UNKNOWN", () => {
    const rows = [
      [GOOD_ACCESSION, "13F-HR", GOOD_CIK, "Mgr", "20260331000000", GOOD_DATE],
    ];
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, rows));
    expect(r.parsedRows).toBe(0);
    expect(r.rejectedInvalidPeriodOfReport).toBe(1);
    expect(r.detectedPeriodFormats.UNKNOWN).toBe(1);
  });

  it("quoted value is currently UNKNOWN", () => {
    const rows = [
      [GOOD_ACCESSION, "13F-HR", GOOD_CIK, "Mgr", '"2026-03-31"', GOOD_DATE],
    ];
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, rows));
    expect(r.parsedRows).toBe(0);
    expect(r.rejectedInvalidPeriodOfReport).toBe(1);
    expect(r.detectedPeriodFormats.UNKNOWN).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// R. Counter invariants remain valid with new diagnostic fields
// ---------------------------------------------------------------------------
describe("R – Counter invariants remain valid", () => {
  it("totalRows = recognized + excludedNotice + excludedUnknown", () => {
    const rows = [
      [GOOD_ACCESSION, "13F-HR",  GOOD_CIK, "Mgr", "2026-03-31", GOOD_DATE],
      [GOOD_ACCESSION, "13F-NT",  GOOD_CIK, "Mgr", "2026-03-31", GOOD_DATE],
      [GOOD_ACCESSION, "GARBAGE", GOOD_CIK, "Mgr", "2026-03-31", GOOD_DATE],
    ];
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, rows));
    expect(r.totalRows).toBe(
      r.recognizedHoldingsFormRows + r.excludedNoticeRows + r.excludedUnknownTypeRows
    );
  });

  it("recognizedHoldingsFormRows = parsedRows + all rejection counters (excluding informational)", () => {
    const rows = [
      // valid
      [GOOD_ACCESSION,          "13F-HR", GOOD_CIK,  "Mgr", "2026-03-31", GOOD_DATE],
      // missing accession
      ["",                       "13F-HR", GOOD_CIK,  "Mgr", "2026-03-31", GOOD_DATE],
      // missing CIK
      [GOOD_ACCESSION,          "13F-HR", "",         "Mgr", "2026-03-31", GOOD_DATE],
      // invalid CIK
      [GOOD_ACCESSION,          "13F-HR", "NOTNUM",   "Mgr", "2026-03-31", GOOD_DATE],
      // missing period
      [GOOD_ACCESSION,          "13F-HR", GOOD_CIK,  "Mgr", "",            GOOD_DATE],
      // invalid period
      [GOOD_ACCESSION,          "13F-HR", GOOD_CIK,  "Mgr", "BADPERIOD",   GOOD_DATE],
      // invalid filing date (non-empty, unparseable)
      [GOOD_ACCESSION,          "13F-HR", GOOD_CIK,  "Mgr", "2026-03-31",  "BADDATE"],
    ];
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, rows));

    const gatedRejected =
      r.rejectedMissingAccession +
      r.rejectedMissingCik +
      r.rejectedInvalidCik +
      r.rejectedMissingPeriodOfReport +
      r.rejectedInvalidPeriodOfReport +
      r.rejectedInvalidFilingDate +
      r.rejectedOtherSubmissionValidation;

    expect(r.recognizedHoldingsFormRows).toBe(r.parsedRows + gatedRejected);
    expect(r.recognizedHoldingsFormRows).toBe(7);
    expect(r.parsedRows).toBe(1);
  });

  it("detectedPeriodFormats total matches nonempty period values in holdings-bearing rows", () => {
    const rows = [
      [GOOD_ACCESSION, "13F-HR", GOOD_CIK, "Mgr", "2026-03-31", GOOD_DATE], // ISO_DASH
      [GOOD_ACCESSION, "13F-HR", GOOD_CIK, "Mgr", "20260331",   GOOD_DATE], // ISO_COMPACT
      [GOOD_ACCESSION, "13F-HR", GOOD_CIK, "Mgr", "BADFORMAT",  GOOD_DATE], // UNKNOWN
      [GOOD_ACCESSION, "13F-NT", GOOD_CIK, "Mgr", "2026-03-31", GOOD_DATE], // NT — not counted
    ];
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, rows));
    const total = Object.values(r.detectedPeriodFormats).reduce((s, n) => s + n, 0);
    // Only 3 holdings-bearing rows (the NT row is excluded)
    expect(total).toBe(3);
    expect(r.detectedPeriodFormats.ISO_DASH).toBe(1);
    expect(r.detectedPeriodFormats.ISO_COMPACT).toBe(1);
    expect(r.detectedPeriodFormats.UNKNOWN).toBe(1);
  });

  it("filing-date regression: filing-date parsing is independent of period-of-report format", () => {
    // Valid YYYYMMDD period + various filing date formats
    const formats: [string, string | null][] = [
      ["2026-03-15", "2026-03-15"],
      ["20260315",   "2026-03-15"],
      ["03/15/2026", "2026-03-15"],
      ["03-15-2026", "2026-03-15"],
      ["",           null], // empty → falls back to period
      ["BAD",        null], // invalid → row rejected
    ];

    for (const [filingDate, expected] of formats) {
      const row = [GOOD_ACCESSION, "13F-HR", GOOD_CIK, "Mgr", "20260331", filingDate];
      const r = parseSubmissionTsv(buildTsv(STD_HEADERS, [row]));
      if (filingDate === "BAD") {
        expect(r.rejectedInvalidFilingDate).toBe(1);
        expect(r.parsedRows).toBe(0);
      } else if (filingDate === "") {
        expect(r.parsedRows).toBe(1);
        expect(r.rows[0]?.filingDate).toBe("2026-03-31"); // fell back to period
      } else {
        expect(r.parsedRows).toBe(1);
        expect(r.rows[0]?.filingDate).toBe(expected);
      }
    }
  });

  it("YYYYMMDD period does not corrupt detectedPeriodFormats for ISO_DASH rows in the same batch", () => {
    const rows = [
      [GOOD_ACCESSION,          "13F-HR", GOOD_CIK, "Mgr", "20260331",   GOOD_DATE],
      ["0000001234-26-000002",  "13F-HR", GOOD_CIK, "Mgr", "2026-03-31", GOOD_DATE],
    ];
    const r = parseSubmissionTsv(buildTsv(STD_HEADERS, rows));
    expect(r.detectedPeriodFormats.ISO_COMPACT).toBe(1);
    expect(r.detectedPeriodFormats.ISO_DASH).toBe(1);
    expect(r.parsedRows).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// detectDateFormat edge cases not covered above
// ---------------------------------------------------------------------------
describe("detectDateFormat – edge cases", () => {
  it("trims whitespace before classifying", () => {
    expect(detectDateFormat("  2026-03-31  ")).toBe("ISO_DASH");
    expect(detectDateFormat("  20260331  ")).toBe("ISO_COMPACT");
    expect(detectDateFormat("  03/31/2026  ")).toBe("US_SLASH");
  });

  it("empty string returns UNKNOWN", () => {
    expect(detectDateFormat("")).toBe("UNKNOWN");
  });

  it("partial dates return UNKNOWN", () => {
    expect(detectDateFormat("2026-03")).toBe("UNKNOWN");
    expect(detectDateFormat("2026")).toBe("UNKNOWN");
    expect(detectDateFormat("03/2026")).toBe("UNKNOWN");
  });

  it("ISO datetime (with time component) returns UNKNOWN", () => {
    expect(detectDateFormat("2026-03-31T00:00:00")).toBe("UNKNOWN");
    expect(detectDateFormat("2026-03-31T00:00:00Z")).toBe("UNKNOWN");
    expect(detectDateFormat("2026-03-31 00:00:00")).toBe("UNKNOWN");
    expect(detectDateFormat("2026-03-31 00:00:00.0")).toBe("UNKNOWN");
  });
});
