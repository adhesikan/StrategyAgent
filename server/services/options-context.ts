// Short-lived opaque options-context tokens (backend-to-MCP options data).
//
// Design (spec option 1): when the Ask AI orchestrator runs for a broker-
// connected user, it mints an opaque context token bound to that userId. The
// token — never the user's broker OAuth tokens — travels to the MCP service
// as a tool argument. MCP presents it back to VCP Trader's internal options
// API (Bearer VCP_INTERNAL_API_KEY + X-Options-Context header), and VCP
// Trader resolves the user, refreshes broker tokens itself, and returns
// account-independent market data only.
//
// Security properties:
// - Tokens are 256-bit random values: unforgeable, no embedded claims, and
//   meaningless outside this process. Nothing to decode, nothing to leak.
// - Only the SHA-256 hash of each token is kept in memory, so a memory dump
//   or accidental console.log of the store never reveals a usable token.
// - Short TTL (default 5 minutes) + hard sweep; expired or unknown tokens
//   resolve to null. Revocation is immediate via revokeOptionsContext.
// - The store maps hash -> { userId, expiresAt } only. No broker tokens, no
//   session data, nothing account-related is ever stored here.
// - NEVER log a raw context token. Log at most tokenId (first 8 hash chars).

import { createHash, randomBytes } from "crypto";

export const OPTIONS_CONTEXT_TTL_MS = 5 * 60 * 1000;
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

/** Mint a new opaque context token for a user. Returns the raw token (hand it
 *  to the MCP tool call and nowhere else) and its absolute expiry. */
export function issueOptionsContext(
  userId: string,
  opts: { ttlMs?: number; now?: number } = {},
): { token: string; expiresAt: string } {
  if (!userId) throw new Error("issueOptionsContext requires a userId");
  const now = opts.now ?? Date.now();
  sweep(now);
  const ttl = Math.min(Math.max(opts.ttlMs ?? OPTIONS_CONTEXT_TTL_MS, 1_000), 15 * 60 * 1000);
  // Hard bound on store size (DoS protection): evict the oldest-expiring
  // entries rather than refusing service — tokens are short-lived anyway.
  if (store.size >= MAX_CONTEXTS) {
    const oldest = Array.from(store.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (const [key] of oldest.slice(0, Math.max(1, oldest.length - MAX_CONTEXTS + 1))) store.delete(key);
  }
  const token = randomBytes(32).toString("hex");
  const expiresAt = now + ttl;
  store.set(hashToken(token), { userId, expiresAt });
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

/** Resolve a presented context token to a userId, or null when the token is
 *  unknown, malformed, or expired. Constant-shape errors: callers cannot
 *  distinguish "never existed" from "expired" (both null). */
export function resolveOptionsContext(token: unknown, now: number = Date.now()): string | null {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) return null;
  const entry = store.get(hashToken(token));
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    store.delete(hashToken(token));
    return null;
  }
  return entry.userId;
}

/** Immediately invalidate a token (e.g. after the Ask request completes). */
export function revokeOptionsContext(token: string): void {
  store.delete(hashToken(token));
}

/** Test-only helper. */
export function _clearOptionsContexts(): void {
  store.clear();
}
