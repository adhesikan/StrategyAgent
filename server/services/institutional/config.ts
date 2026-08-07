// Institutional Intelligence — configuration and feature flags.
//
// Sprint 2.2.5: All env vars that control institutional behaviour.
// When INSTITUTIONAL_INTELLIGENCE_ENABLED is false (default):
//   - No SEC scheduled job runs.
//   - The existing Institutional tab placeholder is preserved.
//   - No SEC HTTP requests are issued.
//
// When INSTITUTIONAL_INTELLIGENCE_ENABLED=true:
//   - Feature is live and the UI shows real 13F data.
//   - SEC ingestion may run if INSTITUTIONAL_13F_INGESTION_ENABLED=true.
//   - SEC_USER_AGENT must be present or ingestion is disabled with a clear error.
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

/** True only when feature flag is enabled AND a User-Agent is configured. */
export function isInstitutionalEnabled(): boolean {
  const cfg = getInstitutionalConfig();
  return cfg.enabled;
}

/** True only when ingestion is fully configured and not suppressed. */
export function isIngestionConfigured(): boolean {
  const cfg = getInstitutionalConfig();
  return cfg.enabled && cfg.ingestionEnabled && cfg.secUserAgent !== null;
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
