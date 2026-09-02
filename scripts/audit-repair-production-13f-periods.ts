#!/usr/bin/env tsx
/**
 * Production-wide SEC filing-period contamination audit and guarded repair.
 *
 * Default mode is strictly read-only. It loads only filing metadata, verifies
 * each canonical accession against SEC submissions metadata, and returns
 * aggregate counts plus at most ten sanitized examples.
 *
 * The write path is intentionally hard to enter and is never used by the
 * documented production audit command. It requires --apply, an exact plan
 * hash, a confirmation phrase, a production Railway identity, a repeatable-read
 * transaction, and a transaction-scoped advisory lock.
 */

import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import {
  secFetch,
  SecHttpError,
  submissionsHistoryUrl,
  submissionsUrl,
} from "../server/services/institutional/sec-client";
import {
  normalizeAccession,
  normalizeDateField,
  normalizeSubmissionType,
  parseSubmissionMetadataFromArchiveBuffer,
  prepareBulkArchiveFromDescriptor,
  type SubmissionRow,
} from "../server/services/institutional/sec-13f-bulk-parser";
import {
  fetchDatasetCatalog,
  toDatasetDescriptor,
  type InstitutionalDatasetCatalogEntry,
} from "../server/services/institutional/sec-dataset-catalog";
import {
  buildHistoricalFilingRepairPlan,
  classifyStoredFilings,
  decideDuplicateHoldingDisposition,
  summarizeFilingAudit,
  type AuthoritativeFilingMetadata,
  type AccessionVerificationOutcome,
  type FilingRepairPlan,
  type HoldingFingerprint,
  type StoredFilingMetadata,
} from "../server/services/institutional/historical-filing-period-repair";

export const HISTORICAL_AUDIT_DEFAULTS = {
  maxFilings: 5_000,
  maxCiks: 5_000,
  cikBatchSize: 100,
} as const;
export const HISTORICAL_AUDIT_HARD_CEILINGS = {
  maxFilings: 10_000,
  maxCiks: 10_000,
  cikBatchSize: 500,
} as const;
const MAX_SEC_HISTORY_FILES_PER_CIK = 30;
const MAX_EXAMPLES = 10;
const STATEMENT_TIMEOUT_MS = 120_000;
const REPAIR_LOCK_KEY = 774_412_006;
const APPLY_CONFIRMATION = "REPAIR_HISTORICAL_13F_PERIODS";

type QueryResult = { rows?: unknown[] } | unknown[];
type Executor = { execute(query: unknown): Promise<QueryResult> };

export interface HistoricalPeriodAuditArgs {
  apply: boolean;
  planHash: string | null;
  confirm: string | null;
  maxFilings: number;
  maxCiks: number;
  cikBatchSize: number;
}

export function parseHistoricalPeriodAuditArgs(args: string[]): HistoricalPeriodAuditArgs {
  const parsed = parseArgs({
    args,
    options: {
      apply: { type: "boolean", default: false },
      "plan-hash": { type: "string" },
      confirm: { type: "string" },
      "max-filings": { type: "string" },
      "max-ciks": { type: "string" },
      "cik-batch-size": { type: "string" },
    },
    strict: true,
  });
  const positiveInteger = (value: string | undefined, fallback: number, name: string) => {
    const parsedValue = value === undefined ? fallback : Number(value);
    if (!Number.isSafeInteger(parsedValue) || parsedValue < 1) {
      throw new Error(`${name}_MUST_BE_POSITIVE_INTEGER`);
    }
    return parsedValue;
  };
  return {
    apply: Boolean(parsed.values.apply),
    planHash: parsed.values["plan-hash"] ? String(parsed.values["plan-hash"]) : null,
    confirm: parsed.values.confirm ? String(parsed.values.confirm) : null,
    maxFilings: positiveInteger(
      parsed.values["max-filings"] as string | undefined,
      HISTORICAL_AUDIT_DEFAULTS.maxFilings,
      "MAX_FILINGS",
    ),
    maxCiks: positiveInteger(
      parsed.values["max-ciks"] as string | undefined,
      HISTORICAL_AUDIT_DEFAULTS.maxCiks,
      "MAX_CIKS",
    ),
    cikBatchSize: positiveInteger(
      parsed.values["cik-batch-size"] as string | undefined,
      HISTORICAL_AUDIT_DEFAULTS.cikBatchSize,
      "CIK_BATCH_SIZE",
    ),
  };
}

export function validateHistoricalPeriodAuditEnvironment(
  env: NodeJS.ProcessEnv,
  apply: boolean,
): string[] {
  const issues: string[] = [];
  if (env.NODE_ENV !== "production") issues.push("PRODUCTION_NODE_ENV_REQUIRED");
  if (env.RAILWAY_ENVIRONMENT_NAME !== "production") issues.push("RAILWAY_PRODUCTION_IDENTITY_REQUIRED");
  for (const key of ["RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_ENVIRONMENT_ID"]) {
    if (!env[key]) issues.push(`${key}_REQUIRED`);
  }
  if (!env.DATABASE_URL) issues.push("DATABASE_URL_REQUIRED");
  if (env.EXTERNAL_DATABASE_URL) issues.push("EXTERNAL_DATABASE_URL_FORBIDDEN");
  if (!env.SEC_USER_AGENT) issues.push("SEC_USER_AGENT_REQUIRED");
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    const railwayHost = url.hostname.endsWith(".railway.internal") || url.hostname.endsWith(".rlwy.net");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !railwayHost) {
      issues.push("DATABASE_URL_IS_NOT_A_RAILWAY_POSTGRES_ENDPOINT");
    }
  } catch {
    if (env.DATABASE_URL) issues.push("DATABASE_URL_INVALID");
  }
  if (apply && env.DATABASE_URL?.includes("default_transaction_read_only=on")) {
    issues.push("APPLY_DATABASE_URL_IS_READ_ONLY");
  }
  return issues;
}

export function buildHistoricalAuditReadOnlyUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c default_transaction_read_only=on -c statement_timeout=${STATEMENT_TIMEOUT_MS}`);
  return url.toString();
}

export function validateHistoricalAuditBounds(options: Pick<
  HistoricalPeriodAuditArgs,
  "maxFilings" | "maxCiks" | "cikBatchSize"
>): string[] {
  const issues: string[] = [];
  if (options.maxFilings > HISTORICAL_AUDIT_HARD_CEILINGS.maxFilings) {
    issues.push("MAX_FILINGS_HARD_CEILING_EXCEEDED");
  }
  if (options.maxCiks > HISTORICAL_AUDIT_HARD_CEILINGS.maxCiks) {
    issues.push("MAX_CIKS_HARD_CEILING_EXCEEDED");
  }
  if (options.cikBatchSize > HISTORICAL_AUDIT_HARD_CEILINGS.cikBatchSize) {
    issues.push("CIK_BATCH_SIZE_HARD_CEILING_EXCEEDED");
  }
  return issues;
}

export function getHistoricalRepairApplyGuardIssues(
  args: HistoricalPeriodAuditArgs,
  plan: FilingRepairPlan,
): string[] {
  if (!args.apply) return [];
  const issues: string[] = [];
  if (!args.planHash) issues.push("PLAN_HASH_REQUIRED");
  else if (args.planHash !== plan.planHash) issues.push("PLAN_HASH_MISMATCH");
  if (args.confirm !== APPLY_CONFIRMATION) issues.push("CONFIRMATION_REQUIRED");
  if (plan.blocked.length > 0) issues.push("UNVERIFIED_OR_AMBIGUOUS_FILINGS_PRESENT");
  if (plan.replayRequiredOperations.length > 0) issues.push("REPLAY_REQUIRED_OPERATIONS_PRESENT");
  if (plan.operations.length === 0) issues.push("NO_REPAIR_OPERATIONS");
  return issues;
}

function rowsOf(result: QueryResult): Record<string, any>[] {
  return Array.isArray(result)
    ? result as Record<string, any>[]
    : ((result.rows ?? []) as Record<string, any>[]);
}

interface SecColumnarFilings {
  accessionNumber?: unknown;
  filingDate?: unknown;
  reportDate?: unknown;
  form?: unknown;
}

interface SecSubmissionsPayload {
  filings?: {
    recent?: SecColumnarFilings;
    files?: Array<{ name?: unknown }>;
  };
  accessionNumber?: unknown;
  filingDate?: unknown;
  reportDate?: unknown;
  form?: unknown;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "")) : [];
}

export function chunkCanonicalCiks(ciks: Iterable<string>, batchSize: number): string[][] {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error("CIK_BATCH_SIZE_INVALID");
  const sorted = Array.from(new Set(ciks)).sort();
  const batches: string[][] = [];
  for (let index = 0; index < sorted.length; index += batchSize) {
    batches.push(sorted.slice(index, index + batchSize));
  }
  return batches;
}

export function extractAuthoritativeSecFilings(
  payload: SecColumnarFilings,
  targetAccessions: ReadonlySet<string>,
): AuthoritativeFilingMetadata[] {
  const accessions = stringArray(payload.accessionNumber);
  const filingDates = stringArray(payload.filingDate);
  const reportDates = stringArray(payload.reportDate);
  const forms = stringArray(payload.form);
  const output: AuthoritativeFilingMetadata[] = [];
  for (let index = 0; index < accessions.length; index++) {
    const canonicalAccession = normalizeAccession(accessions[index]);
    if (!targetAccessions.has(canonicalAccession) || !/^\d{18}$/.test(canonicalAccession)) continue;
    const filingDate = normalizeDateField(filingDates[index] ?? "");
    const periodOfReport = normalizeDateField(reportDates[index] ?? "");
    const filingType = normalizeSubmissionType(forms[index] ?? "");
    if (
      !filingDate ||
      !periodOfReport ||
      (filingType !== "13F-HR" && filingType !== "13F-HR/A")
    ) continue;
    output.push({
      canonicalAccession,
      filerCik: canonicalAccession.slice(0, 10),
      filingDate,
      periodOfReport,
      filingType,
      amendmentFlag: filingType === "13F-HR/A",
    });
  }
  return output;
}

export interface SecMetadataLoadOptions {
  maxCiks?: number;
  cikBatchSize?: number;
  fetchSec?: (url: string) => Promise<string>;
  catalog?: InstitutionalDatasetCatalogEntry[];
  fetchCatalog?: () => Promise<InstitutionalDatasetCatalogEntry[]>;
  fetchArchive?: (descriptor: ReturnType<typeof toDatasetDescriptor>) => Promise<Buffer>;
  onProgress?: (progress: { processedCiks: number; totalCiks: number; batchNumber: number }) => void;
}

export interface SecMetadataVerificationStatus {
  unverifiedCiks: Set<string>;
  secNotFoundCiks: Set<string>;
  failures: SecSubmissionsFailureDetails[];
  accessionOutcomes: Map<string, AccessionVerificationOutcome>;
}

export function createSecMetadataVerificationStatus(): SecMetadataVerificationStatus {
  return {
    unverifiedCiks: new Set(),
    secNotFoundCiks: new Set(),
    failures: [],
    accessionOutcomes: new Map(),
  };
}

export class HistoricalAuditBoundError extends Error {
  constructor(
    public readonly details: {
      error: "PRODUCTION_POPULATION_EXCEEDS_HARD_CAP";
      actualFilings: number;
      actualUniqueCiks: number;
      maxFilings: number;
      maxCiks: number;
    },
  ) {
    super(details.error);
    this.name = "HistoricalAuditBoundError";
  }
}

export interface SecSubmissionsFailureDetails {
  error: "SEC_SUBMISSIONS_FETCH_FAILED" | "SEC_SUBMISSIONS_URL_INVALID";
  stage: "SEC_SUBMISSIONS_FETCH";
  cik: string;
  httpStatus: number | null;
  safeMessage: string;
}

export class SecSubmissionsFailureError extends Error {
  constructor(public readonly details: SecSubmissionsFailureDetails) {
    super(details.error);
    this.name = "SecSubmissionsFailureError";
  }
}

export function buildSecSubmissionsRequest(cik: string): { cik: string; url: string } {
  const normalized = cik.trim();
  if (!/^\d{1,10}$/.test(normalized)) {
    throw new SecSubmissionsFailureError({
      error: "SEC_SUBMISSIONS_URL_INVALID",
      stage: "SEC_SUBMISSIONS_FETCH",
      cik: normalized.slice(0, 10),
      httpStatus: null,
      safeMessage: "SEC_CIK_INVALID",
    });
  }
  const canonicalCik = normalized.replace(/^0+/, "").padStart(10, "0");
  try {
    const url = submissionsUrl(canonicalCik);
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "data.sec.gov") {
      throw new Error("SEC_SUBMISSIONS_HOST_INVALID");
    }
    return { cik: canonicalCik, url };
  } catch (error) {
    if (error instanceof SecSubmissionsFailureError) throw error;
    throw new SecSubmissionsFailureError({
      error: "SEC_SUBMISSIONS_URL_INVALID",
      stage: "SEC_SUBMISSIONS_FETCH",
      cik: canonicalCik,
      httpStatus: null,
      safeMessage: "SEC_SUBMISSIONS_URL_INVALID",
    });
  }
}

function buildSecSubmissionsFailure(cik: string, error: unknown): SecSubmissionsFailureError {
  const canonicalCik = /^\d{1,10}$/.test(cik.trim())
    ? cik.trim().replace(/^0+/, "").padStart(10, "0")
    : cik.trim().slice(0, 10);
  if (error instanceof SecSubmissionsFailureError) return error;
  if (error instanceof SecHttpError) {
    return new SecSubmissionsFailureError({
      error: "SEC_SUBMISSIONS_FETCH_FAILED",
      stage: "SEC_SUBMISSIONS_FETCH",
      cik: canonicalCik,
      httpStatus: error.status,
      safeMessage: error.status === 404
        ? "SEC_SUBMISSIONS_NOT_FOUND"
        : "SEC_SUBMISSIONS_HTTP_ERROR",
    });
  }
  return new SecSubmissionsFailureError({
    error: "SEC_SUBMISSIONS_FETCH_FAILED",
    stage: "SEC_SUBMISSIONS_FETCH",
    cik: canonicalCik,
    httpStatus: null,
    safeMessage: "SEC_SUBMISSIONS_REQUEST_FAILED",
  });
}

function recordSecFailure(
  status: SecMetadataVerificationStatus | undefined,
  failure: SecSubmissionsFailureError,
): void {
  if (!status || status.failures.length >= MAX_EXAMPLES) return;
  status.failures.push(failure.details);
}

function submissionRowToAuthoritative(row: SubmissionRow): AuthoritativeFilingMetadata {
  return {
    canonicalAccession: row.accessionNumber,
    filerCik: row.cik,
    filingDate: row.filingDate,
    periodOfReport: row.periodOfReport,
    filingType: row.formType,
    amendmentFlag: row.isAmendment,
  };
}

function sameAuthoritativeMetadata(
  left: AuthoritativeFilingMetadata,
  right: AuthoritativeFilingMetadata,
): boolean {
  return left.canonicalAccession === right.canonicalAccession &&
    left.filerCik === right.filerCik &&
    left.filingDate === right.filingDate &&
    left.periodOfReport === right.periodOfReport &&
    left.filingType === right.filingType &&
    left.amendmentFlag === right.amendmentFlag;
}

function addAuthoritativeEvidence(
  output: Map<string, AuthoritativeFilingMetadata[]>,
  evidence: AuthoritativeFilingMetadata,
): void {
  const existing = output.get(evidence.canonicalAccession);
  if (!existing) {
    output.set(evidence.canonicalAccession, [evidence]);
    return;
  }
  if (!existing.some((item) => sameAuthoritativeMetadata(item, evidence))) existing.push(evidence);
}

export function selectAccessionVerificationDescriptors(
  rows: StoredFilingMetadata[],
  catalog: InstitutionalDatasetCatalogEntry[],
): Array<ReturnType<typeof toDatasetDescriptor>> {
  const selected = new Map<string, ReturnType<typeof toDatasetDescriptor>>();
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.filingDate)) continue;
    for (const entry of catalog) {
      if (row.filingDate < entry.windowStart || row.filingDate > entry.windowEnd) continue;
      const descriptor = toDatasetDescriptor({
        entry,
        expectedPeriodOfReport: entry.expectedPeriodOfReport,
        canonicalPeriodLabel: entry.canonicalPeriodLabel,
      });
      if (!selected.has(descriptor.downloadUrl)) selected.set(descriptor.downloadUrl, descriptor);
    }
  }
  return Array.from(selected.values()).sort((a, b) => a.downloadUrl.localeCompare(b.downloadUrl));
}

async function recoverAccessionsFromBulkMetadata(
  storedRows: StoredFilingMetadata[],
  authoritative: Map<string, AuthoritativeFilingMetadata[]>,
  status: SecMetadataVerificationStatus,
  options: SecMetadataLoadOptions,
): Promise<void> {
  const unresolvedRows = storedRows.filter((row) => {
    const accession = normalizeAccession(row.rawAccession);
    return /^\d{18}$/.test(accession) && !authoritative.has(accession);
  });
  if (unresolvedRows.length === 0) return;

  let catalog = options.catalog;
  try {
    if (!catalog && options.fetchCatalog) catalog = await options.fetchCatalog();
  } catch {
    for (const row of unresolvedRows) {
      status.accessionOutcomes.set(normalizeAccession(row.rawAccession), "VERIFICATION_UNAVAILABLE");
    }
    return;
  }
  if (!catalog || catalog.length === 0) {
    for (const row of unresolvedRows) {
      status.accessionOutcomes.set(normalizeAccession(row.rawAccession), "VERIFICATION_UNAVAILABLE");
    }
    return;
  }

  const descriptors = selectAccessionVerificationDescriptors(unresolvedRows, catalog);
  const targetsByDescriptor = new Map<string, Set<string>>();
  for (const row of unresolvedRows) {
    const accession = normalizeAccession(row.rawAccession);
    for (const descriptor of descriptors) {
      if (row.filingDate >= descriptor.windowStart && row.filingDate <= descriptor.windowEnd) {
        const targets = targetsByDescriptor.get(descriptor.downloadUrl);
        if (targets) targets.add(accession);
        else targetsByDescriptor.set(descriptor.downloadUrl, new Set([accession]));
      }
    }
  }

  const unavailable = new Set<string>();
  const scanned = new Set<string>();
  for (const descriptor of descriptors) {
    const targets = targetsByDescriptor.get(descriptor.downloadUrl) ?? new Set<string>();
    if (targets.size === 0) continue;
    let buffer: Buffer;
    try {
      buffer = await (options.fetchArchive
        ? options.fetchArchive(descriptor)
        : (async () => {
          const prepared = await prepareBulkArchiveFromDescriptor(descriptor);
          if ("status" in prepared) throw new Error(prepared.failureCode ?? "SEC_ARCHIVE_UNAVAILABLE");
          return prepared.buffer;
        })());
    } catch {
      for (const accession of targets) unavailable.add(accession);
      continue;
    }
    try {
      const rowsFromArchive = parseSubmissionMetadataFromArchiveBuffer(buffer, targets);
      for (const accession of targets) scanned.add(accession);
      for (const row of rowsFromArchive) {
        addAuthoritativeEvidence(authoritative, submissionRowToAuthoritative(row));
      }
    } catch {
      for (const accession of targets) unavailable.add(accession);
    }
  }

  for (const row of unresolvedRows) {
    const accession = normalizeAccession(row.rawAccession);
    if (authoritative.has(accession)) {
      if ((authoritative.get(accession) ?? []).length > 1) {
        status.accessionOutcomes.set(accession, "AMBIGUOUS_CONFLICTING_EVIDENCE");
      }
    } else if (unavailable.has(accession) || !scanned.has(accession)) {
      status.accessionOutcomes.set(accession, "VERIFICATION_UNAVAILABLE");
    } else {
      status.accessionOutcomes.set(accession, "AUTHORITATIVE_ACCESSION_NOT_FOUND");
    }
  }
}

export async function loadAuthoritativeSecMetadata(
  storedRows: StoredFilingMetadata[],
  options: SecMetadataLoadOptions & { status?: SecMetadataVerificationStatus } = {},
): Promise<Map<string, AuthoritativeFilingMetadata[]>> {
  const maxCiks = options.maxCiks ?? HISTORICAL_AUDIT_DEFAULTS.maxCiks;
  const cikBatchSize = options.cikBatchSize ?? HISTORICAL_AUDIT_DEFAULTS.cikBatchSize;
  const fetchSec = options.fetchSec ?? secFetch;
  const targets = new Set(
    storedRows
      .map((row) => normalizeAccession(row.rawAccession))
      .filter((accession) => /^\d{18}$/.test(accession)),
  );
  const byCik = new Map<string, Set<string>>();
  for (const accession of targets) {
    const cik = accession.slice(0, 10);
    const group = byCik.get(cik);
    if (group) group.add(accession);
    else byCik.set(cik, new Set([accession]));
  }
  if (byCik.size > maxCiks) {
    throw new HistoricalAuditBoundError({
      error: "PRODUCTION_POPULATION_EXCEEDS_HARD_CAP",
      actualFilings: storedRows.length,
      actualUniqueCiks: byCik.size,
      maxFilings: storedRows.length,
      maxCiks,
    });
  }

  const output = new Map<string, AuthoritativeFilingMetadata[]>();
  const batches = chunkCanonicalCiks(byCik.keys(), cikBatchSize);
  let processedCiks = 0;
  for (let batchNumber = 0; batchNumber < batches.length; batchNumber++) {
    // Deliberately serial: SEC request state and each batch are bounded before
    // the next batch is allocated. No Promise.all over the production CIK set.
    for (const cik of batches[batchNumber]) {
      const cikTargets = byCik.get(cik)!;
      const request = buildSecSubmissionsRequest(cik);
      let body: string;
      try {
        body = await fetchSec(request.url);
      } catch (error) {
        const failure = buildSecSubmissionsFailure(request.cik, error);
        if (failure.details.httpStatus === 404) {
          // A missing filer endpoint is record-level source unavailability.
          // Continue the bounded batch; the absent map entries classify those
          // accessions as SOURCE_IDENTITY_NOT_VERIFIED.
          options.status?.unverifiedCiks.add(request.cik);
          options.status?.secNotFoundCiks.add(request.cik);
          recordSecFailure(options.status, failure);
          processedCiks++;
          continue;
        }
        throw failure;
      }
      let payload: SecSubmissionsPayload;
      try {
        payload = JSON.parse(body) as SecSubmissionsPayload;
      } catch {
        throw new Error("SEC_SUBMISSIONS_JSON_INVALID");
      }
      const found = extractAuthoritativeSecFilings(payload.filings?.recent ?? {}, cikTargets);
      for (const filing of found) output.set(filing.canonicalAccession, [filing]);

      const unresolved = new Set(Array.from(cikTargets).filter((accession) => !output.has(accession)));
      const historyFiles = (payload.filings?.files ?? [])
        .map((item) => typeof item.name === "string" ? item.name : "")
        .filter((name) => /^CIK\d+-submissions-\d{3}\.json$/.test(name))
        .slice(0, MAX_SEC_HISTORY_FILES_PER_CIK);
      for (const fileName of historyFiles) {
        if (unresolved.size === 0) break;
        let historyText: string;
        try {
          historyText = await fetchSec(submissionsHistoryUrl(fileName));
        } catch (error) {
          const failure = buildSecSubmissionsFailure(cik, error);
          if (failure.details.httpStatus === 404) {
            // No alternate URL is invented. Remaining accessions are left
            // without metadata and therefore fail closed during classification.
            options.status?.unverifiedCiks.add(cik);
            for (const accession of unresolved) {
              options.status?.accessionOutcomes.set(accession, "VERIFICATION_UNAVAILABLE");
            }
            recordSecFailure(options.status, failure);
            break;
          }
          throw failure;
        }
        let history: SecSubmissionsPayload;
        try {
          history = JSON.parse(historyText) as SecSubmissionsPayload;
        } catch {
          throw new Error("SEC_SUBMISSIONS_HISTORY_JSON_INVALID");
        }
        for (const filing of extractAuthoritativeSecFilings(history, unresolved)) {
          const existing = output.get(filing.canonicalAccession);
          if (existing) existing.push(filing);
          else output.set(filing.canonicalAccession, [filing]);
          unresolved.delete(filing.canonicalAccession);
        }
      }
      if (unresolved.size > 0) options.status?.unverifiedCiks.add(cik);
      processedCiks++;
    }
    options.onProgress?.({ processedCiks, totalCiks: byCik.size, batchNumber: batchNumber + 1 });
  }
  if (options.status) {
    await recoverAccessionsFromBulkMetadata(storedRows, output, options.status, options);
  }
  return output;
}

interface FilingPopulation {
  actualFilings: number;
  actualUniqueCiks: number;
}

async function readFilingPopulation(executor: Executor): Promise<FilingPopulation> {
  const tableResult = await executor.execute(sql`
    SELECT to_regclass('public.institutional_13f_filings')::text AS table_name
  `);
  if (!rowsOf(tableResult)[0]?.table_name) throw new Error("INSTITUTIONAL_FILINGS_TABLE_REQUIRED");
  const result = await executor.execute(sql`
    SELECT COUNT(*)::int AS "actualFilings",
           COUNT(DISTINCT LPAD(regexp_replace(filer_cik, '[^0-9]', '', 'g'), 10, '0'))::int AS "actualUniqueCiks"
      FROM institutional_13f_filings
  `);
  const row = rowsOf(result)[0] ?? {};
  return {
    actualFilings: Number(row.actualFilings ?? 0),
    actualUniqueCiks: Number(row.actualUniqueCiks ?? 0),
  };
}

export async function readStoredFilings(
  executor: Executor,
  limits: Pick<HistoricalPeriodAuditArgs, "maxFilings" | "maxCiks"> = HISTORICAL_AUDIT_DEFAULTS,
): Promise<StoredFilingMetadata[]> {
  const population = await readFilingPopulation(executor);
  if (
    population.actualFilings > limits.maxFilings ||
    population.actualUniqueCiks > limits.maxCiks
  ) {
    throw new HistoricalAuditBoundError({
      error: "PRODUCTION_POPULATION_EXCEEDS_HARD_CAP",
      ...population,
      maxFilings: limits.maxFilings,
      maxCiks: limits.maxCiks,
    });
  }
  const result = await executor.execute(sql`
    SELECT id::text AS id,
           accession_number AS "rawAccession",
           filer_name AS "filerName",
           filer_cik AS "filerCik",
           filing_date::text AS "filingDate",
           period_of_report::text AS "periodOfReport",
           filing_type AS "filingType",
           amendment_flag AS "amendmentFlag",
           is_effective AS "isEffective"
      FROM institutional_13f_filings
     ORDER BY regexp_replace(accession_number, '[^0-9]', '', 'g'), id
     LIMIT ${limits.maxFilings + 1}
  `);
  const rows = rowsOf(result);
  if (rows.length > limits.maxFilings) {
    throw new HistoricalAuditBoundError({
      error: "PRODUCTION_POPULATION_EXCEEDS_HARD_CAP",
      actualFilings: population.actualFilings,
      actualUniqueCiks: population.actualUniqueCiks,
      maxFilings: limits.maxFilings,
      maxCiks: limits.maxCiks,
    });
  }
  return rows.map((row) => ({
    id: String(row.id),
    rawAccession: String(row.rawAccession),
    filerName: String(row.filerName ?? row.filerCik),
    filerCik: String(row.filerCik),
    filingDate: String(row.filingDate),
    periodOfReport: String(row.periodOfReport),
    filingType: String(row.filingType),
    amendmentFlag: Boolean(row.amendmentFlag),
    isEffective: Boolean(row.isEffective),
  }));
}

export async function readDuplicateHoldingFingerprints(
  executor: Executor,
  rows: StoredFilingMetadata[],
): Promise<Map<string, HoldingFingerprint>> {
  const duplicateRows = rows.filter((row, index) => rows.some(
    (other, otherIndex) =>
      otherIndex !== index && normalizeAccession(other.rawAccession) === normalizeAccession(row.rawAccession),
  ));
  const rawAccessions = Array.from(new Set(duplicateRows.map((row) => row.rawAccession))).sort();
  if (rawAccessions.length === 0) return new Map();
  const values = sql.join(rawAccessions.map((value) => sql`${value}`), sql`, `);
  const result = await executor.execute(sql`
    SELECT accession_number AS "rawAccession",
           COUNT(*)::int AS row_count,
           md5(COALESCE(string_agg(
             concat_ws('|', cusip, class_title, COALESCE(put_call, ''), issuer_name,
               COALESCE(reported_value::text, ''), COALESCE(reported_shares::text, ''),
               COALESCE(shares_prn_type, ''), COALESCE(investment_discretion, ''),
               COALESCE(voting_sole::text, ''), COALESCE(voting_shared::text, ''),
               COALESCE(voting_none::text, '')),
             E'\n' ORDER BY cusip, class_title, COALESCE(put_call, ''), issuer_name
           ), '')) AS digest
      FROM institutional_13f_holdings
     WHERE accession_number IN (${values})
     GROUP BY accession_number
  `);
  const fingerprints = new Map<string, HoldingFingerprint>(
    rawAccessions.map((accession) => [accession, { count: 0, digest: "" }]),
  );
  for (const row of rowsOf(result)) {
    fingerprints.set(
      String(row.rawAccession),
      { count: Number(row.row_count ?? 0), digest: String(row.digest ?? "") },
    );
  }
  return fingerprints;
}

export function buildDuplicateDispositions(
  rows: StoredFilingMetadata[],
  fingerprints: ReadonlyMap<string, HoldingFingerprint>,
): Map<string, ReturnType<typeof decideDuplicateHoldingDisposition>> {
  const dispositions = new Map<string, ReturnType<typeof decideDuplicateHoldingDisposition>>();
  const grouped = new Map<string, StoredFilingMetadata[]>();
  for (const row of rows) {
    const accession = normalizeAccession(row.rawAccession);
    const group = grouped.get(accession);
    if (group) group.push(row);
    else grouped.set(accession, [row]);
  }
  for (const [accession, groupRows] of Array.from(grouped.entries())) {
    if (groupRows.length < 2) continue;
    const sorted = [...groupRows].sort((a, b) => {
      const aCanonical = a.rawAccession === accession ? 0 : 1;
      const bCanonical = b.rawAccession === accession ? 0 : 1;
      return aCanonical - bCanonical || a.id.localeCompare(b.id);
    });
    let survivor = fingerprints.get(sorted[0].rawAccession);
    if (!survivor) continue;
    let disposition: ReturnType<typeof decideDuplicateHoldingDisposition> = "NOOP_EMPTY_DUPLICATE";
    for (const duplicate of sorted.slice(1)) {
      const duplicateFingerprint = fingerprints.get(duplicate.rawAccession);
      if (!duplicateFingerprint) {
        disposition = "REPLAY_REQUIRED";
        break;
      }
      disposition = decideDuplicateHoldingDisposition(survivor, duplicateFingerprint);
      if (disposition === "REPLAY_REQUIRED") break;
      if (disposition === "MOVE_DUPLICATE_TO_EMPTY_SURVIVOR") survivor = duplicateFingerprint;
    }
    dispositions.set(accession, disposition);
  }
  return dispositions;
}

export async function readDownstreamImpact(
  executor: Executor,
  categories: {
    verifiedMetadataMismatches: string[];
    canonicalDuplicates: string[];
    unverifiedFilings: string[];
  },
): Promise<Record<string, unknown>> {
  const categorized = [
    ...categories.verifiedMetadataMismatches.map((accession) => ["verifiedMetadataMismatches", accession] as const),
    ...categories.canonicalDuplicates.map((accession) => ["canonicalDuplicates", accession] as const),
    ...categories.unverifiedFilings.map((accession) => ["unverifiedFilings", accession] as const),
  ];
  if (categorized.length === 0) {
    return {
      holdings: 0,
      effectiveFilings: 0,
      quarterlyAggregates: 0,
      signals: 0,
      sectorSnapshots: 0,
      themeSnapshots: 0,
      affectedSymbols: 0,
      categoryImpact: {
        verifiedMetadataMismatches: { holdings: 0, effectiveFilings: 0, aggregates: 0, signals: 0, affectedSymbols: 0 },
        canonicalDuplicates: { holdings: 0, effectiveFilings: 0, aggregates: 0, signals: 0, affectedSymbols: 0 },
        unverifiedFilings: { holdings: 0, effectiveFilings: 0, aggregates: 0, signals: 0, affectedSymbols: 0 },
      },
      downstreamGeneratedFromContaminatedFilings: false,
    };
  }
  const categorizedValues = sql.join(
    categorized.map(([category, accession]) => sql`(${category}, ${accession})`),
    sql`, `,
  );
  const result = await executor.execute(sql`
    WITH categorized_accessions(category, accession) AS (
      VALUES ${categorizedValues}
    ),
    affected_holdings AS (
      SELECT ca.category, h.*
        FROM institutional_13f_holdings h
        JOIN categorized_accessions ca
          ON regexp_replace(h.accession_number, '[^0-9]', '', 'g') = ca.accession
    ),
    affected_symbols AS (
      SELECT DISTINCT category, mapped_symbol AS symbol, period_of_report
        FROM affected_holdings
       WHERE mapped_symbol IS NOT NULL
    ),
    affected_aggregates AS (
      SELECT s.category, a.*
        FROM institutional_quarterly_aggregates a
        JOIN affected_symbols s
          ON s.symbol = a.symbol
         AND s.period_of_report = a.period_of_report
    ),
    affected_signals AS (
      SELECT i.category, s.*
        FROM institutional_symbol_signals s
        JOIN affected_symbols i ON i.symbol = s.symbol
    )
    SELECT category,
      (SELECT COUNT(*)::int FROM affected_holdings h WHERE h.category = c.category) AS holdings,
      (SELECT COUNT(*)::int FROM institutional_13f_filings f
        JOIN categorized_accessions ca
          ON regexp_replace(f.accession_number, '[^0-9]', '', 'g') = ca.accession
        WHERE ca.category = c.category AND f.is_effective) AS "effectiveFilings",
      (SELECT COUNT(*)::int FROM affected_aggregates a WHERE a.category = c.category) AS aggregates,
      (SELECT COUNT(*)::int FROM affected_signals s WHERE s.category = c.category) AS signals,
      (SELECT COUNT(*)::int FROM affected_symbols s WHERE s.category = c.category) AS "affectedSymbols"
    FROM (SELECT DISTINCT category FROM categorized_accessions) c
    ORDER BY category
  `);
  const emptyCategory = () => ({ holdings: 0, effectiveFilings: 0, aggregates: 0, signals: 0, affectedSymbols: 0 });
  const categoryImpact: Record<string, ReturnType<typeof emptyCategory>> = {
    verifiedMetadataMismatches: emptyCategory(),
    canonicalDuplicates: emptyCategory(),
    unverifiedFilings: emptyCategory(),
  };
  for (const row of rowsOf(result)) {
    const category = String(row.category);
    if (category in categoryImpact) {
      categoryImpact[category] = {
        holdings: Number(row.holdings ?? 0),
        effectiveFilings: Number(row.effectiveFilings ?? 0),
        aggregates: Number(row.aggregates ?? 0),
        signals: Number(row.signals ?? 0),
        affectedSymbols: Number(row.affectedSymbols ?? 0),
      };
    }
  }
  const totals = Object.values(categoryImpact).reduce((sum, item) => ({
    holdings: sum.holdings + item.holdings,
    effectiveFilings: sum.effectiveFilings + item.effectiveFilings,
    aggregates: sum.aggregates + item.aggregates,
    signals: sum.signals + item.signals,
    affectedSymbols: sum.affectedSymbols + item.affectedSymbols,
  }), emptyCategory());
  return {
    holdings: totals.holdings,
    effectiveFilings: totals.effectiveFilings,
    quarterlyAggregates: totals.aggregates,
    signals: totals.signals,
    sectorSnapshots: 0,
    themeSnapshots: 0,
    affectedSymbols: totals.affectedSymbols,
    categoryImpact,
    downstreamRowsLinkedToCanonicalDuplicates: categoryImpact.canonicalDuplicates,
    downstreamRowsLinkedToUnverifiedFilings: categoryImpact.unverifiedFilings,
    downstreamRowsLinkedToVerifiedMetadataMismatches: categoryImpact.verifiedMetadataMismatches,
    downstreamGeneratedFromContaminatedFilings:
      totalsForCategory(categoryImpact.verifiedMetadataMismatches) > 0,
  };
}

function totalsForCategory(category: {
  holdings: number;
  effectiveFilings: number;
  aggregates: number;
  signals: number;
  affectedSymbols: number;
}): number {
  return category.holdings + category.aggregates + category.signals + category.affectedSymbols;
}

function sanitizedExamples(classified: ReturnType<typeof classifyStoredFilings>) {
  return classified
    .filter((row) => row.accessionClassification !== "VERIFIED_VALID")
    .slice(0, MAX_EXAMPLES)
    .map((row) => ({
      accession: row.canonicalAccession,
      canonicalCik: row.canonicalAccession.slice(0, 10),
      classification: row.classification,
      accessionClassification: row.accessionClassification,
      storedPeriodOfReport: row.periodOfReport,
      secPeriodOfReport: row.authoritative?.periodOfReport ?? null,
      storedFilingDate: row.filingDate,
      secFilingDate: row.authoritative?.filingDate ?? null,
      mismatches: row.mismatches,
      reason: row.accessionClassification,
    }));
}

export async function runHistoricalPeriodAudit(
  executor: Executor,
  authoritativeLoader: (
    rows: StoredFilingMetadata[],
    status: SecMetadataVerificationStatus,
  ) => Promise<Map<string, AuthoritativeFilingMetadata[]>>,
  limits: Pick<HistoricalPeriodAuditArgs, "maxFilings" | "maxCiks" | "cikBatchSize"> =
    HISTORICAL_AUDIT_DEFAULTS,
) {
  const storedRows = await readStoredFilings(executor, limits);
  const verificationStatus = createSecMetadataVerificationStatus();
  const authoritative = await authoritativeLoader(storedRows, verificationStatus);
  const classified = classifyStoredFilings(
    storedRows,
    authoritative,
    verificationStatus.accessionOutcomes,
  );
  const fingerprints = await readDuplicateHoldingFingerprints(executor, storedRows);
  const summary = summarizeFilingAudit(classified, fingerprints);
  const duplicateDispositions = buildDuplicateDispositions(storedRows, fingerprints);
  const plan = buildHistoricalFilingRepairPlan(storedRows, authoritative, {
    duplicateDispositions,
  });
  const canonicalClassifications = new Map<string, string>();
  for (const row of classified) {
    if (!canonicalClassifications.has(row.canonicalAccession)) {
      canonicalClassifications.set(row.canonicalAccession, row.accessionClassification);
    }
  }
  const impact = await readDownstreamImpact(executor, {
    verifiedMetadataMismatches: Array.from(canonicalClassifications)
      .filter(([, classification]) => [
        "VERIFIED_PERIOD_MISMATCH",
        "VERIFIED_FILING_DATE_MISMATCH",
        "VERIFIED_CIK_MISMATCH",
      ].includes(classification))
      .map(([accession]) => accession)
      .sort(),
    canonicalDuplicates: Array.from(canonicalClassifications)
      .filter(([, classification]) => classification === "VERIFIED_CANONICAL_DUPLICATE")
      .map(([accession]) => accession)
      .sort(),
    unverifiedFilings: Array.from(canonicalClassifications)
      .filter(([, classification]) => [
        "AUTHORITATIVE_ACCESSION_NOT_FOUND",
        "VERIFICATION_UNAVAILABLE",
        "AMBIGUOUS_CONFLICTING_EVIDENCE",
      ].includes(classification))
      .map(([accession]) => accession)
      .sort(),
  });
  const exactMetadataMismatchAccessions = [
    "VERIFIED_PERIOD_MISMATCH",
    "VERIFIED_FILING_DATE_MISMATCH",
    "VERIFIED_CIK_MISMATCH",
  ].reduce((count, classification) =>
    count + (summary.canonicalClassificationCounts[
      classification as keyof typeof summary.canonicalClassificationCounts
    ] ?? 0), 0);
  const impossibleToVerifyAccessions = [
    "AUTHORITATIVE_ACCESSION_NOT_FOUND",
    "VERIFICATION_UNAVAILABLE",
    "AMBIGUOUS_CONFLICTING_EVIDENCE",
  ].reduce((count, classification) =>
    count + (summary.canonicalClassificationCounts[
      classification as keyof typeof summary.canonicalClassificationCounts
    ] ?? 0), 0);
  const historicalBackfillBlockers = [
    ...(impossibleToVerifyAccessions > 0 ? ["UNRESOLVED_AUTHORITATIVE_IDENTITIES"] : []),
    ...(plan.replayRequiredOperations.length > 0 ? ["DUPLICATE_REPLAY_REQUIRED"] : []),
  ];
  return {
    mode: "DRY_RUN",
    rootCause: {
      code: "LEGACY_REQUESTED_PERIOD_SUBSTITUTION",
      currentPathAffected: false,
      evidence: "Legacy per-filing XML ingestion assigned targetPeriodOfReport to filing and holding rows; current bulk ingestion derives PERIODOFREPORT from accession-scoped SEC submission rows.",
    },
    audit: {
      ...summary,
      unverifiedCiks: verificationStatus.unverifiedCiks.size,
      secNotFoundCiks: verificationStatus.secNotFoundCiks.size,
      secSubmissionFailures: verificationStatus.failures,
    },
    downstreamImpact: impact,
    conclusions: {
      productionPeriodContaminationProven: summary.periodMismatchesSEC > 0,
      exactSecMetadataMismatchAccessions: exactMetadataMismatchAccessions,
      canonicalDuplicateRows: summary.canonicalDuplicateRows,
      impossibleToVerifyAccessions,
      safeDuplicateCleanupGroups: summary.safeDuplicateCleanupGroups,
      historicalBackfillBlocked: historicalBackfillBlockers.length > 0,
      historicalBackfillBlockers,
    },
    repairPlan: {
      planHash: plan.planHash,
      operationCount: plan.operations.length,
      blockedCount: plan.blocked.length,
      duplicateCleanupOperations: plan.duplicateCleanupOperations.length,
      metadataCorrectionOperations: plan.metadataCorrectionOperations.length,
      replayRequiredOperations: plan.replayRequiredOperations.length,
      blockedOperations: plan.blockedOperations.length,
      canonicalDuplicateGroups: plan.operations.filter((operation) => operation.duplicateIds.length > 0).length,
      affectedPeriods: plan.affectedPeriods,
      blockedReasons: Object.fromEntries(
        Array.from(new Set(plan.blocked.map((item) => item.reason))).map((reason) => [
          reason,
          plan.blocked.filter((item) => item.reason === reason).length,
        ]),
      ),
    },
    examples: sanitizedExamples(classified),
    plan,
    authoritative,
  };
}

async function holdingFingerprint(executor: Executor, accession: string) {
  const result = await executor.execute(sql`
    SELECT COUNT(*)::int AS row_count,
           md5(COALESCE(string_agg(
             concat_ws('|', cusip, class_title, COALESCE(put_call, ''), issuer_name,
               COALESCE(reported_value::text, ''), COALESCE(reported_shares::text, ''),
               COALESCE(shares_prn_type, ''), COALESCE(investment_discretion, ''),
               COALESCE(voting_sole::text, ''), COALESCE(voting_shared::text, ''),
               COALESCE(voting_none::text, '')),
             E'\n' ORDER BY cusip, class_title, COALESCE(put_call, ''), issuer_name
           ), '')) AS digest
      FROM institutional_13f_holdings
     WHERE accession_number = ${accession}
  `);
  const row = rowsOf(result)[0] ?? {};
  return { count: Number(row.row_count ?? 0), digest: String(row.digest ?? "") };
}

async function applyHistoricalFilingRepair(
  database: { transaction<T>(callback: (tx: Executor) => Promise<T>): Promise<T> },
  expectedPlan: FilingRepairPlan,
  authoritative: Map<string, AuthoritativeFilingMetadata[]>,
): Promise<Array<{ symbol: string; periodOfReport: string }>> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    const lock = rowsOf(await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${REPAIR_LOCK_KEY}::bigint) AS locked`,
    ));
    if (lock[0]?.locked !== true) throw new Error("HISTORICAL_PERIOD_REPAIR_LOCK_HELD");
    const currentRows = await readStoredFilings(tx, HISTORICAL_AUDIT_DEFAULTS);
    const currentFingerprints = await readDuplicateHoldingFingerprints(tx, currentRows);
    const currentPlan = buildHistoricalFilingRepairPlan(currentRows, authoritative, {
      duplicateDispositions: buildDuplicateDispositions(currentRows, currentFingerprints),
    });
    if (currentPlan.planHash !== expectedPlan.planHash) throw new Error("HISTORICAL_PERIOD_REPAIR_PLAN_DRIFT");
    if (currentPlan.blocked.length > 0) throw new Error("HISTORICAL_PERIOD_REPAIR_BLOCKED");

    const affectedSymbols = new Set<string>();
    const affectedPairs = new Set<string>();
    for (const operation of currentPlan.operations) {
      const groupRows = currentRows.filter(
        (row) => normalizeAccession(row.rawAccession) === operation.canonicalAccession,
      );
      const survivor = groupRows.find((row) => row.id === operation.survivorId);
      if (!survivor) throw new Error("HISTORICAL_PERIOD_REPAIR_SURVIVOR_MISSING");
      const symbolRows = rowsOf(await tx.execute(sql`
        SELECT DISTINCT mapped_symbol AS symbol
          FROM institutional_13f_holdings
         WHERE regexp_replace(accession_number, '[^0-9]', '', 'g') = ${operation.canonicalAccession}
           AND mapped_symbol IS NOT NULL
      `));
      for (const row of symbolRows) affectedSymbols.add(String(row.symbol));

      let survivorAccession = survivor.rawAccession;
      let survivorFingerprint = await holdingFingerprint(tx, survivorAccession);
      for (const duplicateId of operation.duplicateIds) {
        const duplicate = groupRows.find((row) => row.id === duplicateId);
        if (!duplicate) throw new Error("HISTORICAL_PERIOD_REPAIR_DUPLICATE_MISSING");
        const duplicateFingerprint = await holdingFingerprint(tx, duplicate.rawAccession);
        const disposition = decideDuplicateHoldingDisposition(
          survivorFingerprint,
          duplicateFingerprint,
        );
        if (disposition === "MOVE_DUPLICATE_TO_EMPTY_SURVIVOR") {
          await tx.execute(sql`
            UPDATE institutional_13f_holdings
               SET accession_number = ${survivorAccession}
             WHERE accession_number = ${duplicate.rawAccession}
          `);
          survivorFingerprint = duplicateFingerprint;
        } else if (disposition === "DELETE_IDENTICAL_DUPLICATE") {
          await tx.execute(sql`
            DELETE FROM institutional_13f_holdings
             WHERE accession_number = ${duplicate.rawAccession}
          `);
        } else if (disposition === "REPLAY_REQUIRED") {
          throw new Error("HISTORICAL_PERIOD_REPAIR_REPLAY_REQUIRED");
        }
        await tx.execute(sql`DELETE FROM institutional_13f_filings WHERE id = ${duplicate.id}`);
      }

      if (survivorAccession !== operation.canonicalAccession) {
        await tx.execute(sql`
          UPDATE institutional_13f_holdings
             SET accession_number = ${operation.canonicalAccession}
           WHERE accession_number = ${survivorAccession}
        `);
        await tx.execute(sql`
          UPDATE institutional_13f_filings
             SET accession_number = ${operation.canonicalAccession}
           WHERE id = ${operation.survivorId}
        `);
        survivorAccession = operation.canonicalAccession;
      }

      const source = operation.authoritative;
      await tx.execute(sql`
        UPDATE institutional_13f_filings
           SET filer_cik = ${source.filerCik},
               filing_date = ${source.filingDate},
               period_of_report = ${source.periodOfReport},
               filing_type = ${source.filingType},
               amendment_flag = ${source.amendmentFlag}
         WHERE id = ${operation.survivorId}
      `);
      await tx.execute(sql`
        UPDATE institutional_13f_holdings
           SET filer_cik = ${source.filerCik},
               filing_date = ${source.filingDate},
               period_of_report = ${source.periodOfReport}
         WHERE accession_number = ${survivorAccession}
      `);
      for (const period of new Set([...operation.oldPeriods, source.periodOfReport])) {
        affectedPairs.add(`${source.filerCik}|${period}`);
      }
    }

    for (const pair of affectedPairs) {
      const [filerCik, period] = pair.split("|");
      await tx.execute(sql`
        UPDATE institutional_13f_filings
           SET is_effective = id = (
             SELECT id
               FROM institutional_13f_filings
              WHERE filer_cik = ${filerCik}
                AND period_of_report = ${period}
              ORDER BY amendment_flag DESC, filing_date DESC, accession_number DESC
              LIMIT 1
           )
         WHERE filer_cik = ${filerCik}
           AND period_of_report = ${period}
      `);
    }

    const targets: Array<{ symbol: string; periodOfReport: string }> = [];
    for (const symbol of affectedSymbols) {
      for (const period of currentPlan.affectedPeriods) targets.push({ symbol, periodOfReport: period });
    }
    return targets;
  });
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseHistoricalPeriodAuditArgs(args);
  const environmentIssues = validateHistoricalPeriodAuditEnvironment(process.env, options.apply);
  const boundIssues = validateHistoricalAuditBounds(options);
  if (environmentIssues.length > 0 || boundIssues.length > 0) {
    throw new Error(`PRODUCTION_RUNTIME_REJECTED:${[...environmentIssues, ...boundIssues].join(",")}`);
  }
  if (!options.apply) process.env.DATABASE_URL = buildHistoricalAuditReadOnlyUrl(process.env.DATABASE_URL!);

  const { db, pool } = await import("../server/db");
  try {
    if (!options.apply) {
      const mode = rowsOf(await db.execute(sql.raw("SHOW default_transaction_read_only")))[0]
        ?.default_transaction_read_only;
      if (mode !== "on") throw new Error("READ_ONLY_SESSION_REQUIRED");
    }
    const result = await runHistoricalPeriodAudit(
      db as unknown as Executor,
      (rows, status) => loadAuthoritativeSecMetadata(rows, {
        maxCiks: options.maxCiks,
        cikBatchSize: options.cikBatchSize,
        status,
        fetchCatalog: () => fetchDatasetCatalog(process.env.SEC_USER_AGENT!),
        onProgress: (progress) => {
          if (process.env.HISTORICAL_AUDIT_PROGRESS === "1") {
            console.error(JSON.stringify(progress));
          }
        },
      }),
      options,
    );
    const publicReport = {
      mode: options.apply ? "APPLY_REQUESTED" : result.mode,
      rootCause: result.rootCause,
      productionContaminationAudit: result.audit,
      downstreamImpact: result.downstreamImpact,
      conclusions: result.conclusions,
      legacyRepairDesign: result.repairPlan,
      examples: result.examples,
    };
    if (!options.apply) {
      console.log(JSON.stringify(publicReport, null, 2));
      return;
    }

    const guardIssues = getHistoricalRepairApplyGuardIssues(options, result.plan);
    if (guardIssues.length > 0) {
      throw new Error(`HISTORICAL_PERIOD_REPAIR_GUARD_REJECTED:${guardIssues.join(",")}`);
    }
    const targets = await applyHistoricalFilingRepair(
      db as unknown as { transaction<T>(callback: (tx: Executor) => Promise<T>): Promise<T> },
      result.plan,
      result.authoritative,
    );
    const { materializeAffectedInstitutionalTargets } = await import(
      "../server/services/institutional/ingestion-service"
    );
    const materialization = await materializeAffectedInstitutionalTargets(targets);
    console.log(JSON.stringify({
      ...publicReport,
      mode: "APPLIED",
      appliedOperations: result.plan.operations.length,
      materialization: {
        targetCount: targets.length,
        failedTargetCount: materialization.failedTargets.length,
        snapshotRefreshAttempted: targets.length > 0,
      },
    }, null, 2));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.includes("audit-repair-production-13f-periods")) {
  main().catch((error) => {
    if (error instanceof HistoricalAuditBoundError || error instanceof SecSubmissionsFailureError) {
      console.error(JSON.stringify(error.details));
    } else {
      console.error(JSON.stringify({
        error: error instanceof Error ? error.message.split(":")[0] : "HISTORICAL_PERIOD_AUDIT_FAILED",
      }));
    }
    process.exitCode = 1;
  });
}