import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration — VCP Trader AI Sprint 2.7.7 E2E Test Suite
 *
 * Run: npm run test:e2e
 * Env vars:
 *   PLAYWRIGHT_BASE_URL   — override base URL (default: http://localhost:5000)
 *   PLAYWRIGHT_TEST_USER  — test account email (authenticated flows only)
 *   PLAYWRIGHT_TEST_PASS  — test account password (authenticated flows only)
 *
 * Authenticated flow tests are skipped when PLAYWRIGHT_TEST_USER is unset.
 * Unauthenticated/structural tests always run.
 */

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // sequential for single-server dev environment
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "e2e-results.json" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Do not start a web server — tests expect the dev server already running
  // (started by workflow `npm run dev`)
});
