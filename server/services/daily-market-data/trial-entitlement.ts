// Central Daily Analysis Mode entitlement service.
// Composes (1) the Twelve Data license gate (access-control.ts — the FINAL
// legal safety control), (2) the product flag TRIAL_DAILY_ANALYSIS_ENABLED,
// (3) the user's subscription/trial state, and (4) broker connection state.
// All trial-facing endpoints must use getDailyAnalysisEntitlement /
// getAllowedTrialSymbols instead of scattering checks around the app.

import { db } from "../../db";
import { marketDataSymbols } from "@shared/schema";
import { and, asc, eq } from "drizzle-orm";
import { canAccessTwelveDataBackedAnalysis, type AccessUser } from "./access-control";
import { getTrialDailyAnalysisConfig } from "./config";
import { getUserPlanRecord } from "../billing/userPlan";
import { storage } from "../../storage";

export type DailyAnalysisAccessLevel =
  | "none"
  | "internal_prelaunch"
  | "external_trial"
  | "external_paid"
  | "broker_connected";

export type DailyAnalysisDataMode = "unavailable" | "historical_daily" | "broker_current";

export type DailyAnalysisEntitlement = {
  allowed: boolean;
  accessLevel: DailyAnalysisAccessLevel;
  allowedSymbols: string[];
  dataMode: DailyAnalysisDataMode;
  reasonCode?: string;
  limits: {
    watchlist: number;
    savedCandidates: number;
    radarResults: number;
  };
};

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.\-]{0,9}$/;

// ---- Allowlist cache (short TTL; invalidated on admin symbol changes) ----
let cachedTrialSymbols: string[] | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

export function invalidateTrialSymbolCache(): void {
  cachedTrialSymbols = null;
  cacheLoadedAt = 0;
}

/** Load the enabled, trial-approved symbol universe (uppercase), cached briefly. */
export async function getAllowedTrialSymbols(): Promise<string[]> {
  const now = Date.now();
  if (cachedTrialSymbols && now - cacheLoadedAt < CACHE_TTL_MS) return cachedTrialSymbols;
  const rows = await db
    .select({ symbol: marketDataSymbols.symbol })
    .from(marketDataSymbols)
    .where(and(eq(marketDataSymbols.enabled, true), eq(marketDataSymbols.trialEnabled, true)))
    .orderBy(asc(marketDataSymbols.displayOrder));
  // Hard cap: never expose more than the configured trial symbol limit, even
  // if admins flag additional rows. First N by displayOrder win.
  const limit = getTrialDailyAnalysisConfig().symbolLimit;
  cachedTrialSymbols = rows.slice(0, Math.max(0, limit)).map((r) => r.symbol.toUpperCase());
  cacheLoadedAt = now;
  return cachedTrialSymbols;
}

/** Normalize a requested symbol; returns null when the input is invalid. */
export function normalizeSymbol(raw: string): string | null {
  const sym = (raw || "").trim().toUpperCase();
  return SYMBOL_PATTERN.test(sym) ? sym : null;
}

/** True when the (normalized) symbol is in the approved trial universe. */
export async function isTrialSymbolAllowed(raw: string): Promise<boolean> {
  const sym = normalizeSymbol(raw);
  if (!sym) return false;
  const allowed = await getAllowedTrialSymbols();
  return allowed.includes(sym);
}

export const TRIAL_SYMBOL_DENIAL_MESSAGE =
  "This symbol is not included in the current trial market coverage. Connect a supported brokerage account or upgrade when broader coverage becomes available.";

/** Server-side check for an active, usable broker connection. */
export async function hasSupportedBrokerConnection(userId: string): Promise<boolean> {
  try {
    const conn = await storage.getBrokerConnectionWithToken(userId);
    return !!(conn && conn.isConnected && (conn.accessToken || conn.sandboxAccessToken));
  } catch {
    return false;
  }
}

/**
 * Central entitlement decision for Daily Analysis Mode.
 * License gate (env) is checked FIRST and can never be overridden.
 */
export async function getDailyAnalysisEntitlement(user: AccessUser): Promise<DailyAnalysisEntitlement> {
  const trialCfg = getTrialDailyAnalysisConfig();
  const limits = {
    watchlist: trialCfg.watchlistLimit,
    savedCandidates: trialCfg.savedCandidateLimit,
    radarResults: trialCfg.radarResultLimit,
  };
  const deny = (reasonCode: string): DailyAnalysisEntitlement => ({
    allowed: false,
    accessLevel: "none",
    allowedSymbols: [],
    dataMode: "unavailable",
    reasonCode,
    limits,
  });

  // 1) License-level clearance (disabled / prelaunch / external + display flag).
  const license = canAccessTwelveDataBackedAnalysis({ user });
  if (!license.allowed) return deny(license.reason);

  if (!user?.id) return deny("unauthenticated");

  // 2) Product flag.
  if (!trialCfg.enabled) return deny("trial_daily_analysis_disabled");

  const allowedSymbols = await getAllowedTrialSymbols();
  const brokerConnected = await hasSupportedBrokerConnection(user.id);

  // Internal (admin / internal roles / allowlisted testers) during prelaunch or
  // otherwise: full internal QA access to the trial experience.
  if (license.scope === "internal") {
    return {
      allowed: true,
      accessLevel: brokerConnected ? "broker_connected" : "internal_prelaunch",
      allowedSymbols,
      dataMode: brokerConnected ? "broker_current" : "historical_daily",
      limits,
    };
  }

  // 3) External users: require an active trial or paid subscription.
  const plan = await getUserPlanRecord(user.id);
  if (!plan) return deny("no_plan_record");
  const now = Date.now();
  const trialActive =
    plan.subscriptionStatus === "trialing" && !!plan.trialEndsAt && plan.trialEndsAt.getTime() > now;
  const paidActive = plan.planId !== "free" && ["active", "past_due"].includes(plan.subscriptionStatus);

  if (!trialActive && !paidActive) return deny("no_active_entitlement");

  if (brokerConnected && !getTrialDailyAnalysisConfig().requireNoBrokerConnection) {
    // Broker-connected users may still view historical Daily Analysis, but
    // current/account workflows must use broker-authorized data.
    return {
      allowed: true,
      accessLevel: "broker_connected",
      allowedSymbols,
      dataMode: "broker_current",
      limits,
    };
  }

  return {
    allowed: true,
    accessLevel: paidActive ? "external_paid" : "external_trial",
    allowedSymbols,
    dataMode: "historical_daily",
    limits,
  };
}

export type TrialFeatureRestriction = {
  restricted: boolean;
  allowedSymbols: string[];
  watchlistLimit: number;
  savedCandidateLimit: number;
  radarResultLimit: number;
};

/**
 * License-independent restriction check for general features (watchlists,
 * saved candidates, Opportunity Radar, Grow/Trade Finder symbol entry).
 * Applies to users on an active trial WITHOUT a supported broker connection.
 * Internal roles, paid subscribers, and broker-connected users keep existing
 * behavior. This never grants Twelve Data display rights — it only limits
 * what trial users can request.
 */
export async function getTrialFeatureRestriction(user: AccessUser): Promise<TrialFeatureRestriction> {
  const cfg = getTrialDailyAnalysisConfig();
  const none: TrialFeatureRestriction = {
    restricted: false,
    allowedSymbols: [],
    watchlistLimit: cfg.watchlistLimit,
    savedCandidateLimit: cfg.savedCandidateLimit,
    radarResultLimit: cfg.radarResultLimit,
  };
  if (!user?.id) return none;
  const role = (user.role || "user").toLowerCase();
  if (["admin", "internal", "internal_tester"].includes(role)) return none;

  const plan = await getUserPlanRecord(user.id);
  if (!plan) return none;
  const trialActive =
    plan.subscriptionStatus === "trialing" &&
    !!plan.trialEndsAt &&
    plan.trialEndsAt.getTime() > Date.now();
  if (!trialActive) return none;

  const brokerConnected = await hasSupportedBrokerConnection(user.id);
  if (brokerConnected) return none;

  return { ...none, restricted: true, allowedSymbols: await getAllowedTrialSymbols() };
}

/**
 * True when trial symbol/limit restrictions apply to this entitlement.
 * Internal QA accounts exercise the same restrictions to mirror the real
 * trial experience; broker-connected and paid users are unrestricted.
 */
export function isTrialRestricted(ent: DailyAnalysisEntitlement): boolean {
  return ent.accessLevel === "external_trial" || ent.accessLevel === "internal_prelaunch";
}
