// POST /api/admin/institutional/run — Institutional Intelligence admin trigger.
//
// Admin-only endpoint to fire a manual backfill without SSH/CLI access.
// Follows the established admin-route pattern used by market-data-admin.ts,
// scan/run, scheduled-scan/run, etc.
//
// Security:
//   - isAuthenticated + isAdmin middleware required (caller must pass both).
//   - Accepts only a bounded quarter count — no arbitrary URL or label injection.
//   - Returns immediately with an acknowledgement; does not hold the HTTP request.
//   - Advisory lock in runInstitutionalIngestion prevents duplicate concurrent runs.
//   - Does NOT require INSTITUTIONAL_INTELLIGENCE_ENABLED=true.
//   - Blocked by INSTITUTIONAL_13F_INGESTION_ENABLED=false or missing SEC_USER_AGENT.
//
// Does NOT expose: DATABASE_URL, SEC_USER_AGENT value, raw filing content, or
// any user credentials.

import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { isIngestionConfigured } from "../services/institutional/config";
import { runInstitutionalIngestion } from "../services/institutional/ingestion-service";
import { getPipelineStatus } from "../services/institutional/pipeline-status";
import {
  INSTITUTIONAL_MANAGER_COHORTS,
  MANAGER_COHORT_STATUSES,
} from "../services/institutional/manager-cohort-types";
import {
  listManagerCohorts,
  managerCohortSeedInputSchema,
  seedManagerCohorts,
} from "../services/institutional/manager-cohort-service";

const MAX_ADMIN_QUARTERS = 8;
const MIN_ADMIN_QUARTERS = 1;

const runBodySchema = z.object({
  /** Number of most-recent quarters to ingest. Must be 1–8. */
  quarters: z.number().int().min(MIN_ADMIN_QUARTERS).max(MAX_ADMIN_QUARTERS).default(2),
});

const cohortSeedBodySchema = z.object({
  records: z.array(managerCohortSeedInputSchema).min(1).max(500),
});

const cohortListQuerySchema = z.object({
  managerId: z.string().trim().regex(/^\d{1,10}$/).optional(),
  cohort: z.enum(INSTITUTIONAL_MANAGER_COHORTS).optional(),
  status: z.enum(MANAGER_COHORT_STATUSES).optional(),
});

export function registerInstitutionalAdminRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  isAdmin: RequestHandler,
): void {
  app.post(
    "/api/admin/institutional/manager-cohorts/seed",
    isAuthenticated,
    isAdmin,
    async (req, res) => {
      const parsed = cohortSeedBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid manager cohort seed",
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const records = await seedManagerCohorts(parsed.data.records);
        return res.json({ count: records.length, records });
      } catch (error) {
        console.error(
          "[InstitutionalAdmin] Manager cohort seed error:",
          error instanceof Error ? error.message : "Unknown error",
        );
        return res.status(400).json({ error: "Unable to seed manager cohorts" });
      }
    },
  );

  app.get(
    "/api/admin/institutional/manager-cohorts",
    isAuthenticated,
    isAdmin,
    async (req, res) => {
      const parsed = cohortListQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid manager cohort query",
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const records = await listManagerCohorts(parsed.data);
        return res.json({ count: records.length, records });
      } catch (error) {
        console.error(
          "[InstitutionalAdmin] Manager cohort list error:",
          error instanceof Error ? error.message : "Unknown error",
        );
        return res.status(500).json({ error: "Unable to list manager cohorts" });
      }
    },
  );

  /**
   * POST /api/admin/institutional/run
   * Body: { quarters?: number }  (default 2)
   *
   * Fires a non-blocking ingestion run and returns an acknowledgement.
   * The advisory lock inside runInstitutionalIngestion prevents concurrent runs.
   */
  app.post(
    "/api/admin/institutional/run",
    isAuthenticated,
    isAdmin,
    async (req, res) => {
      try {
        // Validate body
        const bodyParse = runBodySchema.safeParse(req.body ?? {});
        if (!bodyParse.success) {
          return res.status(400).json({
            error: "Invalid request",
            details: bodyParse.error.flatten().fieldErrors,
          });
        }
        const { quarters } = bodyParse.data;

        // Preflight — fail early if ingestion is not configured
        if (!isIngestionConfigured()) {
          return res.status(503).json({
            error: "Ingestion not configured",
            detail:
              "SEC_USER_AGENT is not set or INSTITUTIONAL_13F_INGESTION_ENABLED=false. " +
              "Configure both before triggering a manual backfill.",
          });
        }

        // Fire-and-forget — do not await; advisory lock prevents duplicates
        runInstitutionalIngestion({
          initiatedBy: "admin_manual",
          quartersOverride: quarters,
        }).catch((err: any) => {
          console.error("[InstitutionalAdmin] Background ingestion error:", err?.message);
        });

        // Return immediately with acknowledgement
        return res.status(202).json({
          status: "accepted",
          message: `Institutional 13F backfill started for ${quarters} quarter(s). Check server logs for progress.`,
          quarters,
          note: "Advisory lock prevents duplicate concurrent runs. The public Institutional tab is controlled separately by INSTITUTIONAL_INTELLIGENCE_ENABLED.",
        });
      } catch (err: any) {
        console.error("[InstitutionalAdmin] Route error:", err?.message);
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  /**
   * GET /api/admin/institutional/pipeline-status
   *
   * Returns full pipeline status for all priority quarters including state,
   * progress percentage, stored counts, and next expected run time.
   * Suitable for admin dashboards and monitoring alerts.
   */
  app.get(
    "/api/admin/institutional/pipeline-status",
    isAuthenticated,
    isAdmin,
    async (_req, res) => {
      try {
        const configured = isIngestionConfigured();
        const schedulerEnabled = process.env.INSTITUTIONAL_13F_INGESTION_ENABLED !== "false";
        const priorityQuarters = ["2026-Q1", "2025-Q4", "2025-Q3", "2025-Q2"];

        const status = await getPipelineStatus(priorityQuarters, {
          schedulerEnabled,
          ingestionConfigured: configured,
        });

        return res.json(status);
      } catch (err: any) {
        console.error("[InstitutionalAdmin] Pipeline-status route error:", err?.message);
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  /**
   * GET /api/admin/institutional/status
   * Returns current ingestion configuration state (no secrets).
   */
  app.get(
    "/api/admin/institutional/status",
    isAuthenticated,
    isAdmin,
    async (_req, res) => {
      try {
        const configured = isIngestionConfigured();
        const publicEnabled = process.env.INSTITUTIONAL_INTELLIGENCE_ENABLED === "true";
        const ingestionEnabled = process.env.INSTITUTIONAL_13F_INGESTION_ENABLED !== "false";
        const hasUserAgent = !!(process.env.SEC_USER_AGENT ?? "").trim();

        return res.json({
          ingestionConfigured: configured,
          publicFeatureEnabled: publicEnabled,
          ingestionEnabled,
          secUserAgentConfigured: hasUserAgent,
          // Safe message — does not expose the actual value
          note: hasUserAgent
            ? "SEC_USER_AGENT is configured."
            : "SEC_USER_AGENT is not set. Ingestion is blocked until this is configured.",
        });
      } catch (err: any) {
        console.error("[InstitutionalAdmin] Status route error:", err?.message);
        return res.status(500).json({ error: "Internal server error" });
      }
    },
  );
}
