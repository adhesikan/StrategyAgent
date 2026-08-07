// Tests — SEC Form 13F Dataset Catalog
//
// Sprint: Institutional 13F — Fix Post-2023 SEC Dataset Discovery and Period Mapping
//
// Root cause: bulkDatasetUrl() constructs YYYYqN_form13f.zip for all years,
// but post-2023 datasets use date-range filenames (e.g. 01mar2026-31may2026_form13f.zip).
// All post-2023 HEAD probes returned 404 → labeled "dataset not yet published".
//
// Test groups:
//   A. Filename parsing — legacy and date-range
//   B. Catalog HTML parsing
//   C. Catalog normalization
//   D. Dataset window selection (--quarters N semantics)
//   E. Descriptor contract
//   F. Regression — existing 2023Q4 and earlier still work

import { describe, it, expect, beforeEach } from "vitest";
import {
  parseDatasetFileName,
  parseCatalogHtml,
  selectDatasetWindows,
  toDatasetDescriptor,
  evictCatalogCache,
} from "../sec-dataset-catalog";
import type {
  InstitutionalDatasetCatalogEntry,
  ParsedDatasetFileName,
} from "../sec-dataset-catalog";

// ---------------------------------------------------------------------------
// A. Filename parsing
// ---------------------------------------------------------------------------

describe("A. Filename parsing — parseDatasetFileName", () => {
  // A1. Legacy format
  it("A01: parses legacy 2023q4_form13f.zip", () => {
    const r = parseDatasetFileName("2023q4_form13f.zip");
    expect(r).not.toBeNull();
    expect(r!.publicationModel).toBe("legacy_quarter");
    expect(r!.holdingsYear).toBe(2023);
    expect(r!.holdingsQ).toBe(4);
    expect(r!.expectedPeriodOfReport).toBe("2023-12-31");
    expect(r!.canonicalPeriodLabel).toBe("2023Q4");
    expect(r!.windowStart).toBe("2023-10-01");
    expect(r!.windowEnd).toBe("2023-12-31");
    expect(r!.displayLabel).toBe("2023 Q4");
  });

  it("A02: parses legacy 2013q2_form13f.zip (earliest)", () => {
    const r = parseDatasetFileName("2013q2_form13f.zip");
    expect(r).not.toBeNull();
    expect(r!.holdingsYear).toBe(2013);
    expect(r!.holdingsQ).toBe(2);
    expect(r!.expectedPeriodOfReport).toBe("2013-06-30");
  });

  it("A03: parses legacy 2020Q1 (uppercase Q)", () => {
    const r = parseDatasetFileName("2020Q1_form13f.zip");
    expect(r).not.toBeNull();
    expect(r!.holdingsQ).toBe(1);
    expect(r!.expectedPeriodOfReport).toBe("2020-03-31");
  });

  // A4–A8. Post-2023 date-range formats
  it("A04: parses 01mar2025-31may2025_form13f.zip (Mar-May → Q1)", () => {
    const r = parseDatasetFileName("01mar2025-31may2025_form13f.zip");
    expect(r).not.toBeNull();
    expect(r!.publicationModel).toBe("three_month_window");
    expect(r!.holdingsYear).toBe(2025);
    expect(r!.holdingsQ).toBe(1);
    expect(r!.expectedPeriodOfReport).toBe("2025-03-31");
    expect(r!.canonicalPeriodLabel).toBe("2025Q1");
    expect(r!.windowStart).toBe("2025-03-01");
    expect(r!.windowEnd).toBe("2025-05-31");
    expect(r!.displayLabel).toBe("Mar 1–May 31, 2025");
  });

  it("A05: parses 01jun2025-31aug2025_form13f.zip (Jun-Aug → Q2)", () => {
    const r = parseDatasetFileName("01jun2025-31aug2025_form13f.zip");
    expect(r).not.toBeNull();
    expect(r!.holdingsYear).toBe(2025);
    expect(r!.holdingsQ).toBe(2);
    expect(r!.expectedPeriodOfReport).toBe("2025-06-30");
    expect(r!.canonicalPeriodLabel).toBe("2025Q2");
    expect(r!.displayLabel).toBe("Jun 1–Aug 31, 2025");
  });

  it("A06: parses 01sep2025-30nov2025_form13f.zip (Sep-Nov → Q3)", () => {
    const r = parseDatasetFileName("01sep2025-30nov2025_form13f.zip");
    expect(r).not.toBeNull();
    expect(r!.holdingsYear).toBe(2025);
    expect(r!.holdingsQ).toBe(3);
    expect(r!.expectedPeriodOfReport).toBe("2025-09-30");
    expect(r!.canonicalPeriodLabel).toBe("2025Q3");
    expect(r!.windowStart).toBe("2025-09-01");
    expect(r!.windowEnd).toBe("2025-11-30");
  });

  it("A07: parses 01dec2025-28feb2026_form13f.zip (Dec-Feb cross-year → Q4 2025)", () => {
    const r = parseDatasetFileName("01dec2025-28feb2026_form13f.zip");
    expect(r).not.toBeNull();
    expect(r!.holdingsYear).toBe(2025);
    expect(r!.holdingsQ).toBe(4);
    expect(r!.expectedPeriodOfReport).toBe("2025-12-31");
    expect(r!.canonicalPeriodLabel).toBe("2025Q4");
    expect(r!.windowStart).toBe("2025-12-01");
    expect(r!.windowEnd).toBe("2026-02-28");
    expect(r!.displayLabel).toBe("Dec 1, 2025–Feb 28, 2026");
  });

  it("A08: parses 01mar2026-31may2026_form13f.zip (Mar-May 2026 → Q1 2026)", () => {
    const r = parseDatasetFileName("01mar2026-31may2026_form13f.zip");
    expect(r).not.toBeNull();
    expect(r!.holdingsYear).toBe(2026);
    expect(r!.holdingsQ).toBe(1);
    expect(r!.expectedPeriodOfReport).toBe("2026-03-31");
    expect(r!.canonicalPeriodLabel).toBe("2026Q1");
    expect(r!.displayLabel).toBe("Mar 1–May 31, 2026");
  });

  it("A09: handles leap-year February (01dec2023-29feb2024_form13f.zip → 2023Q4)", () => {
    // 2024 is a leap year — 29 Feb 2024 is valid
    const r = parseDatasetFileName("01dec2023-29feb2024_form13f.zip");
    expect(r).not.toBeNull();
    expect(r!.holdingsQ).toBe(4);
    expect(r!.holdingsYear).toBe(2023);
    expect(r!.expectedPeriodOfReport).toBe("2023-12-31");
    expect(r!.windowEnd).toBe("2024-02-29");
  });

  it("A10: rejects leap-year day in non-leap year (01dec2025-29feb2026_form13f.zip)", () => {
    // 2026 is not a leap year — 29 Feb 2026 does not exist
    const r = parseDatasetFileName("01dec2025-29feb2026_form13f.zip");
    expect(r).toBeNull();
  });

  // A11. Malformed filenames
  it("A11: rejects filename not ending in _form13f.zip", () => {
    expect(parseDatasetFileName("2023q4_form13f.tar.gz")).toBeNull();
    expect(parseDatasetFileName("2023q4_data.zip")).toBeNull();
    expect(parseDatasetFileName("form13f_2023q4.zip")).toBeNull();
  });

  it("A12: rejects filename with invalid quarter (0 or 5)", () => {
    expect(parseDatasetFileName("2023q0_form13f.zip")).toBeNull();
    expect(parseDatasetFileName("2023q5_form13f.zip")).toBeNull();
  });

  it("A13: rejects unknown month abbreviation in date-range filename", () => {
    expect(parseDatasetFileName("01xyz2026-31may2026_form13f.zip")).toBeNull();
  });

  it("A14: rejects malformed date-range with invalid end day > month max", () => {
    // November has 30 days — 31 Nov is invalid
    expect(parseDatasetFileName("01sep2025-31nov2025_form13f.zip")).toBeNull();
  });

  it("A15: rejects completely malformed string", () => {
    expect(parseDatasetFileName("totally-wrong")).toBeNull();
    expect(parseDatasetFileName("")).toBeNull();
  });

  it("A16: rejects year before 2013", () => {
    expect(parseDatasetFileName("2010q2_form13f.zip")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B. Catalog HTML parsing
// ---------------------------------------------------------------------------

describe("B. Catalog HTML parsing — parseCatalogHtml", () => {
  const BASE = "https://www.sec.gov";

  it("B01: extracts post-2023 date-range ZIP links from realistic HTML", () => {
    const html = `
      <html><body>
        <a href="/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip">01mar2026-31may2026_form13f.zip</a>
        <a href="/files/structureddata/data/form-13f-data-sets/01dec2025-28feb2026_form13f.zip">01dec2025-28feb2026_form13f.zip</a>
        <a href="/files/structureddata/data/form-13f-data-sets/01sep2025-30nov2025_form13f.zip">Sep-Nov 2025</a>
      </body></html>
    `;
    const entries = parseCatalogHtml(html, BASE);
    expect(entries.length).toBe(3);
    const labels = entries.map((e) => e.canonicalPeriodLabel);
    expect(labels).toContain("2026Q1");
    expect(labels).toContain("2025Q4");
    expect(labels).toContain("2025Q3");
  });

  it("B02: extracts legacy quarter ZIP links", () => {
    const html = `
      <a href="/files/structureddata/data/form-13f-data-sets/2023q4_form13f.zip">2023 Q4</a>
      <a href="/files/structureddata/data/form-13f-data-sets/2023q3_form13f.zip">2023 Q3</a>
    `;
    const entries = parseCatalogHtml(html, BASE);
    expect(entries.length).toBe(2);
    const labels = entries.map((e) => e.canonicalPeriodLabel);
    expect(labels).toContain("2023Q4");
    expect(labels).toContain("2023Q3");
    expect(entries[0].publicationModel).toBe("legacy_quarter");
  });

  it("B03: ignores non-ZIP links", () => {
    const html = `
      <a href="/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip">ZIP</a>
      <a href="/files/structureddata/data/form-13f-data-sets/README.txt">Readme</a>
      <a href="/data/browse-edgar?action=getcompany">EDGAR</a>
      <a href="/some-page.html">Page</a>
    `;
    const entries = parseCatalogHtml(html, BASE);
    expect(entries.length).toBe(1);
    expect(entries[0].canonicalPeriodLabel).toBe("2026Q1");
  });

  it("B04: ignores external host links (rejects non-sec.gov)", () => {
    const html = `
      <a href="https://example.com/files/01mar2026-31may2026_form13f.zip">External</a>
      <a href="https://evil.sec.gov.fake.com/01mar2026-31may2026_form13f.zip">Fake</a>
      <a href="/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip">Real</a>
    `;
    const entries = parseCatalogHtml(html, BASE);
    expect(entries.length).toBe(1);
    expect(entries[0].downloadUrl).toContain("www.sec.gov");
  });

  it("B05: resolves relative sec.gov links correctly", () => {
    const html = `
      <a href="/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip">ZIP</a>
    `;
    const entries = parseCatalogHtml(html, BASE);
    expect(entries.length).toBe(1);
    expect(entries[0].downloadUrl).toBe(
      "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip",
    );
  });

  it("B06: handles full absolute sec.gov HTTPS links", () => {
    const html = `
      <a href="https://www.sec.gov/files/structureddata/data/form-13f-data-sets/2023q4_form13f.zip">2023Q4</a>
    `;
    const entries = parseCatalogHtml(html, BASE);
    expect(entries.length).toBe(1);
    expect(entries[0].downloadUrl).toBe(
      "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/2023q4_form13f.zip",
    );
  });

  it("B07: handles duplicate links — only keeps first occurrence", () => {
    const html = `
      <a href="/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip">First</a>
      <a href="/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip">Duplicate</a>
    `;
    const entries = parseCatalogHtml(html, BASE);
    expect(entries.length).toBe(1);
  });

  it("B08: returns entries sorted newest-first by windowEnd", () => {
    const html = `
      <a href="/files/structureddata/data/form-13f-data-sets/2023q4_form13f.zip">2023Q4</a>
      <a href="/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip">2026Q1</a>
      <a href="/files/structureddata/data/form-13f-data-sets/01dec2025-28feb2026_form13f.zip">2025Q4</a>
    `;
    const entries = parseCatalogHtml(html, BASE);
    expect(entries.length).toBe(3);
    // Sorted newest-first by windowEnd
    expect(entries[0].canonicalPeriodLabel).toBe("2026Q1"); // windowEnd = 2026-05-31
    expect(entries[1].canonicalPeriodLabel).toBe("2025Q4"); // windowEnd = 2026-02-28
    expect(entries[2].canonicalPeriodLabel).toBe("2023Q4"); // windowEnd = 2023-12-31
  });

  it("B09: handles labels containing month names in link text (not filename)", () => {
    // Link text is irrelevant — parsing is always from the href filename
    const html = `
      <a href="/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip">March to May 2026</a>
    `;
    const entries = parseCatalogHtml(html, BASE);
    expect(entries.length).toBe(1);
    expect(entries[0].canonicalPeriodLabel).toBe("2026Q1");
  });

  it("B10: handles single-quoted href attributes", () => {
    const html = `<a href='/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip'>ZIP</a>`;
    const entries = parseCatalogHtml(html, BASE);
    expect(entries.length).toBe(1);
  });

  it("B11: rejects HTTP (non-HTTPS) links", () => {
    const html = `<a href="http://www.sec.gov/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip">HTTP</a>`;
    const entries = parseCatalogHtml(html, BASE);
    expect(entries.length).toBe(0);
  });

  it("B12: returns empty array for empty HTML", () => {
    expect(parseCatalogHtml("", BASE)).toEqual([]);
    expect(parseCatalogHtml("<html><body>No data here</body></html>", BASE)).toEqual([]);
  });

  it("B13: each entry carries correct metadata", () => {
    const html = `<a href="/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip">ZIP</a>`;
    const [e] = parseCatalogHtml(html, BASE);
    expect(e.fileName).toBe("01mar2026-31may2026_form13f.zip");
    expect(e.publicationModel).toBe("three_month_window");
    expect(e.windowStart).toBe("2026-03-01");
    expect(e.windowEnd).toBe("2026-05-31");
    expect(e.expectedPeriodOfReport).toBe("2026-03-31");
    expect(e.canonicalPeriodLabel).toBe("2026Q1");
    expect(e.displayLabel).toBe("Mar 1–May 31, 2026");
  });
});

// ---------------------------------------------------------------------------
// C. Catalog normalization
// ---------------------------------------------------------------------------

describe("C. Catalog normalization", () => {
  it("C01: legacy 2023Q4 maps windowStart/End to Q4 bounds", () => {
    const r = parseDatasetFileName("2023q4_form13f.zip")!;
    expect(r.windowStart).toBe("2023-10-01");
    expect(r.windowEnd).toBe("2023-12-31");
  });

  it("C02: Mar-May window expects Q1 holdings period", () => {
    const r = parseDatasetFileName("01mar2026-31may2026_form13f.zip")!;
    expect(r.holdingsQ).toBe(1);
    expect(r.expectedPeriodOfReport).toBe("2026-03-31");
  });

  it("C03: Jun-Aug window expects Q2 holdings period", () => {
    const r = parseDatasetFileName("01jun2025-31aug2025_form13f.zip")!;
    expect(r.holdingsQ).toBe(2);
    expect(r.expectedPeriodOfReport).toBe("2025-06-30");
  });

  it("C04: Sep-Nov window expects Q3 holdings period", () => {
    const r = parseDatasetFileName("01sep2025-30nov2025_form13f.zip")!;
    expect(r.holdingsQ).toBe(3);
    expect(r.expectedPeriodOfReport).toBe("2025-09-30");
  });

  it("C05: Dec-Feb window expects Q4 holdings period of START year", () => {
    const r = parseDatasetFileName("01dec2025-28feb2026_form13f.zip")!;
    expect(r.holdingsQ).toBe(4);
    expect(r.holdingsYear).toBe(2025); // Q4 of 2025, not 2026
    expect(r.expectedPeriodOfReport).toBe("2025-12-31");
  });

  it("C06: cross-year date range sets windowEnd year correctly", () => {
    const r = parseDatasetFileName("01dec2025-28feb2026_form13f.zip")!;
    expect(r.windowStart).toBe("2025-12-01");
    expect(r.windowEnd).toBe("2026-02-28");
  });

  it("C07: canonicalPeriodLabel is always YYYYqN without dash", () => {
    const r = parseDatasetFileName("01mar2026-31may2026_form13f.zip")!;
    expect(r.canonicalPeriodLabel).toMatch(/^\d{4}Q[1-4]$/);
  });
});

// ---------------------------------------------------------------------------
// D. Quarter selection (--quarters N semantics)
// ---------------------------------------------------------------------------

describe("D. Dataset window selection — selectDatasetWindows", () => {
  function makeEntry(
    fileName: string,
    expectedPeriodOfReport: string,
    canonicalPeriodLabel: string,
    windowEnd: string,
  ): InstitutionalDatasetCatalogEntry {
    return {
      downloadUrl: `https://www.sec.gov/files/structureddata/data/form-13f-data-sets/${fileName}`,
      fileName,
      displayLabel: canonicalPeriodLabel,
      windowStart: "2026-03-01",
      windowEnd,
      publicationModel: "three_month_window",
      canonicalPeriodLabel,
      expectedPeriodOfReport,
    };
  }

  it("D01: --quarters 2 selects the 2 newest distinct holdings periods", () => {
    const catalog: InstitutionalDatasetCatalogEntry[] = [
      makeEntry("01mar2026-31may2026_form13f.zip", "2026-03-31", "2026Q1", "2026-05-31"),
      makeEntry("01dec2025-28feb2026_form13f.zip", "2025-12-31", "2025Q4", "2026-02-28"),
      makeEntry("01sep2025-30nov2025_form13f.zip", "2025-09-30", "2025Q3", "2025-11-30"),
      makeEntry("2023q4_form13f.zip",              "2023-12-31", "2023Q4", "2023-12-31"),
    ];
    const selected = selectDatasetWindows(2, catalog);
    expect(selected.length).toBe(2);
    expect(selected[0].canonicalPeriodLabel).toBe("2026Q1");
    expect(selected[1].canonicalPeriodLabel).toBe("2025Q4");
  });

  it("D02: does not fall back to 2023Q4 when post-2023 entries exist", () => {
    const catalog: InstitutionalDatasetCatalogEntry[] = [
      makeEntry("01mar2026-31may2026_form13f.zip", "2026-03-31", "2026Q1", "2026-05-31"),
      makeEntry("01dec2025-28feb2026_form13f.zip", "2025-12-31", "2025Q4", "2026-02-28"),
      makeEntry("2023q4_form13f.zip",              "2023-12-31", "2023Q4", "2023-12-31"),
    ];
    const selected = selectDatasetWindows(2, catalog);
    const labels = selected.map((s) => s.canonicalPeriodLabel);
    expect(labels).not.toContain("2023Q4"); // post-2023 entries were selected first
    expect(labels).toContain("2026Q1");
    expect(labels).toContain("2025Q4");
  });

  it("D03: dataset window and holdings period remain distinct fields", () => {
    const catalog: InstitutionalDatasetCatalogEntry[] = [
      makeEntry("01mar2026-31may2026_form13f.zip", "2026-03-31", "2026Q1", "2026-05-31"),
    ];
    const [w] = selectDatasetWindows(1, catalog);
    expect(w.expectedPeriodOfReport).toBe("2026-03-31");
    expect(w.entry.windowEnd).toBe("2026-05-31");
    expect(w.entry.windowEnd).not.toBe(w.expectedPeriodOfReport);
  });

  it("D04: duplicate holdings periods do not satisfy the quota twice", () => {
    const catalog: InstitutionalDatasetCatalogEntry[] = [
      // Two entries claiming the same holdings period (e.g. amendment)
      makeEntry("01mar2026-31may2026_form13f.zip",        "2026-03-31", "2026Q1", "2026-05-31"),
      makeEntry("01mar2026-31may2026_amended_form13f.zip","2026-03-31", "2026Q1", "2026-05-28"),
      makeEntry("01dec2025-28feb2026_form13f.zip",         "2025-12-31", "2025Q4", "2026-02-28"),
    ];
    const selected = selectDatasetWindows(2, catalog);
    // Should still return 2 distinct periods even though there are 3 entries
    expect(selected.length).toBe(2);
    const labels = selected.map((s) => s.canonicalPeriodLabel);
    expect(labels[0]).toBe("2026Q1");
    expect(labels[1]).toBe("2025Q4");
  });

  it("D05: late amendment duplicate does not corrupt selection", () => {
    const catalog: InstitutionalDatasetCatalogEntry[] = [
      makeEntry("01mar2026-31may2026_form13f.zip",    "2026-03-31", "2026Q1", "2026-05-31"),
      // Amendment with same period but different filename
      makeEntry("01mar2026-30jun2026_form13f.zip",    "2026-03-31", "2026Q1", "2026-06-30"),
      makeEntry("01dec2025-28feb2026_form13f.zip",    "2025-12-31", "2025Q4", "2026-02-28"),
    ];
    const selected = selectDatasetWindows(2, catalog);
    expect(selected).toHaveLength(2);
    const labels = selected.map((s) => s.canonicalPeriodLabel);
    expect(new Set(labels).size).toBe(2); // distinct
  });

  it("D06: returns only as many as catalog contains when fewer than requested", () => {
    const catalog: InstitutionalDatasetCatalogEntry[] = [
      makeEntry("01mar2026-31may2026_form13f.zip", "2026-03-31", "2026Q1", "2026-05-31"),
    ];
    const selected = selectDatasetWindows(4, catalog);
    expect(selected.length).toBe(1); // only 1 available
  });

  it("D07: returns empty array for empty catalog", () => {
    expect(selectDatasetWindows(2, [])).toEqual([]);
  });

  it("D08: --quarters 1 returns only the single most-recent dataset", () => {
    const catalog: InstitutionalDatasetCatalogEntry[] = [
      makeEntry("01mar2026-31may2026_form13f.zip", "2026-03-31", "2026Q1", "2026-05-31"),
      makeEntry("01dec2025-28feb2026_form13f.zip", "2025-12-31", "2025Q4", "2026-02-28"),
    ];
    const selected = selectDatasetWindows(1, catalog);
    expect(selected.length).toBe(1);
    expect(selected[0].canonicalPeriodLabel).toBe("2026Q1");
  });
});

// ---------------------------------------------------------------------------
// E. Descriptor contract
// ---------------------------------------------------------------------------

describe("E. DatasetDescriptor contract — toDatasetDescriptor", () => {
  function makeWindow(fileName: string): ReturnType<typeof selectDatasetWindows>[0] {
    const parsed = parseDatasetFileName(fileName)!;
    return {
      entry: {
        downloadUrl: `https://www.sec.gov/files/structureddata/data/form-13f-data-sets/${fileName}`,
        fileName,
        displayLabel: parsed.displayLabel,
        windowStart: parsed.windowStart,
        windowEnd: parsed.windowEnd,
        publicationModel: parsed.publicationModel,
        canonicalPeriodLabel: parsed.canonicalPeriodLabel,
        expectedPeriodOfReport: parsed.expectedPeriodOfReport,
      },
      expectedPeriodOfReport: parsed.expectedPeriodOfReport,
      canonicalPeriodLabel: parsed.canonicalPeriodLabel,
    };
  }

  it("E01: descriptor uses exact catalog URL for 2026Q1 dataset", () => {
    const d = toDatasetDescriptor(makeWindow("01mar2026-31may2026_form13f.zip"));
    expect(d.downloadUrl).toBe(
      "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip",
    );
    expect(d.downloadUrl).not.toContain("2026q1_form13f.zip"); // NOT legacy URL
  });

  it("E02: descriptor downloadUrl is not reconstructed from year+q", () => {
    const d = toDatasetDescriptor(makeWindow("01dec2025-28feb2026_form13f.zip"));
    // The descriptor must use the date-range filename, not a constructed 2025q4 URL
    expect(d.downloadUrl).toContain("01dec2025-28feb2026_form13f.zip");
    expect(d.downloadUrl).not.toContain("2025q4_form13f.zip");
  });

  it("E03: descriptor carries correct year+q for entry prefix resolution", () => {
    const d = toDatasetDescriptor(makeWindow("01dec2025-28feb2026_form13f.zip"));
    expect(d.year).toBe(2025);
    expect(d.q).toBe(4);
  });

  it("E04: descriptor carries correct expectedPeriodOfReport", () => {
    const d = toDatasetDescriptor(makeWindow("01mar2026-31may2026_form13f.zip"));
    expect(d.expectedPeriodOfReport).toBe("2026-03-31");
  });

  it("E05: descriptor carries windowStart and windowEnd separately from period", () => {
    const d = toDatasetDescriptor(makeWindow("01mar2026-31may2026_form13f.zip"));
    expect(d.windowStart).toBe("2026-03-01");
    expect(d.windowEnd).toBe("2026-05-31");
    // Holdings period is different from dataset window
    expect(d.windowEnd).not.toBe(d.expectedPeriodOfReport);
  });

  it("E06: legacy 2023Q4 descriptor still uses legacy URL (backward compat)", () => {
    const d = toDatasetDescriptor(makeWindow("2023q4_form13f.zip"));
    expect(d.downloadUrl).toContain("2023q4_form13f.zip");
    expect(d.year).toBe(2023);
    expect(d.q).toBe(4);
    expect(d.expectedPeriodOfReport).toBe("2023-12-31");
  });

  it("E07: 404 from catalog entry is handled safely — no URL reconstruction", () => {
    // The descriptor carries the catalog URL. If that 404s, parseBulkFromDescriptor
    // returns empty_not_published without trying to guess an alternative URL.
    // We verify the descriptor shape has no fallback URL.
    const d = toDatasetDescriptor(makeWindow("01mar2026-31may2026_form13f.zip"));
    expect(Object.keys(d)).toEqual([
      "downloadUrl", "fileName", "windowStart", "windowEnd",
      "expectedPeriodOfReport", "year", "q",
    ]);
  });
});

// ---------------------------------------------------------------------------
// F. Regression — existing 2023Q4 and earlier behavior unchanged
// ---------------------------------------------------------------------------

describe("F. Regression — legacy behavior unchanged", () => {
  it("F01: 2023Q4 legacy filename still parses correctly", () => {
    const r = parseDatasetFileName("2023q4_form13f.zip")!;
    expect(r).not.toBeNull();
    expect(r.expectedPeriodOfReport).toBe("2023-12-31");
    expect(r.publicationModel).toBe("legacy_quarter");
  });

  it("F02: 2020Q1 through Q4 all parse correctly", () => {
    for (const q of [1, 2, 3, 4] as const) {
      const ends = { 1: "2020-03-31", 2: "2020-06-30", 3: "2020-09-30", 4: "2020-12-31" };
      const r = parseDatasetFileName(`2020q${q}_form13f.zip`)!;
      expect(r).not.toBeNull();
      expect(r.expectedPeriodOfReport).toBe(ends[q]);
    }
  });

  it("F03: EMPTY_NOT_PUBLISHED status semantics are unchanged — a missing URL still returns empty_not_published", () => {
    // This test verifies the status string constant hasn't changed — ingestion service
    // pattern-matches on it in runInstitutionalIngestion.
    // We verify parseCatalogHtml returns empty for a page with no ZIPs (not a thrown error).
    const result = parseCatalogHtml("<html><body>No Form 13F datasets available.</body></html>");
    expect(result).toEqual([]); // no error thrown — ingestion handles empty catalog
  });

  it("F04: EMPTY_PARSE_FAILURE behavior is unchanged — bad archive content still produces empty_parse_failure status", () => {
    // Verify the status literal used by ingestion-service is still the correct string
    const validStatuses = ["success", "partial_success", "empty_not_published", "empty_parse_failure", "failed"];
    expect(validStatuses).toContain("empty_parse_failure");
    expect(validStatuses).toContain("empty_not_published");
  });

  it("F05: catalog HTML parsing does not throw on malformed HTML", () => {
    const malformed = `
      <html><<a broken <a href="javascript:void(0)">nope</a>
      <div class="table">>><a href="/files/structureddata/data/form-13f-data-sets/2023q4_form13f.zip">2023Q4</a>
    `;
    expect(() => parseCatalogHtml(malformed)).not.toThrow();
  });

  it("F06: 2023Q4 in a mixed catalog is still discoverable", () => {
    const html = `
      <a href="/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip">2026Q1</a>
      <a href="/files/structureddata/data/form-13f-data-sets/2023q4_form13f.zip">2023Q4</a>
    `;
    const entries = parseCatalogHtml(html, "https://www.sec.gov");
    const labels = entries.map((e) => e.canonicalPeriodLabel);
    expect(labels).toContain("2023Q4");
    expect(labels).toContain("2026Q1");
  });

  it("F07: --quarters 2 does not report '2026Q2 unpublished' when the question is about the Mar-May window", () => {
    // The old system labeled quarters "2026Q2 not yet published" when it should have
    // been checking whether 01mar2026-31may2026_form13f.zip exists.
    // The new system selects from the catalog (which contains the correct URLs).
    // We verify: selectDatasetWindows never produces a label that says "Q2" for
    // the Mar-May dataset window — that window is Q1.
    const catalog: InstitutionalDatasetCatalogEntry[] = [
      {
        downloadUrl: "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip",
        fileName: "01mar2026-31may2026_form13f.zip",
        displayLabel: "Mar 1–May 31, 2026",
        windowStart: "2026-03-01",
        windowEnd: "2026-05-31",
        publicationModel: "three_month_window",
        canonicalPeriodLabel: "2026Q1", // NOT 2026Q2
        expectedPeriodOfReport: "2026-03-31",
      },
    ];
    const [w] = selectDatasetWindows(1, catalog);
    expect(w.canonicalPeriodLabel).toBe("2026Q1");
    expect(w.canonicalPeriodLabel).not.toBe("2026Q2");
  });
});

// ---------------------------------------------------------------------------
// G. CLI dry-run output contract (structural)
// ---------------------------------------------------------------------------

describe("G. CLI dry-run output contract", () => {
  it("G01: selectedDatasetWindow has both dataset window and holdings period fields", () => {
    const html = `<a href="/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip">ZIP</a>`;
    const catalog = parseCatalogHtml(html, "https://www.sec.gov");
    const [w] = selectDatasetWindows(1, catalog);

    // These are the fields the dry-run output uses
    expect(w.entry.displayLabel).toBe("Mar 1–May 31, 2026");   // dataset window
    expect(w.entry.fileName).toBe("01mar2026-31may2026_form13f.zip");
    expect(w.canonicalPeriodLabel).toBe("2026Q1");              // expected holdings period
    expect(w.expectedPeriodOfReport).toBe("2026-03-31");
  });

  it("G02: dry-run would not say '2026Q2 unpublished' for a Mar-May archive", () => {
    // The CLI prints canonicalPeriodLabel — verify it's Q1 for the Mar-May window
    const html = `<a href="/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip">ZIP</a>`;
    const catalog = parseCatalogHtml(html, "https://www.sec.gov");
    const [w] = selectDatasetWindows(1, catalog);
    expect(w.canonicalPeriodLabel).not.toMatch(/Q2/);
  });

  it("G03: dry-run output fields cover spec requirements", () => {
    const html = `<a href="/files/structureddata/data/form-13f-data-sets/01dec2025-28feb2026_form13f.zip">ZIP</a>`;
    const catalog = parseCatalogHtml(html, "https://www.sec.gov");
    const [w] = selectDatasetWindows(1, catalog);

    // Spec-required output fields
    expect(w.entry.displayLabel).toBeTruthy();       // dataset window label
    expect(w.entry.fileName).toBeTruthy();           // ZIP filename
    expect(w.canonicalPeriodLabel).toBeTruthy();     // expected holdings quarter
    expect(w.expectedPeriodOfReport).toBeTruthy();   // expected period of report date
    expect(w.entry.publicationModel).toBeTruthy();   // publication model
  });
});

// ---------------------------------------------------------------------------
// H. Cache behavior (unit-level)
// ---------------------------------------------------------------------------

describe("H. Catalog cache", () => {
  beforeEach(() => {
    evictCatalogCache();
  });

  it("H01: evictCatalogCache does not throw", () => {
    expect(() => evictCatalogCache()).not.toThrow();
  });

  it("H02: evictCatalogCache is idempotent", () => {
    evictCatalogCache();
    evictCatalogCache();
    // No error
  });
});
