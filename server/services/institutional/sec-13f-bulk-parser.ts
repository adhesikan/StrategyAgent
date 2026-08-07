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
  /** Manager name if present in SUBMISSION (legacy). Empty string for current schema. */
  name: string;
  formType: string;        // "13F-HR" | "13F-HR/A"
  filingDate: string;      // YYYY-MM-DD
  periodOfReport: string;  // YYYY-MM-DD
  isAmendment: boolean;
}

/**
 * Parse SUBMISSION.tsv. Returns 13F-HR and 13F-HR/A rows only.
 * Excludes 13F-NT and 13F-NT/A (notice-only, no information table).
 *
 * Supports all SEC bulk TSV schema generations via canonical alias resolution:
 *   Legacy (pre-2024):  ACCESSION-NUMBER, NAME, CONFORMED-PERIOD-OF-REPORT, FILING-DATE
 *   Current (post-2023): ACCESSION_NUMBER, SUBMISSIONTYPE, PERIODOFREPORT, FILING_DATE
 *   And any future hyphen/underscore variant
 *
 * Required canonical fields: accession, CIK, period of report.
 * Manager name is OPTIONAL — current SEC schema stores it in COVERPAGE.tsv.
 * missingHeaders reports canonical labels (not raw column names).
 */
export function parseSubmissionTsv(text: string): {
  rows: SubmissionRow[];
  totalRows: number;
  parsedRows: number;
  missingHeaders: string[];
  canonicalMapping: Record<string, string | null>;
} {
  const { headers, rows: rawRows } = parseTsv(text);
  const lookup = buildHeaderLookup(headers);

  // Validate required fields (manager name is deliberately excluded).
  const missingHeaders = REQUIRED_SUBMISSION_FIELDS
    .filter((f) => !hasAnyAlias(lookup, f.aliases))
    .map((f) => f.canonical);

  // Diagnostic mapping: canonical label → actual header found (null if absent)
  const canonicalMapping = buildCanonicalMapping(lookup, ALL_SUBMISSION_FIELDS);

  const rows: SubmissionRow[] = [];
  let totalRows = 0;

  for (const raw of rawRows) {
    totalRows++;

    const formTypeRaw = getField(raw, lookup, SUB_FORMTYPE_ALIASES).trim().toUpperCase();
    // Exclude notice-only filings (13F-NT / 13F-NT/A) — they have no information table.
    // If form-type column is absent, accept all rows (dataset is exclusively 13F forms).
    if (formTypeRaw === "13F-NT" || formTypeRaw === "13F-NT/A") continue;
    if (formTypeRaw && formTypeRaw !== "13F-HR" && formTypeRaw !== "13F-HR/A") continue;

    const accRaw        = getField(raw, lookup, SUB_ACCESSION_ALIASES);
    const cikRaw        = getField(raw, lookup, SUB_CIK_ALIASES);
    const name          = getField(raw, lookup, SUB_NAME_ALIASES).trim(); // empty for current schema
    const periodRaw     = getField(raw, lookup, SUB_PERIOD_ALIASES);
    const filingDateRaw = getField(raw, lookup, SUB_FILINGDATE_ALIASES);

    const accession = normalizeAccession(accRaw);
    const cik = cikRaw.replace(/^0+/, "").padStart(10, "0") || cikRaw;
    const periodOfReport = normalizeDateField(periodRaw);
    const filingDate = normalizeDateField(filingDateRaw) ?? periodOfReport ?? "";

    if (!accession || !cik || !periodOfReport) continue;

    rows.push({
      accessionNumber: accession,
      cik,
      name,
      formType: formTypeRaw || "13F-HR",
      filingDate,
      periodOfReport,
      isAmendment: formTypeRaw === "13F-HR/A",
    });
  }

  return { rows, totalRows, parsedRows: rows.length, missingHeaders, canonicalMapping };
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
    rows: subRows,
    totalRows: totalSubRows,
    parsedRows: parsedSubRows,
    missingHeaders: missingSubH,
    canonicalMapping: subHeaderMapping,
  } = parseSubmissionTsv(subText);

  if (missingSubH.length > 0) {
    return {
      status: "empty_parse_failure",
      holdings: [],
      diagnostics: {
        ...EMPTY_DIAGNOSTICS,
        ...baseDiag,
        ...resolutionDiag,
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

  if (subRows.length === 0) {
    return {
      status: "empty_parse_failure",
      holdings: [],
      diagnostics: {
        ...EMPTY_DIAGNOSTICS,
        ...baseDiag,
        ...resolutionDiag,
        submissionHeaderMapping: subHeaderMapping,
        coverPageHeaderMapping: {},
        infoTableHeaderMapping: {},
        submissionRows: totalSubRows,
        parsedSubmissionRows: parsedSubRows,
        durationMs: Date.now() - startMs,
      },
      reason: `SUBMISSION.tsv has ${totalSubRows} rows but 0 parsed as 13F-HR/A form type`,
    };
  }

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
  } else if (!subHasManagerName) {
    // COVERPAGE not in archive AND SUBMISSION has no manager-name column
    return {
      status: "empty_parse_failure",
      holdings: [],
      diagnostics: {
        ...EMPTY_DIAGNOSTICS,
        ...baseDiag,
        ...resolutionDiag,
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

    // Amendment: SUBMISSION formType takes precedence; fall back to COVERPAGE.ISAMENDMENT
    const isAmendment = sub.isAmendment || (cpRow?.isAmendment ?? false);

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
    archiveBytes: buffer.length,
    archiveEntries: allEntryNames,
    ...resolutionDiag,
    ...headerDiag,
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
