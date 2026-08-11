/**
 * server/services/trade-preferences-service.ts — Sprint 2.8.1A
 *
 * Pure computation engine for:
 *   - User trading preferences (presentation-only, not suitability)
 *   - Expression option compatibility cards per symbol/session
 *   - Broad expression selection persistence
 *
 * INVARIANTS:
 *   - Preferences affect presentation ordering only
 *   - Preferences cannot qualify/disqualify research candidates
 *   - Preferences cannot override broker permissions or strategy matching
 *   - selectedBy is always "USER" — AI cannot set this
 *   - Global preference update does not mutate existing trade plans or sessions
 *   - No financial questionnaire, no suitability, no risk profiling
 */

import { db } from "../db";
import { userSettings, tradePlanningSessions, tradePlans } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import type { ExpressionFamilyResult } from "../../shared/trade-planning-types";
import {
  BROAD_EXPRESSION_TYPES,
  BROAD_EXPRESSION_LABELS,
  BROAD_EXPRESSION_EDUCATIONAL,
  BROAD_TO_FAMILIES,
  isBroadExpressionType,
  EXPRESSION_COMPATIBILITY_STATUSES,
  TRADE_PREFERENCES_SETTINGS_DISCLAIMER,
  EXPRESSION_SELECTION_DISCLAIMER,
  COVERED_CALL_CAPITAL_NOTE,
  CSP_CAPITAL_NOTE,
  ADVANCED_OPTIONS_NOTE,
  TRADE_PREFERENCES_METHODOLOGY_VERSION,
} from "../../shared/trade-preference-types";
import type {
  BroadExpressionType,
  ExpressionCompatibilityStatus,
  ExpressionOption,
  ExpressionOptionsResult,
  UserTradingPreferences,
  OpportunityExpressionSelection,
} from "../../shared/trade-preference-types";

// ─────────────────────────────────────────────────────────────────────────────
// INJECTABLE DEPS (for testing)
// ─────────────────────────────────────────────────────────────────────────────

export interface TradePreferencesDeps {
  getEligibleFamilies?: (userId: string, sessionId: string) => Promise<ExpressionFamilyResult[]>;
  getUserSettingsRow?: (userId: string) => Promise<any | null>;
  updateUserSettingsRow?: (userId: string, patch: Record<string, unknown>) => Promise<void>;
  getPlanningSession?: (userId: string, sessionId: string) => Promise<any | null>;
  updatePlanningSession?: (userId: string, sessionId: string, patch: Record<string, unknown>) => Promise<void>;
  updateTradePlan?: (userId: string, planId: string, patch: Record<string, unknown>) => Promise<void>;
  now?: () => Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT DB IMPLEMENTATIONS
// ─────────────────────────────────────────────────────────────────────────────

async function defaultGetUserSettingsRow(userId: string): Promise<any | null> {
  const rows = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return rows[0] ?? null;
}

async function defaultUpdateUserSettingsRow(userId: string, patch: Record<string, unknown>): Promise<void> {
  const existing = await db.select({ id: userSettings.id }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  if (existing.length === 0) {
    await db.insert(userSettings).values({ userId, ...patch } as any);
  } else {
    await db.update(userSettings).set({ ...patch, updatedAt: new Date() } as any).where(eq(userSettings.userId, userId));
  }
}

async function defaultGetPlanningSession(userId: string, sessionId: string): Promise<any | null> {
  const rows = await db.select().from(tradePlanningSessions)
    .where(and(eq(tradePlanningSessions.id, sessionId), eq(tradePlanningSessions.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

async function defaultUpdatePlanningSession(userId: string, sessionId: string, patch: Record<string, unknown>): Promise<void> {
  await db.update(tradePlanningSessions)
    .set({ ...patch, updatedAt: new Date() } as any)
    .where(and(eq(tradePlanningSessions.id, sessionId), eq(tradePlanningSessions.userId, userId)));
}

async function defaultUpdateTradePlan(userId: string, planId: string, patch: Record<string, unknown>): Promise<void> {
  await db.update(tradePlans)
    .set({ ...patch, updatedAt: new Date() } as any)
    .where(and(eq(tradePlans.id, planId), eq(tradePlans.userId, userId)));
}

// ─────────────────────────────────────────────────────────────────────────────
// DB STARTUP
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureTradePreferencesTables(): Promise<void> {
  try {
    await db.execute(`
      ALTER TABLE user_settings
        ADD COLUMN IF NOT EXISTS preferred_expression_types JSONB DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS show_other_compatible_structures BOOLEAN DEFAULT true
    `);
    await db.execute(`
      ALTER TABLE trade_planning_sessions
        ADD COLUMN IF NOT EXISTS broad_expression_type TEXT DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS expression_selected_by TEXT DEFAULT NULL
    `);
    await db.execute(`
      ALTER TABLE trade_plans
        ADD COLUMN IF NOT EXISTS broad_expression_type TEXT DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS expression_selected_by TEXT DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS expression_selected_at TIMESTAMPTZ DEFAULT NULL
    `);
  } catch (e: any) {
    // Column already exists — idempotent
    if (!e?.message?.includes("already exists")) {
      console.error("[trade-preferences] table init error:", e?.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// USER TRADING PREFERENCES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get user's global trading preferences.
 * Returns defaults if none saved — never forces onboarding.
 */
export async function getUserTradingPreferences(
  userId: string,
  deps: TradePreferencesDeps = {}
): Promise<UserTradingPreferences> {
  const getRow = deps.getUserSettingsRow ?? defaultGetUserSettingsRow;
  const row = await getRow(userId);
  const now = (deps.now ?? (() => new Date()))();

  const preferredExpressionTypes: BroadExpressionType[] = [];
  if (Array.isArray(row?.preferredExpressionTypes)) {
    for (const v of row.preferredExpressionTypes) {
      if (isBroadExpressionType(v)) preferredExpressionTypes.push(v);
    }
  }

  return {
    userId,
    preferredExpressionTypes,
    showOtherCompatibleStructures: row?.showOtherCompatibleStructures !== false,
    updatedAt: row?.updatedAt?.toISOString?.() ?? now.toISOString(),
  };
}

/**
 * Save user's global trading preferences.
 * Validates all expression types. Trims duplicates.
 * Does NOT modify existing trade plans or planning sessions.
 */
export async function saveUserTradingPreferences(
  userId: string,
  raw: {
    preferredExpressionTypes: string[];
    showOtherCompatibleStructures?: boolean;
  },
  deps: TradePreferencesDeps = {}
): Promise<UserTradingPreferences> {
  const updateRow = deps.updateUserSettingsRow ?? defaultUpdateUserSettingsRow;

  // Validate and deduplicate
  const validated: BroadExpressionType[] = [];
  const seen = new Set<string>();
  for (const v of raw.preferredExpressionTypes ?? []) {
    if (isBroadExpressionType(v) && !seen.has(v)) {
      validated.push(v);
      seen.add(v);
    }
  }

  const showOther = raw.showOtherCompatibleStructures !== false;

  await updateRow(userId, {
    preferredExpressionTypes: validated,
    showOtherCompatibleStructures: showOther,
  });

  return getUserTradingPreferences(userId, deps);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPRESSION OPTION COMPUTATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine compatibility status for one broad expression type.
 * Uses the ExpressionFamilyResult[] from evaluateExpressionFamilies().
 * Does NOT duplicate strategy matching logic — reads results only.
 */
export function computeBroadCompatibility(
  broadType: BroadExpressionType,
  families: ExpressionFamilyResult[],
  portfolioContext?: {
    hasSharesOf?: (symbol: string) => boolean;
    symbol?: string;
  }
): { status: ExpressionCompatibilityStatus; reasons: string[]; requirements: string[]; limitations: string[]; compatibleFamilies: string[] } {
  const reasons: string[] = [];
  const requirements: string[] = [];
  const limitations: string[] = [];

  if (broadType === "EXPLORE_COMPATIBLE_STRUCTURES") {
    const compatibleFamilies = families
      .filter(f => f.status === "applicable" || f.status === "potentially_applicable")
      .map(f => f.family as string);
    reasons.push("Shows all research structure categories compatible with the current opportunity.");
    return { status: "AVAILABLE", reasons, requirements, limitations, compatibleFamilies };
  }

  const targetFamilies = BROAD_TO_FAMILIES[broadType];
  const matching = families.filter(f => targetFamilies.includes(f.family));

  const applicable    = matching.filter(f => f.status === "applicable");
  const potentiallyApp = matching.filter(f => f.status === "potentially_applicable");
  const unavailable   = matching.filter(f => f.status === "unavailable");
  const compatibleFamilies = [...applicable, ...potentiallyApp].map(f => f.family as string);

  // Collect all reasons from matching families
  for (const f of [...applicable, ...potentiallyApp]) {
    reasons.push(...f.reasons);
    limitations.push(...f.limitations);
    requirements.push(...f.constraintsMissing);
  }

  // Special handling per broad type
  if (broadType === "COVERED_CALL") {
    requirements.push(COVERED_CALL_CAPITAL_NOTE);
    if (portfolioContext?.symbol && portfolioContext.hasSharesOf) {
      const hasShares = portfolioContext.hasSharesOf(portfolioContext.symbol);
      if (!hasShares) {
        if (applicable.length > 0 || potentiallyApp.length > 0) {
          return { status: "AVAILABLE_WITH_REQUIREMENTS", reasons, requirements, limitations, compatibleFamilies };
        }
        return { status: "UNAVAILABLE", reasons: ["Covered call research requires confirmed share ownership."], requirements, limitations, compatibleFamilies: [] };
      }
    }
    if (applicable.length > 0) return { status: "AVAILABLE", reasons, requirements, limitations, compatibleFamilies };
    if (potentiallyApp.length > 0) return { status: "AVAILABLE_WITH_REQUIREMENTS", reasons, requirements, limitations, compatibleFamilies };
    return { status: "UNAVAILABLE", reasons: matching.length > 0 ? unavailable.flatMap(f => f.reasons) : ["Current research context does not support covered call structures."], requirements, limitations, compatibleFamilies: [] };
  }

  if (broadType === "CASH_SECURED_PUT") {
    limitations.push(CSP_CAPITAL_NOTE);
    if (applicable.length > 0) return { status: "AVAILABLE", reasons, requirements, limitations, compatibleFamilies };
    if (potentiallyApp.length > 0) return { status: "AVAILABLE_WITH_REQUIREMENTS", reasons, requirements, limitations, compatibleFamilies };
    if (matching.length === 0) {
      return { status: "UNAVAILABLE", reasons: ["Current research context does not support cash-secured put structures."], requirements, limitations, compatibleFamilies: [] };
    }
    // Check if unavailability is due to directional thesis mismatch
    const unavailReasons = unavailable.flatMap(f => f.reasons).join(" ").toLowerCase();
    if (unavailReasons.includes("directional") || unavailReasons.includes("thesis") || unavailReasons.includes("neutral") || unavailReasons.includes("not aligned")) {
      return { status: "NOT_ALIGNED_WITH_CURRENT_RESEARCH", reasons: ["Current thesis direction may not align with put strategy construction."], requirements, limitations, compatibleFamilies: [] };
    }
    return { status: "UNAVAILABLE", reasons: unavailable.flatMap(f => f.reasons), requirements, limitations, compatibleFamilies: [] };
  }

  if (broadType === "ADVANCED_OPTIONS") {
    limitations.push(ADVANCED_OPTIONS_NOTE);
    // Advanced options is always opt-in — show as AVAILABLE_WITH_REQUIREMENTS minimum
    if (applicable.length > 0 || potentiallyApp.length > 0) {
      return { status: "AVAILABLE_WITH_REQUIREMENTS", reasons: ["Advanced options is an opt-in research category.", ...reasons], requirements, limitations, compatibleFamilies };
    }
    return { status: "AVAILABLE_WITH_REQUIREMENTS", reasons: ["Advanced options structures are available as an extended research category."], requirements, limitations, compatibleFamilies };
  }

  if (broadType === "NEUTRAL_OPTIONS") {
    if (applicable.length > 0) return { status: "AVAILABLE", reasons, requirements, limitations, compatibleFamilies };
    if (potentiallyApp.length > 0) return { status: "AVAILABLE_WITH_REQUIREMENTS", reasons, requirements, limitations, compatibleFamilies };
    // Neutral structures aren't aligned when thesis is strongly directional
    const hasDirectionalUnavailable = unavailable.some(f =>
      f.reasons.some(r => r.toLowerCase().includes("directional") || r.toLowerCase().includes("momentum"))
    );
    if (hasDirectionalUnavailable || matching.length === 0) {
      return { status: "NOT_ALIGNED_WITH_CURRENT_RESEARCH", reasons: ["Neutral options structures are typically not aligned with strongly directional research theses."], requirements, limitations, compatibleFamilies: [] };
    }
    return { status: "UNAVAILABLE", reasons: ["Current research context does not support neutral options structures."], requirements, limitations, compatibleFamilies: [] };
  }

  if (broadType === "STOCK") {
    if (applicable.length > 0) return { status: "AVAILABLE", reasons, requirements, limitations, compatibleFamilies };
    if (potentiallyApp.length > 0) return { status: "AVAILABLE_WITH_REQUIREMENTS", reasons, requirements, limitations, compatibleFamilies };
    if (matching.length === 0) return { status: "AVAILABLE", reasons: ["Equity-based research is available for this candidate."], requirements, limitations, compatibleFamilies: ["equity"] };
    return { status: "UNAVAILABLE", reasons, requirements, limitations, compatibleFamilies: [] };
  }

  // General case
  if (applicable.length > 0) return { status: "AVAILABLE", reasons, requirements, limitations, compatibleFamilies };
  if (potentiallyApp.length > 0) return { status: "AVAILABLE_WITH_REQUIREMENTS", reasons, requirements, limitations, compatibleFamilies };
  if (matching.length === 0) {
    // This broad type has no underlying families in current context
    return { status: "UNAVAILABLE", reasons: [`No compatible research families for ${BROAD_EXPRESSION_LABELS[broadType]}.`], requirements, limitations, compatibleFamilies: [] };
  }
  // All matching families are unavailable — check if directional mismatch
  const allUnavailReasons = unavailable.flatMap(f => f.reasons);
  const isDirectionalMismatch = allUnavailReasons.some(r =>
    r.toLowerCase().includes("directional") || r.toLowerCase().includes("neutral") || r.toLowerCase().includes("thesis")
  );
  if (isDirectionalMismatch) {
    return { status: "NOT_ALIGNED_WITH_CURRENT_RESEARCH", reasons: allUnavailReasons, requirements, limitations, compatibleFamilies: [] };
  }
  return { status: "UNAVAILABLE", reasons: allUnavailReasons, requirements, limitations, compatibleFamilies: [] };
}

/**
 * Compute the full ordered list of ExpressionOption cards for a symbol/session.
 * Preferred categories come first within the same compatibility tier.
 * Pure — uses injected family results and preferences.
 */
export function computeExpressionOptions(
  symbol: string,
  families: ExpressionFamilyResult[],
  userPreferences: UserTradingPreferences | null,
  opts?: {
    sessionId?: string;
    portfolioContext?: { hasSharesOf?: (s: string) => boolean };
  }
): ExpressionOptionsResult {
  const preferred = new Set<BroadExpressionType>(userPreferences?.preferredExpressionTypes ?? []);

  const options: ExpressionOption[] = [];

  for (const broadType of BROAD_EXPRESSION_TYPES) {
    const compat = computeBroadCompatibility(broadType, families, {
      symbol,
      hasSharesOf: opts?.portfolioContext?.hasSharesOf,
    });

    options.push({
      expressionType:           broadType,
      label:                    BROAD_EXPRESSION_LABELS[broadType],
      educationalSummary:       BROAD_EXPRESSION_EDUCATIONAL[broadType],
      compatibilityStatus:      compat.status,
      preferredByUser:          preferred.has(broadType),
      reasons:                  compat.reasons,
      requirements:             compat.requirements,
      limitations:              compat.limitations,
      specificCompatibleFamilies: compat.compatibleFamilies,
    });
  }

  // Sort: preferred first within each compatibility tier
  options.sort((a, b) => {
    const tierA = EXPRESSION_COMPATIBILITY_STATUSES.indexOf(a.compatibilityStatus);
    const tierB = EXPRESSION_COMPATIBILITY_STATUSES.indexOf(b.compatibilityStatus);
    if (tierA !== tierB) return tierA - tierB;
    // Within same tier: preferred first
    if (a.preferredByUser && !b.preferredByUser) return -1;
    if (!a.preferredByUser && b.preferredByUser) return 1;
    // Stable sort within same tier+preference
    return BROAD_EXPRESSION_TYPES.indexOf(a.expressionType) - BROAD_EXPRESSION_TYPES.indexOf(b.expressionType);
  });

  return {
    symbol,
    sessionId:       opts?.sessionId,
    options,
    userPreferences: userPreferences ?? null,
    disclaimer:      EXPRESSION_SELECTION_DISCLAIMER,
    generatedAt:     new Date().toISOString(),
    methodologyVersion: TRADE_PREFERENCES_METHODOLOGY_VERSION,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPRESSION SELECTION PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate and save broad expression selection to a planning session.
 * selectedBy is always "USER" — never AI.
 * Returns the selection record.
 */
export async function saveBroadExpressionSelection(
  userId: string,
  sessionId: string,
  rawExpressionType: string,
  deps: TradePreferencesDeps = {}
): Promise<OpportunityExpressionSelection> {
  if (!isBroadExpressionType(rawExpressionType)) {
    throw Object.assign(new Error(`Invalid broad expression type: ${rawExpressionType}`), { code: "INVALID_EXPRESSION_TYPE" });
  }

  const getSession = deps.getPlanningSession ?? defaultGetPlanningSession;
  const updateSession = deps.updatePlanningSession ?? defaultUpdatePlanningSession;
  const now = (deps.now ?? (() => new Date()))();

  const session = await getSession(userId, sessionId);
  if (!session) {
    throw Object.assign(new Error("Planning session not found"), { code: "SESSION_NOT_FOUND" });
  }

  await updateSession(userId, sessionId, {
    broadExpressionType:  rawExpressionType,
    expressionSelectedBy: "USER",
  });

  return {
    id:                   sessionId,
    userId,
    symbol:               session.symbol,
    planningSessionId:    sessionId,
    selectedExpressionType: rawExpressionType as BroadExpressionType,
    selectedBy:           "USER" as const,
    selectedAt:           now.toISOString(),
  };
}

/**
 * Get the current broad expression selection for a planning session.
 * Returns null if no selection made yet.
 */
export async function getBroadExpressionSelection(
  userId: string,
  sessionId: string,
  deps: TradePreferencesDeps = {}
): Promise<OpportunityExpressionSelection | null> {
  const getSession = deps.getPlanningSession ?? defaultGetPlanningSession;
  const session = await getSession(userId, sessionId);
  if (!session) return null;

  if (!session.broadExpressionType || !isBroadExpressionType(session.broadExpressionType)) {
    return null;
  }

  return {
    id:                   sessionId,
    userId,
    symbol:               session.symbol,
    planningSessionId:    sessionId,
    selectedExpressionType: session.broadExpressionType as BroadExpressionType,
    selectedBy:           "USER" as const,
    selectedAt:           session.updatedAt?.toISOString?.() ?? new Date().toISOString(),
  };
}

/**
 * Persist broad expression fields to a saved Trade Plan.
 * Only updates broadExpressionType / expressionSelectedBy / expressionSelectedAt.
 * Does NOT mutate the immutable research, planning, structure, or risk snapshots.
 * Global preference change does NOT call this — only explicit user selection does.
 */
export async function persistBroadExpressionToPlan(
  userId: string,
  planId: string,
  expressionType: BroadExpressionType,
  deps: TradePreferencesDeps = {}
): Promise<void> {
  if (!isBroadExpressionType(expressionType)) {
    throw Object.assign(new Error(`Invalid broad expression type: ${expressionType}`), { code: "INVALID_EXPRESSION_TYPE" });
  }
  const updatePlan = deps.updateTradePlan ?? defaultUpdateTradePlan;
  const now = (deps.now ?? (() => new Date()))();
  await updatePlan(userId, planId, {
    broadExpressionType:  expressionType,
    expressionSelectedBy: "USER",
    expressionSelectedAt: now,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTING HELPER — maps broad type to engine entry point
// ─────────────────────────────────────────────────────────────────────────────

export type ExpressionRouting =
  | { engine: "EQUITY"; families: readonly string[] }
  | { engine: "OPTIONS_MATCHING"; constraintedFamilies: readonly string[] }
  | { engine: "EXPLORE_ALL"; families: readonly string[] };

/**
 * Determine which planning engine to route to for a broad expression type.
 * Does NOT call any engine — just returns the routing descriptor.
 *
 * STOCK → Equity Planning Engine
 * LONG_OPTIONS | COVERED_CALL | CASH_SECURED_PUT | DEFINED_RISK_OPTIONS |
 * INCOME_OPTIONS | NEUTRAL_OPTIONS | ADVANCED_OPTIONS → Options Strategy Matching
 *   constrained to the relevant families
 * EXPLORE_COMPATIBLE_STRUCTURES → all compatible families
 */
export function resolveExpressionRouting(broadType: BroadExpressionType, allCompatibleFamilies: readonly string[]): ExpressionRouting {
  switch (broadType) {
    case "STOCK":
      return { engine: "EQUITY", families: BROAD_TO_FAMILIES.STOCK };

    case "EXPLORE_COMPATIBLE_STRUCTURES":
      return { engine: "EXPLORE_ALL", families: allCompatibleFamilies };

    default:
      return {
        engine: "OPTIONS_MATCHING",
        constraintedFamilies: BROAD_TO_FAMILIES[broadType],
      };
  }
}
