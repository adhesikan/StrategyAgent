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

// ---------------------------------------------------------------------------
// Structured research-analysis derivation (presentation only — no scanner
// algorithm/scoring changes). Everything below is derived deterministically
// from the scan_vcp result so the UI and the model receive consistent,
// non-fabricated structure.
// ---------------------------------------------------------------------------

export type VcpStage = "no-setup" | "early" | "developing" | "contraction" | "pivot-ready";

export interface VcpAnalysis {
  analysisSummary: {
    vcpScore: number | null;
    stage: VcpStage | null;
    trend: string | null;
  };
  vcpStructure: {
    stage: string | null;
    base: string;
    contractions: string | null;
    volatility: string | null;
    volume: string | null;
    higherLows: string | null;
    actionablePivot: { detected: boolean; price: number | null; source: string | null; distancePercent: number | null };
    majorHigh: { price: number | null; date: string | null; distancePercent: number | null; note: "historical context only" };
    baseSupport: number | null;
    baseResistance: number | null;
  };
  setupAssessment: {
    qualifies: boolean;
    strengths: string[];
    weaknesses: string[];
    improvementConditions: string[];
    watchConditions: string[];
  };
}

const KNOWN_STAGES: VcpStage[] = ["no-setup", "early", "developing", "contraction", "pivot-ready"];

function normalizeStage(stage: unknown): VcpStage | null {
  if (stage === "base-building") return "developing"; // retired stage
  return KNOWN_STAGES.includes(stage as VcpStage) ? (stage as VcpStage) : null;
}

/** Defensive truthiness for expanded scanner sub-objects. */
function featureState(v: any): boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v;
  const flag = v.detected ?? v.established ?? v.compressed ?? v.contracting ?? v.present;
  return typeof flag === "boolean" ? flag : null;
}

function featurePercent(v: any): number | null {
  if (!v || typeof v !== "object") return null;
  return num(v.percent ?? v.contractionPercent ?? v.compressionPercent ?? v.changePercent);
}

/**
 * Derives the structured analysis payload from an expanded scan_vcp result.
 * Returns null when the payload is unusable. Never invents values: fields the
 * scanner didn't supply are null/omitted from prose.
 */
export function deriveVcpAnalysis(raw: unknown, fallbackSymbol?: string): VcpAnalysis | null {
  let r: any = raw;
  if (Array.isArray(r)) {
    r = fallbackSymbol
      ? r.find((x: any) => String(x?.symbol ?? "").toUpperCase() === fallbackSymbol.toUpperCase()) ?? r[0]
      : r[0];
  }
  if (Array.isArray(r?.results)) r = r.results[0];
  if (!r || typeof r !== "object" || r.truncated) return null;

  const stage = normalizeStage(r.stage);
  const score = num(r.score);
  const trend = typeof r.trend?.classification === "string" ? r.trend.classification : null;

  // --- structure ---
  const base = r.base;
  const baseDetected = base?.detected === true;
  const dur = baseDetected ? num(base.durationDays ?? base.lengthDays) : null;
  const depth = baseDetected ? num(base.depthPercent) : null;
  const baseSupport = baseDetected ? num(base.support) : null;
  const baseResistance = baseDetected ? num(base.resistance) : null;
  const baseText = baseDetected
    ? ["Confirmed", dur !== null ? `${Math.round(dur)} days` : null, depth !== null ? `${Math.abs(depth).toFixed(1)}% deep` : null]
        .filter(Boolean)
        .join(", ")
    : "No confirmed base";

  const volComp = featureState(r.volatilityCompression);
  const volCon = featureState(r.volumeContraction);
  const volConPct = featurePercent(r.volumeContraction);
  const hl = featureState(r.higherLows);
  const contractionsOk = stage === "contraction" || stage === "pivot-ready";

  const ap = r.actionablePivot;
  const apPrice = ap ? num(ap.price) : num(r.pivotPrice);
  const apDetected = ap ? ap.detected === true && apPrice !== null : apPrice !== null;
  const apDist = apDetected ? num(ap?.distancePercent ?? r.distanceToPivotPercent) : null;

  const mhPrice = num(r.majorHigh?.price);

  // --- strengths / weaknesses (only from real scanner evidence) ---
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const improvements: string[] = [];
  const watch: string[] = [];

  const trendLower = (trend ?? "").toLowerCase();
  const trendWeak = /down|weak|bear/.test(trendLower);
  const trendStrong = /up|strong|bull/.test(trendLower) && !trendWeak;
  if (trend) {
    (trendStrong ? strengths : trendWeak ? weaknesses : strengths).push(
      trendStrong ? "Established uptrend" : trendWeak ? "Trend structure is weak" : `Trend: ${trend}`,
    );
  }
  if (trendWeak) {
    improvements.push("Price would need to repair the trend structure and regain important moving averages.");
    watch.push("Trend repair: price regains relevant moving averages and their slopes improve.");
  }

  if (baseDetected) strengths.push("Confirmed consolidation base");
  else {
    weaknesses.push("No confirmed consolidation base");
    improvements.push("A stable consolidation base needs to form rather than continued large directional swings.");
    watch.push("Base formation: price establishes a controlled consolidation range.");
  }

  if (contractionsOk) strengths.push("Successive contractions are tightening");
  else {
    weaknesses.push("Contractions are not tightening sufficiently");
    improvements.push("Successive pullbacks would need to become progressively shallower.");
    watch.push("Contraction quality: pullbacks become progressively shallower.");
  }

  if (volComp === true) strengths.push("Volatility is compressing");
  else if (volComp === false) {
    weaknesses.push("Volatility is not sufficiently compressed");
    improvements.push("Daily ranges and ATR should begin contracting.");
  }

  if (volCon === true) strengths.push(volConPct !== null ? `Volume is contracting (${Math.abs(volConPct).toFixed(0)}%)` : "Volume is drying up");
  else if (volCon === false) {
    weaknesses.push("Volume is not contracting");
    improvements.push("Volume should generally decline as the consolidation tightens.");
    watch.push("Volume: trading activity dries up during consolidation.");
  }

  if (hl === true) strengths.push("Higher lows are established");
  else if (hl === false) {
    weaknesses.push("Higher-low structure is not established");
    improvements.push("The structure would improve if subsequent pullbacks hold above prior swing lows.");
  }

  if (apDetected && apPrice !== null) {
    // Most decision-relevant strength — keep it ahead of the 6-item cap.
    strengths.unshift(
      apDist !== null
        ? `Price is ${Math.abs(apDist).toFixed(2)}% from a valid actionable pivot at ${fmtPrice(apPrice)}`
        : `A valid actionable pivot exists at ${fmtPrice(apPrice)}`,
    );
    watch.push(`Actionable pivot: ${fmtPrice(apPrice)}${apDist !== null ? ` (distance ${Math.abs(apDist).toFixed(2)}%)` : ""}.`);
    if (apDist !== null && Math.abs(apDist) > 5 && stage !== "pivot-ready") {
      improvements.push("The setup may be developing, but price remains too far from the actionable pivot to be considered pivot-ready.");
    }
  } else {
    weaknesses.push("No actionable pivot exists");
    improvements.push("A valid pivot should only emerge after a base and tightening contraction structure form.");
    watch.push("Pivot: no actionable pivot exists yet; wait for the structure to establish one.");
  }
  if (baseSupport !== null) watch.push(`Base support: ${fmtPrice(baseSupport)}.`);
  if (baseResistance !== null) watch.push(`Base resistance: ${fmtPrice(baseResistance)}.`);

  const qualifies = stage === "pivot-ready" || stage === "contraction";

  return {
    analysisSummary: { vcpScore: score !== null ? Math.round(score) : null, stage, trend },
    vcpStructure: {
      stage: stage ? STAGE_LABELS[stage] ?? stage : null,
      base: baseText,
      contractions: contractionsOk ? "Tightening" : "No valid tightening sequence",
      volatility: volComp === true ? "Compressing" : volComp === false ? "Not sufficiently compressed" : null,
      volume: volCon === true ? (volConPct !== null ? `Contracting ${Math.abs(volConPct).toFixed(0)}%` : "Contracting") : volCon === false ? "Not contracting" : null,
      higherLows: hl === true ? "Established" : hl === false ? "Not established" : null,
      actionablePivot: { detected: apDetected, price: apDetected ? apPrice : null, source: typeof ap?.source === "string" ? ap.source : null, distancePercent: apDist },
      majorHigh: {
        price: mhPrice,
        date: typeof r.majorHigh?.date === "string" ? r.majorHigh.date : null,
        distancePercent: num(r.majorHigh?.distancePercent ?? r.majorHigh?.percentBelow),
        note: "historical context only",
      },
      baseSupport,
      baseResistance,
    },
    setupAssessment: {
      qualifies,
      strengths: strengths.slice(0, 7),
      weaknesses: weaknesses.slice(0, 6),
      improvementConditions: qualifies ? improvements.slice(0, 3) : improvements.slice(0, 6),
      watchConditions: watch.slice(0, 6),
    },
  };
}

/**
 * Context-aware next-step suggestions. Presentation/navigation only — no
 * Trade Builder emphasis when there is no actionable setup.
 */
export function suggestionsForVcpStage(stage: VcpStage | null, symbol: string): { label: string; href: string }[] {
  const chart = { label: `View ${symbol} chart`, href: `/charts/${symbol}` };
  const scanner = { label: "Open Scanner", href: "/trade-finder" };
  const ranked = { label: "See ranked opportunities", href: "/opportunity-radar" };
  switch (stage) {
    case "pivot-ready":
      return [
        { label: `View ${symbol} setup`, href: `/charts/${symbol}` },
        { label: "Open Trade Builder", href: `/trade-finder?symbol=${symbol}` },
        ranked,
      ];
    case "developing":
    case "contraction":
      return [scanner, chart, ranked];
    case "no-setup":
    case "early":
    default:
      return [ranked, scanner];
  }
}

/**
 * Confidence reflects data completeness + analytical agreement — never
 * bullishness/bearishness. A clearly-failing (bearish) setup with complete
 * data is HIGH confidence.
 */
export function confidenceForAnalysis(input: {
  scanSucceeded: boolean;
  hasLiveQuote: boolean;
  analysis: VcpAnalysis | null;
}): "low" | "medium" | "high" {
  if (!input.scanSucceeded || !input.analysis) return "low";
  const a = input.analysis;
  if (!input.hasLiveQuote) return "medium";
  const stage = a.analysisSummary.stage;
  // Clear-cut structural verdicts with full data → high; mixed evidence → medium.
  const mixed = a.setupAssessment.strengths.length > 1 && a.setupAssessment.weaknesses.length > 1
    && stage !== "no-setup" && stage !== "pivot-ready";
  return mixed ? "medium" : "high";
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
