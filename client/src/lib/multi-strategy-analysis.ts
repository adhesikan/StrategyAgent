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

export function msaStrategyName(s: MsaSetup): string {
  return s.strategyDisplayName ?? s.strategy;
}

export function msaFmtPrice(n: number | null | undefined): string | null {
  return typeof n === "number" && Number.isFinite(n)
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;
}

export function msaStatusLabel(status: string | null | undefined): string {
  const s = String(status ?? "").toLowerCase();
  if (!s) return "Unknown";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function msaFreshLabel(fresh: boolean | null): string {
  return fresh === true ? "Fresh" : fresh === false ? "Stale" : "Unknown";
}

/**
 * Candidate-check label (spec §4). Derived ONLY from the server payload:
 * - QUALIFIED → "Trade candidate qualified"
 * - NO_TRADE  → "Candidate rejected: <MCP-supplied reason>"
 * - WATCH     → "Setup detected, but not tradeable yet"
 * - UNAVAILABLE (or legacy null candidate) → "Candidate qualification unavailable"
 * Returns null when the entry was never evaluated (no candidate check ran).
 */
export function msaCandidateCheckLabel(entry: MsaSetupEntry): string | null {
  const cc = entry.candidateCheck;
  if (!cc) {
    // Legacy payloads without candidateCheck: null candidate = failed check.
    return entry.candidate === null ? "Candidate qualification unavailable" : null;
  }
  switch (cc.status) {
    case "QUALIFIED":
      return "Trade candidate qualified";
    case "NO_TRADE":
      return cc.reason ? `Candidate rejected: ${cc.reason}` : "Candidate rejected";
    case "WATCH":
      return "Setup detected, but not tradeable yet";
    case "UNAVAILABLE":
    default:
      return "Candidate qualification unavailable";
  }
}

export type MsaSupportGroup = "confirming" | "forming" | "rejected" | "unavailable";

export const MSA_SUPPORT_GROUP_LABELS: Record<MsaSupportGroup, string> = {
  confirming: "Confirming",
  forming: "Forming",
  rejected: "Rejected",
  unavailable: "Unavailable / Unknown",
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
