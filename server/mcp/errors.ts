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
    // Returned when the MCP service reports a stale/missing session that
    // VCP Trader must reinitialize before retrying (HTTP 404 +
    // "session not found" / "must re-initialize" body text).
    | "MCP_SESSION_INVALID"
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

// Matches MCP service messages that mean "this session no longer exists on the
// server — please create a new one and retry". Combined with an HTTP 404 in the
// error text this uniquely identifies a recoverable session-expired condition.
const SESSION_INVALID_RE =
  /session\s+not\s+found|must\s+re[-\s]?initializ|reinitializ|session\s+(is\s+)?(invalid|expired)/i;

/**
 * Returns true when `err` represents a recoverable MCP session-invalid
 * condition (HTTP 404 + documented session-not-found body text).
 *
 * Narrowly scoped: a plain 404 (unknown route, tool not found) does NOT
 * qualify — it must also contain the session-expired message text.
 */
export function isMcpSessionInvalid(err: unknown): boolean {
  if (err instanceof McpError) return err.code === "MCP_SESSION_INVALID";
  const raw = err instanceof Error ? err.message : String(err);
  const safe = raw.replace(/bearer\s+\S+/gi, "Bearer [redacted]");
  return /\b404\b/.test(safe) && SESSION_INVALID_RE.test(safe);
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
  // Session-invalid must be checked before the generic network fallback: the
  // MCP SDK wraps the 404 response in an Error but it is NOT a connection drop.
  if (/\b404\b/.test(safe) && SESSION_INVALID_RE.test(safe)) {
    return new McpError("MCP_SESSION_INVALID", "Market data session expired; reconnecting.", tool);
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network|ECONNRESET|socket/i.test(safe)) {
    return new McpError("MCP_UNAVAILABLE", "Live market data is temporarily unavailable.", tool);
  }
  return new McpError("MCP_TOOL_ERROR", "Market data is temporarily unavailable.", tool);
}
