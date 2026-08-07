// SEC Form 13F Bulk Dataset Parser
//
// Downloads and parses SEC quarterly 13F bulk archives from:
//   https://www.sec.gov/files/structureddata/data/form-13f-data-sets/{YYYY}q{N}_form13f.zip
//
// Archive structure (uppercase TSV files):
//   {YYYY}Q{N}_SUBMISSION.TSV   — one row per 13F-HR / 13F-HR/A filing
//   {YYYY}Q{N}_INFOTABLE.TSV    — one row per InfoTable holding entry
//
// ── ROOT CAUSE OF PRIOR ZERO-FILING BUG ─────────────────────────────────────
//   The prior code downloaded company.idx (EDGAR full-index) and called
//   parseQuarterlyIndex(), which checks:
//       line.includes("|") ? line.split("|") : null
//   The EDGAR company.idx file is FIXED-WIDTH (not pipe-delimited).
//   Every line failed the pipe check → parts = null → entries = [] → totalFilings = 0.
//   The downloaded "indexBytes: ~5.5 MB" was the fixed-width company.idx — the data
//   was present but the delimiter assumption was wrong.
// ────────────────────────────────────────────────────────────────────────────
//
// CORRECTNESS RULES (NON-NEGOTIABLE):
//   - ZIP entry names are uppercase; matching is case-insensitive.
//   - Files are tab-delimited and may begin with a UTF-8 BOM.
//   - Line endings may be CRLF or LF.
//   - Accession numbers are normalized to dashed format before joining.
//   - Put/call rows are preserved; never counted as common-stock SH volume.
//   - PRN rows are preserved; never counted as share count.
//   - A nontrivial archive with 0 parsed 13F-HR rows is EMPTY_PARSE_FAILURE.
//   - HTTP 404 is EMPTY_NOT_PUBLISHED (quarter not yet released by SEC).
//   - Never log raw holding data, credentials, or full archive contents.

import AdmZip from "adm-zip";
import { secFetchBuffer, SecHttpError } from "./sec-client";
import type { DatasetDescriptor } from "./sec-dataset-catalog";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BULK_DATASET_BASE =
  "https://www.sec.gov/files/structureddata/data/form-13f-data-sets";

// Joined / total-INFOTABLE rate below which we suspect an accession-number mismatch.
const MIN_JOIN_RATE_WARN = 0.5;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BulkQuarterStatus =
  | "success"
  | "partial_success"
  | "empty_not_published"
  | "empty_parse_failure"
  | "failed";

export interface BulkParseDiagnostics {
  archiveBytes: number;
  /** First ≤8 entry names (safe to log) */
  archiveEntries: string[];
  submissionRows: number;
  informationTableRows: number;
  joinedHoldingRows: number;
  rejectedRows: number;
  eligibleCommonStockRows: number;
  putCallExcludedRows: number;
  prnExcludedRows: number;
  durationMs: number;
}

export interface ParsedBulkHolding {
  accessionNumber: string; // dashed format
  filerCik: string;        // 10-digit padded
  filerName: string;
  filingType: string;      // "13F-HR" | "13F-HR/A"
  filingDate: string;      // YYYY-MM-DD
  periodOfReport: string;  // YYYY-MM-DD
  isAmendment: boolean;
  issuerName: string;
  classTitle: string;
  cusip: string;           // 9-char normalized
  figi: string | null;
  reportedValue: number | null;    // thousands USD as filed
  reportedShares: number | null;
  sharesPrnType: "SH" | "PRN" | null;
  putCall: "Put" | "Call" | null;
  investmentDiscretion: string | null;
  otherManager: string | null;
  votingSole: number | null;
  votingShared: number | null;
  votingNone: number | null;
}

export interface BulkParseResult {
  status: BulkQuarterStatus;
  holdings: ParsedBulkHolding[];
  diagnostics: BulkParseDiagnostics;
  /** Human-readable reason (safe, no secrets) */
  reason?: string;
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * URL for the SEC Form 13F bulk dataset ZIP for a given year/quarter.
 *
 * NOTE: This function constructs a legacy-format URL (YYYYqN_form13f.zip)
 * and only works reliably for datasets through 2023Q4. Post-2023 datasets
 * use a three-month date-range filename (e.g. 01mar2026-31may2026_form13f.zip)
 * that cannot be constructed without the official catalog.
 *
 * For post-2023 datasets, use getCachedCatalog() in sec-dataset-catalog.ts
 * to obtain the authoritative download URL.
 *
 * @deprecated Prefer DatasetDescriptor.downloadUrl from the catalog for new code.
 */
export function bulkDatasetUrl(year: number, q: 1 | 2 | 3 | 4): string {
  return `${BULK_DATASET_BASE}/${year}q${q}_form13f.zip`;
}

/**
 * ZIP entry prefix for a quarter, e.g. year=2026, q=1 → "2026Q1".
 * Entries inside the archive are named {prefix}_SUBMISSION.TSV etc.
 */
export function entryPrefix(year: number, q: 1 | 2 | 3 | 4): string {
  return `${year}Q${q}`;
}

/**
 * Auto-detect the entry prefix inside a ZIP by scanning for *_SUBMISSION.TSV.
 * Returns the detected prefix (e.g. "2026Q1") or null if not found.
 * Used as a fallback when the expected prefix is not present in the archive.
 */
export function detectEntryPrefix(zip: AdmZip): string | null {
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.toUpperCase().replace(/\\/g, "/");
    const base = name.includes("/") ? name.split("/").pop()! : name;
    const m = base.match(/^(\d{4}Q[1-4])_SUBMISSION\.TSV$/);
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// TSV parsing
// ---------------------------------------------------------------------------

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse a tab-delimited text file into header array + typed row objects.
 * Handles UTF-8 BOM, CRLF, LF, and skips blank lines.
 */
export function parseTsv(raw: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const text = stripBom(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n");
  const headers: string[] = [];
  const rows: Record<string, string>[] = [];
  let headerParsed = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = line.split("\t");
    if (!headerParsed) {
      for (const cell of cells) headers.push(cell.trim().toUpperCase());
      headerParsed = true;
      continue;
    }
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = (cells[i] ?? "").trim();
    }
    rows.push(row);
  }

  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Accession number normalization
// ---------------------------------------------------------------------------

/**
 * Normalize an accession number to dashed format: XXXXXXXXXX-YY-ZZZZZZ.
 * Handles already-dashed input (returned as-is) and 18-digit undashed input.
 */
export function normalizeAccession(raw: string): string {
  const s = raw.trim();
  if (/^\d{10}-\d{2}-\d{6}$/.test(s)) return s;              // already dashed
  const digits = s.replace(/[^0-9]/g, "");
  if (digits.length === 18) {
    return `${digits.slice(0, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
  }
  return s; // Unknown format — return as-is; join will fail gracefully
}

// ---------------------------------------------------------------------------
// Field normalizers (module-private)
// ---------------------------------------------------------------------------

function normalizeCusip(raw: string): string {
  const c = raw.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return c.padStart(9, "0").slice(0, 9);
}

function parseFiniteInt(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = parseInt(raw.replace(/,/g, ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeSharesPrnType(raw: string): "SH" | "PRN" | null {
  const u = raw.trim().toUpperCase();
  return u === "SH" ? "SH" : u === "PRN" ? "PRN" : null;
}

function normalizePutCall(raw: string): "Put" | "Call" | null {
  const u = raw.trim().toUpperCase();
  if (u === "PUT" || u === "P") return "Put";
  if (u === "CALL" || u === "C") return "Call";
  return null;
}

function normalizeDateField(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return null;
}

// ---------------------------------------------------------------------------
// SUBMISSION.tsv parser
// ---------------------------------------------------------------------------

export interface SubmissionRow {
  accessionNumber: string; // dashed format
  cik: string;             // 10-digit padded
  name: string;
  formType: string;        // "13F-HR" | "13F-HR/A"
  filingDate: string;      // YYYY-MM-DD
  periodOfReport: string;  // YYYY-MM-DD
  isAmendment: boolean;
}

const REQUIRED_SUBMISSION_HEADERS = ["ACCESSION-NUMBER", "CIK", "NAME"];

/**
 * Parse SUBMISSION.tsv. Returns 13F-HR and 13F-HR/A rows only.
 * Supports column-name aliases that have appeared in different SEC release years.
 */
export function parseSubmissionTsv(text: string): {
  rows: SubmissionRow[];
  totalRows: number;
  missingHeaders: string[];
} {
  const { headers, rows: rawRows } = parseTsv(text);
  const missingHeaders = REQUIRED_SUBMISSION_HEADERS.filter(
    (h) => !headers.includes(h),
  );

  const rows: SubmissionRow[] = [];
  let totalRows = 0;

  for (const raw of rawRows) {
    totalRows++;

    const formTypeRaw = (raw["FORM-TYPE"] ?? "").trim().toUpperCase();
    // The 13F data set contains only 13F forms, but filter for safety.
    // If FORM-TYPE column is absent, accept all rows (they are all 13F).
    if (formTypeRaw && formTypeRaw !== "13F-HR" && formTypeRaw !== "13F-HR/A") continue;

    const accRaw = raw["ACCESSION-NUMBER"] ?? raw["ACCESSION_NUMBER"] ?? "";
    const cikRaw = raw["CIK"] ?? "";
    const name = (raw["NAME"] ?? raw["COMPANY-NAME"] ?? "").trim();

    // Period of report: try each alias in priority order
    const periodRaw =
      raw["CONFORMED-PERIOD-OF-REPORT"] ??
      raw["PERIOD-OF-REPORT"] ??
      raw["REPORT-DATE"] ??
      "";

    // Filing date: try each alias
    const filingDateRaw =
      raw["FILING-DATE"] ??
      raw["FILED-AS-OF-DATE"] ??
      raw["DATE-FILED"] ??
      "";

    const accession = normalizeAccession(accRaw);
    const cik = cikRaw.replace(/^0+/, "").padStart(10, "0") || cikRaw;
    const periodOfReport = normalizeDateField(periodRaw);
    const filingDate = normalizeDateField(filingDateRaw) ?? periodOfReport ?? "";

    if (!accession || !cik || !periodOfReport) continue;

    rows.push({
      accessionNumber: accession,
      cik,
      name,
      formType: raw["FORM-TYPE"] ?? "13F-HR",
      filingDate,
      periodOfReport,
      isAmendment: formTypeRaw === "13F-HR/A",
    });
  }

  return { rows, totalRows, missingHeaders };
}

// ---------------------------------------------------------------------------
// INFOTABLE.tsv parser
// ---------------------------------------------------------------------------

export interface InfoTableRow {
  accessionNumber: string;
  issuerName: string;
  classTitle: string;
  cusip: string;
  figi: string | null;
  reportedValue: number | null;
  reportedShares: number | null;
  sharesPrnType: "SH" | "PRN" | null;
  putCall: "Put" | "Call" | null;
  investmentDiscretion: string | null;
  otherManager: string | null;
  votingSole: number | null;
  votingShared: number | null;
  votingNone: number | null;
}

const REQUIRED_INFOTABLE_HEADERS = [
  "ACCESSION-NUMBER",
  "NAMEOFISSUER",
  "TITLEOFCLASS",
  "CUSIP",
];

/**
 * Parse INFOTABLE.tsv. Returns all holding rows including put/call and PRN.
 */
export function parseInfoTableTsv(text: string): {
  rows: InfoTableRow[];
  totalRows: number;
  rejectedRows: number;
  missingHeaders: string[];
} {
  const { headers, rows: rawRows } = parseTsv(text);
  const missingHeaders = REQUIRED_INFOTABLE_HEADERS.filter(
    (h) => !headers.includes(h),
  );

  const rows: InfoTableRow[] = [];
  let totalRows = 0;
  let rejectedRows = 0;

  for (const raw of rawRows) {
    totalRows++;

    const accRaw = raw["ACCESSION-NUMBER"] ?? raw["ACCESSION_NUMBER"] ?? "";
    const issuerName = (raw["NAMEOFISSUER"] ?? "").trim();
    const classTitle = (raw["TITLEOFCLASS"] ?? "").trim();
    const cusipRaw = (raw["CUSIP"] ?? "").trim();

    if (!accRaw || !issuerName || !classTitle || !cusipRaw) {
      rejectedRows++;
      continue;
    }

    const cusip = normalizeCusip(cusipRaw);
    if (cusip.length !== 9) {
      rejectedRows++;
      continue;
    }

    const figiRaw = (raw["FIGI"] ?? "").trim();

    rows.push({
      accessionNumber: normalizeAccession(accRaw),
      issuerName: issuerName.replace(/\s+/g, " "),
      classTitle: classTitle.replace(/\s+/g, " "),
      cusip,
      figi: figiRaw || null,
      reportedValue: parseFiniteInt(raw["VALUE"] ?? ""),
      reportedShares: parseFiniteInt(raw["SSHPRNAMT"] ?? ""),
      sharesPrnType: normalizeSharesPrnType(raw["SSHPRNAMTTYPE"] ?? ""),
      putCall: normalizePutCall(raw["PUTCALL"] ?? ""),
      investmentDiscretion: (raw["INVESTMENTDISCRETION"] ?? "").trim() || null,
      otherManager: (raw["OTHERMANAGER"] ?? "").trim() || null,
      votingSole: parseFiniteInt(raw["VOTINGAUTHORITY-SOLE"] ?? ""),
      votingShared: parseFiniteInt(raw["VOTINGAUTHORITY-SHARED"] ?? ""),
      votingNone: parseFiniteInt(raw["VOTINGAUTHORITY-NONE"] ?? ""),
    });
  }

  return { rows, totalRows, rejectedRows, missingHeaders };
}

// ---------------------------------------------------------------------------
// ZIP entry resolution (case-insensitive)
// ---------------------------------------------------------------------------

/**
 * Find a ZIP entry by name suffix, case-insensitive.
 * Handles entries with directory prefixes (e.g. "data/2026Q1_SUBMISSION.TSV").
 */
export function findZipEntry(
  zip: AdmZip,
  targetSuffix: string,
): AdmZip.IZipEntry | null {
  const suffix = targetSuffix.toUpperCase();
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.toUpperCase().replace(/\\/g, "/");
    if (name === suffix || name.endsWith("/" + suffix)) return entry;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core parse function (synchronous — accepts pre-downloaded buffer)
// ---------------------------------------------------------------------------

const EMPTY_DIAGNOSTICS: BulkParseDiagnostics = {
  archiveBytes: 0,
  archiveEntries: [],
  submissionRows: 0,
  informationTableRows: 0,
  joinedHoldingRows: 0,
  rejectedRows: 0,
  eligibleCommonStockRows: 0,
  putCallExcludedRows: 0,
  prnExcludedRows: 0,
  durationMs: 0,
};

/**
 * Parse a pre-downloaded bulk quarter ZIP buffer.
 * Exported for testing — does not make any HTTP requests.
 *
 * @param buffer             ZIP archive buffer
 * @param year               Holdings period year (used to derive entry prefix)
 * @param q                  Holdings period quarter (used to derive entry prefix)
 * @param startMs            Timestamp of download start for durationMs diagnostic
 * @param entryPrefixOverride  Optional explicit entry prefix (e.g. "2026Q1").
 *                             When provided it is tried first. If no matching
 *                             entry is found, auto-detection from archive entries
 *                             is attempted before falling back to year+q.
 */
export function parseBulkQuarterFromBuffer(
  buffer: Buffer,
  year: number,
  q: 1 | 2 | 3 | 4,
  startMs = 0,
  entryPrefixOverride?: string,
): BulkParseResult {
  // Determine the entry prefix to use:
  //   1. Caller-supplied override (first attempt)
  //   2. Year+quarter derived (fallback)
  // Auto-detect from archive entries when neither resolves.
  const derivedPrefix = entryPrefix(year, q);
  const preferredPrefix = entryPrefixOverride ?? derivedPrefix;

  // Open ZIP
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return {
      status: "failed",
      holdings: [],
      diagnostics: {
        ...EMPTY_DIAGNOSTICS,
        archiveBytes: buffer.length,
        durationMs: Date.now() - startMs,
      },
      reason: "Could not open archive as a ZIP file",
    };
  }

  const allEntries = zip.getEntries().map((e) => e.entryName);
  const baseDiag = { archiveBytes: buffer.length, archiveEntries: allEntries };

  // Resolve the actual entry prefix to look up:
  //   1. Try preferredPrefix (override or derived from year+q)
  //   2. If not found, auto-detect from archive entries
  //   3. Fall back to derivedPrefix for error messages
  let resolvedPrefix = preferredPrefix;
  let submissionEntry = findZipEntry(zip, `${resolvedPrefix}_SUBMISSION.TSV`);
  let infoTableEntry  = findZipEntry(zip, `${resolvedPrefix}_INFOTABLE.TSV`);

  if ((!submissionEntry || !infoTableEntry) && resolvedPrefix !== derivedPrefix) {
    // Try the year+q derived prefix if override didn't match
    submissionEntry = findZipEntry(zip, `${derivedPrefix}_SUBMISSION.TSV`);
    infoTableEntry  = findZipEntry(zip, `${derivedPrefix}_INFOTABLE.TSV`);
    if (submissionEntry || infoTableEntry) resolvedPrefix = derivedPrefix;
  }

  if (!submissionEntry || !infoTableEntry) {
    // Last resort: auto-detect prefix from archive entries
    const autoPrefix = detectEntryPrefix(zip);
    if (autoPrefix) {
      submissionEntry = findZipEntry(zip, `${autoPrefix}_SUBMISSION.TSV`);
      infoTableEntry  = findZipEntry(zip, `${autoPrefix}_INFOTABLE.TSV`);
      if (submissionEntry && infoTableEntry) resolvedPrefix = autoPrefix;
    }
  }

  if (!submissionEntry || !infoTableEntry) {
    const missing = [
      !submissionEntry ? `${resolvedPrefix}_SUBMISSION.TSV` : null,
      !infoTableEntry ? `${resolvedPrefix}_INFOTABLE.TSV` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return {
      status: "empty_parse_failure",
      holdings: [],
      diagnostics: { ...EMPTY_DIAGNOSTICS, ...baseDiag, durationMs: Date.now() - startMs },
      reason:
        `Required TSV entries not found: [${missing}]. ` +
        `Archive has: [${allEntries.slice(0, 8).join(", ")}${allEntries.length > 8 ? ", …" : ""}]`,
    };
  }

  // Parse SUBMISSION.tsv
  const subText = submissionEntry.getData().toString("utf8");
  const {
    rows: subRows,
    totalRows: totalSubRows,
    missingHeaders: missingSubH,
  } = parseSubmissionTsv(subText);

  // Parse INFOTABLE.tsv
  const infoText = infoTableEntry.getData().toString("utf8");
  const {
    rows: infoRows,
    totalRows: totalInfoRows,
    rejectedRows,
    missingHeaders: missingInfoH,
  } = parseInfoTableTsv(infoText);

  // Missing required headers → can't parse
  if (missingSubH.length > 0 || missingInfoH.length > 0) {
    return {
      status: "empty_parse_failure",
      holdings: [],
      diagnostics: {
        ...EMPTY_DIAGNOSTICS,
        ...baseDiag,
        submissionRows: totalSubRows,
        informationTableRows: totalInfoRows,
        durationMs: Date.now() - startMs,
      },
      reason:
        `Required headers missing — SUBMISSION: [${missingSubH.join(", ")}], ` +
        `INFOTABLE: [${missingInfoH.join(", ")}]`,
    };
  }

  // Zero 13F-HR rows in SUBMISSION
  if (subRows.length === 0) {
    return {
      status: "empty_parse_failure",
      holdings: [],
      diagnostics: {
        ...EMPTY_DIAGNOSTICS,
        ...baseDiag,
        submissionRows: totalSubRows,
        informationTableRows: totalInfoRows,
        rejectedRows,
        durationMs: Date.now() - startMs,
      },
      reason: `SUBMISSION.tsv has ${totalSubRows} rows but 0 parsed as 13F-HR/A form type`,
    };
  }

  // Build accession → submission map for join
  const subMap = new Map<string, SubmissionRow>();
  for (const s of subRows) subMap.set(s.accessionNumber, s);

  // Join INFOTABLE to SUBMISSION
  const holdings: ParsedBulkHolding[] = [];
  let joinedHoldingRows = 0;
  let putCallExcludedRows = 0;
  let prnExcludedRows = 0;
  let eligibleCommonStockRows = 0;

  for (const row of infoRows) {
    const sub = subMap.get(row.accessionNumber);
    if (!sub) continue; // not a 13F-HR row, or accession format mismatch

    joinedHoldingRows++;

    // Track diagnostic categories (rows are always included)
    if (row.putCall !== null) putCallExcludedRows++;
    else if (row.sharesPrnType === "PRN") prnExcludedRows++;
    else eligibleCommonStockRows++;

    holdings.push({
      accessionNumber: row.accessionNumber,
      filerCik: sub.cik,
      filerName: sub.name,
      filingType: sub.formType,
      filingDate: sub.filingDate,
      periodOfReport: sub.periodOfReport,
      isAmendment: sub.isAmendment,
      issuerName: row.issuerName,
      classTitle: row.classTitle,
      cusip: row.cusip,
      figi: row.figi,
      reportedValue: row.reportedValue,
      reportedShares: row.reportedShares,
      sharesPrnType: row.sharesPrnType,
      putCall: row.putCall,
      investmentDiscretion: row.investmentDiscretion,
      otherManager: row.otherManager,
      votingSole: row.votingSole,
      votingShared: row.votingShared,
      votingNone: row.votingNone,
    });
  }

  const diagnostics: BulkParseDiagnostics = {
    archiveBytes: buffer.length,
    archiveEntries: allEntries,
    submissionRows: totalSubRows,
    informationTableRows: totalInfoRows,
    joinedHoldingRows,
    rejectedRows,
    eligibleCommonStockRows,
    putCallExcludedRows,
    prnExcludedRows,
    durationMs: Date.now() - startMs,
  };

  // Zero join with non-trivial INFOTABLE → accession-number format mismatch
  if (joinedHoldingRows === 0 && totalInfoRows > 0) {
    return {
      status: "empty_parse_failure",
      holdings: [],
      diagnostics,
      reason:
        `Join rate 0%: ${totalInfoRows} INFOTABLE rows but none matched SUBMISSION accessions. ` +
        `Check accession-number format consistency.`,
    };
  }

  // Implausibly low join rate with large dataset → likely format mismatch
  const joinRate = totalInfoRows > 0 ? joinedHoldingRows / totalInfoRows : 1;
  if (totalInfoRows > 100 && joinRate < MIN_JOIN_RATE_WARN) {
    return {
      status: "empty_parse_failure",
      holdings,
      diagnostics,
      reason: `Implausibly low join rate (${(joinRate * 100).toFixed(1)}%) — accession-number format mismatch suspected`,
    };
  }

  const status: BulkQuarterStatus =
    rejectedRows > 0 ? "partial_success" : "success";

  return { status, holdings, diagnostics };
}

// ---------------------------------------------------------------------------
// Async entry point — downloads and parses (legacy year+quarter interface)
// ---------------------------------------------------------------------------

/**
 * Download and parse the SEC Form 13F bulk dataset ZIP for a quarter.
 * Returns EMPTY_NOT_PUBLISHED on HTTP 404 (SEC has not yet published the dataset).
 *
 * NOTE: Uses the legacy YYYYqN URL construction, which only works reliably for
 * datasets through 2023Q4. For post-2023 datasets, use parseBulkFromDescriptor()
 * with a catalog-resolved DatasetDescriptor.
 */
export async function parseBulkQuarter(
  year: number,
  q: 1 | 2 | 3 | 4,
  signal?: AbortSignal,
): Promise<BulkParseResult> {
  const startMs = Date.now();

  let buffer: Buffer;
  try {
    buffer = await secFetchBuffer(bulkDatasetUrl(year, q), signal);
  } catch (err: any) {
    const is404 = err instanceof SecHttpError && err.status === 404;
    return {
      status: is404 ? "empty_not_published" : "failed",
      holdings: [],
      diagnostics: { ...EMPTY_DIAGNOSTICS, durationMs: Date.now() - startMs },
      reason: is404
        ? `Quarter ${year}Q${q} bulk dataset not yet published (HTTP 404)`
        : `Download failed: ${err.name ?? "NETWORK_ERROR"}`,
    };
  }

  return parseBulkQuarterFromBuffer(buffer, year, q, startMs);
}

/**
 * Download and parse a SEC Form 13F bulk dataset ZIP from a catalog-resolved
 * DatasetDescriptor.
 *
 * The descriptor's downloadUrl is used verbatim — no URL reconstruction.
 * The descriptor's year+q identify the primary holdings period and guide the
 * ZIP entry prefix lookup. Auto-detection fallback is used when the expected
 * entry prefix is not found.
 *
 * Returns EMPTY_NOT_PUBLISHED on HTTP 404.
 */
export async function parseBulkFromDescriptor(
  descriptor: DatasetDescriptor,
  signal?: AbortSignal,
): Promise<BulkParseResult> {
  const startMs = Date.now();
  const label = descriptor.fileName;

  let buffer: Buffer;
  try {
    buffer = await secFetchBuffer(descriptor.downloadUrl, signal);
  } catch (err: any) {
    const is404 = err instanceof SecHttpError && err.status === 404;
    return {
      status: is404 ? "empty_not_published" : "failed",
      holdings: [],
      diagnostics: { ...EMPTY_DIAGNOSTICS, durationMs: Date.now() - startMs },
      reason: is404
        ? `Dataset ${label} not available (HTTP 404) — URL may be stale; refresh catalog`
        : `Download failed: ${err.name ?? "NETWORK_ERROR"}`,
    };
  }

  // Pass the holdings year+q so the expected entry prefix (e.g. "2026Q1") is
  // tried first. Auto-detect fallback handles cases where the SEC uses a
  // different internal naming convention inside post-2023 ZIPs.
  return parseBulkQuarterFromBuffer(buffer, descriptor.year, descriptor.q, startMs);
}

// ---------------------------------------------------------------------------
// Quarter availability probe
// ---------------------------------------------------------------------------

/**
 * Probe whether a quarter's bulk dataset is available, using a HEAD request.
 * Returns { available: true } for 2xx, { available: false } for 404 or errors.
 *
 * @param userAgent SEC_USER_AGENT string (passed explicitly — no config import needed)
 *
 * NOTE: Uses the legacy YYYYqN URL construction. For post-2023 datasets,
 * use probeDescriptorAvailability() with a catalog-resolved DatasetDescriptor.
 */
export async function probeQuarterAvailability(
  year: number,
  q: 1 | 2 | 3 | 4,
  userAgent: string,
): Promise<{ available: boolean; statusCode: number | null }> {
  try {
    const res = await fetch(bulkDatasetUrl(year, q), {
      method: "HEAD",
      headers: { "User-Agent": userAgent, Accept: "*/*" },
    });
    return { available: res.ok, statusCode: res.status };
  } catch {
    return { available: false, statusCode: null };
  }
}

/**
 * Probe whether a catalog-resolved dataset is available, using a HEAD request
 * on the descriptor's exact download URL.
 *
 * @param descriptor  DatasetDescriptor from the official catalog
 * @param userAgent   SEC_USER_AGENT string
 */
export async function probeDescriptorAvailability(
  descriptor: DatasetDescriptor,
  userAgent: string,
): Promise<{ available: boolean; statusCode: number | null }> {
  try {
    const res = await fetch(descriptor.downloadUrl, {
      method: "HEAD",
      headers: { "User-Agent": userAgent, Accept: "*/*" },
    });
    return { available: res.ok, statusCode: res.status };
  } catch {
    return { available: false, statusCode: null };
  }
}

// ---------------------------------------------------------------------------
// Available-quarter selection (injectable probe for testing)
// ---------------------------------------------------------------------------

export interface AvailableQuarter {
  year: number;
  q: 1 | 2 | 3 | 4;
  label: string;    // "2026Q1"
  periodEnd: string; // "2026-03-31"
}

export interface SkippedQuarter {
  label: string;
  reason: string;
}

const PERIOD_ENDS: Record<1 | 2 | 3 | 4, (year: number) => string> = {
  1: (y) => `${y}-03-31`,
  2: (y) => `${y}-06-30`,
  3: (y) => `${y}-09-30`,
  4: (y) => `${y}-12-31`,
};

/**
 * Find the N most-recent quarters whose SEC bulk datasets are confirmed available.
 * Probes quarters going backward from `today` and skips any that are not published.
 *
 * @param n          Number of available quarters to find
 * @param today      Reference date
 * @param probe      Availability probe function (injectable for testing)
 * @param maxSearch  Maximum quarters to search backward before stopping
 */
export async function selectAvailableQuarters(
  n: number,
  today: Date,
  probe: (
    year: number,
    q: 1 | 2 | 3 | 4,
  ) => Promise<{ available: boolean }>,
  maxSearch = 12,
): Promise<{ available: AvailableQuarter[]; skipped: SkippedQuarter[] }> {
  const available: AvailableQuarter[] = [];
  const skipped: SkippedQuarter[] = [];

  const currentMonth = today.getMonth() + 1;
  let year = today.getFullYear();
  let q = Math.ceil(currentMonth / 3) as 1 | 2 | 3 | 4;

  for (let i = 0; i < maxSearch && available.length < n; i++) {
    const label = `${year}Q${q}`;
    try {
      const { available: isAvail } = await probe(year, q);
      if (isAvail) {
        available.push({ year, q, label, periodEnd: PERIOD_ENDS[q](year) });
      } else {
        skipped.push({ label, reason: "dataset not yet published" });
      }
    } catch {
      skipped.push({ label, reason: "probe failed" });
    }

    // Decrement quarter
    if (q === 1) { q = 4 as const; year--; }
    else { q = (q - 1) as 1 | 2 | 3 | 4; }
  }

  return { available, skipped };
}
