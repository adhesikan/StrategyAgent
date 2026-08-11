/**
 * server/routes/execution-readiness.ts — Sprint 2.8.4
 *
 * REST routes for Execution Readiness & Guardrails.
 *
 * PERMANENT INVARIANTS:
 *   - No order submission, modification, or cancellation in this module.
 *   - Readiness is deterministic — no LLM involvement.
 *   - Client-supplied account balances, positions, and broker permissions
 *     are NEVER trusted. All authoritative data is fetched server-side.
 *   - brokerSubmissionEnabled is always false in all responses.
 *
 * Routes:
 *   GET  /api/execution/execution-readiness/health
 *   POST /api/trade-plans/:id/execution-readiness
 *   GET  /api/trade-plans/:id/execution-readiness/latest
 */

import type { Express, RequestHandler } from "express";
import {
  evaluateExecutionReadiness,
  ensureExecutionReadinessTables,
  persistReadinessResult,
  getLatestReadinessResult,
  getReadinessHealthMetrics,
  recordReadinessMetric,
} from "../services/execution-readiness-service";
import type { ExecutionReadinessInput } from "../../shared/execution-readiness-types";
import { maskAccountId } from "../services/broker-execution-adapter";

// ─────────────────────────────────────────────────────────────────────────────
// FORBIDDEN CLIENT FIELDS
// Client may never inject these — all authoritative data is fetched server-side.
// ─────────────────────────────────────────────────────────────────────────────
const FORBIDDEN_CLIENT_FIELDS = new Set([
  "positions", "buyingPower", "accountBalance", "balance", "cashBalance",
  "brokerCapabilities", "optionsPermission", "optionsLevel", "accountStatus",
  "connected", "sessionToken", "accessToken", "brokerToken",
  "forceReady", "overrideStatus", "bypassChecks", "skipValidation",
  "forceExecute", "approved", "readyToTrade", "executionApproved",
]);

function checkForbiddenFields(body: Record<string, unknown>): string | null {
  for (const key of Array.from(FORBIDDEN_CLIENT_FIELDS)) {
    if (key in body) return key;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

export function registerExecutionReadinessRoutes(
  app: Express,
  isAuthenticated: RequestHandler
): void {
  // ── Health (static — before dynamic routes) ──────────────────────────────
  app.get("/api/execution/execution-readiness/health", (_req, res) => {
    res.json({
      brokerSubmissionEnabled: false,
      metrics: getReadinessHealthMetrics(),
    });
  });

  // ── POST: Run readiness evaluation ──────────────────────────────────────
  /**
   * POST /api/trade-plans/:id/execution-readiness
   *
   * Body (optional):
   *   { orderDraftId?: string }
   *
   * Server-side pipeline:
   *   1. Load trade plan (scoped to userId)
   *   2. Load latest options preview for the draft
   *   3. Load broker capabilities (server-side — never from client)
   *   4. Load positions (server-side — never from client)
   *   5. Run deterministic readiness engine
   *   6. Persist result
   *   7. Return structured response
   */
  app.post(
    "/api/trade-plans/:id/execution-readiness",
    isAuthenticated,
    async (req, res) => {
      const start = Date.now();
      const userId = req.session.userId!;
      const tradePlanId = req.params.id;

      // Reject forbidden client-injected fields
      const forbidden = checkForbiddenFields(req.body ?? {});
      if (forbidden) {
        return res.status(400).json({
          error: "FORBIDDEN_FIELD",
          message: `Field '${forbidden}' may not be supplied by the client. ` +
            "All account, position, and broker data is fetched server-side.",
        });
      }

      const orderDraftId: string | null = req.body?.orderDraftId ?? null;

      try {
        // 1. Load trade plan
        const tradePlan = await loadTradePlan(tradePlanId, userId);
        if (!tradePlan) {
          return res.status(404).json({ error: "TRADE_PLAN_NOT_FOUND", message: "Trade plan not found." });
        }

        // 2. Load latest options preview for this draft
        let preview: import("../../shared/options-order-preview-types").OptionsOrderPreview | null = null;
        let orderPreviewId: string | null = null;
        if (orderDraftId) {
          const { generateOptionsPreview, createDbOptionsPreviewDeps } = await import("../services/options-preview-service");
          try {
            const previewResult = await generateOptionsPreview({
              userId,
              orderDraftId,
              deps: createDbOptionsPreviewDeps(userId),
            });
            preview = previewResult.preview;
            orderPreviewId = preview.id;
          } catch {
            // Preview generation failure — proceed with null; will generate BLOCKED findings
          }
        }

        // If no preview available, we cannot run full readiness — return early with error
        if (!preview) {
          return res.status(422).json({
            error: "PREVIEW_REQUIRED",
            message: "An Options Order Preview must be generated before running Execution Readiness. " +
              "Provide orderDraftId or generate the preview first.",
          });
        }

        // 3. Load broker capabilities (server-side)
        const brokerCapabilities = await loadBrokerCapabilities(userId, tradePlan);

        // 4. Load positions (server-side)
        const positions = await loadPositions(userId, tradePlan);

        // 5. Run readiness engine
        const input: ExecutionReadinessInput = {
          tradePlanId,
          userId,
          orderDraftId,
          orderPreviewId,
          preview,
          positions,
          brokerCapabilities,
          now: new Date(),
        };

        const result = evaluateExecutionReadiness(input);
        const latencyMs = Date.now() - start;
        recordReadinessMetric(result.status, latencyMs);

        // 6. Persist
        const provider = (tradePlan as any).provider ?? brokerCapabilities?.provider ?? undefined;
        const accountRef = (tradePlan as any).accountRef ?? null;
        await persistReadinessResult(
          result,
          userId,
          provider,
          accountRef ? maskAccountId(accountRef) : undefined
        );

        // 7. Return
        res.json({ readiness: result });
      } catch (err: any) {
        console.error("[execution-readiness] evaluation failed:", err?.message);
        res.status(500).json({ error: "EVALUATION_FAILED", message: "Readiness evaluation failed. Please try again." });
      }
    }
  );

  // ── GET: Latest readiness result ─────────────────────────────────────────
  /**
   * GET /api/trade-plans/:id/execution-readiness/latest
   *
   * Returns the most recent persisted readiness result for this trade plan.
   */
  app.get(
    "/api/trade-plans/:id/execution-readiness/latest",
    isAuthenticated,
    async (req, res) => {
      const userId = req.session.userId!;
      const tradePlanId = req.params.id;

      // Verify trade plan belongs to user
      const tradePlan = await loadTradePlan(tradePlanId, userId);
      if (!tradePlan) {
        return res.status(404).json({ error: "TRADE_PLAN_NOT_FOUND", message: "Trade plan not found." });
      }

      const result = await getLatestReadinessResult(tradePlanId, userId);
      if (!result) {
        return res.status(404).json({
          error: "NO_READINESS_RESULT",
          message: "No readiness evaluation found for this trade plan. Run execution readiness first.",
        });
      }

      res.json({ readiness: result });
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVER-SIDE DATA LOADERS
// (Never trust client-supplied account data)
// ─────────────────────────────────────────────────────────────────────────────

async function loadTradePlan(id: string, userId: string): Promise<Record<string, unknown> | null> {
  try {
    const { db } = await import("../db");
    const { tradePlans } = await import("../../shared/schema");
    const { eq, and } = await import("drizzle-orm");
    const rows = await db.select().from(tradePlans)
      .where(and(eq(tradePlans.id, id), eq(tradePlans.userId, userId)))
      .limit(1);
    return (rows[0] as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

async function loadBrokerCapabilities(
  userId: string,
  _tradePlan: Record<string, unknown>
): Promise<import("../../shared/execution-readiness-types").BrokerReadinessCapabilities | null> {
  try {
    const { storage } = await import("../storage");
    const conn = await storage.getBrokerConnectionWithToken(userId);
    if (!conn || !conn.isConnected) {
      return { connected: false, provider: "unknown", supportsOptions: null, supportsMultileg: null, optionsLevel: null, accountStatus: null, buyingPowerUsd: null, buyingPowerSource: "unavailable" };
    }

    const provider = conn.provider ?? "unknown";
    const { getProviderCapabilityMatrix, createLiveBrokerExecutionAdapter } = await import("../services/broker-execution-adapter");
    const matrix = getProviderCapabilityMatrix(provider);

    // Try to get buying power
    let buyingPowerUsd: number | null = null;
    let buyingPowerSource: "broker" | "unavailable" = "unavailable";
    try {
      const adapter = await createLiveBrokerExecutionAdapter(provider);
      const bp = await adapter.getBuyingPower(userId, conn.accountId ?? "");
      if (bp.available && bp.buyingPowerUsd != null) {
        buyingPowerUsd = bp.buyingPowerUsd;
        buyingPowerSource = "broker";
      }
    } catch { /* buying power unavailable */ }

    return {
      connected: true,
      provider,
      supportsOptions: matrix.options === "SUPPORTED" ? true : matrix.options === "UNSUPPORTED" ? false : null,
      supportsMultileg: matrix.multiLeg === "SUPPORTED" ? true : matrix.multiLeg === "UNSUPPORTED" ? false : null,
      optionsLevel: null, // Not available from Tradier/TradeStation without permissions API
      accountStatus: "active", // assumed; no status API available
      buyingPowerUsd,
      buyingPowerSource,
    };
  } catch {
    return null;
  }
}

async function loadPositions(
  userId: string,
  _tradePlan: Record<string, unknown>
): Promise<import("../../shared/execution-readiness-types").ReadinessPositionContext[] | null> {
  try {
    const { storage } = await import("../storage");
    const conn = await storage.getBrokerConnectionWithToken(userId);
    if (!conn || !conn.isConnected) return null;

    const provider = conn.provider ?? "unknown";
    const { createLiveBrokerExecutionAdapter } = await import("../services/broker-execution-adapter");
    const adapter = await createLiveBrokerExecutionAdapter(provider);
    const raw = await adapter.getPositions(userId);

    return raw.map(p => ({
      symbol: p.symbol,
      quantity: p.quantity,
      isOption: false,  // Broker position context doesn't distinguish options from equity
      isLiveBrokerData: p.isLiveBrokerData,
    }));
  } catch {
    return null;
  }
}

export { ensureExecutionReadinessTables };
