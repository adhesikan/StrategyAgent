#!/usr/bin/env tsx
/**
 * Read-only production-shell provenance reconciler for historical SEC 13F rows.
 *
 * This script deliberately imports only the database read handle and the SEC
 * catalog/streaming parser. It never imports ingestion services and contains no
 * database mutation or migration operation.
 */

import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { normalizeAccession, streamBulkFromDescriptor, type ParsedBulkHolding } from "../server/services/institutional/sec-13f-bulk-parser";
import {
  fetchDatasetCatalog,
  resolveCatalogQuarterRange,
  type DatasetDescriptor,
} from "../server/services/institutional/sec-dataset-catalog";
import { getInstitutionalConfig } from "../server/services/institutional/config";

type FilingMetadata = {
  rawAccession: string;
  canonicalAccession: string;
  filerCik: string;
  periodOfReport: string;
  filingDate: string;
  filingType: string;
  amendmentFlag: boolean;
  sourceKind?: string;
  checksumPresent?: boolean;
};

type SourceFiling = Omit<FilingMetadata, "sourceKind" | "checksumPresent">;

type SourceFailureStage =
  | "CATALOG_RESOLUTION"
  | "DOWNLOAD"
  | "HTTP_RESPONSE"
  | "ARCHIVE_OPEN"
  | "SUBMISSION_PARSE"
  | "METADATA_JOIN"
  | "CANCELLATION"
  | "OTHER";

export type SafeSourceFailure = {
  error: "SEC_SOURCE_FAILED";
  stage: SourceFailureStage;
  quarter: string;
  httpStatus: number | null;
  contentType: string | null;
  safeMessage: string;
};

class ReconciliationSourceError extends Error {
  constructor(readonly report: SafeSourceFailure) {
    super(report.error);
    this.name = "ReconciliationSourceError";
  }
}

export type ReconciliationArgs = {
  fromQuarter: string;
  toQuarter: string;
};

export type CollisionClassification =
  | "DASHED_VS_UNDASHED"
  | "WHITESPACE_OR_PUNCTUATION"
  | "OTHER_FORMAT_VARIANT"
  | "IDENTICAL_CANONICAL_DIFFERENT_RAW"
  | "UNCLASSIFIED";

export type CollisionSummary = {
  collisionGroups: number;
  excessRows: number;
  byCategory: Record<CollisionClassification, { groups: number; excessRows: number }>;
};

export type CrossMatchSummary = {
  managerReportPeriodMatches: number;
  managerReportPeriodFilingDateMatches: number;
  uniqueDeterministicMatches: number;
  ambiguousDeterministicMatches: number;
  noDeterministicMatch: number;
  matchingSourceExamples: Array<SanitizedSourceExample>;
};

export function isUsableSourceStatus(status: string): boolean {
  // Keep this in lockstep with the historical backfill dry-run contract:
  // rejected rows do not invalidate the bounded source metadata population.
  return status === "success" || status === "partial_success";
}

type SanitizedExistingExample = Pick<
  FilingMetadata,
  | "rawAccession"
  | "canonicalAccession"
  | "filerCik"
  | "periodOfReport"
  | "filingDate"
  | "filingType"
  | "amendmentFlag"
  | "sourceKind"
  | "checksumPresent"
>;

type SanitizedSourceExample = Pick<
  SourceFiling,
  | "rawAccession"
  | "canonicalAccession"
  | "filerCik"
  | "periodOfReport"
  | "filingDate"
  | "filingType"
  | "amendmentFlag"
>;

const COLLISION_CATEGORIES: CollisionClassification[] = [
  "DASHED_VS_UNDASHED",
  "WHITESPACE_OR_PUNCTUATION",
  "OTHER_FORMAT_VARIANT",
  "IDENTICAL_CANONICAL_DIFFERENT_RAW",
  "UNCLASSIFIED",
];

function emptyCollisionSummary(): CollisionSummary {
  return {
    collisionGroups: 0,
    excessRows: 0,
    byCategory: Object.fromEntries(
      COLLISION_CATEGORIES.map((category) => [category, { groups: 0, excessRows: 0 }]),
    ) as CollisionSummary["byCategory"],
  };
}

function isDashedAccession(value: string): boolean {
  return /^\d{10}-\d{2}-\d{6}$/.test(value);
}

function classifyCollision(rawValues: string[]): CollisionClassification {
  const trimmed = rawValues.map((value) => value.trim());
  const hasDashed = trimmed.some(isDashedAccession);
  const hasUndashed = trimmed.some((value) => /^\d{18}$/.test(value));
  if (hasDashed && hasUndashed) return "DASHED_VS_UNDASHED";
  if (rawValues.some((value) => value !== value.trim())) return "WHITESPACE_OR_PUNCTUATION";
  if (new Set(rawValues.map((value) => value.replace(/[0-9]/g, ""))).size > 1) {
    return "WHITESPACE_OR_PUNCTUATION";
  }
  if (rawValues.some((value) => /[^0-9]/.test(value))) return "OTHER_FORMAT_VARIANT";
  if (new Set(rawValues).size > 1) return "IDENTICAL_CANONICAL_DIFFERENT_RAW";
  return "UNCLASSIFIED";
}

export function summarizeCanonicalCollisions(rows: Array<{ rawAccession: string }>): CollisionSummary {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const canonical = normalizeAccession(row.rawAccession);
    const values = groups.get(canonical);
    if (values) values.push(row.rawAccession);
    else groups.set(canonical, [row.rawAccession]);
  }

  const summary = emptyCollisionSummary();
  for (const values of groups.values()) {
    if (values.length < 2) continue;
    const category = classifyCollision(values);
    const excessRows = values.length - 1;
    summary.collisionGroups++;
    summary.excessRows += excessRows;
    summary.byCategory[category].groups++;
    summary.byCategory[category].excessRows += excessRows;
  }
  return summary;
}

function deterministicKey(filing: Pick<FilingMetadata, "filerCik" | "periodOfReport" | "filingDate" | "filingType" | "amendmentFlag">): string {
  return [
    filing.filerCik,
    filing.periodOfReport,
    filing.filingDate,
    filing.filingType.trim().toUpperCase(),
    filing.amendmentFlag ? "1" : "0",
  ].join("|");
}

export function crossMatchExistingOnly(
  existingOnly: FilingMetadata[],
  sourceRows: SourceFiling[],
): CrossMatchSummary {
  const byManagerPeriod = new Set<string>();
  const byManagerPeriodDate = new Set<string>();
  const byDeterministicKey = new Map<string, SourceFiling[]>();
  for (const source of sourceRows) {
    byManagerPeriod.add(`${source.filerCik}|${source.periodOfReport}`);
    byManagerPeriodDate.add(`${source.filerCik}|${source.periodOfReport}|${source.filingDate}`);
    const key = deterministicKey(source);
    const matches = byDeterministicKey.get(key);
    if (matches) matches.push(source);
    else byDeterministicKey.set(key, [source]);
  }

  let managerReportPeriodMatches = 0;
  let managerReportPeriodFilingDateMatches = 0;
  let uniqueDeterministicMatches = 0;
  let ambiguousDeterministicMatches = 0;
  let noDeterministicMatch = 0;
  const matchingSourceExamples: SanitizedSourceExample[] = [];

  for (const existing of existingOnly) {
    if (byManagerPeriod.has(`${existing.filerCik}|${existing.periodOfReport}`)) {
      managerReportPeriodMatches++;
    }
    if (byManagerPeriodDate.has(`${existing.filerCik}|${existing.periodOfReport}|${existing.filingDate}`)) {
      managerReportPeriodFilingDateMatches++;
    }
    const matches = byDeterministicKey.get(deterministicKey(existing)) ?? [];
    if (matches.length === 1) {
      uniqueDeterministicMatches++;
      if (matchingSourceExamples.length < 10) matchingSourceExamples.push(sanitizeSource(matches[0]));
    } else if (matches.length > 1) {
      ambiguousDeterministicMatches++;
    } else {
      noDeterministicMatch++;
    }
  }

  return {
    managerReportPeriodMatches,
    managerReportPeriodFilingDateMatches,
    uniqueDeterministicMatches,
    ambiguousDeterministicMatches,
    noDeterministicMatch,
    matchingSourceExamples,
  };
}

function sanitizeSource(source: SourceFiling): SanitizedSourceExample {
  return {
    rawAccession: source.rawAccession,
    canonicalAccession: source.canonicalAccession,
    filerCik: source.filerCik,
    periodOfReport: source.periodOfReport,
    filingDate: source.filingDate,
    filingType: source.filingType,
    amendmentFlag: source.amendmentFlag,
  };
}

function sourceFailureStage(result: {
  reason?: string;
  failureCode?: string;
  diagnostics?: { httpStatus?: number | null };
}): SourceFailureStage {
  if (result.failureCode === "CANCELLED" || result.reason === "CANCELLED") return "CANCELLATION";
  if (typeof result.diagnostics?.httpStatus === "number") return "HTTP_RESPONSE";
  if (
    result.failureCode === "SOURCE_REJECTED" ||
    result.failureCode === "RATE_LIMITED" ||
    result.failureCode === "SOURCE_FORMAT_UNEXPECTED"
  ) return "HTTP_RESPONSE";
  if (result.failureCode === "SOURCE_INTEGRITY_FAILURE" || result.reason === "REQUIRED_ARCHIVE_ENTRY_MISSING") {
    return "ARCHIVE_OPEN";
  }
  if (result.failureCode === "PARSE_FAILED") return "SUBMISSION_PARSE";
  const reason = result.reason ?? "";
  if (/MANAGER_IDENTITY|Join rate|join rate|INFOTABLE_ACCESSION_ORDER/i.test(reason)) return "METADATA_JOIN";
  if (/SUBMISSION|INFOTABLE_HEADERS|INVALID_SUBMISSION|NO_HOLDINGS|ALL_HOLDINGS/i.test(reason)) {
    return "SUBMISSION_PARSE";
  }
  if (/SOURCE_UNAVAILABLE|DOWNLOAD|retrieval failed/i.test(reason) || result.failureCode === "SOURCE_UNAVAILABLE") {
    return "DOWNLOAD";
  }
  return "OTHER";
}

function safeSourceMessage(stage: SourceFailureStage): string {
  switch (stage) {
    case "CATALOG_RESOLUTION": return "SEC_DATASET_CATALOG_RESOLUTION_FAILED";
    case "DOWNLOAD": return "SEC_ARCHIVE_DOWNLOAD_FAILED";
    case "HTTP_RESPONSE": return "SEC_ARCHIVE_HTTP_RESPONSE_REJECTED";
    case "ARCHIVE_OPEN": return "SEC_ARCHIVE_OPEN_OR_INTEGRITY_FAILED";
    case "SUBMISSION_PARSE": return "SEC_SUBMISSION_METADATA_PARSE_FAILED";
    case "METADATA_JOIN": return "SEC_METADATA_JOIN_FAILED";
    case "CANCELLATION": return "SEC_SOURCE_RECONCILIATION_CANCELLED";
    default: return "SEC_SOURCE_RECONCILIATION_FAILED";
  }
}

function safeContentType(contentType: string | null | undefined): string | null {
  if (!contentType) return null;
  return contentType.split(";", 1)[0].trim().slice(0, 100) || null;
}

function throwSourceFailure(
  quarter: string,
  result: {
    reason?: string;
    failureCode?: string;
    diagnostics?: { httpStatus?: number | null; contentType?: string | null };
  },
): never {
  throw new ReconciliationSourceError(buildSafeSourceFailure(quarter, result));
}

export function buildSafeSourceFailure(
  quarter: string,
  result: {
    reason?: string;
    failureCode?: string;
    diagnostics?: { httpStatus?: number | null; contentType?: string | null };
  },
): SafeSourceFailure {
  const stage = sourceFailureStage(result);
  return {
    error: "SEC_SOURCE_FAILED",
    stage,
    quarter,
    httpStatus: typeof result.diagnostics?.httpStatus === "number" ? result.diagnostics.httpStatus : null,
    contentType: safeContentType(result.diagnostics?.contentType),
    safeMessage: safeSourceMessage(stage),
  };
}

export function parseReconciliationArgs(args: string[]): ReconciliationArgs {
  const parsed = parseArgs({
    args,
    options: {
      "from-quarter": { type: "string" },
      "to-quarter": { type: "string" },
    },
    strict: true,
  });
  const fromQuarter = parsed.values["from-quarter"];
  const toQuarter = parsed.values["to-quarter"];
  if (!fromQuarter || !toQuarter) throw new Error("EXPLICIT_QUARTER_RANGE_REQUIRED");
  if (!/^\d{4}-?Q[1-4]$/i.test(fromQuarter) || !/^\d{4}-?Q[1-4]$/i.test(toQuarter)) {
    throw new Error("INVALID_QUARTER_RANGE");
  }
  return { fromQuarter, toQuarter };
}

export function validateReconciliationEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== "production") throw new Error("PRODUCTION_NODE_ENV_REQUIRED");
  if (env.RAILWAY_ENVIRONMENT_NAME !== "production") {
    throw new Error("RAILWAY_PRODUCTION_IDENTITY_REQUIRED");
  }
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  if (env.EXTERNAL_DATABASE_URL) throw new Error("EXTERNAL_DATABASE_URL_FORBIDDEN");
}

function sourceFromHolding(holding: ParsedBulkHolding): SourceFiling {
  return {
    // The streaming parser exposes its canonical accession by design. Keeping
    // rawAccession equal to that value makes the provenance boundary explicit:
    // this report never pretends to have an unobserved pre-normalization value.
    rawAccession: holding.accessionNumber,
    canonicalAccession: normalizeAccession(holding.accessionNumber),
    filerCik: holding.filerCik,
    periodOfReport: holding.periodOfReport,
    filingDate: holding.filingDate,
    filingType: holding.filingType,
    amendmentFlag: holding.isAmendment,
  };
}

async function checkDatabaseIdentity(): Promise<{
  databaseName: string | null;
  institutionalFilingsTablePresent: boolean;
  institutionalHoldingsTablePresent: boolean;
  ingestionRunsTablePresent: boolean;
}> {
  const result = await db.execute(sql`
    SELECT current_database() AS "databaseName",
           to_regclass('public.institutional_13f_filings')::text AS "filingsTable",
           to_regclass('public.institutional_13f_holdings')::text AS "holdingsTable",
           to_regclass('public.institutional_ingestion_runs')::text AS "runsTable"
  `);
  const row = result.rows[0] as {
    databaseName: string | null;
    filingsTable: string | null;
    holdingsTable: string | null;
    runsTable: string | null;
  };
  return {
    databaseName: row.databaseName ?? null,
    institutionalFilingsTablePresent: Boolean(row.filingsTable),
    institutionalHoldingsTablePresent: Boolean(row.holdingsTable),
    ingestionRunsTablePresent: Boolean(row.runsTable),
  };
}

async function readExistingFilings(periods: string[]): Promise<FilingMetadata[]> {
  const periodList = sql.join(periods.map((period) => sql`${period}`), sql`, `);
  const result = await db.execute(sql`
    SELECT accession_number AS "rawAccession",
           filer_cik AS "filerCik",
           period_of_report::text AS "periodOfReport",
           filing_date::text AS "filingDate",
           filing_type AS "filingType",
           amendment_flag AS "amendmentFlag",
           source_url AS "sourceUrl",
           source_checksum AS "sourceChecksum"
      FROM institutional_13f_filings
     WHERE period_of_report IN (${periodList})
     ORDER BY period_of_report, accession_number
  `);
  return (result.rows as Array<{
    rawAccession: string;
    filerCik: string;
    periodOfReport: string;
    filingDate: string;
    filingType: string;
    amendmentFlag: boolean;
    sourceUrl: string | null;
    sourceChecksum: string | null;
  }>).map((row) => ({
    rawAccession: row.rawAccession,
    canonicalAccession: normalizeAccession(row.rawAccession),
    filerCik: row.filerCik,
    periodOfReport: row.periodOfReport,
    filingDate: row.filingDate,
    filingType: row.filingType,
    amendmentFlag: Boolean(row.amendmentFlag),
    sourceKind: classifySourceKind(row.sourceUrl),
    checksumPresent: Boolean(row.sourceChecksum),
  }));
}

function classifySourceKind(sourceUrl: string | null): string {
  if (!sourceUrl) return "NULL";
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase();
    if (hostname === "sec.gov" || hostname.endsWith(".sec.gov")) return "SEC";
    return "OTHER";
  } catch {
    return "INVALID_URL";
  }
}

async function collectSourceFilings(descriptors: DatasetDescriptor[]): Promise<SourceFiling[]> {
  const sourceByAccession = new Map<string, SourceFiling>();
  for (const descriptor of descriptors) {
    const result = await streamBulkFromDescriptor(descriptor, {
      batchSize: 2_000,
      onBatch: async (batch) => {
        if (!batch.length) return;
        const first = sourceFromHolding(batch[0]);
        if (!sourceByAccession.has(first.canonicalAccession)) {
          sourceByAccession.set(first.canonicalAccession, first);
        }
      },
    });
    if (!isUsableSourceStatus(result.status)) {
      throwSourceFailure(`${descriptor.year}-Q${descriptor.q}`, result);
    }
  }
  return Array.from(sourceByAccession.values());
}

function quarterPeriods(descriptors: DatasetDescriptor[]): string[] {
  return Array.from(new Set(descriptors.map((descriptor) => descriptor.expectedPeriodOfReport))).sort();
}

function sanitizeExisting(row: FilingMetadata): SanitizedExistingExample {
  return {
    rawAccession: row.rawAccession,
    canonicalAccession: row.canonicalAccession,
    filerCik: row.filerCik,
    periodOfReport: row.periodOfReport,
    filingDate: row.filingDate,
    filingType: row.filingType,
    amendmentFlag: row.amendmentFlag,
    sourceKind: row.sourceKind,
    checksumPresent: row.checksumPresent,
  };
}

function provenanceSummary(rows: FilingMetadata[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const kind = `${row.sourceKind ?? "UNKNOWN"}:${row.checksumPresent ? "CHECKSUM" : "NO_CHECKSUM"}`;
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

function finalClassification(input: {
  normalizedOverlap: number;
  uniqueDeterministicMatches: number;
  existingOnly: number;
  provenance: Record<string, number>;
}): "LEGACY_FORMAT_ONLY" | "LEGACY_SOURCE_DIFFERENCE" | "SYNTHETIC_OR_INTERNAL_ACCESSIONS" | "WRONG_FIELD_HISTORICALLY" | "MIXED_LEGACY_DATA" | "SAFE_ZERO_OVERLAP" | "UNRESOLVED" {
  if (input.normalizedOverlap > 0 && input.existingOnly === 0) return "LEGACY_FORMAT_ONLY";
  if (input.uniqueDeterministicMatches > 0) return "LEGACY_SOURCE_DIFFERENCE";
  const provenanceKinds = Object.keys(input.provenance).map((key) => key.split(":")[0]);
  if (input.existingOnly > 0 && provenanceKinds.length > 0 && provenanceKinds.every((kind) => kind !== "SEC")) {
    return "SYNTHETIC_OR_INTERNAL_ACCESSIONS";
  }
  return "UNRESOLVED";
}

function emptyOutput(): Record<string, unknown> {
  return { finalClassification: "UNRESOLVED" };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseReconciliationArgs(args);
  validateReconciliationEnvironment(process.env);
  const config = getInstitutionalConfig();
  if (!config.secUserAgent) throw new Error("SEC_USER_AGENT_REQUIRED");

  try {
    const databaseIdentity = await checkDatabaseIdentity();
    if (
      !databaseIdentity.institutionalFilingsTablePresent ||
      !databaseIdentity.institutionalHoldingsTablePresent ||
      !databaseIdentity.ingestionRunsTablePresent
    ) {
      console.log(JSON.stringify({ databaseIdentity, ...emptyOutput() }));
      return;
    }

    let catalog: Awaited<ReturnType<typeof fetchDatasetCatalog>>;
    try {
      catalog = await fetchDatasetCatalog(config.secUserAgent);
    } catch {
      throw new ReconciliationSourceError({
        error: "SEC_SOURCE_FAILED",
        stage: "CATALOG_RESOLUTION",
        quarter: `${options.fromQuarter}..${options.toQuarter}`,
        httpStatus: null,
        contentType: null,
        safeMessage: safeSourceMessage("CATALOG_RESOLUTION"),
      });
    }
    let range: ReturnType<typeof resolveCatalogQuarterRange>;
    try {
      range = resolveCatalogQuarterRange(options.fromQuarter, options.toQuarter, catalog);
    } catch {
      throw new ReconciliationSourceError({
        error: "SEC_SOURCE_FAILED",
        stage: "CATALOG_RESOLUTION",
        quarter: `${options.fromQuarter}..${options.toQuarter}`,
        httpStatus: null,
        contentType: null,
        safeMessage: safeSourceMessage("CATALOG_RESOLUTION"),
      });
    }
    if (range.missingQuarterLabels.length > 0) {
      throw new ReconciliationSourceError({
        error: "SEC_SOURCE_FAILED",
        stage: "CATALOG_RESOLUTION",
        quarter: range.missingQuarterLabels[0],
        httpStatus: null,
        contentType: null,
        safeMessage: "SEC_DATASET_QUARTER_NOT_FOUND",
      });
    }
    const periods = quarterPeriods(range.descriptors);
    const [existingRows, sourceRows] = await Promise.all([
      readExistingFilings(periods),
      collectSourceFilings(range.descriptors),
    ]);
    const existingCanonical = new Set(existingRows.map((row) => row.canonicalAccession));
    const sourceCanonical = new Set(sourceRows.map((row) => row.canonicalAccession));
    const exactOverlap = existingRows.filter((row) => sourceRows.some((source) => source.rawAccession === row.rawAccession)).length;
    const normalizedOverlap = Array.from(existingCanonical).filter((accession) => sourceCanonical.has(accession)).length;
    const existingOnlyRows = existingRows.filter((row) => !sourceCanonical.has(row.canonicalAccession));
    const existingOnly = new Set(existingOnlyRows.map((row) => row.canonicalAccession)).size;
    const sourceOnly = Array.from(sourceCanonical).filter((accession) => !existingCanonical.has(accession)).length;
    const crossMatch = crossMatchExistingOnly(existingOnlyRows, sourceRows);
    const collisions = summarizeCanonicalCollisions(existingRows);
    const existingExamples = existingOnlyRows.slice(0, 10).map(sanitizeExisting);
    const provenance = provenanceSummary(existingRows);
    const output = {
      databaseIdentity,
      existing: {
        existingRows: existingRows.length,
        existingCanonicalAccessions: existingCanonical.size,
        duplicateCanonicalAccessions: collisions.excessRows,
        provenance,
        existingOnlyExamples: existingExamples,
      },
      source: {
        sourceRows: sourceRows.length,
        sourceCanonicalAccessions: sourceCanonical.size,
        duplicateSourceCanonicalAccessions: sourceRows.length - sourceCanonical.size,
      },
      overlap: {
        exactOverlap,
        normalizedOverlap,
        existingOnly,
        sourceOnly,
      },
      deterministicCrossMatch: {
        managerReportPeriodMatches: crossMatch.managerReportPeriodMatches,
        managerReportPeriodFilingDateMatches: crossMatch.managerReportPeriodFilingDateMatches,
        uniqueDeterministicMatches: crossMatch.uniqueDeterministicMatches,
        ambiguousDeterministicMatches: crossMatch.ambiguousDeterministicMatches,
        noDeterministicMatch: crossMatch.noDeterministicMatch,
        matchingSourceExamples: crossMatch.matchingSourceExamples,
      },
      collisions,
      existingOnlyExamples: existingExamples,
      matchingSourceExamples: crossMatch.matchingSourceExamples,
      finalClassification: finalClassification({
        normalizedOverlap,
        uniqueDeterministicMatches: crossMatch.uniqueDeterministicMatches,
        existingOnly,
        provenance,
      }),
    };
    console.log(JSON.stringify(output));
  } finally {
    await pool.end();
  }
}

if (import.meta.url.endsWith(process.argv[1] ?? "")) {
  main().catch((error: unknown) => {
    if (error instanceof ReconciliationSourceError) {
      console.log(JSON.stringify(error.report));
      process.exitCode = 1;
      return;
    }
    const code = error instanceof Error ? error.message.split(":")[0] : "RECONCILIATION_FAILED";
    console.log(JSON.stringify({ error: code }));
    process.exitCode = 1;
  });
}