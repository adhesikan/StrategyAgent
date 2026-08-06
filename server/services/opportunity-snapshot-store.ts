// Opportunity Snapshot Store — Sprint 1.1
//
// Thin repository layer over the `opportunity_scan_snapshots` PostgreSQL table.
// The Opportunity Engine calls this service; it contains no orchestration logic.
//
// Trust rules:
//   - Never stores MCP session IDs, access tokens, account data, raw provider payloads.
//   - result_payload is validated by the engine before calling saveSuccessfulSnapshot.
//   - errorSummary is bounded to 500 chars; never a stack trace.
//   - All DB errors are surfaced to the caller, never silently swallowed.
//
// Retention:
//   - Valid snapshots (SUCCESS / PARTIAL_SUCCESS / EMPTY_SUCCESS): 30 days
//   - Failed attempts: 7 days

import { db } from "../db";
import { opportunityScanSnapshots } from "@shared/schema";
import { desc, sql, inArray, lt, and } from "drizzle-orm";
import type { RankedTradeCandidate, RankedWatchCandidate } from "../routes/ranked-trade-search";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VALID_STATUSES = ["SUCCESS", "PARTIAL_SUCCESS", "EMPTY_SUCCESS"] as const;
export const FAILED_STATUS = "FAILED" as const;
export type ScanStatus = (typeof VALID_STATUSES)[number] | typeof FAILED_STATUS;

const VALID_RETENTION_DAYS = 30;
const FAILED_RETENTION_DAYS = 7;

// ---------------------------------------------------------------------------
// Payload shape stored in result_payload column
// ---------------------------------------------------------------------------

export interface SnapshotResultPayload {
  marketRegime: string | null;
  topGrowth: RankedTradeCandidate[];
  topIncome: RankedTradeCandidate[];
  topWatchlist: RankedWatchCandidate[];
  approachingQualification: RankedWatchCandidate[];
}

// ---------------------------------------------------------------------------
// Runtime snapshot (what the engine keeps in memory + returns to clients)
// ---------------------------------------------------------------------------

export interface PersistedOpportunitySnapshot {
  id: string;
  status: (typeof VALID_STATUSES)[number];
  startedAt: string;   // ISO
  completedAt: string; // ISO
  generatedAt: string; // ISO
  scannerVersion: string;
  marketRegime: string | null;
  dataSource: string;
  dataQuality: string;
  reviewedCount: number;
  qualifiedCount: number;
  watchCount: number;
  rejectedCount: number;
  excludedCount: number;
  unavailableCount: number;
  topGrowth: RankedTradeCandidate[];
  topIncome: RankedTradeCandidate[];
  topWatchlist: RankedWatchCandidate[];
  approachingQualification: RankedWatchCandidate[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Argument types
// ---------------------------------------------------------------------------

export interface SaveSuccessfulSnapshotArgs {
  status: (typeof VALID_STATUSES)[number];
  startedAt: Date;
  completedAt: Date;
  generatedAt: Date | null;
  dataSource: string;
  dataQuality: string;
  scannerVersion: string;
  requestFingerprint: string;
  requestSummary: Record<string, unknown>;
  reviewedCount: number;
  qualifiedCount: number;
  watchCount: number;
  rejectedCount: number;
  excludedCount: number;
  unavailableCount: number;
  resultPayload: SnapshotResultPayload;
  warnings: string[];
  durationMs: number;
}

export interface SaveFailedAttemptArgs {
  startedAt: Date;
  completedAt: Date;
  errorCode: string;
  errorSummary: string;
  durationMs: number;
  requestSummary?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Store functions
// ---------------------------------------------------------------------------

/**
 * Persist a successful (or partial/empty) scan result.
 * Returns the generated row ID.
 * Throws on DB error.
 */
export async function saveSuccessfulSnapshot(args: SaveSuccessfulSnapshotArgs): Promise<string> {
  const rows = await db
    .insert(opportunityScanSnapshots)
    .values({
      status: args.status,
      scanType: "MARKET_RANKING",
      startedAt: args.startedAt,
      completedAt: args.completedAt,
      generatedAt: args.generatedAt,
      dataSource: args.dataSource,
      dataQuality: args.dataQuality,
      scannerVersion: args.scannerVersion,
      requestFingerprint: args.requestFingerprint,
      requestSummary: args.requestSummary,
      reviewedCount: args.reviewedCount,
      qualifiedCount: args.qualifiedCount,
      watchCount: args.watchCount,
      rejectedCount: args.rejectedCount,
      excludedCount: args.excludedCount,
      unavailableCount: args.unavailableCount,
      resultPayload: args.resultPayload as unknown as Record<string, unknown>,
      warnings: args.warnings as unknown as Record<string, unknown>,
      durationMs: args.durationMs,
    })
    .returning({ id: opportunityScanSnapshots.id });

  const id = rows[0]?.id;
  if (!id) throw new Error("opportunity-snapshot-store: INSERT did not return an id");
  return id;
}

/**
 * Persist a failed scan attempt (no result_payload written).
 * FAILED rows never replace the latest valid snapshot.
 */
export async function saveFailedAttempt(args: SaveFailedAttemptArgs): Promise<void> {
  await db.insert(opportunityScanSnapshots).values({
    status: FAILED_STATUS,
    scanType: "MARKET_RANKING",
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    errorCode: args.errorCode.slice(0, 64),
    errorSummary: args.errorSummary.slice(0, 500),
    durationMs: args.durationMs,
    requestSummary: args.requestSummary ?? {},
    warnings: [] as unknown as Record<string, unknown>,
  });
}

/**
 * Return the most recent row where status is a valid (non-FAILED) outcome.
 * Reconstructs a PersistedOpportunitySnapshot from the stored columns + JSONB payload.
 * Returns null when no valid snapshot exists.
 */
export async function getLatestValidSnapshot(): Promise<PersistedOpportunitySnapshot | null> {
  const rows = await db
    .select()
    .from(opportunityScanSnapshots)
    .where(inArray(opportunityScanSnapshots.status, [...VALID_STATUSES]))
    .orderBy(desc(opportunityScanSnapshots.completedAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return rowToSnapshot(row);
}

/**
 * Return the most recent row regardless of status.
 * Used by the endpoint to surface the last attempt's error when no valid snapshot exists.
 */
export async function getLatestAttempt(): Promise<{
  status: ScanStatus;
  completedAt: string | null;
  errorCode: string | null;
  errorSummary: string | null;
} | null> {
  const rows = await db
    .select({
      status: opportunityScanSnapshots.status,
      completedAt: opportunityScanSnapshots.completedAt,
      errorCode: opportunityScanSnapshots.errorCode,
      errorSummary: opportunityScanSnapshots.errorSummary,
    })
    .from(opportunityScanSnapshots)
    .orderBy(desc(opportunityScanSnapshots.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    status: row.status as ScanStatus,
    completedAt: row.completedAt?.toISOString() ?? null,
    errorCode: row.errorCode,
    errorSummary: row.errorSummary,
  };
}

/**
 * Delete expired rows:
 *   - Valid snapshots older than 30 days
 *   - FAILED attempts older than 7 days
 * Returns counts for observability.
 * Non-blocking — caller should not await in the critical path.
 */
export async function deleteExpiredSnapshots(): Promise<{
  validDeleted: number;
  failedDeleted: number;
}> {
  const validCutoff = new Date(Date.now() - VALID_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const failedCutoff = new Date(Date.now() - FAILED_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const [validResult, failedResult] = await Promise.all([
    db.execute(
      sql`DELETE FROM opportunity_scan_snapshots
          WHERE status IN ('SUCCESS', 'PARTIAL_SUCCESS', 'EMPTY_SUCCESS')
            AND created_at < ${validCutoff}`,
    ),
    db.execute(
      sql`DELETE FROM opportunity_scan_snapshots
          WHERE status = 'FAILED'
            AND created_at < ${failedCutoff}`,
    ),
  ]);

  const validDeleted = (validResult as any).rowCount ?? 0;
  const failedDeleted = (failedResult as any).rowCount ?? 0;
  return { validDeleted, failedDeleted };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rowToSnapshot(row: {
  id: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  generatedAt: Date | null;
  scannerVersion: string | null;
  dataSource: string | null;
  dataQuality: string | null;
  reviewedCount: number;
  qualifiedCount: number;
  watchCount: number;
  rejectedCount: number;
  excludedCount: number;
  unavailableCount: number;
  resultPayload: unknown;
  warnings: unknown;
  createdAt: Date | null;
}): PersistedOpportunitySnapshot {
  const payload = (row.resultPayload ?? {}) as Partial<SnapshotResultPayload>;
  const now = new Date().toISOString();

  return {
    id: row.id,
    status: row.status as (typeof VALID_STATUSES)[number],
    startedAt: row.startedAt?.toISOString() ?? row.createdAt?.toISOString() ?? now,
    completedAt: row.completedAt?.toISOString() ?? row.createdAt?.toISOString() ?? now,
    generatedAt: row.generatedAt?.toISOString() ?? row.createdAt?.toISOString() ?? now,
    scannerVersion: row.scannerVersion ?? "mcp-v1",
    marketRegime: payload.marketRegime ?? null,
    dataSource: row.dataSource ?? "Twelve Data via MCP",
    dataQuality: row.dataQuality ?? "Latest daily market data",
    reviewedCount: row.reviewedCount,
    qualifiedCount: row.qualifiedCount,
    watchCount: row.watchCount,
    rejectedCount: row.rejectedCount,
    excludedCount: row.excludedCount,
    unavailableCount: row.unavailableCount,
    topGrowth: Array.isArray(payload.topGrowth) ? payload.topGrowth : [],
    topIncome: Array.isArray(payload.topIncome) ? payload.topIncome : [],
    topWatchlist: Array.isArray(payload.topWatchlist) ? payload.topWatchlist : [],
    approachingQualification: Array.isArray(payload.approachingQualification)
      ? payload.approachingQualification
      : [],
    warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : [],
  };
}
