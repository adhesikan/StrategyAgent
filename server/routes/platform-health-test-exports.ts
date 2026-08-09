// ---------------------------------------------------------------------------
// Test export shim — Sprint 2.5.3B
//
// Re-exports pure computation functions from platform-health.ts so that
// unit tests can import them without bootstrapping the full Express app.
//
// These functions are pure (no DB, no network, no AI calls) and are safe
// to call in any test environment.
// ---------------------------------------------------------------------------

export {
  computeOperationsSummary,
  computePipelineStages,
  computeDataFreshness,
} from "./platform-health-internals";
