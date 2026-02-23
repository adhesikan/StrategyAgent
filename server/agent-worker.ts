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
  AgentPolicy,
} from "@shared/schema";
import {
  runOptionsScan,
  type OptionCandidate,
  type ScanPreferences,
} from "./engines/options-scanner/index";
import { placeBrokerOrder } from "./broker/index";
import type { OrderRequest } from "./broker/types";
import { fetchQuotesFromBroker } from "./broker-service";
import { resolvePositionSize, getTraderTypeConfig } from "./position-sizing";

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
    return;
  }
  
  if (agentState.paused) {
    return;
  }
  
  if (agentState.emergencyStop) {
    return;
  }
  
  const policy = await getOrCreatePolicy(userId);
  
  if (!policy.enabled) {
    return;
  }

  const userSettings = await storage.getUserSettings(userId);
  const traderConfig = getTraderTypeConfig(userSettings?.traderType);

  if (!traderConfig.allowEquities) {
    console.log(`[AgentWorker] Skipping equity opportunities for ${traderConfig.label} (user ${userId})`);
    return;
  }

  const safetyLimits = userSettings?.safetyLimits as any;

  const systemProfile = await storage.getLatestSystemProfile(userId);
  const effectivePolicy = { ...policy };

  if (safetyLimits?.maxTradesPerDay) {
    const wizardMaxTrades = safetyLimits.maxTradesPerDay;
    if (!effectivePolicy.maxTradesPerDay || wizardMaxTrades < effectivePolicy.maxTradesPerDay) {
      effectivePolicy.maxTradesPerDay = wizardMaxTrades;
    }
  }
  if (safetyLimits?.maxDailyLossUsd) {
    const wizardMaxLoss = safetyLimits.maxDailyLossUsd;
    if (!effectivePolicy.maxDailyLossUsd || wizardMaxLoss < effectivePolicy.maxDailyLossUsd) {
      effectivePolicy.maxDailyLossUsd = wizardMaxLoss;
    }
  }
  if (safetyLimits?.riskPerTradeUsd) {
    const wizardRisk = safetyLimits.riskPerTradeUsd;
    if (!effectivePolicy.riskPerTradeUsd || wizardRisk < effectivePolicy.riskPerTradeUsd) {
      effectivePolicy.riskPerTradeUsd = wizardRisk;
    }
  }
  if (safetyLimits?.maxPositions) {
    const wizardMaxPos = safetyLimits.maxPositions;
    if (!effectivePolicy.maxConcurrentPositions || wizardMaxPos < effectivePolicy.maxConcurrentPositions) {
      effectivePolicy.maxConcurrentPositions = wizardMaxPos;
    }
  }

  if (systemProfile?.minConfidenceThreshold) {
    const profileThreshold = systemProfile.minConfidenceThreshold;
    if (!effectivePolicy.minConfidencePct || profileThreshold > effectivePolicy.minConfidencePct) {
      effectivePolicy.minConfidencePct = profileThreshold;
    }
  }
  if (systemProfile?.maxTradesPerDay) {
    if (!effectivePolicy.maxTradesPerDay || systemProfile.maxTradesPerDay < effectivePolicy.maxTradesPerDay) {
      effectivePolicy.maxTradesPerDay = systemProfile.maxTradesPerDay;
    }
  }

  const automationMode = userSettings?.automationMode || "ALERTS";
  if (automationMode === "ALERTS" && effectivePolicy.mode === AgentMode.AUTO) {
    effectivePolicy.mode = AgentMode.SUGGEST;
    console.log(`[AgentWorker] User ${userId}: automationMode=ALERTS overrides policy to SUGGEST`);
  }

  console.log(`[AgentWorker] User ${userId}: effectiveMode=${effectivePolicy.mode}, policyMode=${policy.mode}, automationMode=${automationMode}, traderType=${traderConfig.label}`);
  
  let opportunities = await storage.getOpportunities(userId, { status: "ACTIVE" });
  
  if (opportunities.length === 0) {
    const scanResults = await storage.getScanResults();
    if (scanResults.length > 0) {
      const { ingestOpportunitiesFromScan } = await import("./opportunity-service");
      const byStrategy = new Map<string, typeof scanResults>();
      for (const r of scanResults) {
        const strat = (r as any).strategy || "VCP";
        if (!byStrategy.has(strat)) byStrategy.set(strat, []);
        byStrategy.get(strat)!.push(r);
      }
      let totalIngested = 0;
      for (const [strat, results] of Array.from(byStrategy.entries())) {
        totalIngested += await ingestOpportunitiesFromScan(userId, results, strat, "1d");
      }
      if (totalIngested > 0) {
        console.log(`[AgentWorker] Auto-ingested ${totalIngested} opportunities from scan results for user ${userId}`);
        opportunities = await storage.getOpportunities(userId, { status: "ACTIVE" });
      }
    }
  }

  if (opportunities.length === 0) {
    return;
  }
  
  const evaluated = opportunities.map(opportunity => ({
    opportunity,
    eligibility: isEligible(opportunity, effectivePolicy),
  }));
  
  const ineligible = evaluated.filter(e => !e.eligibility.pass);
  if (ineligible.length > 0) {
    console.log(`[AgentWorker] Skipped ${ineligible.length} ineligible: ${ineligible.map(i => i.opportunity.symbol).join(", ")}`);
    for (const item of ineligible) {
      try {
        await storage.createSkippedTrade({
          userId,
          symbol: item.opportunity.symbol,
          skipReason: item.eligibility.reasons.join("; "),
          source: "eligibility",
          price: item.opportunity.detectedPrice || item.opportunity.lastPrice || null,
          strategyId: item.opportunity.strategyId || null,
        });
      } catch (e) {}
    }
  }
  
  const ranked = rankOpportunities(evaluated);
  
  console.log(`[AgentWorker] User ${userId}: ${ineligible.length} skipped, ${ranked.length} eligible`);
  
  for (const item of ranked) {
    const authorization = await authorizeOrder(userId, effectivePolicy, item.opportunity.symbol);
    
    if (!authorization.allowed) {
      console.log(`[AgentWorker] Skipped ${item.opportunity.symbol}: ${authorization.reasons.join(", ")}`);
      try {
        await storage.createSkippedTrade({
          userId,
          symbol: item.opportunity.symbol,
          skipReason: authorization.reasons.join("; "),
          source: "authorization",
          price: item.opportunity.detectedPrice || item.opportunity.lastPrice || null,
          strategyId: item.opportunity.strategyId || null,
        });
      } catch (e) {}
      continue;
    }
    
    if (effectivePolicy.mode === AgentMode.SUGGEST) {
      const reasons = ["Opportunity passed all policy criteria"];

      let optionsCandidate: OptionCandidate | null = null;
      if (effectivePolicy.optionsEnabled) {
        optionsCandidate = await evaluateOptionsForOpportunity(userId, effectivePolicy, item.opportunity);
        if (optionsCandidate) {
          reasons.push(`Options match: ${optionsCandidate.optionType.toUpperCase()} $${optionsCandidate.strike} exp ${optionsCandidate.expiration} (delta ${optionsCandidate.delta.toFixed(2)}, score ${optionsCandidate.score})`);
        }
      }

      const decision: InsertAgentDecision = {
        userId,
        policyId: policy.id,
        opportunityId: item.opportunity.id,
        symbol: item.opportunity.symbol,
        action: AgentAction.SUGGEST,
        reasons,
        metricsSnapshot: item.eligibility.metrics,
        orderPayload: optionsCandidate ? await buildOptionsOrderPayload(item.opportunity, effectivePolicy, optionsCandidate, userId) : undefined,
      };
      await recordDecision(decision);
      console.log(`[AgentWorker] SUGGEST: ${item.opportunity.symbol}${optionsCandidate ? ` (options: ${optionsCandidate.optionType} $${optionsCandidate.strike})` : ""} for user ${userId}`);
    } else if (effectivePolicy.mode === AgentMode.AUTO) {
      try {
        let orderPayload: object;
        let optionsCandidate: OptionCandidate | null = null;

        if (effectivePolicy.optionsEnabled) {
          optionsCandidate = await evaluateOptionsForOpportunity(userId, effectivePolicy, item.opportunity);
        }

        if (optionsCandidate) {
          orderPayload = await buildOptionsOrderPayload(item.opportunity, effectivePolicy, optionsCandidate, userId);
        } else {
          orderPayload = await buildOrderPayload(item.opportunity, effectivePolicy, userId);
        }

        const connection = await storage.getBrokerConnection(userId);
        if (!connection || !connection.isConnected || !connection.preferredAccountId) {
          throw new Error("No connected broker account found for order execution");
        }

        const brokerOrder = toBrokerOrderRequest(orderPayload as any, connection.preferredAccountId);
        const orderResult = await placeBrokerOrder(userId, brokerOrder);

        if (!isOrderSuccessful(orderResult.status)) {
          throw new Error(`Broker rejected order: ${orderResult.status} (orderId: ${orderResult.orderId})`);
        }

        const decision: InsertAgentDecision = {
          userId,
          policyId: policy.id,
          opportunityId: item.opportunity.id,
          symbol: item.opportunity.symbol,
          action: AgentAction.EXECUTE,
          reasons: optionsCandidate 
            ? [`Auto-executed options: ${optionsCandidate.optionType.toUpperCase()} $${optionsCandidate.strike} exp ${optionsCandidate.expiration}`, `Broker order ${orderResult.orderId} ${orderResult.status}`]
            : [`Auto-executed by agent`, `Broker order ${orderResult.orderId} ${orderResult.status}`],
          metricsSnapshot: item.eligibility.metrics,
          orderPayload: { ...orderPayload, brokerOrderId: orderResult.orderId, brokerStatus: orderResult.status },
          brokerOrderId: orderResult.orderId,
        };
        await recordDecision(decision);
        await incrementTradesToday(userId);
        
        console.log(`[AgentWorker] EXECUTE: ${item.opportunity.symbol}${optionsCandidate ? ` (options: ${optionsCandidate.optionType} $${optionsCandidate.strike})` : ""} -> order ${orderResult.orderId} for user ${userId}`);
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

function mapPolicyToStrategyKey(strategy: string | null): string {
  switch (strategy) {
    case "long_calls":
    case "long_puts":
      return "long-options";
    case "covered_calls":
    case "cash_secured_puts":
      return "wheel";
    case "credit_spreads":
      return "credit-spreads";
    default:
      return "long-options";
  }
}

async function evaluateOptionsForOpportunity(
  userId: string,
  policy: AgentPolicy,
  opportunity: Opportunity,
): Promise<OptionCandidate | null> {
  if (!policy.optionsEnabled) return null;

  const brokerConnection = await storage.getBrokerConnectionWithToken(userId);
  if (!brokerConnection?.accessToken) {
    console.log(`[AgentWorker] No broker token for options evaluation, user ${userId}`);
    return null;
  }

  const scanPrefs: ScanPreferences = {
    dteMin: policy.optionsDteMin ?? 14,
    dteMax: policy.optionsDteMax ?? 45,
    deltaMin: policy.optionsDeltaMin ?? 0.30,
    deltaMax: policy.optionsDeltaMax ?? 0.70,
    minPremiumPct: 0.5,
  };

  const strategyKey = mapPolicyToStrategyKey(policy.optionsStrategy);

  try {
    const optionsProvider = (brokerConnection.provider === "tradestation" ? "tradestation" : "tradier") as import("./engines/options-scanner/index").OptionsProvider;
    const result = await runOptionsScan(
      {
        universeId: "agent",
        strategyKey,
        symbols: [opportunity.symbol],
        scanPreferences: scanPrefs,
        provider: optionsProvider,
      },
      brokerConnection.accessToken,
    );

    if (result.candidates.length === 0) return null;

    const optionType = policy.optionType ?? "calls";
    let filtered = result.candidates;

    if (optionType !== "both") {
      const filterType = optionType === "calls" ? "call" : "put";
      filtered = filtered.filter((c) => c.optionType === filterType);
    }

    if (policy.optionsMinOpenInterest) {
      filtered = filtered.filter((c) => c.openInterest >= (policy.optionsMinOpenInterest ?? 0));
    }
    if (policy.optionsMinVolume) {
      filtered = filtered.filter((c) => c.volume >= (policy.optionsMinVolume ?? 0));
    }
    if (policy.optionsPremiumMin != null) {
      filtered = filtered.filter((c) => c.mid >= (policy.optionsPremiumMin ?? 0));
    }
    if (policy.optionsPremiumMax != null) {
      filtered = filtered.filter((c) => c.mid <= (policy.optionsPremiumMax ?? Infinity));
    }
    if (policy.optionsMaxRiskUsd != null) {
      filtered = filtered.filter((c) => Math.abs(c.maxLoss) <= (policy.optionsMaxRiskUsd ?? Infinity));
    }

    if (filtered.length === 0) return null;

    filtered.sort((a, b) => b.score - a.score);
    return filtered[0];
  } catch (error: any) {
    console.error(`[AgentWorker] Options evaluation error for ${opportunity.symbol}: ${error.message}`);
    return null;
  }
}

async function buildOptionsOrderPayload(
  opportunity: Opportunity,
  policy: AgentPolicy,
  candidate: OptionCandidate,
  userId: string,
): Promise<object> {
  const maxRisk = policy.optionsMaxRiskUsd ?? 500;
  const contractCost = candidate.mid * 100;
  const quantity = contractCost > 0 ? Math.max(1, Math.floor(maxRisk / contractCost)) : 1;

  const settings = await storage.getAgentSettings(userId);
  let optionsStopPrice: number | undefined;
  let optionsTargetPrice: number | undefined;

  if (settings?.optionsBracketEnabled && candidate.mid > 0) {
    const stopMethod = settings.optionsBracketStopMethod || "pct";
    const stopValue = settings.optionsBracketStopValue ?? 50;
    const targetMethod = settings.optionsBracketTargetMethod || "pct";
    const targetValue = settings.optionsBracketTargetValue ?? 100;

    if (stopMethod === "pct" && stopValue > 0) {
      optionsStopPrice = +(candidate.mid * (1 - stopValue / 100)).toFixed(2);
    } else if (stopMethod === "dollar" && stopValue > 0) {
      optionsStopPrice = +(candidate.mid - stopValue).toFixed(2);
    }

    if (targetMethod === "pct" && targetValue > 0) {
      optionsTargetPrice = +(candidate.mid * (1 + targetValue / 100)).toFixed(2);
    } else if (targetMethod === "dollar" && targetValue > 0) {
      optionsTargetPrice = +(candidate.mid + targetValue).toFixed(2);
    }

    if (optionsStopPrice !== undefined && optionsStopPrice <= 0) optionsStopPrice = undefined;
    if (optionsTargetPrice !== undefined && optionsTargetPrice <= 0) optionsTargetPrice = undefined;
  }

  return {
    symbol: candidate.symbol,
    underlying: candidate.underlying,
    action: candidate.legs[0]?.side === "sell" ? "SELL_TO_OPEN" : "BUY_TO_OPEN",
    orderType: "LIMIT",
    limitPrice: candidate.mid,
    quantity,
    optionType: candidate.optionType,
    strike: candidate.strike,
    expiration: candidate.expiration,
    strategy: candidate.strategy,
    delta: candidate.delta,
    dte: candidate.dte,
    maxLoss: candidate.maxLoss,
    maxProfit: candidate.maxProfit,
    breakeven: candidate.breakeven,
    legs: candidate.legs,
    opportunityId: opportunity.id,
    isOptionsOrder: true,
    optionsStopPrice,
    optionsTargetPrice,
  };
}

function filterCandidateByPolicy(candidate: OptionCandidate, policy: AgentPolicy): boolean {
  const optionType = policy.optionType ?? "calls";
  if (optionType !== "both") {
    const filterType = optionType === "calls" ? "call" : "put";
    if (candidate.optionType !== filterType) return false;
  }

  const delta = Math.abs(candidate.delta);
  if (policy.optionsDeltaMin != null && delta < policy.optionsDeltaMin) return false;
  if (policy.optionsDeltaMax != null && delta > policy.optionsDeltaMax) return false;

  if (policy.optionsDteMin != null && candidate.dte < policy.optionsDteMin) return false;
  if (policy.optionsDteMax != null && candidate.dte > policy.optionsDteMax) return false;

  if (policy.optionsMinOpenInterest != null && candidate.openInterest < policy.optionsMinOpenInterest) return false;
  if (policy.optionsMinVolume != null && candidate.volume < policy.optionsMinVolume) return false;

  if (policy.optionsPremiumMin != null && candidate.mid < policy.optionsPremiumMin) return false;
  if (policy.optionsPremiumMax != null && candidate.mid > policy.optionsPremiumMax) return false;

  if (policy.optionsMaxRiskUsd != null && Math.abs(candidate.maxLoss) > policy.optionsMaxRiskUsd) return false;

  return true;
}

function buildOptionsScanOrderPayload(candidate: OptionCandidate, policy: AgentPolicy): object {
  const maxRisk = policy.optionsMaxRiskUsd ?? 500;
  const contractCost = candidate.mid * 100;
  const quantity = contractCost > 0 ? Math.max(1, Math.floor(maxRisk / contractCost)) : 1;

  return {
    symbol: candidate.symbol,
    underlying: candidate.underlying,
    action: candidate.legs[0]?.side === "sell" ? "SELL_TO_OPEN" : "BUY_TO_OPEN",
    orderType: "LIMIT",
    limitPrice: candidate.mid,
    quantity,
    optionType: candidate.optionType,
    strike: candidate.strike,
    expiration: candidate.expiration,
    strategy: candidate.strategy,
    delta: candidate.delta,
    dte: candidate.dte,
    maxLoss: candidate.maxLoss,
    maxProfit: candidate.maxProfit,
    breakeven: candidate.breakeven,
    legs: candidate.legs,
    score: candidate.score,
    rationale: candidate.rationale,
    isOptionsOrder: true,
    source: "options_scan",
  };
}

async function processOptionsScanResults(userId: string): Promise<void> {
  const policy = await getOrCreatePolicy(userId);
  const userSettings = await storage.getUserSettings(userId);
  const traderConfig = getTraderTypeConfig(userSettings?.traderType);

  if (!traderConfig.allowOptions && !policy.optionsEnabled) return;

  const latestScan = await storage.getLatestOptionsScan(userId);
  if (!latestScan) return;

  const scanAge = Date.now() - new Date(latestScan.createdAt).getTime();
  const MAX_SCAN_AGE_MS = 60 * 60 * 1000; // 1 hour
  if (scanAge > MAX_SCAN_AGE_MS) {
    return;
  }

  const result = latestScan.resultJson as any;
  if (!result?.candidates || !Array.isArray(result.candidates) || result.candidates.length === 0) {
    return;
  }

  const candidates: OptionCandidate[] = result.candidates;
  const filtered = candidates.filter((c) => filterCandidateByPolicy(c, policy));

  if (filtered.length === 0) {
    console.log(`[AgentWorker] Options scan: ${candidates.length} candidates, 0 passed policy filters for user ${userId}`);
    return;
  }

  filtered.sort((a, b) => b.score - a.score);
  const topCandidates = filtered.slice(0, policy.maxTradesPerDay ?? 2);

  console.log(`[AgentWorker] Options scan: ${candidates.length} candidates, ${filtered.length} passed filters, processing top ${topCandidates.length} for user ${userId}`);

  for (const candidate of topCandidates) {
    const authorization = await authorizeOrder(userId, policy, candidate.underlying);
    if (!authorization.allowed) {
      console.log(`[AgentWorker] Skipped options ${candidate.underlying} ${candidate.optionType.toUpperCase()} $${candidate.strike}: ${authorization.reasons.join(", ")}`);
      try {
        await storage.createSkippedTrade({
          userId,
          symbol: candidate.underlying,
          skipReason: `Options ${candidate.optionType.toUpperCase()} $${candidate.strike}: ${authorization.reasons.join("; ")}`,
          source: "options_authorization",
          price: candidate.mid,
          strategyId: candidate.strategy || null,
        });
      } catch (e) {}
      continue;
    }

    if (policy.mode === AgentMode.SUGGEST) {
      const decision: InsertAgentDecision = {
        userId,
        policyId: policy.id,
        symbol: candidate.underlying,
        action: AgentAction.SUGGEST,
        reasons: [
          `Options scan match: ${candidate.optionType.toUpperCase()} $${candidate.strike} exp ${candidate.expiration}`,
          `Score: ${candidate.score}, Delta: ${candidate.delta.toFixed(2)}, DTE: ${candidate.dte}`,
          candidate.rationale,
        ],
        orderPayload: buildOptionsScanOrderPayload(candidate, policy),
      };
      await recordDecision(decision);
      console.log(`[AgentWorker] SUGGEST options: ${candidate.underlying} ${candidate.optionType.toUpperCase()} $${candidate.strike} for user ${userId}`);
    } else if (policy.mode === AgentMode.AUTO) {
      try {
        const orderPayload = buildOptionsScanOrderPayload(candidate, policy);

        const connection = await storage.getBrokerConnection(userId);
        if (!connection || !connection.isConnected || !connection.preferredAccountId) {
          throw new Error("No connected broker account found for options order execution");
        }

        const brokerOrder = toBrokerOrderRequest(orderPayload, connection.preferredAccountId);
        const orderResult = await placeBrokerOrder(userId, brokerOrder);

        if (!isOrderSuccessful(orderResult.status)) {
          throw new Error(`Broker rejected options order: ${orderResult.status} (orderId: ${orderResult.orderId})`);
        }

        const decision: InsertAgentDecision = {
          userId,
          policyId: policy.id,
          symbol: candidate.underlying,
          action: AgentAction.EXECUTE,
          reasons: [
            `Auto-executed options from scan: ${candidate.optionType.toUpperCase()} $${candidate.strike} exp ${candidate.expiration}`,
            `Score: ${candidate.score}, Delta: ${candidate.delta.toFixed(2)}, DTE: ${candidate.dte}`,
            `Broker order ${orderResult.orderId} ${orderResult.status}`,
          ],
          orderPayload: { ...orderPayload, brokerOrderId: orderResult.orderId, brokerStatus: orderResult.status },
          brokerOrderId: orderResult.orderId,
        };
        await recordDecision(decision);
        await incrementTradesToday(userId);
        console.log(`[AgentWorker] EXECUTE options: ${candidate.underlying} ${candidate.optionType.toUpperCase()} $${candidate.strike} -> order ${orderResult.orderId} for user ${userId}`);
      } catch (error: any) {
        const decision: InsertAgentDecision = {
          userId,
          policyId: policy.id,
          symbol: candidate.underlying,
          action: AgentAction.ERROR,
          reasons: [`Options execution failed: ${error.message}`],
        };
        await recordDecision(decision);
        console.error(`[AgentWorker] ERROR options: ${candidate.underlying} - ${error.message}`);
      }
    }
  }
}

async function processExternalAlerts(userId: string): Promise<void> {
  const pendingAlerts = await storage.getPendingExternalAlerts(userId);
  if (pendingAlerts.length === 0) return;

  const policy = await getOrCreatePolicy(userId);
  const settings = await storage.getAgentSettings(userId);

  const isEnabled = settings?.enabled || policy.enabled;
  if (!isEnabled) return;

  const userSettings = await storage.getUserSettings(userId);
  const traderConfig = getTraderTypeConfig(userSettings?.traderType);

  if (!traderConfig.allowEquities) {
    console.log(`[AgentWorker] Skipping external equity alerts for ${traderConfig.label} (user ${userId})`);
    for (const alert of pendingAlerts) {
      await storage.updateExternalAlert(alert.id, {
        status: "SKIPPED",
        skipReason: `Trader type "${traderConfig.label}" does not trade equities`,
      });
    }
    return;
  }

  let effectiveMode = settings?.mode ? settings.mode.toUpperCase() : policy.mode;
  const automationMode = userSettings?.automationMode || "ALERTS";
  if (automationMode === "ALERTS" && effectiveMode === AgentMode.AUTO) {
    effectiveMode = AgentMode.SUGGEST;
  }

  console.log(`[AgentWorker] Processing ${pendingAlerts.length} external alerts for user ${userId} (mode: ${effectiveMode})`);

  for (const alert of pendingAlerts) {
    try {
      await storage.updateExternalAlert(alert.id, { status: "EVALUATING" });

      if (alert.alertType === "exit") {
        await storage.updateExternalAlert(alert.id, {
          status: "SKIPPED",
          skipReason: `Exit signal: ${alert.exitReason || "position closed"}`,
        });
        continue;
      }

      if (alert.direction === "Short") {
        const reason = "Short trades not supported by current policy";
        await storage.updateExternalAlert(alert.id, { status: "SKIPPED", skipReason: reason });
        try { await storage.createSkippedTrade({ userId, symbol: alert.symbol, skipReason: reason, source: "external_alert", price: alert.entryPrice, strategyId: null }); } catch (e) {}
        continue;
      }

      if (!alert.riskPrice || !alert.targetPrice) {
        const reason = "Missing risk or target price levels for entry evaluation";
        await storage.updateExternalAlert(alert.id, { status: "SKIPPED", skipReason: reason });
        try { await storage.createSkippedTrade({ userId, symbol: alert.symbol, skipReason: reason, source: "external_alert", price: alert.entryPrice, strategyId: null }); } catch (e) {}
        continue;
      }

      let effectiveEntry = alert.entryPrice;
      let effectiveTarget = alert.targetPrice;
      if (effectiveEntry >= effectiveTarget && alert.direction !== "Short") {
        try {
          const connWithToken = await storage.getBrokerConnectionWithToken(userId);
          if (connWithToken) {
            const quotes = await fetchQuotesFromBroker(connWithToken, [alert.symbol]);
            const quote = quotes[0];
            if (quote && quote.last > 0 && quote.last < effectiveEntry) {
              console.log(`[AgentWorker] Correcting entry for ${alert.symbol}: webhook sent entry=$${effectiveEntry}, using live quote=$${quote.last}, target=$${effectiveTarget}`);
              effectiveTarget = effectiveEntry;
              effectiveEntry = quote.last;
            } else if (effectiveEntry === effectiveTarget) {
              console.log(`[AgentWorker] Entry equals target for ${alert.symbol} ($${effectiveEntry}), cannot determine correct entry`);
            }
          }
        } catch (err: any) {
          console.log(`[AgentWorker] Could not fetch live quote for ${alert.symbol} to correct entry: ${err?.message}`);
        }
      }

      if (policy.priceMin != null && effectiveEntry < policy.priceMin) {
        const reason = `Entry price $${effectiveEntry.toFixed(2)} below minimum $${policy.priceMin}`;
        await storage.updateExternalAlert(alert.id, { status: "SKIPPED", skipReason: reason });
        try { await storage.createSkippedTrade({ userId, symbol: alert.symbol, skipReason: reason, source: "external_alert", price: effectiveEntry, strategyId: null }); } catch (e) {}
        continue;
      }
      if (policy.priceMax != null && effectiveEntry > policy.priceMax) {
        const reason = `Entry price $${effectiveEntry.toFixed(2)} above maximum $${policy.priceMax}`;
        await storage.updateExternalAlert(alert.id, { status: "SKIPPED", skipReason: reason });
        try { await storage.createSkippedTrade({ userId, symbol: alert.symbol, skipReason: reason, source: "external_alert", price: effectiveEntry, strategyId: null }); } catch (e) {}
        continue;
      }

      const riskPerShare = effectiveEntry - alert.riskPrice;
      if (riskPerShare <= 0) {
        const reason = "Invalid risk level: risk price must be below entry price";
        await storage.updateExternalAlert(alert.id, { status: "SKIPPED", skipReason: reason });
        try { await storage.createSkippedTrade({ userId, symbol: alert.symbol, skipReason: reason, source: "external_alert", price: effectiveEntry, strategyId: null }); } catch (e) {}
        continue;
      }

      const rewardPerShare = effectiveTarget - effectiveEntry;
      const rewardRisk = rewardPerShare / riskPerShare;
      if (policy.minRewardRisk != null && rewardRisk < policy.minRewardRisk) {
        const reason = `R:R ratio ${rewardRisk.toFixed(1)}:1 below minimum ${policy.minRewardRisk}:1`;
        await storage.updateExternalAlert(alert.id, { status: "SKIPPED", skipReason: reason });
        try { await storage.createSkippedTrade({ userId, symbol: alert.symbol, skipReason: reason, source: "external_alert", price: effectiveEntry, strategyId: null }); } catch (e) {}
        continue;
      }

      const authorization = await authorizeOrder(userId, policy, alert.symbol);
      if (!authorization.allowed) {
        const reason = authorization.reasons.join("; ");
        await storage.updateExternalAlert(alert.id, { status: "SKIPPED", skipReason: reason });
        try { await storage.createSkippedTrade({ userId, symbol: alert.symbol, skipReason: reason, source: "external_alert", price: effectiveEntry, strategyId: null }); } catch (e) {}
        console.log(`[AgentWorker] Skipped external alert ${alert.symbol}: ${authorization.reasons.join(", ")}`);
        continue;
      }

      const sizing = await resolvePositionSize(userId, effectiveEntry, riskPerShare > 0 ? riskPerShare : undefined);
      let quantity = sizing.quantity;

      if (settings?.sizingMethod === "fixedQty" && settings.fixedQuantity) {
        quantity = settings.fixedQuantity;
      } else if (settings?.sizingMethod === "fixedNotional" && settings.fixedNotionalUsd) {
        quantity = Math.floor(settings.fixedNotionalUsd / effectiveEntry);
      }
      if (quantity <= 0) quantity = 1;

      const rawOrderType = settings?.entryOrderType?.toUpperCase() || "LIMIT";
      const effectiveOrderType = ["MARKET", "LIMIT"].includes(rawOrderType) ? rawOrderType : "LIMIT";
      const bracket = computeBracket(settings, effectiveEntry, alert.riskPrice, effectiveTarget);

      const orderPayload = {
        symbol: alert.symbol,
        action: "BUY",
        orderType: effectiveOrderType,
        limitPrice: effectiveEntry,
        quantity,
        stopLoss: bracket.stopLoss,
        target: bracket.target,
        source: "external_alert",
        externalAlertId: alert.id,
        strategyName: alert.strategyName,
      };

      if (effectiveMode === AgentMode.SUGGEST) {
        const decision: InsertAgentDecision = {
          userId,
          policyId: policy.id,
          symbol: alert.symbol,
          action: AgentAction.SUGGEST,
          reasons: [
            `External alert from ${alert.source}: ${alert.strategyName}`,
            `Entry: $${effectiveEntry.toFixed(2)}, Risk: $${alert.riskPrice}, Target: $${effectiveTarget.toFixed(2)}`,
            `R:R ${rewardRisk.toFixed(1)}:1, Qty: ${quantity} shares`,
          ],
          orderPayload,
        };
        const savedDecision = await recordDecision(decision);
        await storage.updateExternalAlert(alert.id, {
          status: "PENDING",
          agentDecisionId: savedDecision.id,
        });
        console.log(`[AgentWorker] SUGGEST external alert: ${alert.symbol} from ${alert.strategyName} for user ${userId}`);
      } else if (effectiveMode === AgentMode.AUTO) {
        try {
          const connection = await storage.getBrokerConnection(userId);
          if (!connection || !connection.isConnected || !connection.preferredAccountId) {
            throw new Error("No connected broker account found for order execution");
          }

          const brokerOrder = toBrokerOrderRequest(orderPayload, connection.preferredAccountId);
          const orderResult = await placeBrokerOrder(userId, brokerOrder);

          if (!isOrderSuccessful(orderResult.status)) {
            throw new Error(`Broker rejected order: ${orderResult.status} (orderId: ${orderResult.orderId})`);
          }

          const decision: InsertAgentDecision = {
            userId,
            policyId: policy.id,
            symbol: alert.symbol,
            action: AgentAction.EXECUTE,
            reasons: [
              `Auto-executed external alert from ${alert.source}: ${alert.strategyName}`,
              `Entry: $${effectiveEntry.toFixed(2)}, Risk: $${alert.riskPrice}, Target: $${effectiveTarget.toFixed(2)}`,
              `Broker order ${orderResult.orderId} ${orderResult.status}`,
            ],
            orderPayload: { ...orderPayload, brokerOrderId: orderResult.orderId, brokerStatus: orderResult.status },
            brokerOrderId: orderResult.orderId,
          };
          const savedDecision = await recordDecision(decision);
          await incrementTradesToday(userId);
          await storage.updateExternalAlert(alert.id, {
            status: "EXECUTED",
            agentDecisionId: savedDecision.id,
            brokerOrderId: orderResult.orderId,
            executedPrice: alert.entryPrice,
            executedAt: new Date(),
          });
          console.log(`[AgentWorker] EXECUTE external alert: ${alert.symbol} from ${alert.strategyName} -> order ${orderResult.orderId} for user ${userId}`);
        } catch (error: any) {
          const decision: InsertAgentDecision = {
            userId,
            policyId: policy.id,
            symbol: alert.symbol,
            action: AgentAction.ERROR,
            reasons: [`External alert execution failed: ${error.message}`, `Source: ${alert.source} - ${alert.strategyName}`],
          };
          await recordDecision(decision);
          await storage.updateExternalAlert(alert.id, {
            status: "ERROR",
            skipReason: error.message,
          });
          console.error(`[AgentWorker] ERROR external alert: ${alert.symbol} - ${error.message}`);
        }
      }
    } catch (error: any) {
      await storage.updateExternalAlert(alert.id, {
        status: "ERROR",
        skipReason: `Processing error: ${error.message}`,
      });
      console.error(`[AgentWorker] Error processing external alert ${alert.id}: ${error.message}`);
    }
  }
}

interface BracketResult {
  stopLoss: number | undefined;
  target: number | undefined;
}

function computeBracket(
  settings: any,
  entryPrice: number,
  signalStop: number | undefined | null,
  signalTarget: number | undefined | null,
  side: "buy" | "sell" = "buy"
): BracketResult {
  const bracketEnabled = settings?.bracketEnabled ?? true;
  if (!bracketEnabled) {
    return { stopLoss: undefined, target: undefined };
  }

  const stopMethod = settings?.bracketStopMethod || "signal";
  const stopValue = settings?.bracketStopValue;
  const targetMethod = settings?.bracketTargetMethod || "signal";
  const targetValue = settings?.bracketTargetValue;

  const safeSignalStop = (signalStop != null && signalStop > 0) ? signalStop : undefined;
  const safeSignalTarget = (signalTarget != null && signalTarget > 0) ? signalTarget : undefined;

  let stopLoss: number | undefined = safeSignalStop;
  let target: number | undefined = safeSignalTarget;

  if (stopMethod === "pct" && stopValue && stopValue > 0 && entryPrice > 0) {
    stopLoss = side === "buy"
      ? +(entryPrice * (1 - stopValue / 100)).toFixed(2)
      : +(entryPrice * (1 + stopValue / 100)).toFixed(2);
  } else if (stopMethod === "dollar" && stopValue && stopValue > 0 && entryPrice > 0) {
    stopLoss = side === "buy"
      ? +(entryPrice - stopValue).toFixed(2)
      : +(entryPrice + stopValue).toFixed(2);
  }

  if (targetMethod === "pct" && targetValue && targetValue > 0 && entryPrice > 0) {
    target = side === "buy"
      ? +(entryPrice * (1 + targetValue / 100)).toFixed(2)
      : +(entryPrice * (1 - targetValue / 100)).toFixed(2);
  } else if (targetMethod === "dollar" && targetValue && targetValue > 0 && entryPrice > 0) {
    target = side === "buy"
      ? +(entryPrice + targetValue).toFixed(2)
      : +(entryPrice - targetValue).toFixed(2);
  } else if (targetMethod === "rr" && targetValue && targetValue > 0 && stopLoss && entryPrice > 0) {
    const risk = Math.abs(entryPrice - stopLoss);
    if (risk > 0) {
      target = side === "buy"
        ? +(entryPrice + risk * targetValue).toFixed(2)
        : +(entryPrice - risk * targetValue).toFixed(2);
    }
  }

  if (stopLoss !== undefined && stopLoss <= 0) stopLoss = undefined;
  if (target !== undefined && target <= 0) target = undefined;

  return { stopLoss, target };
}

async function buildOrderPayload(opportunity: Opportunity, policy: any, userId: string): Promise<object> {
  const price = opportunity.lastPrice || opportunity.detectedPrice || 0;
  const signalStop = opportunity.stopReferencePrice || undefined;
  const signalTarget = opportunity.resistancePrice || undefined;
  const riskPerShare = price - (signalStop || 0);

  const settings = await storage.getAgentSettings(userId);

  const sizing = await resolvePositionSize(userId, price, riskPerShare > 0 ? riskPerShare : undefined);
  let quantity = sizing.quantity;

  if (settings?.sizingMethod === "fixedQty" && settings.fixedQuantity) {
    quantity = settings.fixedQuantity;
  } else if (settings?.sizingMethod === "fixedNotional" && settings.fixedNotionalUsd && price > 0) {
    quantity = Math.floor(settings.fixedNotionalUsd / price);
  }

  if (quantity <= 0) quantity = 1;

  const effectiveOrderType = settings?.entryOrderType?.toUpperCase() || "LIMIT";
  const validOrderType = ["MARKET", "LIMIT"].includes(effectiveOrderType) ? effectiveOrderType : "LIMIT";

  const bracket = computeBracket(settings, price, signalStop || undefined, signalTarget || undefined);

  return {
    symbol: opportunity.symbol,
    action: "BUY",
    orderType: validOrderType,
    limitPrice: price,
    quantity,
    stopLoss: bracket.stopLoss,
    target: bracket.target,
    strategyId: opportunity.strategyId,
    opportunityId: opportunity.id,
    sizingMethod: sizing.method,
    sizingDetails: sizing.details,
  };
}

function mapOrderType(raw: string | undefined): OrderRequest["orderType"] {
  switch (raw?.toUpperCase()) {
    case "LIMIT": return "limit";
    case "STOP": return "stop";
    case "STOP_LIMIT": return "stop_limit";
    default: return "market";
  }
}

function mapOptionSide(action: string | undefined): OrderRequest["optionSide"] {
  switch (action?.toUpperCase()) {
    case "SELL_TO_OPEN": return "sell_to_open";
    case "SELL_TO_CLOSE": return "sell_to_close";
    case "BUY_TO_CLOSE": return "buy_to_close";
    default: return "buy_to_open";
  }
}

function toBrokerOrderRequest(payload: any, accountId: string): OrderRequest {
  const orderType = mapOrderType(payload.orderType);

  if (payload.isOptionsOrder) {
    const optionSide = mapOptionSide(payload.action);
    const side: "buy" | "sell" = optionSide.startsWith("sell") ? "sell" : "buy";
    return {
      accountId,
      symbol: payload.underlying || payload.symbol,
      side,
      quantity: payload.quantity || 1,
      orderType,
      price: orderType === "limit" || orderType === "stop_limit" ? payload.limitPrice : undefined,
      stopPrice: orderType === "stop" || orderType === "stop_limit" ? payload.stopPrice : undefined,
      duration: "day",
      orderClass: "option",
      optionSymbol: payload.symbol,
      optionSide,
    };
  }

  const side: "buy" | "sell" = payload.action?.toUpperCase() === "SELL" ? "sell" : "buy";
  const resolvedStopPrice = payload.stopPrice || payload.stopLoss;
  const bracketTarget = typeof payload.target === "number" && payload.target > 0 ? payload.target : undefined;
  const bracketStop = typeof payload.stopLoss === "number" && payload.stopLoss > 0 ? payload.stopLoss : undefined;
  const hasBracket = bracketTarget != null && bracketStop != null;
  return {
    accountId,
    symbol: payload.symbol,
    side,
    quantity: payload.quantity || 1,
    orderType,
    price: orderType === "limit" || orderType === "stop_limit" ? payload.limitPrice : undefined,
    stopPrice: orderType === "stop" || orderType === "stop_limit" ? resolvedStopPrice : undefined,
    duration: "day",
    orderClass: hasBracket ? "otoco" : "equity",
    bracketTarget,
    bracketStop,
  };
}

function isOrderSuccessful(status: string): boolean {
  const failed = ["rejected", "canceled", "cancelled", "expired", "error"];
  return !failed.includes(status.toLowerCase());
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
        await processOptionsScanResults(user.userId);
        await processExternalAlerts(user.userId);
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
  const { agentState, agentPolicies, agentSettings } = await import("@shared/schema");
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
  
  const userIdSet = new Set(states.map(s => s.userId));
  const results: EnabledAgentUser[] = [];
  
  for (const state of states) {
    const policy = await db
      .select({ scanIntervalMinutes: agentPolicies.scanIntervalMinutes })
      .from(agentPolicies)
      .where(eq(agentPolicies.userId, state.userId))
      .limit(1);
    
    const scanInterval = policy.length > 0 && policy[0].scanIntervalMinutes
      ? policy[0].scanIntervalMinutes
      : 5;
    
    results.push({
      userId: state.userId,
      scanIntervalMinutes: scanInterval,
      lastRunAt: state.lastRunAt,
    });
  }

  const settingsUsers = await db
    .select({ userId: agentSettings.userId })
    .from(agentSettings)
    .where(eq(agentSettings.enabled, true));

  for (const su of settingsUsers) {
    if (!userIdSet.has(su.userId)) {
      const existingState = await db
        .select({ paused: agentState.paused, emergencyStop: agentState.emergencyStop, lastRunAt: agentState.lastRunAt })
        .from(agentState)
        .where(eq(agentState.userId, su.userId))
        .limit(1);

      if (existingState.length > 0 && (existingState[0].paused || existingState[0].emergencyStop)) {
        continue;
      }

      const policy = await db
        .select({ scanIntervalMinutes: agentPolicies.scanIntervalMinutes })
        .from(agentPolicies)
        .where(eq(agentPolicies.userId, su.userId))
        .limit(1);

      results.push({
        userId: su.userId,
        scanIntervalMinutes: policy.length > 0 && policy[0].scanIntervalMinutes ? policy[0].scanIntervalMinutes : 5,
        lastRunAt: existingState.length > 0 ? existingState[0].lastRunAt : null,
      });
      userIdSet.add(su.userId);
    }
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

  setInterval(async () => {
    try {
      const cleaned = await storage.cleanupOldSkippedTrades();
      if (cleaned > 0) {
        console.log(`[AgentWorker] Cleaned up ${cleaned} expired skipped trade records`);
      }
    } catch (e) {}
  }, 60 * 60 * 1000);
}

export function stopAgentWorker(): void {
  if (agentWorkerInterval) {
    clearInterval(agentWorkerInterval);
    agentWorkerInterval = null;
    console.log("[AgentWorker] Worker stopped");
  }
}

export { runAgentWorker, processUserOpportunities, processExternalAlerts };
