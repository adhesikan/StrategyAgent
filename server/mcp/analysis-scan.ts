// Deterministic VCP scan for stock-analysis asks (spec: "Analyze MU" must
// always include scan_vcp results when MCP is enabled, instead of relying on
// the model's optional tool-calling).
//
// This module decides (a) whether a question is a clear stock-analysis ask,
// and (b) fetches exactly one scan_vcp result through the centralized
// McpToolsClient wrapper (so stats.calls increments and mcp_tool_call logs
// are emitted). Failures never propagate — the caller falls back to the
// pre-existing Analyze behavior with no scanner block.

import { isMcpEnabled } from "./config";

// Intent rule: any of these phrasings counts as a stock-analysis ask when a
// ticker is also present in the question:
//   - "analyze X" / "analysis of X" ("analyse" too)
//   - "evaluate X"
//   - "technical analysis of X"
//   - "how does X look" / "how is X looking"
//   - "what's the setup on/for X" / "setup on X"
const ANALYSIS_PATTERNS: RegExp[] = [
  /\banaly[sz]e\b/,
  /\banalysis\b/,
  /\bevaluate\b/,
  /\bhow\s+(does|is)\s+\S{1,10}\s+look(ing)?\b/,
  /\b(what'?s|what\s+is)\s+the\s+setup\s+(on|for)\b/,
  /\bsetup\s+on\s+\$?[a-z]{1,5}\b/,
];

export function isStockAnalysisAsk(question: string): boolean {
  const lower = String(question ?? "").toLowerCase();
  return ANALYSIS_PATTERNS.some((re) => re.test(lower));
}

export interface DeterministicScanResult {
  symbol: string;
  lookbackDays: number;
  /** Structured scan_vcp result as returned by the MCP server. */
  result: unknown;
}

// Bound the size of the scan payload injected into the model prompt so an
// unexpectedly large MCP response can't blow up token usage. Structured
// values are preserved when under the cap; oversized payloads are truncated
// as a JSON string with a marker (the model treats it as untrusted data
// either way — system rules take precedence).
const MAX_SCAN_PAYLOAD_CHARS = 4000;
export function capPayload(result: unknown): unknown {
  try {
    const json = JSON.stringify(result);
    if (json && json.length > MAX_SCAN_PAYLOAD_CHARS) {
      return { truncated: true, preview: json.slice(0, MAX_SCAN_PAYLOAD_CHARS) };
    }
  } catch {
    return null;
  }
  return result;
}

/**
 * Runs scan_vcp exactly once for the first extracted ticker when MCP is
 * enabled and the question is a stock-analysis ask. Returns null (never
 * throws) when MCP is disabled, no ticker was found, the question isn't an
 * analysis ask, or the scan fails — the caller keeps the existing behavior.
 */
export async function fetchDeterministicVcpScan(
  question: string,
  tickers: string[],
): Promise<DeterministicScanResult | null> {
  if (!isMcpEnabled()) return null;
  if (!isStockAnalysisAsk(question)) return null;
  const symbol = tickers?.[0];
  if (!symbol) return null;
  const lookbackDays = 120;
  try {
    const { scanVcp } = await import("./tools");
    const result = await scanVcp([symbol], lookbackDays);
    return { symbol, lookbackDays, result: capPayload(result) };
  } catch (err: any) {
    // Never fail the ask request; the model is told live scanner data is
    // unavailable rather than receiving fabricated results.
    console.warn(
      JSON.stringify({ event: "mcp_deterministic_scan_failed", tool: "scan_vcp", symbol, code: err?.code ?? "MCP_TOOL_ERROR" }),
    );
    return null;
  }
}
