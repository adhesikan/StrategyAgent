// Sprint 5.4D — Research Records client types
// Mirrors the server-side ResearchEvidenceRecord / DB schema.
// No raw evidence is ever submitted from the browser.

export type ResearchDomain =
  | "SYMBOL_ANALYSIS"
  | "TRADE_RESEARCH"
  | "MARKET_OPPORTUNITY_SEARCH"
  | "PORTFOLIO_GOAL_RESEARCH"
  | "PORTFOLIO_IMPACT"
  | "OPTIONS_RESEARCH";

export const DOMAIN_LABELS: Record<ResearchDomain, string> = {
  SYMBOL_ANALYSIS: "Symbol Analysis",
  TRADE_RESEARCH: "Trade Research",
  MARKET_OPPORTUNITY_SEARCH: "Market Opportunity Search",
  PORTFOLIO_GOAL_RESEARCH: "Portfolio Goal Research",
  PORTFOLIO_IMPACT: "Portfolio Impact",
  OPTIONS_RESEARCH: "Options Research",
};

export type ResearchConfidence = "high" | "medium" | "low" | "none";

// Shape returned by /api/ask when researchSave is available.
// Only safe metadata — never evidence content.
export interface ResearchSaveMeta {
  available: true;
  handleId: string;
  domain: ResearchDomain;
  titleSuggestion: string;
  tagSuggestions: string[];
  expiresAt: string; // ISO timestamp
}

// Shape of a saved research record from the API.
export interface ResearchRecord {
  id: string;
  domain: ResearchDomain;
  schemaVersion: string;
  symbol?: string | null;
  symbols: string[];
  normalizedRequestSummary: string;
  verdict: string;
  status?: string | null;
  strategy?: string | null;
  strategyDisplayName?: string | null;
  direction?: string | null;
  instrument?: string | null;
  qualificationStatus?: string | null;
  confidence: ResearchConfidence;
  dataQuality: {
    estimated?: boolean;
    simulated?: boolean;
    partial?: boolean;
    stale?: boolean;
  };
  reasons: string[];
  warnings: string[];
  watchConditions: string[];
  sourceTools: string[];
  sourceTimestamps: string[];
  limitations: string[];
  domainSnapshot: Record<string, unknown>;
  title: string;
  userLabel?: string | null;
  tags: string[];
  archived: boolean;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
}

// Shape of the list endpoint response.
export interface ResearchRecordList {
  records: ResearchRecord[];
  count: number;
}

// User-editable metadata only — never evidence fields.
export interface ResearchRecordMetadataUpdate {
  title?: string;
  userLabel?: string;
  tags?: string[];
  archived?: boolean;
}

// POST /api/research-records body — only the handle and approved metadata.
export interface SaveResearchRequest {
  handleId: string;
  title?: string;
  userLabel?: string;
  tags?: string[];
  conversationId?: string;
}

// Decision journal entry shape.
export interface DecisionJournalEntry {
  id: string;
  researchRecordId: string;
  thesis?: string | null;
  entryPlan?: string | null;
  riskPlan?: string | null;
  exitPlan?: string | null;
  notes?: string | null;
  expectedConditions?: string | null;
  invalidationConditions?: string | null;
  userDecision: string;
  outcomeReview?: string | null;
  lessonsLearned?: string | null;
  userRecordedEntryPrice?: number | null;
  userRecordedExitPrice?: number | null;
  userRecordedQuantity?: number | null;
  openedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Query filter params for GET /api/research-records
export interface ResearchRecordFilters {
  domain?: ResearchDomain | "";
  symbol?: string;
  archived?: boolean;
  limit?: number;
  offset?: number;
}

// Confidence display helpers
export const CONFIDENCE_COLORS: Record<ResearchConfidence, string> = {
  high: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  medium: "border-sky-500/40 text-sky-300 bg-sky-500/10",
  low: "border-amber-500/40 text-amber-300 bg-amber-500/10",
  none: "border-muted text-muted-foreground bg-muted/20",
};

export function formatDomain(domain: ResearchDomain): string {
  return DOMAIN_LABELS[domain] ?? domain;
}

export function formatConfidence(c: ResearchConfidence): string {
  const map: Record<ResearchConfidence, string> = {
    high: "High confidence",
    medium: "Medium confidence",
    low: "Low confidence",
    none: "Unrated",
  };
  return map[c] ?? c;
}

export function formatGeneratedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
