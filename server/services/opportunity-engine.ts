// Opportunity Engine — Sprint 1 (Production-hardened + bounded)
//
// Background scanner that pre-computes stock opportunities and persists each
// result to PostgreSQL. On startup, the latest valid snapshot is loaded from
// the database so the dashboard can serve it immediately without waiting for
// a new MCP scan.
//
// Startup sequence:
//   1. initOpportunityEngine() — loads latest valid snapshot from PostgreSQL
//   2. initial scan fires immediately (fire-and-forget, terminal catch)
//   3. recurring interval registered for later scans
//
// Deadline: every scan is wrapped in a total deadline (OPPORTUNITY_SCAN_TIMEOUT_MS,
// default 90 s, min 30 s, max 300 s). A scan that exceeds the deadline emits
// exactly one terminal event (opportunity_scan_failed with code
// OPPORTUNITY_SCAN_TIMEOUT), saves a FAILED attempt, and releases the
// advisory lock. A late-completing MCP promise is discarded via a
// scan-generation token — it cannot overwrite the snapshot or re-emit events.
//
// Locking: PostgreSQL advisory lock prevents concurrent scans across Railway
// instances. Released in a finally block on every exit path.
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
import { writeOpportunityHistory } from "./opportunity-history-writer";

// ---------------------------------------------------------------------------
// Re-export the canonical snapshot type used by routes
// ---------------------------------------------------------------------------
export type { PersistedOpportunitySnapshot as OpportunitySnapshot };

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SCANNER_VERSION = "mcp-v1";
const OPPORTUNITY_SCAN_LOCK_KEY = 774_412_002;

/** Parse OPPORTUNITY_SCAN_INTERVAL_MINUTES with bounds (30–1440, default 240). */
function getScanIntervalMs(): number {
  const raw = parseInt(process.env.OPPORTUNITY_SCAN_INTERVAL_MINUTES ?? "240", 10);
  const minutes = Number.isFinite(raw) && raw >= 30 && raw <= 1440 ? raw : 240;
  return minutes * 60 * 1000;
}

/** Parse OPPORTUNITY_SCAN_TIMEOUT_MS with bounds (30_000–300_000, default 90_000). */
function getScanTimeoutMs(): number {
  const raw = parseInt(process.env.OPPORTUNITY_SCAN_TIMEOUT_MS ?? "90000", 10);
  if (!Number.isFinite(raw) || raw < 30_000 || raw > 300_000) return 90_000;
  return raw;
}

// Exported for tests and endpoint (freshness + timeout inspection).
export function getIntervalMs(): number {
  return getScanIntervalMs();
}

export function getTimeoutMs(): number {
  return getScanTimeoutMs();
}

// ---------------------------------------------------------------------------
// Scan trigger type
// ---------------------------------------------------------------------------

export type ScanTrigger = "startup" | "interval" | "manual";

// ---------------------------------------------------------------------------
// Structured log helper
//
// Uses process.stdout/stderr.write so output appears as a plain line in
// Railway logs regardless of JSON parsing — visible alongside all other
// structured events in the Railway log view.
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
// Forbidden-field scanner
// ---------------------------------------------------------------------------

const OPPORTUNITY_FORBIDDEN_FIELDS = new Set([
  "accessToken", "refreshToken", "sessionId", "authorization",
  "accountId", "accountNumber", "userId", "apiKey", "serviceToken",
  "rawProviderResponse", "rawProviderPayload",
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

// ---------------------------------------------------------------------------
// Scan-generation token
//
// Incremented at the start of each scan. Any async work (MCP call, persist)
// that completes AFTER a timeout checks this token before mutating shared
// state — a mismatch means the scan was superseded and the result is discarded.
// ---------------------------------------------------------------------------

let scanGeneration = 0;

export function getLatestSnapshot(): PersistedOpportunitySnapshot | null {
  return latestSnapshot;
}

export function getRefreshState(): RefreshState {
  return { ...refreshState };
}

// ---------------------------------------------------------------------------
// Advisory lock helpers
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
// Scan-ID generator
// ---------------------------------------------------------------------------

function makeScanId(): string {
  return `scan-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

// ---------------------------------------------------------------------------
// Startup: load latest valid snapshot from PostgreSQL
// ---------------------------------------------------------------------------

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
// Main scan — public entry point
//
// Never rejects. All exit paths emit exactly one terminal event.
// ---------------------------------------------------------------------------

export async function runOpportunityEngine(trigger: ScanTrigger = "interval"): Promise<void> {
  const scanId = makeScanId();
  const attemptedAt = new Date().toISOString();

  // Top-level safety net — runOpportunityEngine must NEVER reject.
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

  // ── Gate 0: triggered (always first) ───────────────────────────────────
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
  const myGeneration = ++scanGeneration;
  const startedAt = new Date();
  const started = Date.now();
  let lockAcquired = false;

  try {
    // ── Gate 3: Advisory lock ───────────────────────────────────────────────
    let locked = false;
    try {
      locked = await tryAcquireLock();
    } catch (err: any) {
      structuredLog("warn", {
        event: "opportunity_scan_skipped_locked",
        scanId,
        trigger,
        gate: "advisory_lock",
        reason: "Lock acquisition threw an error.",
        error: String(err?.message ?? err).slice(0, 200),
      });
      refreshState = { status: "idle", attemptedAt, errorSummary: null };
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
      return;
    }
    lockAcquired = true;

    structuredLog("info", {
      event: "opportunity_scan_lock_acquired",
      scanId,
      trigger,
      lockKey: OPPORTUNITY_SCAN_LOCK_KEY,
    });

    // ── Deadline setup ──────────────────────────────────────────────────────
    const timeoutMs = getScanTimeoutMs();
    structuredLog("info", {
      event: "opportunity_scan_timeout_scheduled",
      scanId,
      trigger,
      timeoutMs,
    });

    structuredLog("info", {
      event: "opportunity_scan_started",
      scanId,
      trigger,
      scannerVersion: SCANNER_VERSION,
      timeoutMs,
      timestamp: new Date().toISOString(),
    });

    // ── Bounded MCP + validate + persist chain ──────────────────────────────
    // Promise.race enforces the total scan deadline.
    // The winning branch determines whether we commit or abort.

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const deadlinePromise = new Promise<"SCAN_TIMEOUT">((resolve) => {
      timeoutHandle = setTimeout(() => resolve("SCAN_TIMEOUT"), timeoutMs);
    });

    const scanWorkPromise: Promise<"SCAN_DONE"> = (async (): Promise<"SCAN_DONE"> => {
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

      // Market regime — non-fatal
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
        /* non-fatal */
      }

      const completedAt = new Date();
      const durationMs = Date.now() - started;

      // Partition candidates
      const INCOME_RE = /income|covered|credit|spread|dividend|yield/i;
      const all = search.candidates;
      const topGrowth = all.filter((c) => !c.strategy || !INCOME_RE.test(c.strategy)).slice(0, 5);
      const topIncome = all.filter((c) => c.strategy && INCOME_RE.test(c.strategy)).slice(0, 5);
      const topWatchlist = search.watchCandidates.slice(0, 3);
      const approachingQualification = search.watchCandidates.slice(3, 8);

      const resultPayload = { marketRegime, topGrowth, topIncome, topWatchlist, approachingQualification };

      // ── Generation check before any state mutation ──────────────────────
      // If the deadline fired while the MCP call was in flight, myGeneration
      // will no longer match scanGeneration. Discard this late result.
      if (scanGeneration !== myGeneration) {
        structuredLog("info", {
          event: "opportunity_scan_late_result_discarded",
          scanId,
          trigger,
          phase: "post_mcp",
          elapsedMs: durationMs,
        });
        return "SCAN_DONE"; // swallowed — terminal event already emitted by timeout handler
      }

      // Validation
      const forbiddenScan = scanForForbiddenOpportunityFields(resultPayload);
      if (forbiddenScan.found) {
        throw Object.assign(
          new Error(`Forbidden field found in result payload at ${forbiddenScan.path}`),
          { code: "FORBIDDEN_FIELD" },
        );
      }
      if (scanForSimulatedData(resultPayload)) {
        throw Object.assign(new Error("result_payload contains simulated/mock data"), {
          code: "SIMULATED_DATA",
        });
      }
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
      const status = classifyOutcome(
        search.qualifiedCount,
        search.watchCandidates.length,
        search.unavailableCount ?? 0,
        search.warnings,
      );

      // Capture previous snapshot for lifecycle tracking — must be done BEFORE
      // saveSuccessfulSnapshot so we get the snapshot from the previous scan,
      // not the one we're about to write.
      const prevSnapshotForHistory = latestSnapshot;

      // Persist
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
      } catch (persistErr: any) {
        structuredLog("warn", {
          event: "opportunity_snapshot_persistence_failed",
          scanId,
          error: String(persistErr?.message ?? persistErr).slice(0, 200),
        });
        // Generation check — if we timed out before getting here, abort.
        if (scanGeneration !== myGeneration) {
          structuredLog("info", {
            event: "opportunity_scan_late_result_discarded",
            scanId,
            trigger,
            phase: "post_persist_failure",
          });
          return "SCAN_DONE";
        }
        refreshState = { status: "failed", attemptedAt, errorSummary: "Scan completed but persistence failed." };
        structuredLog("warn", {
          event: "opportunity_scan_failed",
          scanId,
          trigger,
          durationMs,
          errorCode: "PERSISTENCE_ERROR",
          scannerVersion: SCANNER_VERSION,
        });
        return "SCAN_DONE";
      }

      // ── Final generation check before committing to shared state ──────────
      if (scanGeneration !== myGeneration) {
        structuredLog("info", {
          event: "opportunity_scan_late_result_discarded",
          scanId,
          trigger,
          phase: "post_persist",
          elapsedMs: Date.now() - started,
        });
        return "SCAN_DONE";
      }

      // Update in-memory snapshot
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
        reviewedCount: counts.reviewedCount,
        qualifiedCount: counts.qualifiedCount,
        scannerVersion: SCANNER_VERSION,
      });
      structuredLog("info", { event: "opportunity_snapshot_persisted", scanId, id: snapshotId, status });

      // Retention — non-blocking
      void deleteExpiredSnapshots()
        .then(({ validDeleted, failedDeleted }) => {
          if (validDeleted > 0 || failedDeleted > 0) {
            structuredLog("info", { event: "opportunity_snapshot_retention_completed", validDeleted, failedDeleted });
          }
        })
        .catch((err: any) => {
          structuredLog("warn", {
            event: "opportunity_snapshot_retention_failed",
            error: String(err?.message ?? err).slice(0, 200),
          });
        });

      // Lifecycle history — non-blocking, never fatal.
      // Runs after the snapshot is persisted so snapshotId exists in DB.
      void writeOpportunityHistory({
        snapshotId,
        completedAt,
        marketRegime,
        topGrowth,
        topIncome,
        topWatchlist,
        approachingQualification,
        unavailableCount: search.unavailableCount ?? 0,
        previousSnapshot: prevSnapshotForHistory,
      }).catch((err: any) => {
        structuredLog("warn", {
          event: "opportunity_history_write_failed_engine",
          scanId,
          error: String(err?.message ?? err).slice(0, 200),
        });
      });

      return "SCAN_DONE";
    })().catch((err: any): "SCAN_DONE" => {
      // Catch within the scan-work chain — surface as a scan failure but only
      // if the generation is still ours (we may have already timed out).
      if (scanGeneration !== myGeneration) {
        structuredLog("info", {
          event: "opportunity_scan_late_result_discarded",
          scanId,
          trigger,
          phase: "scan_error_after_timeout",
        });
        return "SCAN_DONE";
      }
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
      // Record failed attempt
      void saveFailedAttempt({
        startedAt,
        completedAt: new Date(),
        errorCode,
        errorSummary,
        durationMs,
        requestSummary: { numberOfIdeas: 10, instrumentPreference: "stock", direction: "either" },
      }).catch((persistErr: any) => {
        structuredLog("warn", {
          event: "opportunity_snapshot_persistence_failed",
          scanId,
          context: "failed_attempt",
          error: String(persistErr?.message ?? persistErr).slice(0, 200),
        });
      });
      refreshState = { status: "failed", attemptedAt, errorSummary: "Scan failed. Previous snapshot remains available." };
      return "SCAN_DONE";
    });

    // ── Race ────────────────────────────────────────────────────────────────
    const winner = await Promise.race([scanWorkPromise, deadlinePromise]);

    // Clear deadline timer whether we timed out or completed normally.
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }

    if (winner === "SCAN_TIMEOUT") {
      // ── Timeout path ──────────────────────────────────────────────────────
      const elapsedMs = Date.now() - started;

      // Invalidate the generation so the late-completing scanWorkPromise
      // discards its result when it eventually settles.
      scanGeneration++;

      structuredLog("warn", {
        event: "opportunity_scan_timeout_triggered",
        scanId,
        trigger,
        timeoutMs,
        elapsedMs,
        phase: "scan_deadline_exceeded",
      });

      // Save a safe FAILED attempt record (non-blocking, non-fatal).
      void saveFailedAttempt({
        startedAt,
        completedAt: new Date(),
        errorCode: "OPPORTUNITY_SCAN_TIMEOUT",
        errorSummary: `Scan exceeded ${timeoutMs}ms deadline. Set OPPORTUNITY_SCAN_TIMEOUT_MS to adjust.`,
        durationMs: elapsedMs,
        requestSummary: { numberOfIdeas: 10, instrumentPreference: "stock", direction: "either" },
      }).catch((persistErr: any) => {
        structuredLog("warn", {
          event: "opportunity_snapshot_persistence_failed",
          scanId,
          context: "timeout_failed_attempt",
          error: String(persistErr?.message ?? persistErr).slice(0, 200),
        });
      });

      refreshState = {
        status: "failed",
        attemptedAt,
        errorSummary: "Scan timed out. Previous snapshot remains available.",
      };
      // latestSnapshot intentionally NOT updated — preserve the last valid one.

      structuredLog("warn", {
        event: "opportunity_scan_failed",
        scanId,
        trigger,
        durationMs: elapsedMs,
        errorCode: "OPPORTUNITY_SCAN_TIMEOUT",
        scannerVersion: SCANNER_VERSION,
      });

      // The scanWorkPromise is still in flight. When it eventually settles,
      // the generation check inside it will discard the late result.
      // We do NOT await it here — that would defeat the timeout.
    }
    // winner === "SCAN_DONE" → normal path, already handled inside scanWorkPromise

  } finally {
    if (lockAcquired) {
      try {
        await releaseLock();
        structuredLog("info", { event: "opportunity_scan_lock_released", scanId, trigger });
      } catch (err: any) {
        structuredLog("warn", {
          event: "opportunity_scan_lock_release_failed",
          scanId,
          error: String(err?.message ?? err).slice(0, 200),
        });
      }
    }
    engineRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export function scheduleOpportunityEngine(): void {
  const intervalMs = getScanIntervalMs();
  const intervalMinutes = Math.round(intervalMs / 60_000);

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
// Test helpers
// ---------------------------------------------------------------------------

/** @internal Reset all module-level state. Tests only. */
export function _resetEngineState(): void {
  latestSnapshot = null;
  engineRunning = false;
  refreshState = { status: "idle", attemptedAt: null, errorSummary: null };
  scanGeneration = 0;
  stopOpportunityEngine();
}
