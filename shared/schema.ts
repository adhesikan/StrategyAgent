import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";

export const symbols = pgTable("symbols", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticker: text("ticker").notNull().unique(),
  name: text("name").notNull(),
  exchange: text("exchange"),
  sector: text("sector"),
  industry: text("industry"),
  marketCap: real("market_cap"),
  avgVolume: real("avg_volume"),
  isActive: boolean("is_active").default(true),
});

export const insertSymbolSchema = createInsertSchema(symbols).omit({ id: true });
export type InsertSymbol = z.infer<typeof insertSymbolSchema>;
export type Symbol = typeof symbols.$inferSelect;

export const candles = pgTable("candles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbolId: varchar("symbol_id").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  open: real("open").notNull(),
  high: real("high").notNull(),
  low: real("low").notNull(),
  close: real("close").notNull(),
  volume: real("volume").notNull(),
  timeframe: text("timeframe").notNull(),
});

export const insertCandleSchema = createInsertSchema(candles).omit({ id: true });
export type InsertCandle = z.infer<typeof insertCandleSchema>;
export type Candle = typeof candles.$inferSelect;

export const PatternStage = {
  FORMING: "FORMING",
  READY: "READY",
  BREAKOUT: "BREAKOUT",
} as const;

export type PatternStageType = typeof PatternStage[keyof typeof PatternStage];

export const StrategyType = {
  VCP: "VCP",
  VCP_MULTIDAY: "VCP_MULTIDAY",
  CLASSIC_PULLBACK: "CLASSIC_PULLBACK",
  VWAP_RECLAIM: "VWAP_RECLAIM",
  ORB5: "ORB5",
  ORB15: "ORB15",
  HIGH_RVOL: "HIGH_RVOL",
  GAP_AND_GO: "GAP_AND_GO",
  TREND_CONTINUATION: "TREND_CONTINUATION",
  VOLATILITY_SQUEEZE: "VOLATILITY_SQUEEZE",
} as const;

export type StrategyTypeValue = typeof StrategyType[keyof typeof StrategyType];

export interface StrategyInfo {
  id: StrategyTypeValue;
  name: string;
  displayName: string;
  shortDescription: string;
  description: string;
  category: string;
  legacyName?: string;
  stages: string[];
}

export const scanResults = pgTable("scan_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scanRunId: varchar("scan_run_id"),
  ticker: text("ticker").notNull(),
  name: text("name"),
  price: real("price").notNull(),
  change: real("change"),
  changePercent: real("change_percent"),
  volume: real("volume"),
  avgVolume: real("avg_volume"),
  rvol: real("rvol"),
  stage: text("stage").notNull(),
  resistance: real("resistance"),
  stopLoss: real("stop_loss"),
  patternScore: integer("pattern_score"),
  ema9: real("ema9"),
  ema21: real("ema21"),
  atr: real("atr"),
  strategy: text("strategy"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertScanResultSchema = createInsertSchema(scanResults).omit({ id: true, createdAt: true });
export type InsertScanResult = z.infer<typeof insertScanResultSchema>;
export type ScanResult = typeof scanResults.$inferSelect;

export const opportunityFirstSeen = pgTable("opportunity_first_seen", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticker: text("ticker").notNull().unique(),
  stage: text("stage").notNull(),
  strategy: text("strategy"),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
});

export type OpportunityFirstSeen = typeof opportunityFirstSeen.$inferSelect;

// Opportunity Outcome Report - tracks detected opportunities and their lifecycle
export const OpportunityStatus = {
  ACTIVE: "ACTIVE",
  RESOLVED: "RESOLVED",
} as const;

export type OpportunityStatusType = typeof OpportunityStatus[keyof typeof OpportunityStatus];

export const OpportunityOutcome = {
  BROKE_RESISTANCE: "BROKE_RESISTANCE",
  INVALIDATED: "INVALIDATED",
  EXPIRED: "EXPIRED",
} as const;

export type OpportunityOutcomeType = typeof OpportunityOutcome[keyof typeof OpportunityOutcome];

export const opportunities = pgTable("opportunities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol").notNull(),
  strategyId: text("strategy_id").notNull(),
  strategyName: text("strategy_name").notNull(),
  timeframe: text("timeframe").notNull().default("1d"),
  stageAtDetection: text("stage_at_detection").notNull(),
  detectedAt: timestamp("detected_at").notNull(),
  detectedPrice: real("detected_price"),
  resistancePrice: real("resistance_price"),
  stopReferencePrice: real("stop_reference_price"),
  entryTriggerPrice: real("entry_trigger_price"),
  rvol: real("rvol"),
  score: integer("score"),
  status: text("status").notNull().default("ACTIVE"),
  resolvedAt: timestamp("resolved_at"),
  resolutionOutcome: text("resolution_outcome"),
  resolutionReason: text("resolution_reason"),
  resolutionPrice: real("resolution_price"),
  pnlPercent: real("pnl_percent"),
  maxPriceAfter: real("max_price_after"),
  minPriceAfter: real("min_price_after"),
  lastPrice: real("last_price"),
  maxFavorableMovePercent: real("max_favorable_move_percent"),
  maxAdverseMovePercent: real("max_adverse_move_percent"),
  barsTracked: integer("bars_tracked").notNull().default(0),
  activeDurationMinutes: integer("active_duration_minutes"),
  dedupeKey: text("dedupe_key").unique(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOpportunitySchema = createInsertSchema(opportunities).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type InsertOpportunity = z.infer<typeof insertOpportunitySchema>;
export type Opportunity = typeof opportunities.$inferSelect;

export const AlertType = {
  BREAKOUT: "BREAKOUT",
  STOP_HIT: "STOP_HIT",
  EMA_EXIT: "EMA_EXIT",
  APPROACHING: "APPROACHING",
} as const;

export type AlertTypeValue = typeof AlertType[keyof typeof AlertType];

export const alerts = pgTable("alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticker: text("ticker").notNull(),
  type: text("type").notNull(),
  price: real("price"),
  targetPrice: real("target_price"),
  stopPrice: real("stop_price"),
  message: text("message"),
  isRead: boolean("is_read").default(false),
  isTriggered: boolean("is_triggered").default(false),
  triggeredAt: timestamp("triggered_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAlertSchema = createInsertSchema(alerts).omit({ id: true, triggeredAt: true, createdAt: true });
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alerts.$inferSelect;

export const RuleConditionType = {
  STAGE_ENTERED: "STAGE_ENTERED",
  PRICE_ABOVE: "PRICE_ABOVE",
  PRICE_BELOW: "PRICE_BELOW",
  VOLUME_SPIKE: "VOLUME_SPIKE",
  ANY_STRATEGY_BREAKOUT: "ANY_STRATEGY_BREAKOUT",
  APPROACHING_TRIGGER: "APPROACHING_TRIGGER",
  EXIT_CONDITION: "EXIT_CONDITION",
  CONFLUENCE_MATCH: "CONFLUENCE_MATCH",
  SCORE_THRESHOLD: "SCORE_THRESHOLD",
} as const;

export type RuleConditionTypeValue = typeof RuleConditionType[keyof typeof RuleConditionType];

export const AlertTimeframe = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "1d": "1d",
} as const;

export type AlertTimeframeValue = typeof AlertTimeframe[keyof typeof AlertTimeframe];

export const ScanInterval = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
} as const;

export type ScanIntervalValue = typeof ScanInterval[keyof typeof ScanInterval];

export const alertRules = pgTable("alert_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol"),
  isGlobal: boolean("is_global").default(false),
  strategy: text("strategy").notNull().default("VCP"),
  strategies: text("strategies").array(),
  timeframe: text("timeframe").notNull().default("1d"),
  scanInterval: text("scan_interval").default("5m"),
  conditionType: text("condition_type").notNull(),
  conditionPayload: jsonb("condition_payload"),
  scoreThreshold: integer("score_threshold"),
  minStrategies: integer("min_strategies"),
  automationProfileId: varchar("automation_profile_id"),
  automationEndpointId: varchar("automation_endpoint_id"),
  watchlistId: varchar("watchlist_id"),
  sendPushNotification: boolean("send_push_notification").default(true),
  sendWebhook: boolean("send_webhook").default(false),
  isEnabled: boolean("is_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  lastEvaluatedAt: timestamp("last_evaluated_at"),
  lastState: jsonb("last_state"),
  triggeredSymbols: text("triggered_symbols").array(),
});

export const insertAlertRuleSchema = createInsertSchema(alertRules).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true, 
  lastEvaluatedAt: true,
  lastState: true,
  triggeredSymbols: true,
});
export type InsertAlertRule = z.infer<typeof insertAlertRuleSchema>;
export type AlertRule = typeof alertRules.$inferSelect;

export const alertEvents = pgTable("alert_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ruleId: varchar("rule_id").notNull(),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol").notNull(),
  triggeredAt: timestamp("triggered_at").defaultNow(),
  eventKey: text("event_key").notNull().unique(),
  fromState: text("from_state"),
  toState: text("to_state").notNull(),
  price: real("price"),
  payload: jsonb("payload"),
  deliveryStatus: jsonb("delivery_status"),
  isRead: boolean("is_read").default(false),
});

export const insertAlertEventSchema = createInsertSchema(alertEvents).omit({ 
  id: true, 
  triggeredAt: true 
});
export type InsertAlertEvent = z.infer<typeof insertAlertEventSchema>;
export type AlertEvent = typeof alertEvents.$inferSelect;

export const watchlists = pgTable("watchlists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  symbols: text("symbols").array(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWatchlistSchema = createInsertSchema(watchlists).omit({ id: true, createdAt: true });
export type InsertWatchlist = z.infer<typeof insertWatchlistSchema>;
export type Watchlist = typeof watchlists.$inferSelect;

export const BrokerProvider = {
  TRADIER: "tradier",
  IBKR: "ibkr",
  ALPACA: "alpaca",
  SCHWAB: "schwab",
  POLYGON: "polygon",
  TASTYTRADE: "tastytrade",
  TRADESTATION: "tradestation",
} as const;

export type BrokerProviderType = typeof BrokerProvider[keyof typeof BrokerProvider];

export const brokerConnections = pgTable("broker_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  provider: text("provider").notNull(),
  encryptedCredentials: text("encrypted_credentials"),
  credentialsIv: text("credentials_iv"),
  credentialsAuthTag: text("credentials_auth_tag"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  isConnected: boolean("is_connected").default(false),
  lastSync: timestamp("last_sync"),
  permissions: jsonb("permissions"),
  preferredAccountId: text("preferred_account_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBrokerConnectionSchema = createInsertSchema(brokerConnections).omit({ id: true });
export type InsertBrokerConnection = z.infer<typeof insertBrokerConnectionSchema>;
export type BrokerConnection = typeof brokerConnections.$inferSelect;

export const snaptradeConnections = pgTable("snaptrade_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  brokerageAuthorizationId: varchar("brokerage_authorization_id").notNull(),
  brokerName: text("broker_name").notNull(),
  brokerSlug: text("broker_slug"),
  accountId: varchar("account_id"),
  accountName: text("account_name"),
  accountNumber: text("account_number"),
  accountType: text("account_type"),
  isActive: boolean("is_active").default(true),
  isTradingEnabled: boolean("is_trading_enabled").default(false),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSnaptradeConnectionSchema = createInsertSchema(snaptradeConnections).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSnaptradeConnection = z.infer<typeof insertSnaptradeConnectionSchema>;
export type SnaptradeConnection = typeof snaptradeConnections.$inferSelect;

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ id: true, createdAt: true });
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

export const backtestResults = pgTable("backtest_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  ticker: text("ticker").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  initialCapital: real("initial_capital").notNull(),
  positionSize: real("position_size").notNull(),
  stopLossPercent: real("stop_loss_percent").notNull(),
  totalTrades: integer("total_trades").notNull(),
  winRate: real("win_rate").notNull(),
  avgReturn: real("avg_return").notNull(),
  maxDrawdown: real("max_drawdown").notNull(),
  sharpeRatio: real("sharpe_ratio"),
  totalReturn: real("total_return").notNull(),
  trades: jsonb("trades"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBacktestResultSchema = createInsertSchema(backtestResults).omit({ id: true, createdAt: true });
export type InsertBacktestResult = z.infer<typeof insertBacktestResultSchema>;
export type BacktestResult = typeof backtestResults.$inferSelect;

export const scannerFilters = z.object({
  minPrice: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
  minVolume: z.number().min(0).optional(),
  minDollarVolume: z.number().min(0).optional(),
  minRvol: z.number().min(0).optional(),
  maxSpread: z.number().min(0).optional(),
  excludeEtfs: z.boolean().optional(),
  excludeOtc: z.boolean().optional(),
  universe: z.enum(["all", "sp500", "nasdaq100", "dow30", "watchlist"]).optional(),
  sector: z.string().optional(),
  strategies: z.array(z.string()).optional(),
  minConfluence: z.number().min(2).max(10).optional(),
});

export type ScannerFilters = z.infer<typeof scannerFilters>;

export const marketStats = z.object({
  advancers: z.number(),
  decliners: z.number(),
  unchanged: z.number(),
  totalVolume: z.number(),
  marketStatus: z.enum(["open", "closed", "pre", "after"]),
});

export type MarketStats = z.infer<typeof marketStats>;

export const MarketRegime = {
  TRENDING: "TRENDING",
  CHOPPY: "CHOPPY",
  RISK_OFF: "RISK_OFF",
} as const;

export type MarketRegimeType = typeof MarketRegime[keyof typeof MarketRegime];

export const strategiesEnabled = pgTable("strategies_enabled", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  enabledStrategyIds: jsonb("enabled_strategy_ids").notNull().default([]),
  presetName: text("preset_name"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertStrategiesEnabledSchema = createInsertSchema(strategiesEnabled).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStrategiesEnabled = z.infer<typeof insertStrategiesEnabledSchema>;
export type StrategiesEnabled = typeof strategiesEnabled.$inferSelect;

export const scanResultsCache = pgTable("scan_results_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  strategyId: text("strategy_id").notNull(),
  stage: text("stage").notNull(),
  score: integer("score").notNull(),
  levels: jsonb("levels"),
  explanation: text("explanation"),
  computedAt: timestamp("computed_at").defaultNow(),
});

export const insertScanResultsCacheSchema = createInsertSchema(scanResultsCache).omit({ id: true, computedAt: true });
export type InsertScanResultsCache = z.infer<typeof insertScanResultsCacheSchema>;
export type ScanResultsCache = typeof scanResultsCache.$inferSelect;

export const confluenceResults = pgTable("confluence_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  matchedStrategies: jsonb("matched_strategies").notNull(),
  confluenceScore: integer("confluence_score").notNull(),
  primaryStage: text("primary_stage").notNull(),
  keyLevels: jsonb("key_levels"),
  explanation: text("explanation"),
  computedAt: timestamp("computed_at").defaultNow(),
});

export const insertConfluenceResultSchema = createInsertSchema(confluenceResults).omit({ id: true, computedAt: true });
export type InsertConfluenceResult = z.infer<typeof insertConfluenceResultSchema>;
export type ConfluenceResult = typeof confluenceResults.$inferSelect;

export const marketRegimeHistory = pgTable("market_regime_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  regime: text("regime").notNull(),
  strength: integer("strength").notNull(),
  ema21Slope: real("ema21_slope"),
  priceVsEma21: real("price_vs_ema21"),
  description: text("description"),
  recordedAt: timestamp("recorded_at").defaultNow(),
});

export const insertMarketRegimeHistorySchema = createInsertSchema(marketRegimeHistory).omit({ id: true, recordedAt: true });
export type InsertMarketRegimeHistory = z.infer<typeof insertMarketRegimeHistorySchema>;
export type MarketRegimeHistory = typeof marketRegimeHistory.$inferSelect;

export const automationSettings = pgTable("automation_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  isEnabled: boolean("is_enabled").default(false),
  webhookUrl: text("webhook_url"),
  encryptedApiKey: text("encrypted_api_key"),
  apiKeyIv: text("api_key_iv"),
  apiKeyAuthTag: text("api_key_auth_tag"),
  autoEntryEnabled: boolean("auto_entry_enabled").default(true),
  autoExitEnabled: boolean("auto_exit_enabled").default(true),
  minScore: integer("min_score").default(70),
  maxPositions: integer("max_positions").default(5),
  defaultPositionSize: real("default_position_size").default(1000),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAutomationSettingsSchema = createInsertSchema(automationSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAutomationSettings = z.infer<typeof insertAutomationSettingsSchema>;
export type AutomationSettings = typeof automationSettings.$inferSelect;

export const automationLogs = pgTable("automation_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  signalType: text("signal_type").notNull(),
  symbol: text("symbol").notNull(),
  message: text("message").notNull(),
  webhookResponse: jsonb("webhook_response"),
  success: boolean("success").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAutomationLogSchema = createInsertSchema(automationLogs).omit({ id: true, createdAt: true });
export type InsertAutomationLog = z.infer<typeof insertAutomationLogSchema>;
export type AutomationLog = typeof automationLogs.$inferSelect;

export const AutomationMode = {
  OFF: "OFF",
  AUTO: "AUTO",
  CONFIRM: "CONFIRM",
  NOTIFY_ONLY: "NOTIFY_ONLY",
} as const;

export type AutomationModeType = typeof AutomationMode[keyof typeof AutomationMode];

export const AutomationAction = {
  SENT: "SENT",
  QUEUED: "QUEUED",
  SKIPPED: "SKIPPED",
  BLOCKED: "BLOCKED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;

export type AutomationActionType = typeof AutomationAction[keyof typeof AutomationAction];

export const guardrailsSchema = z.object({
  maxPerDay: z.number().min(1).max(100).optional(),
  cooldownMinutes: z.number().min(1).max(1440).optional(),
  allowedTimeWindow: z.object({
    start: z.string().optional(),
    end: z.string().optional(),
  }).optional(),
  allowedStrategies: z.array(z.string()).optional(),
  allowedWatchlists: z.array(z.string()).optional(),
  allowedSymbols: z.array(z.string()).optional(),
});

export type Guardrails = z.infer<typeof guardrailsSchema>;

export const automationProfiles = pgTable("automation_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  webhookUrl: text("webhook_url").notNull(),
  encryptedApiKey: text("encrypted_api_key"),
  apiKeyIv: text("api_key_iv"),
  apiKeyAuthTag: text("api_key_auth_tag"),
  isEnabled: boolean("is_enabled").default(true),
  mode: text("mode").notNull().default("NOTIFY_ONLY"),
  guardrails: jsonb("guardrails"),
  lastTestStatus: integer("last_test_status"),
  lastTestAt: timestamp("last_test_at"),
  lastTestResponse: text("last_test_response"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAutomationProfileSchema = createInsertSchema(automationProfiles).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true,
  lastTestStatus: true,
  lastTestAt: true,
  lastTestResponse: true,
});
export type InsertAutomationProfile = z.infer<typeof insertAutomationProfileSchema>;
export type AutomationProfile = typeof automationProfiles.$inferSelect;

export const userAutomationSettings = pgTable("user_automation_settings", {
  userId: varchar("user_id").primaryKey(),
  globalDefaultProfileId: varchar("global_default_profile_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserAutomationSettingsSchema = createInsertSchema(userAutomationSettings).omit({ 
  createdAt: true, 
  updatedAt: true 
});
export type InsertUserAutomationSettings = z.infer<typeof insertUserAutomationSettingsSchema>;
export type UserAutomationSettings = typeof userAutomationSettings.$inferSelect;

export const automationEvents = pgTable("automation_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  signalId: varchar("signal_id").notNull(),
  profileId: varchar("profile_id").notNull(),
  symbol: text("symbol").notNull(),
  action: text("action").notNull(),
  reason: text("reason"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  payload: jsonb("payload"),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAutomationEventSchema = createInsertSchema(automationEvents).omit({ 
  id: true, 
  createdAt: true 
});
export type InsertAutomationEvent = z.infer<typeof insertAutomationEventSchema>;
export type AutomationEvent = typeof automationEvents.$inferSelect;

export const opportunityDefaults = pgTable("opportunity_defaults", {
  userId: varchar("user_id").primaryKey(),
  defaultMode: text("default_mode").notNull().default("single"),
  defaultStrategyId: text("default_strategy_id").notNull().default("VCP"),
  defaultScanScope: text("default_scan_scope").notNull().default("watchlist"),
  defaultWatchlistId: text("default_watchlist_id"),
  defaultSymbol: text("default_symbol"),
  defaultMarketIndex: text("default_market_index"),
  defaultFilterPreset: text("default_filter_preset").notNull().default("balanced"),
  autoRunOnLoad: boolean("auto_run_on_load").default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOpportunityDefaultsSchema = createInsertSchema(opportunityDefaults).omit({ 
  updatedAt: true 
});
export type InsertOpportunityDefaults = z.infer<typeof insertOpportunityDefaultsSchema>;
export type OpportunityDefaults = typeof opportunityDefaults.$inferSelect;

// Action Mode - User's preferred trading mode
export const ActionMode = {
  ALERTS_ONLY: "ALERTS_ONLY",
  ASSISTED: "ASSISTED",
  AUTO: "AUTO",
} as const;

export type ActionModeType = typeof ActionMode[keyof typeof ActionMode];

export const userSettings = pgTable("user_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  showTooltips: varchar("show_tooltips").notNull().default("true"),
  pushNotificationsEnabled: varchar("push_notifications_enabled").notNull().default("false"),
  breakoutAlertsEnabled: varchar("breakout_alerts_enabled").notNull().default("true"),
  stopAlertsEnabled: varchar("stop_alerts_enabled").notNull().default("true"),
  emaAlertsEnabled: varchar("ema_alerts_enabled").notNull().default("true"),
  approachingAlertsEnabled: varchar("approaching_alerts_enabled").notNull().default("true"),
  hasSeenWelcomeTutorial: varchar("has_seen_welcome_tutorial").notNull().default("false"),
  hasSeenScannerTutorial: varchar("has_seen_scanner_tutorial").notNull().default("false"),
  hasSeenVcpTutorial: varchar("has_seen_vcp_tutorial").notNull().default("false"),
  hasSeenAlertsTutorial: varchar("has_seen_alerts_tutorial").notNull().default("false"),
  preferredDataSource: varchar("preferred_data_source").notNull().default("brokerage"),
  preferredStrategies: jsonb("preferred_strategies").default([]),
  scanUniverse: text("scan_universe").default("all"),
  scanTimeframe: text("scan_timeframe").default("1d"),
  scanConfidenceMin: integer("scan_confidence_min").default(75),
  actionMode: text("action_mode").notNull().default("ALERTS_ONLY"),
  brokerPreference: text("broker_preference"),
  safetyLimits: jsonb("safety_limits").default({
    maxTradesPerDay: 2,
    maxPositions: 3,
    riskPerTradeUsd: 500,
    maxDailyLossUsd: 1000,
  }),
  setupCompleted: boolean("setup_completed").default(false),
  setupCompletedAt: timestamp("setup_completed_at"),
  autoAgentAcknowledged: boolean("auto_agent_acknowledged").default(false),
  autoAgentAcknowledgedAt: timestamp("auto_agent_acknowledged_at"),
  autoAgentAckVersion: text("auto_agent_ack_version"),
  automationMode: text("automation_mode").notNull().default("ALERTS"),
  automationEngine: text("automation_engine").notNull().default("BUILT_IN"),
  selectedAlgopilotxEndpointId: text("selected_algopilotx_endpoint_id"),
  automationStatus: text("automation_status").notNull().default("DISABLED"),
  ccFilterPresets: jsonb("cc_filter_presets").default(null),
  traderType: text("trader_type").default("swing"),
  onboardingStep: integer("onboarding_step").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSettingsSchema = createInsertSchema(userSettings).omit({ 
  id: true,
  updatedAt: true 
});
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;

export const userSettingsUpdateSchema = z.object({
  showTooltips: z.boolean().optional(),
  pushNotificationsEnabled: z.boolean().optional(),
  breakoutAlertsEnabled: z.boolean().optional(),
  stopAlertsEnabled: z.boolean().optional(),
  emaAlertsEnabled: z.boolean().optional(),
  approachingAlertsEnabled: z.boolean().optional(),
  hasSeenWelcomeTutorial: z.boolean().optional(),
  hasSeenScannerTutorial: z.boolean().optional(),
  hasSeenVcpTutorial: z.boolean().optional(),
  hasSeenAlertsTutorial: z.boolean().optional(),
  preferredDataSource: z.enum(["brokerage"]).optional(),
  preferredStrategies: z.array(z.string()).optional(),
  scanUniverse: z.string().optional(),
  scanTimeframe: z.string().optional(),
  scanConfidenceMin: z.number().min(50).max(100).optional(),
  actionMode: z.enum(["ALERTS_ONLY", "ASSISTED", "AUTO"]).optional(),
  brokerPreference: z.string().optional(),
  safetyLimits: z.object({
    maxTradesPerDay: z.number().min(1).max(20).default(2),
    maxPositions: z.number().min(1).max(10).default(3),
    riskPerTradeUsd: z.number().min(50).max(10000).default(500),
    maxDailyLossUsd: z.number().min(100).max(50000).default(1000),
  }).optional(),
  setupCompleted: z.boolean().optional(),
  setupCompletedAt: z.coerce.date().optional(),
  autoAgentAcknowledged: z.boolean().optional(),
  autoAgentAcknowledgedAt: z.coerce.date().optional(),
  autoAgentAckVersion: z.string().optional(),
  automationMode: z.enum(["ALERTS", "ASSISTED", "AUTONOMOUS"]).optional(),
  automationEngine: z.enum(["BUILT_IN", "ALGOPILOTX"]).optional(),
  selectedAlgopilotxEndpointId: z.string().nullable().optional(),
  automationStatus: z.enum(["ARMED", "PAUSED", "DISABLED"]).optional(),
  ccFilterPresets: z.any().nullable().optional(),
  traderType: z.enum(["day", "swing", "options", "futures"]).optional(),
  onboardingStep: z.number().min(0).max(5).optional(),
});
export type UserSettingsUpdate = z.infer<typeof userSettingsUpdateSchema>;
export type UserSettings = typeof userSettings.$inferSelect;

export const safetyLimitsSchema = z.object({
  maxTradesPerDay: z.number().min(1).max(20).default(2),
  maxPositions: z.number().min(1).max(10).default(3),
  riskPerTradeUsd: z.number().min(50).max(10000).default(500),
  maxDailyLossUsd: z.number().min(100).max(50000).default(1000),
});
export type SafetyLimits = z.infer<typeof safetyLimitsSchema>;

export const AlgoPilotXConnectionType = {
  OAUTH: "OAUTH",
  WEBHOOK: "WEBHOOK",
} as const;

export type AlgoPilotXConnectionTypeValue = typeof AlgoPilotXConnectionType[keyof typeof AlgoPilotXConnectionType];

export const algoPilotxConnections = pgTable("algo_pilotx_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  connectionType: text("connection_type").notNull().default("WEBHOOK"),
  apiBaseUrl: text("api_base_url"),
  webhookUrl: text("webhook_url"),
  webhookSecretEncrypted: text("webhook_secret_encrypted"),
  webhookSecretIv: text("webhook_secret_iv"),
  webhookSecretAuthTag: text("webhook_secret_auth_tag"),
  oauthRefreshTokenEncrypted: text("oauth_refresh_token_encrypted"),
  oauthAccessTokenEncrypted: text("oauth_access_token_encrypted"),
  oauthTokenIv: text("oauth_token_iv"),
  oauthTokenAuthTag: text("oauth_token_auth_tag"),
  isConnected: boolean("is_connected").default(false),
  lastTestedAt: timestamp("last_tested_at"),
  lastTestSuccess: boolean("last_test_success"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAlgoPilotxConnectionSchema = createInsertSchema(algoPilotxConnections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastTestedAt: true,
  lastTestSuccess: true,
});
export type InsertAlgoPilotxConnection = z.infer<typeof insertAlgoPilotxConnectionSchema>;
export type AlgoPilotxConnection = typeof algoPilotxConnections.$inferSelect;

export const ExecutionRequestStatus = {
  CREATED: "CREATED",
  SENT: "SENT",
  ACKED: "ACKED",
  EXECUTED: "EXECUTED",
  REJECTED: "REJECTED",
  FAILED: "FAILED",
} as const;

export type ExecutionRequestStatusValue = typeof ExecutionRequestStatus[keyof typeof ExecutionRequestStatus];

export const executionRequests = pgTable("execution_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  endpointId: varchar("endpoint_id"),
  action: text("action"),
  symbol: text("symbol").notNull(),
  strategyId: text("strategy_id").notNull(),
  timeframe: text("timeframe"),
  setupPayload: jsonb("setup_payload"),
  automationProfileId: varchar("automation_profile_id"),
  status: text("status").notNull().default("CREATED"),
  algoPilotxReference: text("algo_pilotx_reference"),
  redirectUrl: text("redirect_url"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertExecutionRequestSchema = createInsertSchema(executionRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertExecutionRequest = z.infer<typeof insertExecutionRequestSchema>;
export type ExecutionRequest = typeof executionRequests.$inferSelect;

export const setupPayloadSchema = z.object({
  symbol: z.string(),
  strategyId: z.string(),
  strategyName: z.string(),
  stage: z.string(),
  price: z.number(),
  resistance: z.number().optional(),
  stopLoss: z.number().optional(),
  entryTrigger: z.number().optional(),
  exitRule: z.string().optional(),
  rvol: z.number().optional(),
  patternScore: z.number().optional(),
  explanation: z.string().optional(),
  timestamp: z.string(),
  nonce: z.string(),
});
export type SetupPayload = z.infer<typeof setupPayloadSchema>;

export const automationEndpoints = pgTable("automation_endpoints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  webhookUrl: text("webhook_url").notNull(),
  webhookSecretEncrypted: text("webhook_secret_encrypted"),
  webhookSecretIv: text("webhook_secret_iv"),
  webhookSecretAuthTag: text("webhook_secret_auth_tag"),
  isActive: boolean("is_active").default(true),
  lastTestedAt: timestamp("last_tested_at"),
  lastTestSuccess: boolean("last_test_success"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAutomationEndpointSchema = createInsertSchema(automationEndpoints).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastTestedAt: true,
  lastTestSuccess: true,
});
export type InsertAutomationEndpoint = z.infer<typeof insertAutomationEndpointSchema>;
export type AutomationEndpoint = typeof automationEndpoints.$inferSelect;

export const TradeStatus = {
  OPEN: "OPEN",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
} as const;

export type TradeStatusValue = typeof TradeStatus[keyof typeof TradeStatus];

export const TradeSide = {
  LONG: "LONG",
  SHORT: "SHORT",
} as const;

export type TradeSideValue = typeof TradeSide[keyof typeof TradeSide];

export const trades = pgTable("trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol").notNull(),
  strategyId: text("strategy_id").notNull(),
  endpointId: varchar("endpoint_id"),
  alertEventId: varchar("alert_event_id"),
  entryExecutionId: varchar("entry_execution_id"),
  exitExecutionId: varchar("exit_execution_id"),
  side: text("side").notNull().default("LONG"),
  status: text("status").notNull().default("OPEN"),
  entryPrice: real("entry_price"),
  exitPrice: real("exit_price"),
  quantity: real("quantity"),
  stopLoss: real("stop_loss"),
  target: real("target"),
  pnl: real("pnl"),
  pnlPercent: real("pnl_percent"),
  setupPayload: jsonb("setup_payload"),
  entryTimestamp: timestamp("entry_timestamp").defaultNow(),
  exitTimestamp: timestamp("exit_timestamp"),
  createdAt: timestamp("created_at").defaultNow(),
  source: text("source").default("manual"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTradeSchema = createInsertSchema(trades).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof trades.$inferSelect;

// Auto Agent - Policy-based automated trading
export const AgentMode = {
  SUGGEST: "SUGGEST",
  AUTO: "AUTO",
} as const;

export type AgentModeType = typeof AgentMode[keyof typeof AgentMode];

export const AgentAction = {
  SKIP: "SKIP",
  SUGGEST: "SUGGEST",
  EXECUTE: "EXECUTE",
  ERROR: "ERROR",
} as const;

export type AgentActionType = typeof AgentAction[keyof typeof AgentAction];

export const agentPolicies = pgTable("agent_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  brokerAccountId: text("broker_account_id"),
  strategyId: text("strategy_id"),
  name: text("name").default("Default Policy"),
  enabled: boolean("enabled").default(true),
  mode: text("mode").notNull().default("SUGGEST"),
  allowedStages: jsonb("allowed_stages").default(["BREAKOUT"]),
  minConfidencePct: integer("min_confidence_pct").default(85),
  minUpsidePct: real("min_upside_pct").default(5.0),
  minRvol: real("min_rvol").default(1.5),
  minRewardRisk: real("min_reward_risk").default(1.0),
  allowedMomentum: jsonb("allowed_momentum").default(["strong", "volume expanding"]),
  priceMin: real("price_min"),
  priceMax: real("price_max"),
  minAvgDollarVolume: real("min_avg_dollar_volume"),
  maxTradesPerDay: integer("max_trades_per_day").default(2),
  maxConcurrentPositions: integer("max_concurrent_positions").default(3),
  riskPerTradeUsd: real("risk_per_trade_usd").default(500),
  maxDailyLossUsd: real("max_daily_loss_usd").default(1000),
  avoidFirstMinutes: integer("avoid_first_minutes").default(15),
  cooldownMinutes: integer("cooldown_minutes").default(60),
  scanIntervalMinutes: integer("scan_interval_minutes").default(5),
  optionsEnabled: boolean("options_enabled").default(false),
  optionType: text("option_type").default("calls"),
  optionsStrategy: text("options_strategy").default("long_calls"),
  optionsDeltaMin: real("options_delta_min").default(0.30),
  optionsDeltaMax: real("options_delta_max").default(0.70),
  optionsDteMin: integer("options_dte_min").default(14),
  optionsDteMax: integer("options_dte_max").default(45),
  optionsPremiumMin: real("options_premium_min"),
  optionsPremiumMax: real("options_premium_max"),
  optionsMinOpenInterest: integer("options_min_open_interest").default(100),
  optionsMinVolume: integer("options_min_volume").default(10),
  optionsMaxRiskUsd: real("options_max_risk_usd").default(500),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAgentPolicySchema = createInsertSchema(agentPolicies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAgentPolicy = z.infer<typeof insertAgentPolicySchema>;
export type AgentPolicy = typeof agentPolicies.$inferSelect;

export const agentDecisions = pgTable("agent_decisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  policyId: varchar("policy_id").notNull(),
  opportunityId: varchar("opportunity_id"),
  symbol: text("symbol").notNull(),
  action: text("action").notNull(),
  reasons: jsonb("reasons"),
  metricsSnapshot: jsonb("metrics_snapshot"),
  orderPayload: jsonb("order_payload"),
  brokerOrderId: text("broker_order_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentDecisionSchema = createInsertSchema(agentDecisions).omit({
  id: true,
  createdAt: true,
});
export type InsertAgentDecision = z.infer<typeof insertAgentDecisionSchema>;
export type AgentDecision = typeof agentDecisions.$inferSelect;

export const agentState = pgTable("agent_state", {
  userId: varchar("user_id").primaryKey(),
  enabled: boolean("enabled").default(false),
  paused: boolean("paused").default(false),
  emergencyStop: boolean("emergency_stop").default(false),
  lastRunAt: timestamp("last_run_at"),
  tradesTodayCount: integer("trades_today_count").default(0),
  dailyPnlEstimate: real("daily_pnl_estimate").default(0),
  lastTradeDate: text("last_trade_date"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAgentStateSchema = createInsertSchema(agentState);
export type InsertAgentState = z.infer<typeof insertAgentStateSchema>;
export type AgentState = typeof agentState.$inferSelect;

export const agentDecisionMetricsSchema = z.object({
  confidence: z.number().optional(),
  price: z.number(),
  resistance: z.number().optional(),
  stop: z.number().optional(),
  rvol: z.number().optional(),
  volume: z.number().optional(),
  upsidePct: z.number().optional(),
  riskPct: z.number().optional(),
  rewardRisk: z.number().optional(),
});
export type AgentDecisionMetrics = z.infer<typeof agentDecisionMetricsSchema>;

// Audit Events - Compliance logging for key user actions
export const AuditEventType = {
  WIZARD_COMPLETED: "WIZARD_COMPLETED",
  AUTO_AGENT_ARMED: "AUTO_AGENT_ARMED",
  AUTO_AGENT_PAUSED: "AUTO_AGENT_PAUSED",
  AUTO_AGENT_DISABLED: "AUTO_AGENT_DISABLED",
  EMERGENCY_STOP_TRIGGERED: "EMERGENCY_STOP_TRIGGERED",
  EXECUTION_COCKPIT_OPENED: "EXECUTION_COCKPIT_OPENED",
  INSTATRADE_INITIATED: "INSTATRADE_INITIATED",
  BROKER_CONNECTED: "BROKER_CONNECTED",
  BROKER_DISCONNECTED: "BROKER_DISCONNECTED",
  MODE_CHANGED: "MODE_CHANGED",
  SETTINGS_UPDATED: "SETTINGS_UPDATED",
} as const;

export type AuditEventTypeValue = typeof AuditEventType[keyof typeof AuditEventType];

export const auditEvents = pgTable("audit_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  eventType: text("event_type").notNull(),
  eventAt: timestamp("event_at").defaultNow().notNull(),
  metadata: jsonb("metadata").default({}),
});

export const insertAuditEventSchema = createInsertSchema(auditEvents).omit({
  id: true,
  eventAt: true,
});
export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type AuditEvent = typeof auditEvents.$inferSelect;

// ─── Risk Profiles ─────────────────────────────────────────────────
export const riskProfiles = pgTable("risk_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  riskMode: text("risk_mode").notNull(),
  riskPerTrade: real("risk_per_trade").notNull(),
  maxDeploy: real("max_deploy").notNull(),
  deltaMin: real("delta_min"),
  deltaMax: real("delta_max"),
  lossCutoffMult: real("loss_cutoff_mult"),
  minPremiumPct: real("min_premium_pct"),
  vixPause: real("vix_pause"),
  protectionsEnabled: boolean("protections_enabled").notNull().default(true),
  guardrailsJson: jsonb("guardrails_json").notNull().default({}),
  protectionsJson: jsonb("protections_json").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertRiskProfileSchema = createInsertSchema(riskProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRiskProfile = z.infer<typeof insertRiskProfileSchema>;
export type RiskProfile = typeof riskProfiles.$inferSelect;

// ─── Ticker Universes ──────────────────────────────────────────────
export const tickerUniverses = pgTable("ticker_universes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTickerUniverseSchema = createInsertSchema(tickerUniverses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTickerUniverse = z.infer<typeof insertTickerUniverseSchema>;
export type TickerUniverse = typeof tickerUniverses.$inferSelect;

// ─── Ticker Universe Members ───────────────────────────────────────
export const tickerUniverseMembers = pgTable("ticker_universe_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  universeId: varchar("universe_id").notNull(),
  symbol: text("symbol").notNull(),
  addedAt: timestamp("added_at").defaultNow(),
});

export const insertTickerUniverseMemberSchema = createInsertSchema(tickerUniverseMembers).omit({
  id: true,
  addedAt: true,
});
export type InsertTickerUniverseMember = z.infer<typeof insertTickerUniverseMemberSchema>;
export type TickerUniverseMember = typeof tickerUniverseMembers.$inferSelect;

export const optionsScans = pgTable("options_scans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  universeId: text("universe_id").notNull(),
  strategyKey: text("strategy_key").notNull(),
  requestJson: jsonb("request_json").notNull(),
  resultJson: jsonb("result_json").notNull(),
});

export const insertOptionsScanSchema = createInsertSchema(optionsScans).omit({
  id: true,
  createdAt: true,
});
export type InsertOptionsScan = z.infer<typeof insertOptionsScanSchema>;
export type OptionsScan = typeof optionsScans.$inferSelect;

// ─── Trade Orders ─────────────────────────────────────────────────
export const TradeOrderStatus = {
  PENDING: "pending",
  FILLED: "filled",
  PARTIALLY_FILLED: "partially_filled",
  CANCELLED: "cancelled",
  REJECTED: "rejected",
  EXPIRED: "expired",
} as const;
export type TradeOrderStatusType = typeof TradeOrderStatus[keyof typeof TradeOrderStatus];

export const tradeOrders = pgTable("trade_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  brokerProvider: text("broker_provider").notNull(),
  brokerAccountId: text("broker_account_id").notNull(),
  brokerOrderId: text("broker_order_id"),
  symbol: text("symbol").notNull(),
  optionSymbol: text("option_symbol"),
  orderClass: text("order_class").notNull().default("option"),
  side: text("side").notNull(),
  optionSide: text("option_side"),
  quantity: integer("quantity").notNull(),
  orderType: text("order_type").notNull(),
  limitPrice: real("limit_price"),
  stopPrice: real("stop_price"),
  duration: text("duration").notNull().default("day"),
  status: text("status").notNull().default("pending"),
  fillPrice: real("fill_price"),
  filledAt: timestamp("filled_at"),
  strategyKey: text("strategy_key"),
  strategyVariant: text("strategy_variant"),
  strike: real("strike"),
  expiration: text("expiration"),
  optionType: text("option_type"),
  ticketJson: jsonb("ticket_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTradeOrderSchema = createInsertSchema(tradeOrders).omit({
  id: true,
  createdAt: true,
});
export type InsertTradeOrder = z.infer<typeof insertTradeOrderSchema>;
export type TradeOrder = typeof tradeOrders.$inferSelect;

// ─── Managed Exits (OCO fallback) ──────────────────────────────────
export const ManagedExitStatus = {
  ACTIVE: "active",
  TARGET_HIT: "target_hit",
  STOP_HIT: "stop_hit",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  ERROR: "error",
} as const;
export type ManagedExitStatusType = typeof ManagedExitStatus[keyof typeof ManagedExitStatus];

export const managedExits = pgTable("managed_exits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  tradeOrderId: varchar("trade_order_id").notNull(),
  brokerProvider: text("broker_provider").notNull(),
  brokerAccountId: text("broker_account_id").notNull(),
  symbol: text("symbol").notNull(),
  optionSymbol: text("option_symbol"),
  optionSide: text("option_side"),
  quantity: integer("quantity").notNull(),
  targetPrice: real("target_price"),
  stopPrice: real("stop_price"),
  stopType: text("stop_type").notNull().default("stop"),
  status: text("status").notNull().default("active"),
  exitBrokerOrderId: text("exit_broker_order_id"),
  exitPrice: real("exit_price"),
  exitedAt: timestamp("exited_at"),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertManagedExitSchema = createInsertSchema(managedExits).omit({
  id: true,
  createdAt: true,
});
export type InsertManagedExit = z.infer<typeof insertManagedExitSchema>;
export type ManagedExit = typeof managedExits.$inferSelect;

// ─── Futures Orders ───────────────────────────────────────────────
export const FuturesOrderStatus = {
  CREATED: "created",
  SENT: "sent",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  PART_FILLED: "part_filled",
  FILLED: "filled",
  CANCELED: "canceled",
  ERROR: "error",
} as const;
export type FuturesOrderStatusType = typeof FuturesOrderStatus[keyof typeof FuturesOrderStatus];

export const futuresOrders = pgTable("futures_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  qty: integer("qty").notNull(),
  orderType: text("order_type").notNull(),
  limitPrice: real("limit_price"),
  status: text("status").notNull().default("created"),
  brokerOrderId: text("broker_order_id"),
  raw: jsonb("raw").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFuturesOrderSchema = createInsertSchema(futuresOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFuturesOrder = z.infer<typeof insertFuturesOrderSchema>;
export type FuturesOrder = typeof futuresOrders.$inferSelect;

// ─── Futures Fills ────────────────────────────────────────────────
export const futuresFills = pgTable("futures_fills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull(),
  fillPrice: real("fill_price").notNull(),
  fillQty: integer("fill_qty").notNull(),
  filledAt: timestamp("filled_at").defaultNow(),
  raw: jsonb("raw").default({}),
});

export const insertFuturesFillSchema = createInsertSchema(futuresFills).omit({
  id: true,
  filledAt: true,
});
export type InsertFuturesFill = z.infer<typeof insertFuturesFillSchema>;
export type FuturesFill = typeof futuresFills.$inferSelect;

// ─── Futures Positions ────────────────────────────────────────────
export const futuresPositions = pgTable("futures_positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol").notNull(),
  qty: integer("qty").notNull(),
  avgPrice: real("avg_price").notNull(),
  unrealizedPnl: real("unrealized_pnl"),
  updatedAt: timestamp("updated_at").defaultNow(),
  raw: jsonb("raw").default({}),
});

export const insertFuturesPositionSchema = createInsertSchema(futuresPositions).omit({
  id: true,
  updatedAt: true,
});
export type InsertFuturesPosition = z.infer<typeof insertFuturesPositionSchema>;
export type FuturesPosition = typeof futuresPositions.$inferSelect;

// ─── Futures Commands ─────────────────────────────────────────────
export const FuturesCommandStatus = {
  PENDING: "pending",
  PROCESSING: "processing",
  DONE: "done",
  FAILED: "failed",
} as const;
export type FuturesCommandStatusType = typeof FuturesCommandStatus[keyof typeof FuturesCommandStatus];

export const futuresCommands = pgTable("futures_commands", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  commandType: text("command_type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFuturesCommandSchema = createInsertSchema(futuresCommands).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFuturesCommand = z.infer<typeof insertFuturesCommandSchema>;
export type FuturesCommand = typeof futuresCommands.$inferSelect;

// ─── Futures Worker Status ────────────────────────────────────────
export const futuresWorkerStatus = pgTable("futures_worker_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  status: text("status").notNull().default("stopped"),
  lastHeartbeatAt: timestamp("last_heartbeat_at").defaultNow(),
  details: jsonb("details").default({}),
});

export type FuturesWorkerStatus = typeof futuresWorkerStatus.$inferSelect;

// ─── Futures Agent Audit Log ──────────────────────────────────────
export const futuresAgentAuditLog = pgTable("futures_agent_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  action: text("action").notNull(),
  symbol: text("symbol"),
  details: jsonb("details").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertFuturesAgentAuditLogSchema = createInsertSchema(futuresAgentAuditLog).omit({
  id: true,
  createdAt: true,
});
export type InsertFuturesAgentAuditLog = z.infer<typeof insertFuturesAgentAuditLogSchema>;
export type FuturesAgentAuditLog = typeof futuresAgentAuditLog.$inferSelect;
