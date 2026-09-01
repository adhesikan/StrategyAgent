#!/usr/bin/env tsx
// Guarded historical SEC 13F backfill. Dry-run is the default.

import { parseArgs } from "node:util";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { getInstitutionalConfig } from "../server/services/institutional/config";
import {
  fetchDatasetCatalog,
  resolveCatalogQuarterRange,
} from "../server/services/institutional/sec-dataset-catalog";
import { runInstitutionalIngestion } from "../server/services/institutional/ingestion-service";

export interface HistoricalBackfillArgs {
  fromQuarter: string;
  toQuarter: string;
  apply: boolean;
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
  for (const descriptor of range.descriptors) {
    log(`target=${descriptor.year}-Q${descriptor.q} file=${descriptor.fileName}`);
  }

  if (!options.apply) {
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