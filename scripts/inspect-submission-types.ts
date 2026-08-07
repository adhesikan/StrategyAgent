#!/usr/bin/env tsx
// Diagnostic: Inspect distinct SUBMISSIONTYPE values in the latest SEC 13F archive.
//
// Usage:
//   npx tsx scripts/inspect-submission-types.ts
//   npx tsx scripts/inspect-submission-types.ts --quarters 1
//
// Requirements:
//   SEC_USER_AGENT  — descriptive User-Agent for SEC EDGAR
//
// Output: safe structured log — distinct SUBMISSIONTYPE values and counts only.
// Never logs raw filing rows, SEC_USER_AGENT value, DATABASE_URL, or credentials.

import {
  fetchDatasetCatalog,
  selectDatasetWindows,
  toDatasetDescriptor,
  type InstitutionalDatasetCatalogEntry,
} from "../server/services/institutional/sec-dataset-catalog";
import {
  normalizeSubmissionType,
  parseSubmissionTsv,
} from "../server/services/institutional/sec-13f-bulk-parser";
// secFetchBuffer(url, signal?) — reads SEC_USER_AGENT from institutional config internally.
// Do NOT pass userAgent as an argument; the function has exactly two parameters.
import { secFetchBuffer } from "../server/services/institutional/sec-client";
import AdmZip from "adm-zip";

const MAX_DISTINCT = 30;

// ---------------------------------------------------------------------------
// Pure helper — shared by the script and tests to resolve catalog entries.
// The canonical return shape of fetchDatasetCatalog / getCachedCatalog is
// InstitutionalDatasetCatalogEntry[] (a plain array). This helper makes that
// expectation explicit and fails fast if the shape ever regresses.
// ---------------------------------------------------------------------------
export function resolveCatalogEntries(
  result: InstitutionalDatasetCatalogEntry[],
): InstitutionalDatasetCatalogEntry[] {
  if (!Array.isArray(result)) {
    throw new TypeError(
      `catalog is not iterable: expected InstitutionalDatasetCatalogEntry[] but received ${typeof result}`,
    );
  }
  return result;
}

async function main(): Promise<void> {
  const userAgent = process.env.SEC_USER_AGENT;
  if (!userAgent) {
    console.error("[inspect] ERROR: SEC_USER_AGENT is required");
    process.exit(1);
  }

  // Parse optional --quarters N argument (default 1)
  const quartersArg = process.argv.indexOf("--quarters");
  const quarters =
    quartersArg !== -1 ? parseInt(process.argv[quartersArg + 1] ?? "1", 10) : 1;
  if (isNaN(quarters) || quarters < 1) {
    console.error("[inspect] ERROR: --quarters must be a positive integer");
    process.exit(1);
  }

  console.log("[inspect] Fetching SEC 13F dataset catalog…");
  const raw = await fetchDatasetCatalog(userAgent);
  const catalog = resolveCatalogEntries(raw);

  console.log(`[inspect] Catalog returned ${catalog.length} recognised dataset(s).`);
  if (catalog.length === 0) {
    console.error("[inspect] ERROR: catalog is empty");
    process.exit(1);
  }

  // Reuse the same selection logic as run-institutional-backfill.ts.
  // selectDatasetWindows(n, catalog) — n is FIRST, catalog is SECOND.
  const windows = selectDatasetWindows(quarters, catalog);
  if (windows.length === 0) {
    console.error("[inspect] ERROR: no dataset windows found");
    process.exit(1);
  }

  console.log("[inspect] Selected:");
  for (const w of windows) {
    console.log(`[inspect]   ${w.entry.fileName}  (${w.canonicalPeriodLabel})`);
  }

  // Inspect only the most recent window (first in the list)
  const window = windows[0];
  const descriptor = toDatasetDescriptor(window);

  console.log("[inspect] Downloading selected SEC dataset…");

  // secFetchBuffer(url, signal?) — userAgent is sourced internally from getInstitutionalConfig().
  // Pass ONLY the URL and the AbortSignal; never pass userAgent in the signal position.
  const controller = new AbortController();
  const DOWNLOAD_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  let buffer: Buffer;
  try {
    buffer = await secFetchBuffer(descriptor.downloadUrl, controller.signal);
  } finally {
    clearTimeout(timer);
  }

  console.log(`[inspect] Archive bytes: ${buffer.length}`);

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    console.error("[inspect] ERROR: could not open archive as ZIP");
    process.exit(1);
  }

  console.log("[inspect] Resolving SUBMISSION.tsv…");

  // Find SUBMISSION.tsv (case-insensitive)
  const subEntry = zip.getEntries().find((e) => {
    const base = e.entryName.toUpperCase().replace(/\\/g, "/").split("/").pop() ?? "";
    return base === "SUBMISSION.TSV";
  });

  if (!subEntry) {
    const names = zip.getEntries().map((e) => e.entryName).slice(0, 10);
    console.error("[inspect] ERROR: SUBMISSION.tsv not found. Entries:", names);
    process.exit(1);
  }

  console.log(`[inspect] Resolved: ${subEntry.entryName}`);

  const text = subEntry.getData().toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  if (lines.length < 2) {
    console.error("[inspect] ERROR: SUBMISSION.tsv is empty or header-only");
    process.exit(1);
  }

  const fullText = subEntry.getData().toString("utf8").replace(/^\uFEFF/, "");

  // Parse header to find SUBMISSIONTYPE column index (for lightweight type-only scan)
  const headers = lines[0].split("\t").map((h) => h.trim().toUpperCase());

  const formTypeIdx = headers.findIndex((h) => {
    const n = h.replace(/[-_]/g, "");
    return n === "SUBMISSIONTYPE" || n === "FORMTYPE";
  });

  if (formTypeIdx === -1) {
    console.error("[inspect] WARNING: no SUBMISSIONTYPE/FORM-TYPE column found in headers");
  }

  const rawCounts = new Map<string, number>();
  const normalizedCounts = new Map<string, number>();
  let totalRows = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    totalRows++;

    if (formTypeIdx !== -1) {
      const cells = lines[i].split("\t");
      const val = (cells[formTypeIdx] ?? "").trim();
      rawCounts.set(val, (rawCounts.get(val) ?? 0) + 1);

      const norm = normalizeSubmissionType(val) ?? "null";
      normalizedCounts.set(norm, (normalizedCounts.get(norm) ?? 0) + 1);
    }
  }

  // Build bounded result maps (sorted by count desc)
  function buildBoundedRecord(map: Map<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    let n = 0;
    for (const [val, count] of [...map.entries()].sort((a, b) => b[1] - a[1])) {
      if (n >= MAX_DISTINCT) {
        out["[OTHER]"] = (out["[OTHER]"] ?? 0) + count;
      } else {
        out[val] = count;
        n++;
      }
    }
    return out;
  }

  const submissionTypeCounts = buildBoundedRecord(rawCounts);
  const normalizedSubmissionTypeCounts = buildBoundedRecord(normalizedCounts);

  // Safe output — print in the expected format, never print credentials
  console.log(`[inspect] Submission rows: ${totalRows}`);
  console.log("");
  console.log("[inspect] Raw SUBMISSIONTYPE values:");
  for (const [val, count] of Object.entries(submissionTypeCounts)) {
    console.log(`[inspect]   ${val.padEnd(20)} ${count}`);
  }
  console.log("");
  console.log("[inspect] Normalized values:");
  for (const [val, count] of Object.entries(normalizedSubmissionTypeCounts)) {
    console.log(`[inspect]   ${val.padEnd(20)} ${count}`);
  }

  // ── --validate mode: full field-level validation via parseSubmissionTsv ──
  if (process.argv.includes("--validate")) {
    console.log("");
    console.log("[inspect] ── Field validation (--validate) ─────────────────────────────");

    // parseSubmissionTsv reads the full TSV and validates all required fields.
    // It performs no DB writes, no INFOTABLE parsing, no network calls.
    const parsed = parseSubmissionTsv(fullText);

    console.log(`[inspect] Type classification:`);
    console.log(`[inspect]   13F-HR recognized:         ${parsed.recognized13fHrRows}`);
    console.log(`[inspect]   13F-HR/A recognized:       ${parsed.recognized13fHrAmendmentRows}`);
    console.log(`[inspect]   13F-NT excluded:           ${parsed.excludedNoticeRows}`);
    console.log(`[inspect]   UNKNOWN type excluded:     ${parsed.excludedUnknownTypeRows}`);
    console.log(`[inspect]   Recognized holdings total: ${parsed.recognizedHoldingsFormRows}`);
    console.log("");
    console.log(`[inspect] Field validation (holdings-bearing rows only):`);
    console.log(`[inspect]   parsed successfully:          ${parsed.parsedRows}`);
    console.log(`[inspect]   missing accession:            ${parsed.rejectedMissingAccession}`);
    console.log(`[inspect]   non-standard accession fmt:   ${parsed.rejectedInvalidAccession}  (informational — not gated)`);
    console.log(`[inspect]   missing CIK:                  ${parsed.rejectedMissingCik}`);
    console.log(`[inspect]   invalid CIK (non-numeric):    ${parsed.rejectedInvalidCik}`);
    console.log(`[inspect]   missing period of report:     ${parsed.rejectedMissingPeriodOfReport}`);
    console.log(`[inspect]   invalid period of report:     ${parsed.rejectedInvalidPeriodOfReport}`);
    console.log(`[inspect]   invalid filing date:          ${parsed.rejectedInvalidFilingDate}`);
    console.log(`[inspect]   other validation:             ${parsed.rejectedOtherSubmissionValidation}`);
    console.log("");

    // Invariant check
    const totalRejected =
      parsed.rejectedMissingAccession +
      parsed.rejectedMissingCik +
      parsed.rejectedInvalidCik +
      parsed.rejectedMissingPeriodOfReport +
      parsed.rejectedInvalidPeriodOfReport +
      parsed.rejectedInvalidFilingDate +
      parsed.rejectedOtherSubmissionValidation;
    const invariantHolds = parsed.recognizedHoldingsFormRows === parsed.parsedRows + totalRejected;
    console.log(`[inspect] Invariant check: recognizedHoldingsFormRows === parsedRows + totalRejected`);
    console.log(`[inspect]   ${parsed.recognizedHoldingsFormRows} === ${parsed.parsedRows} + ${totalRejected}  →  ${invariantHolds ? "✓ OK" : "✗ FAIL"}`);

    if (!invariantHolds) {
      console.error("[inspect] WARNING: invariant violated — rejectedInvalidAccession (informational) may account for the difference");
    }

    // Observed field format sampling (safe — no raw filing content)
    if (parsed.rows.length > 0) {
      const sample = parsed.rows[0];
      console.log("");
      console.log("[inspect] Observed field formats (from first parsed row):");
      console.log(`[inspect]   accession format: ${/^\d{10}-\d{2}-\d{6}$/.test(sample.accessionNumber) ? "dashed (10-2-6)" : "non-standard"}`);
      console.log(`[inspect]   CIK digits:       ${sample.cik.length} chars (${/^\d{10}$/.test(sample.cik) ? "padded 10-digit" : "other"})`);
      console.log(`[inspect]   period format:    YYYY-MM-DD (normalized from source)`);
      console.log(`[inspect]   filing date fmt:  YYYY-MM-DD (normalized from source)`);
    }

    // Diagnosis
    console.log("");
    if (parsed.parsedRows === 0 && parsed.recognizedHoldingsFormRows > 0) {
      console.log("[inspect] ⚠  DIAGNOSIS: Holdings forms recognized but all failed field validation.");
      console.log("[inspect]    Check the rejection counters above to identify the blocking field.");
      console.log("[inspect]    Expected: ALL_HOLDINGS_SUBMISSIONS_INVALID failure code in bulk parser.");
    } else if (parsed.parsedRows === 0 && parsed.recognizedHoldingsFormRows === 0) {
      console.log("[inspect] ⚠  DIAGNOSIS: No holdings-bearing form types recognized at all.");
      console.log("[inspect]    Expected: NO_HOLDINGS_BEARING_SUBMISSIONS failure code in bulk parser.");
    } else {
      console.log(`[inspect] ✓  DIAGNOSIS: ${parsed.parsedRows} rows parsed successfully.`);
      console.log("[inspect]    Proceed to run the full backfill when ready.");
    }
  }
}

// Only execute when run directly (not when imported by tests)
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("inspect-submission-types.ts") ||
    process.argv[1].endsWith("inspect-submission-types.js"));

if (isMain) {
  main().catch((err) => {
    console.error("[inspect] FATAL:", err?.message ?? err);
    process.exit(1);
  });
}
