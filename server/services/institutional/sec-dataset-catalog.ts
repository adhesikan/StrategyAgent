// SEC Form 13F Dataset Catalog
//
// Fetches and parses the official SEC Form 13F Data Sets index page to discover
// available bulk dataset ZIPs, supporting both SEC naming conventions:
//
//   Legacy (2013Q2–2023Q4):   YYYYqN_form13f.zip
//   Post-2023 (2024Q1+):      DDmonYYYY-DDmonYYYY_form13f.zip
//
// The catalog is the authoritative source — no URL is guessed or constructed
// independently of the official index page.
//
// CORRECTNESS RULES (NON-NEGOTIABLE):
//   - Only HTTPS links hosted on sec.gov are accepted.
//   - Only filenames ending in _form13f.zip are accepted.
//   - External/arbitrary URLs are rejected.
//   - SEC_USER_AGENT must be passed explicitly — no config import needed.
//   - Catalog is cached in memory (5-minute TTL) per process.
//   - Catalog must NOT be fetched on ordinary user page requests.
//   - Safe retry/backoff with bounded request count.
//   - No HTML scraping outside the official SEC dataset index page.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATALOG_PAGE_URL =
  "https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets";

const BULK_DATASET_HOST = "www.sec.gov";
const BULK_DATASET_PATH_PREFIX = "/files/structureddata/data/form-13f-data-sets/";

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Normalized catalog entry for a single SEC Form 13F bulk dataset ZIP.
 * Populated from the official SEC index page, not guessed from constructed URLs.
 */
export interface InstitutionalDatasetCatalogEntry {
  /** Full HTTPS download URL from the official catalog */
  downloadUrl: string;
  /** ZIP filename, e.g. "01mar2026-31may2026_form13f.zip" or "2023q4_form13f.zip" */
  fileName: string;
  /** Human-readable label, e.g. "Mar 1–May 31, 2026" or "2023 Q4" */
  displayLabel: string;
  /** Dataset window start date (YYYY-MM-DD) */
  windowStart: string;
  /** Dataset window end date (YYYY-MM-DD) */
  windowEnd: string;
  /** Which SEC naming scheme this entry uses */
  publicationModel: "legacy_quarter" | "three_month_window";
  /** Quarter label for the primary expected holdings period, e.g. "2026Q1" */
  canonicalPeriodLabel: string;
  /** ISO date of the primary expected period of report, e.g. "2026-03-31" */
  expectedPeriodOfReport: string;
}

/**
 * Resolved dataset descriptor — minimal interface for ingestion.
 * Passed from catalog → ingestion so the ingestion never reconstructs a URL.
 */
export interface DatasetDescriptor {
  downloadUrl: string;
  fileName: string;
  windowStart: string;
  windowEnd: string;
  /** Primary expected holdings period of report (YYYY-MM-DD) */
  expectedPeriodOfReport: string;
  /** Year component of the holdings period — for ZIP entry prefix resolution */
  year: number;
  /** Quarter component of the holdings period — for ZIP entry prefix resolution */
  q: 1 | 2 | 3 | 4;
}

// ---------------------------------------------------------------------------
// Month abbreviation → zero-based month index
// ---------------------------------------------------------------------------

const MONTH_ABBR: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse a month abbreviation (e.g. "mar") to 1-based month number.
 * Returns null if unrecognised.
 */
function parseMonthAbbr(abbr: string): number | null {
  const idx = MONTH_ABBR[abbr.toLowerCase()];
  return idx !== undefined ? idx + 1 : null;
}

/**
 * Format a 1-based month + year as an ISO date string (YYYY-MM-DD).
 * Day defaults to the first; pass `day` for end dates.
 */
function isoDate(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Last day of a given month/year (handles leap years).
 */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate(); // month is 1-based; day 0 = last day of prior month
}

/**
 * Quarter number (1–4) from a 1-based month.
 */
function monthToQuarter(month: number): 1 | 2 | 3 | 4 {
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

/**
 * Period-end ISO date for a year+quarter (Q1=Mar31, Q2=Jun30, Q3=Sep30, Q4=Dec31).
 */
function periodEnd(year: number, q: 1 | 2 | 3 | 4): string {
  const ends: Record<1 | 2 | 3 | 4, string> = {
    1: `${year}-03-31`,
    2: `${year}-06-30`,
    3: `${year}-09-30`,
    4: `${year}-12-31`,
  };
  return ends[q];
}

// ---------------------------------------------------------------------------
// Filename parsing
// ---------------------------------------------------------------------------

/**
 * Parsed metadata extracted from a SEC 13F bulk ZIP filename.
 */
export interface ParsedDatasetFileName {
  publicationModel: "legacy_quarter" | "three_month_window";
  windowStart: string;
  windowEnd: string;
  holdingsYear: number;
  holdingsQ: 1 | 2 | 3 | 4;
  expectedPeriodOfReport: string;
  canonicalPeriodLabel: string;
  displayLabel: string;
}

/**
 * Parse a SEC Form 13F bulk dataset ZIP filename into structured metadata.
 *
 * Supports:
 *   Legacy:        2023q4_form13f.zip  (no leading zeros, lowercase q)
 *   Post-2023:     01mar2026-31may2026_form13f.zip
 *                  01dec2025-28feb2026_form13f.zip  (cross-year)
 *                  01dec2024-29feb2025_form13f.zip  (leap year Feb)
 *
 * Returns null for unrecognised or malformed filenames.
 */
export function parseDatasetFileName(
  fileName: string,
): ParsedDatasetFileName | null {
  // Must end in _form13f.zip
  if (!fileName.endsWith("_form13f.zip")) return null;

  // ── Legacy: YYYYqN_form13f.zip ────────────────────────────────────────────
  const legacyMatch = fileName.match(/^(\d{4})q([1-4])_form13f\.zip$/i);
  if (legacyMatch) {
    const year = parseInt(legacyMatch[1], 10);
    const q = parseInt(legacyMatch[2], 10) as 1 | 2 | 3 | 4;
    if (year < 2013 || year > 2099) return null;

    const qStartMonths: Record<1 | 2 | 3 | 4, number> = { 1: 1, 2: 4, 3: 7, 4: 10 };
    const qEndMonths: Record<1 | 2 | 3 | 4, number> = { 1: 3, 2: 6, 3: 9, 4: 12 };
    const startMonth = qStartMonths[q];
    const endMonth = qEndMonths[q];

    return {
      publicationModel: "legacy_quarter",
      windowStart: isoDate(year, startMonth, 1),
      windowEnd: isoDate(year, endMonth, lastDayOfMonth(year, endMonth)),
      holdingsYear: year,
      holdingsQ: q,
      expectedPeriodOfReport: periodEnd(year, q),
      canonicalPeriodLabel: `${year}Q${q}`,
      displayLabel: `${year} Q${q}`,
    };
  }

  // ── Post-2023: DDmonYYYY-DDmonYYYY_form13f.zip ────────────────────────────
  // e.g. 01mar2026-31may2026_form13f.zip
  // e.g. 01dec2025-28feb2026_form13f.zip  (cross-year)
  const rangeMatch = fileName.match(
    /^(\d{2})([a-z]{3})(\d{4})-(\d{2})([a-z]{3})(\d{4})_form13f\.zip$/i,
  );
  if (rangeMatch) {
    const startDay = parseInt(rangeMatch[1], 10);
    const startMonthAbbr = rangeMatch[2].toLowerCase();
    const startYear = parseInt(rangeMatch[3], 10);
    const endDay = parseInt(rangeMatch[4], 10);
    const endMonthAbbr = rangeMatch[5].toLowerCase();
    const endYear = parseInt(rangeMatch[6], 10);

    const startMonth = parseMonthAbbr(startMonthAbbr);
    const endMonth = parseMonthAbbr(endMonthAbbr);
    if (startMonth === null || endMonth === null) return null;

    if (startYear < 2013 || startYear > 2099) return null;
    if (endYear < startYear || endYear > startYear + 1) return null;
    if (startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31) return null;

    // Validate end day against actual last day of month (handles 28/29 Feb)
    const actualLastDay = lastDayOfMonth(endYear, endMonth);
    if (endDay > actualLastDay) return null;

    const windowStart = isoDate(startYear, startMonth, startDay);
    const windowEnd = isoDate(endYear, endMonth, endDay);

    // Determine primary holdings period from the START month of the window.
    //
    // The filing window corresponds to the holdings period whose deadline falls
    // within that window. Quarterly 13F deadlines are ~45 days after quarter end:
    //
    //   Q1 (Mar 31) → deadline mid-May  → dataset window Mar–May
    //   Q2 (Jun 30) → deadline mid-Aug  → dataset window Jun–Aug
    //   Q3 (Sep 30) → deadline mid-Nov  → dataset window Sep–Nov
    //   Q4 (Dec 31) → deadline mid-Feb  → dataset window Dec–Feb (cross-year)
    //
    // Map start month to holdings quarter/year:
    //   Mar (3)  → Q1 of startYear
    //   Jun (6)  → Q2 of startYear
    //   Sep (9)  → Q3 of startYear
    //   Dec (12) → Q4 of startYear
    let holdingsYear: number;
    let holdingsQ: 1 | 2 | 3 | 4;

    if (startMonth === 3)  { holdingsYear = startYear; holdingsQ = 1; }
    else if (startMonth === 6)  { holdingsYear = startYear; holdingsQ = 2; }
    else if (startMonth === 9)  { holdingsYear = startYear; holdingsQ = 3; }
    else if (startMonth === 12) { holdingsYear = startYear; holdingsQ = 4; }
    else {
      // Unrecognised window start month — derive from quarter containing start month
      holdingsYear = startYear;
      holdingsQ = monthToQuarter(startMonth);
    }

    const expectedPeriodOfReport = periodEnd(holdingsYear, holdingsQ);
    const canonicalPeriodLabel = `${holdingsYear}Q${holdingsQ}`;

    // Build a human-readable label e.g. "Mar 1–May 31, 2026"
    const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const startMon = MONTH_NAMES[startMonth - 1];
    const endMon   = MONTH_NAMES[endMonth - 1];
    const displayLabel = startYear === endYear
      ? `${startMon} ${startDay}–${endMon} ${endDay}, ${startYear}`
      : `${startMon} ${startDay}, ${startYear}–${endMon} ${endDay}, ${endYear}`;

    return {
      publicationModel: "three_month_window",
      windowStart,
      windowEnd,
      holdingsYear,
      holdingsQ,
      expectedPeriodOfReport,
      canonicalPeriodLabel,
      displayLabel,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// HTML catalog parsing (pure — testable without HTTP)
// ---------------------------------------------------------------------------

/**
 * Parse the official SEC Form 13F dataset index HTML page and return
 * normalized catalog entries.
 *
 * Accepts any HTML from the official page URL. Uses regex to extract
 * href attributes — no DOM library needed.
 *
 * Filters:
 *   - href must resolve to sec.gov HTTPS
 *   - filename must end in _form13f.zip
 *   - rejects external hosts
 *   - deduplicates by fileName (first occurrence wins)
 *
 * @param html     Raw HTML of the catalog page
 * @param baseUrl  Base URL for resolving relative hrefs (e.g. "https://www.sec.gov")
 */
export function parseCatalogHtml(
  html: string,
  baseUrl: string = "https://www.sec.gov",
): InstitutionalDatasetCatalogEntry[] {
  const entries = new Map<string, InstitutionalDatasetCatalogEntry>();
  const hrefPattern = /href=["']([^"']+_form13f\.zip)["']/gi;

  let match: RegExpExecArray | null;
  while ((match = hrefPattern.exec(html)) !== null) {
    const rawHref = match[1];

    // Resolve relative URLs
    let resolved: URL;
    try {
      resolved = new URL(rawHref, baseUrl);
    } catch {
      continue; // malformed URL — skip
    }

    // Enforce HTTPS + sec.gov host
    if (resolved.protocol !== "https:") continue;
    if (resolved.hostname !== BULK_DATASET_HOST) continue;

    const fileName = resolved.pathname.split("/").pop() ?? "";
    if (!fileName.endsWith("_form13f.zip")) continue;

    // Deduplicate
    if (entries.has(fileName)) continue;

    // Parse the filename
    const parsed = parseDatasetFileName(fileName);
    if (!parsed) continue;

    const entry: InstitutionalDatasetCatalogEntry = {
      downloadUrl: resolved.href,
      fileName,
      displayLabel: parsed.displayLabel,
      windowStart: parsed.windowStart,
      windowEnd: parsed.windowEnd,
      publicationModel: parsed.publicationModel,
      canonicalPeriodLabel: parsed.canonicalPeriodLabel,
      expectedPeriodOfReport: parsed.expectedPeriodOfReport,
    };

    entries.set(fileName, entry);
  }

  // Sort newest-first by windowEnd (ISO sort works for YYYY-MM-DD)
  return Array.from(entries.values()).sort(
    (a, b) => b.windowEnd.localeCompare(a.windowEnd),
  );
}

// ---------------------------------------------------------------------------
// HTTP catalog fetch (with retry and backoff)
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [500, 1500]; // up to 2 retries

async function fetchWithRetry(
  url: string,
  userAgent: string,
  signal?: AbortSignal,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]),
      );
    }
    if (signal?.aborted) throw new Error("Aborted");

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const combined = signal
      ? AbortSignal.any
        ? AbortSignal.any([signal, ctrl.signal])
        : ctrl.signal
      : ctrl.signal;

    try {
      const res = await fetch(url, {
        signal: combined,
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml,*/*",
        },
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching catalog`);
      return await res.text();
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// In-process catalog cache
// ---------------------------------------------------------------------------

interface CatalogCache {
  entries: InstitutionalDatasetCatalogEntry[];
  fetchedAt: number;
}

let _catalogCache: CatalogCache | null = null;

/**
 * Fetch and parse the official SEC Form 13F dataset catalog.
 * Not cached — use getCachedCatalog for production calls.
 *
 * @param userAgent SEC_USER_AGENT string (required)
 * @param signal    Optional abort signal
 */
export async function fetchDatasetCatalog(
  userAgent: string,
  signal?: AbortSignal,
): Promise<InstitutionalDatasetCatalogEntry[]> {
  const html = await fetchWithRetry(CATALOG_PAGE_URL, userAgent, signal);
  return parseCatalogHtml(html, "https://www.sec.gov");
}

/**
 * Return the cached catalog, refreshing if older than 5 minutes.
 * Safe to call repeatedly — only makes one HTTP request per TTL window.
 *
 * Do NOT call from ordinary user page request handlers.
 *
 * @param userAgent SEC_USER_AGENT string (required)
 */
export async function getCachedCatalog(
  userAgent: string,
): Promise<InstitutionalDatasetCatalogEntry[]> {
  const now = Date.now();
  if (_catalogCache && now - _catalogCache.fetchedAt < CATALOG_CACHE_TTL_MS) {
    return _catalogCache.entries;
  }
  const entries = await fetchDatasetCatalog(userAgent);
  _catalogCache = { entries, fetchedAt: now };
  return entries;
}

/** Evict the catalog cache (used in tests). */
export function evictCatalogCache(): void {
  _catalogCache = null;
}

// ---------------------------------------------------------------------------
// Dataset window selection
// ---------------------------------------------------------------------------

export interface SelectedDatasetWindow {
  entry: InstitutionalDatasetCatalogEntry;
  /** ISO date of the primary expected holdings period of report */
  expectedPeriodOfReport: string;
  /** Human-readable quarter label e.g. "2026Q1" */
  canonicalPeriodLabel: string;
}

/**
 * From a sorted catalog (newest-first), select enough entries to cover
 * at least `n` distinct expected holdings periods of report.
 *
 * --quarters 2 means "cover the 2 most recent distinct holdings periods",
 * not simply "download 2 ZIPs".
 *
 * Duplicate holdings periods (e.g. from amendments appearing as separate
 * catalog entries) are collapsed — the most-recent entry for each period wins.
 *
 * @param n        Number of distinct holdings periods to cover
 * @param catalog  Catalog entries sorted newest-first (from getCachedCatalog)
 */
export function selectDatasetWindows(
  n: number,
  catalog: InstitutionalDatasetCatalogEntry[],
): SelectedDatasetWindow[] {
  const seen = new Set<string>(); // by expectedPeriodOfReport
  const selected: SelectedDatasetWindow[] = [];

  for (const entry of catalog) {
    if (selected.length >= n) break;
    const key = entry.expectedPeriodOfReport;
    if (seen.has(key)) continue; // duplicate period — skip
    seen.add(key);
    selected.push({
      entry,
      expectedPeriodOfReport: entry.expectedPeriodOfReport,
      canonicalPeriodLabel: entry.canonicalPeriodLabel,
    });
  }

  return selected;
}

/**
 * Convert a SelectedDatasetWindow to a DatasetDescriptor for ingestion.
 */
export function toDatasetDescriptor(
  window: SelectedDatasetWindow,
): DatasetDescriptor {
  const parsed = parseDatasetFileName(window.entry.fileName)!;
  return {
    downloadUrl: window.entry.downloadUrl,
    fileName: window.entry.fileName,
    windowStart: window.entry.windowStart,
    windowEnd: window.entry.windowEnd,
    expectedPeriodOfReport: window.expectedPeriodOfReport,
    year: parsed.holdingsYear,
    q: parsed.holdingsQ,
  };
}
