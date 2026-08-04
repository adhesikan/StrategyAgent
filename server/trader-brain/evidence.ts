// TraderBrain Core — Evidence helpers.
//
// Wraps MCP tool results (and failures) into ToolEvidence envelopes.
// Preserves the original validated payload — never flattens domain fields.
//
// Security constraints:
//   - Never log complete payloads.
//   - Never surface portfolio tokens, account IDs, or raw balances.
//   - dataQuality.simulated must be set when MCP returns source:"mock".

import type {
  ToolEvidence,
  EvidenceStatus,
  EvidenceSource,
  ToolEvidenceDataQuality,
  BrainToolId,
} from "./types";

// ---------------------------------------------------------------------------
// Data quality extraction
// ---------------------------------------------------------------------------

function extractDataQuality(data: unknown): ToolEvidenceDataQuality {
  if (!data || typeof data !== "object") {
    return { estimated: false, simulated: false, partial: false, stale: false };
  }
  const d = data as Record<string, unknown>;
  const source = typeof d.source === "string" ? d.source.toLowerCase() : "";
  const simulated =
    source.includes("mock") ||
    source.includes("simulated") ||
    source.includes("fixture") ||
    source.includes("synthetic") ||
    d.simulatedData === true;
  const estimated = d.estimated === true || source.includes("estimated");
  return {
    estimated: Boolean(estimated),
    simulated: Boolean(simulated),
    partial: false,
    stale: false,
  };
}

function extractSource(data: unknown): EvidenceSource {
  if (!data || typeof data !== "object") return "mcp_live";
  const d = data as Record<string, unknown>;
  const src = typeof d.source === "string" ? d.source.toLowerCase() : "";
  if (src.includes("mock") || src.includes("simulated")) return "mcp_mock";
  if (src.includes("db") || src.includes("stored")) return "db_stored";
  if (src.includes("cache")) return "cache";
  return "mcp_live";
}

function extractWarnings(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.warnings)) {
    return d.warnings.filter((w): w is string => typeof w === "string");
  }
  return [];
}

function extractVerdict(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  // recommendation: recommendations[0].overallVerdict
  if (Array.isArray(d.recommendations) && d.recommendations.length > 0) {
    const first = d.recommendations[0];
    if (first && typeof first === "object") {
      const v = (first as Record<string, unknown>).overallVerdict;
      if (typeof v === "string") return v;
    }
  }
  // multi-strategy: overallVerdict
  if (typeof d.overallVerdict === "string") return d.overallVerdict;
  // portfolio plan: feasibility.feasible
  if (d.feasibility && typeof d.feasibility === "object") {
    const f = d.feasibility as Record<string, unknown>;
    return f.feasible === true ? "FEASIBLE" : f.feasible === false ? "NOT_FEASIBLE" : undefined;
  }
  return undefined;
}

function extractConfidence(data: unknown): "high" | "medium" | "low" | "none" | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.recommendations) && d.recommendations.length > 0) {
    const first = d.recommendations[0] as Record<string, unknown>;
    const c = first?.confidence;
    if (typeof c === "number") {
      if (c >= 0.7) return "high";
      if (c >= 0.4) return "medium";
      return "low";
    }
  }
  if (typeof d.dataQuality === "object" && d.dataQuality) {
    const dq = d.dataQuality as Record<string, unknown>;
    if (dq.realMarketData === true && dq.fresh === true) return "high";
    if (dq.realMarketData === true) return "medium";
    return "low";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

/**
 * Wraps a successful MCP call result into a ToolEvidence envelope.
 * Preserves the original validated payload under `data`.
 */
export function wrapSuccess(
  stepId: string,
  tool: BrainToolId,
  data: unknown,
  durationMs: number,
): ToolEvidence {
  const dataQuality = extractDataQuality(data);
  const source = extractSource(data);
  const status: EvidenceStatus = dataQuality.simulated ? "degraded" : "ok";

  return {
    stepId,
    source,
    tool,
    status,
    durationMs,
    generatedAt: new Date().toISOString(),
    data,
    dataQuality,
    warnings: extractWarnings(data),
    limitations: dataQuality.simulated
      ? ["Data returned by the service is simulated / mock — not live market data."]
      : [],
    confidence: extractConfidence(data),
    verdict: extractVerdict(data),
  };
}

/**
 * Wraps a failed MCP call into a ToolEvidence envelope.
 * Never includes the raw error message (may contain sensitive data).
 */
export function wrapFailure(
  stepId: string,
  tool: BrainToolId,
  safeErrorCode: string,
  durationMs: number,
): ToolEvidence {
  return {
    stepId,
    source: "mcp_live",
    tool,
    status: "failed",
    durationMs,
    generatedAt: new Date().toISOString(),
    data: null,
    dataQuality: { estimated: false, simulated: false, partial: false, stale: false },
    warnings: [],
    limitations: [`Tool "${tool}" was unavailable (${safeErrorCode}).`],
    safeErrorCode,
  };
}

/**
 * Creates a skipped evidence envelope (step was not executed because a
 * dependency failed or the step was not needed for this result).
 */
export function wrapSkipped(stepId: string, tool: BrainToolId, reason: string): ToolEvidence {
  return {
    stepId,
    source: "mcp_live",
    tool,
    status: "skipped",
    durationMs: 0,
    generatedAt: new Date().toISOString(),
    data: null,
    dataQuality: { estimated: false, simulated: false, partial: false, stale: false },
    warnings: [],
    limitations: [`Step "${stepId}" skipped: ${reason}`],
  };
}

/**
 * Creates a rule-based fallback evidence envelope.
 */
export function wrapRuleBased(stepId: string, tool: BrainToolId, data: unknown): ToolEvidence {
  return {
    stepId,
    source: "rule_based",
    tool,
    status: "degraded",
    durationMs: 0,
    generatedAt: new Date().toISOString(),
    data,
    dataQuality: { estimated: true, simulated: false, partial: true, stale: false },
    warnings: ["Deterministic rule-based fallback — live service was unavailable."],
    limitations: ["Live service unavailable. Result generated from rule-based fallback."],
    confidence: "low",
  };
}

// ---------------------------------------------------------------------------
// Aggregate helpers
// ---------------------------------------------------------------------------

/** Aggregate all warnings from a list of evidence envelopes. */
export function aggregateWarnings(evidence: ToolEvidence[]): string[] {
  const all: string[] = [];
  for (const e of evidence) all.push(...e.warnings);
  return [...new Set(all)]; // deduplicate
}

/** Aggregate all limitations from a list of evidence envelopes. */
export function aggregateLimitations(evidence: ToolEvidence[]): string[] {
  const all: string[] = [];
  for (const e of evidence) all.push(...e.limitations);
  return [...new Set(all)];
}

/**
 * Derive overall execution status from evidence list.
 * A required step failure → "unavailable".
 * Optional failures only → "partial".
 * All degraded → "degraded".
 * All ok → "complete".
 */
export function deriveStatus(
  evidence: ToolEvidence[],
  plan: { steps: Array<{ id: string; required: boolean }> },
): import("./types").BrainExecutionStatus {
  const stepMap = new Map(plan.steps.map((s) => [s.id, s.required]));
  let hasPartial = false;
  let hasDegraded = false;
  for (const e of evidence) {
    if (e.status === "failed") {
      if (stepMap.get(e.stepId)) return "unavailable";
      hasPartial = true;
    }
    if (e.status === "degraded") hasDegraded = true;
  }
  if (hasPartial) return "partial";
  if (hasDegraded) return "degraded";
  return "complete";
}
