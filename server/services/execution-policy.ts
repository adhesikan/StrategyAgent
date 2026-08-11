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
 * Sprint 2.8.6: "test_live" added.
 */
export function getExecutionMode(): ExecutionMode {
  const raw = (process.env.BROKER_EXECUTION_MODE ?? "").trim().toLowerCase();
  if (raw === "sandbox") return "sandbox";
  if (raw === "test_live") return "test_live";
  if (raw === "production") return "production";
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

// ─────────────────────────────────────────────────────────────────────────────
// TEST_LIVE SAFETY GATES (Sprint 2.8.6)
// ALL conditions must be true simultaneously. Never mix with PRODUCTION.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether TEST_LIVE execution is actively armed.
 * Requires EXECUTION_TEST_LIVE_ARMED=true AND (optionally) not past EXECUTION_TEST_LIVE_ARMED_UNTIL.
 */
export function isTestLiveArmed(): boolean {
  const armed = (process.env.EXECUTION_TEST_LIVE_ARMED ?? "").trim().toLowerCase();
  if (armed !== "true") return false;
  // Optional expiry: EXECUTION_TEST_LIVE_ARMED_UNTIL=2026-08-15T18:00:00Z
  const until = (process.env.EXECUTION_TEST_LIVE_ARMED_UNTIL ?? "").trim();
  if (until) {
    const expiry = new Date(until).getTime();
    if (isNaN(expiry)) return false; // invalid date string → treat as not armed
    if (Date.now() > expiry) return false; // arming has expired
  }
  return true;
}

/**
 * Comma-separated allowlist of account IDs permitted in TEST_LIVE.
 * Empty array = allowlist not configured (all blocked if TEST_LIVE and this is required).
 * The submission service enforces this — empty env var blocks all accounts.
 */
export function getTestLiveAllowlistedAccounts(): string[] {
  const raw = (process.env.EXECUTION_TEST_ACCOUNT_ALLOWLIST ?? "").trim();
  if (!raw) return [];
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * Comma-separated allowlist of symbols permitted in TEST_LIVE.
 * Empty array = allowlist not configured (all blocked if TEST_LIVE and this is required).
 */
export function getTestLiveAllowlistedSymbols(): string[] {
  const raw = (process.env.EXECUTION_TEST_SYMBOL_ALLOWLIST ?? "").trim();
  if (!raw) return [];
  return raw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
}

/**
 * Maximum notional (USD) for a single TEST_LIVE order.
 * null = not configured (cap not enforced).
 */
export function getTestLiveMaxNotional(): number | null {
  const raw = (process.env.EXECUTION_TEST_MAX_NOTIONAL ?? "").trim();
  if (!raw) return null;
  const n = parseFloat(raw);
  return isNaN(n) || n <= 0 ? null : n;
}

/**
 * Maximum equity share quantity for a single TEST_LIVE order.
 * null = not configured.
 */
export function getTestLiveMaxEquityQty(): number | null {
  const raw = (process.env.EXECUTION_TEST_MAX_EQUITY_QTY ?? "").trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return isNaN(n) || n <= 0 ? null : n;
}

/**
 * Maximum option contracts for a single TEST_LIVE order.
 * null = not configured.
 */
export function getTestLiveMaxOptionContracts(): number | null {
  const raw = (process.env.EXECUTION_TEST_MAX_OPTION_CONTRACTS ?? "").trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return isNaN(n) || n <= 0 ? null : n;
}

/**
 * Check the full TEST_LIVE safety gate.
 * Returns { open: true } only when ALL conditions are simultaneously met.
 * This is the single authoritative check — never bypass it.
 */
export function isTestLiveSafetyGateOpen(
  accountRef: string,
  symbol: string,
  estimatedNotional: number | null,
  quantity: number,
  instrumentType: string,
): { open: boolean; failedGates: string[] } {
  const failedGates: string[] = [];

  // Global execution must be enabled
  if (!isExecutionEnabled()) failedGates.push("BROKER_EXECUTION_ENABLED");
  // Mode must be test_live
  if (getExecutionMode() !== "test_live") failedGates.push("BROKER_EXECUTION_MODE");
  // Armed gate
  if (!isTestLiveArmed()) failedGates.push("EXECUTION_TEST_LIVE_ARMED");

  // Account allowlist (required — empty = all blocked)
  const accounts = getTestLiveAllowlistedAccounts();
  if (accounts.length === 0 || !accounts.includes(accountRef)) {
    failedGates.push("EXECUTION_TEST_ACCOUNT_ALLOWLIST");
  }

  // Symbol allowlist (required — empty = all blocked)
  const symbols = getTestLiveAllowlistedSymbols();
  if (symbols.length === 0 || !symbols.includes(symbol.toUpperCase())) {
    failedGates.push("EXECUTION_TEST_SYMBOL_ALLOWLIST");
  }

  // Notional cap
  const maxNotional = getTestLiveMaxNotional();
  if (maxNotional !== null && estimatedNotional !== null && estimatedNotional > maxNotional) {
    failedGates.push("EXECUTION_TEST_MAX_NOTIONAL");
  }

  // Quantity caps
  if (instrumentType === "equity") {
    const maxQty = getTestLiveMaxEquityQty();
    if (maxQty !== null && quantity > maxQty) failedGates.push("EXECUTION_TEST_MAX_EQUITY_QTY");
  } else {
    const maxContracts = getTestLiveMaxOptionContracts();
    if (maxContracts !== null && quantity > maxContracts) failedGates.push("EXECUTION_TEST_MAX_OPTION_CONTRACTS");
  }

  return { open: failedGates.length === 0, failedGates };
}

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
