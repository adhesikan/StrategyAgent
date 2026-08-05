// Utility: resolve the authenticated landing page from a stored preference.
//
// Rules (Sprint 5.5):
//   - null / undefined / "" → "/dashboard"   (no preference set)
//   - "/home"               → "/dashboard"   (legacy DB default — /home is now a
//                                             deep-link-only page, not pinnable)
//   - "/journal"            → "/dashboard"   (removed page)
//   - "/history"            → "/dashboard"   (was previously the /journal redirect target)
//   - any PINNABLE value    → that path      (explicit user preference preserved)
//   - unrecognised path     → "/dashboard"   (safety fallback)
//
// "/home" is intentionally absent from PINNABLE_LANDING_PAGES.
// Users can still navigate to /home directly; they cannot pin it as their
// default landing page (Settings UI no longer offers it as an option).
//
// Must stay in sync with:
//   - LANDING_PAGE_OPTIONS in shared/schema.ts
//   - Server-side coercions in GET/PUT /api/user/settings (routes.ts)

export const PINNABLE_LANDING_PAGES = [
  "/dashboard",
  "/scanner",
  "/goal-mode",
  "/income-mode",
  "/trade-finder",
  "/markets",
  "/opportunity-radar",
  "/instatrade",
  "/charts",
] as const;

/** Values that should be treated as "unset" and redirected to /dashboard. */
const LEGACY_OR_REMOVED = new Set(["/home", "/journal", "/history"]);

export function resolveLandingPage(stored: string | null | undefined): string {
  if (!stored) return "/dashboard";
  if (LEGACY_OR_REMOVED.has(stored)) return "/dashboard";
  if ((PINNABLE_LANDING_PAGES as readonly string[]).includes(stored)) return stored;
  return "/dashboard";
}
