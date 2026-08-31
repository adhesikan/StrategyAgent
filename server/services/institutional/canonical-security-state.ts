/**
 * Canonical effective-holding scope shared by the read-only verifier and the
 * remediation analyzer. Identity trust is resolved from exact/reviewed
 * persisted mapping evidence; asset type is read from security_master.
 */
export const canonicalSecurityTypeStateQuery = `
WITH eligible_cusips AS (
  SELECT DISTINCT h.cusip
  FROM institutional_13f_holdings h
  JOIN institutional_13f_filings f ON f.accession_number = h.accession_number
  WHERE f.is_effective = TRUE
    AND h.put_call IS NULL
    AND COALESCE(UPPER(h.shares_prn_type), 'SH') <> 'PRN'
    AND h.reported_shares > 0
), evidence AS (
  SELECT cusip, mapped_symbol AS symbol, mapping_status AS status, NULL::text AS asset_type
  FROM institutional_security_mappings
  UNION ALL
  SELECT cusip, ticker AS symbol, review_status AS status, asset_type
  FROM security_master
), trusted AS (
  SELECT cusip
  FROM evidence
  GROUP BY cusip
  HAVING COUNT(DISTINCT NULLIF(UPPER(TRIM(symbol)), ''))
           FILTER (WHERE LOWER(COALESCE(status, '')) IN ('exact', 'reviewed')) = 1
     AND BOOL_OR(LOWER(COALESCE(status, '')) = 'rejected') IS NOT TRUE
), canonical AS (
  SELECT e.cusip, MAX(sm.asset_type) AS asset_type
  FROM eligible_cusips e
  JOIN trusted t ON t.cusip = e.cusip
  LEFT JOIN security_master sm ON sm.cusip = e.cusip
  GROUP BY e.cusip
)
SELECT
  COUNT(*)::int AS trusted_cusips,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(asset_type), '') IS NOT NULL)::int AS asset_type_populated,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(asset_type), '') IS NULL)::int AS asset_type_missing,
  COUNT(*) FILTER (WHERE asset_type IN ('common_stock', 'reit'))::int AS stock_eligible_cusips,
   COUNT(*) FILTER (WHERE asset_type IN ('etf', 'mutual_fund', 'closed_end_fund', 'money_market_fund', 'other_pooled_fund'))::int AS separate_fund_cusips,
  COUNT(*) FILTER (WHERE asset_type IS NULL OR asset_type NOT IN (
     'common_stock', 'reit', 'etf', 'mutual_fund', 'closed_end_fund', 'money_market_fund', 'other_pooled_fund'
  ))::int AS unsupported_or_insufficient_cusips
FROM canonical`;

export interface CanonicalEligibilityReconciliation {
  canonicalVerifierStockEligibleCusips: number;
  analyzerCanonicalStockEligibleInputCusips: number;
  difference: number;
  reconciled: boolean;
  scope: string;
}

export function reconcileCanonicalStockEligibility(
  verifierStockEligibleCusips: number,
  analyzerCanonicalStockEligibleInputCusips: number,
): CanonicalEligibilityReconciliation {
  return {
    canonicalVerifierStockEligibleCusips: verifierStockEligibleCusips,
    analyzerCanonicalStockEligibleInputCusips,
    difference: analyzerCanonicalStockEligibleInputCusips - verifierStockEligibleCusips,
    reconciled: analyzerCanonicalStockEligibleInputCusips === verifierStockEligibleCusips,
    scope: "effective positive-share, non-PRN, non-put/call holding CUSIPs",
  };
}