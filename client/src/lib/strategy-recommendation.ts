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
  /**
   * Optional structured rejection reason code for NO_TRADE / WATCH verdicts.
   * Maps to a specific chip label via `translateNoTradeReason` from ranked-trade-search.ts.
   * Additive — older server responses that don't include this field render safely
   * (the chip is simply omitted).
   *
   * Known codes: WAITING_FOR_TRIGGER · RISK_LIMIT_EXCEEDED · EARNINGS_RISK ·
   *              STALE_SETUP · DATA_UNAVAILABLE · DIRECTION_CONFLICT ·
   *              NO_VALID_SETUP · UNSUPPORTED_STRUCTURE
   */
  rejectionReasonCode?: string | null;
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
  LIVE_OPTIONS: "Live Options",
  ESTIMATED_OPTIONS: "Options Estimate",
  STOCK: "Trade Candidate",
  WATCH: "Waiting for Confirmation",
  NO_TRADE: "Rejected",        // Sprint 4.1C: never show bare "No trade" — components use tradeStatusLabel for specific reason
  UNSUPPORTED: "Unsupported",
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

// ---------------------------------------------------------------------------
// Recommendation Experience 2.0 — pure presentation helpers. Everything below
// derives display state from the deterministic server payload only; nothing
// is computed, ranked, or invented client-side.
// ---------------------------------------------------------------------------

/**
 * Setup status label shown on the hero card.
 * Sprint 4.1C: use tradeStatusLabel() from trade-plan-view-model for
 * rejection-code-aware labels. This function provides a verdict-only fallback
 * used where no rejection code is available.
 *
 * @deprecated prefer tradeStatusLabel() from trade-plan-view-model when a
 * TradePlanViewModel or rejectionReasonCode is available.
 */
export function recStatusLabel(v: RecommendationVerdict): string {
  switch (v) {
    case "LIVE_OPTIONS":
    case "STOCK":
      return "Trade Ready";
    case "ESTIMATED_OPTIONS":
      return "Trade Ready — Estimates";
    case "WATCH":
      return "Waiting for Confirmation";
    case "NO_TRADE":
      return "Rejected";
    default:
      return "Unsupported";
  }
}

/** Trade structure (e.g. "Long Put", "Shares") from engine fields only. */
export function recStructureLabel(idea: RecIdea): string | null {
  const oa = (idea.optionAnalysis ?? {}) as Record<string, unknown>;
  const setup = (idea.setup ?? {}) as Record<string, unknown>;
  const pos = (idea.recommendedPosition ?? {}) as Record<string, unknown>;
  const raw =
    (typeof oa.structure === "string" && oa.structure) ||
    (typeof oa.strategyType === "string" && oa.strategyType) ||
    (typeof oa.optionType === "string" && `Long ${oa.optionType}`) ||
    (typeof pos.structure === "string" && pos.structure) ||
    (typeof setup.structure === "string" && setup.structure) ||
    null;
  if (raw) return String(raw).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  if (idea.overallVerdict === "STOCK") return "Shares";
  return null;
}

/** 5-second summary lines. Deterministic wording per verdict — never GPT. */
export function recSummaryLines(rec: StrategyRecommendation): string[] {
  const ideas = rec.recommendations;
  const actionable = ideas.filter((i) => i.overallVerdict === "LIVE_OPTIONS" || i.overallVerdict === "ESTIMATED_OPTIONS" || i.overallVerdict === "STOCK").length;
  const watch = ideas.filter((i) => i.overallVerdict === "WATCH").length;
  const lines: string[] = [];
  if (actionable > 0) lines.push(`${actionable} setup${actionable === 1 ? " is" : "s are"} actionable now.`);
  if (watch > 0) {
    lines.push(`${watch} setup${watch === 1 ? " is" : "s are"} forming.`);
    if (actionable === 0) lines.push("Confirmation has not occurred.");
  }
  if (actionable === 0) {
    if (watch === 0 && ideas.every((i) => i.overallVerdict === "UNSUPPORTED")) {
      lines.push("The requested strategy is not yet supported.");
    } else if (watch === 0) {
      lines.push("No qualifying setup was found.");
    }
    lines.push("No trade is recommended yet.");
  }
  return lines;
}

/** Environment notes from the engine's own top-level warnings — deduped and
 *  shortened, never invented. */
export function recEnvironmentNotes(rec: StrategyRecommendation): string[] {
  const notes = new Set<string>();
  for (const w of rec.warnings ?? []) {
    const s = String(w);
    if (/market regime/i.test(s)) notes.add("Market regime unavailable");
    else if (/options provider|option chain|no options/i.test(s)) notes.add("Options provider unavailable");
    else if (/earnings/i.test(s)) notes.add("Upcoming earnings");
    else if (/provider request failed|HTTP 429|rate limit/i.test(s)) notes.add("Upstream data provider degraded");
    else if (s.length <= 90) notes.add(s);
  }
  return Array.from(notes).slice(0, 5);
}

export interface RecFactorChip {
  label: string;
  detail: string;
  tone: "warning" | "environment" | "data" | "neutral";
}

/** Classify deterministic decision-factor strings into short chips. The full
 *  engine sentence stays as the expandable detail — no information invented. */
export function recDecisionFactorChips(factors: string[]): RecFactorChip[] {
  const chips: RecFactorChip[] = [];
  const seen = new Set<string>();
  for (const f of factors) {
    const s = String(f);
    let label = "";
    let tone: RecFactorChip["tone"] = "neutral";
    if (/trigger|entry.*not reached|no breakout|no entry/i.test(s)) { label = "Entry Trigger Missing"; tone = "warning"; }
    else if (/reward\/?risk|risk\/?reward|r\/r/i.test(s)) { label = "Poor Reward/Risk"; tone = "warning"; }
    else if (/earnings/i.test(s)) { label = "Upcoming Earnings"; tone = "warning"; }
    else if (/volatility/i.test(s)) { label = "Volatility"; tone = "warning"; }
    else if (/market regime/i.test(s)) { label = "Market Regime Missing"; tone = "environment"; }
    else if (/options provider|option chain|no options/i.test(s)) { label = "No Options Provider"; tone = "environment"; }
    else if (/provider request failed|HTTP 429|rate limit|unavailable/i.test(s)) { label = "Data Unavailable"; tone = "data"; }
    else if (/simulated|mock/i.test(s)) { label = "Simulated Data"; tone = "data"; }
    else if (/no actionable|no qualifying|no setup/i.test(s)) { label = "No Qualifying Setup"; tone = "neutral"; }
    else { label = s.length > 32 ? `${s.slice(0, 29)}…` : s; }
    const key = `${label}|${s}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push({ label, detail: s, tone });
  }
  return chips.slice(0, 8);
}

export interface RecNextStep {
  label: string;
  href: string;
}

/** Verdict-aware CTAs. Trade-ticket CTAs obey the existing eligibility rules
 *  (never on simulated data). */
export function recNextSteps(idea: RecIdea, simulatedData: boolean): RecNextStep[] {
  // All hrefs are existing app routes only (wouter routes in App.tsx).
  const sym = recIdeaSymbol(idea);
  const chart = sym ? `/charts/${sym}` : "/charts";
  const scanner = "/scanner";
  switch (idea.overallVerdict) {
    case "WATCH":
      return [
        { label: "View Chart", href: chart },
        { label: "Add to Watchlist", href: "/watchlists" },
        { label: "Open Scanner", href: scanner },
      ];
    case "NO_TRADE":
      return [
        { label: "Find Similar Opportunities", href: "/opportunity-radar" },
        { label: "Open Scanner", href: scanner },
        ...(sym ? [{ label: "View Chart", href: chart }] : []),
      ];
    case "LIVE_OPTIONS": {
      const steps: RecNextStep[] = sym
        ? [{ label: "Review Trade", href: `/trade/${sym}` }, { label: "View Chart", href: chart }]
        : [{ label: "Open Scanner", href: scanner }];
      if (recTradeBuilderEligible(idea, simulatedData) && sym) {
        steps.push({ label: "Build Trade Ticket", href: `/trade/${sym}` });
      }
      return steps;
    }
    case "STOCK": {
      const steps: RecNextStep[] = sym
        ? [{ label: "Review Stock Plan", href: `/trade/${sym}` }, { label: "View Chart", href: chart }]
        : [{ label: "Open Scanner", href: scanner }];
      if (recTradeBuilderEligible(idea, simulatedData) && sym) {
        steps.push({ label: "Build Trade Ticket", href: `/trade/${sym}` });
      }
      return steps;
    }
    case "ESTIMATED_OPTIONS":
      return [
        { label: "View Chart", href: chart },
        { label: "Connect Broker for Live Options", href: "/settings" },
        { label: "Open Scanner", href: scanner },
      ];
    default: // UNSUPPORTED
      return [
        { label: "Show Supported Strategies", href: "/help" },
        { label: "Open Scanner", href: scanner },
      ];
  }
}

/** ✓/✕ evidence-quality checks for the confidence section. Positive checks
 *  reflect what actually happened; negatives come from evidence reasons and
 *  environment warnings. Never chain-of-thought. */
export function recConfidenceChecks(
  evidence: RecommendationEvidence,
  rec: StrategyRecommendation,
): { ok: boolean; text: string }[] {
  const checks: { ok: boolean; text: string }[] = [];
  if (evidence.summary.strategiesEvaluated != null) {
    checks.push({ ok: true, text: `${evidence.summary.strategiesEvaluated} strategies evaluated` });
  }
  checks.push({ ok: true, text: "Deterministic recommendation engine" });
  for (const r of evidence.confidence.reasons) {
    const negative = /unavailable|simulated|mock|partial|missing|degraded|not reported|unknown/i.test(r);
    checks.push({ ok: !negative, text: r });
  }
  for (const n of recEnvironmentNotes(rec)) {
    if (!checks.some((c) => c.text === n)) checks.push({ ok: false, text: n });
  }
  return checks.slice(0, 8);
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
