import { db } from "./db";
import { managedExits, tradeOrders } from "@shared/schema";
import { eq } from "drizzle-orm";
import * as brokerService from "./broker/index";
import { storage } from "./storage";
import { getTraderTypeConfig } from "./position-sizing";
import { getMarketSession, durationForExtendedHours } from "@shared/market-session";

const CHECK_INTERVAL_MS = 30_000;
const MARKET_CLOSE_HOUR = 16;
const MARKET_CLOSE_MINUTE = 0;
const EOD_CLOSE_MINUTES_BEFORE = 5;

// Active during regular + extended sessions (4:00 AM – 8:00 PM ET, weekdays).
function isTradeableSession(): boolean {
  const session = getMarketSession();
  return session !== "closed";
}

async function checkManagedExits(): Promise<void> {
  if (!isTradeableSession()) return;

  try {
    const activeExits = await db
      .select()
      .from(managedExits)
      .where(eq(managedExits.status, "active"));

    if (activeExits.length === 0) return;

    console.log(`[ExitManager] Checking ${activeExits.length} active managed exits`);

    for (const exit of activeExits) {
      try {
        await processExit(exit);
      } catch (err) {
        console.error(`[ExitManager] Error processing exit ${exit.id}:`, (err as Error).message);
        await db
          .update(managedExits)
          .set({ lastCheckedAt: new Date() })
          .where(eq(managedExits.id, exit.id));
      }
    }
  } catch (err) {
    console.error("[ExitManager] Error fetching active exits:", (err as Error).message);
  }
}

async function processExit(exit: typeof managedExits.$inferSelect): Promise<void> {
  if (!exit.optionSymbol) {
    console.warn(`[ExitManager] Exit ${exit.id} has no option symbol, skipping`);
    return;
  }

  const quote = await brokerService.getOptionQuote(exit.userId, exit.optionSymbol);
  if (!quote) {
    await db
      .update(managedExits)
      .set({ lastCheckedAt: new Date() })
      .where(eq(managedExits.id, exit.id));
    return;
  }

  const currentMid = quote.mid;
  if (!currentMid || isNaN(currentMid) || currentMid <= 0) {
    console.warn(`[ExitManager] Exit ${exit.id}: invalid mid price (${currentMid}), skipping`);
    await db
      .update(managedExits)
      .set({ lastCheckedAt: new Date() })
      .where(eq(managedExits.id, exit.id));
    return;
  }

  if ((!quote.bid && quote.bid !== 0) || (!quote.ask && quote.ask !== 0) || (quote.bid === 0 && quote.ask === 0)) {
    console.warn(`[ExitManager] Exit ${exit.id}: invalid bid/ask (${quote.bid}/${quote.ask}), skipping`);
    await db
      .update(managedExits)
      .set({ lastCheckedAt: new Date() })
      .where(eq(managedExits.id, exit.id));
    return;
  }

  const closeSide = exit.optionSide || "sell_to_close";
  const isBuyToClose = closeSide === "buy_to_close";

  let triggered: "target" | "stop" | null = null;

  if (isBuyToClose) {
    if (exit.targetPrice && currentMid <= exit.targetPrice) {
      triggered = "target";
    } else if (exit.stopPrice && currentMid >= exit.stopPrice) {
      triggered = "stop";
    }
  } else {
    if (exit.targetPrice && currentMid >= exit.targetPrice) {
      triggered = "target";
    } else if (exit.stopPrice && currentMid <= exit.stopPrice) {
      triggered = "stop";
    }
  }

  if (!triggered) {
    await db
      .update(managedExits)
      .set({ lastCheckedAt: new Date() })
      .where(eq(managedExits.id, exit.id));
    return;
  }

  console.log(`[ExitManager] ${triggered.toUpperCase()} triggered for exit ${exit.id} (${exit.optionSymbol}), mid=$${currentMid}`);

  try {
    const tradeOrder = await db
      .select()
      .from(tradeOrders)
      .where(eq(tradeOrders.id, exit.tradeOrderId))
      .then((rows) => rows[0]);

    if (!tradeOrder) {
      console.warn(`[ExitManager] Exit ${exit.id}: trade order ${exit.tradeOrderId} not found, marking error`);
      await db
        .update(managedExits)
        .set({ status: "error", lastCheckedAt: new Date() })
        .where(eq(managedExits.id, exit.id));
      return;
    }

    // In extended sessions market orders aren't accepted — fall back to a
    // marketable limit at the current mid using the matching pre/post duration.
    const extDur = durationForExtendedHours();
    const useExtended = extDur !== null;
    const orderRequest: any = {
      accountId: exit.brokerAccountId,
      symbol: exit.symbol,
      side: isBuyToClose ? "buy" : "sell",
      quantity: exit.quantity,
      orderType: useExtended ? ("limit" as const) : ("market" as const),
      duration: useExtended ? extDur! : ("day" as const),
      orderClass: "option",
      optionSymbol: exit.optionSymbol,
      optionSide: closeSide,
      ...(useExtended ? { price: Number(currentMid.toFixed(2)) } : {}),
    };

    const result = await brokerService.placeBrokerOrder(exit.userId, orderRequest);

    await db
      .update(managedExits)
      .set({
        status: triggered === "target" ? "target_hit" : "stop_hit",
        exitBrokerOrderId: result.orderId,
        exitPrice: currentMid,
        exitedAt: new Date(),
        lastCheckedAt: new Date(),
      })
      .where(eq(managedExits.id, exit.id));

    console.log(`[ExitManager] Exit order placed for ${exit.optionSymbol}: ${result.orderId} (${triggered})`);
  } catch (err) {
    console.error(`[ExitManager] Failed to place exit order for ${exit.id}:`, (err as Error).message);
    await db
      .update(managedExits)
      .set({
        status: "error",
        lastCheckedAt: new Date(),
      })
      .where(eq(managedExits.id, exit.id));
  }
}

function isNearMarketClose(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = et.getHours();
  const minute = et.getMinutes();
  const day = et.getDay();

  if (day === 0 || day === 6) return false;

  const currentMinutes = hour * 60 + minute;
  const closeMinutes = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;
  const eodThreshold = closeMinutes - EOD_CLOSE_MINUTES_BEFORE;

  return currentMinutes >= eodThreshold && currentMinutes < closeMinutes;
}

const eodClosedToday = new Set<string>();

function resetEodTracker(): void {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = et.getHours();
  if (hour < 8) {
    eodClosedToday.clear();
  }
}

async function checkDayTraderEODClose(): Promise<void> {
  if (!isNearMarketClose()) return;

  resetEodTracker();

  try {
    const { userSettings } = await import("@shared/schema");
    const allSettings = await db.select().from(userSettings);

    for (const settings of allSettings) {
      const traderConfig = getTraderTypeConfig(settings.traderType);
      if (!traderConfig.autoCloseEOD) continue;

      const userId = settings.userId;
      if (eodClosedToday.has(userId)) continue;

      try {
        const connection = await storage.getBrokerConnection(userId);
        if (!connection || !connection.isConnected || !connection.preferredAccountId) continue;

        const positions = await brokerService.getBrokerPositions(userId);
        if (positions.length === 0) {
          eodClosedToday.add(userId);
          continue;
        }

        console.log(`[ExitManager] Day trader EOD close: ${positions.length} positions for user ${userId}`);

        for (const position of positions) {
          if (position.qty === 0) continue;

          try {
            const side: "buy" | "sell" = position.qty > 0 ? "sell" : "buy";
            const orderRequest = {
              accountId: connection.preferredAccountId,
              symbol: position.symbol,
              side,
              quantity: Math.abs(position.qty),
              orderType: "market" as const,
              duration: "day" as const,
              orderClass: "equity" as const,
            };

            const result = await brokerService.placeBrokerOrder(userId, orderRequest);
            console.log(`[ExitManager] EOD close order for ${position.symbol}: ${result.orderId} (side: ${side}, qty: ${Math.abs(position.qty)})`);
          } catch (err) {
            console.error(`[ExitManager] EOD close failed for ${position.symbol} (user ${userId}):`, (err as Error).message);
          }
        }

        eodClosedToday.add(userId);
      } catch (err) {
        console.error(`[ExitManager] EOD close error for user ${userId}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error("[ExitManager] EOD close check error:", (err as Error).message);
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function runExitChecks(): Promise<void> {
  await checkManagedExits();
  await checkDayTraderEODClose();
}

export function startExitManager(): void {
  if (intervalHandle) return;

  console.log(`[ExitManager] Starting exit manager (${CHECK_INTERVAL_MS / 1000}s interval)`);
  intervalHandle = setInterval(runExitChecks, CHECK_INTERVAL_MS);
  runExitChecks();
}

export function stopExitManager(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[ExitManager] Stopped");
  }
}
