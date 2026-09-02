import { createHash } from "node:crypto";
import { normalizeAccession } from "./sec-13f-bulk-parser";

export type FilingAuditClassification =
  | "VALID_SEC_IDENTITY_AND_PERIOD"
  | "CANONICAL_DUPLICATE"
  | "PERIOD_MISMATCH"
  | "SOURCE_IDENTITY_NOT_VERIFIED"
  | "OTHER_INVALID";

export type FilingAccessionClassification =
  | "VERIFIED_VALID"
  | "VERIFIED_CANONICAL_DUPLICATE"
  | "VERIFIED_PERIOD_MISMATCH"
  | "VERIFIED_FILING_DATE_MISMATCH"
  | "VERIFIED_CIK_MISMATCH"
  | "AUTHORITATIVE_ACCESSION_NOT_FOUND"
  | "VERIFICATION_UNAVAILABLE"
  | "AMBIGUOUS_CONFLICTING_EVIDENCE";

export type AccessionVerificationOutcome =
  | "AUTHORITATIVE_ACCESSION_NOT_FOUND"
  | "VERIFICATION_UNAVAILABLE"
  | "AMBIGUOUS_CONFLICTING_EVIDENCE";

export const FILING_ACCESSION_CLASSIFICATIONS: FilingAccessionClassification[] = [
  "VERIFIED_VALID",
  "VERIFIED_CANONICAL_DUPLICATE",
  "VERIFIED_PERIOD_MISMATCH",
  "VERIFIED_FILING_DATE_MISMATCH",
  "VERIFIED_CIK_MISMATCH",
  "AUTHORITATIVE_ACCESSION_NOT_FOUND",
  "VERIFICATION_UNAVAILABLE",
  "AMBIGUOUS_CONFLICTING_EVIDENCE",
];

export interface StoredFilingMetadata {
  id: string;
  rawAccession: string;
  filerName?: string;
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
  accessionClassification: FilingAccessionClassification;
  authoritative: AuthoritativeFilingMetadata | null;
  mismatches: Array<"PERIOD" | "FILING_DATE" | "MANAGER_CIK" | "FORM" | "AMENDMENT">;
}

export interface HoldingFingerprint {
  count: number;
  digest: string;
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
  duplicateCleanupOperations: FilingRepairOperation[];
  metadataCorrectionOperations: FilingRepairOperation[];
  replayRequiredOperations: Array<{
    canonicalAccession: string;
    reason: "CONFLICTING_HOLDINGS" | "DOWNSTREAM_OWNERSHIP_CONFLICT";
  }>;
  blocked: Array<{
    canonicalAccession: string;
    reason: "UNVERIFIED" | "AMBIGUOUS_SEC_IDENTITY" | "INVALID_ACCESSION" | "VERIFICATION_UNAVAILABLE";
  }>;
  blockedOperations: Array<{
    canonicalAccession: string;
    reason: "UNVERIFIED" | "AMBIGUOUS_SEC_IDENTITY" | "INVALID_ACCESSION" | "VERIFICATION_UNAVAILABLE";
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
  verificationOutcomes: ReadonlyMap<string, AccessionVerificationOutcome> = new Map(),
): ClassifiedFiling[] {
  const canonicalCounts = new Map<string, number>();
  const rowsByAccession = new Map<string, StoredFilingMetadata[]>();
  for (const row of storedRows) {
    const canonical = normalizeAccession(row.rawAccession);
    canonicalCounts.set(canonical, (canonicalCounts.get(canonical) ?? 0) + 1);
    const group = rowsByAccession.get(canonical);
    if (group) group.push(row);
    else rowsByAccession.set(canonical, [row]);
  }
  const accessionClassifications = new Map<string, FilingAccessionClassification>();
  for (const [canonicalAccession, rows] of Array.from(rowsByAccession.entries())) {
    const authoritativeMatches = authoritativeByAccession.get(canonicalAccession) ?? [];
    const validAccession = /^\d{18}$/.test(canonicalAccession);
    if (!validAccession) {
      accessionClassifications.set(canonicalAccession, "VERIFICATION_UNAVAILABLE");
      continue;
    }
    if (authoritativeMatches.length > 1) {
      accessionClassifications.set(canonicalAccession, "AMBIGUOUS_CONFLICTING_EVIDENCE");
      continue;
    }
    if (authoritativeMatches.length === 0) {
      accessionClassifications.set(
        canonicalAccession,
        verificationOutcomes.get(canonicalAccession) ?? "VERIFICATION_UNAVAILABLE",
      );
      continue;
    }
    const groupMismatches = rows.flatMap((row) => metadataMismatches(row, authoritativeMatches[0]));
    if (groupMismatches.includes("PERIOD")) {
      accessionClassifications.set(canonicalAccession, "VERIFIED_PERIOD_MISMATCH");
    } else if (groupMismatches.includes("FILING_DATE")) {
      accessionClassifications.set(canonicalAccession, "VERIFIED_FILING_DATE_MISMATCH");
    } else if (groupMismatches.includes("MANAGER_CIK")) {
      accessionClassifications.set(canonicalAccession, "VERIFIED_CIK_MISMATCH");
    } else if (rows.length > 1) {
      accessionClassifications.set(canonicalAccession, "VERIFIED_CANONICAL_DUPLICATE");
    } else {
      accessionClassifications.set(canonicalAccession, "VERIFIED_VALID");
    }
  }

  return storedRows.map((row) => {
    const canonicalAccession = normalizeAccession(row.rawAccession);
    const authoritativeMatches = authoritativeByAccession.get(canonicalAccession) ?? [];
    const validAccession = /^\d{18}$/.test(canonicalAccession);
    const authoritative = authoritativeMatches.length === 1 ? authoritativeMatches[0] : null;
    const mismatches = authoritative ? metadataMismatches(row, authoritative) : [];
    const accessionClassification =
      accessionClassifications.get(canonicalAccession) ?? "VERIFICATION_UNAVAILABLE";
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
      accessionClassification,
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
  options: {
    duplicateDispositions?: ReadonlyMap<string, DuplicateHoldingDisposition>;
  } = {},
): FilingRepairPlan {
  const groups = new Map<string, StoredFilingMetadata[]>();
  for (const row of storedRows) {
    const canonical = normalizeAccession(row.rawAccession);
    const group = groups.get(canonical);
    if (group) group.push(row);
    else groups.set(canonical, [row]);
  }

  const operations: FilingRepairOperation[] = [];
  const duplicateCleanupOperations: FilingRepairOperation[] = [];
  const metadataCorrectionOperations: FilingRepairOperation[] = [];
  const replayRequiredOperations: FilingRepairPlan["replayRequiredOperations"] = [];
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

    const duplicateMetadataAgrees = rows.every(
      (row) => metadataMismatches(row, authoritative).length === 0,
    );
    const duplicateDisposition = options.duplicateDispositions?.get(canonicalAccession);
    if (duplicateIds.length > 0 && !duplicateMetadataAgrees) {
      replayRequiredOperations.push({
        canonicalAccession,
        reason: "DOWNSTREAM_OWNERSHIP_CONFLICT",
      });
      continue;
    }
    if (duplicateIds.length > 0 && (!duplicateDisposition || duplicateDisposition === "REPLAY_REQUIRED")) {
      replayRequiredOperations.push({
        canonicalAccession,
        reason: "CONFLICTING_HOLDINGS",
      });
      continue;
    }

    for (const row of rows) affectedPeriods.add(row.periodOfReport);
    affectedPeriods.add(authoritative.periodOfReport);
    const operation = {
      canonicalAccession,
      survivorId: survivor.id,
      duplicateIds,
      oldPeriods: Array.from(new Set(rows.map((row) => row.periodOfReport))).sort(),
      authoritative,
      canonicalizeAccession,
    };
    operations.push(operation);
    if (duplicateIds.length > 0 || canonicalizeAccession) duplicateCleanupOperations.push(operation);
    if (needsMetadataCorrection) metadataCorrectionOperations.push(operation);
  }

  const planBody = {
    operations,
    duplicateCleanupOperations,
    metadataCorrectionOperations,
    replayRequiredOperations,
    blocked,
    blockedOperations: blocked,
    affectedPeriods: Array.from(affectedPeriods).sort(),
  };
  return {
    ...planBody,
    planHash: createHash("sha256").update(stableJson(planBody)).digest("hex"),
  };
}

export function summarizeFilingAudit(
  classified: ClassifiedFiling[],
  fingerprints: ReadonlyMap<string, HoldingFingerprint> = new Map(),
) {
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
  const canonicalClassificationCounts: Record<FilingAccessionClassification, number> =
    Object.fromEntries(FILING_ACCESSION_CLASSIFICATIONS.map((item) => [item, 0])) as Record<FilingAccessionClassification, number>;
  const duplicateGroups = new Map<string, ClassifiedFiling[]>();
  for (const row of classified) {
    counts[row.classification]++;
    const group = duplicateGroups.get(row.canonicalAccession);
    if (group) group.push(row);
    else duplicateGroups.set(row.canonicalAccession, [row]);
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
  let verifiedDuplicateGroups = 0;
  let unverifiedDuplicateGroups = 0;
  let identicalHoldingDuplicateGroups = 0;
  let conflictingHoldingDuplicateGroups = 0;
  let emptyHoldingDuplicateGroups = 0;
  let safeDuplicateCleanupGroups = 0;
  let blockedDuplicateGroups = 0;
  for (const [, rows] of Array.from(duplicateGroups.entries())) {
    canonicalClassificationCounts[rows[0].accessionClassification]++;
    if (rows.length < 2) continue;
    const verified = rows.every((row) => row.authoritative !== null);
    const verifiedDuplicate = rows[0].accessionClassification === "VERIFIED_CANONICAL_DUPLICATE";
    if (verified) verifiedDuplicateGroups++;
    else unverifiedDuplicateGroups++;
    const sets = rows.map((row) => fingerprints.get(row.rawAccession)).filter(Boolean) as HoldingFingerprint[];
    if (sets.length < rows.length) {
      blockedDuplicateGroups++;
      continue;
    }
    const nonEmptySets = sets.filter((set) => set.count > 0);
    const nonEmptyIdentical = nonEmptySets.length <= 1 ||
      nonEmptySets.every((set) =>
        set.count === nonEmptySets[0].count && set.digest === nonEmptySets[0].digest);
    if (!nonEmptyIdentical) conflictingHoldingDuplicateGroups++;
    else if (sets.some((set) => set.count === 0)) emptyHoldingDuplicateGroups++;
    else {
      identicalHoldingDuplicateGroups++;
    }
    if (verifiedDuplicate && nonEmptyIdentical) {
      safeDuplicateCleanupGroups++;
    } else {
      blockedDuplicateGroups++;
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
    canonicalClassificationCounts,
    verifiedDuplicateGroups,
    unverifiedDuplicateGroups,
    identicalHoldingDuplicateGroups,
    conflictingHoldingDuplicateGroups,
    emptyHoldingDuplicateGroups,
    safeDuplicateCleanupGroups,
    blockedDuplicateGroups,
    periodMismatchesByStoredReportQuarter: Object.fromEntries(
      Object.entries(byStoredQuarter).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}