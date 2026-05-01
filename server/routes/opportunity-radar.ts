import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { generateCandidateScenarios, type RadarFilters } from "../services/opportunity-radar/radar-service";

const filtersSchema = z.object({
  strategyType: z.enum(["any", "stock_swing", "long_call", "long_put", "debit_spread", "covered_call", "cash_secured_put"]).optional(),
  bias: z.enum(["any", "bullish", "bearish", "neutral"]).optional(),
  maxLoss: z.coerce.number().positive().optional(),
  minGrade: z.enum(["A+", "A", "B", "C"]).optional(),
  timeHorizon: z.enum(["intraday", "1_5d", "1_4w", "30_60d"]).optional(),
  universe: z.enum(["watchlist", "large_cap", "high_volume", "options_liquid", "custom"]).optional(),
  customSymbols: z.union([z.array(z.string()), z.string()]).optional(),
  minStockVolume: z.coerce.number().nonnegative().optional(),
  minOptionOpenInterest: z.coerce.number().nonnegative().optional(),
  minOptionVolume: z.coerce.number().nonnegative().optional(),
  maxBidAskSpreadPct: z.coerce.number().positive().optional(),
  avoidEarningsDays: z.coerce.number().int().nonnegative().optional(),
  minRewardRisk: z.coerce.number().positive().optional(),
  excludeCurrentHoldings: z.coerce.boolean().optional(),
  includeOnlyCurrentHoldings: z.coerce.boolean().optional(),
});

const actionSchema = z.object({
  action: z.enum(["reviewed", "paper_traded", "prepared_order", "sent_order"]),
  scenario: z.object({
    symbol: z.string(),
    companyName: z.string().optional().nullable(),
    strategyType: z.string(),
    bias: z.string().optional().nullable(),
    finalGrade: z.string().optional().nullable(),
    finalScore: z.number().int().optional().nullable(),
    technicalScore: z.number().int().optional().nullable(),
    sentimentScore: z.number().int().optional().nullable(),
    momentumScore: z.number().int().optional().nullable(),
    liquidityScore: z.number().int().optional().nullable(),
    riskScore: z.number().int().optional().nullable(),
    thesis: z.string().optional().nullable(),
    mainReason: z.string().optional().nullable(),
    mainRisk: z.string().optional().nullable(),
    entry: z.number().optional().nullable(),
    stop: z.number().optional().nullable(),
    target: z.number().optional().nullable(),
    maxLoss: z.number().optional().nullable(),
    maxGain: z.number().optional().nullable(),
    breakeven: z.number().optional().nullable(),
    capitalRequired: z.number().optional().nullable(),
    expiration: z.string().optional().nullable(),
    strikes: z.string().optional().nullable(),
    orderPreview: z.any().optional(),
    dataMode: z.string().optional().nullable(),
    brokerConnected: z.boolean().optional(),
  }),
  complianceAcknowledged: z.boolean().optional(),
});

function parseListParam(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim()) {
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

export function registerOpportunityRadarRoutes(app: Express, isAuthenticated: RequestHandler): void {
  app.get("/api/radar/scenarios", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "unauthorized" });

      const raw = { ...req.query };
      if (raw.customSymbols) raw.customSymbols = parseListParam(raw.customSymbols) as any;

      const parsed = filtersSchema.safeParse(raw);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_filters", details: parsed.error.flatten() });
      }

      const filters: RadarFilters = {
        ...parsed.data,
        customSymbols: Array.isArray(parsed.data.customSymbols) ? parsed.data.customSymbols : undefined,
      };

      const result = await generateCandidateScenarios(userId, filters);
      return res.json(result);
    } catch (err) {
      console.error("[OpportunityRadar] /api/radar/scenarios failed:", err);
      return res.status(500).json({ error: "radar_failed" });
    }
  });

  app.post("/api/radar/scenarios", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "unauthorized" });

      const parsed = actionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });
      }

      // sent_order requires explicit compliance acknowledgement
      if (parsed.data.action === "sent_order" && !parsed.data.complianceAcknowledged) {
        return res.status(400).json({ error: "compliance_acknowledgement_required" });
      }

      const s = parsed.data.scenario;
      const now = new Date();

      const saved = await storage.createOpportunityScenario({
        userId,
        sourceMode: "opportunity_radar",
        symbol: s.symbol.toUpperCase(),
        companyName: s.companyName ?? null,
        strategyType: s.strategyType,
        bias: s.bias ?? null,
        finalGrade: s.finalGrade ?? null,
        finalScore: s.finalScore ?? null,
        technicalScore: s.technicalScore ?? null,
        sentimentScore: s.sentimentScore ?? null,
        momentumScore: s.momentumScore ?? null,
        liquidityScore: s.liquidityScore ?? null,
        riskScore: s.riskScore ?? null,
        thesis: s.thesis ?? null,
        mainReason: s.mainReason ?? null,
        mainRisk: s.mainRisk ?? null,
        entry: s.entry ?? null,
        stop: s.stop ?? null,
        target: s.target ?? null,
        maxLoss: s.maxLoss ?? null,
        maxGain: s.maxGain ?? null,
        breakeven: s.breakeven ?? null,
        capitalRequired: s.capitalRequired ?? null,
        expiration: s.expiration ?? null,
        strikes: s.strikes ?? null,
        orderPreviewJson: s.orderPreview ?? null,
        dataMode: s.dataMode ?? "simulated",
        brokerConnected: s.brokerConnected ?? false,
        reviewedAt: parsed.data.action === "reviewed" ? now : null,
        paperTradedAt: parsed.data.action === "paper_traded" ? now : null,
        preparedOrderAt: parsed.data.action === "prepared_order" ? now : null,
        sentOrderAt: parsed.data.action === "sent_order" ? now : null,
        complianceAcknowledged: parsed.data.complianceAcknowledged ?? false,
      } as any);

      // Mirror into trade_setup_history with sourceMode for the History page.
      try {
        await storage.createTradeSetupHistory({
          userId,
          symbol: s.symbol.toUpperCase(),
          strategyName: s.strategyType,
          assetType: s.strategyType === "stock_swing" ? "stock" : "option",
          timeframe: null as any,
          setupJson: s as any,
          modelScore: s.finalScore ?? null,
          status: parsed.data.action,
          sentToInstatrade: parsed.data.action === "sent_order",
          sourceMode: "opportunity_radar",
          complianceAcknowledged: parsed.data.complianceAcknowledged ?? false,
          orderReviewedAt: parsed.data.action === "prepared_order" ? now : null,
          userConfirmedOrder: parsed.data.action === "sent_order",
        } as any);
      } catch (mirrorErr) {
        console.warn("[OpportunityRadar] history mirror failed (non-fatal):", mirrorErr);
      }

      return res.status(201).json(saved);
    } catch (err) {
      console.error("[OpportunityRadar] POST /api/radar/scenarios failed:", err);
      return res.status(500).json({ error: "save_failed" });
    }
  });

  app.get("/api/radar/scenarios/history", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "unauthorized" });
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const rows = await storage.getOpportunityScenariosByUser(userId, limit);
      return res.json(rows);
    } catch (err) {
      console.error("[OpportunityRadar] history fetch failed:", err);
      return res.status(500).json({ error: "history_failed" });
    }
  });
}
