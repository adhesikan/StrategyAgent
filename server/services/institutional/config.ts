// Institutional Intelligence — configuration and feature flags.
//
// Sprint 2.2.5 (updated: separate UI and ingestion gates).
//
// ── Variable responsibilities ────────────────────────────────────────────────
// INSTITUTIONAL_INTELLIGENCE_ENABLED (default: false)
//   Controls only the user-facing API and UI.
//   When false: /api/institutional/:symbol returns { status: "unavailable" }.
//   Does NOT gate ingestion — data can be backfilled while the tab is disabled.
//
// INSTITUTIONAL_13F_INGESTION_ENABLED (default: true)
//   Controls scheduled and manual 13F ingestion.
//   Can run independently of the public feature flag.
//
// SEC_USER_AGENT (required for any SEC HTTP request)
//   Must be set to a descriptive value per SEC fair-access guidelines.
//   Ingestion is hard-blocked when absent.
//
// ── Safe ingestion gate (isIngestionConfigured) ──────────────────────────────
//   INSTITUTIONAL_13F_INGESTION_ENABLED=true
//   AND SEC_USER_AGENT is configured
//   (Does NOT require INSTITUTIONAL_INTELLIGENCE_ENABLED=true)
//
// Advisory lock key: 774_412_003 (distinct from opportunity engine 774_412_002).

export const INSTITUTIONAL_ADVISORY_LOCK_KEY = 774_412_003;

export interface InstitutionalConfig {
  enabled: boolean;
  ingestionEnabled: boolean;
  secUserAgent: string | null;
  backfillQuarters: number;
}

function parseBool(raw: string | undefined, def: boolean): boolean {
  if (raw === undefined) return def;
  return raw.toLowerCase() === "true" || raw === "1";
}

function parseBackfillQuarters(raw: string | undefined): number {
  const n = parseInt(raw ?? "8", 10);
  if (!Number.isFinite(n) || n < 2 || n > 24) return 8;
  return n;
}

export function getInstitutionalConfig(): InstitutionalConfig {
  const enabled = parseBool(process.env.INSTITUTIONAL_INTELLIGENCE_ENABLED, false);
  const ingestionEnabled = parseBool(process.env.INSTITUTIONAL_13F_INGESTION_ENABLED, true);
  const secUserAgent = (process.env.SEC_USER_AGENT ?? "").trim() || null;
  const backfillQuarters = parseBackfillQuarters(process.env.INSTITUTIONAL_13F_BACKFILL_QUARTERS);
  return { enabled, ingestionEnabled, secUserAgent, backfillQuarters };
}

/** True when the user-facing institutional API should serve real 13F data. */
export function isInstitutionalEnabled(): boolean {
  const cfg = getInstitutionalConfig();
  return cfg.enabled;
}

/**
 * True when 13F ingestion can run.
 *
 * Intentionally does NOT require INSTITUTIONAL_INTELLIGENCE_ENABLED=true.
 * This allows an operator to backfill data while the public tab is still
 * disabled, completing the full activation sequence before exposing the UI.
 *
 * Gate:
 *   INSTITUTIONAL_13F_INGESTION_ENABLED=true (default)
 *   AND SEC_USER_AGENT is configured
 */
export function isIngestionConfigured(): boolean {
  const cfg = getInstitutionalConfig();
  return cfg.ingestionEnabled && cfg.secUserAgent !== null;
}

/**
 * Number of new (non-skipped) accessions to persist per scheduled invocation.
 *
 * Controls INSTITUTIONAL_ACCESSIONS_PER_RUN (default: 300, range: 50–2000).
 *
 * At current throughput (~195 holdings/sec, ~355 avg holdings/accession),
 * 300 new accessions ≈ 9 minutes of persistence work — safely within the
 * 10–15 minute target per daily run.
 *
 * Increase this value (up to 2000) as throughput improves (e.g. after Task #97
 * implements batch existence checks).
 *
 * Environment variable: INSTITUTIONAL_ACCESSIONS_PER_RUN
 * Default:              300
 * Range:                50–2000  (values outside range fall back to 300)
 */
export function getAccessionsPerRun(): number {
  const raw = process.env.INSTITUTIONAL_ACCESSIONS_PER_RUN;
  if (!raw) return 300;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 50 || n > 2_000) return 300;
  return n;
}

/**
 * Stale-run threshold in minutes.
 *
 * Runs whose last_heartbeat_at (or started_at if no heartbeat) is older than
 * this threshold are considered stale and marked partial at daily-job startup.
 *
 * Environment variable: INSTITUTIONAL_STALE_RUN_THRESHOLD_MINUTES
 * Default:              30
 * Range:                10–120
 */
export function getStaleRunThresholdMinutes(): number {
  const raw = process.env.INSTITUTIONAL_STALE_RUN_THRESHOLD_MINUTES;
  if (!raw) return 30;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 10 || n > 120) return 30;
  return n;
}

/**
 * Parse a quarter label string into its components.
 * Accepts both "2026-Q2" (internal) and "2026Q2" (CLI shorthand).
 * Returns null for invalid inputs.
 */
export function parseQuarterLabel(
  label: string,
): { year: number; q: 1 | 2 | 3 | 4; periodEnd: string; label: string } | null {
  // Normalise: strip whitespace, accept "2026Q2" or "2026-Q2"
  const normalised = label.trim().replace(/^(\d{4})-?Q(\d)$/i, "$1-Q$2");
  const match = normalised.match(/^(\d{4})-Q([1-4])$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const q = parseInt(match[2], 10) as 1 | 2 | 3 | 4;
  if (year < 2013 || year > 2035) return null; // sanity: 13F mandate since 1978, future cap
  return { year, q, periodEnd: periodEndDate(year, q), label: `${year}-Q${q}` };
}

/**
 * Derive the fiscal quarter label and period-end date from a calendar date.
 * 13F quarters end: Q1 = Mar 31, Q2 = Jun 30, Q3 = Sep 30, Q4 = Dec 31.
 */
export function quarterFromPeriodDate(periodDate: string): string {
  const d = new Date(periodDate);
  const month = d.getUTCMonth() + 1; // 1-12
  const year = d.getUTCFullYear();
  let q: number;
  if (month <= 3) q = 1;
  else if (month <= 6) q = 2;
  else if (month <= 9) q = 3;
  else q = 4;
  return `${year}-Q${q}`;
}

/** Return the SEC EDGAR quarter string (QTR1–QTR4) from a date. */
export function secEdgarQuarter(date: Date): string {
  const month = date.getUTCMonth() + 1;
  const q = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
  return `QTR${q}`;
}

/** Return the fiscal quarter period-end ISO date string for a given year + quarter. */
export function periodEndDate(year: number, q: 1 | 2 | 3 | 4): string {
  const ends: Record<number, string> = {
    1: `${year}-03-31`,
    2: `${year}-06-30`,
    3: `${year}-09-30`,
    4: `${year}-12-31`,
  };
  return ends[q];
}

/**
 * List the N most-recent completed quarters (period-end dates) working backwards
 * from the most recently ended quarter before `asOf`.
 */
export function recentQuarters(n: number, asOf: Date = new Date()): Array<{ year: number; q: 1 | 2 | 3 | 4; periodEnd: string; label: string }> {
  const quarters: Array<{ year: number; q: 1 | 2 | 3 | 4; periodEnd: string; label: string }> = [];
  let year = asOf.getUTCFullYear();
  let month = asOf.getUTCMonth() + 1;
  // Step back to the most recently completed quarter
  let q: 1 | 2 | 3 | 4;
  if (month > 9) { q = 3; }        // Q4 not yet complete if month <= 12 but filings aren't in for 45 days
  else if (month > 6) { q = 2; }
  else if (month > 3) { q = 1; }
  else { q = 4; year -= 1; }

  for (let i = 0; i < n; i++) {
    quarters.push({ year, q, periodEnd: periodEndDate(year, q), label: `${year}-Q${q}` });
    if (q === 1) { q = 4; year -= 1; }
    else { q = (q - 1) as 2 | 3 | 4; }
  }
  return quarters;
}
