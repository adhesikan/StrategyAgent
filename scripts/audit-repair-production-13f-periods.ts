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
import { normalizeAccession, normalizeDateField, normalizeSubmissionType } from "../server/services/institutional/sec-13f-bulk-parser";
import {
  buildHistoricalFilingRepairPlan,
  classifyStoredFilings,
  decideDuplicateHoldingDisposition,
  summarizeFilingAudit,
  type AuthoritativeFilingMetadata,
  type FilingRepairPlan,
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
  onProgress?: (progress: { processedCiks: number; totalCiks: number; batchNumber: number }) => void;
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

export async function loadAuthoritativeSecMetadata(
  storedRows: StoredFilingMetadata[],
  options: SecMetadataLoadOptions = {},
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
        throw buildSecSubmissionsFailure(request.cik, error);
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
          throw buildSecSubmissionsFailure(cik, error);
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
      processedCiks++;
    }
    options.onProgress?.({ processedCiks, totalCiks: byCik.size, batchNumber: batchNumber + 1 });
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

async function readStoredFilings(
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
    filerCik: String(row.filerCik),
    filingDate: String(row.filingDate),
    periodOfReport: String(row.periodOfReport),
    filingType: String(row.filingType),
    amendmentFlag: Boolean(row.amendmentFlag),
    isEffective: Boolean(row.isEffective),
  }));
}

async function readDownstreamImpact(
  executor: Executor,
  canonicalAccessions: string[],
  affectedPeriods: string[],
): Promise<Record<string, unknown>> {
  if (canonicalAccessions.length === 0) {
    return {
      holdings: 0,
      effectiveFilings: 0,
      quarterlyAggregates: 0,
      signals: 0,
      sectorSnapshots: 0,
      themeSnapshots: 0,
      affectedSymbols: 0,
      downstreamGeneratedFromContaminatedFilings: false,
    };
  }
  const accessions = sql.join(canonicalAccessions.map((value) => sql`${value}`), sql`, `);
  const periods = affectedPeriods.length
    ? sql.join(affectedPeriods.map((value) => sql`${value}`), sql`, `)
    : sql`NULL`;
  const result = await executor.execute(sql`
    WITH affected_holdings AS (
      SELECT h.*
        FROM institutional_13f_holdings h
       WHERE regexp_replace(h.accession_number, '[^0-9]', '', 'g') IN (${accessions})
    ),
    affected_symbols AS (
      SELECT DISTINCT mapped_symbol AS symbol
        FROM affected_holdings
       WHERE mapped_symbol IS NOT NULL
    ),
    affected_aggregates AS (
      SELECT a.*
        FROM institutional_quarterly_aggregates a
       WHERE a.period_of_report::text IN (${periods})
         AND a.symbol IN (SELECT symbol FROM affected_symbols)
    ),
    affected_signals AS (
      SELECT s.*
        FROM institutional_symbol_signals s
       WHERE s.symbol IN (SELECT symbol FROM affected_symbols)
    )
    SELECT
      (SELECT COUNT(*)::int FROM affected_holdings) AS holdings,
      (SELECT COUNT(*)::int FROM institutional_13f_filings f
        WHERE f.is_effective
          AND regexp_replace(f.accession_number, '[^0-9]', '', 'g') IN (${accessions})
      ) AS "effectiveFilings",
      (SELECT COUNT(*)::int FROM affected_aggregates) AS "quarterlyAggregates",
      (SELECT COUNT(*)::int FROM affected_signals) AS signals,
      (SELECT COUNT(*)::int FROM affected_symbols) AS "affectedSymbols",
      CASE WHEN EXISTS (SELECT 1 FROM affected_signals)
        THEN (SELECT COUNT(*)::int FROM sector_intelligence_snapshots
               WHERE generated_at = (SELECT MAX(generated_at) FROM sector_intelligence_snapshots))
        ELSE 0 END AS "sectorSnapshots",
      CASE WHEN EXISTS (SELECT 1 FROM affected_signals)
        THEN (SELECT COUNT(*)::int FROM theme_intelligence_snapshots
               WHERE generated_at = (SELECT MAX(generated_at) FROM theme_intelligence_snapshots))
        ELSE 0 END AS "themeSnapshots"
  `);
  const row = rowsOf(result)[0] ?? {};
  const quarterlyAggregates = Number(row.quarterlyAggregates ?? 0);
  const signals = Number(row.signals ?? 0);
  return {
    holdings: Number(row.holdings ?? 0),
    effectiveFilings: Number(row.effectiveFilings ?? 0),
    quarterlyAggregates,
    signals,
    sectorSnapshots: Number(row.sectorSnapshots ?? 0),
    themeSnapshots: Number(row.themeSnapshots ?? 0),
    affectedSymbols: Number(row.affectedSymbols ?? 0),
    downstreamGeneratedFromContaminatedFilings: quarterlyAggregates > 0 || signals > 0,
  };
}

function sanitizedExamples(classified: ReturnType<typeof classifyStoredFilings>) {
  return classified
    .filter((row) => row.classification !== "VALID_SEC_IDENTITY_AND_PERIOD")
    .slice(0, MAX_EXAMPLES)
    .map((row) => ({
      accession: row.canonicalAccession,
      classification: row.classification,
      storedPeriodOfReport: row.periodOfReport,
      secPeriodOfReport: row.authoritative?.periodOfReport ?? null,
      storedFilingDate: row.filingDate,
      secFilingDate: row.authoritative?.filingDate ?? null,
      mismatches: row.mismatches,
    }));
}

export async function runHistoricalPeriodAudit(
  executor: Executor,
  authoritativeLoader: (rows: StoredFilingMetadata[]) => Promise<Map<string, AuthoritativeFilingMetadata[]>>,
  limits: Pick<HistoricalPeriodAuditArgs, "maxFilings" | "maxCiks" | "cikBatchSize"> =
    HISTORICAL_AUDIT_DEFAULTS,
) {
  const storedRows = await readStoredFilings(executor, limits);
  const authoritative = await authoritativeLoader(storedRows);
  const classified = classifyStoredFilings(storedRows, authoritative);
  const summary = summarizeFilingAudit(classified);
  const plan = buildHistoricalFilingRepairPlan(storedRows, authoritative);
  const contaminated = classified.filter((row) =>
    row.classification === "PERIOD_MISMATCH" || row.classification === "CANONICAL_DUPLICATE",
  );
  const impact = await readDownstreamImpact(
    executor,
    Array.from(new Set(contaminated.map((row) => row.canonicalAccession))).sort(),
    Array.from(new Set(contaminated.flatMap((row) => [
      row.periodOfReport,
      row.authoritative?.periodOfReport ?? row.periodOfReport,
    ]))).sort(),
  );
  return {
    mode: "DRY_RUN",
    rootCause: {
      code: "LEGACY_REQUESTED_PERIOD_SUBSTITUTION",
      currentPathAffected: false,
      evidence: "Legacy per-filing XML ingestion assigned targetPeriodOfReport to filing and holding rows; current bulk ingestion derives PERIODOFREPORT from accession-scoped SEC submission rows.",
    },
    audit: summary,
    downstreamImpact: impact,
    repairPlan: {
      planHash: plan.planHash,
      operationCount: plan.operations.length,
      blockedCount: plan.blocked.length,
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
    const currentPlan = buildHistoricalFilingRepairPlan(currentRows, authoritative);
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
      (rows) => loadAuthoritativeSecMetadata(rows, {
        maxCiks: options.maxCiks,
        cikBatchSize: options.cikBatchSize,
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