// TraderBrain Core — Structured observability.
//
// Emits safe structured log events for each Brain lifecycle stage.
//
// NEVER logs:
//   - Prompt content when it may contain sensitive data
//   - Account IDs, user IDs, broker tokens, context tokens
//   - Raw portfolio positions, cash balances, buying power
//   - Complete tool payloads
//   - Any string that looks like a credential or token

import type {
  TraderBrainIntent,
  BrainExecutionStatus,
  ToolPlan,
  ToolEvidence,
  NormalizedBrainRequest,
  BrainToolId,
} from "./types";

// ---------------------------------------------------------------------------
// Event shapes (all fields are safe to log)
// ---------------------------------------------------------------------------

interface BrainRequestEvent {
  event: "trader_brain_request";
  requestId: string;
  intent: TraderBrainIntent;
  tickerCount: number;
  hasPortfolioConstraints: boolean;
  ts: string;
}

interface BrainPlanEvent {
  event: "trader_brain_plan";
  requestId: string;
  intent: TraderBrainIntent;
  plannedTools: BrainToolId[];
  stepCount: number;
  requiresOpenAi: boolean;
  ts: string;
}

interface BrainStepEvent {
  event: "trader_brain_step";
  requestId: string;
  stepId: string;
  tool: BrainToolId;
  status: string;
  durationMs: number;
  safeErrorCode?: string;
  ts: string;
}

interface BrainCompleteEvent {
  event: "trader_brain_complete";
  requestId: string;
  intent: TraderBrainIntent;
  status: BrainExecutionStatus;
  totalDurationMs: number;
  sectionNames: string[];
  openAiUsed: boolean;
  warningCount: number;
  ts: string;
}

interface BrainFailureEvent {
  event: "trader_brain_failure";
  requestId: string;
  intent: TraderBrainIntent;
  safeErrorCode: string;
  durationMs: number;
  ts: string;
}

// ---------------------------------------------------------------------------
// Safe emitter (writes to structured JSON; never throws)
// ---------------------------------------------------------------------------

function emit(event: Record<string, unknown>): void {
  try {
    // Use console.log for structured JSON — can be piped to a log aggregator.
    // In production, replace with a proper logging library.
    console.log(JSON.stringify(event));
  } catch {
    // Never let observability crash the request
  }
}

// ---------------------------------------------------------------------------
// Public log functions
// ---------------------------------------------------------------------------

export function logBrainRequest(
  requestId: string,
  req: NormalizedBrainRequest,
): void {
  const event: BrainRequestEvent = {
    event: "trader_brain_request",
    requestId,
    intent: req.intent,
    tickerCount: req.tickers.length,
    hasPortfolioConstraints: req.portfolioConstraints != null,
    ts: new Date().toISOString(),
  };
  emit(event);
}

export function logBrainPlan(requestId: string, plan: ToolPlan): void {
  const event: BrainPlanEvent = {
    event: "trader_brain_plan",
    requestId,
    intent: plan.intent,
    plannedTools: plan.steps.map((s) => s.tool),
    stepCount: plan.steps.length,
    requiresOpenAi: plan.responsePolicy.requiresOpenAi,
    ts: new Date().toISOString(),
  };
  emit(event);
}

export function logBrainStep(requestId: string, ev: ToolEvidence): void {
  const event: BrainStepEvent = {
    event: "trader_brain_step",
    requestId,
    stepId: ev.stepId,
    tool: ev.tool,
    status: ev.status,
    durationMs: ev.durationMs,
    ...(ev.safeErrorCode ? { safeErrorCode: ev.safeErrorCode } : {}),
    ts: new Date().toISOString(),
  };
  emit(event);
}

export function logBrainComplete(
  requestId: string,
  intent: TraderBrainIntent,
  status: BrainExecutionStatus,
  totalDurationMs: number,
  sectionNames: string[],
  openAiUsed: boolean,
  warningCount: number,
): void {
  const event: BrainCompleteEvent = {
    event: "trader_brain_complete",
    requestId,
    intent,
    status,
    totalDurationMs,
    sectionNames,
    openAiUsed,
    warningCount,
    ts: new Date().toISOString(),
  };
  emit(event);
}

export function logBrainFailure(
  requestId: string,
  intent: TraderBrainIntent,
  safeErrorCode: string,
  durationMs: number,
): void {
  const event: BrainFailureEvent = {
    event: "trader_brain_failure",
    requestId,
    intent,
    safeErrorCode,
    durationMs,
    ts: new Date().toISOString(),
  };
  emit(event);
}

// ---------------------------------------------------------------------------
// Memory / follow-up telemetry (Sprint 5.2)
// ---------------------------------------------------------------------------

interface BrainMemoryEvent {
  event: "trader_brain_memory";
  requestId: string;
  eventType: "context_hit" | "context_miss" | "follow_up_resolved" | "fresh_search" | "context_reset";
  followUpKind?: string;
  intent?: string;
  ts: string;
}

export function logBrainMemory(
  requestId: string,
  eventType: BrainMemoryEvent["eventType"],
  extras?: { followUpKind?: string; intent?: string },
): void {
  const event: BrainMemoryEvent = {
    event: "trader_brain_memory",
    requestId,
    eventType,
    ...(extras?.followUpKind ? { followUpKind: extras.followUpKind } : {}),
    ...(extras?.intent ? { intent: extras.intent } : {}),
    ts: new Date().toISOString(),
  };
  emit(event);
}

// ---------------------------------------------------------------------------
// Fallback event — emitted when Brain fails and the request is handed off to
// the legacy callOpenAi path.  No PII; reason is a safe error-code string.
// ---------------------------------------------------------------------------

interface BrainFallbackEvent {
  event: "trader_brain_fallback";
  requestId: string;
  intent: string;      // may be "unknown" if classification failed
  fallbackReason: string;
  durationMs: number;
  ts: string;
}

export function logBrainFallback(
  requestId: string,
  intent: string,
  fallbackReason: string,
  durationMs: number,
): void {
  const safeReason = fallbackReason.replace(/user|account|position|balance|key|token|secret/gi, "[redacted]").slice(0, 120);
  const event: BrainFallbackEvent = {
    event: "trader_brain_fallback",
    requestId,
    intent,
    fallbackReason: safeReason,
    durationMs,
    ts: new Date().toISOString(),
  };
  emit(event);
}
