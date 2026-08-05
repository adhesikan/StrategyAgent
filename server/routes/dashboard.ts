// Dashboard Orchestration API — Sprint 5.5
//
// GET /api/dashboard
//
// Single endpoint that fans out to all data sources in bounded parallel using
// Promise.allSettled. Each section is independently tagged with status: "ok" |
// "unavailable" so the client can isolate failures without a waterfall.
//
// Trust rules:
//   - userId from req.session only; never from query/body.
//   - No account numbers or broker identifiers returned to client.
//   - No raw internal enums in savedResearch (verdicts come from the stored record).
//   - No fabricated data — missing fields return status "unavailable".

import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { authStorage } from "../replit_integrations/auth";
import { ResearchRecordService } from "../services/research-record-service";
import { generateCandidateScenarios } from "../services/opportunity-radar/radar-service";
import { getTrialFeatureRestriction } from "../services/daily-market-data/trial-entitlement";
import { buildHomeSnapshot } from "./home-snapshot";

export function registerDashboardRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  app.get("/api/dashboard", isAuthenticated, async (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    // Resolve trial restrictions once; needed for radar filter enforcement
    const userRecord = await authStorage.getUser(userId).catch(() => null);
    const restriction = userRecord
      ? await getTrialFeatureRestriction(userRecord).catch(() => null)
      : null;

    // Build radar filters — trial users get restricted universe
    const radarFilters: Parameters<typeof generateCandidateScenarios>[1] = {
      timeHorizon: "1_4w",
      universe: "watchlist",
      maxLoss: 2000,
    };
    if (restriction?.restricted) {
      radarFilters.customSymbols = restriction.allowedSymbols;
      delete radarFilters.universe;
    }

    // Fan out in parallel — all settle independently
    const [
      snapshotResult,
      radarResult,
      brokerConnectionResult,
      researchResult,
      watchlistsResult,
    ] = await Promise.allSettled([
      buildHomeSnapshot(userId),
      generateCandidateScenarios(userId, radarFilters),
      storage.getBrokerConnection(userId),
      ResearchRecordService.listForUser(userId, { limit: 5, archived: false }),
      storage.getWatchlists(userId),
    ]);

    const brokerConnection =
      brokerConnectionResult.status === "fulfilled"
        ? brokerConnectionResult.value
        : null;
    const brokerConnected = !!(brokerConnection?.isConnected);

    // Fetch positions only when broker is connected — avoids an unnecessary call
    let positionsResult: PromiseSettledResult<any[]> = {
      status: "rejected",
      reason: "not_connected",
    };
    if (brokerConnected) {
      try {
        const brokerService = await import("../broker/index");
        const positions = await brokerService.getBrokerPositions(userId);
        positionsResult = { status: "fulfilled", value: positions ?? [] };
      } catch (err) {
        positionsResult = { status: "rejected", reason: String(err) };
      }
    }

    // Clamp radar candidates for trial users
    let radarCandidates: any[] = [];
    if (radarResult.status === "fulfilled") {
      radarCandidates = Array.isArray((radarResult.value as any)?.candidates)
        ? (radarResult.value as any).candidates
        : [];
      if (restriction?.restricted) {
        radarCandidates = radarCandidates
          .filter((c) =>
            restriction.allowedSymbols.includes(
              String(c.symbol ?? "").toUpperCase(),
            ),
          )
          .slice(0, restriction.radarResultLimit ?? 5);
      }
    }

    // Sanitize positions — never return account IDs or raw balances
    const sanitizedPositions =
      positionsResult.status === "fulfilled"
        ? (positionsResult.value ?? []).map((p: any) => ({
            symbol: p.symbol,
            qty: p.qty ?? p.quantity ?? 0,
            costBasis: p.costBasis ?? p.averagePrice ?? null,
            marketPrice: p.marketPrice ?? p.last ?? null,
            unrealizedPnl: p.unrealizedPnl ?? p.unrealizedPnL ?? null,
          }))
        : [];

    return res.json({
      marketSnapshot:
        snapshotResult.status === "fulfilled"
          ? { status: "ok", data: snapshotResult.value }
          : { status: "unavailable" },

      opportunities:
        radarResult.status === "fulfilled"
          ? {
              status: "ok",
              candidates: radarCandidates.slice(0, 5),
              dataMode: (radarResult.value as any)?.dataMode ?? "simulated",
            }
          : { status: "unavailable" },

      portfolio: {
        brokerConnected,
        status:
          brokerConnected && positionsResult.status === "fulfilled"
            ? "ok"
            : brokerConnected
            ? "unavailable"
            : "not_connected",
        positions: brokerConnected ? sanitizedPositions : undefined,
      },

      savedResearch:
        researchResult.status === "fulfilled"
          ? { status: "ok", records: researchResult.value }
          : { status: "unavailable" },

      watchlists:
        watchlistsResult.status === "fulfilled"
          ? { status: "ok", items: watchlistsResult.value ?? [] }
          : { status: "unavailable" },
    });
  });
}
