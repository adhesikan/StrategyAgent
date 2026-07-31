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
