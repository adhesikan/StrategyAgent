// Central access-control service for Twelve Data-backed analysis (Phase 13).
// ALL endpoints, jobs, emails, notifications, and exports that surface
// Twelve Data data or derived analytics must call canAccessTwelveDataBackedAnalysis.
// Do not scatter license checks across the app.

import { getTwelveDataConfig } from "./config";

export type AccessUser = {
  id?: string;
  email?: string | null;
  role?: string | null;
} | null | undefined;

export type AccessDecision = {
  allowed: boolean;
  scope: "internal" | "external" | null;
  reason: string;
};

export const SAFE_DENIAL_MESSAGE =
  "Daily market analysis is not currently available for this account.";

const INTERNAL_ROLES = new Set(["admin", "internal", "internal_tester"]);

export function canAccessTwelveDataBackedAnalysis(params: {
  user: AccessUser;
  feature?: string;
  requestedScope?: "internal" | "external";
}): AccessDecision {
  const cfg = getTwelveDataConfig();
  const user = params.user;

  if (!cfg.enabled || cfg.licenseMode === "disabled") {
    return { allowed: false, scope: null, reason: "provider_disabled" };
  }

  // Anonymous users are always denied.
  if (!user || !user.id) {
    return { allowed: false, scope: null, reason: "unauthenticated" };
  }

  const role = (user.role || "user").toLowerCase();
  const email = (user.email || "").toLowerCase();
  const isInternal = INTERNAL_ROLES.has(role) || (email !== "" && cfg.internalUserEmails.includes(email));

  if (cfg.licenseMode === "prelaunch") {
    // Prelaunch: admins, internal roles, and explicitly allowlisted emails only.
    // A Stripe trial or paid subscription does NOT grant access in this mode.
    if (isInternal) return { allowed: true, scope: "internal", reason: "prelaunch_internal" };
    return { allowed: false, scope: null, reason: "prelaunch_external_denied" };
  }

  // external mode: BOTH env settings must be affirmative.
  if (cfg.licenseMode === "external") {
    if (!cfg.externalDisplayEnabled) {
      // Misconfiguration: external mode without the display flag. Internal
      // users may still access; external users are denied.
      if (isInternal) return { allowed: true, scope: "internal", reason: "external_flag_missing_internal_only" };
      return { allowed: false, scope: null, reason: "external_display_flag_disabled" };
    }
    // Normal application rules (subscription/trial/role) apply downstream —
    // this service grants the license-level clearance only.
    return { allowed: true, scope: isInternal ? "internal" : "external", reason: "external_enabled" };
  }

  return { allowed: false, scope: null, reason: "unknown_mode" };
}

/** Express middleware factory gating routes on Twelve Data-backed access. */
export function requireDailyAnalysisAccess(getUser: (req: any) => Promise<AccessUser> | AccessUser) {
  return async (req: any, res: any, next: any) => {
    try {
      const user = await getUser(req);
      const decision = canAccessTwelveDataBackedAnalysis({ user });
      if (!decision.allowed) {
        return res.status(403).json({ error: SAFE_DENIAL_MESSAGE, code: "DAILY_ANALYSIS_UNAVAILABLE" });
      }
      req.dailyAnalysisScope = decision.scope;
      next();
    } catch {
      return res.status(403).json({ error: SAFE_DENIAL_MESSAGE, code: "DAILY_ANALYSIS_UNAVAILABLE" });
    }
  };
}
