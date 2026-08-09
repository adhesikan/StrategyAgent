/**
 * Sprint 2.5.5 — Research Reports & Publishing
 *
 * Shared types for the Research Report Engine.
 *
 * COMPLIANCE: No "recommendation", "buy", "sell", "target price",
 *             "strong buy", "top pick", "guarantee".
 * Use only: Research Report, Research Candidate, Observed Change,
 *           Research Summary, Market Intelligence.
 */

// ---------------------------------------------------------------------------
// Report Types (16 types)
// ---------------------------------------------------------------------------

export const REPORT_TYPES = [
  "morning_brief",
  "evening_summary",
  "market_changes",
  "weekly_market_intel",
  "weekly_ai_infrastructure",
  "weekly_semiconductor",
  "weekly_memory",
  "weekly_cloud",
  "weekly_cybersecurity",
  "weekly_institutional",
  "weekly_sector_leadership",
  "weekly_theme_leadership",
  "collection_summary",
  "research_monitoring_summary",
  "opportunity_intel_summary",
  "workspace_summary",
] as const;

export type ReportType = typeof REPORT_TYPES[number];

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  morning_brief:                "Morning Research Brief",
  evening_summary:              "Evening Research Summary",
  market_changes:               "Today's Market Changes",
  weekly_market_intel:          "Weekly Market Intelligence",
  weekly_ai_infrastructure:     "Weekly AI Infrastructure Intelligence",
  weekly_semiconductor:         "Weekly Semiconductor Intelligence",
  weekly_memory:                "Weekly Memory Intelligence",
  weekly_cloud:                 "Weekly Cloud Intelligence",
  weekly_cybersecurity:         "Weekly Cybersecurity Intelligence",
  weekly_institutional:         "Weekly Institutional Activity",
  weekly_sector_leadership:     "Weekly Sector Leadership",
  weekly_theme_leadership:      "Weekly Theme Leadership",
  collection_summary:           "Research Collection Summary",
  research_monitoring_summary:  "Research Monitoring Summary",
  opportunity_intel_summary:    "Opportunity Intelligence Summary",
  workspace_summary:            "Research Workspace Summary",
};

export const REPORT_TYPE_SUBTITLES: Partial<Record<ReportType, string>> = {
  morning_brief:            "Pre-market research intelligence",
  evening_summary:          "End-of-day research recap",
  market_changes:           "Observed research changes today",
  weekly_market_intel:      "Weekly market intelligence digest",
  weekly_ai_infrastructure: "AI infrastructure sector research",
  weekly_semiconductor:     "Semiconductor sector research",
  weekly_memory:            "Memory & storage sector research",
  weekly_cloud:             "Cloud infrastructure sector research",
  weekly_cybersecurity:     "Cybersecurity sector research",
  weekly_institutional:     "Institutional ownership activity",
  weekly_sector_leadership: "Sector leadership research",
  weekly_theme_leadership:  "Investment theme leadership research",
  collection_summary:       "Research collection overview",
  research_monitoring_summary: "Research monitoring activity",
  opportunity_intel_summary:   "Opportunity intelligence overview",
  workspace_summary:           "AI Research Workspace activity",
};

// ---------------------------------------------------------------------------
// Report Status
// ---------------------------------------------------------------------------

export type ReportStatus = "published" | "archived";

// ---------------------------------------------------------------------------
// Export Formats
// ---------------------------------------------------------------------------

export const EXPORT_FORMATS = [
  "html",
  "markdown",
  "json",
  "pdf_ready",
  "ppt_ready",
] as const;

export type ExportFormat = typeof EXPORT_FORMATS[number];

// ---------------------------------------------------------------------------
// Template Section Types (11)
// ---------------------------------------------------------------------------

export const TEMPLATE_SECTION_TYPES = [
  "executive_summary",
  "market_overview",
  "sector_summary",
  "theme_summary",
  "institutional_summary",
  "research_candidate_summary",
  "research_monitoring_summary",
  "collection_summary",
  "risk_summary",
  "methodology",
  "appendix",
] as const;

export type TemplateSectionType = typeof TEMPLATE_SECTION_TYPES[number];

// ---------------------------------------------------------------------------
// Evidence & Supporting Data
// ---------------------------------------------------------------------------

export interface EvidenceItem {
  label:       string;
  value:       string | number | null;
  context:     string | null;
  source:      string;
  dataDate:    string | null;
}

export interface DataFreshnessInfo {
  rankingAt:  string | null;
  themeAt:    string | null;
  sectorAt:   string | null;
  intelAt:    string | null;
  reportedAt: string;
}

// ---------------------------------------------------------------------------
// Report Sections
// ---------------------------------------------------------------------------

export interface ReportSection {
  id:           string;
  sectionType:  TemplateSectionType;
  title:        string;
  content:      string;
  bullets:      string[];
  data:         Record<string, unknown>;
  sortOrder:    number;
}

// ---------------------------------------------------------------------------
// Report Content (stored in JSONB)
// ---------------------------------------------------------------------------

export interface ReportContent {
  executiveSummary:   string;
  keyFindings:        string[];
  supportingEvidence: EvidenceItem[];
  riskFactors:        string[];
  methodology:        string;
  dataFreshness:      DataFreshnessInfo;
  disclaimer:         string;
  sections:           ReportSection[];
}

// ---------------------------------------------------------------------------
// Core Report Record
// ---------------------------------------------------------------------------

export interface ResearchReport {
  id:           string;
  userId:       string;
  title:        string;
  subtitle:     string | null;
  reportType:   ReportType;
  status:       ReportStatus;
  isPinned:     boolean;
  generatedAt:  string;
  dataFreshness: string | null;
  marketRegime:  string | null;
  author:        string;
  version:       number;
  disclaimer:    string;
  content:       ReportContent;
  tags:          string[];
  summary:       string | null;
  createdAt:     string;
  updatedAt:     string;
}

// ---------------------------------------------------------------------------
// Generate Options
// ---------------------------------------------------------------------------

export interface GenerateReportOptions {
  title?:    string;
  subtitle?: string;
  tags?:     string[];
  /** Scope to specific theme ID (for weekly_*_theme reports) */
  themeId?:  string;
  /** Scope to specific sector (for weekly_sector_leadership) */
  sector?:   string;
  /** Scope to specific collection ID (for collection_summary) */
  collectionId?: string;
}

// ---------------------------------------------------------------------------
// Update Input
// ---------------------------------------------------------------------------

export interface ReportUpdateInput {
  title?:    string;
  isPinned?: boolean;
  status?:   ReportStatus;
  tags?:     string[];
}

// ---------------------------------------------------------------------------
// Search Options
// ---------------------------------------------------------------------------

export interface ReportSearchOptions {
  reportType?:   ReportType | ReportType[];
  status?:       ReportStatus;
  isPinned?:     boolean;
  marketRegime?: string;
  keyword?:      string;
  symbol?:       string;
  theme?:        string;
  sector?:       string;
  collectionId?: string;
  fromDate?:     string;
  toDate?:       string;
  limit?:        number;
  offset?:       number;
  sortBy?:       "generatedAt" | "title" | "reportType";
  sortDir?:      "asc" | "desc";
}

// ---------------------------------------------------------------------------
// Report Short Card (for lists and command center)
// ---------------------------------------------------------------------------

export interface ReportShortCard {
  reportId:     string;
  title:        string;
  reportType:   ReportType;
  typeLabel:    string;
  generatedAt:  string;
  marketRegime: string | null;
  summary:      string | null;
  isPinned:     boolean;
  status:       ReportStatus;
  linkTo:       string;
}

// ---------------------------------------------------------------------------
// Command Center — Latest Report Section
// ---------------------------------------------------------------------------

export interface LatestReportSection {
  available:      boolean;
  latestReport:   ReportShortCard | null;
  recentReports:  ReportShortCard[];
  reportsToday:   number;
  lastGeneratedAt: string | null;
  generateShortcut: string;
  viewAllShortcut:  string;
}

// ---------------------------------------------------------------------------
// Platform Health
// ---------------------------------------------------------------------------

export interface ResearchReportsHealth {
  reportsGenerated:  number;
  reportsToday:      number;
  latestReport:      string | null;       // ISO timestamp of last generated report
  generationTimeMs:  number | null;
  storageHealth:     "ok" | "degraded" | "unknown";
  reportTypeBreakdown: Partial<Record<ReportType, number>>;
}

// ---------------------------------------------------------------------------
// Future-ready delivery targets (interfaces only — NOT implemented Sprint 2.5.5)
// ---------------------------------------------------------------------------

export type DeliveryChannel = "email" | "slack" | "teams" | "webhook" | "api_publish";

export interface ScheduledReportConfig {
  reportType:    ReportType;
  schedule:      "daily" | "weekly" | "on_demand";
  deliveryChannels: DeliveryChannel[];
  isActive:      boolean;
  /** Sprint 2.6+ — not yet implemented */
  _reserved:     true;
}
