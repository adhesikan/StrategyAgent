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

export interface MsaSetupEntry {
  setup: MsaSetup;
  candidate?: MsaCandidate | null;
}

export type MsaVerdict = "TRADE_CANDIDATE" | "WATCH" | "NO_TRADE" | "INSUFFICIENT_DATA";

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
  TRADE_CANDIDATE: "Trade candidate",
  WATCH: "Watch",
  NO_TRADE: "No trade",
  INSUFFICIENT_DATA: "Insufficient data",
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
