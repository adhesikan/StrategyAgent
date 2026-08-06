// Opportunity Engine — Sprint 1 (Production-hardened)
//
// Background scanner that pre-computes stock opportunities and persists each
// result to PostgreSQL. On startup, the latest valid snapshot is loaded from
// the database so the dashboard can serve it immediately without waiting for
// a new MCP scan.
//
// Startup sequence:
//   1. initOpportunityEngine() — loads latest valid snapshot from PostgreSQL
//   2. initial scan fires immediately (fire-and-forget, terminal catch)
//   3. recurring interval registered for later scans (setInterval/setTimeout)
//
// Locking: PostgreSQL advisory lock prevents concurrent scans across Railway
// instances. The lock is released after every success or failure.
//
// Interval: configurable via OPPORTUNITY_SCAN_INTERVAL_MINUTES (default 240,
// min 30, max 1440). Invalid values fall back to the default.
//
// Observability: every scan emits opportunity_scan_triggered as the first
// event and exactly one terminal event. All events use the same structured log
// helper that is visible in Railway regardless of JSON parsing.
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
// Scan trigger type
// ---------------------------------------------------------------------------

export type ScanTrigger = "startup" | "interval" | "manual";

// ---------------------------------------------------------------------------
// Structured log helper
//
// Uses process.stdout.write so output appears as a plain line in Railway logs
// regardless of how the runtime parses JSON or prefixes console.log output.
// The format matches the structured events the spec requires.
// ---------------------------------------------------------------------------

function structuredLog(
  level: "info" | "warn",
  payload: Record<string, unknown>,
): void {
  const line = JSON.stringify(payload) + "\n";
  if (level === "warn") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
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
// Scan-ID generator (safe non-secret identifier for log correlation)
// ---------------------------------------------------------------------------

function makeScanId(): string {
  return `scan-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
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
  structuredLog("info", { event: "opportunity_snapshot_load_started", scannerVersion: SCANNER_VERSION });

  try {
    const stored = await getLatestValidSnapshot();
    if (stored) {
      latestSnapshot = stored;
      structuredLog("info", {
        event: "opportunity_snapshot_loaded",
        id: stored.id,
        status: stored.status,
        qualifiedCount: stored.qualifiedCount,
        watchCount: stored.watchCount,
        scannerVersion: stored.scannerVersion,
        completedAt: stored.completedAt,
      });
    } else {
      structuredLog("info", {
        event: "opportunity_snapshot_not_found",
        detail: "No valid snapshot in database; initial scan will populate one.",
      });
    }
  } catch (err: any) {
    structuredLog("warn", {
      event: "opportunity_snapshot_load_failed",
      error: String(err?.message ?? err).slice(0, 200),
      detail: "Non-fatal. Engine will attempt a fresh scan.",
    });
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
 *   1. Emit opportunity_scan_triggered (first event, before any gate)
 *   2. Check gates: MCP enabled, in-process guard
 *   3. Acquire advisory lock (skip if held by another instance)
 *   4. Emit opportunity_scan_started
 *   5. Call MCP via runRankedTradeSearch
 *   6. Validate + classify the result
 *   7. Persist to PostgreSQL
 *   8. Update in-memory snapshot
 *   9. Release lock, emit terminal event
 *
 * Never throws — failures update refreshState.errorSummary and log safely.
 */
export async function runOpportunityEngine(trigger: ScanTrigger = "interval"): Promise<void> {
  const scanId = makeScanId();
  const attemptedAt = new Date().toISOString();

  // Top-level safety net: runOpportunityEngine must NEVER reject.
  // Any unexpected throw (e.g. isMcpEnabled() misconfigured) is caught here
  // and emitted as a failed event so the caller never sees an unhandled rejection.
  try {
  return await _runOpportunityEngineInner(scanId, trigger, attemptedAt);
  } catch (err: any) {
    structuredLog("warn", {
      event: "opportunity_scan_failed",
      scanId,
      trigger,
      errorCode: "UNEXPECTED_ERROR",
      error: String(err?.message ?? err).slice(0, 500),
    });
    if (engineRunning) engineRunning = false;
    if (refreshState.status === "running") {
      refreshState = { status: "failed", attemptedAt, errorSummary: "Unexpected engine error." };
    }
  }
}

async function _runOpportunityEngineInner(
  scanId: string,
  trigger: ScanTrigger,
  attemptedAt: string,
): Promise<void> {
  // ── Gate 0: triggered event (always emitted) ────────────────────────────
  structuredLog("info", {
    event: "opportunity_scan_triggered",
    scanId,
    trigger,
    timestamp: attemptedAt,
    scannerVersion: SCANNER_VERSION,
  });

  // ── Gate 1: MCP enabled ─────────────────────────────────────────────────
  const mcpEnabled = isMcpEnabled();
  if (!mcpEnabled) {
    structuredLog("info", {
      event: "opportunity_scan_skipped_disabled",
      scanId,
      trigger,
      gate: "MCP_ENABLED",
      gateValue: String(process.env.MCP_ENABLED ?? "(not set)"),
      reason: "MCP_ENABLED is not set to 'true'. Set MCP_ENABLED=true on Railway to enable scanning.",
    });
    // refreshState stays idle — skipped is not a failure.
    return;
  }

  // ── Gate 2: In-process guard ─────────────────────────────────────────────
  if (engineRunning) {
    structuredLog("info", {
      event: "opportunity_scan_skipped_disabled",
      scanId,
      trigger,
      gate: "in_process_guard",
      reason: "Another scan is already running in this process.",
    });
    return;
  }

  refreshState = { status: "running", attemptedAt, errorSummary: null };
  engineRunning = true;
  const startedAt = new Date();
  const started = Date.now();

  // ── Gate 3: Advisory lock ─────────────────────────────────────────────────
  let locked = false;
  try {
    locked = await tryAcquireLock();
  } catch (err: any) {
    const errorSummary = String(err?.message ?? err).slice(0, 200);
    structuredLog("warn", {
      event: "opportunity_scan_skipped_locked",
      scanId,
      trigger,
      gate: "advisory_lock",
      reason: "Lock acquisition threw an error.",
      error: errorSummary,
    });
    refreshState = { status: "idle", attemptedAt, errorSummary: null };
    engineRunning = false;
    return;
  }

  if (!locked) {
    structuredLog("info", {
      event: "opportunity_scan_skipped_locked",
      scanId,
      trigger,
      gate: "advisory_lock",
      reason: "Lock held by another Railway instance; skipping this cycle.",
    });
    refreshState = { status: "idle", attemptedAt, errorSummary: null };
    engineRunning = false;
    return;
  }

  // ── Lock acquired ─────────────────────────────────────────────────────────
  structuredLog("info", {
    event: "opportunity_scan_lock_acquired",
    scanId,
    trigger,
    lockKey: OPPORTUNITY_SCAN_LOCK_KEY,
  });

  structuredLog("info", {
    event: "opportunity_scan_started",
    scanId,
    trigger,
    scannerVersion: SCANNER_VERSION,
    timestamp: new Date().toISOString(),
  });

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

    // Partition candidates into growth vs income.
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

    // ── Validate before persistence ──────────────────────────────────────────

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
        throw Object.assign(
          new Error(`Count field ${k} is not a finite non-negative integer: ${v}`),
          { code: "INVALID_COUNT" },
        );
      }
    }

    // 4. Classify outcome
    const status = classifyOutcome(
      search.qualifiedCount,
      search.watchCandidates.length,
      search.unavailableCount ?? 0,
      search.warnings,
    );

    // ── Persist ──────────────────────────────────────────────────────────────
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
      structuredLog("warn", {
        event: "opportunity_snapshot_persistence_failed",
        scanId,
        error: String(err?.message ?? err).slice(0, 200),
      });
      refreshState = {
        status: "failed",
        attemptedAt,
        errorSummary: "Scan completed but persistence failed.",
      };
      return;
    }

    // ── Update in-memory snapshot (only after successful persistence) ─────────
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

    structuredLog("info", {
      event: logEvent,
      scanId,
      trigger,
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
    });

    structuredLog("info", {
      event: "opportunity_snapshot_persisted",
      scanId,
      id: snapshotId,
      status,
    });

    // Retention cleanup — non-blocking, failure does not invalidate the scan.
    void deleteExpiredSnapshots()
      .then(({ validDeleted, failedDeleted }) => {
        if (validDeleted > 0 || failedDeleted > 0) {
          structuredLog("info", {
            event: "opportunity_snapshot_retention_completed",
            validDeleted,
            failedDeleted,
          });
        }
      })
      .catch((err: any) => {
        structuredLog("warn", {
          event: "opportunity_snapshot_retention_failed",
          error: String(err?.message ?? err).slice(0, 200),
        });
      });
  } catch (err: any) {
    const durationMs = Date.now() - started;
    const errorCode = (err as any).code ?? "SCAN_ERROR";
    const errorSummary = String(err?.message ?? err).slice(0, 500);

    structuredLog("warn", {
      event: "opportunity_scan_failed",
      scanId,
      trigger,
      durationMs,
      errorCode,
      error: errorSummary,
      scannerVersion: SCANNER_VERSION,
    });

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
      structuredLog("warn", {
        event: "opportunity_snapshot_persistence_failed",
        scanId,
        context: "failed_attempt",
        error: String(persistErr?.message ?? persistErr).slice(0, 200),
      });
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
      structuredLog("warn", {
        event: "opportunity_scan_lock_release_failed",
        scanId,
        error: String(err?.message ?? err).slice(0, 200),
      });
    }
    engineRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/**
 * Initialize and schedule the opportunity engine:
 *   1. Load latest valid snapshot from PostgreSQL (startup-load events emitted)
 *   2. Fire the initial scan immediately — non-blocking, with a terminal catch
 *      so unhandled rejections are impossible
 *   3. Schedule recurring refreshes per OPPORTUNITY_SCAN_INTERVAL_MINUTES
 *
 * Call once from server startup. Never blocks startup or dashboard load.
 */
export function scheduleOpportunityEngine(): void {
  const intervalMs = getScanIntervalMs();
  const intervalMinutes = Math.round(intervalMs / 60_000);

  // Load from PostgreSQL, then kick off first scan — both non-blocking.
  // The outer catch is belt-and-suspenders: runOpportunityEngine() never
  // rejects, but we guard against any unexpected runtime failure.
  void initOpportunityEngine()
    .then(() => {
      void runOpportunityEngine("startup").catch((err: any) => {
        structuredLog("warn", {
          event: "opportunity_scan_failed",
          scanId: makeScanId(),
          trigger: "startup",
          errorCode: "UNHANDLED_ERROR",
          error: String(err?.message ?? err).slice(0, 500),
        });
      });
    })
    .catch((err: any) => {
      // initOpportunityEngine should never reject, but guard defensively.
      structuredLog("warn", {
        event: "opportunity_snapshot_load_failed",
        error: String(err?.message ?? err).slice(0, 200),
        detail: "initOpportunityEngine threw unexpectedly; initial scan will still be attempted.",
      });
      void runOpportunityEngine("startup").catch((err2: any) => {
        structuredLog("warn", {
          event: "opportunity_scan_failed",
          scanId: makeScanId(),
          trigger: "startup",
          errorCode: "UNHANDLED_ERROR",
          error: String(err2?.message ?? err2).slice(0, 500),
        });
      });
    });

  // Recurring interval.
  function scheduleNext() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      await runOpportunityEngine("interval");
      scheduleNext();
    }, intervalMs);
    if (refreshTimer && typeof (refreshTimer as any).unref === "function") {
      (refreshTimer as any).unref();
    }
  }
  scheduleNext();

  structuredLog("info", {
    event: "opportunity_engine_scheduled",
    intervalMinutes,
    scannerVersion: SCANNER_VERSION,
  });
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
