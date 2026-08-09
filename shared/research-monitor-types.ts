/**
 * Research Monitor Types — Sprint 2.5.4
 *
 * Continuous Research Monitoring & Daily Intelligence Feed
 *
 * All types are deterministic — no prediction, no recommendation, no guarantee.
 * All terminology follows the Research Glossary (shared/research-glossary.ts).
 *
 * Future notification targets (email, push, Slack, Teams, webhook) are
 * described here as interfaces but NOT implemented in this sprint.
 */

// ============================================================================
// Enumerations
// ============================================================================

/** What kind of entity the watch tracks */
export type WatchType =
  | "company"               // Specific ticker / company
  | "theme"                 // Curated theme (AI Infrastructure, Semiconductors, etc.)
  | "sector"                // Market sector (Technology, Healthcare, etc.)
  | "collection"            // Research collection (system or user)
  | "opportunity_type"      // Category: growth | income | momentum | etf | dividend
  | "market_regime"         // Overall market regime change
  | "institutional_activity"// Institutional 13F activity for a symbol
  | "growth_candidates"     // All growth-type qualified candidates
  | "income_candidates"     // All income-type qualified candidates
  | "momentum"              // Momentum / power-breakout candidates
  | "etf_candidates"        // ETF research candidates
  | "dividend_candidates"   // Dividend / covered-call candidates
  | "custom_collection";    // User-defined collection watch (future)

export const WATCH_TYPES: WatchType[] = [
  "company", "theme", "sector", "collection", "opportunity_type",
  "market_regime", "institutional_activity", "growth_candidates",
  "income_candidates", "momentum", "etf_candidates", "dividend_candidates",
  "custom_collection",
];

/** Lifecycle state of a watch */
export type WatchStatus = "active" | "paused" | "archived";

/** Direction of an observed change */
export type ChangeDirection = "improved" | "weakened" | "new" | "removed" | "attention" | "stable";

/** What triggered the activity log entry */
export type WatchActivityType =
  | "new_candidate"            // Symbol newly qualified
  | "candidate_removed"        // Symbol no longer qualified
  | "score_improved"           // Research score improved meaningfully
  | "score_weakened"           // Research score declined meaningfully
  | "confidence_changed"       // Confidence level changed
  | "regime_change"            // Market regime changed
  | "theme_improved"           // Theme score improved
  | "theme_weakened"           // Theme score weakened
  | "sector_improved"          // Sector score improved
  | "sector_weakened"          // Sector score weakened
  | "collection_added"         // Symbol added to a collection
  | "collection_removed"       // Symbol removed from a collection
  | "institutional_accumulation"| // Institutional accumulation detected
  "institutional_distribution" // Institutional distribution detected
  | "member_count_changed"     // Number of candidates in a category changed
  | "status_unchanged";        // Evaluated; no meaningful change detected

// ============================================================================
// Core Models
// ============================================================================

/** A research watch created by a user */
export interface ResearchWatch {
  id: string;
  userId: string;
  name: string;
  watchType: WatchType;
  /** Symbol, themeId, sector name, collectionId, or null for market-wide watches */
  entityId: string | null;
  /** Human-readable label (company name, theme name, sector name, etc.) */
  entityLabel: string | null;
  status: WatchStatus;
  lastEvaluatedAt: Date | null;
  lastChangeAt: Date | null;
  lastChangeType: WatchActivityType | null;
  lastChangeSummary: string | null;
  /** Future notification targets — not implemented in Sprint 2.5.4 */
  notifyEmail: boolean;
  notifyPush: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** One observed change event for a watch */
export interface WatchActivityEntry {
  id: string;
  watchId: string;
  userId: string;
  activityType: WatchActivityType;
  entitySymbol: string | null;
  entityLabel: string | null;
  changeDirection: ChangeDirection | null;
  /** Structured change data: { from?, to?, delta?, reasons?, regime?, score? } */
  changeData: Record<string, unknown> | null;
  observedAt: Date;
}

// ============================================================================
// Watch Input / Mutations
// ============================================================================

export interface CreateWatchInput {
  name: string;
  watchType: WatchType;
  entityId?: string | null;
  entityLabel?: string | null;
}

export interface UpdateWatchInput {
  name?: string;
  status?: WatchStatus;
  notifyEmail?: boolean;
  notifyPush?: boolean;
}

// ============================================================================
// Watch Evaluation
// ============================================================================

/** Result of evaluating one watch against current precomputed intelligence */
export interface WatchEvaluation {
  watchId: string;
  evaluatedAt: string;
  changed: boolean;
  changeType: WatchActivityType;
  changeDirection: ChangeDirection | null;
  changeSummary: string;
  activityEntries: WatchActivityEntry[];
  currentStatus: WatchCurrentStatus;
}

/** Current computed state of the watched entity */
export interface WatchCurrentStatus {
  score?: number;
  confidence?: string;
  label?: string;
  memberCount?: number;
  regime?: string | null;
  trend?: string | null;
  lastUpdated: string | null;
  freshnessSec?: number | null;
  isQualified?: boolean;
  opportunityType?: string | null;
}

// ============================================================================
// Watch Detail
// ============================================================================

export interface RelatedCandidate {
  symbol: string;
  label: string;
  score: number;
  direction: ChangeDirection;
  linkTo: string;
}

export interface ResearchWatchDetail extends ResearchWatch {
  currentStatus: WatchCurrentStatus;
  recentActivity: WatchActivityEntry[];
  relatedCandidates: RelatedCandidate[];
  evidence: string[];
  whyChanged: string[];
  freshness: string | null;
}

// ============================================================================
// Daily Research Feed
// ============================================================================

export interface FeedItem {
  id: string;
  symbol?: string;
  label: string;
  detail: string;
  changeDirection: ChangeDirection;
  /** Link to an existing page (opportunity workspace, intelligence, collections, etc.) */
  linkTo: string;
  score?: number;
  delta?: number;
  watchId?: string;
}

export interface FeedSection {
  id: string;
  title: string;
  description: string;
  changeType: "new" | "improved" | "weakened" | "attention" | "stable";
  count: number;
  items: FeedItem[];
  linkTo?: string;
}

export interface FeedSummary {
  totalChanges: number;
  highlights: string[];
  newCandidates: number;
  improvedCandidates: number;
  weakenedCandidates: number;
  themeChanges: number;
  sectorChanges: number;
  regimeChanged: boolean;
}

export interface DailyResearchFeed {
  feedId: string;
  generatedAt: string;
  feedDate: string;
  summary: FeedSummary;
  sections: FeedSection[];
  /** True when personalized to user's watches; false = market-wide feed */
  isPersonalized: boolean;
  watchCount: number;
}

// ============================================================================
// Future Notification Targets — Interfaces Only (NOT IMPLEMENTED)
// ============================================================================

/** Future: delivery channel for watch changes. Not implemented in Sprint 2.5.4. */
export interface NotificationTarget {
  type: "email" | "push" | "slack" | "teams" | "webhook";
  config: Record<string, unknown>;
  enabled: boolean;
}

/**
 * Future: notification channel status.
 * Reserved for Sprint 2.6+ (Alerts & Notifications).
 */
export interface NotificationChannelStatus {
  channelType: NotificationTarget["type"];
  isConfigured: boolean;
  isEnabled: boolean;
  lastDeliveredAt: string | null;
}

// ============================================================================
// Monitoring Health (Platform Health)
// ============================================================================

export interface ResearchMonitoringHealth {
  watchCount: number;
  activeWatchCount: number;
  lastEvaluatedAt: string | null;
  lastFeedGeneratedAt: string | null;
  evaluationsToday: number;
}

// ============================================================================
// Command Center Integration
// ============================================================================

export interface WatchChangeSummary {
  watchId: string;
  watchName: string;
  watchType: WatchType;
  entityLabel: string | null;
  changeType: WatchActivityType;
  changeDirection: ChangeDirection | null;
  changeSummary: string;
  changedAt: string;
  linkTo: string | null;
}

export interface MyWatchChangesSection {
  available: boolean;
  watchCount: number;
  activeWatchCount: number;
  recentChanges: WatchChangeSummary[];
  lastEvaluatedAt: string | null;
  feedSummary: string | null;
}
