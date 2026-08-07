// Tests — SEC 13F Bulk Parser: Archive Entry Resolution
//
// Sprint: Institutional 13F — Fix Bare TSV Archive Entry Resolution
//
// Root cause: parseBulkQuarterFromBuffer() built expected entry names using the
// quarter prefix (e.g. 2026Q1_SUBMISSION.TSV) even for post-2023 archives that
// use bare filenames (SUBMISSION.tsv). detectEntryPrefix() only matched the legacy
// pattern and returned null for bare-named archives — leaving all three resolution
// attempts empty → REQUIRED_ARCHIVE_ENTRY_MISSING.
//
// Fix: resolveRequiredArchiveEntry() resolves by canonical basename, case-insensitively,
// across three priority tiers: bare root (A) > legacy-prefixed (B) > nested (C).
//
// Test sections:
//   A. Post-2023 bare archive
//   B. Uppercase archive (case-insensitive)
//   C. Mixed-case archive
//   D. Nested archive
//   E. Legacy-prefixed archive
//   F. Quarter-prefix mismatch (descriptor=2026Q1, archive has bare names)
//   G. Missing submission
//   H. Missing infotable
//   I. Ambiguous submission
//   J. Bare entry plus nested duplicate (root wins)
//   K. Partial-name rejection
//   L. Parser regression (entries resolve → rows > 0)
//   M. Duplicate event regression (structural)

import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import {
  resolveRequiredArchiveEntry,
  parseBulkQuarterFromBuffer,
  parseSubmissionTsv,
  parseInfoTableTsv,
} from "../sec-13f-bulk-parser";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build an in-memory ZIP buffer from a filename → content map. */
function makeZipBuffer(files: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content, "utf8"));
  }
  return zip.toBuffer();
}

/** Opens a ZIP buffer and returns the entry objects. */
function openEntries(buf: Buffer): AdmZip.IZipEntry[] {
  return new AdmZip(buf).getEntries();
}

// Minimal valid TSV content (header + one row each, accessions match for join)
const ACCESSION = "0001234567-26-000001";
const SUBMISSION_TSV =
  "ACCESSION-NUMBER\tCIK\tNAME\tFORM-TYPE\tFILING-DATE\tCONFORMED-PERIOD-OF-REPORT\n" +
  `${ACCESSION}\t0001234567\tTEST FUND LP\t13F-HR\t2026-02-15\t2025-12-31`;

const INFOTABLE_TSV =
  "ACCESSION-NUMBER\tNAMEOFISSUER\tTITLEOFCLASS\tCUSIP\tVALUE\tSSHPRNAMT\tSSHPRNAMTTYPE\t" +
  "INVESTMENTDISCRETION\tOTHERMANAGER\tVOTINGAUTHORITY-SOLE\tVOTINGAUTHORITY-SHARED\tVOTINGAUTHORITY-NONE\n" +
  `${ACCESSION}\tAPPLE INC\tCOM\t037833100\t50000\t300000\tSH\tSOLE\t\t300000\t0\t0`;

// ---------------------------------------------------------------------------
// A. Post-2023 bare archive (bare root names)
// ---------------------------------------------------------------------------

describe("A. Post-2023 bare archive — SUBMISSION.tsv / INFOTABLE.tsv", () => {
  const entries = openEntries(
    makeZipBuffer({ "SUBMISSION.tsv": SUBMISSION_TSV, "INFOTABLE.tsv": INFOTABLE_TSV }),
  );

  it("A01: resolves SUBMISSION.tsv with mode=bare_exact", () => {
    const r = resolveRequiredArchiveEntry(entries, "SUBMISSION.tsv");
    expect(r.found).toBe(true);
    if (r.found) {
      expect(r.mode).toBe("bare_exact");
      expect(r.entry.entryName).toBe("SUBMISSION.tsv");
    }
  });

  it("A02: resolves INFOTABLE.tsv with mode=bare_exact", () => {
    const r = resolveRequiredArchiveEntry(entries, "INFOTABLE.tsv");
    expect(r.found).toBe(true);
    if (r.found) expect(r.mode).toBe("bare_exact");
  });

  it("A03: parseBulkQuarterFromBuffer succeeds and records resolution mode", () => {
    const buf = makeZipBuffer({ "SUBMISSION.tsv": SUBMISSION_TSV, "INFOTABLE.tsv": INFOTABLE_TSV });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).not.toBe("empty_parse_failure");
    expect(result.status).not.toBe("failed");
    expect(result.diagnostics.resolutionMode).toBe("bare_exact");
    expect(result.diagnostics.resolvedSubmissionEntry).toBe("SUBMISSION.tsv");
    expect(result.diagnostics.resolvedInfoTableEntry).toBe("INFOTABLE.tsv");
  });
});

// ---------------------------------------------------------------------------
// B. Uppercase archive — SUBMISSION.TSV / INFOTABLE.TSV
// ---------------------------------------------------------------------------

describe("B. Uppercase archive — case-insensitive resolution", () => {
  const entries = openEntries(
    makeZipBuffer({ "SUBMISSION.TSV": SUBMISSION_TSV, "INFOTABLE.TSV": INFOTABLE_TSV }),
  );

  it("B01: resolves SUBMISSION.TSV case-insensitively", () => {
    const r = resolveRequiredArchiveEntry(entries, "SUBMISSION.tsv");
    expect(r.found).toBe(true);
    if (r.found) {
      expect(r.mode).toBe("bare_exact");
      expect(r.entry.entryName.toUpperCase()).toBe("SUBMISSION.TSV");
    }
  });

  it("B02: resolves INFOTABLE.TSV case-insensitively", () => {
    const r = resolveRequiredArchiveEntry(entries, "INFOTABLE.tsv");
    expect(r.found).toBe(true);
    if (r.found) expect(r.mode).toBe("bare_exact");
  });

  it("B03: parseBulkQuarterFromBuffer succeeds for uppercase archive", () => {
    const buf = makeZipBuffer({ "SUBMISSION.TSV": SUBMISSION_TSV, "INFOTABLE.TSV": INFOTABLE_TSV });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).not.toBe("empty_parse_failure");
    expect(result.diagnostics.resolutionMode).toBe("bare_exact");
  });
});

// ---------------------------------------------------------------------------
// C. Mixed-case archive — Submission.tsv / InfoTable.tsv
// ---------------------------------------------------------------------------

describe("C. Mixed-case archive", () => {
  const entries = openEntries(
    makeZipBuffer({ "Submission.tsv": SUBMISSION_TSV, "InfoTable.tsv": INFOTABLE_TSV }),
  );

  it("C01: resolves Submission.tsv case-insensitively", () => {
    const r = resolveRequiredArchiveEntry(entries, "SUBMISSION.tsv");
    expect(r.found).toBe(true);
    if (r.found) expect(r.mode).toBe("bare_exact");
  });

  it("C02: resolves InfoTable.tsv case-insensitively", () => {
    const r = resolveRequiredArchiveEntry(entries, "INFOTABLE.tsv");
    expect(r.found).toBe(true);
    if (r.found) expect(r.mode).toBe("bare_exact");
  });

  it("C03: parseBulkQuarterFromBuffer succeeds for mixed-case archive", () => {
    const buf = makeZipBuffer({ "Submission.tsv": SUBMISSION_TSV, "InfoTable.tsv": INFOTABLE_TSV });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).not.toBe("empty_parse_failure");
  });
});

// ---------------------------------------------------------------------------
// D. Nested archive — dataset/SUBMISSION.tsv / dataset/INFOTABLE.tsv
// ---------------------------------------------------------------------------

describe("D. Nested archive", () => {
  const entries = openEntries(
    makeZipBuffer({
      "dataset/SUBMISSION.tsv": SUBMISSION_TSV,
      "dataset/INFOTABLE.tsv": INFOTABLE_TSV,
    }),
  );

  it("D01: resolves nested SUBMISSION.tsv with mode=nested_basename", () => {
    const r = resolveRequiredArchiveEntry(entries, "SUBMISSION.tsv");
    expect(r.found).toBe(true);
    if (r.found) {
      expect(r.mode).toBe("nested_basename");
      expect(r.entry.entryName).toContain("SUBMISSION.tsv");
    }
  });

  it("D02: resolves nested INFOTABLE.tsv with mode=nested_basename", () => {
    const r = resolveRequiredArchiveEntry(entries, "INFOTABLE.tsv");
    expect(r.found).toBe(true);
    if (r.found) expect(r.mode).toBe("nested_basename");
  });

  it("D03: parseBulkQuarterFromBuffer succeeds for nested archive", () => {
    const buf = makeZipBuffer({
      "dataset/SUBMISSION.tsv": SUBMISSION_TSV,
      "dataset/INFOTABLE.tsv": INFOTABLE_TSV,
    });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).not.toBe("empty_parse_failure");
    expect(result.diagnostics.resolutionMode).toBe("nested_basename");
  });
});

// ---------------------------------------------------------------------------
// E. Legacy-prefixed archive — 2023Q4_SUBMISSION.tsv / 2023Q4_INFOTABLE.tsv
// ---------------------------------------------------------------------------

describe("E. Legacy-prefixed archive", () => {
  const entries = openEntries(
    makeZipBuffer({
      "2023Q4_SUBMISSION.tsv": SUBMISSION_TSV,
      "2023Q4_INFOTABLE.tsv": INFOTABLE_TSV,
    }),
  );

  it("E01: resolves 2023Q4_SUBMISSION.tsv with mode=legacy_prefixed", () => {
    const r = resolveRequiredArchiveEntry(entries, "SUBMISSION.tsv");
    expect(r.found).toBe(true);
    if (r.found) {
      expect(r.mode).toBe("legacy_prefixed");
      expect(r.entry.entryName).toContain("SUBMISSION");
    }
  });

  it("E02: resolves 2023Q4_INFOTABLE.tsv with mode=legacy_prefixed", () => {
    const r = resolveRequiredArchiveEntry(entries, "INFOTABLE.tsv");
    expect(r.found).toBe(true);
    if (r.found) expect(r.mode).toBe("legacy_prefixed");
  });

  it("E03: parseBulkQuarterFromBuffer succeeds for legacy archive", () => {
    const buf = makeZipBuffer({
      "2023Q4_SUBMISSION.tsv": SUBMISSION_TSV,
      "2023Q4_INFOTABLE.tsv": INFOTABLE_TSV,
    });
    const result = parseBulkQuarterFromBuffer(buf, 2023, 4);
    expect(result.status).not.toBe("empty_parse_failure");
    expect(result.diagnostics.resolutionMode).toBe("legacy_prefixed");
  });

  it("E04: uppercase legacy prefix (2023Q4_SUBMISSION.TSV) also resolves", () => {
    const buf = makeZipBuffer({
      "2023Q4_SUBMISSION.TSV": SUBMISSION_TSV,
      "2023Q4_INFOTABLE.TSV": INFOTABLE_TSV,
    });
    const result = parseBulkQuarterFromBuffer(buf, 2023, 4);
    expect(result.status).not.toBe("empty_parse_failure");
    expect(result.diagnostics.resolutionMode).toBe("legacy_prefixed");
  });
});

// ---------------------------------------------------------------------------
// F. Quarter-prefix mismatch — descriptor=2026Q1, archive has bare names
// ---------------------------------------------------------------------------

describe("F. Quarter-prefix mismatch — descriptor quarter ≠ archive naming", () => {
  it("F01: bare archive with descriptor year=2026 q=1 resolves without imposing prefix", () => {
    const buf = makeZipBuffer({ "SUBMISSION.tsv": SUBMISSION_TSV, "INFOTABLE.tsv": INFOTABLE_TSV });
    // Descriptor says 2026Q1 — old code would try 2026Q1_SUBMISSION.TSV and fail
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).not.toBe("empty_parse_failure");
    expect(result.diagnostics.resolutionMode).toBe("bare_exact");
    // No quarter prefix was imposed
    expect(result.diagnostics.resolvedSubmissionEntry).not.toMatch(/2026Q1/i);
    expect(result.diagnostics.resolvedSubmissionEntry).toBe("SUBMISSION.tsv");
  });

  it("F02: bare archive with any descriptor quarter resolves correctly", () => {
    const buf = makeZipBuffer({ "SUBMISSION.tsv": SUBMISSION_TSV, "INFOTABLE.tsv": INFOTABLE_TSV });
    // Descriptor says 2025Q3 — should still find bare entries
    const result = parseBulkQuarterFromBuffer(buf, 2025, 3);
    expect(result.status).not.toBe("empty_parse_failure");
    expect(result.diagnostics.resolutionMode).toBe("bare_exact");
  });

  it("F03: resolver does not depend on year/q parameters to find entries", () => {
    // The same archive resolves identically regardless of the descriptor quarter
    const buf = makeZipBuffer({ "SUBMISSION.tsv": SUBMISSION_TSV, "INFOTABLE.tsv": INFOTABLE_TSV });
    const r1 = parseBulkQuarterFromBuffer(buf, 2026, 1);
    const r2 = parseBulkQuarterFromBuffer(buf, 2023, 4);
    expect(r1.diagnostics.resolutionMode).toBe(r2.diagnostics.resolutionMode);
    expect(r1.diagnostics.resolvedSubmissionEntry).toBe(r2.diagnostics.resolvedSubmissionEntry);
  });
});

// ---------------------------------------------------------------------------
// G. Missing submission
// ---------------------------------------------------------------------------

describe("G. Missing submission", () => {
  it("G01: returns empty_parse_failure when SUBMISSION.tsv is absent", () => {
    const buf = makeZipBuffer({
      // no SUBMISSION
      "INFOTABLE.tsv": INFOTABLE_TSV,
      "COVERPAGE.tsv": "HEADER\nrow",
    });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).toBe("empty_parse_failure");
    expect(result.reason).toMatch(/REQUIRED_ARCHIVE_ENTRY_MISSING/);
    expect(result.reason).toMatch(/SUBMISSION\.tsv/i);
    expect(result.diagnostics.resolvedSubmissionEntry).toBeNull();
  });

  it("G02: resolveRequiredArchiveEntry returns REQUIRED_ARCHIVE_ENTRY_MISSING for absent entry", () => {
    const buf = makeZipBuffer({ "INFOTABLE.tsv": INFOTABLE_TSV });
    const entries = openEntries(buf);
    const r = resolveRequiredArchiveEntry(entries, "SUBMISSION.tsv");
    expect(r.found).toBe(false);
    if (!r.found) expect(r.error).toBe("REQUIRED_ARCHIVE_ENTRY_MISSING");
  });

  it("G03: archive listing is included in failure reason", () => {
    const buf = makeZipBuffer({ "INFOTABLE.tsv": INFOTABLE_TSV, "COVERPAGE.tsv": "" });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.reason).toMatch(/Archive has:/i);
  });
});

// ---------------------------------------------------------------------------
// H. Missing infotable
// ---------------------------------------------------------------------------

describe("H. Missing infotable", () => {
  it("H01: returns empty_parse_failure when INFOTABLE.tsv is absent", () => {
    const buf = makeZipBuffer({
      "SUBMISSION.tsv": SUBMISSION_TSV,
      // no INFOTABLE
    });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).toBe("empty_parse_failure");
    expect(result.reason).toMatch(/REQUIRED_ARCHIVE_ENTRY_MISSING/);
    expect(result.reason).toMatch(/INFOTABLE\.tsv/i);
    expect(result.diagnostics.resolvedInfoTableEntry).toBeNull();
  });

  it("H02: resolvedSubmissionEntry is populated even when infotable is absent", () => {
    const buf = makeZipBuffer({ "SUBMISSION.tsv": SUBMISSION_TSV });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.diagnostics.resolvedSubmissionEntry).toBe("SUBMISSION.tsv");
    expect(result.diagnostics.resolvedInfoTableEntry).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// I. Ambiguous submission entries
// ---------------------------------------------------------------------------

describe("I. Ambiguous submission — multiple nested candidates, no root entry", () => {
  it("I01: returns AMBIGUOUS_ARCHIVE_ENTRY when two nested SUBMISSION.tsv exist", () => {
    const buf = makeZipBuffer({
      "folder-a/SUBMISSION.tsv": SUBMISSION_TSV,
      "folder-b/SUBMISSION.tsv": SUBMISSION_TSV,
      "INFOTABLE.tsv": INFOTABLE_TSV,
    });
    const entries = openEntries(buf);
    const r = resolveRequiredArchiveEntry(entries, "SUBMISSION.tsv");
    expect(r.found).toBe(false);
    if (!r.found) expect(r.error).toBe("AMBIGUOUS_ARCHIVE_ENTRY");
  });

  it("I02: parseBulkQuarterFromBuffer returns empty_parse_failure on ambiguity", () => {
    const buf = makeZipBuffer({
      "folder-a/SUBMISSION.tsv": SUBMISSION_TSV,
      "folder-b/SUBMISSION.tsv": SUBMISSION_TSV,
      "INFOTABLE.tsv": INFOTABLE_TSV,
    });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).toBe("empty_parse_failure");
    expect(result.reason).toMatch(/AMBIGUOUS_ARCHIVE_ENTRY/);
    expect(result.reason).toMatch(/SUBMISSION\.tsv/i);
  });

  it("I03: ambiguous infotable also triggers AMBIGUOUS_ARCHIVE_ENTRY", () => {
    const buf = makeZipBuffer({
      "SUBMISSION.tsv": SUBMISSION_TSV,
      "folder-a/INFOTABLE.tsv": INFOTABLE_TSV,
      "folder-b/INFOTABLE.tsv": INFOTABLE_TSV,
    });
    const entries = openEntries(buf);
    const r = resolveRequiredArchiveEntry(entries, "INFOTABLE.tsv");
    expect(r.found).toBe(false);
    if (!r.found) expect(r.error).toBe("AMBIGUOUS_ARCHIVE_ENTRY");
  });
});

// ---------------------------------------------------------------------------
// J. Bare root entry wins over nested duplicate
// ---------------------------------------------------------------------------

describe("J. Bare root entry plus nested duplicate — root wins", () => {
  it("J01: root SUBMISSION.tsv wins over backup/SUBMISSION.tsv", () => {
    const buf = makeZipBuffer({
      "SUBMISSION.tsv": SUBMISSION_TSV,
      "backup/SUBMISSION.tsv": "DIFFERENT\ncontent",
      "INFOTABLE.tsv": INFOTABLE_TSV,
    });
    const entries = openEntries(buf);
    const r = resolveRequiredArchiveEntry(entries, "SUBMISSION.tsv");
    expect(r.found).toBe(true);
    if (r.found) {
      expect(r.mode).toBe("bare_exact");
      expect(r.entry.entryName).toBe("SUBMISSION.tsv"); // not backup/SUBMISSION.tsv
    }
  });

  it("J02: parseBulkQuarterFromBuffer succeeds and uses root entry content", () => {
    const buf = makeZipBuffer({
      "SUBMISSION.tsv": SUBMISSION_TSV,
      "backup/SUBMISSION.tsv": "GARBAGE\ncontent",
      "INFOTABLE.tsv": INFOTABLE_TSV,
    });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).not.toBe("empty_parse_failure");
    expect(result.diagnostics.resolutionMode).toBe("bare_exact");
    expect(result.diagnostics.resolvedSubmissionEntry).toBe("SUBMISSION.tsv");
  });
});

// ---------------------------------------------------------------------------
// K. Partial-name rejection
// ---------------------------------------------------------------------------

describe("K. Partial-name rejection", () => {
  it("K01: OLD_SUBMISSION_BACKUP.tsv is NOT matched as SUBMISSION.tsv", () => {
    const buf = makeZipBuffer({
      "OLD_SUBMISSION_BACKUP.tsv": SUBMISSION_TSV, // must be rejected
      "INFOTABLE.tsv": INFOTABLE_TSV,
    });
    const entries = openEntries(buf);
    const r = resolveRequiredArchiveEntry(entries, "SUBMISSION.tsv");
    expect(r.found).toBe(false);
    if (!r.found) expect(r.error).toBe("REQUIRED_ARCHIVE_ENTRY_MISSING");
  });

  it("K02: SUBMISSION_NOTES.txt is NOT matched as SUBMISSION.tsv", () => {
    const buf = makeZipBuffer({
      "SUBMISSION_NOTES.txt": "notes",
      "INFOTABLE.tsv": INFOTABLE_TSV,
    });
    const entries = openEntries(buf);
    const r = resolveRequiredArchiveEntry(entries, "SUBMISSION.tsv");
    expect(r.found).toBe(false);
  });

  it("K03: 2023Q4_BAD_SUBMISSION.tsv (double underscore) is NOT matched as legacy", () => {
    // The filename is NOT <YYYYQN>_SUBMISSION.tsv — it has extra segment
    const buf = makeZipBuffer({
      "2023Q4_BAD_SUBMISSION.tsv": SUBMISSION_TSV,
      "INFOTABLE.tsv": INFOTABLE_TSV,
    });
    const entries = openEntries(buf);
    const r = resolveRequiredArchiveEntry(entries, "SUBMISSION.tsv");
    // basename.slice(indexOf("_")+1) = "BAD_SUBMISSION.tsv" ≠ "submission.tsv"
    expect(r.found).toBe(false);
  });

  it("K04: partial match does not cause false positive in parseBulkQuarterFromBuffer", () => {
    const buf = makeZipBuffer({
      "OLD_SUBMISSION_BACKUP.tsv": SUBMISSION_TSV,
      "INFOTABLE.tsv": INFOTABLE_TSV,
    });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.status).toBe("empty_parse_failure");
    expect(result.reason).toMatch(/REQUIRED_ARCHIVE_ENTRY_MISSING/);
  });
});

// ---------------------------------------------------------------------------
// L. Parser regression — entries resolve → submissionRows > 0, etc.
// ---------------------------------------------------------------------------

describe("L. Parser regression — correct parse after resolution", () => {
  it("L01: bare archive produces submissionRows > 0, informationTableRows > 0, joinedHoldingRows > 0", () => {
    const buf = makeZipBuffer({ "SUBMISSION.tsv": SUBMISSION_TSV, "INFOTABLE.tsv": INFOTABLE_TSV });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.diagnostics.submissionRows).toBeGreaterThan(0);
    expect(result.diagnostics.informationTableRows).toBeGreaterThan(0);
    expect(result.diagnostics.joinedHoldingRows).toBeGreaterThan(0);
    expect(result.holdings.length).toBeGreaterThan(0);
  });

  it("L02: legacy archive produces the same holding data", () => {
    const buf = makeZipBuffer({
      "2023Q4_SUBMISSION.tsv": SUBMISSION_TSV,
      "2023Q4_INFOTABLE.tsv": INFOTABLE_TSV,
    });
    const result = parseBulkQuarterFromBuffer(buf, 2023, 4);
    expect(result.diagnostics.submissionRows).toBeGreaterThan(0);
    expect(result.diagnostics.joinedHoldingRows).toBeGreaterThan(0);
    expect(result.holdings[0].filerName).toBe("TEST FUND LP");
    expect(result.holdings[0].issuerName).toBe("APPLE INC");
    expect(result.holdings[0].cusip).toBe("037833100");
  });

  it("L03: uppercase bare archive produces joinedHoldingRows > 0", () => {
    const buf = makeZipBuffer({ "SUBMISSION.TSV": SUBMISSION_TSV, "INFOTABLE.TSV": INFOTABLE_TSV });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(result.diagnostics.joinedHoldingRows).toBeGreaterThan(0);
  });

  it("L04: result status is 'success' or 'partial_success' (not failure)", () => {
    const buf = makeZipBuffer({ "SUBMISSION.tsv": SUBMISSION_TSV, "INFOTABLE.tsv": INFOTABLE_TSV });
    const result = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(["success", "partial_success"]).toContain(result.status);
  });

  it("L05: diagnostics include all expected fields", () => {
    const buf = makeZipBuffer({ "SUBMISSION.tsv": SUBMISSION_TSV, "INFOTABLE.tsv": INFOTABLE_TSV });
    const { diagnostics } = parseBulkQuarterFromBuffer(buf, 2026, 1);
    expect(diagnostics.archiveBytes).toBeGreaterThan(0);
    expect(diagnostics.archiveEntries.length).toBeGreaterThan(0);
    expect(diagnostics.resolvedSubmissionEntry).toBe("SUBMISSION.tsv");
    expect(diagnostics.resolvedInfoTableEntry).toBe("INFOTABLE.tsv");
    expect(diagnostics.resolutionMode).toBe("bare_exact");
    expect(typeof diagnostics.durationMs).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// M. Duplicate event regression (structural)
// ---------------------------------------------------------------------------

describe("M. Duplicate event regression", () => {
  it("M01: institutional_13f_empty_parse_failure is NOT re-emitted in runInstitutionalIngestion descriptor loop", () => {
    // Structural test: the second log call in the loop was the source of duplicate events.
    // We verify it was removed by reading the ingestion-service source.
    // This is a safety net against regression — the authoritative event is emitted
    // inside ingestFromDescriptor() with full parse diagnostics.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "../ingestion-service.ts"),
      "utf8",
    );

    // The loop block handling "empty_parse_failure" result must NOT contain a
    // direct log("institutional_13f_empty_parse_failure", ...) call.
    // Find the descriptor loop section and check for the duplicate.
    const loopBlock = src.slice(
      src.indexOf("specificDescriptors && options.specificDescriptors.length"),
      src.indexOf("return { status: overallStatus, quartersProcessed };"),
    );
    // The loop block should reference the event name only in a comment, not in a log() call
    const logCallCount = (loopBlock.match(/log\("institutional_13f_empty_parse_failure"/g) ?? []).length;
    expect(logCallCount).toBe(0);
  });

  it("M02: ingestFromDescriptor emits the authoritative failure event with full diagnostics", () => {
    // Verify the authoritative log call is inside ingestFromDescriptor (not removed)
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "../ingestion-service.ts"),
      "utf8",
    );
    // Find ingestFromDescriptor function body
    const fnStart = src.indexOf("async function ingestFromDescriptor(");
    const fnEnd = src.indexOf("\nasync function ", fnStart + 1);
    const fnBody = src.slice(fnStart, fnEnd);

    // Must contain the authoritative event
    expect(fnBody).toContain('log("institutional_13f_empty_parse_failure"');
    // Must include parse diagnostics (reason, submissionRows, etc.)
    expect(fnBody).toContain("reason: parseResult.reason");
    expect(fnBody).toContain("submissionRows: parseResult.diagnostics.submissionRows");
  });

  it("M03: resolveRequiredArchiveEntry is a pure function (no side effects, no logging)", () => {
    // The resolver must not log anything — logging belongs to the ingestion layer
    const buf = makeZipBuffer({ "SUBMISSION.tsv": SUBMISSION_TSV });
    const entries = new AdmZip(buf).getEntries();
    const consoleSpy: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => consoleSpy.push(String(args[0]));
    try {
      resolveRequiredArchiveEntry(entries, "SUBMISSION.tsv");
      resolveRequiredArchiveEntry(entries, "INFOTABLE.tsv"); // missing → error
    } finally {
      console.log = orig;
    }
    expect(consoleSpy).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Additional: resolveRequiredArchiveEntry unit tests
// ---------------------------------------------------------------------------

describe("resolveRequiredArchiveEntry — edge cases", () => {
  it("empty entries array returns REQUIRED_ARCHIVE_ENTRY_MISSING", () => {
    const r = resolveRequiredArchiveEntry([], "SUBMISSION.tsv");
    expect(r.found).toBe(false);
    if (!r.found) expect(r.error).toBe("REQUIRED_ARCHIVE_ENTRY_MISSING");
  });

  it("directory-marker entries (trailing slash) are skipped", () => {
    const zip = new AdmZip();
    zip.addFile("data/", Buffer.alloc(0)); // directory marker
    zip.addFile("data/SUBMISSION.tsv", Buffer.from(SUBMISSION_TSV, "utf8"));
    const entries = zip.getEntries();
    const r = resolveRequiredArchiveEntry(entries, "SUBMISSION.tsv");
    expect(r.found).toBe(true);
    if (r.found) expect(r.mode).toBe("nested_basename");
  });

  it("backslash-separated paths are normalized correctly", () => {
    // AdmZip on Windows might produce backslash paths — verify normalization
    const entries = openEntries(
      makeZipBuffer({ "dataset/SUBMISSION.tsv": SUBMISSION_TSV }),
    );
    // Manually mutate the entry name to simulate backslash path
    const entry = entries.find((e) => e.entryName.includes("SUBMISSION"))!;
    (entry as any).entryName = "dataset\\SUBMISSION.tsv";
    const r = resolveRequiredArchiveEntry(entries, "SUBMISSION.tsv");
    expect(r.found).toBe(true);
    if (r.found) expect(r.mode).toBe("nested_basename");
  });

  it("leading ./ is stripped (e.g. ./SUBMISSION.tsv treated as root bare)", () => {
    const entries = openEntries(
      makeZipBuffer({ "SUBMISSION.tsv": SUBMISSION_TSV }),
    );
    // Simulate ./ prefix
    const entry = entries.find((e) => e.entryName === "SUBMISSION.tsv")!;
    (entry as any).entryName = "./SUBMISSION.tsv";
    const r = resolveRequiredArchiveEntry(entries, "SUBMISSION.tsv");
    expect(r.found).toBe(true);
    if (r.found) expect(r.mode).toBe("bare_exact");
  });

  it("two ambiguous root-level bare entries return AMBIGUOUS_ARCHIVE_ENTRY", () => {
    // Build manually since makeZipBuffer deduplicates by filename key
    const zip = new AdmZip();
    zip.addFile("SUBMISSION.tsv", Buffer.from(SUBMISSION_TSV, "utf8"));
    zip.addFile("SUBMISSION_2.tsv", Buffer.from(SUBMISSION_TSV, "utf8")); // different name, not a match
    const entries = zip.getEntries();
    // Manually add a second root entry with same name
    const fakeEntry = { ...entries[0] } as AdmZip.IZipEntry;
    (fakeEntry as any).entryName = "SUBMISSION.tsv";
    const r = resolveRequiredArchiveEntry([...entries, fakeEntry], "SUBMISSION.tsv");
    // Two root exact matches → AMBIGUOUS
    expect(r.found).toBe(false);
    if (!r.found) expect(r.error).toBe("AMBIGUOUS_ARCHIVE_ENTRY");
  });
});
