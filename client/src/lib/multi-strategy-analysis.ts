// Client contract for the server's deterministic multi-strategy analysis
// payload (Ask AI "Analyze <ticker>"). Mirrors
// server/mcp/multi-strategy-analysis.ts — all fields optional/additive.

export interface MsaPriceLevel {
  price: number;
  basis?: string;
}

export interface MsaSetup {
  symbol: string;
  strategy: string;
  strategyDisplayName?: string;
  direction?: string;
  score?: number | null;
  status?: string | null;
  timeframe?: string | null;
  trigger?: MsaPriceLevel | null;
  invalidation?: MsaPriceLevel | null;
  technicalObjective?: MsaPriceLevel | null;
  currentPrice?: number | null;
  reasons?: string[];
  warnings?: string[];
  detectedAt?: string | null;
  source?: string;
}

export interface MsaCandidate {
  verdict?: string;
  noTradeReasons?: string[];
  earningsRisk?: { status?: string; daysUntilEarnings?: number | null } | null;
  marketRegime?: { regime?: string } | null;
}

export interface MsaCandidateCheck {
  status: "QUALIFIED" | "WATCH" | "NO_TRADE" | "UNAVAILABLE";
  verdict?: string | null;
  reason?: string | null;
  warnings?: string[];
  riskSummary?: Record<string, unknown> | null;
}

export interface MsaSetupEntry {
  setup: MsaSetup;
  candidate?: MsaCandidate | null;
  candidateCheck?: MsaCandidateCheck;
}

export type MsaVerdict = "TRADE_CANDIDATE" | "WATCH" | "NO_TRADE" | "INSUFFICIENT_DATA";

export interface MsaPriceIntegrity {
  valid: boolean;
  code?: string;
  ratioCategory?: string;
  affectedFields?: string[];
  referenceSource?: string;
}

export interface MultiStrategyAnalysis {
  symbol: string;
  generatedAt?: string;
  timeframe?: string;
  strategiesChecked: number;
  strategiesMatched: number;
  strategiesFailed: number;
  overallVerdict: MsaVerdict;
  primarySetup?: (MsaSetupEntry & { selectionReasons: string[] }) | null;
  supportingSetups: MsaSetupEntry[];
  noMatchStrategies?: string[];
  failedStrategies?: Array<{ strategy: string; safeErrorCode: string }>;
  /** Setup-status breakdown across all matched strategies (spec §5). */
  confirmingCount?: number;
  formingCount?: number;
  rejectedCount?: number;
  unavailableCount?: number;
  /** Independent VCP Trader price cross-check result. */
  priceIntegrity?: MsaPriceIntegrity;
  marketContext?: {
    price?: number | null;
    trend?: string | null;
    marketRegime?: string | null;
    earningsRisk?: string | null;
  };
  dataQuality: {
    source: string;
    realMarketData: boolean;
    fresh: boolean | null;
    complete: boolean;
  };
}

export function isRenderableMultiStrategyAnalysis(a: unknown): a is MultiStrategyAnalysis {
  const x = a as MultiStrategyAnalysis | null | undefined;
  return (
    !!x &&
    typeof x === "object" &&
    typeof x.symbol === "string" &&
    typeof x.strategiesChecked === "number" &&
    typeof x.overallVerdict === "string"
  );
}

export const MSA_VERDICT_LABELS: Record<MsaVerdict, string> = {
  TRADE_CANDIDATE: "Qualified research candidate",
  WATCH: "Setup worth monitoring",
  NO_TRADE: "No qualifying setup",
  INSUFFICIENT_DATA: "Insufficient verified data",
};

// ---------------------------------------------------------------------------
// Status badge — user-facing label + Tailwind color class
// ---------------------------------------------------------------------------

export interface MsaStatusBadge {
  label: string;
  /** Tailwind text/border/bg classes to apply to the Badge component. */
  className: string;
}

/**
 * Maps known server status values to user-facing labels with colour hierarchy:
 *   Green  — confirmed / qualifying
 *   Blue   — developing / forming
 *   Amber  — monitoring / watch
 *   Gray   — no signal / unavailable
 *   Red    — not actionable / rejected
 *
 * Unknown or absent status → "No current signal" (gray).
 * No raw enum values (FORMING, TRIGGERED, UNKNOWN, INVALID, etc.) appear here.
 */
const MSA_STATUS_MAP: Record<string, MsaStatusBadge> = {
  // Confirming / qualified (green)
  triggered:   { label: "Breakout confirmed",          className: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  breakout:    { label: "Breakout confirmed",          className: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  ready:       { label: "Breakout confirmed",          className: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  qualified:   { label: "Breakout confirmed",          className: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  // Developing (blue)
  forming:     { label: "Developing",                  className: "text-sky-300 border-sky-500/40 bg-sky-500/10" },
  waiting:     { label: "Waiting for confirmation",    className: "text-sky-300 border-sky-500/40 bg-sky-500/10" },
  // Monitoring (amber)
  watch:       { label: "Monitoring",                  className: "text-amber-300 border-amber-500/40 bg-amber-500/10" },
  monitoring:  { label: "Monitoring",                  className: "text-amber-300 border-amber-500/40 bg-amber-500/10" },
  // Not actionable / rejected (red)
  invalid:     { label: "Not actionable",              className: "text-rose-300 border-rose-500/40 bg-rose-500/10" },
  rejected:    { label: "Not actionable",              className: "text-rose-300 border-rose-500/40 bg-rose-500/10" },
  failed:      { label: "Not actionable",              className: "text-rose-300 border-rose-500/40 bg-rose-500/10" },
  // Gray fallback handled by msaStatusBadge()
};

const MSA_STATUS_FALLBACK: MsaStatusBadge = {
  label: "No current signal",
  className: "text-muted-foreground",
};

/**
 * Returns a { label, className } pair for a setup status value.
 * Never returns a raw enum string to the caller.
 */
export function msaStatusBadge(status: string | null | undefined): MsaStatusBadge {
  const s = String(status ?? "").toLowerCase().trim();
  if (!s || s === "unknown") return MSA_STATUS_FALLBACK;
  return MSA_STATUS_MAP[s] ?? MSA_STATUS_FALLBACK;
}

/** Plain-text label for a status value (uses the same map). */
export function msaStatusLabel(status: string | null | undefined): string {
  return msaStatusBadge(status).label;
}

export function msaStrategyName(s: MsaSetup): string {
  return s.strategyDisplayName ?? s.strategy;
}

export function msaFmtPrice(n: number | null | undefined): string | null {
  return typeof n === "number" && Number.isFinite(n)
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;
}

export function msaFreshLabel(fresh: boolean | null): string {
  return fresh === true ? "Current" : fresh === false ? "Delayed" : "Unknown";
}

/**
 * Candidate-check label (Sprint 5.4E §2).
 * Uses entirely user-facing language — no raw enum values.
 *
 * - QUALIFIED   → "Qualified research opportunity"
 * - NO_TRADE    → "Did not qualify: <MCP-supplied reason>" / "Did not qualify"
 * - WATCH       → "Setup forming, not yet actionable"
 * - UNAVAILABLE → "Research outcome unavailable"
 *
 * Returns null when the entry was never evaluated (no candidate check ran).
 */
export function msaCandidateCheckLabel(entry: MsaSetupEntry): string | null {
  const cc = entry.candidateCheck;
  if (!cc) {
    // Legacy payloads without candidateCheck: null candidate = failed check.
    return entry.candidate === null ? "Research outcome unavailable" : null;
  }
  switch (cc.status) {
    case "QUALIFIED":
      return "Qualified research opportunity";
    case "NO_TRADE":
      return cc.reason ? `Did not qualify: ${cc.reason}` : "Did not qualify";
    case "WATCH":
      return "Setup forming, not yet actionable";
    case "UNAVAILABLE":
    default:
      return "Research outcome unavailable";
  }
}

export type MsaSupportGroup = "confirming" | "forming" | "rejected" | "unavailable";

export const MSA_SUPPORT_GROUP_LABELS: Record<MsaSupportGroup, string> = {
  confirming:  "Confirming",
  forming:     "Developing",
  rejected:    "Did not qualify",
  unavailable: "No signal available",
};

/**
 * Groups a supporting setup (spec §5). Unknown status or an unavailable
 * candidate check is NEVER presented as positive supporting evidence.
 */
export function msaSupportGroup(entry: MsaSetupEntry): MsaSupportGroup {
  const status = String(entry.setup.status ?? "").toLowerCase();
  const cc = entry.candidateCheck;
  if (cc?.status === "NO_TRADE") return "rejected";
  if (cc?.status === "UNAVAILABLE") return "unavailable";
  if (!status || status === "unknown") return "unavailable";
  if (status === "forming") return "forming";
  if (status === "triggered" || status === "breakout" || status === "ready") return "confirming";
  return "unavailable";
}

const MSA_INTRADAY_TIMEFRAMES = new Set(["5min", "5m", "15min", "15m", "1h"]);

export function msaIsIntraday(s: MsaSetup): boolean {
  return MSA_INTRADAY_TIMEFRAMES.has(String(s.timeframe ?? "").toLowerCase());
}
