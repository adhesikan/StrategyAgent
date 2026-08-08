// Theme Intelligence Engine — Sprint 2.3.3
//
// Deterministic aggregation of stock-level opportunity data into theme-level
// research intelligence.
//
// KEY PRINCIPLES:
//   - Pure computation. All DB queries happen OUTSIDE this module.
//   - No LLM. No investment recommendations. No prediction language.
//   - Theme membership comes from the curated theme registry only.
//   - Missing institutional data does NOT penalize a theme.
//   - "Strong" does not mean "buy". Scores represent research evidence breadth.
//
// THEME SCORE FORMULA (0-100):
//   Quality     (35%): average opportunity score of ranked members
//   Technical   (25%): breadth of members with strong technical evidence
//   Institutional (20%): breadth of members with accumulation evidence
//   Opportunity (20%): fraction of theme members that are currently ranked

import {
  type IntelligenceLabel,
  type RankedSymbolSummary,
  type InstitutionalSignalSummary,
  type SectorTopSymbol,
  scoreToLabel,
  computeMedian,
} from "./sector-intelligence-engine";

import { type ThemeDefinition } from "../config/theme-registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThemeBreadth {
  technicalBreadth: number;        // 0-100: % of ranked members with technicalScore >= threshold
  technicalNumerator: number;
  technicalDenominator: number;

  institutionalBreadth: number;    // 0-100: % of data-available members with accumulation
  institutionalNumerator: number;
  institutionalDenominator: number;

  opportunityBreadth: number;      // 0-100: % of theme members currently ranked
  opportunityNumerator: number;
  opportunityDenominator: number;
}

export interface ThemeChanges {
  scoreDelta: number | null;
  newLeaders: string[];
  lostLeaders: string[];
  strengtheningSymbols: string[];
  weakeningSymbols: string[];
  summary: string;
}

export interface ThemeIntelligence {
  themeId: string;
  themeName: string;
  description: string;
  score: number;
  label: IntelligenceLabel;
  memberCount: number;
  rankedMemberCount: number;
  averageOpportunityScore: number;
  medianOpportunityScore: number;
  topOpportunityScore: number;
  breadth: ThemeBreadth;
  highConfidenceCount: number;
  newOpportunityCount: number;
  upgradedCount: number;
  downgradedCount: number;
  strengtheningCount: number;
  weakeningCount: number;
  institutionalDataAvailableCount: number;
  institutionalAccumulationCount: number;
  institutionalDistributionCount: number;
  topSymbols: SectorTopSymbol[];
  allMembers: ThemeMemberEntry[];
  changes: ThemeChanges;
  dataQuality: {
    technicalCoverage: number;
    institutionalCoverage: number;
    classificationCoverage: number;
    confidence: "high" | "moderate" | "limited";
  };
}

export interface ThemeMemberEntry {
  symbol: string;
  overallScore: number | null;
  technicalScore: number | null;
  institutionalScore: number | null;
  confidence: string | null;
  category: string | null;
  isRanked: boolean;
  changeDirection: string | null;
}

export interface ThemeSnapshot {
  generatedAt: string;
  themes: ThemeIntelligence[];
  regime: string | null;
}

// ---------------------------------------------------------------------------
// Theme score computation (exported for tests)
// ---------------------------------------------------------------------------

const TECHNICAL_BREADTH_THRESHOLD = 65;  // technicalScore >= 65 counts as "strong"

export function computeThemeScore(
  averageOpportunityScore: number,
  technicalBreadth: number,
  institutionalBreadth: number,
  opportunityBreadth: number,
): number {
  // All breadth values are 0-100 percentages
  const qualityComponent       = (averageOpportunityScore / 100) * 35;
  const technicalComponent     = (technicalBreadth / 100) * 25;
  const institutionalComponent = (institutionalBreadth / 100) * 20;
  const opportunityComponent   = (opportunityBreadth / 100) * 20;

  return Math.round(qualityComponent + technicalComponent + institutionalComponent + opportunityComponent);
}

// ---------------------------------------------------------------------------
// Breadth computation (exported for tests)
// ---------------------------------------------------------------------------

export function computeThemeBreadth(
  members: string[],
  rankedMembers: RankedSymbolSummary[],
  institutionalSignals: Map<string, InstitutionalSignalSummary>,
): ThemeBreadth {
  const rankedSet = new Set(rankedMembers.map(r => r.symbol));

  // Technical breadth
  const techEligible = rankedMembers.length;
  const techAbove = rankedMembers.filter(
    r => r.technicalScore >= TECHNICAL_BREADTH_THRESHOLD,
  ).length;
  const technicalBreadth = techEligible > 0
    ? Math.round((techAbove / techEligible) * 100)
    : 0;

  // Institutional breadth
  const instMembers = members.filter(sym => institutionalSignals.has(sym));
  const instAccum = instMembers.filter(sym => {
    const sig = institutionalSignals.get(sym);
    return sig?.label === "Strong Accumulation" || sig?.label === "Accumulation";
  }).length;
  const institutionalBreadth = instMembers.length > 0
    ? Math.round((instAccum / instMembers.length) * 100)
    : 0;

  // Opportunity breadth
  const oppBreadth = members.length > 0
    ? Math.round((rankedMembers.length / members.length) * 100)
    : 0;

  return {
    technicalBreadth,
    technicalNumerator:      techAbove,
    technicalDenominator:    techEligible,
    institutionalBreadth,
    institutionalNumerator:  instAccum,
    institutionalDenominator: instMembers.length,
    opportunityBreadth:      oppBreadth,
    opportunityNumerator:    rankedMembers.length,
    opportunityDenominator:  members.length,
  };
}

// ---------------------------------------------------------------------------
// Change detection (exported for tests)
// ---------------------------------------------------------------------------

export function detectThemeChanges(
  themeName: string,
  currentScore: number,
  currentLabel: IntelligenceLabel,
  currentTopSymbols: string[],
  currentStrengthening: string[],
  currentWeakening: string[],
  prevSnapshot: {
    score: number;
    topSymbols: string[];
  } | null,
): ThemeChanges {
  if (!prevSnapshot) {
    return {
      scoreDelta:           null,
      newLeaders:           [],
      lostLeaders:          [],
      strengtheningSymbols: currentStrengthening,
      weakeningSymbols:     currentWeakening,
      summary:              `${themeName} — first intelligence snapshot.`,
    };
  }

  const scoreDelta = currentScore - prevSnapshot.score;
  const prevTopSet = new Set(prevSnapshot.topSymbols.slice(0, 5));
  const currTopSet = new Set(currentTopSymbols.slice(0, 5));

  const newLeaders  = currentTopSymbols.slice(0, 5).filter(s => !prevTopSet.has(s));
  const lostLeaders = prevSnapshot.topSymbols.slice(0, 5).filter(s => !currTopSet.has(s));

  const summary = buildThemeChangeSummary(
    themeName,
    scoreDelta,
    currentLabel,
    currentStrengthening.length,
    currentWeakening.length,
    newLeaders,
    lostLeaders,
  );

  return {
    scoreDelta,
    newLeaders,
    lostLeaders,
    strengtheningSymbols: currentStrengthening,
    weakeningSymbols:     currentWeakening,
    summary,
  };
}

export function buildThemeChangeSummary(
  themeName: string,
  scoreDelta: number | null,
  label: IntelligenceLabel,
  strengtheningCount: number,
  weakeningCount: number,
  newLeaders: string[],
  lostLeaders: string[],
): string {
  const parts: string[] = [];

  if (scoreDelta != null) {
    if (scoreDelta >= 8) {
      parts.push(`${themeName} strengthened`);
    } else if (scoreDelta <= -8) {
      parts.push(`${themeName} weakened`);
    } else {
      parts.push(`${themeName} remains ${label.toLowerCase()}`);
    }
  } else {
    parts.push(`${themeName} is ${label.toLowerCase()}`);
  }

  const details: string[] = [];
  if (strengtheningCount > 0) {
    details.push(`${strengtheningCount} member${strengtheningCount !== 1 ? "s" : ""} improved`);
  }
  if (newLeaders.length > 0) {
    details.push(`${newLeaders.join(", ")} entered top positions`);
  }
  if (lostLeaders.length > 0) {
    details.push(`${lostLeaders.join(", ")} left top positions`);
  }
  if (weakeningCount > 0) {
    details.push(`${weakeningCount} member${weakeningCount !== 1 ? "s" : ""} declined`);
  }

  if (details.length > 0) {
    return parts.join("") + " — " + details.join(", ") + ".";
  }
  return parts.join("") + ".";
}

// ---------------------------------------------------------------------------
// Data quality / confidence
// ---------------------------------------------------------------------------

export function computeThemeDataQuality(
  memberCount: number,
  rankedMemberCount: number,
  institutionalDenominator: number,
): {
  technicalCoverage: number;
  institutionalCoverage: number;
  classificationCoverage: number;
  confidence: "high" | "moderate" | "limited";
} {
  const techCoverage  = memberCount > 0 ? rankedMemberCount / memberCount : 0;
  const instCoverage  = memberCount > 0 ? institutionalDenominator / memberCount : 0;
  const classCoverage = 1; // curated membership = 100% classified

  let confidence: "high" | "moderate" | "limited";
  if (rankedMemberCount >= 5 && techCoverage >= 0.4) {
    confidence = "high";
  } else if (rankedMemberCount >= 2 || techCoverage >= 0.2) {
    confidence = "moderate";
  } else {
    confidence = "limited";
  }

  return {
    technicalCoverage:   Math.round(techCoverage * 100) / 100,
    institutionalCoverage: Math.round(instCoverage * 100) / 100,
    classificationCoverage: classCoverage,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Core aggregation — pure function (exported for tests)
// ---------------------------------------------------------------------------

export function aggregateTheme(
  theme: ThemeDefinition,
  rankedSymbols: Map<string, RankedSymbolSummary>,
  institutionalSignals: Map<string, InstitutionalSignalSummary>,
  prevSnapshot: { score: number; topSymbols: string[] } | null,
): ThemeIntelligence {
  const members        = theme.symbols;
  const rankedMembers  = members
    .map(sym => rankedSymbols.get(sym))
    .filter((r): r is RankedSymbolSummary => r !== undefined);

  const scores = rankedMembers.map(r => r.overallScore);
  const avgScore = scores.length > 0
    ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)
    : 0;

  const breadth = computeThemeBreadth(members, rankedMembers, institutionalSignals);

  const score = computeThemeScore(
    avgScore,
    breadth.technicalBreadth,
    breadth.institutionalBreadth,
    breadth.opportunityBreadth,
  );
  const label = scoreToLabel(score);

  // Institutional counts (across ALL members, not just ranked)
  let instDataCount   = 0;
  let instAccumCount  = 0;
  let instDistCount   = 0;

  for (const sym of members) {
    const sig = institutionalSignals.get(sym);
    if (!sig) continue;
    instDataCount++;
    if (sig.label === "Strong Accumulation" || sig.label === "Accumulation") instAccumCount++;
    if (sig.label === "Distribution" || sig.label === "Strong Distribution") instDistCount++;
  }

  // Change buckets
  const strengtheningSymbols = rankedMembers
    .filter(r => r.changeDirection === "upgraded" || r.changeDirection === "new")
    .map(r => r.symbol);
  const weakeningSymbols = rankedMembers
    .filter(r => r.changeDirection === "downgraded")
    .map(r => r.symbol);

  const newCount       = rankedMembers.filter(r => r.changeDirection === "new").length;
  const upgradedCount  = rankedMembers.filter(r => r.changeDirection === "upgraded").length;
  const downgradedCount = rankedMembers.filter(r => r.changeDirection === "downgraded").length;
  const highConfCount  = rankedMembers.filter(r => r.confidence === "high").length;

  // Top symbols
  const topSymbols: SectorTopSymbol[] = [...rankedMembers]
    .sort((a, b) => b.overallScore - a.overallScore)
    .slice(0, 10)
    .map(r => ({
      symbol:           r.symbol,
      overallScore:     r.overallScore,
      technicalScore:   r.technicalScore,
      institutionalScore: r.institutionalScore,
      confidence:       r.confidence,
      category:         r.category,
    }));

  // All members (ranked + unranked)
  const allMembers: ThemeMemberEntry[] = members.map(sym => {
    const ranked = rankedSymbols.get(sym);
    return {
      symbol:            sym,
      overallScore:      ranked?.overallScore ?? null,
      technicalScore:    ranked?.technicalScore ?? null,
      institutionalScore: ranked?.institutionalScore ?? null,
      confidence:        ranked?.confidence ?? null,
      category:          ranked?.category ?? null,
      isRanked:          ranked !== undefined,
      changeDirection:   ranked?.changeDirection ?? null,
    };
  }).sort((a, b) => (b.overallScore ?? -1) - (a.overallScore ?? -1));

  const changes = detectThemeChanges(
    theme.name,
    score,
    label,
    topSymbols.map(s => s.symbol),
    strengtheningSymbols,
    weakeningSymbols,
    prevSnapshot,
  );

  const dataQuality = computeThemeDataQuality(
    members.length,
    rankedMembers.length,
    breadth.institutionalDenominator,
  );

  return {
    themeId:      theme.themeId,
    themeName:    theme.name,
    description:  theme.description,
    score,
    label,
    memberCount:  members.length,
    rankedMemberCount: rankedMembers.length,
    averageOpportunityScore:    avgScore,
    medianOpportunityScore:     computeMedian(scores),
    topOpportunityScore:        scores.length > 0 ? Math.max(...scores) : 0,
    breadth,
    highConfidenceCount:        highConfCount,
    newOpportunityCount:        newCount,
    upgradedCount,
    downgradedCount,
    strengtheningCount:         strengtheningSymbols.length,
    weakeningCount:             weakeningSymbols.length,
    institutionalDataAvailableCount: instDataCount,
    institutionalAccumulationCount:  instAccumCount,
    institutionalDistributionCount:  instDistCount,
    topSymbols,
    allMembers,
    changes,
    dataQuality,
  };
}

// ---------------------------------------------------------------------------
// Full theme snapshot computation
// ---------------------------------------------------------------------------

export interface ThemeAggregationInput {
  themes:               ThemeDefinition[];
  rankedSymbols:        RankedSymbolSummary[];
  institutionalSignals: InstitutionalSignalSummary[];
  prevThemeSnapshot:    Map<string, { score: number; topSymbols: string[] }>;
  regime:               string | null;
  generatedAt:          string;
}

export function computeThemeSnapshot(input: ThemeAggregationInput): ThemeSnapshot {
  const {
    themes,
    rankedSymbols,
    institutionalSignals,
    prevThemeSnapshot,
    regime,
    generatedAt,
  } = input;

  const rankedMap = new Map<string, RankedSymbolSummary>(
    rankedSymbols.map(r => [r.symbol, r]),
  );
  const instMap = new Map<string, InstitutionalSignalSummary>(
    institutionalSignals.map(s => [s.symbol, s]),
  );

  const themeResults: ThemeIntelligence[] = [];

  for (const theme of themes) {
    if (!theme.active) continue;
    const prev = prevThemeSnapshot.get(theme.themeId) ?? null;
    const intel = aggregateTheme(theme, rankedMap, instMap, prev);
    themeResults.push(intel);
  }

  // Sort by score descending
  themeResults.sort((a, b) => b.score - a.score);

  return { generatedAt, themes: themeResults, regime };
}
