/**
 * Opportunity Intelligence Service — Sprint 2.5.0
 *
 * Reusable engine that produces CanonicalOpportunity objects by enriching
 * the existing ranking snapshot with:
 *   - Company metadata (companyName, sector, industry) from market_data_symbols
 *   - Theme memberships from the curated theme registry
 *   - Structured evidence panels from scanner reasons/warnings
 *   - Normalized scores, riskLevel, timeHorizon, opportunityType
 *
 * ARCHITECTURE
 *   - Pure enrichment layer — never duplicates scanning or ranking logic.
 *   - Reads getLatestRanking() (existing in-memory snapshot).
 *   - Single batch DB query for company metadata.
 *   - getAllThemes() for theme membership (no DB call).
 *   - Exported as a service used by routes, Ask AI, and future Portfolio Intelligence.
 *
 * COMPLIANCE
 *   - Never uses "recommendation", "buy", "sell", "target price".
 *   - Returns "research candidates" only.
 */

import { db } from "../db";
import { marketDataSymbols } from "../../shared/schema";
import { inArray } from "drizzle-orm";
import { getLatestRanking } from "./opportunity-ranking-engine";
import { getAllThemes } from "../config/theme-registry";
import type {
  CanonicalOpportunity,
  EvidenceItem,
  EvidenceStrength,
  InvalidatesThesis,
  OpportunityFilterOptions,
  OpportunityIntelligenceMeta,
  OpportunityIntelligenceResult,
  OpportunitySortOptions,
  OpportunityType,
  OppConfidence,
  RiskFactor,
  RiskLevel,
  TimeHorizon,
} from "../../shared/opportunity-intelligence-types";
import { OPPORTUNITY_TYPE_LABELS } from "../../shared/opportunity-intelligence-types";
import type {
  ScoredGrowthCandidate,
  ScoredWatchCandidate,
  OpportunityScore,
} from "./opportunity-ranking-engine";
import type { RankedTradeCandidate } from "../routes/ranked-trade-search";

// ---------------------------------------------------------------------------
// Internal helpers — pure functions
// ---------------------------------------------------------------------------

/** Map riskScore (0-100, higher = riskier) to a RiskLevel label. */
export function mapRiskLevel(riskScore: number): RiskLevel {
  if (riskScore >= 60) return "high";
  if (riskScore >= 35) return "medium";
  return "low";
}

/** Map opportunityCategory + strategy string to OpportunityType. */
export function mapOpportunityType(
  sourceCategory: "topGrowth" | "topIncome" | "watchlist" | "approaching",
  strategy?: string,
): OpportunityType {
  const s = (strategy ?? "").toLowerCase();

  if (s.includes("covered call"))                     return "covered_call";
  if (s.includes("cash secured put") || s.includes("cash-secured put")) return "cash_secured_put";
  if (s.includes("dividend"))                         return "dividend";
  if (s.includes("etf"))                              return "etf";
  if (s.includes("value"))                            return "value";
  if (s.includes("momentum"))                         return "momentum";
  if (s.includes("swing"))                            return "swing";
  if (s.includes("long-term") || s.includes("long term") || s.includes("compounder")) return "long_term_investment";

  if (sourceCategory === "topIncome")                 return "income";
  if (sourceCategory === "watchlist" || sourceCategory === "approaching") return "swing";
  return "growth";
}

/** Map timeHorizon from opportunityType and strategy. */
export function mapTimeHorizon(type: OpportunityType, strategy?: string): TimeHorizon {
  const s = (strategy ?? "").toLowerCase();
  if (type === "swing" || type === "momentum" || type === "covered_call" || type === "cash_secured_put") return "short";
  if (type === "long_term_investment" || s.includes("long") || s.includes("compounder")) return "long";
  return "medium";
}

/** Build a stable deterministic ID for a canonical opportunity. */
export function buildOpportunityId(symbol: string, sourceCategory: string): string {
  return `${symbol.toUpperCase()}-${sourceCategory}`;
}

/**
 * Derive a sentiment score (0-100) as a proxy combining:
 *   - Institutional sentiment (signals from 13F holders)
 *   - Regime score (macro environment positivity)
 * No new data — derived from existing scores.
 */
export function deriveSentimentScore(institutionalScore: number, regimeScore: number): number {
  return Math.round(institutionalScore * 0.65 + regimeScore * 0.35);
}

/** Map scanner confidence string to OppConfidence. */
export function mapConfidence(c: string | undefined): OppConfidence {
  if (c === "high") return "high";
  if (c === "medium") return "medium";
  return "low";
}

/** Convert a strength numeric indicator to EvidenceStrength. */
function strengthFromScore(score: number): EvidenceStrength {
  if (score >= 70) return "strong";
  if (score >= 45) return "moderate";
  return "weak";
}

/**
 * Build primaryEvidence from scanner reasons and institutional/technical signals.
 * Max 4 items.
 */
export function buildPrimaryEvidence(
  reasons: string[],
  whySelected: string[],
  technicalScore: number,
  institutionalScore: number,
): EvidenceItem[] {
  const items: EvidenceItem[] = [];

  // Leading positive reasons from scanner
  const allReasons = [...new Set([...whySelected, ...reasons])].filter(Boolean);
  for (const r of allReasons.slice(0, 3)) {
    items.push({
      type:     "technical",
      label:    "Technical Signal",
      detail:   r,
      strength: strengthFromScore(technicalScore),
    });
  }

  // Institutional signal if meaningful
  if (institutionalScore >= 45) {
    items.push({
      type:     "institutional",
      label:    "Institutional Interest",
      detail:   institutionalScore >= 70
        ? "Strong institutional accumulation signal detected from 13F filings."
        : "Moderate institutional presence observed in recent 13F filings.",
      strength: strengthFromScore(institutionalScore),
    });
  }

  return items.slice(0, 4);
}

/**
 * Build secondaryEvidence from sector/theme context.
 */
export function buildSecondaryEvidence(
  sector: string | null,
  themes: string[],
  fundamentalScore: number,
): EvidenceItem[] {
  const items: EvidenceItem[] = [];

  if (sector) {
    items.push({
      type:     "sector",
      label:    "Sector Context",
      detail:   `Operates in the ${sector} sector.`,
      strength: "moderate",
    });
  }

  for (const theme of themes.slice(0, 2)) {
    items.push({
      type:     "theme",
      label:    "Theme Membership",
      detail:   `Classified as a ${theme} candidate.`,
      strength: "moderate",
    });
  }

  if (fundamentalScore >= 50) {
    items.push({
      type:     "fundamental",
      label:    "Fundamental Health",
      detail:   fundamentalScore >= 70
        ? "Strong fundamental indicators support the research thesis."
        : "Moderate fundamental evidence supports the research thesis.",
      strength: strengthFromScore(fundamentalScore),
    });
  }

  return items.slice(0, 4);
}

/**
 * Build riskFactors from scanner warnings.
 */
export function buildRiskFactors(warnings: string[], riskLevel: RiskLevel): RiskFactor[] {
  const items: RiskFactor[] = [];

  for (const w of warnings.filter(Boolean).slice(0, 3)) {
    items.push({
      label:    "Risk Signal",
      detail:   w,
      severity: riskLevel === "high" ? "high" : riskLevel === "medium" ? "medium" : "low",
    });
  }

  return items;
}

/**
 * Build invalidatesThesis from the scanner's invalidation field.
 */
export function buildInvalidatesThesis(
  invalidation: string | undefined,
  riskFactors: RiskFactor[],
): InvalidatesThesis[] {
  const items: InvalidatesThesis[] = [];

  if (invalidation) {
    items.push({
      condition: "Setup invalidated",
      detail:    invalidation,
    });
  }

  // If high-severity risk factors exist, surface them as potential invalidators
  for (const rf of riskFactors.filter(r => r.severity === "high").slice(0, 2)) {
    items.push({
      condition: rf.label,
      detail:    rf.detail,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Theme lookup map
// ---------------------------------------------------------------------------

/**
 * Build a reverse lookup: symbol → array of theme names.
 * Pure function — no DB calls.
 */
export function buildSymbolThemeMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const themes = getAllThemes();
  for (const theme of themes) {
    for (const sym of theme.symbols) {
      const key = sym.toUpperCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(theme.name);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Assembly — convert a ScoredGrowthCandidate to CanonicalOpportunity
// ---------------------------------------------------------------------------

interface CompanyMeta {
  companyName: string | null;
  sector:      string | null;
  industry:    string | null;
}

function assembleScoredGrowth(
  c:              ScoredGrowthCandidate,
  sourceCategory: "topGrowth" | "topIncome",
  rank:           number,
  meta:           CompanyMeta,
  themes:         string[],
  regime:         string | null,
): CanonicalOpportunity {
  const score  = c.opportunityScore;
  const oppType = mapOpportunityType(sourceCategory, c.strategy);
  const rl      = mapRiskLevel(score.riskScore);
  const th      = mapTimeHorizon(oppType, c.strategy);
  const primary = buildPrimaryEvidence(
    score.reasons ?? [],
    (c as any).whySelected ?? [],
    score.technicalScore,
    score.institutionalScore,
  );
  const secondary = buildSecondaryEvidence(meta.sector, themes, score.fundamentalScore);
  const risks     = buildRiskFactors(score.warnings ?? [], rl);
  const invalidates = buildInvalidatesThesis((c as any).invalidation, risks);

  return {
    id:                  buildOpportunityId(c.symbol, sourceCategory),
    symbol:              c.symbol,
    companyName:         meta.companyName,
    sector:              meta.sector,
    industry:            meta.industry,
    themes,
    opportunityType:     oppType,
    opportunityTypeLabel: OPPORTUNITY_TYPE_LABELS[oppType],
    researchScore:       score.overallScore,
    technicalScore:      score.technicalScore,
    fundamentalScore:    score.fundamentalScore,
    institutionalScore:  score.institutionalScore,
    sentimentScore:      deriveSentimentScore(score.institutionalScore, score.regimeScore),
    confidence:          mapConfidence(score.confidence),
    marketRegime:        regime,
    timeHorizon:         th,
    riskLevel:           rl,
    lastUpdated:         score.lastUpdated,
    primaryEvidence:     primary,
    secondaryEvidence:   secondary,
    riskFactors:         risks,
    invalidatesThesis:   invalidates,
    _sourceCategory:     sourceCategory,
    _rank:               rank,
  };
}

function assembleScoredWatch(
  c:              ScoredWatchCandidate,
  sourceCategory: "watchlist" | "approaching",
  rank:           number,
  meta:           CompanyMeta,
  themes:         string[],
  regime:         string | null,
): CanonicalOpportunity {
  const score   = c.opportunityScore;
  const oppType = mapOpportunityType(sourceCategory, c.strategy);
  const rl      = mapRiskLevel(score.riskScore);
  const th      = mapTimeHorizon(oppType, c.strategy);
  const primary = buildPrimaryEvidence(
    score.reasons ?? [],
    (c as any).watchConditions ?? [],
    score.technicalScore,
    score.institutionalScore,
  );
  const secondary  = buildSecondaryEvidence(meta.sector, themes, score.fundamentalScore);
  const risks      = buildRiskFactors(score.warnings ?? [], rl);
  const invalidates = buildInvalidatesThesis(undefined, risks);

  return {
    id:                  buildOpportunityId(c.symbol, sourceCategory),
    symbol:              c.symbol,
    companyName:         meta.companyName,
    sector:              meta.sector,
    industry:            meta.industry,
    themes,
    opportunityType:     oppType,
    opportunityTypeLabel: OPPORTUNITY_TYPE_LABELS[oppType],
    researchScore:       score.overallScore,
    technicalScore:      score.technicalScore,
    fundamentalScore:    score.fundamentalScore,
    institutionalScore:  score.institutionalScore,
    sentimentScore:      deriveSentimentScore(score.institutionalScore, score.regimeScore),
    confidence:          mapConfidence(score.confidence),
    marketRegime:        regime,
    timeHorizon:         th,
    riskLevel:           rl,
    lastUpdated:         score.lastUpdated,
    primaryEvidence:     primary,
    secondaryEvidence:   secondary,
    riskFactors:         risks,
    invalidatesThesis:   invalidates,
    _sourceCategory:     sourceCategory,
    _rank:               rank,
  };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export function filterOpportunities(
  opps:    CanonicalOpportunity[],
  filters: OpportunityFilterOptions,
): CanonicalOpportunity[] {
  return opps.filter(o => {
    if (filters.sector?.length && (!o.sector || !filters.sector.includes(o.sector)))     return false;
    if (filters.industry?.length && (!o.industry || !filters.industry.includes(o.industry))) return false;
    if (filters.theme?.length && !filters.theme.some(t => o.themes.includes(t)))          return false;
    if (filters.opportunityType?.length && !filters.opportunityType.includes(o.opportunityType)) return false;
    if (filters.riskLevel?.length && !filters.riskLevel.includes(o.riskLevel))             return false;
    if (filters.timeHorizon?.length && !filters.timeHorizon.includes(o.timeHorizon))       return false;
    if (filters.minResearchScore !== undefined && o.researchScore < filters.minResearchScore) return false;
    if (filters.minTechnicalScore !== undefined && o.technicalScore < filters.minTechnicalScore) return false;
    if (filters.minInstitutionalScore !== undefined && o.institutionalScore < filters.minInstitutionalScore) return false;
    if (filters.marketRegime && o.marketRegime !== filters.marketRegime)                    return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export function sortOpportunities(
  opps:    CanonicalOpportunity[],
  sort:    OpportunitySortOptions,
): CanonicalOpportunity[] {
  const sorted = [...opps];
  const { field, direction } = sort;
  const mult = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (field) {
      case "researchScore":      return mult * (a.researchScore - b.researchScore);
      case "technicalScore":     return mult * (a.technicalScore - b.technicalScore);
      case "institutionalScore": return mult * (a.institutionalScore - b.institutionalScore);
      case "symbol":             return mult * a.symbol.localeCompare(b.symbol);
      case "opportunityType":    return mult * a.opportunityType.localeCompare(b.opportunityType);
      case "lastUpdated":        return mult * a.lastUpdated.localeCompare(b.lastUpdated);
      default:                   return 0;
    }
  });

  return sorted;
}

// ---------------------------------------------------------------------------
// Meta extraction
// ---------------------------------------------------------------------------

export function extractMeta(opps: CanonicalOpportunity[]): OpportunityIntelligenceMeta {
  const sectors    = new Set<string>();
  const industries = new Set<string>();
  const themes     = new Set<string>();
  const types      = new Set<OpportunityType>();

  for (const o of opps) {
    if (o.sector)   sectors.add(o.sector);
    if (o.industry) industries.add(o.industry);
    for (const t of o.themes) themes.add(t);
    types.add(o.opportunityType);
  }

  return {
    sectors:          [...sectors].sort(),
    industries:       [...industries].sort(),
    themes:           [...themes].sort(),
    opportunityTypes: [...types].sort() as OpportunityType[],
    riskLevels:       ["low", "medium", "high"],
    timeHorizons:     ["short", "medium", "long"],
  };
}

// ---------------------------------------------------------------------------
// Main engine entry point
// ---------------------------------------------------------------------------

/**
 * getOpportunityIntelligence — primary public API for this service.
 *
 * 1. Reads the latest ranking snapshot (in-memory, no DB).
 * 2. Batch-queries company metadata for all ranked symbols (one DB call).
 * 3. Assembles CanonicalOpportunity for each candidate.
 * 4. Applies filters, sorting.
 * 5. Returns OpportunityIntelligenceResult.
 *
 * Returns null if no ranking snapshot is available yet.
 */
export async function getOpportunityIntelligence(
  filters?: OpportunityFilterOptions,
  sort?:    OpportunitySortOptions,
): Promise<OpportunityIntelligenceResult | null> {
  const ranking = getLatestRanking();
  if (!ranking) return null;

  // 1. Collect all symbols across all ranking buckets
  const allCandidates: Array<{
    c:   ScoredGrowthCandidate | ScoredWatchCandidate;
    cat: "topGrowth" | "topIncome" | "watchlist" | "approaching";
  }> = [
    ...(ranking.topGrowth ?? []).map((c, i)    => ({ c, cat: "topGrowth"   as const })),
    ...(ranking.topIncome ?? []).map((c, i)    => ({ c, cat: "topIncome"   as const })),
    ...(ranking.watchlist ?? []).map((c, i)    => ({ c, cat: "watchlist"   as const })),
    ...(ranking.approaching ?? []).map((c, i)  => ({ c, cat: "approaching" as const })),
  ];

  const symbols = [...new Set(allCandidates.map(x => x.c.symbol.toUpperCase()))];

  // 2. Batch DB lookup for company metadata (single query)
  let metaMap = new Map<string, CompanyMeta>();
  try {
    if (symbols.length > 0) {
      const rows = await db
        .select({
          symbol:      marketDataSymbols.symbol,
          companyName: marketDataSymbols.companyName,
          sector:      marketDataSymbols.sector,
          industry:    marketDataSymbols.industry,
        })
        .from(marketDataSymbols)
        .where(inArray(marketDataSymbols.symbol, symbols));

      for (const r of rows) {
        metaMap.set(r.symbol.toUpperCase(), {
          companyName: r.companyName ?? null,
          sector:      r.sector      ?? null,
          industry:    r.industry    ?? null,
        });
      }
    }
  } catch {
    // Metadata enrichment failure is non-fatal — proceed with nulls
  }

  // 3. Theme membership lookup (pure, no DB)
  const themeMap = buildSymbolThemeMap();

  const emptyMeta: CompanyMeta = { companyName: null, sector: null, industry: null };

  // 4. Assemble canonical opportunities
  const rankCounters: Record<string, number> = {
    topGrowth: 0, topIncome: 0, watchlist: 0, approaching: 0,
  };

  const opportunities: CanonicalOpportunity[] = [];

  for (const { c, cat } of allCandidates) {
    const sym    = c.symbol.toUpperCase();
    const meta   = metaMap.get(sym) ?? emptyMeta;
    const themes = themeMap.get(sym) ?? [];
    rankCounters[cat] += 1;
    const rank = rankCounters[cat];

    if (cat === "topGrowth" || cat === "topIncome") {
      opportunities.push(
        assembleScoredGrowth(c as ScoredGrowthCandidate, cat, rank, meta, themes, ranking.regime),
      );
    } else {
      opportunities.push(
        assembleScoredWatch(c as ScoredWatchCandidate, cat, rank, meta, themes, ranking.regime),
      );
    }
  }

  // 5. Extract meta before filtering
  const fullMeta = extractMeta(opportunities);
  const totalCount = opportunities.length;

  // 6. Apply filters
  const filtered = filters ? filterOpportunities(opportunities, filters) : opportunities;

  // 7. Apply sort (default: researchScore DESC)
  const defaultSort: OpportunitySortOptions = { field: "researchScore", direction: "desc" };
  const sorted = sortOpportunities(filtered, sort ?? defaultSort);

  return {
    generatedAt:   ranking.generatedAt,
    marketRegime:  ranking.regime,
    totalCount,
    filteredCount: sorted.length,
    opportunities: sorted,
    meta:          fullMeta,
  };
}

/**
 * getCanonicalOpportunity — single-symbol lookup.
 *
 * Convenience wrapper for routes that need one opportunity by symbol.
 * Returns null if not in the current ranking snapshot.
 */
export async function getCanonicalOpportunity(symbol: string): Promise<CanonicalOpportunity | null> {
  const result = await getOpportunityIntelligence();
  if (!result) return null;
  return result.opportunities.find(o => o.symbol.toUpperCase() === symbol.toUpperCase()) ?? null;
}

/**
 * getOpportunityIntelligenceHealth — platform health snapshot.
 */
export function getOpportunityIntelligenceHealth(): {
  hasSnapshot:      boolean;
  totalOpportunities: number;
  growthCount:      number;
  incomeCount:      number;
  watchlistCount:   number;
  approachingCount: number;
  lastGeneratedAt:  string | null;
  marketRegime:     string | null;
} {
  const ranking = getLatestRanking();
  if (!ranking) {
    return {
      hasSnapshot:       false,
      totalOpportunities: 0,
      growthCount:       0,
      incomeCount:       0,
      watchlistCount:    0,
      approachingCount:  0,
      lastGeneratedAt:   null,
      marketRegime:      null,
    };
  }
  return {
    hasSnapshot:       true,
    totalOpportunities: (ranking.topGrowth?.length ?? 0)
                      + (ranking.topIncome?.length ?? 0)
                      + (ranking.watchlist?.length ?? 0)
                      + (ranking.approaching?.length ?? 0),
    growthCount:      ranking.topGrowth?.length    ?? 0,
    incomeCount:      ranking.topIncome?.length    ?? 0,
    watchlistCount:   ranking.watchlist?.length    ?? 0,
    approachingCount: ranking.approaching?.length  ?? 0,
    lastGeneratedAt:  ranking.generatedAt,
    marketRegime:     ranking.regime,
  };
}
