// ---------------------------------------------------------------------------
// Shared types for Research Trade Card components
// Mirror server/routes/opportunity-research.ts + opportunity-research.tsx
//
// Keep in sync with: client/src/pages/opportunity-research.tsx
// ---------------------------------------------------------------------------

export type LifecycleState =
  | "NEWLY_QUALIFIED"
  | "STILL_QUALIFIED"
  | "STRENGTHENING"
  | "WEAKENING"
  | "APPROACHING"
  | "TRIGGERED"
  | "DROPPED"
  | "UNAVAILABLE";

export interface LifecycleItem {
  symbol: string;
  lifecycleState: LifecycleState;
  qualificationStatus: "QUALIFIED" | "WATCHING" | "ABSENT";
  strategy?: string;
  rankCurrent: number | null;
  rankPrev: number | null;
  scoreCurrent: number;
  scorePrev: number;
  scoreDelta: number;
  firstSeen: string | null;
  lastUpdated: string;
}

export interface ScanHistoryEntry {
  id: string;
  snapshotId: string;
  scanTime: string;
  rank: number | null;
  score: number;
  qualificationStatus: string;
  lifecycleState: string;
  strategy: string | null;
  marketRegime: string | null;
  createdAt: string;
}

export interface Candidate {
  rank: number;
  symbol: string;
  strategy?: string;
  setupStatus?: string;
  instrument?: string;
  structure?: string;
  trigger?: string;
  invalidation?: string;
  objective?: string;
  rewardRisk?: number;
  maxRisk?: number;
  quantity?: number;
  confidence?: string;
  dataQuality?: string;
  fitsRiskBudget?: boolean;
  strategyScore?: number;
  currentPrice?: number;
  whySelected: string[];
  warnings: string[];
}

export interface ResearchPackage {
  symbol: string;
  candidate: Candidate;
  lifecycleItem: LifecycleItem | null;
  scanHistory: ScanHistoryEntry[];
  brokerConnected: boolean;
  marketRegime: string | null;
  dataSource: string;
  dataQuality: string;
  freshnessStatus: "fresh" | "stale";
  completedAt: string;
  snapshotId: string;
}

export interface MarketSnapshot {
  marketRegime?: { regime: string; strength: number; description: string } | null;
  marketTone?: string | null;
  vix?: { last: number; changePercent: number } | null;
  sectorLeadership?: Array<{ symbol: string; name: string; changePercent: number }>;
  topNews?: Array<{
    symbol: string;
    label: string;
    impact: string;
    whyItMatters: string;
    buzz: number;
    articleCount: number;
  }>;
  asOf?: string;
}

export interface DashboardResponse {
  marketSnapshot:
    | { status: "ok"; data: MarketSnapshot }
    | { status: "unavailable" };
}

export interface EvidenceStars {
  technical: 1 | 2 | 3 | 4 | 5;
  congress: 1 | 2 | 3 | 4 | 5;
  news: 1 | 2 | 3 | 4 | 5;
  institutional: 0 | 1 | 2 | 3 | 4 | 5;
  catalysts: 1 | 2 | 3;
  regime: 1 | 2 | 3 | 4 | 5;
}

// ---------------------------------------------------------------------------
// Shared display constants
// ---------------------------------------------------------------------------

export const LIFECYCLE_BADGE: Record<LifecycleState, { label: string; className: string }> = {
  NEWLY_QUALIFIED: { label: "New Today",     className: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  STILL_QUALIFIED: { label: "Holding",       className: "text-sky-300 border-sky-500/40 bg-sky-500/10" },
  STRENGTHENING:   { label: "Strengthening", className: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  WEAKENING:       { label: "Weakening",     className: "text-amber-300 border-amber-500/40 bg-amber-500/10" },
  APPROACHING:     { label: "Approaching",   className: "text-violet-300 border-violet-500/40 bg-violet-500/10" },
  TRIGGERED:       { label: "Triggered",     className: "text-sky-300 border-sky-500/40 bg-sky-500/10" },
  DROPPED:         { label: "Dropped",       className: "text-rose-300 border-rose-500/40 bg-rose-500/10" },
  UNAVAILABLE:     { label: "Data Gap",      className: "text-muted-foreground border-border/40" },
};

export const REGIME_LABEL: Record<string, string> = {
  TRENDING: "Strong Bull",
  CHOPPY:   "Choppy",
  RISK_OFF: "Risk-Off",
};
