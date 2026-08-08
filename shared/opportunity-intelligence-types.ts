/**
 * Sprint 2.5.0 — Opportunity Intelligence Engine
 *
 * Canonical, normalized opportunity model consumed by:
 *   Dashboard · Research · Ask AI · Intelligence · (future) Portfolio · Watchlists · Alerts
 *
 * IMPORTANT
 *   "Research Candidate" / "Investment Candidate" / "Trade Candidate" language only.
 *   Never "recommendation", "buy", "sell", "target price", or "strong buy".
 */

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

export type OpportunityType =
  | "growth"
  | "long_term_investment"
  | "income"
  | "covered_call"
  | "cash_secured_put"
  | "etf"
  | "dividend"
  | "momentum"
  | "value"
  | "swing"
  | "ai_infrastructure"
  | "semiconductors"
  | "memory"
  | "networking"
  | "cybersecurity"
  | "cloud"
  | "energy"
  | "healthcare"
  | "financials"
  | "consumer"
  | "industrials"
  | "custom_theme";

export const OPPORTUNITY_TYPE_LABELS: Record<OpportunityType, string> = {
  growth:               "Growth Candidate",
  long_term_investment: "Long-Term Investment Candidate",
  income:               "Income Candidate",
  covered_call:         "Covered Call Candidate",
  cash_secured_put:     "Cash-Secured Put Candidate",
  etf:                  "ETF Candidate",
  dividend:             "Dividend Candidate",
  momentum:             "Momentum Candidate",
  value:                "Value Candidate",
  swing:                "Swing Candidate",
  ai_infrastructure:    "AI Infrastructure Candidate",
  semiconductors:       "Semiconductors Candidate",
  memory:               "Memory Candidate",
  networking:           "Networking Candidate",
  cybersecurity:        "Cybersecurity Candidate",
  cloud:                "Cloud Candidate",
  energy:               "Energy Candidate",
  healthcare:           "Healthcare Candidate",
  financials:           "Financials Candidate",
  consumer:             "Consumer Candidate",
  industrials:          "Industrials Candidate",
  custom_theme:         "Custom Theme Candidate",
};

export type RiskLevel     = "low" | "medium" | "high";
export type TimeHorizon   = "short" | "medium" | "long";
export type OppConfidence = "high" | "medium" | "low";

// ---------------------------------------------------------------------------
// Evidence and risk types
// ---------------------------------------------------------------------------

export type EvidenceStrength = "strong" | "moderate" | "weak";
export type EvidenceCategory =
  | "technical"
  | "fundamental"
  | "institutional"
  | "theme"
  | "sector"
  | "catalyst";

export interface EvidenceItem {
  type:     EvidenceCategory;
  label:    string;
  detail:   string;
  strength: EvidenceStrength;
}

export interface RiskFactor {
  label:    string;
  detail:   string;
  severity: "high" | "medium" | "low";
}

export interface InvalidatesThesis {
  condition: string;
  detail:    string;
}

// ---------------------------------------------------------------------------
// Canonical Opportunity (the unified model)
// ---------------------------------------------------------------------------

export interface CanonicalOpportunity {
  id:                string;
  symbol:            string;
  companyName:       string | null;
  sector:            string | null;
  industry:          string | null;
  themes:            string[];                // theme names (not IDs)

  opportunityType:      OpportunityType;
  opportunityTypeLabel: string;

  // Research quality scores — all 0-100
  researchScore:      number;
  technicalScore:     number;
  fundamentalScore:   number;
  institutionalScore: number;
  sentimentScore:     number;               // derived proxy score

  confidence:    OppConfidence;
  marketRegime:  string | null;
  timeHorizon:   TimeHorizon;
  riskLevel:     RiskLevel;

  lastUpdated: string;

  primaryEvidence:   EvidenceItem[];        // top 3–4 positive signals
  secondaryEvidence: EvidenceItem[];        // supporting context
  riskFactors:       RiskFactor[];          // scanner warnings + risk signals
  invalidatesThesis: InvalidatesThesis[];   // conditions that cancel the thesis

  // Internal — available to API consumers for sorting/display
  _sourceCategory: string;                  // "topGrowth" | "topIncome" | "watchlist" | "approaching"
  _rank:           number;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export interface OpportunityFilterOptions {
  sector?:              string[];
  industry?:            string[];
  theme?:               string[];
  opportunityType?:     OpportunityType[];
  minResearchScore?:    number;
  minTechnicalScore?:   number;
  minInstitutionalScore?: number;
  riskLevel?:           RiskLevel[];
  timeHorizon?:         TimeHorizon[];
  marketRegime?:        string;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type OpportunitySortField =
  | "researchScore"
  | "technicalScore"
  | "institutionalScore"
  | "symbol"
  | "lastUpdated"
  | "opportunityType";

export interface OpportunitySortOptions {
  field:     OpportunitySortField;
  direction: "asc" | "desc";
}

// ---------------------------------------------------------------------------
// Engine result
// ---------------------------------------------------------------------------

export interface OpportunityIntelligenceMeta {
  sectors:          string[];
  industries:       string[];
  themes:           string[];
  opportunityTypes: OpportunityType[];
  riskLevels:       RiskLevel[];
  timeHorizons:     TimeHorizon[];
}

export interface OpportunityIntelligenceResult {
  generatedAt:  string;
  marketRegime: string | null;
  totalCount:   number;
  filteredCount: number;
  opportunities: CanonicalOpportunity[];
  meta:          OpportunityIntelligenceMeta;
}
