// Centralized MCP client for the vcp-trader-mcp service (Streamable HTTP,
// stateful sessions, Bearer auth). This is the ONLY place in VCP Trader that
// speaks the MCP protocol. Everything else goes through the typed wrappers in
// ./tools.ts.
//
// Lifecycle:
//   - connects lazily on the first tool call
//   - reuses the session across calls
//   - reconnects (bounded backoff, no storms) when the session drops
//   - auto-recovers from MCP_SESSION_INVALID (Railway redeploy) with one retry,
//     for read-only tools in SESSION_RECOVERY_ALLOWLIST
//   - never crashes the app if the MCP service is down — callers get a
//     normalized McpError instead
//   - closes cleanly on backend shutdown via disconnect()

import { getMcpConfig, isMcpEnabled, McpConfigError, type McpConfig } from "./config";
import { McpError, normalizeMcpError } from "./errors";

type SdkClient = import("@modelcontextprotocol/sdk/client/index.js").Client;

const RECONNECT_COOLDOWN_MS = 5_000; // min gap between failed connect attempts
const MAX_CALL_ATTEMPTS = 2;         // 1 retry after a session/connection failure
const MIN_VIABLE_RETRY_MS = 500;     // skip retry if less than this remains in deadline

/**
 * Read-only MCP tools that are safe to auto-retry after a session-invalid
 * recovery. Tools that could produce side effects (prepare_trade_ticket) are
 * excluded and must be retried explicitly by the caller.
 *
 * Maintain in sync with MCP_ALLOWED_TOOLS in ./tools.ts when adding new tools.
 */
export const SESSION_RECOVERY_ALLOWLIST = new Set<string>([
  "get_quote",
  "get_market_history",
  "get_news",
  "scan_vcp",
  "get_positions",
  "scan_strategy",
  "scan_opportunities",
  "build_trade_candidate",
  "calculate_position_risk",
  "get_market_regime",
  "get_earnings",
  "get_fundamentals",
  "get_options_chain",
  "analyze_options",
  "select_option_contracts",
  "calculate_trade_risk",
  "recommend_trade_strategy",
  "rank_market_trade_candidates",
  "plan_portfolio_trade",
]);

export class McpToolsClient {
  private client: SdkClient | null = null;
  private connecting: Promise<SdkClient> | null = null;
  /** Deduplicates concurrent session-invalid recoveries (thundering herd). */
  private recovering: Promise<void> | null = null;
  private lastConnectFailureAt = 0;
  private toolNames: string[] | null = null;
  private stats = { calls: 0, failures: 0, reconnects: 0 };

  get isConnected(): boolean {
    return this.client !== null;
  }

  getStats() {
    return { ...this.stats };
  }

  /** Cached tool names from the last successful listTools call (may be null). */
  getKnownToolNames(): string[] | null {
    return this.toolNames ? [...this.toolNames] : null;
  }

  private getConfigOrThrow(): McpConfig {
    if (!isMcpEnabled()) {
      throw new McpError("MCP_DISABLED", "Live market data integration is disabled.");
    }
    try {
      const cfg = getMcpConfig();
      if (!cfg) throw new McpError("MCP_DISABLED", "Live market data integration is disabled.");
      return cfg;
    } catch (err) {
      if (err instanceof McpConfigError) {
        // Log the config problem (message never contains the token).
        console.error("[mcp] configuration error:", err.message);
        throw new McpError("MCP_CONFIG_ERROR", "Live market data is not configured.");
      }
      throw err;
    }
  }

  async connect(): Promise<void> {
    await this.ensureClient();
  }

  private async ensureClient(): Promise<SdkClient> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;

    // Bounded backoff: after a failed connect, refuse to hammer the MCP
    // service — callers immediately get "unavailable" until the cooldown ends.
    const sinceFailure = Date.now() - this.lastConnectFailureAt;
    if (this.lastConnectFailureAt > 0 && sinceFailure < RECONNECT_COOLDOWN_MS) {
      throw new McpError("MCP_UNAVAILABLE", "Live market data is temporarily unavailable.");
    }

    const cfg = this.getConfigOrThrow();

    this.connecting = (async () => {
      const started = Date.now();
      try {
        const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
        const { StreamableHTTPClientTransport } = await import(
          "@modelcontextprotocol/sdk/client/streamableHttp.js"
        );
        const transport = new StreamableHTTPClientTransport(new URL(cfg.endpointUrl), {
          requestInit: {
            headers: { Authorization: `Bearer ${cfg.token}` },
          },
        });
        const client = new Client(
          { name: "vcp-trader-backend", version: "1.0.0" },
          { capabilities: {} },
        );
        client.onclose = () => {
          // Session ended (MCP redeploy, idle expiry, network drop). Clear the
          // cached client so the next call reconnects lazily.
          if (this.client === client) this.client = null;
        };
        await client.connect(transport, { timeout: cfg.timeoutMs });
        this.client = client;
        this.lastConnectFailureAt = 0;
        console.log(JSON.stringify({ event: "mcp_connected", durationMs: Date.now() - started }));
        return client;
      } catch (err) {
        this.lastConnectFailureAt = Date.now();
        const norm = normalizeMcpError(err);
        console.warn(JSON.stringify({ event: "mcp_connect_failed", code: norm.code, durationMs: Date.now() - started }));
        throw norm;
      } finally {
        this.connecting = null;
      }
    })();

    return this.connecting;
  }

  async listTools(): Promise<string[]> {
    const cfg = this.getConfigOrThrow();
    const client = await this.ensureClient();
    try {
      const result = await client.listTools(undefined, { timeout: cfg.timeoutMs });
      this.toolNames = result.tools.map((t) => t.name);
      return [...this.toolNames];
    } catch (err) {
      throw normalizeMcpError(err);
    }
  }

  /**
   * Call a tool by name. NOTE: allowlist enforcement lives in tools.ts —
   * always go through callAllowedTool / the typed wrappers from app code.
   *
   * Per-call timeout precedence: opts.timeoutMs → global MCP_TIMEOUT_MS
   * default (10s). Slow tools (recommend_trade_strategy) pass a longer
   * per-call timeout AND retryOnTimeout=false so the total wait stays
   * bounded — a deterministic slow computation won't get faster by retrying.
   *
   * Session recovery: when the MCP service returns HTTP 404 with a
   * session-not-found body, the stale session is cleared, a fresh session is
   * initialized, and the tool call is retried once — but only for tools in
   * SESSION_RECOVERY_ALLOWLIST (all verified read-only tools). The recovery
   * uses the remaining deadline budget; if budget is exhausted the original
   * error is surfaced without retrying.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    opts?: { timeoutMs?: number; retryOnTimeout?: boolean },
  ): Promise<unknown> {
    const cfg = this.getConfigOrThrow();
    const timeoutMs =
      typeof opts?.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : cfg.timeoutMs;
    const retryOnTimeout = opts?.retryOnTimeout !== false;
    // One deadline shared across the original call, any recovery, and the retry.
    const deadline = Date.now() + timeoutMs;
    let lastError: McpError | null = null;
    // Guard: only one session-recovery attempt per callTool invocation.
    let sessionRecoveryAttempted = false;

    for (let attempt = 1; attempt <= MAX_CALL_ATTEMPTS; attempt++) {
      const attemptStarted = Date.now();
      // Compute remaining budget. On the first attempt this equals timeoutMs.
      const remainingMs = deadline - attemptStarted;
      if (attempt > 1 && remainingMs < MIN_VIABLE_RETRY_MS) {
        // Budget exhausted — surface whatever error we have rather than
        // starting a retry that cannot reasonably complete.
        break;
      }
      // Use whichever is tighter: the per-call timeout or the remaining budget.
      const callTimeoutMs = Math.min(timeoutMs, Math.max(MIN_VIABLE_RETRY_MS, remainingMs));

      try {
        const client = await this.ensureClient();
        const result = await client.callTool({ name, arguments: args }, undefined, {
          timeout: callTimeoutMs,
        });
        this.stats.calls++;
        console.log(JSON.stringify({ event: "mcp_tool_call", tool: name, timeoutMs: callTimeoutMs, attempt, durationMs: Date.now() - attemptStarted, success: !result.isError }));
        if (result.isError) {
          const text = extractText(result.content);
          throw new McpError("MCP_TOOL_ERROR", text || "Market data is temporarily unavailable.", name);
        }
        // Preserve structured output when the server provides it; otherwise
        // parse JSON text content so the model receives structured values.
        if (result.structuredContent !== undefined) return result.structuredContent;
        const text = extractText(result.content);
        if (text) {
          try {
            return JSON.parse(text);
          } catch {
            return text;
          }
        }
        return result.content ?? null;
      } catch (err) {
        this.stats.failures++;
        lastError = normalizeMcpError(err, name);
        console.warn(JSON.stringify({ event: "mcp_tool_call", tool: name, timeoutMs: callTimeoutMs, attempt, durationMs: Date.now() - attemptStarted, success: false, code: lastError.code }));

        // ── Session-invalid recovery ──────────────────────────────────────
        // HTTP 404 + "session not found": the MCP service redeployed and
        // discarded our session. Recover once for verified read-only tools.
        if (
          lastError.code === "MCP_SESSION_INVALID" &&
          !sessionRecoveryAttempted &&
          SESSION_RECOVERY_ALLOWLIST.has(name)
        ) {
          sessionRecoveryAttempted = true;
          console.log(JSON.stringify({ event: "mcp_session_invalid_detected", tool: name, attempt, code: lastError.code }));

          const budgetAfterFailure = deadline - Date.now();
          if (budgetAfterFailure < MIN_VIABLE_RETRY_MS) {
            // Not enough time left to recover + retry.
            break;
          }

          try {
            await this.recoverSession(name, attempt);
            this.stats.reconnects++;
            console.log(JSON.stringify({ event: "mcp_tool_retried_after_reinitialize", tool: name, attempt }));
            continue; // proceed to attempt 2 with the fresh session
          } catch (recoverErr) {
            lastError = normalizeMcpError(recoverErr, name);
            console.warn(JSON.stringify({ event: "mcp_tool_retry_failed", tool: name, attempt, code: lastError.code }));
            break; // surface the recovery failure — no further retries
          }
        }

        // ── Existing retry logic: reconnect on session drop / unavailable ─
        // Config/disabled/auth/tool errors won't be fixed by reconnecting.
        // Timeout retries are opt-out (retryOnTimeout=false) for slow tools.
        const retryable =
          lastError.code === "MCP_UNAVAILABLE" ||
          (lastError.code === "MCP_TIMEOUT" && retryOnTimeout);
        if (!retryable || attempt === MAX_CALL_ATTEMPTS) throw lastError;
        // Drop the (likely dead) session and retry once with a fresh one.
        await this.resetSession();
        this.stats.reconnects++;
        console.log(JSON.stringify({ event: "mcp_reconnect", tool: name }));
      }
    }
    throw lastError ?? new McpError("MCP_TOOL_ERROR", "Market data is temporarily unavailable.", name);
  }

  /**
   * Recover from a session-invalid error:
   * - If a recovery is already in progress (concurrent callers), join it.
   * - Otherwise, start a new recovery: clear the stale session, reinitialize.
   * - Clears `this.recovering` on both success and failure so later callers
   *   can start a fresh recovery if needed (no permanently poisoned Promise).
   */
  private async recoverSession(tool: string, attempt: number): Promise<void> {
    if (this.recovering) {
      // Another request already started recovery — join its Promise.
      console.log(JSON.stringify({ event: "mcp_session_reinitialize_joined", tool, attempt }));
      await this.recovering;
      return;
    }

    console.log(JSON.stringify({ event: "mcp_session_reinitialize_started", tool, attempt }));
    const started = Date.now();

    this.recovering = (async () => {
      try {
        await this.resetSession();
        await this.ensureClient();
        console.log(JSON.stringify({ event: "mcp_session_reinitialize_succeeded", tool, attempt, durationMs: Date.now() - started }));
      } catch (err) {
        const norm = normalizeMcpError(err);
        console.warn(JSON.stringify({ event: "mcp_session_reinitialize_failed", tool, attempt, durationMs: Date.now() - started, code: norm.code }));
        throw norm;
      } finally {
        // Always clear — prevents a permanently poisoned Promise and allows
        // subsequent requests to start a fresh recovery.
        this.recovering = null;
      }
    })();

    await this.recovering;
  }

  private async resetSession(): Promise<void> {
    const client = this.client;
    this.client = null;
    // Allow the immediate retry to attempt a fresh connection.
    this.lastConnectFailureAt = 0;
    if (client) {
      try {
        await client.close();
      } catch {
        // best effort
      }
    }
  }

  async disconnect(): Promise<void> {
    await this.resetSession();
  }
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((c: any) => c && c.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("\n");
}

// Singleton — one session shared across the backend (see spec §18: one
// centralized McpToolsClient, no duplicated transport logic per route).
export const mcpClient = new McpToolsClient();

// Close the MCP session cleanly when the backend shuts down.
let shutdownHooked = false;
export function hookMcpShutdown(): void {
  if (shutdownHooked) return;
  shutdownHooked = true;
  const close = () => {
    void mcpClient.disconnect();
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}
