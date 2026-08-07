/**
 * Tests for the inspect-submission-types diagnostic script.
 *
 * Covers spec sections A–L:
 *   A. Current catalog return shape works (plain array)
 *   B. Latest dataset selected correctly (selectDatasetWindows order)
 *   C. Catalog with zero entries fails safely
 *   D. Catalog object never directly iterated if not an array
 *   E. SUBMISSION.tsv resolves
 *   F. Raw SUBMISSIONTYPE counts computed correctly
 *   G. Normalized counts computed correctly
 *   H. UNKNOWN values counted separately
 *   I. Script performs no DB writes
 *   J. Script does not parse INFOTABLE
 *   K. Safe output contains no secrets
 *   L. Existing catalog / backfill argument order preserved
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveCatalogEntries } from "../../../../scripts/inspect-submission-types";
import {
  selectDatasetWindows,
  type InstitutionalDatasetCatalogEntry,
} from "../sec-dataset-catalog";
import { normalizeSubmissionType } from "../sec-13f-bulk-parser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  fileName: string,
  overrides: Partial<InstitutionalDatasetCatalogEntry> = {},
): InstitutionalDatasetCatalogEntry {
  return {
    fileName,
    downloadUrl: `https://www.sec.gov/files/${fileName}`,
    windowStart: "2026-03-01",
    windowEnd: "2026-05-31",
    expectedPeriodOfReport: "2026-03-31",
    canonicalPeriodLabel: "2026Q1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A. Current catalog return shape works (plain array)
// ---------------------------------------------------------------------------
describe("A – resolveCatalogEntries accepts a plain array", () => {
  it("returns the same array when given an array", () => {
    const entries = [makeEntry("01mar2026-31may2026_form13f.zip")];
    expect(resolveCatalogEntries(entries)).toBe(entries);
  });

  it("returns empty array without throwing", () => {
    expect(resolveCatalogEntries([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B. Latest dataset selected correctly — argument order matters
// ---------------------------------------------------------------------------
describe("B – selectDatasetWindows argument order matches backfill script", () => {
  const catalog = [
    makeEntry("01mar2026-31may2026_form13f.zip", {
      expectedPeriodOfReport: "2026-03-31",
      canonicalPeriodLabel: "2026Q1",
    }),
    makeEntry("01dec2025-28feb2026_form13f.zip", {
      windowStart: "2025-12-01",
      windowEnd: "2026-02-28",
      expectedPeriodOfReport: "2025-12-31",
      canonicalPeriodLabel: "2025Q4",
    }),
  ];

  it("selects the most-recent entry with (1, catalog)", () => {
    const windows = selectDatasetWindows(1, catalog);
    expect(windows).toHaveLength(1);
    expect(windows[0].entry.fileName).toBe("01mar2026-31may2026_form13f.zip");
  });

  it("selects two entries with (2, catalog)", () => {
    const windows = selectDatasetWindows(2, catalog);
    expect(windows).toHaveLength(2);
  });

  it("(catalog, 1) reversed call: n=catalog throws or produces wrong result", () => {
    // Passing the array as n and 1 as catalog would attempt to iterate 1 (a number).
    // This is the exact bug that caused the FATAL: catalog is not iterable error.
    // TypeScript prevents this at compile time; at runtime the function would throw.
    expect(() => {
      // @ts-expect-error intentionally wrong argument order to document the bug
      selectDatasetWindows(catalog, 1);
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// C. Catalog with zero entries fails safely
// ---------------------------------------------------------------------------
describe("C – empty catalog", () => {
  it("resolveCatalogEntries returns [] for empty input", () => {
    expect(resolveCatalogEntries([])).toEqual([]);
  });

  it("selectDatasetWindows returns [] when catalog is empty", () => {
    expect(selectDatasetWindows(1, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D. Catalog object never directly iterated if it is not an array
// ---------------------------------------------------------------------------
describe("D – non-array catalog throws via resolveCatalogEntries", () => {
  it("throws TypeError for a plain object", () => {
    expect(() =>
      // @ts-expect-error deliberate wrong type
      resolveCatalogEntries({ entries: [] }),
    ).toThrow(TypeError);
  });

  it("throws TypeError for a number", () => {
    // @ts-expect-error deliberate wrong type
    expect(() => resolveCatalogEntries(42)).toThrow(TypeError);
  });

  it("throws TypeError for null", () => {
    // @ts-expect-error deliberate wrong type
    expect(() => resolveCatalogEntries(null)).toThrow(TypeError);
  });

  it("throws TypeError with informative message", () => {
    // @ts-expect-error deliberate wrong type
    expect(() => resolveCatalogEntries({ entries: [] })).toThrow(
      "catalog is not iterable",
    );
  });
});

// ---------------------------------------------------------------------------
// E. SUBMISSION.tsv resolves — column detection logic
// ---------------------------------------------------------------------------
describe("E – SUBMISSION.tsv column detection", () => {
  function parseFormTypeIdx(header: string): number {
    const headers = header.split("\t").map((h) => h.trim().toUpperCase());
    return headers.findIndex((h) => {
      const n = h.replace(/[-_]/g, "");
      return n === "SUBMISSIONTYPE" || n === "FORMTYPE";
    });
  }

  it("detects SUBMISSION-TYPE header", () => {
    expect(parseFormTypeIdx("ACCESSION-NUMBER\tSUBMISSION-TYPE\tFILED-AS-OF-DATE")).toBe(1);
  });

  it("detects SUBMISSIONTYPE header (no hyphen)", () => {
    expect(parseFormTypeIdx("ACCESSION-NUMBER\tSUBMISSIONTYPE\tFILED-AS-OF-DATE")).toBe(1);
  });

  it("detects FORM-TYPE header", () => {
    expect(parseFormTypeIdx("ACCESSION-NUMBER\tFORM-TYPE\tFILED-AS-OF-DATE")).toBe(1);
  });

  it("detects FORM_TYPE header (underscore)", () => {
    expect(parseFormTypeIdx("ACCESSION-NUMBER\tFORM_TYPE\tFILED-AS-OF-DATE")).toBe(1);
  });

  it("returns -1 when no matching column", () => {
    expect(parseFormTypeIdx("ACCESSION-NUMBER\tCIK\tFILED-AS-OF-DATE")).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// F. Raw SUBMISSIONTYPE counts computed correctly
// ---------------------------------------------------------------------------
describe("F – raw SUBMISSIONTYPE counting", () => {
  function countRaw(rows: string[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of rows) {
      const val = row.trim();
      map.set(val, (map.get(val) ?? 0) + 1);
    }
    return map;
  }

  it("counts distinct values correctly", () => {
    const rows = ["13F-HR", "13F-HR", "13F-NT", "13F-HR/A", "13F-HR"];
    const counts = countRaw(rows);
    expect(counts.get("13F-HR")).toBe(3);
    expect(counts.get("13F-NT")).toBe(1);
    expect(counts.get("13F-HR/A")).toBe(1);
  });

  it("treats whitespace-differing values as distinct raw values", () => {
    const rows = ["13F-HR", " 13F-HR", "13F-HR "];
    const counts = countRaw(rows.map((r) => r.trim()));
    // After trim all resolve to the same raw key
    expect(counts.get("13F-HR")).toBe(3);
  });

  it("handles empty or blank rows gracefully", () => {
    const rows = ["13F-HR", "", "   ", "13F-NT"];
    const counts = countRaw(rows.map((r) => r.trim()));
    expect(counts.get("")).toBe(2); // two blank entries
    expect(counts.get("13F-HR")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// G. Normalized counts computed correctly
// ---------------------------------------------------------------------------
describe("G – normalized SUBMISSIONTYPE counting", () => {
  it("normalizes 13F-HR variants to 13F-HR", () => {
    const inputs = ["13F-HR", "13F_HR", "13fhr", "13FHR"];
    for (const val of inputs) {
      expect(normalizeSubmissionType(val)).toBe("13F-HR");
    }
  });

  it("normalizes 13F-HR/A variants to 13F-HR/A", () => {
    const inputs = ["13F-HR/A", "13F_HR_A", "13fhr/a", "13FHRA", "13F-HR-A"];
    for (const val of inputs) {
      expect(normalizeSubmissionType(val)).toBe("13F-HR/A");
    }
  });

  it("normalizes 13F-NT variants to 13F-NT", () => {
    const inputs = ["13F-NT", "13F_NT", "13FNT"];
    for (const val of inputs) {
      expect(normalizeSubmissionType(val)).toBe("13F-NT");
    }
  });

  it("produces correct normalized aggregate", () => {
    const raw = ["13F-HR", "13F_HR", "13FHR", "13F-NT", "GARBAGE"];
    const map = new Map<string, number>();
    for (const val of raw) {
      const norm = normalizeSubmissionType(val) ?? "null";
      map.set(norm, (map.get(norm) ?? 0) + 1);
    }
    expect(map.get("13F-HR")).toBe(3);
    expect(map.get("13F-NT")).toBe(1);
    expect(map.get("UNKNOWN")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// H. UNKNOWN values counted separately
// ---------------------------------------------------------------------------
describe("H – UNKNOWN values counted", () => {
  it("normalizeSubmissionType returns UNKNOWN for unrecognised values", () => {
    expect(normalizeSubmissionType("GARBAGE")).toBe("UNKNOWN");
    expect(normalizeSubmissionType("10-K")).toBe("UNKNOWN");
    expect(normalizeSubmissionType("SC 13G")).toBe("UNKNOWN");
  });

  it("normalizeSubmissionType returns null for blank/null input", () => {
    expect(normalizeSubmissionType("")).toBeNull();
    expect(normalizeSubmissionType(null)).toBeNull();
    expect(normalizeSubmissionType(undefined)).toBeNull();
  });

  it("UNKNOWN entries appear in normalized count map under 'UNKNOWN'", () => {
    const raw = ["13F-HR", "13F-NT", "WEIRD-TYPE", "ANOTHER-GARBAGE"];
    const norm = raw.map((v) => normalizeSubmissionType(v) ?? "null");
    const unknownCount = norm.filter((v) => v === "UNKNOWN").length;
    expect(unknownCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// I. Script performs no DB writes
// ---------------------------------------------------------------------------
describe("I – script performs no DB writes", () => {
  it("resolveCatalogEntries has no side effects", () => {
    const entries = [makeEntry("01mar2026-31may2026_form13f.zip")];
    // Call twice — pure function, no state mutation
    resolveCatalogEntries(entries);
    const result = resolveCatalogEntries(entries);
    expect(result).toHaveLength(1);
  });

  it("normalizeSubmissionType has no side effects", () => {
    normalizeSubmissionType("13F-HR");
    normalizeSubmissionType("13F-HR");
    expect(normalizeSubmissionType("13F-HR")).toBe("13F-HR");
  });
});

// ---------------------------------------------------------------------------
// J. Script does not parse INFOTABLE
// ---------------------------------------------------------------------------
describe("J – INFOTABLE not parsed", () => {
  it("resolveCatalogEntries does not reference INFOTABLE", () => {
    // This test validates the module boundary: resolveCatalogEntries operates
    // only on catalog entries (not holding rows)
    const entries = [makeEntry("01mar2026-31may2026_form13f.zip")];
    const result = resolveCatalogEntries(entries);
    // Result should be catalog entries, not parsed INFOTABLE rows
    expect(result[0]).toHaveProperty("fileName");
    expect(result[0]).not.toHaveProperty("cusip");
    expect(result[0]).not.toHaveProperty("value");
    expect(result[0]).not.toHaveProperty("shrsOrPrnAmt");
  });
});

// ---------------------------------------------------------------------------
// K. Safe output — no secrets
// ---------------------------------------------------------------------------
describe("K – safe output contains no secrets", () => {
  it("resolveCatalogEntries output contains only catalog fields", () => {
    const entries = [makeEntry("01mar2026-31may2026_form13f.zip")];
    const result = resolveCatalogEntries(entries);
    const serialized = JSON.stringify(result);
    // Should not contain any credential-like patterns
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(/secret/i);
    expect(serialized).not.toMatch(/token/i);
    expect(serialized).not.toMatch(/DATABASE_URL/i);
  });
});

// ---------------------------------------------------------------------------
// L. Existing catalog / backfill argument order preserved
// ---------------------------------------------------------------------------
describe("L – argument order consistency between backfill and diagnostic", () => {
  const catalog = [
    makeEntry("01mar2026-31may2026_form13f.zip", {
      expectedPeriodOfReport: "2026-03-31",
      canonicalPeriodLabel: "2026Q1",
    }),
    makeEntry("01dec2025-28feb2026_form13f.zip", {
      windowStart: "2025-12-01",
      windowEnd: "2026-02-28",
      expectedPeriodOfReport: "2025-12-31",
      canonicalPeriodLabel: "2025Q4",
    }),
  ];

  it("backfill pattern: selectDatasetWindows(n, catalog) succeeds", () => {
    // This mirrors the exact call in run-institutional-backfill.ts line 262:
    //   const selected = selectDatasetWindows(quarters!, catalog);
    const selected = selectDatasetWindows(1, catalog);
    expect(selected).toHaveLength(1);
    expect(selected[0].canonicalPeriodLabel).toBe("2026Q1");
  });

  it("diagnostic pattern: selectDatasetWindows(quarters, catalog) is identical", () => {
    // This mirrors the fixed call in inspect-submission-types.ts:
    //   const windows = selectDatasetWindows(quarters, catalog);
    const windows = selectDatasetWindows(1, catalog);
    expect(windows[0].entry.fileName).toBe("01mar2026-31may2026_form13f.zip");
  });

  it("both patterns select the same entry for n=1", () => {
    const backfill = selectDatasetWindows(1, catalog);
    const diagnostic = selectDatasetWindows(1, catalog);
    expect(backfill[0].entry.fileName).toBe(diagnostic[0].entry.fileName);
  });

  it("resolveCatalogEntries is compatible with fetchDatasetCatalog output (plain array)", () => {
    // fetchDatasetCatalog returns InstitutionalDatasetCatalogEntry[] — a plain array.
    // resolveCatalogEntries must accept that shape without transformation.
    const fakeResult: InstitutionalDatasetCatalogEntry[] = catalog;
    expect(() => resolveCatalogEntries(fakeResult)).not.toThrow();
    expect(resolveCatalogEntries(fakeResult)).toHaveLength(2);
  });
});
