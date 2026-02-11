import type { Express, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import { isAuthenticated } from "../replit_integrations/auth";
import { futuresOrders, futuresPositions, futuresCommands, futuresWorkerStatus, futuresAgentAuditLog } from "@shared/schema";
import { futuresCommandSchema } from "../trading/futures/commands";
import { getRecentBars, getLastTick, getAllSubscribedSymbols } from "../trading/futures/marketState";
import { scanFuturesOpportunities } from "../trading/futures/mockScanner";
import { getAdapter, getAgentConfig, isWorkerRunning, getFeedInfo } from "../trading/futures/futuresWorker";
import { FUTURES_SYMBOLS } from "../trading/brokers/futures/types";

export function registerFuturesRoutes(app: Express): void {

  app.get("/api/futures/status", isAuthenticated, async (_req: Request, res: Response) => {
    try {
      const rows = await db.select().from(futuresWorkerStatus).limit(1);
      const workerRow = rows[0] ?? null;
      const subscribedSymbols = getAdapter()?.getSubscribedSymbols() ?? [];
      const agentCfg = getAgentConfig();
      const feedInfo = getFeedInfo();

      res.json({
        enabled: process.env.FUTURES_TRADING_ENABLED === "true",
        workerRunning: isWorkerRunning(),
        workerStatus: workerRow?.status ?? "stopped",
        lastHeartbeat: workerRow?.lastHeartbeatAt ?? null,
        subscribedSymbols,
        availableSymbols: FUTURES_SYMBOLS.map((s) => ({ symbol: s.symbol, name: s.name, tickSize: s.tickSize, pointValue: s.pointValue })),
        agent: agentCfg,
        feedType: feedInfo.feedType,
        feedDetail: feedInfo.feedDetail,
      });
    } catch (error) {
      console.error("Error fetching futures status:", error);
      res.status(500).json({ message: "Failed to fetch futures status" });
    }
  });

  app.post("/api/futures/command", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const parsed = futuresCommandSchema.parse(req.body);

      const inserted = await db
        .insert(futuresCommands)
        .values({
          userId,
          commandType: parsed.commandType,
          payload: parsed as any,
          status: "pending",
        })
        .returning();

      res.json({ commandId: inserted[0].id, status: "pending" });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid command", errors: error.errors });
      }
      console.error("Error creating futures command:", error);
      res.status(500).json({ message: error.message ?? "Failed to create command" });
    }
  });

  app.get("/api/futures/bars", isAuthenticated, (req: Request, res: Response) => {
    try {
      const symbol = (req.query.symbol as string) ?? "MES";
      const limit = Math.min(parseInt((req.query.limit as string) ?? "300", 10), 900);
      const bars = getRecentBars(symbol, limit);
      const tick = getLastTick(symbol);

      res.json({ bars, lastTick: tick });
    } catch (error) {
      console.error("Error fetching futures bars:", error);
      res.status(500).json({ message: "Failed to fetch bars" });
    }
  });

  app.get("/api/futures/orders", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 200);

      const orders = await db
        .select()
        .from(futuresOrders)
        .where(eq(futuresOrders.userId, userId))
        .orderBy(desc(futuresOrders.createdAt))
        .limit(limit);

      res.json(orders);
    } catch (error) {
      console.error("Error fetching futures orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.get("/api/futures/positions", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const positions = await db
        .select()
        .from(futuresPositions)
        .where(eq(futuresPositions.userId, userId));

      res.json(positions);
    } catch (error) {
      console.error("Error fetching futures positions:", error);
      res.status(500).json({ message: "Failed to fetch positions" });
    }
  });

  app.get("/api/futures/scan", isAuthenticated, (req: Request, res: Response) => {
    try {
      const symbol = (req.query.symbol as string) ?? "MES";
      const opportunities = scanFuturesOpportunities(symbol);
      res.json(opportunities);
    } catch (error) {
      console.error("Error scanning futures:", error);
      res.status(500).json({ message: "Failed to scan" });
    }
  });

  app.get("/api/futures/agent/audit", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) ?? "20", 10), 100);
      const logs = await db
        .select()
        .from(futuresAgentAuditLog)
        .orderBy(desc(futuresAgentAuditLog.createdAt))
        .limit(limit);

      res.json(logs);
    } catch (error) {
      console.error("Error fetching agent audit log:", error);
      res.status(500).json({ message: "Failed to fetch audit log" });
    }
  });

  app.get("/api/futures/stream", isAuthenticated, (req: Request, res: Response) => {
    const symbol = (req.query.symbol as string) ?? "MES";

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    res.write("data: {\"type\":\"connected\"}\n\n");

    const adapterInstance = getAdapter();
    if (!adapterInstance) {
      res.write(`data: ${JSON.stringify({ type: "error", message: "Worker not running" })}\n\n`);
      res.end();
      return;
    }

    const tickHandler = (tick: any) => {
      if (tick.symbol === symbol) {
        res.write(`data: ${JSON.stringify({ type: "tick", data: tick })}\n\n`);
      }
    };

    const barHandler = (bar: any) => {
      if (bar.symbol === symbol) {
        res.write(`data: ${JSON.stringify({ type: "bar", data: bar })}\n\n`);
      }
    };

    const orderHandler = (update: any) => {
      res.write(`data: ${JSON.stringify({ type: "orderUpdate", data: update })}\n\n`);
    };

    adapterInstance.on("tick", tickHandler);
    adapterInstance.on("bar", barHandler);
    adapterInstance.on("orderUpdate", orderHandler);

    const heartbeat = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      adapterInstance.removeListener("tick", tickHandler);
      adapterInstance.removeListener("bar", barHandler);
      adapterInstance.removeListener("orderUpdate", orderHandler);
    });
  });
}
