// Research Save Handle — Sprint 5.4C
//
// Short-lived, user-bound, single-use handles for persisting research evidence.
//
// Design (spec §9):
//   - Opaque 256-bit random hex ID
//   - Stored in-process Map keyed by SHA-256 hash (same pattern as portfolio-context.ts)
//   - 10-minute TTL
//   - Bound to authenticated userId
//   - Single-use: marked consumed after first successful persistence
//   - Never exposed to OpenAI
//   - Contains no credentials or sensitive fields
//   - Periodic sweep removes expired entries

import crypto from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const RESEARCH_DOMAINS = [
  "SYMBOL_ANALYSIS",
  "TRADE_RESEARCH",
  "MARKET_OPPORTUNITY_SEARCH",
  "PORTFOLIO_GOAL_RESEARCH",
  "PORTFOLIO_IMPACT",
  "OPTIONS_RESEARCH",
] as const;

export type ResearchDomain = typeof RESEARCH_DOMAINS[number];

export interface ResearchEvidenceRecord {
  schemaVersion: "1.0";
  domain: ResearchDomain;
  requestId: string;
  conversationId?: string;
  parentRecordId?: string;
  symbol?: string;
  symbols?: string[];
  normalizedRequestSummary: string;
  verdict: string;
  status?: string;
  strategy?: string;
  strategyDisplayName?: string;
  direction?: string;
  instrument?: string;
  qualificationStatus?: string;
  confidence: "high" | "medium" | "low" | "none";
  dataQuality: {
    estimated?: boolean;
    simulated?: boolean;
    partial?: boolean;
    stale?: boolean;
  };
  reasons: string[];
  warnings: string[];
  watchConditions?: string[];
  sourceTools: string[];
  sourceTimestamps: string[];
  limitations: string[];
  domainSnapshot: Record<string, unknown>;
  generatedAt: string;
}

export interface ResearchSaveHandle {
  /** Opaque random handle ID returned to the frontend. */
  id: string;
  /** Authenticated user who may consume this handle. */
  userId: string;
  requestId: string;
  evidence: ResearchEvidenceRecord;
  domain: ResearchDomain;
  titleSuggestion: string;
  tagSuggestions: string[];
  expiresAt: Date;
  consumed: boolean;
}

/** Safe metadata returned to the frontend (spec §10). */
export interface ResearchSaveMetadata {
  available: true;
  handleId: string;
  domain: ResearchDomain;
  titleSuggestion: string;
  tagSuggestions: string[];
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Internal store (keyed by SHA-256 of the handle ID)
// ---------------------------------------------------------------------------

const TTL_MS = 10 * 60 * 1000; // 10 minutes

interface StoreEntry {
  handle: ResearchSaveHandle;
  expiresAt: number;
}

const store = new Map<string, StoreEntry>();

function hashId(id: string): string {
  return crypto.createHash("sha256").update(id).digest("hex");
}

/** Periodic sweep — removes expired entries. */
function sweep(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}
// Run sweep every 2 minutes
const sweepInterval = setInterval(sweep, 2 * 60 * 1000);
sweepInterval.unref?.(); // don't block process exit

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mint a new save handle for the given user + evidence.
 * Returns the full handle (used internally) and the safe metadata for the frontend.
 */
export function issueResearchSaveHandle(
  userId: string,
  evidence: ResearchEvidenceRecord,
  titleSuggestion: string,
  tagSuggestions: string[],
): { handle: ResearchSaveHandle; metadata: ResearchSaveMetadata } {
  sweep();
  const id = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TTL_MS);
  const handle: ResearchSaveHandle = {
    id,
    userId,
    requestId: evidence.requestId,
    evidence,
    domain: evidence.domain,
    titleSuggestion,
    tagSuggestions,
    expiresAt,
    consumed: false,
  };
  store.set(hashId(id), { handle, expiresAt: expiresAt.getTime() });
  const metadata: ResearchSaveMetadata = {
    available: true,
    handleId: id,
    domain: evidence.domain,
    titleSuggestion,
    tagSuggestions,
    expiresAt: expiresAt.toISOString(),
  };
  return { handle, metadata };
}

export type ResolveHandleError =
  | "NOT_FOUND"
  | "EXPIRED"
  | "CONSUMED"
  | "WRONG_USER";

/**
 * Resolve and consume a save handle.
 * Verifies userId ownership, TTL, and consumed state.
 * Single-use: marks the handle as consumed on success.
 */
export function resolveResearchSaveHandle(
  handleId: string,
  requestingUserId: string,
): { ok: true; handle: ResearchSaveHandle } | { ok: false; error: ResolveHandleError } {
  sweep();
  const key = hashId(handleId);
  const entry = store.get(key);
  if (!entry) return { ok: false, error: "NOT_FOUND" };
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return { ok: false, error: "EXPIRED" };
  }
  if (entry.handle.consumed) return { ok: false, error: "CONSUMED" };
  if (entry.handle.userId !== requestingUserId) return { ok: false, error: "WRONG_USER" };

  // Mark consumed (idempotent retry: once consumed, any retry returns CONSUMED)
  entry.handle = { ...entry.handle, consumed: true };
  store.set(key, entry);

  return { ok: true, handle: entry.handle };
}

/**
 * Check whether a handle exists and is still valid for the given user
 * without consuming it. Used for idempotency checks.
 */
export function peekResearchSaveHandle(
  handleId: string,
  requestingUserId: string,
): { valid: true } | { valid: false; reason: ResolveHandleError } {
  const key = hashId(handleId);
  const entry = store.get(key);
  if (!entry) return { valid: false, reason: "NOT_FOUND" };
  if (Date.now() > entry.expiresAt) return { valid: false, reason: "EXPIRED" };
  if (entry.handle.consumed) return { valid: false, reason: "CONSUMED" };
  if (entry.handle.userId !== requestingUserId) return { valid: false, reason: "WRONG_USER" };
  return { valid: true };
}

/** Count of active (non-expired) handles in the store. For tests/diagnostics only. */
export function activeHandleCount(): number {
  sweep();
  return store.size;
}

/** Clear all handles. Test helper only. */
export function _clearAllHandles(): void {
  store.clear();
}
