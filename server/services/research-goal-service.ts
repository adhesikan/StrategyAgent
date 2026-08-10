/**
 * Research Goal Service — Sprint 2.6.5
 *
 * Responsibilities:
 *   1. Goal CRUD (create, read, update, archive)
 *   2. Primary goal management (one per user)
 *   3. Deterministic goal matching against OppIntel snapshot
 *   4. Goal activity assembly from change intelligence
 *   5. Goal research context for Research Workspace
 *   6. Research plan generation
 *   7. Platform health
 *
 * COMPLIANCE:
 *   - No suitability scoring
 *   - No financial questionnaire data
 *   - No recommendation language
 *   - Match states are categorical, never numeric suitability scores
 *   - AI receives goal context but NEVER invents goal matches
 *
 * OWNERSHIP: Always query WHERE id = ? AND user_id = ?
 * Cross-user access returns null (caller maps to 404).
 */

import { db } from "../db";
import { researchGoals } from "../../shared/schema";
import { eq, and, desc, ne, count } from "drizzle-orm";
import type {
  ResearchGoal,
  CreateResearchGoalInput,
  UpdateResearchGoalInput,
  GoalType,
  ResearchHorizon,
  ResearchStyle,
  VolatilityPreference,
  GoalStatus,
  GoalMatchResult,
  GoalMatchState,
  GoalMatchSummary,
  GoalActivitySummary,
  GoalActivityItem,
  GoalResearchContext,
  ResearchPlan,
  ResearchPlanAction,
  ResearchGoalHealthSnapshot,
} from "../../shared/research-goal-types";
import {
  GOAL_TYPES,
  RESEARCH_HORIZONS,
  RESEARCH_STYLES,
  VOLATILITY_PREFERENCES,
  GOAL_TYPE_LABELS,
  RESEARCH_HORIZON_LABELS,
  RESEARCH_STYLE_LABELS,
  VOLATILITY_PREFERENCE_LABELS,
  HORIZON_TO_TIME_HORIZON_MAP,
  GOAL_COMPLIANCE_DISCLAIMER,
} from "../../shared/research-goal-types";
import { getOpportunityIntelligence } from "./opportunity-intelligence-service";

// ---------------------------------------------------------------------------
// Health metrics (in-memory, reset on restart)
// ---------------------------------------------------------------------------

const healthMetrics = {
  matchRequests:       0,
  matchRequestsOk:     0,
  failedMatchRequests: 0,
  totalMatchMs:        0,
  matchCount:          0,
};

function recordMatchRequest(ok: boolean, durationMs: number): void {
  healthMetrics.matchRequests++;
  if (ok) {
    healthMetrics.matchRequestsOk++;
    healthMetrics.totalMatchMs += durationMs;
    healthMetrics.matchCount++;
  } else {
    healthMetrics.failedMatchRequests++;
  }
}

// ---------------------------------------------------------------------------
// Helpers — row to domain model
// ---------------------------------------------------------------------------

function rowToGoal(row: typeof researchGoals.$inferSelect): ResearchGoal {
  return {
    id:                        row.id,
    userId:                    row.userId,
    name:                      row.name,
    goalType:                  row.goalType as GoalType,
    description:               row.description ?? null,
    horizon:                   row.horizon as ResearchHorizon,
    researchStyle:             row.researchStyle as ResearchStyle,
    focusAreas:                (row.focusAreas as string[]) ?? [],
    preferredSectors:          (row.preferredSectors as string[]) ?? [],
    preferredThemes:           (row.preferredThemes as string[]) ?? [],
    preferredOpportunityTypes: (row.preferredOpportunityTypes as string[]) ?? [],
    volatilityPreference:      row.volatilityPreference as VolatilityPreference,
    optionsInterest:           row.optionsInterest,
    monitoringEnabled:         row.monitoringEnabled,
    isPrimary:                 row.isPrimary,
    status:                    row.status as GoalStatus,
    createdAt:                 row.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt:                 row.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateGoalType(t: string): t is GoalType {
  return GOAL_TYPES.includes(t as GoalType);
}

export function validateHorizon(h: string): h is ResearchHorizon {
  return RESEARCH_HORIZONS.includes(h as ResearchHorizon);
}

export function validateResearchStyle(s: string): s is ResearchStyle {
  return RESEARCH_STYLES.includes(s as ResearchStyle);
}

export function validateVolatilityPreference(v: string): v is VolatilityPreference {
  return VOLATILITY_PREFERENCES.includes(v as VolatilityPreference);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listGoals(
  userId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<ResearchGoal[]> {
  const rows = await db
    .select()
    .from(researchGoals)
    .where(
      opts.includeArchived
        ? eq(researchGoals.userId, userId)
        : and(
            eq(researchGoals.userId, userId),
            ne(researchGoals.status, "archived"),
          ),
    )
    .orderBy(desc(researchGoals.isPrimary), desc(researchGoals.createdAt));

  return rows.map(rowToGoal);
}

export async function getGoal(
  goalId: string,
  userId: string,
): Promise<ResearchGoal | null> {
  const [row] = await db
    .select()
    .from(researchGoals)
    .where(and(eq(researchGoals.id, goalId), eq(researchGoals.userId, userId)))
    .limit(1);

  return row ? rowToGoal(row) : null;
}

export async function getPrimaryGoal(userId: string): Promise<ResearchGoal | null> {
  const [row] = await db
    .select()
    .from(researchGoals)
    .where(
      and(
        eq(researchGoals.userId, userId),
        eq(researchGoals.isPrimary, true),
        eq(researchGoals.status, "active"),
      ),
    )
    .limit(1);

  return row ? rowToGoal(row) : null;
}

export async function createGoal(
  userId: string,
  input: CreateResearchGoalInput,
): Promise<ResearchGoal> {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("name is required");
  if (!validateGoalType(input.goalType)) throw new Error(`Invalid goalType: ${input.goalType}`);
  if (!validateHorizon(input.horizon)) throw new Error(`Invalid horizon: ${input.horizon}`);
  if (!validateResearchStyle(input.researchStyle)) throw new Error(`Invalid researchStyle: ${input.researchStyle}`);
  const volatilityPreference: VolatilityPreference = validateVolatilityPreference(input.volatilityPreference ?? "balanced")
    ? input.volatilityPreference as VolatilityPreference
    : "balanced";

  // Check if this is the first goal — make it primary automatically
  const existingGoals = await listGoals(userId);
  const isFirst = existingGoals.length === 0;

  const [row] = await db
    .insert(researchGoals)
    .values({
      userId,
      name,
      goalType:                  input.goalType,
      description:               input.description?.slice(0, 500) ?? null,
      horizon:                   input.horizon,
      researchStyle:             input.researchStyle,
      focusAreas:                input.focusAreas ?? [],
      preferredSectors:          input.preferredSectors ?? [],
      preferredThemes:           input.preferredThemes ?? [],
      preferredOpportunityTypes: input.preferredOpportunityTypes ?? [],
      volatilityPreference,
      optionsInterest:           input.optionsInterest ?? false,
      monitoringEnabled:         input.monitoringEnabled ?? false,
      isPrimary:                 isFirst,
      status:                    "active",
    })
    .returning();

  console.log(JSON.stringify({
    event:          "research_goal_created",
    goalType:       row.goalType,
    horizon:        row.horizon,
    numberOfFocusAreas: ((row.focusAreas as string[]) ?? []).length,
    ts:             new Date().toISOString(),
  }));

  return rowToGoal(row);
}

export async function updateGoal(
  goalId: string,
  userId: string,
  input: UpdateResearchGoalInput,
): Promise<ResearchGoal | null> {
  const existing = await getGoal(goalId, userId);
  if (!existing) return null;

  const updates: Partial<typeof researchGoals.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined)               updates.name = input.name.trim().slice(0, 120);
  if (input.description !== undefined)        updates.description = input.description?.slice(0, 500) ?? null;
  if (input.horizon !== undefined && validateHorizon(input.horizon)) {
    updates.horizon = input.horizon;
  }
  if (input.researchStyle !== undefined && validateResearchStyle(input.researchStyle)) {
    updates.researchStyle = input.researchStyle;
  }
  if (input.focusAreas !== undefined)               updates.focusAreas = input.focusAreas;
  if (input.preferredSectors !== undefined)         updates.preferredSectors = input.preferredSectors;
  if (input.preferredThemes !== undefined)          updates.preferredThemes = input.preferredThemes;
  if (input.preferredOpportunityTypes !== undefined) updates.preferredOpportunityTypes = input.preferredOpportunityTypes;
  if (input.volatilityPreference !== undefined && validateVolatilityPreference(input.volatilityPreference)) {
    updates.volatilityPreference = input.volatilityPreference;
  }
  if (input.optionsInterest !== undefined)    updates.optionsInterest = input.optionsInterest;
  if (input.monitoringEnabled !== undefined)  updates.monitoringEnabled = input.monitoringEnabled;
  if (input.status !== undefined && ["active", "paused", "archived"].includes(input.status)) {
    updates.status = input.status;
  }

  // Invalidate match cache
  invalidateGoalMatchCache(userId, goalId);

  const [row] = await db
    .update(researchGoals)
    .set(updates)
    .where(and(eq(researchGoals.id, goalId), eq(researchGoals.userId, userId)))
    .returning();

  if (!row) return null;

  console.log(JSON.stringify({
    event:    "research_goal_updated",
    goalType: row.goalType,
    horizon:  row.horizon,
    ts:       new Date().toISOString(),
  }));

  return rowToGoal(row);
}

export async function archiveGoal(
  goalId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .update(researchGoals)
    .set({ status: "archived", isPrimary: false, updatedAt: new Date() })
    .where(and(eq(researchGoals.id, goalId), eq(researchGoals.userId, userId)));

  invalidateGoalMatchCache(userId, goalId);

  console.log(JSON.stringify({
    event: "research_goal_archived",
    ts:    new Date().toISOString(),
  }));

  return (result.rowCount ?? 0) > 0;
}

export async function deleteGoal(
  goalId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(researchGoals)
    .where(and(eq(researchGoals.id, goalId), eq(researchGoals.userId, userId)));

  invalidateGoalMatchCache(userId, goalId);
  return (result.rowCount ?? 0) > 0;
}

export async function setPrimaryGoal(
  goalId: string,
  userId: string,
): Promise<ResearchGoal | null> {
  const target = await getGoal(goalId, userId);
  if (!target || target.status === "archived") return null;

  // Clear existing primary (service-level enforcement — one primary per user)
  await db
    .update(researchGoals)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(and(eq(researchGoals.userId, userId), eq(researchGoals.isPrimary, true)));

  // Set new primary
  const [row] = await db
    .update(researchGoals)
    .set({ isPrimary: true, updatedAt: new Date() })
    .where(and(eq(researchGoals.id, goalId), eq(researchGoals.userId, userId)))
    .returning();

  if (!row) return null;

  console.log(JSON.stringify({
    event:    "research_goal_primary_changed",
    goalType: row.goalType,
    ts:       new Date().toISOString(),
  }));

  return rowToGoal(row);
}

// ---------------------------------------------------------------------------
// Goal matching — deterministic, no AI, no ranking changes
// ---------------------------------------------------------------------------

/**
 * Match cache — keyed by userId:goalId:oppGenId
 * Invalidated when goal changes or opportunity intelligence refreshes.
 * Never shared across users.
 */
const matchCache = new Map<string, { result: GoalMatchSummary; cachedAt: number }>();

function matchCacheKey(userId: string, goalId: string, oppGenId: string): string {
  return `${userId}:${goalId}:${oppGenId}`;
}

function invalidateGoalMatchCache(userId: string, goalId: string): void {
  for (const key of Array.from(matchCache.keys())) {
    if (key.startsWith(`${userId}:${goalId}:`)) {
      matchCache.delete(key);
    }
  }
}

/**
 * Compute a categorical match state for one opportunity against one goal.
 * NEVER computes a numeric suitability score.
 */
export function matchOpportunityToGoal(
  opp: {
    symbol:          string;
    companyName:     string | null;
    sector:          string | null;
    themes:          string[];
    opportunityType: string;
    timeHorizon?:    string | null;
    riskLevel?:      string | null;
    institutionalScore?: number;
    technicalScore?: number;
    researchScore?:  number;
  },
  goal: ResearchGoal,
): GoalMatchResult {
  const matchReasons: string[] = [];
  const matchedThemes: string[] = [];
  const matchedSectors: string[] = [];
  const matchedTypes: string[] = [];
  let matchScore = 0;

  // --- Theme matching ---
  if (goal.preferredThemes.length > 0) {
    for (const theme of opp.themes) {
      if (goal.preferredThemes.some(pt => theme.toLowerCase().includes(pt.toLowerCase()) || pt.toLowerCase().includes(theme.toLowerCase()))) {
        matchedThemes.push(theme);
      }
    }
    if (matchedThemes.length > 0) {
      matchScore += matchedThemes.length >= 2 ? 2 : 1;
      matchReasons.push(`${matchedThemes.slice(0, 2).join(", ")} theme${matchedThemes.length > 1 ? "s" : ""}`);
    }
  }

  // --- Sector matching ---
  if (goal.preferredSectors.length > 0 && opp.sector) {
    const sectorMatch = goal.preferredSectors.some(s =>
      s.toLowerCase() === opp.sector!.toLowerCase() ||
      opp.sector!.toLowerCase().includes(s.toLowerCase()),
    );
    if (sectorMatch) {
      matchedSectors.push(opp.sector);
      matchScore += 1;
      matchReasons.push(`${opp.sector} sector`);
    }
  }

  // --- Opportunity type matching ---
  if (goal.preferredOpportunityTypes.length > 0) {
    if (goal.preferredOpportunityTypes.includes(opp.opportunityType)) {
      matchedTypes.push(opp.opportunityType);
      matchScore += 1;
      matchReasons.push(`${opp.opportunityType.replace(/_/g, " ")} type`);
    }
  }

  // --- Horizon alignment ---
  let horizonAligned = false;
  if (opp.timeHorizon) {
    const goalHorizons = HORIZON_TO_TIME_HORIZON_MAP[goal.horizon] ?? [];
    horizonAligned = goalHorizons.includes(opp.timeHorizon);
    if (horizonAligned) {
      matchScore += 1;
      matchReasons.push(`${RESEARCH_HORIZON_LABELS[goal.horizon]} research horizon`);
    }
  } else {
    // Horizon unknown — don't penalize
    horizonAligned = false;
  }

  // --- Style alignment ---
  let styleAligned = false;
  const styleToFilter: Partial<Record<ResearchStyle, () => boolean>> = {
    growth:                 () => (opp.researchScore ?? 0) >= 55,
    momentum:               () => (opp.technicalScore ?? 0) >= 55,
    institutional_activity: () => (opp.institutionalScore ?? 0) >= 40,
    income:                 () => ["income", "dividend_income"].includes(opp.opportunityType) || goal.preferredOpportunityTypes.includes("income"),
    technical:              () => (opp.technicalScore ?? 0) >= 50,
    fundamental:            () => (opp.researchScore ?? 0) >= 50,
  };
  const styleFn = styleToFilter[goal.researchStyle];
  styleAligned = styleFn ? styleFn() : true; // balanced, value, quality, thematic → always aligned

  // --- Volatility preference ---
  if (opp.riskLevel) {
    if (goal.volatilityPreference === "lower" && opp.riskLevel === "high") {
      matchScore = Math.max(0, matchScore - 1);
    }
  }

  // --- Options interest ---
  if (goal.optionsInterest && ["covered_call", "cash_secured_put", "options"].includes(opp.opportunityType)) {
    matchScore += 1;
    matchReasons.push("options research interest");
  }

  // Determine categorical match state
  let matchState: GoalMatchState;
  const hasAnyFilter =
    goal.preferredThemes.length > 0 ||
    goal.preferredSectors.length > 0 ||
    goal.preferredOpportunityTypes.length > 0;

  if (!hasAnyFilter) {
    // Goal has no specific filters — everything is a match
    matchState = "match";
    matchReasons.push("matches research goal criteria");
  } else if (matchScore >= 3) {
    matchState = "strong_match";
  } else if (matchScore >= 2) {
    matchState = "match";
  } else if (matchScore >= 1) {
    matchState = "partial_match";
  } else {
    matchState = "outside_filters";
  }

  return {
    goalId:                    goal.id,
    goalName:                  goal.name,
    symbol:                    opp.symbol,
    companyName:               opp.companyName,
    matchState,
    matchReasons,
    matchedThemes,
    matchedSectors,
    matchedOpportunityTypes:   matchedTypes,
    horizonAligned,
    styleAligned,
  };
}

export async function computeGoalMatches(
  goal: ResearchGoal,
  opts: { maxResults?: number; minState?: GoalMatchState } = {},
): Promise<GoalMatchSummary> {
  const start = Date.now();
  const maxResults = opts.maxResults ?? 50;

  try {
    const oppResult = await getOpportunityIntelligence().catch(() => null);
    const opps = oppResult?.opportunities ?? [];
    const oppGenId = oppResult?.generatedAt ?? "no_snapshot";

    // Check match cache
    const cacheKey = matchCacheKey(goal.userId, goal.id, oppGenId);
    const cached = matchCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < 5 * 60 * 1000) {
      recordMatchRequest(true, Date.now() - start);
      return cached.result;
    }

    // Compute matches deterministically
    const allMatches: GoalMatchResult[] = [];
    for (const opp of opps) {
      const result = matchOpportunityToGoal(
        {
          symbol:             opp.symbol,
          companyName:        opp.companyName,
          sector:             opp.sector,
          themes:             opp.themes,
          opportunityType:    opp.opportunityType,
          timeHorizon:        opp.timeHorizon,
          riskLevel:          opp.riskLevel,
          institutionalScore: opp.institutionalScore,
          technicalScore:     opp.technicalScore,
          researchScore:      opp.researchScore,
        },
        goal,
      );
      if (result.matchState !== "outside_filters") {
        allMatches.push(result);
      }
    }

    // Sort: strong_match first, then match, then partial_match
    const ORDER: Record<GoalMatchState, number> = {
      strong_match:    0,
      match:           1,
      partial_match:   2,
      outside_filters: 3,
    };
    allMatches.sort((a, b) => ORDER[a.matchState] - ORDER[b.matchState]);

    const strongMatches  = allMatches.filter(m => m.matchState === "strong_match").length;
    const matches        = allMatches.filter(m => m.matchState === "match").length;
    const partialMatches = allMatches.filter(m => m.matchState === "partial_match").length;

    const summary: GoalMatchSummary = {
      goalId:        goal.id,
      goalName:      goal.name,
      totalMatched:  allMatches.length,
      strongMatches,
      matches,
      partialMatches,
      topMatches:    allMatches.slice(0, maxResults),
      generatedAt:   new Date().toISOString(),
    };

    matchCache.set(cacheKey, { result: summary, cachedAt: Date.now() });

    console.log(JSON.stringify({
      event:       "research_goal_matches_requested",
      goalType:    goal.goalType,
      matchCount:  allMatches.length,
      durationMs:  Date.now() - start,
      ts:          new Date().toISOString(),
    }));

    recordMatchRequest(true, Date.now() - start);
    return summary;
  } catch (err: any) {
    recordMatchRequest(false, Date.now() - start);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Goal activity — from change intelligence
// ---------------------------------------------------------------------------

export async function computeGoalActivity(
  goal: ResearchGoal,
): Promise<GoalActivitySummary> {
  const start = Date.now();

  try {
    const oppResult = await getOpportunityIntelligence().catch(() => null);
    const opps = oppResult?.opportunities ?? [];

    // Find matching symbols
    const matchingMatches: Array<{ symbol: string; matchState: string; researchScore: number }> = [];
    for (const opp of opps) {
      const mr = matchOpportunityToGoal(
        { symbol: opp.symbol, companyName: opp.companyName, sector: opp.sector,
          themes: opp.themes, opportunityType: opp.opportunityType,
          timeHorizon: opp.timeHorizon, riskLevel: opp.riskLevel,
          researchScore: opp.researchScore },
        goal,
      );
      if (mr.matchState !== "outside_filters") {
        matchingMatches.push({ symbol: opp.symbol, matchState: mr.matchState, researchScore: opp.researchScore });
      }
    }

    // Build activity items from current snapshot (deterministic)
    const items: GoalActivityItem[] = [];
    const strongMatches = matchingMatches.filter(m => m.matchState === "strong_match");
    const regularMatches = matchingMatches.filter(m => m.matchState === "match");

    if (strongMatches.length > 0) {
      items.push({
        type:      "new_candidate",
        label:     `${strongMatches.length} candidate${strongMatches.length > 1 ? "s" : ""} strongly match this goal`,
        detail:    `${strongMatches.slice(0, 3).map(m => m.symbol).join(", ")} meet multiple goal filters`,
        direction: "positive",
        observedAt: new Date().toISOString(),
      });
    }

    if (goal.preferredThemes.length > 0) {
      const matchedThemeCount = new Set(
        opps.flatMap(o => o.themes.filter(t =>
          goal.preferredThemes.some(pt => t.toLowerCase().includes(pt.toLowerCase()))
        ))
      ).size;
      if (matchedThemeCount > 0) {
        items.push({
          type:      "theme_change",
          label:     `${matchedThemeCount} theme${matchedThemeCount > 1 ? "s" : ""} active in goal filters`,
          detail:    `${goal.preferredThemes.slice(0, 2).join(", ")} themes have qualifying candidates`,
          direction: "positive",
          observedAt: new Date().toISOString(),
        });
      }
    }

    console.log(JSON.stringify({
      event:      "research_goal_activity_requested",
      goalType:   goal.goalType,
      matchCount: matchingMatches.length,
      durationMs: Date.now() - start,
      ts:         new Date().toISOString(),
    }));

    return {
      goalId:        goal.id,
      goalName:      goal.name,
      newCandidates: strongMatches.length,
      strengthened:  regularMatches.length,
      weakened:      0,
      themeChanges:  goal.preferredThemes.length,
      items:         items.slice(0, 10),
      generatedAt:   new Date().toISOString(),
    };
  } catch {
    return {
      goalId:        goal.id,
      goalName:      goal.name,
      newCandidates: 0,
      strengthened:  0,
      weakened:      0,
      themeChanges:  0,
      items:         [],
      generatedAt:   new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Goal research context (for Research Workspace integration)
// ---------------------------------------------------------------------------

export async function buildGoalResearchContext(
  goal: ResearchGoal,
): Promise<GoalResearchContext> {
  const matchingSummary = await computeGoalMatches(goal, { maxResults: 20 }).catch(() => ({
    goalId:        goal.id,
    goalName:      goal.name,
    totalMatched:  0,
    strongMatches: 0,
    matches:       0,
    partialMatches: 0,
    topMatches:    [],
    generatedAt:   new Date().toISOString(),
  } as GoalMatchSummary));

  return {
    goalId:                    goal.id,
    goalName:                  goal.name,
    goalType:                  goal.goalType,
    horizon:                   goal.horizon,
    researchStyle:             goal.researchStyle,
    preferredSectors:          goal.preferredSectors,
    preferredThemes:           goal.preferredThemes,
    preferredOpportunityTypes: goal.preferredOpportunityTypes,
    volatilityPreference:      goal.volatilityPreference,
    matchingSummary,
    disclaimer:                GOAL_COMPLIANCE_DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// Research Plan
// ---------------------------------------------------------------------------

export async function buildResearchPlan(goal: ResearchGoal): Promise<ResearchPlan> {
  const matchSummary = await computeGoalMatches(goal, { maxResults: 10 }).catch(() => null);
  const topSymbols = matchSummary?.topMatches.filter(m => m.matchState !== "outside_filters").slice(0, 5).map(m => m.symbol) ?? [];

  const monitorItems: string[] = [
    ...goal.preferredThemes.slice(0, 4),
    ...goal.preferredSectors.slice(0, 2),
  ];

  if (monitorItems.length === 0) {
    monitorItems.push(GOAL_TYPE_LABELS[goal.goalType]);
  }

  const actions: ResearchPlanAction[] = [
    {
      label:       "View Matching Research",
      description: "Browse research candidates that match this goal's filters",
      url:         `/goals/${goal.id}`,
    },
    {
      label:       "Open AI Research Workspace",
      description: "Research matching candidates with AI assistance",
      url:         `/research-workspace?goalId=${goal.id}&mode=opportunity`,
    },
    {
      label:       "Compare Candidates",
      description: "Compare top matching candidates side by side",
      url:         topSymbols.length >= 2
        ? `/research-workspace?mode=comparison&symbols=${topSymbols.slice(0, 3).join(",")}&goalId=${goal.id}`
        : `/research-workspace?mode=comparison&goalId=${goal.id}`,
    },
    {
      label:       "Monitor This Goal",
      description: "Set up monitoring for research changes affecting this goal",
      url:         `/research-monitor`,
    },
    {
      label:       "Generate Research Report",
      description: "Create a research report focused on this goal",
      url:         `/research-reports`,
    },
  ];

  return {
    goalId:            goal.id,
    goalName:          goal.name,
    objective:         GOAL_TYPE_LABELS[goal.goalType],
    horizon:           RESEARCH_HORIZON_LABELS[goal.horizon],
    monitorItems,
    researchCandidates: topSymbols,
    suggestedActions:  actions,
    generatedAt:       new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Platform health
// ---------------------------------------------------------------------------

export async function getResearchGoalHealth(): Promise<ResearchGoalHealthSnapshot> {
  try {
    const [activeGoals, usersWithGoals, primaryGoals] = await Promise.all([
      db.select({ cnt: count() })
        .from(researchGoals)
        .where(eq(researchGoals.status, "active")),
      db.select({ cnt: count() })
        .from(researchGoals)
        .where(eq(researchGoals.status, "active"))
        .groupBy(researchGoals.userId),
      db.select({ cnt: count() })
        .from(researchGoals)
        .where(and(eq(researchGoals.isPrimary, true), eq(researchGoals.status, "active"))),
    ]);

    const avgMatchMs = healthMetrics.matchCount > 0
      ? Math.round(healthMetrics.totalMatchMs / healthMetrics.matchCount)
      : 0;

    return {
      activeGoals:           Number(activeGoals[0]?.cnt ?? 0),
      usersWithGoals:        usersWithGoals.length,
      primaryGoals:          Number(primaryGoals[0]?.cnt ?? 0),
      matchRequests:         healthMetrics.matchRequests,
      matchRequestsOk:       healthMetrics.matchRequestsOk,
      averageMatchLatencyMs: avgMatchMs,
      failedMatchRequests:   healthMetrics.failedMatchRequests,
    };
  } catch {
    return {
      activeGoals:           0,
      usersWithGoals:        0,
      primaryGoals:          0,
      matchRequests:         healthMetrics.matchRequests,
      matchRequestsOk:       healthMetrics.matchRequestsOk,
      averageMatchLatencyMs: 0,
      failedMatchRequests:   healthMetrics.failedMatchRequests,
    };
  }
}
