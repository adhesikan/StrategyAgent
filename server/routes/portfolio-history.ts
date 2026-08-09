/**
 * Portfolio History Routes — Sprint 2.6.0
 *
 * API endpoints for portfolio snapshots, history, and change intelligence.
 * All routes are authenticated and user-isolated — cross-user portfolio IDs
 * return 404 with no leakage through error messages or counts.
 *
 * COMPLIANCE:
 *   Responses use "Portfolio Change", "Observed Change", "Research Evidence Improved"
 *   Never: "You bought", "You sold", "Recommendation"
 */

import type { Express, RequestHandler } from "express";
import {
  capturePortfolioSnapshot,
  getPortfolioSnapshots,
  getPortfolioChanges,
} from "../services/portfolio-history-service";
import type { HistoryPeriod, SnapshotSourceType } from "../../shared/portfolio-history-types";

const VALID_PERIODS: HistoryPeriod[] = ["7D", "30D", "90D", "YTD", "1Y", "ALL"];

export function registerPortfolioHistoryRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  // ── GET /api/portfolio/:id/history ────────────────────────────────────────
  //
  // Returns portfolio snapshot timeline for the given period.
  // Periods: 7D (default) | 30D | 90D | YTD | 1Y | ALL
  // Cross-user portfolios return 404.

  app.get("/api/portfolio/:id/history", isAuthenticated, async (req, res) => {
    try {
      const userId      = req.session.userId!;
      const portfolioId = req.params.id;
      const period      = (req.query.period as HistoryPeriod) ?? "30D";

      if (!VALID_PERIODS.includes(period)) {
        return res.status(400).json({
          error:        "Invalid period",
          validPeriods: VALID_PERIODS,
        });
      }

      const snapshots = await getPortfolioSnapshots(portfolioId, userId, period);

      // getPortfolioSnapshots returns [] for non-existent/wrong-user portfolios
      // which is safe — no information leakage about whether the portfolio exists
      return res.json({
        portfolioId,
        period,
        snapshots,
        count: snapshots.length,
        disclaimer: "Portfolio history is provided for research and analytics purposes and does not constitute investment advice.",
      });
    } catch (err) {
      console.error("[portfolio-history] history error:", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "Failed to load portfolio history" });
    }
  });

  // ── GET /api/portfolio/:id/changes ────────────────────────────────────────
  //
  // Returns deterministic portfolio change classification.
  // Query params:
  //   from=<snapshotId>   Optional — defaults to the snapshot before the latest
  //   to=<snapshotId>     Optional — defaults to the latest snapshot
  // Cross-user snapshot IDs return null / 404.

  app.get("/api/portfolio/:id/changes", isAuthenticated, async (req, res) => {
    try {
      const userId         = req.session.userId!;
      const portfolioId    = req.params.id;
      const fromSnapshotId = req.query.from  as string | undefined;
      const toSnapshotId   = req.query.to    as string | undefined;

      const result = await getPortfolioChanges(
        portfolioId,
        userId,
        fromSnapshotId,
        toSnapshotId,
      );

      if (!result) {
        return res.status(404).json({
          error: "Portfolio not found, or insufficient snapshot history to compare. Capture at least two snapshots to see changes.",
        });
      }

      return res.json({
        changes:    result,
        disclaimer: "Portfolio change information is provided for research and analytics purposes and does not constitute investment advice.",
      });
    } catch (err) {
      console.error("[portfolio-history] changes error:", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "Failed to compute portfolio changes" });
    }
  });

  // ── POST /api/portfolio/:id/snapshot ─────────────────────────────────────
  //
  // Manually capture a portfolio snapshot.
  // Deduplication: identical fingerprint within 30 minutes → 200 with skipped=true.
  // Rate protection: deduplication fingerprint is the primary guard.

  app.post("/api/portfolio/:id/snapshot", isAuthenticated, async (req, res) => {
    try {
      const userId      = req.session.userId!;
      const portfolioId = req.params.id;

      const result = await capturePortfolioSnapshot(portfolioId, userId, {
        sourceType: "manual_snapshot",
      });

      if (!result.ok && !result.skipped) {
        return res.status(result.reason?.includes("not found") ? 404 : 400).json({
          error: result.reason ?? "Snapshot capture failed",
        });
      }

      return res.status(result.skipped ? 200 : 201).json({
        ok:         true,
        snapshotId: result.snapshotId ?? null,
        skipped:    result.skipped ?? false,
        message:    result.skipped
                      ? "Identical snapshot captured in last 30 minutes — no duplicate created"
                      : "Portfolio snapshot captured successfully",
        durationMs: result.durationMs ?? null,
      });
    } catch (err) {
      console.error("[portfolio-history] snapshot error:", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "Snapshot capture failed" });
    }
  });
}
