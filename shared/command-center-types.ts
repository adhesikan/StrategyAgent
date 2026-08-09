/**
 * Sprint 2.5.3 / 2.5.4 — Market Research Command Center
 *
 * Shared types for the daily command-center snapshot.
 * The Command Center answers "What changed today?" without requiring search.
 *
 * Consumes:
 *   Opportunity Intelligence Engine  ·  Research Collections
 *   AI Research Workspace            ·  Market / Theme / Sector Intelligence
 *   Institutional Intelligence
 *
 * COMPLIANCE: No "recommendation", "buy", "sell", "target price".
 *
 * -------------------------------------------------------------------
 * Free vs Premium access documentation (No artificial restrictions in code)
 * -------------------------------------------------------------------
 * Registered users (free):
 *   Market Overview · Top-5 Theme Changes · Top-5 Sector Changes
 *   Opportunity Changes (top 5 movers) · System Collection highlights
 *   Research Timeline (last 5 conversations)
 *
 * Subscribers:
 *   Full Opportunity Changes (all movers, upgrades, downgrades, new, removed)
 *   All Theme / Sector changes · Institutional Changes
 *   AI Research Summary with suggested queries
 *   Research Timeline (full history)
 *
 * Professional:
 *   AI Research Summary with evidence citations per section
 *   Cross-collection change analysis
 *   Institutional signal detail (per-fund breakdown)
 *
 * Enterprise:
 *   Custom collection monitoring · Institutional portfolio matching
 *   Sector/theme exposure reports
 */

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

export interface RelatedResearchLink {
  label: string;
  path: string;
}

export interface ConfidenceLevel {
  level: "high" | "medium" | "low";
  /** Human-readable basis for the confidence rating. */
  basis: string;
}

// ---------------------------------------------------------------------------
// Market Overview
// ---------------------------------------------------------------------------

export interface ThemeSummaryItem {
  themeId:    string;
  themeName:  string;
  score:      number;
  direction:  "up" | "down" | "stable";
  scoreDelta: number | null;
  topSymbols: string[];
  relatedResearch: RelatedResearchLink[];
}

export interface SectorSummaryItem {
  sector:     string;
  label:      string;
  score:      number;
  direction:  "up" | "down" | "stable";
  scoreDelta: number | null;
  topSymbols: string[];
  relatedResearch: RelatedResearchLink[];
}

export interface MarketOverviewSection {
  regime:           string | null;
  marketHealth:     number | null;
  marketHealthLabel: "Strong" | "Moderate" | "Weak" | "Unknown";
  leadingThemes:    ThemeSummaryItem[];
  leadingSectors:   SectorSummaryItem[];
  mostImprovedThemes:  ThemeSummaryItem[];
  weakeningThemes:     ThemeSummaryItem[];
  whatsNew:     string[];
  whatsChanged: string[];
  evidence:     string[];
  confidence:   ConfidenceLevel;
  freshness:    string | null;
  hasData:      boolean;
  relatedResearch: RelatedResearchLink[];
}

// ---------------------------------------------------------------------------
// Opportunity Changes
// ---------------------------------------------------------------------------

export interface OpportunityChangeItem {
  symbol:        string;
  companyName:   string | null;
  previousScore: number | null;
  currentScore:  number | null;
  scoreDelta:    number | null;
  changeType:    "upgrade" | "downgrade" | "new" | "removed" | "major_mover";
  importance:    "Minor" | "Moderate" | "Major" | "Critical";
  explanation:   string;
  drivers:       string[];
  warnings:      string[];
  previousState: string | null;
  currentState:  string | null;
  relatedResearch: RelatedResearchLink[];
}

export interface OpportunityChangesSection {
  available:    boolean;
  majorMovers:  OpportunityChangeItem[];
  upgrades:     OpportunityChangeItem[];
  downgrades:   OpportunityChangeItem[];
  newEntries:   OpportunityChangeItem[];
  removed:      OpportunityChangeItem[];
  totalChanged: number;
  whatsNew:     string[];
  whatsChanged: string[];
  evidence:     string[];
  confidence:   ConfidenceLevel;
  freshness:    string | null;
  relatedResearch: RelatedResearchLink[];
}

// ---------------------------------------------------------------------------
// Theme Changes
// ---------------------------------------------------------------------------

export interface ThemeChangesSection {
  themes:       ThemeSummaryItem[];
  whatsNew:     string[];
  whatsChanged: string[];
  evidence:     string[];
  confidence:   ConfidenceLevel;
  freshness:    string | null;
  hasData:      boolean;
  relatedResearch: RelatedResearchLink[];
}

// ---------------------------------------------------------------------------
// Sector Changes
// ---------------------------------------------------------------------------

export interface SectorChangesSection {
  sectors:      SectorSummaryItem[];
  whatsNew:     string[];
  whatsChanged: string[];
  evidence:     string[];
  confidence:   ConfidenceLevel;
  freshness:    string | null;
  hasData:      boolean;
  relatedResearch: RelatedResearchLink[];
}

// ---------------------------------------------------------------------------
// Institutional Changes
// ---------------------------------------------------------------------------

export interface InstitutionalSignalItem {
  symbol:      string;
  companyName: string | null;
  signalType:  string;
  magnitude:   "high" | "medium" | "low";
  detail:      string;
  calculatedAt: string | null;
  relatedResearch: RelatedResearchLink[];
}

export interface InstitutionalChangesSection {
  available:    boolean;
  recentSignals: InstitutionalSignalItem[];
  whatsNew:     string[];
  whatsChanged: string[];
  evidence:     string[];
  confidence:   ConfidenceLevel;
  freshness:    string | null;
  relatedResearch: RelatedResearchLink[];
}

// ---------------------------------------------------------------------------
// Collection Changes
// ---------------------------------------------------------------------------

export interface CollectionChangeSummary {
  id:             string;
  name:           string;
  collectionType: "system" | "user";
  systemKey:      string | null;
  opportunityCount: number;
  topOpportunities: string[];
  isFollowing: boolean;
  isFavorite:  boolean;
  isPinned:    boolean;
  relatedResearch: RelatedResearchLink[];
}

export interface CollectionChangesSection {
  collections:  CollectionChangeSummary[];
  whatsNew:     string[];
  whatsChanged: string[];
  evidence:     string[];
  confidence:   ConfidenceLevel;
  freshness:    string | null;
  relatedResearch: RelatedResearchLink[];
}

// ---------------------------------------------------------------------------
// My Collections
// ---------------------------------------------------------------------------

export interface MyCollectionsSection {
  pinned:           CollectionChangeSummary[];
  favorites:        CollectionChangeSummary[];
  followed:         CollectionChangeSummary[];
  systemHighlights: CollectionChangeSummary[];
  total:            number;
  relatedResearch:  RelatedResearchLink[];
}

// ---------------------------------------------------------------------------
// AI Research Summary
// ---------------------------------------------------------------------------

export interface SuggestedQuery {
  label:       string;
  description: string;
  mode:        string;
  scope:       string;
  promptText:  string;
}

export interface AiResearchSummarySection {
  available:               boolean;
  recentConversationCount: number;
  pinnedConversationCount: number;
  topModes:                string[];
  suggestedQueries:        SuggestedQuery[];
  whatsNew:                string[];
  evidence:                string[];
  confidence:              ConfidenceLevel;
  relatedResearch:         RelatedResearchLink[];
}

// ---------------------------------------------------------------------------
// Research Timeline
// ---------------------------------------------------------------------------

export interface ResearchTimelineItem {
  id:            string;
  title:         string;
  researchMode:  string;
  contextScope:  string;
  lastMessageAt: string;
  isPinned:      boolean;
  relatedResearch: RelatedResearchLink[];
}

export interface ResearchTimelineSection {
  items:              ResearchTimelineItem[];
  totalConversations: number;
  available:          boolean;
  relatedResearch:    RelatedResearchLink[];
}

// ---------------------------------------------------------------------------
// Top-level snapshot
// ---------------------------------------------------------------------------

export interface CommandCenterDailySnapshot {
  generatedAt:           string;
  marketOverview:        MarketOverviewSection;
  opportunityChanges:    OpportunityChangesSection;
  themeChanges:          ThemeChangesSection;
  sectorChanges:         SectorChangesSection;
  institutionalChanges:  InstitutionalChangesSection;
  collectionChanges:     CollectionChangesSection;
  myCollections:         MyCollectionsSection;
  aiResearchSummary:     AiResearchSummarySection;
  researchTimeline:      ResearchTimelineSection;
  /** Sprint 2.5.4 — personalized research monitoring changes */
  myWatchChanges:        MyWatchChangesSection;
}

// ---------------------------------------------------------------------------
// Sprint 2.5.4 — Research Monitor (inline to avoid cross-module imports)
// ---------------------------------------------------------------------------

export type WatchChangeDirection = "improved" | "weakened" | "new" | "removed" | "attention" | "stable";
export type CommandCenterWatchType = "company" | "theme" | "sector" | "collection" | "opportunity_type" | "market_regime" | "institutional_activity" | "growth_candidates" | "income_candidates" | "momentum" | "etf_candidates" | "dividend_candidates" | "custom_collection";

export interface WatchChangeSummary {
  watchId:         string;
  watchName:       string;
  watchType:       CommandCenterWatchType;
  entityLabel:     string | null;
  changeType:      string;
  changeDirection: WatchChangeDirection | null;
  changeSummary:   string;
  changedAt:       string;
  linkTo:          string | null;
}

export interface MyWatchChangesSection {
  available:        boolean;
  watchCount:       number;
  activeWatchCount: number;
  recentChanges:    WatchChangeSummary[];
  lastEvaluatedAt:  string | null;
  feedSummary:      string | null;
}

// ---------------------------------------------------------------------------
// Platform health
// ---------------------------------------------------------------------------

export interface CommandCenterHealthSnapshot {
  lastGeneratedAt:               string | null;
  sectionsAvailable:             number;
  opportunityChangesAvailable:   boolean;
  themeDataAvailable:            boolean;
  sectorDataAvailable:           boolean;
  collectionsSeeded:             boolean;
  institutionalDataAvailable:    boolean;
}
