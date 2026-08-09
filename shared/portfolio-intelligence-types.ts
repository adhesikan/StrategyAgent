// ---------------------------------------------------------------------------
// Sprint 2.6.1 — Portfolio Intelligence Types
//
// Portfolio Intelligence is a RESEARCH-FIRST personalization layer.
// It never creates investment recommendations, suitability determinations,
// or independent scoring universes. All scores are sourced from
// Opportunity Intelligence (see CanonicalOpportunity in
// shared/opportunity-intelligence-types.ts).
// ---------------------------------------------------------------------------

import type { CanonicalOpportunity, EvidenceItem } from "./opportunity-intelligence-types";

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** How a portfolio holding relates to the current Opportunity Intelligence snapshot. */
export type OverlapCategory =
  | "CURRENTLY_QUALIFIED"      // _sourceCategory topGrowth | topIncome
  | "APPROACHING_QUALIFICATION" // _sourceCategory approaching | watchlist
  | "NO_LONGER_QUALIFIED"      // was qualified, no longer in snapshot
  | "NOT_CURRENTLY_RANKED";    // not in current OppIntel snapshot

/** Descriptive label for position/sector/theme concentration. */
export type ConcentrationLabel = "Low" | "Moderate" | "High";

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * Research coverage tracks HOW MUCH of the portfolio has each
 * data dimension available. Missing data is tracked as null/missing,
 * never converted to zero.
 */
export interface PortfolioResearchCoverage {
  positionsTotal:                   number;
  positionsWithMarketData:          number;  // reference price available
  positionsWithOpportunityIntelligence: number; // in OppIntel snapshot
  positionsWithFundamentalEvidence: number;  // fundamentalScore > 0
  positionsWithInstitutionalEvidence: number; // institutional signal available
  positionsWithSector:              number;  // sector not null
  positionsWithTheme:               number;  // at least one theme membership
  overallCoveragePercent:           number;  // composite 0–100
}

// ---------------------------------------------------------------------------
// Concentration
// ---------------------------------------------------------------------------

/**
 * Transparent concentration metrics — no composite scores.
 *
 * Thresholds (documented in Research Glossary `portfolio_concentration`):
 *   largestPosition: Low <10%, Moderate 10–20%, High >20%
 *   top3 share:      Low <25%, Moderate 25–50%, High >50%
 *   sector:          Low <30%, Moderate 30–50%, High >50%
 *   theme:           Low <20%, Moderate 20–40%, High >40%
 */
export interface ConcentrationMetrics {
  largestPositionPercent:  number | null;
  largestPositionSymbol:   string | null;
  top3PositionPercent:     number | null;
  top5PositionPercent:     number | null;
  largestSectorPercent:    number | null;
  largestSectorName:       string | null;
  largestThemePercent:     number | null;
  largestThemeName:        string | null;
  concentrationLabel:      ConcentrationLabel;  // based on largestPositionPercent
  top3Label:               ConcentrationLabel;
  sectorLabel:             ConcentrationLabel;
}

// ---------------------------------------------------------------------------
// Sector & Theme exposure
// ---------------------------------------------------------------------------

export interface SectorExposureItem {
  sector:                      string;
  marketValue:                 number | null;
  portfolioPercent:            number | null;
  positionCount:               number;
  symbols:                     string[];
  changeSincePreviousSnapshot: number | null; // percentage-point delta
}

/**
 * Theme exposure sums overlap, so percentages CAN exceed 100% total.
 * The API and UI must display this disclosure explicitly.
 */
export interface ThemeExposureItem {
  themeId:          string;
  themeName:        string;
  marketValue:      number | null;
  portfolioPercent: number | null;
  positionCount:    number;
  symbols:          string[];
}

// ---------------------------------------------------------------------------
// Opportunity overlap
// ---------------------------------------------------------------------------

export interface OpportunityOverlapItem {
  symbol:               string;
  companyName:          string | null;
  overlapCategory:      OverlapCategory;
  researchScore:        number | null;  // from OppIntel — not recomputed
  technicalScore:       number | null;
  fundamentalScore:     number | null;
  institutionalScore:   number | null;
  opportunityType:      string | null;
  opportunityTypeLabel: string | null;
  confidence:           string | null;
  riskLevel:            string | null;
  primaryEvidence:      EvidenceItem[];
  portfolioWeight:      number | null;  // % of portfolio by market value
}

// ---------------------------------------------------------------------------
// Research change holdings
// ---------------------------------------------------------------------------

/** A holding whose research evidence changed between portfolio snapshots. */
export interface ResearchChangeHolding {
  symbol:        string;
  companyName:   string | null;
  changeType:    "RESEARCH_STRENGTHENED" | "RESEARCH_WEAKENED" | "NEWLY_QUALIFIED" | "NO_LONGER_QUALIFIED";
  previousScore: number | null;
  currentScore:  number | null;
  scoreDelta:    number | null;
  sector:        string | null;
}

// ---------------------------------------------------------------------------
// Holding research summary
// ---------------------------------------------------------------------------

/** Compact research profile for a single holding in portfolio context. */
export interface HoldingResearchSummary {
  symbol:                  string;
  companyName:             string | null;
  sector:                  string | null;
  themes:                  string[];   // theme names (not IDs)
  portfolioWeight:         number | null;
  marketValue:             number | null;
  researchScore:           number | null;
  technicalScore:          number | null;
  fundamentalScore:        number | null;
  institutionalScore:      number | null;
  overlapCategory:         OverlapCategory;
  hasInstitutionalEvidence: boolean;
  hasFundamentalEvidence:  boolean;
}

// ---------------------------------------------------------------------------
// Institutional context
// ---------------------------------------------------------------------------

export interface InstitutionalContextSummary {
  symbolsCovered:      number;  // symbols with institutional signal data
  symbolsTotal:        number;
  coveragePercent:     number;
  holdingsWithActivity: number;
  disclosure:          string;  // mandatory SEC 13F disclosure
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

export interface RiskObservation {
  type:            "concentration" | "sector_concentration" | "theme_concentration"
                 | "limited_coverage" | "institutional_data_gap"
                 | "research_weakening" | "no_longer_qualified";
  label:           string;
  description:     string;   // descriptive, never advisory
  affectedSymbols: string[];
}

export interface ResearchObservation {
  type:  string;
  text:  string;  // factual, descriptive sentence
}

export interface FurtherResearchArea {
  area:       string;
  description: string;
  linkPath?:   string;  // client-side route (e.g. "/opportunities/NVDA")
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

export interface PortfolioIntelligenceFreshness {
  generatedAt:               string;  // ISO
  opportunityIntelligenceAt: string | null;
  latestSnapshotAt:          string | null;
  historyFromAt:             string | null;
  historyToAt:               string | null;
  institutionalDataNote:     string;
}

// ---------------------------------------------------------------------------
// Canonical result — the full intelligence package
// ---------------------------------------------------------------------------

/**
 * PortfolioIntelligenceResult is the canonical reusable result for
 * Portfolio Intelligence (Sprint 2.6.1). It is deliberately structured
 * for consumption by:
 *  - The Portfolio Intelligence UI tab (Sprint 2.6.1)
 *  - Research Reports (Sprint 2.6.3)
 *  - Trade Planning (future)
 *  - AI Research Workspace portfolio context (Sprint 2.6.3)
 *
 * It contains NO opaque composite portfolio score.
 * Scoring fields come exclusively from Opportunity Intelligence.
 */
export interface PortfolioIntelligenceResult {
  portfolioId:   string;
  portfolioName: string;
  generatedAt:   string;
  snapshotId:    string | null;

  // Aggregate portfolio state
  marketValue:    number | null;
  costBasis:      number | null;
  positionCount:  number;
  marketRegime:   string | null;  // from OppIntel, never recomputed

  // Research dimensions
  coverage:         PortfolioResearchCoverage;
  concentration:    ConcentrationMetrics;
  sectorExposure:   SectorExposureItem[];   // sorted largest first
  themeExposure:    ThemeExposureItem[];    // sorted largest first; may overlap
  opportunityOverlap: OpportunityOverlapItem[];

  // Research change intelligence (requires ≥2 snapshots)
  strengthenedHoldings:    ResearchChangeHolding[];
  weakenedHoldings:        ResearchChangeHolding[];
  newlyQualifiedHoldings:  ResearchChangeHolding[];
  noLongerQualifiedHoldings: ResearchChangeHolding[];

  // Holdings classification
  qualifiedHoldings:  HoldingResearchSummary[];  // in OppIntel (any category)
  uncoveredHoldings:  HoldingResearchSummary[];  // not in OppIntel

  // Institutional
  institutionalSummary: InstitutionalContextSummary;

  // Observations (all descriptive, never advisory)
  riskObservations:     RiskObservation[];
  researchObservations: ResearchObservation[];
  furtherResearchAreas: FurtherResearchArea[];

  // Compliance
  disclaimer:  string;
  limitations: string[];
  freshness:   PortfolioIntelligenceFreshness;
}

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

export interface PortfolioIntelligenceResponse {
  available:    boolean;
  portfolioId:  string;
  generatedAt:  string;
  intelligence: PortfolioIntelligenceResult | null;
  message?:     string;
}

export interface PortfolioSymbolIntelligence {
  portfolioId:                  string;
  symbol:                       string;
  companyName:                  string | null;
  portfolioWeight:              number | null;  // % of total portfolio market value
  quantity:                     number;
  marketValue:                  number | null;
  sector:                       string | null;
  industry:                     string | null;
  themes:                       string[];   // theme names
  themeIds:                     string[];
  sectorExposureContribution:   number | null;
  overlapCategory:              OverlapCategory;
  canonicalOpportunity:         CanonicalOpportunity | null;
  researchChange:               ResearchChangeHolding | null;
  hasInstitutionalEvidence:     boolean;
  institutionalDisclosure:      string;
  furtherResearch:              string;
  disclaimer:                   string;
}

// ---------------------------------------------------------------------------
// Platform health
// ---------------------------------------------------------------------------

export interface PortfolioIntelligenceHealth {
  status:                  "HEALTHY" | "DEGRADED" | "UNKNOWN" | "DISABLED";
  portfoliosAnalyzed:      number;
  lastAnalysisAt:          string | null;
  averageAnalysisDurationMs: number | null;
  partialAnalyses:         number;
  failedAnalyses:          number;
  averageCoveragePercent:  number | null;
}
