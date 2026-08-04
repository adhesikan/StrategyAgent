// Normalized VCP-side MCP error shape. Raw MCP protocol errors are never
// surfaced to end users; they're logged (without credentials) and converted
// into this stable structure.

export interface McpNormalizedError {
  code:
    | "MCP_DISABLED"
    | "MCP_CONFIG_ERROR"
    | "MCP_UNAVAILABLE"
    | "MCP_TIMEOUT"
    | "MCP_AUTH_ERROR"
    | "MCP_TOOL_ERROR"
    | "MCP_TOOL_NOT_ALLOWED"
    // Local contract-adapter rejections (strategy-contract-adapter.ts) —
    // raised BEFORE any MCP call, never by the MCP service itself.
    | "UNSUPPORTED_STRATEGY_MAPPING"
    | "UNSUPPORTED_TIMEFRAME";
  tool?: string;
  message: string;
}

export class McpError extends Error {
  code: McpNormalizedError["code"];
  tool?: string;

  constructor(code: McpNormalizedError["code"], message: string, tool?: string) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.tool = tool;
  }

  toJSON(): McpNormalizedError {
    return { code: this.code, tool: this.tool, message: this.message };
  }
}

/** Convert an arbitrary thrown value into a safe, normalized McpError. */
export function normalizeMcpError(err: unknown, tool?: string): McpError {
  if (err instanceof McpError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  // Never propagate anything that could contain an Authorization header.
  const safe = raw.replace(/bearer\s+\S+/gi, "Bearer [redacted]");
  if (/timed?\s*out|timeout|abort/i.test(safe)) {
    return new McpError("MCP_TIMEOUT", "Live market data timed out. Please try again shortly.", tool);
  }
  if (/\b401\b|\b403\b|unauthorized|forbidden/i.test(safe)) {
    // Auth details are intentionally not echoed to callers.
    return new McpError("MCP_AUTH_ERROR", "Live market data is temporarily unavailable.", tool);
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network|ECONNRESET|socket/i.test(safe)) {
    return new McpError("MCP_UNAVAILABLE", "Live market data is temporarily unavailable.", tool);
  }
  return new McpError("MCP_TOOL_ERROR", "Market data is temporarily unavailable.", tool);
}
