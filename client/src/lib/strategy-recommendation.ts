// Client contract for the server's deterministic trade-strategy
// recommendation payload (Ask AI "find a trade..." asks). Mirrors
// server/mcp/strategy-recommendation.ts — all fields optional/additive so
// older answers and unknown extras render safely.

export type RecommendationVerdict =
  | "LIVE_OPTIONS"
  | "ESTIMATED_OPTIONS"
  | "STOCK"
  | "WATCH"
  | "NO_TRADE"
  | "UNSUPPORTED";

export interface RecIdea {
  overallVerdict: RecommendationVerdict;
  recommendedStrategy?: string | null;
  strategySummary?: string | null;
  setup?: Record<string, unknown> | null;
  tradeCandidate?: Record<string, unknown> | null;
  riskAssessment?: Record<string, unknown> | null;
  optionAnalysis?: Record<string, unknown> | null;
  recommendedPosition?: Record<string, unknown> | null;
  alternatives?: unknown[];
  reasons?: string[];
  warnings?: string[];
  confidence?: number | null;
  dataQuality?: Record<string, unknown> | null;
}

/** Additive transparency payload derived server-side from engine data only. */
export interface RecommendationEvidence {
  summary: {
    strategiesEvaluated: number | null;
    ideasActionable: number;
    ideasWatch: number;
    ideasRejected: number;
    dataQuality: "LIVE" | "MIXED" | "PARTIAL" | "SIMULATED" | "UNAVAILABLE" | "UNKNOWN";
  };
  evaluations: { strategy: string; status: "READY" | "WATCH" | "REJECTED" | "SUPPORTING" | "ALTERNATIVE"; reason?: string }[];
  watchConditions: string[];
  decisionFactors: string[];
  selection: { strategy: string; reasons: string[]; consideredAlternatives: string[] } | null;
  confidence: { level: "HIGH" | "MEDIUM" | "LOW"; reasons: string[] };
}

export interface StrategyRecommendation {
  source: "mcp";
  generatedAt: string;
  tradeGoal?: unknown;
  recommendations: RecIdea[];
  warnings?: string[];
  simulatedData: boolean;
  recommendationEvidence?: RecommendationEvidence;
}

/** Defensive accessor — older answers won't carry evidence, and a partially
 *  malformed payload must degrade to "no evidence section", never crash. */
export function recEvidence(rec: StrategyRecommendation): RecommendationEvidence | null {
  const ev = rec.recommendationEvidence;
  if (!ev || typeof ev !== "object") return null;
  const s = ev.summary as RecommendationEvidence["summary"] | undefined;
  const c = ev.confidence as RecommendationEvidence["confidence"] | undefined;
  const ok =
    !!s && typeof s === "object" &&
    typeof s.ideasActionable === "number" && typeof s.ideasWatch === "number" && typeof s.ideasRejected === "number" &&
    typeof s.dataQuality === "string" &&
    Array.isArray(ev.evaluations) && Array.isArray(ev.watchConditions) && Array.isArray(ev.decisionFactors) &&
    !!c && typeof c === "object" && typeof c.level === "string" && Array.isArray(c.reasons);
  return ok ? ev : null;
}

export function isRenderableStrategyRecommendation(a: unknown): a is StrategyRecommendation {
  const x = a as StrategyRecommendation | null | undefined;
  return (
    !!x &&
    typeof x === "object" &&
    Array.isArray(x.recommendations) &&
    x.recommendations.length > 0 &&
    typeof x.recommendations[0]?.overallVerdict === "string"
  );
}

export const REC_VERDICT_LABELS: Record<RecommendationVerdict, string> = {
  LIVE_OPTIONS: "Live options",
  ESTIMATED_OPTIONS: "Estimated options",
  STOCK: "Stock trade",
  WATCH: "Watch",
  NO_TRADE: "No trade",
  UNSUPPORTED: "Not yet supported",
};

/** Badge tone per verdict (maps onto shadcn Badge variants + classes). */
export function recVerdictTone(v: RecommendationVerdict): "positive" | "caution" | "negative" | "neutral" {
  if (v === "LIVE_OPTIONS" || v === "STOCK") return "positive";
  if (v === "ESTIMATED_OPTIONS" || v === "WATCH") return "caution";
  if (v === "NO_TRADE") return "negative";
  return "neutral";
}

export function recIdeaSymbol(idea: RecIdea): string | null {
  const s = (idea.setup?.symbol ?? idea.tradeCandidate?.symbol) as string | undefined;
  return typeof s === "string" && s.trim() ? s.toUpperCase() : null;
}

export function recStrategyLabel(idea: RecIdea): string | null {
  const raw =
    idea.recommendedStrategy ??
    ((idea.setup?.strategyDisplayName ?? idea.setup?.strategy) as string | undefined) ??
    null;
  if (!raw) return null;
  return String(raw)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function recFmtPrice(n: unknown): string | null {
  return typeof n === "number" && Number.isFinite(n)
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;
}

/** Live-only option fields must never render for ESTIMATED_OPTIONS ideas. */
export function showsLiveOptionFields(idea: RecIdea): boolean {
  return idea.overallVerdict === "LIVE_OPTIONS";
}

/** Trade Builder / ticket CTA gating, mirrored from the server rules:
 *  only STOCK or LIVE_OPTIONS with a concrete candidate/position, never on
 *  simulated data. */
export function recTradeBuilderEligible(idea: RecIdea, simulatedData: boolean): boolean {
  if (simulatedData) return false;
  if (idea.overallVerdict === "STOCK") return !!(idea.tradeCandidate || idea.recommendedPosition);
  if (idea.overallVerdict === "LIVE_OPTIONS") return !!(idea.optionAnalysis || idea.recommendedPosition);
  return false;
}
