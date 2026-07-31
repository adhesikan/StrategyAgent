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

// ---------------------------------------------------------------------------
// Presentation for the expanded scan_vcp result.
//
// CRITICAL SEMANTICS (spec):
// - majorHigh is HISTORICAL CONTEXT ONLY — never labeled pivot, breakout
//   level, buy point, or actionable entry.
// - actionablePivot is the ONLY actionable pivot concept.
// - actionablePivot.detected === false or price === null renders as
//   "Actionable VCP pivot: None" (null is valid data, not an error).
// - Legacy pivotPrice is equivalent to actionablePivot.price (may be null).
// - Stage "base-building" no longer exists; use early / developing.
// - Trend comes from trend.classification.
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<string, string> = {
  "no-setup": "No valid VCP setup",
  early: "Early base formation",
  developing: "Developing base",
  contraction: "Contraction phase",
  "pivot-ready": "Pivot-ready",
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fmtPrice(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Deterministic plain-English summary of an expanded scan_vcp result, in the
 * spec's structure. Defensive: any missing/unknown fields are simply omitted.
 * Returns null when the payload has no usable scan object.
 */
export function summarizeVcpScan(raw: unknown, fallbackSymbol?: string): string | null {
  let r: any = raw;
  if (Array.isArray(r)) {
    r = fallbackSymbol
      ? r.find((x: any) => String(x?.symbol ?? "").toUpperCase() === fallbackSymbol.toUpperCase()) ?? r[0]
      : r[0];
  }
  if (Array.isArray(r?.results)) r = r.results[0];
  if (!r || typeof r !== "object" || (r as any).truncated) return null;

  const lines: string[] = [];
  const score = num(r.score);
  if (score !== null) lines.push(`VCP Score: ${Math.round(score)}/100`);

  const stage = typeof r.stage === "string" ? r.stage : null;
  // "base-building" is retired — map it defensively to "developing".
  const stageKey = stage === "base-building" ? "developing" : stage;
  const setupLabel =
    (stageKey && STAGE_LABELS[stageKey]) ??
    (r.setupDetected === false ? STAGE_LABELS["no-setup"] : r.setupDetected === true ? "Setup detected" : null);
  if (setupLabel) lines.push(`Setup: ${setupLabel}`);

  const trend = typeof r.trend?.classification === "string" ? r.trend.classification : null;
  if (trend) lines.push(`Trend: ${trend}`);

  // majorHigh — historical context only. Deliberately worded so it can never
  // read as an entry/breakout level.
  const mhPrice = num(r.majorHigh?.price);
  if (mhPrice !== null) {
    let line = `Major high (historical context, not an entry level): ${fmtPrice(mhPrice)}`;
    if (typeof r.majorHigh?.date === "string" && r.majorHigh.date) line += ` on ${r.majorHigh.date}`;
    const below = num(r.majorHigh?.distancePercent ?? r.majorHigh?.percentBelow);
    if (below !== null) line += `; current price is ${Math.abs(below).toFixed(1)}% below that high`;
    lines.push(line);
  }

  const base = r.base;
  if (base?.detected === true) {
    const parts: string[] = [];
    const dur = num(base.durationDays ?? base.lengthDays);
    if (dur !== null) parts.push(`${Math.round(dur)} days`);
    const depth = num(base.depthPercent);
    if (depth !== null) parts.push(`${Math.abs(depth).toFixed(1)}% deep`);
    const support = num(base.support);
    if (support !== null) parts.push(`support ${fmtPrice(support)}`);
    const resistance = num(base.resistance);
    if (resistance !== null) parts.push(`resistance ${fmtPrice(resistance)}`);
    lines.push(`Base: ${parts.length ? parts.join(", ") : "detected"}`);
  } else if (base !== undefined) {
    lines.push("Base: No confirmed base");
  }

  // actionablePivot — the ONLY actionable pivot concept. detected:false or
  // price:null is valid data meaning "None", never an error.
  const ap = r.actionablePivot;
  const apPrice = ap ? num(ap.price) : num(r.pivotPrice); // legacy pivotPrice fallback
  const apDetected = ap ? ap.detected === true && apPrice !== null : apPrice !== null;
  if (apDetected && apPrice !== null) {
    let line = `Actionable VCP pivot: ${fmtPrice(apPrice)}`;
    if (typeof ap?.source === "string" && ap.source) line += ` (source: ${ap.source})`;
    const dist = num(ap?.distancePercent ?? r.distanceToPivotPercent);
    if (dist !== null) line += `, ${Math.abs(dist).toFixed(2)}% away`;
    lines.push(line);
  } else if (ap !== undefined || r.pivotPrice !== undefined) {
    lines.push("Actionable VCP pivot: None");
  }

  const why: string[] = [];
  for (const reason of Array.isArray(r.reasons) ? r.reasons : []) {
    if (typeof reason === "string" && reason) why.push(reason);
  }
  for (const warning of Array.isArray(r.warnings) ? r.warnings : []) {
    if (typeof warning === "string" && warning) why.push(warning);
  }
  if (why.length) lines.push(`Why:\n- ${why.slice(0, 8).join("\n- ")}`);

  return lines.length ? lines.join("\n") : null;
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
