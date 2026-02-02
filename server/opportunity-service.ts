import { storage, type OpportunityFilters, type OpportunitySummary } from "./storage";
import type { ScanResult, Opportunity, InsertOpportunity, StrategyInfo } from "@shared/schema";
import { StrategyType } from "@shared/schema";
import { getStrategyDisplayName } from "@shared/strategies";

const EXPIRATION_DAYS: Record<string, number> = {
  "5m": 1,
  "15m": 1,
  "1h": 3,
  "1d": 10,
  "daily": 10,
};

const BREAKOUT_BUFFER = 0.001;

function generateDedupeKey(userId: string, symbol: string, strategyId: string, timeframe: string, detectedAt: Date): string {
  const hourBucket = Math.floor(detectedAt.getTime() / (1000 * 60 * 60));
  return `${userId}:${symbol}:${strategyId}:${timeframe}:${hourBucket}`;
}

function getStrategyName(strategyId: string): string {
  return getStrategyDisplayName(strategyId);
}

export async function ingestOpportunitiesFromScan(
  userId: string,
  scanResults: ScanResult[],
  strategyId: string = "VCP",
  timeframe: string = "1d"
): Promise<number> {
  let ingested = 0;
  const now = new Date();
  
  const qualifyingStages = ["FORMING", "READY", "BREAKOUT"];
  const qualifyingResults = scanResults.filter(r => qualifyingStages.includes(r.stage));
  
  for (const result of qualifyingResults) {
    const dedupeKey = generateDedupeKey(userId, result.ticker, strategyId, timeframe, now);
    
    const existing = await storage.findOpportunityByDedupeKey(dedupeKey);
    if (existing) {
      continue;
    }
    
    const opportunity: InsertOpportunity = {
      userId,
      symbol: result.ticker,
      strategyId,
      strategyName: getStrategyName(strategyId),
      timeframe,
      stageAtDetection: result.stage,
      detectedAt: now,
      detectedPrice: result.price,
      resistancePrice: result.resistance || null,
      stopReferencePrice: result.stopLoss || null,
      entryTriggerPrice: null,
      rvol: result.rvol || null,
      score: result.patternScore || null,
      status: "ACTIVE",
      dedupeKey,
      barsTracked: 0,
    };
    
    try {
      await storage.createOpportunity(opportunity);
      ingested++;
      console.log(`[Opportunities] Ingested: ${result.ticker} (${result.stage}) for user ${userId}`);
    } catch (error: any) {
      if (error.code === '23505') {
        continue;
      }
      console.error(`[Opportunities] Failed to ingest ${result.ticker}:`, error.message);
    }
  }
  
  // Also update prices for all active opportunities based on scan results
  if (scanResults.length > 0) {
    try {
      await updatePricesFromScanResults(userId, scanResults);
    } catch (updateError: any) {
      console.error(`[Opportunities] Error updating prices:`, updateError.message);
    }
  }
  
  return ingested;
}

async function updatePricesFromScanResults(userId: string, scanResults: ScanResult[]): Promise<void> {
  const activeOpportunities = await storage.getActiveOpportunities();
  const userOpportunities = activeOpportunities.filter(o => o.userId === userId);
  
  const priceMap = new Map<string, number>();
  for (const result of scanResults) {
    if (result.price) {
      priceMap.set(result.ticker, result.price);
    }
  }
  
  for (const opp of userOpportunities) {
    const currentPrice = priceMap.get(opp.symbol);
    if (currentPrice === undefined) continue;
    
    const updates: Partial<Opportunity> = {
      barsTracked: (opp.barsTracked || 0) + 1,
      lastPrice: currentPrice, // Always update lastPrice to latest
    };
    
    if (!opp.maxPriceAfter || currentPrice > opp.maxPriceAfter) {
      updates.maxPriceAfter = currentPrice;
      if (opp.detectedPrice) {
        updates.maxFavorableMovePercent = ((currentPrice - opp.detectedPrice) / opp.detectedPrice) * 100;
      }
    }
    
    if (!opp.minPriceAfter || currentPrice < opp.minPriceAfter) {
      updates.minPriceAfter = currentPrice;
      if (opp.detectedPrice) {
        updates.maxAdverseMovePercent = ((opp.detectedPrice - currentPrice) / opp.detectedPrice) * 100;
      }
    }
    
    await storage.updateOpportunity(opp.id, updates);
  }
}

export async function resolveOpportunities(): Promise<number> {
  let resolved = 0;
  const now = new Date();
  
  try {
    const activeOpportunities = await storage.getActiveOpportunities();
    console.log(`[Opportunities] Processing ${activeOpportunities.length} active opportunities`);
    
    for (const opp of activeOpportunities) {
      const expirationDays = EXPIRATION_DAYS[opp.timeframe] || 10;
      const expirationMs = expirationDays * 24 * 60 * 60 * 1000;
      const isExpired = now.getTime() - new Date(opp.detectedAt).getTime() > expirationMs;
      
      let resolutionOutcome: string | null = null;
      let resolutionReason: string | null = null;
      
      // Check for breakout - if stock broke resistance, it's a winner
      const breakoutThreshold = opp.resistancePrice ? opp.resistancePrice * (1 + BREAKOUT_BUFFER) : null;
      const didBreakResistance = breakoutThreshold && opp.maxPriceAfter && opp.maxPriceAfter >= breakoutThreshold;
      
      // Check for stop hit
      const didHitStop = opp.stopReferencePrice && opp.minPriceAfter && opp.minPriceAfter <= opp.stopReferencePrice;
      
      // Use lastPrice for current state (if available), otherwise fall back to max price
      const currentPrice = opp.lastPrice ?? opp.maxPriceAfter;
      
      // Check if current price is above entry (trade is currently profitable or recovered)
      const isCurrentlyAboveEntry = currentPrice && opp.detectedPrice && currentPrice >= opp.detectedPrice;
      
      // PRIORITY 1: BROKE_RESISTANCE wins - stock broke above resistance
      if (didBreakResistance) {
        resolutionOutcome = "BROKE_RESISTANCE";
        resolutionReason = `Price reached ${opp.maxPriceAfter!.toFixed(2)}, exceeding resistance ${opp.resistancePrice!.toFixed(2)}`;
      } 
      // PRIORITY 2: INVALIDATED - stop was hit AND current price is still below entry
      // This ensures we don't mark recovered trades as losses
      else if (didHitStop && !isCurrentlyAboveEntry) {
        resolutionOutcome = "INVALIDATED";
        resolutionReason = `Price dropped to ${opp.minPriceAfter!.toFixed(2)}, below stop reference ${opp.stopReferencePrice!.toFixed(2)}`;
      }
      // If stop was hit but price recovered above entry, defer to expiration
      
      // PRIORITY 3: Expiration - determine final outcome based on current/last price
      if (!resolutionOutcome && isExpired) {
        if (didHitStop && !isCurrentlyAboveEntry) {
          // Stop hit and currently below entry - true loss
          resolutionOutcome = "INVALIDATED";
          resolutionReason = `Price dropped to ${opp.minPriceAfter!.toFixed(2)}, below stop reference ${opp.stopReferencePrice!.toFixed(2)}`;
        } else {
          // Either didn't hit stop, or hit stop but recovered above entry
          resolutionOutcome = "EXPIRED";
          if (didHitStop && isCurrentlyAboveEntry) {
            resolutionReason = `Opportunity expired. Hit stop briefly but recovered above entry.`;
          } else {
            resolutionReason = `Opportunity expired after ${expirationDays} trading days without resolution`;
          }
        }
      }
      
      if (resolutionOutcome) {
        const resolvedAt = now;
        const activeDurationMinutes = Math.floor((resolvedAt.getTime() - new Date(opp.detectedAt).getTime()) / 60000);
        
        // Determine resolution price based on outcome
        let resolutionPrice: number | null = null;
        if (resolutionOutcome === "BROKE_RESISTANCE" && opp.maxPriceAfter) {
          resolutionPrice = opp.maxPriceAfter;
        } else if (resolutionOutcome === "INVALIDATED" && opp.minPriceAfter) {
          resolutionPrice = opp.minPriceAfter;
        } else if (resolutionOutcome === "EXPIRED") {
          // For expired, use lastPrice if available (most accurate), then maxPriceAfter, then minPriceAfter
          resolutionPrice = opp.lastPrice ?? opp.maxPriceAfter ?? opp.minPriceAfter ?? null;
        }
        
        // Calculate P&L percentage
        let pnlPercent: number | null = null;
        if (resolutionPrice && opp.detectedPrice) {
          pnlPercent = ((resolutionPrice - opp.detectedPrice) / opp.detectedPrice) * 100;
        }
        
        await storage.updateOpportunity(opp.id, {
          status: "RESOLVED",
          resolvedAt,
          resolutionOutcome,
          resolutionReason,
          resolutionPrice,
          pnlPercent,
          activeDurationMinutes,
        });
        
        resolved++;
        console.log(`[Opportunities] Resolved: ${opp.symbol} -> ${resolutionOutcome} (P&L: ${pnlPercent?.toFixed(2) ?? 'N/A'}%)`);
      }
    }
  } catch (error: any) {
    console.error("[Opportunities] Error resolving opportunities:", error.message);
  }
  
  return resolved;
}

export async function updateOpportunityPrices(
  symbol: string,
  currentPrice: number,
  highPrice?: number,
  lowPrice?: number
): Promise<void> {
  try {
    const activeOpportunities = await storage.getActiveOpportunities();
    const symbolOpportunities = activeOpportunities.filter(o => o.symbol === symbol);
    
    for (const opp of symbolOpportunities) {
      const updates: Partial<Opportunity> = {
        barsTracked: (opp.barsTracked || 0) + 1,
        lastPrice: currentPrice, // Always update lastPrice to latest
      };
      
      const effectiveHigh = highPrice ?? currentPrice;
      const effectiveLow = lowPrice ?? currentPrice;
      
      if (!opp.maxPriceAfter || effectiveHigh > opp.maxPriceAfter) {
        updates.maxPriceAfter = effectiveHigh;
        if (opp.detectedPrice) {
          updates.maxFavorableMovePercent = ((effectiveHigh - opp.detectedPrice) / opp.detectedPrice) * 100;
        }
      }
      
      if (!opp.minPriceAfter || effectiveLow < opp.minPriceAfter) {
        updates.minPriceAfter = effectiveLow;
        if (opp.detectedPrice) {
          updates.maxAdverseMovePercent = ((opp.detectedPrice - effectiveLow) / opp.detectedPrice) * 100;
        }
      }
      
      await storage.updateOpportunity(opp.id, updates);
    }
  } catch (error: any) {
    console.error(`[Opportunities] Error updating prices for ${symbol}:`, error.message);
  }
}

export async function getOpportunities(userId: string, filters?: OpportunityFilters): Promise<Opportunity[]> {
  return storage.getOpportunities(userId, filters);
}

export async function getOpportunity(id: string): Promise<Opportunity | null> {
  return storage.getOpportunity(id);
}

export async function getOpportunitySummary(userId: string, filters?: OpportunityFilters): Promise<OpportunitySummary> {
  return storage.getOpportunitySummary(userId, filters);
}

export async function exportOpportunitiesCSV(userId: string, filters?: OpportunityFilters): Promise<string> {
  const opportunities = await storage.getOpportunities(userId, { ...filters, limit: 10000 });
  
  const headers = [
    "Symbol",
    "Strategy",
    "Timeframe",
    "Stage at Detection",
    "Detected At",
    "Detected Price",
    "Resistance",
    "Stop Reference",
    "Max Price After",
    "Min Price After",
    "Max Favorable Move %",
    "Max Adverse Move %",
    "Status",
    "Outcome",
    "Resolution Reason",
    "Active Duration (min)",
    "Bars Tracked",
    "RVOL",
    "Score",
  ];
  
  const rows = opportunities.map(opp => [
    opp.symbol,
    opp.strategyName,
    opp.timeframe,
    opp.stageAtDetection,
    opp.detectedAt ? new Date(opp.detectedAt).toISOString() : "",
    opp.detectedPrice?.toFixed(2) ?? "",
    opp.resistancePrice?.toFixed(2) ?? "",
    opp.stopReferencePrice?.toFixed(2) ?? "",
    opp.maxPriceAfter?.toFixed(2) ?? "",
    opp.minPriceAfter?.toFixed(2) ?? "",
    opp.maxFavorableMovePercent?.toFixed(2) ?? "",
    opp.maxAdverseMovePercent?.toFixed(2) ?? "",
    opp.status,
    opp.resolutionOutcome ?? "",
    opp.resolutionReason ?? "",
    opp.activeDurationMinutes?.toString() ?? "",
    opp.barsTracked?.toString() ?? "",
    opp.rvol?.toFixed(2) ?? "",
    opp.score?.toString() ?? "",
  ]);
  
  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
  ].join("\n");
  
  return csvContent;
}
