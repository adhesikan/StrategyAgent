// opportunity-change-engine.ts — Sprint 2.3.1
//
// Pure deterministic engine that explains WHY each opportunity changed.
// No LLM, no randomness, no network calls.
//
// Input: current OpportunityRankingResult + per-symbol history rows (DB-fetched by caller)
// Output: OpportunityChangeExplanation[] — one per symbol that had a meaningful change
//
// Rules:
//   - "previous" data comes from the most-recent history row BEFORE the current scan
//   - When no previous row exists the symbol is "new"
//   - Dimension scores in the current candidate drive driver inference
//     (we don't have previous per-dimension scores from history, so we infer from the
//      score delta direction + current dimension values + textual signals)
//   - Everything is deterministic: same inputs → same output

import type { OpportunityRankingResult, ScoredGrowthCandidate, ScoredWatchCandidate, OpportunityChange } from "./opportunity-ranking-engine";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ChangeImportance = "Minor" | "Moderate" | "Major" | "Critical";
export type ChangeConfidence = "high" | "medium" | "low";

export interface OpportunityChangeExplanation {
  symbol: string;
  previousRank: number | null;
  currentRank: number | null;
  previousScore: number | null;
  currentScore: number;
  scoreDelta: number | null;
  rankDelta: number | null;
  importance: ChangeImportance;
  summary: string;
  drivers: string[];
  warnings: string[];
  confidence: ChangeConfidence;
  category: string;
  direction: OpportunityChange["direction"] | "unchanged" | "removed";
}

export interface ChangeIntelligenceReport {
  generatedAt: string;
  /** Symbols with Major or Critical importance. */
  majorMovers: OpportunityChangeExplanation[];
  /** Symbols that moved to a higher category tier. */
  upgrades: OpportunityChangeExplanation[];
  /** Symbols that moved to a lower category tier. */
  downgrades: OpportunityChangeExplanation[];
  /** Symbols appearing for the first time in the ranking. */
  newEntries: OpportunityChangeExplanation[];
  /** Symbols that were qualified recently but are absent from current ranking. */
  removed: OpportunityChangeExplanation[];
}

// Minimal history row shape — caller fetches from opportunity_history table.
export interface SymbolHistoryRow {
  symbol: string;
  score: number;
  rank: number | null;
  qualificationStatus: string;
  lifecycleState: string;
  strategy: string | null;
  marketRegime: string | null;
  scanTime: string;
}

// ---------------------------------------------------------------------------
// Importance classifier
// ---------------------------------------------------------------------------

export function classifyImportance(
  scoreDelta: number | null,
  rankDelta: number | null,
  direction: OpportunityChangeExplanation["direction"],
): ChangeImportance {
  if (direction === "new" || direction === "removed") return "Major";

  const absScore = scoreDelta != null ? Math.abs(scoreDelta) : 0;
  const absRank  = rankDelta  != null ? Math.abs(rankDelta)  : 0;

  if (absScore >= 20 || absRank >= 5) return "Critical";
  if (absScore >= 10 || absRank >= 3) return "Major";
  if (absScore >= 5  || absRank >= 1) return "Moderate";
  return "Minor";
}

// ---------------------------------------------------------------------------
// Driver inference
// ---------------------------------------------------------------------------

function allText(candidate: ScoredGrowthCandidate | ScoredWatchCandidate): string {
  const scored = candidate as ScoredGrowthCandidate;
  return [
    ...(scored.whySelected ?? []),
    ...(scored.warnings ?? []),
    ...((candidate as any).watchConditions ?? []),
    candidate.strategy ?? "",
    candidate.opportunityScore.reasons.join(" "),
    candidate.opportunityScore.warnings.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

export function inferDrivers(
  candidate: ScoredGrowthCandidate | ScoredWatchCandidate,
  scoreDelta: number | null,
  direction: OpportunityChangeExplanation["direction"],
  prevRegime: string | null,
  currentRegime: string | null,
): string[] {
  const drivers: string[] = [];
  const score = candidate.opportunityScore;
  const text  = allText(candidate);
  const improving = scoreDelta == null || scoreDelta >= 0;

  // ── New entry ──────────────────────────────────────────────────────────────
  if (direction === "new") {
    drivers.push(`New opportunity — ${candidate.symbol} entered the ranking for the first time.`);
    if (score.technicalScore >= 70) drivers.push("Technical quality meets qualification threshold.");
    if (score.institutionalScore >= 65) drivers.push("Institutional signal supports the thesis.");
    return drivers;
  }

  // ── Removed ───────────────────────────────────────────────────────────────
  if (direction === "removed") {
    drivers.push(`${candidate.symbol} is no longer in the ranking.`);
    if (score.technicalScore < 50) drivers.push("Technical quality fell below qualification threshold.");
    if (text.includes("earnings") || text.includes("binary")) drivers.push("Elevated event risk may have triggered exclusion.");
    return drivers;
  }

  // ── Category change (slot 1 — always within the 5-driver cap) ──────────────
  if (direction === "upgraded") {
    drivers.push(`Promoted to ${score.category} — composite score crossed a higher threshold.`);
  } else if (direction === "downgraded") {
    drivers.push(`Demoted from previous tier — composite score fell below the ${score.category} threshold.`);
  }

  // ── Regime change (slot 2 — guaranteed when regime actually changed) ────────
  if (prevRegime && currentRegime && prevRegime !== currentRegime) {
    const currLower = currentRegime.toLowerCase();
    if (currLower.includes("bull") || currLower.includes("momentum")) {
      drivers.push(`Market regime improved to "${currentRegime}" — conditions now favor momentum setups.`);
    } else if (currLower.includes("bear") || currLower.includes("caution") || currLower.includes("defensive")) {
      drivers.push(`Market regime shifted to "${currentRegime}" — headwinds increased for growth setups.`);
    } else {
      drivers.push(`Market regime changed to "${currentRegime}".`);
    }
  }

  // ── Technical ─────────────────────────────────────────────────────────────
  if (score.technicalScore >= 80) {
    drivers.push(improving ? "Technical breakout confirmed — pattern quality is exceptional." : "Technical quality remains strong despite overall pressure.");
  } else if (score.technicalScore >= 65 && improving) {
    drivers.push("Technical quality improved — key confirmation signals are present.");
  } else if (score.technicalScore < 50 && !improving) {
    drivers.push("Pattern weakened — setup no longer fully confirmed.");
  }

  if (text.includes("volume")) {
    drivers.push(improving ? "Volume confirmed the move — above-average participation." : "Volume signal weakened — below-average participation.");
  }

  if (text.includes("breakout") || text.includes("resistance")) {
    drivers.push(improving ? "Resistance level approached — breakout potential identified." : "Resistance rejected — price failed to hold above key level.");
  }

  if (text.includes("support broken") || text.includes("invalidat")) {
    drivers.push("Support broken — previous stop level is no longer valid.");
  }

  // ── Institutional ─────────────────────────────────────────────────────────
  if (score.institutionalScore >= 70) {
    drivers.push(improving ? "Institutional confidence is elevated — 13F evidence is supportive." : "Institutional signal remains strong despite other pressure.");
  } else if (score.institutionalScore >= 55 && improving) {
    drivers.push("Institutional posture improved — net buying activity detected.");
  } else if (score.institutionalScore < 45 && !improving) {
    drivers.push("Institutional signal softened — reduced buying activity detected.");
  }

  // ── Fundamental ───────────────────────────────────────────────────────────
  if (score.fundamentalScore >= 70 && improving) {
    drivers.push("Fundamental characteristics are favorable for this strategy.");
  } else if (score.fundamentalScore < 45 && !improving) {
    drivers.push("Fundamental risk factors are elevated for current conditions.");
  }

  // ── Risk ──────────────────────────────────────────────────────────────────
  if (score.riskScore >= 70 && improving) {
    drivers.push("Risk profile improved — reward/risk ratio is within acceptable range.");
  } else if (score.riskScore < 45 && !improving) {
    drivers.push("Risk increased — position sizing should be reduced.");
  }

  // ── Regime ────────────────────────────────────────────────────────────────
  if (prevRegime && currentRegime && prevRegime !== currentRegime) {
    const currLower = currentRegime.toLowerCase();
    if (currLower.includes("bull") || currLower.includes("momentum")) {
      drivers.push(`Market regime improved to "${currentRegime}" — conditions now favor momentum setups.`);
    } else if (currLower.includes("bear") || currLower.includes("caution") || currLower.includes("defensive")) {
      drivers.push(`Market regime shifted to "${currentRegime}" — headwinds increased for growth setups.`);
    } else {
      drivers.push(`Market regime changed to "${currentRegime}".`);
    }
  } else if (score.regimeScore >= 70 && improving) {
    drivers.push("Market regime is supportive — current conditions favor this strategy type.");
  } else if (score.regimeScore < 40 && !improving) {
    drivers.push("Market regime is unfavorable — broad conditions are creating headwinds.");
  }

  // Deduplicate and cap at 5
  const seen: string[] = [];
  return drivers.filter(d => {
    if (seen.includes(d)) return false;
    seen.push(d);
    return true;
  }).slice(0, 5);
}

// ---------------------------------------------------------------------------
// Warning inference
// ---------------------------------------------------------------------------

export function inferWarnings(
  candidate: ScoredGrowthCandidate | ScoredWatchCandidate,
  direction: OpportunityChangeExplanation["direction"],
): string[] {
  const warnings: string[] = [];
  const score = candidate.opportunityScore;
  const text  = allText(candidate);
  const allWarn = [
    ...score.warnings,
    ...((candidate as ScoredGrowthCandidate).warnings ?? []),
  ].join(" ").toLowerCase();

  if (direction === "removed") return [];

  if (allWarn.includes("earnings") || text.includes("earnings")) {
    warnings.push("Earnings event approaching — binary risk is elevated.");
  }
  if (allWarn.includes("liquidity") || text.includes("thin")) {
    warnings.push("Liquidity may be limited — use limit orders.");
  }
  if (allWarn.includes("gap") || allWarn.includes("overnight")) {
    warnings.push("Gap risk detected — price may open outside the stop zone.");
  }
  if (score.riskScore < 40) {
    warnings.push("Risk score is below average — reduce position size.");
  }
  if (score.institutionalScore < 40) {
    warnings.push("Institutional signal is weak — thesis lacks 13F support.");
  }
  if (score.confidence === "low") {
    warnings.push("Signal confidence is low — data coverage may be limited.");
  }

  return Array.from(new Set(warnings)).slice(0, 3);
}

// ---------------------------------------------------------------------------
// Summary sentence generator
// ---------------------------------------------------------------------------

export function buildSummary(
  symbol: string,
  scoreDelta: number | null,
  rankDelta: number | null,
  drivers: string[],
  direction: OpportunityChangeExplanation["direction"],
  importance: ChangeImportance,
  category: string,
): string {
  if (direction === "new") {
    return `${symbol} entered the ranking as a ${category} opportunity with ${importance.toLowerCase()} signal strength.`;
  }
  if (direction === "removed") {
    return `${symbol} dropped out of the ranking — it no longer meets qualification criteria.`;
  }

  // Treat zero delta the same as null — use direction-based summary instead.
  const scorePart =
    scoreDelta == null || scoreDelta === 0 ? "" :
    scoreDelta > 0     ? `Overall score increased ${scoreDelta} points` :
    `Overall score fell ${Math.abs(scoreDelta)} points`;

  if (!scorePart) {
    if (direction === "upgraded")   return `${symbol} was promoted to ${category}.`;
    if (direction === "downgraded") return `${symbol} was demoted to ${category}.`;
    return `${symbol} remains in the ranking with ${importance.toLowerCase()} changes.`;
  }

  // Find the top cause from drivers
  const topDriver = drivers[0] ?? null;
  const secondDriver = drivers[1] ?? null;

  if (topDriver && secondDriver) {
    const d1 = topDriver.replace(/\.$/, "").toLowerCase();
    const d2 = secondDriver.replace(/\.$/, "").toLowerCase();
    return `${scorePart} because ${d1} and ${d2}.`;
  }
  if (topDriver) {
    return `${scorePart} because ${topDriver.replace(/\.$/, "").toLowerCase()}.`;
  }
  return `${scorePart}.`;
}

// ---------------------------------------------------------------------------
// Confidence classifier
// ---------------------------------------------------------------------------

export function classifyConfidence(
  candidate: ScoredGrowthCandidate | ScoredWatchCandidate,
  hasHistory: boolean,
): ChangeConfidence {
  const score = candidate.opportunityScore;
  if (!hasHistory) return "low"; // new entry — no delta to compare
  if (score.confidence === "high" && score.overallScore >= 70) return "high";
  if (score.confidence === "low"  || score.overallScore < 50)  return "low";
  return "medium";
}

// ---------------------------------------------------------------------------
// Single-symbol explanation builder
// ---------------------------------------------------------------------------

export function explainSymbolChange(
  candidate: ScoredGrowthCandidate | ScoredWatchCandidate,
  historyRows: SymbolHistoryRow[],          // newest-first; [0]=latest, [1]=previous
  change: OpportunityChange | null,
  currentRank: number | null,
  currentRegime: string | null,
): OpportunityChangeExplanation {
  // [0] is the most recent history row (from the current scan or prior);
  // [1] is the previous one.
  const prev = historyRows.length >= 2 ? historyRows[1] : null;
  const currentScore = candidate.opportunityScore.overallScore;
  const previousScore = prev ? prev.score : null;
  const previousRank  = prev ? prev.rank  : null;
  const scoreDelta = previousScore != null ? currentScore - previousScore : null;
  const rankDelta  = (previousRank != null && currentRank != null)
    ? previousRank - currentRank  // positive = moved up (rank number decreased)
    : null;

  const direction: OpportunityChangeExplanation["direction"] =
    change?.direction ?? (prev ? "unchanged" : "new");

  const prevRegime = prev?.marketRegime ?? null;
  const importance = classifyImportance(scoreDelta, rankDelta, direction);
  const drivers    = inferDrivers(candidate, scoreDelta, direction, prevRegime, currentRegime);
  const warnings   = inferWarnings(candidate, direction);
  const summary    = buildSummary(
    candidate.symbol,
    scoreDelta != null ? Math.round(scoreDelta) : null,
    rankDelta,
    drivers,
    direction,
    importance,
    candidate.opportunityScore.category,
  );
  const confidence = classifyConfidence(candidate, prev != null);

  return {
    symbol: candidate.symbol,
    previousRank,
    currentRank,
    previousScore: previousScore != null ? Math.round(previousScore * 10) / 10 : null,
    currentScore,
    scoreDelta: scoreDelta != null ? Math.round(scoreDelta * 10) / 10 : null,
    rankDelta,
    importance,
    summary,
    drivers,
    warnings,
    confidence,
    category: candidate.opportunityScore.category,
    direction,
  };
}

// ---------------------------------------------------------------------------
// Removed-symbol explanation
// ---------------------------------------------------------------------------

export function explainRemovedSymbol(
  symbol: string,
  historyRows: SymbolHistoryRow[],
  currentRegime: string | null,
): OpportunityChangeExplanation {
  const latest = historyRows[0];
  const previousScore = latest?.score ?? null;
  const previousRank  = latest?.rank  ?? null;

  return {
    symbol,
    previousRank,
    currentRank: null,
    previousScore,
    currentScore: 0,
    scoreDelta: previousScore != null ? -previousScore : null,
    rankDelta: null,
    importance: "Major",
    summary: `${symbol} dropped out of the ranking — it no longer meets qualification criteria.`,
    drivers: [
      `${symbol} is no longer in the ranking.`,
      previousScore != null && previousScore < 50
        ? "Score was already below average before removal."
        : "Score was in range but other criteria were not met.",
    ],
    warnings: [],
    confidence: "medium",
    category: "Removed",
    direction: "removed",
  };
}

// ---------------------------------------------------------------------------
// Main report builder — pure function
// ---------------------------------------------------------------------------

export function buildChangeIntelligenceReport(
  ranking: OpportunityRankingResult,
  /** Map from UPPER symbol → last 2 history rows (newest-first) */
  historyMap: Map<string, SymbolHistoryRow[]>,
  /** Symbols that were recently qualified but absent from current ranking */
  removedSymbols: string[],
): ChangeIntelligenceReport {
  const generatedAt = new Date().toISOString();
  const regime      = ranking.regime;

  // Build a change direction lookup from ranking.changes
  const changeMap = new Map<string, OpportunityChange>();
  for (const c of ranking.changes) {
    changeMap.set(c.symbol.toUpperCase(), c);
  }

  const allCandidates: Array<{ candidate: ScoredGrowthCandidate | ScoredWatchCandidate; rank: number | null }> = [
    ...ranking.topGrowth.map(  (c, i) => ({ candidate: c as ScoredGrowthCandidate, rank: i + 1 })),
    ...ranking.topIncome.map(  (c, i) => ({ candidate: c as ScoredGrowthCandidate, rank: i + 1 })),
    ...ranking.watchlist.map(  (c)    => ({ candidate: c as ScoredWatchCandidate,  rank: null })),
    ...ranking.approaching.map((c)    => ({ candidate: c as ScoredWatchCandidate,  rank: null })),
  ];

  const explanations: OpportunityChangeExplanation[] = allCandidates.map(({ candidate, rank }) => {
    const sym     = candidate.symbol.toUpperCase();
    const history = historyMap.get(sym) ?? [];
    const change  = changeMap.get(sym) ?? null;
    return explainSymbolChange(candidate, history, change, rank, regime);
  });

  // Removed symbols
  const removedExplanations: OpportunityChangeExplanation[] = removedSymbols.map(sym => {
    const history = historyMap.get(sym) ?? [];
    return explainRemovedSymbol(sym, history, regime);
  });

  const majorMovers = explanations
    .filter(e => e.importance === "Major" || e.importance === "Critical")
    .sort((a, b) => Math.abs(b.scoreDelta ?? 0) - Math.abs(a.scoreDelta ?? 0));

  const upgrades   = explanations.filter(e => e.direction === "upgraded");
  const downgrades = explanations.filter(e => e.direction === "downgraded");
  const newEntries = explanations.filter(e => e.direction === "new");

  return { generatedAt, majorMovers, upgrades, downgrades, newEntries, removed: removedExplanations };
}
