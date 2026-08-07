// Opportunity Ranking Engine — Sprint 2.2.7
//
// Pure deterministic service that consumes MCP scanner output + institutional
// signals + market regime to produce a composite 0-100 score per candidate.
//
// Design constraints:
//   - Zero OpenAI / LLM calls. 100% synchronous pure computation.
//   - All weights are configurable via RankingWeights.
//   - Missing evidence degrades gracefully; never fabricates a signal.
//   - Institutional signals read from the precomputed institutional_symbol_signals
//     table (built by Sprint 2.2.6). One batch DB query per snapshot ranking.
//   - Results are cached in-memory after each scanner run. Dashboard reads the
//     in-memory result; no live computation ever happens per-request.
//
// Score formula:
//   overallScore = Technical×0.40 + Institutional×0.20 + Fundamental×0.15
//                + Risk×0.15 + Regime×0.10
//
// All component scores are 0-100.  Final score is an integer in [0, 100].

import { db } from "../db";
import { sql } from "drizzle-orm";
import type {
  RankedTradeCandidate,
  RankedWatchCandidate,
} from "../routes/ranked-trade-search";
import type { PersistedOpportunitySnapshot } from "./opportunity-snapshot-store";

// ---------------------------------------------------------------------------
// Configurable weights
// ---------------------------------------------------------------------------

export interface RankingWeights {
  /** Technical scanner evidence weight [0, 1]. Default 0.40. */
  technical: number;
  /** Institutional 13F signal weight [0, 1]. Default 0.20. */
  institutional: number;
  /** Fundamental / earnings / liquidity weight [0, 1]. Default 0.15. */
  fundamental: number;
  /** Risk / reward quality weight [0, 1]. Default 0.15. */
  risk: number;
  /** Regime alignment weight [0, 1]. Default 0.10. */
  regime: number;
}

export const DEFAULT_WEIGHTS: RankingWeights = {
  technical: 0.40,
  institutional: 0.20,
  fundamental: 0.15,
  risk: 0.15,
  regime: 0.10,
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type OpportunityCategory = "Top Growth" | "Income" | "Watch" | "Avoid";
export type ScoreConfidence = "high" | "medium" | "low";

export interface OpportunityScore {
  symbol: string;
  /** Weighted composite, integer in [0, 100]. */
  overallScore: number;
  confidence: ScoreConfidence;
  technicalScore: number;
  institutionalScore: number;
  fundamentalScore: number;
  riskScore: number;
  regimeScore: number;
  category: OpportunityCategory;
  /** Positive signals surfaced to the UI (max 4). */
  reasons: string[];
  /** Risk warnings surfaced to the UI (max 3). */
  warnings: string[];
  lastUpdated: string;
}

export interface ScoredGrowthCandidate extends RankedTradeCandidate {
  opportunityScore: OpportunityScore;
}

export interface ScoredWatchCandidate extends RankedWatchCandidate {
  opportunityScore: OpportunityScore;
}

export interface OpportunityChange {
  symbol: string;
  /** Previous category or "New" if absent. */
  from: string;
  /** Current category. */
  to: string;
  direction: "upgraded" | "downgraded" | "new" | "moved";
}

export interface OpportunityRankingResult {
  generatedAt: string;
  snapshotId: string;
  regime: string | null;
  weights: RankingWeights;
  /** Ranked by overallScore DESC — qualified non-income momentum candidates. */
  topGrowth: ScoredGrowthCandidate[];
  /** Ranked by overallScore DESC — income-strategy candidates. */
  topIncome: ScoredGrowthCandidate[];
  /** Ranked by overallScore DESC — watch-list candidates. */
  watchlist: ScoredWatchCandidate[];
  /** Ranked by overallScore DESC — approaching qualification. */
  approaching: ScoredWatchCandidate[];
  /** Symbol-level changes vs previous ranking. */
  changes: OpportunityChange[];
}

// ---------------------------------------------------------------------------
// Institutional signal row (minimal — only fields used by the engine)
// ---------------------------------------------------------------------------

interface InstitutionalSignalRow {
  symbol: string;
  status: string;
  score: number | null;
  data_quality_confidence: string | null;
  label: string | null;
  manager_count_latest: number | null;
  new_manager_count: number | null;
  exited_manager_count: number | null;
  increased_manager_count: number | null;
  reduced_manager_count: number | null;
}

// ---------------------------------------------------------------------------
// ── Pure computation functions ──────────────────────────────────────────────
// ---------------------------------------------------------------------------

/**
 * Technical score from scanner evidence.
 * Uses strategyScore directly if available (already 0-100).
 * Falls back to a rank-derived estimate if not.
 */
export function computeTechnicalScore(candidate: RankedTradeCandidate): number {
  let base: number;

  // strategyScore is a runtime-emitted field (not in the interface declaration
  // but present in the sanitized output via pickNum).
  const sc = (candidate as Record<string, unknown>).strategyScore;
  if (typeof sc === "number" && sc >= 0 && sc <= 100) {
    base = sc;
  } else {
    // Rank 1 → 85, rank 2 → 75, rank 3 → 65, …, floor at 30.
    const r = typeof candidate.rank === "number" && candidate.rank >= 1 ? candidate.rank : 5;
    base = Math.max(30, 85 - (r - 1) * 10);
  }

  // Confidence modifier
  const conf = (candidate.confidence ?? "").toLowerCase();
  if (conf === "high") base += 5;
  else if (conf === "low") base -= 10;

  // Setup status modifier
  const setup = (candidate.setupStatus ?? "").toLowerCase();
  if (setup === "watch" || setup === "approaching" || setup === "near") base -= 8;

  return Math.round(clamp(base, 0, 100));
}

/**
 * Technical score for a watch candidate.
 * Watch candidates have weaker confirmation, so base score is lower.
 */
export function computeWatchTechnicalScore(candidate: RankedWatchCandidate): number {
  // Watch candidates are not yet qualified — conservative base.
  let base = 42;

  // If the candidate has an explicit missing-confirmation note, reduce further.
  if (candidate.missingConfirmation) base -= 5;

  // Stage advancement is a positive signal.
  const stage = (candidate.currentStage ?? "").toLowerCase();
  if (stage.includes("3") || stage.includes("late") || stage.includes("final")) base += 10;
  else if (stage.includes("2") || stage.includes("mid")) base += 5;

  return Math.round(clamp(base, 0, 100));
}

export interface InstitutionalScoreResult {
  score: number;
  /** True when actual institutional data was available for this symbol. */
  hasData: boolean;
  /** DataQuality confidence reported by the signal engine. */
  dataConfidence: string | null;
}

/**
 * Institutional score derived from the precomputed signal.
 *
 * When no signal is available, returns 50 (neutral) with hasData=false.
 * This means the institutional weight contributes neutrally when evidence is
 * absent — it never silently penalises or boosts an unknown symbol.
 */
export function computeInstitutionalScore(
  row: InstitutionalSignalRow | null | undefined,
): InstitutionalScoreResult {
  if (!row) return { score: 50, hasData: false, dataConfidence: null };

  const { status, score, data_quality_confidence } = row;

  if (
    status === "unavailable" ||
    status === "mapping_incomplete" ||
    status === "insufficient_history" ||
    status === "processing"
  ) {
    return { score: 50, hasData: false, dataConfidence: data_quality_confidence };
  }

  if (score == null) {
    return { score: 50, hasData: false, dataConfidence: data_quality_confidence };
  }

  // Scale by confidence tier to reflect evidence reliability.
  let adjusted: number;
  switch (data_quality_confidence) {
    case "high":
      adjusted = score;
      break;
    case "moderate":
      // Compress toward 50: 50 + 0.75 * (score - 50)
      adjusted = 50 + 0.75 * (score - 50);
      break;
    case "limited":
      // Compress further: 50 + 0.55 * (score - 50)
      adjusted = 50 + 0.55 * (score - 50);
      break;
    default:
      return { score: 50, hasData: false, dataConfidence: data_quality_confidence };
  }

  return {
    score: Math.round(clamp(adjusted, 0, 100)),
    hasData: true,
    dataConfidence: data_quality_confidence,
  };
}

/**
 * Fundamental score — uses the candidate's strategy and warning text as a proxy
 * for earnings risk and income characteristics (no market-cap data available).
 */
export function computeFundamentalScore(
  candidate: RankedTradeCandidate | RankedWatchCandidate,
): number {
  let base = 60;

  const allText = [
    ...((candidate as RankedTradeCandidate).whySelected ?? []),
    ...((candidate as RankedTradeCandidate).warnings ?? []),
    ...(( candidate as RankedWatchCandidate).watchConditions ?? []),
    candidate.strategy ?? "",
  ]
    .join(" ")
    .toLowerCase();

  // Earnings proximity is a risk factor for breakout strategies.
  if (/earnings\s*risk|reporting\s*this\s*week|earnings\s*this\s*week/.test(allText)) base -= 15;

  // Income-generating strategies score better on fundamental quality.
  if (/covered\s*call|cash.secured\s*put|dividend|income/.test(allText)) base += 15;

  // Liquidity mention is positive.
  if (/strong\s*liquidity|high\s*liquidity/.test(allText)) base += 5;

  return Math.round(clamp(base, 0, 100));
}

/**
 * Risk score — higher = better risk profile.
 * Combines reward/risk ratio, budget fit, and warning patterns.
 */
export function computeRiskScore(candidate: RankedTradeCandidate): number {
  let score = 60;

  // Budget fit
  if (candidate.fitsRiskBudget === true) score += 15;
  else if (candidate.fitsRiskBudget === false) score -= 10;

  // Reward/risk ratio
  const rr = typeof candidate.rewardRisk === "number" ? candidate.rewardRisk : 0;
  if (rr >= 3.0) score += 18;
  else if (rr >= 2.5) score += 13;
  else if (rr >= 2.0) score += 8;
  else if (rr >= 1.5) score += 3;
  else if (rr > 0 && rr < 1.0) score -= 22;
  // rr 1.0–1.5: no adjustment (marginal)

  // Warning patterns that increase risk
  const warningText = (candidate.warnings ?? []).join(" ").toLowerCase();
  if (/gap\s*risk|large\s*gap|overnight\s*gap/.test(warningText)) score -= 10;
  if (/earnings.*risk|high.*volat/.test(warningText)) score -= 5;
  if (/low.*liquidity|thin.*market/.test(warningText)) score -= 8;

  return Math.round(clamp(score, 0, 100));
}

/**
 * Risk score for watch candidates — more conservative (no confirmed entry).
 */
export function computeWatchRiskScore(candidate: RankedWatchCandidate): number {
  // Watch candidates have fewer risk signals; use a slightly lower base.
  let score = 50;
  const text = (candidate.watchConditions ?? []).join(" ").toLowerCase();
  if (/earnings/.test(text)) score -= 10;
  return Math.round(clamp(score, 0, 100));
}

/**
 * Regime alignment score.
 * TRENDING + momentum strategy → high (90).
 * RISK_OFF → low (15–25).
 * Unknown regime → neutral (50).
 */
export function computeRegimeScore(
  regime: string | null,
  strategy?: string | null,
): number {
  const r = (regime ?? "").toUpperCase();
  const s = (strategy ?? "").toUpperCase();

  const isMomentum = /VCP|TREND|GAP|HIGH_RVOL|BREAKOUT|ORB|SURGE/.test(s);
  const isIncome   = /COVERED|CREDIT|SPREAD|CASH.SECURED|INCOME/.test(s);

  if (r === "TRENDING") {
    if (isMomentum) return 90;
    if (isIncome)   return 65;
    return 75;
  }
  if (r === "RISK_OFF") {
    if (isMomentum) return 15;
    if (isIncome)   return 40;
    return 20;
  }
  if (r === "CHOPPY") {
    if (isMomentum) return 35;
    if (isIncome)   return 55;
    return 45;
  }

  return 50; // regime unknown/null → neutral
}

/**
 * Weighted composite score from individual components.
 * All weights are applied as-supplied — caller is responsible for ensuring
 * they sum to 1.0 (or close enough for the use case).
 */
export function computeOverallScore(
  components: {
    technical: number;
    institutional: number;
    fundamental: number;
    risk: number;
    regime: number;
  },
  weights: RankingWeights,
): number {
  const raw =
    components.technical    * weights.technical +
    components.institutional * weights.institutional +
    components.fundamental  * weights.fundamental +
    components.risk         * weights.risk +
    components.regime       * weights.regime;
  return Math.round(clamp(raw, 0, 100));
}

/**
 * Assign a display category based on overall score, regime, and strategy type.
 */
export function assignCategory(
  overallScore: number,
  regime: string | null,
  strategy?: string | null,
  isWatchCandidate = false,
): OpportunityCategory {
  if (isWatchCandidate) return "Watch";

  const r = (regime ?? "").toUpperCase();
  const s = (strategy ?? "").toUpperCase();
  const isIncome = /COVERED|CREDIT|SPREAD|CASH.SECURED|INCOME/.test(s);

  // Hard avoid: RISK_OFF with weak score, or any score below 40.
  if (overallScore < 40) return "Avoid";
  if (r === "RISK_OFF" && overallScore < 55) return "Avoid";

  if (isIncome && overallScore >= 55) return "Income";
  if (overallScore >= 60) return "Top Growth";
  return "Watch";
}

/**
 * Determine overall confidence for the OpportunityScore.
 *
 * high  : technicalScore ≥ 70 AND institutional data confirmed.
 * medium: overallScore ≥ 50 OR either source is reliable.
 * low   : overallScore < 50 or all evidence is weak.
 */
export function deriveConfidence(
  overallScore: number,
  technicalScore: number,
  institutionalHasData: boolean,
): ScoreConfidence {
  if (technicalScore >= 70 && institutionalHasData) return "high";
  if (overallScore >= 50) return "medium";
  return "low";
}

/**
 * Build human-readable reason strings from available evidence.
 * Returns at most 4 reasons.
 */
export function buildReasons(
  candidate: RankedTradeCandidate | RankedWatchCandidate,
  technicalScore: number,
  institutionalScore: number,
  institutionalHasData: boolean,
): string[] {
  const reasons: string[] = [];

  // Primary scanner rationale
  const whySelected = (candidate as RankedTradeCandidate).whySelected ?? [];
  if (whySelected.length > 0) reasons.push(whySelected[0]);
  if (whySelected.length > 1) reasons.push(whySelected[1]);

  // Institutional signal
  if (institutionalHasData && institutionalScore >= 70) {
    reasons.push("Institutional accumulation signal");
  } else if (institutionalHasData && institutionalScore >= 60) {
    reasons.push("Moderate institutional interest");
  }

  // Technical quality
  if (technicalScore >= 80 && reasons.length < 4) {
    reasons.push("Strong technical setup quality");
  }

  return reasons.slice(0, 4);
}

/**
 * Build warning strings from candidate and score context.
 * Returns at most 3 warnings.
 */
export function buildWarnings(
  candidate: RankedTradeCandidate | RankedWatchCandidate,
  regimeScore: number,
  regime: string | null,
): string[] {
  const warnings: string[] = [];

  // Pass through scanner warnings first.
  const scannerWarnings = (candidate as RankedTradeCandidate).warnings ?? [];
  for (const w of scannerWarnings.slice(0, 2)) warnings.push(w);

  // Regime context warning.
  if (regimeScore <= 25 && regime && warnings.length < 3) {
    warnings.push(`Unfavorable market regime (${regime})`);
  }

  return warnings.slice(0, 3);
}

// ---------------------------------------------------------------------------
// ── Candidate scoring ───────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

/**
 * Score a single qualified (non-watch) candidate.
 * Pure — no DB access, no side effects.
 */
export function scoreCandidate(
  candidate: RankedTradeCandidate,
  institutionalRow: InstitutionalSignalRow | null,
  regime: string | null,
  weights: RankingWeights,
  now: string,
): OpportunityScore {
  const technical    = computeTechnicalScore(candidate);
  const instResult   = computeInstitutionalScore(institutionalRow);
  const fundamental  = computeFundamentalScore(candidate);
  const risk         = computeRiskScore(candidate);
  const regimeScore  = computeRegimeScore(regime, candidate.strategy);

  const overallScore = computeOverallScore(
    { technical, institutional: instResult.score, fundamental, risk, regime: regimeScore },
    weights,
  );

  const confidence = deriveConfidence(overallScore, technical, instResult.hasData);
  const category   = assignCategory(overallScore, regime, candidate.strategy, false);
  const reasons    = buildReasons(candidate, technical, instResult.score, instResult.hasData);
  const warnings   = buildWarnings(candidate, regimeScore, regime);

  return {
    symbol: candidate.symbol,
    overallScore,
    confidence,
    technicalScore: technical,
    institutionalScore: instResult.score,
    fundamentalScore: fundamental,
    riskScore: risk,
    regimeScore,
    category,
    reasons,
    warnings,
    lastUpdated: now,
  };
}

/**
 * Score a single watch candidate.
 * Pure — no DB access, no side effects.
 */
export function scoreWatchCandidate(
  candidate: RankedWatchCandidate,
  institutionalRow: InstitutionalSignalRow | null,
  regime: string | null,
  weights: RankingWeights,
  now: string,
): OpportunityScore {
  const technical    = computeWatchTechnicalScore(candidate);
  const instResult   = computeInstitutionalScore(institutionalRow);
  const fundamental  = computeFundamentalScore(candidate);
  const risk         = computeWatchRiskScore(candidate);
  const regimeScore  = computeRegimeScore(regime, candidate.strategy);

  const overallScore = computeOverallScore(
    { technical, institutional: instResult.score, fundamental, risk, regime: regimeScore },
    weights,
  );

  const confidence = deriveConfidence(overallScore, technical, instResult.hasData);
  const reasons    = buildReasons(candidate, technical, instResult.score, instResult.hasData);
  const warnings   = buildWarnings(candidate, regimeScore, regime);

  return {
    symbol: candidate.symbol,
    overallScore,
    confidence,
    technicalScore: technical,
    institutionalScore: instResult.score,
    fundamentalScore: fundamental,
    riskScore: risk,
    regimeScore,
    category: "Watch" as const,
    reasons,
    warnings,
    lastUpdated: now,
  };
}

// ---------------------------------------------------------------------------
// ── Pure ranking pipeline (no DB) ───────────────────────────────────────────
// ---------------------------------------------------------------------------

/**
 * Rank a full snapshot using an already-fetched institutional signal map.
 * Pure: no DB, no side effects.
 */
export function buildRanking(
  snapshot: PersistedOpportunitySnapshot,
  institutionalMap: Map<string, InstitutionalSignalRow>,
  previousResult: OpportunityRankingResult | null,
  weights: RankingWeights,
  now: string,
): OpportunityRankingResult {
  const regime = snapshot.marketRegime;

  // ── Score qualified candidates ───────────────────────────────────────────
  const scoredAll = snapshot.topGrowth.concat(snapshot.topIncome).map((c) =>
    Object.assign({}, c, {
      opportunityScore: scoreCandidate(
        c,
        institutionalMap.get(c.symbol.toUpperCase()) ?? null,
        regime,
        weights,
        now,
      ),
    }),
  ) as ScoredGrowthCandidate[];

  // Re-partition after scoring so institutional/regime context can reclassify.
  const INCOME_RE = /income|covered|credit|spread|dividend|yield/i;
  const topGrowth = scoredAll
    .filter((c) => !c.strategy || !INCOME_RE.test(c.strategy))
    .sort(byScore)
    .slice(0, 5);
  const topIncome = scoredAll
    .filter((c) => !!c.strategy && INCOME_RE.test(c.strategy))
    .sort(byScore)
    .slice(0, 5);

  // ── Score watchlist ───────────────────────────────────────────────────────
  const watchlist = snapshot.topWatchlist
    .map((c) =>
      Object.assign({}, c, {
        opportunityScore: scoreWatchCandidate(
          c,
          institutionalMap.get(c.symbol.toUpperCase()) ?? null,
          regime,
          weights,
          now,
        ),
      }),
    )
    .sort(byScore)
    .slice(0, 5) as ScoredWatchCandidate[];

  const approaching = snapshot.approachingQualification
    .map((c) =>
      Object.assign({}, c, {
        opportunityScore: scoreWatchCandidate(
          c,
          institutionalMap.get(c.symbol.toUpperCase()) ?? null,
          regime,
          weights,
          now,
        ),
      }),
    )
    .sort(byScore)
    .slice(0, 5) as ScoredWatchCandidate[];

  // ── Compute changes vs previous ranking ──────────────────────────────────
  const changes = computeChanges(
    scoredAll,
    [...watchlist, ...approaching],
    previousResult,
  );

  return {
    generatedAt: now,
    snapshotId: snapshot.id,
    regime,
    weights,
    topGrowth,
    topIncome,
    watchlist,
    approaching,
    changes,
  };
}

function byScore(
  a: ScoredGrowthCandidate | ScoredWatchCandidate,
  b: ScoredGrowthCandidate | ScoredWatchCandidate,
): number {
  const diff = b.opportunityScore.overallScore - a.opportunityScore.overallScore;
  if (diff !== 0) return diff;
  // Tie-break: symbol alphabetically for determinism.
  return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
}

function computeChanges(
  qualifiedCandidates: ScoredGrowthCandidate[],
  watchCandidates: ScoredWatchCandidate[],
  previous: OpportunityRankingResult | null,
): OpportunityChange[] {
  if (!previous) return [];

  const changes: OpportunityChange[] = [];

  // Build a flat previous-category map.
  const prevCategories = new Map<string, string>();
  for (const c of previous.topGrowth)  prevCategories.set(c.symbol, "Top Growth");
  for (const c of previous.topIncome)  prevCategories.set(c.symbol, "Income");
  for (const c of previous.watchlist)  prevCategories.set(c.symbol, "Watch");
  for (const c of previous.approaching) prevCategories.set(c.symbol, "Approaching");

  const CATEGORY_ORDER: Record<string, number> = {
    "Top Growth": 4, "Income": 3, "Watch": 2, "Approaching": 1, "Avoid": 0,
  };

  for (const c of qualifiedCandidates) {
    const currentCat = c.opportunityScore.category;
    const prevCat    = prevCategories.get(c.symbol);
    if (!prevCat) {
      changes.push({ symbol: c.symbol, from: "New", to: currentCat, direction: "new" });
    } else if (prevCat !== currentCat) {
      const prevRank = CATEGORY_ORDER[prevCat]    ?? 1;
      const currRank = CATEGORY_ORDER[currentCat] ?? 1;
      const dir = currRank > prevRank ? "upgraded" : currRank < prevRank ? "downgraded" : "moved";
      changes.push({ symbol: c.symbol, from: prevCat, to: currentCat, direction: dir });
    }
  }

  for (const c of watchCandidates) {
    const prevCat = prevCategories.get(c.symbol);
    if (!prevCat) {
      changes.push({ symbol: c.symbol, from: "New", to: "Watch", direction: "new" });
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// ── DB-backed ranking (reads institutional signals, builds ranking) ─────────
// ---------------------------------------------------------------------------

/**
 * Batch-fetch institutional signal rows for a list of symbols.
 * Returns a Map<UPPER_SYMBOL, row> — missing symbols are absent from the map.
 *
 * Single SQL query; no Drizzle ORM here to avoid schema re-import issues.
 */
export async function fetchInstitutionalSignalMap(
  symbols: string[],
): Promise<Map<string, InstitutionalSignalRow>> {
  if (symbols.length === 0) return new Map();

  const upper = symbols.map((s) => s.toUpperCase());

  // Build a parameterised query without template-literal interpolation of user data.
  // Using sql`` + Drizzle's sql.join/placeholder is verbose; raw SQL with typed params
  // is safer and simpler for a fixed IN clause.
  const result = await db.execute(
    sql`SELECT symbol, status, score, data_quality_confidence, label,
               manager_count_latest, new_manager_count, exited_manager_count,
               increased_manager_count, reduced_manager_count
        FROM institutional_symbol_signals
        WHERE symbol = ANY(${upper})`,
  );

  const rows = (result as any).rows ?? (result as any[]) ?? [];
  const map = new Map<string, InstitutionalSignalRow>();
  for (const r of rows) {
    if (r.symbol) {
      map.set(String(r.symbol).toUpperCase(), r as InstitutionalSignalRow);
    }
  }
  return map;
}

/**
 * Compute a full ranking for the given snapshot.
 * Reads institutional signals from DB (one batch query), then pure-computes.
 *
 * This is the only DB-touching function in the ranking engine.
 * Never throws — on DB error, falls back to ranking with no institutional data.
 */
export async function computeRankingForSnapshot(
  snapshot: PersistedOpportunitySnapshot,
  previousResult: OpportunityRankingResult | null = null,
  weights: RankingWeights = DEFAULT_WEIGHTS,
): Promise<OpportunityRankingResult> {
  const now = new Date().toISOString();

  const allSymbols = [
    ...snapshot.topGrowth,
    ...snapshot.topIncome,
    ...snapshot.topWatchlist,
    ...snapshot.approachingQualification,
  ].map((c) => c.symbol);

  let institutionalMap = new Map<string, InstitutionalSignalRow>();
  try {
    institutionalMap = await fetchInstitutionalSignalMap(allSymbols);
  } catch (err: any) {
    // Non-fatal: institutional table may not yet exist on first deploy.
    process.stderr.write(
      JSON.stringify({
        event: "opportunity_ranking_institutional_fetch_failed",
        error: String(err?.message ?? err).slice(0, 200),
        detail: "Ranking will proceed without institutional data.",
      }) + "\n",
    );
  }

  return buildRanking(snapshot, institutionalMap, previousResult, weights, now);
}

// ---------------------------------------------------------------------------
// ── In-memory cache — set/get by opportunity-engine hook ────────────────────
// ---------------------------------------------------------------------------

let latestRanking: OpportunityRankingResult | null = null;

export function getLatestRanking(): OpportunityRankingResult | null {
  return latestRanking;
}

export function setLatestRanking(result: OpportunityRankingResult): void {
  latestRanking = result;
}

// ---------------------------------------------------------------------------
// ── Utility ─────────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
