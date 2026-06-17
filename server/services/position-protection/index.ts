import { db } from "../../db";
import {
  positionProtectionPlans,
  positionProtectionEvents,
  PositionProtectionStatus,
  type PositionProtectionPlan,
  type InsertPositionProtectionEvent,
} from "@shared/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { storage } from "../../storage";
import { fetchQuotesFromBroker } from "../../broker-service";
import { placeBrokerOrder } from "../../broker/index";
import {
  evaluateTriggers,
  updateTrail,
  computeStopPrice,
  computeTargetPrice,
  computeTrailStop,
  type PositionSide,
  type ValueMode,
  type TrailMode,
} from "./calculator";

// ─── Feature flags ──────────────────────────────────────────────────
// Position Protection ships paper + stocks first. Live trading, options, and
// spreads stay off until each is explicitly enabled via env flag.
function flag(name: string, defaultOn: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultOn;
  return raw === "1" || raw.toLowerCase() === "true";
}

export function getProtectionConfig() {
  return {
    enabled: flag("POSITION_PROTECTION_ENABLED", true),
    liveEnabled: flag("POSITION_PROTECTION_LIVE_ENABLED", false),
    optionsEnabled: flag("POSITION_PROTECTION_OPTIONS_ENABLED", false),
    spreadsEnabled: flag("POSITION_PROTECTION_SPREADS_ENABLED", false),
  };
}

const ACTIVE_STATUSES = [PositionProtectionStatus.ACTIVE, PositionProtectionStatus.PAUSED];

// ─── Events ─────────────────────────────────────────────────────────
export async function logEvent(event: InsertPositionProtectionEvent): Promise<void> {
  try {
    await db.insert(positionProtectionEvents).values(event);
  } catch (err) {
    console.error("[PositionProtection] Failed to log event:", (err as Error).message);
  }
}

export async function getEventsForPlan(planId: string, userId: string) {
  return db
    .select()
    .from(positionProtectionEvents)
    .where(and(eq(positionProtectionEvents.planId, planId), eq(positionProtectionEvents.userId, userId)))
    .orderBy(desc(positionProtectionEvents.createdAt))
    .limit(100);
}

// ─── Reads ──────────────────────────────────────────────────────────
export async function getPlansForUser(userId: string): Promise<PositionProtectionPlan[]> {
  return db
    .select()
    .from(positionProtectionPlans)
    .where(eq(positionProtectionPlans.userId, userId))
    .orderBy(desc(positionProtectionPlans.createdAt));
}

export async function getPlan(planId: string, userId: string): Promise<PositionProtectionPlan | undefined> {
  const rows = await db
    .select()
    .from(positionProtectionPlans)
    .where(and(eq(positionProtectionPlans.id, planId), eq(positionProtectionPlans.userId, userId)));
  return rows[0];
}

export async function getActivePlans(): Promise<PositionProtectionPlan[]> {
  return db
    .select()
    .from(positionProtectionPlans)
    .where(eq(positionProtectionPlans.status, PositionProtectionStatus.ACTIVE));
}

// ─── Validation / safety gates ──────────────────────────────────────
export interface CreatePlanInput {
  brokerProvider: string;
  brokerAccountId: string;
  accountMode: "paper" | "live";
  symbol: string;
  instrumentType: "stock" | "option";
  optionSymbol?: string | null;
  positionSide: PositionSide;
  quantity: number;
  entryPrice?: number | null;
  stopEnabled?: boolean;
  stopMode?: ValueMode;
  stopValue?: number;
  targetEnabled?: boolean;
  targetMode?: ValueMode;
  targetValue?: number;
  trailEnabled?: boolean;
  trailMode?: TrailMode;
  trailValue?: number;
  exitOrderType?: "market" | "stop" | "stop_limit";
  acknowledged: boolean;
  notes?: string | null;
}

export interface GateResult {
  ok: boolean;
  error?: string;
  code?: string;
}

export function checkPlanGates(input: CreatePlanInput): GateResult {
  const cfg = getProtectionConfig();
  if (!cfg.enabled) {
    return { ok: false, error: "Position Protection is currently disabled.", code: "FEATURE_DISABLED" };
  }
  if (!input.acknowledged) {
    return { ok: false, error: "You must acknowledge the risk disclosure to enable Position Protection.", code: "ACK_REQUIRED" };
  }
  if (input.accountMode === "live" && !cfg.liveEnabled) {
    return { ok: false, error: "Position Protection is available for paper accounts only right now.", code: "LIVE_DISABLED" };
  }
  if (input.instrumentType === "option" && !cfg.optionsEnabled) {
    return { ok: false, error: "Option Position Protection isn't enabled yet.", code: "OPTIONS_DISABLED" };
  }
  if (input.instrumentType === "option" && !input.optionSymbol) {
    return { ok: false, error: "An option symbol is required for option protection.", code: "OPTION_SYMBOL_REQUIRED" };
  }
  if (!input.stopEnabled && !input.targetEnabled && !input.trailEnabled) {
    return { ok: false, error: "Enable at least one exit rule (stop, target, or trailing stop).", code: "NO_RULES" };
  }
  if (!input.quantity || input.quantity < 1) {
    return { ok: false, error: "Quantity must be at least 1.", code: "BAD_QUANTITY" };
  }
  return { ok: true };
}

// ─── Create / update / lifecycle ────────────────────────────────────
export async function createPlan(userId: string, input: CreatePlanInput): Promise<PositionProtectionPlan> {
  const gate = checkPlanGates(input);
  if (!gate.ok) {
    const err = new Error(gate.error) as Error & { code?: string };
    err.code = gate.code;
    throw err;
  }

  const ref = input.entryPrice ?? 0;
  const stopPrice =
    input.stopEnabled && input.stopMode && input.stopValue
      ? computeStopPrice(input.positionSide, input.stopMode, input.stopValue, ref)
      : null;
  const targetPrice =
    input.targetEnabled && input.targetMode && input.targetValue
      ? computeTargetPrice(input.positionSide, input.targetMode, input.targetValue, ref)
      : null;
  const highWaterMark = input.trailEnabled ? (input.entryPrice ?? null) : null;
  const trailStopPrice =
    input.trailEnabled && input.trailMode && input.trailValue && highWaterMark
      ? computeTrailStop(input.positionSide, input.trailMode, input.trailValue, highWaterMark)
      : null;

  const rows = await db
    .insert(positionProtectionPlans)
    .values({
      userId,
      brokerProvider: input.brokerProvider,
      brokerAccountId: input.brokerAccountId,
      accountMode: input.accountMode,
      symbol: input.symbol.toUpperCase(),
      instrumentType: input.instrumentType,
      optionSymbol: input.optionSymbol ?? null,
      positionSide: input.positionSide,
      quantity: Math.floor(input.quantity),
      entryPrice: input.entryPrice ?? null,
      stopEnabled: !!input.stopEnabled,
      stopMode: input.stopMode ?? null,
      stopValue: input.stopValue ?? null,
      stopPrice,
      targetEnabled: !!input.targetEnabled,
      targetMode: input.targetMode ?? null,
      targetValue: input.targetValue ?? null,
      targetPrice,
      trailEnabled: !!input.trailEnabled,
      trailMode: input.trailMode ?? null,
      trailValue: input.trailValue ?? null,
      highWaterMark,
      trailStopPrice,
      exitOrderType: input.exitOrderType ?? "market",
      acknowledged: input.acknowledged,
      notes: input.notes ?? null,
      status: PositionProtectionStatus.ACTIVE,
    })
    .returning();

  const plan = rows[0];
  await logEvent({
    planId: plan.id,
    userId,
    eventType: "created",
    message: `Protection enabled for ${plan.quantity} ${plan.symbol} (${plan.positionSide})`,
    price: input.entryPrice ?? null,
    metadata: { stopPrice, targetPrice, trailStopPrice },
  });
  return plan;
}

export async function updatePlan(
  planId: string,
  userId: string,
  input: Partial<CreatePlanInput>,
): Promise<PositionProtectionPlan | undefined> {
  const existing = await getPlan(planId, userId);
  if (!existing) return undefined;
  if (existing.status === PositionProtectionStatus.EXITED || existing.status === PositionProtectionStatus.TRIGGERED) {
    const err = new Error("This plan has already exited and can't be edited.") as Error & { code?: string };
    err.code = "PLAN_CLOSED";
    throw err;
  }

  const side = (input.positionSide ?? existing.positionSide) as PositionSide;
  const ref = input.entryPrice ?? existing.entryPrice ?? 0;

  const stopEnabled = input.stopEnabled ?? existing.stopEnabled;
  const stopMode = (input.stopMode ?? existing.stopMode) as ValueMode | null;
  const stopValue = input.stopValue ?? existing.stopValue;
  const stopPrice =
    stopEnabled && stopMode && stopValue ? computeStopPrice(side, stopMode, stopValue, ref) : null;

  const targetEnabled = input.targetEnabled ?? existing.targetEnabled;
  const targetMode = (input.targetMode ?? existing.targetMode) as ValueMode | null;
  const targetValue = input.targetValue ?? existing.targetValue;
  const targetPrice =
    targetEnabled && targetMode && targetValue ? computeTargetPrice(side, targetMode, targetValue, ref) : null;

  const trailEnabled = input.trailEnabled ?? existing.trailEnabled;
  const trailMode = (input.trailMode ?? existing.trailMode) as TrailMode | null;
  const trailValue = input.trailValue ?? existing.trailValue;
  const highWaterMark = trailEnabled ? (existing.highWaterMark ?? existing.entryPrice ?? null) : null;
  const trailStopPrice =
    trailEnabled && trailMode && trailValue && highWaterMark
      ? computeTrailStop(side, trailMode, trailValue, highWaterMark)
      : null;

  const rows = await db
    .update(positionProtectionPlans)
    .set({
      positionSide: side,
      quantity: input.quantity ? Math.floor(input.quantity) : existing.quantity,
      entryPrice: input.entryPrice ?? existing.entryPrice,
      stopEnabled,
      stopMode,
      stopValue,
      stopPrice,
      targetEnabled,
      targetMode,
      targetValue,
      targetPrice,
      trailEnabled,
      trailMode,
      trailValue,
      highWaterMark,
      trailStopPrice,
      exitOrderType: input.exitOrderType ?? existing.exitOrderType,
      notes: input.notes ?? existing.notes,
      updatedAt: new Date(),
    })
    .where(and(eq(positionProtectionPlans.id, planId), eq(positionProtectionPlans.userId, userId)))
    .returning();

  await logEvent({
    planId,
    userId,
    eventType: "updated",
    message: "Protection rules updated",
    metadata: { stopPrice, targetPrice, trailStopPrice },
  });
  return rows[0];
}

async function setStatus(
  planId: string,
  userId: string,
  status: string,
  eventType: string,
  message: string,
  allowedFrom: string[],
): Promise<PositionProtectionPlan | undefined> {
  // Enforce a strict state machine: only transition from an allowed source status.
  // This prevents re-arming closed plans (triggered/exited/cancelled/error) which
  // could otherwise cause the worker to submit a duplicate exit order.
  const rows = await db
    .update(positionProtectionPlans)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(positionProtectionPlans.id, planId),
        eq(positionProtectionPlans.userId, userId),
        inArray(positionProtectionPlans.status, allowedFrom),
      ),
    )
    .returning();
  if (rows[0]) {
    await logEvent({ planId, userId, eventType, message });
  }
  return rows[0];
}

export function pausePlan(planId: string, userId: string) {
  return setStatus(planId, userId, PositionProtectionStatus.PAUSED, "paused", "Monitoring paused", [
    PositionProtectionStatus.ACTIVE,
  ]);
}

export function resumePlan(planId: string, userId: string) {
  return setStatus(planId, userId, PositionProtectionStatus.ACTIVE, "resumed", "Monitoring resumed", [
    PositionProtectionStatus.PAUSED,
  ]);
}

export function cancelPlan(planId: string, userId: string) {
  return setStatus(planId, userId, PositionProtectionStatus.CANCELLED, "cancelled", "Protection cancelled by user", [
    PositionProtectionStatus.ACTIVE,
    PositionProtectionStatus.PAUSED,
  ]);
}

// ─── Quote helper ───────────────────────────────────────────────────
async function getStockPrice(userId: string, symbol: string): Promise<number | null> {
  const connection = await storage.getBrokerConnectionWithToken(userId);
  if (!connection || !connection.accessToken) return null;
  try {
    const quotes = await fetchQuotesFromBroker(connection as any, [symbol]);
    const q = quotes.find((x) => x.symbol?.toUpperCase() === symbol.toUpperCase()) ?? quotes[0];
    return q && q.last > 0 ? q.last : null;
  } catch (err) {
    console.error(`[PositionProtection] Quote error for ${symbol}:`, (err as Error).message);
    return null;
  }
}

// ─── Monitoring ─────────────────────────────────────────────────────
async function touch(planId: string, fields: Partial<typeof positionProtectionPlans.$inferInsert>): Promise<void> {
  await db
    .update(positionProtectionPlans)
    .set({ ...fields, lastCheckedAt: new Date() })
    .where(eq(positionProtectionPlans.id, planId));
}

export async function processPlan(plan: PositionProtectionPlan): Promise<void> {
  const cfg = getProtectionConfig();

  // Options/spreads stay disabled unless explicitly turned on. Stocks only for now.
  if (plan.instrumentType === "option" && !cfg.optionsEnabled) {
    await touch(plan.id, {});
    return;
  }

  let price: number | null = null;
  if (plan.instrumentType === "option" && plan.optionSymbol) {
    const { getOptionQuote } = await import("../../broker/index");
    const oq = await getOptionQuote(plan.userId, plan.optionSymbol);
    price = oq && oq.mid > 0 ? oq.mid : null;
  } else {
    price = await getStockPrice(plan.userId, plan.symbol);
  }

  if (price == null || !Number.isFinite(price) || price <= 0) {
    await touch(plan.id, {});
    return;
  }

  const side = plan.positionSide as PositionSide;

  // Advance trailing stop (only moves favorably).
  let effectiveTrailStop = plan.trailStopPrice;
  if (plan.trailEnabled && plan.trailValue) {
    const trail = updateTrail(
      {
        positionSide: side,
        entryPrice: plan.entryPrice,
        trailEnabled: plan.trailEnabled,
        trailMode: plan.trailMode,
        trailValue: plan.trailValue,
        highWaterMark: plan.highWaterMark,
        trailStopPrice: plan.trailStopPrice,
      },
      price,
    );
    if (trail) {
      effectiveTrailStop = trail.trailStopPrice;
      if (trail.adjusted) {
        await touch(plan.id, {
          highWaterMark: trail.highWaterMark,
          trailStopPrice: trail.trailStopPrice,
          lastPrice: price,
        });
        await logEvent({
          planId: plan.id,
          userId: plan.userId,
          eventType: "trail_adjusted",
          message: `Trailing stop moved to $${trail.trailStopPrice?.toFixed(2)} (high water $${trail.highWaterMark.toFixed(2)})`,
          price,
        });
      }
    }
  }

  const triggered = evaluateTriggers(
    {
      positionSide: side,
      stopEnabled: plan.stopEnabled,
      stopPrice: plan.stopPrice,
      targetEnabled: plan.targetEnabled,
      targetPrice: plan.targetPrice,
      trailEnabled: plan.trailEnabled,
      trailStopPrice: effectiveTrailStop,
    },
    price,
    effectiveTrailStop,
  );

  if (!triggered) {
    await touch(plan.id, { lastPrice: price });
    return;
  }

  await triggerExit(plan, triggered, price);
}

async function triggerExit(
  plan: PositionProtectionPlan,
  reason: "stop" | "target" | "trail",
  price: number,
): Promise<void> {
  // Idempotency: re-read and claim the plan before placing any order.
  const claimed = await db
    .update(positionProtectionPlans)
    .set({
      status: PositionProtectionStatus.TRIGGERED,
      triggerReason: reason,
      lastPrice: price,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(positionProtectionPlans.id, plan.id),
        eq(positionProtectionPlans.status, PositionProtectionStatus.ACTIVE),
        isNull(positionProtectionPlans.submittedExitOrderId),
      ),
    )
    .returning();

  if (claimed.length === 0) {
    // Another worker tick already handled it, or an exit order was already submitted.
    return;
  }

  await logEvent({
    planId: plan.id,
    userId: plan.userId,
    eventType: "triggered",
    message: `${reason.toUpperCase()} triggered at $${price.toFixed(2)}`,
    price,
  });

  const exitSide: "buy" | "sell" = plan.positionSide === "long" ? "sell" : "buy";
  const isOption = plan.instrumentType === "option" && !!plan.optionSymbol;

  try {
    const orderRequest: any = {
      accountId: plan.brokerAccountId,
      symbol: plan.symbol,
      side: exitSide,
      quantity: plan.quantity,
      orderType: "market",
      duration: "day",
      orderClass: isOption ? "option" : "equity",
    };
    if (isOption) {
      orderRequest.optionSymbol = plan.optionSymbol;
      orderRequest.optionSide = plan.positionSide === "long" ? "sell_to_close" : "buy_to_close";
    }

    const result = await placeBrokerOrder(plan.userId, orderRequest);

    await db
      .update(positionProtectionPlans)
      .set({
        status: PositionProtectionStatus.EXITED,
        submittedExitOrderId: result.orderId,
        exitPrice: price,
        exitedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(positionProtectionPlans.id, plan.id));

    await logEvent({
      planId: plan.id,
      userId: plan.userId,
      eventType: "exit_submitted",
      message: `Exit order ${result.orderId} submitted (${reason}) — ${exitSide} ${plan.quantity} ${plan.symbol}`,
      price,
      metadata: { orderId: result.orderId, brokerStatus: result.status },
    });

    await notifyTrigger(plan, reason, price);
  } catch (err) {
    await db
      .update(positionProtectionPlans)
      .set({ status: PositionProtectionStatus.ERROR, updatedAt: new Date() })
      .where(eq(positionProtectionPlans.id, plan.id));
    await logEvent({
      planId: plan.id,
      userId: plan.userId,
      eventType: "error",
      message: `Exit order failed: ${(err as Error).message}`,
      price,
    });
    console.error(`[PositionProtection] Exit failed for plan ${plan.id}:`, (err as Error).message);
  }
}

async function notifyTrigger(
  plan: PositionProtectionPlan,
  reason: "stop" | "target" | "trail",
  price: number,
): Promise<void> {
  try {
    const { sendPushNotification } = await import("../../push-service");
    const subs = await storage.getPushSubscriptionsByUserId(plan.userId);
    const label = reason === "target" ? "Target hit" : reason === "trail" ? "Trailing stop hit" : "Stop hit";
    for (const sub of subs) {
      await sendPushNotification(sub, {
        title: `${plan.symbol} — ${label}`,
        body: `Exit Protection submitted a ${plan.positionSide === "long" ? "sell" : "buy"} order for ${plan.quantity} ${plan.symbol} at ~$${price.toFixed(2)}.`,
        icon: "/logo.png",
        badge: "/logo.png",
        tag: `protection-${plan.id}`,
        data: { url: "/journal", symbol: plan.symbol },
      });
    }
  } catch (err) {
    console.error("[PositionProtection] Notify error:", (err as Error).message);
  }
}

// ─── Admin / monitoring ─────────────────────────────────────────────
export async function getAllPlansForAdmin(statuses?: string[]) {
  if (statuses && statuses.length > 0) {
    return db
      .select()
      .from(positionProtectionPlans)
      .where(inArray(positionProtectionPlans.status, statuses))
      .orderBy(desc(positionProtectionPlans.updatedAt))
      .limit(500);
  }
  return db
    .select()
    .from(positionProtectionPlans)
    .orderBy(desc(positionProtectionPlans.updatedAt))
    .limit(500);
}

export { ACTIVE_STATUSES };
