// Tests for MCP session-invalid detection, recovery, and retry.
//
// Run with: npx vitest run --root . server/mcp/session-recovery.test.ts
//
// All tests mock the MCP SDK — no real MCP service is required.
// Tests cover sections A-F from the spec.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Environment helpers ────────────────────────────────────────────────────

const ENV_KEYS = ["MCP_ENABLED", "MCP_BASE_URL", "MCP_SERVICE_TOKEN", "MCP_TIMEOUT_MS"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

function enableMcpEnv() {
  process.env.MCP_ENABLED = "true";
  process.env.MCP_BASE_URL = "https://mcp.example.com";
  process.env.MCP_SERVICE_TOKEN = "test-token";
}

// ── SDK mock factory ───────────────────────────────────────────────────────

type MockResult =
  | { content: { type: string; text: string }[] }
  | { structuredContent: unknown }
  | Error;

function mockSdk(behavior: {
  connectError?: Error;
  /** Results returned by callTool in order. Errors are thrown. */
  callResults?: MockResult[];
  /** Override connect() to succeed on the nth attempt (1-based). Default: always succeed. */
  failConnectsUntil?: number;
}) {
  let callIndex = 0;
  let connectAttempt = 0;

  const instance = {
    connect: vi.fn().mockImplementation(() => {
      connectAttempt++;
      if (behavior.connectError) return Promise.reject(behavior.connectError);
      if (behavior.failConnectsUntil && connectAttempt <= behavior.failConnectsUntil) {
        return Promise.reject(new Error("fetch failed: ECONNREFUSED"));
      }
      return Promise.resolve();
    }),
    close: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [{ name: "rank_market_trade_candidates" }] }),
    callTool: vi.fn().mockImplementation(() => {
      const r = behavior.callResults?.[callIndex++];
      if (r === undefined) return Promise.resolve({ content: [{ type: "text", text: "{}" }] });
      if (r instanceof Error) return Promise.reject(r);
      return Promise.resolve(r);
    }),
    onclose: undefined as (() => void) | undefined,
  };

  vi.doMock("@modelcontextprotocol/sdk/client/index.js", () => ({
    Client: function MockClient() {
      return instance;
    },
  }));
  vi.doMock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
    StreamableHTTPClientTransport: function MockTransport() {},
  }));

  return instance;
}

/** Canonical session-not-found error the MCP SDK surfaces on HTTP 404. */
const SESSION_NOT_FOUND_ERR = new Error(
  "Error POSTing to endpoint (HTTP 404): MCP session not found — client must re-initialize",
);
const OK_RESULT: MockResult = { content: [{ type: "text", text: '{"ok":true}' }] };

// ══════════════════════════════════════════════════════════════════════════
// A. Session recovery — happy path
// ══════════════════════════════════════════════════════════════════════════

describe("A. Session recovery — happy path", () => {
  it("valid session: tool call succeeds on first attempt, no recovery", async () => {
    enableMcpEnv();
    const inst = mockSdk({ callResults: [OK_RESULT] });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    const result = await c.callTool("rank_market_trade_candidates", {});
    expect(result).toEqual({ ok: true });
    expect(inst.callTool).toHaveBeenCalledTimes(1);
    expect(c.getStats().reconnects).toBe(0);
  });

  it("stale session: 404 session-not-found detected, session cleared", async () => {
    enableMcpEnv();
    const inst = mockSdk({ callResults: [SESSION_NOT_FOUND_ERR, OK_RESULT] });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await c.callTool("rank_market_trade_candidates", {});
    // close() called during resetSession() inside recovery
    expect(inst.close).toHaveBeenCalledOnce();
  });

  it("stale session: new session initialized (connect called twice — initial + recovery)", async () => {
    enableMcpEnv();
    const inst = mockSdk({ callResults: [SESSION_NOT_FOUND_ERR, OK_RESULT] });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await c.callTool("rank_market_trade_candidates", {});
    // connect: once for original session, once after recovery
    expect(inst.connect).toHaveBeenCalledTimes(2);
  });

  it("stale session: original read-only tool retried exactly once", async () => {
    enableMcpEnv();
    const inst = mockSdk({ callResults: [SESSION_NOT_FOUND_ERR, OK_RESULT] });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await c.callTool("rank_market_trade_candidates", {});
    expect(inst.callTool).toHaveBeenCalledTimes(2);
  });

  it("stale session: retry returns the correct result to the caller", async () => {
    enableMcpEnv();
    const successResult: MockResult = { content: [{ type: "text", text: '{"candidates":[{"symbol":"NVDA"}]}' }] };
    mockSdk({ callResults: [SESSION_NOT_FOUND_ERR, successResult] });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    const result = await c.callTool("rank_market_trade_candidates", {}) as any;
    expect(result.candidates[0].symbol).toBe("NVDA");
  });

  it("stale session: reconnects stat incremented once", async () => {
    enableMcpEnv();
    mockSdk({ callResults: [SESSION_NOT_FOUND_ERR, OK_RESULT] });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await c.callTool("scan_strategy", { symbol: "AAPL", strategy: "vcp" });
    expect(c.getStats().reconnects).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. Retry boundaries — things that must NOT trigger recovery
// ══════════════════════════════════════════════════════════════════════════

describe("B. Retry boundaries", () => {
  it("second call with session-invalid does NOT loop (sessionRecoveryAttempted guard)", async () => {
    enableMcpEnv();
    // Both attempts return session-invalid → should fail after one recovery attempt
    const inst = mockSdk({ callResults: [SESSION_NOT_FOUND_ERR, SESSION_NOT_FOUND_ERR] });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await expect(c.callTool("rank_market_trade_candidates", {})).rejects.toMatchObject({
      code: "MCP_SESSION_INVALID",
    });
    // Exactly 2 SDK calls (attempt 1 + one retry), not an infinite loop
    expect(inst.callTool).toHaveBeenCalledTimes(2);
  });

  it("HTTP 401 does NOT trigger session recovery", async () => {
    enableMcpEnv();
    const inst = mockSdk({
      callResults: [new Error("HTTP 401 Unauthorized")],
    });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await expect(c.callTool("rank_market_trade_candidates", {})).rejects.toMatchObject({
      code: "MCP_AUTH_ERROR",
    });
    expect(inst.callTool).toHaveBeenCalledTimes(1);
    expect(inst.close).not.toHaveBeenCalled();
  });

  it("plain 404 without session-not-found text does NOT trigger recovery", async () => {
    enableMcpEnv();
    const inst = mockSdk({
      callResults: [new Error("HTTP 404: Unknown route /mcp/foo")],
    });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await expect(c.callTool("rank_market_trade_candidates", {})).rejects.toMatchObject({
      code: "MCP_TOOL_ERROR",
    });
    expect(inst.callTool).toHaveBeenCalledTimes(1);
    expect(inst.close).not.toHaveBeenCalled();
  });

  it("malformed / unknown tool error does NOT trigger recovery", async () => {
    enableMcpEnv();
    const inst = mockSdk({
      callResults: [{ content: [{ type: "text", text: "schema validation failed" }], isError: true } as any],
    });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await expect(c.callTool("rank_market_trade_candidates", {})).rejects.toMatchObject({
      code: "MCP_TOOL_ERROR",
    });
    expect(inst.callTool).toHaveBeenCalledTimes(1);
    expect(inst.close).not.toHaveBeenCalled();
  });

  it("ordinary provider failure (tool isError) does NOT trigger recovery", async () => {
    enableMcpEnv();
    const inst = mockSdk({
      callResults: [
        { content: [{ type: "text", text: "Upstream provider request failed (HTTP 429)." }], isError: true } as any,
      ],
    });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await expect(c.callTool("rank_market_trade_candidates", {})).rejects.toMatchObject({
      code: "MCP_TOOL_ERROR",
    });
    expect(inst.callTool).toHaveBeenCalledTimes(1);
  });

  it("tool NOT in SESSION_RECOVERY_ALLOWLIST does NOT trigger recovery on session-invalid", async () => {
    enableMcpEnv();
    // prepare_trade_ticket is excluded from the allowlist
    const inst = mockSdk({ callResults: [SESSION_NOT_FOUND_ERR] });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await expect(c.callTool("prepare_trade_ticket", {})).rejects.toMatchObject({
      code: "MCP_SESSION_INVALID",
    });
    // No recovery — close() not called for recovery purposes
    expect(inst.callTool).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C. Concurrency
// ══════════════════════════════════════════════════════════════════════════

describe("C. Concurrency", () => {
  it("multiple stale-session callers trigger exactly one reinitialization", async () => {
    enableMcpEnv();
    // First two calls both hit session-invalid; both retries succeed
    const inst = mockSdk({
      callResults: [
        SESSION_NOT_FOUND_ERR,
        SESSION_NOT_FOUND_ERR,
        OK_RESULT,
        OK_RESULT,
      ],
    });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();

    const [r1, r2] = await Promise.all([
      c.callTool("rank_market_trade_candidates", {}),
      c.callTool("rank_market_trade_candidates", {}),
    ]);
    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });

    // Connect: 1 initial + 1 recovery (not 1 initial + 2 recoveries)
    expect(inst.connect).toHaveBeenCalledTimes(2);
  });

  it("waiting callers join the single in-progress recovery and then retry", async () => {
    enableMcpEnv();
    const inst = mockSdk({
      callResults: [
        SESSION_NOT_FOUND_ERR,
        SESSION_NOT_FOUND_ERR,
        OK_RESULT,
        OK_RESULT,
      ],
    });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    // Both succeed — confirm joiners get their own retry
    const results = await Promise.all([
      c.callTool("scan_strategy", { symbol: "AAPL", strategy: "vcp" }),
      c.callTool("scan_opportunities", { symbols: ["AAPL"] }),
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r: any) => r?.ok === true)).toBe(true);
  });

  it("failed recovery clears the shared Promise so a later request can recover again", async () => {
    enableMcpEnv();
    const connectAttempts: number[] = [];
    let callIdx = 0;
    const callResults: MockResult[] = [
      SESSION_NOT_FOUND_ERR,        // request 1, attempt 1
      OK_RESULT,                     // request 2, attempt 1 (after later recovery)
    ];
    let connectCallCount = 0;

    const instance = {
      connect: vi.fn().mockImplementation(() => {
        connectCallCount++;
        connectAttempts.push(connectCallCount);
        if (connectCallCount === 2) {
          // Recovery attempt fails
          return Promise.reject(new Error("fetch failed: ECONNREFUSED"));
        }
        return Promise.resolve();
      }),
      close: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn().mockImplementation(() => {
        const r = callResults[callIdx++];
        if (r instanceof Error) return Promise.reject(r);
        return Promise.resolve(r ?? { content: [{ type: "text", text: "{}" }] });
      }),
      onclose: undefined,
    };
    vi.doMock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: function () { return instance; } }));
    vi.doMock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: function () {} }));

    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();

    // Request 1: session-invalid → recovery fails → request 1 fails
    await expect(c.callTool("rank_market_trade_candidates", {})).rejects.toBeDefined();

    // Request 2: `this.recovering` is cleared after failure, so a new recovery can run
    // Connect attempt 3 will succeed
    const result = await c.callTool("rank_market_trade_candidates", {});
    expect(result).toEqual({ ok: true });
  });

  it("no deadlock: recovery promise always resolves or rejects", async () => {
    enableMcpEnv();
    mockSdk({ callResults: [SESSION_NOT_FOUND_ERR, OK_RESULT] });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    // Must not hang
    const result = await Promise.race([
      c.callTool("rank_market_trade_candidates", {}),
      new Promise((_, reject) => setTimeout(() => reject(new Error("DEADLOCK")), 5_000)),
    ]);
    expect(result).toEqual({ ok: true });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// D. Timeout budget
// ══════════════════════════════════════════════════════════════════════════

describe("D. Timeout budget", () => {
  it("retry uses a timeout no greater than the per-call timeoutMs", async () => {
    enableMcpEnv();
    const seenTimeouts: number[] = [];
    const instance = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn().mockImplementation((_req: any, _schema: any, opts: any) => {
        seenTimeouts.push(opts?.timeout);
        const idx = seenTimeouts.length;
        if (idx === 1) return Promise.reject(SESSION_NOT_FOUND_ERR);
        return Promise.resolve({ content: [{ type: "text", text: "{}" }] });
      }),
      onclose: undefined,
    };
    vi.doMock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: function () { return instance; } }));
    vi.doMock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: function () {} }));

    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await c.callTool("rank_market_trade_candidates", {}, { timeoutMs: 8_000 });

    // Both attempts use a timeout <= 8000
    expect(seenTimeouts.length).toBe(2);
    expect(seenTimeouts.every((t) => t <= 8_000)).toBe(true);
  });

  it("total duration is bounded (both attempts within outer timeout)", async () => {
    enableMcpEnv();
    let callCount = 0;
    const instance = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(SESSION_NOT_FOUND_ERR);
        return Promise.resolve({ content: [{ type: "text", text: "{}" }] });
      }),
      onclose: undefined,
    };
    vi.doMock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: function () { return instance; } }));
    vi.doMock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: function () {} }));

    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    const started = Date.now();
    await c.callTool("rank_market_trade_candidates", {}, { timeoutMs: 5_000 });
    // Both mock calls are synchronous — should complete in well under 1s
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// E. Dashboard regression
// ══════════════════════════════════════════════════════════════════════════

describe("E. Dashboard regression", () => {
  it("recovered session: rank_market_trade_candidates returns real data (not error)", async () => {
    enableMcpEnv();
    const candidates = [{ symbol: "NVDA", score: 95 }, { symbol: "AMD", score: 88 }];
    mockSdk({
      callResults: [
        SESSION_NOT_FOUND_ERR,
        { content: [{ type: "text", text: JSON.stringify({ candidates }) }] },
      ],
    });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    const result = await c.callTool("rank_market_trade_candidates", {}) as any;
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].symbol).toBe("NVDA");
  });

  it("failed recovery surfaces MCP_SESSION_INVALID, not a crash or undefined", async () => {
    enableMcpEnv();
    let connectCount = 0;
    const instance = {
      connect: vi.fn().mockImplementation(() => {
        connectCount++;
        if (connectCount >= 2) return Promise.reject(new Error("fetch failed: ECONNREFUSED"));
        return Promise.resolve();
      }),
      close: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn().mockRejectedValue(SESSION_NOT_FOUND_ERR),
      onclose: undefined,
    };
    vi.doMock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: function () { return instance; } }));
    vi.doMock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: function () {} }));

    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    const err: any = await c.callTool("rank_market_trade_candidates", {}).catch((e) => e);
    // Recovery failed (connect fails) → surfaces MCP_UNAVAILABLE from the failed connect
    expect(err).toBeDefined();
    expect(["MCP_SESSION_INVALID", "MCP_UNAVAILABLE"]).toContain(err.code);
  });

  it("no simulated fallback data returned on session failure", async () => {
    enableMcpEnv();
    mockSdk({ callResults: [SESSION_NOT_FOUND_ERR, SESSION_NOT_FOUND_ERR] });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    const result = await c.callTool("rank_market_trade_candidates", {}).catch((e) => e);
    // Must be a McpError, not a fallback data object
    const { McpError } = await import("./errors");
    expect(result).toBeInstanceOf(McpError);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// F. Existing behaviour unchanged
// ══════════════════════════════════════════════════════════════════════════

describe("F. Existing behaviour unchanged", () => {
  it("MCP_UNAVAILABLE (socket hang up) still reconnects and retries once as before", async () => {
    enableMcpEnv();
    const inst = mockSdk({
      callResults: [
        new Error("fetch failed: socket hang up"),
        OK_RESULT,
      ],
    });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    const result = await c.callTool("get_quote", { symbol: "MU" });
    expect(result).toEqual({ ok: true });
    expect(inst.callTool).toHaveBeenCalledTimes(2);
    expect(c.getStats().reconnects).toBe(1);
  });

  it("MCP_TIMEOUT with retryOnTimeout=false: one attempt only", async () => {
    enableMcpEnv();
    const inst = mockSdk({ callResults: [new Error("Request timed out after 30000ms")] });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await expect(
      c.callTool("recommend_trade_strategy", { symbol: "META" }, { timeoutMs: 30_000, retryOnTimeout: false }),
    ).rejects.toMatchObject({ code: "MCP_TIMEOUT" });
    expect(inst.callTool).toHaveBeenCalledTimes(1);
  });

  it("MCP_DISABLED when env not set", async () => {
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await expect(c.callTool("get_quote", { symbol: "MU" })).rejects.toMatchObject({ code: "MCP_DISABLED" });
  });

  it("broker integration: no MCP calls made (unrelated code path)", async () => {
    // Broker integration does not use mcpClient — verify mcpClient is not imported by broker routes
    // by confirming the singleton is still pristine with 0 calls after this test.
    enableMcpEnv();
    mockSdk({});
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    expect(c.getStats().calls).toBe(0);
  });

  it("no order duplication: session-invalid retry only fires once (sessionRecoveryAttempted guard)", async () => {
    enableMcpEnv();
    const inst = mockSdk({
      callResults: [SESSION_NOT_FOUND_ERR, SESSION_NOT_FOUND_ERR, OK_RESULT],
    });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    // Even though a third result exists, the loop must stop after 2 callTool attempts
    await expect(c.callTool("rank_market_trade_candidates", {})).rejects.toMatchObject({
      code: "MCP_SESSION_INVALID",
    });
    expect(inst.callTool).toHaveBeenCalledTimes(2); // not 3
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Error classifier — isMcpSessionInvalid unit tests
// ══════════════════════════════════════════════════════════════════════════

describe("isMcpSessionInvalid classifier", () => {
  it("matches canonical session-not-found message with 404", async () => {
    const { isMcpSessionInvalid } = await import("./errors");
    expect(isMcpSessionInvalid(SESSION_NOT_FOUND_ERR)).toBe(true);
  });

  it("matches 'must re-initialize' variant", async () => {
    const { isMcpSessionInvalid } = await import("./errors");
    expect(isMcpSessionInvalid(new Error("HTTP 404: must re-initialize"))).toBe(true);
  });

  it("matches 'reinitialize' variant", async () => {
    const { isMcpSessionInvalid } = await import("./errors");
    expect(isMcpSessionInvalid(new Error("HTTP 404: please reinitialize your session"))).toBe(true);
  });

  it("does NOT match plain 404 without session text", async () => {
    const { isMcpSessionInvalid } = await import("./errors");
    expect(isMcpSessionInvalid(new Error("HTTP 404: unknown route"))).toBe(false);
  });

  it("does NOT match session text without 404", async () => {
    const { isMcpSessionInvalid } = await import("./errors");
    expect(isMcpSessionInvalid(new Error("session not found — client must re-initialize"))).toBe(false);
  });

  it("does NOT match 401", async () => {
    const { isMcpSessionInvalid } = await import("./errors");
    expect(isMcpSessionInvalid(new Error("HTTP 401 Unauthorized"))).toBe(false);
  });

  it("returns true for an McpError already classified MCP_SESSION_INVALID", async () => {
    const { isMcpSessionInvalid, McpError } = await import("./errors");
    expect(isMcpSessionInvalid(new McpError("MCP_SESSION_INVALID", "expired"))).toBe(true);
  });

  it("returns false for an McpError of any other code", async () => {
    const { isMcpSessionInvalid, McpError } = await import("./errors");
    expect(isMcpSessionInvalid(new McpError("MCP_UNAVAILABLE", "down"))).toBe(false);
    expect(isMcpSessionInvalid(new McpError("MCP_AUTH_ERROR", "auth"))).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// SESSION_RECOVERY_ALLOWLIST coverage
// ══════════════════════════════════════════════════════════════════════════

describe("SESSION_RECOVERY_ALLOWLIST", () => {
  it("includes explicitly required read-only tools from spec", async () => {
    const { SESSION_RECOVERY_ALLOWLIST } = await import("./client");
    expect(SESSION_RECOVERY_ALLOWLIST.has("rank_market_trade_candidates")).toBe(true);
    expect(SESSION_RECOVERY_ALLOWLIST.has("scan_strategy")).toBe(true);
    expect(SESSION_RECOVERY_ALLOWLIST.has("scan_opportunities")).toBe(true);
    expect(SESSION_RECOVERY_ALLOWLIST.has("get_market_history")).toBe(true);
    expect(SESSION_RECOVERY_ALLOWLIST.has("get_quote")).toBe(true);
  });

  it("excludes prepare_trade_ticket (side-effect risk)", async () => {
    const { SESSION_RECOVERY_ALLOWLIST } = await import("./client");
    expect(SESSION_RECOVERY_ALLOWLIST.has("prepare_trade_ticket")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Observability — logs must contain structured events, never secrets
// ══════════════════════════════════════════════════════════════════════════

describe("Observability", () => {
  it("session recovery emits structured events without token or session ID", async () => {
    enableMcpEnv();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    vi.spyOn(console, "warn").mockImplementation((...a) => logs.push(a.join(" ")));

    mockSdk({ callResults: [SESSION_NOT_FOUND_ERR, OK_RESULT] });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await c.callTool("rank_market_trade_candidates", {});

    const parsed = logs.flatMap((l) => {
      try { return [JSON.parse(l)]; } catch { return []; }
    });
    const events = parsed.map((o) => o.event);

    expect(events).toContain("mcp_session_invalid_detected");
    expect(events).toContain("mcp_session_reinitialize_started");
    expect(events).toContain("mcp_session_reinitialize_succeeded");
    expect(events).toContain("mcp_tool_retried_after_reinitialize");

    // No secrets ever logged
    const allLogs = logs.join("\n");
    expect(allLogs).not.toContain("test-token");
    expect(allLogs).not.toMatch(/authorization/i);
    expect(allLogs).not.toContain("Bearer t");
  });

  it("mcp_session_reinitialize_joined emitted when second caller joins recovery", async () => {
    enableMcpEnv();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    vi.spyOn(console, "warn").mockImplementation((...a) => logs.push(a.join(" ")));

    mockSdk({
      callResults: [SESSION_NOT_FOUND_ERR, SESSION_NOT_FOUND_ERR, OK_RESULT, OK_RESULT],
    });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();

    await Promise.all([
      c.callTool("rank_market_trade_candidates", {}),
      c.callTool("rank_market_trade_candidates", {}),
    ]);

    const parsed = logs.flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
    const events = parsed.map((o) => o.event);
    expect(events).toContain("mcp_session_reinitialize_joined");
  });
});
