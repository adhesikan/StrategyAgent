// Dashboard Orchestration API — Sprint 5.5 / Task #58 (real market data)
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
//   - No fabricated data — missing fields return status "unavailable".
//   - dataMode "simulated" has been removed; all candidates are real or missing.

import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { authStorage } from "../replit_integrations/auth";
import { ResearchRecordService } from "../services/research-record-service";
import { generateCandidateScenarios } from "../services/opportunity-radar/radar-service";
import { getTrialFeatureRestriction } from "../services/daily-market-data/trial-entitlement";
import { buildHomeSnapshot } from "./home-snapshot";
import { buildAiInfraWatch } from "../services/ai-infra-watch";

/** Strategy types that map to "growth" opportunities (stock or bullish-options). */
const GROWTH_STRATEGIES = new Set(["stock_swing", "long_call", "debit_spread"]);

/** Strategy types that map to "income" opportunities. */
const INCOME_STRATEGIES = new Set(["covered_call", "cash_secured_put"]);

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

    // Build radar filters — broader universe to allow strategy-based splitting.
    // Trial users get a restricted symbol set.
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
      aiInfraResult,
      brokerConnectionResult,
      researchResult,
      watchlistsResult,
    ] = await Promise.allSettled([
      buildHomeSnapshot(userId),
      generateCandidateScenarios(userId, radarFilters),
      buildAiInfraWatch(userId),
      storage.getBrokerConnection(userId),
      ResearchRecordService.listForUser(userId, { limit: 5, archived: false }),
      storage.getWatchlists(userId),
    ]);

    const brokerConnection =
      brokerConnectionResult.status === "fulfilled"
        ? brokerConnectionResult.value
        : null;
    const brokerConnected = !!(brokerConnection?.isConnected);

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

    // Clamp and split radar candidates by strategy type
    let allCandidates: any[] = [];
    if (radarResult.status === "fulfilled") {
      allCandidates = Array.isArray((radarResult.value as any)?.candidates)
        ? (radarResult.value as any).candidates
        : [];
      if (restriction?.restricted) {
        allCandidates = allCandidates
          .filter((c) =>
            restriction.allowedSymbols.includes(
              String(c.symbol ?? "").toUpperCase(),
            ),
          )
          .slice(0, restriction.radarResultLimit ?? 5);
      }
    }

    // Real-data eligibility gate: exclude candidates built on mock/hash-derived quotes.
    //   "live"      — broker real-time quotes  ✓ real
    //   "mixed"     — broker + Twelve Data stored bars  ✓ real
    //   "simulated" — no broker, no stored bars, hash-derived mock only  ✗ excluded
    //
    // This enforces Task #58: only real market data surfaces to traders.
    // Candidates that pass the gate have their internal dataMode stripped before
    // reaching the client; provenance is communicated via section-level status only.
    const realCandidates = allCandidates.filter(
      (c: any) => c.dataMode !== "simulated",
    );

    function stripProvenance(c: any) {
      const { dataMode: _dropped, ...rest } = c;
      return rest;
    }

    // Split real candidates into strategy buckets
    const growthCandidates = realCandidates
      .filter((c: any) => GROWTH_STRATEGIES.has(c.strategyType) && c.bias !== "bearish")
      .slice(0, 5)
      .map(stripProvenance);
    const incomeCandidates = realCandidates
      .filter((c: any) => INCOME_STRATEGIES.has(c.strategyType))
      .slice(0, 5)
      .map(stripProvenance);
    // Watchlist movers: any real-data strategy, sorted by score descending
    const watchlistCandidates = realCandidates
      .slice()
      .sort((a: any, b: any) => (b.finalScore ?? 0) - (a.finalScore ?? 0))
      .slice(0, 5)
      .map(stripProvenance);

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

      // Growth opportunities: stock_swing + long_call (bullish bias)
      // dataMode intentionally omitted — radar's internal "simulated" flag must never surface.
      growthOpportunities:
        radarResult.status === "fulfilled"
          ? { status: "ok", candidates: growthCandidates }
          : { status: "unavailable" },

      // Income opportunities: covered_call + cash_secured_put
      incomeOpportunities:
        radarResult.status === "fulfilled"
          ? { status: "ok", candidates: incomeCandidates }
          : { status: "unavailable" },

      // Top-ranked candidates across all strategies (watchlist movers)
      watchlistOpportunities:
        radarResult.status === "fulfilled"
          ? { status: "ok", candidates: watchlistCandidates }
          : { status: "unavailable" },

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
