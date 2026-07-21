import { getActivePlans, processPlan, getProtectionConfig } from "./services/position-protection/index";
import { getMarketSession } from "@shared/market-session";

// Poll cadences are env-overridable. Live accounts are checked more frequently
// than paper accounts since real money is at stake.
function pollMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 5_000 ? Math.floor(raw) : fallback;
}

const LIVE_INTERVAL_MS = pollMs("POSITION_PROTECTION_LIVE_POLL_MS", 15_000);
const PAPER_INTERVAL_MS = pollMs("POSITION_PROTECTION_PAPER_POLL_MS", 60_000);

// Worker heartbeat — surfaced to the admin monitor so operators can confirm the
// loop is alive and see what the last sweep processed.
interface Heartbeat {
  startedAt: string | null;
  lastRunAt: string | null;
  lastLiveCount: number;
  lastPaperCount: number;
  lastError: string | null;
  liveIntervalMs: number;
  paperIntervalMs: number;
  running: boolean;
}

const heartbeat: Heartbeat = {
  startedAt: null,
  lastRunAt: null,
  lastLiveCount: 0,
  lastPaperCount: 0,
  lastError: null,
  liveIntervalMs: LIVE_INTERVAL_MS,
  paperIntervalMs: PAPER_INTERVAL_MS,
  running: false,
};

export function getWorkerHeartbeat(): Heartbeat {
  return { ...heartbeat };
}

// Active during regular + extended sessions (4:00 AM – 8:00 PM ET, weekdays).
function isTradeableSession(): boolean {
  return getMarketSession() !== "closed";
}

async function runProtectionChecks(mode: "live" | "paper"): Promise<void> {
  const cfg = getProtectionConfig();
  if (!cfg.enabled) return;
  if (mode === "live" && !cfg.liveEnabled) return;
  if (!isTradeableSession()) return;

  try {
    const plans = await getActivePlans(mode);
    heartbeat.lastRunAt = new Date().toISOString();
    if (mode === "live") heartbeat.lastLiveCount = plans.length;
    else heartbeat.lastPaperCount = plans.length;

    if (plans.length === 0) return;
    console.log(`[PositionProtection] Checking ${plans.length} active ${mode} plans`);

    for (const plan of plans) {
      try {
        await processPlan(plan);
      } catch (err) {
        heartbeat.lastError = (err as Error).message;
        console.error(`[PositionProtection] Error processing plan ${plan.id}:`, (err as Error).message);
      }
    }
  } catch (err) {
    heartbeat.lastError = (err as Error).message;
    console.error(`[PositionProtection] Error fetching active ${mode} plans:`, (err as Error).message);
  }
}

let liveHandle: ReturnType<typeof setInterval> | null = null;
let paperHandle: ReturnType<typeof setInterval> | null = null;

export function startPositionProtectionWorker(): void {
  if (liveHandle || paperHandle) return;
  heartbeat.startedAt = new Date().toISOString();
  heartbeat.running = true;
  const cfg = getProtectionConfig();
  console.log(
    `[PositionProtection] Starting protection worker (live ${LIVE_INTERVAL_MS / 1000}s / paper ${PAPER_INTERVAL_MS / 1000}s) — ` +
      `config: enabled=${cfg.enabled} liveEnabled=${cfg.liveEnabled} sandboxEnabled=${cfg.sandboxEnabled} ` +
      `optionsEnabled=${cfg.optionsEnabled} spreadsEnabled=${cfg.spreadsEnabled}`,
  );
  liveHandle = setInterval(() => runProtectionChecks("live"), LIVE_INTERVAL_MS);
  paperHandle = setInterval(() => runProtectionChecks("paper"), PAPER_INTERVAL_MS);
  runProtectionChecks("live");
  runProtectionChecks("paper");
}

export function stopPositionProtectionWorker(): void {
  if (liveHandle) clearInterval(liveHandle);
  if (paperHandle) clearInterval(paperHandle);
  liveHandle = null;
  paperHandle = null;
  heartbeat.running = false;
  console.log("[PositionProtection] Stopped");
}
