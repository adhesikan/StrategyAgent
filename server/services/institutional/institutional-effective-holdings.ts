/**
 * Shared source-of-truth for remediation holding populations.
 *
 * The filing rank is intentional even though ingestion normally leaves only
 * one effective filing per filer/quarter: it makes reads fail closed against
 * an anomalous state with more than one effective filing, and keeps planner
 * and APPLY semantics identical.
 */
export const CANONICAL_EFFECTIVE_HOLDINGS_CTE = `
WITH ranked_filings AS (
  SELECT
    f.accession_number,
    f.filer_cik,
    f.period_of_report,
    f.is_effective,
    ROW_NUMBER() OVER (
      PARTITION BY f.filer_cik, f.period_of_report
      ORDER BY f.is_effective DESC,
               f.accepted_at DESC NULLS LAST,
               f.filing_date DESC,
               f.accession_number DESC
    ) AS filing_rank
  FROM institutional_13f_filings f
),
canonical_filings AS (
  SELECT accession_number, filer_cik, period_of_report
  FROM ranked_filings f
  WHERE f.is_effective = TRUE
    AND f.filing_rank = 1
),
canonical_effective_holdings AS (
  SELECT h.*, f.filer_cik, f.period_of_report
  FROM institutional_13f_holdings h
  JOIN canonical_filings f ON f.accession_number = h.accession_number
  WHERE h.put_call IS NULL
    AND COALESCE(UPPER(h.shares_prn_type), 'SH') <> 'PRN'
    AND h.reported_shares > 0
)`;

export const CANONICAL_EFFECTIVE_HOLDINGS_SCOPE =
  "effective filings ranked by filer and reporting period; null put/call, non-PRN, positive-share holdings";