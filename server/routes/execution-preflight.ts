/**
 * server/routes/execution-preflight.ts
 *
 * Sprint 2.8.0 — Execution Preflight Routes
 *
 * Routes:
 *   POST /api/trade-plans/:id/execution/preflight
 *       Runs or re-runs execution preflight for a trade plan.
 *       Requires saved Trade Plan (tradePlanId). No shortcut.
 *
 *   GET /api/trade-plans/:id/execution/preflight
 *       Returns the most recent preflight result for a trade plan.
 *
 *   GET /api/execution/capabilities
 *       Platform-level execution capability summary.
 *
 *   GET /api/execution/health
 *       Execution readiness health section for Platform Health.
 *       Never exposes raw account IDs, balances, or positions.
 *
 * Static routes (/api/execution/*) are registered BEFORE dynamic routes (:id).
 * All routes: isAuthenticated. Cross-user plan access → 404.
 * No order submission endpoints are defined in this file.
 *
 * Rejected client fields:
 *   skipQuoteValidation, skipBuyingPower, skipPermissions, forceExecute,
 *   ignoreInvalidation, overrideExecution, bypassPreflight, skipLifecycle, skipRisk
 */

import type { Express, Request, Response } from "express";
import type { ExecutionCapability, ExecutionHealthSummary } from "@shared/execution-types";
import {
  EXECUTION_PREFLIGHT_DISCLAIMER,
  EXECUTION_FRESHNESS_THRESHOLDS,
} from "@shared/execution-types";
import {
  getExecutionPolicy,
  isExecutionEnabled,
  getExecutionMode,
  getExecutionDisabledResponse,
  detectSafetyBypassAttempt,
} from "../services/execution-policy";
import {
  runExecutionPreflight,
  createDbPreflightDeps,
  ensureExecutionPreflightTables,
} from "../services/execution-preflight-service";
import { createLiveBrokerExecutionAdapter } from "../services/broker-execution-adapter";

// ─── In-memory health metrics (resets on restart, no PII) ──────────────────
const healthMetrics = {
  preflightRequests: 0,
  preflightPasses: 0,
  preflightFailures: 0,
  permissionsChecks: 0,
  buyingPowerChecks: 0,
  quoteChecks: 0,
  lastPreflightAt: undefined as string | undefined,
};

// ─────────────────────────────────────────────────────────────────────────────

export function registerExecutionPreflightRoutes(
  app: Express,
  isAuthenticated: (req: Request, res: Response, next: () => void) => void
): void {

  // ── Static routes first (before dynamic /:id) ──────────────────────────

  /**
   * GET /api/execution/capabilities
   * Platform-level execution capability summary.
   * Never exposes raw account IDs or raw balances.
   */
  app.get("/api/execution/capabilities", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).session?.userId as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized." });

      const policy = getExecutionPolicy();

      // Get broker status (best-effort)
      let brokerConnected = false;
      let provider: string | undefined;
      let accountResolved = false;
      let accountIdMasked: string | undefined;
      let buyingPowerAvailable: boolean | undefined;
      let blockers: string[] = [];
      const warnings: string[] = [];

      if (!policy.executionEnabled) {
        blockers.push("EXECUTION_DISABLED");
      } else {
        try {
          const { storage } = await import("../storage");
          const conn = await storage.getBrokerConnectionWithToken(userId);
          brokerConnected = !!(conn?.isConnected && conn?.accessToken);
          provider = conn?.provider ?? undefined;

          if (!brokerConnected) {
            blockers.push("BROKER_NOT_CONNECTED");
          } else {
            const broker = await import("../broker/index");
            const accounts = await broker.getBrokerAccounts(userId).catch(() => []);
            accountResolved = accounts.length === 1;
            if (accounts.length === 0) {
              blockers.push("ACCOUNT_NOT_RESOLVED");
            }
          }
        } catch {
          blockers.push("BROKER_NOT_CONNECTED");
        }
      }

      const capability: ExecutionCapability = {
        executionEnabled: policy.executionEnabled,
        executionMode: policy.executionMode,
        brokerConnected,
        provider,
        accountResolved,
        accountIdMasked,
        supportsEquityOrders: brokerConnected,
        supportsOptionsOrders: brokerConnected,
        supportsMultiLegOrders: false, // Unknown until permissions verified
        optionsPermissionLevel: null,
        buyingPowerAvailable,
        positionDataAvailable: brokerConnected,
        quoteValidationAvailable: brokerConnected,
        orderIdempotencyAvailable: false, // Sprint 2.8.5
        explicitConfirmationRequired: true,
        blockers: blockers as any[],
        warnings: warnings as any[],
        lastCheckedAt: new Date().toISOString(),
      };

      return res.json(capability);
    } catch (err: any) {
      console.error("[execution-capabilities] error:", err?.message);
      return res.status(500).json({ error: "Could not retrieve execution capabilities." });
    }
  });

  /**
   * GET /api/execution/health
   * Execution readiness health for Platform Health.
   * Never exposes account IDs, balances, raw positions.
   */
  app.get("/api/execution/health", isAuthenticated, async (_req: Request, res: Response) => {
    try {
      const mode = getExecutionMode();
      const enabled = isExecutionEnabled();

      const state: ExecutionHealthSummary["state"] =
        !enabled ? "DISABLED" :
        mode === "sandbox" ? "SANDBOX_READY" :
        mode === "production" ? "NOT_READY" : // Not yet vetted for production
        "DISABLED";

      const summary: ExecutionHealthSummary = {
        state,
        executionMode: mode,
        executionEnabled: enabled,
        preflightRequests: healthMetrics.preflightRequests,
        preflightPasses: healthMetrics.preflightPasses,
        preflightFailures: healthMetrics.preflightFailures,
        brokerConnectionsAvailable: 0, // Don't expose count without auth
        permissionsChecks: healthMetrics.permissionsChecks,
        buyingPowerChecks: healthMetrics.buyingPowerChecks,
        quoteChecks: healthMetrics.quoteChecks,
        lastPreflightAt: healthMetrics.lastPreflightAt,
        providerStatus: {
          tradier: "unchecked",
          tradestation: "unchecked",
        },
      };

      return res.json(summary);
    } catch (err: any) {
      console.error("[execution-health] error:", err?.message);
      return res.status(500).json({ error: "Could not retrieve execution health." });
    }
  });

  // ── Dynamic trade-plan routes ───────────────────────────────────────────

  /**
   * POST /api/trade-plans/:id/execution/preflight
   * Runs execution preflight for a saved Trade Plan.
   *
   * Body (optional):
   *   { requestedAccountRef?: string }
   *
   * Rejected body fields: skipQuoteValidation, skipBuyingPower, skipPermissions,
   *   forceExecute, ignoreInvalidation, overrideExecution, bypassPreflight,
   *   skipLifecycle, skipRisk
   *
   * Returns: ExecutionPreflightResult (always includes disclaimer)
   */
  app.post(
    "/api/trade-plans/:id/execution/preflight",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const userId = (req as any).session?.userId as string;
      const tradePlanId = req.params.id;

      if (!userId) return res.status(401).json({ error: "Unauthorized." });
      if (!tradePlanId) return res.status(400).json({ error: "Trade Plan ID required." });

      // Reject safety bypass attempts
      const bypassFields = detectSafetyBypassAttempt(req.body ?? {});
      if (bypassFields.length > 0) {
        return res.status(400).json({
          error: "Safety override fields are not permitted.",
          rejectedFields: bypassFields,
        });
      }

      const requestedAccountRef = typeof req.body?.requestedAccountRef === "string"
        ? req.body.requestedAccountRef
        : undefined;

      healthMetrics.preflightRequests++;
      healthMetrics.lastPreflightAt = new Date().toISOString();

      try {
        // Get broker provider from connection
        let provider = "tradier"; // default
        try {
          const { storage } = await import("../storage");
          const conn = await storage.getBrokerConnection(userId);
          if (conn?.provider) provider = conn.provider;
        } catch {/* use default */}

        const adapter = await createLiveBrokerExecutionAdapter(provider);
        const deps = await createDbPreflightDeps(adapter);

        const result = await runExecutionPreflight(
          { tradePlanId, userId, requestedAccountRef },
          deps
        );

        // Update health metrics
        if (result.overallStatus === "PASS") healthMetrics.preflightPasses++;
        else if (result.overallStatus === "FAIL") healthMetrics.preflightFailures++;
        if (result.quoteValidation.status !== "SKIPPED") healthMetrics.quoteChecks++;
        if (result.permissionsValidation.status !== "SKIPPED") healthMetrics.permissionsChecks++;
        if (result.buyingPowerValidation.status !== "SKIPPED") healthMetrics.buyingPowerChecks++;

        return res.json(result);
      } catch (err: any) {
        healthMetrics.preflightFailures++;
        // Scrub any potentially sensitive info from error message
        const safeMsg = err?.message?.includes("not found") || err?.message?.includes("not belong")
          ? err.message
          : "Preflight evaluation failed.";
        console.error("[execution-preflight POST] error:", err?.message);
        return res.status(500).json({ error: safeMsg });
      }
    }
  );

  /**
   * GET /api/trade-plans/:id/execution/preflight
   * Returns the most recent preflight result for a Trade Plan.
   * Returns 404 if no preflight has been run yet.
   */
  app.get(
    "/api/trade-plans/:id/execution/preflight",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const userId = (req as any).session?.userId as string;
      const tradePlanId = req.params.id;

      if (!userId) return res.status(401).json({ error: "Unauthorized." });

      try {
        const { db } = await import("../db");
        const { executionPreflights } = await import("@shared/schema");
        const { eq, and, desc } = await import("drizzle-orm");

        // First verify the trade plan belongs to this user
        const { tradePlans } = await import("@shared/schema");
        const plans = await db
          .select({ id: tradePlans.id })
          .from(tradePlans)
          .where(and(eq(tradePlans.id, tradePlanId), eq(tradePlans.userId, userId)))
          .limit(1);

        if (!plans[0]) {
          return res.status(404).json({ error: "Trade Plan not found." });
        }

        const rows = await db
          .select()
          .from(executionPreflights)
          .where(
            and(
              eq(executionPreflights.tradePlanId, tradePlanId),
              eq(executionPreflights.userId, userId)
            )
          )
          .orderBy(desc(executionPreflights.evaluatedAt))
          .limit(1);

        if (!rows[0]) {
          return res.status(404).json({
            error: "No preflight result found. Run preflight first.",
            tradePlanId,
          });
        }

        const row = rows[0];
        // Check if result is still valid
        const isExpired = row.validUntil && new Date(row.validUntil) < new Date();

        return res.json({
          ...(row.resultJson as object),
          isExpired: !!isExpired,
          disclaimer: EXECUTION_PREFLIGHT_DISCLAIMER,
        });
      } catch (err: any) {
        console.error("[execution-preflight GET] error:", err?.message);
        return res.status(500).json({ error: "Could not retrieve preflight result." });
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STARTUP TABLE INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

export { ensureExecutionPreflightTables };
