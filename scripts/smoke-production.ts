#!/usr/bin/env tsx
/**
 * scripts/smoke-production.ts — VCP Trader AI Sprint 2.7.7
 *
 * Production Smoke Runner
 * cmd: npm run test:smoke:production
 *
 * Safe, read-only checks against a running instance (local or production).
 * Requirements:
 *   - Read-only only (no mutations, no broker orders, no portfolio changes)
 *   - Does not expose credentials in output
 *   - Does not generate large provider loads
 *   - Does not place broker orders
 *   - Configurable base URL via SMOKE_BASE_URL env var
 *
 * Authentication:
 *   For unauthenticated checks: runs without credentials.
 *   For authenticated checks: requires SMOKE_SESSION_COOKIE env var
 *   (obtained manually — never hardcode credentials in this file).
 *
 * Usage:
 *   # Local (dev server must be running):
 *   SMOKE_BASE_URL=http://localhost:5000 npm run test:smoke:production
 *
 *   # Production (after deployment):
 *   SMOKE_BASE_URL=https://your-app.railway.app SMOKE_SESSION_COOKIE="..." npm run test:smoke:production
 */

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:5000";
const SESSION_COOKIE = process.env.SMOKE_SESSION_COOKIE ?? "";
const AUTH_AVAILABLE = SESSION_COOKIE.length > 0;

interface SmokeResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail: string;
  durationMs: number;
}

const results: SmokeResult[] = [];

async function check(
  name: string,
  fn: () => Promise<{ pass: boolean; detail: string }>,
  requiresAuth = false
): Promise<void> {
  if (requiresAuth && !AUTH_AVAILABLE) {
    results.push({ name, status: "SKIP", detail: "No SMOKE_SESSION_COOKIE set", durationMs: 0 });
    return;
  }
  const start = Date.now();
  try {
    const { pass, detail } = await fn();
    results.push({
      name,
      status: pass ? "PASS" : "FAIL",
      detail,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    results.push({
      name,
      status: "FAIL",
      detail: `Error: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    });
  }
}

function authHeaders(): Record<string, string> {
  return SESSION_COOKIE ? { Cookie: SESSION_COOKIE } : {};
}

async function get(path: string, auth = false): Promise<Response> {
  const headers: Record<string, string> = auth ? authHeaders() : {};
  return fetch(`${BASE_URL}${path}`, { headers });
}

// ============================================================================
// Checks
// ============================================================================

async function runAllChecks(): Promise<void> {
  console.log(`\n🔥 VCP Trader AI — Production Smoke Runner`);
  console.log(`   Target: ${BASE_URL}`);
  console.log(`   Auth: ${AUTH_AVAILABLE ? "YES (cookie present)" : "NO (unauthenticated checks only)"}`);
  console.log(`   Time: ${new Date().toISOString()}\n`);

  // ── Reachability ─────────────────────────────────────────────────────────
  await check("Server reachable (GET /)", async () => {
    const resp = await get("/");
    return { pass: resp.status < 500, detail: `HTTP ${resp.status}` };
  });

  // ── Auth boundary ─────────────────────────────────────────────────────────
  await check("Auth boundary: /api/opportunities/today → 401 unauthed", async () => {
    const resp = await get("/api/opportunities/today", false);
    return { pass: resp.status === 401, detail: `HTTP ${resp.status} (expected 401)` };
  });

  await check("Auth boundary: /api/trade-plans → 401 unauthed", async () => {
    const resp = await get("/api/trade-plans", false);
    return { pass: resp.status === 401, detail: `HTTP ${resp.status} (expected 401)` };
  });

  await check("Auth boundary: /api/research-goals → 401 unauthed", async () => {
    const resp = await get("/api/research-goals", false);
    return { pass: resp.status === 401, detail: `HTTP ${resp.status} (expected 401)` };
  });

  await check("Admin boundary: /api/admin/platform-health → 401/403 unauthed", async () => {
    const resp = await get("/api/admin/platform-health", false);
    return { pass: [401, 403].includes(resp.status), detail: `HTTP ${resp.status} (expected 401/403)` };
  });

  // ── Route collision checks ────────────────────────────────────────────────
  await check("Route: /api/opportunities/today is not 404 (static before dynamic)", async () => {
    const resp = await get("/api/opportunities/today", false);
    return { pass: resp.status !== 404, detail: `HTTP ${resp.status}` };
  });

  await check("Route: /api/trade-plans/lifecycle/health is not 404", async () => {
    const resp = await get("/api/trade-plans/lifecycle/health", false);
    return { pass: resp.status !== 404, detail: `HTTP ${resp.status}` };
  });

  // ── Input validation ──────────────────────────────────────────────────────
  await check("Input: long symbol returns 400/401/404, not 500", async () => {
    const resp = await get(`/api/opportunities/${"A".repeat(200)}`, false);
    return { pass: resp.status !== 500, detail: `HTTP ${resp.status}` };
  });

  // ── Authenticated checks (require SMOKE_SESSION_COOKIE) ──────────────────
  await check("Auth: /api/opportunities/today returns 200 with valid session", async () => {
    const resp = await get("/api/opportunities/today", true);
    return { pass: resp.status === 200, detail: `HTTP ${resp.status}` };
  }, true);

  await check("Auth: /api/trade-plans returns 200 with valid session", async () => {
    const resp = await get("/api/trade-plans", true);
    return { pass: resp.status === 200, detail: `HTTP ${resp.status}` };
  }, true);

  await check("Auth: /api/research-goals returns 200 with valid session", async () => {
    const resp = await get("/api/research-goals", true);
    return { pass: resp.status === 200, detail: `HTTP ${resp.status}` };
  }, true);

  await check("Auth: Platform health accessible to admin session", async () => {
    const resp = await get("/api/admin/platform-health", true);
    if (resp.status === 403) {
      return { pass: true, detail: `HTTP ${resp.status} (non-admin session — correct)` };
    }
    if (resp.status === 200) {
      const data = await resp.json().catch(() => null);
      const hasCards = Array.isArray((data as any)?.cards);
      return { pass: hasCards, detail: `HTTP ${resp.status} cards=${hasCards}` };
    }
    return { pass: false, detail: `HTTP ${resp.status}` };
  }, true);

  await check("Auth: Opportunity Intelligence endpoint responds", async () => {
    const resp = await get("/api/opportunities/latest", true);
    return { pass: [200, 202, 404].includes(resp.status), detail: `HTTP ${resp.status}` };
  }, true);

  await check("Auth: Research goals list is array", async () => {
    const resp = await get("/api/research-goals", true);
    if (!resp.ok) return { pass: false, detail: `HTTP ${resp.status}` };
    const data = await resp.json().catch(() => null);
    const isArray = Array.isArray((data as any)?.goals ?? data);
    return { pass: isArray, detail: `isArray=${isArray}` };
  }, true);

  await check("Auth: Trade plan lifecycle health not 404", async () => {
    const resp = await get("/api/trade-plans/lifecycle/health", true);
    return { pass: resp.status !== 404, detail: `HTTP ${resp.status}` };
  }, true);

  // ── No secret leakage ─────────────────────────────────────────────────────
  await check("Security: 401 response contains no secret patterns", async () => {
    const resp = await get("/api/opportunities/today", false);
    const body = await resp.text();
    const hasSecret = /sk-[a-zA-Z0-9]{20,}|eyJ[a-zA-Z0-9+/]{40,}/.test(body);
    return { pass: !hasSecret, detail: hasSecret ? "FOUND secret pattern in response!" : "Clean" };
  });

  await check("Security: Error response contains no stack trace", async () => {
    const resp = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "invalid@test.com", password: "badpassword123" }),
    });
    const body = await resp.text();
    const hasStack = body.includes("at Object.") || body.includes("node_modules/");
    return { pass: !hasStack, detail: hasStack ? "FOUND stack trace in error response!" : "Clean" };
  });
}

// ============================================================================
// Report
// ============================================================================

function printReport(): void {
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;

  console.log("\n" + "=".repeat(60));
  console.log(" PRODUCTION SMOKE RESULTS");
  console.log("=".repeat(60));

  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : r.status === "SKIP" ? "⚠️ " : "❌";
    const dur = r.durationMs > 0 ? ` (${r.durationMs}ms)` : "";
    console.log(`${icon} ${r.name}${dur}`);
    if (r.status !== "PASS") {
      console.log(`   → ${r.detail}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`  PASS: ${passed}  FAIL: ${failed}  SKIP: ${skipped}`);
  console.log("=".repeat(60));

  if (!AUTH_AVAILABLE) {
    console.log("\n⚠️  Authenticated checks SKIPPED — set SMOKE_SESSION_COOKIE to run them.");
    console.log("   See docs/operations/13-production-release-checklist.md §Post-Deploy Smoke.");
  }

  if (failed > 0) {
    console.error(`\n❌ ${failed} smoke check(s) FAILED.`);
    process.exit(1);
  } else {
    console.log(`\n✅ All ${passed} runnable checks passed.`);
  }
}

// ============================================================================
// Main
// ============================================================================

runAllChecks().then(printReport).catch((err) => {
  console.error("Fatal error in smoke runner:", err);
  process.exit(2);
});
