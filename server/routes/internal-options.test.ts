// Security + integration tests for the internal options API (backend-to-MCP).
// Run: npx vitest run --root . server/routes/internal-options.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import {
  registerInternalOptionsRoutes,
  capabilityForUser,
  normalizeContract,
  type InternalOptionsDeps,
} from "./internal-options";
import { issueOptionsContext, resolveOptionsContext, _clearOptionsContexts } from "../services/options-context";
import type { OptionChainContract } from "../broker/providers/tradier";

const KEY = "test-internal-key";
const USER = "user-abc";
const BROKER_ACCESS_TOKEN = "SUPER-SECRET-BROKER-ACCESS-TOKEN";
const BROKER_REFRESH_TOKEN = "SUPER-SECRET-REFRESH-TOKEN";

let server: Server;
let baseUrl: string;
let connection: { provider: string; isConnected: boolean } | null;
let chainCalls: Array<{ userId: string; symbol: string; expiration: string }>;
let expirationCalls: string[];

function contract(overrides: Partial<OptionChainContract> = {}): OptionChainContract {
  return {
    symbol: "NVDA260918C00360000",
    strike: 360,
    optionType: "call",
    expiration: "2026-09-18",
    bid: 12.1,
    ask: 12.5,
    last: 12.3,
    volume: 1500,
    openInterest: 9000,
    greeks: { delta: 0.52, gamma: 0.01, theta: -0.08, vega: 0.22, mid_iv: 0.41 },
    ...overrides,
  };
}

function deps(): InternalOptionsDeps {
  return {
    resolveContext: (t) => resolveOptionsContext(t),
    getBrokerConnection: async () => connection,
    getOptionExpirations: async (userId, symbol) => {
      expirationCalls.push(`${userId}:${symbol}`);
      return ["2026-08-21", "2026-09-18"];
    },
    getOptionChain: async (userId, symbol, expiration) => {
      chainCalls.push({ userId, symbol, expiration });
      // Simulate a raw broker payload that also carries fields our
      // normalizer must strip (account leakage canary).
      return [
        { ...contract(), accountId: "ACCT-123", accessToken: BROKER_ACCESS_TOKEN } as any,
        contract({ optionType: "put", symbol: "NVDA260918P00360000", greeks: undefined }),
      ];
    },
  };
}

async function startApp() {
  const app = express();
  registerInternalOptionsRoutes(app, deps());
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

function get(path: string, opts: { apiKey?: string | null; context?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (opts.apiKey !== null) headers.Authorization = `Bearer ${opts.apiKey ?? KEY}`;
  if (opts.context) headers["X-Options-Context"] = opts.context;
  return fetch(`${baseUrl}${path}`, { headers });
}

beforeEach(async () => {
  process.env.VCP_INTERNAL_API_KEY = KEY;
  _clearOptionsContexts();
  connection = { provider: "tradier", isConnected: true };
  chainCalls = [];
  expirationCalls = [];
  await startApp();
});

afterEach(async () => {
  delete process.env.VCP_INTERNAL_API_KEY;
  await new Promise((r) => server.close(r));
  vi.restoreAllMocks();
});

const ROUTES = [
  "/api/internal/options/capability",
  "/api/internal/options/expirations?symbol=NVDA",
  "/api/internal/options/chain?symbol=NVDA&expiration=2026-09-18",
];

describe("service auth (VCP_INTERNAL_API_KEY)", () => {
  it("401 without the internal API key on every route — even with a valid context", async () => {
    const { token } = issueOptionsContext(USER);
    for (const path of ROUTES) {
      const res = await get(path, { apiKey: null, context: token });
      expect(res.status).toBe(401);
    }
    expect(chainCalls).toHaveLength(0);
  });

  it("401 on a wrong internal API key", async () => {
    const { token } = issueOptionsContext(USER);
    const res = await get(ROUTES[2], { apiKey: "wrong-key", context: token });
    expect(res.status).toBe(401);
    expect(chainCalls).toHaveLength(0);
  });

  it("503 fail-closed when the internal API is not configured", async () => {
    delete process.env.VCP_INTERNAL_API_KEY;
    const { token } = issueOptionsContext(USER);
    const res = await get(ROUTES[0], { context: token });
    expect(res.status).toBe(503);
  });
});

describe("context token enforcement", () => {
  it("401 CONTEXT_INVALID without a context token — API key alone is NOT enough", async () => {
    for (const path of ROUTES) {
      const res = await get(path);
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("CONTEXT_INVALID");
    }
    expect(chainCalls).toHaveLength(0);
    expect(expirationCalls).toHaveLength(0);
  });

  it("401 on forged and expired tokens", async () => {
    const forged = "f".repeat(64);
    expect((await get(ROUTES[2], { context: forged })).status).toBe(401);

    const { token } = issueOptionsContext(USER, { ttlMs: 1000, now: Date.now() - 60_000 });
    expect((await get(ROUTES[2], { context: token })).status).toBe(401);
    expect(chainCalls).toHaveLength(0);
  });

  it("valid context resolves to the issuing user only", async () => {
    const { token } = issueOptionsContext(USER);
    const res = await get(ROUTES[2], { context: token });
    expect(res.status).toBe(200);
    expect(chainCalls).toEqual([{ userId: USER, symbol: "NVDA", expiration: "2026-09-18" }]);
  });
});

describe("capability status", () => {
  it("connected tradier → {liveOptionsAvailable:true, provider:'tradier'}", async () => {
    const { token } = issueOptionsContext(USER);
    const res = await get(ROUTES[0], { context: token });
    expect(await res.json()).toEqual({ liveOptionsAvailable: true, provider: "tradier" });
  });

  it("connected tradestation → provider tradestation", async () => {
    connection = { provider: "tradestation", isConnected: true };
    const { token } = issueOptionsContext(USER);
    expect(await (await get(ROUTES[0], { context: token })).json()).toEqual({
      liveOptionsAvailable: true,
      provider: "tradestation",
    });
  });

  it("no connection / disconnected / unsupported provider → {liveOptionsAvailable:false} with no provider leak", async () => {
    for (const c of [null, { provider: "tradier", isConnected: false }, { provider: "schwab", isConnected: true }]) {
      connection = c as any;
      const { token } = issueOptionsContext(USER);
      const body = await (await get(ROUTES[0], { context: token })).json();
      expect(body).toEqual({ liveOptionsAvailable: false });
    }
  });

  it("capabilityForUser unit behavior matches", async () => {
    expect(await capabilityForUser(USER, { getBrokerConnection: async () => ({ provider: "tradier", isConnected: true }) }))
      .toEqual({ liveOptionsAvailable: true, provider: "tradier" });
    expect(await capabilityForUser(USER, { getBrokerConnection: async () => null }))
      .toEqual({ liveOptionsAvailable: false });
  });
});

describe("chain + expirations data", () => {
  it("returns a normalized account-independent chain", async () => {
    const { token } = issueOptionsContext(USER);
    const res = await get(ROUTES[2], { context: token });
    const body = await res.json();
    expect(body.symbol).toBe("NVDA");
    expect(body.provider).toBe("tradier");
    expect(body.count).toBe(2);
    expect(body.contracts[0]).toEqual({
      contractSymbol: "NVDA260918C00360000",
      strike: 360,
      optionType: "call",
      expiration: "2026-09-18",
      bid: 12.1,
      ask: 12.5,
      last: 12.3,
      volume: 1500,
      openInterest: 9000,
      greeks: { delta: 0.52, gamma: 0.01, theta: -0.08, vega: 0.22, midIv: 0.41 },
    });
    expect(body.contracts[1].greeks).toBeNull();
  });

  it("NEVER leaks broker tokens, account ids, userId, positions, or orders", async () => {
    const { token } = issueOptionsContext(USER);
    for (const path of ROUTES) {
      const text = await (await get(path, { context: token })).text();
      expect(text).not.toContain(BROKER_ACCESS_TOKEN);
      expect(text).not.toContain(BROKER_REFRESH_TOKEN);
      expect(text).not.toContain("ACCT-123");
      expect(text).not.toContain(USER);
      expect(text).not.toMatch(/position|order|balance|account/i);
    }
  });

  it("409 NO_BROKER for chain/expirations when no options-capable broker", async () => {
    connection = null;
    const { token } = issueOptionsContext(USER);
    for (const path of [ROUTES[1], ROUTES[2]]) {
      const res = await get(path, { context: token });
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("NO_BROKER");
    }
    expect(chainCalls).toHaveLength(0);
  });

  it("validates symbol and expiration", async () => {
    const { token } = issueOptionsContext(USER);
    expect((await get("/api/internal/options/chain?symbol=&expiration=2026-09-18", { context: token })).status).toBe(400);
    expect((await get("/api/internal/options/chain?symbol=NVDA;DROP&expiration=2026-09-18", { context: token })).status).toBe(400);
    expect((await get("/api/internal/options/chain?symbol=NVDA&expiration=notadate", { context: token })).status).toBe(400);
    expect((await get("/api/internal/options/expirations?symbol=NV%20DA", { context: token })).status).toBe(400);
    expect(chainCalls).toHaveLength(0);
  });

  it("502 BROKER_ERROR without internal detail when the broker call throws", async () => {
    const app = express();
    registerInternalOptionsRoutes(app, {
      ...deps(),
      getOptionChain: async () => { throw new Error(`boom ${BROKER_ACCESS_TOKEN}`); },
    });
    const s: Server = await new Promise((r) => { const sv = app.listen(0, () => r(sv)); });
    const port = (s.address() as { port: number }).port;
    const { token } = issueOptionsContext(USER);
    const res = await fetch(`http://127.0.0.1:${port}/api/internal/options/chain?symbol=NVDA&expiration=2026-09-18`, {
      headers: { Authorization: `Bearer ${KEY}`, "X-Options-Context": token },
    });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(BROKER_ACCESS_TOKEN);
    await new Promise((r) => s.close(r));
  });
});

describe("source-level security boundaries", () => {
  it("module never touches decrypted broker credentials or order/position APIs", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./internal-options.ts", import.meta.url), "utf8");
    expect(src).not.toContain("getBrokerConnectionWithToken");
    expect(src).not.toMatch(/getPositions|getOrders|placeOrder|cancelOrder|refreshToken/);
    // never spreads raw broker contracts into a response
    expect(src).not.toMatch(/res\.json\([^)]*\.\.\./s);
  });

  it("normalizeContract whitelist-drops unknown fields", () => {
    const n = normalizeContract({ ...contract(), accountId: "ACCT-9", accessToken: "tok" } as any);
    expect(JSON.stringify(n)).not.toMatch(/ACCT-9|accessToken|accountId/);
  });
});
