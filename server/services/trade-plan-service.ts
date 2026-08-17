/**
 * server/services/trade-plan-service.ts — Sprint 2.7.5 Trade Plan Workspace
 *
 * Server-authoritative plan creation and management.
 * Client submits only references (session ID, candidate ID, scenario ID).
 * Server reconstructs authoritative scores, snapshots, risk values.
 *
 * ROADMAP DISCIPLINE:
 * - No broker order fields
 * - No execution CTA
 * - No probability of profit / expected return
 * - No "approved trade" / "recommended trade"
 * - No suitability scoring
 */

import { db } from "../db";
import { tradePlans, tradePlanVersions, tradePlanningSessions } from "../../shared/schema";
import { eq, and, desc, asc, inArray, sql } from "drizzle-orm";
import type {
  TradePlan,
  TradePlanSummary,
  TradePlanVersion,
  TradePlanResearchSnapshot,
  TradePlanPlanningSnapshot,
  TradePlanEquitySnapshot,
  TradePlanOptionsSnapshot,
  TradePlanRiskSnapshot,
  TradePlanMonitoringSnapshot,
  TradePlanChecklist,
  TradePlanResearchChange,
  TradePlanHealth,
  TradePlanStatus,
  TradePlanType,
  TradePlanMonitoringInput,
  TradePlanListQuery,
  TradePlanListResponse,
  TradePlanHealthMetrics,
  CreateTradePlanRequest,
  UpdateTradePlanRequest,
  CreateTradePlanVersionRequest,
  ResearchChangeDirection,
  ResearchChangeMateriality,
} from "../../shared/trade-plan-types";
import {
  DEFAULT_TRADE_PLAN_CHECKLIST,
  TRADE_PLAN_VERSION,
} from "../../shared/trade-plan-types";
import { getPlanningSession, buildTradePlanningContext } from "./trade-planning-service";
import { computePlanningCapitalContext } from "../../shared/trade-planning-types";
import { buildEquityPlanningScenario } from "./equity-planning-service";
import { getSessionContractResearch, getCachedRiskAnalysis } from "./trade-risk-scenario-service";
import { getOpportunityIntelligence } from "./opportunity-intelligence-service";

// ============================================================================
// Health Counters (in-memory, admin aggregate only — no PII)
// ============================================================================

let _healthCounters = {
  tradePlansCreated:           0,
  planCreationFailures:        0,
  totalCreationLatencyMs:      0,
  planCreationCount:           0,
};

function _recordCreationSuccess(latencyMs: number): void {
  _healthCounters.tradePlansCreated++;
  _healthCounters.totalCreationLatencyMs += latencyMs;
  _healthCounters.planCreationCount++;
}

function _recordCreationFailure(): void {
  _healthCounters.planCreationFailures++;
}

// ============================================================================
// Row ↔ Domain Mapping
// ============================================================================

function _rowToPlan(row: any): TradePlan {
  return {
    id:                    row.id,
    userId:                row.userId,
    symbol:                row.symbol,
    companyName:           row.companyName ?? null,
    planType:              row.planType as TradePlanType,
    status:                row.status as TradePlanStatus,
    planHealth:            row.planHealth as TradePlanHealth,
    planningContextId:     row.planningContextId,
    researchGoalId:        row.researchGoalId ?? null,
    portfolioId:           row.portfolioId ?? null,
    selectedExpressionFamily: row.selectedExpressionFamily,
    researchSnapshot:      row.researchSnapshot as TradePlanResearchSnapshot,
    planningSnapshot:      row.planningSnapshot as TradePlanPlanningSnapshot,
    structureSnapshot:     (row.structureSnapshot ?? null) as any,
    riskSnapshot:          (row.riskSnapshot ?? null) as TradePlanRiskSnapshot | null,
    monitoringSnapshot:    (row.monitoringSnapshot ?? {
      monitoringPlan: null,
      invalidationContext: null,
      watchCriteria: [],
      monitoringStartedAt: null,
      researchWatchId: null,
    }) as TradePlanMonitoringSnapshot,
    userNotes:             row.userNotes ?? null,
    reviewChecklist:       (row.reviewChecklist ?? DEFAULT_TRADE_PLAN_CHECKLIST) as TradePlanChecklist,
    version:               row.version ?? 1,
    createdAt:             row.createdAt?.toISOString?.() ?? row.createdAt,
    updatedAt:             row.updatedAt?.toISOString?.() ?? row.updatedAt,
    archivedAt:            row.archivedAt ? (row.archivedAt.toISOString?.() ?? row.archivedAt) : null,
    completedResearchAt:   row.completedResearchAt ? (row.completedResearchAt.toISOString?.() ?? row.completedResearchAt) : null,
    monitoringStartedAt:   row.monitoringStartedAt ? (row.monitoringStartedAt.toISOString?.() ?? row.monitoringStartedAt) : null,
    freshnessAtCreation:   row.freshnessAtCreation ?? "unknown",
    limitations:           (row.limitations ?? []) as string[],
  };
}

function _rowToSummary(row: any, currentScore: number | null): TradePlanSummary {
  const rs = row.researchSnapshot as TradePlanResearchSnapshot;
  const savedScore = rs?.researchScore ?? 0;
  return {
    id:                       row.id,
    symbol:                   row.symbol,
    companyName:              row.companyName ?? null,
    planType:                 row.planType as TradePlanType,
    status:                   row.status as TradePlanStatus,
    planHealth:               row.planHealth as TradePlanHealth,
    selectedExpressionFamily: row.selectedExpressionFamily,
    researchScoreAtCreation:  savedScore,
    riskLevelAtCreation:      rs?.riskLevel ?? "UNKNOWN",
    currentResearchScore:     currentScore,
    researchScoreChange:      currentScore !== null ? currentScore - savedScore : null,
    version:                  row.version ?? 1,
    createdAt:                row.createdAt?.toISOString?.() ?? row.createdAt,
    updatedAt:                row.updatedAt?.toISOString?.() ?? row.updatedAt,
    archivedAt:               row.archivedAt ? (row.archivedAt.toISOString?.() ?? row.archivedAt) : null,
    freshnessAtCreation:      row.freshnessAtCreation ?? "unknown",
  };
}

function _rowToVersion(row: any): TradePlanVersion {
  return {
    id:               row.id,
    tradePlanId:      row.tradePlanId,
    version:          row.version,
    changeReason:     row.changeReason ?? null,
    researchSnapshot: row.researchSnapshot as TradePlanResearchSnapshot,
    planningSnapshot: row.planningSnapshot as TradePlanPlanningSnapshot,
    structureSnapshot: (row.structureSnapshot ?? null) as any,
    riskSnapshot:     (row.riskSnapshot ?? null) as TradePlanRiskSnapshot | null,
    createdAt:        row.createdAt?.toISOString?.() ?? row.createdAt,
  };
}

// ============================================================================
// Research Snapshot Builder
// ============================================================================

function _buildResearchSnapshot(opportunity: any): TradePlanResearchSnapshot {
  return {
    opportunityId:      opportunity.id ?? null,
    opportunityType:    opportunity.opportunityType ?? null,
    researchScore:      opportunity.researchScore ?? 0,
    technicalScore:     opportunity.technicalScore ?? 0,
    fundamentalScore:   opportunity.fundamentalScore ?? 0,
    institutionalScore: opportunity.institutionalScore ?? 0,
    evidenceConfidence: opportunity.evidenceConfidence ?? null,
    riskLevel:          opportunity.riskLevel ?? "UNKNOWN",
    marketRegime:       opportunity.marketRegime ?? null,
    sector:             opportunity.sector ?? null,
    themes:             Array.isArray(opportunity.themes) ? opportunity.themes : [],
    primaryEvidence:    (opportunity.primaryEvidence ?? []).map((e: any) => ({
      label: e.label ?? "", description: e.description ?? "", type: e.type ?? "",
    })),
    secondaryEvidence:  (opportunity.secondaryEvidence ?? []).map((e: any) => ({
      label: e.label ?? "", description: e.description ?? "", type: e.type ?? "",
    })),
    riskFactors:        opportunity.riskFactors ?? [],
    invalidatesThesis:  (opportunity.invalidatesThesis ?? []).map((c: any) => ({
      condition: c.condition ?? "", description: c.description ?? "",
    })),
    generatedAt:        new Date().toISOString(),
  };
}

function _buildEmptyResearchSnapshot(symbol: string): TradePlanResearchSnapshot {
  return {
    opportunityId: null, opportunityType: null,
    researchScore: 0, technicalScore: 0, fundamentalScore: 0, institutionalScore: 0,
    evidenceConfidence: null, riskLevel: "UNKNOWN", marketRegime: null,
    sector: null, themes: [], primaryEvidence: [], secondaryEvidence: [],
    riskFactors: [], invalidatesThesis: [], generatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Planning Snapshot Builder
// ============================================================================

function _buildPlanningSnapshot(
  context: any,
  session: any,
  goalContextSummary: string | null,
  portfolioContextSummary: string | null,
): TradePlanPlanningSnapshot {
  // Sprint 2.8.7 BI-004: embed planning capital context when session constraints
  // provide capitalAvailable + maxRiskPercent + maxAllocationPercent.
  // SAFETY: source is always "USER_DEFINED_PLANNING_CAPITAL" — never execution-grade.
  const constraints = session.constraints as Record<string, unknown> | null | undefined;
  const planningCapital = computePlanningCapitalContext(
    typeof constraints?.capitalAvailable === "number" ? constraints.capitalAvailable : null,
    typeof constraints?.maxRiskPercent === "number" ? constraints.maxRiskPercent : null,
    typeof constraints?.maxAllocationPercent === "number" ? constraints.maxAllocationPercent : null,
  );

  return {
    planningContextId:        context.id ?? session.id,
    symbol:                   session.symbol,
    researchHorizon:          context.researchHorizon ?? null,
    selectedExpressionFamily: session.selectedExpressionFamily ?? "",
    constraintsFingerprint:   context.planningConstraintsFingerprint ?? "",
    goalContextSummary,
    portfolioContextSummary,
    limitations:              context.limitations ?? [],
    generatedAt:              new Date().toISOString(),
    planningCapital:          planningCapital ?? null,
  };
}

// ============================================================================
// Equity Snapshot Builder
// ============================================================================

function _buildEquitySnapshot(scenario: any): TradePlanEquitySnapshot {
  return {
    equityScenarioId:      scenario.id,
    referencePrice:        scenario.referencePrice ?? null,
    referencePriceSource:  scenario.referencePriceSource ?? "",
    entryFramework:        scenario.entryFramework ?? {},
    invalidationFramework: scenario.invalidationFramework ?? {},
    hypotheticalSizing:    scenario.sizingFramework ?? null,
    scenarioSummary:       scenario.scenarioGrid ?? null,
    monitoringPlan:        scenario.monitoringPlan ?? null,
    marketDataAsOf:        scenario.marketDataAsOf ?? null,
    methodologyVersion:    scenario.methodologyVersion ?? TRADE_PLAN_VERSION,
  };
}

// ============================================================================
// Options Snapshot Builder
// ============================================================================

function _buildOptionsSnapshot(
  candidate: any,
  riskResult: any,
): TradePlanOptionsSnapshot {
  return {
    candidateId:         candidate.id,
    strategyFamily:      candidate.strategyFamily ?? "",
    strategyLabel:       candidate.strategyLabel ?? "",
    expiration:          candidate.expiration ?? "",
    expirationLabel:     candidate.expirationLabel ?? "",
    dte:                 candidate.dte ?? 0,
    legs:                candidate.legs ?? [],
    estimatedMidpoint:   candidate.metrics?.estimatedMidpoint ?? null,
    liquidityQuality:    candidate.overallLiquidity ?? "",
    greeks:              candidate.metrics?.netGreeks ?? null,
    eventContext:        candidate.eventExposure ?? null,
    riskAnalysisSummary: riskResult
      ? {
          maxLoss:          riskResult.payoffProfile?.maxLoss ?? null,
          maxGain:          riskResult.payoffProfile?.maxGain ?? null,
          breakevens:       riskResult.payoffProfile?.breakevens ?? [],
          constraintStatus: riskResult.structureSummary?.constraintStatus ?? null,
        }
      : null,
    methodologyVersion:  TRADE_PLAN_VERSION,
  };
}

// ============================================================================
// Risk Snapshot Builder
// ============================================================================

function _buildRiskSnapshot(riskResult: any): TradePlanRiskSnapshot | null {
  if (!riskResult) return null;
  return {
    analysisId:        riskResult.id ?? "unknown",
    maxLoss:           riskResult.payoffProfile?.maxLoss ?? null,
    maxGain:           riskResult.payoffProfile?.maxGain ?? null,
    breakevens:        riskResult.payoffProfile?.breakevens ?? [],
    capitalProfile:    riskResult.capitalProfile ?? null,
    netGreeks:         riskResult.greekProfile ?? null,
    riskFlags:         (riskResult.riskFlags ?? []).map((f: any) => f.code ?? f),
    eventExposure:     riskResult.eventScenarios?.[0] ?? null,
    liquidityRisk:     riskResult.liquidityRisk ?? null,
    constraintStatus:  riskResult.structureSummary?.constraintStatus ?? "UNKNOWN",
    scenarioConfig:    { scenarioPcts: riskResult.scenarioPcts ?? [] },
    generatedAt:       riskResult.generatedAt ?? new Date().toISOString(),
    methodologyVersion: riskResult.methodologyVersion ?? TRADE_PLAN_VERSION,
  };
}

// ============================================================================
// Plan Health Computation (pure, deterministic)
// ============================================================================

const MATERIAL_SCORE_CHANGE_THRESHOLD = 5;  // 5-point change in research score

/**
 * Compute plan health by comparing saved snapshot with current research.
 * Uses existing Change Intelligence thresholds — no new formulas invented.
 */
export function computePlanHealth(
  savedSnapshot: TradePlanResearchSnapshot,
  currentOpportunity: any | null,
): { health: TradePlanHealth; reason: string } {
  if (!currentOpportunity) {
    return { health: "UNKNOWN", reason: "Current research data unavailable." };
  }

  // Check data freshness
  const freshness: string = currentOpportunity.freshness?.overallStatus ?? "unknown";
  if (freshness === "stale" || freshness === "unavailable") {
    return { health: "DATA_STALE", reason: "Current research data is stale or unavailable." };
  }

  // Check thesis invalidation
  const currentInvalidation = currentOpportunity.invalidatesThesis ?? [];
  if (currentInvalidation.length > 0) {
    const savedInvalidation = savedSnapshot.invalidatesThesis ?? [];
    const newInvalidations = currentInvalidation.filter(
      (c: any) => !savedInvalidation.some(
        (s: any) => s.condition === (c.condition ?? c)
      )
    );
    if (newInvalidations.length > 0) {
      return {
        health: "THESIS_INVALIDATED",
        reason: "A documented thesis invalidation condition was observed.",
      };
    }
  }

  // Check qualification loss
  const wasQualified = savedSnapshot.researchScore > 0;
  const isQualified = (currentOpportunity.researchScore ?? 0) > 0;
  if (wasQualified && !isQualified) {
    return {
      health: "REQUIRES_REVIEW",
      reason: "Symbol no longer qualified in current research.",
    };
  }

  // Check material score change
  const scoreDiff = Math.abs(
    (currentOpportunity.researchScore ?? 0) - savedSnapshot.researchScore
  );
  if (scoreDiff >= MATERIAL_SCORE_CHANGE_THRESHOLD) {
    return {
      health: "REQUIRES_REVIEW",
      reason: `Research score changed by ${scoreDiff.toFixed(1)} points since plan creation.`,
    };
  }

  // Check market regime change
  if (
    currentOpportunity.marketRegime &&
    savedSnapshot.marketRegime &&
    currentOpportunity.marketRegime !== savedSnapshot.marketRegime
  ) {
    return {
      health: "CHANGED",
      reason: `Market regime changed from "${savedSnapshot.marketRegime}" to "${currentOpportunity.marketRegime}".`,
    };
  }

  // Minor changes
  const minorScoreDiff = Math.abs(
    (currentOpportunity.researchScore ?? 0) - savedSnapshot.researchScore
  );
  if (minorScoreDiff > 0) {
    return { health: "CHANGED", reason: "Minor research evidence change detected." };
  }

  return { health: "CURRENT", reason: "Research evidence consistent with plan creation." };
}

// ============================================================================
// Research Change Comparison
// ============================================================================

export function computeResearchChange(
  savedSnapshot: TradePlanResearchSnapshot,
  currentOpportunity: any | null,
): TradePlanResearchChange {
  const now = new Date().toISOString();

  if (!currentOpportunity) {
    return {
      researchScoreChange: null,
      technicalScoreChange: null,
      fundamentalScoreChange: null,
      institutionalScoreChange: null,
      riskLevelChange: null,
      marketRegimeChange: null,
      qualificationChange: null,
      thesisInvalidationObserved: false,
      invalidationConditionsFired: [],
      newRiskFactors: [],
      removedRiskFactors: [],
      changeDirection: "UNKNOWN",
      materiality: "UNKNOWN",
      lastComparedAt: now,
      comparisonNote: "Current research data unavailable.",
    };
  }

  const researchScoreChange = (currentOpportunity.researchScore ?? 0) - savedSnapshot.researchScore;
  const technicalScoreChange = (currentOpportunity.technicalScore ?? 0) - savedSnapshot.technicalScore;
  const fundamentalScoreChange = (currentOpportunity.fundamentalScore ?? 0) - savedSnapshot.fundamentalScore;
  const institutionalScoreChange = (currentOpportunity.institutionalScore ?? 0) - savedSnapshot.institutionalScore;

  const riskLevelChange = (
    currentOpportunity.riskLevel && savedSnapshot.riskLevel &&
    currentOpportunity.riskLevel !== savedSnapshot.riskLevel
  ) ? `${savedSnapshot.riskLevel} → ${currentOpportunity.riskLevel}` : null;

  const marketRegimeChange = (
    currentOpportunity.marketRegime && savedSnapshot.marketRegime &&
    currentOpportunity.marketRegime !== savedSnapshot.marketRegime
  ) ? `${savedSnapshot.marketRegime} → ${currentOpportunity.marketRegime}` : null;

  const wasQualified = savedSnapshot.researchScore > 0;
  const isQualified = (currentOpportunity.researchScore ?? 0) > 0;
  const qualificationChange = wasQualified !== isQualified
    ? (isQualified ? "disqualified → qualified" : "qualified → disqualified")
    : null;

  // Thesis invalidation
  const currentInvalidation: any[] = currentOpportunity.invalidatesThesis ?? [];
  const savedConditions = new Set(savedSnapshot.invalidatesThesis.map(c => c.condition));
  const invalidationConditionsFired = currentInvalidation
    .filter((c: any) => !savedConditions.has(c.condition ?? c))
    .map((c: any) => c.condition ?? String(c));
  const thesisInvalidationObserved = invalidationConditionsFired.length > 0;

  // Risk factor diff
  const savedRiskFactors = new Set(savedSnapshot.riskFactors);
  const currentRiskFactors: string[] = currentOpportunity.riskFactors ?? [];
  const newRiskFactors = currentRiskFactors.filter(r => !savedRiskFactors.has(r));
  const removedRiskFactors = savedSnapshot.riskFactors.filter(r => !currentRiskFactors.includes(r));

  // Direction and materiality
  let changeDirection: ResearchChangeDirection = "UNCHANGED";
  let materiality: ResearchChangeMateriality = "NONE";

  if (thesisInvalidationObserved) {
    changeDirection = "WEAKENED";
    materiality = "MATERIAL";
  } else if (Math.abs(researchScoreChange) >= MATERIAL_SCORE_CHANGE_THRESHOLD) {
    changeDirection = researchScoreChange > 0 ? "STRENGTHENED" : "WEAKENED";
    materiality = "MATERIAL";
  } else if (riskLevelChange || marketRegimeChange || qualificationChange) {
    changeDirection = "MIXED";
    materiality = "MATERIAL";
  } else if (Math.abs(researchScoreChange) > 0 || newRiskFactors.length > 0) {
    changeDirection = researchScoreChange > 0 ? "STRENGTHENED" : (researchScoreChange < 0 ? "WEAKENED" : "MIXED");
    materiality = "MINOR";
  }

  const comparisonNote = thesisInvalidationObserved
    ? "A thesis invalidation condition was observed. Review current research carefully."
    : materiality === "MATERIAL"
    ? "Material changes detected since plan creation. Research review recommended."
    : materiality === "MINOR"
    ? "Minor evidence changes detected since plan creation."
    : "Research evidence is consistent with plan creation.";

  return {
    researchScoreChange,
    technicalScoreChange,
    fundamentalScoreChange,
    institutionalScoreChange,
    riskLevelChange,
    marketRegimeChange,
    qualificationChange,
    thesisInvalidationObserved,
    invalidationConditionsFired,
    newRiskFactors,
    removedRiskFactors,
    changeDirection,
    materiality,
    lastComparedAt: now,
    comparisonNote,
  };
}

// ============================================================================
// Create Trade Plan (server-authoritative)
// ============================================================================

export async function createTradePlan(
  userId: string,
  req: CreateTradePlanRequest,
): Promise<TradePlan> {
  const startMs = Date.now();

  // 1. Validate session belongs to user
  const session = await getPlanningSession(userId, req.planningSessionId).catch(() => null);
  if (!session) {
    _recordCreationFailure();
    throw new Error("Planning session not found or does not belong to user.");
  }

  const symbol = session.symbol;

  // 2. Build planning context (server-authoritative, never client-supplied)
  const context = await buildTradePlanningContext(userId, symbol, {
    constraints: session.constraints,
  }).catch(() => null);

  // 3. Resolve current opportunity for research snapshot
  let opportunityForSnapshot: any = null;
  try {
    const intel = await getOpportunityIntelligence();
    opportunityForSnapshot = intel?.opportunities?.find(
      (o: any) => o.symbol === symbol
    ) ?? null;
  } catch { /* degrade gracefully */ }

  const researchSnapshot: TradePlanResearchSnapshot = opportunityForSnapshot
    ? _buildResearchSnapshot(opportunityForSnapshot)
    : _buildEmptyResearchSnapshot(symbol);

  // 4. Goal / portfolio context summaries (compact, no sensitive data)
  const goalContextSummary = session.researchGoalId
    ? `Research goal attached (ID: ${session.researchGoalId.slice(0, 8)}…)`
    : null;
  const portfolioContextSummary = session.portfolioId
    ? `Portfolio context attached (ID: ${session.portfolioId.slice(0, 8)}…)`
    : null;

  const planningSnapshot = _buildPlanningSnapshot(
    context ?? { id: req.planningSessionId, limitations: [] },
    session,
    goalContextSummary,
    portfolioContextSummary,
  );

  // 5. Resolve structure snapshot
  let structureSnapshot: TradePlanEquitySnapshot | TradePlanOptionsSnapshot | null = null;
  let riskSnapshot: TradePlanRiskSnapshot | null = null;

  if (req.planType === "EQUITY") {
    // Rebuild equity scenario server-side from the planning context (server-authoritative)
    try {
      const session = await getPlanningSession(userId, req.planningSessionId).catch(() => null);
      if (session) {
        const scenario = await buildEquityPlanningScenario({
          userId,
          symbol,
          tradePlanningContextId: req.planningSessionId,
          planningSessionId:      req.planningSessionId,
          constraints:            (session.constraints as any) ?? {},
        }).catch(() => null);
        if (scenario) structureSnapshot = _buildEquitySnapshot(scenario);
      }
    } catch { /* degrade gracefully */ }
  } else if (req.planType === "OPTIONS") {
    if (req.contractResearchCandidateId) {
      const contractResearch = getSessionContractResearch(req.planningSessionId);
      const candidate = contractResearch?.structureCandidates?.find(
        (c: any) => c.id === req.contractResearchCandidateId
      ) ?? null;

      let riskResult: any = null;
      if (req.riskScenarioAnalysisId) {
        riskResult = getCachedRiskAnalysis(userId, req.planningSessionId, req.contractResearchCandidateId);
      }

      if (candidate) {
        structureSnapshot = _buildOptionsSnapshot(candidate, riskResult);
        riskSnapshot = _buildRiskSnapshot(riskResult);
      }
    }
  }

  // 6. Monitoring snapshot (initial empty state)
  const monitoringSnapshot: TradePlanMonitoringSnapshot = {
    monitoringPlan:      req.monitoringPlan ?? null,
    invalidationContext: null,
    watchCriteria:       req.monitoringCriteria ?? [],
    monitoringStartedAt: null,
    researchWatchId:     null,
  };

  // 7. Checklist
  const reviewChecklist: TradePlanChecklist = {
    ...DEFAULT_TRADE_PLAN_CHECKLIST,
    ...(req.reviewChecklist ?? {}),
  };

  // 8. Freshness
  const freshness = opportunityForSnapshot
    ? (opportunityForSnapshot.freshness?.overallStatus ?? "unknown")
    : "unknown";

  // 9. Compute initial health
  const { health: planHealth } = computePlanHealth(researchSnapshot, opportunityForSnapshot);

  // 10. Persist
  const [row] = await db.insert(tradePlans).values({
    userId,
    symbol,
    companyName:              opportunityForSnapshot?.companyName ?? null,
    planType:                 req.planType,
    status:                   "DRAFT",
    planHealth,
    planningContextId:        req.planningSessionId,
    researchGoalId:           req.researchGoalId ?? session.researchGoalId ?? null,
    portfolioId:              req.portfolioId ?? session.portfolioId ?? null,
    selectedExpressionFamily: session.selectedExpressionFamily ?? req.planType,
    researchSnapshot:         researchSnapshot as unknown as Record<string, unknown>,
    planningSnapshot:         planningSnapshot as unknown as Record<string, unknown>,
    structureSnapshot:        structureSnapshot as unknown as Record<string, unknown> | undefined,
    riskSnapshot:             riskSnapshot as unknown as Record<string, unknown> | undefined,
    monitoringSnapshot:       monitoringSnapshot as unknown as Record<string, unknown>,
    userNotes:                req.userNotes ?? null,
    reviewChecklist:          reviewChecklist as unknown as Record<string, unknown>,
    version:                  1,
    freshnessAtCreation:      freshness,
    limitations:              (context?.limitations ?? []) as unknown as string[],
  }).returning();

  _recordCreationSuccess(Date.now() - startMs);
  return _rowToPlan(row);
}

// ============================================================================
// Get Trade Plan
// ============================================================================

export async function getTradePlan(
  userId: string,
  planId: string,
): Promise<TradePlan | null> {
  const rows = await db
    .select()
    .from(tradePlans)
    .where(and(eq(tradePlans.id, planId), eq(tradePlans.userId, userId)))
    .limit(1);

  return rows.length > 0 ? _rowToPlan(rows[0]) : null;
}

// ============================================================================
// List Trade Plans
// ============================================================================

export async function listTradePlans(
  userId: string,
  query: TradePlanListQuery = {},
): Promise<TradePlanListResponse> {
  const limit  = Math.min(query.limit ?? 20, 100);
  const offset = query.offset ?? 0;

  // Build filter conditions
  const conditions = [eq(tradePlans.userId, userId)];

  if (query.symbol) {
    conditions.push(eq(tradePlans.symbol, query.symbol.toUpperCase()));
  }
  if (query.planType) {
    conditions.push(eq(tradePlans.planType, query.planType));
  }
  if (query.status) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    if (statuses.length === 1) {
      conditions.push(eq(tradePlans.status, statuses[0]));
    } else {
      conditions.push(inArray(tradePlans.status, statuses));
    }
  }

  // Sort
  let orderBy: any = desc(tradePlans.createdAt);
  if (query.sort === "oldest")  orderBy = asc(tradePlans.createdAt);
  if (query.sort === "updated") orderBy = desc(tradePlans.updatedAt);
  if (query.sort === "symbol")  orderBy = asc(tradePlans.symbol);
  if (query.sort === "status")  orderBy = asc(tradePlans.status);

  const whereClause = and(...conditions);

  const [rows, countResult] = await Promise.all([
    db.select().from(tradePlans).where(whereClause).orderBy(orderBy).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(tradePlans).where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;

  // Try to enrich with current research scores (best effort)
  let currentScoreMap: Map<string, number> = new Map();
  try {
    const intel = await getOpportunityIntelligence();
    for (const opp of intel?.opportunities ?? []) {
      currentScoreMap.set(opp.symbol, opp.researchScore);
    }
  } catch { /* degrade */ }

  const plans = rows.map(row =>
    _rowToSummary(row, currentScoreMap.get(row.symbol) ?? null)
  );

  return { plans, total, offset, limit };
}

// ============================================================================
// Update Trade Plan
// ============================================================================

export async function updateTradePlan(
  userId: string,
  planId: string,
  patch: UpdateTradePlanRequest,
): Promise<TradePlan | null> {
  const existing = await getTradePlan(userId, planId);
  if (!existing) return null;

  const updates: Partial<typeof tradePlans.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (patch.status !== undefined) {
    updates.status = patch.status;
    if (patch.status === "RESEARCH_COMPLETE" && !existing.completedResearchAt) {
      updates.completedResearchAt = new Date();
    }
    if (patch.status === "MONITORING" && !existing.monitoringStartedAt) {
      updates.monitoringStartedAt = new Date();
    }
    if (patch.status === "ARCHIVED") {
      updates.archivedAt = new Date();
    }
  }

  if (patch.userNotes !== undefined) {
    updates.userNotes = patch.userNotes; // private — never logged
  }

  if (patch.reviewChecklist !== undefined) {
    const merged = { ...existing.reviewChecklist, ...patch.reviewChecklist };
    updates.reviewChecklist = merged as unknown as Record<string, unknown>;
  }

  if (patch.monitoringPlan !== undefined || patch.monitoringCriteria !== undefined) {
    const existing_mon = existing.monitoringSnapshot;
    const updated_mon: TradePlanMonitoringSnapshot = {
      ...existing_mon,
      monitoringPlan: patch.monitoringPlan ?? existing_mon.monitoringPlan,
      watchCriteria: patch.monitoringCriteria ?? existing_mon.watchCriteria,
    };
    updates.monitoringSnapshot = updated_mon as unknown as Record<string, unknown>;
  }

  const [row] = await db
    .update(tradePlans)
    .set(updates)
    .where(and(eq(tradePlans.id, planId), eq(tradePlans.userId, userId)))
    .returning();

  return row ? _rowToPlan(row) : null;
}

// ============================================================================
// Update Planning Capital (Sprint 2.8.7 BI-004)
// ============================================================================

/**
 * Patch a trade plan's planningSnapshot.planningCapital in-place.
 * No version bump — planning capital is a mutable planning assumption,
 * not a structural research change.
 *
 * SAFETY: source is always "USER_DEFINED_PLANNING_CAPITAL".
 * This NEVER authorizes execution or represents broker buying power.
 */
export async function updateTradePlanPlanningCapital(
  userId: string,
  planId: string,
  capitalAmount: number,
  maxRiskPercent: number,
  maxAllocationPercent: number,
): Promise<TradePlan | null> {
  const existing = await getTradePlan(userId, planId);
  if (!existing) return null;
  if (existing.status === "ARCHIVED") return null;

  const planningCapital = computePlanningCapitalContext(capitalAmount, maxRiskPercent, maxAllocationPercent);
  if (!planningCapital) return null; // invalid inputs

  const updatedSnapshot = {
    ...(existing.planningSnapshot as Record<string, unknown>),
    planningCapital,
  };

  const [row] = await db
    .update(tradePlans)
    .set({ planningSnapshot: updatedSnapshot as any, updatedAt: new Date() })
    .where(and(eq(tradePlans.id, planId), eq(tradePlans.userId, userId)))
    .returning();

  return row ? _rowToPlan(row) : null;
}

// ============================================================================
// Archive Trade Plan
// ============================================================================

export async function archiveTradePlan(
  userId: string,
  planId: string,
): Promise<TradePlan | null> {
  return updateTradePlan(userId, planId, { status: "ARCHIVED" });
}

// ============================================================================
// Duplicate Trade Plan
// ============================================================================

export async function duplicateTradePlan(
  userId: string,
  planId: string,
): Promise<TradePlan | null> {
  const source = await getTradePlan(userId, planId);
  if (!source) return null;

  const [row] = await db.insert(tradePlans).values({
    userId,
    symbol:                   source.symbol,
    companyName:              source.companyName ?? undefined,
    planType:                 source.planType,
    status:                   "DRAFT",
    planHealth:               source.planHealth,
    planningContextId:        source.planningContextId,
    researchGoalId:           source.researchGoalId ?? undefined,
    portfolioId:              source.portfolioId ?? undefined,
    selectedExpressionFamily: source.selectedExpressionFamily,
    researchSnapshot:         source.researchSnapshot as unknown as Record<string, unknown>,
    planningSnapshot:         source.planningSnapshot as unknown as Record<string, unknown>,
    structureSnapshot:        source.structureSnapshot as unknown as Record<string, unknown> | undefined,
    riskSnapshot:             source.riskSnapshot as unknown as Record<string, unknown> | undefined,
    monitoringSnapshot:       source.monitoringSnapshot as unknown as Record<string, unknown>,
    userNotes:                null, // fresh notes — user's choice to copy
    reviewChecklist:          DEFAULT_TRADE_PLAN_CHECKLIST as unknown as Record<string, unknown>,
    version:                  1,
    freshnessAtCreation:      source.freshnessAtCreation,
    limitations:              source.limitations as unknown as string[],
  }).returning();

  return row ? _rowToPlan(row) : null;
}

// ============================================================================
// Get Research Changes (Saved vs Current)
// ============================================================================

export async function getTradePlanChanges(
  userId: string,
  planId: string,
): Promise<{ plan: TradePlan; change: TradePlanResearchChange; planHealth: TradePlanHealth; healthReason: string } | null> {
  const plan = await getTradePlan(userId, planId);
  if (!plan) return null;

  // Get current opportunity (best effort)
  let currentOpportunity: any = null;
  try {
    const intel = await getOpportunityIntelligence();
    currentOpportunity = intel?.opportunities?.find(
      (o: any) => o.symbol === plan.symbol
    ) ?? null;
  } catch { /* degrade */ }

  const change = computeResearchChange(plan.researchSnapshot, currentOpportunity);
  const { health: planHealth, reason: healthReason } = computePlanHealth(
    plan.researchSnapshot, currentOpportunity
  );

  // Update stored health if it changed
  if (planHealth !== plan.planHealth) {
    await db
      .update(tradePlans)
      .set({ planHealth, updatedAt: new Date() })
      .where(and(eq(tradePlans.id, planId), eq(tradePlans.userId, userId)))
      .catch(() => { /* non-critical */ });
  }

  return { plan, change, planHealth, healthReason };
}

// ============================================================================
// Versioning
// ============================================================================

export async function getPlanVersions(
  userId: string,
  planId: string,
): Promise<TradePlanVersion[]> {
  // Validate ownership first
  const plan = await getTradePlan(userId, planId);
  if (!plan) return [];

  const rows = await db
    .select()
    .from(tradePlanVersions)
    .where(and(eq(tradePlanVersions.tradePlanId, planId), eq(tradePlanVersions.userId, userId)))
    .orderBy(asc(tradePlanVersions.version));

  return rows.map(_rowToVersion);
}

export async function createPlanVersion(
  userId: string,
  planId: string,
  req: CreateTradePlanVersionRequest,
): Promise<{ plan: TradePlan; version: TradePlanVersion } | null> {
  const plan = await getTradePlan(userId, planId);
  if (!plan) return null;

  // Persist current state as a version record before bumping
  const [versionRow] = await db.insert(tradePlanVersions).values({
    tradePlanId:      planId,
    userId,
    version:          plan.version,
    changeReason:     req.changeReason ?? null,
    researchSnapshot: plan.researchSnapshot as unknown as Record<string, unknown>,
    planningSnapshot: plan.planningSnapshot as unknown as Record<string, unknown>,
    structureSnapshot: plan.structureSnapshot as unknown as Record<string, unknown> | undefined,
    riskSnapshot:     plan.riskSnapshot as unknown as Record<string, unknown> | undefined,
  }).returning();

  // Bump version on the plan
  const [updatedRow] = await db
    .update(tradePlans)
    .set({ version: plan.version + 1, updatedAt: new Date() })
    .where(and(eq(tradePlans.id, planId), eq(tradePlans.userId, userId)))
    .returning();

  return {
    plan:    _rowToPlan(updatedRow),
    version: _rowToVersion(versionRow),
  };
}

// ============================================================================
// Monitoring Context (2.7.6 handoff)
// ============================================================================

export async function getMonitoringContext(
  userId: string,
  planId: string,
): Promise<TradePlanMonitoringInput | null> {
  const plan = await getTradePlan(userId, planId);
  if (!plan) return null;

  const structureSummary = plan.planType === "OPTIONS"
    ? `Options: ${(plan.structureSnapshot as any)?.strategyLabel ?? "unknown strategy"}`
    : `Equity: ${plan.selectedExpressionFamily}`;

  return {
    tradePlanId:            plan.id,
    symbol:                 plan.symbol,
    researchSnapshot:       plan.researchSnapshot,
    invalidationConditions: plan.researchSnapshot.invalidatesThesis,
    monitoringPlan:         plan.monitoringSnapshot.monitoringPlan,
    structureSummary,
    riskFlags:              plan.riskSnapshot?.riskFlags ?? [],
    freshnessRequirements:  ["research_data", "market_data"],
  };
}

// ============================================================================
// Platform Health (admin aggregate — no PII)
// ============================================================================

export async function getTradePlanHealthMetrics(): Promise<TradePlanHealthMetrics> {
  try {
    const counts = await db
      .select({
        status: tradePlans.status,
        planHealth: tradePlans.planHealth,
        count: sql<number>`count(*)::int`,
        lastCreatedAt: sql<string>`max(created_at)::text`,
      })
      .from(tradePlans)
      .groupBy(tradePlans.status, tradePlans.planHealth);

    let activeTradePlans   = 0;
    let monitoringTradePlans = 0;
    let archivedTradePlans = 0;
    let plansRequiringReview = 0;
    let invalidatedPlans   = 0;
    let lastCreatedAt: string | null = null;

    for (const row of counts) {
      if (row.status === "DRAFT" || row.status === "RESEARCH_COMPLETE") activeTradePlans += row.count;
      if (row.status === "MONITORING") monitoringTradePlans += row.count;
      if (row.status === "ARCHIVED")   archivedTradePlans += row.count;
      if (row.planHealth === "REQUIRES_REVIEW") plansRequiringReview += row.count;
      if (row.planHealth === "THESIS_INVALIDATED") invalidatedPlans += row.count;
      if (row.lastCreatedAt && (!lastCreatedAt || row.lastCreatedAt > lastCreatedAt)) {
        lastCreatedAt = row.lastCreatedAt;
      }
    }

    const avgLatencyMs = _healthCounters.planCreationCount > 0
      ? Math.round(_healthCounters.totalCreationLatencyMs / _healthCounters.planCreationCount)
      : null;

    return {
      tradePlansCreated:           _healthCounters.tradePlansCreated,
      activeTradePlans,
      monitoringTradePlans,
      archivedTradePlans,
      plansRequiringReview,
      invalidatedPlans,
      planCreationFailures:        _healthCounters.planCreationFailures,
      averagePlanCreationLatencyMs: avgLatencyMs,
      lastTradePlanCreatedAt:      lastCreatedAt,
    };
  } catch {
    return {
      tradePlansCreated:           _healthCounters.tradePlansCreated,
      activeTradePlans:            0,
      monitoringTradePlans:        0,
      archivedTradePlans:          0,
      plansRequiringReview:        0,
      invalidatedPlans:            0,
      planCreationFailures:        _healthCounters.planCreationFailures,
      averagePlanCreationLatencyMs: null,
      lastTradePlanCreatedAt:      null,
    };
  }
}

// ============================================================================
// Startup table initialisation (idempotent — CREATE TABLE IF NOT EXISTS)
// ============================================================================

export async function ensureTradePlanTables(): Promise<void> {
  try {
    // ── trade_planning_sessions ──────────────────────────────────────────────
    // Sprint 2.7.0 introduced this table via migrations/028_trade_planning_sessions.sql.
    // That file is never auto-executed on Railway — this block is the canonical
    // idempotent creator.  All columns from migration 028 + 029 are included so
    // a fresh Railway deployment never hits a missing-table error.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS trade_planning_sessions (
        id                         VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                    TEXT NOT NULL,
        symbol                     VARCHAR(20) NOT NULL,
        opportunity_id             TEXT,
        research_goal_id           TEXT,
        portfolio_id               TEXT,
        constraints                JSONB NOT NULL DEFAULT '{"equityAllowed":true,"optionsAllowed":false}',
        selected_expression_family TEXT,
        broad_expression_type      TEXT DEFAULT NULL,
        expression_selected_by     TEXT DEFAULT NULL,
        created_at                 TIMESTAMPTZ DEFAULT NOW(),
        updated_at                 TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tps_user_id     ON trade_planning_sessions (user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tps_user_symbol ON trade_planning_sessions (user_id, symbol)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tps_updated     ON trade_planning_sessions (updated_at DESC)`);

    // CHECK constraint — additive, idempotent
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'trade_planning_sessions'
            AND constraint_name = 'chk_expression_family'
        ) THEN
          ALTER TABLE trade_planning_sessions
            ADD CONSTRAINT chk_expression_family
            CHECK (
              selected_expression_family IS NULL
              OR selected_expression_family IN (
                'equity','equity_scaled','income','defined_risk_directional',
                'covered_call','cash_secured_put','vertical_spread',
                'long_option','neutral_options','advanced_options','monitor_only'
              )
            );
        END IF;
      END $$;
    `);

    // Additive column migration for existing Railway tables (migration 029 + later)
    await db.execute(sql`
      ALTER TABLE trade_planning_sessions
        ADD COLUMN IF NOT EXISTS broad_expression_type  TEXT DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS expression_selected_by TEXT DEFAULT NULL
    `);

    // ── trade_plans ──────────────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS trade_plans (
        id                      VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                 TEXT NOT NULL,
        symbol                  VARCHAR(20) NOT NULL,
        company_name            TEXT,
        plan_type               TEXT NOT NULL,
        status                  TEXT NOT NULL DEFAULT 'DRAFT',
        plan_health             TEXT NOT NULL DEFAULT 'UNKNOWN',
        planning_context_id     TEXT NOT NULL,
        research_goal_id        TEXT,
        portfolio_id            TEXT,
        selected_expression_family TEXT NOT NULL,
        research_snapshot       JSONB NOT NULL DEFAULT '{}',
        planning_snapshot       JSONB NOT NULL DEFAULT '{}',
        structure_snapshot      JSONB,
        risk_snapshot           JSONB,
        monitoring_snapshot     JSONB NOT NULL DEFAULT '{}',
        user_notes              TEXT,
        review_checklist        JSONB NOT NULL DEFAULT '{}',
        version                 INTEGER NOT NULL DEFAULT 1,
        freshness_at_creation   TEXT NOT NULL DEFAULT 'unknown',
        limitations             JSONB NOT NULL DEFAULT '[]',
        created_at              TIMESTAMPTZ DEFAULT NOW(),
        updated_at              TIMESTAMPTZ DEFAULT NOW(),
        archived_at             TIMESTAMPTZ,
        completed_research_at   TIMESTAMPTZ,
        monitoring_started_at   TIMESTAMPTZ
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tp_user_id ON trade_plans(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tp_user_status ON trade_plans(user_id, status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tp_user_symbol ON trade_plans(user_id, symbol)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tp_created_at ON trade_plans(created_at DESC)`);

    // ── Additive column migrations for trade_plans ─────────────────────────
    // Columns added after Sprint 2.7.5 that were NOT in the original CREATE TABLE.
    // Each ALTER is idempotent (ADD COLUMN IF NOT EXISTS).
    // This block is the canonical deployment path; the standalone .sql migration
    // files in server/migrations/ are supplemental and NOT auto-executed on Railway.
    //
    // Column history:
    //   broad_expression_type   — Sprint 2.8.1A (Expression Selection UX)
    //   expression_selected_by  — Sprint 2.8.1A (always "USER")
    //   expression_selected_at  — Sprint 2.8.1A (timestamp of expression lock)
    //   last_reviewed_at              — Sprint 2.8.6A Defect-9 (explicit research review)
    //   last_reviewed_research_state  — Sprint 2.8.6A Defect-10c-prod (reviewed-state baseline)
    await db.execute(sql`
      ALTER TABLE trade_plans
        ADD COLUMN IF NOT EXISTS broad_expression_type        TEXT,
        ADD COLUMN IF NOT EXISTS expression_selected_by       TEXT,
        ADD COLUMN IF NOT EXISTS expression_selected_at       TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_reviewed_at        TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_reviewed_research_state JSONB DEFAULT NULL
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS trade_plan_versions (
        id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        trade_plan_id  VARCHAR NOT NULL,
        user_id        TEXT NOT NULL,
        version        INTEGER NOT NULL,
        change_reason  TEXT,
        research_snapshot  JSONB NOT NULL DEFAULT '{}',
        planning_snapshot  JSONB NOT NULL DEFAULT '{}',
        structure_snapshot JSONB,
        risk_snapshot      JSONB,
        created_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tpv_plan_id ON trade_plan_versions(trade_plan_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tpv_user_id ON trade_plan_versions(user_id)`);

    console.log(JSON.stringify({ event: "trade_plan_tables_ready", ts: new Date().toISOString() }));
  } catch (err: any) {
    console.error(JSON.stringify({ event: "trade_plan_tables_error", error: err?.message, ts: new Date().toISOString() }));
    // Non-fatal — DB already exists on most startups
  }
}

// ============================================================================
// Helper for opportunity workspace integration
// ============================================================================

/** Get lightweight plan summaries for a symbol (for Opportunity Workspace). */
export async function getPlansForSymbol(
  userId: string,
  symbol: string,
): Promise<TradePlanSummary[]> {
  const result = await listTradePlans(userId, {
    symbol,
    status: ["DRAFT", "RESEARCH_COMPLETE", "MONITORING"],
    sort: "updated",
    limit: 5,
  });
  return result.plans;
}
