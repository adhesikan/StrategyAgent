export const CURRENT_HOLDING_DUPLICATE_KEY = [
  "accessionNumber",
  "cusip",
  "classTitle",
  "putCall",
] as const;

export const OMITTED_MATERIAL_HOLDING_FIELDS = [
  "issuerName",
  "figi",
  "reportedValue",
  "reportedShares",
  "sharesPrnType",
  "investmentDiscretion",
  "otherManager",
  "votingSole",
  "votingShared",
  "votingNone",
  "filerCik",
  "periodOfReport",
  "filingDate",
] as const;

/**
 * SEC bulk INFOTABLE rows carry INFOTABLE_SK, but the current parser/schema do
 * not preserve it. No stored-data-only key can prove that two otherwise equal
 * rows came from the same source row.
 */
export const CANONICAL_SOURCE_HOLDING_IDENTITY = [
  "accessionNumber",
  "infoTableSk",
] as const;

export type StoredHoldingMaterial = {
  accessionNumber: string;
  cusip: string;
  classTitle: string;
  putCall: string | null;
  issuerName: string;
  figi: string | null;
  reportedValue: number | null;
  reportedShares: number | null;
  sharesPrnType: string | null;
  investmentDiscretion: string | null;
  otherManager: string | null;
  votingSole: number | null;
  votingShared: number | null;
  votingNone: number | null;
  filerCik: string;
  periodOfReport: string;
  filingDate: string;
};

export type StoredDuplicateCategory =
  | "IDENTICAL_STORED_MATERIAL_SOURCE_IDENTITY_UNRESOLVED"
  | "MATERIALLY_DISTINCT_SHARE_PRN_TYPE"
  | "MATERIALLY_DISTINCT_INVESTMENT_DISCRETION"
  | "MATERIALLY_DISTINCT_OTHER_MANAGER"
  | "MATERIALLY_DISTINCT_VOTING_AUTHORITY"
  | "MATERIALLY_DISTINCT_REPORTED_AMOUNT"
  | "MATERIALLY_DISTINCT_ISSUER_OR_FIGI"
  | "MATERIALLY_DISTINCT_FILING_CONTEXT"
  | "MULTIPLE_MATERIAL_DIFFERENCES";

function encode(values: unknown[]): string {
  return JSON.stringify(values);
}

function countVariants(rows: StoredHoldingMaterial[], select: (row: StoredHoldingMaterial) => unknown[]): number {
  return new Set(rows.map((row) => encode(select(row)))).size;
}

export function currentDuplicateKey(row: StoredHoldingMaterial): string {
  return encode([
    row.accessionNumber,
    row.cusip,
    row.classTitle,
    row.putCall ?? "",
  ]);
}

export function classifyStoredDuplicateGroup(
  rows: StoredHoldingMaterial[],
): StoredDuplicateCategory | null {
  if (rows.length < 2) return null;
  if (new Set(rows.map(currentDuplicateKey)).size !== 1) return null;

  const dimensions: Array<[StoredDuplicateCategory, number]> = [
    ["MATERIALLY_DISTINCT_SHARE_PRN_TYPE", countVariants(rows, (row) => [row.sharesPrnType])],
    ["MATERIALLY_DISTINCT_INVESTMENT_DISCRETION", countVariants(rows, (row) => [row.investmentDiscretion])],
    ["MATERIALLY_DISTINCT_OTHER_MANAGER", countVariants(rows, (row) => [row.otherManager])],
    ["MATERIALLY_DISTINCT_VOTING_AUTHORITY", countVariants(rows, (row) => [
      row.votingSole,
      row.votingShared,
      row.votingNone,
    ])],
    ["MATERIALLY_DISTINCT_REPORTED_AMOUNT", countVariants(rows, (row) => [
      row.reportedValue,
      row.reportedShares,
    ])],
    ["MATERIALLY_DISTINCT_ISSUER_OR_FIGI", countVariants(rows, (row) => [row.issuerName, row.figi])],
    ["MATERIALLY_DISTINCT_FILING_CONTEXT", countVariants(rows, (row) => [
      row.filerCik,
      row.periodOfReport,
      row.filingDate,
    ])],
  ];
  const changed = dimensions.filter(([, variants]) => variants > 1);
  if (changed.length === 0) return "IDENTICAL_STORED_MATERIAL_SOURCE_IDENTITY_UNRESOLVED";
  if (changed.length === 1) return changed[0][0];
  return "MULTIPLE_MATERIAL_DIFFERENCES";
}
