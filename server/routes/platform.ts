import type { Express } from "express";
import { z } from "zod";
import { isAuthenticated } from "../replit_integrations/auth";
import { getDefaultRiskProfile } from "../models/risk-profiles";
import { listUniverses, getUniverse, createUniverse, updateUniverse, deleteUniverse } from "../models/ticker-universes";
import { storage } from "../storage";
import { toRiskProfileResponse, toUniverseResponse, type PlatformContext } from "@shared/platform-types";

const VALID_RISK_MODES = ["conservative", "balanced", "aggressive"] as const;

const updateRiskProfileSchema = z.object({
  risk_mode: z.enum(VALID_RISK_MODES).optional(),
  risk_per_trade: z.number().min(0.1).max(10).optional(),
  max_deploy: z.number().min(5).max(100).optional(),
  delta_min: z.number().min(0).max(1).optional(),
  delta_max: z.number().min(0).max(1).optional(),
  loss_cutoff_mult: z.number().min(0.1).max(10).optional(),
  min_premium_pct: z.number().min(0).max(100).optional(),
  vix_pause: z.number().min(0).max(100).optional(),
  protections_enabled: z.boolean().optional(),
  guardrails_json: z.record(z.unknown()).optional(),
  protections_json: z.record(z.unknown()).optional(),
});

const createUniverseSchema = z.object({
  name: z.string().min(1).max(100),
  symbols: z.array(z.string().min(1).max(10)).min(1).max(500),
  description: z.string().max(500).optional(),
});

const updateUniverseSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  symbols: z.array(z.string().min(1).max(10)).min(1).max(500),
  description: z.string().max(500).optional(),
});

export function registerPlatformRoutes(app: Express): void {

  app.get("/api/platform/risk-profile", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const profile = await getDefaultRiskProfile(userId);
      res.json(toRiskProfileResponse(profile));
    } catch (error) {
      console.error("Error fetching risk profile:", error);
      res.status(500).json({ message: "Failed to fetch risk profile" });
    }
  });

  app.get("/api/platform/context", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const [profile, universes] = await Promise.all([
        getDefaultRiskProfile(userId),
        listUniverses(userId),
      ]);
      const ctx: PlatformContext = {
        riskProfile: toRiskProfileResponse(profile),
        universes: universes.map(u => toUniverseResponse(u, u.members.length)),
      };
      res.json(ctx);
    } catch (error) {
      console.error("Error fetching platform context:", error);
      res.status(500).json({ message: "Failed to fetch platform context" });
    }
  });

  app.put("/api/platform/risk-profile", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const data = updateRiskProfileSchema.parse(req.body);

      const existing = await getDefaultRiskProfile(userId);

      const updates: Record<string, unknown> = {};
      if (data.risk_mode !== undefined) updates.riskMode = data.risk_mode;
      if (data.risk_per_trade !== undefined) updates.riskPerTrade = data.risk_per_trade;
      if (data.max_deploy !== undefined) updates.maxDeploy = data.max_deploy;
      if (data.delta_min !== undefined) updates.deltaMin = data.delta_min;
      if (data.delta_max !== undefined) updates.deltaMax = data.delta_max;
      if (data.loss_cutoff_mult !== undefined) updates.lossCutoffMult = data.loss_cutoff_mult;
      if (data.min_premium_pct !== undefined) updates.minPremiumPct = data.min_premium_pct;
      if (data.vix_pause !== undefined) updates.vixPause = data.vix_pause;
      if (data.protections_enabled !== undefined) updates.protectionsEnabled = data.protections_enabled;
      if (data.guardrails_json !== undefined) updates.guardrailsJson = data.guardrails_json;
      if (data.protections_json !== undefined) updates.protectionsJson = data.protections_json;

      if (Object.keys(updates).length === 0) {
        return res.json(toRiskProfileResponse(existing));
      }

      const updated = await storage.updateRiskProfile(existing.id, updates);
      if (!updated) {
        return res.status(500).json({ message: "Failed to update risk profile" });
      }
      res.json(toRiskProfileResponse(updated));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("Error updating risk profile:", error);
      res.status(500).json({ message: "Failed to update risk profile" });
    }
  });

  app.get("/api/platform/universes", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const universes = await listUniverses(userId);
      const result = universes.map(u => toUniverseResponse(u, u.members.length));
      res.json(result);
    } catch (error) {
      console.error("Error listing universes:", error);
      res.status(500).json({ message: "Failed to list universes" });
    }
  });

  app.get("/api/platform/universes/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const universe = await getUniverse(req.params.id, userId);
      if (!universe) {
        return res.status(404).json({ message: "Universe not found" });
      }
      res.json({
        ...toUniverseResponse(universe, universe.members.length),
        symbols: universe.members.map(m => m.symbol),
      });
    } catch (error) {
      console.error("Error fetching universe:", error);
      res.status(500).json({ message: "Failed to fetch universe" });
    }
  });

  app.post("/api/platform/universes", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const data = createUniverseSchema.parse(req.body);
      const normalizedSymbols = data.symbols.map(s => s.toUpperCase().trim());
      const universe = await createUniverse(userId, data.name, normalizedSymbols, data.description);
      res.status(201).json(toUniverseResponse(universe, universe.members.length));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("Error creating universe:", error);
      res.status(500).json({ message: "Failed to create universe" });
    }
  });

  app.put("/api/platform/universes/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const universeId = req.params.id;
      const data = updateUniverseSchema.parse(req.body);
      const normalizedSymbols = data.symbols.map(s => s.toUpperCase().trim());
      const existing = await storage.getTickerUniverse(universeId, userId);
      if (!existing) {
        return res.status(404).json({ message: "Universe not found" });
      }
      const updated = await updateUniverse(
        universeId,
        userId,
        data.name ?? existing.name,
        normalizedSymbols,
        data.description ?? existing.description ?? undefined,
      );
      if (!updated) {
        return res.status(404).json({ message: "Universe not found" });
      }
      res.json(toUniverseResponse(updated, updated.members.length));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("Error updating universe:", error);
      res.status(500).json({ message: "Failed to update universe" });
    }
  });

  app.delete("/api/platform/universes/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const universeId = req.params.id;
      const deleted = await deleteUniverse(universeId, userId);
      if (!deleted) {
        return res.status(404).json({ message: "Universe not found" });
      }
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting universe:", error);
      res.status(500).json({ message: "Failed to delete universe" });
    }
  });
}
