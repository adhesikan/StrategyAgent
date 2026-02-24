import cron from "node-cron";
import crypto from "crypto";
import { storage } from "./storage";
import { ingestOpportunitiesFromScan } from "./opportunity-service";
import { fetchQuotesFromBroker, isBullishQuote, verifyBullishTrend } from "./broker-service";
import { StrategyType, agentState as agentStateTable, agentSettings as agentSettingsTable } from "@shared/schema";
import type { ScanResult } from "@shared/schema";
import { classifyQuote } from "./strategies";
import type { StrategyIdType } from "./strategies/types";
import { eq } from "drizzle-orm";
import { db } from "./db";

async function getAgentEnabledUserIds(): Promise<string[]> {
  const stateUsers = await db
    .select({ userId: agentStateTable.userId })
    .from(agentStateTable)
    .where(eq(agentStateTable.enabled, true));

  const settingsUsers = await db
    .select({ userId: agentSettingsTable.userId })
    .from(agentSettingsTable)
    .where(eq(agentSettingsTable.enabled, true));

  const userIds = new Set([
    ...stateUsers.map(u => u.userId),
    ...settingsUsers.map(u => u.userId),
  ]);
  return Array.from(userIds);
}

const DEFAULT_SCAN_UNIVERSE = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "AMD", "INTC", "CRM",
  "NFLX", "ADBE", "PYPL", "SHOP", "SQ", "COIN", "ROKU", "ZM", "DOCU", "SNOW",
  "NET", "CRWD", "DDOG", "ZS", "OKTA", "MDB", "PLTR", "U", "RBLX", "ABNB",
  "UBER", "LYFT", "DASH", "PINS", "SNAP", "SPOT", "SE", "BABA", "JD", "PDD",
  "NIO", "XPEV", "LI", "RIVN", "LCID", "F", "GM", "TM", "RACE", "BA",
  "LMT", "RTX", "GD", "NOC", "CAT", "DE", "MMM", "HON", "GE", "JPM",
  "BAC", "WFC", "C", "GS", "MS", "V", "MA", "AXP", "SCHW", "XOM",
  "CVX", "COP", "SLB", "OXY", "MRO", "DVN", "EOG", "PXD", "FANG", "UNH",
  "JNJ", "PFE", "MRNA", "ABBV", "MRK", "LLY", "BMY", "AMGN", "GILD", "WMT",
  "COST", "TGT", "HD", "LOW", "SBUX", "MCD", "NKE", "DIS", "CMCSA", "T"
];

const US_MARKET_HOLIDAYS_2025_2026 = [
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
  "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
];

// Default strategy groups for each scan window (used when user has no preferences)
const DEFAULT_WINDOW_STRATEGIES: Record<string, string[]> = {
  premarket: [StrategyType.GAP_AND_GO, StrategyType.VCP, StrategyType.VCP_MULTIDAY],
  vcp: [StrategyType.VCP, StrategyType.VCP_MULTIDAY],
  early_momentum: [StrategyType.ORB5, StrategyType.ORB15, StrategyType.GAP_AND_GO],
  mid_morning: [StrategyType.VWAP_RECLAIM, StrategyType.HIGH_RVOL],
  extended_hours: [StrategyType.VCP, StrategyType.VCP_MULTIDAY, StrategyType.VWAP_RECLAIM, StrategyType.HIGH_RVOL],
};

// Strategy groups kept for backward compatibility with manual scan
const STRATEGY_GROUPS = {
  PREMARKET_STRATEGIES: DEFAULT_WINDOW_STRATEGIES.premarket,
  VCP_STRATEGIES: DEFAULT_WINDOW_STRATEGIES.vcp,
  EARLY_MOMENTUM_STRATEGIES: DEFAULT_WINDOW_STRATEGIES.early_momentum,
  MID_MORNING_STRATEGIES: DEFAULT_WINDOW_STRATEGIES.mid_morning,
  EXTENDED_HOURS_STRATEGIES: DEFAULT_WINDOW_STRATEGIES.extended_hours,
};

interface ScanWindowConfig {
  enabled: boolean;
  strategies: string[];
}

function getUserStrategiesForWindow(scanSchedule: any, windowId: string): string[] | null {
  if (!scanSchedule || !scanSchedule.windows) {
    return DEFAULT_WINDOW_STRATEGIES[windowId] || null;
  }
  const windowConfig: ScanWindowConfig | undefined = scanSchedule.windows[windowId];
  if (!windowConfig) {
    return DEFAULT_WINDOW_STRATEGIES[windowId] || null;
  }
  if (!windowConfig.enabled) {
    return null;
  }
  if (!windowConfig.strategies || windowConfig.strategies.length === 0) {
    return DEFAULT_WINDOW_STRATEGIES[windowId] || null;
  }
  return windowConfig.strategies;
}


function isTradingDay(date: Date = new Date()): boolean {
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  
  const dateStr = date.toISOString().split("T")[0];
  if (US_MARKET_HOLIDAYS_2025_2026.includes(dateStr)) return false;
  
  return true;
}

function quotesToScanResults(quotes: any[], strategy: string): ScanResult[] {
  const results: ScanResult[] = [];
  const strategyId = strategy as StrategyIdType;
  
  for (const quote of quotes) {
    if (!isBullishQuote(quote)) continue;

    const classified = classifyQuote(strategyId, quote);
    if (!classified) continue;

    results.push({
      id: crypto.randomUUID(),
      ticker: classified.symbol,
      name: classified.name,
      price: classified.price,
      change: classified.change,
      changePercent: classified.changePercent,
      volume: classified.volume,
      avgVolume: classified.avgVolume || 0,
      rvol: classified.rvol,
      stage: classified.stage,
      patternScore: classified.score,
      resistance: classified.resistance,
      stopLoss: classified.stopLevel,
      strategy: strategy,
      createdAt: new Date(),
      scanRunId: null,
      atr: null,
      ema9: classified.ema9,
      ema21: classified.ema21,
    });
  }
  
  return results;
}

async function runScheduledScan(defaultStrategies: string[], scanName: string, windowId?: string): Promise<number> {
  const now = new Date();
  console.log(`[ScheduledScan] Running ${scanName} scan at ${now.toISOString()}`);
  
  if (!isTradingDay(now)) {
    console.log("[ScheduledScan] Not a trading day, skipping scan");
    return 0;
  }
  
  let totalIngested = 0;
  
  try {
    const connection = await storage.getAnyActiveBrokerConnection();
    if (!connection) {
      console.log("[ScheduledScan] No active broker connection available, skipping scheduled scan");
      return 0;
    }
    
    const connectionWithToken = await storage.getBrokerConnectionWithToken(connection.userId);
    if (!connectionWithToken || !connectionWithToken.accessToken) {
      console.log("[ScheduledScan] Could not retrieve broker access token, skipping scan");
      return 0;
    }
    
    console.log(`[ScheduledScan] Using broker connection: ${connection.provider} (user: ${connection.userId})`);
    
    const BATCH_SIZE = 50;
    const allQuotes: any[] = [];
    
    for (let i = 0; i < DEFAULT_SCAN_UNIVERSE.length; i += BATCH_SIZE) {
      const batch = DEFAULT_SCAN_UNIVERSE.slice(i, i + BATCH_SIZE);
      try {
        const quotes = await fetchQuotesFromBroker(connectionWithToken, batch);
        allQuotes.push(...quotes);
        await new Promise(r => setTimeout(r, 200));
      } catch (error: any) {
        console.error(`[ScheduledScan] Batch ${i / BATCH_SIZE + 1} error:`, error.message);
      }
    }
    
    console.log(`[ScheduledScan] Fetched ${allQuotes.length} quotes from ${DEFAULT_SCAN_UNIVERSE.length} symbols`);
    
    const agentUserIds = await getAgentEnabledUserIds();
    const allIngestUserIds = Array.from(new Set([connection.userId, ...agentUserIds]));

    const allUserSettings = await Promise.all(
      allIngestUserIds.map(async (uid) => {
        const settings = await storage.getAgentSettings(uid);
        return { userId: uid, scanSchedule: settings?.scanSchedule || null };
      })
    );

    const allStrategiesNeeded = new Set<string>();
    const userStrategyMap = new Map<string, string[]>();

    for (const { userId, scanSchedule } of allUserSettings) {
      let strategies: string[] | null;
      if (windowId) {
        strategies = getUserStrategiesForWindow(scanSchedule, windowId);
      } else {
        strategies = defaultStrategies;
      }
      if (strategies && strategies.length > 0) {
        userStrategyMap.set(userId, strategies);
        strategies.forEach(s => allStrategiesNeeded.add(s));
      } else {
        console.log(`[ScheduledScan] User ${userId} has window '${windowId}' disabled, skipping`);
      }
    }

    if (allStrategiesNeeded.size === 0) {
      console.log(`[ScheduledScan] No users have enabled strategies for ${scanName}, skipping`);
      return 0;
    }

    const strategyResults = new Map<string, ScanResult[]>();
    for (const strategy of Array.from(allStrategiesNeeded)) {
      const rawResults = quotesToScanResults(allQuotes, strategy);
      const results = await verifyBullishTrend(connectionWithToken, rawResults);
      strategyResults.set(strategy, results);
      
      if (results.length > 0) {
        console.log(`[ScheduledScan] Strategy ${strategy}: ${rawResults.length} raw -> ${results.length} bullish-verified`);
      } else {
        console.log(`[ScheduledScan] Strategy ${strategy}: 0 qualifying setups`);
      }
    }

    for (const [uid, strategies] of Array.from(userStrategyMap.entries())) {
      for (const strategy of strategies) {
        const results = strategyResults.get(strategy);
        if (results && results.length > 0) {
          try {
            const ingested = await ingestOpportunitiesFromScan(uid, results, strategy, "1d");
            totalIngested += ingested;
          } catch (error: any) {
            console.error(`[ScheduledScan] Failed to ingest for user ${uid}, strategy ${strategy}:`, error.message);
          }
        }
      }
    }
    
    console.log(`[ScheduledScan] ${scanName} completed: ingested ${totalIngested} setups for ${userStrategyMap.size} user(s)`);
  } catch (error: any) {
    console.error(`[ScheduledScan] Error running ${scanName}:`, error.message);
  }
  
  return totalIngested;
}

export function startScheduledScanService(): void {
  cron.schedule("0 8 * * 1-5", async () => {
    console.log("[ScheduledScan] 8:00 AM ET - Premarket scan triggered");
    await runScheduledScan(STRATEGY_GROUPS.PREMARKET_STRATEGIES, "Premarket (8:00 AM)", "premarket");
  }, {
    timezone: "America/New_York"
  });

  cron.schedule("45 9 * * 1-5", async () => {
    console.log("[ScheduledScan] 9:45 AM ET - VCP strategies scan triggered");
    await runScheduledScan(STRATEGY_GROUPS.VCP_STRATEGIES, "VCP Strategies (9:45 AM)", "vcp");
  }, {
    timezone: "America/New_York"
  });
  
  cron.schedule("0 10 * * 1-5", async () => {
    console.log("[ScheduledScan] 10:00 AM ET - Early momentum strategies scan triggered");
    await runScheduledScan(STRATEGY_GROUPS.EARLY_MOMENTUM_STRATEGIES, "Early Momentum (10:00 AM)", "early_momentum");
  }, {
    timezone: "America/New_York"
  });
  
  cron.schedule("0 11 * * 1-5", async () => {
    console.log("[ScheduledScan] 11:00 AM ET - Mid-morning strategies scan triggered");
    await runScheduledScan(STRATEGY_GROUPS.MID_MORNING_STRATEGIES, "Mid-Morning (11:00 AM)", "mid_morning");
  }, {
    timezone: "America/New_York"
  });

  cron.schedule("15 16 * * 1-5", async () => {
    console.log("[ScheduledScan] 4:15 PM ET - Extended hours scan triggered");
    await runScheduledScan(STRATEGY_GROUPS.EXTENDED_HOURS_STRATEGIES, "Extended Hours (4:15 PM)", "extended_hours");
  }, {
    timezone: "America/New_York"
  });
  
  console.log("[ScheduledScan] Scheduled scan service started with multiple scan times:");
  console.log("  - 8:00 AM ET: Premarket (Gap Force, VCP patterns)");
  console.log("  - 9:45 AM ET: Momentum Breakout, Power Breakout (swing strategies)");
  console.log("  - 10:00 AM ET: Open Drive (5m/15m), Gap Force (early momentum)");
  console.log("  - 11:00 AM ET: Institutional Reclaim, Volume Surge (mid-morning)");
  console.log("  - 4:15 PM ET: Extended Hours (VCP, VWAP Reclaim, Volume Surge)");
}

export async function runManualScheduledScan(): Promise<{ success: boolean; message: string; ingestedCount?: number }> {
  try {
    const allStrategies = [
      ...STRATEGY_GROUPS.VCP_STRATEGIES,
      ...STRATEGY_GROUPS.EARLY_MOMENTUM_STRATEGIES,
      ...STRATEGY_GROUPS.MID_MORNING_STRATEGIES,
    ];
    
    const totalIngested = await runScheduledScan(allStrategies, "Manual Full Scan");
    return { 
      success: true, 
      message: `Scheduled scan completed successfully. Ingested ${totalIngested} setups across all strategies.`,
      ingestedCount: totalIngested 
    };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}
