#!/usr/bin/env npx tsx
// Institutional 13F — Daily Background Job
//
// Designed to run as a Railway cron job at 06:00 UTC daily.
// Command: npx tsx scripts/run-institutional-daily.ts
//
// Flow:
//   1. Guard: INSTITUTIONAL_13F_INGESTION_ENABLED + SEC_USER_AGENT + DATABASE_URL
//   2. Clean stale "running" runs (leftover from SIGKILL/restart)
//   3. Fetch SEC catalog (priority quarters: 2026-Q1, 2025-Q4)
//   4. For each quarter, compute state via computeQuarterState()
//   5. READY → skip (data is complete; aggregates computed)
//   6. NOT_STARTED / PARTIAL / FAILED → run ingestFromDescriptor with chunkSize
//   7. Exit 0 always (Railway cron must not see failures as retries)
//
// Env vars required:
//   INSTITUTIONAL_13F_INGESTION_ENABLED=true   (gate)
//   SEC_USER_AGENT="YourApp/1.0 (contact@example.com)"  (SEC robots.txt)
//   DATABASE_URL                               (PostgreSQL connection string)
//
// Env vars optional:
//   INSTITUTIONAL_ACCESSIONS_PER_RUN=300       (default 300, range 50–2000)
//   INSTITUTIONAL_STALE_RUN_THRESHOLD_MINUTES=30

// No ../server/env import — scripts read process.env directly.
// Set env vars via Railway cron service settings or a .env file loaded
// externally (e.g. `dotenv -e .env -- npx tsx scripts/run-institutional-daily.ts`).

import { runInstitutionalIngestion, cleanStalePendingRuns } from "../server/services/institutional/ingestion-service";
import { getAccessionsPerRun, isIngestionConfigured, getInstitutionalConfig } from "../server/services/institutional/config";
import { computeQuarterState, isResumable, isReady } from "../server/services/institutional/quarter-state";
import { getPipelineStatus } from "../server/services/institutional/pipeline-status";
import {
  fetchDatasetCatalog,
  type InstitutionalDatasetCatalogEntry,
} from "../server/services/institutional/sec-dataset-catalog";
import { findDescriptorForQuarter } from "../server/services/institutional/catalog-utils";
import { log } from "../server/logger";

// Priority order: newest quarter first (covers both 2026-Q1 and 2025-Q4)
const PRIORITY_QUARTERS = ["2026-Q1", "2025-Q4"];
// How many catalog windows to fetch (at least 2 to cover both priority quarters)
const CATALOG_WINDOWS = 4;

// ---------------------------------------------------------------------------
// Startup guards
// ---------------------------------------------------------------------------

function guardOrExit(): { userAgent: string; chunkSize: number } {
  // DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error(
      "[institutional-daily] FATAL: DATABASE_URL is not set. " +
        "Configure it on the Railway cron service env vars.",
    );
    process.exit(0); // intentional: cron must not retry on config error
  }

  // Ingestion gate
  if (!isIngestionConfigured()) {
    const ingestionEnabled = process.env.INSTITUTIONAL_13F_INGESTION_ENABLED;
    const userAgentSet = !!(process.env.SEC_USER_AGENT ?? "").trim();
    console.log(
      "[institutional-daily] Skipped: ingestion not configured. " +
        `INSTITUTIONAL_13F_INGESTION_ENABLED=${ingestionEnabled ?? "(unset)"} ` +
        `SEC_USER_AGENT=${userAgentSet ? "set" : "(unset)"}`,
    );
    log("institutional_daily_job_skipped", {
      reason: "ingestion_not_configured",
      ingestionEnabledValue: ingestionEnabled ?? null,
      secUserAgentSet: userAgentSet,
    });
    process.exit(0);
  }

  const cfg = getInstitutionalConfig();
  const userAgent = cfg.secUserAgent!;
  const chunkSize = getAccessionsPerRun();
  return { userAgent, chunkSize };
}

// ---------------------------------------------------------------------------
// Catalog fetch → descriptor lookup for a specific quarter label
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startMs = Date.now();
  const { userAgent, chunkSize } = guardOrExit();

  log("institutional_daily_job_started", {
    priorityQuarters: PRIORITY_QUARTERS,
    accessionsPerRun: chunkSize,
  });
  console.log(`[institutional-daily] Starting. chunkSize=${chunkSize}`);

  // ── Step 1: Clean stale running runs ─────────────────────────────────────
  const staleCleaned = await cleanStalePendingRuns();
  if (staleCleaned > 0) {
    log("institutional_daily_stale_cleaned", { staleCleaned });
    console.log(`[institutional-daily] Cleaned ${staleCleaned} stale run(s).`);
  }

  // ── Step 2: Fetch SEC catalog ─────────────────────────────────────────────
  let catalogEntries: InstitutionalDatasetCatalogEntry[] = [];
  try {
    catalogEntries = await fetchDatasetCatalog(userAgent);
    log("institutional_daily_catalog_fetched", {
      entryCount: catalogEntries.length,
    });
    console.log(`[institutional-daily] Catalog fetched: ${catalogEntries.length} entries.`);
  } catch (err: any) {
    log("institutional_daily_catalog_error", {
      errorCode: err?.name ?? "CATALOG_FETCH_ERROR",
      errorMessage: err?.message?.slice(0, 200),
    });
    console.error("[institutional-daily] Failed to fetch SEC catalog:", err?.message);
    // Graceful degradation: continue with legacy label-based URL construction
  }

  // ── Step 3: Compute pipeline status (for state machine decisions) ─────────
  // If this query fails (e.g. checkpoint columns missing pre-migration),
  // we fall back to treating all quarters as resumable with force=true.
  // This ensures the first post-migration run always proceeds.
  let status: Awaited<ReturnType<typeof getPipelineStatus>> | null = null;
  try {
    status = await getPipelineStatus(PRIORITY_QUARTERS, {
      schedulerEnabled: true,
      ingestionConfigured: true,
    });
  } catch (err: any) {
    log("institutional_daily_status_query_failed", {
      errorCode: err?.name ?? "STATUS_QUERY_ERROR",
      errorMessage: err?.message?.slice(0, 300),
      hint: "Run scripts/migrate-institutional.sql to apply the required schema. Proceeding with force=true for all priority quarters.",
    });
    console.warn(
      "[institutional-daily] Pipeline status query failed (schema migration may be needed). " +
        "Treating all priority quarters as resumable with force=true.",
    );
  }

  // ── Step 4: Process each priority quarter ─────────────────────────────────
  let anyWorkDone = false;

  for (const quarter of PRIORITY_QUARTERS) {
    // When status query failed, treat as PARTIAL (conservative: always resume)
    const entry = status?.quarters.find((q) => q.quarter === quarter);
    const state = entry?.state ?? (status === null ? "PARTIAL" : "NOT_STARTED");

    console.log(`[institutional-daily] Quarter ${quarter}: ${state} (${entry?.stateLabel ?? ""})`);

    // Skip quarters that are fully complete
    if (isReady(state)) {
      log("institutional_daily_quarter_skipped_ready", { quarter, state });
      console.log(`  → Already READY — skipping.`);
      continue;
    }

    // Only process quarters that can be resumed or started
    if (!isResumable(state)) {
      log("institutional_daily_quarter_no_action", { quarter, state });
      console.log(`  → No action for state: ${state}`);
      continue;
    }

    const isPartial = state === "PARTIAL" || state === "FAILED";

    // Resolve descriptor from the catalog. For post-2023 quarters (2024-Q1+),
    // the legacy YYYYqN URL construction is unreliable — we require a real catalog
    // descriptor. If the catalog was unavailable or does not include this quarter,
    // log a retriable miss and exit cleanly rather than ingesting from a guessed URL.
    const descriptor = catalogEntries.length > 0
      ? findDescriptorForQuarter(quarter, catalogEntries)
      : null;

    if (!descriptor) {
      const reason = catalogEntries.length === 0 ? "catalog_fetch_failed" : "quarter_not_in_catalog";
      log("institutional_daily_catalog_miss", {
        quarter,
        reason,
        hint: "Re-run tomorrow; catalog may not yet list this quarter or the fetch failed transiently.",
      });
      console.log(
        `  → Cannot ingest ${quarter}: ${reason}. ` +
          "No legacy URL fallback for post-2023 quarters. Will retry tomorrow.",
      );
      // Count as no-work — do not attempt legacy URL construction for post-2023 datasets
      continue;
    }

    log("institutional_daily_quarter_starting", {
      quarter,
      state,
      force: isPartial,
      chunkSize,
    });
    console.log(
      `  → Starting ingestion (chunkSize=${chunkSize}, force=${isPartial})`,
    );

    anyWorkDone = true;

    const result = await runInstitutionalIngestion({
      initiatedBy: "daily_job",
      specificDescriptors: [descriptor],
      force: isPartial,
      chunkSize,
    });

    const durationMs = Date.now() - startMs;
    log("institutional_daily_quarter_result", {
      quarter,
      status: result.status,
      quartersProcessed: result.quartersProcessed,
      durationMs,
    });
    console.log(
      `  → Done: status=${result.status}, processed=${result.quartersProcessed}, duration=${Math.round(durationMs / 1000)}s`,
    );

    // Process one quarter per invocation to stay within time budget
    break;
  }

  if (!anyWorkDone) {
    log("institutional_refresh_no_work", {
      quarters: PRIORITY_QUARTERS,
      reason: "all_quarters_ready_catalog_miss_or_not_actionable",
    });
    console.log("[institutional-daily] No work started this invocation (all READY or catalog miss).");
  }

  const totalMs = Date.now() - startMs;
  log("institutional_daily_job_completed", {
    anyWorkDone,
    totalDurationMs: totalMs,
  });
  console.log(`[institutional-daily] Completed in ${Math.round(totalMs / 1000)}s.`);
}

// ── Entry point ────────────────────────────────────────────────────────────
if (!process.env.VITEST) {
  main().catch((err) => {
    // Never throw — Railway must see exit 0 (errors handled by logging)
    log("institutional_daily_job_fatal", {
      errorCode: err?.name ?? "FATAL",
      errorMessage: err?.message?.slice(0, 500),
    });
    console.error("[institutional-daily] Fatal error:", err?.message);
    process.exit(0); // intentional: cron must not retry on error
  });
}
