import type { Page, APIRequestContext } from "@playwright/test";

/**
 * E2E auth helpers — Sprint 2.7.7A
 *
 * Authenticated tests support two credential variable name conventions:
 *   - PLAYWRIGHT_TEST_USER / PLAYWRIGHT_TEST_PASS  (original)
 *   - TEST_USER_EMAIL / TEST_USER_PASSWORD         (canonical for release certification)
 *
 * Either pair can be used. The canonical names are preferred for CI/CD pipelines.
 *
 * For release certification: SKIPPED = NOT_READY (not PASS).
 * For development: clean skips are acceptable.
 *
 * Never commit credentials. Use environment variables or secret manager only.
 * Variable names to configure: TEST_USER_EMAIL + TEST_USER_PASSWORD
 */

export const TEST_USER =
  process.env.TEST_USER_EMAIL ??
  process.env.PLAYWRIGHT_TEST_USER ??
  "";

export const TEST_PASS =
  process.env.TEST_USER_PASSWORD ??
  process.env.PLAYWRIGHT_TEST_PASS ??
  "";

export const AUTH_AVAILABLE = !!(TEST_USER && TEST_PASS);

/**
 * For release certification: if credentials are missing, the flow is NOT_READY.
 * Use this in certification-mode test runs to surface the gap explicitly.
 */
export const RELEASE_CERTIFICATION_MODE =
  process.env.PLAYWRIGHT_RELEASE_CERT === "1";

/**
 * In release certification mode, missing credentials are a hard failure (NOT_READY).
 * In development mode, tests skip cleanly.
 *
 * Usage: test.skip(shouldSkipAuth(), "Auth credentials not configured — NOT_READY for release cert");
 */
export function shouldSkipAuth(): boolean {
  if (RELEASE_CERTIFICATION_MODE && !AUTH_AVAILABLE) {
    // In cert mode we do NOT skip — the test will fail, making NOT_READY visible
    return false;
  }
  return !AUTH_AVAILABLE;
}

/**
 * Login via the UI login form. Call in beforeAll for flows that need auth.
 * Returns false if credentials not configured.
 */
export async function loginWithCredentials(page: Page): Promise<boolean> {
  if (!AUTH_AVAILABLE) return false;
  await page.goto("/auth/login");
  await page.waitForLoadState("networkidle");
  await page.fill('input[name="email"], input[type="email"]', TEST_USER);
  await page.fill('input[name="password"], input[type="password"]', TEST_PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), {
    timeout: 10_000,
  });
  return true;
}

/**
 * Login via API (faster for setup). Returns true if successful.
 */
export async function loginViaApi(request: APIRequestContext): Promise<boolean> {
  if (!AUTH_AVAILABLE) return false;
  const resp = await request.post("/api/auth/login", {
    data: { email: TEST_USER, password: TEST_PASS },
  });
  return resp.ok();
}

/**
 * Check whether the current page is the login/auth page.
 */
export async function isOnAuthPage(page: Page): Promise<boolean> {
  return page.url().includes("/auth") || page.url().includes("/login");
}
