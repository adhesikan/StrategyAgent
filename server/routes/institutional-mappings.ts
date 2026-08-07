// Institutional Mapping Routes — Sprint 2.2.5 (updated)
//
// Public (authenticated):
//   GET  /api/institutional/mappings          — paginated mapping queue
//   GET  /api/institutional/unmapped          — top unmapped issuers
//   GET  /api/institutional/mapping-audit     — stats + audit summary
//
// Admin-only:
//   POST /api/institutional/mapping-pipeline  — run the mapping pipeline
//   POST /api/institutional/review            — approve / reject / merge
//
// Security:
//   - isAuthenticated required on all routes
//   - isAdmin required on mutating routes
//   - No raw holdings, CUSIPs, or issuer names returned unless requested
//   - All user-supplied tickers/CUSIPs are validated before DB writes

import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  getMappingQueue,
  getMappingStats,
  getTopUnmapped,
  getMappingAudit,
  approveMapping,
  rejectMapping,
  mergeMapping,
  runMappingPipeline,
} from "../services/institutional/security-master-service";

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

/** True when the error is a missing-table error (migration not yet applied). */
export function isTableMissingError(err: unknown): boolean {
  const msg = (err as any)?.message ?? "";
  // Postgres: "relation \"security_master\" does not exist"
  return /relation .* does not exist/i.test(msg) || /table .* does not exist/i.test(msg);
}

/** Empty MappingPage — the shape the queue endpoint always returns. */
export const EMPTY_QUEUE = { entries: [] as any[], total: 0, page: 1, pageSize: 25 };

/** Empty MappingAudit — the shape the audit endpoint always returns. */
export const EMPTY_AUDIT = {
  stats: {
    reviewed: 0, probable: 0, needsReview: 0, unmapped: 0, rejected: 0,
    total: 0, mappedHoldings: 0, unmappedHoldings: 0, totalHoldings: 0, coveragePercent: 0,
  },
  topUnmapped: [] as any[],
  remainingWork: { toReview: 0, estimatedReviewMinutes: 0 },
};

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const queueQuerySchema = z.object({
  status: z
    .enum(["reviewed", "probable", "needs_review", "unmapped", "rejected", "all"])
    .default("all"),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  orderBy: z.enum(["holdingCount", "confidence", "lastVerified"]).default("holdingCount"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

const reviewBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    cusip: z.string().length(9).regex(/^[A-Z0-9]{9}$/, "CUSIP must be 9 uppercase alphanumeric characters"),
    ticker: z.string().min(1).max(10).regex(/^[A-Z]{1,10}$/, "Ticker must be 1–10 uppercase letters"),
    exchange: z.enum(["NYSE", "NASDAQ", "OTC", "CBOE", "other"]).optional(),
    assetType: z.enum(["common_stock", "etf", "reit", "adr", "preferred", "warrant", "other"]).optional(),
    notes: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("reject"),
    cusip: z.string().length(9).regex(/^[A-Z0-9]{9}$/),
    notes: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("merge"),
    fromCusip: z.string().length(9).regex(/^[A-Z0-9]{9}$/),
    intoCusip: z.string().length(9).regex(/^[A-Z0-9]{9}$/),
  }),
]);

const pipelineBodySchema = z.object({
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/).optional(),
  limitCusips: z.number().int().min(1).max(10000).optional(),
});

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerInstitutionalMappingRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  isAdmin: RequestHandler,
): void {
  /**
   * GET /api/institutional/mappings
   * Paginated view of the security_master queue.
   * Returns EMPTY_QUEUE shape when table has not been migrated yet.
   */
  app.get("/api/institutional/mappings", isAuthenticated, async (req, res) => {
    try {
      const parsed = queueQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors });
      }
      const result = await getMappingQueue(parsed.data);
      return res.json(result);
    } catch (err: any) {
      if (isTableMissingError(err)) {
        console.warn("[mapping-queue] security_master table not found — migration needed");
        return res.json({ ...EMPTY_QUEUE, page: Number(req.query.page ?? 1) });
      }
      console.error("[mapping-queue]", err?.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /api/institutional/unmapped
   * Top unmapped issuers by holding count.
   * Returns empty list when table has not been migrated yet.
   */
  app.get("/api/institutional/unmapped", isAuthenticated, async (req, res) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 25)));
      const rows = await getTopUnmapped(limit);
      return res.json({ unmapped: rows, count: rows.length });
    } catch (err: any) {
      if (isTableMissingError(err)) {
        console.warn("[unmapped-issuers] security_master table not found — migration needed");
        return res.json({ unmapped: [], count: 0 });
      }
      console.error("[unmapped-issuers]", err?.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /api/institutional/mapping-audit
   * Full audit: stats + coverage + top unmapped + remaining work.
   * Returns EMPTY_AUDIT shape when table has not been migrated yet.
   */
  app.get("/api/institutional/mapping-audit", isAuthenticated, async (_req, res) => {
    try {
      const audit = await getMappingAudit();
      return res.json(audit);
    } catch (err: any) {
      if (isTableMissingError(err)) {
        console.warn("[mapping-audit] security_master table not found — migration needed");
        return res.json(EMPTY_AUDIT);
      }
      console.error("[mapping-audit]", err?.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /api/institutional/review
   * Approve, reject, or merge a mapping. Admin-only.
   */
  app.post("/api/institutional/review", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const parsed = reviewBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
      }

      const body = parsed.data;
      let result: any;

      if (body.action === "approve") {
        result = await approveMapping(body.cusip, body.ticker, {
          exchange: body.exchange,
          assetType: body.assetType,
          notes: body.notes,
        });
        return res.json({ status: "approved", mapping: result });
      }

      if (body.action === "reject") {
        result = await rejectMapping(body.cusip, body.notes);
        return res.json({ status: "rejected", mapping: result });
      }

      if (body.action === "merge") {
        result = await mergeMapping(body.fromCusip, body.intoCusip);
        return res.json({ status: "merged", mapping: result });
      }

      return res.status(400).json({ error: "Unknown action" });
    } catch (err: any) {
      if (err?.message?.includes("not found") || err?.message?.includes("not reviewed")) {
        return res.status(404).json({ error: err.message });
      }
      if (err?.message?.includes("already reviewed")) {
        return res.status(409).json({ error: err.message });
      }
      console.error("[mapping-review]", err?.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /api/institutional/mapping-pipeline
   * Run the CUSIP → ticker mapping pipeline. Admin-only.
   */
  app.post("/api/institutional/mapping-pipeline", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const parsed = pipelineBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
      }

      const result = await runMappingPipeline(parsed.data);
      return res.json({ status: "complete", result });
    } catch (err: any) {
      if (isTableMissingError(err)) {
        console.warn("[mapping-pipeline] security_master or holdings table missing — run migration first");
        return res.status(503).json({
          error: "Schema migration required",
          detail: "Run scripts/migrate-security-master.sql and scripts/migrate-institutional.sql on the production database before using the mapping pipeline.",
        });
      }
      console.error("[mapping-pipeline]", err?.message);
      return res.status(500).json({ error: "Internal server error", detail: err?.message });
    }
  });

  /**
   * GET /api/admin/institutional/mapping-diagnostics
   * Read-only table health check — counts rows in holdings + security_master.
   * Used by operators to verify migration status and pipeline readiness.
   */
  app.get("/api/admin/institutional/mapping-diagnostics", isAuthenticated, isAdmin, async (_req, res) => {
    const result: Record<string, any> = {};

    // Check institutional_13f_holdings
    try {
      const holdingsCount = await db.execute(sql`
        SELECT
          COUNT(*)::int              AS total_rows,
          COUNT(DISTINCT cusip)::int AS distinct_cusips,
          COUNT(figi)::int           AS non_null_figi
        FROM institutional_13f_holdings
      `);
      const hRow = ((holdingsCount as any).rows ?? holdingsCount)[0] ?? {};
      result.holdings = {
        tableExists: true,
        totalRows: Number(hRow.total_rows ?? 0),
        distinctCusips: Number(hRow.distinct_cusips ?? 0),
        nonNullFigi: Number(hRow.non_null_figi ?? 0),
      };
    } catch (err: any) {
      result.holdings = { tableExists: false, error: err?.message };
    }

    // Check security_master
    try {
      const smCount = await db.execute(sql`
        SELECT
          COUNT(*)::int                                                    AS total_rows,
          COUNT(*) FILTER (WHERE review_status = 'reviewed')::int         AS reviewed,
          COUNT(*) FILTER (WHERE review_status = 'probable')::int         AS probable,
          COUNT(*) FILTER (WHERE review_status = 'needs_review')::int     AS needs_review,
          COUNT(*) FILTER (WHERE review_status = 'unmapped')::int         AS unmapped,
          COUNT(*) FILTER (WHERE review_status = 'rejected')::int         AS rejected,
          ARRAY_AGG(DISTINCT review_status ORDER BY review_status)        AS distinct_statuses
        FROM security_master
      `);
      const sRow = ((smCount as any).rows ?? smCount)[0] ?? {};
      result.securityMaster = {
        tableExists: true,
        totalRows: Number(sRow.total_rows ?? 0),
        reviewed: Number(sRow.reviewed ?? 0),
        probable: Number(sRow.probable ?? 0),
        needsReview: Number(sRow.needs_review ?? 0),
        unmapped: Number(sRow.unmapped ?? 0),
        rejected: Number(sRow.rejected ?? 0),
        distinctStatuses: sRow.distinct_statuses ?? [],
      };
    } catch (err: any) {
      result.securityMaster = { tableExists: false, error: err?.message };
    }

    result.migrationStatus = {
      holdingsReady: result.holdings?.tableExists && result.holdings?.totalRows > 0,
      securityMasterReady: result.securityMaster?.tableExists,
      pipelineCanRun: result.holdings?.tableExists && result.securityMaster?.tableExists,
      recommendation: (() => {
        if (!result.holdings?.tableExists) return "Run migrate-institutional.sql";
        if (!result.securityMaster?.tableExists) return "Run migrate-security-master.sql";
        if (result.holdings?.totalRows === 0) return "Holdings table is empty — ingest 13F data first";
        if (result.securityMaster?.totalRows === 0) return "Run Mapping Pipeline to populate security_master";
        return "Ready";
      })(),
    };

    return res.json(result);
  });
}
