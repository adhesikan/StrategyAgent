// Backend-only MCP configuration. All values come from environment variables
// set on the deployment platform (Railway) or Replit Secrets:
//
//   MCP_ENABLED=true|false      feature flag / rollback switch
//   MCP_BASE_URL=https://...    base URL of the vcp-trader-mcp service
//                               (public Railway URL or private-network host)
//   MCP_SERVICE_TOKEN=...       bearer token — NEVER exposed to the client,
//                               NEVER logged, NEVER returned through an API
//   MCP_TIMEOUT_MS=10000        per-request timeout
//
// This module is imported only from server code. Do not import from client/.

export interface McpConfig {
  enabled: boolean;
  baseUrl: string;
  /** Full URL of the MCP endpoint (baseUrl + /mcp). */
  endpointUrl: string;
  token: string;
  timeoutMs: number;
}

export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpConfigError";
  }
}

export function isMcpEnabled(): boolean {
  return String(process.env.MCP_ENABLED ?? "").toLowerCase() === "true";
}

/**
 * Returns validated MCP configuration, or null when MCP is disabled.
 * Throws McpConfigError when MCP_ENABLED=true but required values are
 * missing — the error message never contains the token value.
 */
export function getMcpConfig(): McpConfig | null {
  if (!isMcpEnabled()) return null;

  const baseUrl = (process.env.MCP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const token = (process.env.MCP_SERVICE_TOKEN ?? "").trim();
  const timeoutMs = Number.parseInt(process.env.MCP_TIMEOUT_MS ?? "", 10);

  if (!baseUrl) {
    throw new McpConfigError("MCP_ENABLED is true but MCP_BASE_URL is not set.");
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new McpConfigError("MCP_BASE_URL must be an http(s) URL.");
  }
  if (!token) {
    throw new McpConfigError("MCP_ENABLED is true but MCP_SERVICE_TOKEN is not set.");
  }

  return {
    enabled: true,
    baseUrl,
    endpointUrl: `${baseUrl}/mcp`,
    token,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000,
  };
}
