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
import { FUTURES_SYMBOLS } from "../brokers/futures/types";
import { upsertTick, upsertBar } from "./marketState";
import { scanFuturesOpportunities, type FuturesOpportunity } from "./mockScanner";
import type { FuturesCommandPayload } from "./commands";
import { createFuturesAdapter, type FuturesFeedType } from "./adapterFactory";

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
  sizeMode: "contracts" | "dollars";
  tradeSize: number;
  entryTimeStart: string;
  entryTimeEnd: string;
  exitTime: string;
  takeProfit: number;
  stopLoss: number;
  tradesToday: number;
  lastResetDate: string;
}

let adapter: IFuturesBrokerAdapter | null = null;
let currentFeedType: FuturesFeedType = "mock";
let currentFeedDetail: string | undefined;
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
  sizeMode: "contracts",
  tradeSize: 1,
  entryTimeStart: "09:30",
  entryTimeEnd: "15:30",
  exitTime: "15:55",
  takeProfit: 0,
  stopLoss: 0,
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

export function getFeedInfo(): { feedType: FuturesFeedType; feedDetail?: string } {
  return { feedType: currentFeedType, feedDetail: currentFeedDetail };
}

export async function startFuturesWorker(): Promise<void> {
  if (running) return;
  if (process.env.FUTURES_TRADING_ENABLED !== "true") {
    console.log("[FuturesWorker] Disabled (set FUTURES_TRADING_ENABLED=true to enable)");
    return;
  }

  console.log("[FuturesWorker] Starting...");
  running = true;

  const result = await createFuturesAdapter();
  adapter = result.adapter;
  currentFeedType = result.feedType;
  currentFeedDetail = result.feedDetail;
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
        stopPrice: payload.stopPrice,
        linkedToOrderId: payload.linkedToOrderId,
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
        if (payload.rules.sizeMode !== undefined) agentConfig.sizeMode = payload.rules.sizeMode;
        if (payload.rules.tradeSize !== undefined) agentConfig.tradeSize = payload.rules.tradeSize;
        if (payload.rules.entryTimeStart !== undefined) agentConfig.entryTimeStart = payload.rules.entryTimeStart;
        if (payload.rules.entryTimeEnd !== undefined) agentConfig.entryTimeEnd = payload.rules.entryTimeEnd;
        if (payload.rules.exitTime !== undefined) agentConfig.exitTime = payload.rules.exitTime;
        if (payload.rules.takeProfit !== undefined) agentConfig.takeProfit = payload.rules.takeProfit;
        if (payload.rules.stopLoss !== undefined) agentConfig.stopLoss = payload.rules.stopLoss;
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

function getETNow(): { hours: number; minutes: number; timeStr: string } {
  const d = new Date();
  const etStr = d.toLocaleString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });
  const [h, m] = etStr.split(":").map(Number);
  return { hours: h, minutes: m, timeStr: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
}

function parseTimeStr(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function isInTimeWindow(now: string, start: string, end: string): boolean {
  const n = parseTimeStr(now);
  const s = parseTimeStr(start);
  const e = parseTimeStr(end);
  return n >= s && n <= e;
}

function computeContractQty(symbol: string, price: number): number {
  if (agentConfig.sizeMode === "contracts") {
    return Math.max(1, Math.round(agentConfig.tradeSize));
  }
  const info = FUTURES_SYMBOLS.find((s) => s.symbol === symbol);
  const pointValue = info?.pointValue ?? 5;
  const contractValue = price * pointValue;
  if (contractValue <= 0) return 1;
  const qty = Math.floor(agentConfig.tradeSize / contractValue);
  if (qty < 1) {
    console.warn(`[FuturesAgent] Dollar amount $${agentConfig.tradeSize} insufficient for ${symbol} at $${price} (contract value $${contractValue}). Skipping trade.`);
    return 0;
  }
  return qty;
}

async function runAgentLoop(): Promise<void> {
  if (!agentConfig.enabled || !agentConfig.symbol || !adapter) return;

  const today = new Date().toISOString().slice(0, 10);
  if (agentConfig.lastResetDate !== today) {
    agentConfig.tradesToday = 0;
    agentConfig.lastResetDate = today;
  }
  if (agentConfig.tradesToday >= agentConfig.maxTradesPerDay) return;

  const etNow = getETNow();

  if (agentConfig.exitTime) {
    const exitMin = parseTimeStr(agentConfig.exitTime);
    const nowMin = parseTimeStr(etNow.timeStr);
    if (nowMin >= exitMin) {
      await closeAllAgentPositions(agentConfig.symbol, "exit_time");
      return;
    }
  }

  if (agentConfig.entryTimeStart && agentConfig.entryTimeEnd) {
    if (!isInTimeWindow(etNow.timeStr, agentConfig.entryTimeStart, agentConfig.entryTimeEnd)) {
      return;
    }
  }

  try {
    const opportunities = scanFuturesOpportunities(agentConfig.symbol);
    const qualifying = opportunities.filter((o) => o.score >= agentConfig.minScore);
    if (qualifying.length === 0) return;

    const best = qualifying[0];
    const qty = computeContractQty(best.symbol, best.entry);
    if (qty === 0) return;

    const bracketGroupId = `agent-bracket-${Date.now()}`;

    await db.insert(futuresCommands).values({
      userId: "agent",
      commandType: "placeOrder",
      payload: {
        commandType: "placeOrder",
        symbol: best.symbol,
        side: best.side,
        qty,
        orderType: "market" as const,
      },
      status: "pending",
    });

    agentConfig.tradesToday++;

    const hasBracket = agentConfig.takeProfit > 0 || agentConfig.stopLoss > 0;

    if (agentConfig.takeProfit > 0) {
      const tpSide = best.side === "buy" ? "sell" : "buy";
      const tpPrice = best.side === "buy"
        ? Math.round((best.entry + agentConfig.takeProfit) * 100) / 100
        : Math.round((best.entry - agentConfig.takeProfit) * 100) / 100;
      await db.insert(futuresCommands).values({
        userId: "agent",
        commandType: "placeOrder",
        payload: {
          commandType: "placeOrder",
          symbol: best.symbol,
          side: tpSide,
          qty,
          orderType: "limit" as const,
          limitPrice: tpPrice,
          ...(hasBracket ? { linkedToOrderId: bracketGroupId } : {}),
        },
        status: "pending",
      });
    }

    if (agentConfig.stopLoss > 0) {
      const slSide = best.side === "buy" ? "sell" : "buy";
      const slPrice = best.side === "buy"
        ? Math.round((best.entry - agentConfig.stopLoss) * 100) / 100
        : Math.round((best.entry + agentConfig.stopLoss) * 100) / 100;
      await db.insert(futuresCommands).values({
        userId: "agent",
        commandType: "placeOrder",
        payload: {
          commandType: "placeOrder",
          symbol: best.symbol,
          side: slSide,
          qty,
          orderType: "stop" as const,
          stopPrice: slPrice,
          ...(hasBracket ? { linkedToOrderId: bracketGroupId } : {}),
        },
        status: "pending",
      });
    }

    const { futuresAgentAuditLog } = await import("@shared/schema");
    await db.insert(futuresAgentAuditLog).values({
      userId: "agent",
      action: "auto_trade",
      symbol: best.symbol,
      details: {
        setup: best.setup,
        score: best.score,
        side: best.side,
        entry: best.entry,
        qty,
        sizeMode: agentConfig.sizeMode,
        takeProfit: agentConfig.takeProfit || undefined,
        stopLoss: agentConfig.stopLoss || undefined,
      },
    });
  } catch (e) {
    console.error("[FuturesAgent] Error:", e);
  }
}

async function closeAllAgentPositions(symbol: string, reason: string): Promise<void> {
  try {
    const positions = await db
      .select()
      .from(futuresPositions)
      .where(and(eq(futuresPositions.userId, "agent"), eq(futuresPositions.symbol, symbol)));

    for (const pos of positions) {
      if (pos.qty === 0) continue;
      const closeSide = pos.qty > 0 ? "sell" : "buy";
      await db.insert(futuresCommands).values({
        userId: "agent",
        commandType: "placeOrder",
        payload: {
          commandType: "placeOrder",
          symbol,
          side: closeSide,
          qty: Math.abs(pos.qty),
          orderType: "market" as const,
        },
        status: "pending",
      });

      const { futuresAgentAuditLog } = await import("@shared/schema");
      await db.insert(futuresAgentAuditLog).values({
        userId: "agent",
        action: reason,
        symbol,
        details: { qty: Math.abs(pos.qty), side: closeSide, reason },
      });
    }
  } catch (e) {
    console.error("[FuturesAgent] closeAllPositions error:", e);
  }
}
