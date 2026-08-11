/**
 * server/services/execution-policy.ts
 *
 * Sprint 2.8.0 — Execution Policy & Global Kill Switch
 *
 * Canonical execution kill switch and policy engine.
 *
 * Environment variables:
 *   BROKER_EXECUTION_ENABLED=false   (default: false — execution disabled)
 *   BROKER_EXECUTION_MODE=disabled|sandbox|production  (default: disabled)
 *   TRADIER_EXECUTION_ENABLED=false   (default: false)
 *   TRADESTATION_EXECUTION_ENABLED=false  (default: false)
 *
 * PRECEDENCE RULE:
 *   BROKER_EXECUTION_ENABLED=false overrides all provider-specific flags.
 *   Even if TRADIER_EXECUTION_ENABLED=true, execution remains DISABLED when
 *   BROKER_EXECUTION_ENABLED is false.
 *
 * PRODUCTION DEFAULT: false / disabled.
 * Execution cannot be enabled merely because a broker OAuth is connected.
 */

import type { ExecutionMode, ExecutionPolicy } from "@shared/execution-types";

// ─────────────────────────────────────────────────────────────────────────────
// KILL SWITCH READS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether global broker execution is enabled.
 * Default: FALSE. Missing or invalid → FALSE.
 * This is the master kill switch.
 */
export function isExecutionEnabled(): boolean {
  const raw = process.env.BROKER_EXECUTION_ENABLED ?? "";
  return raw.trim().toLowerCase() === "true";
}

/**
 * Current execution mode.
 * Default: "disabled". Invalid value → "disabled".
 * Do not infer production from NODE_ENV.
 */
export function getExecutionMode(): ExecutionMode {
  const raw = (process.env.BROKER_EXECUTION_MODE ?? "").trim().toLowerCase();
  if (raw === "sandbox" || raw === "production") return raw;
  return "disabled";
}

/**
 * Whether Tradier execution is enabled.
 * ALWAYS returns false when global kill switch is off.
 */
export function isTradierExecutionEnabled(): boolean {
  if (!isExecutionEnabled()) return false;
  const raw = process.env.TRADIER_EXECUTION_ENABLED ?? "";
  return raw.trim().toLowerCase() === "true";
}

/**
 * Whether TradeStation execution is enabled.
 * ALWAYS returns false when global kill switch is off.
 */
export function isTradeStationExecutionEnabled(): boolean {
  if (!isExecutionEnabled()) return false;
  const raw = process.env.TRADESTATION_EXECUTION_ENABLED ?? "";
  return raw.trim().toLowerCase() === "true";
}

/**
 * Whether execution is enabled for a specific provider.
 * ALWAYS returns false when global kill switch is off.
 */
export function isProviderExecutionEnabled(provider: string): boolean {
  if (!isExecutionEnabled()) return false;
  const p = provider.toLowerCase();
  if (p === "tradier") return isTradierExecutionEnabled();
  if (p === "tradestation") return isTradeStationExecutionEnabled();
  // Any unknown provider: disabled by default
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION POLICY OBJECT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the current canonical execution policy.
 * All safety requirements are TRUE by default.
 * Client cannot disable any safeguard.
 */
export function getExecutionPolicy(): ExecutionPolicy {
  return {
    executionMode: getExecutionMode(),
    executionEnabled: isExecutionEnabled(),
    requireTradePlan: true,
    requireFreshLifecycle: true,
    requireFreshQuotes: true,
    requireRiskAnalysis: true,
    requireBrokerConnection: true,
    requireAccountValidation: true,
    requirePermissions: true,
    requireBuyingPower: true,
    requirePositionValidation: true,
    requireExplicitConfirmation: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD MIDDLEWARE HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a structured error response when execution is disabled.
 * Use this in all order-capable route handlers.
 */
export function getExecutionDisabledResponse() {
  return {
    error: "Order submission is currently disabled.",
    code: "EXECUTION_DISABLED",
    executionEnabled: false,
    executionMode: getExecutionMode(),
  };
}

/**
 * Asserts that no client-submitted fields can bypass safety checks.
 * Returns the list of forbidden fields found in the request body.
 * If any are present, the handler must reject the request.
 */
export function detectSafetyBypassAttempt(
  body: Record<string, unknown>
): string[] {
  const FORBIDDEN = [
    "skipQuoteValidation",
    "skipBuyingPower",
    "skipPermissions",
    "forceExecute",
    "ignoreInvalidation",
    "overrideExecution",
    "bypassPreflight",
    "skipLifecycle",
    "skipRisk",
  ];
  return FORBIDDEN.filter((k) => k in body);
}
