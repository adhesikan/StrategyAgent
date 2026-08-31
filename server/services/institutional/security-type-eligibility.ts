export const SECURITY_ANALYTICS_POPULATIONS = [
  "ELIGIBLE_STOCK_ANALYTICS",
  "ELIGIBLE_BUT_SEPARATE_FUND_ANALYTICS",
  "UNSUPPORTED_FOR_STOCK_ANALYTICS",
  "INSUFFICIENT_SECURITY_TYPE_EVIDENCE",
] as const;

export type SecurityAnalyticsPopulation =
  (typeof SECURITY_ANALYTICS_POPULATIONS)[number];

export const CANONICAL_INSTITUTIONAL_SECURITY_TYPES = [
  "common_stock",
  "reit",
  "etf",
  "mutual_fund",
  "closed_end_fund",
  "money_market_fund",
  "other_pooled_fund",
  "adr",
  "foreign_listing",
  "preferred",
  "debt",
  "warrant",
  "rights",
  "other",
  "ambiguous",
  "insufficient_evidence",
] as const;

export type CanonicalInstitutionalSecurityType =
  (typeof CANONICAL_INSTITUTIONAL_SECURITY_TYPES)[number];

/** Bump only when the deterministic provider/persisted normalization rules change. */
export const INSTITUTIONAL_SECURITY_TYPE_NORMALIZATION_VERSION = 1 as const;

export interface InstitutionalSecurityTypeEvidence {
  assetType?: string | null;
  securityType?: string | null;
  securityType2?: string | null;
  marketSector?: string | null;
  /** Descriptive provider metadata; never used as a type signal. */
  securityDescription?: string | null;
}

export interface InstitutionalSecurityTypeClassification {
  canonicalType: CanonicalInstitutionalSecurityType;
  analyticsPopulation: SecurityAnalyticsPopulation;
  evidence: string[];
}

const STOCK_TYPES = new Set<CanonicalInstitutionalSecurityType>([
  "common_stock",
  "reit",
]);
const FUND_TYPES = new Set<CanonicalInstitutionalSecurityType>([
  "etf",
  "mutual_fund",
  "closed_end_fund",
  "money_market_fund",
  "other_pooled_fund",
]);
const UNSUPPORTED_TYPES = new Set<CanonicalInstitutionalSecurityType>([
  "adr",
  "foreign_listing",
  "preferred",
  "debt",
  "warrant",
  "rights",
  "other",
]);

function normalize(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/[_/-]+/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function populationForType(
  canonicalType: CanonicalInstitutionalSecurityType,
): SecurityAnalyticsPopulation {
  if (STOCK_TYPES.has(canonicalType)) return "ELIGIBLE_STOCK_ANALYTICS";
  if (FUND_TYPES.has(canonicalType)) {
    return "ELIGIBLE_BUT_SEPARATE_FUND_ANALYTICS";
  }
  if (UNSUPPORTED_TYPES.has(canonicalType)) {
    return "UNSUPPORTED_FOR_STOCK_ANALYTICS";
  }
  return "INSUFFICIENT_SECURITY_TYPE_EVIDENCE";
}

const PERSISTED_ASSET_TYPES: Record<
  string,
  CanonicalInstitutionalSecurityType
> = {
  COMMON_STOCK: "common_stock",
  COMMON_EQUITY: "common_stock",
  REIT: "reit",
  ETF: "etf",
  ETP: "etf",
  MUTUAL_FUND: "mutual_fund",
  OPEN_END_FUND: "mutual_fund",
  CLOSED_END_FUND: "closed_end_fund",
  MONEY_MARKET_FUND: "money_market_fund",
  OTHER_POOLED_FUND: "other_pooled_fund",
  ADR: "adr",
  FOREIGN_LISTING: "foreign_listing",
  PREFERRED: "preferred",
  DEBT: "debt",
  WARRANT: "warrant",
  RIGHTS: "rights",
  OTHER: "other",
  AMBIGUOUS: "ambiguous",
  INSUFFICIENT_EVIDENCE: "insufficient_evidence",
};

const CLASSIFICATION_RULES: Array<{
  type: CanonicalInstitutionalSecurityType;
  pattern: RegExp;
}> = [
  {
    type: "money_market_fund",
    pattern: /\b(MONEY MARKET|LIQUIDITY FUND|CASH MANAGEMENT FUND)\b/,
  },
  {
    type: "other_pooled_fund",
    pattern: /\b(COLLECTIVE INVESTMENT TRUST|POOLED INVESTMENT VEHICLE|POOLED FUND)\b/,
  },
  {
    type: "closed_end_fund",
    pattern: /\b(CLOSED END|CLOSED END FUND|CEF)\b/,
  },
  {
    type: "etf",
    pattern: /\b(ETF|ETP|EXCHANGE TRADED FUND|EXCHANGE TRADED PRODUCT)\b/,
  },
  {
    type: "mutual_fund",
    pattern: /\b(MUTUAL FUND|OPEN END FUND|UNIT INVESTMENT TRUST|INDEX FUND)\b/,
  },
  {
    type: "foreign_listing",
    pattern: /\b(FOREIGN|NON US|OFFSHORE|INTERNATIONAL LISTING)\b/,
  },
  {
    type: "adr",
    pattern: /\b(ADR|ADS|DEPOSITARY RECEIPT|DEPOSITORY RECEIPT)\b/,
  },
  {
    type: "preferred",
    pattern: /\b(PREFERRED|PREFERENCE SHARE)\b/,
  },
  {
    type: "debt",
    pattern:
      /\b(DEBT|BOND|NOTE|DEBENTURE|FIXED INCOME|TREASURY|MUNICIPAL|LOAN|MORTGAGE BACKED|ASSET BACKED)\b/,
  },
  {
    type: "warrant",
    pattern: /\b(WARRANT|WT)\b/,
  },
  {
    type: "rights",
    pattern: /\b(RIGHT|RIGHTS)\b/,
  },
  {
    type: "other",
    pattern: /\b(DERIVATIVE|OPTION|FUTURE|FORWARD|SWAP|UNIT)\b/,
  },
  {
    type: "reit",
    pattern: /\b(REIT|REAL ESTATE INVESTMENT TRUST)\b/,
  },
  {
    type: "common_stock",
    pattern: /\b(COMMON STOCK|COMMON SHARE|COMMON EQUITY|ORDINARY SHARE)\b/,
  },
];

function providerClassification(
  input: InstitutionalSecurityTypeEvidence,
): InstitutionalSecurityTypeClassification {
  // OpenFIGI's securityType/securityType2 are the type-bearing fields. A
  // market sector can corroborate an equity/fund result, but "Equity" alone
  // is intentionally not specific enough to become common stock.
  const typeFields = [input.securityType, input.securityType2]
    .map(normalize)
    .filter(Boolean);
  const evidence = [
    ...typeFields.map((value, index) => `${index === 0 ? "securityType" : "securityType2"}:${value}`),
    ...(normalize(input.marketSector) ? [`marketSector:${normalize(input.marketSector)}`] : []),
  ];
  const joinedTypeFields = typeFields.join(" | ");
  const matches = Array.from(new Set(
    CLASSIFICATION_RULES
      .filter((rule) => rule.pattern.test(joinedTypeFields))
      .map((rule) => rule.type),
  ));
  const marketSector = normalize(input.marketSector);
  const hasBroadEquityType = typeFields.some((value) => value === "EQUITY" || value === "EQUITY LINKED");
  const fixedIncomeSector = /\b(FIXED INCOME|MUNICIPAL|GOVERNMENT|CORPORATE DEBT)\b/.test(marketSector);
  const moneyMarketSector = /\bMONEY MARKET\b/.test(marketSector);
  const currencySector = /\bCURRENCY\b/.test(marketSector);
  const hasContradictorySector = (
    fixedIncomeSector && (hasBroadEquityType || matches.some((type) =>
      type !== "debt" && type !== "other"
    ))
  ) || (
    moneyMarketSector && matches.some((type) =>
      type !== "money_market_fund" && type !== "other_pooled_fund"
    )
  ) || (
    currencySector && (hasBroadEquityType || matches.some((type) => type !== "other"))
  );
  if (hasContradictorySector || matches.length > 1) {
    return {
      canonicalType: "ambiguous",
      analyticsPopulation: "INSUFFICIENT_SECURITY_TYPE_EVIDENCE",
      evidence,
    };
  }
  if (matches.length === 0) {
    // A fixed-income market sector is an authoritative debt population only
    // when it is not contradicted by a concrete equity-like type. A broad
    // "Equity" label alone remains insufficient and never becomes stock.
    if (/\bFIXED INCOME\b/.test(marketSector)) {
      return {
        canonicalType: "debt",
        analyticsPopulation: "UNSUPPORTED_FOR_STOCK_ANALYTICS",
        evidence,
      };
    }
    if (/\b(CURRENCY|MONEY MARKET)\b/.test(marketSector)) {
      return {
        canonicalType: "other",
        analyticsPopulation: "UNSUPPORTED_FOR_STOCK_ANALYTICS",
        evidence,
      };
    }
    return {
      canonicalType: "insufficient_evidence",
      analyticsPopulation: "INSUFFICIENT_SECURITY_TYPE_EVIDENCE",
      evidence,
    };
  }
  const canonicalType = matches[0];
  return {
    canonicalType,
    analyticsPopulation: populationForType(canonicalType),
    evidence,
  };
}

export function classifyInstitutionalSecurityType(
  input: InstitutionalSecurityTypeEvidence,
): InstitutionalSecurityTypeClassification {
  const normalizedAssetType = normalize(input.assetType).replace(/ /g, "_");
  if (normalizedAssetType) {
    const canonicalType = PERSISTED_ASSET_TYPES[normalizedAssetType];
    if (!canonicalType) {
      return {
        canonicalType: "insufficient_evidence",
        analyticsPopulation: "INSUFFICIENT_SECURITY_TYPE_EVIDENCE",
        evidence: [`assetType:${normalizedAssetType}`],
      };
    }
    return {
      canonicalType,
      analyticsPopulation: populationForType(canonicalType),
      evidence: [`assetType:${normalizedAssetType}`],
    };
  }
  return providerClassification(input);
}

export function isEligibleForStockInstitutionalAnalytics(
  input: InstitutionalSecurityTypeEvidence,
): boolean {
  return (
    classifyInstitutionalSecurityType(input).analyticsPopulation ===
    "ELIGIBLE_STOCK_ANALYTICS"
  );
}