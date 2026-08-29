import { sql } from "drizzle-orm";
import { pgTable, pgEnum, text, varchar, integer, real, boolean, timestamp, jsonb, numeric, time, date, bigint, uniqueIndex, index, check } from "drizzle-orm/pg-core";
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
  subIndustry: text("sub_industry"),
  marketCap: real("market_cap"),
  avgVolume: real("avg_volume"),
  country: text("country"),
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
  autoReconnect: boolean("auto_reconnect").default(false),
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
  positionSizingMethod: text("position_sizing_method").default("fixed_dollar"),
  positionSizingValue: integer("position_sizing_value").default(1000),
  // Sprint 5.5: changed DB default from "/home" to "/dashboard".
  // "/home" is treated as a legacy value — DefaultLanding coerces it to "/dashboard".
  defaultLandingPage: text("default_landing_page").default("/dashboard"),
  // Sprint 2.8.1A — Research & Trading Preferences (presentation-only, not suitability)
  preferredExpressionTypes: jsonb("preferred_expression_types").$type<string[]>().default([]),
  showOtherCompatibleStructures: boolean("show_other_compatible_structures").default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Sprint 5.5: "/home" removed as a pinnable landing page — it is now the
// AI Command Center accessible via direct URL / deep link only.
// Legacy users with "/home" stored are migrated to "/dashboard" by both
// the server-side GET /api/user/settings coercion and resolveLandingPage().
export const LANDING_PAGE_OPTIONS = [
  { value: "/dashboard", label: "Dashboard" },
  { value: "/scanner", label: "Scanner" },
  { value: "/goal-mode", label: "Grow" },
  { value: "/income-mode", label: "Income" },
  { value: "/trade-finder", label: "Trade" },
  { value: "/markets", label: "Markets" },
  { value: "/opportunity-radar", label: "Top Opportunities" },
  { value: "/instatrade", label: "InstaTrade" },
  { value: "/charts", label: "Charts" },
] as const;
export const landingPageValues = LANDING_PAGE_OPTIONS.map((o) => o.value) as unknown as [string, ...string[]];

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
  onboardingStep: z.number().min(0).max(6).optional(),
  positionSizingMethod: z.enum(["fixed_dollar", "fixed_shares", "percent_account"]).optional(),
  positionSizingValue: z.number().min(1).optional(),
  defaultLandingPage: z.enum(landingPageValues).optional(),
  traderPersona: z.enum(["buyer", "seller", "complex", "learner"]).nullable().optional(),
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

// ─── Position Protection (user-directed exit rules) ───────────────────
// App-managed monitoring of stop loss / take profit / trailing stops.
// NOT autonomous trading: a user must explicitly enable each plan, define
// the parameters, and acknowledge the risk. Tradier has no native
// trailing_stop order, so the worker submits regular market/stop exit
// orders when a user-defined trigger is hit.
export const PositionProtectionStatus = {
  ACTIVE: "active",
  PAUSED: "paused",
  TRIGGERED: "triggered",
  EXITED: "exited",
  CANCELLED: "cancelled",
  ERROR: "error",
} as const;
export type PositionProtectionStatusType =
  typeof PositionProtectionStatus[keyof typeof PositionProtectionStatus];

export const positionProtectionPlans = pgTable("position_protection_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  brokerProvider: text("broker_provider").notNull(),
  brokerAccountId: text("broker_account_id").notNull(),
  // "paper" (sandbox) or "live" — used to gate live trading behind a flag.
  accountMode: text("account_mode").notNull().default("paper"),
  symbol: text("symbol").notNull(),
  // "stock" | "option" — options/spreads disabled by default via env flag.
  instrumentType: text("instrument_type").notNull().default("stock"),
  optionSymbol: text("option_symbol"),
  // "long" | "short" — direction of the position being protected.
  positionSide: text("position_side").notNull().default("long"),
  quantity: integer("quantity").notNull(),
  entryPrice: real("entry_price"),

  // Hard stop loss
  stopEnabled: boolean("stop_enabled").notNull().default(false),
  stopMode: text("stop_mode"), // "price" | "percent" | "dollar"
  stopValue: real("stop_value"),
  stopPrice: real("stop_price"),

  // Take profit target
  targetEnabled: boolean("target_enabled").notNull().default(false),
  targetMode: text("target_mode"), // "price" | "percent" | "dollar"
  targetValue: real("target_value"),
  targetPrice: real("target_price"),

  // App-managed trailing stop
  trailEnabled: boolean("trail_enabled").notNull().default(false),
  trailMode: text("trail_mode"), // "percent" | "dollar"
  trailValue: real("trail_value"),
  highWaterMark: real("high_water_mark"),
  trailStopPrice: real("trail_stop_price"),

  // How the exit order is submitted when triggered.
  exitOrderType: text("exit_order_type").notNull().default("market"), // "market" | "stop" | "stop_limit"

  status: text("status").notNull().default("active"),
  triggerReason: text("trigger_reason"), // "stop" | "target" | "trail"
  submittedExitOrderId: text("submitted_exit_order_id"),
  exitPrice: real("exit_price"),
  exitedAt: timestamp("exited_at"),
  lastPrice: real("last_price"),
  lastCheckedAt: timestamp("last_checked_at"),
  acknowledged: boolean("acknowledged").notNull().default(false),
  // Snapshot of the exact acknowledgment copy the user agreed to, plus when —
  // required for compliance audit when enabling protection on live positions.
  acknowledgedText: text("acknowledged_text"),
  acknowledgedAt: timestamp("acknowledged_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPositionProtectionPlanSchema = createInsertSchema(positionProtectionPlans).omit({
  id: true,
  status: true,
  triggerReason: true,
  submittedExitOrderId: true,
  exitPrice: true,
  exitedAt: true,
  lastPrice: true,
  lastCheckedAt: true,
  highWaterMark: true,
  trailStopPrice: true,
  acknowledgedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPositionProtectionPlan = z.infer<typeof insertPositionProtectionPlanSchema>;
export type PositionProtectionPlan = typeof positionProtectionPlans.$inferSelect;

export const positionProtectionEvents = pgTable("position_protection_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planId: varchar("plan_id").notNull(),
  userId: varchar("user_id").notNull(),
  // created | updated | trail_adjusted | triggered | exit_submitted |
  // exit_filled | paused | resumed | cancelled | error
  eventType: text("event_type").notNull(),
  message: text("message"),
  price: real("price"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPositionProtectionEventSchema = createInsertSchema(positionProtectionEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertPositionProtectionEvent = z.infer<typeof insertPositionProtectionEventSchema>;
export type PositionProtectionEvent = typeof positionProtectionEvents.$inferSelect;

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

// ─── External Trade Alerts (Strategy Fundamentals) ───────────────
export const ExternalAlertStatus = {
  PENDING: "PENDING",
  EVALUATING: "EVALUATING",
  EXECUTED: "EXECUTED",
  SKIPPED: "SKIPPED",
  EXPIRED: "EXPIRED",
  ERROR: "ERROR",
} as const;
export type ExternalAlertStatusType = typeof ExternalAlertStatus[keyof typeof ExternalAlertStatus];

export const ExternalAlertDirection = {
  LONG: "Long",
  SHORT: "Short",
} as const;
export type ExternalAlertDirectionType = typeof ExternalAlertDirection[keyof typeof ExternalAlertDirection];

export const externalAlerts = pgTable("external_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  source: text("source").notNull().default("strategy_fundamentals"),
  alertType: text("alert_type").notNull().default("entry"),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull().default("Long"),
  strategyName: text("strategy_name").notNull(),
  strategyGroup: text("strategy_group"),
  entryPrice: real("entry_price").notNull(),
  riskPrice: real("risk_price"),
  targetPrice: real("target_price"),
  exitReason: text("exit_reason"),
  alertTimestamp: timestamp("alert_timestamp").notNull(),
  status: text("status").notNull().default("PENDING"),
  skipReason: text("skip_reason"),
  agentDecisionId: varchar("agent_decision_id"),
  brokerOrderId: text("broker_order_id"),
  executedPrice: real("executed_price"),
  executedAt: timestamp("executed_at"),
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertExternalAlertSchema = createInsertSchema(externalAlerts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertExternalAlert = z.infer<typeof insertExternalAlertSchema>;
export type ExternalAlert = typeof externalAlerts.$inferSelect;

export const externalAlertWebhookSchema = z.object({
  symbol: z.string().min(1).max(10),
  direction: z.enum(["Long", "Short"]).default("Long"),
  alert_type: z.enum(["entry", "exit"]).default("entry"),
  strategy_name: z.string().min(1),
  strategy_group: z.string().optional(),
  entry_price: z.number().positive(),
  risk_price: z.number().positive().optional(),
  target_price: z.number().positive().optional(),
  exit_reason: z.string().optional(),
  timestamp: z.string().optional(),
});
export type ExternalAlertWebhook = z.infer<typeof externalAlertWebhookSchema>;

export const externalAlertRawTextSchema = z.object({
  rawText: z.string().min(1),
  strategy_name: z.string().optional(),
  strategy_group: z.string().optional(),
  timestamp: z.string().optional(),
});
export type ExternalAlertRawText = z.infer<typeof externalAlertRawTextSchema>;

export const externalAlertApiKeys = pgTable("external_alert_api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  label: text("label").default("Default"),
  isActive: boolean("is_active").default(true),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertExternalAlertApiKeySchema = createInsertSchema(externalAlertApiKeys).omit({
  id: true,
  createdAt: true,
});
export type InsertExternalAlertApiKey = z.infer<typeof insertExternalAlertApiKeySchema>;
export type ExternalAlertApiKey = typeof externalAlertApiKeys.$inferSelect;

export const partnerConfigs = pgTable("partner_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  sharedSecret: text("shared_secret").notNull(),
  partnerApiKey: text("partner_api_key"),
  isActive: boolean("is_active").default(true),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPartnerConfigSchema = createInsertSchema(partnerConfigs).omit({
  id: true,
  createdAt: true,
});
export type InsertPartnerConfig = z.infer<typeof insertPartnerConfigSchema>;
export type PartnerConfig = typeof partnerConfigs.$inferSelect;

export const partnerUsers = pgTable("partner_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  partnerId: varchar("partner_id").notNull(),
  partnerSubscriberId: text("partner_subscriber_id").notNull(),
  email: text("email").notNull(),
  name: text("name"),
  linkedUserId: varchar("linked_user_id"),
  isActive: boolean("is_active").default(true),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPartnerUserSchema = createInsertSchema(partnerUsers).omit({
  id: true,
  createdAt: true,
});
export type InsertPartnerUser = z.infer<typeof insertPartnerUserSchema>;
export type PartnerUser = typeof partnerUsers.$inferSelect;

export const partnerLoginSchema = z.object({
  token: z.string().min(1),
  partner: z.string().min(1),
});

// Agent Settings - comprehensive auto agent configuration
export const agentSettings = pgTable("agent_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),

  // Core
  enabled: boolean("enabled").default(false),
  mode: text("mode").default("suggest"),
  assetTypes: jsonb("asset_types").default(["stocks"]),
  timezone: text("timezone").default("America/New_York"),
  tradingWindowStart: text("trading_window_start").default("09:35:00"),
  tradingWindowEnd: text("trading_window_end").default("15:50:00"),

  // Risk limits
  riskPerTradeUsd: real("risk_per_trade_usd").default(100),
  maxDailyLossUsd: real("max_daily_loss_usd").default(200),
  maxTradesPerDay: integer("max_trades_per_day").default(2),
  maxConcurrentPositions: integer("max_concurrent_positions").default(2),
  minPrice: real("min_price").default(5),
  maxPrice: real("max_price").default(500),
  minRr: real("min_rr").default(2),

  // Execution
  entryOrderType: text("entry_order_type").default("limit"),
  timeInForce: text("time_in_force").default("day"),
  limitOffsetPercent: real("limit_offset_percent").default(0.05),
  missingStopsPolicy: text("missing_stops_policy").default("skip"),
  bracketEnabled: boolean("bracket_enabled").default(true),
  bracketStopMethod: text("bracket_stop_method").default("signal"),
  bracketStopValue: real("bracket_stop_value"),
  bracketTargetMethod: text("bracket_target_method").default("signal"),
  bracketTargetValue: real("bracket_target_value"),
  optionsBracketEnabled: boolean("options_bracket_enabled").default(false),
  optionsBracketStopMethod: text("options_bracket_stop_method").default("pct"),
  optionsBracketStopValue: real("options_bracket_stop_value").default(50),
  optionsBracketTargetMethod: text("options_bracket_target_method").default("pct"),
  optionsBracketTargetValue: real("options_bracket_target_value").default(100),
  requireStops: boolean("require_stops").default(true),

  // Filters & sizing
  direction: text("direction").default("both"),
  sizingMethod: text("sizing_method").default("riskBased"),
  fixedQuantity: integer("fixed_quantity"),
  fixedNotionalUsd: real("fixed_notional_usd"),
  symbolAllowlist: text("symbol_allowlist").array(),
  symbolBlocklist: text("symbol_blocklist").array(),
  duplicateSignalWindowMinutes: integer("duplicate_signal_window_minutes").default(10),
  cooldownMinutesAfterExit: integer("cooldown_minutes_after_exit").default(15),
  maxPositionsPerSymbol: integer("max_positions_per_symbol").default(1),

  // Scan schedule preferences (JSONB: { windows: { premarket: { enabled, strategies }, vcp: {...}, ... } })
  scanSchedule: jsonb("scan_schedule").default({}),

  // Advanced (JSONB to avoid schema bloat)
  optionsConstraints: jsonb("options_constraints").default({}),
  futuresConstraints: jsonb("futures_constraints").default({}),
  reliability: jsonb("reliability").default({}),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAgentSettingsSchema = createInsertSchema(agentSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAgentSettings = z.infer<typeof insertAgentSettingsSchema>;
export type AgentSettings = typeof agentSettings.$inferSelect;

// Agent Settings Audit Log
export const agentSettingsAudit = pgTable("agent_settings_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  changedBy: varchar("changed_by").notNull(),
  changedAt: timestamp("changed_at").defaultNow(),
  before: jsonb("before").notNull(),
  after: jsonb("after").notNull(),
  source: text("source").default("ui"),
});

export const insertAgentSettingsAuditSchema = createInsertSchema(agentSettingsAudit).omit({
  id: true,
  changedAt: true,
});
export type InsertAgentSettingsAudit = z.infer<typeof insertAgentSettingsAuditSchema>;
export type AgentSettingsAudit = typeof agentSettingsAudit.$inferSelect;

export const autoModeConsents = pgTable("auto_mode_consents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  email: text("email").notNull(),
  consentedAt: timestamp("consented_at").defaultNow(),
  clientIp: text("client_ip").notNull(),
  userAgent: text("user_agent"),
  consentText: text("consent_text").notNull(),
});

export const insertAutoModeConsentSchema = createInsertSchema(autoModeConsents).omit({
  id: true,
  consentedAt: true,
});
export type InsertAutoModeConsent = z.infer<typeof insertAutoModeConsentSchema>;
export type AutoModeConsent = typeof autoModeConsents.$inferSelect;

// Enum-like constants for user system profiles and acceptance types
export const TradingStyle = { DAY: "DAY", SWING: "SWING", AUTO: "AUTO" } as const;
export const MarketScope = { STOCKS: "STOCKS", OPTIONS: "OPTIONS", BOTH: "BOTH" } as const;
export const PersonaGoal = { CONSISTENCY: "CONSISTENCY", SAVE_TIME: "SAVE_TIME", OPPORTUNITIES: "OPPORTUNITIES", REDUCE_EMOTION: "REDUCE_EMOTION" } as const;
export const PersonaRisk = { CONSERVATIVE: "CONSERVATIVE", BALANCED: "BALANCED", AGGRESSIVE: "AGGRESSIVE" } as const;
export const AcceptanceType = { WIZARD_AUTOPILOT_ENABLE: "WIZARD_AUTOPILOT_ENABLE", DASHBOARD_RECONFIRM: "DASHBOARD_RECONFIRM", TERMS_UPDATE: "TERMS_UPDATE", AUTO_AGENT_ENABLE: "AUTO_AGENT_ENABLE", AUTO_MODE_CONSENT: "AUTO_MODE_CONSENT", PARTNER_AUTO_MODE: "PARTNER_AUTO_MODE", LEGAL_TERMS: "LEGAL_TERMS", OTHER: "OTHER" } as const;

// User System Profiles - stores trading style, market scope, and persona information
export const userSystemProfiles = pgTable("user_system_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  version: integer("version").notNull().default(1),
  tradingStyle: text("trading_style").notNull().default("AUTO"),
  marketScope: text("market_scope").notNull().default("STOCKS"),
  personaGoal: text("persona_goal"),
  personaRisk: text("persona_risk"),
  personaLabel: text("persona_label"),
  riskPerTradeUsd: integer("risk_per_trade_usd").default(500),
  maxTradesPerDay: integer("max_trades_per_day").default(2),
  minConfidenceThreshold: integer("min_confidence_threshold").default(90),
  strategyBundleId: text("strategy_bundle_id"),
  automationEnabled: boolean("automation_enabled").default(false),
  simpleMode: boolean("simple_mode").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSystemProfileSchema = createInsertSchema(userSystemProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUserSystemProfile = z.infer<typeof insertUserSystemProfileSchema>;
export type UserSystemProfile = typeof userSystemProfiles.$inferSelect;

// User Advanced Configs - stores strategy parameters, filters, and overrides as JSON
export const userAdvancedConfigs = pgTable("user_advanced_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  strategyParamsJson: jsonb("strategy_params_json"),
  filtersJson: jsonb("filters_json"),
  overridesJson: jsonb("overrides_json"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserAdvancedConfigSchema = createInsertSchema(userAdvancedConfigs).omit({
  id: true,
  updatedAt: true,
});
export type InsertUserAdvancedConfig = z.infer<typeof insertUserAdvancedConfigSchema>;
export type UserAdvancedConfig = typeof userAdvancedConfigs.$inferSelect;

// User Onboarding States - tracks user onboarding progress
export const userOnboardingStates = pgTable("user_onboarding_states", {
  userId: varchar("user_id").primaryKey(),
  wizardCompletedAt: timestamp("wizard_completed_at"),
  firstTradeExecutedAt: timestamp("first_trade_executed_at"),
  firstTradeCelebrationSeen: boolean("first_trade_celebration_seen").default(false),
  lastWizardVersionSeen: integer("last_wizard_version_seen").default(0),
});

export const insertUserOnboardingStateSchema = createInsertSchema(userOnboardingStates);
export type InsertUserOnboardingState = z.infer<typeof insertUserOnboardingStateSchema>;
export type UserOnboardingState = typeof userOnboardingStates.$inferSelect;

// Disclaimer Acceptance Logs - audit trail for disclaimer acceptances
export const disclaimerAcceptanceLogs = pgTable("disclaimer_acceptance_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  userEmail: text("user_email"),
  userName: text("user_name"),
  acceptanceType: text("acceptance_type").notNull(),
  disclaimerVersion: text("disclaimer_version").notNull(),
  disclaimerHash: text("disclaimer_hash").notNull(),
  accepted: boolean("accepted").notNull().default(true),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
  metadataJson: jsonb("metadata_json"),
});

export const insertDisclaimerAcceptanceLogSchema = createInsertSchema(disclaimerAcceptanceLogs).omit({
  id: true,
  createdAt: true,
});
export type InsertDisclaimerAcceptanceLog = z.infer<typeof insertDisclaimerAcceptanceLogSchema>;
export type DisclaimerAcceptanceLog = typeof disclaimerAcceptanceLogs.$inferSelect;

export const customStrategies = pgTable("custom_strategies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  assetType: text("asset_type").notNull().default("stock"),
  timeframe: text("timeframe"),
  rulesJson: jsonb("rules_json"),
  sourceText: text("source_text"),
  validationStatus: text("validation_status").notNull().default("draft"),
  isEnabled: boolean("is_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCustomStrategySchema = createInsertSchema(customStrategies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCustomStrategy = z.infer<typeof insertCustomStrategySchema>;
export type CustomStrategy = typeof customStrategies.$inferSelect;

export const tradeSetupHistory = pgTable("trade_setup_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol").notNull(),
  strategyName: text("strategy_name").notNull(),
  assetType: text("asset_type").notNull().default("stock"),
  timeframe: text("timeframe"),
  setupJson: jsonb("setup_json"),
  modelScore: integer("model_score"),
  status: text("status").notNull().default("generated"),
  sentToInstatrade: boolean("sent_to_instatrade").default(false),
  sourceMode: text("source_mode"),
  userCapital: integer("user_capital"),
  monthlyTarget: integer("monthly_target"),
  maxRiskPerTrade: integer("max_risk_per_trade"),
  allowedInstruments: text("allowed_instruments").array(),
  activityLevel: text("activity_level"),
  goalType: text("goal_type"),
  realityCheckText: text("reality_check_text"),
  complianceAcknowledged: boolean("compliance_acknowledged").default(false),
  orderReviewedAt: timestamp("order_reviewed_at"),
  userConfirmedOrder: boolean("user_confirmed_order").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTradeSetupHistorySchema = createInsertSchema(tradeSetupHistory).omit({
  id: true,
  createdAt: true,
});
export type InsertTradeSetupHistory = z.infer<typeof insertTradeSetupHistorySchema>;
export type TradeSetupHistory = typeof tradeSetupHistory.$inferSelect;

export const opportunityScenarios = pgTable("opportunity_scenarios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  sourceMode: text("source_mode").notNull().default("opportunity_radar"),
  symbol: text("symbol").notNull(),
  companyName: text("company_name"),
  strategyType: text("strategy_type").notNull(),
  bias: text("bias"),
  finalGrade: text("final_grade"),
  finalScore: integer("final_score"),
  technicalScore: integer("technical_score"),
  sentimentScore: integer("sentiment_score"),
  momentumScore: integer("momentum_score"),
  liquidityScore: integer("liquidity_score"),
  riskScore: integer("risk_score"),
  thesis: text("thesis"),
  mainReason: text("main_reason"),
  mainRisk: text("main_risk"),
  entry: real("entry"),
  stop: real("stop"),
  target: real("target"),
  maxLoss: real("max_loss"),
  maxGain: real("max_gain"),
  breakeven: real("breakeven"),
  capitalRequired: real("capital_required"),
  expiration: text("expiration"),
  strikes: text("strikes"),
  orderPreviewJson: jsonb("order_preview_json"),
  dataMode: text("data_mode"),
  brokerConnected: boolean("broker_connected").default(false),
  reviewedAt: timestamp("reviewed_at"),
  paperTradedAt: timestamp("paper_traded_at"),
  preparedOrderAt: timestamp("prepared_order_at"),
  sentOrderAt: timestamp("sent_order_at"),
  complianceAcknowledged: boolean("compliance_acknowledged").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOpportunityScenarioSchema = createInsertSchema(opportunityScenarios).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOpportunityScenario = z.infer<typeof insertOpportunityScenarioSchema>;
export type OpportunityScenario = typeof opportunityScenarios.$inferSelect;

// News Sentiment — per-article AI analysis cache
export const newsSentiment = pgTable("news_sentiment", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  articleHash: text("article_hash").notNull().unique(),
  symbol: text("symbol"),
  headline: text("headline").notNull(),
  source: text("source"),
  url: text("url"),
  publishedAt: timestamp("published_at"),
  rawSummary: text("raw_summary"),
  aiSummary: text("ai_summary"),
  sentimentLabel: text("sentiment_label"),
  sentimentScore: real("sentiment_score"),
  confidence: real("confidence"),
  impactLevel: text("impact_level"),
  timeHorizon: text("time_horizon"),
  whyItMatters: text("why_it_matters"),
  bullishDrivers: jsonb("bullish_drivers"),
  bearishDrivers: jsonb("bearish_drivers"),
  riskWarnings: jsonb("risk_warnings"),
  affectedSymbols: jsonb("affected_symbols"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertNewsSentimentSchema = createInsertSchema(newsSentiment).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertNewsSentiment = z.infer<typeof insertNewsSentimentSchema>;
export type NewsSentiment = typeof newsSentiment.$inferSelect;

// Ticker-level sentiment snapshot (rollup of recent articles)
export const tickerSentimentSnapshot = pgTable("ticker_sentiment_snapshot", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull().unique(),
  sentimentLabel: text("sentiment_label").notNull(),
  sentimentScore: real("sentiment_score").notNull(),
  confidence: real("confidence").notNull(),
  impactLevel: text("impact_level").notNull(),
  buzzScore: real("buzz_score").notNull(),
  articleCount: integer("article_count").notNull(),
  topThemes: jsonb("top_themes"),
  whyItMatters: text("why_it_matters"),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

export const insertTickerSentimentSnapshotSchema = createInsertSchema(tickerSentimentSnapshot).omit({
  id: true,
  lastUpdated: true,
});
export type InsertTickerSentimentSnapshot = z.infer<typeof insertTickerSentimentSnapshotSchema>;
export type TickerSentimentSnapshot = typeof tickerSentimentSnapshot.$inferSelect;

export const promptRequestLogs = pgTable("prompt_request_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  prompt: text("prompt").notNull(),
  resolvedIntent: text("resolved_intent"),
  resolvedSymbol: text("resolved_symbol"),
  resolvedStrategy: text("resolved_strategy"),
  requestJson: jsonb("request_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPromptRequestLogSchema = createInsertSchema(promptRequestLogs).omit({
  id: true,
  createdAt: true,
});
export type InsertPromptRequestLog = z.infer<typeof insertPromptRequestLogSchema>;
export type PromptRequestLog = typeof promptRequestLogs.$inferSelect;

export const activityLogs = pgTable("activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  eventType: text("event_type").notNull(),
  description: text("description").notNull(),
  metadataJson: jsonb("metadata_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  createdAt: true,
});
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;

export const agentSkippedTrades = pgTable("agent_skipped_trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol").notNull(),
  skipReason: text("skip_reason").notNull(),
  source: text("source").notNull(),
  price: real("price"),
  strategyId: text("strategy_id"),
  assetType: text("asset_type").default("equity"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentSkippedTradeSchema = createInsertSchema(agentSkippedTrades).omit({
  id: true,
  createdAt: true,
});
export type InsertAgentSkippedTrade = z.infer<typeof insertAgentSkippedTradeSchema>;
export type AgentSkippedTrade = typeof agentSkippedTrades.$inferSelect;

export const analysisConditions = pgTable("analysis_conditions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  label: text("label").notNull(),
  category: text("category").notNull().default("custom"),
  conditionType: text("condition_type").notNull(),
  operator: text("operator").notNull().default("gte"),
  value: text("value").notNull(),
  isBuiltIn: boolean("is_built_in").default(false),
  isEnabled: boolean("is_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAnalysisConditionSchema = createInsertSchema(analysisConditions).omit({
  id: true,
  createdAt: true,
});
export type InsertAnalysisCondition = z.infer<typeof insertAnalysisConditionSchema>;
export type AnalysisCondition = typeof analysisConditions.$inferSelect;

// ============================================================
// Probability Engine + Instrument Selector + Options + Outcomes
// ============================================================

export const setupScores = pgTable("setup_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  setupId: varchar("setup_id").notNull(),
  finalScore: real("final_score").notNull(),
  technicalScore: real("technical_score").notNull(),
  realtimeScore: real("realtime_score").notNull(),
  newsScore: real("news_score").notNull(),
  analystScore: real("analyst_score").notNull(),
  riskScore: real("risk_score").notNull(),
  grade: text("grade").notNull(),
  reasonsJson: jsonb("reasons_json"),
  warningsJson: jsonb("warnings_json"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertSetupScoreSchema = createInsertSchema(setupScores).omit({ id: true, createdAt: true });
export type InsertSetupScore = z.infer<typeof insertSetupScoreSchema>;
export type SetupScore = typeof setupScores.$inferSelect;

export const instrumentRecommendations = pgTable("instrument_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  setupId: varchar("setup_id").notNull(),
  recommendedInstrumentType: text("recommended_instrument_type").notNull(),
  alternativeInstrumentType: text("alternative_instrument_type"),
  vehicleScore: real("vehicle_score"),
  recommendationJson: jsonb("recommendation_json"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertInstrumentRecommendationSchema = createInsertSchema(instrumentRecommendations).omit({ id: true, createdAt: true });
export type InsertInstrumentRecommendation = z.infer<typeof insertInstrumentRecommendationSchema>;
export type InstrumentRecommendation = typeof instrumentRecommendations.$inferSelect;

export const optionCandidates = pgTable("option_candidates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  setupId: varchar("setup_id").notNull(),
  symbol: text("symbol").notNull(),
  expiry: text("expiry").notNull(),
  strikeLong: real("strike_long").notNull(),
  strikeShort: real("strike_short"),
  optionType: text("option_type").notNull(),
  strategyType: text("strategy_type").notNull(),
  delta: real("delta"),
  iv: real("iv"),
  bid: real("bid"),
  ask: real("ask"),
  mid: real("mid"),
  openInterest: integer("open_interest"),
  volume: integer("volume"),
  maxProfit: real("max_profit"),
  maxLoss: real("max_loss"),
  breakeven: real("breakeven"),
  suitabilityScore: real("suitability_score"),
  detailsJson: jsonb("details_json"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertOptionCandidateSchema = createInsertSchema(optionCandidates).omit({ id: true, createdAt: true });
export type InsertOptionCandidate = z.infer<typeof insertOptionCandidateSchema>;
export type OptionCandidate = typeof optionCandidates.$inferSelect;

export const tradeOutcomes = pgTable("trade_outcomes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  setupId: varchar("setup_id"),
  symbol: text("symbol").notNull(),
  executedInstrumentType: text("executed_instrument_type").notNull(),
  strategy: text("strategy"),
  scoreAtEntry: real("score_at_entry"),
  vehicleScoreAtEntry: real("vehicle_score_at_entry"),
  entryTime: timestamp("entry_time"),
  exitTime: timestamp("exit_time"),
  entryPrice: real("entry_price"),
  exitPrice: real("exit_price"),
  quantity: real("quantity"),
  pnl: real("pnl"),
  pnlPercent: real("pnl_percent"),
  outcomeLabel: text("outcome_label"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertTradeOutcomeSchema = createInsertSchema(tradeOutcomes).omit({ id: true, createdAt: true });
export type InsertTradeOutcome = z.infer<typeof insertTradeOutcomeSchema>;
export type TradeOutcome = typeof tradeOutcomes.$inferSelect;

export const userTradePreferences = pgTable("user_trade_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  allowStocks: boolean("allow_stocks").default(true),
  allowLongCalls: boolean("allow_long_calls").default(true),
  allowLongPuts: boolean("allow_long_puts").default(true),
  allowDebitSpreads: boolean("allow_debit_spreads").default(true),
  allowCreditSpreads: boolean("allow_credit_spreads").default(false),
  definedRiskOnly: boolean("defined_risk_only").default(false),
  preferredDteMin: integer("preferred_dte_min").default(7),
  preferredDteMax: integer("preferred_dte_max").default(45),
  minOpenInterest: integer("min_open_interest").default(100),
  minOptionVolume: integer("min_option_volume").default(50),
  maxBidAskSpreadPct: real("max_bid_ask_spread_pct").default(10.0),
  minRewardRisk: real("min_reward_risk").default(1.5),
  minProbabilityScore: integer("min_probability_score").default(65),
  defaultOrderType: text("default_order_type").default("limit"),
  requireConfirmation: boolean("require_confirmation").default(true),
  onboardingStatus: text("onboarding_status").default("not_started"),
  quickSetupCompleted: boolean("quick_setup_completed").default(false),
  fullPersonalizationCompleted: boolean("full_personalization_completed").default(false),
  personalizationDismissed: boolean("personalization_dismissed").default(false),
  preferredGoal: text("preferred_goal"),
  preferredInstruments: text("preferred_instruments"),
  preferredRiskAmount: real("preferred_risk_amount"),
  interfaceMode: text("interface_mode").default("guided"),
  liveSetupCompleted: boolean("live_setup_completed").default(false),
  maxDollarRisk: real("max_dollar_risk"),
  maxAccountRiskPercent: real("max_account_risk_percent"),
  optionsAcknowledgedAt: timestamp("options_acknowledged_at"),
  executionDisclosureAcceptedAt: timestamp("execution_disclosure_accepted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertUserTradePreferencesSchema = createInsertSchema(userTradePreferences).omit({ id: true, createdAt: true, updatedAt: true });

export const savedCandidates = pgTable("saved_candidates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  candidateId: varchar("candidate_id"),
  symbol: text("symbol").notNull(),
  strategy: text("strategy"),
  grade: text("grade"),
  status: text("status").default("saved"),
  notes: text("notes"),
  savedAt: timestamp("saved_at").defaultNow(),
});
export const insertSavedCandidateSchema = createInsertSchema(savedCandidates).omit({ id: true, savedAt: true });
export type InsertSavedCandidate = z.infer<typeof insertSavedCandidateSchema>;
export type SavedCandidate = typeof savedCandidates.$inferSelect;
export type InsertUserTradePreferences = z.infer<typeof insertUserTradePreferencesSchema>;
export type UserTradePreferences = typeof userTradePreferences.$inferSelect;

export const sessionAuditEvents = pgTable("session_audit_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  email: text("email"),
  eventType: text("event_type").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  deviceType: text("device_type"),
  browser: text("browser"),
  os: text("os"),
  country: text("country"),
  region: text("region"),
  city: text("city"),
  referrer: text("referrer"),
  path: text("path"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertSessionAuditEventSchema = createInsertSchema(sessionAuditEvents).omit({ id: true, createdAt: true });
export type InsertSessionAuditEvent = z.infer<typeof insertSessionAuditEventSchema>;
export type SessionAuditEvent = typeof sessionAuditEvents.$inferSelect;

export const cookieConsents = pgTable("cookie_consents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  email: text("email"),
  decision: text("decision").notNull(), // "accepted" | "denied"
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  country: text("country"),
  region: text("region"),
  city: text("city"),
  path: text("path"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertCookieConsentSchema = createInsertSchema(cookieConsents).omit({ id: true, createdAt: true });
export type InsertCookieConsent = z.infer<typeof insertCookieConsentSchema>;
export type CookieConsent = typeof cookieConsents.$inferSelect;

export const emailCampaigns = pgTable("email_campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  audienceType: text("audience_type").notNull(),
  recipientUserId: varchar("recipient_user_id"),
  status: text("status").notNull().default("draft"),
  sentCount: integer("sent_count").default(0),
  deliveredCount: integer("delivered_count").default(0),
  openedCount: integer("opened_count").default(0),
  clickedCount: integer("clicked_count").default(0),
  bouncedCount: integer("bounced_count").default(0),
  unsubscribedCount: integer("unsubscribed_count").default(0),
  errorMessage: text("error_message"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  sentAt: timestamp("sent_at"),
});
export const insertEmailCampaignSchema = createInsertSchema(emailCampaigns).omit({
  id: true,
  createdAt: true,
  sentAt: true,
  sentCount: true,
  deliveredCount: true,
  openedCount: true,
  clickedCount: true,
  bouncedCount: true,
  unsubscribedCount: true,
});
export type InsertEmailCampaign = z.infer<typeof insertEmailCampaignSchema>;
export type EmailCampaign = typeof emailCampaigns.$inferSelect;

// AI Agent Test Suite — admin-only QA harness for the trading AI agent.
// `agent_test_questions` is the seeded question bank (160 prompts across
// trading/options/futures/compliance categories). `agent_test_runs` stores
// every execution so admins can review the AI answer, the validator's grade,
// and any compliance flags over time.
export const agentTestQuestions = pgTable("agent_test_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: text("category").notNull(),
  difficulty: text("difficulty").notNull(), // beginner | intermediate | advanced
  question: text("question").notNull(),
  expectedAnswerGuidelines: text("expected_answer_guidelines").notNull(),
  requiredConcepts: jsonb("required_concepts").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  forbiddenClaims: jsonb("forbidden_claims").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  complianceRules: jsonb("compliance_rules").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  scoringRubric: text("scoring_rubric").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const agentTestRuns = pgTable("agent_test_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  questionId: varchar("question_id").notNull(),
  category: text("category").notNull(),
  difficulty: text("difficulty").notNull(),
  question: text("question").notNull(),
  aiAnswer: text("ai_answer").notNull(),
  score: integer("score").notNull().default(0),
  status: text("status").notNull(), // pass | needs_review | fail | error
  validationJson: jsonb("validation_json").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentTestQuestionSchema = createInsertSchema(agentTestQuestions).omit({
  id: true,
  createdAt: true,
});
export const insertAgentTestRunSchema = createInsertSchema(agentTestRuns).omit({
  id: true,
  createdAt: true,
});
export type InsertAgentTestQuestion = z.infer<typeof insertAgentTestQuestionSchema>;
export type AgentTestQuestion = typeof agentTestQuestions.$inferSelect;
export type InsertAgentTestRun = z.infer<typeof insertAgentTestRunSchema>;
export type AgentTestRun = typeof agentTestRuns.$inferSelect;

// Curated reference answers promoted from the AI Agent Test Suite. When an
// admin "promotes" a test run, the recorded answer becomes a few-shot
// example injected into the live agent's system prompt for matching
// questions. Keyed by questionId so each seed question can have at most one
// canonical reference at a time.
export const agentReferenceAnswers = pgTable("agent_reference_answers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  questionId: varchar("question_id").notNull().unique(),
  question: text("question").notNull(),
  category: text("category").notNull(),
  referenceAnswer: text("reference_answer").notNull(),
  score: integer("score").default(0),
  sourceRunId: varchar("source_run_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAgentReferenceAnswerSchema = createInsertSchema(agentReferenceAnswers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAgentReferenceAnswer = z.infer<typeof insertAgentReferenceAnswerSchema>;
export type AgentReferenceAnswer = typeof agentReferenceAnswers.$inferSelect;

// User-provided Schwab developer-app credentials (Advanced BYO mode).
// Existence of a row with credentialMode='user_credentials' tells the Schwab
// OAuth + refresh code paths to use these creds instead of the platform env
// vars. Client ID and client secret are stored encrypted at rest.
export const userBrokerCredentials = pgTable("user_broker_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  provider: text("provider").notNull().default("schwab"),
  credentialMode: text("credential_mode").notNull().default("platform_credentials"),
  encryptedClientId: text("encrypted_client_id"),
  clientIdIv: text("client_id_iv"),
  clientIdAuthTag: text("client_id_auth_tag"),
  encryptedClientSecret: text("encrypted_client_secret"),
  clientSecretIv: text("client_secret_iv"),
  clientSecretAuthTag: text("client_secret_auth_tag"),
  redirectUri: text("redirect_uri"),
  lastError: text("last_error"),
  lastRefreshSuccessAt: timestamp("last_refresh_success_at"),
  reconnectRequired: boolean("reconnect_required").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type UserBrokerCredentials = typeof userBrokerCredentials.$inferSelect;

// ============================================================
// Twelve Data / Daily Market Data integration (provider-neutral)
// ============================================================

// Provider licensing record. Environment variables remain the final safety
// control — a permissive DB value must never override a restrictive env var.
export const marketDataLicenseConfig = pgTable("market_data_license_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull().unique(),
  planName: text("plan_name").notNull(),
  licenseMode: text("license_mode").notNull().default("prelaunch"), // disabled | prelaunch | external
  externalDisplayEnabled: boolean("external_display_enabled").notNull().default(false),
  effectiveDate: date("effective_date"),
  attributionRequired: boolean("attribution_required").notNull().default(true),
  confirmationReference: text("confirmation_reference"),
  notes: text("notes"),
  updatedBy: varchar("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type MarketDataLicenseConfig = typeof marketDataLicenseConfig.$inferSelect;

// Curated, admin-managed symbol universe for daily ingestion.
export const marketDataSymbols = pgTable("market_data_symbols", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull().unique(),
  companyName: text("company_name"),
  assetType: text("asset_type").notNull().default("equity"), // equity | etf
  exchange: text("exchange"),
  sector: text("sector"),
  provider: text("provider").notNull().default("twelve_data"),
  providerSymbol: text("provider_symbol"),
  enabled: boolean("enabled").notNull().default(true),
  internalAnalysisEnabled: boolean("internal_analysis_enabled").notNull().default(true),
  futureTrialEnabled: boolean("future_trial_enabled").notNull().default(false),
  trialEnabled: boolean("trial_enabled").notNull().default(false),
  paidEnabled: boolean("paid_enabled").notNull().default(false),
  brokerConnectedEnabled: boolean("broker_connected_enabled").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  backfillYears: integer("backfill_years").notNull().default(2),
  lastSuccessfulIngestionAt: timestamp("last_successful_ingestion_at"),
  latestAvailableTradeDate: date("latest_available_trade_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertMarketDataSymbolSchema = createInsertSchema(marketDataSymbols).omit({
  id: true,
  lastSuccessfulIngestionAt: true,
  latestAvailableTradeDate: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMarketDataSymbol = z.infer<typeof insertMarketDataSymbolSchema>;
export type MarketDataSymbol = typeof marketDataSymbols.$inferSelect;

// Normalized historical daily OHLCV bars. Prices use numeric (never float).
export const marketDailyBars = pgTable("market_daily_bars", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  tradeDate: date("trade_date").notNull(),
  open: numeric("open", { precision: 18, scale: 6 }).notNull(),
  high: numeric("high", { precision: 18, scale: 6 }).notNull(),
  low: numeric("low", { precision: 18, scale: 6 }).notNull(),
  close: numeric("close", { precision: 18, scale: 6 }).notNull(),
  adjustedClose: numeric("adjusted_close", { precision: 18, scale: 6 }),
  volume: bigint("volume", { mode: "number" }).notNull(),
  dataProvider: text("data_provider").notNull().default("twelve_data"),
  providerTimestamp: text("provider_timestamp"),
  ingestedAt: timestamp("ingested_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  validatedAt: timestamp("validated_at"),
  isComplete: boolean("is_complete").notNull().default(true),
  isAdjusted: boolean("is_adjusted").notNull().default(false),
  dataVersion: integer("data_version").notNull().default(1),
  checksum: text("checksum"),
}, (t) => ({
  uqSymbolDateProvider: uniqueIndex("uq_mdb_symbol_date_provider").on(t.symbol, t.tradeDate, t.dataProvider),
  idxSymbolDate: index("idx_mdb_symbol_date").on(t.symbol, t.tradeDate),
  idxTradeDate: index("idx_mdb_trade_date").on(t.tradeDate),
  idxSymbolComplete: index("idx_mdb_symbol_complete").on(t.symbol, t.isComplete),
}));
export type MarketDailyBar = typeof marketDailyBars.$inferSelect;

export const marketDataIngestionRuns = pgTable("market_data_ingestion_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull().default("twelve_data"),
  runType: text("run_type").notNull(), // backfill | daily | manual | health_check | repair
  environment: text("environment").notNull().default("development"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  status: text("status").notNull().default("pending"), // pending|running|partially_completed|completed|failed|cancelled|deferred_quota
  symbolsRequested: integer("symbols_requested").notNull().default(0),
  symbolsSucceeded: integer("symbols_succeeded").notNull().default(0),
  symbolsFailed: integer("symbols_failed").notNull().default(0),
  creditsReserved: integer("credits_reserved").notNull().default(0),
  creditsUsed: integer("credits_used").notNull().default(0),
  recordsInserted: integer("records_inserted").notNull().default(0),
  recordsUpdated: integer("records_updated").notNull().default(0),
  errorSummary: text("error_summary"),
  initiatedBy: varchar("initiated_by"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type MarketDataIngestionRun = typeof marketDataIngestionRuns.$inferSelect;

export const marketDataIngestionItems = pgTable("market_data_ingestion_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ingestionRunId: varchar("ingestion_run_id").notNull(),
  symbol: text("symbol").notNull(),
  status: text("status").notNull().default("pending"),
  creditsUsed: integer("credits_used").notNull().default(0),
  recordsReceived: integer("records_received").notNull().default(0),
  recordsInserted: integer("records_inserted").notNull().default(0),
  recordsUpdated: integer("records_updated").notNull().default(0),
  latestTradeDate: date("latest_trade_date"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (t) => ({
  idxRun: index("idx_mdii_run").on(t.ingestionRunId),
}));
export type MarketDataIngestionItem = typeof marketDataIngestionItems.$inferSelect;

// Internally calculated daily indicators (versioned).
export const dailyIndicators = pgTable("daily_indicators", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  tradeDate: date("trade_date").notNull(),
  sma10: numeric("sma10", { precision: 18, scale: 6 }),
  sma20: numeric("sma20", { precision: 18, scale: 6 }),
  sma50: numeric("sma50", { precision: 18, scale: 6 }),
  sma100: numeric("sma100", { precision: 18, scale: 6 }),
  sma200: numeric("sma200", { precision: 18, scale: 6 }),
  ema8: numeric("ema8", { precision: 18, scale: 6 }),
  ema21: numeric("ema21", { precision: 18, scale: 6 }),
  rsi14: numeric("rsi14", { precision: 10, scale: 4 }),
  atr14: numeric("atr14", { precision: 18, scale: 6 }),
  averageVolume20: bigint("average_volume20", { mode: "number" }),
  relativeVolume: numeric("relative_volume", { precision: 10, scale: 4 }),
  return1d: numeric("return_1d", { precision: 10, scale: 6 }),
  return5d: numeric("return_5d", { precision: 10, scale: 6 }),
  return20d: numeric("return_20d", { precision: 10, scale: 6 }),
  historicalVolatility20: numeric("historical_volatility20", { precision: 10, scale: 6 }),
  distanceFrom52WeekHigh: numeric("distance_from_52_week_high", { precision: 10, scale: 6 }),
  trendScore: integer("trend_score"),
  momentumScore: integer("momentum_score"),
  volumeScore: integer("volume_score"),
  riskScore: integer("risk_score"),
  calculationVersion: integer("calculation_version").notNull().default(1),
  calculatedAt: timestamp("calculated_at").defaultNow(),
}, (t) => ({
  uqSymbolDateVersion: uniqueIndex("uq_di_symbol_date_version").on(t.symbol, t.tradeDate, t.calculationVersion),
  idxSymbolDate: index("idx_di_symbol_date").on(t.symbol, t.tradeDate),
}));
export type DailyIndicatorRow = typeof dailyIndicators.$inferSelect;

// Published internal daily analysis snapshots.
export const dailyAnalysisSnapshots = pgTable("daily_analysis_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  analysisDate: date("analysis_date").notNull(),
  marketDataAsOf: date("market_data_as_of").notNull(),
  compositeScore: integer("composite_score").notNull(),
  compositeGrade: text("composite_grade").notNull(),
  technicalScore: integer("technical_score"),
  momentumScore: integer("momentum_score"),
  volumeScore: integer("volume_score"),
  trendScore: integer("trend_score"),
  riskScore: integer("risk_score"),
  conditionsPassed: jsonb("conditions_passed").$type<string[]>().default([]),
  conditionsFailed: jsonb("conditions_failed").$type<string[]>().default([]),
  setupType: text("setup_type"),
  summary: text("summary"),
  strengths: jsonb("strengths").$type<string[]>().default([]),
  risks: jsonb("risks").$type<string[]>().default([]),
  dataProvider: text("data_provider").notNull().default("twelve_data"),
  modelVersion: text("model_version"),
  calculationVersion: integer("calculation_version").notNull().default(1),
  accessScope: text("access_scope").notNull().default("internal"), // internal | external_trial | external_paid
  generatedAt: timestamp("generated_at").defaultNow(),
  publishedAt: timestamp("published_at"),
  isCurrent: boolean("is_current").notNull().default(false),
}, (t) => ({
  idxSymbolCurrent: index("idx_das_symbol_current").on(t.symbol, t.isCurrent),
  idxAnalysisDate: index("idx_das_analysis_date").on(t.analysisDate),
}));
export type DailyAnalysisSnapshot = typeof dailyAnalysisSnapshots.$inferSelect;

// Persistent (multi-instance safe) provider credit accounting.
export const marketDataCreditUsage = pgTable("market_data_credit_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull().default("twelve_data"),
  windowType: text("window_type").notNull(), // minute | day
  windowStart: timestamp("window_start").notNull(),
  creditsUsed: integer("credits_used").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uqProviderWindow: uniqueIndex("uq_mdcu_provider_window").on(t.provider, t.windowType, t.windowStart),
}));
export type MarketDataCreditUsage = typeof marketDataCreditUsage.$inferSelect;

// Per-request credit ledger for admin visibility / auditing.
export const marketDataRequestLog = pgTable("market_data_request_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull().default("twelve_data"),
  endpoint: text("endpoint").notNull(),
  endpointWeight: integer("endpoint_weight").notNull().default(1),
  symbolsRequested: jsonb("symbols_requested").$type<string[]>().default([]),
  creditsUsed: integer("credits_used").notNull().default(0),
  status: text("status").notNull(), // success | error | deferred
  retryCount: integer("retry_count").notNull().default(0),
  durationMs: integer("duration_ms"),
  ingestionRunId: varchar("ingestion_run_id"),
  environment: text("environment"),
  caller: text("caller"),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  idxCreatedAt: index("idx_mdrl_created_at").on(t.createdAt),
}));
export type MarketDataRequestLog = typeof marketDataRequestLog.$inferSelect;

// ============================================================
// Resend Email Service: messages, events, support tickets,
// suppressions, and admin email settings.
// ============================================================

export const emailMessages = pgTable("email_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull().default("resend"),
  providerMessageId: text("provider_message_id"),
  direction: text("direction").notNull(), // INBOUND | OUTBOUND
  messageType: text("message_type").notNull().default("general"), // welcome | password_reset | support_ack | support_reply | forward | campaign | ...
  fromAddress: text("from_address").notNull(),
  fromName: text("from_name"),
  toAddresses: text("to_addresses").array().notNull().default(sql`'{}'::text[]`),
  ccAddresses: text("cc_addresses").array().notNull().default(sql`'{}'::text[]`),
  bccAddresses: text("bcc_addresses").array().notNull().default(sql`'{}'::text[]`),
  replyTo: text("reply_to"),
  subject: text("subject").notNull().default(""),
  textBody: text("text_body"),
  sanitizedHtmlBody: text("sanitized_html_body"),
  status: text("status").notNull().default("QUEUED"), // QUEUED | SENT | DELIVERED | DELAYED | BOUNCED | COMPLAINED | FAILED | RECEIVED
  receivedAt: timestamp("received_at"),
  sentAt: timestamp("sent_at"),
  userId: varchar("user_id"),
  ticketId: varchar("ticket_id"),
  threadKey: text("thread_key"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxEmailMsgProviderMsg: index("idx_email_msg_provider_msg").on(t.providerMessageId),
  idxEmailMsgUser: index("idx_email_msg_user").on(t.userId),
  idxEmailMsgTicket: index("idx_email_msg_ticket").on(t.ticketId),
  idxEmailMsgStatus: index("idx_email_msg_status").on(t.status),
  idxEmailMsgCreated: index("idx_email_msg_created").on(t.createdAt),
}));
export type EmailMessage = typeof emailMessages.$inferSelect;
export const insertEmailMessageSchema = createInsertSchema(emailMessages).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmailMessage = z.infer<typeof insertEmailMessageSchema>;

export const emailEvents = pgTable("email_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull().default("resend"),
  providerEventId: text("provider_event_id").notNull(),
  providerMessageId: text("provider_message_id"),
  eventType: text("event_type").notNull(),
  payloadMetadata: jsonb("payload_metadata").$type<Record<string, unknown>>().default({}),
  occurredAt: timestamp("occurred_at"),
  processedAt: timestamp("processed_at"),
  processingStatus: text("processing_status").notNull().default("pending"), // pending | processed | failed | skipped_duplicate
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  uqEmailEventProviderEvent: uniqueIndex("uq_email_event_provider_event").on(t.provider, t.providerEventId),
  idxEmailEventMsg: index("idx_email_event_msg").on(t.providerMessageId),
  idxEmailEventCreated: index("idx_email_event_created").on(t.createdAt),
}));
export type EmailEvent = typeof emailEvents.$inferSelect;

export const supportTickets = pgTable("support_tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketNumber: text("ticket_number").notNull(),
  userId: varchar("user_id"),
  requesterEmail: text("requester_email").notNull(),
  requesterName: text("requester_name"),
  subject: text("subject").notNull().default(""),
  category: text("category").notNull().default("General"),
  priority: text("priority").notNull().default("NORMAL"), // LOW | NORMAL | HIGH | URGENT
  status: text("status").notNull().default("open"), // open | waiting_on_customer | resolved | closed
  assignedToUserId: varchar("assigned_to_user_id"),
  aiSummary: text("ai_summary"),
  aiSuggestedReply: text("ai_suggested_reply"),
  internalNotes: jsonb("internal_notes").$type<Array<{ authorId: string; note: string; at: string }>>().default([]),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uqTicketNumber: uniqueIndex("uq_support_ticket_number").on(t.ticketNumber),
  idxTicketRequester: index("idx_support_ticket_requester").on(t.requesterEmail),
  idxTicketUser: index("idx_support_ticket_user").on(t.userId),
  idxTicketStatus: index("idx_support_ticket_status").on(t.status),
  idxTicketCreated: index("idx_support_ticket_created").on(t.createdAt),
}));
export type SupportTicket = typeof supportTickets.$inferSelect;

export const supportMessages = pgTable("support_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull(),
  emailMessageId: varchar("email_message_id"),
  direction: text("direction").notNull(), // INBOUND | OUTBOUND
  senderType: text("sender_type").notNull(), // customer | admin | system
  senderEmail: text("sender_email").notNull(),
  bodyText: text("body_text"),
  sanitizedBodyHtml: text("sanitized_body_html"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  idxSupportMsgTicket: index("idx_support_msg_ticket").on(t.ticketId),
  idxSupportMsgCreated: index("idx_support_msg_created").on(t.createdAt),
}));
export type SupportMessage = typeof supportMessages.$inferSelect;

export const emailSuppressions = pgTable("email_suppressions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  emailAddress: text("email_address").notNull(),
  reason: text("reason").notNull(), // bounced | complained | manual
  source: text("source").notNull().default("resend"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uqSuppressionEmail: uniqueIndex("uq_email_suppression_address").on(t.emailAddress),
}));
export type EmailSuppression = typeof emailSuppressions.$inferSelect;

export const emailSettings = pgTable("email_settings", {
  id: varchar("id").primaryKey().default("singleton"),
  defaultSenderName: text("default_sender_name").notNull().default("VCP Trader AI"),
  defaultReplyTo: text("default_reply_to").notNull().default("team@vcptrader.com"),
  forwardingDestination: text("forwarding_destination").notNull().default("support@sunfishtrading.com"),
  inboundAckEnabled: boolean("inbound_ack_enabled").notNull().default(true),
  supportForwardingEnabled: boolean("support_forwarding_enabled").notNull().default(true),
  maxAttachmentSizeMb: integer("max_attachment_size_mb").notNull().default(10),
  maxAttachmentCount: integer("max_attachment_count").notNull().default(5),
  allowedAttachmentTypes: text("allowed_attachment_types").array().notNull().default(sql`'{pdf,png,jpg,jpeg,gif,txt,csv,log}'::text[]`),
  supportCategories: text("support_categories").array().notNull().default(sql`'{Account,Authentication,Billing,Subscription,"Broker Connection","Market Data","Trade Entry","Position Protection","Paper Trading","Bug Report","Feature Request","Research Question",General,Security,Spam}'::text[]`),
  defaultTicketPriority: text("default_ticket_priority").notNull().default("NORMAL"),
  expectedResponseWording: text("expected_response_wording"),
  openTrackingEnabled: boolean("open_tracking_enabled").notNull().default(false),
  clickTrackingEnabled: boolean("click_tracking_enabled").notNull().default(false),
  aiClassificationEnabled: boolean("ai_classification_enabled").notNull().default(false),
  aiReplySuggestionsEnabled: boolean("ai_reply_suggestions_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type EmailSettings = typeof emailSettings.$inferSelect;
export const updateEmailSettingsSchema = createInsertSchema(emailSettings).omit({ id: true, updatedAt: true }).partial();

// ---------------------------------------------------------------------------
// Sprint 5.4C — Research Record & Decision Journal
// ---------------------------------------------------------------------------

/** Immutable deterministic research evidence + user-owned metadata. */
export const researchRecords = pgTable("research_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Server-side authenticated user — NEVER from request body. */
  userId: varchar("user_id").notNull(),
  /** Brain requestId that produced this evidence. */
  requestId: varchar("request_id").notNull(),
  /** Conversation the evidence came from (nullable — survives conversation deletion). */
  conversationId: varchar("conversation_id"),
  /** Parent record when this is a refresh/re-analysis of an earlier record. */
  parentRecordId: varchar("parent_record_id"),
  /** Evidence domain. One of 6 validated values. */
  domain: text("domain").notNull(),
  /** Schema version string. Must be "1.0". */
  schemaVersion: text("schema_version").notNull(),
  /** Primary symbol (nullable for multi-symbol or portfolio searches). */
  symbol: text("symbol"),
  /** Multiple symbols for ranked-search / portfolio research. */
  symbols: text("symbols").array().notNull().default(sql`'{}'::text[]`),
  normalizedRequestSummary: text("normalized_request_summary").notNull(),
  /** Deterministic verdict — IMMUTABLE after creation. */
  verdict: text("verdict").notNull(),
  status: text("status"),
  strategy: text("strategy"),
  strategyDisplayName: text("strategy_display_name"),
  direction: text("direction"),
  instrument: text("instrument"),
  qualificationStatus: text("qualification_status"),
  /** Confidence level — IMMUTABLE. */
  confidence: text("confidence").notNull(),
  /** Data quality flags — IMMUTABLE. */
  dataQuality: jsonb("data_quality").notNull(),
  /** Deterministic reasons — IMMUTABLE. */
  reasons: text("reasons").array().notNull().default(sql`'{}'::text[]`),
  /** Deterministic warnings — IMMUTABLE. */
  warnings: text("warnings").array().notNull().default(sql`'{}'::text[]`),
  watchConditions: text("watch_conditions").array().notNull().default(sql`'{}'::text[]`),
  /** Source tool names — IMMUTABLE. */
  sourceTools: text("source_tools").array().notNull().default(sql`'{}'::text[]`),
  /** Source timestamps — IMMUTABLE. */
  sourceTimestamps: text("source_timestamps").array().notNull().default(sql`'{}'::text[]`),
  limitations: text("limitations").array().notNull().default(sql`'{}'::text[]`),
  /** Full domain-specific structured snapshot — IMMUTABLE. */
  domainSnapshot: jsonb("domain_snapshot").notNull(),
  /** User-editable display title. */
  title: text("title").notNull(),
  /** User-editable free-form label. */
  userLabel: text("user_label"),
  /** User-editable tags. */
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  /** Soft-archive flag (user can archive without deleting). */
  archived: boolean("archived").notNull().default(false),
  /** When the Brain evidence was generated — IMMUTABLE. */
  generatedAt: timestamp("generated_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ResearchRecord = typeof researchRecords.$inferSelect;
export type InsertResearchRecord = typeof researchRecords.$inferInsert;

/** User-authored Decision Journal entry — one per research record. */
export const decisionJournalEntries = pgTable("decision_journal_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  /** Linked research record — same user ownership required. */
  researchRecordId: varchar("research_record_id").notNull(),
  // --- User-authored free-text fields ---
  thesis: text("thesis"),
  entryPlan: text("entry_plan"),
  riskPlan: text("risk_plan"),
  exitPlan: text("exit_plan"),
  notes: text("notes"),
  expectedConditions: text("expected_conditions"),
  invalidationConditions: text("invalidation_conditions"),
  /**
   * Current user decision state.
   * entered_manually / closed_manually require explicit user action — never inferred.
   */
  userDecision: text("user_decision").notNull().default("researching"),
  outcomeReview: text("outcome_review"),
  lessonsLearned: text("lessons_learned"),
  // --- User-recorded execution fields (no brokerage reconciliation) ---
  userRecordedEntryPrice: real("user_recorded_entry_price"),
  userRecordedExitPrice: real("user_recorded_exit_price"),
  userRecordedQuantity: real("user_recorded_quantity"),
  openedAt: timestamp("opened_at"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DecisionJournalEntry = typeof decisionJournalEntries.$inferSelect;
export type InsertDecisionJournalEntry = typeof decisionJournalEntries.$inferInsert;

// ---------------------------------------------------------------------------
// Opportunity Engine — persisted scan snapshots (Sprint 1.1)
// ---------------------------------------------------------------------------

export const opportunityScanSnapshots = pgTable("opportunity_scan_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Scan outcome: SUCCESS | PARTIAL_SUCCESS | EMPTY_SUCCESS | FAILED */
  status: text("status").notNull(),
  /** Always MARKET_RANKING for now; reserved for future scan types. */
  scanType: text("scan_type").notNull().default("MARKET_RANKING"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  /** Timestamp MCP reported for the underlying market data (may be null). */
  generatedAt: timestamp("generated_at"),
  sourceTimestamp: timestamp("source_timestamp"),
  marketSession: text("market_session"),
  dataSource: text("data_source"),
  dataQuality: text("data_quality"),
  scannerVersion: text("scanner_version"),
  /** Hash of the request parameters for deduplication / provenance. */
  requestFingerprint: text("request_fingerprint"),
  /** Safe bounded request metadata (no tokens, no account IDs). */
  requestSummary: jsonb("request_summary"),
  reviewedCount: integer("reviewed_count").notNull().default(0),
  qualifiedCount: integer("qualified_count").notNull().default(0),
  watchCount: integer("watch_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  excludedCount: integer("excluded_count").notNull().default(0),
  unavailableCount: integer("unavailable_count").notNull().default(0),
  /** Candidate buckets + marketRegime. Null for FAILED rows. Validated before write. */
  resultPayload: jsonb("result_payload"),
  warnings: jsonb("warnings").notNull().default([]),
  /** Safe short error code (no stack, no token, no session info). */
  errorCode: text("error_code"),
  /** Safe bounded error description. Never a stack trace. */
  errorSummary: text("error_summary"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  idxCompletedAt: index("idx_oss_completed_at").on(t.completedAt),
  idxStatus: index("idx_oss_status").on(t.status),
  idxScanTypeCompleted: index("idx_oss_scan_type_completed").on(t.scanType, t.completedAt),
  idxFingerprintCompleted: index("idx_oss_fingerprint_completed").on(t.requestFingerprint, t.completedAt),
}));

export type OpportunityScanSnapshot = typeof opportunityScanSnapshots.$inferSelect;
export type InsertOpportunityScanSnapshot = typeof opportunityScanSnapshots.$inferInsert;

// ---------------------------------------------------------------------------
// Opportunity Lifecycle History — Sprint 2.0
// ---------------------------------------------------------------------------

export const opportunityHistory = pgTable("opportunity_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** FK to opportunity_scan_snapshots.id (cascade delete on snapshot deletion) */
  snapshotId: varchar("snapshot_id").notNull(),
  symbol: text("symbol").notNull(),
  strategy: text("strategy"),
  scanTime: timestamp("scan_time", { withTimezone: true }).notNull(),
  rank: integer("rank"),
  /** Derived score: max(0, 100 - (rank-1)*5) for qualified; 0 for watch. */
  score: numeric("score", { precision: 6, scale: 2 }).notNull().default("0"),
  /** QUALIFIED | WATCHING */
  qualificationStatus: text("qualification_status").notNull(),
  /** NEWLY_QUALIFIED | STILL_QUALIFIED | STRENGTHENING | WEAKENING | APPROACHING | TRIGGERED | DROPPED | UNAVAILABLE */
  lifecycleState: text("lifecycle_state").notNull(),
  reasonSummary: text("reason_summary"),
  marketRegime: text("market_regime"),
  /** Reserved for future technical score from scorer; null until exposed. */
  technicalScore: numeric("technical_score", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  idxSymbolScanTime: index("idx_oh_symbol_scan_time").on(t.symbol, t.scanTime),
  idxSnapshotId: index("idx_oh_snapshot_id").on(t.snapshotId),
  idxLifecycleState: index("idx_oh_lifecycle_state").on(t.lifecycleState, t.scanTime),
}));

export type OpportunityHistoryRecord = typeof opportunityHistory.$inferSelect;
export type InsertOpportunityHistory = typeof opportunityHistory.$inferInsert;

// ---------------------------------------------------------------------------
// Institutional Intelligence — Sprint 2.2.5
//
// Five additive tables. None replaces existing tables.
// All institutional data is 13F-reported holdings only — not total institutional
// ownership. Terminology throughout must match the spec.
// ---------------------------------------------------------------------------

/**
 * One row per SEC Form 13F-HR (or 13F-HR/A) filing.
 * accessionNumber is normalized without dashes and is the natural primary key.
 * isEffective tracks which version of a filing is considered the authoritative
 * version for a given filer+quarter after amendments are processed.
 */
export const institutional13fFilings = pgTable("institutional_13f_filings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Normalized accession number (no dashes), e.g. 0001364742240000078 */
  accessionNumber: text("accession_number").notNull(),
  /** CIK normalized with leading zeros to 10 digits */
  filerCik: text("filer_cik").notNull(),
  filerName: text("filer_name").notNull(),
  /** 13F-HR | 13F-HR/A */
  filingType: text("filing_type").notNull(),
  filingDate: date("filing_date").notNull(),
  /** Timestamp the filing was accepted by EDGAR, when available */
  acceptedAt: timestamp("accepted_at"),
  /** Quarter-end date reflected in the holdings */
  periodOfReport: date("period_of_report").notNull(),
  amendmentFlag: boolean("amendment_flag").notNull().default(false),
  /** Numeric amendment sequence (0 = original) */
  amendmentNumber: integer("amendment_number"),
  /** RESTATEMENT | NEW_AMENDMENT | null */
  amendmentType: text("amendment_type"),
  /**
   * true = this accession is the effective version for this filer+quarter.
   * When a later amendment is ingested the original's isEffective is set false.
   */
  isEffective: boolean("is_effective").notNull().default(true),
  /** Safe EDGAR accession reference URL, no credentials */
  sourceUrl: text("source_url"),
  ingestedAt: timestamp("ingested_at").defaultNow().notNull(),
  /** MD5 of the downloaded document for change detection */
  sourceChecksum: text("source_checksum"),
}, (t) => ({
  idxAccession: uniqueIndex("idx_13f_filings_accession").on(t.accessionNumber),
  idxCikPeriod: index("idx_13f_filings_cik_period").on(t.filerCik, t.periodOfReport),
  idxPeriodDate: index("idx_13f_filings_period_date").on(t.periodOfReport, t.filingDate),
  idxFilingDate: index("idx_13f_filings_filing_date").on(t.filingDate),
  idxEffective: index("idx_13f_filings_effective").on(t.isEffective, t.periodOfReport),
}));

export type Institutional13fFiling = typeof institutional13fFilings.$inferSelect;
export type InsertInstitutional13fFiling = typeof institutional13fFilings.$inferInsert;

/**
 * Curated many-to-many manager cohort memberships.
 * No cohort may be inferred from a manager name or filing without a separately
 * registered deterministic rule.
 */
export const institutionalManagerCohorts = pgTable("institutional_manager_cohorts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** SEC filer CIK normalized to 10 digits. */
  managerId: text("manager_id").notNull(),
  cohort: text("cohort").notNull(),
  /** MANUAL | VERIFIED | RULE_BASED */
  classificationMethod: text("classification_method").notNull(),
  /** 0–100 when supplied; null means no numeric confidence claim. */
  confidence: integer("confidence"),
  /** ACTIVE | INACTIVE | NEEDS_REVIEW */
  status: text("status").notNull().default("ACTIVE"),
  source: text("source"),
  notes: text("notes"),
  /** Required registry key for RULE_BASED records. */
  ruleId: text("rule_id"),
  lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  idxManagerCohortUnique: uniqueIndex("idx_institutional_manager_cohorts_unique").on(
    t.managerId, t.cohort,
  ),
  idxManagerCohortsManager: index("idx_institutional_manager_cohorts_manager").on(
    t.managerId,
  ),
  idxManagerCohortsCohortStatus: index("idx_institutional_manager_cohorts_cohort_status").on(
    t.cohort, t.status,
  ),
  managerCohortAllowed: check(
    "institutional_manager_cohorts_cohort",
    sql`${t.cohort} IN ('hedge_fund', 'pension', 'sovereign', 'endowment', 'asset_manager', 'quantitative', 'technology_specialist', 'healthcare_specialist', 'concentrated', 'broad_diversified')`,
  ),
  managerCohortMethodAllowed: check(
    "institutional_manager_cohorts_method",
    sql`${t.classificationMethod} IN ('MANUAL', 'VERIFIED', 'RULE_BASED')`,
  ),
  managerCohortStatusAllowed: check(
    "institutional_manager_cohorts_status",
    sql`${t.status} IN ('ACTIVE', 'INACTIVE', 'NEEDS_REVIEW')`,
  ),
  managerCohortConfidenceRange: check(
    "institutional_manager_cohorts_confidence",
    sql`${t.confidence} IS NULL OR (${t.confidence} >= 0 AND ${t.confidence} <= 100)`,
  ),
  managerCohortRuleRequired: check(
    "institutional_manager_cohorts_rule",
    sql`${t.classificationMethod} <> 'RULE_BASED' OR ${t.ruleId} IS NOT NULL`,
  ),
}));

export type InstitutionalManagerCohortRecord = typeof institutionalManagerCohorts.$inferSelect;
export type InsertInstitutionalManagerCohort = typeof institutionalManagerCohorts.$inferInsert;

/**
 * One row per holding line in an InfoTable.
 * The uniqueness key is (accessionNumber, cusip, classTitle, putCall) so that
 * re-ingestion of the same accession is idempotent.
 *
 * Put/call rows MUST be kept separate — they must never be mixed into
 * common-stock share totals.
 *
 * Never discard the original reported identifier fields.
 * Never overwrite historical quarters.
 */
export const institutional13fHoldings = pgTable("institutional_13f_holdings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accessionNumber: text("accession_number").notNull(),
  filerCik: text("filer_cik").notNull(),
  filerName: text("filer_name").notNull(),
  /** As reported on the InfoTable — original whitespace normalized */
  issuerName: text("issuer_name").notNull(),
  classTitle: text("class_title").notNull(),
  /** 9-character CUSIP, padded/normalized */
  cusip: text("cusip").notNull(),
  /** FIGI when supplied by the filer */
  figi: text("figi"),
  /** Canonical reported value in US dollars; consumers must not multiply by 1,000 */
  reportedValue: bigint("reported_value", { mode: "number" }),
  /** Reported share/principal amount */
  reportedShares: bigint("reported_shares", { mode: "number" }),
  /** SH = shares; PRN = principal amount */
  sharesPrnType: text("shares_prn_type"),
  /** Put | Call | null — never mixed into common-stock totals */
  putCall: text("put_call"),
  /** SOLE | SHARED | OTHER */
  investmentDiscretion: text("investment_discretion"),
  otherManager: text("other_manager"),
  votingSole: bigint("voting_sole", { mode: "number" }),
  votingShared: bigint("voting_shared", { mode: "number" }),
  votingNone: bigint("voting_none", { mode: "number" }),
  /** Quarter-end date from the parent filing */
  periodOfReport: date("period_of_report").notNull(),
  filingDate: date("filing_date").notNull(),
  /** Internal VCP Trader symbol, or null when unmapped */
  mappedSymbol: text("mapped_symbol"),
  /** exact|reviewed|probable|ambiguous|unmapped|rejected */
  mappingStatus: text("mapping_status").notNull().default("unmapped"),
  ingestedAt: timestamp("ingested_at").defaultNow().notNull(),
}, (t) => ({
  idxHoldingUnique: uniqueIndex("idx_13f_holdings_unique").on(
    t.accessionNumber, t.cusip, t.classTitle, t.putCall,
  ),
  idxCusipPeriod: index("idx_13f_holdings_cusip_period").on(t.cusip, t.periodOfReport),
  idxSymbolPeriod: index("idx_13f_holdings_symbol_period").on(t.mappedSymbol, t.periodOfReport),
  idxFilerPeriod: index("idx_13f_holdings_filer_period").on(t.filerCik, t.periodOfReport),
  idxFilingDate: index("idx_13f_holdings_filing_date").on(t.filingDate),
  idxMappingStatus: index("idx_13f_holdings_mapping").on(t.mappingStatus, t.periodOfReport),
}));

export type Institutional13fHolding = typeof institutional13fHoldings.$inferSelect;
export type InsertInstitutional13fHolding = typeof institutional13fHoldings.$inferInsert;

/**
 * Durable CUSIP → VCP Trader symbol mappings.
 * Production analytics may only use exact or reviewed status.
 * probable and ambiguous are available in diagnostic views only.
 *
 * Every mapping records: method, symbol, status, created at, last verified, sources.
 */
export const institutionalSecurityMappings = pgTable("institutional_security_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Normalized 9-character CUSIP */
  cusip: text("cusip").notNull(),
  /** FIGI when available */
  figi: text("figi"),
  /** Normalized issuer name from 13F (for reference / audit) */
  issuerName: text("issuer_name"),
  classTitle: text("class_title"),
  /** VCP Trader internal symbol, null when unmapped */
  mappedSymbol: text("mapped_symbol"),
  /** exact | reviewed | probable | ambiguous | unmapped | rejected */
  mappingStatus: text("mapping_status").notNull(),
  /** cusip_exact | figi_exact | reviewed | name_match | manual */
  mappingMethod: text("mapping_method").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastVerifiedAt: timestamp("last_verified_at").defaultNow().notNull(),
  /** Auditable notes for reviewed/manual mappings */
  notes: text("notes"),
}, (t) => ({
  idxCusip: uniqueIndex("idx_sec_mappings_cusip").on(t.cusip),
  idxMappedSymbol: index("idx_sec_mappings_symbol").on(t.mappedSymbol),
  idxStatus: index("idx_sec_mappings_status").on(t.mappingStatus),
}));

export type InstitutionalSecurityMapping = typeof institutionalSecurityMappings.$inferSelect;
export type InsertInstitutionalSecurityMapping = typeof institutionalSecurityMappings.$inferInsert;

/**
 * Pre-computed quarterly aggregates per (symbol, periodOfReport).
 * Generated by the aggregation engine after holdings are ingested.
 * The API reads from this table — never from the raw holdings at request time.
 *
 * All concentration fields refer to the reported 13F universe, not total ownership.
 */
export const institutionalQuarterlyAggregates = pgTable("institutional_quarterly_aggregates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  /** Quarter-end date, e.g. 2024-03-31 */
  periodOfReport: date("period_of_report").notNull(),
  /** Human-readable label, e.g. "2024-Q1" */
  periodLabel: text("period_label").notNull(),
  /** Count of 13F filing managers who reported an eligible position */
  reportingManagerCount: integer("reporting_manager_count").notNull().default(0),
  /** Aggregate eligible common-stock reported shares (excludes put/call, PRN) */
  aggregateReportedShares: bigint("aggregate_reported_shares", { mode: "number" }),
  /** Aggregate canonical reported value in US dollars */
  aggregateReportedValue: bigint("aggregate_reported_value", { mode: "number" }),
  /** Quarter-end date of the previous comparable quarter used for comparison */
  prevPeriodOfReport: date("prev_period_of_report"),
  previousQuarterShares: bigint("previous_quarter_shares", { mode: "number" }),
  previousQuarterValue: bigint("previous_quarter_value", { mode: "number" }),
  /** Signed share change: current − previous */
  reportedSharesChange: bigint("reported_shares_change", { mode: "number" }),
  /** Percent change; null when denominator is zero or unavailable */
  reportedSharesChangePercent: real("reported_shares_change_percent"),
  /** Managers with no prior-quarter position who have a current position */
  newPositionCount: integer("new_position_count").notNull().default(0),
  increasedPositionCount: integer("increased_position_count").notNull().default(0),
  reducedPositionCount: integer("reduced_position_count").notNull().default(0),
  exitedPositionCount: integer("exited_position_count").notNull().default(0),
  unchangedCount: integer("unchanged_count").notNull().default(0),
  /** Top single holder share of reported 13F shares (0–1), null when unavailable */
  topHolderPercent: real("top_holder_percent"),
  top5HolderPercent: real("top5_holder_percent"),
  top10HolderPercent: real("top10_holder_percent"),
  /** low | moderate | high | unavailable */
  concentrationClassification: text("concentration_classification"),
  /** increasing | stable | decreasing | mixed | insufficient_history | unavailable */
  trend: text("trend").notNull().default("unavailable"),
  /** JSON array of largest reported holders (bounded to top 20) */
  largestHolders: jsonb("largest_holders").notNull().default([]),
  /** Count of eligible holdings included in the aggregate */
  eligibleHoldingCount: integer("eligible_holding_count").notNull().default(0),
  /** Count of holdings excluded (put/call, PRN, unmapped, etc.) */
  excludedHoldingCount: integer("excluded_holding_count").notNull().default(0),
  /** complete | partial | insufficient */
  coverageStatus: text("coverage_status").notNull().default("insufficient"),
  /** clean | has_amendments | pending_amendments */
  amendmentStatus: text("amendment_status").notNull().default("clean"),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
}, (t) => ({
  idxSymbolPeriod: uniqueIndex("idx_iqa_symbol_period").on(t.symbol, t.periodOfReport),
  idxPeriod: index("idx_iqa_period").on(t.periodOfReport),
  idxSymbol: index("idx_iqa_symbol").on(t.symbol),
  idxGenerated: index("idx_iqa_generated").on(t.generatedAt),
}));

export type InstitutionalQuarterlyAggregate = typeof institutionalQuarterlyAggregates.$inferSelect;
export type InsertInstitutionalQuarterlyAggregate = typeof institutionalQuarterlyAggregates.$inferInsert;

/**
 * Tracks each ingestion run: one row per quarter per attempt.
 * Used by the readiness audit and advisory-lock guard.
 */
export const institutionalIngestionRuns = pgTable("institutional_ingestion_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Quarter identifier, e.g. "2024-Q1" */
  quarter: text("quarter").notNull(),
  /** Quarter-end date */
  periodOfReport: date("period_of_report").notNull(),
  /** pending|running|completed|partial|failed|skipped_locked|skipped_disabled */
  status: text("status").notNull(),
  filingCount: integer("filing_count").notNull().default(0),
  holdingCount: integer("holding_count").notNull().default(0),
  mappedCount: integer("mapped_count").notNull().default(0),
  unmappedCount: integer("unmapped_count").notNull().default(0),
  /** Safe short error code (no stack, no credentials) */
  errorCode: text("error_code"),
  errorSummary: text("error_summary"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
  /** scheduler | manual_admin | startup | daily_job */
  initiatedBy: text("initiated_by").notNull().default("scheduler"),
  // ── Accession-level checkpoint fields (Sprint 2.2.5 background ops) ──────
  /** Total accessions in the parsed dataset (NULL until first parse completes). */
  totalAccessions: integer("total_accessions"),
  /** Accessions processed in all runs to date (both new and skipped). */
  processedAccessions: integer("processed_accessions"),
  /** Last time the ingestion loop wrote a progress heartbeat. */
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
}, (t) => ({
  idxQuarterStatus: index("idx_iir_quarter_status").on(t.quarter, t.status),
  idxStatus: index("idx_iir_status").on(t.status),
  idxStarted: index("idx_iir_started").on(t.startedAt),
  idxPeriod: index("idx_iir_period").on(t.periodOfReport),
}));

export type InstitutionalIngestionRun = typeof institutionalIngestionRuns.$inferSelect;
export type InsertInstitutionalIngestionRun = typeof institutionalIngestionRuns.$inferInsert;

/**
 * Canonical CUSIP → ticker reference store for the Institutional Intelligence
 * mapping engine. Richer metadata than institutionalSecurityMappings; the review
 * queue operates on this table. Approved entries are synced back to
 * institutionalSecurityMappings so the ingestion pipeline picks them up.
 *
 * reviewStatus values:
 *   reviewed   — manually confirmed; never overwritten by automation
 *   probable   — high-confidence automated match, awaiting review
 *   needs_review — low-confidence or ambiguous match, flagged for human review
 *   unmapped   — no automated match found
 *   rejected   — explicitly rejected; excluded from analytics
 *
 * confidence scale:
 *   100 — reviewed (manually confirmed)
 *   95  — exact CUSIP match in legacy mapping table
 *   90  — FIGI exact match
 *   80  — issuer name deterministic match (unique)
 *   60  — probable (heuristic)
 *   0   — unmapped
 */
export const securityMaster = pgTable("security_master", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Normalized 9-character CUSIP (uppercase, no dashes) */
  cusip: text("cusip").notNull(),
  /** VCP Trader internal symbol (e.g. "AAPL") */
  ticker: text("ticker"),
  issuerName: text("issuer_name"),
  /** NYSE | NASDAQ | OTC | CBOE | other */
  exchange: text("exchange"),
  /** common_stock | etf | reit | adr | preferred | warrant | other */
  assetType: text("asset_type"),
  figi: text("figi"),
  /** 0–100 confidence in the ticker assignment */
  confidence: integer("confidence").notNull().default(0),
  /** manual | cusip_exact | figi_exact | name_match | heuristic | unmapped */
  mappingMethod: text("mapping_method").notNull().default("unmapped"),
  /** reviewed | probable | needs_review | unmapped | rejected */
  reviewStatus: text("review_status").notNull().default("unmapped"),
  firstSeen: timestamp("first_seen").defaultNow().notNull(),
  lastVerified: timestamp("last_verified").defaultNow().notNull(),
  notes: text("notes"),
  /** Number of holdings rows referencing this CUSIP (updated on pipeline runs) */
  holdingCount: integer("holding_count").notNull().default(0),
}, (t) => ({
  idxCusip: uniqueIndex("idx_sm_cusip").on(t.cusip),
  idxTicker: index("idx_sm_ticker").on(t.ticker),
  idxReviewStatus: index("idx_sm_review_status").on(t.reviewStatus),
  idxConfidence: index("idx_sm_confidence").on(t.confidence),
  idxHoldingCount: index("idx_sm_holding_count").on(t.holdingCount),
}));

export type SecurityMaster = typeof securityMaster.$inferSelect;
export type InsertSecurityMaster = typeof securityMaster.$inferInsert;

/**
 * Extensible curated theme definitions for security enrichment.
 * Theme membership is normalized in security_master_themes; analytics must
 * never hardcode theme names or symbol lists.
 */
export const securityThemes = pgTable("security_themes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Stable kebab-case identifier shared with the theme registry. */
  themeId: text("theme_id").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  /** curated until a separately governed classifier is introduced */
  classificationMethod: text("classification_method").notNull().default("curated"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  idxThemeActive: index("idx_security_themes_active").on(t.active),
}));

export type SecurityTheme = typeof securityThemes.$inferSelect;
export type InsertSecurityTheme = typeof securityThemes.$inferInsert;

/**
 * Many-to-many security master ↔ theme membership.
 * A membership is valid only when its security master record is reliably
 * mapped; unresolved holdings never receive a row here.
 */
export const securityMasterThemes = pgTable("security_master_themes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  securityMasterId: varchar("security_master_id").notNull()
    .references(() => securityMaster.id, { onDelete: "cascade" }),
  themeId: text("theme_id").notNull()
    .references(() => securityThemes.themeId, { onDelete: "cascade" }),
  classificationMethod: text("classification_method").notNull().default("curated"),
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  idxSecurityMasterThemeUnique: uniqueIndex("idx_security_master_themes_unique").on(
    t.securityMasterId, t.themeId,
  ),
  idxSecurityMasterThemesSecurity: index("idx_security_master_themes_security").on(t.securityMasterId),
  idxSecurityMasterThemesTheme: index("idx_security_master_themes_theme").on(t.themeId),
}));

export type SecurityMasterTheme = typeof securityMasterThemes.$inferSelect;
export type InsertSecurityMasterTheme = typeof securityMasterThemes.$inferInsert;

// ---------------------------------------------------------------------------
// Institutional Symbol Signals — Sprint 2.2.6
// ---------------------------------------------------------------------------

/**
 * Pre-computed Institutional Signal per ticker symbol.
 *
 * Populated by rebuildInstitutionalSignals() / rebuildInstitutionalSignalForSymbol().
 * The /api/institutional/signals/:symbol endpoint reads from this table.
 * Never reads raw holdings at request time — all inputs come from
 * institutional_quarterly_aggregates.
 *
 * One row per symbol; upserted on every rebuild run.
 */
export const institutionalSymbolSignals = pgTable("institutional_symbol_signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** VCP Trader internal symbol (e.g. "AAPL") */
  symbol: text("symbol").notNull(),

  // Signal envelope
  /** available | insufficient_history | mapping_incomplete | processing | unavailable */
  status: text("status").notNull().default("unavailable"),
  /** Human-readable quarter label for latest quarter (e.g. "2026-Q1") */
  latestQuarter: text("latest_quarter"),
  /** Human-readable quarter label for previous quarter */
  previousQuarter: text("previous_quarter"),
  /** ISO date of the latest quarter's period-of-report */
  periodEndDate: date("period_end_date"),

  // Score and label
  /** 0–100 institutional evidence score; null when insufficient data */
  score: integer("score"),
  /** Strong Accumulation | Accumulation | Stable | Distribution | Strong Distribution | Insufficient Data */
  label: text("label"),
  /** Deterministic plain-language summary */
  summary: text("summary"),

  // Manager activity counts
  managerCountLatest: integer("manager_count_latest"),
  managerCountPrevious: integer("manager_count_previous"),
  totalSharesLatest: bigint("total_shares_latest", { mode: "number" }),
  totalSharesPrevious: bigint("total_shares_previous", { mode: "number" }),
  totalValueLatest: bigint("total_value_latest", { mode: "number" }),
  totalValuePrevious: bigint("total_value_previous", { mode: "number" }),
  newManagerCount: integer("new_manager_count").notNull().default(0),
  exitedManagerCount: integer("exited_manager_count").notNull().default(0),
  increasedManagerCount: integer("increased_manager_count").notNull().default(0),
  reducedManagerCount: integer("reduced_manager_count").notNull().default(0),
  unchangedManagerCount: integer("unchanged_manager_count").notNull().default(0),

  // Concentration
  topHolderPct: real("top_holder_pct"),
  top5HolderPct: real("top5_holder_pct"),
  /** increasing_concentration | stable_concentration | broadening_ownership | insufficient_data */
  concentrationTrend: text("concentration_trend"),

  // Data quality
  /** Symbol-level mapping coverage: eligible / (eligible + excluded) */
  mappingCoverage: real("mapping_coverage"),
  /** high | moderate | limited | insufficient */
  dataQualityConfidence: text("data_quality_confidence"),

  // Bounded change lists — JSON arrays of InstitutionalManagerChange
  topBuyers: jsonb("top_buyers").notNull().default([]),
  topSellers: jsonb("top_sellers").notNull().default([]),
  newPositions: jsonb("new_positions").notNull().default([]),
  exitedPositions: jsonb("exited_positions").notNull().default([]),

  /** Score components JSON object */
  scoreComponents: jsonb("score_components"),

  calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
}, (t) => ({
  idxSymbol:     uniqueIndex("idx_iss_symbol").on(t.symbol),
  idxScore:      index("idx_iss_score").on(t.score),
  idxStatus:     index("idx_iss_status").on(t.status),
  idxCalculated: index("idx_iss_calculated").on(t.calculatedAt),
  idxLabel:      index("idx_iss_label").on(t.label),
}));

export type InstitutionalSymbolSignal = typeof institutionalSymbolSignals.$inferSelect;
export type InsertInstitutionalSymbolSignal = typeof institutionalSymbolSignals.$inferInsert;

// ── Sector & Theme Intelligence Snapshots (Sprint 2.3.3) ─────────────────────

export const sectorIntelligenceSnapshots = pgTable("sector_intelligence_snapshots", {
  id:          varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sector:      text("sector").notNull(),
  score:       integer("score").notNull(),
  label:       text("label").notNull(),
  metrics:     jsonb("metrics").notNull().default({}),
  topSymbols:  jsonb("top_symbols").notNull().default([]),
  changes:     jsonb("changes").notNull().default({}),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
}, (t) => ({
  idxSector:  index("idx_sis_sector").on(t.sector),
  idxGenAt:   index("idx_sis_generated_at").on(t.generatedAt),
}));

export type SectorIntelligenceSnapshot = typeof sectorIntelligenceSnapshots.$inferSelect;

export const themeIntelligenceSnapshots = pgTable("theme_intelligence_snapshots", {
  id:          varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  themeId:     text("theme_id").notNull(),
  themeName:   text("theme_name").notNull(),
  score:       integer("score").notNull(),
  label:       text("label").notNull(),
  metrics:     jsonb("metrics").notNull().default({}),
  topSymbols:  jsonb("top_symbols").notNull().default([]),
  changes:     jsonb("changes").notNull().default({}),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
}, (t) => ({
  idxThemeId: index("idx_tis_theme_id").on(t.themeId),
  idxGenAt:   index("idx_tis_generated_at").on(t.generatedAt),
}));

export type ThemeIntelligenceSnapshot = typeof themeIntelligenceSnapshots.$inferSelect;

// ============================================================
// PORTFOLIO FOUNDATION (Sprint 2.4.0)
// ============================================================

export const portfolioSourceTypeEnum = pgEnum("portfolio_source_type", [
  "manual",
  "csv",
  "xlsx",
  "broker",
  "image",
  "pdf",
]);

export const portfolios = pgTable("portfolios", {
  id:              varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:          varchar("user_id").notNull(),
  name:            text("name").notNull(),
  sourceType:      portfolioSourceTypeEnum("source_type").notNull().default("manual"),
  sourceAccountId: text("source_account_id"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  idxUserId: index("idx_portfolios_user_id").on(t.userId),
}));

export type Portfolio = typeof portfolios.$inferSelect;
export type InsertPortfolio = typeof portfolios.$inferInsert;
export const insertPortfolioSchema = createInsertSchema(portfolios).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const portfolioPositions = pgTable("portfolio_positions", {
  id:              varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portfolioId:     varchar("portfolio_id").notNull(),
  symbol:          text("symbol").notNull(),
  quantity:        numeric("quantity", { precision: 18, scale: 8 }).notNull(),
  averageCost:     numeric("average_cost", { precision: 18, scale: 8 }),
  costBasis:       numeric("cost_basis", { precision: 18, scale: 8 }),
  marketValue:     numeric("market_value", { precision: 18, scale: 8 }),
  currency:        text("currency").notNull().default("USD"),
  sourceType:      portfolioSourceTypeEnum("source_type").notNull().default("manual"),
  sourceReference: text("source_reference"),
  importedAt:      timestamp("imported_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  idxPortfolioId:   index("idx_pp_portfolio_id").on(t.portfolioId),
  idxPortfolioSym:  index("idx_pp_portfolio_symbol").on(t.portfolioId, t.symbol),
}));

export type PortfolioPosition = typeof portfolioPositions.$inferSelect;
export type InsertPortfolioPosition = typeof portfolioPositions.$inferInsert;
export const insertPortfolioPositionSchema = createInsertSchema(portfolioPositions).omit({
  id: true, importedAt: true, updatedAt: true,
});

// =============================================================================
// Research Collections — Sprint 2.5.1
// =============================================================================

export const collectionTypeEnum = pgEnum("collection_type", ["system", "user"]);

// ---------------------------------------------------------------------------
// research_collections — collection definitions
// ---------------------------------------------------------------------------

export const researchCollections = pgTable("research_collections", {
  id:             varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** null for system collections */
  userId:         varchar("user_id"),
  name:           text("name").notNull(),
  description:    text("description"),
  collectionType: collectionTypeEnum("collection_type").notNull(),
  /** Stable key for system collections (e.g. "ai-infrastructure", "growth") */
  systemKey:      text("system_key"),
  isArchived:     boolean("is_archived").notNull().default(false),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  idxUserId:    index("idx_rc_user_id").on(t.userId),
  idxSystemKey: index("idx_rc_system_key").on(t.systemKey),
}));

export type ResearchCollection = typeof researchCollections.$inferSelect;
export type InsertResearchCollection = typeof researchCollections.$inferInsert;

// ---------------------------------------------------------------------------
// collection_symbols — symbol references for user collections
// ---------------------------------------------------------------------------

export const collectionSymbols = pgTable("collection_symbols", {
  id:           varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  collectionId: varchar("collection_id").notNull(),
  symbol:       text("symbol").notNull(),
  addedAt:      timestamp("added_at").notNull().defaultNow(),
  addedBy:      varchar("added_by"),
}, (t) => ({
  idxCollectionId: index("idx_cs_collection_id").on(t.collectionId),
  idxSymbol:       index("idx_cs_symbol").on(t.symbol),
  uniqCollSym:     uniqueIndex("idx_cs_collection_symbol").on(t.collectionId, t.symbol),
}));

export type CollectionSymbol = typeof collectionSymbols.$inferSelect;

// ---------------------------------------------------------------------------
// user_collection_follows — follow state (per-user, per-collection)
// ---------------------------------------------------------------------------

export const userCollectionFollows = pgTable("user_collection_follows", {
  userId:       varchar("user_id").notNull(),
  collectionId: varchar("collection_id").notNull(),
  followedAt:   timestamp("followed_at").notNull().defaultNow(),
}, (t) => ({
  pk:        uniqueIndex("idx_ucf_user_coll").on(t.userId, t.collectionId),
  idxUser:   index("idx_ucf_user_id").on(t.userId),
}));

export type UserCollectionFollow = typeof userCollectionFollows.$inferSelect;

// ---------------------------------------------------------------------------
// user_collection_favorites — favorite state (per-user, per-collection)
// ---------------------------------------------------------------------------

export const userCollectionFavorites = pgTable("user_collection_favorites", {
  userId:       varchar("user_id").notNull(),
  collectionId: varchar("collection_id").notNull(),
  favoritedAt:  timestamp("favorited_at").notNull().defaultNow(),
}, (t) => ({
  pk:        uniqueIndex("idx_ucfav_user_coll").on(t.userId, t.collectionId),
  idxUser:   index("idx_ucfav_user_id").on(t.userId),
}));

export type UserCollectionFavorite = typeof userCollectionFavorites.$inferSelect;

// ---------------------------------------------------------------------------
// user_collection_pins — pin state (per-user, per-collection)
// ---------------------------------------------------------------------------

export const userCollectionPins = pgTable("user_collection_pins", {
  userId:       varchar("user_id").notNull(),
  collectionId: varchar("collection_id").notNull(),
  pinnedAt:     timestamp("pinned_at").notNull().defaultNow(),
}, (t) => ({
  pk:        uniqueIndex("idx_ucp_user_coll").on(t.userId, t.collectionId),
  idxUser:   index("idx_ucp_user_id").on(t.userId),
}));

export type UserCollectionPin = typeof userCollectionPins.$inferSelect;

// =============================================================================
// AI Research Workspace — Sprint 2.5.2
// =============================================================================

export const workspaceConversations = pgTable("workspace_conversations", {
  id:              varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:          varchar("user_id").notNull(),
  title:           text("title").notNull(),
  /** Research mode: opportunity | company | theme | sector | institutional | market | collection | comparison */
  researchMode:    text("research_mode").notNull().default("opportunity"),
  /** Context scope: entire_market | my_collections | ai-infrastructure | growth | etc. */
  contextScope:    text("context_scope").notNull().default("entire_market"),
  /** Primary tickers referenced in this conversation */
  tickers:         text("tickers").array(),
  /** Sprint 2.6.4 context metadata columns */
  contextType:     text("context_type"),
  contextLabel:    text("context_label"),
  primarySymbol:   varchar("primary_symbol"),
  comparisonSymbols: text("comparison_symbols").array(),
  sourceRoute:     varchar("source_route"),
  isPinned:        boolean("is_pinned").notNull().default(false),
  pinnedAt:        timestamp("pinned_at"),
  lastMessageAt:   timestamp("last_message_at").notNull().defaultNow(),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  idxUserId:       index("idx_wc_user_id").on(t.userId),
  idxLastMessage:  index("idx_wc_last_message").on(t.userId, t.lastMessageAt),
  idxPinned:       index("idx_wc_pinned").on(t.userId, t.isPinned),
}));

export type WorkspaceConversation = typeof workspaceConversations.$inferSelect;
export type InsertWorkspaceConversation = typeof workspaceConversations.$inferInsert;

export const workspaceMessages = pgTable("workspace_messages", {
  id:              varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId:  varchar("conversation_id").notNull(),
  /** "user" | "assistant" */
  role:            text("role").notNull(),
  /** Plain text content (for user messages) */
  plainText:       text("plain_text"),
  /** Structured response JSON (for assistant messages) */
  structuredContent: jsonb("structured_content"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  idxConversationId: index("idx_wm_conversation_id").on(t.conversationId),
  idxCreatedAt:      index("idx_wm_created_at").on(t.conversationId, t.createdAt),
}));

export type WorkspaceMessage = typeof workspaceMessages.$inferSelect;
export type InsertWorkspaceMessage = typeof workspaceMessages.$inferInsert;

// =============================================================================
// Research Monitor — Sprint 2.5.4
// =============================================================================

/**
 * research_watches — one row per watch per user
 *
 * entityId stores the watched entity identifier:
 *   company              → ticker symbol (e.g. "NVDA")
 *   theme                → themeId from theme-registry.ts (e.g. "ai-infrastructure")
 *   sector               → sector name (e.g. "Technology")
 *   collection           → collection UUID
 *   opportunity_type     → type key (e.g. "growth" | "income" | "momentum")
 *   market_regime        → null (market-wide)
 *   growth_candidates etc. → null (market-wide category)
 */
export const researchWatches = pgTable("research_watches", {
  id:               varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:           varchar("user_id").notNull(),
  name:             text("name").notNull(),
  /** WatchType enum — see shared/research-monitor-types.ts */
  watchType:        text("watch_type").notNull(),
  entityId:         text("entity_id"),
  entityLabel:      text("entity_label"),
  /** WatchStatus: 'active' | 'paused' | 'archived' */
  status:           text("status").notNull().default("active"),
  lastEvaluatedAt:  timestamp("last_evaluated_at"),
  lastChangeAt:     timestamp("last_change_at"),
  /** WatchActivityType of the most recent change */
  lastChangeType:   text("last_change_type"),
  lastChangeSummary:text("last_change_summary"),
  /** Future notification targets — not implemented in Sprint 2.5.4 */
  notifyEmail:      boolean("notify_email").notNull().default(false),
  notifyPush:       boolean("notify_push").notNull().default(false),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  idxUserId:    index("idx_rw_user_id").on(t.userId),
  idxStatus:    index("idx_rw_status").on(t.userId, t.status),
  idxWatchType: index("idx_rw_watch_type").on(t.userId, t.watchType),
}));

export type ResearchWatchRow    = typeof researchWatches.$inferSelect;
export type InsertResearchWatch = typeof researchWatches.$inferInsert;

/**
 * watch_activity_log — one row per detected change per watch evaluation
 *
 * changeData JSONB shape: { from?, to?, delta?, reasons?, regime?, score?, memberCount? }
 * activityType 'status_unchanged' is written on evaluate-but-no-change (for freshness tracking).
 * Rows older than 90 days are eligible for cleanup.
 */
export const watchActivityLog = pgTable("watch_activity_log", {
  id:              varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  watchId:         varchar("watch_id").notNull(),
  userId:          varchar("user_id").notNull(),
  /** WatchActivityType */
  activityType:    text("activity_type").notNull(),
  entitySymbol:    text("entity_symbol"),
  entityLabel:     text("entity_label"),
  /** ChangeDirection: 'improved' | 'weakened' | 'new' | 'removed' | 'attention' | 'stable' */
  changeDirection: text("change_direction"),
  changeData:      jsonb("change_data"),
  observedAt:      timestamp("observed_at").notNull().defaultNow(),
}, (t) => ({
  idxWatchId:    index("idx_wal_watch_id").on(t.watchId),
  idxUserId:     index("idx_wal_user_id").on(t.userId),
  idxObservedAt: index("idx_wal_observed_at").on(t.watchId, t.observedAt),
}));

export type WatchActivityRow    = typeof watchActivityLog.$inferSelect;
export type InsertWatchActivity = typeof watchActivityLog.$inferInsert;

// ---------------------------------------------------------------------------
// Sprint 2.5.5 — Research Reports
// ---------------------------------------------------------------------------

export const researchReports = pgTable("research_reports", {
  id:           varchar("id", { length: 128 }).primaryKey(),
  userId:       varchar("user_id", { length: 128 }).notNull(),
  title:        text("title").notNull(),
  subtitle:     text("subtitle"),
  reportType:   text("report_type").notNull(),
  status:       text("status").notNull().default("published"),
  isPinned:     boolean("is_pinned").notNull().default(false),
  generatedAt:  timestamp("generated_at").notNull(),
  dataFreshness: text("data_freshness"),
  marketRegime:  text("market_regime"),
  author:        text("author").notNull().default("VCP Trader AI Research Engine"),
  version:       integer("version").notNull().default(1),
  disclaimer:    text("disclaimer").notNull(),
  /** ReportContent serialised as JSONB */
  content:      jsonb("content").notNull(),
  /** Cached export strings (html / markdown / json / pdf_ready / ppt_ready) */
  exports:      jsonb("exports"),
  tags:         text("tags").array(),
  /** Short plain-text summary for search display (≤300 chars) */
  summary:      text("summary"),
  createdAt:    timestamp("created_at").defaultNow(),
  updatedAt:    timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxRrUserId:      index("idx_rr_user_id").on(t.userId),
  idxRrStatus:      index("idx_rr_status").on(t.userId, t.status),
  idxRrType:        index("idx_rr_type").on(t.userId, t.reportType),
  idxRrPinned:      index("idx_rr_pinned").on(t.userId, t.isPinned),
  idxRrGeneratedAt: index("idx_rr_generated_at").on(t.userId, t.generatedAt),
}));

export type ResearchReportRow    = typeof researchReports.$inferSelect;
export type InsertResearchReport = typeof researchReports.$inferInsert;

// ---------------------------------------------------------------------------
// Sprint 2.6.5 — Research Goals & Research Planning
// ---------------------------------------------------------------------------

/**
 * research_goals — user research preference data.
 *
 * These are RESEARCH PREFERENCES, not suitability determinations.
 * No financial questionnaire data (income, net worth, etc.) is stored here.
 *
 * Ownership rule: always query WHERE id = ? AND user_id = ?
 * Primary goal: enforced in service logic (only one is_primary = TRUE per user).
 *
 * Future extensibility: goalScope field can be added later to support
 * client / team / firm / institution ownership hierarchies (RIA sprint).
 */
export const researchGoals = pgTable("research_goals", {
  id:                       varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:                   varchar("user_id").notNull(),
  name:                     text("name").notNull(),
  /** GoalType — see shared/research-goal-types.ts */
  goalType:                 text("goal_type").notNull().default("custom"),
  description:              text("description"),
  /** ResearchHorizon: short_term | medium_term | long_term | multi_year */
  horizon:                  text("horizon").notNull().default("long_term"),
  /** ResearchStyle: growth | value | income | quality | momentum | balanced | ... */
  researchStyle:            text("research_style").notNull().default("balanced"),
  /** Free-form focus area labels */
  focusAreas:               jsonb("focus_areas").notNull().default([]),
  /** Sector names aligned to canonical sector registry */
  preferredSectors:         jsonb("preferred_sectors").notNull().default([]),
  /** Theme names aligned to canonical theme registry */
  preferredThemes:          jsonb("preferred_themes").notNull().default([]),
  /** OpportunityType values from opportunity intelligence */
  preferredOpportunityTypes: jsonb("preferred_opportunity_types").notNull().default([]),
  /** VolatilityPreference: lower | balanced | higher_accepted */
  volatilityPreference:     text("volatility_preference").notNull().default("balanced"),
  optionsInterest:          boolean("options_interest").notNull().default(false),
  monitoringEnabled:        boolean("monitoring_enabled").notNull().default(false),
  isPrimary:                boolean("is_primary").notNull().default(false),
  /** GoalStatus: active | paused | archived */
  status:                   text("status").notNull().default("active"),
  createdAt:                timestamp("created_at").notNull().defaultNow(),
  updatedAt:                timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  idxUserId:     index("idx_rg_user_id").on(t.userId),
  idxStatus:     index("idx_rg_user_status").on(t.userId, t.status),
  idxPrimary:    index("idx_rg_user_primary").on(t.userId, t.isPrimary),
}));

export type ResearchGoalRow    = typeof researchGoals.$inferSelect;
export type InsertResearchGoal = typeof researchGoals.$inferInsert;

// ===========================================================================
// Trade Planning Sessions — Sprint 2.7.0
// ===========================================================================

/**
 * trade_planning_sessions — user-selected planning sessions.
 *
 * Stores only user-selected planning constraints and selected expression
 * family. Does NOT store orders, broker instructions, scores, or
 * authoritative research data. Server always reconstructs those from
 * canonical services.
 *
 * No income, net worth, age, tax bracket, or household data.
 */
export const tradePlanningSessions = pgTable("trade_planning_sessions", {
  id:                       varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:                   text("user_id").notNull(),
  symbol:                   varchar("symbol", { length: 20 }).notNull(),
  opportunityId:            text("opportunity_id"),
  // TEXT to match research_goals.id which is varchar (not UUID)
  researchGoalId:           text("research_goal_id"),
  portfolioId:              text("portfolio_id"),
  // User-selected planning constraints — JSONB, validated server-side
  constraints:              jsonb("constraints").notNull().$type<Record<string, unknown>>().default({ equityAllowed: true, optionsAllowed: false }),
  // User's current focus area in this session (low-level family)
  selectedExpressionFamily: text("selected_expression_family"),
  // Sprint 2.8.1A — Broad expression type explicitly selected by user
  broadExpressionType:      text("broad_expression_type"),
  expressionSelectedBy:     text("expression_selected_by"),   // always "USER"
  createdAt:                timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt:                timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  idxUserId:     index("idx_tps_user_id").on(t.userId),
  idxUserSymbol: index("idx_tps_user_symbol").on(t.userId, t.symbol),
  idxUpdated:    index("idx_tps_updated").on(t.updatedAt),
}));

export type TradePlanningSessionRow    = typeof tradePlanningSessions.$inferSelect;
export type InsertTradePlanningSession = typeof tradePlanningSessions.$inferInsert;

// ============================================================================
// Trade Plan Workspace — Sprint 2.7.5
// ============================================================================

/**
 * trade_plans — canonical user-saved research plans.
 * Strict user ownership. No broker/order fields.
 * Snapshots preserve what the user saw at plan creation (immutable).
 */
export const tradePlans = pgTable("trade_plans", {
  id:                    varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:                text("user_id").notNull(),
  symbol:                varchar("symbol", { length: 20 }).notNull(),
  companyName:           text("company_name"),
  planType:              text("plan_type").notNull(),               // EQUITY | OPTIONS
  status:                text("status").notNull().default("DRAFT"), // TradePlanStatus
  planHealth:            text("plan_health").notNull().default("UNKNOWN"), // TradePlanHealth
  planningContextId:     text("planning_context_id").notNull(),
  researchGoalId:        text("research_goal_id"),
  portfolioId:           text("portfolio_id"),
  selectedExpressionFamily: text("selected_expression_family").notNull(),
  // Immutable snapshots (JSONB — preserved at plan creation)
  researchSnapshot:      jsonb("research_snapshot").notNull().$type<Record<string, unknown>>(),
  planningSnapshot:      jsonb("planning_snapshot").notNull().$type<Record<string, unknown>>(),
  structureSnapshot:     jsonb("structure_snapshot").$type<Record<string, unknown>>(),
  riskSnapshot:          jsonb("risk_snapshot").$type<Record<string, unknown>>(),
  // Mutable user data
  monitoringSnapshot:    jsonb("monitoring_snapshot").notNull().$type<Record<string, unknown>>().default({}),
  userNotes:             text("user_notes"),                        // private; never logged
  reviewChecklist:       jsonb("review_checklist").notNull().$type<Record<string, unknown>>().default({}),
  // Versioning
  version:               integer("version").notNull().default(1),
  // Timestamps
  createdAt:             timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).defaultNow(),
  archivedAt:            timestamp("archived_at", { withTimezone: true }),
  completedResearchAt:   timestamp("completed_research_at", { withTimezone: true }),
  monitoringStartedAt:   timestamp("monitoring_started_at", { withTimezone: true }),
  // Sprint 2.8.1A — Broad expression type explicitly selected by user
  broadExpressionType:    text("broad_expression_type"),
  expressionSelectedBy:   text("expression_selected_by"),   // always "USER"
  expressionSelectedAt:   timestamp("expression_selected_at", { withTimezone: true }),
  // Creation-time context
  freshnessAtCreation:   text("freshness_at_creation").notNull().default("unknown"),
  limitations:           jsonb("limitations").notNull().$type<string[]>().default([]),
  // Sprint 2.8.6A — Explicit research review acknowledgement
  // Set when the user explicitly marks "Research Reviewed" in the lifecycle panel.
  // When set and recent (<= 7 days), clears REQUIRES_REVIEW lifecycle state.
  // Does NOT clear THESIS_INVALIDATED or DATA_STALE — those take priority.
  lastReviewedAt:            timestamp("last_reviewed_at", { withTimezone: true }),
  lastReviewedResearchState: jsonb("last_reviewed_research_state").$type<Record<string, unknown>>(),
}, (t) => ({
  idxUserId:        index("idx_trade_plans_user_id").on(t.userId),
  idxUserStatus:    index("idx_trade_plans_user_status").on(t.userId, t.status),
  idxUserSymbol:    index("idx_trade_plans_user_symbol").on(t.userId, t.symbol),
  idxCreatedAt:     index("idx_trade_plans_created_at").on(t.createdAt),
}));

export type TradePlanRow    = typeof tradePlans.$inferSelect;
export type InsertTradePlan = typeof tradePlans.$inferInsert;

/**
 * trade_plan_versions — immutable version history.
 * Created when user explicitly updates authoritative plan components.
 * Preserves created snapshot + latest snapshot for traceability.
 */
export const tradePlanVersions = pgTable("trade_plan_versions", {
  id:               varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradePlanId:      varchar("trade_plan_id").notNull(),
  userId:           text("user_id").notNull(),           // for ownership validation
  version:          integer("version").notNull(),
  changeReason:     text("change_reason"),
  researchSnapshot: jsonb("research_snapshot").notNull().$type<Record<string, unknown>>(),
  planningSnapshot: jsonb("planning_snapshot").notNull().$type<Record<string, unknown>>(),
  structureSnapshot: jsonb("structure_snapshot").$type<Record<string, unknown>>(),
  riskSnapshot:     jsonb("risk_snapshot").$type<Record<string, unknown>>(),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  idxPlanId:        index("idx_tpv_plan_id").on(t.tradePlanId),
  idxUserId:        index("idx_tpv_user_id").on(t.userId),
}));

export type TradePlanVersionRow    = typeof tradePlanVersions.$inferSelect;
export type InsertTradePlanVersion = typeof tradePlanVersions.$inferInsert;

/**
 * trade_plan_activity — lifecycle event log for a trade plan.
 * Persists observed lifecycle events (research changes, invalidation, expiration, etc.).
 * Created by the lifecycle evaluation service.
 * Deduplicated by fingerprint + dedup window to prevent repeated entries.
 * User-owned. No capital, P/L, notes, option legs, or user identity in metadata.
 */
export const tradePlanActivity = pgTable("trade_plan_activity", {
  id:            varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradePlanId:   varchar("trade_plan_id").notNull(),
  userId:        text("user_id").notNull(),
  activityType:  text("activity_type").notNull(),  // ActivityEventType
  observedAt:    timestamp("observed_at", { withTimezone: true }).defaultNow(),
  previousState: text("previous_state"),
  currentState:  text("current_state"),
  summary:       text("summary").notNull(),
  metadata:      jsonb("metadata").notNull().$type<Record<string, unknown>>().default({}),
  fingerprint:   text("fingerprint").notNull(),
}, (t) => ({
  idxPlanId:      index("idx_tpa_plan_id").on(t.tradePlanId),
  idxUserId:      index("idx_tpa_user_id").on(t.userId),
  idxObservedAt:  index("idx_tpa_observed_at").on(t.tradePlanId, t.observedAt),
  idxFingerprint: index("idx_tpa_fingerprint").on(t.fingerprint),
}));

export type TradePlanActivityRow    = typeof tradePlanActivity.$inferSelect;
export type InsertTradePlanActivity = typeof tradePlanActivity.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION PREFLIGHT TABLES  (Sprint 2.8.0)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// ORDER DRAFTS (Sprint 2.8.1 — Order Preparation Engine)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Order Drafts — non-executable order preparation records.
 *
 * INVARIANT: An order draft is a non-executable representation of a possible
 * future broker order. It MUST NOT cause broker mutation. No broker order ID,
 * no execution status, no fill data.
 *
 * Unique constraint on (fingerprint, user_id) for concurrency safety.
 * Uses upsert (onConflictDoUpdate) to handle concurrent identical requests.
 */
export const orderDrafts = pgTable("order_drafts", {
  id:               varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:           text("user_id").notNull(),
  tradePlanId:      varchar("trade_plan_id").notNull(),
  tradePlanVersion: integer("trade_plan_version").notNull().default(1),
  preflightId:      varchar("preflight_id").notNull(),
  provider:         text("provider").notNull().default("unknown"),
  accountRef:       text("account_ref").notNull().default("none"),
  instrumentType:   text("instrument_type").notNull(),
  structureType:    text("structure_type").notNull(),
  /** Full OrderDraft. No raw tokens, broker credentials, balances, or positions. */
  draftJson:        jsonb("draft_json").notNull().$type<Record<string, unknown>>().default({}),
  fingerprint:      text("fingerprint").notNull(),
  status:           text("status").notNull().default("DRAFT"),
  version:          integer("version").notNull().default(1),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt:        timestamp("expires_at", { withTimezone: true }),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxOdUserId:      index("idx_od_user_id").on(t.userId),
  idxOdTradePlanId: index("idx_od_trade_plan_id").on(t.tradePlanId),
  idxOdStatus:      index("idx_od_status").on(t.status),
  idxOdFingerprint: uniqueIndex("idx_od_fingerprint_user").on(t.fingerprint, t.userId),
}));

export type OrderDraftRow    = typeof orderDrafts.$inferSelect;
export type InsertOrderDraft = typeof orderDrafts.$inferInsert;

/**
 * Execution preflight results.
 * Append-only. One row per preflight evaluation.
 * result_json holds the full ExecutionPreflightResult (no raw tokens, balances, positions).
 */
export const executionPreflights = pgTable("execution_preflights", {
  id:          varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:      text("user_id").notNull(),
  tradePlanId: varchar("trade_plan_id").notNull(),
  provider:    text("provider"),
  status:      text("status").notNull(),
  resultJson:  jsonb("result_json").notNull().$type<Record<string, unknown>>().default({}),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
  validUntil:  timestamp("valid_until", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxEpUserId:      index("idx_ep_user_id").on(t.userId),
  idxEpTradePlanId: index("idx_ep_trade_plan_id").on(t.tradePlanId),
  idxEpEvaluatedAt: index("idx_ep_evaluated_at").on(t.evaluatedAt),
}));

export type ExecutionPreflightRow    = typeof executionPreflights.$inferSelect;
export type InsertExecutionPreflight = typeof executionPreflights.$inferInsert;

/**
 * Execution audit events.
 * Strictly append-only.
 * No raw tokens, full account IDs, balances, or positions in metadata.
 */
export const executionAuditEvents = pgTable("execution_audit_events", {
  id:               varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:           text("user_id").notNull(),
  tradePlanId:      varchar("trade_plan_id").notNull(),
  eventType:        text("event_type").notNull(),
  occurredAt:       timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  provider:         text("provider"),
  accountRefMasked: text("account_ref_masked"),
  metadata:         jsonb("metadata").notNull().$type<Record<string, unknown>>().default({}),
}, (t) => ({
  idxEaeUserId:      index("idx_eae_user_id").on(t.userId),
  idxEaeTradePlanId: index("idx_eae_trade_plan_id").on(t.tradePlanId),
  idxEaeOccurredAt:  index("idx_eae_occurred_at").on(t.occurredAt),
}));

export type ExecutionAuditEventRow    = typeof executionAuditEvents.$inferSelect;
export type InsertExecutionAuditEvent = typeof executionAuditEvents.$inferInsert;
