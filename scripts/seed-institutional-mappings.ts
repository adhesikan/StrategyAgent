#!/usr/bin/env tsx
// Institutional Intelligence — Reviewed Mapping Seed
//
// Safe CLI tool for inserting reviewed CUSIP→ticker mappings.
// Reviewed mappings are required before institutional aggregates can be shown
// for any symbol in VCP Trader.
//
// Usage — from a JSON file:
//   npx tsx scripts/seed-institutional-mappings.ts --file scripts/data/reviewed-mappings.json
//
// Usage — from a single CLI record:
//   npx tsx scripts/seed-institutional-mappings.ts \
//     --cusip 22160K105 --ticker COST \
//     --issuer "Costco Wholesale Corporation" \
//     --method manual_reviewed
//
// Dry run (no writes):
//   npx tsx scripts/seed-institutional-mappings.ts --file mappings.json --dry-run
//
// Mapping file format (JSON array):
//   [
//     {
//       "cusip": "22160K105",
//       "ticker": "COST",
//       "issuerName": "Costco Wholesale Corporation",
//       "mappingMethod": "manual_reviewed",
//       "mappingStatus": "reviewed",
//       "figi": null
//     }
//   ]
//
// RULES:
//   - Only "exact" and "reviewed" mappingStatus values are accepted.
//   - "probable" and "ambiguous" are rejected — they must not feed production aggregates.
//   - CUSIP is normalised to 9 uppercase alphanumeric characters.
//   - Ticker is normalised to uppercase, max 10 chars.
//   - Issuer name is required and must be non-empty.
//   - Upsert is idempotent — safe to re-run.
//   - Dry run prints what would be upserted without touching the DB.
//   - NEVER prints DATABASE_URL or credentials.

import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { institutionalSecurityMappings } from "../shared/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewedMappingRecord {
  cusip: string;
  ticker: string;
  issuerName: string;
  mappingMethod: "manual_reviewed" | "cusip_exact" | "figi_exact" | "reviewed";
  mappingStatus: "exact" | "reviewed";
  figi?: string | null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CUSIP_RE = /^[A-Z0-9]{9}$/;
const TICKER_RE = /^[A-Z]{1,10}$/;
const ALLOWED_STATUSES = new Set(["exact", "reviewed"]);
const REJECTED_STATUSES = new Set(["probable", "ambiguous", "unmapped"]);

export function normaliseCusip(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normaliseTicker(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10);
}

export interface ValidationResult {
  ok: boolean;
  record?: ReviewedMappingRecord;
  errors: string[];
}

export function validateMapping(raw: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  // CUSIP
  const rawCusip = String(raw.cusip ?? "").trim();
  const cusip = normaliseCusip(rawCusip);
  if (!CUSIP_RE.test(cusip)) {
    errors.push(`Invalid CUSIP "${rawCusip}" — must be exactly 9 uppercase alphanumeric characters after normalisation.`);
  }

  // Ticker
  const rawTicker = String(raw.ticker ?? "").trim();
  const ticker = normaliseTicker(rawTicker);
  if (!TICKER_RE.test(ticker)) {
    errors.push(`Invalid ticker "${rawTicker}" — must be 1–10 uppercase letters after normalisation.`);
  }

  // Issuer name
  const issuerName = String(raw.issuerName ?? "").trim();
  if (!issuerName || issuerName.length < 2) {
    errors.push(`issuerName is required and must be at least 2 characters.`);
  }

  // Mapping status
  const mappingStatus = String(raw.mappingStatus ?? "").trim().toLowerCase();
  if (REJECTED_STATUSES.has(mappingStatus)) {
    errors.push(
      `mappingStatus "${mappingStatus}" is not allowed for production seed. ` +
      `Only "exact" and "reviewed" are permitted. ` +
      `Do not use issuer-name fuzzy matching to create reviewed mappings.`,
    );
  } else if (!ALLOWED_STATUSES.has(mappingStatus)) {
    errors.push(`mappingStatus "${mappingStatus}" is not valid. Use "exact" or "reviewed".`);
  }

  // Mapping method
  const allowedMethods = new Set(["manual_reviewed", "cusip_exact", "figi_exact", "reviewed"]);
  const mappingMethod = String(raw.mappingMethod ?? "manual_reviewed").trim().toLowerCase();
  if (!allowedMethods.has(mappingMethod)) {
    errors.push(`mappingMethod "${mappingMethod}" is not valid. Use one of: manual_reviewed, cusip_exact, figi_exact, reviewed.`);
  }

  // FIGI (optional)
  const figi = raw.figi !== undefined && raw.figi !== null ? String(raw.figi).trim() || null : null;

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    record: {
      cusip,
      ticker,
      issuerName,
      mappingMethod: mappingMethod as ReviewedMappingRecord["mappingMethod"],
      mappingStatus: mappingStatus as "exact" | "reviewed",
      figi: figi || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Schema preflight
// ---------------------------------------------------------------------------

async function checkSchemaExists(): Promise<void> {
  try {
    await db.execute(sql`SELECT 1 FROM institutional_security_mappings LIMIT 0`);
  } catch (err: any) {
    const msg: string = err?.message ?? "";
    if (msg.includes("does not exist") || msg.includes("relation") || msg.includes("42P01")) {
      console.error(
        "[seed:error] INSTITUTIONAL_SCHEMA_MISSING: Table institutional_security_mappings does not exist.\n" +
        "  Run the migration first:\n" +
        "  psql \"$DATABASE_URL\" -f scripts/migrate-institutional.sql",
      );
      process.exit(1);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Upsert — idempotent
// ---------------------------------------------------------------------------

async function upsertMapping(record: ReviewedMappingRecord, dryRun: boolean): Promise<"inserted" | "updated" | "dry_run"> {
  if (dryRun) {
    console.log(
      `  [dry-run] Would upsert: cusip=${record.cusip} ticker=${record.ticker} ` +
      `issuer="${record.issuerName}" status=${record.mappingStatus} method=${record.mappingMethod}`,
    );
    return "dry_run";
  }

  // Idempotent upsert: update on conflict
  await db
    .insert(institutionalSecurityMappings)
    .values({
      cusip: record.cusip,
      figi: record.figi ?? null,
      mappedSymbol: record.ticker,
      issuerName: record.issuerName,
      mappingStatus: record.mappingStatus,
      mappingMethod: record.mappingMethod,
      lastVerifiedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [institutionalSecurityMappings.cusip],
      set: {
        mappedSymbol: record.ticker,
        issuerName: record.issuerName,
        mappingStatus: record.mappingStatus,
        mappingMethod: record.mappingMethod,
        lastVerifiedAt: new Date(),
      },
    });

  console.log(
    `  ✓ Upserted: cusip=${record.cusip} ticker=${record.ticker} ` +
    `issuer="${record.issuerName}" status=${record.mappingStatus}`,
  );
  return "inserted";
}

// ---------------------------------------------------------------------------
// Load records from source
// ---------------------------------------------------------------------------

async function loadRecords(
  file: string | null,
  singleArgs: { cusip?: string; ticker?: string; issuerName?: string; mappingMethod?: string; figi?: string } | null,
): Promise<Array<Record<string, unknown>>> {
  if (file) {
    let raw: string;
    try {
      raw = await readFile(file, "utf-8");
    } catch (err: any) {
      console.error(`[seed:error] Cannot read file "${file}": ${err?.message}`);
      process.exit(1);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      console.error(`[seed:error] File "${file}" is not valid JSON: ${err?.message}`);
      process.exit(1);
    }
    if (!Array.isArray(parsed)) {
      console.error(`[seed:error] File "${file}" must contain a JSON array of mapping records.`);
      process.exit(1);
    }
    return parsed as Array<Record<string, unknown>>;
  }

  if (singleArgs) {
    return [singleArgs as Record<string, unknown>];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("[seed] === Institutional Mapping Seed ===");

  // Parse arguments
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        file: { type: "string" },
        cusip: { type: "string" },
        ticker: { type: "string" },
        issuer: { type: "string" },
        method: { type: "string", default: "manual_reviewed" },
        figi: { type: "string" },
        "dry-run": { type: "boolean", default: false },
      },
      strict: true,
    });
  } catch (err: any) {
    console.error(`[seed:error] INVALID_ARGS: ${err?.message}`);
    process.exit(1);
  }

  const vals = parsed.values as any;
  const dryRun = Boolean(vals["dry-run"]);
  const file: string | null = vals.file ?? null;
  const hasSingleArgs = vals.cusip || vals.ticker;

  if (!file && !hasSingleArgs) {
    console.error(
      "[seed:error] INVALID_ARGS: Provide either --file <path> or --cusip/--ticker/--issuer arguments.",
    );
    process.exit(1);
  }
  if (file && hasSingleArgs) {
    console.error("[seed:error] INVALID_ARGS: --file and --cusip/--ticker cannot be used together.");
    process.exit(1);
  }

  const singleArgs = hasSingleArgs
    ? { cusip: vals.cusip, ticker: vals.ticker, issuerName: vals.issuer, mappingMethod: vals.method, figi: vals.figi }
    : null;

  // Environment check
  if (!process.env.DATABASE_URL) {
    console.error("[seed:error] MISSING_DATABASE_URL: DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  // Schema preflight
  if (!dryRun) {
    await checkSchemaExists();
  }

  // Load records
  const rawRecords = await loadRecords(file, singleArgs);
  console.log(`[seed] ${rawRecords.length} record(s) to process${dryRun ? " (dry run)" : ""}.`);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < rawRecords.length; i++) {
    const raw = rawRecords[i];
    const result = validateMapping(raw);

    if (!result.ok) {
      console.error(`[seed:error] Record ${i + 1}: Validation failed:`);
      for (const e of result.errors) {
        console.error(`  - ${e}`);
      }
      errorCount++;
      continue;
    }

    try {
      await upsertMapping(result.record!, dryRun);
      successCount++;
    } catch (err: any) {
      console.error(`[seed:error] Record ${i + 1}: DB upsert failed: ${String(err?.message ?? "").slice(0, 200)}`);
      errorCount++;
    }
  }

  console.log(
    `[seed] Summary: ${successCount} succeeded, ${errorCount} failed${dryRun ? " (dry run — no writes)" : ""}.`,
  );

  if (errorCount > 0) {
    console.error("[seed] Exiting with errors.");
    process.exit(1);
  }

  console.log("[seed] === Seed complete ===");
  process.exit(0);
}

// Only auto-execute when run directly (not when imported by the test suite)
if (!process.env.VITEST) {
  main().catch((err: any) => {
    console.error(`[seed:fatal] ${err?.name ?? "FATAL"}: ${String(err?.message ?? "").slice(0, 300)}`);
    process.exit(1);
  });
}
