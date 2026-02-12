import { storage } from "./storage";
import {
  AgentPolicy,
  AgentState,
  AgentDecision,
  InsertAgentDecision,
  AgentAction,
  AgentMode,
  AgentDecisionMetrics,
  Opportunity,
} from "@shared/schema";

export interface EligibilityResult {
  pass: boolean;
  reasons: string[];
  metrics: AgentDecisionMetrics;
}

export function computeTargetPrice(resistance: number, stop: number): number {
  if (!resistance || !stop || resistance <= 0 || stop <= 0) return 0;
  const baseDepth = resistance - stop;
  return resistance + (baseDepth * 0.5);
}

export function computeUpsidePct(price: number, resistance: number, stop?: number): number {
  if (!price || price <= 0 || !resistance) return 0;
  const target = stop ? computeTargetPrice(resistance, stop) : resistance;
  return ((target - price) / price) * 100;
}

export function computeRiskPct(price: number, stop: number): number {
  if (!price || price <= 0 || !stop) return 0;
  return ((price - stop) / price) * 100;
}

export function computeRewardRisk(upsidePct: number, riskPct: number): number {
  if (!riskPct || riskPct <= 0) return 0;
  return upsidePct / riskPct;
}

export function isEligible(
  opportunity: Opportunity,
  policy: AgentPolicy,
  currentTime?: Date
): EligibilityResult {
  const reasons: string[] = [];
  const now = currentTime || new Date();
  
  const price = opportunity.detectedPrice || opportunity.lastPrice || 0;
  const resistance = opportunity.resistancePrice || 0;
  const stop = opportunity.stopReferencePrice || 0;
  const confidence = opportunity.score || 0;
  const rvol = opportunity.rvol || 0;
  
  const upsidePct = computeUpsidePct(price, resistance, stop);
  const riskPct = computeRiskPct(price, stop);
  const rewardRisk = computeRewardRisk(upsidePct, riskPct);
  
  const metrics: AgentDecisionMetrics = {
    confidence,
    price,
    resistance,
    stop,
    rvol,
    upsidePct,
    riskPct,
    rewardRisk,
  };
  
  if (!policy.enabled) {
    reasons.push("Policy is disabled");
    return { pass: false, reasons, metrics };
  }
  
  if (policy.strategyId && policy.strategyId !== opportunity.strategyId) {
    reasons.push(`Strategy ${opportunity.strategyId} not matching policy filter ${policy.strategyId}`);
    return { pass: false, reasons, metrics };
  }
  
  if (policy.minConfidencePct && confidence < policy.minConfidencePct) {
    reasons.push(`Confidence ${confidence}% < min ${policy.minConfidencePct}%`);
  }
  
  if (policy.minUpsidePct && upsidePct < policy.minUpsidePct) {
    reasons.push(`Upside ${upsidePct.toFixed(1)}% < min ${policy.minUpsidePct}%`);
  }
  
  if (policy.minRvol && rvol < policy.minRvol) {
    reasons.push(`RVOL ${rvol.toFixed(2)} < min ${policy.minRvol}`);
  }
  
  if (policy.minRewardRisk && rewardRisk < policy.minRewardRisk) {
    reasons.push(`R:R ${rewardRisk.toFixed(2)} < min ${policy.minRewardRisk}`);
  }
  
  if (policy.priceMin && price < policy.priceMin) {
    reasons.push(`Price $${price.toFixed(2)} < min $${policy.priceMin}`);
  }
  
  if (policy.priceMax && price > policy.priceMax) {
    reasons.push(`Price $${price.toFixed(2)} > max $${policy.priceMax}`);
  }
  
  if (policy.avoidFirstMinutes && policy.avoidFirstMinutes > 0) {
    const etTimeStr = now.toLocaleString("en-US", { 
      timeZone: "America/New_York",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit"
    });
    const [hourStr, minStr] = etTimeStr.split(":");
    const hour = parseInt(hourStr);
    const minute = parseInt(minStr);
    const marketOpenHour = 9;
    const marketOpenMinute = 30;
    
    const minutesSinceOpen = (hour - marketOpenHour) * 60 + (minute - marketOpenMinute);
    
    if (minutesSinceOpen >= 0 && minutesSinceOpen < policy.avoidFirstMinutes) {
      reasons.push(`Within first ${policy.avoidFirstMinutes} minutes of market open`);
    }
  }
  
  return {
    pass: reasons.length === 0,
    reasons,
    metrics,
  };
}

export function rankOpportunities(
  opportunities: Array<{ opportunity: Opportunity; eligibility: EligibilityResult }>
): Array<{ opportunity: Opportunity; eligibility: EligibilityResult; score: number }> {
  return opportunities
    .filter(o => o.eligibility.pass)
    .map(o => {
      const { metrics } = o.eligibility;
      const score = 
        (metrics.confidence || 0) * 0.3 +
        (metrics.rewardRisk || 0) * 20 +
        (metrics.rvol || 0) * 10 +
        (metrics.upsidePct || 0) * 2;
      return { ...o, score };
    })
    .sort((a, b) => b.score - a.score);
}

export interface AuthorizationResult {
  allowed: boolean;
  reasons: string[];
}

export async function authorizeOrder(
  userId: string,
  policy: AgentPolicy,
  symbol: string
): Promise<AuthorizationResult> {
  const reasons: string[] = [];
  
  const agentState = await storage.getAgentState(userId);
  
  if (agentState?.emergencyStop) {
    reasons.push("Emergency stop is active");
    return { allowed: false, reasons };
  }
  
  if (agentState?.paused) {
    reasons.push("Agent is paused");
    return { allowed: false, reasons };
  }
  
  if (!agentState?.enabled) {
    reasons.push("Agent is not enabled");
    return { allowed: false, reasons };
  }
  
  const today = new Date().toISOString().split("T")[0];
  let tradesToday = agentState.tradesTodayCount || 0;
  
  if (agentState.lastTradeDate !== today) {
    tradesToday = 0;
  }
  
  if (policy.maxTradesPerDay && tradesToday >= policy.maxTradesPerDay) {
    reasons.push(`Max trades/day (${policy.maxTradesPerDay}) reached`);
    return { allowed: false, reasons };
  }
  
  const openPositions = await storage.getOpenTradesCount(userId);
  if (policy.maxConcurrentPositions && openPositions >= policy.maxConcurrentPositions) {
    reasons.push(`Max concurrent positions (${policy.maxConcurrentPositions}) reached`);
    return { allowed: false, reasons };
  }
  
  const existingPosition = await storage.hasOpenTradeForSymbol(userId, symbol);
  if (existingPosition) {
    reasons.push(`Already have open position in ${symbol}`);
    return { allowed: false, reasons };
  }
  
  if (policy.maxDailyLossUsd && agentState.dailyPnlEstimate) {
    if (agentState.dailyPnlEstimate <= -policy.maxDailyLossUsd) {
      reasons.push(`Max daily loss ($${policy.maxDailyLossUsd}) reached`);
      return { allowed: false, reasons };
    }
  }
  
  if (policy.cooldownMinutes && policy.cooldownMinutes > 0) {
    const recentDecision = await storage.getRecentDecisionForSymbol(
      userId,
      symbol,
      policy.cooldownMinutes
    );
    if (recentDecision) {
      reasons.push(`Cooldown active - traded ${symbol} within ${policy.cooldownMinutes} minutes`);
      return { allowed: false, reasons };
    }
  }
  
  return { allowed: true, reasons: [] };
}

export async function recordDecision(
  decision: InsertAgentDecision
): Promise<AgentDecision> {
  return storage.createAgentDecision(decision);
}

export async function incrementTradesToday(userId: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  await storage.incrementAgentTradesToday(userId, today);
}

export async function getOrCreateAgentState(userId: string): Promise<AgentState> {
  let state = await storage.getAgentState(userId);
  if (!state) {
    state = await storage.createAgentState(userId);
  }
  return state;
}

export async function getOrCreatePolicy(userId: string): Promise<AgentPolicy> {
  let policy = await storage.getAgentPolicy(userId);
  if (!policy) {
    policy = await storage.createAgentPolicy({ userId });
  }
  return policy;
}
