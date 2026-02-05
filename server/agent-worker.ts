import { storage } from "./storage";
import {
  isEligible,
  rankOpportunities,
  authorizeOrder,
  recordDecision,
  incrementTradesToday,
  getOrCreateAgentState,
  getOrCreatePolicy,
} from "./agent-service";
import {
  AgentAction,
  AgentMode,
  InsertAgentDecision,
  Opportunity,
} from "@shared/schema";

let agentWorkerInterval: NodeJS.Timeout | null = null;
const WORKER_INTERVAL_MS = 60 * 1000; // Check every 1 minute for users whose scan interval has elapsed

function isMarketHours(): boolean {
  const now = new Date();
  const etTimeStr = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  
  const [dayStr, timeStr] = etTimeStr.split(" ");
  const day = dayStr.replace(",", "");
  
  if (day === "Sat" || day === "Sun") {
    return false;
  }
  
  const [hourStr, minStr] = timeStr.split(":");
  const hour = parseInt(hourStr);
  const minute = parseInt(minStr);
  const timeInMinutes = hour * 60 + minute;
  
  const marketOpenMinutes = 9 * 60 + 30; // 9:30 AM
  const marketCloseMinutes = 16 * 60; // 4:00 PM
  
  return timeInMinutes >= marketOpenMinutes && timeInMinutes < marketCloseMinutes;
}

async function processUserOpportunities(userId: string): Promise<void> {
  // Always update lastRunAt at start to respect scan interval, even on early returns
  await storage.updateAgentState(userId, { lastRunAt: new Date() });
  
  const agentState = await getOrCreateAgentState(userId);
  
  if (!agentState.enabled) {
    return; // Agent disabled - already updated lastRunAt
  }
  
  if (agentState.paused) {
    return; // Agent paused - already updated lastRunAt
  }
  
  if (agentState.emergencyStop) {
    return; // Emergency stop - already updated lastRunAt
  }
  
  const policy = await getOrCreatePolicy(userId);
  
  if (!policy.enabled) {
    return; // Policy disabled - already updated lastRunAt
  }
  
  const opportunities = await storage.getOpportunities(userId, { status: "ACTIVE" });
  
  if (opportunities.length === 0) {
    return; // No opportunities - already updated lastRunAt
  }
  
  const evaluated = opportunities.map(opportunity => ({
    opportunity,
    eligibility: isEligible(opportunity, policy),
  }));
  
  const ineligible = evaluated.filter(e => !e.eligibility.pass);
  for (const item of ineligible) {
    const decision: InsertAgentDecision = {
      userId,
      policyId: policy.id,
      opportunityId: item.opportunity.id,
      symbol: item.opportunity.symbol,
      action: AgentAction.SKIP,
      reasons: item.eligibility.reasons,
      metricsSnapshot: item.eligibility.metrics,
    };
    await recordDecision(decision);
  }
  
  const ranked = rankOpportunities(evaluated);
  
  console.log(`[AgentWorker] User ${userId}: ${ineligible.length} skipped, ${ranked.length} eligible`);
  
  for (const item of ranked) {
    const authorization = await authorizeOrder(userId, policy, item.opportunity.symbol);
    
    if (!authorization.allowed) {
      const decision: InsertAgentDecision = {
        userId,
        policyId: policy.id,
        opportunityId: item.opportunity.id,
        symbol: item.opportunity.symbol,
        action: AgentAction.SKIP,
        reasons: authorization.reasons,
        metricsSnapshot: item.eligibility.metrics,
      };
      await recordDecision(decision);
      continue;
    }
    
    if (policy.mode === AgentMode.SUGGEST) {
      const decision: InsertAgentDecision = {
        userId,
        policyId: policy.id,
        opportunityId: item.opportunity.id,
        symbol: item.opportunity.symbol,
        action: AgentAction.SUGGEST,
        reasons: ["Opportunity passed all policy criteria"],
        metricsSnapshot: item.eligibility.metrics,
      };
      await recordDecision(decision);
      console.log(`[AgentWorker] SUGGEST: ${item.opportunity.symbol} for user ${userId}`);
    } else if (policy.mode === AgentMode.AUTO) {
      try {
        const orderPayload = buildOrderPayload(item.opportunity, policy);
        
        const decision: InsertAgentDecision = {
          userId,
          policyId: policy.id,
          opportunityId: item.opportunity.id,
          symbol: item.opportunity.symbol,
          action: AgentAction.EXECUTE,
          reasons: ["Auto-executed by agent"],
          metricsSnapshot: item.eligibility.metrics,
          orderPayload,
        };
        await recordDecision(decision);
        await incrementTradesToday(userId);
        
        console.log(`[AgentWorker] EXECUTE: ${item.opportunity.symbol} for user ${userId}`);
      } catch (error: any) {
        const decision: InsertAgentDecision = {
          userId,
          policyId: policy.id,
          opportunityId: item.opportunity.id,
          symbol: item.opportunity.symbol,
          action: AgentAction.ERROR,
          reasons: [`Execution failed: ${error.message}`],
          metricsSnapshot: item.eligibility.metrics,
        };
        await recordDecision(decision);
        console.error(`[AgentWorker] ERROR: ${item.opportunity.symbol} - ${error.message}`);
      }
    }
  }
}

function buildOrderPayload(opportunity: Opportunity, policy: any): object {
  const price = opportunity.lastPrice || opportunity.detectedPrice || 0;
  const stop = opportunity.stopReferencePrice || 0;
  const target = opportunity.resistancePrice || 0;
  
  const riskPerShare = price - stop;
  let quantity = 0;
  
  if (riskPerShare > 0 && policy.riskPerTradeUsd) {
    quantity = Math.floor(policy.riskPerTradeUsd / riskPerShare);
  }
  
  return {
    symbol: opportunity.symbol,
    action: "BUY",
    orderType: "LIMIT",
    limitPrice: price,
    quantity,
    stopLoss: stop,
    target,
    strategyId: opportunity.strategyId,
    opportunityId: opportunity.id,
  };
}

async function runAgentWorker(): Promise<void> {
  if (!isMarketHours()) {
    return; // Silent skip outside market hours
  }
  
  try {
    const enabledUsers = await getEnabledAgentUsers();
    const usersToProcess = enabledUsers.filter(shouldRunForUser);
    
    if (usersToProcess.length === 0) {
      return; // No users ready for scan
    }
    
    console.log(`[AgentWorker] Processing ${usersToProcess.length} users`);
    
    for (const user of usersToProcess) {
      try {
        await processUserOpportunities(user.userId);
      } catch (error: any) {
        console.error(`[AgentWorker] Error processing user ${user.userId}:`, error.message);
      }
    }
  } catch (error: any) {
    console.error("[AgentWorker] Worker error:", error.message);
  }
}

interface EnabledAgentUser {
  userId: string;
  scanIntervalMinutes: number;
  lastRunAt: Date | null;
}

async function getEnabledAgentUsers(): Promise<EnabledAgentUser[]> {
  const { db } = await import("./db");
  const { agentState, agentPolicies } = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");
  
  const states = await db
    .select({
      userId: agentState.userId,
      lastRunAt: agentState.lastRunAt,
    })
    .from(agentState)
    .where(
      and(
        eq(agentState.enabled, true),
        eq(agentState.paused, false),
        eq(agentState.emergencyStop, false)
      )
    );
  
  const results: EnabledAgentUser[] = [];
  
  for (const state of states) {
    const policy = await db
      .select({ scanIntervalMinutes: agentPolicies.scanIntervalMinutes })
      .from(agentPolicies)
      .where(eq(agentPolicies.userId, state.userId))
      .limit(1);
    
    const scanInterval = policy.length > 0 && policy[0].scanIntervalMinutes
      ? policy[0].scanIntervalMinutes
      : 5; // default 5 minutes
    
    results.push({
      userId: state.userId,
      scanIntervalMinutes: scanInterval,
      lastRunAt: state.lastRunAt,
    });
  }
  
  return results;
}

function shouldRunForUser(user: EnabledAgentUser): boolean {
  if (!user.lastRunAt) {
    return true; // Never run before
  }
  
  const now = new Date();
  const lastRun = new Date(user.lastRunAt);
  const elapsedMinutes = (now.getTime() - lastRun.getTime()) / (60 * 1000);
  
  return elapsedMinutes >= user.scanIntervalMinutes;
}

export function startAgentWorker(): void {
  if (agentWorkerInterval) {
    console.log("[AgentWorker] Worker already running");
    return;
  }
  
  console.log("[AgentWorker] Starting agent worker");
  
  agentWorkerInterval = setInterval(runAgentWorker, WORKER_INTERVAL_MS);
  
  setTimeout(runAgentWorker, 10000);
}

export function stopAgentWorker(): void {
  if (agentWorkerInterval) {
    clearInterval(agentWorkerInterval);
    agentWorkerInterval = null;
    console.log("[AgentWorker] Worker stopped");
  }
}

export { runAgentWorker, processUserOpportunities };
