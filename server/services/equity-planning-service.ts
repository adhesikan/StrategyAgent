/**
 * Equity Trade Planning Engine — Sprint 2.7.1
 *
 * Converts TradePlanningContext + planning constraints + reference price
 * into an EquityPlanningScenario.
 *
 * ARCHITECTURE CONTRACT:
 *   Consumes authoritative TradePlanningContext — never raw scanner results.
 *   Does NOT:
 *     - Re-score or re-rank opportunities
 *     - Create new qualification logic
 *     - Select strikes, expirations, or contracts (Sprint 2.7.2+)
 *     - Construct or submit broker orders
 *     - Fabricate technical price levels
 *     - Perform suitability assessments
 *
 * SERVER AUTHORITATIVE:
 *   Client may not inject referencePrice, support, resistance, pivot,
 *   invalidation price, qualification, or research scores.
 *   Server reconstructs all authoritative context.
 *
 * DATA FRESHNESS:
 *   Reference price sourced from stored daily bars (getReferenceSnapshot).
 *   If bars > 3 trading days old → STALE INPUT WARNING.
 *   No real-time quote is fetched by default (zero provider credits).
 */

import { randomUUID } from "crypto";
import { getReferenceSnapshot } from "./daily-market-data/reference-snapshot";
import { buildTradePlanningContext } from "./trade-planning-service";
import { db } from "../db";
import { tradePlanningSessions } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import type { TradePlanningContext, TradePlanningConstraints } from "../../shared/trade-planning-types";
import { constraintsFingerprint } from "../../shared/trade-planning-types";
import type {
  EquityPlanningScenario,
  EquityPlanningInput,
  EntryFramework,
  EntryConditionType,
  InvalidationFramework,
  SizingFramework,
  ScenarioGrid,
  ScenarioPoint,
  MonitoringPlan,
  MonitoringItem,
  CapitalContext,
  EquityResearchEvidence,
  EquityPlanningFreshness,
  EquityFreshnessItem,
  FreshnessStatus,
  ReferenceLevel,
  EquityPlanningHealthMetrics,
} from "../../shared/equity-planning-types";
import {
  EQUITY_PLANNING_DISCLAIMER,
  SIZING_DISCLAIMER,
  SCENARIO_DISCLAIMER,
  MONITORING_DISCLAIMER,
  DEFAULT_SCENARIO_PERCENTAGES,
  EQUITY_METHODOLOGY_VERSION,
} from "../../shared/equity-planning-types";

// ===========================================================================
// Health metrics (in-memory; resets on restart)
// ===========================================================================

let _equityHealth: EquityPlanningHealthMetrics = {
  equityScenariosGenerated:       0,
  partialEquityScenarios:         0,
  failedEquityScenarios:          0,
  averageEquityScenarioLatencyMs: null,
  lastSuccessfulEquityScenarioAt: null,
};
let _latSum = 0;
let _latCount = 0;

export function getEquityPlanningHealth(): EquityPlanningHealthMetrics {
  return { ..._equityHealth };
}

function _recordSuccess(durationMs: number, partial: boolean): void {
  _equityHealth.equityScenariosGenerated++;
  if (partial) _equityHealth.partialEquityScenarios++;
  _latSum += durationMs;
  _latCount++;
  _equityHealth.averageEquityScenarioLatencyMs = Math.round(_latSum / _latCount);
  _equityHealth.lastSuccessfulEquityScenarioAt = new Date().toISOString();
}
function _recordFailed(): void {
  _equityHealth.failedEquityScenarios++;
}

// ===========================================================================
// Freshness helpers
// ===========================================================================

function ageLabel(isoOrNull: string | null): string {
  if (!isoOrNull) return "Unknown";
  const diffMs = Date.now() - new Date(isoOrNull).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 2)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function freshnessStatus(isoOrNull: string | null): FreshnessStatus {
  if (!isoOrNull) return "unavailable";
  const diffDays = (Date.now() - new Date(isoOrNull).getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 1)  return "fresh";
  if (diffDays < 3)  return "aging";
  return "stale";
}

function makeFreshnessItem(label: string, isoOrNull: string | null): EquityFreshnessItem {
  const status = freshnessStatus(isoOrNull);
  return { label, status, asOf: isoOrNull, ageLabel: ageLabel(isoOrNull) };
}

// ===========================================================================
// Entry Framework builder
// ===========================================================================

function buildEntryFramework(
  ctx: TradePlanningContext,
  referencePrice: number | null,
  ema9: number | null,
  ema21: number | null,
  ema50: number | null,
): EntryFramework {
  const limitations: string[] = [];
  const referenceLevels: ReferenceLevel[] = [];

  // Collect EMA reference levels (from stored technical bars — canonical)
  if (ema9 !== null && ema9 > 0) {
    referenceLevels.push({
      type: "moving_average", label: "EMA 9", price: +ema9.toFixed(2),
      source: "Stored daily bars", description: "9-day exponential moving average",
    });
  }
  if (ema21 !== null && ema21 > 0) {
    referenceLevels.push({
      type: "moving_average", label: "EMA 21", price: +ema21.toFixed(2),
      source: "Stored daily bars", description: "21-day exponential moving average",
    });
  }
  if (ema50 !== null && ema50 > 0) {
    referenceLevels.push({
      type: "moving_average", label: "EMA 50", price: +ema50.toFixed(2),
      source: "Stored daily bars", description: "50-day exponential moving average",
    });
  }

  if (!referencePrice) {
    return {
      available: false,
      conditionType: null,
      referencePrice: null,
      entryZones: [],
      requiredEvidence: [],
      invalidIf: [],
      referenceLevels,
      notes: [],
      unavailableReason: "No reference price available — stored bars not found for this symbol.",
    };
  }

  if (referenceLevels.length === 0) {
    return {
      available: false,
      conditionType: null,
      referencePrice,
      entryZones: [],
      requiredEvidence: [],
      invalidIf: [],
      referenceLevels: [],
      notes: [],
      unavailableReason: "No canonical technical levels available from stored data.",
    };
  }

  // Determine entry condition type from research context
  const oType = ctx.opportunityType?.toLowerCase() ?? "";
  let conditionType: EntryConditionType = "CURRENT_STRUCTURE";
  if (oType.includes("breakout") || oType.includes("momentum")) conditionType = "BREAKOUT_CONFIRMATION";
  else if (oType.includes("pullback") || oType.includes("vcp")) conditionType = "BREAKOUT_CONFIRMATION";
  else if (oType.includes("reclaim")) conditionType = "RECLAIM";
  else if (oType.includes("trend")) conditionType = "TREND_CONTINUATION";

  // Build research entry zones from EMA levels below reference price
  const entryZones = [];
  const belowEmas = referenceLevels
    .filter(l => l.type === "moving_average" && l.price < referencePrice)
    .sort((a, b) => b.price - a.price);

  if (belowEmas.length >= 1) {
    const nearMA = belowEmas[0];
    const zoneLow = +(nearMA.price * 0.98).toFixed(2);
    const zoneHigh = +(nearMA.price * 1.02).toFixed(2);
    entryZones.push({
      label:       "Research Scenario Entry Zone",
      priceLow:    zoneLow,
      priceHigh:   zoneHigh,
      reason:      `Near ${nearMA.label} (${nearMA.price.toFixed(2)}) — within current technical structure`,
      sourceLevel: nearMA.type,
    });
  }

  // Required evidence from research context
  const requiredEvidence: string[] = [];
  if (ctx.primaryEvidence.length > 0) {
    ctx.primaryEvidence.slice(0, 3).forEach(e => {
      requiredEvidence.push(`${e.label} continues to hold`);
    });
  } else {
    requiredEvidence.push("Technical structure remains intact");
    requiredEvidence.push("Volume supports price action");
  }

  // InvalidIf from research thesis invalidation
  const invalidIf = ctx.invalidatesThesis.slice(0, 4).map(inv =>
    inv.condition + (inv.detail ? ` (${inv.detail})` : "")
  );
  if (invalidIf.length === 0) {
    invalidIf.push("Technical structure breaks down");
    invalidIf.push("Research thesis evidence deteriorates");
  }

  const notes: string[] = [];
  if (entryZones.length === 0) {
    notes.push("No validated support level found in stored data — entry zones unavailable.");
    limitations.push("Entry zones could not be computed from available stored technical data.");
  }
  notes.push("These are research entry zones, not buy instructions.");

  return {
    available:       referenceLevels.length > 0,
    conditionType,
    referencePrice,
    entryZones,
    requiredEvidence,
    invalidIf,
    referenceLevels,
    notes,
  };
}

// ===========================================================================
// Invalidation Framework builder
// ===========================================================================

function buildInvalidationFramework(
  ctx: TradePlanningContext,
  referenceLevels: ReferenceLevel[],
): InvalidationFramework {
  // Canonical invalidation from research
  const conditions = [
    ...ctx.invalidatesThesis.map(inv => ({
      condition:     inv.condition,
      detail:        inv.detail ?? null,
      severity:      "high" as const,
      evidenceSource: "Canonical research thesis",
    })),
    ...ctx.riskFactors.slice(0, 3).map(rf => ({
      condition:     rf.label,
      detail:        rf.detail ?? null,
      severity:      (rf.severity as "high" | "medium" | "low") ?? "medium",
      evidenceSource: "Observed research risk factors",
    })),
  ];

  if (conditions.length === 0) {
    conditions.push({
      condition:     "Research thesis evidence deteriorates",
      detail:        "Monitor primary and secondary evidence for weakening",
      severity:      "medium" as const,
      evidenceSource: "General research principle",
    });
    conditions.push({
      condition:     "Technical structure breaks below key reference levels",
      detail:        "Monitor EMA levels from stored data",
      severity:      "high" as const,
      evidenceSource: "Technical reference levels",
    });
  }

  const invalidationLevels = referenceLevels.filter(l =>
    l.type === "invalidation" || l.type === "support" || l.type === "moving_average"
  );

  return {
    conditions,
    referenceLevels: invalidationLevels,
    evidenceSources: ["Canonical research thesis", "Observed risk factors", "Technical reference levels"],
  };
}

// ===========================================================================
// Position Sizing Framework builder (deterministic)
// ===========================================================================

function computeScenarioSizing(
  constraints: TradePlanningConstraints,
  referencePrice: number | null,
  invalidationPrice: number | null,
): SizingFramework {
  const partial: string[] = [];
  const rounding: string[] = [];

  const capAvail    = constraints.capitalAvailable  ?? null;
  const maxAtRisk   = constraints.maxCapitalAtRisk  ?? null;
  const maxLossPos  = constraints.maxLossPerPosition ?? null;

  if (!referencePrice) {
    partial.push("Reference price unavailable — sizing cannot be computed.");
    return {
      capitalAvailable: capAvail, maxCapitalAtRisk: maxAtRisk,
      maxLossPerPosition: maxLossPos, referencePrice: null,
      invalidationPrice: null, riskPerShare: null,
      sharesByCapitalLimit: null, sharesByRiskLimit: null,
      effectiveScenarioShares: null, capitalRequired: null,
      capitalPercentOfPlanningCapital: null,
      estimatedLossAtInvalidation: null,
      partialReasons: partial, roundingNotes: rounding,
      disclaimer: SIZING_DISCLAIMER,
    };
  }

  // Risk per share (only when invalidation price is validated)
  let riskPerShare: number | null = null;
  if (invalidationPrice !== null && invalidationPrice > 0 && referencePrice > invalidationPrice) {
    riskPerShare = +(referencePrice - invalidationPrice).toFixed(4);
    if (riskPerShare <= 0) {
      riskPerShare = null;
      partial.push("Invalidation price is at or above reference price — risk-based sizing unavailable.");
    }
  } else {
    partial.push("No validated invalidation price — risk-based sizing (shares by max loss) unavailable.");
  }

  // Shares by capital limit: floor(maxCapitalAtRisk / referencePrice)
  let sharesByCapitalLimit: number | null = null;
  if (maxAtRisk !== null && maxAtRisk > 0 && referencePrice > 0) {
    sharesByCapitalLimit = Math.floor(maxAtRisk / referencePrice);
    rounding.push(`Shares by capital limit: floor(${maxAtRisk} ÷ ${referencePrice.toFixed(2)}) = ${sharesByCapitalLimit}`);
  } else if (!maxAtRisk) {
    partial.push("Maximum capital at risk not provided — capital-limit sizing unavailable.");
  }

  // Shares by risk limit: floor(maxLossPerPosition / riskPerShare)
  let sharesByRiskLimit: number | null = null;
  if (maxLossPos !== null && maxLossPos > 0 && riskPerShare !== null && riskPerShare > 0) {
    sharesByRiskLimit = Math.floor(maxLossPos / riskPerShare);
    rounding.push(`Shares by risk limit: floor(${maxLossPos} ÷ ${riskPerShare.toFixed(4)}) = ${sharesByRiskLimit}`);
  }

  // Effective scenario shares: min of available limits
  let effectiveScenarioShares: number | null = null;
  const candidates = [sharesByCapitalLimit, sharesByRiskLimit].filter(v => v !== null && v > 0) as number[];
  if (candidates.length > 0) {
    effectiveScenarioShares = Math.min(...candidates);
  } else if (capAvail !== null && capAvail > 0 && referencePrice > 0) {
    effectiveScenarioShares = Math.floor(capAvail / referencePrice);
    partial.push("Using planning capital for sizing (max loss/risk constraints not provided).");
    rounding.push(`Shares by planning capital: floor(${capAvail} ÷ ${referencePrice.toFixed(2)}) = ${effectiveScenarioShares}`);
  }

  // Apply capital ceiling
  if (effectiveScenarioShares !== null && capAvail !== null) {
    const capRequired = +(effectiveScenarioShares * referencePrice).toFixed(2);
    if (capRequired > capAvail) {
      const capped = Math.floor(capAvail / referencePrice);
      if (capped !== effectiveScenarioShares) {
        rounding.push(`Capped to planning capital: ${effectiveScenarioShares} → ${capped} shares`);
        effectiveScenarioShares = capped;
      }
    }
  }

  const capitalRequired = effectiveScenarioShares !== null
    ? +(effectiveScenarioShares * referencePrice).toFixed(2)
    : null;

  const capitalPercentOfPlanningCapital = capAvail && capitalRequired
    ? +((capitalRequired / capAvail) * 100).toFixed(1)
    : null;

  const estimatedLossAtInvalidation = effectiveScenarioShares !== null && riskPerShare !== null
    ? +(effectiveScenarioShares * riskPerShare).toFixed(2)
    : null;

  return {
    capitalAvailable: capAvail, maxCapitalAtRisk: maxAtRisk,
    maxLossPerPosition: maxLossPos, referencePrice, invalidationPrice,
    riskPerShare, sharesByCapitalLimit, sharesByRiskLimit,
    effectiveScenarioShares, capitalRequired,
    capitalPercentOfPlanningCapital, estimatedLossAtInvalidation,
    partialReasons: partial, roundingNotes: rounding,
    disclaimer: SIZING_DISCLAIMER,
  };
}

// ===========================================================================
// Scenario Grid builder (deterministic — NOT a price forecast)
// ===========================================================================

function buildScenarioGrid(
  referencePrice: number,
  sizing: SizingFramework,
  referenceLevels: ReferenceLevel[],
  downsidePct = -0.20,
  upsidePct = 0.20,
): ScenarioGrid {
  const percentages = [...DEFAULT_SCENARIO_PERCENTAGES];
  // Ensure user-specified range is included
  if (!percentages.includes(downsidePct) && downsidePct < 0) percentages.unshift(downsidePct);
  if (!percentages.includes(upsidePct)   && upsidePct  > 0) percentages.push(upsidePct);
  percentages.sort((a, b) => a - b);

  const shares = sizing.effectiveScenarioShares;

  const points: ScenarioPoint[] = percentages.map(pct => {
    const hypPrice = +(referencePrice * (1 + pct)).toFixed(2);
    const mktVal = shares ? +(shares * hypPrice).toFixed(2) : null;
    const pl     = shares ? +(mktVal! - shares * referencePrice).toFixed(2) : null;
    const plPct  = +(pct * 100);

    // Check if a reference level is near this price (±2%)
    const nearLevel = referenceLevels.find(l =>
      Math.abs(l.price - hypPrice) / referencePrice < 0.02
    );

    return {
      percentChange:          pct,
      label:                  pct === 0 ? "0% (Reference)" : `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(0)}%`,
      hypotheticalPrice:      hypPrice,
      hypotheticalMarketValue: mktVal,
      hypotheticalPL:         pl,
      hypotheticalPLPct:      plPct,
      isReferenceLevel:       !!nearLevel,
      referenceLevelLabel:    nearLevel?.label ?? null,
    };
  });

  // Reward/risk: only when upside reference and invalidation reference both exist
  const upsideRef   = referenceLevels.find(l => l.type === "resistance" || l.type === "prior_high");
  const downsideRef = referenceLevels.find(l => l.type === "invalidation" || l.type === "support");

  let upsideDistance: number | null = null;
  let downsideDistance: number | null = null;
  let rewardRiskRatio: number | null = null;

  if (upsideRef && upsideRef.price > referencePrice) {
    upsideDistance = +(upsideRef.price - referencePrice).toFixed(2);
  }
  if (downsideRef && downsideRef.price < referencePrice) {
    downsideDistance = +(referencePrice - downsideRef.price).toFixed(2);
  }
  if (upsideDistance !== null && downsideDistance !== null && downsideDistance > 0) {
    rewardRiskRatio = +(upsideDistance / downsideDistance).toFixed(2);
  }

  return {
    referencePrice,
    sharesUsed: shares,
    capitalInvested: sizing.capitalRequired,
    scenarioPoints: points,
    upsideDistance, downsideDistance, rewardRiskRatio,
    disclaimer: SCENARIO_DISCLAIMER,
  };
}

// ===========================================================================
// Monitoring Plan builder (deterministic)
// ===========================================================================

function buildMonitoringPlan(ctx: TradePlanningContext): MonitoringPlan {
  const items: MonitoringItem[] = [];

  // Technical
  items.push({
    category: "technical",
    label: "Technical Structure",
    currentState: ctx.opportunityLabel ?? "Research candidate",
    watchCondition: "Review if stage changes, key EMA levels fail, or volume patterns deteriorate",
    evidenceSource: "Stored technical bars + opportunity classification",
  });

  // Fundamental
  if (ctx.fundamentalScore > 0) {
    items.push({
      category: "fundamental",
      label: "Fundamental Evidence",
      currentState: `Score ${ctx.fundamentalScore}/100`,
      watchCondition: "Review if fundamental evidence score drops materially or earnings guidance weakens",
      evidenceSource: "Opportunity Intelligence — fundamental score",
    });
  }

  // Institutional
  if (ctx.institutionalScore > 0) {
    items.push({
      category: "institutional",
      label: "Institutional Ownership",
      currentState: `Score ${ctx.institutionalScore}/100`,
      watchCondition: "Review if institutional holdings trend reverses or large position unwinds appear",
      evidenceSource: "Opportunity Intelligence — institutional score",
    });
  }

  // Sector
  if (ctx.sector) {
    items.push({
      category: "sector",
      label: `${ctx.sector} Sector Context`,
      currentState: "Monitor sector relative strength",
      watchCondition: "Review if sector leadership reverses or rotation out of sector begins",
      evidenceSource: "Sector/industry classification",
    });
  }

  // Themes
  if (ctx.themes.length > 0) {
    items.push({
      category: "theme",
      label: `Theme Exposure: ${ctx.themes.slice(0, 2).join(", ")}`,
      currentState: "Monitor theme strength",
      watchCondition: "Review if primary themes lose momentum or news cycle reverses",
      evidenceSource: "Theme registry",
    });
  }

  // Market Regime
  items.push({
    category: "market_regime",
    label: "Market Regime",
    currentState: ctx.marketRegime ?? "Unknown",
    watchCondition: "Review if regime shifts from current classification (e.g. bull → neutral or bear)",
    evidenceSource: "Opportunity Intelligence — market regime",
  });

  // Portfolio exposure (if held)
  if (ctx.portfolioContext?.ownsSymbol) {
    items.push({
      category: "portfolio_exposure",
      label: "Portfolio Concentration",
      currentState: ctx.portfolioContext.portfolioWeight
        ? `${ctx.portfolioContext.portfolioWeight.toFixed(1)}% of portfolio`
        : "Existing position",
      watchCondition: "Review if portfolio weight exceeds intended concentration or correlation increases",
      evidenceSource: "Portfolio Intelligence",
    });
  }

  // Events (earnings risk)
  const earningsRisk = ctx.riskFactors.find(r =>
    r.label?.toLowerCase().includes("earn") || r.label?.toLowerCase().includes("event")
  );
  if (earningsRisk) {
    items.push({
      category: "events",
      label: "Earnings / Event Window",
      currentState: earningsRisk.detail ?? earningsRisk.label,
      watchCondition: "Review thesis before and after earnings announcement",
      evidenceSource: "Observed risk factors",
    });
  }

  return {
    items,
    alertsNote: MONITORING_DISCLAIMER,
  };
}

// ===========================================================================
// Research Evidence Summary builder
// ===========================================================================

function buildResearchEvidence(ctx: TradePlanningContext): EquityResearchEvidence {
  const whyQualified = ctx.primaryEvidence.length > 0
    ? ctx.primaryEvidence.map(e => e.label).join("; ")
    : `Qualified as ${ctx.opportunityLabel ?? ctx.opportunityType}`;

  const goalCtxLabel = ctx.goalContext
    ? `${ctx.goalContext.goalName} (${ctx.goalContext.matchState.replace(/_/g, " ")})`
    : null;

  const portCtxLabel = ctx.portfolioContext
    ? ctx.portfolioContext.ownsSymbol
      ? `Existing position — ${ctx.portfolioContext.portfolioWeight?.toFixed(1) ?? "?"}% portfolio weight`
      : "Not currently held in tracked portfolio"
    : null;

  return {
    whyQualified,
    primaryEvidence:    ctx.primaryEvidence.map(e => ({ label: e.label, detail: (e as any).detail ?? null })),
    secondaryEvidence:  ctx.secondaryEvidence.map(e => ({ label: e.label, detail: (e as any).detail ?? null })),
    risks:              ctx.riskFactors.map(r => ({ label: r.label, detail: r.detail ?? null, severity: r.severity })),
    thesisInvalidation: ctx.invalidatesThesis.map(inv => ({ condition: inv.condition, detail: inv.detail ?? null })),
    recentChanges:      [],
    marketRegime:       ctx.marketRegime ?? null,
    sectorContext:      ctx.sector ?? null,
    themeContext:       ctx.themes,
    goalContext:        goalCtxLabel,
    portfolioContext:   portCtxLabel,
  };
}

// ===========================================================================
// Freshness builder
// ===========================================================================

function buildFreshness(
  ctx: TradePlanningContext,
  priceBarDate: string | null,
  techLevelDate: string | null,
): EquityPlanningFreshness {
  const refPrice  = makeFreshnessItem("Reference Price",            priceBarDate);
  const techLvl   = makeFreshnessItem("Technical Levels",           techLevelDate);
  const oppIntel  = makeFreshnessItem("Opportunity Intelligence",   ctx.generatedAt);
  const funds     = makeFreshnessItem("Fundamental Evidence",       ctx.generatedAt);
  const inst      = makeFreshnessItem("Institutional Evidence",     ctx.generatedAt);
  const port      = makeFreshnessItem("Portfolio Context",
    ctx.portfolioContext ? ctx.portfolioContext.freshness?.updatedAt ?? null : null);
  const goal      = makeFreshnessItem("Goal Context",
    ctx.goalContext ? ctx.goalContext.freshness?.label ?? null : null);

  const criticalStale = [refPrice, techLvl, oppIntel]
    .some(i => i.status === "stale" || i.status === "unavailable");

  return {
    referencePrice: refPrice, technicalLevels: techLvl,
    opportunityIntelligence: oppIntel, fundamentals: funds,
    institutional: inst, portfolio: port, goal,
    hasStaleCriticalData: criticalStale,
    staleWarning: criticalStale
      ? "STALE INPUT WARNING: One or more critical data sources are stale. Scenario values may not reflect current market conditions."
      : null,
  };
}

// ===========================================================================
// Capital Context builder
// ===========================================================================

function buildCapitalContext(sizing: SizingFramework): CapitalContext {
  return {
    planningCapital:          sizing.capitalAvailable,
    maxScenarioCapital:       sizing.maxCapitalAtRisk,
    maxScenarioLoss:          sizing.maxLossPerPosition,
    hypotheticalShares:       sizing.effectiveScenarioShares,
    estimatedCapitalRequired: sizing.capitalRequired,
    estimatedLossAtInvalidation: sizing.estimatedLossAtInvalidation,
    disclaimer: SIZING_DISCLAIMER,
  };
}

// ===========================================================================
// Main: buildEquityPlanningScenario
// ===========================================================================

export async function buildEquityPlanningScenario(
  input: EquityPlanningInput,
): Promise<EquityPlanningScenario> {
  const t0 = Date.now();

  // 1. Load authoritative TradePlanningContext
  let ctx: TradePlanningContext;
  try {
    ctx = await buildTradePlanningContext(input.userId, input.symbol, {
      goalId:      null,
      portfolioId: null,
      constraints: input.constraints,
    });
  } catch (err: any) {
    _recordFailed();
    console.error("[equity-planning] context build failed:", err?.message);
    throw new Error(`No qualified research candidate for ${input.symbol}: ${err?.message}`);
  }

  // 2. Load reference price from stored bars (zero provider credits)
  let referencePrice: number | null = null;
  let priceBarDate: string | null   = null;
  let ema9: number | null = null, ema21: number | null = null, ema50: number | null = null;

  try {
    const snap = await getReferenceSnapshot(input.userId, input.symbol, {
      feature: "equity_planning",
      barLimit: 60,
    });
    if (snap) {
      referencePrice = snap.lastPrice ?? null;
      if (snap.bars.length > 0) {
        const lastBar = snap.bars[snap.bars.length - 1];
        // date field may be "YYYY-MM-DD" or a timestamp
        priceBarDate = (lastBar as any).date
          ? new Date((lastBar as any).date).toISOString()
          : null;
      }
      ema9  = snap.technicals?.ema9  ?? null;
      ema21 = snap.technicals?.ema21 ?? null;
      ema50 = snap.technicals?.ema50 ?? null;
    }
  } catch (err: any) {
    console.warn(`[equity-planning] reference price unavailable for ${input.symbol}:`, err?.message);
  }

  const limitations: string[] = [];
  if (!referencePrice) limitations.push("Reference price unavailable — stored market data not found.");

  // 3. Build frameworks
  const entryFw    = buildEntryFramework(ctx, referencePrice, ema9, ema21, ema50);
  const invalidFw  = buildInvalidationFramework(ctx, entryFw.referenceLevels);
  const sizing     = computeScenarioSizing(input.constraints, referencePrice, null);
  const scenarioGrid = referencePrice
    ? buildScenarioGrid(
        referencePrice, sizing, entryFw.referenceLevels,
        input.downsidePct ?? -0.20,
        input.upsidePct   ??  0.20,
      )
    : null;
  const monitorPlan  = buildMonitoringPlan(ctx);
  const evidence     = buildResearchEvidence(ctx);
  const freshness    = buildFreshness(ctx, priceBarDate, priceBarDate);
  const capitalCtx   = buildCapitalContext(sizing);

  // Collect all partial reasons as limitations
  sizing.partialReasons.forEach(r => {
    if (!limitations.includes(r)) limitations.push(r);
  });
  if (!entryFw.available && entryFw.unavailableReason) {
    if (!limitations.includes(entryFw.unavailableReason)) limitations.push(entryFw.unavailableReason);
  }

  const isPartial = limitations.length > 0;
  const durationMs = Date.now() - t0;

  console.log(JSON.stringify({
    event: isPartial ? "equity_planning_partial" : "equity_planning_completed",
    durationMs, hasEntryFramework: entryFw.available,
    hasInvalidation: invalidFw.conditions.length > 0,
    hasPortfolioContext: !!ctx.portfolioContext,
    hasGoalContext: !!ctx.goalContext,
    scenarioPointCount: scenarioGrid?.scenarioPoints.length ?? 0,
  }));

  _recordSuccess(durationMs, isPartial);

  return {
    id:                  randomUUID(),
    planningContextId:   input.tradePlanningContextId,
    planningSessionId:   input.planningSessionId ?? null,
    symbol:              input.symbol,
    generatedAt:         new Date().toISOString(),
    marketDataAsOf:      priceBarDate,
    researchSummary:     evidence,
    referencePrice,
    referencePriceSource: referencePrice && priceBarDate
      ? `Stored daily close — ${new Date(priceBarDate).toLocaleDateString()}`
      : "Not available",
    entryFramework:      entryFw,
    invalidationFramework: invalidFw,
    sizingFramework:     sizing,
    scenarioGrid,
    monitoringPlan:      monitorPlan,
    capitalContext:      capitalCtx,
    limitations,
    freshness,
    methodologyVersion:  EQUITY_METHODOLOGY_VERSION,
    planningConstraintsFingerprint: constraintsFingerprint(input.constraints),
  };
}

// ===========================================================================
// Scenario recalculation (pure, fast — constraints changed)
// ===========================================================================

export async function recalculateEquityScenario(
  input: EquityPlanningInput,
): Promise<EquityPlanningScenario> {
  // Same as build — context cache means this is fast after first build
  return buildEquityPlanningScenario(input);
}
