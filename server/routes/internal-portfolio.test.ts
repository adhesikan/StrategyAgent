// Sprint 4D — internal portfolio endpoint + computePortfolioAwareness tests.
// Covers all spec §7 scenarios.
// Run: npx vitest run --root . server/routes/internal-portfolio.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import {
  computePortfolioAwareness,
  registerInternalPortfolioRoutes,
  type InternalPortfolioDeps,
} from "./internal-portfolio";
import {
  issuePortfolioContext,
  resolvePortfolioContext,
  _clearPortfolioContexts,
} from "../services/portfolio-context";
import type { NormalizedAccount, NormalizedPosition } from "../broker/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const KEY = "test-internal-key";
const USER = "user-42";

const ACCOUNTS_100K: NormalizedAccount[] = [
  { id: "acct-1", name: "Main", type: "margin", buyingPower: 50_000, equity: 100_000, currency: "USD" },
];

const POSITIONS_NVDA: NormalizedPosition[] = [
  { symbol: "NVDA", qty: 100, avgPrice: 450, marketPrice: 500, unrealizedPnl: 5_000 },
];

const POSITIONS_HEAVY: NormalizedPosition[] = [
  { symbol: "NVDA", qty: 300, avgPrice: 450, marketPrice: 500, unrealizedPnl: 15_000 },
];

// ---------------------------------------------------------------------------
// computePortfolioAwareness unit tests
// ---------------------------------------------------------------------------

describe("computePortfolioAwareness", () => {
  it("returns empty awareness when no positions and no accounts", () => {
    const result = computePortfolioAwareness("NVDA", [], []);
    expect(result.existingPosition).toBeUndefined();
    expect(result.duplicateExposure).toBeUndefined();
    expect(result.concentrationWarning).toBeUndefined();
    expect(result.cashSufficiency).toBe("unknown");
    expect(result.buyingPowerSufficiency).toBe("unknown");
    expect(typeof result.contextFreshness).toBe("string");
  });

  it("detects an existing position for the requested symbol", () => {
    const result = computePortfolioAwareness("NVDA", POSITIONS_NVDA, ACCOUNTS_100K);
    expect(result.existingPosition).toEqual({ shares: 100, unrealizedPnl: 5_000 });
    expect(result.verifiedShares).toBe(100);
    expect(result.duplicateExposure).toBe(true);
  });

  it("does not flag duplicate exposure for a different symbol", () => {
    const result = computePortfolioAwareness("AAPL", POSITIONS_NVDA, ACCOUNTS_100K);
    expect(result.existingPosition).toBeUndefined();
    expect(result.duplicateExposure).toBeUndefined();
  });

  it("computes concentration warning — normal level (<10%)", () => {
    const smallPos: NormalizedPosition[] = [
      { symbol: "NVDA", qty: 10, avgPrice: 450, marketPrice: 500, unrealizedPnl: 500 },
    ];
    const bigAcct: NormalizedAccount[] = [
      { id: "a", name: "Main", type: "margin", buyingPower: 1_000_000, equity: 1_000_000, currency: "USD" },
    ];
    const result = computePortfolioAwareness("NVDA", smallPos, bigAcct);
    // 10 * 500 = $5k / $1M = 0.5%
    expect(result.concentrationWarning).toBeDefined();
    expect(result.concentrationWarning!.level).toBe("normal");
  });

  it("computes concentration warning — elevated level (10–20%)", () => {
    const pos: NormalizedPosition[] = [
      { symbol: "SYM", qty: 100, avgPrice: 10, marketPrice: 100, unrealizedPnl: 9_000 },
    ];
    const acct: NormalizedAccount[] = [
      { id: "a", name: "Main", type: "margin", buyingPower: 50_000, equity: 90_000, currency: "USD" },
    ];
    const result = computePortfolioAwareness("SYM", pos, acct);
    // 100 * 100 = $10k / $90k ≈ 11.1% → elevated
    expect(result.concentrationWarning!.level).toBe("elevated");
    expect(result.concentrationWarning!.pct).toBeGreaterThan(10);
    expect(result.concentrationWarning!.pct).toBeLessThan(20);
  });

  it("computes concentration warning — high level (>20%)", () => {
    const result = computePortfolioAwareness("NVDA", POSITIONS_HEAVY, ACCOUNTS_100K);
    // 300 * 500 = $150k / $100k = 150% → high
    expect(result.concentrationWarning!.level).toBe("high");
  });

  it("verifies cash sufficiency when maxRisk is provided and buying power is enough", () => {
    const result = computePortfolioAwareness("NVDA", [], ACCOUNTS_100K, { maxRisk: 1_000 });
    expect(result.cashSufficiency).toBe("verified");
    expect(result.buyingPowerSufficiency).toBe("sufficient");
  });

  it("reports insufficient when buying power is below maxRisk", () => {
    const result = computePortfolioAwareness("NVDA", [], ACCOUNTS_100K, { maxRisk: 100_000 });
    expect(result.cashSufficiency).toBe("insufficient");
    expect(result.buyingPowerSufficiency).toBe("insufficient");
  });

  it("shows not_verified when accounts present but no maxRisk supplied", () => {
    const result = computePortfolioAwareness("NVDA", [], ACCOUNTS_100K);
    expect(result.cashSufficiency).toBe("not_verified");
    expect(result.buyingPowerSufficiency).toBe("sufficient");
  });

  it("includes a sizing adjustment hint when duplicate exposure detected", () => {
    const result = computePortfolioAwareness("NVDA", POSITIONS_NVDA, ACCOUNTS_100K);
    expect(result.sizingAdjustment).toContain("100 shares");
  });

  it("returns no sizing adjustment when no existing position", () => {
    const result = computePortfolioAwareness("AAPL", POSITIONS_NVDA, ACCOUNTS_100K);
    expect(result.sizingAdjustment).toBeNull();
  });

  it("never includes raw account IDs or equity/buyingPower dollar amounts in output", () => {
    const result = computePortfolioAwareness("NVDA", POSITIONS_NVDA, ACCOUNTS_100K);
    const json = JSON.stringify(result);
    // Account ID must never appear
    expect(json).not.toContain("acct-1");
    // Raw equity/buyingPower amounts must never appear as top-level fields
    expect(result).not.toHaveProperty("equity");
    expect(result).not.toHaveProperty("buyingPower");
  });

  it("handles symbol being undefined gracefully (market-wide mode)", () => {
    const result = computePortfolioAwareness(undefined, POSITIONS_NVDA, ACCOUNTS_100K);
    expect(result.existingPosition).toBeUndefined();
    expect(result.cashSufficiency).toBe("not_verified");
  });
});

// ---------------------------------------------------------------------------
// Internal portfolio HTTP endpoint tests
// ---------------------------------------------------------------------------

let server: Server;
let baseUrl: string;
let getPositionsCalls: string[];
let getAccountsCalls: string[];

function makeDeps(overrides: Partial<InternalPortfolioDeps> = {}): InternalPortfolioDeps {
  return {
    resolveContext: overrides.resolveContext ?? ((t) => resolvePortfolioContext(t)),
    getPositions: overrides.getPositions ?? (async (userId) => {
      getPositionsCalls.push(userId);
      return POSITIONS_NVDA;
    }),
    getAccounts: overrides.getAccounts ?? (async (userId) => {
      getAccountsCalls.push(userId);
      return ACCOUNTS_100K;
    }),
  };
}

async function startApp(deps: Partial<InternalPortfolioDeps> = {}) {
  const app = express();
  registerInternalPortfolioRoutes(app, makeDeps(deps));
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

function get(path: string, opts: { apiKey?: string | null; context?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (opts.apiKey !== null) headers.Authorization = `Bearer ${opts.apiKey ?? KEY}`;
  if (opts.context != null) headers["X-Portfolio-Context"] = opts.context;
  return fetch(`${baseUrl}${path}`, { headers });
}

beforeEach(async () => {
  process.env.VCP_INTERNAL_API_KEY = KEY;
  _clearPortfolioContexts();
  getPositionsCalls = [];
  getAccountsCalls = [];
});

afterEach(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("GET /api/internal/portfolio/context", () => {
  it("returns 401 when API key is missing", async () => {
    const { token } = issuePortfolioContext(USER);
    await startApp();
    const res = await get("/api/internal/portfolio/context?symbol=NVDA", {
      apiKey: null,
      context: token,
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when context token is invalid/expired", async () => {
    await startApp();
    const { token } = issuePortfolioContext(USER);
    const res = await get("/api/internal/portfolio/context?symbol=NVDA", {
      context: token + "-bad",
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("CONTEXT_INVALID");
  });

  it("returns portfolio awareness for a valid token + connected broker", async () => {
    await startApp();
    const { token } = issuePortfolioContext(USER);
    const res = await get("/api/internal/portfolio/context?symbol=NVDA", {
      context: token,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.existingPosition).toBeDefined();
    expect(body.existingPosition.shares).toBe(100);
    expect(body.duplicateExposure).toBe(true);
  });

  it("does not include account IDs or raw balances in response", async () => {
    await startApp();
    const { token } = issuePortfolioContext(USER);
    const res = await get("/api/internal/portfolio/context?symbol=NVDA", {
      context: token,
    });
    const body = await res.json();
    const json = JSON.stringify(body);
    expect(json).not.toContain("acct-1");
    expect(body).not.toHaveProperty("equity");
    expect(body).not.toHaveProperty("buyingPower");
  });

  it("gracefully returns awareness with unknown sufficiency when broker returns empty arrays", async () => {
    await startApp({
      getPositions: async () => [],
      getAccounts: async () => [],
    });
    const { token } = issuePortfolioContext(USER);
    const res = await get("/api/internal/portfolio/context?symbol=NVDA", {
      context: token,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.existingPosition).toBeUndefined();
    expect(body.cashSufficiency).toBe("unknown");
  });

  it("returns 502 when broker positions AND accounts both throw", async () => {
    await startApp({
      getPositions: async () => { throw new Error("broker down"); },
      getAccounts: async () => { throw new Error("broker down"); },
    });
    const { token } = issuePortfolioContext(USER);
    const res = await get("/api/internal/portfolio/context?symbol=NVDA", {
      context: token,
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("BROKER_ERROR");
  });

  it("passes maxRisk query param through to sufficiency computation", async () => {
    await startApp();
    const { token } = issuePortfolioContext(USER);
    // buyingPower = 50_000; maxRisk = 1_000 → verified/sufficient
    const res = await get("/api/internal/portfolio/context?maxRisk=1000", {
      context: token,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cashSufficiency).toBe("verified");
    expect(body.buyingPowerSufficiency).toBe("sufficient");
  });

  it("resolves the correct userId from the context token and calls broker with it", async () => {
    const resolvedCalls: string[] = [];
    await startApp({
      resolveContext: (t) => {
        const uid = resolvePortfolioContext(t);
        if (uid) resolvedCalls.push(uid);
        return uid;
      },
    });
    const { token } = issuePortfolioContext("user-resolved");
    const res = await get("/api/internal/portfolio/context", { context: token });
    expect(res.status).toBe(200);
    expect(resolvedCalls).toContain("user-resolved");
    expect(getPositionsCalls).toContain("user-resolved");
    expect(getAccountsCalls).toContain("user-resolved");
  });

  it("token never appears in response body (no context-token leakage)", async () => {
    await startApp();
    const { token } = issuePortfolioContext(USER);
    const res = await get("/api/internal/portfolio/context?symbol=NVDA", {
      context: token,
    });
    const body = await res.json();
    const json = JSON.stringify(body);
    expect(json).not.toContain(token);
    expect(json).not.toContain(USER);
  });
});
