// Short-lived opaque portfolio-context tokens (backend-to-MCP portfolio data).
//
// Design mirrors options-context.ts: when the Ask AI orchestrator runs for a
// broker-connected user, it mints an opaque token bound to that userId. The
// token — never broker OAuth tokens, account IDs, or raw positions — travels
// to the MCP service as a backend-controlled field. MCP presents it back to
// VCP Trader's internal portfolio API (Bearer VCP_INTERNAL_API_KEY +
// X-Portfolio-Context header), and VCP Trader resolves the user, fetches
// positions/accounts server-side, and returns account-independent safe fields.
//
// Security properties (identical to options-context.ts):
// - 256-bit random tokens: unforgeable, no embedded claims.
// - Only SHA-256(token) is stored — memory dump reveals nothing usable.
// - Default 5-minute TTL + hard sweep; expired/unknown tokens → null.
// - Store holds only hash → { userId, expiresAt }. No broker tokens, no
//   account IDs, no positions, no session data.
// - NEVER log a raw context token.

import { createHash, randomBytes } from "crypto";

export const PORTFOLIO_CONTEXT_TTL_MS = 5 * 60 * 1000;
const MAX_CONTEXTS = 5000;

interface ContextEntry {
  userId: string;
  expiresAt: number;
}

const store = new Map<string, ContextEntry>();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sweep(now: number): void {
  for (const [key, entry] of Array.from(store.entries())) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

/** Mint a new opaque portfolio context token for a user. Returns the raw token
 *  (hand it only to the MCP tool call) and its absolute expiry. */
export function issuePortfolioContext(
  userId: string,
  opts: { ttlMs?: number; now?: number } = {},
): { token: string; expiresAt: string } {
  if (!userId) throw new Error("issuePortfolioContext requires a userId");
  const now = opts.now ?? Date.now();
  sweep(now);
  const ttl = Math.min(
    Math.max(opts.ttlMs ?? PORTFOLIO_CONTEXT_TTL_MS, 1_000),
    15 * 60 * 1000,
  );
  if (store.size >= MAX_CONTEXTS) {
    const oldest = Array.from(store.entries()).sort(
      (a, b) => a[1].expiresAt - b[1].expiresAt,
    );
    for (const [key] of oldest.slice(0, Math.max(1, oldest.length - MAX_CONTEXTS + 1))) {
      store.delete(key);
    }
  }
  const token = randomBytes(32).toString("hex");
  const expiresAt = now + ttl;
  store.set(hashToken(token), { userId, expiresAt });
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

/** Resolve a presented context token → userId, or null when unknown/expired. */
export function resolvePortfolioContext(
  token: unknown,
  now: number = Date.now(),
): string | null {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) return null;
  const entry = store.get(hashToken(token));
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    store.delete(hashToken(token));
    return null;
  }
  return entry.userId;
}

/** Immediately invalidate a token (called after each Ask request completes). */
export function revokePortfolioContext(token: string): void {
  store.delete(hashToken(token));
}

/** Test-only helper. */
export function _clearPortfolioContexts(): void {
  store.clear();
}
