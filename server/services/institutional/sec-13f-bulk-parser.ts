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
import { Readable, Transform } from "node:stream";
import { createInflateRaw } from "node:zlib";
import { createInterface } from "node:readline";
import { secFetchBuffer, secFetchBufferDetailed, SecHttpError } from "./sec-client";
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

export type BulkSourceFailureCode =
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_REJECTED"
  | "RATE_LIMITED"
  | "SOURCE_FORMAT_UNEXPECTED"
  | "SOURCE_INTEGRITY_FAILURE"
  | "PARSE_FAILED"
  | "CANCELLED"
  | "NOT_YET_PUBLISHED";

/** Resolution tier used to locate a required archive entry. */
export type ArchiveResolutionMode =
  | "bare_exact"       // Root-level bare basename: SUBMISSION.tsv
  | "legacy_prefixed"  // Quarter-prefixed legacy: 2023Q4_SUBMISSION.tsv
  | "nested_basename"; // Nested under a directory: dataset/SUBMISSION.tsv

/** Result of resolveRequiredArchiveEntry(). */
export type ResolveArchiveEntryResult =
  | { found: true;  entry: AdmZip.IZipEntry; mode: ArchiveResolutionMode }
  | { found: false; error: "REQUIRED_ARCHIVE_ENTRY_MISSING" | "AMBIGUOUS_ARCHIVE_ENTRY" };

export interface BulkParseDiagnostics {
  requestedUrl: string | null;
  finalUrl: string | null;
  httpStatus: number | null;
  contentType: string | null;
  contentLength: number | null;
  archiveBytes: number;
  /** First ≤8 entry names (safe to log) */
  archiveEntries: string[];
  /** Original entry name as found in the archive (null if not resolved) */
  resolvedSubmissionEntry: string | null;
  /** Original entry name as found in the archive (null if not resolved) */
  resolvedCoverPageEntry: string | null;
  /** Original entry name as found in the archive (null if not resolved) */
  resolvedInfoTableEntry: string | null;
  /** How the entries were located */
  resolutionMode: ArchiveResolutionMode | null;
  /** Total rows in SUBMISSION.tsv (including non-13F) */
  submissionRows: number;
  /** 13F-HR/A rows actually parsed from SUBMISSION.tsv */
  parsedSubmissionRows: number;
  /** Total raw rows in COVERPAGE.tsv */
  coverPageRows: number;
  /** Rows successfully parsed from COVERPAGE.tsv */
  parsedCoverPageRows: number;
  /** SUBMISSION rows matched to a COVERPAGE row */
  coverPageJoinCount: number;
  /** SUBMISSION rows with no matching COVERPAGE row */
  coverPageUnmatchedSubmissionCount: number;
  /** COVERPAGE rows that share an accession number (duplicate or conflicting) */
  duplicateCoverPageAccessionCount: number;
  /** Total rows in INFOTABLE.tsv */
  informationTableRows: number;
  /** Rows parsed (not rejected) from INFOTABLE.tsv */
  parsedInformationRows: number;
  joinedHoldingRows: number;
  /** INFOTABLE rows skipped due to unresolvable manager identity */
  missingManagerIdentityCount: number;
  /** Accessions where CIK was present in both tables but conflicted */
  managerCikConflictCount: number;
  /** Accessions where CIK could not be found in any source */
  missingManagerCikCount: number;
  rejectedRows: number;
  eligibleCommonStockRows: number;
  putCallExcludedRows: number;
  prnExcludedRows: number;
  durationMs: number;
  /** Canonical field → actual header found in SUBMISSION.tsv (null = not present) */
  submissionHeaderMapping: Record<string, string | null>;
  /** Canonical field → actual header found in COVERPAGE.tsv (null = not present) */
  coverPageHeaderMapping: Record<string, string | null>;
  /** Canonical field → actual header found in INFOTABLE.tsv (null = not present) */
  infoTableHeaderMapping: Record<string, string | null>;
  /** Raw SUBMISSIONTYPE value → row count (≤30 distinct values) */
  submissionTypeCounts: Record<string, number>;
  /** Normalized SUBMISSIONTYPE → row count */
  normalizedSubmissionTypeCounts: Record<string, number>;
  // ── Submission type classification (pre-field-validation) ────────────────
  /** Rows whose SUBMISSIONTYPE normalized to 13F-HR or 13F-HR/A (BEFORE field validation) */
  recognizedHoldingsFormRows: number;
  /** Rows whose SUBMISSIONTYPE normalized to 13F-HR specifically */
  recognized13fHrRows: number;
  /** Rows whose SUBMISSIONTYPE normalized to 13F-HR/A specifically */
  recognized13fHrAmendmentRows: number;
  /** Rows excluded as notice-only (normalized 13F-NT / 13F-NT/A) */
  excludedNoticeRows: number;
  /** Rows excluded because SUBMISSIONTYPE could not be normalized (UNKNOWN or blank) */
  excludedUnknownTypeRows: number;
  // ── Field-level rejection counters (holdings-bearing rows only) ───────────
  /** Holdings-bearing rows rejected due to empty accession field */
  rejectedMissingAccession: number;
  /** Holdings-bearing rows rejected due to non-standard accession format (tracked; not gated) */
  rejectedInvalidAccession: number;
  /** Holdings-bearing rows rejected due to empty CIK field */
  rejectedMissingCik: number;
  /** Holdings-bearing rows rejected due to non-numeric CIK value */
  rejectedInvalidCik: number;
  /** Holdings-bearing rows rejected due to empty period-of-report field */
  rejectedMissingPeriodOfReport: number;
  /** Holdings-bearing rows rejected due to unrecognized period-of-report date format */
  rejectedInvalidPeriodOfReport: number;
  /** Holdings-bearing rows rejected due to unrecognized filing-date format (non-empty but unparseable) */
  rejectedInvalidFilingDate: number;
  /** Holdings-bearing rows rejected for any other validation reason */
  rejectedOtherSubmissionValidation: number;
  // ── Post-validation counts ────────────────────────────────────────────────
  /** Rows retained for holdings ingestion (normalized 13F-HR + 13F-HR/A, all fields valid) */
  includedSubmissionCount: number;
  /** Deprecated alias for includedSubmissionCount (kept for log compat). Same value. */
  excludedNoticeCount: number;
  /** Deprecated alias for excludedUnknownTypeRows (kept for log compat). Same value. */
  excludedUnknownSubmissionTypeCount: number;
  /** Included rows that are amendments (normalized 13F-HR/A) */
  amendmentSubmissionCount: number;
  /** Accessions where SUBMISSION and COVERPAGE disagreed on amendment status */
  amendmentFlagConflictCount: number;
  /**
   * Syntactic date-format distribution of PERIODOFREPORT values in holdings-bearing rows.
   * Populated regardless of whether normalizeDateField() succeeds, so a full-UNKNOWN
   * distribution means the date format is not yet supported.
   */
  detectedPeriodFormats: Record<DateFormatLabel, number>;
  /**
   * Bounded distribution of normalized PERIODOFREPORT values from successfully parsed rows.
   * Keys are ISO YYYY-MM-DD dates (sorted by row count, most common first); "other" rolls
   * up any periods beyond the top-10. Empty object when parsedRows = 0.
   */
  normalizedPeriodDistribution: Record<string, number>;
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
  reportedValue: number | null;    // USD as filed — post-2023 SEC bulk VALUE is in dollars (not thousands)
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
  failureCode?: BulkSourceFailureCode;
}

/**
 * The bounded counterpart of BulkParseResult.  Metadata tables are intentionally
 * read eagerly (they are roughly one row per filing); INFOTABLE is never
 * materialised as text, row objects, or a quarter-sized holdings array.
 */
export interface BulkStreamResult {
  status: BulkQuarterStatus;
  diagnostics: BulkParseDiagnostics;
  reason?: string;
  failureCode?: BulkSourceFailureCode;
}

export interface BulkHoldingStreamOptions {
  /** Hard maximum holdings per emitted batch. Defaults to 2,000. */
  batchSize?: number;
  /** One cancellation signal for the complete download/parse/persist pipeline. */
  signal?: AbortSignal;
  /**
   * Called serially. The caller must finish persisting/inspecting a batch before
   * the inflater is allowed to produce the next one.
   */
  onBatch: (
    holdings: ParsedBulkHolding[],
    context: { accessionNumber: string; accessionComplete: boolean },
  ) => Promise<void> | void;
}

/** A validated catalog archive, reusable for a no-write validation pass and a
 * serial persistence pass without another network request or decompression. */
export interface PreparedBulkArchive {
  buffer: Buffer;
  transportDiagnostics: Pick<BulkParseDiagnostics, "requestedUrl" | "finalUrl" | "httpStatus" | "contentType" | "contentLength">;
}

const ZIP_CONTENT_TYPES = new Set([
  "application/zip",
  "application/octet-stream",
  "application/x-zip-compressed",
  "binary/octet-stream",
]);

export function classifySecArchiveFailure(error: unknown): BulkSourceFailureCode {
  if (isCancellationError(error)) return "CANCELLED";
  if (error instanceof SecHttpError) {
    if (error.status === 403) return "SOURCE_REJECTED";
    if (error.status === 429) return "RATE_LIMITED";
    if (error.redirected || (error.status >= 300 && error.status < 400)) return "SOURCE_FORMAT_UNEXPECTED";
    return "SOURCE_UNAVAILABLE";
  }
  return "SOURCE_UNAVAILABLE";
}

function cancellationError(): Error {
  const error = new Error("CANCELLED");
  error.name = "AbortError";
  return error;
}

export function isCancellationError(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "AbortError" || error.message === "CANCELLED" || error.message === "Aborted");
}

function integrityError(code: string): Error {
  const error = new Error(code);
  error.name = "ArchiveIntegrityError";
  return error;
}

function isIntegrityError(error: unknown): boolean {
  return error instanceof Error && error.name === "ArchiveIntegrityError";
}

export function validateSecArchiveResponse(
  contentType: string | null,
  buffer: Buffer,
): BulkSourceFailureCode | null {
  const normalized = contentType?.split(";", 1)[0].trim().toLowerCase() ?? null;
  if (buffer.length === 0) return "SOURCE_FORMAT_UNEXPECTED";
  if (normalized && !ZIP_CONTENT_TYPES.has(normalized)) return "SOURCE_FORMAT_UNEXPECTED";
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return "SOURCE_FORMAT_UNEXPECTED";
  return null;
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
// Header alias resolution
// ---------------------------------------------------------------------------
//
// SEC bulk TSV schema has changed between release generations:
//   Legacy (pre-2024 ZIPs):  ACCESSION-NUMBER, NAME, CONFORMED-PERIOD-OF-REPORT, FILING-DATE
//   Current (post-2023 bare): ACCESSION_NUMBER, FILINGMANAGER_NAME, PERIODOFREPORT, FILING_DATE
//
// normalizeHeaderKey() removes hyphens and underscores so all variants of a
// field name compare equal. buildHeaderLookup() pre-computes this mapping once
// per file. getField() uses the lookup for O(1) per-row field access.

/**
 * Normalize a header token for alias comparison.
 * Strips UTF-8 BOM, trims whitespace, uppercases, then removes all hyphens and
 * underscores so that "ACCESSION-NUMBER", "ACCESSION_NUMBER", and
 * "ACCESSIONNUMBER" all compare equal.
 */
export function normalizeHeaderKey(s: string): string {
  return s
    .replace(/^\uFEFF/, "") // BOM guard (extra safety — parseTsv already stripBom's the file)
    .trim()
    .toUpperCase()
    .replace(/[-_]/g, "");  // hyphens and underscores are equivalent separators
}

/**
 * Build a normalized-key → raw-header lookup from a parseTsv() header array.
 * The "raw header" is the exact key used in row objects (uppercased but otherwise
 * verbatim). Only the first occurrence of each normalized key is kept.
 */
export function buildHeaderLookup(headers: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of headers) {
    const norm = normalizeHeaderKey(h);
    if (!map.has(norm)) map.set(norm, h);
  }
  return map;
}

/**
 * Return the row value for the first alias that resolves in the lookup, or ""
 * if none. Aliases are normalized before lookup so hyphen/underscore variants
 * are treated equivalently.
 */
function getField(
  row: Record<string, string>,
  lookup: Map<string, string>,
  aliases: readonly string[],
): string {
  for (const alias of aliases) {
    const rawKey = lookup.get(normalizeHeaderKey(alias));
    if (rawKey !== undefined) {
      const val = row[rawKey];
      if (val !== undefined) return val;
    }
  }
  return "";
}

/** Return true if any alias resolves to a header present in the lookup. */
function hasAnyAlias(lookup: Map<string, string>, aliases: readonly string[]): boolean {
  return aliases.some((a) => lookup.has(normalizeHeaderKey(a)));
}

/** Build a canonical-label → actual-header mapping for diagnostics. */
function buildCanonicalMapping(
  lookup: Map<string, string>,
  groups: ReadonlyArray<{ canonical: string; aliases: readonly string[] }>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const { canonical, aliases } of groups) {
    let found: string | null = null;
    for (const a of aliases) {
      const raw = lookup.get(normalizeHeaderKey(a));
      if (raw !== undefined) { found = raw; break; }
    }
    out[canonical] = found;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Canonical field alias groups
// ---------------------------------------------------------------------------
//
// Each group covers the full family of header names that have appeared across
// SEC bulk TSV release generations. normalizeHeaderKey() removes hyphens and
// underscores, so only aliases that differ *after* normalization need to be
// listed separately. For example, "ACCESSION-NUMBER", "ACCESSION_NUMBER", and
// "ACCESSIONNUMBER" all normalize to "ACCESSIONNUMBER" — listing one covers all.

// SUBMISSION.tsv
const SUB_ACCESSION_ALIASES  = ["ACCESSION-NUMBER", "ACCESSIONNUMBER"] as const;
const SUB_CIK_ALIASES        = ["CIK", "FILER-CIK", "FILERCIK", "CIKNO"] as const;
// Manager name is OPTIONAL in SUBMISSION (current SEC schema stores it in COVERPAGE).
// These aliases remain for legacy archive support.
const SUB_NAME_ALIASES       = [
  "NAME",                  // legacy
  "FILINGMANAGER-NAME",    // → FILINGMANAGERNAME (covers FILINGMANAGER_NAME)
  "FILINGMANAGERNAME",
  "COMPANY-NAME",          // → COMPANYNAME (covers COMPANY_NAME)
  "COMPANYNAME",
] as const;
const SUB_PERIOD_ALIASES     = [
  "CONFORMED-PERIOD-OF-REPORT", // → CONFORMEDPERIODOFREPORT
  "CONFORMEDPERIODOFREPORT",
  "PERIODOFREPORT",              // current: no separator (covers PERIOD-OF-REPORT too)
  "REPORT-DATE",                 // → REPORTDATE (covers REPORT_DATE)
  "REPORTDATE",
] as const;
// Current schema: SUBMISSIONTYPE (not FORM-TYPE / FORM_TYPE)
const SUB_FORMTYPE_ALIASES   = [
  "SUBMISSIONTYPE",  // current (bare, no separator)
  "FORM-TYPE",       // → FORMTYPE (covers FORM_TYPE)
  "FORMTYPE",
] as const;
const SUB_FILINGDATE_ALIASES = [
  "FILING-DATE",               // → FILINGDATE (covers FILING_DATE)
  "FILINGDATE",
  "FILED-AS-OF-DATE",          // → FILEDASOFDATE
  "FILEDASOFDATE",
  "DATE-FILED",                // → DATEFILED
  "DATEFILED",
] as const;

// COVERPAGE.tsv — current schema manager identity table
// Joined to SUBMISSION by ACCESSION_NUMBER.
// Contains FILINGMANAGER_NAME (manager identity), ISAMENDMENT, AMENDMENTNO,
// AMENDMENTTYPE (amendment metadata), and REPORTTYPE.
// NOTE: CIK is NOT present in COVERPAGE; it lives only in SUBMISSION.
const CP_ACCESSION_ALIASES   = ["ACCESSION-NUMBER", "ACCESSIONNUMBER"] as const;
const CP_NAME_ALIASES        = [
  "FILINGMANAGER-NAME",  // → FILINGMANAGERNAME (covers FILINGMANAGER_NAME)
  "FILINGMANAGERNAME",
  "NAME",                // legacy SUBMISSION manager name (supported for compat)
  "COMPANY-NAME",        // → COMPANYNAME (covers COMPANY_NAME)
  "COMPANYNAME",
] as const;
const CP_ISAMENDMENT_ALIASES      = ["ISAMENDMENT", "IS-AMENDMENT"] as const;
const CP_AMENDMENTNO_ALIASES      = ["AMENDMENTNO", "AMENDMENT-NO"] as const;
const CP_AMENDMENTTYPE_ALIASES    = ["AMENDMENTTYPE", "AMENDMENT-TYPE"] as const;
const CP_REPORTTYPE_ALIASES       = ["REPORTTYPE", "REPORT-TYPE"] as const;
const CP_REPORTCALQ_ALIASES       = ["REPORTCALENDARORQUARTER", "REPORT-CALENDAR-OR-QUARTER"] as const;

// INFOTABLE.tsv
const INFO_ACCESSION_ALIASES  = ["ACCESSION-NUMBER", "ACCESSIONNUMBER"] as const;
const INFO_ISSUER_ALIASES     = [
  "NAMEOFISSUER",              // current + legacy (covers NAME-OF-ISSUER, NAME_OF_ISSUER)
  "ISSUER-NAME",               // → ISSUERNAME (covers ISSUER_NAME)
  "ISSUERNAME",
] as const;
const INFO_CLASS_ALIASES      = [
  "TITLEOFCLASS",              // current + legacy (covers TITLE-OF-CLASS, TITLE_OF_CLASS)
  "CLASS-TITLE",               // → CLASSTITLE (covers CLASS_TITLE)
  "CLASSTITLE",
] as const;
const INFO_CUSIP_ALIASES      = ["CUSIP"] as const;
const INFO_VALUE_ALIASES      = ["VALUE"] as const;
const INFO_SHARES_ALIASES     = ["SSHPRNAMT", "SSH-PRN-AMT"] as const;
const INFO_SHARESTYPE_ALIASES = ["SSHPRNAMTTYPE", "SSHPRNTYPE", "SHARES-TYPE", "SHARESTYPE"] as const;
const INFO_PUTCALL_ALIASES    = ["PUTCALL", "PUT-CALL", "PUTCALLINDICATOR"] as const;
const INFO_DISCRETION_ALIASES = ["INVESTMENTDISCRETION", "INVESTMENT-DISCRETION"] as const;
const INFO_OTHERMGR_ALIASES   = ["OTHERMANAGER", "OTHER-MANAGER"] as const;
const INFO_FIGI_ALIASES       = ["FIGI"] as const;
// Current schema: VOTING_AUTH_SOLE/SHARED/NONE (not VOTINGAUTHORITY_*)
// VOTING_AUTH_SOLE → normalized: VOTINGAUTHSOLE
// VOTINGAUTHORITY-SOLE → normalized: VOTINGAUTHORITYSOLE  (different!)
// Both alias families are listed so all schema generations are covered.
const INFO_VSOLE_ALIASES      = [
  "VOTING-AUTH-SOLE",          // → VOTINGAUTHSOLE (covers VOTING_AUTH_SOLE)
  "VOTINGAUTHSOLE",
  "VOTINGAUTHORITY-SOLE",      // → VOTINGAUTHORITYSOLE (covers VOTINGAUTHORITY_SOLE)
  "VOTINGAUTHORITYSOLE",
  "VOTING-AUTHORITY-SOLE",
] as const;
const INFO_VSHARED_ALIASES    = [
  "VOTING-AUTH-SHARED",
  "VOTINGAUTHSHARED",
  "VOTINGAUTHORITY-SHARED",
  "VOTINGAUTHORITYSHARED",
] as const;
const INFO_VNONE_ALIASES      = [
  "VOTING-AUTH-NONE",
  "VOTINGAUTHNONE",
  "VOTINGAUTHORITY-NONE",
  "VOTINGAUTHORITYNONE",
] as const;

// Required and full field declarations for validation and diagnostic mapping
interface CanonicalField { canonical: string; aliases: readonly string[] }

// SUBMISSION required: accession, CIK, period of report.
// manager name is intentionally NOT required here — current SEC schema stores it in
// COVERPAGE.tsv. We fall back to COVERPAGE; see parseBulkQuarterFromBuffer().
const REQUIRED_SUBMISSION_FIELDS: CanonicalField[] = [
  { canonical: "accession",        aliases: SUB_ACCESSION_ALIASES },
  { canonical: "CIK",              aliases: SUB_CIK_ALIASES },
  { canonical: "period of report", aliases: SUB_PERIOD_ALIASES },
];

const ALL_SUBMISSION_FIELDS: CanonicalField[] = [
  ...REQUIRED_SUBMISSION_FIELDS,
  { canonical: "manager name", aliases: SUB_NAME_ALIASES },
  { canonical: "form type",    aliases: SUB_FORMTYPE_ALIASES },
  { canonical: "filing date",  aliases: SUB_FILINGDATE_ALIASES },
];

// COVERPAGE required: accession, manager name.
// CIK is NOT present in current COVERPAGE schema; it comes from SUBMISSION only.
const REQUIRED_COVERPAGE_FIELDS: CanonicalField[] = [
  { canonical: "accession",    aliases: CP_ACCESSION_ALIASES },
  { canonical: "manager name", aliases: CP_NAME_ALIASES },
];

const ALL_COVERPAGE_FIELDS: CanonicalField[] = [
  ...REQUIRED_COVERPAGE_FIELDS,
  { canonical: "is amendment",           aliases: CP_ISAMENDMENT_ALIASES },
  { canonical: "amendment no",           aliases: CP_AMENDMENTNO_ALIASES },
  { canonical: "amendment type",         aliases: CP_AMENDMENTTYPE_ALIASES },
  { canonical: "report type",            aliases: CP_REPORTTYPE_ALIASES },
  { canonical: "report calendar/quarter", aliases: CP_REPORTCALQ_ALIASES },
];

const REQUIRED_INFOTABLE_FIELDS: CanonicalField[] = [
  { canonical: "accession",   aliases: INFO_ACCESSION_ALIASES },
  { canonical: "issuer name", aliases: INFO_ISSUER_ALIASES },
  { canonical: "class title", aliases: INFO_CLASS_ALIASES },
  { canonical: "CUSIP",       aliases: INFO_CUSIP_ALIASES },
];

const ALL_INFOTABLE_FIELDS: CanonicalField[] = [
  ...REQUIRED_INFOTABLE_FIELDS,
  { canonical: "value",                aliases: INFO_VALUE_ALIASES },
  { canonical: "shares/principal",     aliases: INFO_SHARES_ALIASES },
  { canonical: "shares type",          aliases: INFO_SHARESTYPE_ALIASES },
  { canonical: "put/call",             aliases: INFO_PUTCALL_ALIASES },
  { canonical: "investment discretion", aliases: INFO_DISCRETION_ALIASES },
  { canonical: "other manager",        aliases: INFO_OTHERMGR_ALIASES },
  { canonical: "FIGI",                 aliases: INFO_FIGI_ALIASES },
  { canonical: "voting sole",          aliases: INFO_VSOLE_ALIASES },
  { canonical: "voting shared",        aliases: INFO_VSHARED_ALIASES },
  { canonical: "voting none",          aliases: INFO_VNONE_ALIASES },
];

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

/** Strict calendar validation — year 1993–2099, month 1–12, day in range. */
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1993 || year > 2099) return false;
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(year, month, 0).getDate(); // day 0 = last day of prior month
  if (day < 1 || day > daysInMonth) return false;
  return true;
}

/**
 * Detected syntactic format categories for date strings.
 * Used by detectDateFormat() for diagnostic / sampling purposes.
 * normalizeDateField() is always the canonical parser — never use this for conversion.
 */
export type DateFormatLabel =
  | "ISO_DASH"         // YYYY-MM-DD
  | "ISO_COMPACT"      // YYYYMMDD (8 digits)
  | "US_SLASH"         // MM/DD/YYYY
  | "US_DASH"          // MM-DD-YYYY
  | "ISO_SLASH"        // YYYY/MM/DD
  | "SEC_DD_MMM_YYYY"  // DD-MMM-YYYY (SEC EDGAR post-2023 bulk archive PERIODOFREPORT format)
  | "UNKNOWN";         // no supported pattern matched

/**
 * Classify the syntactic format of a raw date string.
 * Diagnostic only — does NOT validate calendar correctness.
 * normalizeDateField() is the canonical normalization path.
 */
export function detectDateFormat(raw: string): DateFormatLabel {
  const s = raw.trim();
  if (!s) return "UNKNOWN";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "ISO_DASH";
  if (/^\d{8}$/.test(s))             return "ISO_COMPACT";
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return "US_SLASH";
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s))   return "US_DASH";
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s))     return "ISO_SLASH";
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) return "SEC_DD_MMM_YYYY";
  return "UNKNOWN";
}

/**
 * Normalize a date string to ISO 8601 (YYYY-MM-DD) with strict calendar validation.
 *
 * Accepted input formats:
 *   YYYY-MM-DD   (ISO 8601 — most common in current SEC TSVs)
 *   YYYYMMDD     (compact EDGAR form — 8 digits)
 *   MM/DD/YYYY   (US slash format — observed in some EDGAR bulk exports)
 *   MM-DD-YYYY   (US hyphen format)
 *   YYYY/MM/DD   (ISO slash variant)
 *
 * Rejects impossible dates, partial dates, and unrecognised formats.
 * Never uses JavaScript Date loose-parsing.
 */
export function normalizeDateField(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // ── YYYY-MM-DD (current SEC schema, most common) ───────────────────────
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const y = parseInt(s.slice(0, 4), 10);
    const m = parseInt(s.slice(5, 7), 10);
    const d = parseInt(s.slice(8, 10), 10);
    return isValidCalendarDate(y, m, d) ? s : null;
  }

  // ── YYYYMMDD (compact, 8 digits) ─────────────────────────────────────
  if (/^\d{8}$/.test(s)) {
    const y = parseInt(s.slice(0, 4), 10);
    const m = parseInt(s.slice(4, 6), 10);
    const d = parseInt(s.slice(6, 8), 10);
    if (!isValidCalendarDate(y, m, d)) return null;
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }

  // ── MM/DD/YYYY (US slash — observed in some EDGAR bulk exports) ───────
  const mdySlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdySlash) {
    const m = parseInt(mdySlash[1], 10);
    const d = parseInt(mdySlash[2], 10);
    const y = parseInt(mdySlash[3], 10);
    if (!isValidCalendarDate(y, m, d)) return null;
    return `${mdySlash[3]}-${mdySlash[1].padStart(2, "0")}-${mdySlash[2].padStart(2, "0")}`;
  }

  // ── MM-DD-YYYY (US hyphen) ────────────────────────────────────────────
  // Guard: distinguish from YYYY-MM-DD by checking first 4 chars < 1000 (unlikely year)
  const mdyDash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdyDash) {
    const m = parseInt(mdyDash[1], 10);
    const d = parseInt(mdyDash[2], 10);
    const y = parseInt(mdyDash[3], 10);
    if (!isValidCalendarDate(y, m, d)) return null;
    return `${mdyDash[3]}-${mdyDash[1].padStart(2, "0")}-${mdyDash[2].padStart(2, "0")}`;
  }

  // ── YYYY/MM/DD (ISO slash variant) ───────────────────────────────────
  const ymdSlash = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (ymdSlash) {
    const y = parseInt(ymdSlash[1], 10);
    const m = parseInt(ymdSlash[2], 10);
    const d = parseInt(ymdSlash[3], 10);
    if (!isValidCalendarDate(y, m, d)) return null;
    return `${ymdSlash[1]}-${ymdSlash[2]}-${ymdSlash[3]}`;
  }

  // ── DD-MMM-YYYY (SEC EDGAR post-2023 bulk archive PERIODOFREPORT format) ─
  // Examples: 31-MAR-2026, 30-SEP-2025, 01-JAN-2024
  // Requires exactly 2-digit day and exactly 3-letter month abbreviation.
  // Case-insensitive month input is accepted; arbitrary month words are rejected.
  // Never uses Date.parse() or new Date(raw) — all parsing is explicit.
  const ddMmmYyyy = s.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (ddMmmYyyy) {
    const SEC_MONTH_MAP: Record<string, number> = {
      JAN: 1, FEB: 2,  MAR: 3,  APR: 4,  MAY: 5,  JUN: 6,
      JUL: 7, AUG: 8,  SEP: 9,  OCT: 10, NOV: 11, DEC: 12,
    };
    const d = parseInt(ddMmmYyyy[1], 10);
    const monthKey = ddMmmYyyy[2].toUpperCase();
    const m = SEC_MONTH_MAP[monthKey];
    const y = parseInt(ddMmmYyyy[3], 10);
    if (m === undefined) return null;            // unrecognised month abbreviation
    if (!isValidCalendarDate(y, m, d)) return null;
    return `${ddMmmYyyy[3]}-${String(m).padStart(2, "0")}-${ddMmmYyyy[1]}`;
  }

  return null;
}

/**
 * Normalize a CIK string to 10-digit zero-padded format.
 * Returns null for missing (blank) or invalid (non-numeric) input.
 * SEC CIKs are always positive integers, 1–10 digits.
 */
function normalizeCik(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;                       // missing
  if (!/^\d+$/.test(s)) return null;         // non-numeric → invalid
  if (s.length > 10) return null;            // exceeds max CIK length
  return s.replace(/^0+/, "").padStart(10, "0") || "0000000000";
}

// ---------------------------------------------------------------------------
// SUBMISSIONTYPE normalization
// ---------------------------------------------------------------------------
//
// SEC bulk TSV SUBMISSIONTYPE values have varied across schema generations and
// may differ from the canonical strings "13F-HR" / "13F-HR/A".
// normalizeSubmissionType() resolves all known variants to a canonical form.
//
// Accepted alias table (all treated case-insensitively after trim):
//
//   "13F-HR"                → "13F-HR"   (current/legacy exact)
//   "13F-HR/A"              → "13F-HR/A" (current/legacy exact)
//   "13F-NT"                → "13F-NT"   (notice-only, excluded)
//   "13F-NT/A"              → "13F-NT/A" (notice-only amendment, excluded)
//   "13F_HR"                → "13F-HR"   (underscore separator)
//   "13F_HR_A" / "13FHRA"   → "13F-HR/A" (underscore/no-sep amendment)
//   "13F_NT"                → "13F-NT"
//   "13F_NT_A" / "13FNTA"   → "13F-NT/A"
//   "13FHR"                 → "13F-HR"   (no separator at all)
//   "13FNT"                 → "13F-NT"
//   "13F-HR /A" / "13F-HR- A"  → "13F-HR/A" (spacing around amendment suffix)
//   anything else           → "UNKNOWN"
//   null / blank            → null

export type NormalizedSubmissionType =
  | "13F-HR"
  | "13F-HR/A"
  | "13F-NT"
  | "13F-NT/A"
  | "UNKNOWN";

export function normalizeSubmissionType(
  raw: string | null | undefined,
): NormalizedSubmissionType | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s) return null;

  const u = s.toUpperCase();

  // ── 1. Exact matches (most common fast path) ───────────────────────────
  if (u === "13F-HR")   return "13F-HR";
  if (u === "13F-HR/A") return "13F-HR/A";
  if (u === "13F-NT")   return "13F-NT";
  if (u === "13F-NT/A") return "13F-NT/A";

  // ── 2. Strip all separators (hyphens, underscores, spaces, slashes) ────
  //    This handles: 13F_HR, 13FHR, 13F HR, 13F_HR_A, 13FHRA, 13FNTA …
  const noSep = u.replace(/[-_\s/]+/g, "");
  if (noSep === "13FHR")             return "13F-HR";
  if (noSep === "13FHRA")            return "13F-HR/A"; // 13F_HR_A / 13F-HRA / 13FHRA
  if (noSep === "13FHRIA")           return "13F-HR/A"; // 13F-HR/A with extra i (rare)
  if (noSep === "13FNT")             return "13F-NT";
  if (noSep === "13FNTA")            return "13F-NT/A";
  if (noSep === "13FNTIA")           return "13F-NT/A";

  // ── 3. Normalize internal separators then match amendment suffix ────────
  //    Handles: "13F-HR /A", "13F-HR- A", "13F-HR / A"
  const normalized = u
    .replace(/[-_\s]+/g, "-")        // collapse runs to single hyphen
    .replace(/-\s*\/\s*A$/, "/A")    // "-/A" → "/A"
    .replace(/-A$/, "/A");           // trailing "-A" → "/A" (e.g. "13F-HR-A")
  if (normalized === "13F-HR/A") return "13F-HR/A";
  if (normalized === "13F-NT/A") return "13F-NT/A";
  if (normalized === "13F-HR")   return "13F-HR";
  if (normalized === "13F-NT")   return "13F-NT";

  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// SUBMISSION.tsv parser
// ---------------------------------------------------------------------------

export interface SubmissionRow {
  accessionNumber: string; // dashed format
  cik: string;             // 10-digit padded
  /** Manager name if present in SUBMISSION (legacy). Empty string for current schema. */
  name: string;
  formType: string;        // "13F-HR" | "13F-HR/A"
  filingDate: string;      // YYYY-MM-DD
  periodOfReport: string;  // YYYY-MM-DD
  isAmendment: boolean;
}

/**
 * Parse SUBMISSION.tsv.
 *
 * Retained rows: normalized 13F-HR and 13F-HR/A (holdings-bearing filings).
 * Excluded rows:
 *   - 13F-NT / 13F-NT/A  → notice-only, no information table
 *   - UNKNOWN             → unrecognized SUBMISSIONTYPE value
 *   - blank               → no SUBMISSIONTYPE column or empty value
 *
 * Rows with an UNKNOWN SUBMISSIONTYPE are returned separately in `unknownTypeRows`
 * so the caller can attempt a COVERPAGE.REPORTTYPE fallback before discarding them.
 *
 * Normalization (via normalizeSubmissionType):
 *   - Case, whitespace, hyphens, underscores, slashes are all normalised.
 *   - "13F_HR", "13FHR", "13F-HR- A" all map to a canonical form.
 *   - See normalizeSubmissionType() for the full alias table.
 *
 * CRITICAL: Do NOT default UNKNOWN types to "13F-HR". Only explicitly recognised
 * canonical values are included.
 *
 * Supports all SEC bulk TSV schema generations via canonical alias resolution:
 *   Legacy (pre-2024):   ACCESSION-NUMBER, NAME, CONFORMED-PERIOD-OF-REPORT, FILING-DATE
 *   Current (post-2023): ACCESSION_NUMBER, SUBMISSIONTYPE, PERIODOFREPORT, FILING_DATE
 *
 * Required canonical fields: accession, CIK, period of report.
 * Manager name is OPTIONAL — current SEC schema stores it in COVERPAGE.tsv.
 * missingHeaders reports canonical labels (not raw column names).
 */
export function parseSubmissionTsv(text: string): {
  rows: SubmissionRow[];
  /** Rows with UNKNOWN SUBMISSIONTYPE kept for COVERPAGE.REPORTTYPE fallback */
  unknownTypeRows: SubmissionRow[];
  totalRows: number;
  parsedRows: number;
  missingHeaders: string[];
  canonicalMapping: Record<string, string | null>;
  /** Raw SUBMISSIONTYPE value → count (≤30 distinct values; extra bucketed as "[OTHER]") */
  submissionTypeCounts: Record<string, number>;
  /** Normalized type string → count */
  normalizedSubmissionTypeCounts: Record<string, number>;
  // type classification
  recognizedHoldingsFormRows: number;
  recognized13fHrRows: number;
  recognized13fHrAmendmentRows: number;
  excludedNoticeRows: number;
  excludedUnknownTypeRows: number;
  // field-level rejection counters
  rejectedMissingAccession: number;
  rejectedInvalidAccession: number;
  rejectedMissingCik: number;
  rejectedInvalidCik: number;
  rejectedMissingPeriodOfReport: number;
  rejectedInvalidPeriodOfReport: number;
  rejectedInvalidFilingDate: number;
  rejectedOtherSubmissionValidation: number;
  // post-validation (legacy compat aliases)
  includedCount: number;
  excludedNoticeCount: number;
  excludedUnknownCount: number;
  amendmentCount: number;
  /** Syntactic format distribution of PERIODOFREPORT in holdings-bearing rows */
  detectedPeriodFormats: Record<DateFormatLabel, number>;
  /** Up to 10 distinct raw PERIODOFREPORT values from holdings-bearing rows (for diagnostics) */
  rawPeriodSamples: string[];
  /** Bounded distribution of normalized period-of-report values from successfully parsed rows */
  normalizedPeriodDistribution: Record<string, number>;
} {
  const { headers, rows: rawRows } = parseTsv(text);
  const lookup = buildHeaderLookup(headers);

  // Validate required fields (manager name is deliberately excluded).
  const missingHeaders = REQUIRED_SUBMISSION_FIELDS
    .filter((f) => !hasAnyAlias(lookup, f.aliases))
    .map((f) => f.canonical);

  // Diagnostic mapping: canonical label → actual header found (null if absent)
  const canonicalMapping = buildCanonicalMapping(lookup, ALL_SUBMISSION_FIELDS);

  const MAX_DISTINCT_TYPES = 30;
  const rawTypeCounts = new Map<string, number>();
  const normTypeCounts = new Map<string, number>();

  const rows: SubmissionRow[] = [];
  const unknownTypeRows: SubmissionRow[] = [];
  let totalRows = 0;

  // type classification counters
  let recognizedHoldingsFormRows = 0;
  let recognized13fHrRows        = 0;
  let recognized13fHrAmendmentRows = 0;
  let excludedNoticeRows         = 0;
  let excludedUnknownTypeRows    = 0;

  // field-level rejection counters (holdings-bearing rows only)
  let rejectedMissingAccession         = 0;
  let rejectedInvalidAccession         = 0;  // informational — non-standard format (not gated)
  let rejectedMissingCik               = 0;
  let rejectedInvalidCik               = 0;
  let rejectedMissingPeriodOfReport    = 0;
  let rejectedInvalidPeriodOfReport    = 0;
  let rejectedInvalidFilingDate        = 0;
  let rejectedOtherSubmissionValidation = 0;

  let amendmentCount = 0;

  // Period-of-report diagnostic collection (holdings-bearing rows only)
  const periodFormatCounts: Record<DateFormatLabel, number> = {
    ISO_DASH: 0, ISO_COMPACT: 0, US_SLASH: 0, US_DASH: 0, ISO_SLASH: 0, SEC_DD_MMM_YYYY: 0, UNKNOWN: 0,
  };
  const rawPeriodSampleSet = new Set<string>(); // distinct values, capped at 10
  const MAX_PERIOD_SAMPLES = 10;

  for (const raw of rawRows) {
    totalRows++;

    const formTypeRaw  = getField(raw, lookup, SUB_FORMTYPE_ALIASES);
    const normalizedFT = normalizeSubmissionType(formTypeRaw);

    // Track raw counts (bounded)
    const rawKey = formTypeRaw.trim() || "(blank)";
    if (rawTypeCounts.size < MAX_DISTINCT_TYPES || rawTypeCounts.has(rawKey)) {
      rawTypeCounts.set(rawKey, (rawTypeCounts.get(rawKey) ?? 0) + 1);
    } else {
      rawTypeCounts.set("[OTHER]", (rawTypeCounts.get("[OTHER]") ?? 0) + 1);
    }

    // Track normalized counts
    const normKey = normalizedFT ?? "(blank)";
    normTypeCounts.set(normKey, (normTypeCounts.get(normKey) ?? 0) + 1);

    // Notice-only: exclude, count, skip
    if (normalizedFT === "13F-NT" || normalizedFT === "13F-NT/A") {
      excludedNoticeRows++;
      continue;
    }

    // If SUBMISSIONTYPE column is absent (formTypeRaw blank AND no column), accept the
    // row — the dataset is exclusively 13F forms. Treat as "13F-HR" (non-amendment).
    //
    // If the column IS present but the value is UNKNOWN, defer to COVERPAGE fallback.
    const columnAbsent = !hasAnyAlias(lookup, SUB_FORMTYPE_ALIASES);

    if (normalizedFT === "UNKNOWN") {
      // Column present, value unrecognised — keep for COVERPAGE fallback
      excludedUnknownTypeRows++;
      const accRaw        = getField(raw, lookup, SUB_ACCESSION_ALIASES);
      const cikRaw        = getField(raw, lookup, SUB_CIK_ALIASES);
      const name          = getField(raw, lookup, SUB_NAME_ALIASES).trim();
      const periodRaw     = getField(raw, lookup, SUB_PERIOD_ALIASES);
      const filingDateRaw = getField(raw, lookup, SUB_FILINGDATE_ALIASES);
      const accession     = normalizeAccession(accRaw);
      const cik           = normalizeCik(cikRaw) ?? cikRaw.trim();
      const periodOfReport = normalizeDateField(periodRaw);
      const filingDate    = normalizeDateField(filingDateRaw) ?? periodOfReport ?? "";
      if (accession && cik && periodOfReport) {
        unknownTypeRows.push({
          accessionNumber: accession,
          cik,
          name,
          formType: "UNKNOWN",
          filingDate,
          periodOfReport,
          isAmendment: false,
        });
      }
      continue;
    }

    if (normalizedFT === null && !columnAbsent) {
      // Column present, value is blank → unknown, exclude
      excludedUnknownTypeRows++;
      continue;
    }

    // ── Holdings-bearing form: "13F-HR", "13F-HR/A", or null (column absent → 13F-HR) ──
    const resolvedType: "13F-HR" | "13F-HR/A" = normalizedFT === "13F-HR/A" ? "13F-HR/A" : "13F-HR";
    recognizedHoldingsFormRows++;
    if (resolvedType === "13F-HR/A") recognized13fHrAmendmentRows++;
    else recognized13fHrRows++;

    // ── Per-field validation with granular rejection counters ─────────────
    const accRaw        = getField(raw, lookup, SUB_ACCESSION_ALIASES);
    const cikRaw        = getField(raw, lookup, SUB_CIK_ALIASES);
    const name          = getField(raw, lookup, SUB_NAME_ALIASES).trim();
    const periodRaw     = getField(raw, lookup, SUB_PERIOD_ALIASES);
    const filingDateRaw = getField(raw, lookup, SUB_FILINGDATE_ALIASES);

    // ── Period-of-report format sampling (done before any rejection) ─────
    // Collect the syntactic format and up to MAX_PERIOD_SAMPLES distinct raw values
    // regardless of whether the value is valid — this is purely diagnostic.
    if (periodRaw.trim()) {
      const fmt = detectDateFormat(periodRaw);
      periodFormatCounts[fmt]++;
      if (rawPeriodSampleSet.size < MAX_PERIOD_SAMPLES) {
        rawPeriodSampleSet.add(periodRaw.trim());
      }
    }

    // Accession: missing check first; unknown format passes through
    if (!accRaw.trim()) { rejectedMissingAccession++; continue; }
    const accession = normalizeAccession(accRaw);
    // Track non-standard format (informational — still accepted)
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accession)) rejectedInvalidAccession++;

    // CIK: missing and non-numeric are separate gates
    if (!cikRaw.trim()) { rejectedMissingCik++; continue; }
    const cik = normalizeCik(cikRaw);
    if (cik === null) { rejectedInvalidCik++; continue; }

    // Period of report: required field — reject if missing or unrecognised format
    if (!periodRaw.trim()) { rejectedMissingPeriodOfReport++; continue; }
    const periodOfReport = normalizeDateField(periodRaw);
    if (periodOfReport === null) { rejectedInvalidPeriodOfReport++; continue; }

    // Filing date: optional field; falls back to periodOfReport when absent.
    // Reject only if the field is present (non-empty) but fails all format patterns.
    const filingDateNorm = normalizeDateField(filingDateRaw);
    if (filingDateRaw.trim() && filingDateNorm === null) {
      rejectedInvalidFilingDate++;
      continue;
    }
    const filingDate = filingDateNorm ?? periodOfReport;

    const isAmendment = resolvedType === "13F-HR/A";
    if (isAmendment) amendmentCount++;

    rows.push({
      accessionNumber: accession,
      cik,
      name,
      formType: resolvedType,
      filingDate,
      periodOfReport,
      isAmendment,
    });
  }

  const submissionTypeCounts: Record<string, number> = Object.fromEntries(rawTypeCounts);
  const normalizedSubmissionTypeCounts: Record<string, number> = Object.fromEntries(normTypeCounts);

  // ── Bounded normalized period-of-report distribution ──────────────────────
  // Built from successfully parsed rows only. Top-10 periods by row count;
  // any remainder rolls into "other". Empty when parsedRows = 0.
  const MAX_PERIOD_DIST = 10;
  const periodDistMap = new Map<string, number>();
  for (const row of rows) {
    const p = row.periodOfReport;
    periodDistMap.set(p, (periodDistMap.get(p) ?? 0) + 1);
  }
  const sortedPeriodDist = Array.from(periodDistMap.entries()).sort((a, b) => b[1] - a[1]);
  const normalizedPeriodDistribution: Record<string, number> = {};
  let periodDistOther = 0;
  for (let i = 0; i < sortedPeriodDist.length; i++) {
    if (i < MAX_PERIOD_DIST) {
      normalizedPeriodDistribution[sortedPeriodDist[i][0]] = sortedPeriodDist[i][1];
    } else {
      periodDistOther += sortedPeriodDist[i][1];
    }
  }
  if (periodDistOther > 0) normalizedPeriodDistribution["other"] = periodDistOther;

  return {
    rows,
    unknownTypeRows,
    totalRows,
    parsedRows: rows.length,
    missingHeaders,
    canonicalMapping,
    submissionTypeCounts,
    normalizedSubmissionTypeCounts,
    recognizedHoldingsFormRows,
    recognized13fHrRows,
    recognized13fHrAmendmentRows,
    excludedNoticeRows,
    excludedUnknownTypeRows,
    rejectedMissingAccession,
    rejectedInvalidAccession,
    rejectedMissingCik,
    rejectedInvalidCik,
    rejectedMissingPeriodOfReport,
    rejectedInvalidPeriodOfReport,
    rejectedInvalidFilingDate,
    rejectedOtherSubmissionValidation,
    // legacy aliases for backward compatibility
    includedCount: rows.length,
    excludedNoticeCount: excludedNoticeRows,
    excludedUnknownCount: excludedUnknownTypeRows,
    amendmentCount,
    detectedPeriodFormats: periodFormatCounts,
    rawPeriodSamples: Array.from(rawPeriodSampleSet),
    normalizedPeriodDistribution,
  };
}

// ---------------------------------------------------------------------------
// COVERPAGE.tsv parser
// ---------------------------------------------------------------------------

/** A parsed row from COVERPAGE.tsv, keyed by accession number. */
export interface CoverPageRow {
  accessionNumber: string; // dashed format
  managerName: string;
  /** Amendment flag from ISAMENDMENT column ("Y"/"N"), if present */
  isAmendment: boolean;
  amendmentNo: string | null;
  amendmentType: string | null;
  /** REPORTTYPE field (e.g. "13F-HR", "13F-NT"), if present */
  reportType: string | null;
  reportCalendarOrQuarter: string | null;
}

/**
 * Parse COVERPAGE.tsv. Returns a Map<accessionNumber, CoverPageRow> for O(1) joins.
 *
 * Current SEC schema (post-2023 date-range archives):
 *   ACCESSION_NUMBER, FILINGMANAGER_NAME, ISAMENDMENT, AMENDMENTNO, AMENDMENTTYPE,
 *   REPORTTYPE, REPORTCALENDARORQUARTER, + address/admin fields
 *
 * Required canonical fields: accession, manager name.
 *
 * Duplicate accession handling:
 *   - Identical rows: first occurrence wins, counted in duplicateAccessionCount.
 *   - Conflicting manager name: accession marked AMBIGUOUS; excluded from result map;
 *     counted in conflictingAccessionCount.
 */
export function parseCoverPageTsv(text: string): {
  byAccession: Map<string, CoverPageRow>;
  totalRows: number;
  parsedRows: number;
  duplicateAccessionCount: number;
  conflictingAccessionCount: number;
  missingHeaders: string[];
  canonicalMapping: Record<string, string | null>;
} {
  const { headers, rows: rawRows } = parseTsv(text);
  const lookup = buildHeaderLookup(headers);

  const missingHeaders = REQUIRED_COVERPAGE_FIELDS
    .filter((f) => !hasAnyAlias(lookup, f.aliases))
    .map((f) => f.canonical);

  const canonicalMapping = buildCanonicalMapping(lookup, ALL_COVERPAGE_FIELDS);

  const byAccession = new Map<string, CoverPageRow>();
  // Tracks accessions that have conflicting manager names — excluded from map.
  const ambiguous = new Set<string>();

  let totalRows = 0;
  let parsedRows = 0;
  let duplicateAccessionCount = 0;
  let conflictingAccessionCount = 0;

  for (const raw of rawRows) {
    totalRows++;

    const accRaw    = getField(raw, lookup, CP_ACCESSION_ALIASES);
    const nameRaw   = getField(raw, lookup, CP_NAME_ALIASES).trim();
    if (!accRaw || !nameRaw) continue;

    const accession    = normalizeAccession(accRaw);
    const isAmend      = getField(raw, lookup, CP_ISAMENDMENT_ALIASES).trim().toUpperCase() === "Y";
    const amendNo      = getField(raw, lookup, CP_AMENDMENTNO_ALIASES).trim() || null;
    const amendType    = getField(raw, lookup, CP_AMENDMENTTYPE_ALIASES).trim() || null;
    const reportType   = getField(raw, lookup, CP_REPORTTYPE_ALIASES).trim() || null;
    const reportCalQ   = getField(raw, lookup, CP_REPORTCALQ_ALIASES).trim() || null;

    if (ambiguous.has(accession)) {
      // Already marked ambiguous — skip without re-counting
      duplicateAccessionCount++;
      continue;
    }

    const existing = byAccession.get(accession);
    if (existing) {
      if (existing.managerName === nameRaw) {
        // Benign duplicate — same manager name, skip
        duplicateAccessionCount++;
      } else {
        // Conflicting manager names — mark ambiguous and remove from map
        byAccession.delete(accession);
        ambiguous.add(accession);
        conflictingAccessionCount++;
        duplicateAccessionCount++;
      }
      continue;
    }

    byAccession.set(accession, {
      accessionNumber: accession,
      managerName: nameRaw,
      isAmendment: isAmend,
      amendmentNo: amendNo,
      amendmentType: amendType,
      reportType,
      reportCalendarOrQuarter: reportCalQ,
    });
    parsedRows++;
  }

  return {
    byAccession,
    totalRows,
    parsedRows,
    duplicateAccessionCount,
    conflictingAccessionCount,
    missingHeaders,
    canonicalMapping,
  };
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

/**
 * Parse INFOTABLE.tsv. Returns all holding rows including put/call and PRN.
 *
 * Supports all SEC bulk TSV schema generations via canonical alias resolution.
 * Required canonical fields: accession, issuer name, class title, CUSIP.
 * All other fields are optional and remain null when absent.
 *
 * Memory: processes ~3.5–3.8 M rows per quarter. Uses a single linear pass;
 * no duplicate arrays. The header lookup map is built once; per-row access is O(1).
 */
export function parseInfoTableTsv(text: string): {
  rows: InfoTableRow[];
  totalRows: number;
  parsedRows: number;
  rejectedRows: number;
  missingHeaders: string[];
  canonicalMapping: Record<string, string | null>;
} {
  const { headers, rows: rawRows } = parseTsv(text);
  const lookup = buildHeaderLookup(headers);

  const missingHeaders = REQUIRED_INFOTABLE_FIELDS
    .filter((f) => !hasAnyAlias(lookup, f.aliases))
    .map((f) => f.canonical);

  const canonicalMapping = buildCanonicalMapping(lookup, ALL_INFOTABLE_FIELDS);

  const rows: InfoTableRow[] = [];
  let totalRows = 0;
  let rejectedRows = 0;

  for (const raw of rawRows) {
    totalRows++;

    const accRaw     = getField(raw, lookup, INFO_ACCESSION_ALIASES);
    const issuerName = getField(raw, lookup, INFO_ISSUER_ALIASES).trim();
    const classTitle = getField(raw, lookup, INFO_CLASS_ALIASES).trim();
    const cusipRaw   = getField(raw, lookup, INFO_CUSIP_ALIASES).trim();

    if (!accRaw || !issuerName || !classTitle || !cusipRaw) {
      rejectedRows++;
      continue;
    }

    const cusip = normalizeCusip(cusipRaw);
    if (cusip.length !== 9) {
      rejectedRows++;
      continue;
    }

    rows.push({
      accessionNumber: normalizeAccession(accRaw),
      issuerName: issuerName.replace(/\s+/g, " "),
      classTitle: classTitle.replace(/\s+/g, " "),
      cusip,
      figi: getField(raw, lookup, INFO_FIGI_ALIASES).trim() || null,
      reportedValue:        parseFiniteInt(getField(raw, lookup, INFO_VALUE_ALIASES)),
      reportedShares:       parseFiniteInt(getField(raw, lookup, INFO_SHARES_ALIASES)),
      sharesPrnType:        normalizeSharesPrnType(getField(raw, lookup, INFO_SHARESTYPE_ALIASES)),
      putCall:              normalizePutCall(getField(raw, lookup, INFO_PUTCALL_ALIASES)),
      investmentDiscretion: getField(raw, lookup, INFO_DISCRETION_ALIASES).trim() || null,
      otherManager:         getField(raw, lookup, INFO_OTHERMGR_ALIASES).trim() || null,
      votingSole:           parseFiniteInt(getField(raw, lookup, INFO_VSOLE_ALIASES)),
      votingShared:         parseFiniteInt(getField(raw, lookup, INFO_VSHARED_ALIASES)),
      votingNone:           parseFiniteInt(getField(raw, lookup, INFO_VNONE_ALIASES)),
    });
  }

  return { rows, totalRows, parsedRows: rows.length, rejectedRows, missingHeaders, canonicalMapping };
}

// ---------------------------------------------------------------------------
// ZIP entry resolution
// ---------------------------------------------------------------------------

/**
 * Locate a required ZIP entry by canonical base name, case-insensitively.
 *
 * Normalizes each entry name: replaces `\` with `/`, strips leading `./`,
 * trims whitespace, then compares the lowercase basename.
 *
 * Resolution priority (first non-empty tier wins):
 *   A. Bare root basename (e.g. SUBMISSION.tsv at the archive root)
 *   B. Legacy quarter-prefixed match (e.g. 2023Q4_SUBMISSION.tsv — any depth)
 *   C. Unique nested basename match (e.g. dataset/SUBMISSION.tsv)
 *
 * Ambiguity: multiple equally-valid candidates at the same tier returns
 * AMBIGUOUS_ARCHIVE_ENTRY rather than selecting arbitrarily.
 *
 * Rejects unrelated partial matches (OLD_SUBMISSION_BACKUP.tsv, etc.).
 * Does NOT depend on descriptor quarter — works for all archive generations.
 *
 * Archive generations:
 *   - Post-2023: bare filenames (SUBMISSION.tsv, INFOTABLE.tsv)
 *   - Pre-2024:  quarter-prefixed (2023Q4_SUBMISSION.TSV, 2023Q4_INFOTABLE.TSV)
 */
export function resolveRequiredArchiveEntry(
  entries: AdmZip.IZipEntry[],
  requiredBaseName: string,
): ResolveArchiveEntryResult {
  const target = requiredBaseName.toLowerCase();

  const tierA: AdmZip.IZipEntry[] = []; // bare root exact match
  const tierB: AdmZip.IZipEntry[] = []; // legacy quarter-prefixed match
  const tierC: AdmZip.IZipEntry[] = []; // nested (non-root) exact match

  for (const entry of entries) {
    // Normalize: backslash → slash, strip leading ./, trim
    const normalized = entry.entryName
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .trim();

    const parts = normalized.split("/");
    const rawBase = parts[parts.length - 1];
    if (!rawBase) continue; // skip directory-marker entries (trailing slash)

    const basename = rawBase.toLowerCase();
    const isRoot = parts.length === 1;
    const isExact = basename === target;

    // Legacy: must be exactly <YYYYQN>_<target>, nothing else.
    // e.g. "2023q4_submission.tsv" when target = "submission.tsv"
    const isLegacy =
      !isExact &&
      /^\d{4}q[1-4]_/i.test(basename) &&
      basename.slice(basename.indexOf("_") + 1) === target;

    if (isExact && isRoot) {
      tierA.push(entry);
    } else if (isLegacy) {
      tierB.push(entry);
    } else if (isExact) {
      tierC.push(entry); // nested non-root exact match
    }
    // All other entries (partial/wrong name, wrong extension, etc.) ignored
  }

  if (tierA.length === 1) return { found: true, entry: tierA[0], mode: "bare_exact" };
  if (tierA.length > 1)   return { found: false, error: "AMBIGUOUS_ARCHIVE_ENTRY" };

  if (tierB.length === 1) return { found: true, entry: tierB[0], mode: "legacy_prefixed" };
  if (tierB.length > 1)   return { found: false, error: "AMBIGUOUS_ARCHIVE_ENTRY" };

  if (tierC.length === 1) return { found: true, entry: tierC[0], mode: "nested_basename" };
  if (tierC.length > 1)   return { found: false, error: "AMBIGUOUS_ARCHIVE_ENTRY" };

  return { found: false, error: "REQUIRED_ARCHIVE_ENTRY_MISSING" };
}

/**
 * Find a ZIP entry by name suffix, case-insensitive.
 * Handles entries with directory prefixes (e.g. "data/2026Q1_SUBMISSION.TSV").
 *
 * @deprecated Use resolveRequiredArchiveEntry() for new code. This helper
 *   requires the caller to construct the exact suffix (including prefix), which
 *   does not work for post-2023 bare-named archives.
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
  requestedUrl: null,
  finalUrl: null,
  httpStatus: null,
  contentType: null,
  contentLength: null,
  archiveBytes: 0,
  archiveEntries: [],
  resolvedSubmissionEntry: null,
  resolvedCoverPageEntry: null,
  resolvedInfoTableEntry: null,
  resolutionMode: null,
  submissionRows: 0,
  parsedSubmissionRows: 0,
  coverPageRows: 0,
  parsedCoverPageRows: 0,
  coverPageJoinCount: 0,
  coverPageUnmatchedSubmissionCount: 0,
  duplicateCoverPageAccessionCount: 0,
  informationTableRows: 0,
  parsedInformationRows: 0,
  joinedHoldingRows: 0,
  missingManagerIdentityCount: 0,
  managerCikConflictCount: 0,
  missingManagerCikCount: 0,
  rejectedRows: 0,
  eligibleCommonStockRows: 0,
  putCallExcludedRows: 0,
  prnExcludedRows: 0,
  durationMs: 0,
  submissionHeaderMapping: {},
  coverPageHeaderMapping: {},
  infoTableHeaderMapping: {},
  submissionTypeCounts: {},
  normalizedSubmissionTypeCounts: {},
  // type classification
  recognizedHoldingsFormRows: 0,
  recognized13fHrRows: 0,
  recognized13fHrAmendmentRows: 0,
  excludedNoticeRows: 0,
  excludedUnknownTypeRows: 0,
  // field-level rejection counters
  rejectedMissingAccession: 0,
  rejectedInvalidAccession: 0,
  rejectedMissingCik: 0,
  rejectedInvalidCik: 0,
  rejectedMissingPeriodOfReport: 0,
  rejectedInvalidPeriodOfReport: 0,
  rejectedInvalidFilingDate: 0,
  rejectedOtherSubmissionValidation: 0,
  // post-validation
  includedSubmissionCount: 0,
  excludedNoticeCount: 0,               // alias for excludedNoticeRows
  excludedUnknownSubmissionTypeCount: 0, // alias for excludedUnknownTypeRows
  amendmentSubmissionCount: 0,
  amendmentFlagConflictCount: 0,
  detectedPeriodFormats: {
    ISO_DASH: 0, ISO_COMPACT: 0, US_SLASH: 0, US_DASH: 0, ISO_SLASH: 0, SEC_DD_MMM_YYYY: 0, UNKNOWN: 0,
  },
  normalizedPeriodDistribution: {},
};

/**
 * Parse a pre-downloaded bulk quarter ZIP buffer.
 * Exported for testing — does not make any HTTP requests.
 *
 * @param buffer             ZIP archive buffer
 * @param year               Holdings period year (retained for caller compat; not
 *                           used for entry resolution — resolveRequiredArchiveEntry
 *                           handles both bare and legacy-prefixed archives)
 * @param q                  Holdings period quarter (same note as year)
 * @param startMs            Timestamp of download start for durationMs diagnostic
 * @param entryPrefixOverride  @deprecated No longer used for entry resolution.
 *                             The resolver auto-detects bare and legacy-prefixed
 *                             entries without constructing an expected name.
 */
export function parseBulkQuarterFromBuffer(
  buffer: Buffer,
  year: number,
  q: 1 | 2 | 3 | 4,
  startMs = 0,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  entryPrefixOverride?: string,
): BulkParseResult {
  // year and q are retained for caller backward-compat but are no longer used
  // for entry-name construction. resolveRequiredArchiveEntry() handles all
  // archive generations (post-2023 bare + pre-2024 legacy-prefixed) without
  // requiring the caller to specify the expected filename prefix.

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

  const zipEntries = zip.getEntries();
  const allEntryNames = zipEntries.map((e) => e.entryName);
  const baseDiag = { archiveBytes: buffer.length, archiveEntries: allEntryNames };

  // ── STEP 1: Resolve required archive entries ─────────────────────────────
  //
  // Three tables are needed:
  //   SUBMISSION.tsv  — filing metadata (accession, CIK, dates, form type)
  //   COVERPAGE.tsv   — manager identity (name; joined by accession)
  //   INFOTABLE.tsv   — holding rows (issuer, CUSIP, value, shares…)
  //
  // COVERPAGE is resolved conditionally: if SUBMISSION contains a manager-name
  // column (legacy archives), COVERPAGE is optional. For current archives where
  // SUBMISSION lacks the name column, COVERPAGE is required.
  //
  // All three resolvers use the robust basename resolver — works for post-2023
  // bare filenames and pre-2024 quarter-prefixed entries without year/q hints.
  const subResolve  = resolveRequiredArchiveEntry(zipEntries, "SUBMISSION.tsv");
  const infoResolve = resolveRequiredArchiveEntry(zipEntries, "INFOTABLE.tsv");
  const cpResolve   = resolveRequiredArchiveEntry(zipEntries, "COVERPAGE.tsv");

  const resolvedSubmissionEntry = subResolve.found  ? subResolve.entry.entryName  : null;
  const resolvedCoverPageEntry  = cpResolve.found   ? cpResolve.entry.entryName   : null;
  const resolvedInfoTableEntry  = infoResolve.found ? infoResolve.entry.entryName : null;
  const resolutionMode: ArchiveResolutionMode | null =
    subResolve.found  ? subResolve.mode  :
    cpResolve.found   ? cpResolve.mode   :
    infoResolve.found ? infoResolve.mode : null;

  const resolutionDiag = {
    resolvedSubmissionEntry,
    resolvedCoverPageEntry,
    resolvedInfoTableEntry,
    resolutionMode,
  };

  // Ambiguity — multiple equally-valid candidates at the same tier
  const ambiguous = [subResolve, infoResolve].some(
    (r) => !r.found && r.error === "AMBIGUOUS_ARCHIVE_ENTRY",
  );
  if (ambiguous) {
    const ambigNames = [
      !subResolve.found  && subResolve.error  === "AMBIGUOUS_ARCHIVE_ENTRY" ? "SUBMISSION.tsv"  : null,
      !infoResolve.found && infoResolve.error === "AMBIGUOUS_ARCHIVE_ENTRY" ? "INFOTABLE.tsv"   : null,
    ].filter(Boolean).join(", ");
    return {
      status: "empty_parse_failure",
      holdings: [],
      diagnostics: { ...EMPTY_DIAGNOSTICS, ...baseDiag, ...resolutionDiag, durationMs: Date.now() - startMs },
      reason: `AMBIGUOUS_ARCHIVE_ENTRY: multiple equally-valid candidates for [${ambigNames}] — cannot safely select one`,
    };
  }

  // SUBMISSION and INFOTABLE are always required
  if (!subResolve.found || !infoResolve.found) {
    const missing = [
      !subResolve.found  ? "SUBMISSION.tsv"  : null,
      !infoResolve.found ? "INFOTABLE.tsv"   : null,
    ].filter(Boolean).join(", ");
    return {
      status: "empty_parse_failure",
      holdings: [],
      diagnostics: { ...EMPTY_DIAGNOSTICS, ...baseDiag, ...resolutionDiag, durationMs: Date.now() - startMs },
      reason:
        `REQUIRED_ARCHIVE_ENTRY_MISSING: [${missing}]. ` +
        `Archive has: [${allEntryNames.slice(0, 8).join(", ")}${allEntryNames.length > 8 ? ", …" : ""}]`,
    };
  }

  const submissionEntry = subResolve.entry;
  const infoTableEntry  = infoResolve.entry;

  // ── STEP 2: Parse SUBMISSION.tsv ─────────────────────────────────────────
  const subText = submissionEntry.getData().toString("utf8");
  const {
    rows: subRowsVerified,
    unknownTypeRows,
    totalRows: totalSubRows,
    parsedRows: parsedSubRows,
    missingHeaders: missingSubH,
    canonicalMapping: subHeaderMapping,
    submissionTypeCounts,
    normalizedSubmissionTypeCounts,
    includedCount: includedSubmissionCount,
    recognizedHoldingsFormRows,
    recognized13fHrRows,
    recognized13fHrAmendmentRows,
    excludedNoticeRows,
    excludedUnknownTypeRows,
    rejectedMissingAccession,
    rejectedInvalidAccession,
    rejectedMissingCik,
    rejectedInvalidCik,
    rejectedMissingPeriodOfReport,
    rejectedInvalidPeriodOfReport,
    rejectedInvalidFilingDate,
    rejectedOtherSubmissionValidation,
    excludedNoticeCount,
    excludedUnknownCount,
    amendmentCount: amendmentSubmissionCount,
    detectedPeriodFormats,
    rawPeriodSamples,
    normalizedPeriodDistribution,
  } = parseSubmissionTsv(subText);

  /** Submission type diagnostics — shared into every early-return below. */
  const subTypeDiag = {
    submissionTypeCounts,
    normalizedSubmissionTypeCounts,
    includedSubmissionCount,
    recognizedHoldingsFormRows,
    recognized13fHrRows,
    recognized13fHrAmendmentRows,
    excludedNoticeRows,
    excludedUnknownTypeRows,
    rejectedMissingAccession,
    rejectedInvalidAccession,
    rejectedMissingCik,
    rejectedInvalidCik,
    rejectedMissingPeriodOfReport,
    rejectedInvalidPeriodOfReport,
    rejectedInvalidFilingDate,
    rejectedOtherSubmissionValidation,
    excludedNoticeCount,
    excludedUnknownSubmissionTypeCount: excludedUnknownCount,
    amendmentSubmissionCount,
    detectedPeriodFormats,
    rawPeriodSamples,
    normalizedPeriodDistribution,
  };

  if (missingSubH.length > 0) {
    return {
      status: "empty_parse_failure",
      holdings: [],
      diagnostics: {
        ...EMPTY_DIAGNOSTICS,
        ...baseDiag,
        ...resolutionDiag,
        ...subTypeDiag,
        submissionHeaderMapping: subHeaderMapping,
        coverPageHeaderMapping: {},
        infoTableHeaderMapping: {},
        submissionRows: totalSubRows,
        parsedSubmissionRows: parsedSubRows,
        durationMs: Date.now() - startMs,
      },
      reason: `Required SUBMISSION headers missing: [${missingSubH.join(", ")}]`,
    };
  }

  // Working submission row set — starts with verified (13F-HR / 13F-HR/A) rows.
  // COVERPAGE REPORTTYPE fallback may promote additional rows from unknownTypeRows.
  let subRows = subRowsVerified;

  // ── STEP 3: Resolve manager identity source ───────────────────────────────
  //
  // Current SEC schema: manager name is in COVERPAGE.tsv, not SUBMISSION.tsv.
  // Legacy archives: manager name is in SUBMISSION.tsv.
  //
  // Determine which source supplies manager identity:
  //   - If SUBMISSION has a manager-name column → legacy mode (COVERPAGE not required).
  //   - Else → current mode: COVERPAGE is required.
  //
  // CIK precedence: CIK comes from SUBMISSION only (COVERPAGE has no CIK field in the
  // current schema). managerCikConflictCount will be 0 when a single source supplies it.

  const subHasManagerName = hasAnyAlias(buildHeaderLookup(parseTsv(subText).headers), SUB_NAME_ALIASES);

  // COVERPAGE fields used even in legacy mode when available (for amendment metadata).
  let coverPageByAccession = new Map<string, CoverPageRow>();
  let coverPageTotalRows    = 0;
  let coverPageParsedRows   = 0;
  let dupCoverPageCount     = 0;
  let cpHeaderMapping: Record<string, string | null> = {};

  if (cpResolve.found) {
    const cpText = cpResolve.entry.getData().toString("utf8");
    const cpResult = parseCoverPageTsv(cpText);
    coverPageByAccession = cpResult.byAccession;
    coverPageTotalRows   = cpResult.totalRows;
    coverPageParsedRows  = cpResult.parsedRows;
    dupCoverPageCount    = cpResult.duplicateAccessionCount;
    cpHeaderMapping      = cpResult.canonicalMapping;

    if (cpResult.missingHeaders.length > 0 && !subHasManagerName) {
      // COVERPAGE exists but lacks required manager-name field; SUBMISSION also lacks it.
      return {
        status: "empty_parse_failure",
        holdings: [],
        diagnostics: {
          ...EMPTY_DIAGNOSTICS,
          ...baseDiag,
          ...resolutionDiag,
          ...subTypeDiag,
          submissionHeaderMapping: subHeaderMapping,
          coverPageHeaderMapping: cpHeaderMapping,
          infoTableHeaderMapping: {},
          submissionRows: totalSubRows,
          parsedSubmissionRows: parsedSubRows,
          coverPageRows: coverPageTotalRows,
          parsedCoverPageRows: coverPageParsedRows,
          durationMs: Date.now() - startMs,
        },
        reason:
          `MANAGER_IDENTITY_SOURCE_MISSING: COVERPAGE required headers missing ` +
          `[${cpResult.missingHeaders.join(", ")}] and SUBMISSION has no manager-name column`,
      };
    }

    // ── COVERPAGE REPORTTYPE fallback for UNKNOWN-typed submission rows ─────
    //
    // If SUBMISSIONTYPE was unrecognized ("UNKNOWN"), check whether
    // COVERPAGE.REPORTTYPE can resolve it to a holdings-bearing form type.
    // COVERPAGE.REPORTTYPE is only used as a fallback — it supplements but
    // never overrides a verified SUBMISSION.SUBMISSIONTYPE value.
    //
    // Only accept COVERPAGE.REPORTTYPE values that normalise cleanly to
    // "13F-HR" or "13F-HR/A". Anything else is excluded (UNKNOWN → no infer).
    if (unknownTypeRows.length > 0) {
      let coverPageFallbackCount = 0;
      for (const pending of unknownTypeRows) {
        const cpRow = coverPageByAccession.get(pending.accessionNumber);
        if (!cpRow?.reportType) continue;
        const resolvedViaCP = normalizeSubmissionType(cpRow.reportType);
        if (resolvedViaCP === "13F-HR" || resolvedViaCP === "13F-HR/A") {
          subRows = [
            ...subRows,
            {
              ...pending,
              formType: resolvedViaCP,
              isAmendment: resolvedViaCP === "13F-HR/A" || cpRow.isAmendment,
            },
          ];
          coverPageFallbackCount++;
        }
        // If COVERPAGE.REPORTTYPE is also UNKNOWN/NT, row stays excluded.
      }
      // Accumulate into counts so diagnostics reflect reality
      if (coverPageFallbackCount > 0) {
        subTypeDiag.includedSubmissionCount += coverPageFallbackCount;
        subTypeDiag.excludedUnknownSubmissionTypeCount -= coverPageFallbackCount;
        const fallbackAmendments = subRows.filter(
          (s) => !subRowsVerified.includes(s) && s.isAmendment,
        ).length;
        subTypeDiag.amendmentSubmissionCount += fallbackAmendments;
      }
    }
  } else if (!subHasManagerName) {
    // COVERPAGE not in archive AND SUBMISSION has no manager-name column.
    //
    // Distinguish two distinct root causes:
    //   1. No holdings-bearing submissions at all (all UNKNOWN/NT) → NO_HOLDINGS_BEARING_SUBMISSIONS
    //      (primary problem is submission-type filtering, not manager identity)
    //   2. Valid 13F-HR submissions exist but no manager name source → MANAGER_IDENTITY_SOURCE_MISSING
    // No COVERPAGE; distinguish by whether form-type recognition produced anything.
    if (recognizedHoldingsFormRows === 0) {
      return {
        status: "empty_parse_failure",
        holdings: [],
        diagnostics: {
          ...EMPTY_DIAGNOSTICS,
          ...baseDiag,
          ...resolutionDiag,
          ...subTypeDiag,
          submissionHeaderMapping: subHeaderMapping,
          coverPageHeaderMapping: {},
          infoTableHeaderMapping: {},
          submissionRows: totalSubRows,
          parsedSubmissionRows: parsedSubRows,
          durationMs: Date.now() - startMs,
        },
        reason:
          `NO_HOLDINGS_BEARING_SUBMISSIONS: ${totalSubRows} SUBMISSION rows found but none ` +
          `normalised to 13F-HR or 13F-HR/A. ` +
          `Distinct SUBMISSIONTYPE values: ${JSON.stringify(submissionTypeCounts)}`,
      };
    }
    if (subRowsVerified.length === 0) {
      // Form types recognized but all rows rejected by field validation
      return {
        status: "empty_parse_failure",
        holdings: [],
        diagnostics: {
          ...EMPTY_DIAGNOSTICS,
          ...baseDiag,
          ...resolutionDiag,
          ...subTypeDiag,
          submissionHeaderMapping: subHeaderMapping,
          coverPageHeaderMapping: {},
          infoTableHeaderMapping: {},
          submissionRows: totalSubRows,
          parsedSubmissionRows: parsedSubRows,
          durationMs: Date.now() - startMs,
        },
        reason:
          `ALL_HOLDINGS_SUBMISSIONS_INVALID: ${recognizedHoldingsFormRows} holdings-bearing ` +
          `SUBMISSION rows recognised but all failed field validation. ` +
          `rejectedMissingAccession=${rejectedMissingAccession} ` +
          `rejectedMissingCik=${rejectedMissingCik} ` +
          `rejectedInvalidCik=${rejectedInvalidCik} ` +
          `rejectedMissingPeriodOfReport=${rejectedMissingPeriodOfReport} ` +
          `rejectedInvalidPeriodOfReport=${rejectedInvalidPeriodOfReport} ` +
          `rejectedInvalidFilingDate=${rejectedInvalidFilingDate} ` +
          `rejectedOtherSubmissionValidation=${rejectedOtherSubmissionValidation} ` +
          `detectedPeriodFormats=${JSON.stringify(detectedPeriodFormats)}`,
      };
    }
    return {
      status: "empty_parse_failure",
      holdings: [],
      diagnostics: {
        ...EMPTY_DIAGNOSTICS,
        ...baseDiag,
        ...resolutionDiag,
        ...subTypeDiag,
        submissionHeaderMapping: subHeaderMapping,
        coverPageHeaderMapping: {},
        infoTableHeaderMapping: {},
        submissionRows: totalSubRows,
        parsedSubmissionRows: parsedSubRows,
        durationMs: Date.now() - startMs,
      },
      reason:
        `MANAGER_IDENTITY_SOURCE_MISSING: COVERPAGE.tsv not found in archive and ` +
        `SUBMISSION.tsv has no manager-name column — cannot identify filing managers`,
    };
  }

  // ── Check for zero included submissions AFTER COVERPAGE fallback ──────────
  //
  // Only now — after COVERPAGE REPORTTYPE fallback may have promoted rows —
  // do we know the true count. Distinguish recognition failure from validation failure.
  if (subRows.length === 0) {
    const code = recognizedHoldingsFormRows === 0
      ? "NO_HOLDINGS_BEARING_SUBMISSIONS"
      : "ALL_HOLDINGS_SUBMISSIONS_INVALID";
    const reason = recognizedHoldingsFormRows === 0
      ? `NO_HOLDINGS_BEARING_SUBMISSIONS: ${totalSubRows} SUBMISSION rows found but none ` +
        `normalised to 13F-HR or 13F-HR/A. ` +
        `Distinct SUBMISSIONTYPE values: ${JSON.stringify(submissionTypeCounts)}`
      : `ALL_HOLDINGS_SUBMISSIONS_INVALID: ${recognizedHoldingsFormRows} holdings-bearing ` +
        `SUBMISSION rows recognised but all failed field validation. ` +
        `rejectedMissingAccession=${rejectedMissingAccession} ` +
        `rejectedMissingCik=${rejectedMissingCik} ` +
        `rejectedInvalidCik=${rejectedInvalidCik} ` +
        `rejectedMissingPeriodOfReport=${rejectedMissingPeriodOfReport} ` +
        `rejectedInvalidPeriodOfReport=${rejectedInvalidPeriodOfReport} ` +
        `rejectedInvalidFilingDate=${rejectedInvalidFilingDate} ` +
        `rejectedOtherSubmissionValidation=${rejectedOtherSubmissionValidation} ` +
        `detectedPeriodFormats=${JSON.stringify(detectedPeriodFormats)}`;
    void code; // code is embedded in reason string
    return {
      status: "empty_parse_failure",
      holdings: [],
      diagnostics: {
        ...EMPTY_DIAGNOSTICS,
        ...baseDiag,
        ...resolutionDiag,
        ...subTypeDiag,
        submissionHeaderMapping: subHeaderMapping,
        coverPageHeaderMapping: cpHeaderMapping,
        infoTableHeaderMapping: {},
        submissionRows: totalSubRows,
        parsedSubmissionRows: parsedSubRows,
        coverPageRows: coverPageTotalRows,
        parsedCoverPageRows: coverPageParsedRows,
        durationMs: Date.now() - startMs,
      },
      reason,
    };
  }

  // ── STEP 4: Parse INFOTABLE.tsv ──────────────────────────────────────────
  const infoText = infoTableEntry.getData().toString("utf8");
  const {
    rows: infoRows,
    totalRows: totalInfoRows,
    parsedRows: parsedInfoRows,
    rejectedRows,
    missingHeaders: missingInfoH,
    canonicalMapping: infoHeaderMapping,
  } = parseInfoTableTsv(infoText);

  const headerDiag = {
    submissionHeaderMapping: subHeaderMapping,
    coverPageHeaderMapping: cpHeaderMapping,
    infoTableHeaderMapping: infoHeaderMapping,
  };

  if (missingInfoH.length > 0) {
    return {
      status: "empty_parse_failure",
      holdings: [],
      diagnostics: {
        ...EMPTY_DIAGNOSTICS,
        ...baseDiag,
        ...resolutionDiag,
        ...subTypeDiag,
        ...headerDiag,
        submissionRows: totalSubRows,
        parsedSubmissionRows: parsedSubRows,
        coverPageRows: coverPageTotalRows,
        parsedCoverPageRows: coverPageParsedRows,
        informationTableRows: totalInfoRows,
        parsedInformationRows: parsedInfoRows,
        durationMs: Date.now() - startMs,
      },
      reason: `Required INFOTABLE headers missing: [${missingInfoH.join(", ")}]`,
    };
  }

  // ── STEP 5: Three-table join ──────────────────────────────────────────────
  //
  //   SUBMISSION.tsv (subMap)
  //       ↓ accession
  //   COVERPAGE.tsv (coverPageByAccession)
  //       ↓ manager identity (name; CIK from SUBMISSION)
  //   INFOTABLE.tsv
  //       ↓ holding rows
  //   ParsedBulkHolding[]
  //
  // For each INFOTABLE row:
  //   1. Normalize accession
  //   2. Locate SUBMISSION row (provides CIK, dates, form type)
  //   3. Locate manager identity:
  //      - COVERPAGE if present for this accession
  //      - SUBMISSION name field as fallback (legacy archives)
  //   4. Fail row (missingManagerIdentityCount) if neither source yields a name

  const subMap = new Map<string, SubmissionRow>();
  for (const s of subRows) subMap.set(s.accessionNumber, s);

  // CIK conflict tracking: only possible if future schema puts CIK in COVERPAGE.
  // Currently CIK is SUBMISSION-only → managerCikConflictCount is always 0.
  let managerCikConflictCount = 0;
  let missingManagerCikCount  = 0;
  // Amendment conflict: counts accessions where SUBMISSION and COVERPAGE disagree.
  let amendmentFlagConflictCount = 0;

  // Submission → coverpage join diagnostics
  let coverPageJoinCount               = 0;
  let coverPageUnmatchedSubmissionCount = 0;
  for (const s of subRows) {
    if (coverPageByAccession.has(s.accessionNumber)) coverPageJoinCount++;
    else coverPageUnmatchedSubmissionCount++;
  }

  // Main INFOTABLE join
  const holdings: ParsedBulkHolding[] = [];
  let joinedHoldingRows            = 0;
  let missingManagerIdentityCount  = 0;
  let putCallExcludedRows          = 0;
  let prnExcludedRows              = 0;
  let eligibleCommonStockRows      = 0;

  for (const row of infoRows) {
    const sub = subMap.get(row.accessionNumber);
    if (!sub) continue; // not a 13F-HR row, or accession format mismatch

    // Resolve manager identity
    const cpRow  = coverPageByAccession.get(row.accessionNumber);
    const filerName = cpRow?.managerName || sub.name;
    if (!filerName) {
      missingManagerIdentityCount++;
      continue;
    }

    // CIK tracking (from SUBMISSION only in current schema)
    if (!sub.cik) missingManagerCikCount++;

    // Amendment flag precedence:
    //   Either authoritative source indicating amendment → isAmendment = true.
    //   Inconsistency between SUBMISSION and COVERPAGE is counted (not silently resolved).
    //   SUBMISSION.SUBMISSIONTYPE (= 13F-HR/A) is the primary authority.
    //   COVERPAGE.ISAMENDMENT supplements it (some archives only set one).
    const subSaysAmend = sub.isAmendment;
    const cpSaysAmend  = cpRow?.isAmendment ?? false;
    const isAmendment  = subSaysAmend || cpSaysAmend;
    if (subSaysAmend !== cpSaysAmend) amendmentFlagConflictCount++;

    joinedHoldingRows++;

    // Track diagnostic categories (rows are always included in output)
    if (row.putCall !== null) putCallExcludedRows++;
    else if (row.sharesPrnType === "PRN") prnExcludedRows++;
    else eligibleCommonStockRows++;

    holdings.push({
      accessionNumber: row.accessionNumber,
      filerCik: sub.cik,
      filerName,
      filingType: sub.formType,
      filingDate: sub.filingDate,
      periodOfReport: sub.periodOfReport,
      isAmendment,
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
    ...EMPTY_DIAGNOSTICS,
    archiveBytes: buffer.length,
    archiveEntries: allEntryNames,
    ...resolutionDiag,
    ...headerDiag,
    ...subTypeDiag,
    submissionRows: totalSubRows,
    parsedSubmissionRows: parsedSubRows,
    coverPageRows: coverPageTotalRows,
    parsedCoverPageRows: coverPageParsedRows,
    coverPageJoinCount,
    coverPageUnmatchedSubmissionCount,
    duplicateCoverPageAccessionCount: dupCoverPageCount,
    informationTableRows: totalInfoRows,
    parsedInformationRows: parsedInfoRows,
    joinedHoldingRows,
    missingManagerIdentityCount,
    managerCikConflictCount,
    missingManagerCikCount,
    rejectedRows,
    eligibleCommonStockRows,
    putCallExcludedRows,
    prnExcludedRows,
    amendmentFlagConflictCount,
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
// Bounded archive reader
// ---------------------------------------------------------------------------

/**
 * Read a ZIP entry through zlib without invoking AdmZip#getData().  AdmZip is
 * still used for its central directory (and therefore retains the existing
 * entry-resolution rules), but its eager inflater is deliberately bypassed.
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function updateCrc32(crc: number, chunk: Buffer): number {
  let value = crc;
  for (const byte of chunk) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value;
}

function metadataNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function validateEntryBuffer(entry: AdmZip.IZipEntry, data: Buffer): void {
  const expectedSize = metadataNumber(entry.header.size);
  if (expectedSize !== null && data.length !== expectedSize) {
    throw integrityError("ARCHIVE_ENTRY_SIZE_MISMATCH");
  }
  const expectedCrc = metadataNumber(entry.header.crc);
  if (expectedCrc !== null) {
    const actualCrc = (~updateCrc32(0xffffffff, data)) >>> 0;
    if (actualCrc !== expectedCrc) throw integrityError("ARCHIVE_ENTRY_CRC_MISMATCH");
  }
}

function zipEntryTextStream(
  archive: Buffer,
  entry: AdmZip.IZipEntry,
  signal?: AbortSignal,
): Readable {
  const header = entry.header;
  if (header.encrypted) throw new Error("ENCRYPTED_ARCHIVE_ENTRY_UNSUPPORTED");
  const dataOffset = header.realDataOffset || (
    header.offset + 30 + archive.readUInt16LE(header.offset + 26) + archive.readUInt16LE(header.offset + 28)
  );
  const expectedCompressedSize = metadataNumber(header.compressedSize);
  if (expectedCompressedSize !== null && dataOffset + expectedCompressedSize > archive.length) {
    throw integrityError("ARCHIVE_ENTRY_COMPRESSED_SIZE_MISMATCH");
  }
  const compressed = archive.subarray(dataOffset, dataOffset + header.compressedSize);
  async function* chunks(): AsyncGenerator<Buffer> {
    // Do not hand a multi-hundred MB compressed buffer to a stream as one chunk.
    for (let offset = 0; offset < compressed.length; offset += 64 * 1024) {
      if (signal?.aborted) throw cancellationError();
      yield compressed.subarray(offset, Math.min(offset + 64 * 1024, compressed.length));
    }
  }
  const source = Readable.from(chunks());
  const decompressed = header.method === 0
    ? source
    : header.method === 8
      ? source.pipe(createInflateRaw())
      : null;
  if (!decompressed) throw new Error(`UNSUPPORTED_ARCHIVE_COMPRESSION:${header.method}`);

  const expectedSize = metadataNumber(header.size);
  const expectedCrc = metadataNumber(header.crc);
  let outputBytes = 0;
  let crc = 0xffffffff;
  const integrity = new Transform({
    transform(chunk, _encoding, callback) {
      if (signal?.aborted) {
        callback(cancellationError());
        return;
      }
      outputBytes += chunk.length;
      if (expectedSize !== null && outputBytes > expectedSize) {
        callback(integrityError("ARCHIVE_ENTRY_SIZE_MISMATCH"));
        return;
      }
      crc = updateCrc32(crc, chunk);
      callback(null, chunk);
    },
    flush(callback) {
      if (expectedSize !== null && outputBytes !== expectedSize) {
        callback(integrityError("ARCHIVE_ENTRY_SIZE_MISMATCH"));
        return;
      }
      if (expectedCrc !== null && ((~crc) >>> 0) !== expectedCrc) {
        callback(integrityError("ARCHIVE_ENTRY_CRC_MISMATCH"));
        return;
      }
      callback();
    },
  });
  const result = decompressed.pipe(integrity);
  if (signal) {
    const abort = () => result.destroy(cancellationError());
    if (signal.aborted) abort();
    else {
      signal.addEventListener("abort", abort, { once: true });
      result.once("close", () => signal.removeEventListener("abort", abort));
    }
  }
  return result;
}

function infoTableRowFromCells(
  cells: string[],
  headers: string[],
  lookup: Map<string, string>,
): InfoTableRow | null {
  const raw: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) raw[headers[i]] = (cells[i] ?? "").trim();
  const accRaw = getField(raw, lookup, INFO_ACCESSION_ALIASES);
  const issuerName = getField(raw, lookup, INFO_ISSUER_ALIASES).trim();
  const classTitle = getField(raw, lookup, INFO_CLASS_ALIASES).trim();
  const cusipRaw = getField(raw, lookup, INFO_CUSIP_ALIASES).trim();
  if (!accRaw || !issuerName || !classTitle || !cusipRaw) return null;
  const cusip = normalizeCusip(cusipRaw);
  if (cusip.length !== 9) return null;
  return {
    accessionNumber: normalizeAccession(accRaw), issuerName: issuerName.replace(/\s+/g, " "),
    classTitle: classTitle.replace(/\s+/g, " "), cusip,
    figi: getField(raw, lookup, INFO_FIGI_ALIASES).trim() || null,
    reportedValue: parseFiniteInt(getField(raw, lookup, INFO_VALUE_ALIASES)),
    reportedShares: parseFiniteInt(getField(raw, lookup, INFO_SHARES_ALIASES)),
    sharesPrnType: normalizeSharesPrnType(getField(raw, lookup, INFO_SHARESTYPE_ALIASES)),
    putCall: normalizePutCall(getField(raw, lookup, INFO_PUTCALL_ALIASES)),
    investmentDiscretion: getField(raw, lookup, INFO_DISCRETION_ALIASES).trim() || null,
    otherManager: getField(raw, lookup, INFO_OTHERMGR_ALIASES).trim() || null,
    votingSole: parseFiniteInt(getField(raw, lookup, INFO_VSOLE_ALIASES)),
    votingShared: parseFiniteInt(getField(raw, lookup, INFO_VSHARED_ALIASES)),
    votingNone: parseFiniteInt(getField(raw, lookup, INFO_VNONE_ALIASES)),
  };
}

/**
 * Parse an archive with bounded INFOTABLE memory.  This is intentionally async:
 * awaiting onBatch supplies backpressure all the way to the inflater. Accessions
 * must be contiguous in INFOTABLE; a reappearance fails closed rather than
 * silently producing duplicate/incomplete filing batches.
 */
export async function streamBulkQuarterFromBuffer(
  buffer: Buffer, _year: number, _q: 1 | 2 | 3 | 4, options: BulkHoldingStreamOptions,
): Promise<BulkStreamResult> {
  const startMs = Date.now();
  if (options.signal?.aborted) {
    return { status: "failed", diagnostics: { ...EMPTY_DIAGNOSTICS, archiveBytes: buffer.length }, reason: "CANCELLED", failureCode: "CANCELLED" };
  }
  let zip: AdmZip;
  try { zip = new AdmZip(buffer); } catch {
    return {
      status: "failed",
      diagnostics: { ...EMPTY_DIAGNOSTICS, archiveBytes: buffer.length },
      reason: "Could not open archive as a ZIP file",
      failureCode: "SOURCE_INTEGRITY_FAILURE",
    };
  }
  const entries = zip.getEntries();
  const subResolve = resolveRequiredArchiveEntry(entries, "SUBMISSION.tsv");
  const infoResolve = resolveRequiredArchiveEntry(entries, "INFOTABLE.tsv");
  const cpResolve = resolveRequiredArchiveEntry(entries, "COVERPAGE.tsv");
  const names = entries.map((entry) => entry.entryName);
  const resolutionDiag = {
    archiveBytes: buffer.length, archiveEntries: names,
    resolvedSubmissionEntry: subResolve.found ? subResolve.entry.entryName : null,
    resolvedCoverPageEntry: cpResolve.found ? cpResolve.entry.entryName : null,
    resolvedInfoTableEntry: infoResolve.found ? infoResolve.entry.entryName : null,
    resolutionMode: subResolve.found ? subResolve.mode : infoResolve.found ? infoResolve.mode : null,
  };
  if (!subResolve.found || !infoResolve.found) {
    return { status: "empty_parse_failure", diagnostics: { ...EMPTY_DIAGNOSTICS, ...resolutionDiag, durationMs: Date.now() - startMs }, reason: "REQUIRED_ARCHIVE_ENTRY_MISSING" };
  }
  try {
    // These two tables are bounded by the filing population, not holding rows.
    const submissionData = subResolve.entry.getData();
    validateEntryBuffer(subResolve.entry, submissionData);
    const submissionText = submissionData.toString("utf8");
    const submission = parseSubmissionTsv(submissionText);
    const subHasName = hasAnyAlias(buildHeaderLookup(parseTsv(submissionText).headers), SUB_NAME_ALIASES);
    let subRows = submission.rows.slice();
    let cover = new Map<string, CoverPageRow>();
    let cpRows = 0, parsedCpRows = 0, duplicateCpRows = 0;
    let cpMapping: Record<string, string | null> = {};
    if (cpResolve.found) {
      const coverData = cpResolve.entry.getData();
      validateEntryBuffer(cpResolve.entry, coverData);
      const parsed = parseCoverPageTsv(coverData.toString("utf8"));
      cover = parsed.byAccession; cpRows = parsed.totalRows; parsedCpRows = parsed.parsedRows;
      duplicateCpRows = parsed.duplicateAccessionCount; cpMapping = parsed.canonicalMapping;
      if (parsed.missingHeaders.length && !subHasName) throw new Error("MANAGER_IDENTITY_SOURCE_MISSING");
      for (const pending of submission.unknownTypeRows) {
        const type = normalizeSubmissionType(cover.get(pending.accessionNumber)?.reportType ?? "");
        if (type === "13F-HR" || type === "13F-HR/A") subRows.push({ ...pending, formType: type, isAmendment: type === "13F-HR/A" || cover.get(pending.accessionNumber)!.isAmendment });
      }
    } else if (!subHasName) throw new Error("MANAGER_IDENTITY_SOURCE_MISSING");
    if (submission.missingHeaders.length || !subRows.length) throw new Error("INVALID_SUBMISSION");
    const submissions = new Map(subRows.map((row) => [row.accessionNumber, row]));
    let infoHeaders: string[] | null = null, infoLookup: Map<string, string> | null = null;
    let infoMapping: Record<string, string | null> = {};
    let totalInfo = 0, parsedInfo = 0, rejected = 0, joined = 0, missingManager = 0, putCall = 0, prn = 0, eligible = 0;
    let batch: ParsedBulkHolding[] = [], currentAccession: string | null = null;
    const completedAccessions = new Set<string>();
    const batchSize = Math.max(1, options.batchSize ?? 2_000);
    const flush = async (accessionComplete: boolean) => {
      if (!batch.length || currentAccession === null) return;
      const emitted = batch;
      batch = [];
      await options.onBatch(emitted, { accessionNumber: currentAccession, accessionComplete });
    };
    const infoStream = zipEntryTextStream(buffer, infoResolve.entry, options.signal);
    const lineReader = createInterface({ input: infoStream, crlfDelay: Infinity });
    try {
    for await (const rawLine of lineReader) {
      if (options.signal?.aborted) throw cancellationError();
      if (!rawLine.trim()) continue;
      if (!infoHeaders) {
        infoHeaders = stripBom(rawLine).split("\t").map((cell) => cell.trim().toUpperCase());
        infoLookup = buildHeaderLookup(infoHeaders);
        const missing = REQUIRED_INFOTABLE_FIELDS.filter((field) => !hasAnyAlias(infoLookup!, field.aliases));
        if (missing.length) throw new Error(`REQUIRED_INFOTABLE_HEADERS_MISSING:${missing.map((field) => field.canonical).join(",")}`);
        infoMapping = buildCanonicalMapping(infoLookup, ALL_INFOTABLE_FIELDS);
        continue;
      }
      totalInfo++;
      const row = infoTableRowFromCells(rawLine.split("\t"), infoHeaders, infoLookup!);
      if (!row) { rejected++; continue; }
      parsedInfo++;
      if (currentAccession !== row.accessionNumber) {
        if (currentAccession !== null) {
          await flush(true);
          completedAccessions.add(currentAccession);
        }
        if (completedAccessions.has(row.accessionNumber)) throw new Error("INFOTABLE_ACCESSION_ORDER_VIOLATION");
        currentAccession = row.accessionNumber;
      }
      const sub = submissions.get(row.accessionNumber);
      if (!sub) continue;
      const cp = cover.get(row.accessionNumber);
      const filerName = cp?.managerName || sub.name;
      if (!filerName) { missingManager++; continue; }
      joined++;
      if (row.putCall) putCall++; else if (row.sharesPrnType === "PRN") prn++; else eligible++;
      if (batch.length >= batchSize) await flush(false);
      batch.push({ ...row, filerCik: sub.cik, filerName, filingType: sub.formType, filingDate: sub.filingDate, periodOfReport: sub.periodOfReport, isAmendment: sub.isAmendment || (cp?.isAmendment ?? false) });
    }
    } finally {
      lineReader.close();
      infoStream.destroy();
    }
    await flush(true);
    const coverJoins = subRows.reduce((count, row) => count + (cover.has(row.accessionNumber) ? 1 : 0), 0);
    const diagnostics: BulkParseDiagnostics = {
      ...EMPTY_DIAGNOSTICS, ...resolutionDiag, submissionRows: submission.totalRows, parsedSubmissionRows: submission.parsedRows,
      coverPageRows: cpRows, parsedCoverPageRows: parsedCpRows, duplicateCoverPageAccessionCount: duplicateCpRows,
      coverPageJoinCount: coverJoins, coverPageUnmatchedSubmissionCount: subRows.length - coverJoins,
      informationTableRows: totalInfo, parsedInformationRows: parsedInfo, rejectedRows: rejected, joinedHoldingRows: joined,
      missingManagerIdentityCount: missingManager, eligibleCommonStockRows: eligible, putCallExcludedRows: putCall, prnExcludedRows: prn,
      submissionHeaderMapping: submission.canonicalMapping, coverPageHeaderMapping: cpMapping, infoTableHeaderMapping: infoMapping,
      submissionTypeCounts: submission.submissionTypeCounts, normalizedSubmissionTypeCounts: submission.normalizedSubmissionTypeCounts,
      recognizedHoldingsFormRows: submission.recognizedHoldingsFormRows, recognized13fHrRows: submission.recognized13fHrRows,
      recognized13fHrAmendmentRows: submission.recognized13fHrAmendmentRows, excludedNoticeRows: submission.excludedNoticeRows,
      excludedUnknownTypeRows: submission.excludedUnknownTypeRows, rejectedMissingAccession: submission.rejectedMissingAccession,
      rejectedInvalidAccession: submission.rejectedInvalidAccession, rejectedMissingCik: submission.rejectedMissingCik,
      rejectedInvalidCik: submission.rejectedInvalidCik, rejectedMissingPeriodOfReport: submission.rejectedMissingPeriodOfReport,
      rejectedInvalidPeriodOfReport: submission.rejectedInvalidPeriodOfReport, rejectedInvalidFilingDate: submission.rejectedInvalidFilingDate,
      rejectedOtherSubmissionValidation: submission.rejectedOtherSubmissionValidation, includedSubmissionCount: subRows.length,
      excludedNoticeCount: submission.excludedNoticeCount, excludedUnknownSubmissionTypeCount: submission.excludedUnknownCount,
      amendmentSubmissionCount: subRows.filter((row) => row.isAmendment).length, detectedPeriodFormats: submission.detectedPeriodFormats,
      normalizedPeriodDistribution: submission.normalizedPeriodDistribution, durationMs: Date.now() - startMs,
    };
    if (!infoHeaders || (joined === 0 && totalInfo > 0) || (totalInfo > 100 && joined / totalInfo < MIN_JOIN_RATE_WARN)) {
      return { status: "empty_parse_failure", diagnostics, reason: joined === 0 ? "Join rate 0%" : "Implausibly low join rate" };
    }
    return { status: rejected ? "partial_success" : "success", diagnostics };
  } catch (error) {
    if (isCancellationError(error)) {
      return {
        status: "failed",
        diagnostics: { ...EMPTY_DIAGNOSTICS, ...resolutionDiag, durationMs: Date.now() - startMs },
        reason: "CANCELLED",
        failureCode: "CANCELLED",
      };
    }
    if (isIntegrityError(error) || (error instanceof Error && /crc|checksum|unexpected end|unexpected EOF|invalid distance|invalid stored block/i.test(error.message))) {
      return {
        status: "failed",
        diagnostics: { ...EMPTY_DIAGNOSTICS, ...resolutionDiag, durationMs: Date.now() - startMs },
        reason: error instanceof Error ? error.message : "ARCHIVE_ENTRY_INTEGRITY_FAILURE",
        failureCode: "SOURCE_INTEGRITY_FAILURE",
      };
    }
    const reason = error instanceof Error ? error.message : "PARSE_FAILED";
    return { status: "empty_parse_failure", diagnostics: { ...EMPTY_DIAGNOSTICS, ...resolutionDiag, durationMs: Date.now() - startMs }, reason };
  }
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

  let response: Awaited<ReturnType<typeof secFetchBufferDetailed>>;
  try {
    response = await secFetchBufferDetailed(descriptor.downloadUrl, signal);
  } catch (err: any) {
    const failureCode = classifySecArchiveFailure(err);
    return {
      status: "failed",
      holdings: [],
      diagnostics: {
        ...EMPTY_DIAGNOSTICS,
        requestedUrl: descriptor.downloadUrl,
        finalUrl: err instanceof SecHttpError ? err.finalUrl : descriptor.downloadUrl,
        httpStatus: err instanceof SecHttpError ? err.status : null,
        contentType: err instanceof SecHttpError ? err.contentType : null,
        contentLength: err instanceof SecHttpError ? err.byteLength : null,
        durationMs: Date.now() - startMs,
      },
      reason: `Dataset ${label} retrieval failed: ${failureCode}`,
      failureCode,
    };
  }

  const formatFailure = validateSecArchiveResponse(response.contentType, response.buffer);
  const transportDiagnostics = {
    requestedUrl: response.requestedUrl,
    finalUrl: response.finalUrl,
    httpStatus: response.status,
    contentType: response.contentType,
    contentLength: response.contentLength ?? response.byteLength,
  };
  if (formatFailure) {
    return {
      status: "failed",
      holdings: [],
      diagnostics: {
        ...EMPTY_DIAGNOSTICS,
        ...transportDiagnostics,
        archiveBytes: response.byteLength,
        durationMs: Date.now() - startMs,
      },
      reason: `Dataset ${label} response is not a valid ZIP archive`,
      failureCode: formatFailure,
    };
  }
  const parsed = parseBulkQuarterFromBuffer(response.buffer, descriptor.year, descriptor.q, startMs);
  return {
    ...parsed,
    diagnostics: { ...parsed.diagnostics, ...transportDiagnostics },
    ...(parsed.status === "failed" || parsed.status === "empty_parse_failure"
      ? { failureCode: "PARSE_FAILED" as const }
      : {}),
  };
}

/**
 * Catalog-only streaming variant used by historical backfill callers.  It keeps
 * the download/transport validation contract of parseBulkFromDescriptor while
 * exposing the same serial, bounded batch mechanism used by APPLY.
 */
export async function streamBulkFromDescriptor(
  descriptor: DatasetDescriptor,
  options: BulkHoldingStreamOptions,
  signal?: AbortSignal,
): Promise<BulkStreamResult> {
  const prepared = await prepareBulkArchiveFromDescriptor(descriptor, signal);
  if ("status" in prepared) return prepared;
  const result = await streamBulkQuarterFromBuffer(prepared.buffer, descriptor.year, descriptor.q, {
    ...options,
    signal: signal ?? options.signal,
  });
  return { ...result, diagnostics: { ...result.diagnostics, ...prepared.transportDiagnostics } };
}

export async function streamPreparedBulkArchive(
  archive: PreparedBulkArchive,
  descriptor: Pick<DatasetDescriptor, "year" | "q">,
  options: BulkHoldingStreamOptions,
): Promise<BulkStreamResult> {
  const result = await streamBulkQuarterFromBuffer(archive.buffer, descriptor.year, descriptor.q, options);
  return { ...result, diagnostics: { ...result.diagnostics, ...archive.transportDiagnostics } };
}

export async function prepareBulkArchiveFromDescriptor(
  descriptor: DatasetDescriptor,
  signal?: AbortSignal,
): Promise<PreparedBulkArchive | BulkStreamResult> {
  const startMs = Date.now();
  let response: Awaited<ReturnType<typeof secFetchBufferDetailed>>;
  try {
    response = await secFetchBufferDetailed(descriptor.downloadUrl, signal);
  } catch (error: unknown) {
    const secError = error instanceof SecHttpError ? error : null;
    return {
      status: "failed",
      diagnostics: {
        ...EMPTY_DIAGNOSTICS, requestedUrl: descriptor.downloadUrl,
        finalUrl: secError?.finalUrl ?? descriptor.downloadUrl, httpStatus: secError?.status ?? null,
        contentType: secError?.contentType ?? null, contentLength: secError?.byteLength ?? null,
        durationMs: Date.now() - startMs,
      },
      reason: `Dataset ${descriptor.fileName} retrieval failed: ${classifySecArchiveFailure(error)}`,
      failureCode: classifySecArchiveFailure(error),
    };
  }
  const transport = {
    requestedUrl: response.requestedUrl, finalUrl: response.finalUrl, httpStatus: response.status,
    contentType: response.contentType, contentLength: response.contentLength ?? response.byteLength,
  };
  const formatFailure = validateSecArchiveResponse(response.contentType, response.buffer);
  if (formatFailure) {
    return {
      status: "failed",
      diagnostics: { ...EMPTY_DIAGNOSTICS, ...transport, archiveBytes: response.byteLength, durationMs: Date.now() - startMs },
      reason: `Dataset ${descriptor.fileName} response is not a valid ZIP archive`,
      failureCode: formatFailure,
    };
  }
  return { buffer: response.buffer, transportDiagnostics: transport };
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
