// Opportunity Engine — Sprint 1.1
//
// Background scanner that pre-computes stock opportunities and persists each
// result to PostgreSQL. On startup, the latest valid snapshot is loaded from
// the database so the dashboard can serve it immediately without waiting for
// a new MCP scan.
//
// Locking: PostgreSQL advisory lock prevents concurrent scans across Railway
// instances. The lock is released after every success or failure.
//
// Interval: configurable via OPPORTUNITY_SCAN_INTERVAL_MINUTES (default 240,
// min 30, max 1440). Invalid values fall back to the default.
//
// Trust rules:
//   - Never exposes MCP session IDs, tokens, account data, or raw provider payloads.
//   - Forbidden-field scanner runs before persistence.
//   - FAILED results never replace a valid snapshot in memory or PostgreSQL.
//   - No simulated data is ever persisted.

import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  runRankedTradeSearch,
  type RankedTradeCandidate,
  type RankedWatchCandidate,
} from "../routes/ranked-trade-search";
import { isMcpEnabled } from "../mcp/config";
import {
  saveSuccessfulSnapshot,
  saveFailedAttempt,
  getLatestValidSnapshot,
  deleteExpiredSnapshots,
  type PersistedOpportunitySnapshot,
  VALID_STATUSES,
} from "./opportunity-snapshot-store";

// ---------------------------------------------------------------------------
// Re-export the canonical snapshot type used by routes
// ---------------------------------------------------------------------------
export type { PersistedOpportunitySnapshot as OpportunitySnapshot };

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SCANNER_VERSION = "mcp-v1";
const OPPORTUNITY_SCAN_LOCK_KEY = 774_412_002; // distinct from ingestion (774_412_001)

/** Parse OPPORTUNITY_SCAN_INTERVAL_MINUTES with bounds (30–1440, default 240). */
function getScanIntervalMs(): number {
  const raw = parseInt(process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES ?? "240", 10);
  const minutes = Number.isFinite(raw) && raw >= 30 && raw <= 1440 ? raw : 240;
  return minutes * 60 * 1000;
}

// Exported for tests and endpoint (freshness calculation).
export function getIntervalMs(): number {
  return getScanIntervalMs();
}

// ---------------------------------------------------------------------------
// Forbidden-field scanner for opportunity payloads
// ---------------------------------------------------------------------------

const OPPORTUNITY_FORBIDDEN_FIELDS = new Set([
  // Sensitive auth / identity
  "accessToken", "refreshToken", "sessionId", "authorization",
  "accountId", "accountNumber", "userId", "apiKey", "serviceToken",
  "rawProviderResponse", "rawProviderPayload",
  // Synthetic options-contract fields
  "premium", "strikes", "expiration", "optionOpenInterest", "optionVolume",
  "bidAskSpreadPct", "delta", "gamma", "theta", "vega",
]);

function scanForForbiddenOpportunityFields(
  value: unknown,
  path = "$",
): { found: true; path: string } | { found: false } {
  if (value === null || value === undefined) return { found: false };
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 200); i++) {
      const r = scanForForbiddenOpportunityFields(value[i], `${path}[${i}]`);
      if (r.found) return r;
    }
    return { found: false };
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (OPPORTUNITY_FORBIDDEN_FIELDS.has(key)) return { found: true, path: `${path}.${key}` };
      const r = scanForForbiddenOpportunityFields(
        (value as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
      if (r.found) return r;
    }
  }
  return { found: false };
}

function scanForSimulatedData(value: unknown): boolean {
  const s = JSON.stringify(value ?? {});
  return /"dataMode"\s*:\s*"simulated"/.test(s) || /"dataMode"\s*:\s*"mock"/.test(s);
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

export interface RefreshState {
  status: "idle" | "running" | "failed";
  attemptedAt: string | null;
  errorSummary: string | null;
}

let latestSnapshot: PersistedOpportunitySnapshot | null = null;
let engineRunning = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshState: RefreshState = { status: "idle", attemptedAt: null, errorSummary: null };

export function getLatestSnapshot(): PersistedOpportunitySnapshot | null {
  return latestSnapshot;
}

export function getRefreshState(): RefreshState {
  return { ...refreshState };
}

// ---------------------------------------------------------------------------
// Advisory lock helpers (mirrors ingestion.ts pattern)
// ---------------------------------------------------------------------------

async function tryAcquireLock(): Promise<boolean> {
  const res: any = await db.execute(
    sql`SELECT pg_try_advisory_lock(${OPPORTUNITY_SCAN_LOCK_KEY}) AS locked`,
  );
  const row = res.rows?.[0] ?? res[0];
  return row?.locked === true;
}

async function releaseLock(): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_unlock(${OPPORTUNITY_SCAN_LOCK_KEY})`);
}

// ---------------------------------------------------------------------------
// Startup: load latest valid snapshot from PostgreSQL
// ---------------------------------------------------------------------------

/**
 * Load the latest valid PostgreSQL snapshot into memory.
 * Call once at startup before starting the background scan.
 * Never throws — DB failures are logged; the engine continues.
 */
export async function initOpportunityEngine(): Promise<void> {
  try {
    const stored = await getLatestValidSnapshot();
    if (stored) {
      latestSnapshot = stored;
      console.log(
        JSON.stringify({
          event: "opportunity_snapshot_loaded",
          id: stored.id,
          status: stored.status,
          qualifiedCount: stored.qualifiedCount,
          watchCount: stored.watchCount,
          scannerVersion: stored.scannerVersion,
          completedAt: stored.completedAt,
        }),
      );
    } else {
      console.log(JSON.stringify({ event: "opportunity_snapshot_loaded", id: null }));
    }
  } catch (err: any) {
    console.warn(
      JSON.stringify({
        event: "opportunity_snapshot_load_failed",
        error: String(err?.message ?? err).slice(0, 200),
      }),
    );
    // Non-fatal — continue without a pre-loaded snapshot.
  }
}

// ---------------------------------------------------------------------------
// Scan outcome classification
// ---------------------------------------------------------------------------

type ScanOutcome = (typeof VALID_STATUSES)[number];

function classifyOutcome(
  qualified: number,
  watch: number,
  unavailable: number,
  warnings: string[],
): ScanOutcome {
  if (qualified === 0 && watch === 0) return "EMPTY_SUCCESS";
  if (unavailable > 0 || warnings.length > 0) return "PARTIAL_SUCCESS";
  return "SUCCESS";
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

/**
 * Run one opportunity scan:
 *   1. Acquire advisory lock (skip if already running on another instance)
 *   2. Call MCP via runRankedTradeSearch
 *   3. Validate + classify the result
 *   4. Persist to PostgreSQL
 *   5. Update in-memory snapshot
 *   6. Release lock
 *
 * Never throws — failures update refreshState.errorSummary and log safely.
 */
export async function runOpportunityEngine(): Promise<void> {
  if (!isMcpEnabled()) {
    console.log(
      JSON.stringify({ event: "opportunity_engine_skipped", reason: "mcp_disabled" }),
    );
    return;
  }

  // In-process guard (complementary to advisory lock).
  if (engineRunning) {
    console.log(
      JSON.stringify({ event: "opportunity_engine_skipped", reason: "already_running" }),
    );
    return;
  }

  const attemptedAt = new Date().toISOString();
  refreshState = { status: "running", attemptedAt, errorSummary: null };
  engineRunning = true;
  const startedAt = new Date();
  const started = Date.now();

  // Try to acquire PostgreSQL advisory lock — skip if another instance holds it.
  let locked = false;
  try {
    locked = await tryAcquireLock();
  } catch (err: any) {
    console.warn(
      JSON.stringify({
        event: "opportunity_scan_skipped_locked",
        reason: "lock_acquisition_error",
        error: String(err?.message ?? err).slice(0, 200),
      }),
    );
    refreshState = { status: "idle", attemptedAt, errorSummary: null };
    engineRunning = false;
    return;
  }

  if (!locked) {
    console.log(
      JSON.stringify({ event: "opportunity_scan_skipped_locked", reason: "held_by_another_instance" }),
    );
    refreshState = { status: "idle", attemptedAt, errorSummary: null };
    engineRunning = false;
    return;
  }

  console.log(JSON.stringify({ event: "opportunity_scan_started", scannerVersion: SCANNER_VERSION }));

  try {
    const { rankMarketTradeCandidates } = await import("../mcp/tools");

    const search = await runRankedTradeSearch(
      { numberOfIdeas: 10, instrumentPreference: "stock", direction: "either" },
      {
        rank: (args) =>
          rankMarketTradeCandidates({
            numberOfIdeas: 10,
            instrumentPreference: "stock",
            direction: "either",
            ...args,
          }),
      },
    );

    // Attempt to get market regime (non-fatal).
    let marketRegime: string | null = null;
    try {
      const { getMarketRegime } = await import("../mcp/tools");
      const regime = (await getMarketRegime()) as any;
      marketRegime =
        typeof regime?.regime === "string"
          ? regime.regime
          : typeof regime?.label === "string"
          ? regime.label
          : null;
    } catch {
      // Non-fatal.
    }

    const completedAt = new Date();
    const durationMs = Date.now() - started;

    // ---------------------------------------------------------------------------
    // Partition candidates into growth vs income
    // ---------------------------------------------------------------------------
    const INCOME_RE = /income|covered|credit|spread|dividend|yield/i;
    const all = search.candidates;
    const growthCandidates = all.filter((c) => !c.strategy || !INCOME_RE.test(c.strategy));
    const incomeCandidates = all.filter((c) => c.strategy && INCOME_RE.test(c.strategy));

    const topGrowth = growthCandidates.slice(0, 5);
    const topIncome = incomeCandidates.slice(0, 5);
    const topWatchlist = search.watchCandidates.slice(0, 3);
    const approachingQualification = search.watchCandidates.slice(3, 8);

    const resultPayload = {
      marketRegime,
      topGrowth,
      topIncome,
      topWatchlist,
      approachingQualification,
    };

    // ---------------------------------------------------------------------------
    // Validate before persistence
    // ---------------------------------------------------------------------------

    // 1. No forbidden fields
    const forbiddenScan = scanForForbiddenOpportunityFields(resultPayload);
    if (forbiddenScan.found) {
      throw Object.assign(
        new Error(`Forbidden field found in result payload at ${forbiddenScan.path}`),
        { code: "FORBIDDEN_FIELD" },
      );
    }

    // 2. No simulated data
    if (scanForSimulatedData(resultPayload)) {
      throw Object.assign(new Error("result_payload contains simulated/mock data"), {
        code: "SIMULATED_DATA",
      });
    }

    // 3. Counts are finite non-negative integers
    const counts = {
      reviewedCount: search.reviewedCount,
      qualifiedCount: search.qualifiedCount,
      watchCount: search.watchCandidates.length,
      rejectedCount: search.rejectedCount ?? 0,
      excludedCount: search.excludedCount ?? 0,
      unavailableCount: search.unavailableCount ?? 0,
    };
    for (const [k, v] of Object.entries(counts)) {
      if (!Number.isFinite(v) || v < 0) {
        throw Object.assign(new Error(`Count field ${k} is not a finite non-negative integer: ${v}`), {
          code: "INVALID_COUNT",
        });
      }
    }

    // 4. Classify outcome
    const status = classifyOutcome(
      search.qualifiedCount,
      search.watchCandidates.length,
      search.unavailableCount ?? 0,
      search.warnings,
    );

    // ---------------------------------------------------------------------------
    // Persist
    // ---------------------------------------------------------------------------
    let snapshotId: string;
    try {
      snapshotId = await saveSuccessfulSnapshot({
        status,
        startedAt,
        completedAt,
        generatedAt: search.generatedAt ? new Date(search.generatedAt) : null,
        dataSource: "Twelve Data via MCP",
        dataQuality: "Latest daily market data",
        scannerVersion: SCANNER_VERSION,
        requestFingerprint: `mcp-v1-${new Date().toISOString().slice(0, 13)}`,
        requestSummary: { numberOfIdeas: 10, instrumentPreference: "stock", direction: "either" },
        ...counts,
        resultPayload,
        warnings: search.warnings,
        durationMs,
      });
    } catch (err: any) {
      console.warn(
        JSON.stringify({
          event: "opportunity_snapshot_persistence_failed",
          error: String(err?.message ?? err).slice(0, 200),
        }),
      );
      // Do not update the in-memory snapshot if persistence failed.
      refreshState = {
        status: "failed",
        attemptedAt,
        errorSummary: "Scan completed but persistence failed.",
      };
      return;
    }

    // ---------------------------------------------------------------------------
    // Update in-memory snapshot (only after successful persistence)
    // ---------------------------------------------------------------------------
    latestSnapshot = {
      id: snapshotId,
      status,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      generatedAt: search.generatedAt ?? completedAt.toISOString(),
      scannerVersion: SCANNER_VERSION,
      marketRegime,
      dataSource: "Twelve Data via MCP",
      dataQuality: "Latest daily market data",
      ...counts,
      topGrowth,
      topIncome,
      topWatchlist,
      approachingQualification,
      warnings: search.warnings,
    };

    refreshState = { status: "idle", attemptedAt, errorSummary: null };

    const logEvent =
      status === "SUCCESS"
        ? "opportunity_scan_completed"
        : status === "PARTIAL_SUCCESS"
        ? "opportunity_scan_partial"
        : "opportunity_scan_empty";

    console.log(
      JSON.stringify({
        event: logEvent,
        id: snapshotId,
        status,
        durationMs,
        topGrowth: topGrowth.length,
        topIncome: topIncome.length,
        topWatchlist: topWatchlist.length,
        approachingQualification: approachingQualification.length,
        reviewedCount: counts.reviewedCount,
        qualifiedCount: counts.qualifiedCount,
        scannerVersion: SCANNER_VERSION,
        dataSource: "Twelve Data via MCP",
      }),
    );

    console.log(
      JSON.stringify({ event: "opportunity_snapshot_persisted", id: snapshotId, status }),
    );

    // Retention cleanup — non-blocking, failure does not invalidate the scan.
    void deleteExpiredSnapshots()
      .then(({ validDeleted, failedDeleted }) => {
        if (validDeleted > 0 || failedDeleted > 0) {
          console.log(
            JSON.stringify({
              event: "opportunity_snapshot_retention_completed",
              validDeleted,
              failedDeleted,
            }),
          );
        }
      })
      .catch((err: any) => {
        console.warn(
          JSON.stringify({
            event: "opportunity_snapshot_retention_failed",
            error: String(err?.message ?? err).slice(0, 200),
          }),
        );
      });
  } catch (err: any) {
    const durationMs = Date.now() - started;
    const errorCode = (err as any).code ?? "SCAN_ERROR";
    const errorSummary = String(err?.message ?? err).slice(0, 500);

    console.warn(
      JSON.stringify({
        event: "opportunity_scan_failed",
        durationMs,
        errorCode,
        error: errorSummary,
        scannerVersion: SCANNER_VERSION,
      }),
    );

    // Record a failed attempt (does NOT replace last valid snapshot).
    try {
      await saveFailedAttempt({
        startedAt,
        completedAt: new Date(),
        errorCode,
        errorSummary,
        durationMs,
        requestSummary: { numberOfIdeas: 10, instrumentPreference: "stock", direction: "either" },
      });
    } catch (persistErr: any) {
      console.warn(
        JSON.stringify({
          event: "opportunity_snapshot_persistence_failed",
          context: "failed_attempt",
          error: String(persistErr?.message ?? persistErr).slice(0, 200),
        }),
      );
    }

    refreshState = {
      status: "failed",
      attemptedAt,
      errorSummary: "Scan failed. Previous snapshot remains available.",
    };
    // latestSnapshot intentionally NOT updated — preserve the last valid one.
  } finally {
    try {
      await releaseLock();
    } catch (err: any) {
      console.warn(
        JSON.stringify({
          event: "opportunity_scan_lock_release_failed",
          error: String(err?.message ?? err).slice(0, 200),
        }),
      );
    }
    engineRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/**
 * Initialize and schedule the opportunity engine:
 *   1. Load latest valid snapshot from PostgreSQL (non-blocking startup)
 *   2. Run the first background scan asynchronously
 *   3. Schedule periodic refreshes per OPPORTUNITY_SCAN_INTERVAL_MINUTES
 *
 * Call once from server startup. Never blocks startup or dashboard load.
 */
export function scheduleOpportunityEngine(): void {
  // Load from PostgreSQL, then kick off first scan — both non-blocking.
  void initOpportunityEngine().then(() => void runOpportunityEngine());

  function scheduleNext() {
    if (refreshTimer) clearTimeout(refreshTimer);
    const intervalMs = getScanIntervalMs();
    refreshTimer = setTimeout(async () => {
      await runOpportunityEngine();
      scheduleNext();
    }, intervalMs);
    if (refreshTimer && typeof (refreshTimer as any).unref === "function") {
      (refreshTimer as any).unref();
    }
  }
  scheduleNext();
}

export function stopOpportunityEngine(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Test helpers (used by unit tests only)
// ---------------------------------------------------------------------------

/** @internal Reset all module-level state. Tests only. */
export function _resetEngineState(): void {
  latestSnapshot = null;
  engineRunning = false;
  refreshState = { status: "idle", attemptedAt: null, errorSummary: null };
  stopOpportunityEngine();
}
