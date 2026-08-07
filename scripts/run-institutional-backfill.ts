#!/usr/bin/env tsx
// Institutional Intelligence — Manual Backfill CLI
//
// Safe production script for backfilling 13F institutional data.
// Does NOT start the web server. Does NOT modify the public feature flag.
//
// Usage:
//   npx tsx scripts/run-institutional-backfill.ts --quarters 2
//   npx tsx scripts/run-institutional-backfill.ts --quarters 4 --dry-run
//   npx tsx scripts/run-institutional-backfill.ts --quarter 2023Q4
//   npx tsx scripts/run-institutional-backfill.ts --quarter 2025Q4 --rebuild-aggregates
//
// --quarters N
//   Fetch the official SEC dataset catalog and select enough published datasets
//   to cover N distinct 13F holdings periods of report.
//   Uses the catalog URL as source of truth — no URL guessing.
//   Works for all post-2023 date-range filenames as well as legacy YYYYqN datasets.
//
// --quarter YYYYQN
//   Ingest a specific quarter using the legacy URL construction.
//   Reliable for datasets through 2023Q4. Use --quarters for post-2023 datasets.
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
  fetchDatasetCatalog,
  selectDatasetWindows,
  toDatasetDescriptor,
} from "../server/services/institutional/sec-dataset-catalog";
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
    const p = parseQuarterLabel(rawQuarter);
    if (!p) {
      fail(
        "INVALID_ARGS",
        `--quarter value "${rawQuarter}" is not a valid quarter. Use format YYYYQN or YYYY-QN (e.g. 2026Q2 or 2026-Q2).`,
      );
    }
    specificQuarter = p!.label;
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

  // 4. Determine target datasets
  if (specificQuarter) {
    // ── Legacy single-quarter path ──────────────────────────────────────────
    // Uses YYYYqN URL construction. Reliable through 2023Q4.
    // For post-2023 quarters, prefer --quarters N to use the catalog.
    info(`Target quarter (legacy URL mode): ${specificQuarter}`);

    if (dryRun) {
      info("─── DRY RUN ─── No data will be written.");
      info("Would ingest the following quarter (legacy URL construction):");
      info(`  Quarter label: ${specificQuarter}`);
      info("  Note: --quarter uses YYYYqN URL construction, which may return 404 for post-2023 datasets.");
      info("  Use --quarters N to select from the official SEC catalog for post-2023 data.");
      info("Dry run complete. No changes were made.");
      process.exit(0);
    }

    const result = await runInstitutionalIngestion({
      initiatedBy: "cli_backfill",
      specificQuarterLabels: [specificQuarter],
    });

    reportResult(result, rebuildAggregates);

  } else {
    // ── Catalog-driven path (--quarters N) ──────────────────────────────────
    // Fetches the official SEC Form 13F dataset index and selects the N most
    // recent distinct holdings periods.

    info(`Fetching official SEC dataset catalog to select ${quarters} most-recent holdings period(s)…`);
    info(`  Catalog source: https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets`);

    let catalog;
    try {
      catalog = await fetchDatasetCatalog(cfg.secUserAgent!);
    } catch (err: any) {
      fail(
        "CATALOG_FETCH_FAILED",
        `Failed to fetch the official SEC dataset catalog: ${err?.message ?? "network error"}. ` +
        "Check SEC_USER_AGENT and network connectivity.",
      );
    }

    if (catalog.length === 0) {
      fail(
        "CATALOG_EMPTY",
        "The official SEC dataset catalog returned no recognised _form13f.zip entries. " +
        "The catalog page structure may have changed. Check the SEC page manually.",
      );
    }

    info(`Catalog returned ${catalog.length} recognised dataset(s).`);

    // Select N windows covering N distinct holdings periods
    const selected = selectDatasetWindows(quarters!, catalog);

    if (selected.length === 0) {
      fail(
        "NO_AVAILABLE_QUARTERS",
        "No published datasets found in the catalog. " +
        "The SEC may not have released any datasets yet. Try again later.",
      );
    }

    if (selected.length < quarters!) {
      warn(
        `Requested ${quarters} holdings period(s) but catalog only covers ${selected.length}. ` +
        "Proceeding with available datasets.",
      );
    }

    // Print dataset window summary
    info(`\n[backfill] Published SEC datasets selected:\n`);
    for (const w of selected) {
      info(`  Dataset window: ${w.entry.displayLabel}`);
      info(`  File:           ${w.entry.fileName}`);
      info(`  Expected primary report period: ${w.canonicalPeriodLabel}`);
      info(`  Publication model: ${w.entry.publicationModel}`);
      info("");
    }

    info("Target holdings quarters:");
    for (const w of selected) {
      info(`  · ${w.canonicalPeriodLabel} (period of report: ${w.expectedPeriodOfReport})`);
    }
    info("");

    // Dry-run mode
    if (dryRun) {
      info("─── DRY RUN ─── No data will be written.");
      info(`Would ingest ${selected.length} dataset(s) from the official SEC catalog.`);
      if (rebuildAggregates) {
        info("Would rebuild quarterly aggregates after ingestion.");
      }
      info("Dry run complete. No changes were made.");
      process.exit(0);
    }

    // Convert to descriptors and ingest
    const descriptors = selected.map(toDatasetDescriptor);

    info(`Starting ingestion for ${descriptors.length} dataset(s)…`);
    const result = await runInstitutionalIngestion({
      initiatedBy: "cli_backfill",
      specificDescriptors: descriptors,
    });

    reportResult(result, rebuildAggregates);
  }
}

// ---------------------------------------------------------------------------
// Result reporting
// ---------------------------------------------------------------------------

function reportResult(
  result: { status: string; quartersProcessed: number },
  rebuildAggregates: boolean,
): never {
  switch (result.status) {
    case "completed":
      info(`✓ Ingestion completed. Quarters processed: ${result.quartersProcessed}`);
      break;
    case "partial":
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
