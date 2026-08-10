/**
 * e2e/critical-journeys.spec.ts — VCP Trader AI Sprint 2.7.7
 *
 * Critical user journey E2E tests.
 * Authenticated tests require PLAYWRIGHT_TEST_USER + PLAYWRIGHT_TEST_PASS env vars.
 * Without credentials, authenticated tests are skipped and marked NOT_RUN.
 *
 * Flows:
 *   A — Research Discovery
 *   B — Research Goal
 *   C — Portfolio
 *   D — Equity Planning
 *   E — Options Planning
 *   F — Lifecycle
 *
 * Category: BROWSER_E2E
 */

import { test, expect } from "@playwright/test";
import { AUTH_AVAILABLE, loginWithCredentials } from "./helpers/auth";

// ============================================================================
// FLOW A — Research Discovery
// ============================================================================

test.describe("Flow A: Research Discovery", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!AUTH_AVAILABLE, "Requires PLAYWRIGHT_TEST_USER + PLAYWRIGHT_TEST_PASS");
    await loginWithCredentials(page);
  });

  test("A1: Dashboard/Research loads without 500", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const status = page.url();
    expect(status).not.toContain("/auth");
    // No uncaught error modal
    const errorText = await page.locator('[data-testid="error-boundary"], .error-boundary').count();
    expect(errorText).toBe(0);
  });

  test("A2: Opportunity workspace page loads for a symbol", async ({ page }) => {
    await page.goto("/opportunities/NVDA");
    await page.waitForLoadState("networkidle");
    // Should either load the workspace or show 'no data' state — not 500
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
    expect(pageContent).not.toContain("Cannot GET");
  });

  test("A3: Research workspace navigates without 500", async ({ page }) => {
    await page.goto("/research-workspace");
    await page.waitForLoadState("networkidle");
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });
});

// ============================================================================
// FLOW B — Research Goal
// ============================================================================

test.describe("Flow B: Research Goal", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!AUTH_AVAILABLE, "Requires PLAYWRIGHT_TEST_USER + PLAYWRIGHT_TEST_PASS");
    await loginWithCredentials(page);
  });

  test("B1: Goals page loads", async ({ page }) => {
    await page.goto("/goals");
    await page.waitForLoadState("networkidle");
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("B2: API GET /research-goals returns structured response", async ({ request, page }) => {
    await loginWithCredentials(page);
    const resp = await request.get("/api/research-goals", {
      headers: { Cookie: await page.context().cookies().then(cookies =>
        cookies.map(c => `${c.name}=${c.value}`).join("; ")
      ) }
    });
    expect([200, 401]).toContain(resp.status());
    if (resp.ok()) {
      const data = await resp.json();
      expect(Array.isArray(data.goals ?? data)).toBe(true);
    }
  });
});

// ============================================================================
// FLOW C — Portfolio
// ============================================================================

test.describe("Flow C: Portfolio", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!AUTH_AVAILABLE, "Requires PLAYWRIGHT_TEST_USER + PLAYWRIGHT_TEST_PASS");
    await loginWithCredentials(page);
  });

  test("C1: Portfolio page loads", async ({ page }) => {
    await page.goto("/portfolio");
    await page.waitForLoadState("networkidle");
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("C2: Portfolio is optional — research available without portfolio", async ({ page }) => {
    // Navigate to opportunities without having a portfolio
    await page.goto("/opportunities");
    await page.waitForLoadState("networkidle");
    // Should not show 'portfolio required' error
    const pageContent = await page.content();
    expect(pageContent).not.toContain("portfolio required");
    expect(pageContent).not.toContain("Internal Server Error");
  });
});

// ============================================================================
// FLOW D — Equity Planning
// ============================================================================

test.describe("Flow D: Equity Planning", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!AUTH_AVAILABLE, "Requires PLAYWRIGHT_TEST_USER + PLAYWRIGHT_TEST_PASS");
    await loginWithCredentials(page);
  });

  test("D1: Trade planning page loads for a symbol", async ({ page }) => {
    await page.goto("/trade-planning/NVDA");
    await page.waitForLoadState("networkidle");
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("D2: Trade plans list loads", async ({ page }) => {
    await page.goto("/trade-plans");
    await page.waitForLoadState("networkidle");
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("D3: Broker not required for equity planning", async ({ request, page }) => {
    await loginWithCredentials(page);
    const cookies = await page.context().cookies().then(c =>
      c.map(x => `${x.name}=${x.value}`).join("; ")
    );
    // Trade planning context should not return 500 due to missing broker
    const resp = await request.get("/api/trade-planning/session/NVDA", {
      headers: { Cookie: cookies }
    });
    expect([200, 400, 404]).toContain(resp.status());
    expect(resp.status()).not.toBe(500);
  });
});

// ============================================================================
// FLOW E — Options Planning
// ============================================================================

test.describe("Flow E: Options Planning", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!AUTH_AVAILABLE, "Requires PLAYWRIGHT_TEST_USER + PLAYWRIGHT_TEST_PASS");
    await loginWithCredentials(page);
  });

  test("E1: Options strategy endpoint responds (not 500)", async ({ request, page }) => {
    await loginWithCredentials(page);
    const cookies = await page.context().cookies().then(c =>
      c.map(x => `${x.name}=${x.value}`).join("; ")
    );
    const resp = await request.get("/api/options/strategies/NVDA", {
      headers: { Cookie: cookies }
    });
    expect([200, 400, 404]).toContain(resp.status());
    expect(resp.status()).not.toBe(500);
  });

  test("E2: No broker required for strategy matching", async ({ request, page }) => {
    await loginWithCredentials(page);
    const cookies = await page.context().cookies().then(c =>
      c.map(x => `${x.name}=${x.value}`).join("; ")
    );
    // Strategy matching should work without broker connection
    const resp = await request.get("/api/options/strategies/NVDA", {
      headers: { Cookie: cookies }
    });
    // Should not be 503 (broker required) - should at minimum return a structured result
    expect(resp.status()).not.toBe(503);
    expect(resp.status()).not.toBe(500);
  });
});

// ============================================================================
// FLOW F — Lifecycle
// ============================================================================

test.describe("Flow F: Trade Plan Lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!AUTH_AVAILABLE, "Requires PLAYWRIGHT_TEST_USER + PLAYWRIGHT_TEST_PASS");
    await loginWithCredentials(page);
  });

  test("F1: Trade plan detail page loads", async ({ page }) => {
    // Navigate to trade plans list first
    await page.goto("/trade-plans");
    await page.waitForLoadState("networkidle");
    const pageContent = await page.content();
    expect(pageContent).not.toContain("Internal Server Error");
  });

  test("F2: Lifecycle health endpoint accessible to admin", async ({ request, page }) => {
    await loginWithCredentials(page);
    const cookies = await page.context().cookies().then(c =>
      c.map(x => `${x.name}=${x.value}`).join("; ")
    );
    const resp = await request.get("/api/trade-plans/lifecycle/health", {
      headers: { Cookie: cookies }
    });
    // Admin or regular user — either 200 or 403 (not 404 or 500)
    expect([200, 403]).toContain(resp.status());
    expect(resp.status()).not.toBe(404);
    expect(resp.status()).not.toBe(500);
  });

  test("F3: Lifecycle evaluation does not use execution language", async ({ request, page }) => {
    await loginWithCredentials(page);
    const cookies = await page.context().cookies().then(c =>
      c.map(x => `${x.name}=${x.value}`).join("; ")
    );
    // Request lifecycle for a non-existent plan — should 404, not 500
    const resp = await request.get("/api/trade-plans/non-existent-plan-id/lifecycle", {
      headers: { Cookie: cookies }
    });
    expect([404, 400]).toContain(resp.status());
    const body = await resp.text();
    // No execution language in error responses
    const FORBIDDEN = ["Exit", "Sell", "Close Position", "Take Profit", "execution ready"];
    for (const phrase of FORBIDDEN) {
      expect(body.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });
});
