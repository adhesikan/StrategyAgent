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

export interface InstitutionalSecurityTypeEvidence {
  assetType?: string | null;
  securityType?: string | null;
  securityType2?: string | null;
  marketSector?: string | null;
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
    type: "reit",
    pattern: /\b(REIT|REAL ESTATE INVESTMENT TRUST)\b/,
  },
  {
    type: "common_stock",
    pattern: /\b(COMMON STOCK|COMMON SHARE|COMMON EQUITY|ORDINARY SHARE)\b/,
  },
];

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

  const evidence = [
    input.securityType,
    input.securityType2,
    input.marketSector,
  ]
    .map(normalize)
    .filter(Boolean);
  const joined = evidence.join(" | ");
  if (!joined) {
    return {
      canonicalType: "insufficient_evidence",
      analyticsPopulation: "INSUFFICIENT_SECURITY_TYPE_EVIDENCE",
      evidence: [],
    };
  }

  const matches = Array.from(
    new Set(
      CLASSIFICATION_RULES.filter((rule) => rule.pattern.test(joined)).map(
        (rule) => rule.type,
      ),
    ),
  );
  const distinct = Array.from(new Set(matches));
  if (distinct.length !== 1) {
    return {
      canonicalType:
        distinct.length > 1 ? "ambiguous" : "insufficient_evidence",
      analyticsPopulation: "INSUFFICIENT_SECURITY_TYPE_EVIDENCE",
      evidence,
    };
  }
  const canonicalType = distinct[0];
  return {
    canonicalType,
    analyticsPopulation: populationForType(canonicalType),
    evidence,
  };
}

export function isEligibleForStockInstitutionalAnalytics(
  input: InstitutionalSecurityTypeEvidence,
): boolean {
  return (
    classifyInstitutionalSecurityType(input).analyticsPopulation ===
    "ELIGIBLE_STOCK_ANALYTICS"
  );
}