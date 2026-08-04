/**
 * Backfill script: populate entry_trigger_price for existing stored opportunities
 * that have resistance_price but a null entry_trigger_price.
 *
 * Run with:
 *   npx tsx server/scripts/backfill-trigger-prices.ts --dry-run
 *   npx tsx server/scripts/backfill-trigger-prices.ts --apply
 *
 * NEVER run automatically at application startup.
 * ALWAYS review the dry-run output before applying.
 */

import { db } from "../db";
import { opportunities as opportunitiesTable } from "@shared/schema";
import { and, isNull, isNotNull, gt, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Strategy eligibility classifications
// ---------------------------------------------------------------------------

export type TriggerEligibility =
  | "PRICE_TRIGGER_SAFE_TO_BACKFILL"
  | "SESSION_OR_EVENT_TRIGGER_REQUIRES_REVIEW"
  | "NO_PRICE_TRIGGER";

export const STRATEGY_ELIGIBILITY: Record<string, TriggerEligibility> = {
  // Swing/daily strategies: the resistance level is the breakout price trigger.
  // Safe to backfill because the trigger is a persistent price level, not tied
  // to a specific intraday session.
  VCP:                "PRICE_TRIGGER_SAFE_TO_BACKFILL",
  VCP_MULTIDAY:       "PRICE_TRIGGER_SAFE_TO_BACKFILL",
  CLASSIC_PULLBACK:   "PRICE_TRIGGER_SAFE_TO_BACKFILL",
  TREND_CONTINUATION: "PRICE_TRIGGER_SAFE_TO_BACKFILL",
  HIGH_RVOL:          "PRICE_TRIGGER_SAFE_TO_BACKFILL",
  VOLATILITY_SQUEEZE: "PRICE_TRIGGER_SAFE_TO_BACKFILL",
  // VWAP level: resets daily but the stored resistance value is a specific price
  // from the detection session. Safe as a persistent reference level; consumers
  // should note it may not match the current day's VWAP.
  VWAP_RECLAIM:       "PRICE_TRIGGER_SAFE_TO_BACKFILL",

  // Intraday strategies: trigger requires an opening-range or gap event that
  // happened in the detected session. Backfilling with resistance_price is
  // technically possible but the level is only valid on the detection day.
  // Rows from a prior session will be expired by the session-expiry lifecycle
  // resolver anyway. Skipped here to avoid restoring stale intraday triggers.
  GAP_AND_GO:         "SESSION_OR_EVENT_TRIGGER_REQUIRES_REVIEW",
  ORB5:               "SESSION_OR_EVENT_TRIGGER_REQUIRES_REVIEW",
  ORB15:              "SESSION_OR_EVENT_TRIGGER_REQUIRES_REVIEW",
};

const SAFE_STRATEGY_IDS = Object.entries(STRATEGY_ELIGIBILITY)
  .filter(([, v]) => v === "PRICE_TRIGGER_SAFE_TO_BACKFILL")
  .map(([k]) => k);

// ---------------------------------------------------------------------------
// Dry-run report types
// ---------------------------------------------------------------------------

export interface BackfillCandidate {
  id: string;
  symbol: string;
  strategyId: string;
  status: string;
  resistancePrice: number;
  entryTriggerPrice: number | null; // always null for eligible rows
}

export interface BackfillReport {
  rowsInspected: number;
  rowsEligible: number;
  rowsSkipped: number;
  byStrategy: Record<string, { eligible: number; skipped: number; skipReasons: string[] }>;
  sampleChanges: Array<{ symbol: string; strategyId: string; from: null; to: number }>;
  skipReasonSummary: Record<string, number>;
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Core backfill logic (injectable deps for testing)
// ---------------------------------------------------------------------------

export interface BackfillDeps {
  fetchRows(): Promise<Array<{
    id: string;
    symbol: string;
    strategyId: string;
    status: string;
    resistancePrice: number | null;
    entryTriggerPrice: number | null;
  }>>;
  applyUpdate(id: string, entryTriggerPrice: number): Promise<void>;
}

export async function runBackfill(
  mode: "dry-run" | "apply",
  deps: BackfillDeps,
  sampleSize = 5,
): Promise<BackfillReport> {
  const rows = await deps.fetchRows();

  const report: BackfillReport = {
    rowsInspected: rows.length,
    rowsEligible: 0,
    rowsSkipped: 0,
    byStrategy: {},
    sampleChanges: [],
    skipReasonSummary: {},
    dryRun: mode === "dry-run",
  };

  const bump = (stratId: string, field: "eligible" | "skipped", reason?: string) => {
    if (!report.byStrategy[stratId]) {
      report.byStrategy[stratId] = { eligible: 0, skipped: 0, skipReasons: [] };
    }
    report.byStrategy[stratId][field]++;
    if (reason) {
      if (!report.byStrategy[stratId].skipReasons.includes(reason))
        report.byStrategy[stratId].skipReasons.push(reason);
      report.skipReasonSummary[reason] = (report.skipReasonSummary[reason] ?? 0) + 1;
    }
  };

  for (const row of rows) {
    // Row invariant: entryTriggerPrice is already null (fetched with that filter).
    // Guard anyway for idempotency in case of concurrent writes.
    if (row.entryTriggerPrice !== null) {
      bump(row.strategyId, "skipped", "ALREADY_HAS_TRIGGER");
      report.rowsSkipped++;
      continue;
    }

    const eligibility = STRATEGY_ELIGIBILITY[row.strategyId];

    if (!eligibility) {
      bump(row.strategyId, "skipped", "UNKNOWN_STRATEGY");
      report.rowsSkipped++;
      continue;
    }

    if (eligibility !== "PRICE_TRIGGER_SAFE_TO_BACKFILL") {
      bump(row.strategyId, "skipped", eligibility);
      report.rowsSkipped++;
      continue;
    }

    const rp = row.resistancePrice;
    if (rp == null || !Number.isFinite(rp) || rp <= 0) {
      bump(row.strategyId, "skipped", "INVALID_RESISTANCE_PRICE");
      report.rowsSkipped++;
      continue;
    }

    // Eligible
    bump(row.strategyId, "eligible");
    report.rowsEligible++;

    if (report.sampleChanges.length < sampleSize) {
      report.sampleChanges.push({
        symbol: row.symbol,
        strategyId: row.strategyId,
        from: null,
        to: rp,
      });
    }

    if (mode === "apply") {
      await deps.applyUpdate(row.id, rp);
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// Default production deps (Drizzle)
// ---------------------------------------------------------------------------

const productionDeps: BackfillDeps = {
  async fetchRows() {
    return db
      .select({
        id: opportunitiesTable.id,
        symbol: opportunitiesTable.symbol,
        strategyId: opportunitiesTable.strategyId,
        status: opportunitiesTable.status,
        resistancePrice: opportunitiesTable.resistancePrice,
        entryTriggerPrice: opportunitiesTable.entryTriggerPrice,
      })
      .from(opportunitiesTable)
      .where(
        and(
          isNull(opportunitiesTable.entryTriggerPrice),
          isNotNull(opportunitiesTable.resistancePrice),
          gt(opportunitiesTable.resistancePrice, 0),
          inArray(opportunitiesTable.strategyId, SAFE_STRATEGY_IDS),
        ),
      );
  },
  async applyUpdate(id, entryTriggerPrice) {
    await db
      .update(opportunitiesTable)
      .set({ entryTriggerPrice, updatedAt: new Date() })
      .where(
        and(
          // @ts-ignore — Drizzle eq helper
          (await import("drizzle-orm")).eq(opportunitiesTable.id, id),
          isNull(opportunitiesTable.entryTriggerPrice), // idempotency guard
        ),
      );
  },
};

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith("backfill-trigger-prices.ts")) {
  const mode = process.argv.includes("--apply") ? "apply" : "dry-run";

  console.log(`\n[Backfill] Running in ${mode.toUpperCase()} mode…`);

  runBackfill(mode, productionDeps)
    .then((report) => {
      console.log(`\n[Backfill] Complete`);
      console.log(`  Rows inspected : ${report.rowsInspected}`);
      console.log(`  Rows eligible  : ${report.rowsEligible}`);
      console.log(`  Rows skipped   : ${report.rowsSkipped}`);
      console.log(`\n  By strategy:`);
      for (const [id, s] of Object.entries(report.byStrategy)) {
        const reasons = s.skipReasons.length ? ` (skip reasons: ${s.skipReasons.join(", ")})` : "";
        console.log(`    ${id}: ${s.eligible} eligible, ${s.skipped} skipped${reasons}`);
      }
      if (report.sampleChanges.length > 0) {
        console.log(`\n  Sample changes (up to 5):`);
        for (const c of report.sampleChanges) {
          // No prices logged at full precision — rounded to 2 dp for readability
          console.log(`    ${c.symbol} [${c.strategyId}]: entryTriggerPrice null → ${c.to.toFixed(2)}`);
        }
      }
      if (report.dryRun) {
        console.log(`\n  DRY RUN — no rows were modified. Re-run with --apply to persist.`);
      } else {
        console.log(`\n  APPLIED — ${report.rowsEligible} rows updated.`);
      }
    })
    .catch((err) => {
      console.error("[Backfill] Fatal error:", err.message);
      process.exit(1);
    });
}
