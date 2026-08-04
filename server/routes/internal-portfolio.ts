// Internal service-to-service portfolio data API (backend-to-MCP, Sprint 4D).
//
//   GET /api/internal/portfolio/context?symbol=NVDA&maxRisk=500
//
// Trust model: the external vcp-trader-mcp service calls this route with:
//   1. Authorization: Bearer <VCP_INTERNAL_API_KEY>  — proves our MCP
//   2. X-Portfolio-Context: <opaque token>            — identifies the user
//
// Security guarantees:
// - Broker OAuth tokens, account numbers, user IDs NEVER leave this process.
// - Responses contain only safe portfolio-awareness fields (spec §5).
// - Context tokens are resolved via server/services/portfolio-context.ts:
//   opaque, 5-min TTL, hash-stored. Expired/unknown → 401 CONTEXT_INVALID.
// - No raw equity/buyingPower numbers in responses — only derived labels.
// - Concentration pct is rounded to one decimal; no account ID is present.
// - Nothing secret is logged: no context tokens, no broker tokens, no IDs.

import type { Express, Request, Response } from "express";
import { internalApiKeyAuth } from "./internal-market";
import { resolvePortfolioContext } from "../services/portfolio-context";
import type { NormalizedAccount, NormalizedPosition } from "../broker/types";

function err(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

// ---------------------------------------------------------------------------
// Safe portfolio-awareness types (spec §5 — no account IDs, no raw balances)
// ---------------------------------------------------------------------------

export interface SafePortfolioAwareness {
  /** ISO timestamp when positions/accounts were fetched. */
  contextFreshness: string;
  /** Non-null only when the user already holds the requested symbol. */
  existingPosition?: {
    shares: number;
    unrealizedPnl: number;
  };
  /** Explicit share count (same as existingPosition.shares, for MCP convenience). */
  verifiedShares?: number;
  /** True when the user already holds the requested symbol. */
  duplicateExposure?: boolean;
  /** Portfolio-concentration of this symbol (if equity data available). */
  concentrationWarning?: {
    /** Percentage of total equity, rounded to 1 decimal. */
    pct: number;
    level: "normal" | "elevated" | "high";
  };
  /** Whether total buying power appears sufficient for the estimated trade risk. */
  cashSufficiency?: "verified" | "not_verified" | "insufficient" | "unknown";
  /** Whether buying power is sufficient for the estimated trade risk. */
  buyingPowerSufficiency?: "sufficient" | "insufficient" | "unknown";
  /** Descriptive note about any existing option exposure on this symbol. */
  existingOptionExposure?: string | null;
  /** Sizing note when position already exists (e.g. "consider reducing size"). */
  sizingAdjustment?: string | null;
}

// ---------------------------------------------------------------------------
// Pure portfolio-awareness computation (exported for route handler + tests)
// ---------------------------------------------------------------------------

/** Compute safe portfolio-awareness fields from broker data.
 *
 *  Pure function — never logs, never throws on bad data, never includes
 *  account IDs, raw balances, or credentials in the output. */
export function computePortfolioAwareness(
  symbol: string | undefined,
  positions: NormalizedPosition[],
  accounts: NormalizedAccount[],
  opts: { maxRisk?: number } = {},
): SafePortfolioAwareness {
  const sym = symbol?.toUpperCase();
  const now = new Date().toISOString();

  // Existing position for the requested symbol
  const pos = sym ? positions.find((p) => p.symbol.toUpperCase() === sym) : undefined;
  const existingPosition =
    pos && pos.qty > 0
      ? { shares: Math.abs(pos.qty), unrealizedPnl: pos.unrealizedPnl }
      : undefined;
  const duplicateExposure = existingPosition != null ? true : undefined;
  const verifiedShares = existingPosition?.shares;

  // Concentration warning: current position value / total equity
  let concentrationWarning: SafePortfolioAwareness["concentrationWarning"];
  const totalEquity = accounts.reduce((sum, a) => sum + (a.equity ?? 0), 0);
  if (pos && pos.qty > 0 && pos.marketPrice > 0 && totalEquity > 0) {
    const posValue = pos.qty * pos.marketPrice;
    const pct = Math.round((posValue / totalEquity) * 1000) / 10; // 1 decimal
    const level: "normal" | "elevated" | "high" =
      pct >= 20 ? "high" : pct >= 10 ? "elevated" : "normal";
    concentrationWarning = { pct, level };
  }

  // Cash / buying-power sufficiency
  const totalBuyingPower = accounts.reduce((sum, a) => sum + (a.buyingPower ?? 0), 0);
  let cashSufficiency: SafePortfolioAwareness["cashSufficiency"] = "unknown";
  let buyingPowerSufficiency: SafePortfolioAwareness["buyingPowerSufficiency"] = "unknown";
  if (opts.maxRisk != null && opts.maxRisk > 0 && accounts.length > 0) {
    cashSufficiency = totalBuyingPower >= opts.maxRisk ? "verified" : "insufficient";
    buyingPowerSufficiency = totalBuyingPower >= opts.maxRisk ? "sufficient" : "insufficient";
  } else if (accounts.length > 0) {
    // No specific risk amount: show "not_verified" (have buying power, but no trade to check against)
    cashSufficiency = "not_verified";
    buyingPowerSufficiency = totalBuyingPower > 0 ? "sufficient" : "unknown";
  }

  // Sizing adjustment hint when duplicate exposure
  const sizingAdjustment =
    existingPosition
      ? `Already holding ${existingPosition.shares} shares — consider whether additional size fits your risk plan.`
      : null;

  return {
    contextFreshness: now,
    ...(existingPosition ? { existingPosition, verifiedShares, duplicateExposure } : {}),
    ...(concentrationWarning ? { concentrationWarning } : {}),
    cashSufficiency,
    buyingPowerSufficiency,
    existingOptionExposure: null, // reserved for future options-position detection
    sizingAdjustment,
  };
}

// ---------------------------------------------------------------------------
// Dependency injection (tests mock broker calls)
// ---------------------------------------------------------------------------

export interface InternalPortfolioDeps {
  resolveContext: (token: unknown) => string | null;
  getPositions: (userId: string) => Promise<NormalizedPosition[]>;
  getAccounts: (userId: string) => Promise<NormalizedAccount[]>;
}

async function defaultGetPositions(userId: string): Promise<NormalizedPosition[]> {
  const { getBrokerPositions } = await import("../broker");
  return getBrokerPositions(userId);
}

async function defaultGetAccounts(userId: string): Promise<NormalizedAccount[]> {
  const { getBrokerAccounts } = await import("../broker");
  return getBrokerAccounts(userId);
}

const defaultDeps: InternalPortfolioDeps = {
  resolveContext: (token) => resolvePortfolioContext(token),
  getPositions: defaultGetPositions,
  getAccounts: defaultGetAccounts,
};

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerInternalPortfolioRoutes(
  app: Express,
  deps: InternalPortfolioDeps = defaultDeps,
): void {
  /** Shared guard: internal API key + portfolio-context token → userId. */
  function requireContextUser(req: Request, res: Response): string | null {
    const token = req.headers["x-portfolio-context"];
    const userId = deps.resolveContext(typeof token === "string" ? token : undefined);
    if (!userId) {
      err(res, 401, "CONTEXT_INVALID", "Missing, invalid, or expired portfolio context token");
      return null;
    }
    return userId;
  }

  /**
   * GET /api/internal/portfolio/context
   *
   * Query params:
   *   symbol?  — ticker to check existing position for (e.g. NVDA)
   *   maxRisk? — estimated trade risk in dollars for sufficiency checks
   *
   * Returns: SafePortfolioAwareness (no account IDs, no raw balances).
   */
  app.get("/api/internal/portfolio/context", internalApiKeyAuth, async (req, res) => {
    const userId = requireContextUser(req, res);
    if (!userId) return;

    const symbol = typeof req.query.symbol === "string" ? req.query.symbol.trim().toUpperCase() : undefined;
    const maxRiskRaw = Number(req.query.maxRisk);
    const maxRisk = Number.isFinite(maxRiskRaw) && maxRiskRaw > 0 ? maxRiskRaw : undefined;

    const [posResult, acctResult] = await Promise.allSettled([
      deps.getPositions(userId),
      deps.getAccounts(userId),
    ]);

    // Only return 502 when BOTH broker calls fail (no data at all). When one
    // succeeds, we can still compute partial portfolio-awareness rather than
    // forcing MCP to treat an error as "no existing position".
    if (posResult.status === "rejected" && acctResult.status === "rejected") {
      return err(res, 502, "BROKER_ERROR", "Unable to fetch portfolio data");
    }

    const positions = posResult.status === "fulfilled" ? posResult.value : [];
    const accounts = acctResult.status === "fulfilled" ? acctResult.value : [];

    const awareness = computePortfolioAwareness(symbol, positions, accounts, { maxRisk });
    res.json(awareness);
  });
}
