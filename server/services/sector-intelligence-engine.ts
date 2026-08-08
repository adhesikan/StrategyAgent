// Sector Intelligence Engine — Sprint 2.3.3
//
// Deterministic aggregation of stock-level opportunity data into sector-level
// research intelligence.
//
// KEY PRINCIPLES:
//   - Pure computation. All DB queries happen OUTSIDE this module.
//   - No LLM. No investment recommendations. No prediction language.
//   - Missing data is explicit — never fabricated.
//   - Score represents strength of CURRENT RESEARCH EVIDENCE, not expected performance.
//   - "Strong" does not mean "buy". "Weak" does not mean "sell".
//
// SECTOR SCORE FORMULA (0-100):
//   Quality     (40%): average opportunity score across ranked members
//   Breadth     (25%): fraction of eligible symbols that are currently ranked
//   Institutional (20%): fraction of symbols with accumulation evidence
//   Momentum    (15%): net strengthening vs weakening, normalized

export type IntelligenceLabel = "Strong" | "Improving" | "Mixed" | "Weakening" | "Weak";

export interface SymbolSectorInfo {
  symbol: string;
  sector: string;
  industry: string | null;
}

export interface RankedSymbolSummary {
  symbol: string;
  overallScore: number;
  technicalScore: number;
  institutionalScore: number;
  fundamentalScore: number;
  riskScore: number;
  confidence: string;
  category: string;
  changeDirection: "upgraded" | "downgraded" | "new" | "moved" | "unchanged" | null;
}

export interface InstitutionalSignalSummary {
  symbol: string;
  label: string;   // "Strong Accumulation" | "Accumulation" | "Stable" | "Distribution" | "Strong Distribution" | "Insufficient Data"
  score: number | null;
}

export interface SectorTopSymbol {
  symbol: string;
  overallScore: number;
  technicalScore: number;
  institutionalScore: number;
  confidence: string;
  category: string;
}

export interface SectorChanges {
  scoreDelta: number | null;
  newLeaders: string[];
  lostLeaders: string[];
  strengtheningSymbols: string[];
  weakeningSymbols: string[];
  summary: string;
}

export interface SectorMetrics {
  sector: string;
  eligibleSymbolCount: number;    // symbols with this sector in classification DB
  rankedSymbolCount: number;
  averageOpportunityScore: number;
  medianOpportunityScore: number;
  topOpportunityScore: number;
  highConfidenceCount: number;
  newOpportunityCount: number;
  upgradedCount: number;
  downgradedCount: number;
  institutionalDataAvailableCount: number;
  institutionalAccumulationCount: number;
  institutionalDistributionCount: number;
  averageInstitutionalScore: number;
  strengtheningCount: number;
  weakeningCount: number;
  industries: string[];
  topSymbols: SectorTopSymbol[];
  technicalCoverage: number;        // fraction 0-1
  institutionalCoverage: number;    // fraction 0-1
}

export interface SectorIntelligence extends SectorMetrics {
  score: number;
  label: IntelligenceLabel;
  changes: SectorChanges;
}

export interface SectorSnapshot {
  generatedAt: string;
  sectors: SectorIntelligence[];
  regime: string | null;
  totalRankedSymbols: number;
}

// ---------------------------------------------------------------------------
// Label mapping
// ---------------------------------------------------------------------------

export function scoreToLabel(score: number): IntelligenceLabel {
  if (score >= 75) return "Strong";
  if (score >= 60) return "Improving";
  if (score >= 40) return "Mixed";
  if (score >= 25) return "Weakening";
  return "Weak";
}

// ---------------------------------------------------------------------------
// Sector score computation (exported for tests)
// ---------------------------------------------------------------------------

export function computeSectorScore(metrics: {
  averageOpportunityScore: number;
  eligibleSymbolCount: number;
  rankedSymbolCount: number;
  institutionalDataAvailableCount: number;
  institutionalAccumulationCount: number;
  strengtheningCount: number;
  weakeningCount: number;
}): number {
  const {
    averageOpportunityScore,
    eligibleSymbolCount,
    rankedSymbolCount,
    institutionalDataAvailableCount,
    institutionalAccumulationCount,
    strengtheningCount,
    weakeningCount,
  } = metrics;

  // Quality: average opportunity score of ranked members (0-100)
  const qualityComponent = (averageOpportunityScore / 100) * 40;

  // Breadth: fraction of eligible symbols that are ranked (0-1 → weight 25)
  const rankedBreadth = eligibleSymbolCount > 0
    ? rankedSymbolCount / eligibleSymbolCount
    : 0;
  const breadthComponent = Math.min(1, rankedBreadth) * 25;

  // Institutional: fraction of tracked symbols with accumulation evidence (0-1 → weight 20)
  const accumBreadth = institutionalDataAvailableCount > 0
    ? institutionalAccumulationCount / institutionalDataAvailableCount
    : 0;
  const instComponent = Math.min(1, accumBreadth) * 20;

  // Momentum: net strengthening/weakening among ranked symbols (0-1 → weight 15)
  // Net positive → high; net negative → low; neutral → 0.5
  // When no ranked symbols: no momentum evidence, contribute 0.
  let momentumComponent = 0;
  if (rankedSymbolCount > 0) {
    const netMomentum = (strengtheningCount - weakeningCount) / rankedSymbolCount;
    const momentumFactor = Math.min(1, Math.max(0, (netMomentum + 1) / 2));
    momentumComponent = momentumFactor * 15;
  }

  return Math.round(qualityComponent + breadthComponent + instComponent + momentumComponent);
}

// ---------------------------------------------------------------------------
// Median computation (exported for tests)
// ---------------------------------------------------------------------------

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

// ---------------------------------------------------------------------------
// Change detection (exported for tests)
// ---------------------------------------------------------------------------

export function detectSectorChanges(
  sectorName: string,
  currentScore: number,
  currentLabel: IntelligenceLabel,
  currentTopSymbols: string[],
  currentStrengthening: string[],
  currentWeakening: string[],
  prevSnapshot: {
    score: number;
    topSymbols: string[];
    strengtheningSymbols: string[];
  } | null,
): SectorChanges {
  if (!prevSnapshot) {
    return {
      scoreDelta:          null,
      newLeaders:          [],
      lostLeaders:         [],
      strengtheningSymbols: currentStrengthening,
      weakeningSymbols:    currentWeakening,
      summary:             `${sectorName} — first intelligence snapshot.`,
    };
  }

  const scoreDelta = currentScore - prevSnapshot.score;
  const prevTopSet = new Set(prevSnapshot.topSymbols.slice(0, 5));
  const currTopSet = new Set(currentTopSymbols.slice(0, 5));

  const newLeaders  = currentTopSymbols.slice(0, 5).filter(s => !prevTopSet.has(s));
  const lostLeaders = prevSnapshot.topSymbols.slice(0, 5).filter(s => !currTopSet.has(s));

  const summary = buildSectorChangeSummary(
    sectorName,
    scoreDelta,
    currentLabel,
    newLeaders,
    lostLeaders,
    currentStrengthening.length,
    currentWeakening.length,
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

export function buildSectorChangeSummary(
  sectorName: string,
  scoreDelta: number | null,
  label: IntelligenceLabel,
  newLeaders: string[],
  lostLeaders: string[],
  strengtheningCount: number,
  weakeningCount: number,
): string {
  const parts: string[] = [];

  if (scoreDelta != null) {
    if (scoreDelta >= 8) {
      parts.push(`${sectorName} strengthened`);
    } else if (scoreDelta <= -8) {
      parts.push(`${sectorName} weakened`);
    } else {
      parts.push(`${sectorName} remains ${label.toLowerCase()}`);
    }
  } else {
    parts.push(`${sectorName} is ${label.toLowerCase()}`);
  }

  const details: string[] = [];
  if (strengtheningCount > 0) {
    details.push(`${strengtheningCount} member${strengtheningCount !== 1 ? "s" : ""} with improving evidence`);
  }
  if (newLeaders.length > 0) {
    details.push(`${newLeaders.join(", ")} entered top positions`);
  }
  if (lostLeaders.length > 0) {
    details.push(`${lostLeaders.join(", ")} left top positions`);
  }
  if (weakeningCount > 0) {
    details.push(`${weakeningCount} member${weakeningCount !== 1 ? "s" : ""} with declining evidence`);
  }

  if (details.length > 0) {
    return parts.join("") + " — " + details.join(", ") + ".";
  }
  return parts.join("") + ".";
}

// ---------------------------------------------------------------------------
// Core aggregation — pure function (exported for tests)
// ---------------------------------------------------------------------------

export function aggregateSector(
  sector: string,
  allEligibleSymbols: string[],         // symbols with this sector in the classification DB
  rankedSymbols: RankedSymbolSummary[],  // ranked members only
  institutionalSignals: Map<string, InstitutionalSignalSummary>,
  allIndustries: string[],
  prevSnapshot: {
    score: number;
    topSymbols: string[];
    strengtheningSymbols: string[];
  } | null,
): SectorIntelligence {
  const ranked = rankedSymbols;
  const scores = ranked.map(r => r.overallScore);
  const avgScore = scores.length > 0
    ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)
    : 0;

  // Institutional evidence
  let instDataCount = 0;
  let instAccumCount = 0;
  let instDistCount = 0;
  let instScoreSum = 0;
  let instScoreCount = 0;

  for (const sym of allEligibleSymbols) {
    const sig = institutionalSignals.get(sym);
    if (!sig) continue;
    instDataCount++;
    if (sig.score !== null) {
      instScoreSum += sig.score;
      instScoreCount++;
    }
    if (sig.label === "Strong Accumulation" || sig.label === "Accumulation") instAccumCount++;
    if (sig.label === "Distribution" || sig.label === "Strong Distribution") instDistCount++;
  }

  const avgInstScore = instScoreCount > 0
    ? Math.round(instScoreSum / instScoreCount)
    : 0;

  // Momentum
  const strengtheningSymbols = ranked
    .filter(r => r.changeDirection === "upgraded" || r.changeDirection === "new")
    .map(r => r.symbol);
  const weakeningSymbols = ranked
    .filter(r => r.changeDirection === "downgraded")
    .map(r => r.symbol);

  // Change bucket counts
  const newCount       = ranked.filter(r => r.changeDirection === "new").length;
  const upgradedCount  = ranked.filter(r => r.changeDirection === "upgraded").length;
  const downgradedCount = ranked.filter(r => r.changeDirection === "downgraded").length;
  const highConfCount  = ranked.filter(r => r.confidence === "high").length;

  // Top symbols (top 10 by overallScore)
  const topSymbols: SectorTopSymbol[] = [...ranked]
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

  // Coverage
  const technicalCoverage = allEligibleSymbols.length > 0
    ? ranked.length / allEligibleSymbols.length
    : 0;
  const institutionalCoverage = allEligibleSymbols.length > 0
    ? instDataCount / allEligibleSymbols.length
    : 0;

  const metrics: SectorMetrics = {
    sector,
    eligibleSymbolCount:        allEligibleSymbols.length,
    rankedSymbolCount:          ranked.length,
    averageOpportunityScore:    avgScore,
    medianOpportunityScore:     computeMedian(scores),
    topOpportunityScore:        scores.length > 0 ? Math.max(...scores) : 0,
    highConfidenceCount:        highConfCount,
    newOpportunityCount:        newCount,
    upgradedCount,
    downgradedCount,
    institutionalDataAvailableCount: instDataCount,
    institutionalAccumulationCount:  instAccumCount,
    institutionalDistributionCount:  instDistCount,
    averageInstitutionalScore:   avgInstScore,
    strengtheningCount:          strengtheningSymbols.length,
    weakeningCount:              weakeningSymbols.length,
    industries:                  Array.from(new Set(allIndustries)).filter(Boolean).sort(),
    topSymbols,
    technicalCoverage,
    institutionalCoverage,
  };

  const score = computeSectorScore({
    averageOpportunityScore:     avgScore,
    eligibleSymbolCount:         allEligibleSymbols.length,
    rankedSymbolCount:           ranked.length,
    institutionalDataAvailableCount: instDataCount,
    institutionalAccumulationCount:  instAccumCount,
    strengtheningCount:          strengtheningSymbols.length,
    weakeningCount:              weakeningSymbols.length,
  });
  const label = scoreToLabel(score);

  const changes = detectSectorChanges(
    sector,
    score,
    label,
    topSymbols.map(s => s.symbol),
    strengtheningSymbols,
    weakeningSymbols,
    prevSnapshot,
  );

  return { ...metrics, score, label, changes };
}

// ---------------------------------------------------------------------------
// Full sector snapshot computation
// ---------------------------------------------------------------------------

export interface SectorAggregationInput {
  rankedSymbols:          RankedSymbolSummary[];
  symbolSectors:          SymbolSectorInfo[];           // all symbols with sector data
  institutionalSignals:   InstitutionalSignalSummary[];
  prevSectorSnapshot:     Map<string, { score: number; topSymbols: string[]; strengtheningSymbols: string[] }>;
  regime:                 string | null;
  generatedAt:            string;
}

export function computeSectorSnapshot(input: SectorAggregationInput): SectorSnapshot {
  const {
    rankedSymbols,
    symbolSectors,
    institutionalSignals,
    prevSectorSnapshot,
    regime,
    generatedAt,
  } = input;

  // Index ranked symbols by symbol name
  const rankedMap = new Map<string, RankedSymbolSummary>(
    rankedSymbols.map(r => [r.symbol, r]),
  );

  // Index institutional signals
  const instMap = new Map<string, InstitutionalSignalSummary>(
    institutionalSignals.map(s => [s.symbol, s]),
  );

  // Group symbols by sector
  const sectorGroups = new Map<string, { symbols: string[]; industries: string[] }>();
  for (const info of symbolSectors) {
    if (!info.sector) continue;
    if (!sectorGroups.has(info.sector)) {
      sectorGroups.set(info.sector, { symbols: [], industries: [] });
    }
    const group = sectorGroups.get(info.sector)!;
    group.symbols.push(info.symbol);
    if (info.industry) group.industries.push(info.industry);
  }

  // Also add ranked symbols that might not be in the symbols table
  for (const r of rankedSymbols) {
    const info = symbolSectors.find(s => s.symbol === r.symbol);
    if (!info?.sector) continue; // skip unclassified ranked symbols from sector grouping
  }

  // Compute intelligence for each sector
  const sectors: SectorIntelligence[] = [];

  for (const [sector, group] of Array.from(sectorGroups.entries())) {
    const rankedInSector = group.symbols
      .map(sym => rankedMap.get(sym))
      .filter((r): r is RankedSymbolSummary => r !== undefined);

    // Only include sectors with at least one eligible symbol
    if (group.symbols.length === 0) continue;

    const prev = prevSectorSnapshot.get(sector) ?? null;
    const intel = aggregateSector(
      sector,
      group.symbols,
      rankedInSector,
      instMap,
      group.industries,
      prev,
    );
    sectors.push(intel);
  }

  // Sort by score descending
  sectors.sort((a, b) => b.score - a.score);

  return {
    generatedAt,
    sectors,
    regime,
    totalRankedSymbols: rankedSymbols.length,
  };
}
