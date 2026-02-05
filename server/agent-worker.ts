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
const WORKER_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

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
  console.log(`[AgentWorker] Processing opportunities for user ${userId}`);
  
  const agentState = await getOrCreateAgentState(userId);
  
  if (!agentState.enabled) {
    console.log(`[AgentWorker] Agent disabled for user ${userId}`);
    return;
  }
  
  if (agentState.paused) {
    console.log(`[AgentWorker] Agent paused for user ${userId}`);
    return;
  }
  
  if (agentState.emergencyStop) {
    console.log(`[AgentWorker] Emergency stop active for user ${userId}`);
    return;
  }
  
  const policy = await getOrCreatePolicy(userId);
  
  if (!policy.enabled) {
    console.log(`[AgentWorker] Policy disabled for user ${userId}`);
    return;
  }
  
  const opportunities = await storage.getOpportunities(userId, { status: "ACTIVE" });
  
  if (opportunities.length === 0) {
    console.log(`[AgentWorker] No active opportunities for user ${userId}`);
    return;
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
  
  await storage.updateAgentState(userId, { lastRunAt: new Date() });
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
    console.log("[AgentWorker] Outside market hours, skipping");
    return;
  }
  
  console.log("[AgentWorker] Running agent worker cycle");
  
  try {
    const enabledStates = await getEnabledAgentUsers();
    
    for (const state of enabledStates) {
      try {
        await processUserOpportunities(state.userId);
      } catch (error: any) {
        console.error(`[AgentWorker] Error processing user ${state.userId}:`, error.message);
      }
    }
  } catch (error: any) {
    console.error("[AgentWorker] Worker error:", error.message);
  }
}

async function getEnabledAgentUsers(): Promise<{ userId: string }[]> {
  const { db } = await import("./db");
  const { agentState } = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");
  
  const results = await db
    .select({ userId: agentState.userId })
    .from(agentState)
    .where(
      and(
        eq(agentState.enabled, true),
        eq(agentState.paused, false),
        eq(agentState.emergencyStop, false)
      )
    );
  
  return results;
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
