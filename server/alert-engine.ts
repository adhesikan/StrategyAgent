import { storage } from "./storage";
import { fetchQuotesFromBroker, type QuoteData } from "./broker-service";
import type { AlertRule, AlertEvent, InsertAlertEvent, BrokerConnection, PatternStageType } from "@shared/schema";
import { PatternStage, RuleConditionType } from "@shared/schema";
import { sendEntrySignalToProfile, createAutomationLogEntry, type EntrySignal } from "./algopilotx";
import { resolveAutomationProfileForSignal, createAutomationEvent, type AutomationSignalContext } from "./automation-resolver";
import { ALERT_DISCLAIMER, getStrategyDisplayName } from "@shared/strategies";

/**
 * Get current time in Eastern Time as minutes since midnight
 */
/** Fire-and-forget trade alert email mirroring the push notification. */
function emailAlertEvent(userId: string, event: AlertEvent): void {
  (async () => {
    const user = await storage.getUser(userId);
    if (!user?.email) return;
    const data = (event.payload || {}) as Record<string, any>;
    const symbol = event.symbol || data.ticker || "Trade Alert";
    const title = `${symbol} — ${event.toState || data.targetStage || "signal"}`;
    const summary = data.message || `An alert rule triggered for ${symbol}.`;
    const { sendTradeAlertEmail } = await import("./services/email/email-service");
    await sendTradeAlertEmail(user.email, title, `${summary}\n\n${ALERT_DISCLAIMER}`, userId);
  })().catch((err) => console.log(`[AlertEngine] Alert email error: ${err?.message || err}`));
}

function getEasternTimeMinutes(): number {
  const now = new Date();
  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  
  const etParts = etFormatter.formatToParts(now);
  const hour = parseInt(etParts.find(p => p.type === 'hour')?.value || '0');
  const minute = parseInt(etParts.find(p => p.type === 'minute')?.value || '0');
  
  return hour * 60 + minute;
}

/**
 * Check if current time is within US market hours (9:30 AM - 4:00 PM ET)
 * Webhooks/automation should only execute during market hours
 */
export function isWithinMarketHours(): boolean {
  const timeInMinutes = getEasternTimeMinutes();
  const marketOpen = 9 * 60 + 30;  // 9:30 AM = 570 minutes
  const marketClose = 16 * 60;     // 4:00 PM = 960 minutes
  
  return timeInMinutes >= marketOpen && timeInMinutes < marketClose;
}

/**
 * Check if current time is within extended trading hours
 * Pre-market: 4:00 AM - 9:30 AM ET
 * After-hours: 4:00 PM - 8:00 PM ET
 */
export function isWithinExtendedHours(): boolean {
  const timeInMinutes = getEasternTimeMinutes();
  
  const preMarketOpen = 4 * 60;    // 4:00 AM = 240 minutes
  const marketOpen = 9 * 60 + 30;  // 9:30 AM = 570 minutes
  const marketClose = 16 * 60;     // 4:00 PM = 960 minutes
  const afterHoursClose = 20 * 60; // 8:00 PM = 1200 minutes
  
  const isPreMarket = timeInMinutes >= preMarketOpen && timeInMinutes < marketOpen;
  const isAfterHours = timeInMinutes >= marketClose && timeInMinutes < afterHoursClose;
  
  return isPreMarket || isAfterHours;
}

/**
 * Check if current time is within any trading hours (regular + extended)
 * Covers 4:00 AM - 8:00 PM ET for price tracking
 */
export function isWithinAnyTradingHours(): boolean {
  const timeInMinutes = getEasternTimeMinutes();
  const tradingStart = 4 * 60;     // 4:00 AM = 240 minutes
  const tradingEnd = 20 * 60;      // 8:00 PM = 1200 minutes
  
  return timeInMinutes >= tradingStart && timeInMinutes < tradingEnd;
}

export interface VCPClassification {
  stage: PatternStageType;
  priceFromHigh: number;
  volumeRatio: number;
  changePercent: number;
  resistance: number;
  stopLoss: number;
}

export function classifyVCPStage(quote: QuoteData): VCPClassification {
  const priceFromHigh = ((quote.high - quote.last) / quote.high) * 100;
  const volumeRatio = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
  
  let stage: PatternStageType;
  
  if (quote.change > 0 && quote.changePercent > 2 && volumeRatio > 1.5) {
    stage = PatternStage.BREAKOUT;
  } else if (priceFromHigh < 5 && quote.change > 0) {
    stage = PatternStage.READY;
  } else {
    stage = PatternStage.FORMING;
  }
  
  return {
    stage,
    priceFromHigh,
    volumeRatio,
    changePercent: quote.changePercent,
    resistance: (quote.high && quote.high > 0 ? quote.high : quote.last) * 1.02,
    stopLoss: quote.last * 0.93,
  };
}

export function generateEventKey(ruleId: string, toState: string, date: Date): string {
  const dateStr = date.toISOString().split("T")[0];
  return `${ruleId}:${toState}:${dateStr}`;
}

export function generateAlertMessage(
  symbol: string, 
  fromState: string | null, 
  toState: string,
  price: number
): string {
  const transition = fromState 
    ? `${symbol} transitioned from ${fromState} to ${toState}`
    : `${symbol} entered ${toState} stage`;
  
  return `${transition} at $${price.toFixed(2)}. ${ALERT_DISCLAIMER}`;
}

interface EvaluationResult {
  rule: AlertRule;
  triggered: boolean;
  fromState: string | null;
  toState: string;
  price: number;
  quote: QuoteData;
  classification: VCPClassification;
}

export async function evaluateRule(
  rule: AlertRule,
  quote: QuoteData
): Promise<EvaluationResult | null> {
  const classification = classifyVCPStage(quote);
  const currentState = classification.stage;
  
  const lastState = rule.lastState as { stage?: string } | null;
  const previousStage = lastState?.stage || null;
  
  let triggered = false;
  
  switch (rule.conditionType) {
    case RuleConditionType.STAGE_ENTERED: {
      const payload = rule.conditionPayload as { 
        targetStage: string;
        minPatternScore?: number;
        minResistancePercent?: number;
        maxResistancePercent?: number;
      } | null;
      const targetStage = payload?.targetStage || PatternStage.BREAKOUT;
      
      if (currentState === targetStage && previousStage !== targetStage) {
        // Check optional filter conditions
        // Note: patternScore comes from scan results, not live quotes
        // For now, resistance percent is calculated from priceFromHigh
        const resistancePercent = classification.priceFromHigh;
        
        // Check minResistancePercent filter (for stocks with more upside potential)
        if (payload?.minResistancePercent !== undefined && payload.minResistancePercent !== null) {
          if (resistancePercent < payload.minResistancePercent) {
            break; // Stock is too close to resistance, skip
          }
        }
        
        // Check maxResistancePercent filter (for stocks near breakout)
        if (payload?.maxResistancePercent !== undefined && payload.maxResistancePercent !== null) {
          if (resistancePercent > payload.maxResistancePercent) {
            break; // Stock is too far from resistance, skip
          }
        }
        
        triggered = true;
      }
      break;
    }
    
    case RuleConditionType.PRICE_ABOVE: {
      const payload = rule.conditionPayload as { threshold: number } | null;
      const threshold = payload?.threshold;
      const lastPrice = lastState as { price?: number } | null;
      
      if (threshold && quote.last > threshold) {
        if (!lastPrice?.price || lastPrice.price <= threshold) {
          triggered = true;
        }
      }
      break;
    }
    
    case RuleConditionType.PRICE_BELOW: {
      const payload = rule.conditionPayload as { threshold: number } | null;
      const threshold = payload?.threshold;
      const lastPrice = lastState as { price?: number } | null;
      
      if (threshold && quote.last < threshold) {
        if (!lastPrice?.price || lastPrice.price >= threshold) {
          triggered = true;
        }
      }
      break;
    }
    
    case RuleConditionType.VOLUME_SPIKE: {
      const payload = rule.conditionPayload as { multiplier?: number } | null;
      const multiplier = payload?.multiplier || 2.0;
      
      if (classification.volumeRatio >= multiplier) {
        const lastRatio = (lastState as { volumeRatio?: number } | null)?.volumeRatio;
        if (!lastRatio || lastRatio < multiplier) {
          triggered = true;
        }
      }
      break;
    }
  }
  
  if (triggered) {
    return {
      rule,
      triggered: true,
      fromState: previousStage,
      toState: currentState,
      price: quote.last,
      quote,
      classification,
    };
  }
  
  return null;
}

async function sendWebhookToEndpoint(
  endpointId: string,
  symbol: string,
  price: number,
  targetPrice: number,
  stopLoss: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const endpoint = await storage.getAutomationEndpointWithSecret(endpointId);
    if (!endpoint || !endpoint.webhookUrl) {
      return { success: false, error: "Endpoint not found" };
    }
    
    // AlgoPilotX stop-limit format for breakout entries
    // stop = trigger price (resistance/breakout level)
    // lp = limit price (slightly above stop to ensure fill after breakout)
    const stopPrice = price;
    const limitPrice = stopPrice * 1.005; // 0.5% above stop for slippage buffer
    const webhookMessage = `enter sym=${symbol} type=STOP_LIMIT stop=${stopPrice.toFixed(2)} lp=${limitPrice.toFixed(2)} sl=${stopLoss.toFixed(2)} tp=${targetPrice.toFixed(2)}`;
    
    const response = await fetch(endpoint.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: webhookMessage,
    });
    
    if (response.ok) {
      console.log(`[AlertEngine] Webhook sent to ${endpoint.name}: ${webhookMessage}`);
      return { success: true };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function processAlertRules(
  connection: BrokerConnection | null
): Promise<AlertEvent[]> {
  const enabledRules = await storage.getEnabledAlertRules();
  
  if (enabledRules.length === 0) {
    return [];
  }
  
  // Separate global rules from watchlist rules and symbol-specific rules
  const globalRules = enabledRules.filter(r => r.isGlobal);
  const watchlistRules = enabledRules.filter(r => !r.isGlobal && r.watchlistId && !r.symbol);
  const symbolRules = enabledRules.filter(r => !r.isGlobal && r.symbol && !r.watchlistId);
  
  const createdEvents: AlertEvent[] = [];
  const now = new Date();
  
  // Process global rules against scan results
  if (globalRules.length > 0) {
    const scanResults = await storage.getScanResults();
    console.log(`[AlertEngine] Processing ${globalRules.length} global rule(s) against ${scanResults.length} scan results`);
    
    for (const rule of globalRules) {
      try {
        const payload = rule.conditionPayload as { 
          targetStage?: string;
          minPatternScore?: number;
          minResistancePercent?: number;
          maxResistancePercent?: number;
        } | null;
        const targetStage = payload?.targetStage || PatternStage.BREAKOUT;
        
        // Get previously triggered symbols for this rule
        const previouslyTriggered = new Set(rule.triggeredSymbols || []);
        const newlyTriggered: string[] = [];
        
        console.log(`[AlertEngine] Rule ${rule.id}: Looking for stage=${targetStage}, previouslyTriggered=${Array.from(previouslyTriggered).join(',') || 'none'}`);
        
        // Find scan results that match the target stage and optional filters
        const matchingResults = scanResults.filter(result => {
          // Stage check
          if (result.stage !== targetStage) return false;
          
          // Already triggered check
          if (previouslyTriggered.has(result.ticker)) return false;
          
          // Min pattern score filter
          if (payload?.minPatternScore !== undefined && payload.minPatternScore !== null) {
            if ((result.patternScore ?? 0) < payload.minPatternScore) return false;
          }
          
          // Calculate % to resistance for this scan result
          const resistancePercent = result.resistance && result.price 
            ? ((result.resistance - result.price) / result.price) * 100 
            : null;
          
          // Min % to resistance filter (for stocks with more upside potential)
          if (payload?.minResistancePercent !== undefined && payload.minResistancePercent !== null) {
            if (resistancePercent === null || resistancePercent < payload.minResistancePercent) return false;
          }
          
          // Max % to resistance filter (for stocks near breakout)
          if (payload?.maxResistancePercent !== undefined && payload.maxResistancePercent !== null) {
            if (resistancePercent === null || resistancePercent > payload.maxResistancePercent) return false;
          }
          
          return true;
        });
        
        console.log(`[AlertEngine] Rule ${rule.id}: Found ${matchingResults.length} matching results`);
        
        for (const result of matchingResults) {
          const eventKey = generateEventKey(rule.id, `${result.ticker}:${targetStage}`, now);
          
          const existingEvent = await storage.getAlertEventByKey(eventKey);
          if (existingEvent) {
            continue;
          }
          
          const eventData: InsertAlertEvent = {
            ruleId: rule.id,
            userId: rule.userId,
            symbol: result.ticker,
            eventKey,
            fromState: null,
            toState: targetStage,
            price: result.price,
            payload: {
              resistance: result.resistance,
              stopLoss: result.stopLoss,
              volumeRatio: result.rvol,
              changePercent: result.changePercent,
              patternScore: result.patternScore,
              message: generateAlertMessage(result.ticker, null, targetStage, result.price),
            },
            deliveryStatus: { push: false, webhook: false },
            isRead: false,
          };
          
          const event = await storage.createAlertEvent(eventData);
          createdEvents.push(event);
          newlyTriggered.push(result.ticker);
          
          // Track delivery status
          const deliveryStatus: { push?: boolean; pushSentAt?: string; webhook?: boolean; webhookSentAt?: string; endpointName?: string } = { push: false, webhook: false };
          
          // Send push notification if enabled
          if (rule.sendPushNotification !== false) {
            try {
              const { sendAlertPushNotification } = await import("./push-service");
              await sendAlertPushNotification(event);
              deliveryStatus.push = true;
              deliveryStatus.pushSentAt = new Date().toISOString();
              console.log(`[AlertEngine] Push sent for global alert: ${result.ticker} ${targetStage}`);
            } catch (pushError) {
              console.log(`[AlertEngine] Push notification error: ${pushError}`);
            }
            emailAlertEvent(rule.userId, event);
          }
          
          // Send webhook if enabled and endpoint configured (only during market hours)
          if (rule.sendWebhook && rule.automationEndpointId) {
            if (isWithinMarketHours()) {
              // For webhook: entry at current price, target based on risk (entry - stop)
              const entryPrice = result.price;
              const stopLoss = result.stopLoss || entryPrice * 0.93;
              const riskAmount = entryPrice - stopLoss;
              const targetPrice = entryPrice + (riskAmount * 2); // 2R target
              
              // Get endpoint name for display
              const endpoint = await storage.getAutomationEndpoint(rule.automationEndpointId);
              
              const webhookResult = await sendWebhookToEndpoint(
                rule.automationEndpointId,
                result.ticker,
                entryPrice,
                targetPrice,
                stopLoss
              );
              
              if (webhookResult.success) {
                deliveryStatus.webhook = true;
                deliveryStatus.webhookSentAt = new Date().toISOString();
                deliveryStatus.endpointName = endpoint?.name || "AlgoPilotX";
                console.log(`[AlertEngine] Webhook sent for ${result.ticker}`);
              } else {
                console.error(`[AlertEngine] Webhook failed for ${result.ticker}: ${webhookResult.error}`);
              }
            } else {
              console.log(`[AlertEngine] Webhook skipped for ${result.ticker} (outside market hours 9:30 AM - 4:00 PM ET)`);
            }
          }
          
          // Update event with delivery status
          await storage.updateAlertEvent(event.id, { deliveryStatus });
          
          console.log(`[AlertEngine] Global alert triggered: ${result.ticker} entered ${targetStage}`);
        }
        
        // Update rule with newly triggered symbols
        if (newlyTriggered.length > 0) {
          await storage.updateAlertRule(rule.id, {
            lastEvaluatedAt: now,
            triggeredSymbols: [...Array.from(previouslyTriggered), ...newlyTriggered],
          });
        }
      } catch (error) {
        console.error(`[AlertEngine] Error processing global rule ${rule.id}:`, error);
      }
    }
  }
  
  // Process watchlist rules against scan results (filter by watchlist symbols)
  if (watchlistRules.length > 0) {
    const scanResults = await storage.getScanResults();
    console.log(`[AlertEngine] Processing ${watchlistRules.length} watchlist rule(s) against ${scanResults.length} scan results`);
    
    for (const rule of watchlistRules) {
      try {
        if (!rule.watchlistId) continue;
        
        // Get the watchlist to get its symbols
        const watchlist = await storage.getWatchlist(rule.watchlistId, rule.userId);
        if (!watchlist || !watchlist.symbols || watchlist.symbols.length === 0) {
          console.log(`[AlertEngine] Watchlist ${rule.watchlistId} not found or empty`);
          continue;
        }
        
        const watchlistSymbols = new Set(watchlist.symbols.map(s => s.toUpperCase()));
        
        const payload = rule.conditionPayload as { 
          targetStage?: string;
          minPatternScore?: number;
          minResistancePercent?: number;
          maxResistancePercent?: number;
        } | null;
        const targetStage = payload?.targetStage || PatternStage.BREAKOUT;
        
        const previouslyTriggered = new Set(rule.triggeredSymbols || []);
        const newlyTriggered: string[] = [];
        
        console.log(`[AlertEngine] Watchlist rule ${rule.id}: Looking for stage=${targetStage} in watchlist ${watchlist.name} (${watchlist.symbols.length} symbols)`);
        
        // Find scan results that are in the watchlist and match the target stage
        const matchingResults = scanResults.filter(result => {
          // Must be in watchlist
          if (!watchlistSymbols.has(result.ticker.toUpperCase())) return false;
          
          // Stage check
          if (result.stage !== targetStage) return false;
          
          // Already triggered check
          if (previouslyTriggered.has(result.ticker)) return false;
          
          // Min pattern score filter
          if (payload?.minPatternScore !== undefined && payload.minPatternScore !== null) {
            if ((result.patternScore ?? 0) < payload.minPatternScore) return false;
          }
          
          // Calculate % to resistance for this scan result
          const resistancePercent = result.resistance && result.price 
            ? ((result.resistance - result.price) / result.price) * 100 
            : null;
          
          // Min % to resistance filter
          if (payload?.minResistancePercent !== undefined && payload.minResistancePercent !== null) {
            if (resistancePercent === null || resistancePercent < payload.minResistancePercent) return false;
          }
          
          // Max % to resistance filter
          if (payload?.maxResistancePercent !== undefined && payload.maxResistancePercent !== null) {
            if (resistancePercent === null || resistancePercent > payload.maxResistancePercent) return false;
          }
          
          return true;
        });
        
        console.log(`[AlertEngine] Watchlist rule ${rule.id}: Found ${matchingResults.length} matching results`);
        
        for (const result of matchingResults) {
          const eventKey = generateEventKey(rule.id, `${result.ticker}:${targetStage}`, now);
          
          const existingEvent = await storage.getAlertEventByKey(eventKey);
          if (existingEvent) {
            continue;
          }
          
          const eventData: InsertAlertEvent = {
            ruleId: rule.id,
            userId: rule.userId,
            symbol: result.ticker,
            eventKey,
            fromState: null,
            toState: targetStage,
            price: result.price,
            payload: {
              resistance: result.resistance,
              stopLoss: result.stopLoss,
              volumeRatio: result.rvol,
              changePercent: result.changePercent,
              patternScore: result.patternScore,
              watchlistName: watchlist.name,
              message: generateAlertMessage(result.ticker, null, targetStage, result.price),
            },
            deliveryStatus: { push: false, webhook: false },
            isRead: false,
          };
          
          const event = await storage.createAlertEvent(eventData);
          createdEvents.push(event);
          newlyTriggered.push(result.ticker);
          
          const deliveryStatus: { push?: boolean; pushSentAt?: string; webhook?: boolean; webhookSentAt?: string; endpointName?: string } = { push: false, webhook: false };
          
          // Send push notification if enabled
          if (rule.sendPushNotification !== false) {
            try {
              const { sendAlertPushNotification } = await import("./push-service");
              await sendAlertPushNotification(event);
              deliveryStatus.push = true;
              deliveryStatus.pushSentAt = new Date().toISOString();
            } catch (pushError) {
              console.log(`[AlertEngine] Push notification error: ${pushError}`);
            }
            emailAlertEvent(rule.userId, event);
          }
          
          // Send webhook if enabled and endpoint configured (only during market hours)
          if (rule.sendWebhook && rule.automationEndpointId) {
            if (isWithinMarketHours()) {
              const entryPrice = result.price;
              const stopLoss = result.stopLoss || entryPrice * 0.93;
              const riskAmount = entryPrice - stopLoss;
              const targetPrice = entryPrice + (riskAmount * 2);
              
              const endpoint = await storage.getAutomationEndpoint(rule.automationEndpointId);
              
              const webhookResult = await sendWebhookToEndpoint(
                rule.automationEndpointId,
                result.ticker,
                entryPrice,
                targetPrice,
                stopLoss
              );
              
              if (webhookResult.success) {
                deliveryStatus.webhook = true;
                deliveryStatus.webhookSentAt = new Date().toISOString();
                deliveryStatus.endpointName = endpoint?.name || "AlgoPilotX";
                console.log(`[AlertEngine] Webhook sent for ${result.ticker} (watchlist: ${watchlist.name})`);
              } else {
                console.error(`[AlertEngine] Webhook failed for ${result.ticker}: ${webhookResult.error}`);
              }
            } else {
              console.log(`[AlertEngine] Webhook skipped for ${result.ticker} (outside market hours 9:30 AM - 4:00 PM ET)`);
            }
          }
          
          await storage.updateAlertEvent(event.id, { deliveryStatus });
          
          console.log(`[AlertEngine] Watchlist alert triggered: ${result.ticker} (from ${watchlist.name}) entered ${targetStage}`);
        }
        
        // Update rule with newly triggered symbols
        if (newlyTriggered.length > 0) {
          await storage.updateAlertRule(rule.id, {
            lastEvaluatedAt: now,
            triggeredSymbols: [...Array.from(previouslyTriggered), ...newlyTriggered],
          });
        }
      } catch (error) {
        console.error(`[AlertEngine] Error processing watchlist rule ${rule.id}:`, error);
      }
    }
  }
  
  // Process symbol-specific rules (requires broker connection)
  if (symbolRules.length > 0 && connection) {
    const symbols = Array.from(new Set(symbolRules.map(r => r.symbol).filter((s): s is string => s !== null)));
    
    let quotes: QuoteData[] = [];
    if (symbols.length > 0) {
      try {
        quotes = await fetchQuotesFromBroker(connection, symbols);
      } catch (error) {
        console.error("[AlertEngine] Failed to fetch quotes:", error);
      }
    }
    
    const quoteMap = new Map(quotes.map(q => [q.symbol.toUpperCase(), q]));
    
    for (const rule of symbolRules) {
      if (!rule.symbol) continue;
      
      const quote = quoteMap.get(rule.symbol.toUpperCase());
      if (!quote) {
        continue;
      }
      
      try {
        const result = await evaluateRule(rule, quote);
        
        if (result && result.triggered) {
          const eventKey = generateEventKey(rule.id, result.toState, now);
          
          const existingEvent = await storage.getAlertEventByKey(eventKey);
          if (existingEvent) {
            continue;
          }
          
          const classification = result.classification;
          
          const eventData: InsertAlertEvent = {
            ruleId: rule.id,
            userId: rule.userId,
            symbol: rule.symbol,
            eventKey,
            fromState: result.fromState,
            toState: result.toState,
            price: result.price,
            payload: {
              resistance: classification.resistance,
              stopLoss: classification.stopLoss,
              volumeRatio: classification.volumeRatio,
              changePercent: classification.changePercent,
              message: generateAlertMessage(
                rule.symbol,
                result.fromState,
                result.toState,
                result.price
              ),
            },
            deliveryStatus: { push: false, email: false },
            isRead: false,
          };
          
          const event = await storage.createAlertEvent(eventData);
          createdEvents.push(event);
          
          // Track delivery status
          const deliveryStatus: { push?: boolean; pushSentAt?: string; webhook?: boolean; webhookSentAt?: string; endpointName?: string } = { push: false, webhook: false };
          
          // Send push notification for the alert
          if (rule.sendPushNotification !== false) {
            try {
              const { sendAlertPushNotification } = await import("./push-service");
              await sendAlertPushNotification(event);
              deliveryStatus.push = true;
              deliveryStatus.pushSentAt = new Date().toISOString();
            } catch (pushError) {
              console.log(`[AlertEngine] Push notification error: ${pushError}`);
            }
            emailAlertEvent(rule.userId, event);
          }
          
          await storage.updateAlertRule(rule.id, {
            lastEvaluatedAt: now,
            lastState: {
              stage: result.toState,
              price: result.price,
              volumeRatio: classification.volumeRatio,
              timestamp: now.toISOString(),
            },
          });
          
          console.log(`[AlertEngine] Event created: ${rule.symbol} ${result.fromState || "N/A"} -> ${result.toState}`);
          
          // Send webhook if enabled and endpoint configured (only during market hours)
          if (rule.sendWebhook && rule.automationEndpointId && rule.symbol) {
            if (isWithinMarketHours()) {
              // For webhook: entry at current price, target based on risk (entry - stop)
              const entryPrice = result.price;
              const stopLoss = classification.stopLoss || entryPrice * 0.93;
              const riskAmount = entryPrice - stopLoss;
              const targetPrice = entryPrice + (riskAmount * 2); // 2R target
              
              // Get endpoint name for display
              const endpoint = await storage.getAutomationEndpoint(rule.automationEndpointId);
              
              const webhookResult = await sendWebhookToEndpoint(
                rule.automationEndpointId,
                rule.symbol,
                entryPrice,
                targetPrice,
                stopLoss
              );
              
              if (webhookResult.success) {
                deliveryStatus.webhook = true;
                deliveryStatus.webhookSentAt = new Date().toISOString();
                deliveryStatus.endpointName = endpoint?.name || "AlgoPilotX";
                console.log(`[AlertEngine] Webhook sent for ${rule.symbol}`);
              } else {
                console.error(`[AlertEngine] Webhook failed for ${rule.symbol}: ${webhookResult.error}`);
              }
            } else {
              console.log(`[AlertEngine] Webhook skipped for ${rule.symbol} (outside market hours 9:30 AM - 4:00 PM ET)`);
            }
          }
          
          // Update event with delivery status
          await storage.updateAlertEvent(event.id, { deliveryStatus });
          
          // Legacy automation profile handling (only during market hours)
          if (result.toState === PatternStage.BREAKOUT && isWithinMarketHours()) {
            try {
              const alertScore = (eventData.payload as any)?.score || 75;
              const targetPrice = classification.resistance * 1.03;
              
              const signalContext: AutomationSignalContext = {
                userId: rule.userId,
                symbol: rule.symbol,
                strategy: rule.strategy || "VCP",
                alertRuleId: rule.id,
                alertRuleProfileId: rule.automationProfileId || undefined,
                watchlistId: rule.watchlistId || undefined,
                lastPrice: result.price,
                targetPrice: Number(targetPrice.toFixed(2)),
                stopLoss: Number(classification.stopLoss.toFixed(2)),
                score: alertScore,
              };
              
              const decision = await resolveAutomationProfileForSignal(signalContext);
              console.log(`[AlertEngine] Automation decision for ${rule.symbol}: ${decision.action} - ${decision.reason}`);
              
              await createAutomationEvent(signalContext, decision);
              
              if (decision.action === "SEND" && decision.profile) {
                const entrySignal: EntrySignal = {
                  symbol: rule.symbol,
                  lastPrice: result.price,
                  targetPrice: signalContext.targetPrice,
                  stopLoss: signalContext.stopLoss,
                };
                
                const webhookResult = await sendEntrySignalToProfile(
                  decision.profile.webhookUrl,
                  entrySignal,
                  decision.profile.apiKey
                );
                
                const logEntry = createAutomationLogEntry(
                  rule.userId,
                  "entry",
                  rule.symbol,
                  webhookResult.message,
                  webhookResult
                );
                await storage.createAutomationLog(logEntry);
                
                if (webhookResult.success) {
                  console.log(`[AlertEngine] Webhook sent for ${rule.symbol}: ${webhookResult.message}`);
                } else {
                  console.error(`[AlertEngine] Webhook failed for ${rule.symbol}: ${webhookResult.error}`);
                }
              } else if (decision.action === "QUEUE") {
                console.log(`[AlertEngine] Signal queued for approval: ${rule.symbol}`);
              } else if (decision.action === "BLOCKED") {
                console.log(`[AlertEngine] Signal blocked: ${rule.symbol} - ${decision.blockedReason}`);
              }
            } catch (webhookError) {
              console.error(`[AlertEngine] Error in automation for ${rule.symbol}:`, webhookError);
            }
          } else if (result.toState === PatternStage.BREAKOUT) {
            console.log(`[AlertEngine] Legacy automation skipped for ${rule.symbol} (outside market hours 9:30 AM - 4:00 PM ET)`);
          }
        } else {
          await storage.updateAlertRule(rule.id, {
            lastEvaluatedAt: now,
            lastState: {
              stage: classifyVCPStage(quote).stage,
              price: quote.last,
              volumeRatio: quote.avgVolume ? quote.volume / quote.avgVolume : 1,
              timestamp: now.toISOString(),
            },
          });
        }
      } catch (error) {
        console.error(`[AlertEngine] Error evaluating rule ${rule.id}:`, error);
      }
    }
  }
  
  return createdEvents;
}

let scheduledJob: ReturnType<typeof setInterval> | null = null;

export function startAlertEngine(
  getConnection: () => Promise<BrokerConnection | null>,
  intervalMs: number = 60000
): void {
  if (scheduledJob) {
    console.log("[AlertEngine] Already running, stopping previous instance");
    stopAlertEngine();
  }
  
  console.log(`[AlertEngine] Starting with ${intervalMs}ms interval`);
  
  scheduledJob = setInterval(async () => {
    try {
      const connection = await getConnection();
      // Process rules even without connection - global alerts use scan results
      const events = await processAlertRules(connection);
      if (events.length > 0) {
        console.log(`[AlertEngine] Created ${events.length} alert event(s)`);
      }
    } catch (error) {
      console.error("[AlertEngine] Error in scheduled evaluation:", error);
    }
  }, intervalMs);
  
  // Run initial evaluation
  (async () => {
    try {
      const connection = await getConnection();
      await processAlertRules(connection);
    } catch (error) {
      console.error("[AlertEngine] Error in initial evaluation:", error);
    }
  })();
}

export function stopAlertEngine(): void {
  if (scheduledJob) {
    clearInterval(scheduledJob);
    scheduledJob = null;
    console.log("[AlertEngine] Stopped");
  }
}

export function isAlertEngineRunning(): boolean {
  return scheduledJob !== null;
}
