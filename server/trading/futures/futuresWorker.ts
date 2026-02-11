import { db } from "../../db";
import { eq, and, sql } from "drizzle-orm";
import {
  futuresCommands,
  futuresOrders,
  futuresFills,
  futuresPositions,
  futuresWorkerStatus,
  FuturesCommandStatus,
  FuturesOrderStatus,
} from "@shared/schema";
import { MockFuturesAdapter } from "../brokers/futures/mock/MockFuturesAdapter";
import type { IFuturesBrokerAdapter, FuturesOrderUpdate } from "../brokers/futures/types";
import { upsertTick, upsertBar } from "./marketState";
import { scanFuturesOpportunities, type FuturesOpportunity } from "./mockScanner";
import type { FuturesCommandPayload } from "./commands";

const POLL_INTERVAL_MS = 750;
const HEARTBEAT_INTERVAL_MS = 5000;
const MAX_ORDERS_PER_MIN = parseInt(process.env.FUTURES_MAX_ORDERS_PER_MIN ?? "10", 10);
const MAX_POSITION_PER_SYMBOL = parseInt(process.env.FUTURES_MAX_POSITION ?? "10", 10);

interface AgentConfig {
  enabled: boolean;
  symbol?: string;
  minScore: number;
  maxTradesPerDay: number;
  maxPosition: number;
  tradesToday: number;
  lastResetDate: string;
}

let adapter: IFuturesBrokerAdapter | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let agentTimer: ReturnType<typeof setInterval> | null = null;
let workerStatusId: string | null = null;
let running = false;

const orderRateMap = new Map<string, number[]>();
const agentConfig: AgentConfig = {
  enabled: false,
  minScore: 70,
  maxTradesPerDay: 5,
  maxPosition: 3,
  tradesToday: 0,
  lastResetDate: new Date().toISOString().slice(0, 10),
};

export function getAdapter(): IFuturesBrokerAdapter | null {
  return adapter;
}

export function getAgentConfig(): AgentConfig {
  return { ...agentConfig };
}

export function isWorkerRunning(): boolean {
  return running;
}

export async function startFuturesWorker(): Promise<void> {
  if (running) return;
  if (process.env.FUTURES_TRADING_ENABLED !== "true") {
    console.log("[FuturesWorker] Disabled (set FUTURES_TRADING_ENABLED=true to enable)");
    return;
  }

  console.log("[FuturesWorker] Starting...");
  running = true;

  // TODO: Replace MockFuturesAdapter with real Rithmic adapter here
  adapter = new MockFuturesAdapter();
  await adapter.connect();

  adapter.on("tick", (tick) => upsertTick(tick));
  adapter.on("bar", (bar) => upsertBar(bar));
  adapter.on("orderUpdate", (update) => handleOrderUpdate(update));

  const rows = await db.select().from(futuresWorkerStatus).limit(1);
  if (rows.length > 0) {
    workerStatusId = rows[0].id;
    await db
      .update(futuresWorkerStatus)
      .set({ status: "running", lastHeartbeatAt: new Date(), details: {} })
      .where(eq(futuresWorkerStatus.id, workerStatusId));
  } else {
    const inserted = await db
      .insert(futuresWorkerStatus)
      .values({ status: "running", lastHeartbeatAt: new Date(), details: {} })
      .returning();
    workerStatusId = inserted[0].id;
  }

  pollTimer = setInterval(() => pollCommands(), POLL_INTERVAL_MS);
  heartbeatTimer = setInterval(() => sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
  agentTimer = setInterval(() => runAgentLoop(), 5000);

  console.log("[FuturesWorker] Started successfully");
}

export async function stopFuturesWorker(): Promise<void> {
  if (!running) return;
  running = false;

  if (pollTimer) clearInterval(pollTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (agentTimer) clearInterval(agentTimer);
  pollTimer = null;
  heartbeatTimer = null;
  agentTimer = null;

  if (adapter) {
    await adapter.disconnect();
    adapter = null;
  }

  if (workerStatusId) {
    await db
      .update(futuresWorkerStatus)
      .set({ status: "stopped", lastHeartbeatAt: new Date() })
      .where(eq(futuresWorkerStatus.id, workerStatusId));
  }

  console.log("[FuturesWorker] Stopped");
}

async function sendHeartbeat(): Promise<void> {
  if (!workerStatusId) return;
  try {
    const subscribedSymbols = adapter?.getSubscribedSymbols() ?? [];
    await db
      .update(futuresWorkerStatus)
      .set({
        lastHeartbeatAt: new Date(),
        details: { subscribedSymbols, agentEnabled: agentConfig.enabled },
      })
      .where(eq(futuresWorkerStatus.id, workerStatusId));
  } catch (e) {
    console.error("[FuturesWorker] Heartbeat error:", e);
  }
}

async function pollCommands(): Promise<void> {
  try {
    const pending = await db
      .update(futuresCommands)
      .set({ status: FuturesCommandStatus.PROCESSING, updatedAt: new Date() })
      .where(eq(futuresCommands.status, FuturesCommandStatus.PENDING))
      .returning();

    for (const cmd of pending) {
      try {
        await executeCommand(cmd.userId, cmd.payload as FuturesCommandPayload, cmd.id);
        await db
          .update(futuresCommands)
          .set({ status: FuturesCommandStatus.DONE, updatedAt: new Date() })
          .where(eq(futuresCommands.id, cmd.id));
      } catch (err: any) {
        await db
          .update(futuresCommands)
          .set({
            status: FuturesCommandStatus.FAILED,
            error: err.message ?? "Unknown error",
            updatedAt: new Date(),
          })
          .where(eq(futuresCommands.id, cmd.id));
      }
    }
  } catch (e) {
    console.error("[FuturesWorker] Poll error:", e);
  }
}

async function executeCommand(userId: string, payload: FuturesCommandPayload, cmdId: string): Promise<void> {
  if (!adapter) throw new Error("Adapter not initialized");

  switch (payload.commandType) {
    case "subscribe":
      await adapter.subscribeMarketData(payload.symbol);
      break;
    case "unsubscribe":
      await adapter.unsubscribeMarketData(payload.symbol);
      break;
    case "placeOrder": {
      checkRateLimit(userId);
      await checkPositionLimit(userId, payload.symbol, payload.qty);

      const order = await db
        .insert(futuresOrders)
        .values({
          userId,
          symbol: payload.symbol,
          side: payload.side,
          qty: payload.qty,
          orderType: payload.orderType,
          limitPrice: payload.limitPrice ?? null,
          status: FuturesOrderStatus.SENT,
        })
        .returning();

      const result = await adapter.placeOrder({
        symbol: payload.symbol,
        side: payload.side,
        qty: payload.qty,
        orderType: payload.orderType,
        limitPrice: payload.limitPrice,
      });

      await db
        .update(futuresOrders)
        .set({ brokerOrderId: result.brokerOrderId, status: FuturesOrderStatus.ACCEPTED, updatedAt: new Date() })
        .where(eq(futuresOrders.id, order[0].id));
      break;
    }
    case "cancelOrder": {
      await adapter.cancelOrder(payload.brokerOrderId);
      await db
        .update(futuresOrders)
        .set({ status: FuturesOrderStatus.CANCELED, updatedAt: new Date() })
        .where(eq(futuresOrders.brokerOrderId, payload.brokerOrderId));
      break;
    }
    case "toggleAgent": {
      agentConfig.enabled = payload.enabled;
      if (payload.symbol) agentConfig.symbol = payload.symbol;
      if (payload.rules) {
        if (payload.rules.minScore !== undefined) agentConfig.minScore = payload.rules.minScore;
        if (payload.rules.maxTradesPerDay !== undefined) agentConfig.maxTradesPerDay = payload.rules.maxTradesPerDay;
        if (payload.rules.maxPosition !== undefined) agentConfig.maxPosition = payload.rules.maxPosition;
      }
      break;
    }
  }
}

function checkRateLimit(userId: string): void {
  const now = Date.now();
  const times = orderRateMap.get(userId) ?? [];
  const recent = times.filter((t) => now - t < 60000);
  if (recent.length >= MAX_ORDERS_PER_MIN) {
    throw new Error(`Rate limit exceeded: max ${MAX_ORDERS_PER_MIN} orders per minute`);
  }
  recent.push(now);
  orderRateMap.set(userId, recent);
}

async function checkPositionLimit(userId: string, symbol: string, qty: number): Promise<void> {
  const positions = await db
    .select()
    .from(futuresPositions)
    .where(and(eq(futuresPositions.userId, userId), eq(futuresPositions.symbol, symbol)));
  const currentQty = positions.length > 0 ? Math.abs(positions[0].qty) : 0;
  if (currentQty + qty > MAX_POSITION_PER_SYMBOL) {
    throw new Error(`Position limit: max ${MAX_POSITION_PER_SYMBOL} contracts per symbol`);
  }
}

async function handleOrderUpdate(update: FuturesOrderUpdate): Promise<void> {
  try {
    if (update.status === "filled" && update.fillPrice && update.filledAt) {
      await db
        .update(futuresOrders)
        .set({
          status: FuturesOrderStatus.FILLED,
          updatedAt: new Date(),
          raw: { fillPrice: update.fillPrice, filledAt: update.filledAt },
        })
        .where(eq(futuresOrders.brokerOrderId, update.brokerOrderId));

      const orders = await db
        .select()
        .from(futuresOrders)
        .where(eq(futuresOrders.brokerOrderId, update.brokerOrderId));

      if (orders.length > 0) {
        await db.insert(futuresFills).values({
          orderId: orders[0].id,
          fillPrice: update.fillPrice,
          fillQty: update.qty,
          raw: { brokerOrderId: update.brokerOrderId },
        });

        await upsertPosition(orders[0].userId, update);
      }
    } else if (update.status === "accepted") {
      await db
        .update(futuresOrders)
        .set({ status: FuturesOrderStatus.ACCEPTED, updatedAt: new Date() })
        .where(eq(futuresOrders.brokerOrderId, update.brokerOrderId));
    }
  } catch (e) {
    console.error("[FuturesWorker] handleOrderUpdate error:", e);
  }
}

async function upsertPosition(userId: string, update: FuturesOrderUpdate): Promise<void> {
  const existing = await db
    .select()
    .from(futuresPositions)
    .where(and(eq(futuresPositions.userId, userId), eq(futuresPositions.symbol, update.symbol)));

  const direction = update.side === "buy" ? 1 : -1;
  const fillPrice = update.fillPrice ?? 0;

  if (existing.length > 0) {
    const pos = existing[0];
    const newQty = pos.qty + update.qty * direction;

    if (newQty === 0) {
      await db.delete(futuresPositions).where(eq(futuresPositions.id, pos.id));
    } else {
      let newAvg = pos.avgPrice;
      if (Math.sign(newQty) === direction || pos.qty === 0) {
        newAvg = (pos.avgPrice * Math.abs(pos.qty) + fillPrice * update.qty) / (Math.abs(pos.qty) + update.qty);
      }
      await db
        .update(futuresPositions)
        .set({ qty: newQty, avgPrice: Math.round(newAvg * 100) / 100, updatedAt: new Date() })
        .where(eq(futuresPositions.id, pos.id));
    }
  } else {
    await db.insert(futuresPositions).values({
      userId,
      symbol: update.symbol,
      qty: update.qty * direction,
      avgPrice: fillPrice,
    });
  }
}

async function runAgentLoop(): Promise<void> {
  if (!agentConfig.enabled || !agentConfig.symbol || !adapter) return;

  const today = new Date().toISOString().slice(0, 10);
  if (agentConfig.lastResetDate !== today) {
    agentConfig.tradesToday = 0;
    agentConfig.lastResetDate = today;
  }
  if (agentConfig.tradesToday >= agentConfig.maxTradesPerDay) return;

  try {
    const opportunities = scanFuturesOpportunities(agentConfig.symbol);
    const qualifying = opportunities.filter((o) => o.score >= agentConfig.minScore);
    if (qualifying.length === 0) return;

    const best = qualifying[0];

    await db.insert(futuresCommands).values({
      userId: "agent",
      commandType: "placeOrder",
      payload: {
        commandType: "placeOrder",
        symbol: best.symbol,
        side: best.side,
        qty: 1,
        orderType: "market" as const,
      },
      status: "pending",
    });

    agentConfig.tradesToday++;

    const { futuresAgentAuditLog } = await import("@shared/schema");
    await db.insert(futuresAgentAuditLog).values({
      userId: "agent",
      action: "auto_trade",
      symbol: best.symbol,
      details: { setup: best.setup, score: best.score, side: best.side, entry: best.entry },
    });
  } catch (e) {
    console.error("[FuturesAgent] Error:", e);
  }
}
