#!/usr/bin/env tsx
// Institutional Intelligence — Manual Backfill CLI
//
// Safe production script for backfilling 13F institutional data.
// Does NOT start the web server. Does NOT modify the public feature flag.
//
// Usage:
//   npx tsx scripts/run-institutional-backfill.ts --quarters 2
//   npx tsx scripts/run-institutional-backfill.ts --quarter 2026Q2
//   npx tsx scripts/run-institutional-backfill.ts --quarters 4 --dry-run
//   npx tsx scripts/run-institutional-backfill.ts --quarter 2025Q4 --rebuild-aggregates
//
// Requirements (hard-fail if missing):
//   DATABASE_URL         — PostgreSQL connection string
//   SEC_USER_AGENT       — descriptive User-Agent for SEC EDGAR (e.g. "App contact@email.com")
//
// Respects:
//   INSTITUTIONAL_13F_INGESTION_ENABLED — defaults true; set false to block
//
// Does NOT require:
//   INSTITUTIONAL_INTELLIGENCE_ENABLED  — public UI flag is separate from ingestion
//
// NEVER prints: DATABASE_URL, credentials, raw filing content, full HTTP headers.
// Exits non-zero on any unrecoverable error.

import { parseArgs } from "node:util";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import {
  getInstitutionalConfig,
  parseQuarterLabel,
  isIngestionConfigured,
} from "../server/services/institutional/config";
import {
  probeQuarterAvailability,
  selectAvailableQuarters,
} from "../server/services/institutional/sec-13f-bulk-parser";
import { runInstitutionalIngestion } from "../server/services/institutional/ingestion-service";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_QUARTERS = 8;
const MIN_QUARTERS = 1;
const SCHEMA_CHECK_TABLE = "institutional_ingestion_runs";

// ---------------------------------------------------------------------------
// Safe logging — never prints secrets
// ---------------------------------------------------------------------------

function info(msg: string): void {
  console.log(`[backfill] ${msg}`);
}

function warn(msg: string): void {
  console.warn(`[backfill:warn] ${msg}`);
}

function fail(code: string, msg: string): never {
  console.error(`[backfill:error] ${code}: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Schema preflight — fails fast with INSTITUTIONAL_SCHEMA_MISSING
// ---------------------------------------------------------------------------

async function checkSchemaExists(): Promise<void> {
  try {
    await db.execute(
      sql`SELECT 1 FROM ${sql.identifier(SCHEMA_CHECK_TABLE)} LIMIT 0`,
    );
  } catch (err: any) {
    const msg: string = err?.message ?? "";
    if (msg.includes("does not exist") || msg.includes("relation") || msg.includes("42P01")) {
      fail(
        "INSTITUTIONAL_SCHEMA_MISSING",
        `Database table "${SCHEMA_CHECK_TABLE}" does not exist.\n` +
        `  Run the migration first:\n` +
        `  psql "$DATABASE_URL" -f scripts/migrate-institutional.sql`,
      );
    }
    // Re-throw unexpected DB errors
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

function parseCliArgs(): {
  quarters: number | null;
  specificQuarter: string | null;
  dryRun: boolean;
  rebuildAggregates: boolean;
} {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        quarters: { type: "string", short: "n" },
        quarter: { type: "string", short: "q" },
        "dry-run": { type: "boolean", default: false },
        "rebuild-aggregates": { type: "boolean", default: false },
      },
      strict: true,
    });
  } catch (err: any) {
    fail("INVALID_ARGS", err?.message ?? "Unknown argument error");
  }

  const dryRun = Boolean((parsed.values as any)["dry-run"]);
  const rebuildAggregates = Boolean((parsed.values as any)["rebuild-aggregates"]);
  const rawQuarters = (parsed.values as any).quarters as string | undefined;
  const rawQuarter = (parsed.values as any).quarter as string | undefined;

  if (rawQuarters !== undefined && rawQuarter !== undefined) {
    fail("INVALID_ARGS", "--quarters and --quarter cannot be used together. Use one or the other.");
  }

  if (rawQuarters === undefined && rawQuarter === undefined) {
    fail("INVALID_ARGS", "Specify --quarters N or --quarter YYYYQN. Example: --quarters 2");
  }

  let quarters: number | null = null;
  let specificQuarter: string | null = null;

  if (rawQuarters !== undefined) {
    quarters = parseInt(rawQuarters, 10);
    if (!Number.isFinite(quarters) || quarters < MIN_QUARTERS || quarters > MAX_QUARTERS) {
      fail("INVALID_ARGS", `--quarters must be an integer between ${MIN_QUARTERS} and ${MAX_QUARTERS}. Got: ${rawQuarters}`);
    }
  }

  if (rawQuarter !== undefined) {
    // Normalise: accept "2026Q2" or "2026-Q2"
    const parsed = parseQuarterLabel(rawQuarter);
    if (!parsed) {
      fail(
        "INVALID_ARGS",
        `--quarter value "${rawQuarter}" is not a valid quarter. Use format YYYYQN or YYYY-QN (e.g. 2026Q2 or 2026-Q2).`,
      );
    }
    specificQuarter = parsed!.label;
  }

  return { quarters, specificQuarter, dryRun, rebuildAggregates };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  info("=== Institutional 13F Backfill ===");

  // 1. Parse arguments
  const { quarters, specificQuarter, dryRun, rebuildAggregates } = parseCliArgs();

  // 2. Validate environment
  if (!process.env.DATABASE_URL) {
    fail("MISSING_DATABASE_URL", "DATABASE_URL environment variable is not set.");
  }

  const cfg = getInstitutionalConfig();

  if (!cfg.secUserAgent) {
    fail(
      "MISSING_SEC_USER_AGENT",
      "SEC_USER_AGENT is not configured. " +
      "Set it to a descriptive value (e.g. 'VCP Trader AI contact@yourdomain.com') " +
      "to identify your application to SEC EDGAR per their fair-access guidelines.",
    );
  }

  if (!cfg.ingestionEnabled) {
    fail(
      "INGESTION_DISABLED",
      "INSTITUTIONAL_13F_INGESTION_ENABLED is set to false. " +
      "Set it to true (or remove the variable — default is true) to enable ingestion.",
    );
  }

  // Note: INSTITUTIONAL_INTELLIGENCE_ENABLED is NOT checked here.
  // The public UI flag is separate from the ingestion gate.
  const publicFeatureEnabled = cfg.enabled;
  if (!publicFeatureEnabled) {
    info("ℹ️  INSTITUTIONAL_INTELLIGENCE_ENABLED=false — public tab is disabled (this is expected during pre-activation backfill).");
  }

  // 3. Schema preflight
  info("Checking database schema…");
  await checkSchemaExists();
  info("✓ Schema exists.");

  // 4. Determine target quarters
  //    For --quarters N: probe SEC availability and skip any quarter not yet published.
  //    For --quarter SPECIFIC: use exactly as requested (user takes responsibility).
  const targetLabels: string[] = [];
  if (specificQuarter) {
    targetLabels.push(specificQuarter);
    info(`Target quarter: ${specificQuarter}`);
  } else {
    info(`Probing SEC availability for ${quarters} most-recent quarters…`);
    const { available, skipped } = await selectAvailableQuarters(
      quarters!,
      new Date(),
      (y, q) => probeQuarterAvailability(y, q, cfg.secUserAgent!),
    );
    if (skipped.length > 0) {
      info("Skipped:");
      for (const s of skipped) info(`  ${s.label} — ${s.reason}`);
    }
    if (available.length === 0) {
      fail(
        "NO_AVAILABLE_QUARTERS",
        "No published quarters found. " +
        "The SEC may not have released the dataset for recent quarters yet. " +
        "Try again later or use --quarter YYYYQN to specify an exact quarter.",
      );
    }
    for (const q of available) targetLabels.push(q.label);
    info(`Requested available quarters: ${targetLabels.join(", ")}`);
  }

  // 5. Dry-run mode — list what would be ingested and exit
  if (dryRun) {
    info("─── DRY RUN ─── No data will be written.");
    info("Would ingest the following quarters:");
    for (const label of targetLabels) {
      info(`  · ${label}`);
    }
    if (rebuildAggregates) {
      info("Would rebuild quarterly aggregates after ingestion.");
    }
    info("Dry run complete. No changes were made.");
    process.exit(0);
  }

  // 6. Run ingestion via existing service (advisory lock, idempotent upserts)
  info(`Starting ingestion for ${targetLabels.length} quarter(s)…`);
  const result = await runInstitutionalIngestion({
    initiatedBy: "cli_backfill",
    specificQuarterLabels: targetLabels,
  });

  // 7. Report results
  switch (result.status) {
    case "completed":
      info(`✓ Ingestion completed. Quarters processed: ${result.quartersProcessed}`);
      break;
    case "partial":
      // Partial includes EMPTY_PARSE_FAILURE cases — exit non-zero so CI/operator is alerted.
      fail(
        "INGESTION_PARTIAL",
        `Ingestion partially completed. Quarters processed: ${result.quartersProcessed}. ` +
        "Check structured logs above for EMPTY_PARSE_FAILURE or other error codes.",
      );
      break;
    case "skipped_locked":
      fail("ADVISORY_LOCK_HELD", "Another ingestion run is already in progress (advisory lock is held). Try again later.");
      break;
    case "skipped_disabled":
      fail("INGESTION_SKIPPED", "Ingestion was skipped. Verify SEC_USER_AGENT is set and INSTITUTIONAL_13F_INGESTION_ENABLED=true.");
      break;
    case "failed":
      fail("INGESTION_FAILED", "Ingestion failed. Review the structured logs above for error codes.");
      break;
  }

  if (rebuildAggregates && result.quartersProcessed > 0) {
    info("--rebuild-aggregates: aggregates are rebuilt automatically by the ingestion service per quarter. No separate step required.");
  }

  info("=== Backfill complete ===");
  process.exit(0);
}

// Only auto-execute when run directly (not when imported by the test suite)
if (!process.env.VITEST) {
  main().catch((err: any) => {
    // Never print full error objects (may contain DB URLs in stack traces)
    const code: string = err?.name ?? "FATAL";
    const msg: string = String(err?.message ?? "").slice(0, 300);
    console.error(`[backfill:fatal] ${code}: ${msg}`);
    process.exit(1);
  });
}
