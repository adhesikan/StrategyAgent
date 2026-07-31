// Typed, allowlisted wrappers around the MCP tools exposed by vcp-trader-mcp.
// The rest of VCP Trader (and the AI orchestrator) must go through this
// module — never call mcpClient.callTool directly from app code.
//
// Capability boundaries (spec §5-§7):
//   - Explicit allowlist; unknown tools are rejected even if the MCP server
//     advertises them.
//   - All current tools are read-only (market/research/scanner/portfolio
//     reads). There is no trade:execute path — trading stays in InstaTrade.
//   - get_positions is NOT exposed to the AI in Phase 1: account context must
//     come from the authenticated VCP session, never from model output. The
//     typed wrapper exists for backend use once account scoping is verified.

import { mcpClient } from "./client";
import { McpError } from "./errors";

/** Tools VCP Trader is allowed to call at all. */
export const MCP_ALLOWED_TOOLS = [
  "get_quote",
  "get_market_history",
  "get_news",
  "scan_vcp",
  "get_positions",
] as const;

export type McpAllowedTool = (typeof MCP_ALLOWED_TOOLS)[number];

/** Subset of the allowlist the AI orchestrator may invoke (Phase 1). */
export const MCP_AI_TOOLS = [
  "get_quote",
  "get_market_history",
  "get_news",
  "scan_vcp",
] as const;

export type McpAiTool = (typeof MCP_AI_TOOLS)[number];

export function isAllowedTool(name: string): name is McpAllowedTool {
  return (MCP_ALLOWED_TOOLS as readonly string[]).includes(name);
}

export function isAiTool(name: string): name is McpAiTool {
  return (MCP_AI_TOOLS as readonly string[]).includes(name);
}

/** Allowlist gate. Rejects any tool not explicitly approved. */
export async function callAllowedTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!isAllowedTool(name)) {
    throw new McpError("MCP_TOOL_NOT_ALLOWED", `Tool "${name}" is not allowed.`, name);
  }
  return mcpClient.callTool(name, args);
}

// ---------------------------------------------------------------------------
// Typed wrappers
// ---------------------------------------------------------------------------

function cleanSymbol(symbol: string): string {
  const s = String(symbol ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-\/]{0,9}$/.test(s)) {
    throw new McpError("MCP_TOOL_ERROR", `Invalid symbol: ${symbol}`);
  }
  return s;
}

export async function getQuote(symbol: string): Promise<unknown> {
  return callAllowedTool("get_quote", { symbol: cleanSymbol(symbol) });
}

export async function getMarketHistory(
  symbol: string,
  interval?: string,
  outputSize?: number,
): Promise<unknown> {
  const args: Record<string, unknown> = { symbol: cleanSymbol(symbol) };
  if (interval) args.interval = interval;
  if (outputSize != null) args.outputSize = outputSize;
  return callAllowedTool("get_market_history", args);
}

export async function getNews(symbol: string, limit?: number): Promise<unknown> {
  const args: Record<string, unknown> = { symbol: cleanSymbol(symbol) };
  if (limit != null) args.limit = Math.max(1, Math.min(25, Math.floor(limit)));
  return callAllowedTool("get_news", args);
}

export async function scanVcp(symbols: string[], lookbackDays?: number): Promise<unknown> {
  const cleaned = (symbols ?? []).slice(0, 25).map(cleanSymbol);
  if (cleaned.length === 0) {
    throw new McpError("MCP_TOOL_ERROR", "scan_vcp requires at least one symbol.", "scan_vcp");
  }
  const args: Record<string, unknown> = { symbols: cleaned };
  if (lookbackDays != null) args.lookbackDays = lookbackDays;
  return callAllowedTool("scan_vcp", args);
}

/**
 * Backend-only. Account context MUST be derived server-side from the
 * authenticated VCP session — this wrapper deliberately takes no
 * account-id argument from callers and is NOT exposed to the AI (Phase 1).
 */
export async function getPositions(): Promise<unknown> {
  return callAllowedTool("get_positions", {});
}

// ---------------------------------------------------------------------------
// OpenAI function-calling definitions for the AI orchestrator (Phase 1 set)
// ---------------------------------------------------------------------------

export const MCP_OPENAI_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_quote",
      description: "Get the current live market quote (price, change, volume) for a stock symbol. Use whenever the user asks about a specific ticker's current price or status.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Stock ticker symbol, e.g. MU" },
        },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_market_history",
      description: "Get recent historical price bars for a stock symbol (for trend/context questions).",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Stock ticker symbol" },
          interval: { type: "string", description: "Bar interval, e.g. 1day" },
          outputSize: { type: "number", description: "Number of bars to return" },
        },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_news",
      description: "Get recent news headlines for a stock symbol.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Stock ticker symbol" },
          limit: { type: "number", description: "Max headlines to return (default 5)" },
        },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "scan_vcp",
      description: "Run the VCP (Volatility Contraction Pattern) scanner on one or more symbols. Returns setup score, status, and reasons/warnings. Use when the user asks to analyze a ticker or asks about its VCP setup.",
      parameters: {
        type: "object",
        properties: {
          symbols: { type: "array", items: { type: "string" }, description: "Ticker symbols to scan" },
          lookbackDays: { type: "number", description: "Lookback window in days (default 120)" },
        },
        required: ["symbols"],
        additionalProperties: false,
      },
    },
  },
];

/**
 * Execute a tool call requested by the model. Enforces the AI-facing
 * allowlist (get_positions is rejected here even though the backend wrapper
 * exists) and normalizes arguments through the typed wrappers so the model
 * can't pass arbitrary payloads through to MCP.
 */
export async function executeAiToolCall(name: string, rawArgs: unknown): Promise<unknown> {
  if (!isAiTool(name)) {
    throw new McpError("MCP_TOOL_NOT_ALLOWED", `Tool "${name}" is not available to the assistant.`, name);
  }
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
  switch (name) {
    case "get_quote":
      return getQuote(String(args.symbol ?? ""));
    case "get_market_history":
      return getMarketHistory(
        String(args.symbol ?? ""),
        typeof args.interval === "string" ? args.interval : undefined,
        typeof args.outputSize === "number" ? args.outputSize : undefined,
      );
    case "get_news":
      return getNews(String(args.symbol ?? ""), typeof args.limit === "number" ? args.limit : undefined);
    case "scan_vcp":
      return scanVcp(
        Array.isArray(args.symbols) ? args.symbols.map(String) : [],
        typeof args.lookbackDays === "number" ? args.lookbackDays : undefined,
      );
    default:
      throw new McpError("MCP_TOOL_NOT_ALLOWED", `Tool "${name}" is not available to the assistant.`, name);
  }
}
