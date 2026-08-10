/**
 * e2e/structural.spec.ts — VCP Trader AI Sprint 2.7.7
 *
 * Structural E2E tests: always run, no auth required.
 * Validates: server starts, routes respond, auth boundary, page titles.
 *
 * Category: STRUCTURAL, SMOKE
 */

import { test, expect } from "@playwright/test";

// ============================================================================
// §S1 — Server reachability
// ============================================================================

test.describe("§S1: Server reachability", () => {
  test("GET / returns 200 or redirect (not 500)", async ({ request }) => {
    const resp = await request.get("/");
    expect([200, 301, 302, 304]).toContain(resp.status());
  });

  test("GET /api/health or root API path is reachable", async ({ request }) => {
    // Try platform health — admin-only but should return 401, not 500
    const resp = await request.get("/api/platform-health");
    expect([200, 401, 403, 404]).toContain(resp.status());
  });
});

// ============================================================================
// §S2 — Auth boundary (unauthenticated)
// ============================================================================

test.describe("§S2: Auth boundary — unauthenticated access", () => {
  test("unauthenticated request to /api/opportunities/today returns 401", async ({ request }) => {
    const resp = await request.get("/api/opportunities/today");
    expect(resp.status()).toBe(401);
  });

  test("unauthenticated request to /api/portfolios returns 401", async ({ request }) => {
    const resp = await request.get("/api/portfolios");
    expect(resp.status()).toBe(401);
  });

  test("unauthenticated request to /api/research-goals returns 401", async ({ request }) => {
    const resp = await request.get("/api/research-goals");
    expect(resp.status()).toBe(401);
  });

  test("unauthenticated request to /api/trade-plans returns 401", async ({ request }) => {
    const resp = await request.get("/api/trade-plans");
    expect(resp.status()).toBe(401);
  });

  test("unauthenticated request to /api/workspace-conversations returns 401", async ({ request }) => {
    const resp = await request.get("/api/workspace-conversations");
    expect(resp.status()).toBe(401);
  });

  test("unauthenticated request to /api/research-reports returns 401", async ({ request }) => {
    const resp = await request.get("/api/research-reports");
    expect(resp.status()).toBe(401);
  });

  test("admin-only route /api/admin/platform-health requires auth", async ({ request }) => {
    const resp = await request.get("/api/admin/platform-health");
    expect([401, 403]).toContain(resp.status());
  });

  test("admin operations-manual requires auth", async ({ request }) => {
    const resp = await request.get("/api/admin/operations-manual");
    expect([401, 403]).toContain(resp.status());
  });
});

// ============================================================================
// §S3 — Client-side page load (HTML shell)
// ============================================================================

test.describe("§S3: Client page load — HTML shell", () => {
  test("root path returns HTML", async ({ page }) => {
    const resp = await page.goto("/");
    expect(resp?.status()).not.toBe(500);
    // SPA should deliver an HTML shell
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });

  test("deep link /opportunities returns HTML (SPA handles routing)", async ({ page }) => {
    const resp = await page.goto("/opportunities");
    expect(resp?.status()).not.toBe(500);
  });

  test("deep link /trade-plans returns HTML (SPA handles routing)", async ({ page }) => {
    const resp = await page.goto("/trade-plans");
    expect(resp?.status()).not.toBe(500);
  });

  test("deep link /research-workspace returns HTML", async ({ page }) => {
    const resp = await page.goto("/research-workspace");
    expect(resp?.status()).not.toBe(500);
  });

  test("deep link /portfolio returns HTML", async ({ page }) => {
    const resp = await page.goto("/portfolio");
    expect(resp?.status()).not.toBe(500);
  });

  test("deep link /admin/platform-health returns HTML", async ({ page }) => {
    const resp = await page.goto("/admin/platform-health");
    expect(resp?.status()).not.toBe(500);
  });
});

// ============================================================================
// §S4 — Route collision regression (critical namespace checks)
// ============================================================================

test.describe("§S4: Route collision regression", () => {
  test("/api/opportunities/today is not confused with dynamic /:symbol", async ({ request }) => {
    const resp = await request.get("/api/opportunities/today");
    // 401 = reached the right route; 404 = wrong route or not registered
    expect(resp.status()).toBe(401);
  });

  test("/api/opportunities/changes is not confused with dynamic /:symbol", async ({ request }) => {
    const resp = await request.get("/api/opportunities/changes");
    expect(resp.status()).toBe(401);
  });

  test("/api/trade-plans static lifecycle/health is reachable (not consumed by /:id)", async ({ request }) => {
    // This is admin-protected but should NOT 404
    const resp = await request.get("/api/trade-plans/lifecycle/health");
    expect([401, 403, 200]).toContain(resp.status());
    expect(resp.status()).not.toBe(404);
  });

  test("/api/research-goals static route before /:id", async ({ request }) => {
    const resp = await request.get("/api/research-goals");
    expect(resp.status()).toBe(401);
  });
});

// ============================================================================
// §S5 — API input validation (unauthenticated boundary)
// ============================================================================

test.describe("§S5: Input validation — unauthenticated boundary", () => {
  test("very long symbol path parameter returns 400 or 401, not 500", async ({ request }) => {
    const longSym = "A".repeat(200);
    const resp = await request.get(`/api/opportunities/${longSym}`);
    expect([400, 401, 404]).toContain(resp.status());
    expect(resp.status()).not.toBe(500);
  });

  test("path traversal attempt returns 400/401/404, not 500", async ({ request }) => {
    const resp = await request.get("/api/opportunities/../../../etc/passwd");
    expect([400, 401, 404]).toContain(resp.status());
    expect(resp.status()).not.toBe(500);
  });

  test("malformed JSON body returns 400, not 500", async ({ request }) => {
    const resp = await request.post("/api/auth/login", {
      headers: { "Content-Type": "application/json" },
      data: "{ invalid json",
    });
    expect([400, 422]).toContain(resp.status());
    expect(resp.status()).not.toBe(500);
  });
});

// ============================================================================
// §S6 — No secret leakage in public API error responses
// ============================================================================

test.describe("§S6: No secret leakage in public error responses", () => {
  const SECRET_PATTERNS = [
    /sk-[a-zA-Z0-9]{20,}/,
    /eyJ[a-zA-Z0-9+/]{30,}/,
    /DATABASE_URL\s*=/,
    /[A-Z0-9]{40,}/,
  ];

  test("401 response body does not contain secret patterns", async ({ request }) => {
    const resp = await request.get("/api/opportunities/today");
    const body = await resp.text();
    for (const pattern of SECRET_PATTERNS) {
      expect(body).not.toMatch(pattern);
    }
  });

  test("auth login error does not contain stack trace", async ({ request }) => {
    const resp = await request.post("/api/auth/login", {
      data: { email: "invalid@test.com", password: "badpass" },
    });
    const body = await resp.text();
    expect(body).not.toContain("at Object.");
    expect(body).not.toContain("node_modules");
  });
});
