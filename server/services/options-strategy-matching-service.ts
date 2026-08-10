/**
 * Options Strategy Matching Service — Sprint 2.7.2
 *
 * SCOPE: Deterministic strategy FAMILY matching only.
 * Does NOT: select strike, expiration, contract, premium, or order.
 *
 * PERMANENT ARCHITECTURE RULE:
 *   Options Strategy Matching may narrow or reject strategy families based
 *   on research evidence, user-selected planning constraints, portfolio
 *   requirements, volatility/event context, or missing data.
 *
 *   It may NEVER:
 *   - promote an unqualified security into an opportunity
 *   - rewrite the upstream research thesis to justify an options strategy
 *   - invent volatility/event data
 *   - select an actual contract
 *   - rank strategies as personalized recommendations
 *
 * ISOLATION:
 *   This service does NOT import or reference:
 *   - best-trade-finder.ts (BestTradePick / recommendation orchestration)
 *   - options-evaluator.ts (suitabilityScore / synthetic IV)
 *   - opportunity-radar (scanner / radar scoring)
 *   - live-contract-resolver.ts (contract selection — belongs to 2.7.3)
 */

import { randomUUID } from "crypto";
import type { TradePlanningContext, TradePlanningConstraints } from "../../shared/trade-planning-types";
import type {
  OptionsStrategyFamily,
  OptionsStrategyMatch,
  OptionsStrategyMatchResult,
  StrategyMatchStatus,
  ThesisDirection,
  VolatilityContext,
  LiquidityContext,
  EventContext,
  OptionsMatchFreshness,
  MatchFreshnessItem,
  OptionsContractResearchInput,
  StrategyCategory,
} from "../../shared/options-strategy-types";
import {
  ALL_OPTIONS_STRATEGY_FAMILIES,
  STRATEGY_FAMILY_LABELS,
  STRATEGY_FAMILY_CATEGORY,
  STRATEGY_CATEGORY_LABELS,
  STRATEGY_MATCH_STATUS_LABELS,
  THESIS_DIRECTION_LABELS,
  OPTIONS_STRATEGY_DISCLAIMER,
  OPTIONS_RISK_DISCLOSURE,
  OPTIONS_MATCHING_VERSION,
} from "../../shared/options-strategy-types";
import { validateConstraints } from "../../shared/trade-planning-types";

// ===========================================================================
// Health metrics (in-memory, resets on restart)
// ===========================================================================

interface OptionsMatchHealthMetrics {
  optionsMatchRequests:          number;
  optionsMatchesCompleted:       number;
  partialOptionsMatches:         number;
  failedOptionsMatches:          number;
  totalLatencyMs:                number;
  matchCount:                    number;
  lastSuccessfulOptionsMatchAt:  string | null;
}

const _health: OptionsMatchHealthMetrics = {
  optionsMatchRequests:         0,
  optionsMatchesCompleted:      0,
  partialOptionsMatches:        0,
  failedOptionsMatches:         0,
  totalLatencyMs:               0,
  matchCount:                   0,
  lastSuccessfulOptionsMatchAt: null,
};

export function getOptionsMatchingHealth() {
  return {
    optionsMatchRequests:         _health.optionsMatchRequests,
    optionsMatchesCompleted:      _health.optionsMatchesCompleted,
    partialOptionsMatches:        _health.partialOptionsMatches,
    failedOptionsMatches:         _health.failedOptionsMatches,
    averageOptionsMatchLatencyMs: _health.matchCount > 0
      ? Math.round(_health.totalLatencyMs / _health.matchCount)
      : null,
    lastSuccessfulOptionsMatchAt: _health.lastSuccessfulOptionsMatchAt,
  };
}

// ===========================================================================
// Freshness helper
// ===========================================================================

function makeFreshnessItem(label: string, asOf: string | null): MatchFreshnessItem {
  if (!asOf) return { label, status: "unavailable", asOf: null, ageLabel: "Unavailable" };
  const ageMs  = Date.now() - new Date(asOf).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const status  = ageDays < 1 ? "fresh" : ageDays < 3 ? "aging" : "stale";
  const ageLabel = ageDays < 1
    ? `${Math.round(ageMs / 60000)}m ago`
    : `${Math.round(ageDays)}d ago`;
  return { label, status, asOf, ageLabel };
}

function buildFreshness(ctx: TradePlanningContext): OptionsMatchFreshness {
  const oppIntel    = makeFreshnessItem("Opportunity Intelligence", ctx.generatedAt);
  const portfolio   = makeFreshnessItem("Portfolio Context",
    ctx.portfolioContext?.freshness?.updatedAt ?? null);
  const goal        = makeFreshnessItem("Goal Context",
    ctx.goalContext?.freshness?.updatedAt ?? null);
  const volatility  = makeFreshnessItem("Volatility Data", null);   // no IV source in 2.7.2
  const eventData   = makeFreshnessItem("Event Data",     null);    // no external event source

  const hasStaleCriticalData = oppIntel.status === "stale" || oppIntel.status === "unavailable";
  return {
    opportunityIntelligence: oppIntel,
    portfolioContext:        portfolio,
    goalContext:             goal,
    volatilityData:          volatility,
    eventData:               eventData,
    hasStaleCriticalData,
    staleWarning: hasStaleCriticalData
      ? "Opportunity Intelligence data is stale. Strategy matching is based on older research evidence."
      : null,
  };
}

// ===========================================================================
// 1. Thesis Direction Derivation
// ===========================================================================

const BULLISH_OPPORTUNITY_TYPES = new Set([
  "VCP", "VOLATILITY_CONTRACTION", "BREAKOUT", "POWER_BREAKOUT",
  "GAP_AND_GO", "ORB5", "ORB15", "VWAP_RECLAIM", "INSTITUTIONAL_ACCUMULATION",
  "VOLUME_SURGE", "PREMARKET_GAP", "PREMARKET_MOMENTUM",
]);

const BEARISH_OPPORTUNITY_TYPES = new Set([
  "BREAKDOWN", "DISTRIBUTION", "BEARISH_REVERSAL",
]);

const NEUTRAL_OPPORTUNITY_TYPES = new Set([
  "CONSOLIDATION", "RANGE_BOUND", "LOW_VOLATILITY",
]);

/**
 * Derives thesis direction from canonical research context.
 * Uses: opportunityType, technical stage, scores, risk factors, market regime.
 * Does NOT introduce a new ranking score.
 */
export function deriveThesisDirection(ctx: TradePlanningContext): {
  direction: ThesisDirection;
  reasoning: string[];
} {
  const reasoning: string[] = [];
  const oppType = (ctx.opportunityType ?? "").toUpperCase();

  // Explicit bearish signals first
  const bearishRiskCount = ctx.riskFactors.filter(r =>
    /bearish|downtrend|distribution|break.*down|below.*support/i.test(r.label + " " + r.detail)
  ).length;

  const highSeverityRisks = ctx.riskFactors.filter(r => r.severity === "high").length;
  const invalidatesCount  = ctx.invalidatesThesis.length;

  const hasMultipleBearishRisks = bearishRiskCount >= 2 || (highSeverityRisks >= 2 && invalidatesCount >= 2);

  if (BEARISH_OPPORTUNITY_TYPES.has(oppType)) {
    reasoning.push(`Opportunity type "${ctx.opportunityLabel}" is bearish`);
    if (hasMultipleBearishRisks) reasoning.push("Multiple bearish risk factors observed");
    return { direction: "BEARISH", reasoning };
  }

  if (NEUTRAL_OPPORTUNITY_TYPES.has(oppType)) {
    reasoning.push(`Opportunity type "${ctx.opportunityLabel}" indicates range-bound structure`);
    return { direction: "RANGE_BOUND", reasoning };
  }

  if (BULLISH_OPPORTUNITY_TYPES.has(oppType)) {
    reasoning.push(`Opportunity type "${ctx.opportunityLabel}" is bullish/accumulation`);

    // Check for volatility contraction signal (may become bullish breakout)
    if (oppType === "VCP" || oppType === "VOLATILITY_CONTRACTION") {
      reasoning.push("VCP/volatility contraction pattern suggests bullish breakout potential");
    }

    // Check if strong risk factors reduce confidence to MIXED
    if (hasMultipleBearishRisks) {
      reasoning.push("Multiple high-severity risk factors reduce directional confidence");
      return { direction: "MIXED", reasoning };
    }

    return { direction: "BULLISH", reasoning };
  }

  // Score-based derivation as fallback
  const technicalStrong = ctx.technicalScore >= 0.65;
  const fundamentalOk   = ctx.fundamentalScore >= 0.50;
  const overallStrong   = ctx.researchScore >= 0.65;

  if (technicalStrong && overallStrong) {
    reasoning.push(`Strong technical score (${Math.round(ctx.technicalScore * 100)}) with overall quality suggests bullish lean`);
    if (fundamentalOk) reasoning.push("Fundamental evidence supports");
    if (hasMultipleBearishRisks) {
      reasoning.push("Risk factors introduce uncertainty");
      return { direction: "MIXED", reasoning };
    }
    return { direction: "BULLISH", reasoning };
  }

  // Market regime context
  const regime = (ctx.marketRegime ?? "").toLowerCase();
  if (regime.includes("volatile") || regime.includes("expansion")) {
    reasoning.push("Market regime indicates volatility expansion");
    return { direction: "VOLATILITY_EXPANSION", reasoning };
  }
  if (regime.includes("contraction") || regime.includes("low vol")) {
    reasoning.push("Market regime indicates volatility contraction");
    return { direction: "VOLATILITY_CONTRACTION", reasoning };
  }
  if (regime.includes("neutral") || regime.includes("range")) {
    reasoning.push("Market regime indicates neutral/range-bound conditions");
    return { direction: "NEUTRAL", reasoning };
  }

  // Mixed signals
  if (ctx.riskFactors.length >= 2 && (technicalStrong || overallStrong)) {
    reasoning.push("Mixed signals: positive research evidence alongside notable risk factors");
    return { direction: "MIXED", reasoning };
  }

  reasoning.push("Insufficient directional signals to classify");
  return { direction: "UNKNOWN", reasoning };
}

// ===========================================================================
// 2. Volatility Context
// ===========================================================================

/**
 * Derives volatility context. No authoritative IV source exists in 2.7.2.
 * Returns UNKNOWN with an honest explanation.
 */
export function deriveVolatilityContext(_ctx: TradePlanningContext): VolatilityContext {
  return {
    level:  "UNKNOWN",
    note:   "Implied volatility data is not available at this research stage. " +
            "Volatility-sensitive strategy considerations are shown with this limitation.",
    source: null,
  };
}

// ===========================================================================
// 3. Liquidity Context
// ===========================================================================

/**
 * Broad options liquidity context. No chain inspection in 2.7.2.
 * Contract-level liquidity belongs to Sprint 2.7.3.
 */
export function deriveLiquidityContext(_ctx: TradePlanningContext): LiquidityContext {
  return {
    availability: "UNKNOWN",
    note: "Options chain availability is evaluated in Contract Research (2.7.3). " +
          "Strategy family matching proceeds with broad liquidity status unknown.",
  };
}

// ===========================================================================
// 4. Event Context
// ===========================================================================

/**
 * Derives event context from risk factors and research evidence.
 * No external event data source in 2.7.2 — uses text analysis of canonical context.
 */
export function deriveEventContext(ctx: TradePlanningContext): EventContext | null {
  const earningsWindow = 14; // default window in days

  // Check risk factors for earnings mentions
  const earningsRisk = ctx.riskFactors.find(r =>
    /earnings|report|quarterly|q[1-4]\s*(report|results|earnings)/i.test(r.label + " " + r.detail)
  );
  const earningsEvidence = [...ctx.primaryEvidence, ...ctx.secondaryEvidence].find(e =>
    /earnings|report/i.test((e as any).label || "")
  );

  if (!earningsRisk && !earningsEvidence) {
    return {
      hasUpcomingEvent:   false,
      eventType:          null,
      daysUntilEvent:     null,
      insideEventWindow:  false,
      earningsWindowDays: earningsWindow,
      note:               "No earnings or event data found in research evidence. Event context unavailable.",
    };
  }

  return {
    hasUpcomingEvent:   true,
    eventType:          "earnings",
    daysUntilEvent:     null,  // exact date unavailable in this context
    insideEventWindow:  true,  // conservative: if mentioned, treat as inside window
    earningsWindowDays: earningsWindow,
    note:               "Earnings or event risk mentioned in research evidence. Exact date unavailable — " +
                        "treating as inside potential event window (conservative).",
  };
}

// ===========================================================================
// 5. Strategy Family Evaluation Helpers
// ===========================================================================

interface EvaluationParams {
  direction:          ThesisDirection;
  horizon:            string | null;
  volatility:         VolatilityContext;
  liquidity:          LiquidityContext;
  eventCtx:           EventContext | null;
  ownsSymbol:         boolean;
  portfolioAvailable: boolean;
  constraints:        TradePlanningConstraints;
  incomeFocus:        boolean;   // merged from constraints + goal
  directionalFocus:   boolean;   // merged from constraints + goal
  optionsInterest:    boolean;   // from goal context
  avoidEarnings:      boolean;
  hasDefinedRiskPref: boolean;
}

function buildContractResearchInput(
  ctx: TradePlanningContext,
  family: OptionsStrategyFamily,
  direction: ThesisDirection,
  volatility: VolatilityContext,
  liquidity: LiquidityContext,
  eventCtx: EventContext | null,
  fingerprint: string,
): OptionsContractResearchInput {
  return {
    planningContextId:              ctx.id,
    strategyFamily:                 family,
    researchHorizon:                ctx.researchHorizon,
    thesisDirection:                direction,
    volatilityContext:              volatility,
    liquidityContext:               liquidity,
    eventContext:                   eventCtx,
    planningConstraintsFingerprint: fingerprint,
  };
}

type PartialMatch = Pick<OptionsStrategyMatch,
  "status" | "reasons" | "constraintsSatisfied" | "constraintsMissing" |
  "riskCharacteristics" | "incomeCharacteristics" | "directionalCharacteristics" |
  "eventConsiderations" | "portfolioRequirements" | "limitations" | "nextStageRequirements"
>;

/**
 * Pure evaluation of a single strategy family against parameters.
 * Returns status + all explanation fields.
 */
function evaluateFamily(
  family: OptionsStrategyFamily,
  p: EvaluationParams,
): PartialMatch {
  // Global gate: options disabled
  if (!p.constraints.optionsAllowed && family !== "monitor_only") {
    return {
      status:                   "UNAVAILABLE",
      reasons:                  ["Options research is disabled in your current planning constraints."],
      constraintsSatisfied:     [],
      constraintsMissing:       ["optionsAllowed = true"],
      riskCharacteristics:      [],
      incomeCharacteristics:    [],
      directionalCharacteristics: [],
      eventConsiderations:      [],
      portfolioRequirements:    [],
      limitations:              [],
      nextStageRequirements:    [],
    };
  }

  const isBullish     = p.direction === "BULLISH";
  const isBearish     = p.direction === "BEARISH";
  const isNeutral     = p.direction === "NEUTRAL" || p.direction === "RANGE_BOUND";
  const isVolExp      = p.direction === "VOLATILITY_EXPANSION";
  const isVolContract = p.direction === "VOLATILITY_CONTRACTION";
  const isMixed       = p.direction === "MIXED";
  const isUnknown     = p.direction === "UNKNOWN";

  const horizonLong  = p.horizon === "long" || p.horizon === "multi_year";
  const horizonShort = p.horizon === "short";

  const insideEventWindow = p.eventCtx?.insideEventWindow && p.avoidEarnings;

  switch (family) {

    // -----------------------------------------------------------------------
    // LONG CALL
    // -----------------------------------------------------------------------
    case "long_call": {
      const satisfied: string[] = ["Options research enabled"];
      const missing: string[]   = [];
      const reasons: string[]   = [];

      if (isBullish || isVolExp) {
        satisfied.push(`Bullish/vol-expansion thesis aligns with long call directional structure`);
        if (p.directionalFocus) satisfied.push("Directional focus preference noted");
        reasons.push("Bullish research thesis is consistent with this directional structure");
        if (insideEventWindow) {
          return {
            status: "POTENTIALLY_APPLICABLE",
            reasons: [...reasons, "Inside potential event window — premium costs may be elevated"],
            constraintsSatisfied: satisfied,
            constraintsMissing: missing,
            riskCharacteristics: ["Defined premium at risk", "Full loss of premium if thesis does not play out within expiration window", "Time decay (theta) reduces value over time"],
            incomeCharacteristics: [],
            directionalCharacteristics: ["Profits if underlying moves up significantly", "Loses value if underlying declines or remains flat"],
            eventConsiderations: ["Near-term events may inflate premium cost", "Large move required to overcome elevated implied premium"],
            portfolioRequirements: [],
            limitations: ["Exact capital requirement depends on contract selection (2.7.3)"],
            nextStageRequirements: ["Expiration selection", "Strike selection", "Premium evaluation", "Contract liquidity"],
          };
        }
        return {
          status:                  "APPLICABLE",
          reasons,
          constraintsSatisfied:    satisfied,
          constraintsMissing:      missing,
          riskCharacteristics:     ["Defined premium at risk", "Full loss of premium if thesis does not play out within expiration window", "Time decay (theta) reduces value over time"],
          incomeCharacteristics:   [],
          directionalCharacteristics: ["Profits if underlying moves up significantly", "Loses value if underlying declines or remains flat"],
          eventConsiderations:     ["Event risk can inflate premium cost"],
          portfolioRequirements:   [],
          limitations:             ["Exact capital requirement depends on contract selection (2.7.3)"],
          nextStageRequirements:   ["Expiration selection", "Strike selection", "Premium evaluation", "Contract liquidity"],
        };
      }

      if (isMixed || isUnknown) {
        reasons.push("Mixed or unknown thesis direction reduces alignment with directional structure");
        return {
          status:                  "POTENTIALLY_APPLICABLE",
          reasons,
          constraintsSatisfied:    satisfied,
          constraintsMissing:      ["Clearer bullish directional thesis"],
          riskCharacteristics:     ["Defined premium at risk", "Time decay exposure"],
          incomeCharacteristics:   [],
          directionalCharacteristics: ["Directional — requires bullish move"],
          eventConsiderations:     [],
          portfolioRequirements:   [],
          limitations:             ["Directional conviction not well established from current evidence"],
          nextStageRequirements:   ["Expiration selection", "Strike selection", "Premium evaluation"],
        };
      }

      // Bearish or neutral — not applicable
      return {
        status:   "NOT_APPLICABLE",
        reasons:  [`Research thesis direction (${THESIS_DIRECTION_LABELS[p.direction]}) is not consistent with bullish directional structure`],
        constraintsSatisfied: satisfied,
        constraintsMissing:   ["Bullish research thesis"],
        riskCharacteristics:  ["Defined premium at risk"],
        incomeCharacteristics: [],
        directionalCharacteristics: ["Requires bullish directional move"],
        eventConsiderations:  [],
        portfolioRequirements: [],
        limitations:          [],
        nextStageRequirements: [],
      };
    }

    // -----------------------------------------------------------------------
    // LONG PUT
    // -----------------------------------------------------------------------
    case "long_put": {
      const satisfied = ["Options research enabled"];
      if (isBearish || isVolExp) {
        if (p.directionalFocus) satisfied.push("Directional focus noted");
        return {
          status:   "APPLICABLE",
          reasons:  ["Bearish/volatility-expansion research thesis is consistent with this directional structure"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   [],
          riskCharacteristics:  ["Defined premium at risk", "Full loss of premium if underlying does not decline within expiration window", "Time decay exposure"],
          incomeCharacteristics: [],
          directionalCharacteristics: ["Profits if underlying moves down significantly"],
          eventConsiderations:  ["Event risk can inflate premium cost"],
          portfolioRequirements: [],
          limitations:          ["Exact capital requirement depends on contract selection"],
          nextStageRequirements: ["Expiration selection", "Strike selection", "Premium evaluation", "Contract liquidity"],
        };
      }
      if (isMixed || isUnknown) {
        return {
          status:   "POTENTIALLY_APPLICABLE",
          reasons:  ["Mixed/unknown thesis — limited directional conviction for bearish structure"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   ["Clearer bearish directional thesis"],
          riskCharacteristics:  ["Defined premium at risk", "Time decay exposure"],
          incomeCharacteristics: [],
          directionalCharacteristics: ["Requires bearish directional move"],
          eventConsiderations:  [],
          portfolioRequirements: [],
          limitations:          [],
          nextStageRequirements: ["Expiration selection", "Strike selection", "Premium evaluation"],
        };
      }
      return {
        status:   "NOT_APPLICABLE",
        reasons:  [`Research thesis direction (${THESIS_DIRECTION_LABELS[p.direction]}) is not consistent with bearish directional structure`],
        constraintsSatisfied: satisfied,
        constraintsMissing:   ["Bearish research thesis"],
        riskCharacteristics:  ["Defined premium at risk"],
        incomeCharacteristics: [],
        directionalCharacteristics: ["Requires bearish directional move"],
        eventConsiderations:  [],
        portfolioRequirements: [],
        limitations:          [],
        nextStageRequirements: [],
      };
    }

    // -----------------------------------------------------------------------
    // BULL CALL SPREAD
    // -----------------------------------------------------------------------
    case "bull_call_spread": {
      const satisfied = ["Options research enabled", "Defined-risk structure"];
      if (p.hasDefinedRiskPref) satisfied.push("Defined-risk preference satisfied");
      if (isBullish || isVolExp) {
        if (p.directionalFocus) satisfied.push("Directional focus noted");
        return {
          status:   "APPLICABLE",
          reasons:  ["Bullish thesis is consistent with this defined-risk bullish spread structure"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   [],
          riskCharacteristics:  ["Net debit structure — defined maximum cost", "Maximum loss limited to net premium paid", "Upside capped at spread width"],
          incomeCharacteristics: [],
          directionalCharacteristics: ["Long lower-strike call, short higher-strike call", "Profits from bullish move up to short strike"],
          eventConsiderations:  ["Events may increase spread cost"],
          portfolioRequirements: [],
          limitations:          ["Spread width and strike selection require contract research (2.7.3)"],
          nextStageRequirements: ["Expiration selection", "Strike selection (long + short)", "Spread width decision", "Net debit evaluation"],
        };
      }
      if (isMixed || isUnknown) {
        return {
          status:   "POTENTIALLY_APPLICABLE",
          reasons:  ["Mixed/unknown thesis — reduced directional confidence for bullish spread"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   ["Clearer bullish thesis"],
          riskCharacteristics:  ["Defined-risk: max loss = net debit", "Upside capped at spread width"],
          incomeCharacteristics: [],
          directionalCharacteristics: ["Requires bullish move to reach profitability"],
          eventConsiderations:  [],
          portfolioRequirements: [],
          limitations:          [],
          nextStageRequirements: ["Expiration selection", "Strike selection"],
        };
      }
      return {
        status:   "NOT_APPLICABLE",
        reasons:  [`Research thesis direction (${THESIS_DIRECTION_LABELS[p.direction]}) is not consistent with bullish spread structure`],
        constraintsSatisfied: satisfied,
        constraintsMissing:   ["Bullish thesis"],
        riskCharacteristics:  ["Defined-risk debit structure"],
        incomeCharacteristics: [],
        directionalCharacteristics: ["Requires bullish move"],
        eventConsiderations:  [],
        portfolioRequirements: [],
        limitations:          [],
        nextStageRequirements: [],
      };
    }

    // -----------------------------------------------------------------------
    // BEAR PUT SPREAD
    // -----------------------------------------------------------------------
    case "bear_put_spread": {
      const satisfied = ["Options research enabled", "Defined-risk structure"];
      if (p.hasDefinedRiskPref) satisfied.push("Defined-risk preference satisfied");
      if (isBearish) {
        return {
          status:   "APPLICABLE",
          reasons:  ["Bearish thesis is consistent with this defined-risk bearish spread structure"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   [],
          riskCharacteristics:  ["Net debit structure", "Maximum loss limited to net premium paid", "Profit potential capped at spread width"],
          incomeCharacteristics: [],
          directionalCharacteristics: ["Long higher-strike put, short lower-strike put", "Profits from bearish move"],
          eventConsiderations:  ["Events may increase spread cost"],
          portfolioRequirements: [],
          limitations:          ["Spread width and strike selection require contract research (2.7.3)"],
          nextStageRequirements: ["Expiration selection", "Strike selection", "Spread width evaluation"],
        };
      }
      if (isMixed || isVolExp) {
        return {
          status:   "POTENTIALLY_APPLICABLE",
          reasons:  ["Mixed or vol-expansion thesis — limited bearish directional alignment"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   ["Clearer bearish thesis"],
          riskCharacteristics:  ["Defined-risk: max loss = net debit"],
          incomeCharacteristics: [],
          directionalCharacteristics: ["Requires bearish move"],
          eventConsiderations:  [],
          portfolioRequirements: [],
          limitations:          [],
          nextStageRequirements: ["Expiration selection", "Strike selection"],
        };
      }
      return {
        status:   "NOT_APPLICABLE",
        reasons:  [`Research thesis direction (${THESIS_DIRECTION_LABELS[p.direction]}) is not consistent with bearish spread structure`],
        constraintsSatisfied: satisfied,
        constraintsMissing:   ["Bearish thesis"],
        riskCharacteristics:  ["Defined-risk debit structure"],
        incomeCharacteristics: [],
        directionalCharacteristics: ["Requires bearish move"],
        eventConsiderations:  [],
        portfolioRequirements: [],
        limitations:          [],
        nextStageRequirements: [],
      };
    }

    // -----------------------------------------------------------------------
    // BULL PUT SPREAD (credit spread, bullish)
    // -----------------------------------------------------------------------
    case "bull_put_spread": {
      const satisfied = ["Options research enabled", "Defined-risk structure (net credit)"];
      if (p.hasDefinedRiskPref) satisfied.push("Defined-risk preference satisfied");
      if (p.incomeFocus) satisfied.push("Income focus preference noted");
      if (isBullish || isNeutral || isVolContract) {
        const status: StrategyMatchStatus = isNeutral ? "POTENTIALLY_APPLICABLE" : "APPLICABLE";
        return {
          status,
          reasons:  ["Bullish/neutral thesis with income focus is consistent with bull put spread (credit received)"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   [],
          riskCharacteristics:  ["Net credit received at entry", "Maximum loss = spread width minus credit received", "Loss occurs if underlying falls below short put strike"],
          incomeCharacteristics: ["Premium income received at entry", "Income strategy with bullish directional bias"],
          directionalCharacteristics: ["Short higher-strike put, long lower-strike put", "Profits from bullish move or stability above short strike"],
          eventConsiderations:  ["Events may increase spread value (risk to short put)"],
          portfolioRequirements: [],
          limitations:          ["Exact strike and credit depend on contract selection (2.7.3)"],
          nextStageRequirements: ["Expiration selection", "Strike selection", "Credit evaluation", "Contract liquidity"],
        };
      }
      if (isMixed || isUnknown) {
        return {
          status:   "POTENTIALLY_APPLICABLE",
          reasons:  ["Mixed/unknown thesis reduces confidence in bullish directional credit spread"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   ["Bullish or neutral thesis"],
          riskCharacteristics:  ["Defined-risk credit spread", "Loss if underlying falls below short strike"],
          incomeCharacteristics: ["Income received at entry"],
          directionalCharacteristics: ["Requires underlying to stay above short put strike"],
          eventConsiderations:  [],
          portfolioRequirements: [],
          limitations:          [],
          nextStageRequirements: ["Expiration selection", "Strike selection"],
        };
      }
      return {
        status:   "NOT_APPLICABLE",
        reasons:  ["Bearish research thesis is not consistent with bullish credit spread structure"],
        constraintsSatisfied: satisfied,
        constraintsMissing:   ["Bullish or neutral thesis"],
        riskCharacteristics:  ["Credit spread — loss if underlying falls"],
        incomeCharacteristics: [],
        directionalCharacteristics: [],
        eventConsiderations:  [],
        portfolioRequirements: [],
        limitations:          [],
        nextStageRequirements: [],
      };
    }

    // -----------------------------------------------------------------------
    // BEAR CALL SPREAD (credit spread, bearish)
    // -----------------------------------------------------------------------
    case "bear_call_spread": {
      const satisfied = ["Options research enabled", "Defined-risk structure (net credit)"];
      if (p.hasDefinedRiskPref) satisfied.push("Defined-risk preference satisfied");
      if (p.incomeFocus) satisfied.push("Income focus noted");
      if (isBearish || isNeutral || isVolContract) {
        const status: StrategyMatchStatus = isNeutral ? "POTENTIALLY_APPLICABLE" : "APPLICABLE";
        return {
          status,
          reasons:  ["Bearish/neutral thesis with income preference is consistent with bear call spread"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   [],
          riskCharacteristics:  ["Net credit received at entry", "Maximum loss = spread width minus credit received", "Loss occurs if underlying rises above short call strike"],
          incomeCharacteristics: ["Premium income received at entry"],
          directionalCharacteristics: ["Short lower-strike call, long higher-strike call", "Profits from bearish move or stability below short strike"],
          eventConsiderations:  ["Events may cause unexpected upward moves"],
          portfolioRequirements: [],
          limitations:          ["Strike and credit depend on contract selection (2.7.3)"],
          nextStageRequirements: ["Expiration selection", "Strike selection", "Credit evaluation"],
        };
      }
      if (isMixed || isUnknown) {
        return {
          status:   "POTENTIALLY_APPLICABLE",
          reasons:  ["Mixed/unknown thesis reduces confidence in bearish credit spread"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   ["Bearish or neutral thesis"],
          riskCharacteristics:  ["Defined-risk credit spread"],
          incomeCharacteristics: ["Income received at entry"],
          directionalCharacteristics: ["Requires underlying to stay below short call strike"],
          eventConsiderations:  [],
          portfolioRequirements: [],
          limitations:          [],
          nextStageRequirements: ["Expiration selection", "Strike selection"],
        };
      }
      return {
        status:   "NOT_APPLICABLE",
        reasons:  ["Bullish research thesis is not consistent with bearish credit spread structure"],
        constraintsSatisfied: satisfied,
        constraintsMissing:   ["Bearish or neutral thesis"],
        riskCharacteristics:  [],
        incomeCharacteristics: [],
        directionalCharacteristics: [],
        eventConsiderations:  [],
        portfolioRequirements: [],
        limitations:          [],
        nextStageRequirements: [],
      };
    }

    // -----------------------------------------------------------------------
    // COVERED CALL — requires underlying ownership
    // -----------------------------------------------------------------------
    case "covered_call": {
      if (!p.constraints.optionsAllowed) {
        return {
          status:   "UNAVAILABLE",
          reasons:  ["Options research is disabled in your current planning constraints."],
          constraintsSatisfied: [],
          constraintsMissing:   ["optionsAllowed = true"],
          riskCharacteristics: [], incomeCharacteristics: [],
          directionalCharacteristics: [], eventConsiderations: [],
          portfolioRequirements: [], limitations: [], nextStageRequirements: [],
        };
      }
      if (!p.portfolioAvailable || !p.ownsSymbol) {
        return {
          status:   "NOT_APPLICABLE",
          reasons:  ["No qualifying underlying position is available in the selected portfolio context. A covered call requires existing underlying shares."],
          constraintsSatisfied: ["Options research enabled"],
          constraintsMissing:   ["Existing underlying equity position"],
          riskCharacteristics:  ["Underlying equity exposure remains", "Upside participation may be limited above short call strike"],
          incomeCharacteristics: ["Premium income received against existing shares"],
          directionalCharacteristics: [],
          eventConsiderations:  [],
          portfolioRequirements: ["Requires existing underlying shares (at least 100 per contract)"],
          limitations:          ["Cannot be evaluated without confirmed underlying position"],
          nextStageRequirements: [],
        };
      }
      const satisfied = ["Options research enabled", "Underlying position confirmed in portfolio context"];
      if (p.incomeFocus) satisfied.push("Income focus preference noted");
      if (isBullish || isNeutral) {
        return {
          status:   "APPLICABLE",
          reasons:  ["Underlying position confirmed; neutral-to-bullish thesis is appropriate for covered call income research"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   [],
          riskCharacteristics:  ["Underlying equity exposure remains", "Upside participation may be limited above short call strike"],
          incomeCharacteristics: ["Premium income received against existing shares", "Reduces cost basis if shares are held"],
          directionalCharacteristics: ["Short call above current price limits upside participation"],
          eventConsiderations:  ["Events near expiration may cause unexpected assignment"],
          portfolioRequirements: ["Requires existing underlying shares (at least 100 per contract)"],
          limitations:          ["Strike selection requires contract research (2.7.3)"],
          nextStageRequirements: ["Strike selection (OTM call)", "Expiration selection", "Premium evaluation"],
        };
      }
      if (isBearish) {
        return {
          status:   "POTENTIALLY_APPLICABLE",
          reasons:  ["Bearish thesis — covered call income may offset some underlying risk, but underlying equity remains at risk"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   [],
          riskCharacteristics:  ["Underlying equity continues to carry full downside", "Short call income limited protection"],
          incomeCharacteristics: ["Premium income received against existing shares"],
          directionalCharacteristics: [],
          eventConsiderations:  [],
          portfolioRequirements: ["Requires existing underlying shares"],
          limitations:          ["A bearish thesis may conflict with continuing to hold the underlying"],
          nextStageRequirements: ["Strike selection", "Expiration selection"],
        };
      }
      return {
        status:   "POTENTIALLY_APPLICABLE",
        reasons:  ["Underlying position confirmed; thesis direction inconclusive for covered call income research"],
        constraintsSatisfied: satisfied,
        constraintsMissing:   [],
        riskCharacteristics:  ["Underlying equity exposure remains", "Upside capped above short strike"],
        incomeCharacteristics: ["Premium income against existing shares"],
        directionalCharacteristics: [],
        eventConsiderations:  [],
        portfolioRequirements: ["Requires existing underlying shares"],
        limitations:          [],
        nextStageRequirements: ["Strike selection", "Expiration selection"],
      };
    }

    // -----------------------------------------------------------------------
    // CASH-SECURED PUT
    // -----------------------------------------------------------------------
    case "cash_secured_put": {
      const satisfied = ["Options research enabled"];
      if (p.incomeFocus) satisfied.push("Income focus preference noted");
      if (isBullish || isNeutral || isVolContract) {
        return {
          status:   "APPLICABLE",
          reasons:  ["Bullish or neutral thesis is consistent with cash-secured put income research"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   [],
          riskCharacteristics:  ["Potential obligation to acquire underlying shares at strike if assigned", "Capital-intensive — requires capital sufficient to acquire shares if exercised", "Loss if underlying falls well below strike"],
          incomeCharacteristics: ["Premium income received at entry", "Income-oriented structure"],
          directionalCharacteristics: ["Implicitly bullish — seeks premium while willing to acquire shares"],
          eventConsiderations:  ["Events may accelerate assignment"],
          portfolioRequirements: [],
          limitations:          ["Exact capital requirement requires strike selection (2.7.3) — cannot be calculated without a strike price"],
          nextStageRequirements: ["Strike selection", "Expiration selection", "Cash requirement evaluation", "Contract liquidity"],
        };
      }
      if (isMixed || isUnknown) {
        return {
          status:   "POTENTIALLY_APPLICABLE",
          reasons:  ["Mixed/unknown thesis — willingness to acquire shares at a lower price should be considered carefully"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   ["Bullish or neutral thesis"],
          riskCharacteristics:  ["Capital-intensive — potential obligation to acquire shares"],
          incomeCharacteristics: ["Premium income at entry"],
          directionalCharacteristics: [],
          eventConsiderations:  [],
          portfolioRequirements: [],
          limitations:          [],
          nextStageRequirements: ["Strike selection", "Expiration selection"],
        };
      }
      return {
        status:   "NOT_APPLICABLE",
        reasons:  ["Bearish thesis is not consistent with cash-secured put income structure — willingness to acquire shares at strike is implied"],
        constraintsSatisfied: satisfied,
        constraintsMissing:   ["Bullish or neutral thesis"],
        riskCharacteristics:  ["Capital obligation if assigned"],
        incomeCharacteristics: [],
        directionalCharacteristics: [],
        eventConsiderations:  [],
        portfolioRequirements: [],
        limitations:          [],
        nextStageRequirements: [],
      };
    }

    // -----------------------------------------------------------------------
    // PROTECTIVE PUT — requires ownership
    // -----------------------------------------------------------------------
    case "protective_put": {
      if (!p.constraints.optionsAllowed) {
        return {
          status:   "UNAVAILABLE",
          reasons:  ["Options research is disabled in your current planning constraints."],
          constraintsSatisfied: [],
          constraintsMissing:   ["optionsAllowed = true"],
          riskCharacteristics: [], incomeCharacteristics: [],
          directionalCharacteristics: [], eventConsiderations: [],
          portfolioRequirements: [], limitations: [], nextStageRequirements: [],
        };
      }
      if (!p.portfolioAvailable || !p.ownsSymbol) {
        return {
          status:   "NOT_APPLICABLE",
          reasons:  ["No qualifying underlying position available. Protective put requires existing shares."],
          constraintsSatisfied: ["Options research enabled"],
          constraintsMissing:   ["Existing underlying equity position"],
          riskCharacteristics:  ["Defined downside protection for existing shares"],
          incomeCharacteristics: [],
          directionalCharacteristics: [],
          eventConsiderations:  [],
          portfolioRequirements: ["Requires existing underlying shares"],
          limitations:          ["Cannot be evaluated without confirmed underlying position"],
          nextStageRequirements: [],
        };
      }
      const satisfied = ["Options research enabled", "Underlying position confirmed"];
      return {
        status:   "APPLICABLE",
        reasons:  ["Underlying position confirmed; protective put provides defined downside protection research"],
        constraintsSatisfied: satisfied,
        constraintsMissing:   [],
        riskCharacteristics:  ["Premium cost reduces net performance of underlying", "Defined maximum downside if put held through expiration"],
        incomeCharacteristics: [],
        directionalCharacteristics: ["Allows continued upside participation on underlying shares"],
        eventConsiderations:  ["Events may accelerate premium cost or assignment"],
        portfolioRequirements: ["Requires existing underlying shares"],
        limitations:          ["Strike selection determines protection level — requires contract research (2.7.3)"],
        nextStageRequirements: ["Strike selection (protection level)", "Expiration selection", "Premium cost evaluation"],
      };
    }

    // -----------------------------------------------------------------------
    // COLLAR — requires ownership
    // -----------------------------------------------------------------------
    case "collar": {
      if (!p.constraints.optionsAllowed) {
        return {
          status:   "UNAVAILABLE",
          reasons:  ["Options research is disabled in your current planning constraints."],
          constraintsSatisfied: [],
          constraintsMissing:   ["optionsAllowed = true"],
          riskCharacteristics: [], incomeCharacteristics: [],
          directionalCharacteristics: [], eventConsiderations: [],
          portfolioRequirements: [], limitations: [], nextStageRequirements: [],
        };
      }
      if (!p.portfolioAvailable || !p.ownsSymbol) {
        return {
          status:   "NOT_APPLICABLE",
          reasons:  ["No qualifying underlying position available. Collar requires existing shares."],
          constraintsSatisfied: ["Options research enabled"],
          constraintsMissing:   ["Existing underlying equity position"],
          riskCharacteristics:  [],
          incomeCharacteristics: [],
          directionalCharacteristics: [],
          eventConsiderations:  [],
          portfolioRequirements: ["Requires existing underlying shares"],
          limitations:          ["Cannot be evaluated without confirmed underlying position"],
          nextStageRequirements: [],
        };
      }
      const satisfied = ["Options research enabled", "Underlying position confirmed"];
      if (p.incomeFocus) satisfied.push("Income focus noted");
      return {
        status:   "APPLICABLE",
        reasons:  ["Underlying position confirmed; collar provides bounded risk and income research"],
        constraintsSatisfied: satisfied,
        constraintsMissing:   [],
        riskCharacteristics:  ["Upside capped at short call strike", "Downside protected by long put", "Net structure may be near-zero cost depending on strikes"],
        incomeCharacteristics: ["Short call premium received may offset put cost"],
        directionalCharacteristics: ["Bounded range: protective put floor, capped upside"],
        eventConsiderations:  ["Events may cause unexpected assignment on short call"],
        portfolioRequirements: ["Requires existing underlying shares (at least 100 per contract)"],
        limitations:          ["Strike combination requires contract research (2.7.3)"],
        nextStageRequirements: ["Short call strike selection", "Long put strike selection", "Net debit/credit evaluation"],
      };
    }

    // -----------------------------------------------------------------------
    // IRON CONDOR
    // -----------------------------------------------------------------------
    case "iron_condor": {
      const satisfied = ["Options research enabled", "Defined-risk structure"];
      if (p.hasDefinedRiskPref) satisfied.push("Defined-risk preference satisfied");
      if (p.incomeFocus) satisfied.push("Income focus noted");
      if (isNeutral || isVolContract || isVolExp /* range-bound within vol */){
        // Bearish event + avoid earnings → potentially applicable
        const evtNote = insideEventWindow
          ? "Event window detected — short-term directional move risk may invalidate range-bound assumption"
          : "";
        if (insideEventWindow) {
          return {
            status:   "POTENTIALLY_APPLICABLE",
            reasons:  ["Range-bound thesis noted; however inside potential event window — event can break the expected range"],
            constraintsSatisfied: satisfied,
            constraintsMissing:   [],
            riskCharacteristics:  ["Defined-risk: max loss = width of wider spread minus net credit", "Loss if underlying moves outside the condor wings"],
            incomeCharacteristics: ["Net credit received", "Full credit retained if underlying stays within range at expiration"],
            directionalCharacteristics: ["Profits from stability — no significant directional move"],
            eventConsiderations:  [evtNote, "Events can break range-bound assumption"],
            portfolioRequirements: [],
            limitations:          ["Event window may invalidate range-bound thesis"],
            nextStageRequirements: ["Strike selection (4 strikes)", "Expiration selection", "Credit/risk evaluation"],
          };
        }
        return {
          status:   "APPLICABLE",
          reasons:  ["Neutral/range-bound or vol-contraction thesis aligns with iron condor range-bound income structure"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   [],
          riskCharacteristics:  ["Defined-risk: max loss = spread width minus net credit received", "Loss if underlying moves outside the condor range"],
          incomeCharacteristics: ["Net credit received at entry", "Income strategy — profits from underlying staying within range"],
          directionalCharacteristics: ["Non-directional — profits from price stability within defined range"],
          eventConsiderations:  ["Large events can break the expected range"],
          portfolioRequirements: [],
          limitations:          ["4-leg structure requires careful strike coordination in contract research"],
          nextStageRequirements: ["4 strike selections (call spread + put spread)", "Expiration selection", "Net credit evaluation"],
        };
      }
      if (isBullish || isBearish) {
        return {
          status:   "NOT_APPLICABLE",
          reasons:  [`Strong directional thesis (${THESIS_DIRECTION_LABELS[p.direction]}) conflicts with iron condor range-bound structure`],
          constraintsSatisfied: satisfied,
          constraintsMissing:   ["Neutral or range-bound thesis"],
          riskCharacteristics:  [],
          incomeCharacteristics: [],
          directionalCharacteristics: [],
          eventConsiderations:  [],
          portfolioRequirements: [],
          limitations:          [],
          nextStageRequirements: [],
        };
      }
      return {
        status:   "POTENTIALLY_APPLICABLE",
        reasons:  ["Thesis direction unclear — iron condor may be worth researching if market conditions stabilize"],
        constraintsSatisfied: satisfied,
        constraintsMissing:   ["Neutral or range-bound thesis"],
        riskCharacteristics:  ["Defined-risk structure"],
        incomeCharacteristics: ["Net credit structure"],
        directionalCharacteristics: [],
        eventConsiderations:  [],
        portfolioRequirements: [],
        limitations:          ["Unclear thesis direction reduces confidence"],
        nextStageRequirements: ["Strike selection", "Expiration selection"],
      };
    }

    // -----------------------------------------------------------------------
    // IRON BUTTERFLY
    // -----------------------------------------------------------------------
    case "iron_butterfly": {
      const satisfied = ["Options research enabled", "Defined-risk structure"];
      if (p.hasDefinedRiskPref) satisfied.push("Defined-risk preference satisfied");
      if (p.incomeFocus) satisfied.push("Income focus noted");
      if (isNeutral || isVolContract) {
        return {
          status:   "APPLICABLE",
          reasons:  ["Neutral/vol-contraction thesis aligns with iron butterfly tight-range income structure"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   [],
          riskCharacteristics:  ["Defined-risk: max loss at wing strikes", "Higher credit than iron condor but narrower range for full profit"],
          incomeCharacteristics: ["Higher net credit than condor", "Full credit retained only if underlying near ATM at expiration"],
          directionalCharacteristics: ["Very tight range — requires underlying near a specific price at expiration"],
          eventConsiderations:  ["Events can easily move underlying outside the narrow range"],
          portfolioRequirements: [],
          limitations:          ["ATM strike selection critical — requires contract research (2.7.3)"],
          nextStageRequirements: ["ATM body strike", "Wing strikes", "Expiration selection", "Net credit evaluation"],
        };
      }
      if (isBullish || isBearish) {
        return {
          status:   "NOT_APPLICABLE",
          reasons:  [`Strong directional thesis (${THESIS_DIRECTION_LABELS[p.direction]}) conflicts with iron butterfly tight-range structure`],
          constraintsSatisfied: satisfied,
          constraintsMissing:   ["Neutral thesis with very stable price expectation"],
          riskCharacteristics: [], incomeCharacteristics: [],
          directionalCharacteristics: [], eventConsiderations: [],
          portfolioRequirements: [], limitations: [], nextStageRequirements: [],
        };
      }
      return {
        status:   "POTENTIALLY_APPLICABLE",
        reasons:  ["Thesis direction unclear — iron butterfly requires tight range-bound conditions"],
        constraintsSatisfied: satisfied,
        constraintsMissing:   ["Neutral or very stable range-bound thesis"],
        riskCharacteristics:  ["Defined-risk — very tight range"],
        incomeCharacteristics: ["High credit potential"],
        directionalCharacteristics: [],
        eventConsiderations:  [],
        portfolioRequirements: [],
        limitations:          [],
        nextStageRequirements: ["ATM strike", "Wing strikes", "Expiration selection"],
      };
    }

    // -----------------------------------------------------------------------
    // LONG STRADDLE
    // -----------------------------------------------------------------------
    case "long_straddle": {
      const satisfied = ["Options research enabled"];
      if (isVolExp || (p.eventCtx?.hasUpcomingEvent && p.eventCtx.insideEventWindow)) {
        satisfied.push("Volatility expansion or event context supports long straddle research");
        return {
          status:   "APPLICABLE",
          reasons:  ["Volatility expansion or upcoming event creates potential for large move in either direction"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   [],
          riskCharacteristics:  ["Defined premium at risk (combined call + put cost)", "Requires significant move in either direction to be profitable", "Time decay erodes value if underlying does not move"],
          incomeCharacteristics: [],
          directionalCharacteristics: ["Non-directional — profits from large move in either direction"],
          eventConsiderations:  ["Designed for anticipated large move — earnings/events may be catalysts", "Post-event IV crush can cause losses even if underlying moves as expected"],
          portfolioRequirements: [],
          limitations:          ["Premium cost at ATM strike may be elevated near events — evaluate carefully in contract research"],
          nextStageRequirements: ["ATM strike selection", "Expiration selection", "Combined premium evaluation"],
        };
      }
      if (isMixed || isUnknown) {
        return {
          status:   "POTENTIALLY_APPLICABLE",
          reasons:  ["Mixed/unknown thesis — straddle could be considered if large move is anticipated without directional conviction"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   ["Volatility expansion or event catalyst"],
          riskCharacteristics:  ["Defined premium at risk", "Requires significant move for profitability"],
          incomeCharacteristics: [],
          directionalCharacteristics: ["Non-directional"],
          eventConsiderations:  [],
          portfolioRequirements: [],
          limitations:          ["Without clear volatility or event catalyst, cost of straddle may be difficult to recover"],
          nextStageRequirements: ["ATM strike", "Expiration", "Premium evaluation"],
        };
      }
      if (p.incomeFocus || isVolContract) {
        return {
          status:   "NOT_APPLICABLE",
          reasons:  ["Income focus or volatility contraction thesis is not consistent with long volatility straddle structure"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   ["Volatility expansion or event catalyst"],
          riskCharacteristics: [], incomeCharacteristics: [],
          directionalCharacteristics: [], eventConsiderations: [],
          portfolioRequirements: [], limitations: [], nextStageRequirements: [],
        };
      }
      return {
        status:   "POTENTIALLY_APPLICABLE",
        reasons:  ["Directional thesis reduces alignment — straddle thrives on large moves regardless of direction"],
        constraintsSatisfied: satisfied,
        constraintsMissing:   ["Volatility expansion or event context"],
        riskCharacteristics:  ["Defined premium at risk", "Requires large move"],
        incomeCharacteristics: [],
        directionalCharacteristics: ["Non-directional"],
        eventConsiderations:  [],
        portfolioRequirements: [],
        limitations:          [],
        nextStageRequirements: ["ATM strike", "Expiration", "Premium evaluation"],
      };
    }

    // -----------------------------------------------------------------------
    // LONG STRANGLE
    // -----------------------------------------------------------------------
    case "long_strangle": {
      const satisfied = ["Options research enabled"];
      if (isVolExp || (p.eventCtx?.hasUpcomingEvent && p.eventCtx.insideEventWindow)) {
        satisfied.push("Volatility expansion or event context");
        return {
          status:   "APPLICABLE",
          reasons:  ["Volatility expansion or upcoming event supports long strangle (wider strikes, lower cost than straddle)"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   [],
          riskCharacteristics:  ["Defined premium at risk (OTM call + OTM put)", "Requires larger move than straddle to profit", "Lower premium cost than straddle — wider breakevens"],
          incomeCharacteristics: [],
          directionalCharacteristics: ["Non-directional — profits from large move in either direction"],
          eventConsiderations:  ["Lower cost than straddle near events", "Post-event IV crush still a risk"],
          portfolioRequirements: [],
          limitations:          ["OTM strike selection requires contract research (2.7.3)"],
          nextStageRequirements: ["OTM call strike", "OTM put strike", "Expiration selection", "Premium evaluation"],
        };
      }
      if (isMixed || isUnknown) {
        return {
          status:   "POTENTIALLY_APPLICABLE",
          reasons:  ["Mixed/unknown thesis — strangle could be considered with large-move expectation without directional conviction"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   ["Volatility expansion or event catalyst"],
          riskCharacteristics:  ["Defined premium at risk", "Requires large move to profit"],
          incomeCharacteristics: [],
          directionalCharacteristics: ["Non-directional"],
          eventConsiderations:  [],
          portfolioRequirements: [],
          limitations:          [],
          nextStageRequirements: ["OTM strikes", "Expiration", "Premium evaluation"],
        };
      }
      return {
        status:   "NOT_APPLICABLE",
        reasons:  [`Thesis (${THESIS_DIRECTION_LABELS[p.direction]}) does not support long volatility structure — strangle requires expected large move`],
        constraintsSatisfied: satisfied,
        constraintsMissing:   ["Volatility expansion or event catalyst"],
        riskCharacteristics: [], incomeCharacteristics: [],
        directionalCharacteristics: [], eventConsiderations: [],
        portfolioRequirements: [], limitations: [], nextStageRequirements: [],
      };
    }

    // -----------------------------------------------------------------------
    // CALENDAR SPREAD
    // -----------------------------------------------------------------------
    case "calendar_spread": {
      const satisfied = ["Options research enabled"];
      if (horizonLong) satisfied.push("Medium/long research horizon supports calendar structure");
      if (isNeutral || isVolContract) {
        const horizonNote = horizonShort ? "Short horizon may reduce effectiveness of calendar time-decay structure" : "";
        return {
          status:   horizonShort ? "POTENTIALLY_APPLICABLE" : "APPLICABLE",
          reasons:  ["Neutral/stable thesis and time-decay expectations align with calendar spread"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   [],
          riskCharacteristics:  ["Maximum loss is net debit paid", "Complex time-decay dynamics across two expirations", "Early expiration can expire worthless if underlying moves sharply"],
          incomeCharacteristics: [],
          directionalCharacteristics: ["Generally non-directional at entry; profits from time decay differential"],
          eventConsiderations:  ["Events near front-month expiration may spike front-month premium"],
          portfolioRequirements: [],
          limitations:          [horizonNote, "Dual-expiration structure requires contract research (2.7.3)"].filter(Boolean),
          nextStageRequirements: ["Near-term expiration (short)", "Far-term expiration (long)", "Same strike selection", "Net debit evaluation"],
        };
      }
      if (isBullish || isBearish) {
        return {
          status:   "POTENTIALLY_APPLICABLE",
          reasons:  ["Directional thesis reduces alignment — calendar spreads are typically near-neutral at entry"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   ["Neutral thesis or medium/long horizon"],
          riskCharacteristics:  ["Dual-expiration complexity", "Defined debit risk"],
          incomeCharacteristics: [],
          directionalCharacteristics: [],
          eventConsiderations:  [],
          portfolioRequirements: [],
          limitations:          [],
          nextStageRequirements: ["Expiration selection (near + far)", "Strike selection"],
        };
      }
      return {
        status:   "POTENTIALLY_APPLICABLE",
        reasons:  ["Thesis direction unclear — calendar spread is an option worth researching for time-decay scenarios"],
        constraintsSatisfied: satisfied,
        constraintsMissing:   [],
        riskCharacteristics:  ["Defined debit risk"],
        incomeCharacteristics: [],
        directionalCharacteristics: [],
        eventConsiderations:  [],
        portfolioRequirements: [],
        limitations:          [],
        nextStageRequirements: ["Expiration selection", "Strike selection"],
      };
    }

    // -----------------------------------------------------------------------
    // DIAGONAL SPREAD
    // -----------------------------------------------------------------------
    case "diagonal_spread": {
      const satisfied = ["Options research enabled"];
      if (horizonLong) satisfied.push("Longer research horizon supports diagonal structure");
      if (isBullish) {
        return {
          status:   "APPLICABLE",
          reasons:  ["Bullish thesis with medium/long horizon is consistent with diagonal spread research"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   [],
          riskCharacteristics:  ["Net debit structure", "Complex two-expiration dynamics", "Defined maximum loss (net debit)"],
          incomeCharacteristics: ["Short-term option income can offset long-option cost over time"],
          directionalCharacteristics: ["Directional component — profits from bullish move combined with time-decay income"],
          eventConsiderations:  ["Events near short-leg expiration increase complexity"],
          portfolioRequirements: [],
          limitations:          ["Two-leg, two-expiration structure requires careful contract research (2.7.3)"],
          nextStageRequirements: ["Far-term long option (LEAPS or longer)", "Near-term short option strike and expiration", "Net debit evaluation"],
        };
      }
      if (isBearish) {
        return {
          status:   "APPLICABLE",
          reasons:  ["Bearish thesis with longer horizon is consistent with diagonal put spread research"],
          constraintsSatisfied: satisfied,
          constraintsMissing:   [],
          riskCharacteristics:  ["Defined debit risk", "Complex time dynamics"],
          incomeCharacteristics: [],
          directionalCharacteristics: ["Bearish directional with time-income component"],
          eventConsiderations:  [],
          portfolioRequirements: [],
          limitations:          ["Two-leg structure requires contract research"],
          nextStageRequirements: ["Far-term long put", "Near-term short put", "Expiration selection"],
        };
      }
      return {
        status:   "POTENTIALLY_APPLICABLE",
        reasons:  ["Diagonal spread can be explored for directional thesis with time-income component — thesis clarity needed"],
        constraintsSatisfied: satisfied,
        constraintsMissing:   ["Directional thesis (bullish or bearish)", "Medium or long research horizon"],
        riskCharacteristics:  ["Defined debit risk", "Complex two-leg structure"],
        incomeCharacteristics: [],
        directionalCharacteristics: [],
        eventConsiderations:  [],
        portfolioRequirements: [],
        limitations:          ["Two-leg structure; unclear thesis reduces applicability"],
        nextStageRequirements: ["Directional confirmation", "Expiration selection"],
      };
    }

    // -----------------------------------------------------------------------
    // MONITOR ONLY
    // -----------------------------------------------------------------------
    case "monitor_only":
    default:
      return {
        status:   "APPLICABLE",
        reasons:  ["Monitor Only is always available regardless of thesis direction or options permission"],
        constraintsSatisfied: ["Always available"],
        constraintsMissing:   [],
        riskCharacteristics:  ["No market exposure from monitoring alone"],
        incomeCharacteristics: [],
        directionalCharacteristics: [],
        eventConsiderations:  [],
        portfolioRequirements: [],
        limitations:          [],
        nextStageRequirements: [],
      };
  }
}

// ===========================================================================
// 6. Full Evaluation
// ===========================================================================

export function evaluateAllStrategyFamilies(
  ctx: TradePlanningContext,
  constraints: TradePlanningConstraints,
): {
  matches: OptionsStrategyMatch[];
  direction: ThesisDirection;
  directionReasoning: string[];
  volatility: VolatilityContext;
  liquidity: LiquidityContext;
  eventCtx: EventContext | null;
  portfolioOwnership: "owned" | "not_owned" | "unknown";
} {
  const { direction, reasoning: directionReasoning } = deriveThesisDirection(ctx);
  const volatility = deriveVolatilityContext(ctx);
  const liquidity  = deriveLiquidityContext(ctx);
  const eventCtx   = deriveEventContext(ctx);

  const portfolioAvailable = !!(ctx.portfolioContext);
  const ownsSymbol         = ctx.portfolioContext?.ownsSymbol ?? false;
  const portfolioOwnership: "owned" | "not_owned" | "unknown" =
    portfolioAvailable ? (ownsSymbol ? "owned" : "not_owned") : "unknown";

  // Merge income/directional focus from constraints + goal
  const incomeFocus     = !!(constraints.incomeFocus    || ctx.goalContext?.incomeFocused);
  const directionalFocus = !!(constraints.directionalFocus);
  const optionsInterest  = !!(ctx.goalContext?.optionsInterest);
  const avoidEarnings    = !!(constraints.avoidEarningsWindow);
  const hasDefinedRiskPref = !!(constraints.definedRiskPreferred);

  const fingerprint = validateConstraints(constraints) ? JSON.stringify({
    o: constraints.optionsAllowed,
    d: constraints.definedRiskPreferred,
    i: constraints.incomeFocus,
    df: constraints.directionalFocus,
    ae: constraints.avoidEarningsWindow,
  }) : "default";

  const params: EvaluationParams = {
    direction, horizon: ctx.researchHorizon, volatility, liquidity, eventCtx,
    ownsSymbol, portfolioAvailable, constraints,
    incomeFocus, directionalFocus, optionsInterest, avoidEarnings, hasDefinedRiskPref,
  };

  const matches: OptionsStrategyMatch[] = ALL_OPTIONS_STRATEGY_FAMILIES.map(family => {
    const partial = evaluateFamily(family, params);
    const category = STRATEGY_FAMILY_CATEGORY[family];
    const contractInput: OptionsContractResearchInput | null =
      partial.status === "APPLICABLE" || partial.status === "POTENTIALLY_APPLICABLE"
        ? buildContractResearchInput(ctx, family, direction, volatility, liquidity, eventCtx, fingerprint)
        : null;

    return {
      strategyFamily:              family,
      strategyLabel:               STRATEGY_FAMILY_LABELS[family],
      strategyCategory:            category,
      strategyCategoryLabel:       STRATEGY_CATEGORY_LABELS[category],
      status:                      partial.status,
      statusLabel:                 STRATEGY_MATCH_STATUS_LABELS[partial.status],
      reasons:                     partial.reasons,
      constraintsSatisfied:        partial.constraintsSatisfied,
      constraintsMissing:          partial.constraintsMissing,
      riskCharacteristics:         partial.riskCharacteristics,
      incomeCharacteristics:       partial.incomeCharacteristics,
      directionalCharacteristics:  partial.directionalCharacteristics,
      eventConsiderations:         partial.eventConsiderations,
      portfolioRequirements:       partial.portfolioRequirements,
      limitations:                 partial.limitations,
      structure:                   getFamilyStructure(family),
      nextStageRequirements:       partial.nextStageRequirements,
      contractResearchInput:       contractInput,
    };
  });

  return { matches, direction, directionReasoning, volatility, liquidity, eventCtx, portfolioOwnership };
}

// ===========================================================================
// 7. Structure descriptions (generic, no actual contracts)
// ===========================================================================

import type { StrategyStructureDescription } from "../../shared/options-strategy-types";

function getFamilyStructure(family: OptionsStrategyFamily): StrategyStructureDescription {
  const STRUCTURES: Record<OptionsStrategyFamily, StrategyStructureDescription> = {
    long_call:        { legCount: 1, legLabels: ["Long call"],                                          premiumDirection: "paid",     isDefinedRisk: true,  isIncomeFocused: false, isDirectional: true,  requiresOwnership: false },
    long_put:         { legCount: 1, legLabels: ["Long put"],                                           premiumDirection: "paid",     isDefinedRisk: true,  isIncomeFocused: false, isDirectional: true,  requiresOwnership: false },
    bull_call_spread: { legCount: 2, legLabels: ["Long lower-strike call", "Short higher-strike call"], premiumDirection: "paid",     isDefinedRisk: true,  isIncomeFocused: false, isDirectional: true,  requiresOwnership: false },
    bear_put_spread:  { legCount: 2, legLabels: ["Long higher-strike put", "Short lower-strike put"],   premiumDirection: "paid",     isDefinedRisk: true,  isIncomeFocused: false, isDirectional: true,  requiresOwnership: false },
    bull_put_spread:  { legCount: 2, legLabels: ["Short higher-strike put", "Long lower-strike put"],   premiumDirection: "received", isDefinedRisk: true,  isIncomeFocused: true,  isDirectional: true,  requiresOwnership: false },
    bear_call_spread: { legCount: 2, legLabels: ["Short lower-strike call", "Long higher-strike call"], premiumDirection: "received", isDefinedRisk: true,  isIncomeFocused: true,  isDirectional: true,  requiresOwnership: false },
    covered_call:     { legCount: 2, legLabels: ["Long underlying shares", "Short OTM call"],           premiumDirection: "received", isDefinedRisk: false, isIncomeFocused: true,  isDirectional: false, requiresOwnership: true  },
    cash_secured_put: { legCount: 1, legLabels: ["Short put (cash-secured)"],                          premiumDirection: "received", isDefinedRisk: false, isIncomeFocused: true,  isDirectional: true,  requiresOwnership: false },
    protective_put:   { legCount: 2, legLabels: ["Long underlying shares", "Long put"],                premiumDirection: "paid",     isDefinedRisk: true,  isIncomeFocused: false, isDirectional: false, requiresOwnership: true  },
    collar:           { legCount: 3, legLabels: ["Long underlying shares", "Long put", "Short call"],   premiumDirection: "neutral",  isDefinedRisk: true,  isIncomeFocused: true,  isDirectional: false, requiresOwnership: true  },
    iron_condor:      { legCount: 4, legLabels: ["Short OTM put", "Long further OTM put", "Short OTM call", "Long further OTM call"], premiumDirection: "received", isDefinedRisk: true, isIncomeFocused: true, isDirectional: false, requiresOwnership: false },
    iron_butterfly:   { legCount: 4, legLabels: ["Short ATM put", "Long lower put", "Short ATM call", "Long higher call"],           premiumDirection: "received", isDefinedRisk: true, isIncomeFocused: true, isDirectional: false, requiresOwnership: false },
    long_straddle:    { legCount: 2, legLabels: ["Long ATM call", "Long ATM put"],                     premiumDirection: "paid",     isDefinedRisk: true,  isIncomeFocused: false, isDirectional: false, requiresOwnership: false },
    long_strangle:    { legCount: 2, legLabels: ["Long OTM call", "Long OTM put"],                     premiumDirection: "paid",     isDefinedRisk: true,  isIncomeFocused: false, isDirectional: false, requiresOwnership: false },
    calendar_spread:  { legCount: 2, legLabels: ["Short near-term option", "Long far-term same-strike option"], premiumDirection: "paid", isDefinedRisk: true, isIncomeFocused: false, isDirectional: false, requiresOwnership: false },
    diagonal_spread:  { legCount: 2, legLabels: ["Long far-term option", "Short near-term different-strike option"], premiumDirection: "paid", isDefinedRisk: true, isIncomeFocused: false, isDirectional: true, requiresOwnership: false },
    monitor_only:     { legCount: 0, legLabels: [],                                                    premiumDirection: "neutral",  isDefinedRisk: true,  isIncomeFocused: false, isDirectional: false, requiresOwnership: false },
  };
  return STRUCTURES[family];
}

// ===========================================================================
// 8. Build full OptionsStrategyMatchResult
// ===========================================================================

export function buildOptionsStrategyMatchResult(
  ctx: TradePlanningContext,
  constraints: TradePlanningConstraints,
): OptionsStrategyMatchResult {
  const t0 = Date.now();
  _health.optionsMatchRequests++;

  try {
    const {
      matches, direction, directionReasoning, volatility, liquidity, eventCtx, portfolioOwnership,
    } = evaluateAllStrategyFamilies(ctx, constraints);

    const fingerprint = validateConstraints(constraints)
      ? `${constraints.optionsAllowed ? "1" : "0"}|${constraints.definedRiskPreferred ? "1" : "0"}|${constraints.incomeFocus ? "1" : "0"}`
      : "default";

    const applicableCount  = matches.filter(m => m.status === "APPLICABLE").length;
    const potentialCount   = matches.filter(m => m.status === "POTENTIALLY_APPLICABLE").length;
    const notApplicableCount = matches.filter(m => m.status === "NOT_APPLICABLE").length;
    const unavailableCount = matches.filter(m => m.status === "UNAVAILABLE").length;

    const limitations: string[] = [];
    if (volatility.level === "UNKNOWN")
      limitations.push("Implied volatility data unavailable — volatility-sensitive strategy considerations are limited.");
    if (liquidity.availability === "UNKNOWN")
      limitations.push("Options chain liquidity not evaluated at this stage — assess in Contract Research (2.7.3).");
    if (!ctx.portfolioContext)
      limitations.push("No portfolio connected — strategies requiring underlying position ownership are not applicable.");
    if (!ctx.goalContext)
      limitations.push("No research goal linked — goal-based strategy preferences not applied.");
    if (eventCtx && eventCtx.insideEventWindow && eventCtx.daysUntilEvent === null)
      limitations.push("Earnings/event risk detected in research evidence but exact date unavailable — treated conservatively.");

    const partial = limitations.length > 0;

    const freshness = buildFreshness(ctx);
    const latencyMs = Date.now() - t0;

    _health.optionsMatchesCompleted++;
    if (partial) _health.partialOptionsMatches++;
    _health.totalLatencyMs += latencyMs;
    _health.matchCount++;
    _health.lastSuccessfulOptionsMatchAt = new Date().toISOString();

    return {
      id:                             randomUUID(),
      planningContextId:              ctx.id,
      symbol:                         ctx.symbol,
      generatedAt:                    new Date().toISOString(),

      thesisDirection:                direction,
      thesisDirectionLabel:           THESIS_DIRECTION_LABELS[direction],
      thesisDirectionReasoning:       directionReasoning,
      researchHorizon:                ctx.researchHorizon ?? null,
      marketRegime:                   ctx.marketRegime ?? null,

      volatilityContext:              volatility,
      liquidityContext:               liquidity,
      eventContext:                   eventCtx,
      portfolioOwnership,
      goalContextLabel:               ctx.goalContext?.goalName ?? null,

      matches,
      applicableCount,
      potentialCount,
      notApplicableCount,
      unavailableCount,
      limitations,
      freshness,
      disclaimer:                     OPTIONS_STRATEGY_DISCLAIMER,
      optionsRiskDisclosure:          OPTIONS_RISK_DISCLOSURE,
      methodologyVersion:             OPTIONS_MATCHING_VERSION,
      planningConstraintsFingerprint: fingerprint,
      generationLatencyMs:            latencyMs,
    };
  } catch (err) {
    _health.failedOptionsMatches++;
    throw err;
  }
}
