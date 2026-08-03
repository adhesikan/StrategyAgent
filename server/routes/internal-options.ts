// Internal service-to-service options data API (backend-to-MCP, Sprint 3).
//
//   GET /api/internal/options/capability
//   GET /api/internal/options/expirations?symbol=NVDA
//   GET /api/internal/options/chain?symbol=NVDA&expiration=2026-09-18
//
// Trust model (spec design #1): the external vcp-trader-mcp service calls
// these routes with TWO credentials:
//   1. Authorization: Bearer <VCP_INTERNAL_API_KEY> — proves the caller is
//      our own MCP service (same constant-time internalApiKeyAuth as the
//      internal scanner/market APIs).
//   2. X-Options-Context: <opaque token> — a short-lived token minted by the
//      Ask AI orchestrator for a specific authenticated user. It is the ONLY
//      way this API learns which user's broker to use.
//
// Security guarantees:
// - Broker OAuth tokens NEVER leave this process: routes resolve the user's
//   connection and call the existing broker adapters server-side. Responses
//   contain market data only.
// - No positions, orders, balances, account numbers, or userId in responses.
// - Context tokens are resolved via server/services/options-context.ts:
//   opaque, 5-minute TTL, hash-stored. Expired/unknown → 401 CONTEXT_INVALID.
// - Nothing secret is logged: no context tokens, no broker tokens.
// - Token refresh happens inside the existing broker layer
//   (getConnectionForUser → provider refresh) — this module never touches
//   refresh tokens.

import type { Express, Request, Response } from "express";
import { internalApiKeyAuth } from "./internal-market";
import { resolveOptionsContext } from "../services/options-context";
import {
  getOptionChain as brokerGetOptionChain,
  getOptionExpirations as brokerGetOptionExpirations,
} from "../broker";
import { storage } from "../storage";
import type { OptionChainContract } from "../broker/providers/tradier";

const SYMBOL_RE = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;
const EXPIRATION_RE = /^\d{4}-\d{2}-\d{2}$/;
const OPTIONS_PROVIDERS = new Set(["tradier", "tradestation"]);

function err(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

// ---------------------------------------------------------------------------
// Capability + normalization (exported for tests)
// ---------------------------------------------------------------------------

export type OptionsCapability =
  | { liveOptionsAvailable: true; provider: string }
  | { liveOptionsAvailable: false };

export interface NormalizedContract {
  contractSymbol: string;
  strike: number;
  optionType: "call" | "put";
  expiration: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  volume: number | null;
  openInterest: number | null;
  greeks: { delta: number; gamma: number; theta: number; vega: number; midIv: number } | null;
}

/** Whitelist-map a broker chain contract to account-independent market data.
 *  Explicit field mapping (never spread) so a provider adding account fields
 *  can never leak them through this API. */
export function normalizeContract(c: OptionChainContract): NormalizedContract {
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    contractSymbol: String(c.symbol ?? ""),
    strike: c.strike,
    optionType: c.optionType,
    expiration: c.expiration,
    bid: num(c.bid),
    ask: num(c.ask),
    last: num(c.last),
    volume: num(c.volume),
    openInterest: num(c.openInterest),
    greeks: c.greeks
      ? {
          delta: c.greeks.delta,
          gamma: c.greeks.gamma,
          theta: c.greeks.theta,
          vega: c.greeks.vega,
          midIv: c.greeks.mid_iv,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Dependency injection (tests mock these; production uses real broker layer)
// ---------------------------------------------------------------------------

export interface InternalOptionsDeps {
  resolveContext: (token: unknown) => string | null;
  getBrokerConnection: (userId: string) => Promise<{ provider: string; isConnected: boolean } | null | undefined>;
  getOptionExpirations: (userId: string, symbol: string) => Promise<string[]>;
  getOptionChain: (userId: string, symbol: string, expiration: string) => Promise<OptionChainContract[]>;
}

const defaultDeps: InternalOptionsDeps = {
  resolveContext: (token) => resolveOptionsContext(token),
  getBrokerConnection: async (userId) => {
    // Presence/provider only — deliberately NOT the WithToken variant; this
    // path never needs (and never sees) decrypted credentials.
    const conn = await storage.getBrokerConnection(userId);
    return conn ? { provider: conn.provider, isConnected: !!conn.isConnected } : null;
  },
  getOptionExpirations: (userId, symbol) => brokerGetOptionExpirations(userId, symbol),
  getOptionChain: (userId, symbol, expiration) => brokerGetOptionChain(userId, symbol, expiration),
};

export async function capabilityForUser(
  userId: string,
  deps: Pick<InternalOptionsDeps, "getBrokerConnection">,
): Promise<OptionsCapability> {
  const conn = await deps.getBrokerConnection(userId);
  if (conn && conn.isConnected && OPTIONS_PROVIDERS.has(conn.provider)) {
    return { liveOptionsAvailable: true, provider: conn.provider };
  }
  return { liveOptionsAvailable: false };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerInternalOptionsRoutes(app: Express, deps: InternalOptionsDeps = defaultDeps): void {
  // Shared per-request guard: internal API key (handled by internalApiKeyAuth
  // middleware) + options-context token → userId. Returns null after
  // responding when the context is missing/invalid/expired.
  function requireContextUser(req: Request, res: Response): string | null {
    const token = req.headers["x-options-context"];
    const userId = deps.resolveContext(typeof token === "string" ? token : undefined);
    if (!userId) {
      err(res, 401, "CONTEXT_INVALID", "Missing, invalid, or expired options context token");
      return null;
    }
    return userId;
  }

  app.get("/api/internal/options/capability", internalApiKeyAuth, async (req, res) => {
    const userId = requireContextUser(req, res);
    if (!userId) return;
    try {
      res.json(await capabilityForUser(userId, deps));
    } catch {
      err(res, 502, "BROKER_ERROR", "Unable to determine broker capability");
    }
  });

  app.get("/api/internal/options/expirations", internalApiKeyAuth, async (req, res) => {
    const userId = requireContextUser(req, res);
    if (!userId) return;
    const symbol = String(req.query.symbol ?? "").toUpperCase();
    if (!SYMBOL_RE.test(symbol)) return err(res, 400, "INVALID_SYMBOL", "symbol is required (e.g. NVDA)");
    try {
      const capability = await capabilityForUser(userId, deps);
      if (!capability.liveOptionsAvailable) {
        return err(res, 409, "NO_BROKER", "User has no connected options-capable broker");
      }
      const expirations = await deps.getOptionExpirations(userId, symbol);
      res.json({ symbol, provider: capability.provider, expirations, asOf: new Date().toISOString() });
    } catch {
      err(res, 502, "BROKER_ERROR", "Broker expirations request failed");
    }
  });

  app.get("/api/internal/options/chain", internalApiKeyAuth, async (req, res) => {
    const userId = requireContextUser(req, res);
    if (!userId) return;
    const symbol = String(req.query.symbol ?? "").toUpperCase();
    const expiration = String(req.query.expiration ?? "");
    if (!SYMBOL_RE.test(symbol)) return err(res, 400, "INVALID_SYMBOL", "symbol is required (e.g. NVDA)");
    if (!EXPIRATION_RE.test(expiration)) {
      return err(res, 400, "INVALID_EXPIRATION", "expiration is required as YYYY-MM-DD");
    }
    try {
      const capability = await capabilityForUser(userId, deps);
      if (!capability.liveOptionsAvailable) {
        return err(res, 409, "NO_BROKER", "User has no connected options-capable broker");
      }
      const contracts = await deps.getOptionChain(userId, symbol, expiration);
      res.json({
        symbol,
        expiration,
        provider: capability.provider,
        asOf: new Date().toISOString(),
        count: contracts.length,
        contracts: contracts.map(normalizeContract),
      });
    } catch {
      err(res, 502, "BROKER_ERROR", "Broker option chain request failed");
    }
  });
}
