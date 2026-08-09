// Sprint 2.5.5 — Research Reports API Routes
//
// POST   /api/research-reports           — generate new report
// GET    /api/research-reports           — list / search reports
// GET    /api/research-reports/health    — platform health stats
// GET    /api/research-reports/:id       — get single report
// PATCH  /api/research-reports/:id       — update (pin / rename / archive)
// DELETE /api/research-reports/:id       — soft-delete (archive)
// GET    /api/research-reports/:id/export — export in requested format
//
// All routes require isAuthenticated.

import type { Express, Request, Response, RequestHandler } from "express";
import {
  generateReport,
  listReports,
  getReport,
  updateReport,
  deleteReport,
  exportReport,
  getResearchReportsHealth,
} from "../services/research-report-service";
import { REPORT_TYPES, EXPORT_FORMATS } from "@shared/research-report-types";
import type { ReportType, ExportFormat, ReportSearchOptions, GenerateReportOptions } from "@shared/research-report-types";

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export function registerResearchReportRoutes(
  app: Express,
  isAuthenticated: RequestHandler
): void {
  // -------------------------------------------------------------------------
  // POST /api/research-reports — generate a new report
  // -------------------------------------------------------------------------
  app.post("/api/research-reports", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id as string | undefined;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { reportType, title, subtitle, tags, themeId, sector, collectionId } = req.body ?? {};

      if (!reportType || !REPORT_TYPES.includes(reportType as ReportType)) {
        return res.status(400).json({
          error: "Invalid or missing reportType",
          validTypes: REPORT_TYPES,
        });
      }

      const options: GenerateReportOptions = {};
      if (typeof title    === "string" && title.trim())    options.title    = title.trim().slice(0, 120);
      if (typeof subtitle === "string" && subtitle.trim()) options.subtitle = subtitle.trim().slice(0, 200);
      if (Array.isArray(tags)) options.tags = tags.filter((t: unknown) => typeof t === "string").slice(0, 10);
      if (typeof themeId      === "string") options.themeId      = themeId;
      if (typeof sector       === "string") options.sector       = sector;
      if (typeof collectionId === "string") options.collectionId = collectionId;

      const report = await generateReport(userId, reportType as ReportType, options);
      return res.status(201).json({ report });
    } catch (err: any) {
      console.error("[research-reports] POST error:", err?.message);
      return res.status(500).json({ error: "Failed to generate report", detail: err?.message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/research-reports — list / search reports (must come before :id)
  // -------------------------------------------------------------------------
  app.get("/api/research-reports/health", isAuthenticated, async (_req: Request, res: Response) => {
    try {
      const health = await getResearchReportsHealth();
      return res.json({ health });
    } catch (err: any) {
      return res.status(500).json({ error: "Health check failed", detail: err?.message });
    }
  });

  app.get("/api/research-reports", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id as string | undefined;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const q = req.query as Record<string, string | undefined>;

      const searchOptions: ReportSearchOptions = {};
      if (q.reportType) {
        const types = q.reportType.split(",").filter(t => REPORT_TYPES.includes(t as ReportType));
        if (types.length === 1) searchOptions.reportType = types[0] as ReportType;
        else if (types.length > 1) searchOptions.reportType = types as ReportType[];
      }
      if (q.status && ["published", "archived"].includes(q.status)) {
        searchOptions.status = q.status as "published" | "archived";
      }
      if (q.isPinned !== undefined) searchOptions.isPinned = q.isPinned === "true";
      if (q.marketRegime) searchOptions.marketRegime = q.marketRegime;
      if (q.keyword)      searchOptions.keyword      = q.keyword.slice(0, 100);
      if (q.symbol)       searchOptions.symbol       = q.symbol.toUpperCase();
      if (q.theme)        searchOptions.theme        = q.theme;
      if (q.sector)       searchOptions.sector       = q.sector;
      if (q.collectionId) searchOptions.collectionId = q.collectionId;
      if (q.fromDate)     searchOptions.fromDate     = q.fromDate;
      if (q.toDate)       searchOptions.toDate       = q.toDate;
      if (q.sortBy && ["generatedAt", "title", "reportType"].includes(q.sortBy)) {
        searchOptions.sortBy = q.sortBy as ReportSearchOptions["sortBy"];
      }
      if (q.sortDir && ["asc", "desc"].includes(q.sortDir)) {
        searchOptions.sortDir = q.sortDir as "asc" | "desc";
      }
      const limit  = Math.min(parseInt(q.limit  ?? "50", 10) || 50, 100);
      const offset = parseInt(q.offset ?? "0", 10) || 0;
      searchOptions.limit  = limit;
      searchOptions.offset = offset;

      const reports = await listReports(userId, searchOptions);
      return res.json({ reports, count: reports.length, limit, offset });
    } catch (err: any) {
      console.error("[research-reports] list error:", err?.message);
      return res.status(500).json({ error: "Failed to list reports", detail: err?.message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/research-reports/:id — single report
  // -------------------------------------------------------------------------
  app.get("/api/research-reports/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id as string | undefined;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const report = await getReport(req.params.id, userId);
      if (!report) return res.status(404).json({ error: "Report not found" });
      return res.json({ report });
    } catch (err: any) {
      return res.status(500).json({ error: "Failed to get report", detail: err?.message });
    }
  });

  // -------------------------------------------------------------------------
  // PATCH /api/research-reports/:id — update
  // -------------------------------------------------------------------------
  app.patch("/api/research-reports/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id as string | undefined;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { title, isPinned, status, tags } = req.body ?? {};
      const updates: Record<string, unknown> = {};
      if (typeof title    === "string")  updates.title    = title.slice(0, 120);
      if (typeof isPinned === "boolean") updates.isPinned = isPinned;
      if (status === "published" || status === "archived") updates.status = status;
      if (Array.isArray(tags)) updates.tags = tags.filter((t: unknown) => typeof t === "string").slice(0, 10);

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid update fields provided" });
      }

      const updated = await updateReport(req.params.id, userId, updates);
      if (!updated) return res.status(404).json({ error: "Report not found" });
      return res.json({ report: updated });
    } catch (err: any) {
      return res.status(500).json({ error: "Failed to update report", detail: err?.message });
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/research-reports/:id — soft delete
  // -------------------------------------------------------------------------
  app.delete("/api/research-reports/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id as string | undefined;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const ok = await deleteReport(req.params.id, userId);
      if (!ok) return res.status(404).json({ error: "Report not found" });
      return res.json({ ok: true, archived: true });
    } catch (err: any) {
      return res.status(500).json({ error: "Failed to delete report", detail: err?.message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/research-reports/:id/export
  // -------------------------------------------------------------------------
  app.get("/api/research-reports/:id/export", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id as string | undefined;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const format = (req.query.format ?? "json") as string;
      if (!EXPORT_FORMATS.includes(format as ExportFormat)) {
        return res.status(400).json({
          error: "Invalid export format",
          validFormats: EXPORT_FORMATS,
        });
      }

      const result = await exportReport(req.params.id, userId, format as ExportFormat);
      if (result === null) return res.status(404).json({ error: "Report not found" });

      if (format === "html") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(result as string);
      }
      if (format === "markdown") {
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        return res.send(result as string);
      }
      return res.json({ format, content: result });
    } catch (err: any) {
      return res.status(500).json({ error: "Export failed", detail: err?.message });
    }
  });
}
