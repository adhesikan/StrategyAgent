/**
 * Opportunity Intelligence Routes — Sprint 2.5.0
 *
 * GET  /api/intelligence/opportunities         — filtered & sorted canonical list
 * GET  /api/intelligence/opportunities/meta    — available filter options (sectors, themes, types…)
 * GET  /api/intelligence/opportunities/:symbol — single canonical opportunity
 *
 * COMPLIANCE
 *   All responses use "research candidate" / "investment candidate" language.
 *   Never "recommendation", "buy", "sell", "target price".
 *
 * AUTH
 *   All routes require isAuthenticated middleware.
 */

import type { Express, Request, Response, RequestHandler } from "express";
import {
  getOpportunityIntelligence,
  getCanonicalOpportunity,
  getOpportunityIntelligenceHealth,
} from "../services/opportunity-intelligence-service";
import type {
  OpportunityFilterOptions,
  OpportunitySortField,
  OpportunitySortOptions,
} from "../../shared/opportunity-intelligence-types";

// ---------------------------------------------------------------------------
// Query param parsing helpers
// ---------------------------------------------------------------------------

function parseStringArray(v: unknown): string[] | undefined {
  if (!v) return undefined;
  if (Array.isArray(v)) return (v as string[]).filter(Boolean);
  if (typeof v === "string") {
    const arr = v.split(",").map(s => s.trim()).filter(Boolean);
    return arr.length > 0 ? arr : undefined;
  }
  return undefined;
}

function parseNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

function parseFilters(query: Record<string, unknown>): OpportunityFilterOptions {
  const filters: OpportunityFilterOptions = {};

  const sector    = parseStringArray(query.sector);
  const industry  = parseStringArray(query.industry);
  const theme     = parseStringArray(query.theme);
  const oppType   = parseStringArray(query.opportunityType) as any[];
  const riskLevel = parseStringArray(query.riskLevel) as any[];
  const timeHor   = parseStringArray(query.timeHorizon) as any[];

  if (sector?.length)    filters.sector           = sector;
  if (industry?.length)  filters.industry         = industry;
  if (theme?.length)     filters.theme            = theme;
  if (oppType?.length)   filters.opportunityType  = oppType;
  if (riskLevel?.length) filters.riskLevel        = riskLevel;
  if (timeHor?.length)   filters.timeHorizon      = timeHor;

  const minResearch     = parseNumber(query.minResearchScore);
  const minTechnical    = parseNumber(query.minTechnicalScore);
  const minInstitutional = parseNumber(query.minInstitutionalScore);
  if (minResearch     !== undefined) filters.minResearchScore     = minResearch;
  if (minTechnical    !== undefined) filters.minTechnicalScore    = minTechnical;
  if (minInstitutional !== undefined) filters.minInstitutionalScore = minInstitutional;

  if (typeof query.marketRegime === "string") filters.marketRegime = query.marketRegime;

  return filters;
}

const VALID_SORT_FIELDS: OpportunitySortField[] = [
  "researchScore",
  "technicalScore",
  "institutionalScore",
  "symbol",
  "lastUpdated",
  "opportunityType",
];

function parseSort(query: Record<string, unknown>): OpportunitySortOptions | undefined {
  const field = typeof query.sortBy === "string" ? query.sortBy as OpportunitySortField : undefined;
  if (!field || !VALID_SORT_FIELDS.includes(field)) return undefined;
  const direction = query.sortDirection === "asc" ? "asc" : "desc";
  return { field, direction };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerOpportunityIntelligenceRoutes(
  app:             Express,
  isAuthenticated: RequestHandler,
): void {

  // ── GET /api/intelligence/opportunities ────────────────────────────────────
  // Returns filtered, sorted list of canonical opportunities.
  //
  // Query params (all optional):
  //   sector, industry, theme, opportunityType, riskLevel, timeHorizon  — comma-sep strings
  //   minResearchScore, minTechnicalScore, minInstitutionalScore          — integers 0-100
  //   marketRegime                                                        — string
  //   sortBy                                                              — field name
  //   sortDirection                                                       — "asc" | "desc"
  app.get(
    "/api/intelligence/opportunities",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const filters = parseFilters(req.query as Record<string, unknown>);
        const sort    = parseSort(req.query as Record<string, unknown>);
        const result  = await getOpportunityIntelligence(
          Object.keys(filters).length > 0 ? filters : undefined,
          sort,
        );

        if (!result) {
          return res.status(200).json({
            available:   false,
            message:     "No opportunity snapshot is available yet. The scanner runs periodically — check back shortly.",
            generatedAt: null,
          });
        }

        return res.status(200).json({
          available:     true,
          generatedAt:   result.generatedAt,
          marketRegime:  result.marketRegime,
          totalCount:    result.totalCount,
          filteredCount: result.filteredCount,
          opportunities: result.opportunities,
          meta:          result.meta,
        });
      } catch (err) {
        console.error("[OppIntelligence] GET /opportunities error:", (err as Error).message);
        return res.status(500).json({ error: "Failed to retrieve opportunity intelligence" });
      }
    },
  );

  // ── GET /api/intelligence/opportunities/meta ────────────────────────────────
  // Returns available filter options without the full opportunity list.
  // Lightweight call for populating filter dropdowns.
  app.get(
    "/api/intelligence/opportunities/meta",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const result = await getOpportunityIntelligence();

        if (!result) {
          return res.status(200).json({
            available: false,
            meta:      null,
          });
        }

        return res.status(200).json({
          available:   true,
          generatedAt: result.generatedAt,
          totalCount:  result.totalCount,
          meta:        result.meta,
        });
      } catch (err) {
        console.error("[OppIntelligence] GET /opportunities/meta error:", (err as Error).message);
        return res.status(500).json({ error: "Failed to retrieve opportunity meta" });
      }
    },
  );

  // ── GET /api/intelligence/opportunities/:symbol ─────────────────────────────
  // Returns a single canonical opportunity by symbol.
  app.get(
    "/api/intelligence/opportunities/:symbol",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const { symbol } = req.params;
      if (!symbol || typeof symbol !== "string") {
        return res.status(400).json({ error: "Invalid symbol" });
      }

      try {
        const opp = await getCanonicalOpportunity(symbol.toUpperCase());

        if (!opp) {
          const health = getOpportunityIntelligenceHealth();
          if (!health.hasSnapshot) {
            return res.status(200).json({
              available: false,
              message:   "No opportunity snapshot available yet.",
              symbol:    symbol.toUpperCase(),
            });
          }
          return res.status(404).json({
            available: true,
            found:     false,
            symbol:    symbol.toUpperCase(),
            message:   `${symbol.toUpperCase()} is not a current research candidate in the active snapshot.`,
          });
        }

        return res.status(200).json({
          available: true,
          found:     true,
          opportunity: opp,
        });
      } catch (err) {
        console.error("[OppIntelligence] GET /opportunities/:symbol error:", (err as Error).message);
        return res.status(500).json({ error: "Failed to retrieve opportunity" });
      }
    },
  );
}
