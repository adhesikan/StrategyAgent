// Institutional Fund Service — Sprint 2.3.2
//
// Provides manager-level views of SEC Form 13F data for the Fund Explorer.
//
// KEY PRINCIPLES:
//   - Only effective filings (is_effective = true). Never double-counts amendments.
//   - All "value" fields in DB are in CANONICAL US DOLLARS (post-2023 SEC bulk data
//     reports VALUE in dollars, not thousands). The ×1000 multiplier that was here
//     previously was removed — do NOT re-add it. formatPortfolioValue() handles display.
//   - Amendment supersession is handled upstream in the ingestion pipeline; this
//     layer simply filters is_effective = true.
//   - No AI scores, no recommendations, no conviction language.
//   - Missing data is represented explicitly — never fabricated.
//   - 13F data is always delayed; every public response carries a disclosure.
//
// MANAGER IDENTITY:
//   managerId = filerCik (10-digit zero-padded CIK string, SEC standard).
//
// QUARTER FORMAT:
//   External: "2024-Q3" (derived from period_of_report date "2024-09-30")
//   Internal DB: period_of_report is stored as a date string.

import { db } from "../../db";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChangeType = "NEW" | "INCREASED" | "UNCHANGED" | "REDUCED" | "EXITED";

export type FundSortOption =
  | "reportedPortfolioValue"
  | "positionCount"
  | "newPositions"
  | "largestChanges"
  | "managerName";

export interface FundSummary {
  managerId: string;
  managerName: string;
  latestQuarter: string;
  reportedPortfolioValue: number;
  reportedPositionCount: number;
  quarterChangePositionCount: number;
  newPositionsCount: number;
  exitedPositionsCount: number;
  increasedPositionsCount: number;
  reducedPositionsCount: number;
  lastFiledAt: string;
  hasPreviousQuarter: boolean;
}

export interface FundDirectoryResult {
  funds: FundSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FundDirectoryParams {
  search?: string;
  sort?: FundSortOption;
  page?: number;
  pageSize?: number;
}

export interface HoldingRow {
  ticker: string | null;
  issuerName: string;
  cusip: string;
  reportedShares: number;
  reportedValue: number;
  portfolioWeight: number;
  previousShares: number | null;
  shareChange: number | null;
  shareChangePct: number | null;
  changeType: ChangeType;
  mappingStatus: string;
}

export interface FundHoldingsParams {
  quarter?: string;
  search?: string;
  sort?: "value" | "weight" | "change" | "ticker";
  page?: number;
  pageSize?: number;
}

export interface FundHoldingsResult {
  holdings: HoldingRow[];
  total: number;
  page: number;
  pageSize: number;
  quarter: string;
  quarterLabel: string;
}

export interface FundDetail {
  managerId: string;
  managerName: string;
  latestQuarter: string;
  previousQuarter: string | null;
  latestPeriodEndDate: string;
  lastFiledAt: string;
  accessionNumber: string;
  sourceUrl: string | null;
  reportedPortfolioValue: number;
  reportedPositionCount: number;
  newPositionsCount: number;
  exitedPositionsCount: number;
  increasedPositionsCount: number;
  reducedPositionsCount: number;
  quarterChangePositionCount: number;
  topHoldings: HoldingRow[];
  newPositions: HoldingRow[];
  exitedPositions: HoldingRow[];
  increasedPositions: HoldingRow[];
  reducedPositions: HoldingRow[];
  dataQuality: {
    mappedCount: number;
    unmappedCount: number;
    totalCount: number;
    coveragePercent: number;
    hasPreviousQuarter: boolean;
    isAmended: boolean;
    filingFreshnessDays: number;
  };
  disclosure: {
    filingDelayDisclaimer: string;
    dataAsOf: string;
  };
}

export interface HistoryEntry {
  quarter: string;
  periodEndDate: string;
  reportedPortfolioValue: number;
  positionCount: number;
  newPositions: number;
  exitedPositions: number;
  lastFiledAt: string;
}

export interface SymbolHolderEntry {
  managerId: string;
  managerName: string;
  reportedShares: number;
  reportedValue: number;
  portfolioWeight: number | null;
  changeType: ChangeType;
  previousShares: number | null;
  shareChange: number | null;
  shareChangePct: number | null;
  quarter: string;
}

export interface SymbolHolderReport {
  symbol: string;
  quarter: string | null;
  topHolders: SymbolHolderEntry[];
  newHolders: SymbolHolderEntry[];
  increasedHolders: SymbolHolderEntry[];
  reducedHolders: SymbolHolderEntry[];
  exitedHolders: SymbolHolderEntry[];
  totalHolderCount: number;
  dataAsOf: string | null;
  disclosure: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

export const FILING_DELAY_DISCLAIMER =
  "Form 13F data is reported quarterly and may be filed up to 45 days after quarter-end. " +
  "It does not represent real-time institutional positions.";

/**
 * CIK is 1–10 digits — no letters, no special chars.
 */
export function isValidManagerId(managerId: string): boolean {
  return /^\d{1,10}$/.test(String(managerId ?? "").trim());
}

/**
 * Normalize to 10-digit zero-padded CIK string (SEC standard).
 */
export function normalizeManagerId(managerId: string): string {
  const stripped = String(managerId ?? "").trim().replace(/^0+/, "") || "0";
  return stripped.padStart(10, "0");
}

/**
 * Convert a period_of_report date string ("2024-09-30") to quarter label ("2024-Q3").
 */
export function dateToQuarterLabel(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown";
  try {
    const parts = dateStr.split("T")[0].split("-");
    const year  = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    if (!year || !month || month < 1 || month > 12) return "Unknown";
    const quarter = Math.ceil(month / 3);
    return `${year}-Q${quarter}`;
  } catch {
    return "Unknown";
  }
}

/**
 * Portfolio weight as a percentage (2 decimal places).
 * Returns 0 when totalPortfolioValue is zero or negative.
 */
export function computePortfolioWeight(
  holdingValue: number,
  totalPortfolioValue: number,
): number {
  if (!totalPortfolioValue || totalPortfolioValue <= 0) return 0;
  return Math.round((holdingValue / totalPortfolioValue) * 10000) / 100;
}

/**
 * Classify the quarter-over-quarter change type for a position.
 */
export function classifyChangeType(
  latestShares: number | null,
  previousShares: number | null,
): ChangeType {
  if (latestShares === null) return "EXITED";
  if (previousShares === null) return "NEW";
  if (latestShares > previousShares) return "INCREASED";
  if (latestShares < previousShares) return "REDUCED";
  return "UNCHANGED";
}

/**
 * Compute share delta and percent change.
 * Returns nulls for NEW and EXITED positions (no meaningful delta to compare).
 */
export function computeShareChange(
  latestShares: number | null,
  previousShares: number | null,
): { shareChange: number | null; shareChangePct: number | null } {
  if (latestShares === null || previousShares === null) {
    return { shareChange: null, shareChangePct: null };
  }
  const shareChange = latestShares - previousShares;
  const shareChangePct =
    previousShares > 0
      ? Math.round((shareChange / previousShares) * 10000) / 100
      : null;
  return { shareChange, shareChangePct };
}

/**
 * Build a human-readable SEC EDGAR link for a manager CIK.
 * Uses EDGAR's company search (not the raw filing accession) since
 * accession-based URLs require reformatting.
 */
export function buildEdgarManagerUrl(filerCik: string): string {
  const cikNum = parseInt(filerCik, 10).toString();
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikNum}&type=13F-HR&dateb=&owner=include&count=10`;
}

/**
 * Build EDGAR filing index URL from accession number.
 * Accession format in DB: "0001234567-24-000001" → "000123456724000001"
 */
export function buildEdgarFilingUrl(accessionNumber: string, filerCik: string): string {
  const accNoDash = accessionNumber.replace(/-/g, "");
  const cikPadded = filerCik.padStart(10, "0");
  return `https://www.sec.gov/Archives/edgar/data/${parseInt(filerCik, 10)}/${accNoDash}/${accNoDash}-index.htm`;
}

/**
 * Whether a mapping_status value indicates a reliably resolved ticker.
 */
export function isMappingReliable(mappingStatus: string | null | undefined): boolean {
  return (
    mappingStatus === "approved" ||
    mappingStatus === "mapped"   ||
    mappingStatus === "auto"     ||
    mappingStatus === "verified"
  );
}

/**
 * Filing freshness in calendar days from filing_date to now.
 * Returns -1 if date cannot be parsed.
 */
export function computeFilingFreshnessDays(filingDateStr: string | null | undefined): number {
  if (!filingDateStr) return -1;
  try {
    const filed = new Date(filingDateStr);
    if (isNaN(filed.getTime())) return -1;
    const diffMs = Date.now() - filed.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  } catch {
    return -1;
  }
}

// ---------------------------------------------------------------------------
// Internal DB helper
// ---------------------------------------------------------------------------

async function rawQuery<T = Record<string, unknown>>(
  q: ReturnType<typeof sql>,
): Promise<T[]> {
  const result = await db.execute(q);
  return result.rows as T[];
}

function parseNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseStr(v: unknown): string {
  return String(v ?? "");
}

// ---------------------------------------------------------------------------
// Fund Directory — GET /api/institutional/funds
// ---------------------------------------------------------------------------

const MAX_PAGE_SIZE      = 100;
const DEFAULT_PAGE_SIZE  = 25;

export async function getFundDirectory(
  params: FundDirectoryParams = {},
): Promise<FundDirectoryResult> {
  const page     = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE));
  const offset   = (page - 1) * pageSize;
  const search   = (params.search ?? "").trim();

  // Sort expression: only trusted enum values, no user data
  const sortSql: Record<FundSortOption, string> = {
    reportedPortfolioValue: "portfolio_value DESC NULLS LAST",
    positionCount:          "position_count DESC NULLS LAST",
    newPositions:           "new_count DESC NULLS LAST",
    largestChanges:         "(new_count + exited_count + increased_count + reduced_count) DESC NULLS LAST",
    managerName:            "manager_name ASC NULLS LAST",
  };
  const sortStr = sortSql[params.sort ?? "reportedPortfolioValue"] ??
    sortSql.reportedPortfolioValue;

  type DirRow = {
    manager_id: string;
    manager_name: string;
    latest_period: string;
    last_filed_at: string;
    portfolio_value: string | number;
    position_count: string | number;
    new_count: string | number;
    exited_count: string | number;
    increased_count: string | number;
    reduced_count: string | number;
    has_prev: boolean | string;
    total_count: string | number;
  };

  const rows = await rawQuery<DirRow>(sql`
    WITH effective_filings AS (
      SELECT
        filer_cik,
        filer_name,
        period_of_report,
        accession_number,
        filing_date,
        ROW_NUMBER() OVER (
          PARTITION BY filer_cik
          ORDER BY period_of_report DESC, filing_date DESC
        ) AS period_rank
      FROM institutional_13f_filings
      WHERE is_effective = true
    ),
    latest_filing AS (SELECT * FROM effective_filings WHERE period_rank = 1),
    prev_filing   AS (SELECT * FROM effective_filings WHERE period_rank = 2),
    latest_h AS (
      SELECT lf.filer_cik, h.cusip, h.reported_shares, h.reported_value
      FROM institutional_13f_holdings h
      JOIN latest_filing lf ON h.accession_number = lf.accession_number
    ),
    prev_h AS (
      SELECT pf.filer_cik, h.cusip, h.reported_shares
      FROM institutional_13f_holdings h
      JOIN prev_filing pf ON h.accession_number = pf.accession_number
    ),
    combined AS (
      SELECT
        COALESCE(l.filer_cik, p.filer_cik) AS filer_cik,
        CASE WHEN l.cusip IS NOT NULL AND p.cusip IS NULL THEN 1 ELSE 0 END AS is_new,
        CASE WHEN l.cusip IS NULL AND p.cusip IS NOT NULL THEN 1 ELSE 0 END AS is_exited,
        CASE WHEN l.reported_shares IS NOT NULL AND p.reported_shares IS NOT NULL
             AND l.reported_shares > p.reported_shares THEN 1 ELSE 0 END AS is_increased,
        CASE WHEN l.reported_shares IS NOT NULL AND p.reported_shares IS NOT NULL
             AND l.reported_shares < p.reported_shares THEN 1 ELSE 0 END AS is_reduced
      FROM latest_h l
      FULL OUTER JOIN prev_h p ON l.filer_cik = p.filer_cik AND l.cusip = p.cusip
    ),
    qoq AS (
      SELECT filer_cik,
        SUM(is_new)::int       AS new_count,
        SUM(is_exited)::int    AS exited_count,
        SUM(is_increased)::int AS increased_count,
        SUM(is_reduced)::int   AS reduced_count
      FROM combined
      GROUP BY filer_cik
    ),
    portfolio AS (
      SELECT filer_cik,
        SUM(reported_value)::bigint AS portfolio_value,
        COUNT(*)::int               AS position_count
      FROM latest_h
      GROUP BY filer_cik
    ),
    manager_rows AS (
      SELECT
        lf.filer_cik                               AS manager_id,
        lf.filer_name                              AS manager_name,
        lf.period_of_report::text                  AS latest_period,
        lf.filing_date::text                       AS last_filed_at,
        COALESCE(p.portfolio_value, 0)             AS portfolio_value,
        COALESCE(p.position_count, 0)              AS position_count,
        COALESCE(qoq.new_count, 0)                 AS new_count,
        COALESCE(qoq.exited_count, 0)              AS exited_count,
        COALESCE(qoq.increased_count, 0)           AS increased_count,
        COALESCE(qoq.reduced_count, 0)             AS reduced_count,
        EXISTS(SELECT 1 FROM prev_filing pf WHERE pf.filer_cik = lf.filer_cik) AS has_prev
      FROM latest_filing lf
      LEFT JOIN portfolio p   ON p.filer_cik   = lf.filer_cik
      LEFT JOIN qoq           ON qoq.filer_cik = lf.filer_cik
      WHERE (${search} = '' OR UPPER(lf.filer_name) LIKE UPPER(${`%${search}%`}))
    ),
    counted AS (
      SELECT *, COUNT(*) OVER() AS total_count FROM manager_rows
    )
    SELECT * FROM counted
    ORDER BY ${sql.raw(sortStr)}
    LIMIT ${pageSize} OFFSET ${offset}
  `);

  const total  = rows.length > 0 ? parseNum(rows[0].total_count) : 0;
  const funds: FundSummary[] = rows.map(r => {
    const newC  = parseNum(r.new_count);
    const exitC = parseNum(r.exited_count);
    const incC  = parseNum(r.increased_count);
    const redC  = parseNum(r.reduced_count);
    return {
      managerId:                parseStr(r.manager_id),
      managerName:              parseStr(r.manager_name),
      latestQuarter:            dateToQuarterLabel(parseStr(r.latest_period)),
      reportedPortfolioValue:   parseNum(r.portfolio_value),
      reportedPositionCount:    parseNum(r.position_count),
      newPositionsCount:        newC,
      exitedPositionsCount:     exitC,
      increasedPositionsCount:  incC,
      reducedPositionsCount:    redC,
      quarterChangePositionCount: newC + exitC + incC + redC,
      lastFiledAt:              parseStr(r.last_filed_at),
      hasPreviousQuarter:       r.has_prev === true || r.has_prev === "true",
    };
  });

  return { funds, total, page, pageSize };
}

// ---------------------------------------------------------------------------
// Fund Detail — GET /api/institutional/funds/:managerId
// ---------------------------------------------------------------------------

export async function getFundDetail(managerId: string): Promise<FundDetail | null> {
  // Step 1: find latest 2 effective filings for this manager
  type FilingRow = {
    filer_cik: string;
    filer_name: string;
    period_of_report: string;
    accession_number: string;
    filing_date: string;
    amendment_flag: boolean | string;
    source_url: string | null;
    period_rank: string | number;
  };

  const filings = await rawQuery<FilingRow>(sql`
    SELECT
      filer_cik, filer_name, period_of_report::text, accession_number,
      filing_date::text, amendment_flag, source_url,
      ROW_NUMBER() OVER (
        PARTITION BY filer_cik
        ORDER BY period_of_report DESC, filing_date DESC
      ) AS period_rank
    FROM institutional_13f_filings
    WHERE is_effective = true
      AND filer_cik = ${managerId}
    ORDER BY period_of_report DESC, filing_date DESC
    LIMIT 2
  `);

  if (filings.length === 0) return null;

  const latest = filings[0];
  const prev   = filings.length > 1 ? filings[1] : null;

  // Step 2: load latest holdings
  type HoldingDbRow = {
    cusip: string;
    issuer_name: string;
    reported_shares: string | number;
    reported_value: string | number;
    mapped_symbol: string | null;
    mapping_status: string | null;
  };

  const [latestHoldings, prevHoldings] = await Promise.all([
    rawQuery<HoldingDbRow>(sql`
      SELECT cusip, issuer_name, reported_shares, reported_value,
             mapped_symbol, mapping_status
      FROM institutional_13f_holdings
      WHERE accession_number = ${latest.accession_number}
      ORDER BY reported_value DESC
    `),
    prev
      ? rawQuery<HoldingDbRow>(sql`
          SELECT cusip, reported_shares
          FROM institutional_13f_holdings
          WHERE accession_number = ${prev.accession_number}
        `)
      : Promise.resolve<HoldingDbRow[]>([]),
  ]);

  // Step 3: build lookup maps
  const prevShareMap = new Map<string, number>();
  for (const h of prevHoldings) {
    prevShareMap.set(h.cusip, parseNum(h.reported_shares));
  }

  const totalValue = latestHoldings.reduce((s, h) => s + parseNum(h.reported_value), 0);

  // Step 4: build holding rows with QoQ classification
  const holdingRows: HoldingRow[] = latestHoldings.map(h => {
    const prevShares  = prev ? (prevShareMap.get(h.cusip) ?? null) : null;
    const latShares   = parseNum(h.reported_shares);
    const latValue    = parseNum(h.reported_value);
    const { shareChange, shareChangePct } = computeShareChange(latShares, prevShares);
    const ticker = isMappingReliable(h.mapping_status) ? (h.mapped_symbol ?? null) : null;
    return {
      ticker,
      issuerName:      parseStr(h.issuer_name),
      cusip:           parseStr(h.cusip),
      reportedShares:  latShares,
      reportedValue:   latValue,
      portfolioWeight: computePortfolioWeight(latValue, totalValue),
      previousShares:  prevShares,
      shareChange,
      shareChangePct,
      changeType:      classifyChangeType(latShares, prevShares),
      mappingStatus:   parseStr(h.mapping_status) || "unmapped",
    };
  });

  // Step 5: exited positions — in prev but not in latest
  const latestCusips = new Set(latestHoldings.map(h => h.cusip));
  const exitedRows: HoldingRow[] = prevHoldings
    .filter(h => !latestCusips.has(h.cusip))
    .map(h => ({
      ticker:          null,
      issuerName:      parseStr(h.issuer_name),
      cusip:           parseStr(h.cusip),
      reportedShares:  0,
      reportedValue:   0,
      portfolioWeight: 0,
      previousShares:  parseNum(h.reported_shares),
      shareChange:     null,
      shareChangePct:  null,
      changeType:      "EXITED" as ChangeType,
      mappingStatus:   "unmapped",
    }));

  // Step 6: partition into change buckets
  const newPositions      = holdingRows.filter(h => h.changeType === "NEW");
  const increasedPositions = holdingRows.filter(h => h.changeType === "INCREASED");
  const reducedPositions  = holdingRows.filter(h => h.changeType === "REDUCED");
  const topHoldings       = [...holdingRows].sort((a, b) => b.reportedValue - a.reportedValue).slice(0, 20);

  // Step 7: data quality
  const mappedCount   = holdingRows.filter(h => isMappingReliable(h.mappingStatus)).length;
  const unmappedCount = holdingRows.length - mappedCount;
  const coveragePercent =
    holdingRows.length > 0
      ? Math.round((mappedCount / holdingRows.length) * 100)
      : 0;

  const freshnessDays = computeFilingFreshnessDays(latest.filing_date);
  const isAmended     = Boolean(latest.amendment_flag === true || latest.amendment_flag === "true");

  return {
    managerId:    parseStr(latest.filer_cik),
    managerName:  parseStr(latest.filer_name),
    latestQuarter:          dateToQuarterLabel(latest.period_of_report),
    previousQuarter:        prev ? dateToQuarterLabel(prev.period_of_report) : null,
    latestPeriodEndDate:    latest.period_of_report,
    lastFiledAt:            latest.filing_date,
    accessionNumber:        latest.accession_number,
    sourceUrl:              latest.source_url ?? null,
    reportedPortfolioValue: totalValue,
    reportedPositionCount:  holdingRows.length,
    newPositionsCount:      newPositions.length,
    exitedPositionsCount:   exitedRows.length,
    increasedPositionsCount: increasedPositions.length,
    reducedPositionsCount:  reducedPositions.length,
    quarterChangePositionCount:
      newPositions.length + exitedRows.length + increasedPositions.length + reducedPositions.length,
    topHoldings,
    newPositions:       newPositions.sort((a, b) => b.reportedValue - a.reportedValue),
    exitedPositions:    exitedRows,
    increasedPositions: increasedPositions.sort((a, b) => b.reportedValue - a.reportedValue),
    reducedPositions:   reducedPositions.sort((a, b) => b.reportedValue - a.reportedValue),
    dataQuality: {
      mappedCount,
      unmappedCount,
      totalCount:     holdingRows.length,
      coveragePercent,
      hasPreviousQuarter: prev !== null,
      isAmended,
      filingFreshnessDays: freshnessDays,
    },
    disclosure: {
      filingDelayDisclaimer: FILING_DELAY_DISCLAIMER,
      dataAsOf: latest.period_of_report,
    },
  };
}

// ---------------------------------------------------------------------------
// Fund Holdings — GET /api/institutional/funds/:managerId/holdings
// ---------------------------------------------------------------------------

export async function getFundHoldings(
  managerId: string,
  params: FundHoldingsParams = {},
): Promise<FundHoldingsResult | null> {
  const page     = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE));
  const offset   = (page - 1) * pageSize;
  const search   = (params.search ?? "").trim();

  // Determine quarter (accession_number) to load
  type AccRow = { accession_number: string; period_of_report: string; filing_date: string };

  let accessionNumber: string;
  let periodOfReport: string;

  if (params.quarter) {
    // caller specified a quarter — find effective filing for that period
    const accRows = await rawQuery<AccRow>(sql`
      SELECT accession_number, period_of_report::text, filing_date::text
      FROM institutional_13f_filings
      WHERE is_effective = true
        AND filer_cik = ${managerId}
        AND period_of_report::text = ${params.quarter}
      ORDER BY filing_date DESC
      LIMIT 1
    `);
    if (!accRows[0]) return null;
    accessionNumber = accRows[0].accession_number;
    periodOfReport  = accRows[0].period_of_report;
  } else {
    const accRows = await rawQuery<AccRow>(sql`
      SELECT accession_number, period_of_report::text, filing_date::text
      FROM institutional_13f_filings
      WHERE is_effective = true
        AND filer_cik = ${managerId}
      ORDER BY period_of_report DESC, filing_date DESC
      LIMIT 1
    `);
    if (!accRows[0]) return null;
    accessionNumber = accRows[0].accession_number;
    periodOfReport  = accRows[0].period_of_report;
  }

  // Previous period accession for QoQ comparison
  type PrevRow = { accession_number: string };
  const prevAccRows = await rawQuery<PrevRow>(sql`
    SELECT accession_number
    FROM institutional_13f_filings
    WHERE is_effective = true
      AND filer_cik = ${managerId}
      AND period_of_report::text < ${periodOfReport}
    ORDER BY period_of_report DESC, filing_date DESC
    LIMIT 1
  `);
  const prevAccession = prevAccRows[0]?.accession_number ?? null;

  // Portfolio total for weight calculation
  type TotalRow = { total_value: string | number };
  const [totalRows] = await Promise.all([
    rawQuery<TotalRow>(sql`
      SELECT SUM(reported_value)::bigint AS total_value
      FROM institutional_13f_holdings
      WHERE accession_number = ${accessionNumber}
    `),
  ]);
  const totalValue = parseNum(totalRows[0]?.total_value);

  // Sort options (trusted enum, no user data)
  const holdingSortSql: Record<NonNullable<FundHoldingsParams["sort"]>, string> = {
    value:  "h.reported_value DESC",
    weight: "h.reported_value DESC",
    change: "ABS(COALESCE(h.reported_shares - p.reported_shares, 0)) DESC",
    ticker: "COALESCE(h.mapped_symbol, h.issuer_name) ASC",
  };
  const hSortStr = holdingSortSql[params.sort ?? "value"];

  type HRow = {
    cusip: string;
    issuer_name: string;
    reported_shares: string | number;
    reported_value: string | number;
    mapped_symbol: string | null;
    mapping_status: string | null;
    prev_shares: string | number | null;
    total_count: string | number;
  };

  const hRows = await rawQuery<HRow>(
    prevAccession
      ? sql`
          SELECT
            h.cusip, h.issuer_name, h.reported_shares, h.reported_value,
            h.mapped_symbol, h.mapping_status,
            p.reported_shares AS prev_shares,
            COUNT(*) OVER() AS total_count
          FROM institutional_13f_holdings h
          LEFT JOIN institutional_13f_holdings p
            ON p.accession_number = ${prevAccession} AND p.cusip = h.cusip
          WHERE h.accession_number = ${accessionNumber}
            AND (${search} = ''
              OR UPPER(h.issuer_name) LIKE UPPER(${`%${search}%`})
              OR UPPER(COALESCE(h.mapped_symbol, '')) LIKE UPPER(${`%${search}%`}))
          ORDER BY ${sql.raw(hSortStr)}
          LIMIT ${pageSize} OFFSET ${offset}
        `
      : sql`
          SELECT
            h.cusip, h.issuer_name, h.reported_shares, h.reported_value,
            h.mapped_symbol, h.mapping_status,
            NULL AS prev_shares,
            COUNT(*) OVER() AS total_count
          FROM institutional_13f_holdings h
          WHERE h.accession_number = ${accessionNumber}
            AND (${search} = ''
              OR UPPER(h.issuer_name) LIKE UPPER(${`%${search}%`})
              OR UPPER(COALESCE(h.mapped_symbol, '')) LIKE UPPER(${`%${search}%`}))
          ORDER BY ${sql.raw(hSortStr)}
          LIMIT ${pageSize} OFFSET ${offset}
        `,
  );

  const total = hRows.length > 0 ? parseNum(hRows[0].total_count) : 0;

  const holdings: HoldingRow[] = hRows.map(h => {
    const latShares  = parseNum(h.reported_shares);
    const prevShares = h.prev_shares !== null ? parseNum(h.prev_shares) : null;
    const latValue   = parseNum(h.reported_value);
    const { shareChange, shareChangePct } = computeShareChange(latShares, prevShares);
    const ticker = isMappingReliable(h.mapping_status) ? (h.mapped_symbol ?? null) : null;
    return {
      ticker,
      issuerName:      parseStr(h.issuer_name),
      cusip:           parseStr(h.cusip),
      reportedShares:  latShares,
      reportedValue:   latValue,
      portfolioWeight: computePortfolioWeight(latValue, totalValue),
      previousShares:  prevShares,
      shareChange,
      shareChangePct,
      changeType:      classifyChangeType(latShares, prevShares),
      mappingStatus:   parseStr(h.mapping_status) || "unmapped",
    };
  });

  return {
    holdings,
    total,
    page,
    pageSize,
    quarter:      periodOfReport,
    quarterLabel: dateToQuarterLabel(periodOfReport),
  };
}

// ---------------------------------------------------------------------------
// Fund History — GET /api/institutional/funds/:managerId/history
// ---------------------------------------------------------------------------

export async function getFundHistory(managerId: string): Promise<HistoryEntry[]> {
  // Load effective filings + per-period aggregates. Bounded to last 12 quarters.
  type FilingHRow = {
    period_of_report: string;
    filing_date: string;
    accession_number: string;
    period_rank: string | number;
  };

  const filings = await rawQuery<FilingHRow>(sql`
    SELECT DISTINCT ON (period_of_report)
      period_of_report::text, filing_date::text, accession_number,
      ROW_NUMBER() OVER (ORDER BY period_of_report DESC) AS period_rank
    FROM institutional_13f_filings
    WHERE is_effective = true
      AND filer_cik = ${managerId}
    ORDER BY period_of_report DESC, filing_date DESC
    LIMIT 12
  `);

  if (filings.length === 0) return [];

  // For each period, load portfolio value + position count
  type PeriodAgg = {
    accession_number: string;
    portfolio_value: string | number;
    position_count: string | number;
  };

  const accessions = filings.map(f => f.accession_number);
  const aggRows = await rawQuery<PeriodAgg>(sql`
    SELECT accession_number,
      SUM(reported_value)::bigint AS portfolio_value,
      COUNT(*)::int               AS position_count
    FROM institutional_13f_holdings
    WHERE accession_number = ANY(${accessions})
    GROUP BY accession_number
  `);

  const aggMap = new Map(aggRows.map(r => [r.accession_number, r]));

  // QoQ new + exited per period (compare each to the one before it chronologically)
  const result: HistoryEntry[] = [];
  for (let i = 0; i < filings.length; i++) {
    const curr = filings[i];
    const prev = filings[i + 1] ?? null;
    const agg  = aggMap.get(curr.accession_number);

    let newPositions    = 0;
    let exitedPositions = 0;

    if (prev) {
      type CmpRow = { new_count: string | number; exited_count: string | number };
      const cmpRows = await rawQuery<CmpRow>(sql`
        SELECT
          COUNT(CASE WHEN p.cusip IS NULL THEN 1 END)::int AS new_count,
          COUNT(CASE WHEN l.cusip IS NULL THEN 1 END)::int AS exited_count
        FROM institutional_13f_holdings l
        FULL OUTER JOIN institutional_13f_holdings p
          ON p.accession_number = ${prev.accession_number} AND p.cusip = l.cusip
        WHERE COALESCE(l.accession_number, ${curr.accession_number}) = ${curr.accession_number}
          OR p.accession_number = ${prev.accession_number}
      `);
      // Note: FULL OUTER JOIN approach for new/exited needs careful filtering
      // Use a simpler set-difference approach instead:
      type SetRow = { new_count: string | number; exited_count: string | number };
      const setRows = await rawQuery<SetRow>(sql`
        WITH curr_set AS (
          SELECT cusip FROM institutional_13f_holdings WHERE accession_number = ${curr.accession_number}
        ),
        prev_set AS (
          SELECT cusip FROM institutional_13f_holdings WHERE accession_number = ${prev.accession_number}
        )
        SELECT
          (SELECT COUNT(*) FROM curr_set WHERE cusip NOT IN (SELECT cusip FROM prev_set))::int AS new_count,
          (SELECT COUNT(*) FROM prev_set WHERE cusip NOT IN (SELECT cusip FROM curr_set))::int AS exited_count
      `);
      newPositions    = parseNum(setRows[0]?.new_count);
      exitedPositions = parseNum(setRows[0]?.exited_count);
    }

    result.push({
      quarter:               dateToQuarterLabel(curr.period_of_report),
      periodEndDate:         curr.period_of_report,
      reportedPortfolioValue: parseNum(agg?.portfolio_value),
      positionCount:         parseNum(agg?.position_count),
      newPositions,
      exitedPositions,
      lastFiledAt:           curr.filing_date,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Symbol → Fund holders — GET /api/institutional/symbols/:symbol/holders
// ---------------------------------------------------------------------------

export async function getSymbolHolders(symbol: string): Promise<SymbolHolderReport> {
  // Find the latest effective period for this symbol across all managers
  type LatestPeriodRow = { latest_period: string };
  const lpRows = await rawQuery<LatestPeriodRow>(sql`
    SELECT MAX(f.period_of_report)::text AS latest_period
    FROM institutional_13f_holdings h
    JOIN institutional_13f_filings f ON f.accession_number = h.accession_number
    WHERE f.is_effective = true
      AND (
        UPPER(h.mapped_symbol) = UPPER(${symbol})
        OR (h.mapping_status IN ('approved', 'mapped', 'auto', 'verified')
            AND UPPER(h.mapped_symbol) = UPPER(${symbol}))
      )
  `);

  const latestPeriod = lpRows[0]?.latest_period ?? null;
  if (!latestPeriod) {
    return {
      symbol:            symbol.toUpperCase(),
      quarter:           null,
      topHolders:        [],
      newHolders:        [],
      increasedHolders:  [],
      reducedHolders:    [],
      exitedHolders:     [],
      totalHolderCount:  0,
      dataAsOf:          null,
      disclosure:        FILING_DELAY_DISCLAIMER,
    };
  }

  // Find the period before it for QoQ comparison
  type PrevPeriodRow = { prev_period: string };
  const ppRows = await rawQuery<PrevPeriodRow>(sql`
    SELECT MAX(f.period_of_report)::text AS prev_period
    FROM institutional_13f_filings f
    WHERE f.is_effective = true
      AND f.period_of_report::text < ${latestPeriod}
  `);
  const prevPeriod = ppRows[0]?.prev_period ?? null;

  // Load all latest-period holdings for this symbol (effective filings only)
  type HolderRow = {
    filer_cik: string;
    filer_name: string;
    reported_shares: string | number;
    reported_value: string | number;
    accession_number: string;
    manager_total: string | number;
  };

  const holderRows = await rawQuery<HolderRow>(sql`
    SELECT DISTINCT ON (f.filer_cik)
      f.filer_cik, f.filer_name, h.reported_shares, h.reported_value,
      h.accession_number,
      (
        SELECT SUM(reported_value)
        FROM institutional_13f_holdings
        WHERE accession_number = h.accession_number
      ) AS manager_total
    FROM institutional_13f_holdings h
    JOIN institutional_13f_filings f ON f.accession_number = h.accession_number
    WHERE f.is_effective = true
      AND f.period_of_report::text = ${latestPeriod}
      AND UPPER(h.mapped_symbol) = UPPER(${symbol})
    ORDER BY f.filer_cik, h.reported_value DESC
  `);

  // Load previous period holders for QoQ
  const prevHolderMap = new Map<string, number>();
  if (prevPeriod) {
    type PrevHRow = { filer_cik: string; reported_shares: string | number };
    const prevRows = await rawQuery<PrevHRow>(sql`
      SELECT DISTINCT ON (f.filer_cik)
        f.filer_cik, h.reported_shares
      FROM institutional_13f_holdings h
      JOIN institutional_13f_filings f ON f.accession_number = h.accession_number
      WHERE f.is_effective = true
        AND f.period_of_report::text = ${prevPeriod}
        AND UPPER(h.mapped_symbol) = UPPER(${symbol})
      ORDER BY f.filer_cik, h.reported_value DESC
    `);
    for (const r of prevRows) {
      prevHolderMap.set(parseStr(r.filer_cik), parseNum(r.reported_shares));
    }
  }

  // Find managers that held in prev but not latest (exited)
  const latestCiks = new Set(holderRows.map(r => parseStr(r.filer_cik)));
  type ExitedRow = { filer_cik: string; filer_name: string; reported_shares: string | number };
  const exitedRows = prevPeriod
    ? await rawQuery<ExitedRow>(sql`
        SELECT DISTINCT ON (f.filer_cik)
          f.filer_cik, f.filer_name, h.reported_shares
        FROM institutional_13f_holdings h
        JOIN institutional_13f_filings f ON f.accession_number = h.accession_number
        WHERE f.is_effective = true
          AND f.period_of_report::text = ${prevPeriod}
          AND UPPER(h.mapped_symbol) = UPPER(${symbol})
        ORDER BY f.filer_cik, h.reported_value DESC
      `)
    : [];

  const buildEntry = (
    r: { filer_cik: string; filer_name: string; reported_shares: string | number; reported_value?: string | number; manager_total?: string | number },
    latShares: number | null,
    prevShares: number | null,
    latValue: number,
    managerTotal: number,
  ): SymbolHolderEntry => {
    const { shareChange, shareChangePct } = computeShareChange(latShares, prevShares);
    return {
      managerId:    parseStr(r.filer_cik),
      managerName:  parseStr(r.filer_name),
      reportedShares: latShares ?? 0,
      reportedValue:  latValue,
      portfolioWeight: managerTotal > 0 ? computePortfolioWeight(latValue, managerTotal) : null,
      changeType:   classifyChangeType(latShares, prevShares),
      previousShares: prevShares,
      shareChange,
      shareChangePct,
      quarter:      dateToQuarterLabel(latestPeriod),
    };
  };

  const allHolders: SymbolHolderEntry[] = holderRows.map(r => {
    const latShares  = parseNum(r.reported_shares);
    const prevShares = prevHolderMap.get(parseStr(r.filer_cik)) ?? null;
    return buildEntry(r, latShares, prevShares, parseNum(r.reported_value), parseNum(r.manager_total));
  });

  const exitedHolders: SymbolHolderEntry[] = exitedRows
    .filter(r => !latestCiks.has(parseStr(r.filer_cik)))
    .map(r => buildEntry(r, null, parseNum(r.reported_shares), 0, 0));

  const topHolders       = [...allHolders].sort((a, b) => b.reportedValue - a.reportedValue).slice(0, 25);
  const newHolders       = allHolders.filter(h => h.changeType === "NEW").sort((a, b) => b.reportedValue - a.reportedValue);
  const increasedHolders = allHolders.filter(h => h.changeType === "INCREASED").sort((a, b) => b.reportedValue - a.reportedValue);
  const reducedHolders   = allHolders.filter(h => h.changeType === "REDUCED").sort((a, b) => b.reportedValue - a.reportedValue);

  return {
    symbol:           symbol.toUpperCase(),
    quarter:          dateToQuarterLabel(latestPeriod),
    topHolders,
    newHolders,
    increasedHolders,
    reducedHolders,
    exitedHolders:    exitedHolders.sort((a, b) => (b.previousShares ?? 0) - (a.previousShares ?? 0)),
    totalHolderCount: allHolders.length,
    dataAsOf:         latestPeriod,
    disclosure:       FILING_DELAY_DISCLAIMER,
  };
}
