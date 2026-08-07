#!/usr/bin/env npx tsx
// Institutional 13F — Pipeline Status CLI
//
// Read-only terminal display of ingestion progress across all priority quarters.
// Usage: npx tsx scripts/institutional-ingestion-status.ts
//
// Requires: DATABASE_URL environment variable
//
// Output example:
//   ┌─────────────────────────────────────────────────────────────────────┐
//   │ Institutional 13F Pipeline Status            (2026-08-07 06:12 UTC) │
//   ├────────────┬──────────┬──────────┬──────────┬────────┬─────────────┤
//   │ Quarter    │ State    │ Progress │ Filings  │Holdings│ Last Run    │
//   ├────────────┼──────────┼──────────┼──────────┼────────┼─────────────┤
//   │ 2026-Q1    │ PARTIAL  │  32%     │ 2,987    │ 1.06M  │ 2026-08-07  │
//   │ 2025-Q4    │ READY    │ 100%     │ 9,364    │ 3.33M  │ 2026-07-28  │
//   └────────────┴──────────┴──────────┴──────────┴────────┴─────────────┘

// No ../server/env import — DATABASE_URL must be set in the calling environment.
// Usage: DATABASE_URL="..." npx tsx scripts/institutional-ingestion-status.ts

if (!process.env.DATABASE_URL) {
  console.error(
    "[institutional-status] FATAL: DATABASE_URL is not set.\n" +
      "Usage: DATABASE_URL=\"...\" npx tsx scripts/institutional-ingestion-status.ts",
  );
  process.exit(1);
}

import { getPipelineStatus } from "../server/services/institutional/pipeline-status";

const PRIORITY_QUARTERS = ["2026-Q1", "2025-Q4", "2025-Q3", "2025-Q2"];

function pad(s: string | number, width: number, rightAlign = false): string {
  const str = String(s);
  if (str.length >= width) return str.slice(0, width);
  const padding = " ".repeat(width - str.length);
  return rightAlign ? padding + str : str + padding;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return n.toLocaleString();
  return String(n);
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const status = await getPipelineStatus(PRIORITY_QUARTERS);
  const now = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

  const title = `Institutional 13F Pipeline Status            (${now})`;
  // Column widths: Quarter=10, State=15, Progress=8, Filings=8, Holdings=8, LastRun=10
  const top    = "┌" + "─".repeat(73) + "┐";
  const sep1   = "├" + "─".repeat(12) + "┬" + "─".repeat(17) + "┬" + "─".repeat(10) + "┬" + "─".repeat(10) + "┬" + "─".repeat(10) + "┬" + "─".repeat(12) + "┤";
  const sep2   = "├" + "─".repeat(12) + "┼" + "─".repeat(17) + "┼" + "─".repeat(10) + "┼" + "─".repeat(10) + "┼" + "─".repeat(10) + "┼" + "─".repeat(12) + "┤";
  const bottom = "└" + "─".repeat(12) + "┴" + "─".repeat(17) + "┴" + "─".repeat(10) + "┴" + "─".repeat(10) + "┴" + "─".repeat(10) + "┴" + "─".repeat(12) + "┘";

  console.log(top);
  console.log("│ " + pad(title, 71) + " │");
  console.log(sep1);
  console.log(
    "│ " + pad("Quarter", 10) +
    " │ " + pad("State", 15) +
    " │ " + pad("Progress", 8) +
    " │ " + pad("Filings", 8) +
    " │ " + pad("Holdings", 8) +
    " │ " + pad("Last Run", 10) +
    " │",
  );
  console.log(sep2);

  for (const q of status.quarters) {
    const progress = `${q.progressPercent}%`;
    console.log(
      "│ " + pad(q.quarter, 10) +
      " │ " + pad(q.stateLabel, 15) +
      " │ " + pad(progress, 8, true) +
      " │ " + pad(fmtNum(q.storedFilings), 8, true) +
      " │ " + pad(fmtNum(q.storedHoldings), 8, true) +
      " │ " + pad(fmtDate(q.lastScheduledRun), 10) +
      " │",
    );
  }

  console.log(bottom);
  console.log();

  const readyCount = status.quarters.filter((q) => q.ready).length;
  const resumableCount = status.quarters.filter((q) => q.resumable).length;
  console.log(`  Data ready: ${status.institutionalDataReady ? "✓ Yes" : "✗ No"}`);
  console.log(`  Quarters ready: ${readyCount}/${status.quarters.length}`);
  if (resumableCount > 0) {
    console.log(`  Quarters resumable (partial/not started): ${resumableCount}`);
  }
  if (status.nextExpectedRun) {
    console.log(`  Next scheduled run: ${fmtDate(status.nextExpectedRun)}`);
  }
  console.log();
}

if (!process.env.VITEST) {
  main().catch((err) => {
    console.error("Error:", err?.message);
    process.exit(1);
  });
}
