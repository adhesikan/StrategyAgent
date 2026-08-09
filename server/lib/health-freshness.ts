// ---------------------------------------------------------------------------
// Health Freshness Helper — Sprint 2.5.3B
//
// Reusable freshness computation engine for the Platform Operations Center.
// Pure functions — no DB calls, no external requests.
//
// FreshnessStatus vocabulary (canonical):
//   FRESH         — within normal operating cadence
//   RECENT        — slightly older than expected but acceptable
//   DELAYED       — overdue but not alarming (or delayed-by-design)
//   STALE         — significantly overdue
//   UNKNOWN       — no timestamp available
//   NOT_APPLICABLE — does not have a time-based freshness concept
// ---------------------------------------------------------------------------

export type FreshnessStatus =
  | "FRESH"
  | "RECENT"
  | "DELAYED"
  | "STALE"
  | "UNKNOWN"
  | "NOT_APPLICABLE";

/**
 * Freshness rule for a specific dataset.
 *
 * Thresholds are in milliseconds.
 * If `delayedByDesign` is true, the result will always be DELAYED (not STALE)
 * regardless of age — e.g. 13F data which is quarterly by design.
 * If `notApplicable` is true, the result will always be NOT_APPLICABLE.
 */
export interface FreshnessRule {
  /** Human-readable name of the dataset */
  dataset: string;
  /** Expected cadence description for display */
  expectedCadence: string | null;
  /** Age ≤ this → FRESH (ms). If omitted, uses recentWithinMs as lower bound. */
  freshWithinMs?: number;
  /** Age ≤ this → RECENT (ms). If omitted, anything over freshWithinMs is STALE. */
  recentWithinMs?: number;
  /** Age ≤ this → DELAYED (ms). Anything over is STALE. */
  delayedWithinMs?: number;
  /** When true: result is DELAYED regardless of age (delayed-by-design datasets) */
  delayedByDesign?: boolean;
  /** When true: result is NOT_APPLICABLE */
  notApplicable?: boolean;
}

export interface FreshnessResult {
  dataset: string;
  lastUpdated: string | null;
  ageSec: number | null;
  ageLabel: string;
  expectedCadence: string | null;
  freshnessStatus: FreshnessStatus;
  freshnessLabel: string;
  note?: string;
}

/**
 * Compute freshness for a timestamp against a rule.
 * Returns NOT_APPLICABLE for disabled datasets (pass null timestamp + notApplicable rule).
 */
export function assessFreshness(
  timestampIso: string | null | undefined,
  rule: FreshnessRule,
): FreshnessResult {
  if (rule.notApplicable) {
    return {
      dataset:         rule.dataset,
      lastUpdated:     timestampIso ?? null,
      ageSec:          null,
      ageLabel:        "—",
      expectedCadence: rule.expectedCadence,
      freshnessStatus: "NOT_APPLICABLE",
      freshnessLabel:  "N/A",
    };
  }

  if (!timestampIso) {
    return {
      dataset:         rule.dataset,
      lastUpdated:     null,
      ageSec:          null,
      ageLabel:        "Never",
      expectedCadence: rule.expectedCadence,
      freshnessStatus: "UNKNOWN",
      freshnessLabel:  "Unknown",
    };
  }

  const parsed = new Date(timestampIso);
  if (isNaN(parsed.getTime())) {
    return {
      dataset:         rule.dataset,
      lastUpdated:     timestampIso,
      ageSec:          null,
      ageLabel:        "Invalid date",
      expectedCadence: rule.expectedCadence,
      freshnessStatus: "UNKNOWN",
      freshnessLabel:  "Unknown",
    };
  }

  const ageMs  = Date.now() - parsed.getTime();
  const ageSec = Math.round(ageMs / 1000);
  const ageLabel = formatAge(ageSec);

  if (rule.delayedByDesign) {
    return {
      dataset:         rule.dataset,
      lastUpdated:     timestampIso,
      ageSec,
      ageLabel,
      expectedCadence: rule.expectedCadence,
      freshnessStatus: "DELAYED",
      freshnessLabel:  "Delayed by design",
      note:            rule.expectedCadence ?? undefined,
    };
  }

  let status: FreshnessStatus;

  if (rule.freshWithinMs !== undefined && ageMs <= rule.freshWithinMs) {
    status = "FRESH";
  } else if (rule.recentWithinMs !== undefined && ageMs <= rule.recentWithinMs) {
    status = "RECENT";
  } else if (rule.delayedWithinMs !== undefined && ageMs <= rule.delayedWithinMs) {
    status = "DELAYED";
  } else {
    status = "STALE";
  }

  return {
    dataset:         rule.dataset,
    lastUpdated:     timestampIso,
    ageSec,
    ageLabel,
    expectedCadence: rule.expectedCadence,
    freshnessStatus: status,
    freshnessLabel:  FRESHNESS_LABELS[status],
  };
}

const FRESHNESS_LABELS: Record<FreshnessStatus, string> = {
  FRESH:          "Fresh",
  RECENT:         "Recent",
  DELAYED:        "Delayed",
  STALE:          "Stale",
  UNKNOWN:        "Unknown",
  NOT_APPLICABLE: "N/A",
};

function formatAge(sec: number): string {
  if (sec < 60)    return `${sec}s ago`;
  if (sec < 3_600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86_400) return `${Math.round(sec / 3_600)}h ago`;
  return `${Math.round(sec / 86_400)}d ago`;
}

// ---------------------------------------------------------------------------
// Canonical freshness rules for every tracked dataset
//
// Thresholds are intentionally aligned with actual platform cadences:
//
//  Market Prices:       FRESH <6h  RECENT <30h  DELAYED <72h  else STALE
//  Historical Bars:     same as market prices
//  Market Symbol Meta:  FRESH <24h RECENT <72h  else STALE (rare changes)
//  Opportunity Ranking: FRESH <8h  RECENT <24h  DELAYED <72h  else STALE
//  Opportunity Intel:   FRESH <8h  RECENT <24h  else STALE
//  Sector/Theme Intel:  FRESH <24h RECENT <72h  else STALE
//  Institutional 13F:   delayed-by-design (quarterly)
//  Research Collections: FRESH <24h RECENT <72h  else STALE
//  Research Monitor:    FRESH <24h RECENT <72h  else STALE
//  Command Center:      FRESH <12h RECENT <24h  else STALE  (resets on restart)
//  Research Reports:    FRESH <24h RECENT <72h  else STALE
//  Portfolio History:   NOT_APPLICABLE when no snapshots
//  Broker Sync:         NOT_APPLICABLE when none connected
// ---------------------------------------------------------------------------

export const FRESHNESS_RULES: Record<string, FreshnessRule> = {
  marketPrices: {
    dataset:        "Market Prices",
    expectedCadence: "Daily (market close)",
    freshWithinMs:  6  * 3_600_000,   //  6h
    recentWithinMs: 30 * 3_600_000,   // 30h
    delayedWithinMs:72 * 3_600_000,   // 72h
  },
  historicalBars: {
    dataset:        "Historical Bars",
    expectedCadence: "Daily ingestion",
    freshWithinMs:  6  * 3_600_000,
    recentWithinMs: 30 * 3_600_000,
    delayedWithinMs:72 * 3_600_000,
  },
  symbolMetadata: {
    dataset:        "Market Symbol Metadata",
    expectedCadence: "Ad-hoc enrichment",
    freshWithinMs:  24 * 3_600_000,
    recentWithinMs: 72 * 3_600_000,
  },
  opportunityRanking: {
    dataset:        "Opportunity Ranking",
    expectedCadence: "Every scan cycle (~4h)",
    freshWithinMs:  8  * 3_600_000,
    recentWithinMs: 24 * 3_600_000,
    delayedWithinMs:72 * 3_600_000,
  },
  opportunityIntelligence: {
    dataset:        "Opportunity Intelligence",
    expectedCadence: "Every scan cycle (~4h)",
    freshWithinMs:  8  * 3_600_000,
    recentWithinMs: 24 * 3_600_000,
  },
  sectorIntelligence: {
    dataset:        "Sector Intelligence",
    expectedCadence: "After each scan cycle",
    freshWithinMs:  24 * 3_600_000,
    recentWithinMs: 72 * 3_600_000,
  },
  themeIntelligence: {
    dataset:        "Theme Intelligence",
    expectedCadence: "After each scan cycle",
    freshWithinMs:  24 * 3_600_000,
    recentWithinMs: 72 * 3_600_000,
  },
  institutionalSignals: {
    dataset:        "Institutional Signals (13F)",
    expectedCadence: "Quarterly (45-day SEC delay)",
    delayedByDesign: true,
  },
  researchCollections: {
    dataset:        "Research Collections",
    expectedCadence: "On demand / real-time",
    freshWithinMs:  24 * 3_600_000,
    recentWithinMs: 72 * 3_600_000,
  },
  researchMonitor: {
    dataset:        "Research Monitor",
    expectedCadence: "Daily evaluation cycle",
    freshWithinMs:  24 * 3_600_000,
    recentWithinMs: 72 * 3_600_000,
  },
  commandCenterSnapshot: {
    dataset:        "Command Center Snapshot",
    expectedCadence: "On first page visit (resets on restart)",
    freshWithinMs:  12 * 3_600_000,
    recentWithinMs: 24 * 3_600_000,
  },
  researchReports: {
    dataset:        "Research Reports",
    expectedCadence: "On demand",
    freshWithinMs:  24 * 3_600_000,
    recentWithinMs: 72 * 3_600_000,
  },
  portfolioHistory: {
    dataset:        "Portfolio History",
    expectedCadence: "Manual or scheduled snapshot",
    freshWithinMs:  24 * 3_600_000,
    recentWithinMs: 72 * 3_600_000,
  },
  brokerSync: {
    dataset:        "Broker Sync",
    expectedCadence: "Manual or scheduled sync",
    freshWithinMs:  4  * 3_600_000,
    recentWithinMs: 24 * 3_600_000,
  },
};
