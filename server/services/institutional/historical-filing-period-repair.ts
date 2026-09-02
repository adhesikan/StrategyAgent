import { createHash } from "node:crypto";
import { normalizeAccession } from "./sec-13f-bulk-parser";

export type FilingAuditClassification =
  | "VALID_SEC_IDENTITY_AND_PERIOD"
  | "CANONICAL_DUPLICATE"
  | "PERIOD_MISMATCH"
  | "SOURCE_IDENTITY_NOT_VERIFIED"
  | "OTHER_INVALID";

export interface StoredFilingMetadata {
  id: string;
  rawAccession: string;
  filerCik: string;
  filingDate: string;
  periodOfReport: string;
  filingType: string;
  amendmentFlag: boolean;
  isEffective: boolean;
}

export interface AuthoritativeFilingMetadata {
  canonicalAccession: string;
  filerCik: string;
  filingDate: string;
  periodOfReport: string;
  filingType: string;
  amendmentFlag: boolean;
}

export interface ClassifiedFiling extends StoredFilingMetadata {
  canonicalAccession: string;
  classification: FilingAuditClassification;
  authoritative: AuthoritativeFilingMetadata | null;
  mismatches: Array<"PERIOD" | "FILING_DATE" | "MANAGER_CIK" | "FORM" | "AMENDMENT">;
}

export interface FilingRepairOperation {
  canonicalAccession: string;
  survivorId: string;
  duplicateIds: string[];
  oldPeriods: string[];
  authoritative: AuthoritativeFilingMetadata;
  canonicalizeAccession: boolean;
}

export interface FilingRepairPlan {
  planHash: string;
  operations: FilingRepairOperation[];
  blocked: Array<{
    canonicalAccession: string;
    reason: "UNVERIFIED" | "AMBIGUOUS_SEC_IDENTITY" | "INVALID_ACCESSION";
  }>;
  affectedPeriods: string[];
}

function normalizedForm(value: string): string {
  return value.trim().toUpperCase();
}

function metadataMismatches(
  stored: StoredFilingMetadata,
  authoritative: AuthoritativeFilingMetadata,
): ClassifiedFiling["mismatches"] {
  const mismatches: ClassifiedFiling["mismatches"] = [];
  if (stored.periodOfReport !== authoritative.periodOfReport) mismatches.push("PERIOD");
  if (stored.filingDate !== authoritative.filingDate) mismatches.push("FILING_DATE");
  if (stored.filerCik !== authoritative.filerCik) mismatches.push("MANAGER_CIK");
  if (normalizedForm(stored.filingType) !== normalizedForm(authoritative.filingType)) mismatches.push("FORM");
  if (stored.amendmentFlag !== authoritative.amendmentFlag) mismatches.push("AMENDMENT");
  return mismatches;
}

export function classifyStoredFilings(
  storedRows: StoredFilingMetadata[],
  authoritativeByAccession: ReadonlyMap<string, AuthoritativeFilingMetadata[]>,
): ClassifiedFiling[] {
  const canonicalCounts = new Map<string, number>();
  for (const row of storedRows) {
    const canonical = normalizeAccession(row.rawAccession);
    canonicalCounts.set(canonical, (canonicalCounts.get(canonical) ?? 0) + 1);
  }

  return storedRows.map((row) => {
    const canonicalAccession = normalizeAccession(row.rawAccession);
    const authoritativeMatches = authoritativeByAccession.get(canonicalAccession) ?? [];
    const validAccession = /^\d{18}$/.test(canonicalAccession);
    const authoritative = authoritativeMatches.length === 1 ? authoritativeMatches[0] : null;
    const mismatches = authoritative ? metadataMismatches(row, authoritative) : [];
    let classification: FilingAuditClassification;

    if (!validAccession) classification = "OTHER_INVALID";
    else if (authoritativeMatches.length !== 1) classification = "SOURCE_IDENTITY_NOT_VERIFIED";
    else if ((canonicalCounts.get(canonicalAccession) ?? 0) > 1) classification = "CANONICAL_DUPLICATE";
    else if (mismatches.includes("PERIOD")) classification = "PERIOD_MISMATCH";
    else if (mismatches.length > 0) classification = "OTHER_INVALID";
    else classification = "VALID_SEC_IDENTITY_AND_PERIOD";

    return {
      ...row,
      canonicalAccession,
      classification,
      authoritative,
      mismatches,
    };
  });
}

export type DuplicateHoldingDisposition =
  | "NOOP_EMPTY_DUPLICATE"
  | "MOVE_DUPLICATE_TO_EMPTY_SURVIVOR"
  | "DELETE_IDENTICAL_DUPLICATE"
  | "REPLAY_REQUIRED";

export function decideDuplicateHoldingDisposition(
  survivor: { count: number; digest: string },
  duplicate: { count: number; digest: string },
): DuplicateHoldingDisposition {
  if (duplicate.count === 0) return "NOOP_EMPTY_DUPLICATE";
  if (survivor.count === 0) return "MOVE_DUPLICATE_TO_EMPTY_SURVIVOR";
  if (survivor.count === duplicate.count && survivor.digest === duplicate.digest) {
    return "DELETE_IDENTICAL_DUPLICATE";
  }
  return "REPLAY_REQUIRED";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildHistoricalFilingRepairPlan(
  storedRows: StoredFilingMetadata[],
  authoritativeByAccession: ReadonlyMap<string, AuthoritativeFilingMetadata[]>,
): FilingRepairPlan {
  const groups = new Map<string, StoredFilingMetadata[]>();
  for (const row of storedRows) {
    const canonical = normalizeAccession(row.rawAccession);
    const group = groups.get(canonical);
    if (group) group.push(row);
    else groups.set(canonical, [row]);
  }

  const operations: FilingRepairOperation[] = [];
  const blocked: FilingRepairPlan["blocked"] = [];
  const affectedPeriods = new Set<string>();

  for (const [canonicalAccession, rows] of Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^\d{18}$/.test(canonicalAccession)) {
      blocked.push({ canonicalAccession, reason: "INVALID_ACCESSION" });
      continue;
    }
    const authoritativeMatches = authoritativeByAccession.get(canonicalAccession) ?? [];
    if (authoritativeMatches.length === 0) {
      blocked.push({ canonicalAccession, reason: "UNVERIFIED" });
      continue;
    }
    if (authoritativeMatches.length !== 1) {
      blocked.push({ canonicalAccession, reason: "AMBIGUOUS_SEC_IDENTITY" });
      continue;
    }

    const authoritative = authoritativeMatches[0];
    const sorted = [...rows].sort((a, b) => {
      const aCanonical = a.rawAccession === canonicalAccession ? 0 : 1;
      const bCanonical = b.rawAccession === canonicalAccession ? 0 : 1;
      return aCanonical - bCanonical || a.id.localeCompare(b.id);
    });
    const survivor = sorted[0];
    const needsMetadataCorrection = metadataMismatches(survivor, authoritative).length > 0;
    const canonicalizeAccession = survivor.rawAccession !== canonicalAccession;
    const duplicateIds = sorted.slice(1).map((row) => row.id);
    if (!needsMetadataCorrection && !canonicalizeAccession && duplicateIds.length === 0) continue;

    for (const row of rows) affectedPeriods.add(row.periodOfReport);
    affectedPeriods.add(authoritative.periodOfReport);
    operations.push({
      canonicalAccession,
      survivorId: survivor.id,
      duplicateIds,
      oldPeriods: Array.from(new Set(rows.map((row) => row.periodOfReport))).sort(),
      authoritative,
      canonicalizeAccession,
    });
  }

  const planBody = {
    operations,
    blocked,
    affectedPeriods: Array.from(affectedPeriods).sort(),
  };
  return {
    ...planBody,
    planHash: createHash("sha256").update(stableJson(planBody)).digest("hex"),
  };
}

export function summarizeFilingAudit(classified: ClassifiedFiling[]) {
  const canonicalUniqueAccessions = new Set(classified.map((row) => row.canonicalAccession)).size;
  const counts: Record<FilingAuditClassification, number> = {
    VALID_SEC_IDENTITY_AND_PERIOD: 0,
    CANONICAL_DUPLICATE: 0,
    PERIOD_MISMATCH: 0,
    SOURCE_IDENTITY_NOT_VERIFIED: 0,
    OTHER_INVALID: 0,
  };
  const byStoredQuarter: Record<string, number> = {};
  let verifiedAgainstSEC = 0;
  let periodMatchesSEC = 0;
  let periodMismatchesSEC = 0;
  let filingDateMismatchesSEC = 0;
  let managerCikMismatchesSEC = 0;
  for (const row of classified) {
    counts[row.classification]++;
    if (row.authoritative) {
      verifiedAgainstSEC++;
      if (row.mismatches.includes("PERIOD")) {
        periodMismatchesSEC++;
        byStoredQuarter[row.periodOfReport] = (byStoredQuarter[row.periodOfReport] ?? 0) + 1;
      } else {
        periodMatchesSEC++;
      }
      if (row.mismatches.includes("FILING_DATE")) filingDateMismatchesSEC++;
      if (row.mismatches.includes("MANAGER_CIK")) managerCikMismatchesSEC++;
    }
  }
  return {
    totalRows: classified.length,
    canonicalUniqueAccessions,
    canonicalDuplicateRows: classified.length - canonicalUniqueAccessions,
    verifiedAgainstSEC,
    periodMatchesSEC,
    periodMismatchesSEC,
    filingDateMismatchesSEC,
    managerCikMismatchesSEC,
    unverifiedAccessions: new Set(
      classified
        .filter((row) => !row.authoritative)
        .map((row) => row.canonicalAccession),
    ).size,
    classifications: counts,
    periodMismatchesByStoredReportQuarter: Object.fromEntries(
      Object.entries(byStoredQuarter).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}