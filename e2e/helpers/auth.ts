import type { Page, APIRequestContext } from "@playwright/test";

/**
 * E2E auth helpers.
 * Authenticated tests require PLAYWRIGHT_TEST_USER + PLAYWRIGHT_TEST_PASS.
 */

export const TEST_USER = process.env.PLAYWRIGHT_TEST_USER ?? "";
export const TEST_PASS = process.env.PLAYWRIGHT_TEST_PASS ?? "";
export const AUTH_AVAILABLE = !!(TEST_USER && TEST_PASS);

/**
 * Login via the UI login form. Call in beforeAll for flows that need auth.
 * Skips if credentials not set.
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
