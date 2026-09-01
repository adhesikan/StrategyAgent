/**
 * Canonical effective-holding scope shared by the read-only verifier and the
 * remediation analyzer. Identity trust is resolved from exact/reviewed
 * persisted mapping evidence; asset type is read from security_master.
 */
import {
  CANONICAL_EFFECTIVE_HOLDINGS_CTE_BODY,
} from "./institutional-effective-holdings";

function buildCanonicalSecurityStateCte(eligibleCusipsCte: string): string {
  return `
WITH
${eligibleCusipsCte},
evidence AS (
  SELECT cusip, mapped_symbol AS symbol, mapping_status AS status, NULL::text AS asset_type
  FROM institutional_security_mappings
  UNION ALL
  SELECT cusip, ticker AS symbol, review_status AS status, asset_type
  FROM security_master
), trusted AS (
  SELECT
    cusip,
    MAX(NULLIF(UPPER(TRIM(symbol)), ''))
      FILTER (WHERE LOWER(COALESCE(status, '')) IN ('exact', 'reviewed')) AS symbol
  FROM evidence
  GROUP BY cusip
  HAVING COUNT(DISTINCT NULLIF(UPPER(TRIM(symbol)), ''))
           FILTER (WHERE LOWER(COALESCE(status, '')) IN ('exact', 'reviewed')) = 1
     AND BOOL_OR(LOWER(COALESCE(status, '')) = 'rejected') IS NOT TRUE
), canonical AS (
  SELECT e.cusip, MAX(t.symbol) AS symbol, MAX(sm.asset_type) AS asset_type
  FROM eligible_cusips e
  JOIN trusted t ON t.cusip = e.cusip
  LEFT JOIN security_master sm ON sm.cusip = e.cusip
  WHERE (
    (t.symbol ~ '^[A-Z0-9]+$' AND LENGTH(t.symbol) <= 12)
    OR (
      t.symbol ~ '^[A-Z0-9]+\\.[A-Z0-9]+$'
      AND LENGTH(t.symbol) <= 12
      AND EXISTS (
        SELECT 1
        FROM institutional_security_candidate_observations candidate
        WHERE candidate.cusip = e.cusip
          AND candidate.is_current = TRUE
          AND UPPER(TRIM(candidate.ticker)) = t.symbol
          AND NULLIF(TRIM(candidate.share_class_figi), '') IS NOT NULL
      )
    )
  )
  GROUP BY e.cusip
)`;
}

export const canonicalSecurityTypeStateCte = buildCanonicalSecurityStateCte(`
${CANONICAL_EFFECTIVE_HOLDINGS_CTE_BODY},
eligible_cusips AS (
  SELECT DISTINCT h.cusip
  FROM canonical_effective_holdings h
)
`);

export const canonicalSecurityTypeStateQuery = `
${canonicalSecurityTypeStateCte}
SELECT
  COUNT(*)::int AS trusted_cusips,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(asset_type), '') IS NOT NULL)::int AS asset_type_populated,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(asset_type), '') IS NULL)::int AS asset_type_missing,
  COUNT(*) FILTER (WHERE asset_type IN ('common_stock', 'reit'))::int AS stock_eligible_cusips,
   COUNT(*) FILTER (WHERE asset_type IN ('etf', 'mutual_fund', 'closed_end_fund', 'money_market_fund', 'other_pooled_fund'))::int AS separate_fund_cusips,
  COUNT(*) FILTER (WHERE asset_type IS NULL OR asset_type NOT IN (
     'common_stock', 'reit', 'etf', 'mutual_fund', 'closed_end_fund', 'money_market_fund', 'other_pooled_fund'
  ))::int AS unsupported_or_insufficient_cusips,
  COALESCE(
    JSONB_OBJECT_AGG(cusip, symbol ORDER BY cusip)
      FILTER (WHERE asset_type IN ('common_stock', 'reit')),
    '{}'::jsonb
  ) AS stock_eligible_identities
FROM canonical`;

/**
 * Symbol-scoped form of the same canonical identity contract. `$1` must be a
 * normalized symbol supplied through the database driver's parameter binding.
 */
export const canonicalStockIdentityCte = buildCanonicalSecurityStateCte(`
${CANONICAL_EFFECTIVE_HOLDINGS_CTE_BODY},
eligible_cusips AS (
  SELECT DISTINCT h.cusip
  FROM canonical_effective_holdings h
)
`);

export const canonicalStockIdentityForSymbolQuery = `
${canonicalStockIdentityCte}
SELECT
  cusip,
  'reviewed'::text AS "reviewStatus",
  asset_type AS "assetType"
FROM canonical
WHERE symbol = $1
  AND asset_type IN ('common_stock', 'reit')
ORDER BY cusip`;

export function parseCanonicalStockEligibleIdentities(
  value: unknown,
): ReadonlyMap<string, string> {
  let record: Record<string, unknown> = {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        record = parsed as Record<string, unknown>;
      }
    } catch {
      return new Map();
    }
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    record = value as Record<string, unknown>;
  }
  return new Map(
    Object.entries(record)
      .map(([cusip, symbol]) => [cusip.trim().toUpperCase(), String(symbol ?? "").trim().toUpperCase()] as const)
      .filter(([cusip, symbol]) => cusip.length > 0 && symbol.length > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

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