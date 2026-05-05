import { db } from "../../db";
import { users as usersTable } from "@shared/models/auth";
import { eq } from "drizzle-orm";
import { getPlan, isPlanId, isPersonaId, type PlanId, type PersonaId } from "@shared/plans";

export interface UserPlanRecord {
  planId: PlanId;
  traderPersona: PersonaId | null;
  subscriptionStatus: string;
  billingCycle: "monthly" | "annual";
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  dailyAnalysesUsed: number;
  dailyAnalysesResetAt: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export async function getUserPlanRecord(userId: string): Promise<UserPlanRecord | null> {
  const [row] = await db
    .select({
      planId: usersTable.planId,
      traderPersona: usersTable.traderPersona,
      subscriptionStatus: usersTable.subscriptionStatus,
      billingCycle: usersTable.billingCycle,
      trialEndsAt: usersTable.trialEndsAt,
      currentPeriodEndsAt: usersTable.currentPeriodEndsAt,
      dailyAnalysesUsed: usersTable.dailyAnalysesUsed,
      dailyAnalysesResetAt: usersTable.dailyAnalysesResetAt,
      stripeCustomerId: usersTable.stripeCustomerId,
      stripeSubscriptionId: usersTable.stripeSubscriptionId,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!row) return null;

  return {
    planId: isPlanId(row.planId) ? row.planId : "free",
    traderPersona: isPersonaId(row.traderPersona) ? row.traderPersona : null,
    subscriptionStatus: row.subscriptionStatus || "active",
    billingCycle: row.billingCycle === "annual" ? "annual" : "monthly",
    trialEndsAt: row.trialEndsAt,
    currentPeriodEndsAt: row.currentPeriodEndsAt,
    dailyAnalysesUsed: row.dailyAnalysesUsed ?? 0,
    dailyAnalysesResetAt: row.dailyAnalysesResetAt,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
  };
}

export async function setUserTraderPersona(
  userId: string,
  persona: PersonaId | null,
): Promise<void> {
  await db
    .update(usersTable)
    .set({ traderPersona: persona, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
}

function nextUtcMidnight(from: Date = new Date()): Date {
  const d = new Date(Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate() + 1,
    0, 0, 0, 0,
  ));
  return d;
}

function todayUtcMidnight(from: Date = new Date()): Date {
  return new Date(Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
    0, 0, 0, 0,
  ));
}

/**
 * Resets dailyAnalysesUsed to 0 if the last reset was before today's UTC midnight.
 * Returns the post-reset (or unchanged) record.
 */
export async function resetDailyAnalysesIfNeeded(userId: string): Promise<UserPlanRecord | null> {
  const record = await getUserPlanRecord(userId);
  if (!record) return null;

  const todayUtc = todayUtcMidnight();
  const last = record.dailyAnalysesResetAt;
  const needsReset = !last || last.getTime() < todayUtc.getTime();

  if (needsReset) {
    await db
      .update(usersTable)
      .set({
        dailyAnalysesUsed: 0,
        dailyAnalysesResetAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId));
    return { ...record, dailyAnalysesUsed: 0, dailyAnalysesResetAt: new Date() };
  }

  return record;
}

export async function incrementDailyAnalyses(userId: string): Promise<void> {
  const record = await resetDailyAnalysesIfNeeded(userId);
  if (!record) return;
  await db
    .update(usersTable)
    .set({
      dailyAnalysesUsed: (record.dailyAnalysesUsed ?? 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));
}

export interface BillingStatusPayload {
  planId: PlanId;
  planName: string;
  subscriptionStatus: string;
  billingCycle: "monthly" | "annual";
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  dailyAnalysesUsed: number;
  dailyAnalysesLimit: number;
  isTrialing: boolean;
  trialDaysLeft: number | null;
  resetsAt: string;
}

export async function getBillingStatus(userId: string): Promise<BillingStatusPayload> {
  const record = await resetDailyAnalysesIfNeeded(userId);
  const planId: PlanId = record?.planId ?? "free";
  const plan = getPlan(planId);
  const status = record?.subscriptionStatus ?? "active";
  const billingCycle = record?.billingCycle ?? "monthly";
  const trialEnds = record?.trialEndsAt ?? null;
  const isTrialing = status === "trialing" && trialEnds !== null && trialEnds.getTime() > Date.now();
  const trialDaysLeft = isTrialing && trialEnds
    ? Math.max(0, Math.ceil((trialEnds.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;

  return {
    planId,
    planName: plan.name,
    subscriptionStatus: status,
    billingCycle,
    trialEndsAt: trialEnds ? trialEnds.toISOString() : null,
    currentPeriodEndsAt: record?.currentPeriodEndsAt ? record.currentPeriodEndsAt.toISOString() : null,
    dailyAnalysesUsed: record?.dailyAnalysesUsed ?? 0,
    dailyAnalysesLimit: plan.limits.dailyAnalyses,
    isTrialing,
    trialDaysLeft,
    resetsAt: nextUtcMidnight().toISOString(),
  };
}
