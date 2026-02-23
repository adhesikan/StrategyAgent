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

// Strategy groups for different scan times
const STRATEGY_GROUPS = {
  // 8:00 AM - Premarket scan (gap analysis, overnight setups)
  PREMARKET_STRATEGIES: [StrategyType.GAP_AND_GO, StrategyType.VCP, StrategyType.VCP_MULTIDAY],
  // 9:45 AM - VCP patterns (swing/position strategies)
  VCP_STRATEGIES: [StrategyType.VCP, StrategyType.VCP_MULTIDAY],
  // 10:00 AM - Early morning momentum plays
  EARLY_MOMENTUM_STRATEGIES: [StrategyType.ORB5, StrategyType.ORB15, StrategyType.GAP_AND_GO],
  // 11:00 AM - Mid-morning setups
  MID_MORNING_STRATEGIES: [StrategyType.VWAP_RECLAIM, StrategyType.HIGH_RVOL],
  // 4:15 PM - Extended hours scan (post-close review)
  EXTENDED_HOURS_STRATEGIES: [StrategyType.VCP, StrategyType.VCP_MULTIDAY, StrategyType.VWAP_RECLAIM, StrategyType.HIGH_RVOL],
};


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

async function runScheduledScan(strategies: string[], scanName: string): Promise<number> {
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

    for (const strategy of strategies) {
      const rawResults = quotesToScanResults(allQuotes, strategy);
      const results = await verifyBullishTrend(connectionWithToken, rawResults);
      
      if (results.length > 0) {
        console.log(`[ScheduledScan] Strategy ${strategy}: ${rawResults.length} raw -> ${results.length} bullish-verified opportunities`);
        
        for (const uid of allIngestUserIds) {
          try {
            const ingested = await ingestOpportunitiesFromScan(uid, results, strategy, "1d");
            totalIngested += ingested;
          } catch (error: any) {
            console.error(`[ScheduledScan] Failed to ingest for user ${uid}, strategy ${strategy}:`, error.message);
          }
        }
      } else {
        console.log(`[ScheduledScan] Strategy ${strategy}: 0 qualifying opportunities`);
      }
    }
    
    console.log(`[ScheduledScan] ${scanName} completed: ingested ${totalIngested} opportunities for ${allIngestUserIds.length} user(s)`);
  } catch (error: any) {
    console.error(`[ScheduledScan] Error running ${scanName}:`, error.message);
  }
  
  return totalIngested;
}

export function startScheduledScanService(): void {
  // 8:00 AM ET - Premarket scan (gap analysis, overnight setups)
  cron.schedule("0 8 * * 1-5", async () => {
    console.log("[ScheduledScan] 8:00 AM ET - Premarket scan triggered");
    await runScheduledScan(STRATEGY_GROUPS.PREMARKET_STRATEGIES, "Premarket (8:00 AM)");
  }, {
    timezone: "America/New_York"
  });

  // 9:45 AM ET - VCP strategies (swing/position plays)
  cron.schedule("45 9 * * 1-5", async () => {
    console.log("[ScheduledScan] 9:45 AM ET - VCP strategies scan triggered");
    await runScheduledScan(STRATEGY_GROUPS.VCP_STRATEGIES, "VCP Strategies (9:45 AM)");
  }, {
    timezone: "America/New_York"
  });
  
  // 10:00 AM ET - Early momentum strategies (ORB, Gap & Go)
  cron.schedule("0 10 * * 1-5", async () => {
    console.log("[ScheduledScan] 10:00 AM ET - Early momentum strategies scan triggered");
    await runScheduledScan(STRATEGY_GROUPS.EARLY_MOMENTUM_STRATEGIES, "Early Momentum (10:00 AM)");
  }, {
    timezone: "America/New_York"
  });
  
  // 11:00 AM ET - Mid-morning strategies (VWAP, Red to Green)
  cron.schedule("0 11 * * 1-5", async () => {
    console.log("[ScheduledScan] 11:00 AM ET - Mid-morning strategies scan triggered");
    await runScheduledScan(STRATEGY_GROUPS.MID_MORNING_STRATEGIES, "Mid-Morning (11:00 AM)");
  }, {
    timezone: "America/New_York"
  });

  // 4:15 PM ET - Extended hours scan (post-close review for next day)
  cron.schedule("15 16 * * 1-5", async () => {
    console.log("[ScheduledScan] 4:15 PM ET - Extended hours scan triggered");
    await runScheduledScan(STRATEGY_GROUPS.EXTENDED_HOURS_STRATEGIES, "Extended Hours (4:15 PM)");
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
    // Run all strategy groups when manually triggered
    const allStrategies = [
      ...STRATEGY_GROUPS.VCP_STRATEGIES,
      ...STRATEGY_GROUPS.EARLY_MOMENTUM_STRATEGIES,
      ...STRATEGY_GROUPS.MID_MORNING_STRATEGIES,
    ];
    
    const totalIngested = await runScheduledScan(allStrategies, "Manual Full Scan");
    return { 
      success: true, 
      message: `Scheduled scan completed successfully. Ingested ${totalIngested} opportunities across all strategies.`,
      ingestedCount: totalIngested 
    };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}
