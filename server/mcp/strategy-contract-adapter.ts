// Central contract adapter: VCP Trader scanner registry → MCP scan_strategy
// contract. The live MCP service accepts ONLY its own slug namespace and
// timeframe enum; our internal registry uses uppercase IDs and "1d". Every
// scan_strategy call must pass through this module (enforced inside the
// typed scanStrategy wrapper in tools.ts) so no code path can send raw
// registry values to MCP.
//
// Diagnosed 2026-08-04: raw "1d" + registry IDs caused every multi-strategy
// scan to fail MCP input validation (-32602) before reaching the scanner.
//
// Rules:
// - Explicit typed maps only — never infer mappings from display names.
// - Unknown inputs fail LOCALLY (UNSUPPORTED_STRATEGY_MAPPING /
//   UNSUPPORTED_TIMEFRAME) and never call MCP.
// - MCP slugs and MCP timeframes are accepted idempotently.

import { McpError } from "./errors";

// ---------------------------------------------------------------------------
// Narrow contract types
// ---------------------------------------------------------------------------

export const MCP_STRATEGY_IDS = [
  "vcp",
  "momentum_breakout",
  "power_breakout",
  "precision_pullback",
  "institutional_reclaim",
  "open_drive_5m",
  "open_drive_15m",
  "volume_surge",
  "gap_force",
  "trend_pilot",
  "pressure_break",
] as const;
export type McpStrategyId = (typeof MCP_STRATEGY_IDS)[number];

export const MCP_TIMEFRAMES = ["5min", "15min", "1h", "1day"] as const;
export type McpStrategyTimeframe = (typeof MCP_TIMEFRAMES)[number];

export type RegistryStrategyId =
  | "VCP"
  | "VCP_MULTIDAY"
  | "ORB5"
  | "ORB15"
  | "HIGH_RVOL"
  | "GAP_AND_GO"
  | "CLASSIC_PULLBACK"
  | "TREND_CONTINUATION"
  | "VWAP_RECLAIM"
  | "VOLATILITY_SQUEEZE";

// ---------------------------------------------------------------------------
// Authoritative maps (verified against the live MCP service 2026-08-04)
// ---------------------------------------------------------------------------

const REGISTRY_TO_MCP: Record<RegistryStrategyId, McpStrategyId> = {
  VCP: "vcp",
  VCP_MULTIDAY: "power_breakout",
  ORB5: "open_drive_5m",
  ORB15: "open_drive_15m",
  HIGH_RVOL: "volume_surge",
  GAP_AND_GO: "gap_force",
  CLASSIC_PULLBACK: "precision_pullback",
  TREND_CONTINUATION: "trend_pilot",
  VWAP_RECLAIM: "institutional_reclaim",
  VOLATILITY_SQUEEZE: "pressure_break",
};

const TIMEFRAME_MAP: Record<string, McpStrategyTimeframe> = {
  "1d": "1day",
  "1day": "1day",
  "5m": "5min",
  "5min": "5min",
  "15m": "15min",
  "15min": "15min",
  "1h": "1h",
};

const MCP_SLUG_SET = new Set<string>(MCP_STRATEGY_IDS);

// ---------------------------------------------------------------------------
// Pure translation functions
// ---------------------------------------------------------------------------

/**
 * Translates an internal registry strategy ID to the MCP slug. Accepts MCP
 * slugs idempotently. Unknown IDs throw UNSUPPORTED_STRATEGY_MAPPING locally
 * — MCP is never called with an unmapped strategy.
 */
export function toMcpStrategyId(registryStrategyId: string): McpStrategyId {
  const raw = String(registryStrategyId ?? "").trim();
  const mapped = (REGISTRY_TO_MCP as Record<string, McpStrategyId>)[raw.toUpperCase()];
  if (mapped) return mapped;
  if (MCP_SLUG_SET.has(raw.toLowerCase())) return raw.toLowerCase() as McpStrategyId;
  throw new McpError(
    "UNSUPPORTED_STRATEGY_MAPPING",
    `Strategy "${raw}" has no MCP scan_strategy mapping.`,
    "scan_strategy",
  );
}

/**
 * Translates an internal timeframe to the MCP timeframe enum. Accepts MCP
 * values idempotently. Unknown values throw UNSUPPORTED_TIMEFRAME locally.
 */
export function toMcpTimeframe(registryTimeframe: string): McpStrategyTimeframe {
  const mapped = TIMEFRAME_MAP[String(registryTimeframe ?? "").trim().toLowerCase()];
  if (mapped) return mapped;
  throw new McpError(
    "UNSUPPORTED_TIMEFRAME",
    `Timeframe "${registryTimeframe}" is not supported by MCP scan_strategy (expected 5min|15min|1h|1day or 5m|15m|1h|1d).`,
    "scan_strategy",
  );
}
