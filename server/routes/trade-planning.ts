/**
 * Trade Planning Routes — Sprint 2.7.0
 *
 * ROUTE ORDER CONTRACT (static before dynamic):
 *   GET  /api/trade-planning/health          ← static (registered first)
 *   GET  /api/trade-planning/session/:id     ← session static prefix before symbol
 *   PATCH /api/trade-planning/session/:id
 *   GET  /api/trade-planning/session/:id/expressions
 *   POST /api/trade-planning/session         ← create
 *   GET  /api/trade-planning/:symbol/context ← dynamic (registered last)
 *
 * SECURITY:
 *   - All endpoints require authentication
 *   - Session ownership enforced — cross-user returns 404
 *   - Client NEVER submits authoritative research data
 *   - Server reconstructs all scores/evidence from canonical services
 */

import type { Express, Request, Response } from "express";
import {
  buildTradePlanningContext,
  createPlanningSession,
  getPlanningSession,
  updatePlanningSession,
  getLatestSessionForSymbol,
  evaluateExpressionFamilies,
  getTradePlanningHealth,
} from "../services/trade-planning-service";
import {
  buildEquityPlanningScenario,
  recalculateEquityScenario,
  getEquityPlanningHealth,
} from "../services/equity-planning-service";
import { getCanonicalOpportunity } from "../services/opportunity-intelligence-service";
import {
  validateConstraints,
  DEFAULT_CONSTRAINTS,
  TRADE_PLANNING_DISCLAIMER,
  CONSTRAINTS_DISCLAIMER,
  NO_RANKING_DISCLAIMER,
  EXPRESSION_FAMILIES,
  EXPRESSION_FAMILY_LABELS,
  validateExpressionFamily,
} from "../../shared/trade-planning-types";
import {
  EQUITY_PLANNING_DISCLAIMER,
  SIZING_DISCLAIMER,
} from "../../shared/equity-planning-types";

// Reserved static path segment — must not be treated as a symbol
const RESERVED_SEGMENTS = new Set(["health", "session", "history", "templates", "metadata"]);

function isReservedSegment(seg: string): boolean {
  return RESERVED_SEGMENTS.has(seg.toLowerCase());
}

export function registerTradePlanningRoutes(
  app: Express,
  isAuthenticated: (req: Request, res: Response, next: () => void) => void,
): void {

  // =========================================================================
  // Static: GET /api/trade-planning/health
  // Admin-only aggregates — no symbols, no capital values, no user identities
  // =========================================================================
  app.get("/api/trade-planning/health", isAuthenticated, (_req: Request, res: Response) => {
    const metrics = getTradePlanningHealth();
    res.json({
      status:  metrics.failedContexts > metrics.contextsBuilt / 2 ? "DEGRADED" : "HEALTHY",
      metrics: {
        contextsBuilt:           metrics.contextsBuilt,
        sessionsCreated:         metrics.sessionsCreated,
        expressionEvaluations:   metrics.expressionEvaluations,
        partialContexts:         metrics.partialContexts,
        failedContexts:          metrics.failedContexts,
        averageContextLatencyMs: metrics.averageContextLatencyMs ?? "N/A",
        lastSuccessfulContextAt: metrics.lastSuccessfulContextAt ?? "Never",
      },
      disclaimer: TRADE_PLANNING_DISCLAIMER,
    });
  });

  // =========================================================================
  // Static: GET /api/trade-planning/session/:id
  // =========================================================================
  app.get("/api/trade-planning/session/:id", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const session = await getPlanningSession(userId, req.params.id).catch(() => null);
    if (!session) return res.status(404).json({ message: "Planning session not found" });

    res.json({ session, disclaimer: TRADE_PLANNING_DISCLAIMER });
  });

  // =========================================================================
  // Static: PATCH /api/trade-planning/session/:id
  // Client may submit only: constraints, goalId, portfolioId, selectedExpressionFamily
  // =========================================================================
  app.patch("/api/trade-planning/session/:id", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { constraints: rawConstraints, goalId, portfolioId, selectedExpressionFamily } = req.body ?? {};

    // Validate expression family if provided
    if (selectedExpressionFamily !== undefined && selectedExpressionFamily !== null) {
      if (!validateExpressionFamily(selectedExpressionFamily)) {
        return res.status(400).json({
          message: `Invalid expression family: ${selectedExpressionFamily}. Valid values: ${EXPRESSION_FAMILIES.join(", ")}`,
        });
      }
    }

    const patch: Parameters<typeof updatePlanningSession>[2] = {};
    if (rawConstraints !== undefined) patch.constraints = validateConstraints(rawConstraints);
    if (goalId !== undefined)         patch.goalId = goalId ?? null;
    if (portfolioId !== undefined)    patch.portfolioId = portfolioId ?? null;
    if (selectedExpressionFamily !== undefined) patch.selectedExpressionFamily = selectedExpressionFamily;

    const session = await updatePlanningSession(userId, req.params.id, patch).catch(() => null);
    if (!session) return res.status(404).json({ message: "Planning session not found" });

    res.json({ session, disclaimer: TRADE_PLANNING_DISCLAIMER });
  });

  // =========================================================================
  // Static: GET /api/trade-planning/session/:id/expressions
  // Re-evaluate expression families with current session constraints.
  // =========================================================================
  app.get("/api/trade-planning/session/:id/expressions", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const session = await getPlanningSession(userId, req.params.id).catch(() => null);
    if (!session) return res.status(404).json({ message: "Planning session not found" });

    const opp = await getCanonicalOpportunity(session.symbol).catch(() => null);
    if (!opp) {
      return res.status(404).json({ message: `No qualified research candidate for ${session.symbol}` });
    }

    const expressions = evaluateExpressionFamilies(opp, session.constraints);

    res.json({
      symbol:      session.symbol,
      expressions,
      disclaimer:  TRADE_PLANNING_DISCLAIMER,
      noRanking:   NO_RANKING_DISCLAIMER,
    });
  });

  // =========================================================================
  // Static: POST /api/trade-planning/session
  // Create a new planning session. Client submits only: symbol + user constraints.
  // =========================================================================
  app.post("/api/trade-planning/session", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { symbol, constraints: rawConstraints, goalId, portfolioId } = req.body ?? {};
    if (!symbol || typeof symbol !== "string") {
      return res.status(400).json({ message: "symbol is required" });
    }

    const upperSymbol = symbol.toUpperCase();
    if (isReservedSegment(upperSymbol)) {
      return res.status(400).json({ message: `${symbol} is not a valid ticker symbol in this context` });
    }

    // Check candidate exists before creating session
    const opp = await getCanonicalOpportunity(upperSymbol).catch(() => null);
    if (!opp) {
      return res.status(404).json({ message: `No qualified research candidate found for ${upperSymbol}` });
    }

    const constraints = validateConstraints(rawConstraints);
    const session = await createPlanningSession(userId, {
      symbol: upperSymbol,
      opportunityId: opp.id,
      goalId:        goalId ?? null,
      portfolioId:   portfolioId ?? null,
      constraints,
    });

    res.status(201).json({
      session,
      disclaimer:         TRADE_PLANNING_DISCLAIMER,
      constraintsNote:    CONSTRAINTS_DISCLAIMER,
    });
  });

  // =========================================================================
  // Static session equity: GET /api/trade-planning/session/:id/equity
  // Retrieve latest equity scenario for a session (or generate on-demand)
  // =========================================================================
  app.get("/api/trade-planning/session/:id/equity", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const session = await getPlanningSession(userId, req.params.id).catch(() => null);
    if (!session) return res.status(404).json({ message: "Planning session not found" });

    try {
      const scenario = await buildEquityPlanningScenario({
        userId,
        symbol:                  session.symbol,
        tradePlanningContextId:  session.id,
        planningSessionId:       session.id,
        constraints:             session.constraints as any,
      });

      res.json({
        scenario,
        disclaimer:      EQUITY_PLANNING_DISCLAIMER,
        sizingNote:      SIZING_DISCLAIMER,
      });
    } catch (err: any) {
      console.error("[trade-planning] equity session build error:", err?.message);
      res.status(err?.message?.includes("No qualified") ? 404 : 500).json({ message: err?.message ?? "Failed to build equity scenario" });
    }
  });

  // =========================================================================
  // Static session equity: PATCH /api/trade-planning/session/:id/equity
  // Recalculate with updated constraints or scenario range
  // =========================================================================
  app.patch("/api/trade-planning/session/:id/equity", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const session = await getPlanningSession(userId, req.params.id).catch(() => null);
    if (!session) return res.status(404).json({ message: "Planning session not found" });

    const { constraints: rawConstraints, downsidePct, upsidePct } = req.body ?? {};
    const constraints = rawConstraints ? validateConstraints(rawConstraints) : (session.constraints as any);

    // Validate scenario range
    const down = typeof downsidePct === "number" ? Math.max(-0.50, Math.min(-0.01, downsidePct)) : undefined;
    const up   = typeof upsidePct   === "number" ? Math.max(0.01, Math.min(1.00, upsidePct)) : undefined;

    try {
      const scenario = await recalculateEquityScenario({
        userId,
        symbol:                 session.symbol,
        tradePlanningContextId: session.id,
        planningSessionId:      session.id,
        constraints,
        downsidePct: down,
        upsidePct:   up,
      });

      res.json({ scenario, disclaimer: EQUITY_PLANNING_DISCLAIMER });
    } catch (err: any) {
      res.status(err?.message?.includes("No qualified") ? 404 : 500).json({ message: err?.message ?? "Recalculation failed" });
    }
  });

  // =========================================================================
  // Static session equity: GET /api/trade-planning/session/:id/equity/scenarios
  // Return just the scenario grid (fast recalc)
  // =========================================================================
  app.get("/api/trade-planning/session/:id/equity/scenarios", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const session = await getPlanningSession(userId, req.params.id).catch(() => null);
    if (!session) return res.status(404).json({ message: "Planning session not found" });

    const downsidePct = req.query.downsidePct ? parseFloat(req.query.downsidePct as string) : undefined;
    const upsidePct   = req.query.upsidePct   ? parseFloat(req.query.upsidePct   as string) : undefined;

    try {
      const scenario = await recalculateEquityScenario({
        userId,
        symbol:                 session.symbol,
        tradePlanningContextId: session.id,
        planningSessionId:      session.id,
        constraints:            session.constraints as any,
        downsidePct: downsidePct && !isNaN(downsidePct) ? Math.max(-0.50, Math.min(-0.01, downsidePct)) : undefined,
        upsidePct:   upsidePct   && !isNaN(upsidePct)   ? Math.max(0.01, Math.min(1.00, upsidePct))     : undefined,
      });

      res.json({
        symbol:         session.symbol,
        scenarioGrid:   scenario.scenarioGrid,
        referencePrice: scenario.referencePrice,
        freshness:      scenario.freshness.referencePrice,
        disclaimer:     scenario.scenarioGrid?.disclaimer ?? EQUITY_PLANNING_DISCLAIMER,
      });
    } catch (err: any) {
      res.status(500).json({ message: "Scenario recalculation failed" });
    }
  });

  // =========================================================================
  // Dynamic: POST /api/trade-planning/:symbol/equity
  // Build equity scenario for a symbol (without a saved session)
  // =========================================================================
  app.post("/api/trade-planning/:symbol/equity", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const symbol = req.params.symbol?.toUpperCase();
    if (!symbol || isReservedSegment(symbol)) {
      return res.status(400).json({ message: "Invalid symbol" });
    }

    const { constraints: rawConstraints, planningSessionId, downsidePct, upsidePct } = req.body ?? {};
    const constraints = rawConstraints ? validateConstraints(rawConstraints) : DEFAULT_CONSTRAINTS;

    // Validate scenario range
    const down = typeof downsidePct === "number" ? Math.max(-0.50, Math.min(-0.01, downsidePct)) : undefined;
    const up   = typeof upsidePct   === "number" ? Math.max(0.01, Math.min(1.00, upsidePct))     : undefined;

    try {
      const scenario = await buildEquityPlanningScenario({
        userId,
        symbol,
        tradePlanningContextId: planningSessionId ?? `ephemeral-${Date.now()}`,
        planningSessionId:      planningSessionId ?? null,
        constraints,
        downsidePct: down,
        upsidePct:   up,
      });

      res.json({
        scenario,
        disclaimer:  EQUITY_PLANNING_DISCLAIMER,
        sizingNote:  SIZING_DISCLAIMER,
      });
    } catch (err: any) {
      if (err?.message?.includes("No qualified")) {
        return res.status(404).json({
          message: err.message,
          symbol,
          hint: "Only qualified research candidates can be used for equity trade planning.",
        });
      }
      console.error("[trade-planning] equity build error:", err?.message);
      res.status(500).json({ message: "Failed to build equity planning scenario" });
    }
  });

  // =========================================================================
  // Dynamic: GET /api/trade-planning/:symbol/context
  // Build authoritative TradePlanningContext. Client submits only optional
  // goalId/portfolioId/constraints — NEVER scores or qualification data.
  // =========================================================================
  app.get("/api/trade-planning/:symbol/context", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const symbol = req.params.symbol?.toUpperCase();
    if (!symbol || isReservedSegment(symbol)) {
      return res.status(400).json({ message: "Invalid symbol" });
    }

    const goalId      = (req.query.goalId as string | undefined) ?? null;
    const portfolioId = (req.query.portfolioId as string | undefined) ?? null;
    const rawConstraints = req.query.constraints
      ? (() => { try { return JSON.parse(req.query.constraints as string); } catch { return null; } })()
      : null;

    // Try to get latest session constraints as defaults
    const existingSession = await getLatestSessionForSymbol(userId, symbol).catch(() => null);
    const baseConstraints = existingSession?.constraints ?? DEFAULT_CONSTRAINTS;
    const constraints = rawConstraints ? validateConstraints(rawConstraints) : baseConstraints;

    try {
      const context = await buildTradePlanningContext(userId, symbol, {
        goalId:      goalId ?? existingSession?.researchGoalId ?? null,
        portfolioId: portfolioId ?? existingSession?.portfolioId ?? null,
        constraints,
      });

      res.json({
        context,
        existingSession:    existingSession ? { id: existingSession.id } : null,
        disclaimer:         TRADE_PLANNING_DISCLAIMER,
        constraintsNote:    CONSTRAINTS_DISCLAIMER,
        noRanking:          NO_RANKING_DISCLAIMER,
      });
    } catch (err: any) {
      if (err?.message?.includes("No qualified research candidate")) {
        return res.status(404).json({
          message: err.message,
          symbol,
          hint: "Only qualified research candidates can be used as the basis for trade planning.",
        });
      }
      console.error("[trade-planning] context build error:", err?.message);
      res.status(500).json({ message: "Failed to build trade planning context" });
    }
  });
}
