/**
 * server/services/execution-preflight-service.ts
 *
 * Sprint 2.8.0 — Execution Preflight Service
 *
 * Pure computation service. Produces ExecutionPreflightResult for a saved Trade Plan.
 * Injectable dependencies for testing — no static imports of I/O services.
 *
 * This service NEVER:
 *   - calls placeOrder, submitOrder, replaceOrder, cancelOrder
 *   - submits any broker request
 *   - modifies trade plans
 *   - stores approval flags
 *
 * COMPLIANCE LANGUAGE:
 *   Use: "Execution Preflight", "Broker Readiness", "Account Capability",
 *        "Quote Validation", "Planning Constraint", "Execution Blocker"
 *   Never: "Trade Approved", "Ready to Trade", "Recommended Order"
 */

import crypto from "crypto";
import type {
  ExecutionPreflightResult,
  ExecutionPreflightStatus,
  ValidationDimension,
  ValidationStatus,
  PreflightBlocker,
  PreflightWarning,
  ExecutionBlockerCode,
  ExecutionWarningCode,
  ConfirmationRequirements,
  ExecutionAuditEvent,
  ExecutionAuditEventType,
  ExecutionAuditMetadata,
  TradePlanReadiness,
  BrokerExecutionReadiness,
} from "@shared/execution-types";
import {
  EXECUTION_FRESHNESS_THRESHOLDS,
  EXECUTION_PREFLIGHT_DISCLAIMER,
  EXECUTION_OPTIONS_DISCLOSURE,
} from "@shared/execution-types";
import { getExecutionPolicy, isExecutionEnabled, getExecutionMode } from "./execution-policy";
import type { BrokerExecutionAdapter } from "./broker-execution-adapter";

// ─────────────────────────────────────────────────────────────────────────────
// INJECTABLE DEPENDENCIES
// ─────────────────────────────────────────────────────────────────────────────

export interface PreflightDependencies {
  /** Broker adapter — read-only */
  brokerAdapter: BrokerExecutionAdapter;

  /** Load a trade plan by ID (returns null if not found) */
  getTradePlan(planId: string, userId: string): Promise<StoredTradePlan | null>;

  /** Get the latest lifecycle result for a trade plan */
  getLifecycleResult(planId: string, userId: string): Promise<StoredLifecycleResult | null>;

  /** Persist a preflight result — called after computation */
  savePreflight(result: ExecutionPreflightResult): Promise<void>;

  /** Persist an audit event — append-only */
  saveAuditEvent(event: ExecutionAuditEvent): Promise<void>;

  /** Current timestamp override for tests */
  now?(): Date;
}

export interface StoredTradePlan {
  id: string;
  userId: string;
  symbol: string;
  planType: "EQUITY" | "OPTIONS";
  status: string;
  archivedAt?: Date | null;
  riskSnapshot?: Record<string, unknown> | null;
  structureSnapshot?: Record<string, unknown> | null;
  planningSnapshot?: Record<string, unknown> | null;
  updatedAt?: Date | null;
  version: number;
  limitations?: string[];
}

export interface StoredLifecycleResult {
  planId: string;
  lifecycleState: string; // "CURRENT" | "REQUIRES_REVIEW" | "THESIS_INVALIDATED" | "DATA_STALE" | "UNKNOWN" | etc.
  evaluatedAt?: Date | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PREFLIGHT INPUT
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionPreflightInput {
  tradePlanId: string;
  userId: string;
  /** Optional: client-requested account ref; server validates ownership */
  requestedAccountRef?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export async function runExecutionPreflight(
  input: ExecutionPreflightInput,
  deps: PreflightDependencies
): Promise<ExecutionPreflightResult> {
  const startMs = Date.now();
  const now = deps.now ? deps.now() : new Date();
  const id = crypto.randomUUID();
  const policy = getExecutionPolicy();
  const executionMode = getExecutionMode();

  await emitAuditEvent(deps, {
    id: crypto.randomUUID(),
    userId: input.userId,
    tradePlanId: input.tradePlanId,
    eventType: "PREFLIGHT_STARTED",
    occurredAt: now.toISOString(),
    metadata: { executionMode, planType: "UNKNOWN", durationMs: 0 },
  });

  const executionDisabled = !isExecutionEnabled();

  // ── 1. Load trade plan (always — needed for TPR even when execution disabled) ──
  const plan = await deps.getTradePlan(input.tradePlanId, input.userId);

  if (!plan) {
    return buildFailResult(id, input, now, [
      { code: "TRADE_PLAN_NOT_FOUND", message: "Trade Plan not found or does not belong to your account.", dimension: "tradePlan" },
    ]);
  }

  if (plan.archivedAt) {
    return buildFailResult(id, input, now, [
      { code: "TRADE_PLAN_ARCHIVED", message: "This Trade Plan has been archived.", dimension: "tradePlan" },
    ]);
  }

  // ── 2. If execution is globally disabled: compute TPR only, skip broker calls ──
  //    Sprint 2.8.7A: Trade Plan Readiness is independent of execution being enabled.
  //    Users should still see plan readiness even when the kill switch is off.
  if (executionDisabled) {
    await emitAuditEvent(deps, {
      id: crypto.randomUUID(),
      userId: input.userId,
      tradePlanId: input.tradePlanId,
      eventType: "EXECUTION_DISABLED_ATTEMPT",
      occurredAt: now.toISOString(),
      metadata: { executionMode, status: "EXECUTION_DISABLED" },
    });

    // Compute broker-independent TPR even in disabled mode
    const lifecycleResultDisabled = await deps.getLifecycleResult(input.tradePlanId, input.userId).catch(() => null);
    const disabledBlockers: PreflightBlocker[] = [];
    const disabledWarnings: PreflightWarning[] = [];
    const tprTradePlanDim = buildTradePlanDimension(plan);
    const tprLifecycleDim = buildLifecycleDimension(lifecycleResultDisabled, now, disabledBlockers, disabledWarnings);
    const tprFreshnessDim = buildFreshnessDimension(plan, lifecycleResultDisabled, now);
    const tprRiskDim = buildRiskDimension(plan.riskSnapshot, plan.updatedAt, now, disabledBlockers, disabledWarnings);
    const tprConstraintDim = buildPlanningConstraintDimension(plan.planningSnapshot, disabledBlockers, disabledWarnings);
    const tprResult = computeTradePlanReadiness(tprTradePlanDim, tprLifecycleDim, tprFreshnessDim, tprRiskDim, tprConstraintDim);

    const berDisabled: BrokerExecutionReadiness = {
      status: "NOT_CONNECTED",
      label: "Execution Disabled",
      brokerConnected: false,
      dimensions: {
        brokerConnection: { status: "SKIPPED", label: "Broker Connection", note: "Execution disabled." },
        brokerAccount:    { status: "SKIPPED", label: "Broker Account",    note: "Execution disabled." },
        permissions:      { status: "SKIPPED", label: "Broker Permissions",note: "Execution disabled." },
        buyingPower:      { status: "SKIPPED", label: "Buying Power",      note: "Execution disabled." },
        position:         { status: "SKIPPED", label: "Position Requirements", note: "Execution disabled." },
        quote:            { status: "SKIPPED", label: "Quote Validation",  note: "Execution disabled." },
        structure:        { status: "SKIPPED", label: "Structure Validation", note: "Execution disabled." },
      },
    };

    const disabledDim: ValidationDimension = { status: "SKIPPED", label: "—", note: "Execution disabled." };
    const result: ExecutionPreflightResult = {
      id,
      tradePlanId: input.tradePlanId,
      userId: input.userId,
      evaluatedAt: now.toISOString(),
      overallStatus: "EXECUTION_DISABLED",
      tradePlanValidation: tprTradePlanDim,
      lifecycleValidation: tprLifecycleDim,
      freshnessValidation: tprFreshnessDim,
      brokerValidation: disabledDim,
      accountValidation: disabledDim,
      permissionsValidation: disabledDim,
      buyingPowerValidation: disabledDim,
      positionValidation: disabledDim,
      quoteValidation: disabledDim,
      structureValidation: disabledDim,
      riskValidation: tprRiskDim,
      confirmationRequirements: buildConfirmationRequirements(plan.planType),
      blockers: [{ code: "EXECUTION_DISABLED", message: "Order submission is currently disabled. This preflight checks technical readiness only.", dimension: "global" }],
      warnings: [],
      limitations: [EXECUTION_PREFLIGHT_DISCLAIMER],
      executionMode,
      methodologyVersion: "2.8.7a",
      tradePlanReadiness: tprResult,
      brokerExecutionReadiness: berDisabled,
      executionAvailable: false,
    };
    await deps.savePreflight(result);
    return result;
  }

  // ── 3. Run all dimension checks in parallel ─────────────────────────────
  const [
    lifecycle,
    broker,
    accounts,
    positions,
  ] = await Promise.allSettled([
    deps.getLifecycleResult(input.tradePlanId, input.userId),
    deps.brokerAdapter.getConnectionStatus(input.userId),
    deps.brokerAdapter.listAccounts(input.userId),
    deps.brokerAdapter.getPositions(input.userId),
  ]);

  const lifecycleResult = lifecycle.status === "fulfilled" ? lifecycle.value : null;
  const brokerStatus = broker.status === "fulfilled" ? broker.value : null;
  const accountList = accounts.status === "fulfilled" ? accounts.value : [];
  const positionList = positions.status === "fulfilled" ? positions.value : [];

  // ── 4. Account resolution ───────────────────────────────────────────────
  let resolvedAccountRef: string | null = null;
  let resolvedAccountMasked: string | undefined;
  if (input.requestedAccountRef) {
    const owned = accountList.find(a => a.accountRef === input.requestedAccountRef);
    if (owned) {
      resolvedAccountRef = owned.accountRef;
      resolvedAccountMasked = owned.accountIdMasked;
    }
    // else: ACCOUNT_NOT_OWNED blocker will be added below
  } else if (accountList.length === 1) {
    resolvedAccountRef = accountList[0].accountRef;
    resolvedAccountMasked = accountList[0].accountIdMasked;
  }
  // Multiple accounts without selection → warning added below

  // ── 5. Get buying power + quote in parallel (only if broker connected) ──
  let buyingPower = null;
  let quoteValidation = null;
  let permissionsResult = null;
  let optionContracts: Array<{ symbol: string; valid: boolean; expired: boolean }> = [];

  if (brokerStatus?.connected && resolvedAccountRef) {
    const parallelResults = await Promise.allSettled([
      deps.brokerAdapter.getBuyingPower(input.userId, resolvedAccountRef),
      deps.brokerAdapter.getQuoteValidation(input.userId, plan.symbol),
      deps.brokerAdapter.getAccountCapabilities(input.userId, resolvedAccountRef),
    ]);

    buyingPower = parallelResults[0].status === "fulfilled" ? parallelResults[0].value : null;
    quoteValidation = parallelResults[1].status === "fulfilled" ? parallelResults[1].value : null;
    permissionsResult = parallelResults[2].status === "fulfilled" ? parallelResults[2].value : null;

    // Validate options contracts if OPTIONS plan with structure
    if (plan.planType === "OPTIONS" && plan.structureSnapshot) {
      const contractSymbols = extractContractSymbols(plan.structureSnapshot);
      if (contractSymbols.length > 0) {
        const contractChecks = await Promise.allSettled(
          contractSymbols.map(sym => deps.brokerAdapter.validateOptionsContract(input.userId, sym))
        );
        optionContracts = contractChecks.map((r, i) => ({
          symbol: contractSymbols[i],
          valid: r.status === "fulfilled" && r.value.exists && !r.value.isExpired,
          expired: r.status === "fulfilled" ? r.value.isExpired : false,
        }));
      }
    }
  }

  // ── 6. Build dimension results ──────────────────────────────────────────
  const blockers: PreflightBlocker[] = [];
  const warnings: PreflightWarning[] = [];
  const brokerIsConnected = brokerStatus?.connected ?? false;

  // Trade Plan dimension
  const tradePlanDim = buildTradePlanDimension(plan);

  // Lifecycle dimension
  const lifecycleDim = buildLifecycleDimension(lifecycleResult, now, blockers, warnings);

  // Freshness dimension
  const freshnessDim = buildFreshnessDimension(plan, lifecycleResult, now);

  // Risk validation dimension (before constraints — needed for TPR)
  const riskDim = buildRiskDimension(plan.riskSnapshot, plan.updatedAt, now, blockers, warnings);

  // Planning constraint dimension (now returns ValidationDimension)
  const constraintDim = buildPlanningConstraintDimension(plan.planningSnapshot, blockers, warnings);

  // Broker connection dimension (Sprint 2.8.7A: no blocker when simply absent)
  const brokerDim = buildBrokerDimension(brokerStatus, blockers, deps);

  // Account dimension
  const accountDim = buildAccountDimension(
    accountList, resolvedAccountRef, resolvedAccountMasked,
    input.requestedAccountRef, blockers, warnings, brokerIsConnected
  );

  // Permissions dimension
  const permissionsDim = buildPermissionsDimension(
    permissionsResult, plan.planType, plan.structureSnapshot, blockers, warnings, brokerIsConnected
  );

  // Buying power dimension
  const buyingPowerDim = buildBuyingPowerDimension(buyingPower, plan, blockers, warnings, brokerIsConnected);

  // Position validation dimension
  const positionDim = buildPositionDimension(
    positionList, plan, brokerIsConnected, blockers, warnings
  );

  // Quote validation dimension
  const quoteDim = buildQuoteDimension(quoteValidation, optionContracts, plan.planType, blockers, warnings, brokerIsConnected);

  // Structure validation dimension
  const structureDim = buildStructureDimension(plan.structureSnapshot, plan.planType, optionContracts, blockers, brokerIsConnected);

  // Multiple accounts warning (only when broker connected)
  if (brokerIsConnected && accountList.length > 1 && !resolvedAccountRef) {
    warnings.push({
      code: "MULTI_ACCOUNT_SELECTION_REQUIRED",
      message: "Multiple broker accounts found. An account must be selected before any future order can be prepared.",
      dimension: "account",
    });
  }

  // ── 6b. Compute two-layer readiness (Sprint 2.8.7A) ──────────────────
  const tradePlanReadiness = computeTradePlanReadiness(
    tradePlanDim, lifecycleDim, freshnessDim, riskDim, constraintDim
  );

  const brokerExecutionReadiness = computeBrokerExecutionReadiness(
    brokerIsConnected, brokerStatus?.provider,
    brokerDim, accountDim, permissionsDim, buyingPowerDim, positionDim, quoteDim, structureDim
  );

  // ── 7. Determine overall status ─────────────────────────────────────────
  const overallStatus = determineOverallStatus(blockers, warnings, brokerIsConnected);

  // ── 8. Build validUntil ─────────────────────────────────────────────────
  const validUntil = overallStatus === "PASS" || overallStatus === "REQUIRES_REVIEW"
    ? new Date(now.getTime() + EXECUTION_FRESHNESS_THRESHOLDS.preflightResultSec * 1000).toISOString()
    : undefined;

  // ── 9. Build limitations ────────────────────────────────────────────────
  const limitations: string[] = [
    EXECUTION_PREFLIGHT_DISCLAIMER,
    ...(plan.planType === "OPTIONS" ? [EXECUTION_OPTIONS_DISCLOSURE] : []),
    ...(plan.limitations ?? []).slice(0, 5),
  ];

  const durationMs = Date.now() - startMs;

  // ── 10. Emit completion audit event ────────────────────────────────────
  const auditMetadata: ExecutionAuditMetadata = {
    provider: brokerStatus?.provider,
    planType: plan.planType,
    status: overallStatus,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    hasFreshQuote: quoteValidation?.isFresh ?? false,
    hasPermissions: permissionsResult?.equityTrading != null,
    durationMs,
    executionMode,
  };

  await emitAuditEvent(deps, {
    id: crypto.randomUUID(),
    userId: input.userId,
    tradePlanId: input.tradePlanId,
    eventType: blockers.length > 0 ? "PREFLIGHT_FAILED" : "PREFLIGHT_COMPLETED",
    occurredAt: now.toISOString(),
    provider: brokerStatus?.provider,
    accountRefMasked: resolvedAccountMasked,
    metadata: auditMetadata,
  });

  const result: ExecutionPreflightResult = {
    id,
    tradePlanId: input.tradePlanId,
    userId: input.userId,
    evaluatedAt: now.toISOString(),
    overallStatus,
    tradePlanValidation: tradePlanDim,
    lifecycleValidation: lifecycleDim,
    freshnessValidation: freshnessDim,
    brokerValidation: brokerDim,
    accountValidation: accountDim,
    permissionsValidation: permissionsDim,
    buyingPowerValidation: buyingPowerDim,
    positionValidation: positionDim,
    quoteValidation: quoteDim,
    structureValidation: structureDim,
    riskValidation: riskDim,
    confirmationRequirements: buildConfirmationRequirements(plan.planType),
    blockers,
    warnings,
    limitations,
    validUntil,
    executionMode,
    provider: brokerStatus?.provider,
    methodologyVersion: "2.8.7a",
    // ── Sprint 2.8.7A: Two-layer readiness (additive fields) ──────────────
    tradePlanReadiness,
    brokerExecutionReadiness,
    executionAvailable: overallStatus === "PASS",
  };

  await deps.savePreflight(result);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSION BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function buildTradePlanDimension(plan: StoredTradePlan): ValidationDimension {
  if (!plan.structureSnapshot) {
    return { status: "REQUIRES_REVIEW", label: "Trade Plan", note: "No selected structure found in this plan." };
  }
  if (!plan.planningSnapshot) {
    return { status: "FAIL", label: "Trade Plan", note: "Planning context missing." };
  }
  return { status: "PASS", label: "Trade Plan" };
}

function buildLifecycleDimension(
  lifecycle: StoredLifecycleResult | null,
  now: Date,
  blockers: PreflightBlocker[],
  warnings: PreflightWarning[]
): ValidationDimension {
  if (!lifecycle) {
    warnings.push({ code: "DATA_PARTIALLY_UNAVAILABLE", message: "Lifecycle state not available. Run lifecycle evaluation first.", dimension: "lifecycle" });
    return { status: "UNAVAILABLE", label: "Research Lifecycle", note: "Lifecycle evaluation not available." };
  }

  const state = lifecycle.lifecycleState?.toUpperCase() ?? "UNKNOWN";

  if (state === "THESIS_INVALIDATED") {
    blockers.push({ code: "THESIS_INVALIDATED", message: "Saved research invalidation condition currently observed. Review the Trade Plan before proceeding.", dimension: "lifecycle" });
    return { status: "FAIL", label: "Research Lifecycle", note: "Research thesis invalidated." };
  }

  if (state === "DATA_STALE") {
    blockers.push({ code: "TRADE_PLAN_STALE", message: "Trade Plan research data is stale. Refresh before proceeding.", dimension: "lifecycle" });
    return { status: "FAIL", label: "Research Lifecycle", note: "Research data is stale." };
  }

  if (state === "UNKNOWN") {
    blockers.push({ code: "UNKNOWN_CRITICAL_STATE", message: "Lifecycle state is unknown. Re-evaluate the Trade Plan lifecycle before proceeding.", dimension: "lifecycle" });
    return { status: "FAIL", label: "Research Lifecycle", note: "Lifecycle state unknown." };
  }

  if (state === "REQUIRES_REVIEW") {
    blockers.push({ code: "PLAN_REQUIRES_REVIEW", message: "Trade Plan requires review. Assess current conditions before proceeding.", dimension: "lifecycle" });
    return { status: "REQUIRES_REVIEW", label: "Research Lifecycle", note: "Plan requires review." };
  }

  // Check freshness of the lifecycle evaluation itself
  if (lifecycle.evaluatedAt) {
    const ageSec = (now.getTime() - new Date(lifecycle.evaluatedAt).getTime()) / 1000;
    if (ageSec > EXECUTION_FRESHNESS_THRESHOLDS.lifecycleSec) {
      warnings.push({ code: "DATA_PARTIALLY_UNAVAILABLE", message: "Lifecycle evaluation is more than 1 hour old. Consider re-evaluating.", dimension: "lifecycle" });
    }
  }

  return { status: "PASS", label: "Research Lifecycle" };
}

function buildFreshnessDimension(
  plan: StoredTradePlan,
  lifecycle: StoredLifecycleResult | null,
  now: Date
): ValidationDimension {
  const planAgeMs = plan.updatedAt ? now.getTime() - new Date(plan.updatedAt).getTime() : Infinity;
  const planAgeDays = planAgeMs / 86400000;

  if (planAgeDays > 30) {
    return { status: "REQUIRES_REVIEW", label: "Plan Freshness", note: `Trade Plan was last updated ${Math.floor(planAgeDays)} days ago.` };
  }

  if (lifecycle?.evaluatedAt) {
    const lifecycleAgeSec = (now.getTime() - new Date(lifecycle.evaluatedAt).getTime()) / 1000;
    if (lifecycleAgeSec > EXECUTION_FRESHNESS_THRESHOLDS.lifecycleSec * 2) {
      return { status: "REQUIRES_REVIEW", label: "Plan Freshness", note: "Lifecycle state is aging. Re-evaluate recommended." };
    }
  }

  return { status: "PASS", label: "Plan Freshness" };
}

function buildBrokerDimension(
  status: import("./broker-execution-adapter").BrokerConnectionStatus | null,
  blockers: PreflightBlocker[],
  _deps: PreflightDependencies
): ValidationDimension {
  // ── Sprint 2.8.7A: Broker absence is NOT_CONNECTED, not a plan blocker ──
  if (!status) {
    return { status: "NOT_CONNECTED", label: "Broker Connection", note: "Connection status unavailable." };
  }

  if (!status.connected) {
    return { status: "NOT_CONNECTED", label: "Broker Connection", note: "No broker connected." };
  }

  // Re-auth failures ARE errors — they happen while a connection is expected
  if (status.needsReauth) {
    blockers.push({ code: "BROKER_NEEDS_REAUTH", message: "Broker session expired. Reconnect your broker to continue.", dimension: "broker" });
    return { status: "FAIL", label: "Broker Connection", note: "Session requires re-authentication." };
  }

  return { status: "PASS", label: "Broker Connection", note: status.provider };
}

function buildAccountDimension(
  accounts: import("@shared/execution-types").BrokerAccount[],
  resolvedRef: string | null,
  resolvedMasked: string | undefined,
  requestedRef: string | undefined,
  blockers: PreflightBlocker[],
  warnings: PreflightWarning[],
  brokerConnected: boolean
): ValidationDimension {
  // ── Sprint 2.8.7A: Broker absent → NOT_CONNECTED, not a plan blocker ──
  if (!brokerConnected) {
    return { status: "NOT_CONNECTED", label: "Broker Account", note: "Broker connection required." };
  }

  if (accounts.length === 0) {
    blockers.push({ code: "ACCOUNT_NOT_RESOLVED", message: "No broker accounts available.", dimension: "account" });
    return { status: "FAIL", label: "Broker Account" };
  }

  if (requestedRef && !resolvedRef) {
    blockers.push({ code: "ACCOUNT_NOT_OWNED", message: "Requested account is not authorized for this connection.", dimension: "account" });
    return { status: "FAIL", label: "Broker Account", note: "Account not authorized." };
  }

  if (!resolvedRef) {
    return { status: "REQUIRES_REVIEW", label: "Broker Account", note: `${accounts.length} account(s) available. Selection required.` };
  }

  return { status: "PASS", label: "Broker Account", note: resolvedMasked };
}

function buildPermissionsDimension(
  permissions: import("@shared/execution-types").BrokerPermissions | null,
  planType: "EQUITY" | "OPTIONS",
  structure: Record<string, unknown> | undefined | null,
  blockers: PreflightBlocker[],
  warnings: PreflightWarning[],
  brokerConnected: boolean
): ValidationDimension {
  // ── Sprint 2.8.7A: Broker absent → NOT_CONNECTED, not a plan blocker ──
  if (!brokerConnected) {
    return { status: "NOT_CONNECTED", label: "Broker Permissions", note: "Broker connection required to verify permissions." };
  }

  if (!permissions || permissions.source === "unavailable") {
    warnings.push({ code: "OPTIONS_LEVEL_UNVERIFIED", message: "Broker permissions API unavailable. Permissions not verified.", dimension: "permissions" });
    return { status: "UNAVAILABLE", label: "Broker Permissions", note: "Not verifiable with this provider." };
  }

  if (planType === "OPTIONS") {
    if (permissions.optionsTrading === false) {
      blockers.push({ code: "OPTIONS_PERMISSION_INSUFFICIENT", message: "Options trading not permitted on this account.", dimension: "permissions" });
      return { status: "FAIL", label: "Broker Permissions", note: "Options not permitted." };
    }

    // Check if structure requires multi-leg
    const requiresMultiLeg = checkStructureRequiresMultiLeg(structure);
    if (requiresMultiLeg && permissions.multiLeg === false) {
      blockers.push({ code: "MULTILEG_NOT_SUPPORTED", message: "Multi-leg order not supported on this account.", dimension: "permissions" });
      return { status: "FAIL", label: "Broker Permissions", note: "Multi-leg not supported." };
    }
  }

  if (planType === "EQUITY" && permissions.equityTrading === false) {
    blockers.push({ code: "EQUITY_PERMISSION_UNAVAILABLE", message: "Equity trading not permitted on this account.", dimension: "permissions" });
    return { status: "FAIL", label: "Broker Permissions", note: "Equity trading not permitted." };
  }

  return { status: "PASS", label: "Broker Permissions" };
}

function buildBuyingPowerDimension(
  bp: import("@shared/execution-types").BrokerBalanceContext | null,
  plan: StoredTradePlan,
  blockers: PreflightBlocker[],
  warnings: PreflightWarning[],
  brokerConnected: boolean
): ValidationDimension {
  // ── Sprint 2.8.7A: Broker absent → NOT_CONFIRMED, not a plan blocker ──
  if (!brokerConnected) {
    return { status: "NOT_CONFIRMED", label: "Buying Power Availability", note: "Broker connection required for buying power verification." };
  }

  if (!bp || !bp.available) {
    blockers.push({ code: "BUYING_POWER_UNAVAILABLE", message: "Buying power information unavailable from broker.", dimension: "buyingPower" });
    return { status: "UNAVAILABLE", label: "Buying Power Availability" };
  }

  // Estimate capital requirement from planning snapshot
  const estimatedCapital = estimateCapitalRequirement(plan.planningSnapshot, plan.planType);

  if (estimatedCapital != null && bp.buyingPowerUsd != null) {
    if (estimatedCapital > bp.buyingPowerUsd) {
      blockers.push({ code: "INSUFFICIENT_BUYING_POWER", message: "Estimated capital requirement may exceed available buying power. Verify with your broker.", dimension: "buyingPower" });
      return { status: "FAIL", label: "Buying Power Availability", note: "Estimated requirement may exceed available buying power." };
    }
  }

  return { status: "PASS", label: "Buying Power Availability" };
}

function buildPositionDimension(
  positions: import("@shared/execution-types").BrokerPositionContext[],
  plan: StoredTradePlan,
  brokerConnected: boolean,
  blockers: PreflightBlocker[],
  warnings: PreflightWarning[]
): ValidationDimension {
  // ── Sprint 2.8.7A: Broker absent — use NOT_APPLICABLE / NOT_CONFIRMED ──
  if (!brokerConnected) {
    if (plan.planType !== "OPTIONS" || !plan.structureSnapshot) {
      // Equity direct purchase does not require pre-existing position
      return { status: "NOT_APPLICABLE", label: "Position Requirements", note: "No position requirement for this plan type." };
    }
    const structureType = getStructureType(plan.structureSnapshot);
    const requiresShares = SHARE_REQUIRING_STRUCTURES.has(structureType);
    if (requiresShares) {
      return { status: "NOT_CONFIRMED", label: "Position Requirements", note: `${formatStructureType(structureType)} requires underlying shares — confirmation needs broker connection.` };
    }
    return { status: "NOT_APPLICABLE", label: "Position Requirements", note: "No position requirement for this strategy." };
  }

  if (plan.planType !== "OPTIONS" || !plan.structureSnapshot) {
    return { status: "PASS", label: "Position Requirements" };
  }

  const structureType = getStructureType(plan.structureSnapshot);
  const requiresShares = SHARE_REQUIRING_STRUCTURES.has(structureType);

  if (!requiresShares) {
    return { status: "PASS", label: "Position Requirements" };
  }

  // Covered call / protective put / collar require underlying shares
  const existingPosition = positions.find(
    p => p.symbol.toUpperCase() === plan.symbol.toUpperCase()
  );
  const existingQty = existingPosition?.quantity ?? 0;
  const requiredShares = getRequiredShareCount(plan.structureSnapshot);

  if (!existingPosition || existingQty < requiredShares) {
    const code: import("@shared/execution-types").ExecutionBlockerCode =
      structureType === "covered_call" ? "INSUFFICIENT_COVERED_SHARES" : "INSUFFICIENT_PROTECTIVE_SHARES";
    blockers.push({
      code,
      message: `${formatStructureType(structureType)} requires ${requiredShares} underlying shares. Live position not confirmed.`,
      dimension: "position",
    });
    return {
      status: "FAIL",
      label: "Position Requirements",
      note: `${formatStructureType(structureType)}: shares not confirmed.`,
    };
  }

  return { status: "PASS", label: "Position Requirements" };
}

/**
 * Produce a truthful human-readable quote age string for the preflight UI note.
 *
 * Rules:
 *   Infinity  → "Quote timestamp unavailable."      (provider gave no trade time)
 *   ≥ 3600s   → "Last market quote is Xh Ym old."  (after-hours / very stale)
 *   < 3600s   → "Quote is Xs old."                 (within the same session)
 *
 * A missing timestamp MUST NEVER display as "0s old" — that implies freshness.
 * The Infinity case is the canonical fix for QUOTE_STALE with source="unavailable".
 */
export function formatPreflightQuoteAge(freshnessSec: number): string {
  if (!isFinite(freshnessSec) || freshnessSec < 0) {
    return "Quote timestamp unavailable.";
  }
  if (freshnessSec >= 3600) {
    const hours = Math.floor(freshnessSec / 3600);
    const mins = Math.floor((freshnessSec % 3600) / 60);
    return mins > 0
      ? `Last market quote is ${hours}h ${mins}m old.`
      : `Last market quote is ${hours}h old.`;
  }
  return `Quote is ${Math.round(freshnessSec)}s old.`;
}

function buildQuoteDimension(
  quoteValidation: import("@shared/execution-types").BrokerQuoteValidation | null,
  optionContracts: Array<{ symbol: string; valid: boolean; expired: boolean }>,
  planType: "EQUITY" | "OPTIONS",
  blockers: PreflightBlocker[],
  warnings: PreflightWarning[],
  brokerConnected: boolean
): ValidationDimension {
  // ── Sprint 2.8.7A: Broker absent → PLANNING_MODE, not a blocker ──
  if (!brokerConnected) {
    return { status: "PLANNING_MODE", label: "Quote Validation", note: "Planning mode — live quote validation requires broker connection." };
  }

  if (!quoteValidation) {
    blockers.push({ code: "QUOTE_STALE", message: "Underlying quote not available from broker.", dimension: "quote" });
    return { status: "UNAVAILABLE", label: "Quote Validation" };
  }

  if (!quoteValidation.isFresh) {
    blockers.push({ code: "QUOTE_STALE", message: "Underlying quote is stale. Refresh market data before proceeding.", dimension: "quote" });
    // Truthful age display — never say "0s old" when the timestamp is missing.
    // Infinity means the provider did not supply a trade timestamp (not "fresh now").
    const note = formatPreflightQuoteAge(quoteValidation.freshnessSec);
    return { status: "FAIL", label: "Quote Validation", note };
  }

  if (quoteValidation.isCrossed || quoteValidation.isZeroBid || quoteValidation.isSpreadInvalid) {
    blockers.push({ code: "QUOTE_INVALID", message: "Quote data is invalid (zero bid, crossed, or bad spread).", dimension: "quote" });
    return { status: "FAIL", label: "Quote Validation", note: "Invalid quote condition." };
  }

  // Options contract checks
  if (planType === "OPTIONS" && optionContracts.length > 0) {
    const expiredContracts = optionContracts.filter(c => c.expired);
    const unavailableContracts = optionContracts.filter(c => !c.valid && !c.expired);

    if (expiredContracts.length > 0) {
      blockers.push({ code: "CONTRACT_EXPIRED", message: `${expiredContracts.length} selected contract(s) have expired.`, dimension: "quote" });
      return { status: "FAIL", label: "Quote Validation", note: "Expired contracts in structure." };
    }

    if (unavailableContracts.length > 0) {
      blockers.push({ code: "CONTRACT_UNAVAILABLE", message: `${unavailableContracts.length} selected contract(s) unavailable.`, dimension: "quote" });
      return { status: "FAIL", label: "Quote Validation", note: "Contract(s) unavailable." };
    }
  }

  return { status: "PASS", label: "Quote Validation" };
}

function buildStructureDimension(
  structure: Record<string, unknown> | undefined | null,
  planType: "EQUITY" | "OPTIONS",
  optionContracts: Array<{ symbol: string; valid: boolean; expired: boolean }>,
  blockers: PreflightBlocker[],
  brokerConnected: boolean
): ValidationDimension {
  if (!structure) {
    return { status: "UNAVAILABLE", label: "Structure Validation", note: "No selected structure in plan." };
  }

  // ── Sprint 2.8.7A: OPTIONS without broker → PLANNING_MODE (can't validate live contracts) ──
  if (planType === "OPTIONS" && !brokerConnected) {
    return { status: "PLANNING_MODE", label: "Structure Validation", note: "Planning mode — contract validation requires broker connection." };
  }

  if (planType === "OPTIONS") {
    const allValid = optionContracts.length === 0 || optionContracts.every(c => c.valid);
    if (!allValid && optionContracts.length > 0) {
      return { status: "FAIL", label: "Structure Validation", note: "One or more structure legs unavailable." };
    }
    // Check multi-leg validity
    const legs = (structure.legs as unknown[]) ?? [];
    if (legs.length > 1) {
      const changed = optionContracts.some(c => !c.valid);
      if (changed) {
        blockers.push({ code: "STRUCTURE_CHANGED", message: "One or more option legs are no longer available. Structure must be reviewed.", dimension: "structure" });
        return { status: "FAIL", label: "Structure Validation", note: "Leg(s) no longer available." };
      }
    }
  }

  return { status: "PASS", label: "Structure Validation" };
}

function buildRiskDimension(
  riskSnapshot: Record<string, unknown> | null | undefined,
  planUpdatedAt: Date | null | undefined,
  now: Date,
  blockers: PreflightBlocker[],
  warnings: PreflightWarning[]
): ValidationDimension {
  if (!riskSnapshot) {
    warnings.push({ code: "DATA_PARTIALLY_UNAVAILABLE", message: "Risk analysis not completed for this plan.", dimension: "risk" });
    return { status: "UNAVAILABLE", label: "Risk Analysis" };
  }

  // Check risk analysis age
  const riskAsOf = riskSnapshot.calculatedAt ?? riskSnapshot.asOf ?? planUpdatedAt;
  if (riskAsOf) {
    const riskAgeSec = (now.getTime() - new Date(riskAsOf as string).getTime()) / 1000;
    if (riskAgeSec > EXECUTION_FRESHNESS_THRESHOLDS.riskAnalysisSec) {
      blockers.push({ code: "RISK_ANALYSIS_STALE", message: "Risk analysis is more than 24 hours old. Re-run before proceeding.", dimension: "risk" });
      return { status: "FAIL", label: "Risk Analysis", note: "Risk analysis stale." };
    }
  }

  return { status: "PASS", label: "Risk Analysis" };
}

/**
 * Sprint 2.8.7A: Returns a ValidationDimension AND pushes blockers when FAIL.
 * Was previously void; now also used by computeTradePlanReadiness.
 */
function buildPlanningConstraintDimension(
  planningSnapshot: Record<string, unknown> | null | undefined,
  blockers: PreflightBlocker[],
  warnings: PreflightWarning[]
): ValidationDimension {
  if (!planningSnapshot) {
    return { status: "UNAVAILABLE", label: "Planning Constraints", note: "No planning context in this plan." };
  }

  const maxLoss = planningSnapshot.maxRiskDollars ?? planningSnapshot.maxLossDollars;
  const scenarioLoss = planningSnapshot.scenarioMaxLoss ?? planningSnapshot.maxScenarioLoss;

  if (typeof maxLoss === "number" && typeof scenarioLoss === "number") {
    if (scenarioLoss > maxLoss * 1.1) { // 10% buffer
      blockers.push({
        code: "PLANNING_CONSTRAINT_EXCEEDED",
        message: "Current scenario loss estimate may exceed planning constraint. Review before proceeding.",
        dimension: "riskConstraint",
      });
      return { status: "FAIL", label: "Planning Constraints", note: "Scenario loss estimate exceeds planning constraint." };
    }
  }

  return { status: "PASS", label: "Planning Constraints" };
}

// ─────────────────────────────────────────────────────────────────────────────
// TWO-LAYER COMPUTATION (Sprint 2.8.7A)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute broker-independent Trade Plan Readiness.
 *
 * Evaluates: Trade Plan, Research Lifecycle, Plan Freshness, Risk Analysis,
 * Planning Constraints. Does NOT require a broker connection.
 *
 * INVARIANT: PASS here NEVER authorizes order preparation or broker submission.
 */
function computeTradePlanReadiness(
  tradePlanDim: ValidationDimension,
  lifecycleDim: ValidationDimension,
  freshnessDim: ValidationDimension,
  riskDim: ValidationDimension,
  constraintDim: ValidationDimension
): TradePlanReadiness {
  const dims = [tradePlanDim, lifecycleDim, freshnessDim, riskDim, constraintDim];

  // Priority: FAIL > REQUIRES_REVIEW > UNAVAILABLE > PASS
  // UNAVAILABLE means a dim could not be evaluated (e.g. risk analysis not yet run).
  // It must NOT be promoted to REQUIRES_REVIEW — that label implies human review is
  // needed, which is inaccurate when data is simply absent.
  let status: TradePlanReadiness["status"] = "PASS";
  for (const d of dims) {
    if (d.status === "FAIL") { status = "FAIL"; break; }
    if (d.status === "REQUIRES_REVIEW") { status = "REQUIRES_REVIEW"; }
    if (d.status === "UNAVAILABLE" && status === "PASS") { status = "UNAVAILABLE"; }
  }

  const label = status === "PASS"           ? "Plan Ready"
    : status === "FAIL"                     ? "Blocked"
    : status === "REQUIRES_REVIEW"          ? "Review Required"
    : /* UNAVAILABLE */                       "Not Fully Assessed";

  return {
    status,
    label,
    dimensions: {
      tradePlan: tradePlanDim,
      lifecycle: lifecycleDim,
      freshness: freshnessDim,
      risk: riskDim,
      planningConstraints: constraintDim,
    },
    limitations: [],
  };
}

/**
 * Compute broker-dependent Broker Execution Readiness.
 *
 * Reaches READY only when broker is connected, account verified, permissions
 * confirmed, and buying power / position / quote checks all pass.
 */
function computeBrokerExecutionReadiness(
  brokerConnected: boolean,
  provider: string | undefined,
  brokerDim: ValidationDimension,
  accountDim: ValidationDimension,
  permissionsDim: ValidationDimension,
  buyingPowerDim: ValidationDimension,
  positionDim: ValidationDimension,
  quoteDim: ValidationDimension,
  structureDim: ValidationDimension
): BrokerExecutionReadiness {
  if (!brokerConnected) {
    return {
      status: "NOT_CONNECTED",
      label: "Not Connected",
      brokerConnected: false,
      provider: undefined,
      dimensions: {
        brokerConnection: brokerDim,
        brokerAccount: accountDim,
        permissions: permissionsDim,
        buyingPower: buyingPowerDim,
        position: positionDim,
        quote: quoteDim,
        structure: structureDim,
      },
    };
  }

  const dims = [brokerDim, accountDim, permissionsDim, buyingPowerDim, positionDim, quoteDim, structureDim];
  let status: BrokerExecutionReadiness["status"] = "READY";
  for (const d of dims) {
    if (d.status === "FAIL") { status = "BLOCKED"; break; }
    if (d.status === "REQUIRES_REVIEW" && status !== "BLOCKED") { status = "REQUIRES_REVIEW"; }
  }

  const label = status === "READY" ? "Ready"
    : status === "REQUIRES_REVIEW" ? "Review Required"
    : "Blocked";

  return {
    status,
    label,
    brokerConnected: true,
    provider,
    dimensions: {
      brokerConnection: brokerDim,
      brokerAccount: accountDim,
      permissions: permissionsDim,
      buyingPower: buyingPowerDim,
      position: positionDim,
      quote: quoteDim,
      structure: structureDim,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERALL STATUS DETERMINATION
// ─────────────────────────────────────────────────────────────────────────────

function determineOverallStatus(
  blockers: PreflightBlocker[],
  warnings: PreflightWarning[],
  brokerConnected: boolean
): ExecutionPreflightStatus {
  if (blockers.length > 0) return "FAIL";
  if (!brokerConnected) return "UNAVAILABLE";
  const hasReview = warnings.some(w => w.code === "LIFECYCLE_REQUIRES_REVIEW" || w.code === "DATA_PARTIALLY_UNAVAILABLE");
  if (hasReview) return "REQUIRES_REVIEW";
  return "PASS";
}

// ─────────────────────────────────────────────────────────────────────────────
// FAST-PATH HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function buildDisabledResult(
  id: string,
  input: ExecutionPreflightInput,
  now: Date
): ExecutionPreflightResult {
  const disabledDim: ValidationDimension = { status: "SKIPPED", label: "—", note: "Execution disabled." };
  return {
    id,
    tradePlanId: input.tradePlanId,
    userId: input.userId,
    evaluatedAt: now.toISOString(),
    overallStatus: "EXECUTION_DISABLED",
    tradePlanValidation: disabledDim,
    lifecycleValidation: disabledDim,
    freshnessValidation: disabledDim,
    brokerValidation: disabledDim,
    accountValidation: disabledDim,
    permissionsValidation: disabledDim,
    buyingPowerValidation: disabledDim,
    positionValidation: disabledDim,
    quoteValidation: disabledDim,
    structureValidation: disabledDim,
    riskValidation: disabledDim,
    confirmationRequirements: buildConfirmationRequirements("EQUITY"),
    blockers: [{ code: "EXECUTION_DISABLED", message: "Order submission is currently disabled. This preflight checks technical readiness only.", dimension: "global" }],
    warnings: [],
    limitations: [EXECUTION_PREFLIGHT_DISCLAIMER],
    executionMode: getExecutionMode(),
    methodologyVersion: "2.8.0",
  };
}

function buildFailResult(
  id: string,
  input: ExecutionPreflightInput,
  now: Date,
  blockers: PreflightBlocker[]
): ExecutionPreflightResult {
  const failDim: ValidationDimension = { status: "FAIL", label: "—" };
  const skiDim: ValidationDimension = { status: "SKIPPED", label: "—" };
  return {
    id,
    tradePlanId: input.tradePlanId,
    userId: input.userId,
    evaluatedAt: now.toISOString(),
    overallStatus: "FAIL",
    tradePlanValidation: failDim,
    lifecycleValidation: skiDim,
    freshnessValidation: skiDim,
    brokerValidation: skiDim,
    accountValidation: skiDim,
    permissionsValidation: skiDim,
    buyingPowerValidation: skiDim,
    positionValidation: skiDim,
    quoteValidation: skiDim,
    structureValidation: skiDim,
    riskValidation: skiDim,
    confirmationRequirements: buildConfirmationRequirements("EQUITY"),
    blockers,
    warnings: [],
    limitations: [EXECUTION_PREFLIGHT_DISCLAIMER],
    executionMode: getExecutionMode(),
    methodologyVersion: "2.8.7a",
    executionAvailable: false,
  };
}

function buildConfirmationRequirements(planType: "EQUITY" | "OPTIONS"): ConfirmationRequirements {
  return {
    requireSymbolReview: true,
    requireStrategyReview: true,
    requireLegsReview: planType === "OPTIONS",
    requireQuantityReview: true,
    requireEstimatedPriceReview: true,
    requireEstimatedCapitalReview: true,
    requireMaxLossReview: true,
    requireBrokerAccountReview: true,
    requireExpirationReview: planType === "OPTIONS",
    requireWarningsAcknowledged: true,
    confirmationTtlSeconds: 120, // 2-minute TTL for future confirmation tokens
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const SHARE_REQUIRING_STRUCTURES = new Set([
  "covered_call", "protective_put", "collar",
  "covered-call", "protective-put",
]);

function getStructureType(structure: Record<string, unknown>): string {
  return String(structure.structureType ?? structure.type ?? structure.strategyType ?? "").toLowerCase();
}

function checkStructureRequiresMultiLeg(
  structure: Record<string, unknown> | null | undefined
): boolean {
  if (!structure) return false;
  const legs = (structure.legs as unknown[]) ?? [];
  return legs.length > 1;
}

function getRequiredShareCount(structure: Record<string, unknown>): number {
  const contracts = Number(structure.contractQuantity ?? structure.quantity ?? 1);
  const multiplier = Number(structure.multiplier ?? 100);
  return contracts * multiplier;
}

function formatStructureType(raw: string): string {
  return raw.replace(/_|-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function extractContractSymbols(structure: Record<string, unknown>): string[] {
  const legs = (structure.legs as any[]) ?? [];
  if (legs.length > 0) {
    return legs
      .map((l: any) => l.contractSymbol ?? l.optionSymbol ?? l.symbol ?? "")
      .filter(Boolean);
  }
  const single = structure.contractSymbol ?? structure.optionSymbol;
  return single ? [String(single)] : [];
}

function estimateCapitalRequirement(
  planningSnapshot: Record<string, unknown> | null | undefined,
  planType: "EQUITY" | "OPTIONS"
): number | null {
  if (!planningSnapshot) return null;
  const estimatedCapital = planningSnapshot.estimatedCapital ?? planningSnapshot.scenarioCapital;
  if (typeof estimatedCapital === "number") return estimatedCapital;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT EVENT HELPER
// ─────────────────────────────────────────────────────────────────────────────

async function emitAuditEvent(
  deps: PreflightDependencies,
  event: ExecutionAuditEvent
): Promise<void> {
  try {
    await deps.saveAuditEvent(event);
  } catch {
    // Never let audit persistence failure break the preflight
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DB PERSISTENCE FACTORY
// ─────────────────────────────────────────────────────────────────────────────

export async function createDbPreflightDeps(
  brokerAdapter: BrokerExecutionAdapter
): Promise<PreflightDependencies> {
  const { db } = await import("../db");
  const { executionPreflights, executionAuditEvents } = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");

  return {
    brokerAdapter,
    async getTradePlan(planId, userId) {
      const { tradePlans } = await import("@shared/schema");
      const rows = await db
        .select()
        .from(tradePlans)
        .where(and(eq(tradePlans.id, planId), eq(tradePlans.userId, userId)))
        .limit(1);
      if (!rows[0]) return null;
      const row = rows[0];
      return {
        id: row.id,
        userId: row.userId,
        symbol: row.symbol,
        planType: row.planType as "EQUITY" | "OPTIONS",
        status: row.status,
        archivedAt: row.archivedAt,
        riskSnapshot: row.riskSnapshot as Record<string, unknown> | null,
        structureSnapshot: row.structureSnapshot as Record<string, unknown> | null,
        planningSnapshot: row.planningSnapshot as Record<string, unknown> | null,
        updatedAt: row.updatedAt,
        version: row.version,
        limitations: (row.limitations as string[]) ?? [],
      };
    },
    async getLifecycleResult(planId, userId) {
      // ALWAYS force a fresh lifecycle evaluation for preflight.
      //
      // Rationale: execution preflight is an explicit, high-stakes user action.
      // The 5-min in-process cache is an optimization for the lifecycle UI polling;
      // preflight must never serve a pre-review cache entry.
      //
      // Using force:true ensures:
      //   1. lastReviewedAt is always read fresh from trade_plans in the DB.
      //   2. researchDataTimestamp (currentSummary.asOf) reflects the latest OppIntel scan.
      //   3. The lifecycle state shown in preflight is the authoritative computed state,
      //      not a potentially stale in-process cache entry from before the review.
      try {
        const { evaluateTradePlanLifecycle } = await import("./trade-plan-lifecycle-service");
        const result = await evaluateTradePlanLifecycle(userId, planId, { force: true });

        // Diagnostic: log the lifecycle state feeding into preflight so operators can
        // trace discrepancies between the lifecycle UI and preflight in production.
        console.log("[preflight:lifecycle-diagnostic]", JSON.stringify({
          planId,
          lifecycleState:  result.lifecycleState,
          evaluatedAt:     result.evaluatedAt,
          requiresReview:  result.requiresReview,
          reviewReasonsCount: result.reviewReasons?.length ?? 0,
        }));

        return {
          planId,
          lifecycleState: result.lifecycleState,
          evaluatedAt: result.evaluatedAt ? new Date(result.evaluatedAt) : null,
        };
      } catch (err: any) {
        // If the lifecycle evaluation fails (plan not found, OppIntel error, etc.)
        // return null so the preflight marks the lifecycle dimension as UNAVAILABLE
        // rather than crashing the entire preflight.
        console.error("[preflight:lifecycle-diagnostic] evaluation failed:", err?.message);
        return null;
      }
    },
    async savePreflight(result) {
      await db.insert(executionPreflights).values({
        id: result.id,
        userId: result.userId,
        tradePlanId: result.tradePlanId,
        provider: result.provider ?? null,
        status: result.overallStatus,
        resultJson: result as unknown as Record<string, unknown>,
        evaluatedAt: new Date(result.evaluatedAt),
        validUntil: result.validUntil ? new Date(result.validUntil) : null,
      }).onConflictDoNothing();
    },
    async saveAuditEvent(event) {
      await db.insert(executionAuditEvents).values({
        id: event.id,
        userId: event.userId,
        tradePlanId: event.tradePlanId,
        eventType: event.eventType,
        occurredAt: new Date(event.occurredAt),
        provider: event.provider ?? null,
        accountRefMasked: event.accountRefMasked ?? null,
        metadata: event.metadata as Record<string, unknown>,
      }).onConflictDoNothing();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureExecutionPreflightTables(): Promise<void> {
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS execution_preflights (
      id                VARCHAR PRIMARY KEY,
      user_id           TEXT NOT NULL,
      trade_plan_id     VARCHAR NOT NULL,
      provider          TEXT,
      status            TEXT NOT NULL,
      result_json       JSONB NOT NULL DEFAULT '{}',
      evaluated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      valid_until       TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_ep_user_id ON execution_preflights(user_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_ep_trade_plan_id ON execution_preflights(trade_plan_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_ep_evaluated_at ON execution_preflights(evaluated_at)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS execution_audit_events (
      id                  VARCHAR PRIMARY KEY,
      user_id             TEXT NOT NULL,
      trade_plan_id       VARCHAR NOT NULL,
      event_type          TEXT NOT NULL,
      occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      provider            TEXT,
      account_ref_masked  TEXT,
      metadata            JSONB NOT NULL DEFAULT '{}'
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_eae_user_id ON execution_audit_events(user_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_eae_trade_plan_id ON execution_audit_events(trade_plan_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_eae_occurred_at ON execution_audit_events(occurred_at)
  `);
}
