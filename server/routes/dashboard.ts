// Dashboard Orchestration API — Sprint 5.5 / Step 1 (Real Pipeline)
//
// GET /api/dashboard
//
// Single endpoint that fans out to all data sources via Promise.allSettled.
// Each section is independently tagged with status: "ok" | "unavailable" so
// the client can isolate failures without a waterfall.
//
// Stock opportunities are NO LONGER included here. They are served by the
// Opportunity Engine via GET /api/opportunities/latest (pre-computed, async).
// This removes all synchronous MCP opportunity generation from the dashboard.
//
// Trust rules:
//   - userId from req.session only; never from query/body.
//   - No account numbers or broker identifiers returned to client.
//   - No fabricated data — missing fields return status "unavailable".
//   - OpenAI is never called in this route.

import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { ResearchRecordService } from "../services/research-record-service";
import { buildHomeSnapshot } from "./home-snapshot";
import { buildAiInfraWatch } from "../services/ai-infra-watch";
import { buildOptionsAvailability } from "../services/dashboard-stock-opportunities";

export function registerDashboardRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  app.get("/api/dashboard", isAuthenticated, async (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    // Check broker connection first (non-blocking; needed for optionsAvailability)
    const brokerConnection = await storage.getBrokerConnection(userId).catch(() => null);
    const brokerConnected = !!(brokerConnection?.isConnected);

    // Fan out in parallel — all settle independently
    const [
      snapshotResult,
      aiInfraResult,
      researchResult,
      watchlistsResult,
    ] = await Promise.allSettled([
      buildHomeSnapshot(userId),
      buildAiInfraWatch(userId),
      ResearchRecordService.listForUser(userId, { limit: 5, archived: false }),
      storage.getWatchlists(userId),
    ]);

    // Fetch positions only when broker is connected
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

      // Options-data boundary: always honest about what is and isn't available.
      optionsAvailability: buildOptionsAvailability(brokerConnected),

      // AI Infrastructure Watch (NVDA, AMD, MU, AVGO, MRVL, CRDO, ANET, TSM)
      aiInfraWatch:
        aiInfraResult.status === "fulfilled"
          ? aiInfraResult.value
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
