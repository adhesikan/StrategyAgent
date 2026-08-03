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
  // Sprint 2 multi-strategy tools — backend deterministic orchestration only.
  // Deliberately NOT in MCP_AI_TOOLS: the model never picks symbols or
  // strategies; the opportunity-search orchestrator calls these itself.
  "scan_strategy",
  "scan_opportunities",
  "build_trade_candidate",
  "calculate_position_risk",
  "get_market_regime",
  "get_earnings",
  "get_fundamentals",
  // Options pipeline tools — backend deterministic orchestration only.
  // Called (in order) after build_trade_candidate when a live chain is
  // reachable: get_options_chain → analyze_options → select_option_contracts
  // → calculate_trade_risk. Never exposed to the AI (not in MCP_AI_TOOLS).
  "get_options_chain",
  "analyze_options",
  "select_option_contracts",
  "calculate_trade_risk",
  // Ticket preparation — backend deterministic orchestration only, invoked
  // when the USER explicitly clicks "Prepare in Trade Builder" on a qualified
  // card. Output only prefills the Trade Builder; it never places an order.
  "prepare_trade_ticket",
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
// Sprint 2 multi-strategy tools (backend-only deterministic orchestration).
// Argument shapes verified against the deployed vcp-trader-mcp service.
// ---------------------------------------------------------------------------

export interface ScanOpportunitiesFilters {
  strategies?: string[];
  direction?: "bullish" | "bearish";
  minScore?: number;
  status?: string;
  timeframe?: string;
  limit?: number;
}

export async function scanOpportunities(filters: ScanOpportunitiesFilters = {}): Promise<unknown> {
  const args: Record<string, unknown> = {};
  if (filters.strategies?.length) args.strategies = filters.strategies.slice(0, 20).map((s) => String(s));
  if (filters.direction) args.direction = filters.direction;
  if (typeof filters.minScore === "number") args.minScore = filters.minScore;
  if (filters.status) args.status = filters.status;
  if (filters.timeframe) args.timeframe = filters.timeframe;
  if (filters.limit != null) args.limit = Math.max(1, Math.min(25, Math.floor(filters.limit)));
  return callAllowedTool("scan_opportunities", args);
}

export async function scanStrategy(symbol: string, strategy: string, timeframe?: string): Promise<unknown> {
  const args: Record<string, unknown> = { symbol: cleanSymbol(symbol), strategy: String(strategy) };
  if (timeframe) args.timeframe = timeframe;
  return callAllowedTool("scan_strategy", args);
}

/**
 * `optionsContextToken` is a short-lived OPAQUE context token minted by
 * server/services/options-context.ts — never a broker OAuth token. It lets
 * the MCP service call back into /api/internal/options/* (with its own
 * VCP_INTERNAL_API_KEY) to fetch a live option chain for the requesting
 * user. Backend-only: this wrapper is not in MCP_AI_TOOLS, so the model can
 * never supply or observe this argument.
 */
export async function buildTradeCandidate(
  symbol: string,
  strategy: string,
  optionsContextToken?: string,
): Promise<unknown> {
  return callAllowedTool("build_trade_candidate", {
    symbol: cleanSymbol(symbol),
    strategy: String(strategy),
    ...(optionsContextToken ? { optionsContextToken } : {}),
  });
}

export interface PositionRiskArgs {
  symbol: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice?: number;
  /** User-supplied risk budget in dollars → shares sizing on the MCP side. */
  maxRiskDollars?: number;
}

export async function calculatePositionRisk(a: PositionRiskArgs): Promise<unknown> {
  const args: Record<string, unknown> = {
    symbol: cleanSymbol(a.symbol),
    entryPrice: a.entryPrice,
    stopPrice: a.stopPrice,
  };
  if (typeof a.targetPrice === "number") args.targetPrice = a.targetPrice;
  if (typeof a.maxRiskDollars === "number") args.maxRiskDollars = a.maxRiskDollars;
  return callAllowedTool("calculate_position_risk", args);
}

// ---------------------------------------------------------------------------
// Options pipeline tools (backend-only). All take the same short-lived OPAQUE
// optionsContextToken as build_trade_candidate — never a broker OAuth token.
// Availability is best-effort: the orchestrator treats any failure as "live
// contracts unavailable" and degrades to the estimated-options card.
// ---------------------------------------------------------------------------

export async function getOptionsChain(args: {
  symbol: string;
  expiration?: string;
  optionsContextToken?: string;
}): Promise<unknown> {
  return callAllowedTool("get_options_chain", {
    symbol: cleanSymbol(args.symbol),
    ...(args.expiration ? { expiration: String(args.expiration) } : {}),
    ...(args.optionsContextToken ? { optionsContextToken: args.optionsContextToken } : {}),
  });
}

export async function analyzeOptions(args: {
  symbol: string;
  strategy?: string;
  direction?: "bullish" | "bearish";
  optionsContextToken?: string;
}): Promise<unknown> {
  return callAllowedTool("analyze_options", {
    symbol: cleanSymbol(args.symbol),
    ...(args.strategy ? { strategy: String(args.strategy) } : {}),
    ...(args.direction ? { direction: args.direction } : {}),
    ...(args.optionsContextToken ? { optionsContextToken: args.optionsContextToken } : {}),
  });
}

export async function selectOptionContracts(args: {
  symbol: string;
  strategy: string;
  direction?: "bullish" | "bearish";
  targetDte?: { min: number; max: number };
  maxRiskDollars?: number;
  optionsContextToken?: string;
}): Promise<unknown> {
  return callAllowedTool("select_option_contracts", {
    symbol: cleanSymbol(args.symbol),
    strategy: String(args.strategy),
    ...(args.direction ? { direction: args.direction } : {}),
    ...(args.targetDte ? { targetDte: args.targetDte } : {}),
    ...(typeof args.maxRiskDollars === "number" ? { maxRiskDollars: args.maxRiskDollars } : {}),
    ...(args.optionsContextToken ? { optionsContextToken: args.optionsContextToken } : {}),
  });
}

export async function calculateTradeRisk(args: {
  symbol: string;
  strategy: string;
  legs: Array<{
    action: string;
    type: string;
    strike: number;
    expiration?: string;
    premium?: number;
  }>;
  quantity?: number;
  maxRiskDollars?: number;
}): Promise<unknown> {
  return callAllowedTool("calculate_trade_risk", {
    symbol: cleanSymbol(args.symbol),
    strategy: String(args.strategy),
    legs: (args.legs ?? []).slice(0, 6),
    ...(typeof args.quantity === "number" ? { quantity: Math.max(1, Math.floor(args.quantity)) } : {}),
    ...(typeof args.maxRiskDollars === "number" ? { maxRiskDollars: args.maxRiskDollars } : {}),
  });
}

export async function prepareTradeTicket(args: {
  symbol: string;
  strategy?: string;
  quantity?: number;
  entryPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  maxRiskDollars?: number;
  legs?: Array<{
    action: string;
    type: string;
    strike: number;
    expiration?: string;
    premium?: number;
  }>;
  optionsContextToken?: string;
}): Promise<unknown> {
  return callAllowedTool("prepare_trade_ticket", {
    symbol: cleanSymbol(args.symbol),
    ...(args.strategy ? { strategy: String(args.strategy) } : {}),
    ...(typeof args.quantity === "number" ? { quantity: Math.max(1, Math.floor(args.quantity)) } : {}),
    ...(typeof args.entryPrice === "number" ? { entryPrice: args.entryPrice } : {}),
    ...(typeof args.stopPrice === "number" ? { stopPrice: args.stopPrice } : {}),
    ...(typeof args.targetPrice === "number" ? { targetPrice: args.targetPrice } : {}),
    ...(typeof args.maxRiskDollars === "number" ? { maxRiskDollars: args.maxRiskDollars } : {}),
    ...(args.legs && args.legs.length ? { legs: args.legs.slice(0, 6) } : {}),
    ...(args.optionsContextToken ? { optionsContextToken: args.optionsContextToken } : {}),
  });
}

export async function getMarketRegime(): Promise<unknown> {
  return callAllowedTool("get_market_regime", {});
}

export async function getEarnings(symbol: string): Promise<unknown> {
  return callAllowedTool("get_earnings", { symbol: cleanSymbol(symbol) });
}

export async function getFundamentals(symbol: string): Promise<unknown> {
  return callAllowedTool("get_fundamentals", { symbol: cleanSymbol(symbol) });
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
