// Structured Operational Logging — Sprint 2.3.6
//
// Emits JSON-structured log events for key pipelines.
// Consumed by Railway / any log aggregation system that expects JSON lines.
//
// Rules:
//   - never log secrets, credentials, tokens, API keys, or PII
//   - errorMessage is truncated to 500 chars before logging
//   - stack traces are truncated to first 6 frames
//   - all events include timestamp and event name

export type LogLevel = "info" | "warn" | "error";

export interface StructuredEvent {
  event:        string;
  timestamp?:   string;
  durationMs?:  number;
  // counts
  processed?:   number;
  remaining?:   number;
  count?:       number;
  // error
  errorCode?:   string | null;
  errorMessage?: string | null;
  // free-form extra fields
  [key: string]: unknown;
}

export function logStructured(level: LogLevel, event: StructuredEvent): void {
  const payload: Record<string, unknown> = {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  };

  // Redact anything that looks like a secret
  for (const key of Object.keys(payload)) {
    if (/key|token|secret|password|auth|credential|bearer/i.test(key)) {
      payload[key] = "[REDACTED]";
    }
  }

  // Truncate error message
  if (typeof payload.errorMessage === "string") {
    payload.errorMessage = payload.errorMessage.slice(0, 500);
  }

  // Truncate stack
  if (typeof payload.stack === "string") {
    payload.stack = payload.stack.split("\n").slice(0, 6).join(" | ");
  }

  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

// ---------------------------------------------------------------------------
// Named event helpers — one per critical pipeline
// ---------------------------------------------------------------------------

// Scanner
export const log = {
  scannerStarted:   (meta?: Record<string, unknown>) =>
    logStructured("info", { event: "scanner_started", ...meta }),
  scannerCompleted: (meta: { count?: number; durationMs?: number } & Record<string, unknown>) =>
    logStructured("info", { event: "scanner_completed", ...meta }),
  scannerFailed:    (meta: { errorCode?: string; errorMessage?: string } & Record<string, unknown>) =>
    logStructured("error", { event: "scanner_failed", ...meta }),

  // Ranking
  rankingStarted:   (meta?: Record<string, unknown>) =>
    logStructured("info", { event: "ranking_started", ...meta }),
  rankingCompleted: (meta: { count?: number; durationMs?: number } & Record<string, unknown>) =>
    logStructured("info", { event: "ranking_completed", ...meta }),
  rankingFailed:    (meta: { errorCode?: string; errorMessage?: string } & Record<string, unknown>) =>
    logStructured("error", { event: "ranking_failed", ...meta }),

  // Intelligence precompute
  intelligencePrecomputeStarted:    (meta?: Record<string, unknown>) =>
    logStructured("info", { event: "intelligence_precompute_started", ...meta }),
  intelligencePrecomputeCompleted:  (meta: { sectorCount?: number; themeCount?: number; durationMs?: number } & Record<string, unknown>) =>
    logStructured("info", { event: "intelligence_precompute_completed", ...meta }),
  intelligencePrecomputeFailed:     (meta: { errorCode?: string; errorMessage?: string } & Record<string, unknown>) =>
    logStructured("error", { event: "intelligence_precompute_failed", ...meta }),

  // Institutional ingestion
  ingestionStarted:   (meta?: Record<string, unknown>) =>
    logStructured("info", { event: "institutional_ingestion_started", ...meta }),
  ingestionProgress:  (meta: { processed?: number; remaining?: number } & Record<string, unknown>) =>
    logStructured("info", { event: "institutional_ingestion_progress", ...meta }),
  ingestionCompleted: (meta: { processed?: number; durationMs?: number } & Record<string, unknown>) =>
    logStructured("info", { event: "institutional_ingestion_completed", ...meta }),
  ingestionPartial:   (meta: { processed?: number; remaining?: number; errorCode?: string } & Record<string, unknown>) =>
    logStructured("warn", { event: "institutional_ingestion_partial", ...meta }),
  ingestionFailed:    (meta: { errorCode?: string; errorMessage?: string } & Record<string, unknown>) =>
    logStructured("error", { event: "institutional_ingestion_failed", ...meta }),

  // Mapping pipeline
  mappingStarted:    (meta?: Record<string, unknown>) =>
    logStructured("info", { event: "mapping_pipeline_started", ...meta }),
  mappingCompleted:  (meta: { count?: number; durationMs?: number } & Record<string, unknown>) =>
    logStructured("info", { event: "mapping_pipeline_completed", ...meta }),
  mappingFailed:     (meta: { errorCode?: string; errorMessage?: string } & Record<string, unknown>) =>
    logStructured("error", { event: "mapping_pipeline_failed", ...meta }),

  // Symbol enrichment
  enrichmentStarted:   (meta?: Record<string, unknown>) =>
    logStructured("info", { event: "symbol_enrichment_started", ...meta }),
  enrichmentCompleted: (meta: { enriched?: number; failed?: number; pctAfter?: number } & Record<string, unknown>) =>
    logStructured("info", { event: "symbol_enrichment_completed", ...meta }),
  enrichmentFailed:    (meta: { errorMessage?: string } & Record<string, unknown>) =>
    logStructured("error", { event: "symbol_enrichment_failed", ...meta }),
};
