// opportunity-workspace-helpers.ts — Sprint 2.3.0
//
// Pure, testable helpers for the Opportunity Research Workspace page.
// No DOM, no React, no side-effects.

// ---------------------------------------------------------------------------
// Types (mirrored from dashboard.tsx — keep in sync)
// ---------------------------------------------------------------------------

export interface OpportunityScore {
  symbol: string;
  overallScore: number;
  confidence: "high" | "medium" | "low";
  technicalScore: number;
  institutionalScore: number;
  fundamentalScore: number;
  riskScore: number;
  regimeScore: number;
  category: "Top Growth" | "Income" | "Watch" | "Avoid";
  reasons: string[];
  warnings: string[];
  lastUpdated: string;
}

export interface ScoredCandidate {
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
  opportunityScore: OpportunityScore;
}

export interface WatchScoredCandidate {
  symbol: string;
  strategy?: string;
  currentStage?: string;
  missingConfirmation?: string;
  watchConditions: string[];
  opportunityScore: OpportunityScore;
}

export interface OpportunityRanking {
  generatedAt: string;
  snapshotId: string;
  regime: string | null;
  weights: Record<string, number>;
  topGrowth: ScoredCandidate[];
  topIncome: ScoredCandidate[];
  watchlist: WatchScoredCandidate[];
  approaching: WatchScoredCandidate[];
  changes: Array<{
    symbol: string;
    from: string;
    to: string;
    direction: "upgraded" | "downgraded" | "new" | "moved";
  }>;
}

export interface HistoryEntry {
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

// ---------------------------------------------------------------------------
// Score display helpers
// ---------------------------------------------------------------------------

export function getScoreColor(score: number): string {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-sky-400";
  if (score >= 40) return "text-amber-400";
  return "text-rose-400";
}

export function getScoreBarBg(score: number): string {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-sky-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-rose-500";
}

export function getConfidenceBadge(confidence: string): string {
  switch (confidence) {
    case "high":   return "bg-emerald-900/60 text-emerald-300 border-emerald-700";
    case "medium": return "bg-amber-900/60 text-amber-300 border-amber-700";
    case "low":    return "bg-rose-900/60 text-rose-300 border-rose-700";
    default:       return "bg-slate-800 text-slate-300 border-slate-600";
  }
}

export function getCategoryBadge(category: string): string {
  switch (category) {
    case "Top Growth": return "bg-emerald-900/60 text-emerald-300 border-emerald-700";
    case "Income":     return "bg-sky-900/60 text-sky-300 border-sky-700";
    case "Watch":      return "bg-amber-900/60 text-amber-300 border-amber-700";
    case "Avoid":      return "bg-rose-900/60 text-rose-300 border-rose-700";
    default:           return "bg-slate-800 text-slate-300 border-slate-600";
  }
}

// ---------------------------------------------------------------------------
// Deterministic "Why This Ranked" explanation — NO LLM
// ---------------------------------------------------------------------------

export interface RankedExplanation {
  bullets: string[];
  summary: string;
}

export function buildRankedExplanation(
  score: OpportunityScore,
  candidate?: Pick<ScoredCandidate, "rewardRisk" | "strategy"> | null,
  regime?: string | null,
): RankedExplanation {
  const bullets: string[] = [];

  // Technical quality
  if (score.technicalScore >= 80) {
    bullets.push("Technical quality is exceptional — strong pattern with high confirmation.");
  } else if (score.technicalScore >= 65) {
    bullets.push("Technical quality is strong — setup meets core qualification criteria.");
  } else if (score.technicalScore >= 50) {
    bullets.push("Technical quality is solid — key indicators align with the strategy.");
  } else {
    bullets.push("Technical setup is developing — not yet fully confirmed.");
  }

  // Institutional signal
  if (score.institutionalScore >= 70) {
    bullets.push("Institutional accumulation is elevated — 13F evidence supports the thesis.");
  } else if (score.institutionalScore >= 55) {
    bullets.push("Institutional posture is neutral-to-positive — no clear distribution signal.");
  } else if (score.institutionalScore > 0) {
    bullets.push("Institutional data is limited — signal carries less conviction.");
  }

  // Fundamental proxy
  if (score.fundamentalScore >= 70) {
    bullets.push("Fundamental characteristics are favorable for this strategy type.");
  } else if (score.fundamentalScore < 45) {
    bullets.push("Fundamental characteristics present some caution — earnings risk may be elevated.");
  }

  // Risk/reward
  const rr = candidate?.rewardRisk;
  if (typeof rr === "number" && rr >= 3) {
    bullets.push(`Risk/reward is ${rr.toFixed(1)}:1 — exceeds the 3:1 minimum threshold.`);
  } else if (typeof rr === "number" && rr >= 2) {
    bullets.push(`Risk/reward is ${rr.toFixed(1)}:1 — acceptable but not exceptional.`);
  } else if (score.riskScore >= 70) {
    bullets.push("Risk profile is favorable relative to potential reward.");
  } else if (score.riskScore < 40) {
    bullets.push("Risk score is below average — position sizing should be conservative.");
  }

  // Regime
  const regimeStr = (regime ?? "").toLowerCase();
  if (score.regimeScore >= 70 || regimeStr.includes("bull") || regimeStr.includes("momentum")) {
    bullets.push("Market regime is supportive — conditions favor momentum-driven setups.");
  } else if (score.regimeScore < 40 || regimeStr.includes("bear") || regimeStr.includes("caution")) {
    bullets.push("Market regime is challenging — headwinds may limit upside participation.");
  }

  // Overall ranking tier
  const overall = score.overallScore;
  let summary: string;
  if (overall >= 80) {
    summary = `With an overall score of ${overall}/100 and ${score.confidence} confidence, this ranks among the highest-quality opportunities currently available.`;
  } else if (overall >= 65) {
    summary = `With an overall score of ${overall}/100 and ${score.confidence} confidence, this is a solid setup that meets key quality criteria.`;
  } else if (overall >= 50) {
    summary = `With an overall score of ${overall}/100 and ${score.confidence} confidence, this setup is valid but below average — trade with reduced size.`;
  } else {
    summary = `With an overall score of ${overall}/100 and ${score.confidence} confidence, this setup has notable weaknesses — approach with caution.`;
  }

  return { bullets, summary };
}

// ---------------------------------------------------------------------------
// Risk explanation — deterministic, no LLM
// ---------------------------------------------------------------------------

export interface RiskExplanation {
  rewardRisk: string;
  gapRisk: string;
  liquidity: string;
  volatility: string;
  earningsNote: string;
  riskBudget: string;
}

export function buildRiskExplanation(
  score: OpportunityScore,
  candidate?: Pick<ScoredCandidate, "rewardRisk" | "maxRisk" | "warnings"> | null,
): RiskExplanation {
  const rr = candidate?.rewardRisk;
  const rewardRisk = typeof rr === "number"
    ? `${rr.toFixed(1)}:1 — ${rr >= 3 ? "exceeds the 3:1 minimum." : rr >= 2 ? "acceptable but borderline." : "below the 3:1 minimum — size conservatively."}`
    : "Not calculated — verify manually before entry.";

  const warnings = (candidate?.warnings ?? score.warnings ?? []).join(" ").toLowerCase();

  const gapRisk = warnings.includes("earnings") || warnings.includes("gap")
    ? "Elevated gap risk detected — check earnings dates and recent news before entry."
    : "No elevated gap risk signals identified in current scan data.";

  const liquidity = score.technicalScore >= 70
    ? "Liquidity appears adequate for the identified setup — verify average daily volume before sizing."
    : "Liquidity may be limited — use limit orders and verify spread before entry.";

  const volatility = score.riskScore >= 70
    ? "Volatility is within normal range for this strategy type."
    : score.riskScore >= 50
    ? "Moderate volatility — adjust stop placement to avoid noise-driven exits."
    : "Elevated volatility detected — reduce position size accordingly.";

  const earningsNote = warnings.includes("earnings")
    ? "⚠ Earnings event detected in the warning signals — elevated binary risk around the announcement."
    : "No earnings warning flagged — verify upcoming dates independently before entry.";

  const maxR = candidate?.maxRisk;
  const riskBudget = typeof maxR === "number" && maxR > 0
    ? `Maximum risk is estimated at $${maxR.toLocaleString()} — this is an educational planning figure only.`
    : "Risk budget not calculated — apply your personal position-sizing rules.";

  return { rewardRisk, gapRisk, liquidity, volatility, earningsNote, riskBudget };
}

// ---------------------------------------------------------------------------
// Find related opportunities from the same ranking
// ---------------------------------------------------------------------------

export interface RelatedOpportunity {
  symbol: string;
  rank: number;
  category: string;
  overallScore: number;
  strategy?: string;
  reason: "same_category" | "same_strategy" | "same_bucket";
}

export function findRelated(
  symbol: string,
  ranking: OpportunityRanking,
  limit = 4,
): RelatedOpportunity[] {
  // Find source candidate first to get its category + strategy
  const allGrowth = ranking.topGrowth.map(c => ({ ...c, bucket: "topGrowth" as const }));
  const allIncome = ranking.topIncome.map(c => ({ ...c, bucket: "topIncome" as const }));

  const source =
    allGrowth.find(c => c.symbol === symbol) ??
    allIncome.find(c => c.symbol === symbol);

  const sourceCategory = source?.opportunityScore.category ?? null;
  const sourceStrategy = source?.strategy ?? null;

  const results: RelatedOpportunity[] = [];

  const candidates = [...allGrowth, ...allIncome];
  for (const c of candidates) {
    if (c.symbol === symbol) continue;
    if (results.length >= limit) break;

    const cat = c.opportunityScore.category;
    const strat = c.strategy ?? null;

    let reason: RelatedOpportunity["reason"] | null = null;
    if (sourceStrategy && strat === sourceStrategy) reason = "same_strategy";
    else if (sourceCategory && cat === sourceCategory) reason = "same_category";
    else if (source && c.bucket === (source as any).bucket) reason = "same_bucket";

    if (reason) {
      results.push({
        symbol: c.symbol,
        rank: c.rank,
        category: cat,
        overallScore: c.opportunityScore.overallScore,
        strategy: strat ?? undefined,
        reason,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// History trend helpers
// ---------------------------------------------------------------------------

export interface HistoryTrend {
  direction: "improving" | "declining" | "stable" | "insufficient";
  deltaScore: number | null;
  sessions: number;
}

export function analyzeHistoryTrend(history: HistoryEntry[]): HistoryTrend {
  if (history.length < 2) {
    return { direction: "insufficient", deltaScore: null, sessions: history.length };
  }
  const latest = history[0].score;
  const oldest = history[history.length - 1].score;
  const delta = Math.round((latest - oldest) * 10) / 10;

  let direction: HistoryTrend["direction"];
  if (delta > 5) direction = "improving";
  else if (delta < -5) direction = "declining";
  else direction = "stable";

  return { direction, deltaScore: delta, sessions: history.length };
}

// ---------------------------------------------------------------------------
// All ranked symbols in a ranking (for compare selector)
// ---------------------------------------------------------------------------

export function getAllRankedSymbols(ranking: OpportunityRanking): string[] {
  const syms = new Set<string>();
  for (const c of ranking.topGrowth) syms.add(c.symbol);
  for (const c of ranking.topIncome) syms.add(c.symbol);
  for (const c of ranking.watchlist) syms.add(c.symbol);
  for (const c of ranking.approaching) syms.add(c.symbol);
  return Array.from(syms).sort();
}

export function findScoredCandidate(
  symbol: string,
  ranking: OpportunityRanking,
): ScoredCandidate | WatchScoredCandidate | null {
  return (
    ranking.topGrowth.find(c => c.symbol === symbol) ??
    ranking.topIncome.find(c => c.symbol === symbol) ??
    ranking.watchlist.find(c => c.symbol === symbol) ??
    ranking.approaching.find(c => c.symbol === symbol) ??
    null
  );
}
