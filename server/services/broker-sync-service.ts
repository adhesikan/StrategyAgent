/**
 * Broker Synchronization Service — Sprint 2.4.2
 *
 * Pulls live holdings from a connected broker (Tradier / TradeStation),
 * normalises them through the canonical portfolio pipeline, and upserts
 * the result into portfolio_positions.
 *
 * Design rules:
 *  - Idempotent: running twice must not duplicate positions.
 *  - Never logs tokens, credentials, account numbers, or PII.
 *  - Uses existing getBrokerPositions() — no direct API calls here.
 *  - Concurrent sync per-portfolio is prevented; returns { alreadyRunning: true }
 *    so the route can return 409.
 *  - runBrokerSync(userId) is the scheduler-callable interface (Part 6).
 */

import { db } from "../db";
import { portfolios, portfolioPositions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getBrokerPositions } from "../broker/index";
import { getBrokerConnectionWithToken } from "../storage";
import { normalizePortfolioPositions, type RawRow } from "./portfolio-normalization";
import { markJobStarted, markJobCompleted, markJobFailed } from "./job-status-store";

// ---------------------------------------------------------------------------
// Per-portfolio sync state (in-memory, current session only)
// ---------------------------------------------------------------------------

export type BrokerSyncStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "needs_reauth";

export interface PortfolioSyncState {
  portfolioId:    string;
  provider:       string | null;
  status:         BrokerSyncStatus;
  startedAt:      string | null;
  completedAt:    string | null;
  durationMs:     number | null;
  importedCount:  number;
  updatedCount:   number;
  deletedCount:   number;
  lastError:      string | null;
  nextScheduledAt: string | null;
}

const syncStates = new Map<string, PortfolioSyncState>();
const runningSyncs = new Set<string>();

function defaultSyncState(portfolioId: string, provider?: string | null): PortfolioSyncState {
  return {
    portfolioId,
    provider:       provider ?? null,
    status:         "idle",
    startedAt:      null,
    completedAt:    null,
    durationMs:     null,
    importedCount:  0,
    updatedCount:   0,
    deletedCount:   0,
    lastError:      null,
    nextScheduledAt: null,
  };
}

export function getPortfolioSyncState(portfolioId: string): PortfolioSyncState {
  return syncStates.get(portfolioId) ?? defaultSyncState(portfolioId);
}

export function isPortfolioSyncRunning(portfolioId: string): boolean {
  return runningSyncs.has(portfolioId);
}

// ---------------------------------------------------------------------------
// Convert broker NormalizedPosition[] → normalizer RawRow[]
// ---------------------------------------------------------------------------

function positionsToRawRows(positions: Array<{
  symbol: string;
  qty: number;
  avgPrice: number;
  marketPrice: number;
  unrealizedPnl: number;
}>): RawRow[] {
  return positions.map(p => ({
    symbol:      p.symbol,
    quantity:    p.qty,
    "avg cost":  p.avgPrice > 0 ? p.avgPrice : null,
    "cost basis": (p.avgPrice > 0 && p.qty > 0) ? p.avgPrice * p.qty : null,
    currency:    "USD",
  }));
}

// ---------------------------------------------------------------------------
// Core sync function
// ---------------------------------------------------------------------------

export interface SyncResult {
  alreadyRunning: boolean;
  portfolioId?:   string;
  provider?:      string;
  importedCount?: number;
  updatedCount?:  number;
  deletedCount?:  number;
  durationMs?:    number;
  error?:         string;
  needsReauth?:   boolean;
}

export async function syncPortfolioFromBroker(
  portfolioId: string,
  userId: string,
): Promise<SyncResult> {
  // Concurrent-run guard
  if (runningSyncs.has(portfolioId)) {
    return { alreadyRunning: true };
  }

  runningSyncs.add(portfolioId);
  const startedAt = new Date();

  // Load portfolio and verify ownership
  const [portfolio] = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)));

  if (!portfolio) {
    runningSyncs.delete(portfolioId);
    return { alreadyRunning: false, error: "Portfolio not found or access denied" };
  }

  const provider = portfolio.sourceAccountId ?? "unknown";

  // Initialize sync state
  const state: PortfolioSyncState = {
    portfolioId,
    provider,
    status:         "running",
    startedAt:      startedAt.toISOString(),
    completedAt:    null,
    durationMs:     null,
    importedCount:  0,
    updatedCount:   0,
    deletedCount:   0,
    lastError:      null,
    nextScheduledAt: null,
  };
  syncStates.set(portfolioId, state);

  // Update job status store
  markJobStarted("broker_sync", { portfolioId, provider });

  // Structured log — Part 9 (no tokens/credentials/account numbers)
  console.log(JSON.stringify({
    event:       "broker_sync_started",
    portfolioId,
    provider,
    userId:      "[redacted]",
    timestamp:   startedAt.toISOString(),
  }));

  try {
    // Fetch live positions from broker (handles token refresh + caching)
    const brokerPositions = await getBrokerPositions(userId);

    // Convert to normalization input
    const rawRows = positionsToRawRows(brokerPositions);

    // Run canonical normalization pipeline
    const normalized = normalizePortfolioPositions(rawRows, "broker");

    // Count existing positions before replacement
    const existing = await db
      .select({ id: portfolioPositions.id })
      .from(portfolioPositions)
      .where(eq(portfolioPositions.portfolioId, portfolioId));
    const previousCount = existing.length;

    // Idempotent upsert: delete all → insert fresh
    await db.delete(portfolioPositions).where(eq(portfolioPositions.portfolioId, portfolioId));

    const positionRows = normalized.normalizedPositions.map(p => ({
      portfolioId,
      symbol:          p.symbol,
      quantity:        String(p.quantity),
      averageCost:     p.averageCost != null ? String(p.averageCost) : null,
      costBasis:       p.costBasis != null ? String(p.costBasis) : null,
      marketValue:     null,
      currency:        p.currency,
      sourceType:      "broker" as const,
      sourceReference: provider,
      importedAt:      new Date(),
      updatedAt:       new Date(),
    }));

    if (positionRows.length > 0) {
      await db.insert(portfolioPositions).values(positionRows);
    }

    // Update portfolio updatedAt
    await db
      .update(portfolios)
      .set({ updatedAt: new Date() })
      .where(eq(portfolios.id, portfolioId));

    const completedAt = new Date();
    const durationMs  = completedAt.getTime() - startedAt.getTime();
    const importedCount = normalized.normalizedPositions.length;
    const deletedCount  = Math.max(0, previousCount - importedCount);
    const updatedCount  = Math.min(previousCount, importedCount);

    // Update sync state
    const finalState: PortfolioSyncState = {
      ...state,
      status:        "completed",
      completedAt:   completedAt.toISOString(),
      durationMs,
      importedCount,
      updatedCount,
      deletedCount,
    };
    syncStates.set(portfolioId, finalState);

    markJobCompleted("broker_sync", importedCount, null, { portfolioId, provider, importedCount, durationMs });

    console.log(JSON.stringify({
      event:        "broker_sync_completed",
      portfolioId,
      provider,
      importedCount,
      updatedCount,
      deletedCount,
      durationMs,
      timestamp:    completedAt.toISOString(),
    }));

    return { alreadyRunning: false, portfolioId, provider, importedCount, updatedCount, deletedCount, durationMs };

  } catch (err: unknown) {
    const errorMsg = (err instanceof Error) ? err.message : String(err);
    const isReauth = /401|403|unauthorized|token.*expired|invalid.*token/i.test(errorMsg);

    const completedAt = new Date();
    const durationMs  = completedAt.getTime() - startedAt.getTime();

    const finalState: PortfolioSyncState = {
      ...state,
      status:      isReauth ? "needs_reauth" : "failed",
      completedAt: completedAt.toISOString(),
      durationMs,
      lastError:   errorMsg,
    };
    syncStates.set(portfolioId, finalState);

    markJobFailed("broker_sync", isReauth ? "NEEDS_REAUTH" : "SYNC_ERROR", errorMsg, { portfolioId, provider });

    console.log(JSON.stringify({
      event:       "broker_sync_failed",
      portfolioId,
      provider,
      errorCode:   isReauth ? "NEEDS_REAUTH" : "SYNC_ERROR",
      durationMs,
      timestamp:   completedAt.toISOString(),
    }));

    return { alreadyRunning: false, error: errorMsg, needsReauth: isReauth, portfolioId, provider, durationMs };

  } finally {
    runningSyncs.delete(portfolioId);
  }
}

// ---------------------------------------------------------------------------
// Part 6 — Scheduler-callable interface (not yet wired to a cron)
// ---------------------------------------------------------------------------

export async function runBrokerSync(userId: string): Promise<void> {
  // Find all broker-linked portfolios for this user
  const userPortfolios = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.userId, userId), eq(portfolios.sourceType, "broker")));

  for (const p of userPortfolios) {
    if (!runningSyncs.has(p.id)) {
      // Fire and don't await — each portfolio syncs independently
      syncPortfolioFromBroker(p.id, userId).catch((err: Error) => {
        console.error(`[BrokerSync] runBrokerSync error for portfolio ${p.id}:`, err.message);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Health snapshot for Platform Health card (Part 7)
// ---------------------------------------------------------------------------

export interface BrokerSyncHealthSnapshot {
  totalConnections:  number;
  healthyCount:      number;
  failedCount:       number;
  runningCount:      number;
  needsReauthCount:  number;
  lastSyncAt:        string | null;
  avgDurationMs:     number | null;
  pendingJobs:       number;
  lastError:         string | null;
}

export function getBrokerSyncHealth(): BrokerSyncHealthSnapshot {
  const states = Array.from(syncStates.values());
  const completed = states.filter(s => s.status === "completed");
  const failed    = states.filter(s => s.status === "failed");
  const running   = states.filter(s => s.status === "running");
  const reauth    = states.filter(s => s.status === "needs_reauth");

  const completedWithDuration = completed.filter(s => s.durationMs != null);
  const avgDurationMs = completedWithDuration.length > 0
    ? completedWithDuration.reduce((sum, s) => sum + (s.durationMs ?? 0), 0) / completedWithDuration.length
    : null;

  const allCompletedTimes = completed
    .map(s => s.completedAt)
    .filter(Boolean)
    .sort()
    .reverse();

  const lastError = failed.length > 0
    ? (failed.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0]?.lastError ?? null)
    : null;

  return {
    totalConnections: states.length,
    healthyCount:     completed.length,
    failedCount:      failed.length,
    runningCount:     running.length,
    needsReauthCount: reauth.length,
    lastSyncAt:       allCompletedTimes[0] ?? null,
    avgDurationMs:    avgDurationMs != null ? Math.round(avgDurationMs) : null,
    pendingJobs:      runningSyncs.size,
    lastError,
  };
}
