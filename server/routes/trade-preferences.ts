/**
 * server/routes/trade-preferences.ts — Sprint 2.8.1A
 *
 * Routes:
 *   GET  /api/user/trading-preferences
 *   PUT  /api/user/trading-preferences
 *   GET  /api/trade-planning/session/:id/expression-selection
 *   POST /api/trade-planning/session/:id/expression-selection
 *   GET  /api/trade-planning/:symbol/expression-options
 *
 * COMPLIANCE:
 *   - Never "Recommended for You", "Best Strategy", "Suitable"
 *   - selectedBy always "USER" — AI cannot set
 *   - Preferences affect presentation only — not qualification/eligibility
 *   - Server derives userId from session — never from client body
 */

import type { Express, Request, Response } from "express";
import {
  getUserTradingPreferences,
  saveUserTradingPreferences,
  saveBroadExpressionSelection,
  getBroadExpressionSelection,
  computeExpressionOptions,
  ensureTradePreferencesTables,
} from "../services/trade-preferences-service";
import { evaluateExpressionFamilies, getPlanningSession } from "../services/trade-planning-service";
import type { TradePlanningConstraints } from "../../shared/trade-planning-types";
import { getCanonicalOpportunity } from "../services/opportunity-intelligence-service";
import { EXPRESSION_SELECTION_DISCLAIMER, TRADE_PREFERENCES_SETTINGS_DISCLAIMER, isBroadExpressionType } from "../../shared/trade-preference-types";

export { ensureTradePreferencesTables };

const FORBIDDEN_CLIENT_FIELDS = new Set([
  "compatibilityStatus", "strategyMatches", "portfolioOwnership",
  "brokerPermissions", "researchDirection", "suitability", "selectedBy",
]);

export function registerTradePreferencesRoutes(
  app: Express,
  isAuthenticated: (req: Request, res: Response, next: () => void) => void
): void {

  // =========================================================================
  // GET /api/user/trading-preferences
  // Returns user's saved trading preferences.
  // =========================================================================
  app.get("/api/user/trading-preferences", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).session?.userId as string;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
      const prefs = await getUserTradingPreferences(userId);
      res.json({
        preferences: prefs,
        disclaimer: TRADE_PREFERENCES_SETTINGS_DISCLAIMER,
      });
    } catch (e: any) {
      console.error("[trade-preferences] GET preferences error:", e?.message);
      res.status(500).json({ message: "Failed to retrieve trading preferences" });
    }
  });

  // =========================================================================
  // PUT /api/user/trading-preferences
  // Save user's trading preferences.
  // Server derives userId from session — never from body.
  // =========================================================================
  app.put("/api/user/trading-preferences", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).session?.userId as string;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    // Reject forbidden client-submitted fields
    for (const key of Array.from(FORBIDDEN_CLIENT_FIELDS)) {
      if (key in (req.body ?? {})) {
        return res.status(400).json({
          message: `Client cannot submit field: ${key}`,
          code: "FORBIDDEN_FIELD",
        });
      }
    }

    const { preferredExpressionTypes, showOtherCompatibleStructures } = req.body ?? {};

    if (!Array.isArray(preferredExpressionTypes)) {
      return res.status(400).json({ message: "preferredExpressionTypes must be an array" });
    }

    // Validate each type
    const invalid = (preferredExpressionTypes as string[]).filter(v => !isBroadExpressionType(v));
    if (invalid.length > 0) {
      return res.status(400).json({
        message: `Invalid expression types: ${invalid.join(", ")}`,
        code: "INVALID_EXPRESSION_TYPE",
      });
    }

    try {
      const saved = await saveUserTradingPreferences(userId, {
        preferredExpressionTypes,
        showOtherCompatibleStructures,
      });
      res.json({
        preferences: saved,
        disclaimer: TRADE_PREFERENCES_SETTINGS_DISCLAIMER,
      });
    } catch (e: any) {
      console.error("[trade-preferences] PUT preferences error:", e?.message);
      res.status(500).json({ message: "Failed to save trading preferences" });
    }
  });

  // =========================================================================
  // GET /api/trade-planning/session/:id/expression-selection
  // Returns current broad expression selection for a planning session.
  // =========================================================================
  app.get("/api/trade-planning/session/:id/expression-selection", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).session?.userId as string;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const sessionId = req.params.id;

    try {
      const selection = await getBroadExpressionSelection(userId, sessionId);
      if (!selection) {
        return res.status(404).json({ message: "No expression selection for this session" });
      }
      res.json({ selection, disclaimer: EXPRESSION_SELECTION_DISCLAIMER });
    } catch (e: any) {
      if (e?.code === "SESSION_NOT_FOUND") {
        return res.status(404).json({ message: "Planning session not found" });
      }
      console.error("[trade-preferences] GET expression-selection error:", e?.message);
      res.status(500).json({ message: "Failed to retrieve expression selection" });
    }
  });

  // =========================================================================
  // POST /api/trade-planning/session/:id/expression-selection
  // Save explicit broad expression selection.
  // selectedBy is always "USER" — client cannot override.
  // =========================================================================
  app.post("/api/trade-planning/session/:id/expression-selection", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).session?.userId as string;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const sessionId = req.params.id;

    // Reject forbidden client-submitted fields
    for (const key of Array.from(FORBIDDEN_CLIENT_FIELDS)) {
      if (key in (req.body ?? {})) {
        return res.status(400).json({
          message: `Client cannot submit field: ${key}`,
          code: "FORBIDDEN_FIELD",
        });
      }
    }

    const { selectedExpressionType } = req.body ?? {};
    if (!selectedExpressionType || typeof selectedExpressionType !== "string") {
      return res.status(400).json({ message: "selectedExpressionType is required" });
    }

    if (!isBroadExpressionType(selectedExpressionType)) {
      return res.status(400).json({
        message: `Invalid expression type: ${selectedExpressionType}`,
        code: "INVALID_EXPRESSION_TYPE",
      });
    }

    try {
      const selection = await saveBroadExpressionSelection(userId, sessionId, selectedExpressionType);
      res.status(201).json({
        selection,
        disclaimer: EXPRESSION_SELECTION_DISCLAIMER,
      });
    } catch (e: any) {
      if (e?.code === "SESSION_NOT_FOUND") {
        return res.status(404).json({ message: "Planning session not found" });
      }
      if (e?.code === "INVALID_EXPRESSION_TYPE") {
        return res.status(400).json({ message: e.message, code: e.code });
      }
      console.error("[trade-preferences] POST expression-selection error:", e?.message);
      res.status(500).json({ message: "Failed to save expression selection" });
    }
  });

  // =========================================================================
  // GET /api/trade-planning/:symbol/expression-options
  // Compute expression option cards for a symbol.
  // Accepts optional ?sessionId= to read session constraints.
  // This is a dynamic route — registered AFTER all static session routes.
  // =========================================================================
  app.get("/api/trade-planning/:symbol/expression-options", isAuthenticated, async (req: Request, res: Response) => {
    const userId = (req as any).session?.userId as string;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const symbol = (req.params.symbol ?? "").toUpperCase();

    // Guard against static segments being misrouted
    const STATIC_SEGMENTS = new Set(["session", "history", "health", "expressions"]);
    if (STATIC_SEGMENTS.has(symbol.toLowerCase())) {
      return res.status(400).json({ message: `${symbol} is not a valid ticker symbol in this context` });
    }

    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;

    try {
      // Get canonical opportunity (must exist)
      const opp = await getCanonicalOpportunity(symbol).catch(() => null);
      if (!opp) {
        return res.status(404).json({ message: `No qualified research candidate for ${symbol}` });
      }

      // Get session constraints if sessionId provided (validate ownership)
      let sessionConstraints: any = null;
      let resolvedSessionId: string | undefined;
      if (sessionId) {
        const session = await getPlanningSession(userId, sessionId).catch(() => null);
        if (!session || session.userId !== userId) {
          return res.status(404).json({ message: "Planning session not found" });
        }
        if (session.symbol.toUpperCase() !== symbol) {
          return res.status(400).json({ message: "Session symbol does not match requested symbol" });
        }
        sessionConstraints = session.constraints;
        resolvedSessionId = sessionId;
      }

      // Evaluate expression families (reuse existing engine — no duplication)
      const constraints = (sessionConstraints ?? {}) as TradePlanningConstraints;
      const families = evaluateExpressionFamilies(opp, constraints);

      // Get user preferences
      const userPrefs = await getUserTradingPreferences(userId);

      // Compute options
      const result = computeExpressionOptions(symbol, families, userPrefs, {
        sessionId: resolvedSessionId,
      });

      res.json(result);
    } catch (e: any) {
      console.error("[trade-preferences] GET expression-options error:", symbol, e?.message);
      res.status(500).json({ message: "Failed to compute expression options" });
    }
  });
}
