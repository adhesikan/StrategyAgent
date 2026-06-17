import { getActivePlans, processPlan, getProtectionConfig } from "./services/position-protection/index";
import { getMarketSession } from "@shared/market-session";

const CHECK_INTERVAL_MS = 30_000;

// Active during regular + extended sessions (4:00 AM – 8:00 PM ET, weekdays).
function isTradeableSession(): boolean {
  return getMarketSession() !== "closed";
}

async function runProtectionChecks(): Promise<void> {
  const cfg = getProtectionConfig();
  if (!cfg.enabled) return;
  if (!isTradeableSession()) return;

  try {
    const plans = await getActivePlans();
    if (plans.length === 0) return;

    console.log(`[PositionProtection] Checking ${plans.length} active protection plans`);

    for (const plan of plans) {
      try {
        await processPlan(plan);
      } catch (err) {
        console.error(`[PositionProtection] Error processing plan ${plan.id}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error("[PositionProtection] Error fetching active plans:", (err as Error).message);
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startPositionProtectionWorker(): void {
  if (intervalHandle) return;
  console.log(`[PositionProtection] Starting protection worker (${CHECK_INTERVAL_MS / 1000}s interval)`);
  intervalHandle = setInterval(runProtectionChecks, CHECK_INTERVAL_MS);
  runProtectionChecks();
}

export function stopPositionProtectionWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[PositionProtection] Stopped");
  }
}
