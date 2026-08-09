/**
 * Portfolio History & Change Intelligence — Sprint 2.6.0
 *
 * All types for portfolio snapshots, position-level changes, research changes,
 * exposure changes, and portfolio history health.
 *
 * ARCHITECTURE CONTRACT:
 *   Opportunity Intelligence → Portfolio History → Portfolio Change Intelligence
 *                           → Future Portfolio Intelligence → Future Trade Planning
 *
 * Research scores (researchScore, technicalScore, etc.) are owned by
 * Opportunity Intelligence and only READ here — never redefined.
 *
 * COMPLIANCE:
 *   Never: "You bought", "You sold", "Recommend", "Strong Buy"
 *   Always: "Position Increased", "Observed Change", "Research Evidence Improved"
 */

// ============================================================================
// Change classification enums
// ============================================================================

/** Position-level change type — deterministic quantity comparison */
export type PositionChangeType =
  | "NEW"       // current quantity > 0, previously absent
  | "EXITED"    // previously > 0, now absent
  | "INCREASED" // current quantity > previous quantity
  | "REDUCED"   // current quantity < previous quantity, still > 0
  | "UNCHANGED";// same quantity

/** Research evidence change type — based on Opportunity Intelligence score deltas */
export type ResearchChangeType =
  | "RESEARCH_STRENGTHENED"  // researchScore increased >= 2 points
  | "RESEARCH_WEAKENED"      // researchScore decreased >= 2 points
  | "RESEARCH_UNCHANGED"     // no material change (< 2 points)
  | "NEWLY_QUALIFIED"        // now appears in ranking (was absent before)
  | "NO_LONGER_QUALIFIED";   // was in ranking, now absent

/** Sector / theme exposure change — based on portfolio composition shift */
export type ExposureChangeType =
  | "SECTOR_EXPOSURE_INCREASED"
  | "SECTOR_EXPOSURE_DECREASED"
  | "THEME_EXPOSURE_INCREASED"
  | "THEME_EXPOSURE_DECREASED";

/** Source of a portfolio snapshot capture */
export type SnapshotSourceType =
  | "manual_import"     // CSV import confirmed
  | "xlsx_import"       // XLSX import confirmed
  | "image_import"      // image/screenshot import confirmed
  | "pdf_import"        // PDF import confirmed
  | "broker_sync"       // broker synchronization completed
  | "manual_snapshot"   // user clicked "Capture Snapshot"
  | "position_change";  // manual position add/edit/delete

/** Period filter for portfolio history timeline */
export type HistoryPeriod = "7D" | "30D" | "90D" | "YTD" | "1Y" | "ALL";

// ============================================================================
// Snapshot domain objects
// ============================================================================

/** Compact research metadata stored per position snapshot */
export interface PositionResearchSnapshot {
  researchScore:      number | null;
  technicalScore:     number | null;
  fundamentalScore:   number | null;
  institutionalScore: number | null;
  riskScore:          number | null;
  evidenceConfidence: string | null;  // "high" | "medium" | "low" | "insufficient"
  opportunityType:    string | null;
}

/** One position row captured in a snapshot */
export interface PortfolioPositionSnapshot {
  id:              string;
  snapshotId:      string;
  portfolioId:     string;
  symbol:          string;
  quantity:        number;
  averageCost:     number | null;
  costBasis:       number | null;
  referencePrice:  number | null;
  marketValue:     number | null;
  sector:          string | null;
  industry:        string | null;
  themes:          string[];
  research:        PositionResearchSnapshot;
  capturedAt:      string; // ISO
}

/** Coverage metadata in a snapshot */
export interface SnapshotCoverage {
  positionsTotal:                    number;
  positionsWithMarketData:           number;
  positionsWithOpportunityIntelligence: number;
  positionsWithSector:               number;
  positionsWithTheme:                number;
  coveragePercent:                   number;
}

/** A portfolio snapshot — point-in-time view of portfolio state */
export interface PortfolioSnapshot {
  id:               string;
  portfolioId:      string;
  userId:           string;
  snapshotDate:     string;         // YYYY-MM-DD
  capturedAt:       string;         // ISO datetime
  sourceType:       SnapshotSourceType;
  totalMarketValue: number | null;
  totalCostBasis:   number | null;
  positionCount:    number;
  cashValue:        number | null;
  fingerprint:      string;         // dedup key
  coverage:         SnapshotCoverage;
  metadata:         Record<string, unknown>;
  positions:        PortfolioPositionSnapshot[];
  createdAt:        string;
}

/** Lightweight snapshot card for timeline display (no positions array) */
export interface PortfolioSnapshotCard {
  id:               string;
  portfolioId:      string;
  snapshotDate:     string;
  capturedAt:       string;
  sourceType:       SnapshotSourceType;
  totalMarketValue: number | null;
  totalCostBasis:   number | null;
  positionCount:    number;
  coverage:         SnapshotCoverage;
}

// ============================================================================
// Position-level change items
// ============================================================================

/** A single changed position */
export interface PositionChangeItem {
  symbol:           string;
  changeType:       PositionChangeType;
  previousQuantity: number | null;
  currentQuantity:  number | null;
  quantityDelta:    number | null;  // positive = increased, negative = reduced
  previousMarketValue: number | null;
  currentMarketValue:  number | null;
  /** Market value can change without quantity changing (price movement) */
  marketValueDelta: number | null;
  sector:           string | null;
  themes:           string[];
}

/** A position whose research evidence changed */
export interface ResearchChangeItem {
  symbol:            string;
  changeType:        ResearchChangeType;
  previousScore:     number | null;
  currentScore:      number | null;
  scoreDelta:        number | null;
  previousTechScore: number | null;
  currentTechScore:  number | null;
  previousOppType:   string | null;
  currentOppType:    string | null;
  sector:            string | null;
}

/** A sector or theme exposure change */
export interface ExposureChangeItem {
  name:             string;    // sector or theme name
  changeType:       ExposureChangeType;
  previousPercent:  number | null;
  currentPercent:   number | null;
  percentDelta:     number | null;
}

// ============================================================================
// Portfolio change result
// ============================================================================

/** High-level numeric summary of portfolio changes */
export interface PortfolioChangeSummary {
  fromSnapshotId:    string;
  toSnapshotId:      string;
  fromDate:          string;
  toDate:            string;
  /** Portfolio value changes — can happen even without position quantity changes */
  valueChange:       number | null;
  valueChangePercent: number | null;
  previousValue:     number | null;
  currentValue:      number | null;
  costBasisChange:   number | null;
  positionCountChange: number;
  previousPositionCount: number;
  currentPositionCount:  number;
}

export interface DataFreshnessInfo {
  fromSnapshotAt:     string;
  toSnapshotAt:       string;
  referenceDataDate?: string;
  opportunityIntelligenceAt?: string;
  institutionalDataNote: string;
}

export interface PortfolioChangeResult {
  portfolioId:    string;
  summary:        PortfolioChangeSummary;
  /** Positions that appeared new (quantity went from absent to > 0) */
  addedPositions:    PositionChangeItem[];
  /** Positions that were fully closed (quantity went to 0 / absent) */
  exitedPositions:   PositionChangeItem[];
  /** Positions with increased quantity */
  increasedPositions: PositionChangeItem[];
  /** Positions with reduced but non-zero quantity */
  reducedPositions:  PositionChangeItem[];
  /** Positions with no quantity change */
  unchangedPositions: PositionChangeItem[];
  /** Holdings with stronger research evidence */
  researchStrengthened: ResearchChangeItem[];
  /** Holdings with weaker research evidence */
  researchWeakened:     ResearchChangeItem[];
  /** Holdings that newly appear in Opportunity Intelligence ranking */
  newlyQualified:       ResearchChangeItem[];
  /** Holdings that previously appeared in ranking but no longer do */
  noLongerQualified:    ResearchChangeItem[];
  /** Sector exposure shifts */
  sectorChanges:  ExposureChangeItem[];
  /** Theme exposure shifts */
  themeChanges:   ExposureChangeItem[];
  dataFreshness:  DataFreshnessInfo;
  coverage:       SnapshotCoverage;
  limitations:    string[];   // e.g. "Market data unavailable for 3 positions"
}

// ============================================================================
// Platform health
// ============================================================================

export interface PortfolioHistoryHealth {
  portfoliosTracked:        number;
  snapshotsTotal:           number;
  snapshotsToday:           number;
  latestSnapshotAt:         string | null;
  snapshotsFailed:          number;
  positionsCaptured:        number;
  averageSnapshotDurationMs: number | null;
  storageHealth:            "ok" | "degraded" | "unknown";
}
