import cron from "node-cron";
import crypto from "crypto";
import { storage } from "./storage";
import { ingestOpportunitiesFromScan } from "./opportunity-service";
import { fetchQuotesFromBroker } from "./broker-service";
import { classifyVCPStage } from "./alert-engine";
import { StrategyType } from "@shared/schema";
import type { ScanResult } from "@shared/schema";

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

interface StrategyClassification {
  qualifies: boolean;
  stage: "FORMING" | "READY" | "BREAKOUT";
  volumeRatio: number;
  resistance: number;
  stopLoss: number;
  score: number;
}

function classifyORB(quote: any): StrategyClassification {
  const volumeRatio = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
  const priceFromOpen = quote.open ? ((quote.last - quote.open) / quote.open) * 100 : 0;
  
  // ORB looks for strong moves from open with volume
  // Breakout: >1.5% from open with high volume
  // Ready: 0.5-1.5% from open with decent volume
  const qualifies = Math.abs(priceFromOpen) > 0.5 && volumeRatio > 1.0;
  
  let stage: "FORMING" | "READY" | "BREAKOUT" = "FORMING";
  if (priceFromOpen > 1.5 && volumeRatio > 1.5) {
    stage = "BREAKOUT";
  } else if (priceFromOpen > 0.5 && volumeRatio > 1.2) {
    stage = "READY";
  }
  
  return {
    qualifies,
    stage,
    volumeRatio,
    resistance: quote.last * 1.015,
    stopLoss: quote.open || quote.last * 0.985,
    score: Math.min(100, 50 + Math.floor(volumeRatio * 15) + Math.floor(Math.abs(priceFromOpen) * 10)),
  };
}

function classifyGapAndGo(quote: any): StrategyClassification {
  const volumeRatio = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
  // Gap is the difference between today's open and yesterday's close (approximated by prevClose if available)
  const gapPercent = quote.prevClose ? ((quote.open - quote.prevClose) / quote.prevClose) * 100 : quote.changePercent;
  const priceFromOpen = quote.open ? ((quote.last - quote.open) / quote.open) * 100 : 0;
  
  // Gap & Go: Strong gap up (>2%) that continues higher with volume
  const qualifies = gapPercent > 2 && priceFromOpen >= 0 && volumeRatio > 1.2;
  
  let stage: "FORMING" | "READY" | "BREAKOUT" = "FORMING";
  if (gapPercent > 3 && priceFromOpen > 1 && volumeRatio > 2) {
    stage = "BREAKOUT";
  } else if (gapPercent > 2 && priceFromOpen >= 0 && volumeRatio > 1.5) {
    stage = "READY";
  }
  
  return {
    qualifies,
    stage,
    volumeRatio,
    resistance: quote.high || quote.last * 1.02,
    stopLoss: quote.open || quote.last * 0.97,
    score: Math.min(100, 50 + Math.floor(gapPercent * 8) + Math.floor(volumeRatio * 10)),
  };
}

function classifyVWAP(quote: any): StrategyClassification {
  const volumeRatio = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
  // VWAP is approximated as midpoint between high and low weighted by volume patterns
  // For simplicity, use the day's average price as VWAP proxy
  const vwapProxy = (quote.high + quote.low + quote.last) / 3;
  const priceFromVWAP = vwapProxy ? ((quote.last - vwapProxy) / vwapProxy) * 100 : 0;
  
  // VWAP bounce: Price near or just above VWAP with volume
  const qualifies = Math.abs(priceFromVWAP) < 1 && volumeRatio > 0.8;
  
  let stage: "FORMING" | "READY" | "BREAKOUT" = "FORMING";
  if (priceFromVWAP > 0.3 && priceFromVWAP < 1 && volumeRatio > 1.3) {
    stage = "BREAKOUT";
  } else if (Math.abs(priceFromVWAP) < 0.5 && volumeRatio > 1.0) {
    stage = "READY";
  }
  
  return {
    qualifies,
    stage,
    volumeRatio,
    resistance: quote.high || quote.last * 1.015,
    stopLoss: vwapProxy * 0.99,
    score: Math.min(100, 60 + Math.floor(volumeRatio * 15)),
  };
}

function classifyHighRvol(quote: any): StrategyClassification {
  const volumeRatio = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
  
  // High RVOL: Stocks with significantly higher than average volume
  // Indicates unusual activity and potential momentum
  const qualifies = volumeRatio > 2.0 && quote.change > 0;
  
  let stage: "FORMING" | "READY" | "BREAKOUT" = "FORMING";
  if (volumeRatio > 3.0 && quote.changePercent > 2) {
    stage = "BREAKOUT";
  } else if (volumeRatio > 2.5 && quote.changePercent > 0.5) {
    stage = "READY";
  }
  
  return {
    qualifies,
    stage,
    volumeRatio,
    resistance: quote.high || quote.last * 1.02,
    stopLoss: quote.last * 0.95,
    score: Math.min(100, 40 + Math.floor(volumeRatio * 15) + Math.floor(quote.changePercent * 5)),
  };
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
  
  for (const quote of quotes) {
    let classification: StrategyClassification | null = null;
    
    // Use strategy-specific classification
    switch (strategy) {
      case StrategyType.VCP:
      case StrategyType.VCP_MULTIDAY: {
        const vcpResult = classifyVCPStage(quote);
        if (vcpResult.stage === "FORMING" || vcpResult.stage === "READY" || vcpResult.stage === "BREAKOUT") {
          classification = {
            qualifies: true,
            stage: vcpResult.stage,
            volumeRatio: vcpResult.volumeRatio,
            resistance: vcpResult.resistance,
            stopLoss: vcpResult.stopLoss,
            score: Math.min(100, 60 + Math.floor(vcpResult.volumeRatio * 10)),
          };
        }
        break;
      }
      case StrategyType.ORB5:
      case StrategyType.ORB15:
        classification = classifyORB(quote);
        break;
      case StrategyType.GAP_AND_GO:
        classification = classifyGapAndGo(quote);
        break;
      case StrategyType.VWAP_RECLAIM:
        classification = classifyVWAP(quote);
        break;
      case StrategyType.HIGH_RVOL:
        classification = classifyHighRvol(quote);
        break;
    }
    
    if (classification && classification.qualifies) {
      results.push({
        id: crypto.randomUUID(),
        ticker: quote.symbol,
        name: quote.symbol,
        price: quote.last,
        change: quote.change,
        changePercent: quote.changePercent,
        volume: quote.volume,
        avgVolume: quote.avgVolume || 0,
        rvol: classification.volumeRatio,
        stage: classification.stage,
        patternScore: classification.score,
        resistance: classification.resistance,
        stopLoss: classification.stopLoss,
        strategy: strategy,
        createdAt: new Date(),
        scanRunId: null,
        atr: null,
        ema9: null,
        ema21: null,
      });
    }
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
    
    for (const strategy of strategies) {
      const results = quotesToScanResults(allQuotes, strategy);
      
      if (results.length > 0) {
        console.log(`[ScheduledScan] Strategy ${strategy}: ${results.length} qualifying opportunities`);
        
        try {
          const ingested = await ingestOpportunitiesFromScan(connection.userId, results, strategy, "1d");
          totalIngested += ingested;
        } catch (error: any) {
          console.error(`[ScheduledScan] Failed to ingest for strategy ${strategy}:`, error.message);
        }
      } else {
        console.log(`[ScheduledScan] Strategy ${strategy}: 0 qualifying opportunities`);
      }
    }
    
    console.log(`[ScheduledScan] ${scanName} completed: ingested ${totalIngested} opportunities`);
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
