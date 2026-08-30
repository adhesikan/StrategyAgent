// SEC EDGAR HTTP client — Sprint 2.2.5.
//
// All SEC requests must:
//   - Include a descriptive User-Agent from SEC_USER_AGENT env var.
//   - Use a bounded request rate (max 3 req/s by default, well under SEC limit).
//   - Retry with exponential backoff for retryable failures.
//   - Honor HTTP errors and rate limits.
//   - Use caching for quarterly index files.
//   - Never bypass SEC access controls.
//
// If SEC_USER_AGENT is absent:
//   - Throws SecUserAgentMissingError.
//   - Ingestion is disabled.
//   - No anonymous high-volume requests are issued.

import { getInstitutionalConfig } from "./config";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SecUserAgentMissingError extends Error {
  constructor() {
    super(
      "SEC_USER_AGENT environment variable is not configured. " +
      "Institutional 13F ingestion requires a descriptive User-Agent per SEC fair-access guidelines. " +
      "Set SEC_USER_AGENT to a value like 'AppName contact@example.com' to enable ingestion.",
    );
    this.name = "SecUserAgentMissingError";
  }
}

export class SecHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`SEC EDGAR HTTP ${status} for ${url}`);
    this.name = "SecHttpError";
  }
}

// ---------------------------------------------------------------------------
// Rate limiter — token bucket at ≤3 req/s
// ---------------------------------------------------------------------------

const RATE_LIMIT_INTERVAL_MS = 400; // ~2.5 req/s to stay safely under 10/s
const MAX_RETRY = 3;

let lastRequestAt = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const wait = RATE_LIMIT_INTERVAL_MS - (now - lastRequestAt);
  if (wait > 0) {
    await new Promise<void>((r) => setTimeout(r, wait));
  }
  lastRequestAt = Date.now();
}

// ---------------------------------------------------------------------------
// In-memory cache for quarterly index files (they are immutable once a quarter closes)
// ---------------------------------------------------------------------------

const indexCache = new Map<string, { data: string; cachedAt: number }>();
const INDEX_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

/** Build required headers for every SEC EDGAR request. */
function buildHeaders(userAgent: string): Record<string, string> {
  return {
    "User-Agent": userAgent,
    "Accept": "application/json, text/plain, */*",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
  };
}

/**
 * Fetch a SEC EDGAR URL with rate limiting, retries, and User-Agent enforcement.
 * Returns the response body as text.
 *
 * @param url - Full URL to fetch.
 * @param cacheKey - When provided, the result is cached in memory.
 * @param signal - Optional AbortSignal for timeout.
 */
export async function secFetch(
  url: string,
  cacheKey?: string,
  signal?: AbortSignal,
): Promise<string> {
  const cfg = getInstitutionalConfig();
  if (!cfg.secUserAgent) {
    throw new SecUserAgentMissingError();
  }

  // Check cache
  if (cacheKey) {
    const cached = indexCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < INDEX_CACHE_TTL_MS) {
      return cached.data;
    }
  }

  const headers = buildHeaders(cfg.secUserAgent);
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    if (attempt > 0) {
      const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 10_000);
      await new Promise<void>((r) => setTimeout(r, backoffMs));
    }

    await rateLimit();

    try {
      const res = await fetch(url, { headers, signal });

      if (res.status === 429 || res.status === 503) {
        // Rate limited — wait longer
        const retryAfterMs = parseInt(res.headers.get("Retry-After") ?? "5", 10) * 1000;
        await new Promise<void>((r) => setTimeout(r, Math.min(retryAfterMs, 30_000)));
        continue;
      }

      if (!res.ok) {
        throw new SecHttpError(res.status, url);
      }

      const text = await res.text();

      if (cacheKey) {
        indexCache.set(cacheKey, { data: text, cachedAt: Date.now() });
      }

      return text;
    } catch (err: any) {
      if (err instanceof SecHttpError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        // Non-retryable client error (404, 403, etc.)
        throw err;
      }
      lastErr = err;
    }
  }

  throw lastErr ?? new Error(`SEC fetch failed after ${MAX_RETRY} attempts: ${url}`);
}

/** Fetch as Buffer (for binary files). */
export async function secFetchBuffer(url: string, signal?: AbortSignal): Promise<Buffer> {
  const cfg = getInstitutionalConfig();
  if (!cfg.secUserAgent) throw new SecUserAgentMissingError();

  const headers = buildHeaders(cfg.secUserAgent);
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    if (attempt > 0) {
      const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 10_000);
      await new Promise<void>((r) => setTimeout(r, backoffMs));
    }
    await rateLimit();

    try {
      const res = await fetch(url, { headers, signal });
      if (!res.ok) throw new SecHttpError(res.status, url);
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } catch (err: any) {
      if (err instanceof SecHttpError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw err;
      }
      lastErr = err;
    }
  }

  throw lastErr ?? new Error(`SEC fetch buffer failed: ${url}`);
}

// ---------------------------------------------------------------------------
// EDGAR URL helpers
// ---------------------------------------------------------------------------

const EDGAR_BASE = "https://www.sec.gov";
const EDGAR_DATA_BASE = "https://data.sec.gov";

/**
 * URL for the EDGAR quarterly company index (text format).
 * Example: https://www.sec.gov/Archives/edgar/full-index/2024/QTR1/company.idx
 */
export function quarterlyIndexUrl(year: number, qtr: string): string {
  return `${EDGAR_BASE}/Archives/edgar/full-index/${year}/${qtr}/company.idx`;
}

/**
 * URL for the EDGAR filing index page (header) for a given CIK + accession.
 * Accession number should be normalized without dashes, e.g. "000136474224000007".
 */
export function filingIndexUrl(cik: string, accessionNoDashes: string): string {
  const normalizedAccession = accessionNoDashes.replace(/-/g, "");
  if (!/^\d{18}$/.test(normalizedAccession)) {
    throw new Error("SEC_ACCESSION_INVALID: expected 18 digits (10-2-6)");
  }
  if (!/^\d+$/.test(cik.trim())) {
    throw new Error("SEC_CIK_INVALID: expected numeric CIK");
  }
  const cikTrimmed = cik.replace(/^0+/, "");
  const accessionDashed = normalizedAccession.replace(/^(\d{10})(\d{2})(\d{6})$/, "$1-$2-$3");
  return `${EDGAR_BASE}/Archives/edgar/data/${cikTrimmed}/${normalizedAccession}/${accessionDashed}-index.html`;
}

/**
 * Direct document URL for a known document within a filing.
 */
export function filingDocUrl(cik: string, accessionNoDashes: string, docFilename: string): string {
  const cikTrimmed = cik.replace(/^0+/, "");
  return `${EDGAR_BASE}/Archives/edgar/data/${cikTrimmed}/${accessionNoDashes}/${docFilename}`;
}

/**
 * URL for the EDGAR submissions JSON for a CIK.
 * Returns recent filing history without downloading full documents.
 */
export function submissionsUrl(cik: string): string {
  const padded = cik.replace(/^0+/, "").padStart(10, "0");
  return `${EDGAR_DATA_BASE}/submissions/CIK${padded}.json`;
}

// ---------------------------------------------------------------------------
// Quarterly index parsing
// ---------------------------------------------------------------------------

export interface IndexEntry {
  companyName: string;
  formType: string;
  dateFiled: string;
  filename: string;
  /** Normalized accession number (no dashes) derived from filename */
  accessionNumber: string;
  /** CIK extracted from filename */
  cik: string;
}

/**
 * Parse the EDGAR company.idx fixed-width text format.
 * Only returns rows matching the given formTypes filter (default 13F-HR types).
 */
export function parseQuarterlyIndex(
  text: string,
  formTypes: string[] = ["13F-HR", "13F-HR/A"],
): IndexEntry[] {
  const entries: IndexEntry[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    // The file is pipe-delimited in newer versions or fixed-width; try both.
    // Modern EDGAR full-index company.idx is pipe-delimited:
    // Company Name|Form Type|CIK|Date Filed|Filename
    const parts = line.includes("|") ? line.split("|") : null;
    if (!parts || parts.length < 5) continue;

    const companyName = (parts[0] ?? "").trim();
    const formType = (parts[1] ?? "").trim();
    const cikRaw = (parts[2] ?? "").trim();
    const dateFiled = (parts[3] ?? "").trim();
    const filename = (parts[4] ?? "").trim();

    if (!formTypes.includes(formType)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFiled)) continue;
    if (!filename) continue;

    // Extract CIK from filename path: edgar/data/{CIK}/{accession}.txt
    const cikMatch = filename.match(/edgar\/data\/(\d+)\//);
    const cik = cikMatch ? cikMatch[1] : cikRaw;
    if (!cik) continue;

    // Extract accession number from filename
    const accMatch = filename.match(/\/([0-9-]+)\.[a-z]+$/i);
    if (!accMatch) continue;
    const accessionNoDashes = accMatch[1].replace(/-/g, "");
    if (accessionNoDashes.length < 10) continue;

    entries.push({
      companyName,
      formType,
      dateFiled,
      filename,
      accessionNumber: accessionNoDashes,
      cik,
    });
  }

  return entries;
}
