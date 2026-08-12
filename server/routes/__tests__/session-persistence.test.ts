/**
 * server/routes/__tests__/session-persistence.test.ts
 * Sprint 2.8.6A — Defect-6B: POST /api/trade-planning/session crashes Railway process
 *
 * Permanent regression coverage for:
 *   §DB1  trade_planning_sessions is created by ensureTradePlanTables (not a missing-table crash)
 *   §DB2  POST /session handler wraps createPlanningSession in try/catch (process survival)
 *   §DB3  null goalId and null portfolioId accepted without error
 *   §DB4  constraints JSONB serialization round-trip (exact WMT payload)
 *   §DB5  Session creation failure returns 500 JSON — process stays alive
 *   §DB6  Client shows correct failure message (not silent / not "Explore Equity" panel)
 *   §DB7  No expression selection is stored on session creation failure
 *   §DB8  server/index.ts has unhandledRejection + uncaughtException handlers
 *   §DB9  Drizzle schema columns match migration 028 contract (no missing columns)
 *   §DB10 ensureTradePlanTables includes CREATE TABLE trade_planning_sessions
 *   §DB11 Additive migration: broad_expression_type + expression_selected_by present in schema
 *   §DB12 opportunityId is TEXT (not UUID) — buildOpportunityId output accepted
 *   §DB13 portfolioId is TEXT in Drizzle schema (no UUID-cast crash)
 *   §DB14 selectedExpressionFamily null allowed (no constraint violation on creation)
 *   §DB15 id column uses gen_random_uuid() default (no client-supplied id)
 *   §DB16 Security: userId from session, not client body
 *   §DB17 Process survival handler: unhandledRejection does NOT call process.exit
 *   §DB18 Client source: createSessionMutation.onError resets selectedFamily to null
 *   §DB19 Client source: createSessionMutation.onError clears pendingFamilyRef
 *   §DB20 validateConstraints safe with exact WMT payload
 *   §DB21 broker mutations = 0 (no broker impact from session creation)
 *   §DB22 Schema contract: constraints column is JSONB in both Drizzle and migration
 *   §DB23 Startup sequence: ensureTradePlanTables called from routes.ts
 *   §DB24 Session creation error response shape includes code field
 *   §DB25 Forced DB failure result: controlled 500 not process crash
 *
 * All tests are pure/structural — no real DB, no network, no broker calls.
 *
 * Category: regression, security, db-schema
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROUTES_DIR    = path.resolve(__dirname, "..");
const SERVICES_DIR  = path.resolve(__dirname, "../../services");
const SHARED_DIR    = path.resolve(__dirname, "../../../shared");
const CLIENT_DIR    = path.resolve(__dirname, "../../../client/src/pages");
const SERVER_DIR    = path.resolve(__dirname, "../..");

function readRoute(name: string): string {
  return fs.readFileSync(path.join(ROUTES_DIR, name), "utf8");
}
function readService(name: string): string {
  return fs.readFileSync(path.join(SERVICES_DIR, name), "utf8");
}
function readShared(name: string): string {
  return fs.readFileSync(path.join(SHARED_DIR, name), "utf8");
}
function readClient(name: string): string {
  return fs.readFileSync(path.join(CLIENT_DIR, name), "utf8");
}
function readServer(name: string): string {
  return fs.readFileSync(path.join(SERVER_DIR, name), "utf8");
}
function readMigration(name: string): string {
  const migrationsDir = path.resolve(__dirname, "../../../migrations");
  return fs.readFileSync(path.join(migrationsDir, name), "utf8");
}

// ---------------------------------------------------------------------------
// §DB1 — trade_planning_sessions created by ensureTradePlanTables
// ---------------------------------------------------------------------------

describe("§DB1: ensureTradePlanTables creates trade_planning_sessions", () => {
  let src: string;
  beforeEach(() => { src = readService("trade-plan-service.ts"); });

  it("ensureTradePlanTables contains CREATE TABLE IF NOT EXISTS trade_planning_sessions", () => {
    expect(src).toContain("CREATE TABLE IF NOT EXISTS trade_planning_sessions");
  });

  it("trade_planning_sessions creation is inside ensureTradePlanTables function", () => {
    const fnStart = src.indexOf("export async function ensureTradePlanTables");
    const fnEnd   = src.indexOf("export async function ensureTradePlanTables") + 5000;
    const fn      = src.slice(fnStart, Math.min(fnEnd, src.length));
    expect(fn).toContain("CREATE TABLE IF NOT EXISTS trade_planning_sessions");
  });

  it("table creation appears BEFORE trade_plans creation", () => {
    const sessionsIdx = src.indexOf("CREATE TABLE IF NOT EXISTS trade_planning_sessions");
    const plansIdx    = src.indexOf("CREATE TABLE IF NOT EXISTS trade_plans");
    expect(sessionsIdx).toBeGreaterThan(-1);
    expect(plansIdx).toBeGreaterThan(-1);
    expect(sessionsIdx).toBeLessThan(plansIdx);
  });
});

// ---------------------------------------------------------------------------
// §DB2 — POST /session handler has try/catch (process survival)
// ---------------------------------------------------------------------------

describe("§DB2: POST /session handler — try/catch around createPlanningSession", () => {
  let src: string;
  beforeEach(() => { src = readRoute("trade-planning.ts"); });

  it("createPlanningSession call is inside a try block", () => {
    // Find the POST /session handler
    const postHandler = src.slice(
      src.indexOf('app.post("/api/trade-planning/session"'),
      src.indexOf('app.post("/api/trade-planning/session"') + 2000,
    );
    // Must contain try { ... createPlanningSession
    expect(postHandler).toContain("try {");
    expect(postHandler).toContain("createPlanningSession");
  });

  it("catch block returns controlled 500 response", () => {
    const postHandler = src.slice(
      src.indexOf('app.post("/api/trade-planning/session"'),
      src.indexOf('app.post("/api/trade-planning/session"') + 2000,
    );
    expect(postHandler).toContain("catch");
    expect(postHandler).toContain("res.status(500)");
    expect(postHandler).toContain("SESSION_PERSISTENCE_FAILED");
  });

  it("error is logged with structured JSON (event field)", () => {
    const postHandler = src.slice(
      src.indexOf('app.post("/api/trade-planning/session"'),
      src.indexOf('app.post("/api/trade-planning/session"') + 2000,
    );
    expect(postHandler).toContain("trade_planning_session_create_failed");
  });

  it("pgCode is captured in error log", () => {
    const postHandler = src.slice(
      src.indexOf('app.post("/api/trade-planning/session"'),
      src.indexOf('app.post("/api/trade-planning/session"') + 2000,
    );
    expect(postHandler).toContain("pgCode");
  });
});

// ---------------------------------------------------------------------------
// §DB3 — null goalId and null portfolioId accepted
// ---------------------------------------------------------------------------

describe("§DB3: null goalId and null portfolioId accepted by service", () => {
  it("createPlanningSession service accepts null goalId (uses ?? null pattern)", () => {
    const src = readService("trade-planning-service.ts");
    const fn  = src.slice(
      src.indexOf("export async function createPlanningSession"),
      src.indexOf("export async function createPlanningSession") + 800,
    );
    expect(fn).toContain("goalId ?? null");
    expect(fn).toContain("portfolioId ?? null");
  });

  it("Drizzle schema allows null for research_goal_id (no .notNull())", () => {
    const schema = readShared("schema.ts");
    // find tradePlanningSessions block
    const block = schema.slice(
      schema.indexOf("tradePlanningSessions = pgTable"),
      schema.indexOf("tradePlanningSessions = pgTable") + 1000,
    );
    expect(block).toContain("researchGoalId");
    // Must NOT have .notNull() on researchGoalId
    const lineIdx = block.indexOf("researchGoalId");
    const line    = block.slice(lineIdx, lineIdx + 100);
    expect(line).not.toContain(".notNull()");
  });

  it("Drizzle schema allows null for portfolio_id (no .notNull())", () => {
    const schema = readShared("schema.ts");
    const block  = schema.slice(
      schema.indexOf("tradePlanningSessions = pgTable"),
      schema.indexOf("tradePlanningSessions = pgTable") + 1000,
    );
    const lineIdx = block.indexOf("portfolioId");
    const line    = block.slice(lineIdx, lineIdx + 100);
    expect(line).not.toContain(".notNull()");
  });

  it("POST handler passes goalId ?? null to service", () => {
    const src       = readRoute("trade-planning.ts");
    const postBlock = src.slice(
      src.indexOf('app.post("/api/trade-planning/session"'),
      src.indexOf('app.post("/api/trade-planning/session"') + 2000,
    );
    expect(postBlock).toContain("goalId:        goalId ?? null");
    expect(postBlock).toContain("portfolioId:   portfolioId ?? null");
  });
});

// ---------------------------------------------------------------------------
// §DB4 — constraints JSONB serialization (exact WMT payload)
// ---------------------------------------------------------------------------

describe("§DB4: constraints serialization with exact WMT payload", () => {
  it("validateConstraints produces valid TradePlanningConstraints from WMT payload", async () => {
    const { validateConstraints } = await import("../../../shared/trade-planning-types");

    const wmtPayload = { equityAllowed: true, optionsAllowed: false };
    const result     = validateConstraints(wmtPayload);

    expect(result).toBeDefined();
    expect(result.equityAllowed).toBe(true);
    expect(result.optionsAllowed).toBe(false);
    expect(result).not.toHaveProperty("equityAllowed", false);
  });

  it("constraints column is JSONB in Drizzle schema (not TEXT)", () => {
    const schema = readShared("schema.ts");
    // The constraints field declaration anchored to the column binding line
    // (not a comment that also contains the word "constraints")
    expect(schema).toContain(`constraints:              jsonb(`);
  });

  it("migration 028 defines constraints as JSONB", () => {
    const migration = readMigration("028_trade_planning_sessions.sql");
    expect(migration).toContain("constraints");
    expect(migration).toContain("JSONB");
  });

  it("ensureTradePlanTables creates constraints as JSONB", () => {
    const src = readService("trade-plan-service.ts");
    const fnBlock = src.slice(
      src.indexOf("CREATE TABLE IF NOT EXISTS trade_planning_sessions"),
      src.indexOf("CREATE TABLE IF NOT EXISTS trade_planning_sessions") + 600,
    );
    expect(fnBlock).toContain("JSONB");
  });
});

// ---------------------------------------------------------------------------
// §DB5 — Session creation failure returns 500 JSON (process stays alive)
// ---------------------------------------------------------------------------

describe("§DB5: POST /session — controlled 500 on DB failure", () => {
  it("catch block calls res.status(500).json (not process.exit, not throw)", () => {
    const src       = readRoute("trade-planning.ts");
    const postBlock = src.slice(
      src.indexOf('app.post("/api/trade-planning/session"'),
      src.indexOf('app.post("/api/trade-planning/session"') + 2000,
    );
    const catchBlock = postBlock.slice(postBlock.indexOf("} catch"), postBlock.indexOf("} catch") + 400);
    expect(catchBlock).toContain("res.status(500)");
    expect(catchBlock).not.toContain("process.exit");
    expect(catchBlock).not.toContain("throw err");
    expect(catchBlock).not.toContain("throw new");
  });

  it("500 response message matches spec (Unable to save your planning session)", () => {
    const src       = readRoute("trade-planning.ts");
    const postBlock = src.slice(
      src.indexOf('app.post("/api/trade-planning/session"'),
      src.indexOf('app.post("/api/trade-planning/session"') + 2000,
    );
    expect(postBlock).toContain("Unable to save your planning session");
  });
});

// ---------------------------------------------------------------------------
// §DB6 — Client shows correct failure message
// ---------------------------------------------------------------------------

describe("§DB6: Client — session persistence failure message", () => {
  let src: string;
  beforeEach(() => { src = readClient("trade-planning.tsx"); });

  it("createSessionMutation.onError shows 'Unable to save your planning session'", () => {
    expect(src).toContain("Unable to save your planning session");
  });

  it("failure message uses destructive toast variant", () => {
    const onErrorBlock = src.slice(
      src.indexOf("Unable to save your planning session") - 200,
      src.indexOf("Unable to save your planning session") + 200,
    );
    expect(onErrorBlock).toContain("destructive");
  });
});

// ---------------------------------------------------------------------------
// §DB7 — No expression selected on session creation failure
// ---------------------------------------------------------------------------

describe("§DB7: No expression auto-selected when session creation fails", () => {
  let src: string;
  beforeEach(() => { src = readClient("trade-planning.tsx"); });

  it("onError resets selectedFamily to null", () => {
    // Anchor on the onError function signature to avoid matching onSuccess
    const onErrorStart = src.indexOf("onError: (err: any) =>");
    expect(onErrorStart).toBeGreaterThan(-1);
    const onErrorBlock = src.slice(onErrorStart, onErrorStart + 600);
    expect(onErrorBlock).toContain("setSelectedFamily(null)");
  });

  it("onError clears pendingFamilyRef.current", () => {
    expect(src).toContain("pendingFamilyRef.current = null");
  });
});

// ---------------------------------------------------------------------------
// §DB8 — server/index.ts has unhandledRejection + uncaughtException handlers
// ---------------------------------------------------------------------------

describe("§DB8: server/index.ts — global process survival handlers", () => {
  let src: string;
  beforeEach(() => { src = readServer("index.ts"); });

  it("has process.on('unhandledRejection') handler", () => {
    expect(src).toContain('"unhandledRejection"');
  });

  it("has process.on('uncaughtException') handler", () => {
    expect(src).toContain('"uncaughtException"');
  });

  it("unhandledRejection handler does NOT call process.exit()", () => {
    const handlerBlock = src.slice(
      src.indexOf('"unhandledRejection"'),
      src.indexOf('"unhandledRejection"') + 600,
    );
    // Match only actual calls (with parentheses + optional arg), not comments
    expect(handlerBlock).not.toMatch(/process\.exit\(\d*\)/);
  });

  it("unhandledRejection handler logs structured JSON event", () => {
    const handlerBlock = src.slice(
      src.indexOf('"unhandledRejection"'),
      src.indexOf('"unhandledRejection"') + 600,
    );
    expect(handlerBlock).toContain("unhandledRejection");
    // The handler should log to console.error with JSON
    expect(handlerBlock).toContain("console.error");
  });
});

// ---------------------------------------------------------------------------
// §DB9 — Drizzle schema columns match migration 028 contract
// ---------------------------------------------------------------------------

describe("§DB9: Drizzle schema columns match migration 028 contract", () => {
  let schema:    string;
  let migration: string;
  beforeEach(() => {
    schema    = readShared("schema.ts");
    migration = readMigration("028_trade_planning_sessions.sql");
  });

  it("schema has user_id column (user_id NOT NULL in migration)", () => {
    const block = schema.slice(schema.indexOf("tradePlanningSessions = pgTable"), schema.indexOf("tradePlanningSessions = pgTable") + 800);
    expect(block).toContain('text("user_id")');
    expect(block).toContain(".notNull()");
  });

  it("schema has symbol column", () => {
    const block = schema.slice(schema.indexOf("tradePlanningSessions = pgTable"), schema.indexOf("tradePlanningSessions = pgTable") + 800);
    expect(block).toContain("symbol");
  });

  it("schema has opportunity_id column", () => {
    const block = schema.slice(schema.indexOf("tradePlanningSessions = pgTable"), schema.indexOf("tradePlanningSessions = pgTable") + 800);
    expect(block).toContain("opportunityId");
  });

  it("schema has research_goal_id column", () => {
    const block = schema.slice(schema.indexOf("tradePlanningSessions = pgTable"), schema.indexOf("tradePlanningSessions = pgTable") + 800);
    expect(block).toContain("researchGoalId");
  });

  it("schema has portfolio_id column", () => {
    const block = schema.slice(schema.indexOf("tradePlanningSessions = pgTable"), schema.indexOf("tradePlanningSessions = pgTable") + 800);
    expect(block).toContain("portfolioId");
  });

  it("schema has selected_expression_family column", () => {
    const block = schema.slice(schema.indexOf("tradePlanningSessions = pgTable"), schema.indexOf("tradePlanningSessions = pgTable") + 1500);
    expect(block).toContain("selectedExpressionFamily");
  });

  it("schema has created_at and updated_at columns", () => {
    const block = schema.slice(schema.indexOf("tradePlanningSessions = pgTable"), schema.indexOf("tradePlanningSessions = pgTable") + 1500);
    expect(block).toContain("createdAt");
    expect(block).toContain("updatedAt");
  });
});

// ---------------------------------------------------------------------------
// §DB10 — ensureTradePlanTables includes CREATE TABLE trade_planning_sessions
// ---------------------------------------------------------------------------

describe("§DB10: ensureTradePlanTables — complete table creation", () => {
  it("includes all required columns in the CREATE TABLE statement", () => {
    const src   = readService("trade-plan-service.ts");
    const block = src.slice(
      src.indexOf("CREATE TABLE IF NOT EXISTS trade_planning_sessions"),
      src.indexOf("CREATE TABLE IF NOT EXISTS trade_planning_sessions") + 800,
    );
    const required = [
      "user_id",
      "symbol",
      "opportunity_id",
      "research_goal_id",
      "portfolio_id",
      "constraints",
      "selected_expression_family",
      "broad_expression_type",
      "expression_selected_by",
      "created_at",
      "updated_at",
    ];
    for (const col of required) {
      expect(block, `Column ${col} missing from CREATE TABLE`).toContain(col);
    }
  });

  it("includes ADD COLUMN IF NOT EXISTS for broad_expression_type (additive migration)", () => {
    const src = readService("trade-plan-service.ts");
    expect(src).toContain("ADD COLUMN IF NOT EXISTS broad_expression_type");
    expect(src).toContain("ADD COLUMN IF NOT EXISTS expression_selected_by");
  });
});

// ---------------------------------------------------------------------------
// §DB11 — broad_expression_type and expression_selected_by in Drizzle schema
// ---------------------------------------------------------------------------

describe("§DB11: Migration 029 columns present in Drizzle schema", () => {
  it("Drizzle schema has broadExpressionType column", () => {
    const schema = readShared("schema.ts");
    expect(schema).toContain("broadExpressionType");
    expect(schema).toContain('text("broad_expression_type")');
  });

  it("Drizzle schema has expressionSelectedBy column", () => {
    const schema = readShared("schema.ts");
    expect(schema).toContain("expressionSelectedBy");
    expect(schema).toContain('text("expression_selected_by")');
  });
});

// ---------------------------------------------------------------------------
// §DB12 — opportunityId is TEXT (buildOpportunityId output accepted)
// ---------------------------------------------------------------------------

describe("§DB12: opportunityId is TEXT (not UUID) — accepts buildOpportunityId output", () => {
  it("buildOpportunityId returns a TEXT string like 'WMT-top_growth'", async () => {
    const { buildOpportunityId } = await import("../../services/opportunity-intelligence-service");
    const id = buildOpportunityId("WMT", "top_growth");
    expect(typeof id).toBe("string");
    // Should NOT be a UUID format (no hyphens-in-UUID pattern: 8-4-4-4-12)
    expect(id).toContain("WMT");
    expect(id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("Drizzle schema defines opportunityId as text (not uuid)", () => {
    const schema = readShared("schema.ts");
    const block  = schema.slice(
      schema.indexOf("tradePlanningSessions = pgTable"),
      schema.indexOf("tradePlanningSessions = pgTable") + 600,
    );
    const lineIdx = block.indexOf("opportunityId");
    const line    = block.slice(lineIdx, lineIdx + 80);
    expect(line).toContain('text("opportunity_id")');
    expect(line).not.toContain("uuid(");
  });

  it("ensureTradePlanTables defines opportunity_id as TEXT in CREATE TABLE", () => {
    const src   = readService("trade-plan-service.ts");
    const block = src.slice(
      src.indexOf("CREATE TABLE IF NOT EXISTS trade_planning_sessions"),
      src.indexOf("CREATE TABLE IF NOT EXISTS trade_planning_sessions") + 800,
    );
    expect(block).toContain("opportunity_id             TEXT");
  });
});

// ---------------------------------------------------------------------------
// §DB13 — portfolioId is TEXT in Drizzle schema (no UUID-cast crash)
// ---------------------------------------------------------------------------

describe("§DB13: portfolioId is TEXT in Drizzle schema", () => {
  it("Drizzle schema defines portfolioId as text (not uuid())", () => {
    const schema = readShared("schema.ts");
    const block  = schema.slice(
      schema.indexOf("tradePlanningSessions = pgTable"),
      schema.indexOf("tradePlanningSessions = pgTable") + 600,
    );
    const lineIdx = block.indexOf("portfolioId");
    const line    = block.slice(lineIdx, lineIdx + 80);
    expect(line).toContain('text("portfolio_id")');
    expect(line).not.toContain("uuid(");
  });
});

// ---------------------------------------------------------------------------
// §DB14 — selectedExpressionFamily null allowed on creation
// ---------------------------------------------------------------------------

describe("§DB14: selectedExpressionFamily null allowed on creation", () => {
  it("createPlanningSession sets selectedExpressionFamily to null", () => {
    const src = readService("trade-planning-service.ts");
    const fn  = src.slice(
      src.indexOf("export async function createPlanningSession"),
      src.indexOf("export async function createPlanningSession") + 800,
    );
    expect(fn).toContain("selectedExpressionFamily: null");
  });

  it("CHECK constraint allows NULL for selected_expression_family", () => {
    const migration = readMigration("028_trade_planning_sessions.sql");
    expect(migration).toContain("selected_expression_family IS NULL");
  });
});

// ---------------------------------------------------------------------------
// §DB15 — id uses gen_random_uuid() default
// ---------------------------------------------------------------------------

describe("§DB15: id column uses gen_random_uuid() default (no client id)", () => {
  it("Drizzle schema has gen_random_uuid() default for id", () => {
    const schema = readShared("schema.ts");
    const block  = schema.slice(
      schema.indexOf("tradePlanningSessions = pgTable"),
      schema.indexOf("tradePlanningSessions = pgTable") + 400,
    );
    expect(block).toContain("gen_random_uuid()");
  });

  it("createPlanningSession does NOT include id in the values object", () => {
    const src = readService("trade-planning-service.ts");
    const fn  = src.slice(
      src.indexOf("export async function createPlanningSession"),
      src.indexOf("export async function createPlanningSession") + 600,
    );
    // The values object in the insert must NOT include an explicit id
    const valuesBlock = fn.slice(fn.indexOf(".values("), fn.indexOf(".values(") + 400);
    expect(valuesBlock).not.toContain("id:");
  });
});

// ---------------------------------------------------------------------------
// §DB16 — Security: userId from session, not client body
// ---------------------------------------------------------------------------

describe("§DB16: Security — userId from req.session, not client body", () => {
  it("POST /session uses req.session.userId! (not req.body.userId)", () => {
    const src = readRoute("trade-planning.ts");
    const postBlock = src.slice(
      src.indexOf('app.post("/api/trade-planning/session"'),
      src.indexOf('app.post("/api/trade-planning/session"') + 400,
    );
    expect(postBlock).toContain("req.session.userId!");
    expect(postBlock).not.toContain("req.body.userId");
  });

  it("createPlanningSession signature takes userId as first param (server-derived)", () => {
    const src = readService("trade-planning-service.ts");
    const fn  = src.slice(
      src.indexOf("export async function createPlanningSession("),
      src.indexOf("export async function createPlanningSession(") + 100,
    );
    expect(fn).toContain("userId: string");
  });
});

// ---------------------------------------------------------------------------
// §DB17 — Process survival: unhandledRejection does NOT call process.exit
// ---------------------------------------------------------------------------

describe("§DB17: unhandledRejection handler survival invariant", () => {
  it("handler does not call process.exit()", () => {
    const src = readServer("index.ts");
    const handlerBlock = src.slice(
      src.indexOf("process.on"),
      src.indexOf("process.on") + 1000,
    );
    // The handler must NOT call process.exit
    expect(handlerBlock).not.toMatch(/process\.exit\(\d+\)/);
  });

  it("handler logs to stderr or console.error (not swallowed)", () => {
    const src = readServer("index.ts");
    const handlerBlock = src.slice(
      src.indexOf('"unhandledRejection"'),
      src.indexOf('"unhandledRejection"') + 600,
    );
    expect(handlerBlock).toMatch(/console\.error|process\.stderr/);
  });
});

// ---------------------------------------------------------------------------
// §DB18 — Client: createSessionMutation.onError resets selectedFamily to null
// ---------------------------------------------------------------------------

describe("§DB18: Client onError resets selectedFamily (no phantom selection)", () => {
  it("onError calls setSelectedFamily(null)", () => {
    const src          = readClient("trade-planning.tsx");
    // Find the onError block in createSessionMutation (by locating the error handler)
    const onErrorBlock = src.slice(
      src.indexOf("onError: (err: any)"),
      src.indexOf("onError: (err: any)") + 600,
    );
    expect(onErrorBlock).toContain("setSelectedFamily(null)");
  });
});

// ---------------------------------------------------------------------------
// §DB19 — Client: createSessionMutation.onError clears pendingFamilyRef
// ---------------------------------------------------------------------------

describe("§DB19: Client onError clears pendingFamilyRef (no zombie pending state)", () => {
  it("onError sets pendingFamilyRef.current = null", () => {
    const src          = readClient("trade-planning.tsx");
    const onErrorBlock = src.slice(
      src.indexOf("onError: (err: any)"),
      src.indexOf("onError: (err: any)") + 600,
    );
    expect(onErrorBlock).toContain("pendingFamilyRef.current = null");
  });
});

// ---------------------------------------------------------------------------
// §DB20 — validateConstraints safe with exact WMT payload
// ---------------------------------------------------------------------------

describe("§DB20: validateConstraints — exact WMT production payload", () => {
  it("does not throw for { equityAllowed: true, optionsAllowed: false }", async () => {
    const { validateConstraints } = await import("../../../shared/trade-planning-types");
    const result = validateConstraints({ equityAllowed: true, optionsAllowed: false });
    expect(result.equityAllowed).toBe(true);
    expect(result.optionsAllowed).toBe(false);
  });

  it("does not throw for null payload (returns DEFAULT_CONSTRAINTS)", async () => {
    const { validateConstraints, DEFAULT_CONSTRAINTS } = await import("../../../shared/trade-planning-types");
    const result = validateConstraints(null);
    expect(result).toEqual(DEFAULT_CONSTRAINTS);
  });

  it("does not throw for undefined payload (returns DEFAULT_CONSTRAINTS)", async () => {
    const { validateConstraints, DEFAULT_CONSTRAINTS } = await import("../../../shared/trade-planning-types");
    const result = validateConstraints(undefined);
    expect(result).toEqual(DEFAULT_CONSTRAINTS);
  });
});

// ---------------------------------------------------------------------------
// §DB21 — Broker mutations = 0
// ---------------------------------------------------------------------------

describe("§DB21: No broker mutations in session persistence path", () => {
  it("trade-planning.ts POST /session does not call placeOrder/submitOrder", () => {
    const src       = readRoute("trade-planning.ts");
    const postBlock = src.slice(
      src.indexOf('app.post("/api/trade-planning/session"'),
      src.indexOf('app.post("/api/trade-planning/session"') + 2000,
    );
    expect(postBlock).not.toContain("placeOrder");
    expect(postBlock).not.toContain("submitOrder");
    expect(postBlock).not.toContain("replaceOrder");
    expect(postBlock).not.toContain("cancelOrder");
  });

  it("createPlanningSession service does not reference broker services", () => {
    const src = readService("trade-planning-service.ts");
    const fn  = src.slice(
      src.indexOf("export async function createPlanningSession"),
      src.indexOf("export async function createPlanningSession") + 800,
    );
    expect(fn).not.toContain("broker");
    expect(fn).not.toContain("tradier");
    expect(fn).not.toContain("placeOrder");
  });
});

// ---------------------------------------------------------------------------
// §DB22 — Schema contract: constraints is JSONB
// ---------------------------------------------------------------------------

describe("§DB22: constraints column is JSONB (not TEXT or VARCHAR)", () => {
  it("Drizzle schema uses jsonb() for constraints", () => {
    const schema = readShared("schema.ts");
    // The field definition line: "  constraints:  jsonb("constraints")..."
    // Do not use block.indexOf("constraints") — that may land on a comment.
    // Check that the specific field binding exists anywhere in the schema file.
    expect(schema).toContain(`constraints:              jsonb(`);
  });

  it("migration 028 defines constraints column as JSONB", () => {
    const migration = readMigration("028_trade_planning_sessions.sql");
    expect(migration).toMatch(/constraints\s+JSONB/i);
  });

  it("ensureTradePlanTables defines constraints as JSONB in CREATE TABLE", () => {
    const src   = readService("trade-plan-service.ts");
    const block = src.slice(
      src.indexOf("CREATE TABLE IF NOT EXISTS trade_planning_sessions"),
      src.indexOf("CREATE TABLE IF NOT EXISTS trade_planning_sessions") + 600,
    );
    expect(block).toContain("JSONB");
  });
});

// ---------------------------------------------------------------------------
// §DB23 — Startup sequence: ensureTradePlanTables called from routes.ts
// ---------------------------------------------------------------------------

describe("§DB23: Startup sequence — ensureTradePlanTables called in routes.ts", () => {
  it("routes.ts imports and calls ensureTradePlanTables on startup", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../routes.ts"), "utf8");
    expect(src).toContain("ensureTradePlanTables");
    expect(src).toContain("ensureTradePlanTables()");
  });
});

// ---------------------------------------------------------------------------
// §DB24 — Session creation error response shape
// ---------------------------------------------------------------------------

describe("§DB24: 500 error response shape includes code and message", () => {
  it("500 response includes SESSION_PERSISTENCE_FAILED code", () => {
    const src       = readRoute("trade-planning.ts");
    const postBlock = src.slice(
      src.indexOf('app.post("/api/trade-planning/session"'),
      src.indexOf('app.post("/api/trade-planning/session"') + 2000,
    );
    expect(postBlock).toContain("SESSION_PERSISTENCE_FAILED");
  });

  it("500 response includes user-friendly message", () => {
    const src       = readRoute("trade-planning.ts");
    const postBlock = src.slice(
      src.indexOf('app.post("/api/trade-planning/session"'),
      src.indexOf('app.post("/api/trade-planning/session"') + 2000,
    );
    expect(postBlock).toContain("Unable to save your planning session");
  });
});

// ---------------------------------------------------------------------------
// §DB25 — Forced DB failure: controlled 500, no double-response
// ---------------------------------------------------------------------------

describe("§DB25: POST /session — error path has return before res.status(500)", () => {
  it("catch block uses return res.status(500) to prevent double response", () => {
    const src       = readRoute("trade-planning.ts");
    const postBlock = src.slice(
      src.indexOf('app.post("/api/trade-planning/session"'),
      src.indexOf('app.post("/api/trade-planning/session"') + 2000,
    );
    const catchBlock = postBlock.slice(postBlock.indexOf("} catch"), postBlock.indexOf("} catch") + 400);
    // Must have return before status(500) to prevent fall-through to the success path
    expect(catchBlock).toContain("return res.status(500)");
  });
});
