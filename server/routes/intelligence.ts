// Intelligence API Routes — Sprint 2.3.3
//
// GET /api/intelligence/briefing          — daily command-center summary
// GET /api/intelligence/sectors           — all sector summaries (precomputed)
// GET /api/intelligence/sectors/:sector   — single sector detail
// GET /api/intelligence/themes            — all theme summaries (precomputed)
// GET /api/intelligence/themes/:themeId   — single theme detail
// GET /api/intelligence/themes/:themeId/history — theme history
//
// All responses read from precomputed snapshots.
// Responses include data quality / coverage fields for transparency.

import type { Express, Request, Response } from "express";
import {
  getLatestSectorSnapshots,
  getLatestSectorDetail,
  getLatestThemeSnapshots,
  getLatestThemeDetail,
  getThemeHistory,
} from "../services/intelligence-snapshot-store";
import { getAllThemes, getTheme } from "../config/theme-registry";
import { getLatestRanking } from "../services/opportunity-ranking-engine";

// ---------------------------------------------------------------------------
// Dashboard consumer contract (compact, for future dashboard wiring)
// ---------------------------------------------------------------------------

function buildDashboardContracts(
  sectors: Awaited<ReturnType<typeof getLatestSectorSnapshots>>,
  themes:  Awaited<ReturnType<typeof getLatestThemeSnapshots>>,
) {
  const sortedSectors = [...sectors].sort((a, b) => b.score - a.score);
  const sortedThemes  = [...themes].sort((a, b) => b.score - a.score);

  return {
    leadingSectors:   sortedSectors.slice(0, 5).map(s => ({ sector: s.sector, score: s.score, label: s.label })),
    leadingThemes:    sortedThemes.slice(0, 5).map(t => ({ themeId: t.themeId, themeName: t.themeName, score: t.score, label: t.label })),
    improvingThemes:  sortedThemes
      .filter(t => {
        const delta = (t.changes as { scoreDelta?: number | null })?.scoreDelta;
        return delta != null && delta >= 5;
      })
      .slice(0, 5)
      .map(t => ({ themeId: t.themeId, themeName: t.themeName, score: t.score, label: t.label })),
    weakeningThemes:  sortedThemes
      .filter(t => {
        const delta = (t.changes as { scoreDelta?: number | null })?.scoreDelta;
        return delta != null && delta <= -5;
      })
      .slice(0, 5)
      .map(t => ({ themeId: t.themeId, themeName: t.themeName, score: t.score, label: t.label })),
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerIntelligenceRoutes(app: Express): void {

  // ── GET /api/intelligence/briefing ────────────────────────────────────────
  // Daily command-center summary: regime, market health, leading themes/sectors,
  // most improved stocks, institutional highlights.
  app.get("/api/intelligence/briefing", async (_req: Request, res: Response) => {
    try {
      const [sectors, themes] = await Promise.all([
        getLatestSectorSnapshots(),
        getLatestThemeSnapshots(),
      ]);

      const hasData = sectors.length > 0 || themes.length > 0;

      // Regime from in-memory latest ranking (set after each scan cycle)
      const ranking = getLatestRanking();
      const regime  = ranking?.regime ?? null;

      // Leading themes — top 4 by score with direction
      const sortedThemes = [...themes].sort((a, b) => b.score - a.score);
      const leadingThemes = sortedThemes.slice(0, 4).map(t => {
        const delta = (t.changes as Record<string, unknown>)?.scoreDelta as number | null ?? null;
        const direction: "up" | "down" | "stable" =
          delta != null && delta >= 3 ? "up" :
          delta != null && delta <= -3 ? "down" : "stable";
        return { themeId: t.themeId, themeName: t.themeName, score: t.score, direction };
      });

      // Leading sectors — top 3 names
      const sortedSectors = [...sectors].sort((a, b) => b.score - a.score);
      const leadingSectors = sortedSectors.slice(0, 3).map(s => s.sector);

      // Most improved themes — by positive scoreDelta
      const mostImprovedThemes = [...themes]
        .map(t => ({
          themeId:    t.themeId,
          themeName:  t.themeName,
          scoreDelta: ((t.changes as Record<string, unknown>)?.scoreDelta as number) ?? 0,
        }))
        .filter(t => t.scoreDelta > 0)
        .sort((a, b) => b.scoreDelta - a.scoreDelta)
        .slice(0, 2);

      // Most improved stocks — strengthening symbols from improving themes, deduped
      const symbolSet = new Set<string>();
      const improvingThemes = [...themes]
        .filter(t => ((t.changes as Record<string, unknown>)?.scoreDelta as number ?? 0) > 0)
        .sort((a, b) =>
          ((b.changes as Record<string, unknown>)?.scoreDelta as number ?? 0) -
          ((a.changes as Record<string, unknown>)?.scoreDelta as number ?? 0),
        );
      for (const t of improvingThemes) {
        const ch = t.changes as Record<string, unknown>;
        const strengthening = (ch?.strengtheningSymbols as string[]) ?? [];
        const newLeaders    = (ch?.newLeaders          as string[]) ?? [];
        for (const sym of [...strengthening, ...newLeaders]) {
          if (!symbolSet.has(sym)) symbolSet.add(sym);
          if (symbolSet.size >= 5) break;
        }
        if (symbolSet.size >= 5) break;
      }
      // Fall back to top symbols from highest-scoring themes if no movement data
      if (symbolSet.size === 0) {
        for (const t of sortedThemes.slice(0, 3)) {
          const tops = (t.topSymbols as Array<{ symbol: string }>) ?? [];
          for (const ts of tops) {
            if (!symbolSet.has(ts.symbol)) symbolSet.add(ts.symbol);
            if (symbolSet.size >= 5) break;
          }
          if (symbolSet.size >= 5) break;
        }
      }
      const mostImprovedStocks = Array.from(symbolSet);

      // Market health — weighted avg of top-3 sector + theme scores
      const sectorScores = sortedSectors.slice(0, 5).map(s => s.score).filter(Boolean) as number[];
      const themeScores  = sortedThemes.slice(0, 5).map(t => t.score).filter(Boolean) as number[];
      let marketHealth: number | null = null;
      if (sectorScores.length > 0 || themeScores.length > 0) {
        const avgSector = sectorScores.length > 0
          ? sectorScores.reduce((a, b) => a + b, 0) / sectorScores.length
          : null;
        const avgTheme  = themeScores.length > 0
          ? themeScores.reduce((a, b) => a + b, 0) / themeScores.length
          : null;
        if (avgSector != null && avgTheme != null) {
          marketHealth = Math.round(avgSector * 0.4 + avgTheme * 0.6);
        } else {
          marketHealth = Math.round((avgSector ?? avgTheme)!);
        }
        marketHealth = Math.max(0, Math.min(100, marketHealth));
      }

      // Institutional highlights
      const accumulationSignals = themes.reduce((sum, t) => {
        return sum + (((t.metrics as Record<string, unknown>)?.institutionalAccumulationCount as number) ?? 0);
      }, 0);
      const newRankedOpportunities = themes.reduce((sum, t) => {
        return sum + (((t.metrics as Record<string, unknown>)?.newOpportunityCount as number) ?? 0);
      }, 0);
      const themesStrengthened = themes.filter(t =>
        ((t.changes as Record<string, unknown>)?.scoreDelta as number ?? 0) > 0
      ).length;
      const sectorsWeakened = sectors.filter(s =>
        ((s.changes as Record<string, unknown>)?.scoreDelta as number ?? 0) < 0
      ).length;

      const generatedAt = themes[0]?.generatedAt ?? sectors[0]?.generatedAt ?? null;

      res.json({
        regime,
        marketHealth,
        hasData,
        generatedAt,
        leadingThemes,
        leadingSectors,
        mostImprovedThemes,
        mostImprovedStocks,
        institutionalHighlights: {
          accumulationSignals,
          newRankedOpportunities,
          themesStrengthened,
          sectorsWeakened,
        },
      });
    } catch (err: any) {
      console.error("[intelligence] briefing error:", err?.message);
      res.status(500).json({ error: "Failed to load intelligence briefing" });
    }
  });

  // ── GET /api/intelligence/sectors ─────────────────────────────────────────
  app.get("/api/intelligence/sectors", async (_req: Request, res: Response) => {
    try {
      const sectors = await getLatestSectorSnapshots();
      res.json({
        sectors: sectors.sort((a, b) => b.score - a.score),
        count:   sectors.length,
        hasData: sectors.length > 0,
        disclaimer: "Sector scores reflect the strength of current research evidence — not expected sector performance.",
      });
    } catch (err: any) {
      console.error("[intelligence] sectors list error:", err?.message);
      res.status(500).json({ error: "Failed to load sector intelligence" });
    }
  });

  // ── GET /api/intelligence/sectors/:sector ─────────────────────────────────
  app.get("/api/intelligence/sectors/:sector", async (req: Request, res: Response) => {
    const sector = decodeURIComponent(req.params.sector ?? "").trim();
    if (!sector) return res.status(400).json({ error: "sector is required" });

    try {
      const detail = await getLatestSectorDetail(sector);
      if (!detail) {
        return res.status(404).json({
          error: "No intelligence snapshot found for this sector",
          sector,
          hint: "Intelligence snapshots are computed after each Opportunity Ranking cycle.",
        });
      }
      res.json({
        ...detail,
        disclaimer: "Sector scores reflect the strength of current research evidence — not expected sector performance.",
      });
    } catch (err: any) {
      console.error("[intelligence] sector detail error:", err?.message);
      res.status(500).json({ error: "Failed to load sector detail" });
    }
  });

  // ── GET /api/intelligence/themes ──────────────────────────────────────────
  app.get("/api/intelligence/themes", async (_req: Request, res: Response) => {
    try {
      const [stored, registry] = await Promise.all([
        getLatestThemeSnapshots(),
        Promise.resolve(getAllThemes()),
      ]);

      const storedMap = new Map(stored.map(t => [t.themeId, t]));

      // Include all active registry themes, even if no snapshot yet
      const themes = registry.map(def => {
        const snap = storedMap.get(def.themeId);
        if (snap) return snap;
        return {
          themeId:     def.themeId,
          themeName:   def.name,
          score:       null as unknown as number,
          label:       "Insufficient Data",
          generatedAt: null as unknown as string,
          metrics:     {},
          topSymbols:  [],
          changes:     {},
        };
      });

      const contracts = buildDashboardContracts(
        [], // no sector snapshots available in this handler — contracts use theme data only
        stored,
      );

      res.json({
        themes:          themes.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
        count:           themes.length,
        hasData:         stored.length > 0,
        dashboardContracts: contracts,
        disclaimer: "Theme scores reflect the breadth of current research evidence — not a recommendation to buy or sell any theme.",
      });
    } catch (err: any) {
      console.error("[intelligence] themes list error:", err?.message);
      res.status(500).json({ error: "Failed to load theme intelligence" });
    }
  });

  // ── GET /api/intelligence/themes/:themeId ─────────────────────────────────
  app.get("/api/intelligence/themes/:themeId", async (req: Request, res: Response) => {
    const themeId = req.params.themeId ?? "";
    if (!themeId) return res.status(400).json({ error: "themeId is required" });

    const themeDef = getTheme(themeId);
    if (!themeDef) {
      return res.status(404).json({ error: "Unknown theme", themeId });
    }

    try {
      const detail = await getLatestThemeDetail(themeId);
      if (!detail) {
        return res.status(404).json({
          error: "No intelligence snapshot found for this theme",
          themeId,
          themeName:  themeDef.name,
          memberCount: themeDef.symbols.length,
          members:    themeDef.symbols,
          hint: "Intelligence snapshots are computed after each Opportunity Ranking cycle.",
        });
      }
      res.json({
        ...detail,
        disclaimer: "Theme scores reflect the breadth of current research evidence — not a recommendation to buy or sell any theme.",
      });
    } catch (err: any) {
      console.error("[intelligence] theme detail error:", err?.message);
      res.status(500).json({ error: "Failed to load theme detail" });
    }
  });

  // ── GET /api/intelligence/themes/:themeId/history ─────────────────────────
  app.get("/api/intelligence/themes/:themeId/history", async (req: Request, res: Response) => {
    const themeId = req.params.themeId ?? "";
    if (!themeId) return res.status(400).json({ error: "themeId is required" });

    const themeDef = getTheme(themeId);
    if (!themeDef) {
      return res.status(404).json({ error: "Unknown theme", themeId });
    }

    try {
      const history = await getThemeHistory(themeId, 12);
      res.json({
        themeId,
        themeName: themeDef.name,
        history,
        count: history.length,
      });
    } catch (err: any) {
      console.error("[intelligence] theme history error:", err?.message);
      res.status(500).json({ error: "Failed to load theme history" });
    }
  });
}
