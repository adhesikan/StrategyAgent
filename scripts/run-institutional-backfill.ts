#!/usr/bin/env tsx
// Guarded historical SEC 13F backfill. Dry-run is the default.

import { parseArgs } from "node:util";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { getInstitutionalConfig } from "../server/services/institutional/config";
import {
  fetchDatasetCatalog,
  resolveCatalogQuarterRange,
  type DatasetDescriptor,
} from "../server/services/institutional/sec-dataset-catalog";
import {
  streamBulkFromDescriptor,
  type BulkParseResult,
} from "../server/services/institutional/sec-13f-bulk-parser";
import { runInstitutionalIngestion } from "../server/services/institutional/ingestion-service";

export interface HistoricalBackfillArgs {
  fromQuarter: string;
  toQuarter: string;
  apply: boolean;
}

interface ExistingFilingSnapshot {
  accessionNumber: string;
  amendmentFlag: boolean;
  filingDate: string;
  isEffective: boolean;
}

// Retained solely for buildDryRunQuarterPlan's compatibility/test contract.
interface ExistingHoldingSnapshot {
  accessionNumber: string;
  holdingRows: number;
}


export interface DryRunQuarterPlan {
  quarter: string;
  catalogFile: string;
  sourceAvailable: boolean;
  existingFilings: number;
  existingEffectiveFilings: number;
  existingHoldingRows: number;
  sourceFilings: number | null;
  sourceHoldingRows: number | null;
  filingsAlreadyPresent: number | null;
  filingsToInsert: number | null;
  filingsPotentiallyUpdated: number | null;
  amendmentsToReconcile: number | null;
  estimatedHoldingRowsToProcess: number | null;
  downstreamAggregateRebuildRequired: boolean;
  downstreamSignalRebuildRequired: boolean;
  status: "NO_CHANGE" | "PARTIAL_BACKFILL_REQUIRED" | "FULL_BACKFILL_REQUIRED" | "SOURCE_ERROR";
}

function normalizeAccession(accession: string): string {
  return accession.replace(/-/g, "").trim().toUpperCase();
}

function sourceFilingSnapshots(source: BulkParseResult): Map<string, { amendmentFlag: boolean; filingDate: string; holdingRows: number }> {
  const filings = new Map<string, { amendmentFlag: boolean; filingDate: string; holdingRows: number }>();
  for (const holding of source.holdings) {
    const accessionNumber = normalizeAccession(holding.accessionNumber);
    const current = filings.get(accessionNumber);
    if (current) {
      current.holdingRows++;
    } else {
      filings.set(accessionNumber, {
        amendmentFlag: holding.isAmendment,
        filingDate: holding.filingDate,
        holdingRows: 1,
      });
    }
  }
  return filings;
}

export function buildDryRunQuarterPlan(input: {
  descriptor: DatasetDescriptor;
  source: BulkParseResult;
  existingFilings: ExistingFilingSnapshot[];
  existingHoldingRows: ExistingHoldingSnapshot[];
}): DryRunQuarterPlan {
  const existingByAccession = new Map(input.existingFilings.map((filing) => [
    normalizeAccession(filing.accessionNumber),
    filing,
  ]));
  const sourceParsed = input.source.status === "success" || input.source.status === "partial_success";
  const sourceByAccession = sourceParsed ? sourceFilingSnapshots(input.source) : new Map();
  // This is the same accession population the ingestion loop persists: filings
  // without a parsed holding row are not inserted by the existing pipeline.
  const sourceFilings = sourceParsed ? sourceByAccession.size : null;
  const sourceHoldingRows = input.source.status === "success" || input.source.status === "partial_success"
    ? input.source.holdings.length
    : null;

  if (sourceFilings === null) {
    return {
      quarter: `${input.descriptor.year}-Q${input.descriptor.q}`,
      catalogFile: input.descriptor.fileName,
      sourceAvailable: false,
      existingFilings: input.existingFilings.length,
      existingEffectiveFilings: input.existingFilings.filter((filing) => filing.isEffective).length,
      existingHoldingRows: input.existingHoldingRows.reduce((sum, row) => sum + row.holdingRows, 0),
      sourceFilings: null,
      sourceHoldingRows: null,
      filingsAlreadyPresent: null,
      filingsToInsert: null,
      filingsPotentiallyUpdated: null,
      amendmentsToReconcile: null,
      estimatedHoldingRowsToProcess: null,
      downstreamAggregateRebuildRequired: false,
      downstreamSignalRebuildRequired: false,
      status: "SOURCE_ERROR",
    };
  }

  let filingsAlreadyPresent = 0;
  let amendmentsToReconcile = 0;
  let estimatedHoldingRowsToProcess = 0;
  for (const [accession, sourceFiling] of sourceByAccession) {
    const existing = existingByAccession.get(accession);
    if (!existing) {
      estimatedHoldingRowsToProcess += sourceFiling.holdingRows;
      if (sourceFiling.amendmentFlag) amendmentsToReconcile++;
      continue;
    }
    filingsAlreadyPresent++;
  }

  const filingsToInsert = Math.max(0, sourceFilings - filingsAlreadyPresent);
  // Existing ingestion is accession-idempotent (`onConflictDoNothing`) and
  // skips already-present accessions, so it projects no in-place filing updates.
  const filingsPotentiallyUpdated = 0;
  const hasWork = filingsToInsert > 0 || amendmentsToReconcile > 0;
  const existingFilings = input.existingFilings.length;
  return {
    quarter: `${input.descriptor.year}-Q${input.descriptor.q}`,
    catalogFile: input.descriptor.fileName,
    sourceAvailable: true,
    existingFilings,
    existingEffectiveFilings: input.existingFilings.filter((filing) => filing.isEffective).length,
    existingHoldingRows: input.existingHoldingRows.reduce((sum, row) => sum + row.holdingRows, 0),
    sourceFilings,
    sourceHoldingRows,
    filingsAlreadyPresent,
    filingsToInsert,
    filingsPotentiallyUpdated,
    amendmentsToReconcile,
    estimatedHoldingRowsToProcess,
    downstreamAggregateRebuildRequired: hasWork,
    downstreamSignalRebuildRequired: hasWork,
    status: !hasWork
      ? "NO_CHANGE"
      : existingFilings === 0
        ? "FULL_BACKFILL_REQUIRED"
        : "PARTIAL_BACKFILL_REQUIRED",
  };
}

export function parseHistoricalBackfillArgs(args: string[]): HistoricalBackfillArgs {
  const parsed = parseArgs({
    args,
    options: {
      "from-quarter": { type: "string" },
      "to-quarter": { type: "string" },
      apply: { type: "boolean", default: false },
    },
    strict: true,
  });
  const fromQuarter = parsed.values["from-quarter"];
  const toQuarter = parsed.values["to-quarter"];
  if (!fromQuarter || !toQuarter) {
    throw new Error("EXPLICIT_QUARTER_RANGE_REQUIRED");
  }
  if (!/^\d{4}-?Q[1-4]$/i.test(fromQuarter) || !/^\d{4}-?Q[1-4]$/i.test(toQuarter)) {
    throw new Error("INVALID_QUARTER_RANGE");
  }
  return { fromQuarter, toQuarter, apply: parsed.values.apply === true };
}

export function validateHistoricalBackfillEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== "production") throw new Error("PRODUCTION_NODE_ENV_REQUIRED");
  if (env.RAILWAY_ENVIRONMENT_NAME !== "production") {
    throw new Error("RAILWAY_PRODUCTION_IDENTITY_REQUIRED");
  }
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  if (env.EXTERNAL_DATABASE_URL) throw new Error("EXTERNAL_DATABASE_URL_FORBIDDEN");
}

function log(message: string): void {
  console.log(`[historical-backfill] ${message}`);
}

async function checkSchema(): Promise<void> {
  await db.execute(sql`SELECT 1 FROM institutional_ingestion_runs LIMIT 0`);
}

async function readExistingQuarterState(periodOfReport: string): Promise<{
  filings: ExistingFilingSnapshot[];
  holdingRows: number;
  holdingRowsByAccession: Map<string, number>;
}> {
  const filingsResult = await db.execute(sql`
    SELECT accession_number AS "accessionNumber",
           amendment_flag AS "amendmentFlag",
           filing_date AS "filingDate",
           is_effective AS "isEffective"
      FROM institutional_13f_filings
     WHERE period_of_report = ${periodOfReport}
  `);
  const holdingsResult = await db.execute(sql`
    SELECT accession_number AS "accessionNumber",
           COUNT(*)::int AS "holdingRows"
      FROM institutional_13f_holdings
     WHERE period_of_report = ${periodOfReport}
     GROUP BY accession_number
  `);
  const holdingRowsByAccession = new Map<string, number>();
  let holdingRows = 0;
  for (const row of holdingsResult.rows as Array<{ accessionNumber: string; holdingRows: number }>) {
    const count = Number(row.holdingRows ?? 0);
    holdingRowsByAccession.set(normalizeAccession(row.accessionNumber), count);
    holdingRows += count;
  }
  return {
    filings: filingsResult.rows as ExistingFilingSnapshot[],
    holdingRows,
    holdingRowsByAccession,
  };
}

export function buildStreamingDryRunPlan(
  descriptor: DatasetDescriptor,
  existing: { filings: ExistingFilingSnapshot[]; holdingRows: number },
  source: {
    status: string;
    sourceFilings: number;
    sourceHoldingRows: number;
    filingsToInsert: number;
    filingsPotentiallyUpdated: number;
    holdingRowsToProcess: number;
    amendmentsToReconcile: number;
  },
): DryRunQuarterPlan {
  if (source.status !== "success" && source.status !== "partial_success") {
    return { quarter: `${descriptor.year}-Q${descriptor.q}`, catalogFile: descriptor.fileName, sourceAvailable: false,
      existingFilings: existing.filings.length, existingEffectiveFilings: existing.filings.filter((f) => f.isEffective).length,
      existingHoldingRows: existing.holdingRows, sourceFilings: null, sourceHoldingRows: null, filingsAlreadyPresent: null,
      filingsToInsert: null, filingsPotentiallyUpdated: null, amendmentsToReconcile: null, estimatedHoldingRowsToProcess: null,
      downstreamAggregateRebuildRequired: false, downstreamSignalRebuildRequired: false, status: "SOURCE_ERROR" };
  }
  const filingsAlreadyPresent = source.sourceFilings - source.filingsToInsert;
  const hasWork = source.filingsToInsert > 0 || source.filingsPotentiallyUpdated > 0;
  return { quarter: `${descriptor.year}-Q${descriptor.q}`, catalogFile: descriptor.fileName, sourceAvailable: true,
    existingFilings: existing.filings.length, existingEffectiveFilings: existing.filings.filter((f) => f.isEffective).length,
    existingHoldingRows: existing.holdingRows, sourceFilings: source.sourceFilings, sourceHoldingRows: source.sourceHoldingRows,
    filingsAlreadyPresent,
    filingsToInsert: source.filingsToInsert,
    filingsPotentiallyUpdated: source.filingsPotentiallyUpdated,
    amendmentsToReconcile: source.amendmentsToReconcile,
    estimatedHoldingRowsToProcess: source.holdingRowsToProcess,
    downstreamAggregateRebuildRequired: hasWork, downstreamSignalRebuildRequired: hasWork,
    status: !hasWork ? "NO_CHANGE" : existing.filings.length === 0 ? "FULL_BACKFILL_REQUIRED" : "PARTIAL_BACKFILL_REQUIRED" };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseHistoricalBackfillArgs(args);
  validateHistoricalBackfillEnvironment(process.env);
  const config = getInstitutionalConfig();
  if (!config.secUserAgent) throw new Error("SEC_USER_AGENT_REQUIRED");
  if (!config.ingestionEnabled) throw new Error("INSTITUTIONAL_INGESTION_DISABLED");
  await checkSchema();

  const catalog = await fetchDatasetCatalog(config.secUserAgent);
  const range = resolveCatalogQuarterRange(options.fromQuarter, options.toQuarter, catalog);
  if (range.missingQuarterLabels.length > 0) {
    throw new Error(`CATALOG_QUARTERS_MISSING:${range.missingQuarterLabels.join(",")}`);
  }

  log(`range=${options.fromQuarter}..${options.toQuarter} datasets=${range.descriptors.length}`);

  if (!options.apply) {
    const plans: DryRunQuarterPlan[] = [];
    for (const descriptor of range.descriptors) {
      const heapUsedMBStart = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      let heapUsedMBPeak = heapUsedMBStart;
      let batchCount = 0;
      const existing = await readExistingQuarterState(descriptor.expectedPeriodOfReport);
      const existingAccessions = new Set(existing.filings.map((f) => normalizeAccession(f.accessionNumber)));
      const sourceByAccession = new Map<string, { holdingRows: number; isAmendment: boolean }>();
      let sourceHoldingRows = 0;
      const source = await streamBulkFromDescriptor(descriptor, {
        onBatch(batch) {
          batchCount++;
          heapUsedMBPeak = Math.max(heapUsedMBPeak, Math.round(process.memoryUsage().heapUsed / 1024 / 1024));
          for (const holding of batch) {
            sourceHoldingRows++;
            const accession = normalizeAccession(holding.accessionNumber);
            const current = sourceByAccession.get(accession);
            if (current) current.holdingRows++;
            else sourceByAccession.set(accession, { holdingRows: 1, isAmendment: holding.isAmendment });
          }
        },
      });
      let filingsToInsert = 0;
      let filingsPotentiallyUpdated = 0;
      let holdingRowsToProcess = 0;
      let amendmentsToReconcile = 0;
      for (const [accession, sourceFiling] of sourceByAccession) {
        const existingCount = existing.holdingRowsByAccession.get(accession);
        if (!existingAccessions.has(accession)) {
          filingsToInsert++;
          holdingRowsToProcess += sourceFiling.holdingRows;
          if (sourceFiling.isAmendment) amendmentsToReconcile++;
        } else if (existingCount !== sourceFiling.holdingRows) {
          filingsPotentiallyUpdated++;
          holdingRowsToProcess += sourceFiling.holdingRows;
          if (sourceFiling.isAmendment) amendmentsToReconcile++;
        }
      }
      const plan = buildStreamingDryRunPlan(descriptor, existing, {
        status: source.status,
        sourceFilings: sourceByAccession.size,
        sourceHoldingRows,
        filingsToInsert,
        filingsPotentiallyUpdated,
        holdingRowsToProcess,
        amendmentsToReconcile,
      });
      plans.push(plan);
      const heapUsedMBEnd = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      console.log(JSON.stringify({ ...plan, heapUsedMBStart, heapUsedMBPeak, heapUsedMBEnd, batchCount }));
    }
    const totals = plans.reduce((total, plan) => ({
      quarters: total.quarters + 1,
      quartersRequiringBackfill: total.quartersRequiringBackfill +
        (plan.status === "PARTIAL_BACKFILL_REQUIRED" || plan.status === "FULL_BACKFILL_REQUIRED" ? 1 : 0),
      existingFilings: total.existingFilings + plan.existingFilings,
      sourceFilings: total.sourceFilings + (plan.sourceFilings ?? 0),
      filingsToInsert: total.filingsToInsert + (plan.filingsToInsert ?? 0),
      estimatedHoldingRowsToProcess: total.estimatedHoldingRowsToProcess +
        (plan.estimatedHoldingRowsToProcess ?? 0),
    }), {
      quarters: 0,
      quartersRequiringBackfill: 0,
      existingFilings: 0,
      sourceFilings: 0,
      filingsToInsert: 0,
      estimatedHoldingRowsToProcess: 0,
    });
    console.log(JSON.stringify({ totals }));
    log("mode=DRY_RUN no database writes performed");
    return;
  }

  log("mode=APPLY guarded production ingestion starting");
  const result = await runInstitutionalIngestion({
    initiatedBy: "historical_backfill",
    specificDescriptors: range.descriptors,
    chunkSize: Infinity,
    force: false,
    enableReferenceEnrichment: false,
  });
  log(`status=${result.status} quartersProcessed=${result.quartersProcessed}`);
  if (result.status !== "completed") process.exitCode = 1;
}

if (!process.env.VITEST) {
  main().catch((error: unknown) => {
    const code = error instanceof Error ? error.message.slice(0, 300) : "UNKNOWN_FAILURE";
    console.error(`[historical-backfill:error] ${code}`);
    process.exitCode = 1;
  });
}