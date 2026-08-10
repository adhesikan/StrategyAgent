/**
 * Trade Planning Service — Sprint 2.7.0
 *
 * Builds canonical TradePlanningContext from authoritative research services.
 * Evaluates research expression family eligibility deterministically.
 *
 * ARCHITECTURE CONTRACT:
 *   This service bridges Research → Trade Planning.
 *   It does NOT:
 *     - Score or rank opportunities
 *     - Select strikes, expirations, or contracts
 *     - Construct orders
 *     - Submit to brokers
 *     - Generate recommendations
 *     - Perform suitability assessments
 *
 * SERVER AUTHORITATIVE:
 *   Client NEVER submits research scores, qualification status, or portfolio
 *   weights. Server reconstructs all authoritative context from canonical
 *   services. Client submits only: constraints, goalId, portfolioId, family.
 *
 * PERFORMANCE TARGETS:
 *   - Context build: <500ms warm (reuses OppIntel, Goal, Portfolio caches)
 *   - Expression evaluation: <100ms after context assembled
 */

import { db } from "../db";
import { tradePlanningSessions } from "../../shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  getCanonicalOpportunity,
} from "./opportunity-intelligence-service";
import type { CanonicalOpportunity } from "../../shared/opportunity-intelligence-types";
import type {
  TradePlanningContext,
  TradePlanningSession,
  TradePlanningConstraints,
  TradePlanningHealthMetrics,
  ExpressionFamilyResult,
  ExpressionFamily,
  ExpressionStatus,
  PlanningFreshness,
  PlanningPortfolioContext,
  PlanningGoalContext,
} from "../../shared/trade-planning-types";
import {
  EXPRESSION_FAMILIES,
  EXPRESSION_FAMILY_LABELS,
  EXPRESSION_FAMILY_DESCRIPTIONS,
  DEFAULT_CONSTRAINTS,
  constraintsFingerprint,
  validateConstraints,
} from "../../shared/trade-planning-types";

// ---------------------------------------------------------------------------
// In-memory platform health metrics
// ---------------------------------------------------------------------------

let _healthMetrics: TradePlanningHealthMetrics = {
  contextsBuilt:           0,
  sessionsCreated:         0,
  expressionEvaluations:   0,
  partialContexts:         0,
  failedContexts:          0,
  averageContextLatencyMs: null,
  lastSuccessfulContextAt: null,
};
let _latencySum = 0;
let _latencyCount = 0;

function recordContextBuilt(durationMs: number, partial: boolean): void {
  _healthMetrics.contextsBuilt++;
  if (partial) _healthMetrics.partialContexts++;
  _latencySum += durationMs;
  _latencyCount++;
  _healthMetrics.averageContextLatencyMs = Math.round(_latencySum / _latencyCount);
  _healthMetrics.lastSuccessfulContextAt = new Date().toISOString();
}

function recordContextFailed(): void {
  _healthMetrics.failedContexts++;
}

export function getTradePlanningHealth(): TradePlanningHealthMetrics {
  return { ..._healthMetrics };
}

// ---------------------------------------------------------------------------
// Context cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  context: TradePlanningContext;
  expiresAt: number;
}

const contextCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function contextCacheKey(
  userId: string,
  symbol: string,
  oppId: string,
  goalId?: string | null,
  portfolioId?: string | null,
  constraintsKey?: string,
): string {
  return `${userId}:${symbol}:${oppId}:${goalId ?? ""}:${portfolioId ?? ""}:${constraintsKey ?? ""}`;
}

function getCachedContext(key: string): TradePlanningContext | null {
  const entry = contextCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    contextCache.delete(key);
    return null;
  }
  return entry.context;
}

function setCachedContext(key: string, context: TradePlanningContext): void {
  contextCache.set(key, { context, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Freshness helpers
// ---------------------------------------------------------------------------

function computeFreshness(updatedAt: string | null | undefined): PlanningFreshness {
  if (!updatedAt) {
    return { status: "unavailable", label: "Unavailable" };
  }
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const ageMin = Math.floor(ageMs / 60000);
  if (ageMin < 30) {
    return { status: "fresh", label: `${ageMin}m ago`, ageMinutes: ageMin, updatedAt };
  }
  if (ageMin < 4 * 60) {
    return { status: "aging", label: `${ageMin}m ago`, ageMinutes: ageMin, updatedAt };
  }
  if (ageMin < 24 * 60) {
    const h = Math.floor(ageMin / 60);
    return { status: "stale", label: `${h}h ago`, ageMinutes: ageMin, updatedAt };
  }
  const d = Math.floor(ageMin / 1440);
  return { status: "stale", label: `${d}d ago`, ageMinutes: ageMin, updatedAt };
}

function unavailableFreshness(): PlanningFreshness {
  return { status: "unavailable", label: "Not available" };
}

// ---------------------------------------------------------------------------
// Goal context assembly
// ---------------------------------------------------------------------------

async function loadGoalContext(
  userId: string,
  goalId: string,
  opp: CanonicalOpportunity,
): Promise<PlanningGoalContext | null> {
  try {
    const { getGoalById, matchOpportunityToGoal } = await import("./research-goal-service");
    const goal = await getGoalById(userId, goalId);
    if (!goal) return null;

    const matchResult = matchOpportunityToGoal(
      {
        symbol:          opp.symbol,
        companyName:     opp.companyName,
        sector:          opp.sector,
        themes:          opp.themes,
        opportunityType: opp.opportunityType,
        timeHorizon:     opp.timeHorizon,
        riskLevel:       opp.riskLevel,
      },
      goal,
    );

    return {
      goalId:          goal.id,
      goalName:        goal.name,
      goalType:        goal.goalType,
      horizon:         goal.horizon,
      researchStyle:   goal.researchStyle,
      incomeFocused:   ["income", "dividend_income", "options_income"].includes(goal.goalType),
      optionsInterest: goal.optionsInterest,
      preferredThemes: goal.preferredThemes,
      matchState:      matchResult.matchState,
      freshness:       computeFreshness(goal.updatedAt),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Portfolio context assembly
// ---------------------------------------------------------------------------

async function loadPortfolioContext(
  userId: string,
  portfolioId: string,
  symbol: string,
): Promise<PlanningPortfolioContext | null> {
  try {
    const { db: dbInst } = await import("../db");
    const { portfolioPositions } = await import("../../shared/schema");

    // Check if the user owns this portfolio
    const portfolios = await dbInst.query.portfolios?.findMany?.({
      where: (p: any, { and, eq }: any) => and(eq(p.userId, userId), eq(p.id, portfolioId)),
      limit: 1,
    }).catch(() => null);

    if (!portfolios || portfolios.length === 0) return null;
    const portfolio = portfolios[0];

    // Find position in this symbol
    const positions = await dbInst
      .select()
      .from(portfolioPositions)
      .where(
        and(
          eq(portfolioPositions.portfolioId as any, portfolioId),
          eq(portfolioPositions.symbol as any, symbol.toUpperCase()),
        ),
      )
      .limit(1)
      .catch(() => []);

    const position = positions[0] ?? null;
    const ownsSymbol = !!position;

    return {
      portfolioId,
      portfolioName:       portfolio.name ?? "Portfolio",
      ownsSymbol,
      positionSize:        position ? (position as any).quantity ?? undefined : undefined,
      portfolioWeight:     position ? (position as any).portfolioWeight ?? undefined : undefined,
      costBasis:           position ? (position as any).averageCost ?? null : null,
      currentExposure:     position ? (position as any).marketValue ?? null : null,
      concentrationNote:   null,
      recentResearchChange: null,
      freshness:           computeFreshness(portfolio.updatedAt),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Expression family eligibility
// ---------------------------------------------------------------------------

/**
 * Evaluate each research expression family deterministically.
 * Returns categorical status — NO numeric scores, NO "recommended" language.
 * No AI needed for eligibility.
 */
export function evaluateExpressionFamilies(
  opp: CanonicalOpportunity,
  constraints: TradePlanningConstraints,
  goalContext?: PlanningGoalContext | null,
  portfolioContext?: PlanningPortfolioContext | null,
): ExpressionFamilyResult[] {
  const startMs = Date.now();
  const results: ExpressionFamilyResult[] = [];
  const type  = opp.opportunityType?.toLowerCase() ?? "";
  const risk  = opp.riskLevel?.toLowerCase() ?? "";
  const horiz = opp.timeHorizon?.toLowerCase() ?? "";

  const isGrowth   = type.includes("growth") || type.includes("vcp") || type.includes("momentum");
  const isIncome   = type.includes("income") || type.includes("covered") || type.includes("put");
  const isLongTerm = horiz === "long" || horiz === "multi_year";

  const goalIncome  = goalContext?.incomeFocused ?? false;
  const goalOptions = goalContext?.optionsInterest ?? false;
  const ownsSymbol  = portfolioContext?.ownsSymbol ?? false;

  const incomeFocus  = constraints.incomeFocus ?? goalIncome ?? isIncome;
  const dirFocus     = constraints.directionalFocus ?? (isGrowth && !incomeFocus);
  const definedRisk  = constraints.definedRiskPreferred ?? false;
  const avoidEarnings = constraints.avoidEarningsWindow ?? false;

  // Has an earnings risk factor?
  const earningsRisk = opp.riskFactors.some(r =>
    r.label?.toLowerCase().includes("earn") || r.label?.toLowerCase().includes("event")
  );

  // Build results for each family
  for (const family of EXPRESSION_FAMILIES) {
    const result = evaluateOneFamily(family, {
      opp, constraints, goalContext, portfolioContext,
      isGrowth, isIncome, isLongTerm, goalIncome, goalOptions,
      ownsSymbol, incomeFocus, dirFocus, definedRisk, avoidEarnings, earningsRisk,
      risk,
    });
    results.push(result);
  }

  _healthMetrics.expressionEvaluations++;
  console.log(JSON.stringify({
    event:              "trade_planning_expression_evaluated",
    expressionCount:    results.length,
    applicableCount:    results.filter(r => r.status === "applicable").length,
    potentialCount:     results.filter(r => r.status === "potentially_applicable").length,
    durationMs:         Date.now() - startMs,
    hasGoalContext:     !!goalContext,
    hasPortfolioContext: !!portfolioContext,
    ts:                 new Date().toISOString(),
  }));

  return results;
}

interface EvalCtx {
  opp:              CanonicalOpportunity;
  constraints:      TradePlanningConstraints;
  goalContext?:     PlanningGoalContext | null;
  portfolioContext?: PlanningPortfolioContext | null;
  isGrowth:         boolean;
  isIncome:         boolean;
  isLongTerm:       boolean;
  goalIncome:       boolean;
  goalOptions:      boolean;
  ownsSymbol:       boolean;
  incomeFocus:      boolean;
  dirFocus:         boolean;
  definedRisk:      boolean;
  avoidEarnings:    boolean;
  earningsRisk:     boolean;
  risk:             string;
}

function evaluateOneFamily(family: ExpressionFamily, ctx: EvalCtx): ExpressionFamilyResult {
  const { constraints, isGrowth, isIncome, goalOptions, ownsSymbol,
          incomeFocus, dirFocus, definedRisk, avoidEarnings, earningsRisk, risk } = ctx;
  const label       = EXPRESSION_FAMILY_LABELS[family];
  const description = EXPRESSION_FAMILY_DESCRIPTIONS[family];

  const reasons:            string[] = [];
  const constraintsMissing: string[] = [];
  const limitations:        string[] = [];
  let status: ExpressionStatus = "unavailable";

  switch (family) {
    case "equity": {
      if (!constraints.equityAllowed) {
        status = "unavailable";
        reasons.push("Equity research is not enabled in current planning constraints");
      } else {
        status = "applicable";
        reasons.push("Equity research is enabled");
        if (isGrowth) reasons.push("Candidate has a growth-oriented research thesis");
        if (ctx.opp.technicalScore >= 70) reasons.push("Technical evidence score is strong");
        if (avoidEarnings && earningsRisk) {
          limitations.push("Earnings or event risk noted — review before planning");
        }
      }
      break;
    }

    case "equity_scaled": {
      if (!constraints.equityAllowed) {
        status = "unavailable";
        reasons.push("Equity research is not enabled in current planning constraints");
      } else {
        status = "potentially_applicable";
        reasons.push("Equity research is enabled");
        reasons.push("Scaled entries could be explored across multiple price levels");
        if (!constraints.capitalAvailable) {
          constraintsMissing.push("Capital available — required to model scaling scenarios");
        } else {
          status = "applicable";
        }
        if (!constraints.maxCapitalAtRisk) {
          constraintsMissing.push("Maximum capital at risk — helps define scale boundaries");
        }
      }
      break;
    }

    case "income": {
      if (!constraints.equityAllowed && !constraints.optionsAllowed) {
        status = "unavailable";
        reasons.push("Neither equity nor options research is enabled");
      } else if (incomeFocus || isIncome || goalOptions) {
        status = "potentially_applicable";
        if (incomeFocus) reasons.push("Income focus is selected in planning constraints");
        if (isIncome)    reasons.push("Candidate has income-oriented research classification");
        if (goalOptions) reasons.push("Options research interest indicated in goal context");
        if (!constraints.optionsAllowed && !ownsSymbol) {
          constraintsMissing.push("Options research — required for most income structures");
        }
        if (ownsSymbol) {
          reasons.push("Existing position context may support income-oriented expressions");
          status = "applicable";
        }
      } else {
        status = "unavailable";
        reasons.push("No income focus in current constraints or research classification");
      }
      break;
    }

    case "defined_risk_directional": {
      if (!constraints.optionsAllowed) {
        status = "unavailable";
        reasons.push("Options research is not enabled in current planning constraints");
      } else if (dirFocus || isGrowth) {
        status = "potentially_applicable";
        if (dirFocus)   reasons.push("Directional focus is selected in planning constraints");
        if (isGrowth)   reasons.push("Candidate has directional growth-oriented thesis");
        if (definedRisk) {
          reasons.push("Defined-risk preference is selected");
          status = "applicable";
        } else {
          constraintsMissing.push("Defined-risk preference — enable to confirm alignment");
        }
        if (!constraints.preferredHoldingPeriod) {
          constraintsMissing.push("Preferred planning horizon — helps scope option timeframes");
        }
        if (avoidEarnings && earningsRisk) {
          limitations.push("Earnings or event risk noted — may affect options pricing context");
        }
      } else {
        status = "unavailable";
        reasons.push("No directional research thesis identified for current candidate");
      }
      break;
    }

    case "covered_call": {
      if (!constraints.optionsAllowed) {
        status = "unavailable";
        reasons.push("Options research is not enabled in current planning constraints");
      } else if (ownsSymbol || incomeFocus) {
        status = "potentially_applicable";
        if (ownsSymbol)   reasons.push("Existing position context exists — may support covered call research");
        if (incomeFocus)  reasons.push("Income focus selected — covered call research is contextually relevant");
        if (goalOptions)  reasons.push("Options research interest indicated in goal context");
        if (ownsSymbol && incomeFocus) status = "applicable";
        if (!ownsSymbol) {
          limitations.push("No current portfolio position — covered call research would be hypothetical");
        }
      } else {
        status = "unavailable";
        reasons.push("No income focus or existing position context for covered call research");
      }
      break;
    }

    case "cash_secured_put": {
      if (!constraints.optionsAllowed) {
        status = "unavailable";
        reasons.push("Options research is not enabled in current planning constraints");
      } else if (incomeFocus || isIncome) {
        status = "potentially_applicable";
        if (incomeFocus) reasons.push("Income focus selected — cash-secured put research is relevant");
        if (isIncome)    reasons.push("Candidate has income or acquisition-oriented classification");
        if (!constraints.capitalAvailable) {
          constraintsMissing.push("Capital available — needed to model cash-secured put scenarios");
        } else {
          status = "applicable";
        }
      } else {
        status = "unavailable";
        reasons.push("No income or acquisition context for cash-secured put research");
      }
      break;
    }

    case "vertical_spread": {
      if (!constraints.optionsAllowed) {
        status = "unavailable";
        reasons.push("Options research is not enabled in current planning constraints");
      } else if (definedRisk) {
        status = "potentially_applicable";
        reasons.push("Defined-risk preference is selected");
        if (dirFocus || isGrowth) {
          reasons.push("Directional or growth thesis supports vertical spread research");
        }
        if (!constraints.preferredHoldingPeriod) {
          constraintsMissing.push("Preferred planning horizon — helps scope spread timeframes");
        }
        if (!constraints.maxLossPerPosition) {
          constraintsMissing.push("Max loss per position — helps define spread width parameters");
        } else {
          if (dirFocus || isGrowth) status = "applicable";
        }
      } else if (constraints.optionsAllowed) {
        status = "unavailable";
        reasons.push("Defined-risk preference is not selected — enable for vertical spread research");
      }
      break;
    }

    case "long_option": {
      if (!constraints.optionsAllowed) {
        status = "unavailable";
        reasons.push("Options research is not enabled in current planning constraints");
      } else if (dirFocus || isGrowth) {
        status = "potentially_applicable";
        if (dirFocus)   reasons.push("Directional focus is selected");
        if (isGrowth)   reasons.push("Growth candidate supports directional option research");
        if (definedRisk) {
          limitations.push("Long options have defined max loss but unlimited upside — review risk profile");
        }
        if (!constraints.preferredHoldingPeriod) {
          constraintsMissing.push("Preferred planning horizon — critical for long-option time decay context");
        } else {
          status = "applicable";
        }
        if (avoidEarnings && earningsRisk) {
          limitations.push("Earnings or event risk — may significantly affect options pricing context");
        }
      } else {
        status = "unavailable";
        reasons.push("No directional research thesis for long options research");
      }
      break;
    }

    case "neutral_options": {
      if (!constraints.optionsAllowed) {
        status = "unavailable";
        reasons.push("Options research is not enabled in current planning constraints");
      } else {
        const isDirectional = dirFocus || isGrowth || incomeFocus;
        if (isDirectional) {
          status = "unavailable";
          reasons.push("Current research thesis is directional — neutral structures are not aligned");
        } else {
          status = "potentially_applicable";
          reasons.push("Candidate has limited directional bias in current research context");
          limitations.push("Neutral options research requires volatility and regime context not available in this sprint");
          constraintsMissing.push("Preferred planning horizon — required for non-directional option structures");
        }
      }
      break;
    }

    case "monitor_only": {
      // Always available — no constraints required
      status = "applicable";
      reasons.push("Monitoring is always available regardless of planning constraints");
      reasons.push("Continue tracking research changes without constructing an expression");
      limitations.push("No active expression structure — research is passive observation only");
      break;
    }
  }

  return { family, label, description, status, reasons, constraintsMissing, limitations };
}

// ---------------------------------------------------------------------------
// Build canonical TradePlanningContext
// ---------------------------------------------------------------------------

export async function buildTradePlanningContext(
  userId: string,
  symbol: string,
  opts: {
    goalId?:      string | null;
    portfolioId?: string | null;
    constraints?: TradePlanningConstraints;
  } = {},
): Promise<TradePlanningContext> {
  const start = Date.now();
  const constraints = opts.constraints ?? DEFAULT_CONSTRAINTS;
  const fingerprint = constraintsFingerprint(constraints);

  console.log(JSON.stringify({
    event:       "trade_planning_context_started",
    symbol,
    hasGoalId:   !!opts.goalId,
    hasPortfolio: !!opts.portfolioId,
    ts:          new Date().toISOString(),
  }));

  // Fetch canonical opportunity (authoritative — never client-supplied)
  const opp = await getCanonicalOpportunity(symbol);
  if (!opp) {
    recordContextFailed();
    throw new Error(`No qualified research candidate found for symbol: ${symbol}`);
  }

  // Cache check
  const cacheKey = contextCacheKey(userId, symbol, opp.id, opts.goalId, opts.portfolioId, fingerprint);
  const cached = getCachedContext(cacheKey);
  if (cached) return cached;

  // Load optional contexts in parallel
  const [goalContext, portfolioContext] = await Promise.all([
    opts.goalId ? loadGoalContext(userId, opts.goalId, opp) : Promise.resolve(null),
    opts.portfolioId ? loadPortfolioContext(userId, opts.portfolioId, symbol) : Promise.resolve(null),
  ]);

  const limitations: string[] = [];
  if (opp.institutionalScore < 10) {
    limitations.push("Institutional evidence limited or unavailable — planning context uses partial data");
  }
  if (!portfolioContext && opts.portfolioId) {
    limitations.push("Portfolio context unavailable — planning works without portfolio data");
  }
  if (!goalContext && opts.goalId) {
    limitations.push("Goal context unavailable — planning works without goal data");
  }

  const now = new Date().toISOString();
  const oppFreshness = computeFreshness(opp.lastUpdated);

  const expressions = evaluateExpressionFamilies(opp, constraints, goalContext, portfolioContext);

  const context: TradePlanningContext = {
    id:              randomUUID(),
    userId,
    symbol:          opp.symbol,
    companyName:     opp.companyName,
    opportunityId:   opp.id,
    opportunityType: opp.opportunityType,
    opportunityLabel: opp.opportunityTypeLabel,
    researchGoalId:  opts.goalId ?? null,
    portfolioId:     opts.portfolioId ?? null,
    researchHorizon: opp.timeHorizon,
    marketRegime:    opp.marketRegime,
    researchScore:      opp.researchScore,
    technicalScore:     opp.technicalScore,
    fundamentalScore:   opp.fundamentalScore,
    institutionalScore: opp.institutionalScore,
    evidenceConfidence: opp.confidence,
    riskLevel:          opp.riskLevel,
    primaryEvidence:   opp.primaryEvidence,
    secondaryEvidence: opp.secondaryEvidence,
    riskFactors:       opp.riskFactors,
    invalidatesThesis: opp.invalidatesThesis,
    sector:    opp.sector,
    industry:  opp.industry,
    themes:    opp.themes,
    portfolioContext: portfolioContext ?? null,
    goalContext:      goalContext ?? null,
    userConstraints:  constraints,
    eligibleExpressionFamilies: expressions,
    limitations,
    freshness: {
      opportunityIntelligence: oppFreshness,
      technicalEvidence:       oppFreshness,
      fundamentalEvidence:     oppFreshness,
      institutionalEvidence:   opp.institutionalScore < 10 ? unavailableFreshness() : oppFreshness,
      portfolioContext:        portfolioContext?.freshness ?? unavailableFreshness(),
      goalContext:             goalContext?.freshness ?? unavailableFreshness(),
    },
    generatedAt: now,
  };

  const partial = limitations.length > 0;
  const durationMs = Date.now() - start;
  recordContextBuilt(durationMs, partial);

  setCachedContext(cacheKey, context);

  console.log(JSON.stringify({
    event:          "trade_planning_context_completed",
    symbol,
    partial,
    expressionFamilyCount: expressions.length,
    subsystemCount: [!!goalContext, !!portfolioContext].filter(Boolean).length,
    durationMs,
    hasGoalContext:     !!goalContext,
    hasPortfolioContext: !!portfolioContext,
    ts:             now,
  }));

  return context;
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export async function createPlanningSession(
  userId: string,
  data: {
    symbol:       string;
    opportunityId?: string | null;
    goalId?:       string | null;
    portfolioId?:  string | null;
    constraints?:  TradePlanningConstraints;
  },
): Promise<TradePlanningSession> {
  const constraints = data.constraints ?? DEFAULT_CONSTRAINTS;
  const rows = await db
    .insert(tradePlanningSessions)
    .values({
      userId,
      symbol:       data.symbol.toUpperCase(),
      opportunityId: data.opportunityId ?? null,
      researchGoalId: data.goalId ?? null,
      portfolioId:  data.portfolioId ?? null,
      constraints,
      selectedExpressionFamily: null,
    })
    .returning();

  _healthMetrics.sessionsCreated++;

  console.log(JSON.stringify({
    event:              "trade_planning_session_created",
    hasGoalContext:     !!data.goalId,
    hasPortfolioContext: !!data.portfolioId,
    ts:                 new Date().toISOString(),
  }));

  return dbRowToSession(rows[0]);
}

export async function getPlanningSession(
  userId: string,
  sessionId: string,
): Promise<TradePlanningSession | null> {
  const rows = await db
    .select()
    .from(tradePlanningSessions)
    .where(and(eq(tradePlanningSessions.id, sessionId as any), eq(tradePlanningSessions.userId, userId)))
    .limit(1);
  return rows[0] ? dbRowToSession(rows[0]) : null;
}

export async function getLatestSessionForSymbol(
  userId: string,
  symbol: string,
): Promise<TradePlanningSession | null> {
  const rows = await db
    .select()
    .from(tradePlanningSessions)
    .where(and(eq(tradePlanningSessions.userId, userId), eq(tradePlanningSessions.symbol, symbol.toUpperCase())))
    .orderBy(desc(tradePlanningSessions.updatedAt))
    .limit(1);
  return rows[0] ? dbRowToSession(rows[0]) : null;
}

export async function updatePlanningSession(
  userId: string,
  sessionId: string,
  patch: {
    constraints?:              TradePlanningConstraints;
    goalId?:                   string | null;
    portfolioId?:              string | null;
    selectedExpressionFamily?: string | null;
  },
): Promise<TradePlanningSession | null> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.constraints !== undefined) updates.constraints = patch.constraints;
  if (patch.goalId !== undefined)      updates.researchGoalId = patch.goalId;
  if (patch.portfolioId !== undefined) updates.portfolioId = patch.portfolioId;
  if (patch.selectedExpressionFamily !== undefined) {
    updates.selectedExpressionFamily = patch.selectedExpressionFamily;
  }

  const rows = await db
    .update(tradePlanningSessions)
    .set(updates as any)
    .where(and(eq(tradePlanningSessions.id, sessionId as any), eq(tradePlanningSessions.userId, userId)))
    .returning();

  return rows[0] ? dbRowToSession(rows[0]) : null;
}

function dbRowToSession(row: any): TradePlanningSession {
  return {
    id:                      row.id,
    userId:                  row.userId,
    symbol:                  row.symbol,
    opportunityId:           row.opportunityId ?? null,
    researchGoalId:          row.researchGoalId ?? null,
    portfolioId:             row.portfolioId ?? null,
    constraints:             validateConstraints(row.constraints),
    selectedExpressionFamily: row.selectedExpressionFamily ?? null,
    createdAt:               row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt:               row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}
