/**
 * Broker Synchronization Routes — Sprint 2.4.2
 *
 * Part 2 — Broker Connection Center
 * Part 3 — Synchronization trigger
 * Part 4 — Sync status
 * Part 5 — Refresh (manual sync)
 *
 * All routes require authentication. No broker credentials, tokens,
 * or account IDs are returned to the client.
 */

import type { Express, RequestHandler, Request, Response } from "express";
import { db } from "../db";
import { portfolios, portfolioPositions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { storage } from "../storage";
import {
  syncPortfolioFromBroker,
  getPortfolioSyncState,
  isPortfolioSyncRunning,
  runBrokerSync,
} from "../services/broker-sync-service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUserId(req: Request): string {
  return (req.user as { id: string })?.id ?? (req.session as any)?.userId ?? "";
}

/** Safe broker connection info — never exposes tokens or credentials. */
async function safeConnectionInfo(userId: string, provider: string) {
  try {
    const conn = await storage.getBrokerConnection(userId);
    if (!conn || conn.provider !== provider) return { connected: false };
    return {
      connected:   conn.isConnected ?? false,
      provider:    conn.provider,
      accountId:   conn.accountId ?? null,       // display-only, not a token
      connectedAt: conn.connectedAt ?? null,
    };
  } catch {
    return { connected: false };
  }
}

const SUPPORTED_PROVIDERS = ["tradier", "tradestation"] as const;
type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

function isSupportedProvider(p: string): p is SupportedProvider {
  return SUPPORTED_PROVIDERS.includes(p as SupportedProvider);
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerBrokerSyncRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
): void {

  // -------------------------------------------------------------------------
  // GET /api/portfolio/broker/connections
  // Returns broker OAuth status + any linked portfolios + sync state.
  // No tokens exposed.
  // -------------------------------------------------------------------------
  app.get("/api/portfolio/broker/connections", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const [tradierConn, tsConn, userPortfolios] = await Promise.all([
        safeConnectionInfo(userId, "tradier"),
        safeConnectionInfo(userId, "tradestation"),
        db.select().from(portfolios).where(
          and(eq(portfolios.userId, userId), eq(portfolios.sourceType, "broker"))
        ),
      ]);

      const brokerPortfolios = userPortfolios.map(p => ({
        id:         p.id,
        name:       p.name,
        provider:   p.sourceAccountId ?? null,
        createdAt:  p.createdAt,
        updatedAt:  p.updatedAt,
        syncState:  getPortfolioSyncState(p.id),
      }));

      return res.json({
        connections: {
          tradier:     tradierConn,
          tradestation: tsConn,
        },
        portfolios: brokerPortfolios,
      });
    } catch (err: unknown) {
      console.error("[BrokerSync] GET /connections error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to load broker connections" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/portfolio/broker/connect
  // Creates a new broker-linked portfolio and triggers initial sync.
  // Body: { provider: "tradier" | "tradestation", portfolioName?: string }
  // -------------------------------------------------------------------------
  app.post("/api/portfolio/broker/connect", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { provider, portfolioName } = req.body ?? {};

      if (!provider || !isSupportedProvider(provider)) {
        return res.status(400).json({ error: `provider must be one of: ${SUPPORTED_PROVIDERS.join(", ")}` });
      }

      // Verify the broker is actually connected for this user
      const conn = await storage.getBrokerConnection(userId);
      if (!conn || conn.provider !== provider || !conn.isConnected) {
        return res.status(400).json({
          error: `${provider} is not connected. Complete OAuth authentication first.`,
          requiresAuth: true,
        });
      }

      // Prevent duplicate broker portfolios for the same provider
      const existing = await db
        .select()
        .from(portfolios)
        .where(and(eq(portfolios.userId, userId), eq(portfolios.sourceType, "broker")));

      const duplicate = existing.find(p => p.sourceAccountId === provider);
      if (duplicate) {
        return res.status(409).json({
          error: `A portfolio linked to ${provider} already exists.`,
          portfolioId: duplicate.id,
          portfolioName: duplicate.name,
        });
      }

      // Create portfolio
      const name = (portfolioName?.trim()) || `${provider.charAt(0).toUpperCase() + provider.slice(1)} Portfolio`;
      const [created] = await db.insert(portfolios).values({
        userId,
        name,
        sourceType:      "broker",
        sourceAccountId: provider,
        createdAt:       new Date(),
        updatedAt:       new Date(),
      }).returning();

      // Trigger initial sync (fire-and-forget; client polls status)
      syncPortfolioFromBroker(created.id, userId).catch((err: Error) => {
        console.error(`[BrokerSync] Initial sync error for portfolio ${created.id}:`, err.message);
      });

      return res.status(201).json({
        portfolioId:   created.id,
        portfolioName: created.name,
        provider,
        syncing:       true,
        message:       "Portfolio created. Initial sync in progress.",
      });
    } catch (err: unknown) {
      console.error("[BrokerSync] POST /connect error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to connect broker portfolio" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/portfolio/broker/sync/:portfolioId
  // Trigger immediate sync. Returns 409 if already running.
  // -------------------------------------------------------------------------
  app.post("/api/portfolio/broker/sync/:portfolioId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { portfolioId } = req.params;

      // Verify ownership
      const [portfolio] = await db
        .select()
        .from(portfolios)
        .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)));

      if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });
      if (portfolio.sourceType !== "broker") {
        return res.status(400).json({ error: "This portfolio is not linked to a broker." });
      }

      // Concurrent-sync guard
      if (isPortfolioSyncRunning(portfolioId)) {
        return res.status(409).json({
          error: "Synchronization already in progress.",
          portfolioId,
          status: "running",
        });
      }

      // Trigger sync (fire-and-forget, client polls status)
      syncPortfolioFromBroker(portfolioId, userId).catch((err: Error) => {
        console.error(`[BrokerSync] Sync error for portfolio ${portfolioId}:`, err.message);
      });

      return res.json({
        portfolioId,
        status:  "running",
        message: "Synchronization started.",
      });
    } catch (err: unknown) {
      console.error("[BrokerSync] POST /sync error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to start synchronization" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/portfolio/broker/sync/:portfolioId/status
  // Returns per-portfolio sync status without any sensitive data.
  // -------------------------------------------------------------------------
  app.get("/api/portfolio/broker/sync/:portfolioId/status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { portfolioId } = req.params;

      // Verify ownership
      const [portfolio] = await db
        .select()
        .from(portfolios)
        .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)));

      if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });

      const syncState = getPortfolioSyncState(portfolioId);

      // Count current positions
      const positionRows = await db
        .select({ id: portfolioPositions.id })
        .from(portfolioPositions)
        .where(eq(portfolioPositions.portfolioId, portfolioId));

      return res.json({
        portfolioId,
        portfolioName:   portfolio.name,
        provider:        portfolio.sourceAccountId ?? null,
        lastUpdatedAt:   portfolio.updatedAt,
        currentPositionCount: positionRows.length,
        sync:            syncState,
      });
    } catch (err: unknown) {
      console.error("[BrokerSync] GET /status error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to get sync status" });
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/portfolio/broker/disconnect/:portfolioId
  // Converts broker-linked portfolio to manual (keeps positions, stops syncing).
  // Does NOT revoke the broker OAuth token — that is the user's choice separately.
  // -------------------------------------------------------------------------
  app.delete("/api/portfolio/broker/disconnect/:portfolioId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { portfolioId } = req.params;

      const [portfolio] = await db
        .select()
        .from(portfolios)
        .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)));

      if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });
      if (portfolio.sourceType !== "broker") {
        return res.status(400).json({ error: "This portfolio is not linked to a broker." });
      }

      // Convert to manual — keeps all positions, stops broker sync
      await db
        .update(portfolios)
        .set({
          sourceType:      "manual",
          sourceAccountId: null,
          updatedAt:       new Date(),
        })
        .where(eq(portfolios.id, portfolioId));

      // Mark positions as manual source
      await db
        .update(portfolioPositions)
        .set({ sourceType: "manual", updatedAt: new Date() })
        .where(eq(portfolioPositions.portfolioId, portfolioId));

      return res.json({
        portfolioId,
        message: "Broker disconnected. Portfolio converted to manual. Existing positions retained.",
        previousProvider: portfolio.sourceAccountId,
      });
    } catch (err: unknown) {
      console.error("[BrokerSync] DELETE /disconnect error:", (err as Error).message);
      return res.status(500).json({ error: "Failed to disconnect broker" });
    }
  });
}
