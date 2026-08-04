// Unit tests for the MCP integration layer (config validation, allowlist,
// typed wrappers, error normalization). MCP itself is mocked — no test
// depends on the deployed Railway MCP service.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ENV_KEYS = ["MCP_ENABLED", "MCP_BASE_URL", "MCP_SERVICE_TOKEN", "MCP_TIMEOUT_MS"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
  vi.doUnmock("./client");
  vi.doUnmock("@modelcontextprotocol/sdk/client/index.js");
  vi.doUnmock("@modelcontextprotocol/sdk/client/streamableHttp.js");
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("mcp config", () => {
  it("MCP disabled → config is null and app treats MCP as off", async () => {
    const { getMcpConfig, isMcpEnabled } = await import("./config");
    expect(isMcpEnabled()).toBe(false);
    expect(getMcpConfig()).toBeNull();
  });

  it("missing token with MCP_ENABLED=true produces a safe configuration error", async () => {
    process.env.MCP_ENABLED = "true";
    process.env.MCP_BASE_URL = "https://mcp.example.com";
    const { getMcpConfig, McpConfigError } = await import("./config");
    try {
      getMcpConfig();
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(McpConfigError);
      // The error message must never contain a token value.
      expect(err.message).not.toMatch(/bearer/i);
      expect(err.message).toContain("MCP_SERVICE_TOKEN");
    }
  });

  it("valid configuration parses with defaults and trailing-slash cleanup", async () => {
    process.env.MCP_ENABLED = "true";
    process.env.MCP_BASE_URL = "https://mcp.example.com/";
    process.env.MCP_SERVICE_TOKEN = "test-token";
    const { getMcpConfig } = await import("./config");
    const cfg = getMcpConfig()!;
    expect(cfg.endpointUrl).toBe("https://mcp.example.com/mcp");
    expect(cfg.timeoutMs).toBe(10_000);
  });

  it("rejects non-http MCP_BASE_URL", async () => {
    process.env.MCP_ENABLED = "true";
    process.env.MCP_BASE_URL = "ftp://mcp.example.com";
    process.env.MCP_SERVICE_TOKEN = "t";
    const { getMcpConfig, McpConfigError } = await import("./config");
    expect(() => getMcpConfig()).toThrow(McpConfigError);
  });
});

describe("error normalization", () => {
  it("timeout errors normalize to MCP_TIMEOUT", async () => {
    const { normalizeMcpError } = await import("./errors");
    const e = normalizeMcpError(new Error("Request timed out after 10000ms"), "get_quote");
    expect(e.code).toBe("MCP_TIMEOUT");
    expect(e.tool).toBe("get_quote");
  });

  it("auth failures normalize safely without echoing credentials", async () => {
    const { normalizeMcpError } = await import("./errors");
    const e = normalizeMcpError(new Error("HTTP 401 Unauthorized: Bearer super-secret-token rejected"));
    expect(e.code).toBe("MCP_AUTH_ERROR");
    expect(e.message).not.toContain("super-secret-token");
  });

  it("connection failures normalize to MCP_UNAVAILABLE", async () => {
    const { normalizeMcpError } = await import("./errors");
    expect(normalizeMcpError(new Error("fetch failed: ECONNREFUSED")).code).toBe("MCP_UNAVAILABLE");
  });
});

describe("tool allowlist and wrappers", () => {
  async function withMockedClient() {
    const callTool = vi.fn().mockResolvedValue({ ok: true });
    vi.doMock("./client", () => ({ mcpClient: { callTool } }));
    const tools = await import("./tools");
    return { tools, callTool };
  }

  it("unknown tool is rejected by the allowlist", async () => {
    const { tools, callTool } = await withMockedClient();
    await expect(tools.callAllowedTool("place_order", {})).rejects.toMatchObject({
      code: "MCP_TOOL_NOT_ALLOWED",
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("get_quote wrapper maps and uppercases the symbol", async () => {
    const { tools, callTool } = await withMockedClient();
    await tools.getQuote("mu");
    expect(callTool).toHaveBeenCalledWith("get_quote", { symbol: "MU" });
  });

  it("get_quote wrapper rejects garbage symbols", async () => {
    const { tools, callTool } = await withMockedClient();
    await expect(tools.getQuote("MU; DROP TABLE")).rejects.toMatchObject({ code: "MCP_TOOL_ERROR" });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("scan_vcp wrapper maps symbols and lookbackDays", async () => {
    const { tools, callTool } = await withMockedClient();
    await tools.scanVcp(["mu", "amd"], 120);
    expect(callTool).toHaveBeenCalledWith("scan_vcp", { symbols: ["MU", "AMD"], lookbackDays: 120 });
  });

  it("scan_vcp requires at least one symbol", async () => {
    const { tools } = await withMockedClient();
    await expect(tools.scanVcp([])).rejects.toMatchObject({ code: "MCP_TOOL_ERROR" });
  });

  it("AI cannot invoke get_positions (Phase 1) even though the wrapper exists", async () => {
    const { tools, callTool } = await withMockedClient();
    await expect(
      tools.executeAiToolCall("get_positions", { accountId: "someone-elses-account" }),
    ).rejects.toMatchObject({ code: "MCP_TOOL_NOT_ALLOWED" });
    expect(callTool).not.toHaveBeenCalled();
    // Backend wrapper takes no account-id from callers — args are fixed.
    await tools.getPositions();
    expect(callTool).toHaveBeenCalledWith("get_positions", {});
  });

  it("scan_strategy wrapper applies the contract adapter (registry id + '1d' → MCP slug + '1day')", async () => {
    const { tools, callTool } = await withMockedClient();
    await tools.scanStrategy("ba", "VCP_MULTIDAY", "1d");
    expect(callTool).toHaveBeenCalledWith("scan_strategy", {
      symbol: "BA",
      strategy: "power_breakout",
      timeframe: "1day",
    });
  });

  it("scan_strategy wrapper is idempotent for MCP slugs/timeframes", async () => {
    const { tools, callTool } = await withMockedClient();
    await tools.scanStrategy("BA", "vcp", "1day");
    expect(callTool).toHaveBeenCalledWith("scan_strategy", { symbol: "BA", strategy: "vcp", timeframe: "1day" });
  });

  it("scan_strategy wrapper rejects unknown strategy locally — MCP never called", async () => {
    const { tools, callTool } = await withMockedClient();
    await expect(tools.scanStrategy("BA", "NOT_A_STRATEGY", "1d")).rejects.toMatchObject({
      code: "UNSUPPORTED_STRATEGY_MAPPING",
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("scan_strategy wrapper rejects unsupported timeframe locally — MCP never called", async () => {
    const { tools, callTool } = await withMockedClient();
    await expect(tools.scanStrategy("BA", "VCP", "1w")).rejects.toMatchObject({
      code: "UNSUPPORTED_TIMEFRAME",
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("scan_strategy wrapper rejects blank/whitespace timeframe locally — MCP never called", async () => {
    const { tools, callTool } = await withMockedClient();
    await expect(tools.scanStrategy("BA", "VCP", "")).rejects.toMatchObject({ code: "UNSUPPORTED_TIMEFRAME" });
    await expect(tools.scanStrategy("BA", "VCP", "   ")).rejects.toMatchObject({ code: "UNSUPPORTED_TIMEFRAME" });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("scan_strategy wrapper omits timeframe only when undefined", async () => {
    const { tools, callTool } = await withMockedClient();
    await tools.scanStrategy("BA", "VCP");
    expect(callTool).toHaveBeenCalledWith("scan_strategy", { symbol: "BA", strategy: "vcp" });
  });

  it("AI tool calls route through typed wrappers (get_quote / scan_vcp)", async () => {
    const { tools, callTool } = await withMockedClient();
    await tools.executeAiToolCall("get_quote", { symbol: "mu" });
    expect(callTool).toHaveBeenCalledWith("get_quote", { symbol: "MU" });
    await tools.executeAiToolCall("scan_vcp", { symbols: ["MU"], lookbackDays: 120 });
    expect(callTool).toHaveBeenCalledWith("scan_vcp", { symbols: ["MU"], lookbackDays: 120 });
  });
});

describe("client lifecycle (mocked SDK)", () => {
  function mockSdk(behavior: { connectError?: Error; callResults?: any[] }) {
    let callIndex = 0;
    const clientInstance = {
      connect: vi.fn().mockImplementation(() => {
        if (behavior.connectError) return Promise.reject(behavior.connectError);
        return Promise.resolve();
      }),
      close: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [{ name: "get_quote" }, { name: "scan_vcp" }] }),
      callTool: vi.fn().mockImplementation(() => {
        const r = behavior.callResults?.[callIndex++] ?? { content: [{ type: "text", text: "{}" }] };
        if (r instanceof Error) return Promise.reject(r);
        return Promise.resolve(r);
      }),
      onclose: undefined,
    };
    vi.doMock("@modelcontextprotocol/sdk/client/index.js", () => ({
      Client: function MockClient() {
        return clientInstance;
      },
    }));
    vi.doMock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
      StreamableHTTPClientTransport: function MockTransport() {},
    }));
    return clientInstance;
  }

  function enableMcpEnv() {
    process.env.MCP_ENABLED = "true";
    process.env.MCP_BASE_URL = "https://mcp.example.com";
    process.env.MCP_SERVICE_TOKEN = "test-token";
  }

  it("connects with valid configuration and lists tools", async () => {
    enableMcpEnv();
    const inst = mockSdk({});
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    const tools = await c.listTools();
    expect(inst.connect).toHaveBeenCalledOnce();
    expect(tools).toEqual(["get_quote", "scan_vcp"]);
  });

  it("calling a tool while disabled fails safely with MCP_DISABLED", async () => {
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await expect(c.callTool("get_quote", { symbol: "MU" })).rejects.toMatchObject({
      code: "MCP_DISABLED",
    });
  });

  it("connect failure is normalized and does not crash", async () => {
    enableMcpEnv();
    mockSdk({ connectError: new Error("fetch failed: ECONNREFUSED") });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await expect(c.callTool("get_quote", { symbol: "MU" })).rejects.toMatchObject({
      code: "MCP_UNAVAILABLE",
    });
  });

  it("parses structured/text tool results", async () => {
    enableMcpEnv();
    mockSdk({
      callResults: [{ content: [{ type: "text", text: '{"symbol":"MU","last":123.45}' }] }],
    });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    const result = await c.callTool("get_quote", { symbol: "MU" });
    expect(result).toEqual({ symbol: "MU", last: 123.45 });
  });

  it("session failure triggers ONE bounded reconnect then surfaces the error", async () => {
    enableMcpEnv();
    const inst = mockSdk({
      callResults: [new Error("fetch failed: socket hang up"), new Error("fetch failed: socket hang up")],
    });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await expect(c.callTool("get_quote", { symbol: "MU" })).rejects.toMatchObject({
      code: "MCP_UNAVAILABLE",
    });
    // 2 attempts total (1 retry), not infinite.
    expect(inst.callTool).toHaveBeenCalledTimes(2);
    expect(c.getStats().reconnects).toBe(1);
  });

  it("tool-call logs never contain the service token", async () => {
    enableMcpEnv();
    mockSdk({ callResults: [{ content: [{ type: "text", text: "{}" }] }] });
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a) => logs.push(a.join(" ")));
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await c.callTool("get_quote", { symbol: "MU" });
    logSpy.mockRestore();
    warnSpy.mockRestore();
    expect(logs.join("\n")).not.toContain("test-token");
    expect(logs.join("\n")).not.toMatch(/authorization/i);
  });
});

// ---------------------------------------------------------------------------
// Per-call timeouts (recommend_trade_strategy timeout fix)
// ---------------------------------------------------------------------------

describe("per-call timeouts", () => {
  function enableMcpEnv() {
    process.env.MCP_ENABLED = "true";
    process.env.MCP_BASE_URL = "https://mcp.example.com";
    process.env.MCP_SERVICE_TOKEN = "test-token";
  }

  function mockSdkCapturingTimeout(behavior?: { callError?: Error; callErrors?: Error[] }) {
    const seenTimeouts: (number | undefined)[] = [];
    let i = 0;
    const inst = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn().mockImplementation((_req: any, _schema: any, opts: any) => {
        seenTimeouts.push(opts?.timeout);
        const err = behavior?.callErrors ? behavior.callErrors[i++] : behavior?.callError;
        if (err) return Promise.reject(err);
        return Promise.resolve({ content: [{ type: "text", text: "{}" }] });
      }),
      onclose: undefined,
    };
    vi.doMock("@modelcontextprotocol/sdk/client/index.js", () => ({
      Client: function MockClient() { return inst; },
    }));
    vi.doMock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
      StreamableHTTPClientTransport: function MockTransport() {},
    }));
    return { inst, seenTimeouts };
  }

  it("config: recommendation timeout defaults to 30s and is env-overridable; global stays 10s", async () => {
    enableMcpEnv();
    const { getMcpConfig } = await import("./config");
    const cfg = getMcpConfig()!;
    expect(cfg.timeoutMs).toBe(10_000);
    expect(cfg.recommendationTimeoutMs).toBe(30_000);
    process.env.MCP_RECOMMENDATION_TIMEOUT_MS = "45000";
    vi.resetModules();
    const { getMcpConfig: fresh } = await import("./config");
    expect(fresh()!.recommendationTimeoutMs).toBe(45_000);
    delete process.env.MCP_RECOMMENDATION_TIMEOUT_MS;
  });

  it("ordinary tools keep the 10s global default", async () => {
    enableMcpEnv();
    const { seenTimeouts } = mockSdkCapturingTimeout();
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await c.callTool("get_quote", { symbol: "MU" });
    expect(seenTimeouts).toEqual([10_000]);
  });

  it("explicit per-call timeout overrides the default", async () => {
    enableMcpEnv();
    const { seenTimeouts } = mockSdkCapturingTimeout();
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await c.callTool("recommend_trade_strategy", { symbol: "META" }, { timeoutMs: 30_000 });
    expect(seenTimeouts).toEqual([30_000]);
  });

  it("recommendTradeStrategy wrapper passes the 30s recommendation timeout and retryOnTimeout=false", async () => {
    enableMcpEnv();
    const callTool = vi.fn().mockResolvedValue({ recommendations: [] });
    vi.doMock("./client", () => ({ mcpClient: { callTool } }));
    const tools = await import("./tools");
    await tools.recommendTradeStrategy({ symbol: "META" });
    expect(callTool).toHaveBeenCalledWith(
      "recommend_trade_strategy",
      { symbol: "META" },
      { timeoutMs: 30_000, retryOnTimeout: false },
    );
  });

  it("timeout with retryOnTimeout=false is NOT retried — exactly one attempt, MCP_TIMEOUT surfaces", async () => {
    enableMcpEnv();
    const { inst } = mockSdkCapturingTimeout({ callError: new Error("Request timed out after 30000ms") });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await expect(
      c.callTool("recommend_trade_strategy", { symbol: "META" }, { timeoutMs: 30_000, retryOnTimeout: false }),
    ).rejects.toMatchObject({ code: "MCP_TIMEOUT" });
    expect(inst.callTool).toHaveBeenCalledTimes(1);
  });

  it("timeout on fast tools (default retryOnTimeout) still retries once, bounded at 2 attempts", async () => {
    enableMcpEnv();
    const { inst } = mockSdkCapturingTimeout({ callError: new Error("Request timed out after 10000ms") });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await expect(c.callTool("get_quote", { symbol: "MU" })).rejects.toMatchObject({ code: "MCP_TIMEOUT" });
    expect(inst.callTool).toHaveBeenCalledTimes(2);
  });

  it("session errors still get the bounded reconnect retry even with retryOnTimeout=false", async () => {
    enableMcpEnv();
    const { inst } = mockSdkCapturingTimeout({
      callErrors: [new Error("fetch failed: socket hang up")],
    });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    const result = await c.callTool("recommend_trade_strategy", { symbol: "META" }, { timeoutMs: 30_000, retryOnTimeout: false });
    expect(result).toEqual({});
    expect(inst.callTool).toHaveBeenCalledTimes(2);
    expect(c.getStats().reconnects).toBe(1);
  });

  it("provider 429 tool errors are MCP_TOOL_ERROR, never mislabeled as client timeout", async () => {
    enableMcpEnv();
    const inst429 = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn().mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "Upstream provider request failed (vcp:history, HTTP 429)." }],
      }),
      onclose: undefined,
    };
    vi.doMock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: function () { return inst429; } }));
    vi.doMock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: function () {} }));
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await expect(c.callTool("recommend_trade_strategy", { symbol: "META" }, { timeoutMs: 30_000, retryOnTimeout: false }))
      .rejects.toMatchObject({ code: "MCP_TOOL_ERROR" });
    expect(inst429.callTool).toHaveBeenCalledTimes(1); // deterministic error — no retry
  });

  it("call logs include tool, timeoutMs, attempt, durationMs, success, code — never the token", async () => {
    enableMcpEnv();
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a) => logs.push(a.join(" ")));
    mockSdkCapturingTimeout({ callError: new Error("Request timed out after 30000ms") });
    const { McpToolsClient } = await import("./client");
    const c = new McpToolsClient();
    await c.callTool("recommend_trade_strategy", {}, { timeoutMs: 30_000, retryOnTimeout: false }).catch(() => {});
    logSpy.mockRestore();
    warnSpy.mockRestore();
    const line = logs.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((o) => o?.event === "mcp_tool_call");
    expect(line).toMatchObject({ tool: "recommend_trade_strategy", timeoutMs: 30_000, attempt: 1, success: false, code: "MCP_TIMEOUT" });
    expect(typeof line.durationMs).toBe("number");
    expect(logs.join("\n")).not.toContain("test-token");
  });
});
