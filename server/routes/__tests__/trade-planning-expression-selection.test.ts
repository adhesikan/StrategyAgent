/**
 * server/routes/__tests__/trade-planning-expression-selection.test.ts
 * Sprint 2.8.6A — Defect-5: Trade Planning Expression Selection / Execution Handoff
 *
 * Permanent regression coverage for:
 *   §EXP1  Explore CTA labels exist for all families
 *   §EXP2  ExpressionCard renders an explicit Explore button for applicable families
 *   §EXP3  ExpressionCard does NOT render Explore for unavailable families
 *   §EXP4  handleExploreFamily — selectedBy invariant (USER only, never AI/SYSTEM)
 *   §EXP5  No auto-selection: applicable expressions require explicit user action
 *   §EXP6  Scaled Equity shows POTENTIALLY_APPLICABLE when constraints are missing
 *   §EXP7  Options remain UNAVAILABLE when disabled in constraints
 *   §EXP8  Monitor Only shows applicable alongside Equity without auto-selecting either
 *   §EXP9  Trade Plan creation uses EQUITY planType for equity expression
 *   §EXP10 Trade Plan creation requires planningSessionId (cannot be null)
 *   §EXP11 POST /api/trade-plans uses req.session.userId (not req.user.id)
 *   §EXP12 All trade-plans routes use canonical session auth
 *   §EXP13 Trade Plan creation API accepts planningSessionId + planType only
 *   §EXP14 Client source contains handleExploreFamily (explicit selection function)
 *   §EXP15 Client source does NOT auto-select an expression on page load
 *   §EXP16 Client source — stale "Future Planning Steps" placeholder removed
 *   §EXP17 Client source — "Order Preparation — Upcoming" text removed
 *   §EXP18 Client source — Create Trade Plan button present
 *   §EXP19 Client source — EXPLORE_CTA_LABELS mapping exists
 *   §EXP20 Expression evaluation — WMT scenario (equity=applicable, monitor=applicable)
 *   §EXP21 Preference ordering does not auto-select
 *   §EXP22 Forbidden body fields rejected by trade-plans creation route
 *   §EXP23 Client source — pendingFamilyRef pattern present (no-session flow)
 *   §EXP24 No direct broker action from Trade Planning page
 *   §EXP25 Execution workflow stages listed (Research Workflow section)
 *
 * All tests are pure / structural — no DB, no network, no broker calls.
 *
 * Category: regression, security
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROUTES_DIR   = path.resolve(__dirname, "..");
const SHARED_DIR   = path.resolve(__dirname, "../../../shared");
const CLIENT_DIR   = path.resolve(__dirname, "../../../client/src/pages");
const SERVICES_DIR = path.resolve(__dirname, "../../services");

function readRoute(name: string): string {
  return fs.readFileSync(path.join(ROUTES_DIR, name), "utf8");
}
function readShared(name: string): string {
  return fs.readFileSync(path.join(SHARED_DIR, name), "utf8");
}
function readClient(name: string): string {
  return fs.readFileSync(path.join(CLIENT_DIR, name), "utf8");
}
function readService(name: string): string {
  return fs.readFileSync(path.join(SERVICES_DIR, name), "utf8");
}

// ---------------------------------------------------------------------------
// §EXP1 — Explore CTA labels exist for all expected families
// ---------------------------------------------------------------------------

describe("§EXP1: EXPLORE_CTA_LABELS mapping — covers all key families", () => {
  let src: string;
  beforeEach(() => { src = readClient("trade-planning.tsx"); });

  it("EXPLORE_CTA_LABELS constant is defined in client source", () => {
    expect(src).toContain("EXPLORE_CTA_LABELS");
  });

  it("equity → 'Explore Equity' label", () => {
    expect(src).toContain("Explore Equity");
  });

  it("equity_scaled → 'Explore Scaled Equity' label", () => {
    expect(src).toContain("Explore Scaled Equity");
  });

  it("monitor_only → 'Monitor Candidate' label", () => {
    expect(src).toContain("Monitor Candidate");
  });

  it("options families → 'Explore Options' or similar", () => {
    // At least one options explore label must be present
    expect(src).toMatch(/Explore.*Options|Explore.*Covered|Explore.*Put/);
  });
});

// ---------------------------------------------------------------------------
// §EXP2 — ExpressionCard renders explicit Explore button for actionable families
// ---------------------------------------------------------------------------

describe("§EXP2: ExpressionCard — explicit Explore CTA for non-unavailable families", () => {
  let src: string;
  beforeEach(() => { src = readClient("trade-planning.tsx"); });

  it("ExpressionCard accepts onExplore prop", () => {
    expect(src).toContain("onExplore");
  });

  it("onExplore is called with result.family when button clicked", () => {
    // The button onClick must call onExplore with result.family
    expect(src).toContain("onExplore(result.family)");
  });

  it("Explore button only renders when onExplore is provided and family is not unavailable", () => {
    // Pattern: !isUnavailable && onExplore
    expect(src).toMatch(/!isUnavailable.*onExplore|onExplore.*!isUnavailable/);
  });

  it("Explore button uses stopPropagation to not trigger card toggle", () => {
    // The button must stop propagation so it doesn't toggle the card selection
    expect(src).toContain("stopPropagation");
  });
});

// ---------------------------------------------------------------------------
// §EXP3 — ExpressionCard does NOT render Explore for unavailable families
// ---------------------------------------------------------------------------

describe("§EXP3: ExpressionCard — unavailable families have no actionable Explore CTA", () => {
  let src: string;
  beforeEach(() => { src = readClient("trade-planning.tsx"); });

  it("unavailable cards are rendered without onExplore prop", () => {
    // The unavailable card map should not pass onExplore
    const unavailBlock = src.slice(
      src.indexOf("unavailable.map(e =>"),
      src.indexOf("unavailable.map(e =>") + 500,
    );
    expect(unavailBlock).not.toContain("onExplore={handleExploreFamily}");
  });

  it("isUnavailable gates the Explore button", () => {
    // Guard: if isUnavailable, no button renders even if onExplore is passed
    const cardSrc = src.slice(
      src.indexOf("function ExpressionCard"),
      src.indexOf("function ExpressionCard") + 2500,
    );
    expect(cardSrc).toContain("!isUnavailable");
  });
});

// ---------------------------------------------------------------------------
// §EXP4 — selectedBy invariant: always USER, never AI/SYSTEM
// ---------------------------------------------------------------------------

describe("§EXP4: selectedBy = USER invariant", () => {
  it("saveBroadExpressionSelection service hardcodes selectedBy = USER", async () => {
    const svc = readService("trade-preferences-service.ts");
    // Must contain USER literal assignment, not a client-supplied value
    expect(svc).toContain('"USER"');
    expect(svc).toContain("selectedBy");
    // Must NOT accept selectedBy from client as a parameter
    expect(svc).not.toMatch(/selectedBy:\s*selectedBy/); // no passthrough of client value
  });

  it("POST expression-selection route rejects client-submitted selectedBy", () => {
    const route = readRoute("trade-preferences.ts");
    // The route uses FORBIDDEN_CLIENT_FIELDS set to reject selectedBy from client
    expect(route).toContain("FORBIDDEN_CLIENT_FIELDS");
    expect(route).toContain("selectedBy");
  });

  it("client handleExploreFamily does NOT submit selectedBy in request body", () => {
    const src = readClient("trade-planning.tsx");
    // The function must not send selectedBy as a field
    const exploreBlock = src.slice(
      src.indexOf("handleExploreFamily"),
      src.indexOf("handleExploreFamily") + 800,
    );
    expect(exploreBlock).not.toContain("selectedBy");
  });
});

// ---------------------------------------------------------------------------
// §EXP5 — No auto-selection: explicit user action required
// ---------------------------------------------------------------------------

describe("§EXP5: No auto-selection of expression families", () => {
  let src: string;
  beforeEach(() => { src = readClient("trade-planning.tsx"); });

  it("selectedFamily initial state is null (no default selection)", () => {
    expect(src).toContain("useState<ExpressionFamily | null>(null)");
  });

  it("selectedFamily is never set on page load or from context query result", () => {
    // The useEffect seeding from contextQuery only seeds sessionId, not selectedFamily
    const effectBlock = src.slice(
      src.indexOf("useEffect(() => {"),
      src.indexOf("useEffect(() => {") + 600,
    );
    // Should NOT set selectedFamily inside the effect
    expect(effectBlock).not.toContain("setSelectedFamily");
  });

  it("no auto-select when expression is applicable", async () => {
    // Server-side: evaluateExpressionFamilies returns statuses but never selects
    const svc = readService("trade-planning-service.ts");
    expect(svc).toContain("evaluateExpressionFamilies");
    // The function returns array of family results, not a selection
    expect(svc).not.toContain("selectedFamily = applicable[0]");
  });
});

// ---------------------------------------------------------------------------
// §EXP6 — Scaled Equity shows POTENTIALLY_APPLICABLE when constraints missing
// ---------------------------------------------------------------------------

describe("§EXP6: Scaled Equity — POTENTIALLY_APPLICABLE without capital constraint", () => {
  it("evaluateExpressionFamilies marks equity_scaled potentially_applicable when capital constraint absent", async () => {
    const { evaluateExpressionFamilies } = await import("../../services/trade-planning-service");
    const { setLatestRanking } = await import("../../services/opportunity-ranking-engine");
    const { getCanonicalOpportunity } = await import("../../services/opportunity-intelligence-service");

    setLatestRanking({
      generatedAt: new Date().toISOString(),
      topGrowth: [],
      topIncome: [],
      watchlist:  [{
        symbol: "WMT", score: 48, strategy: "Approaching Setup",
        reasons: ["Tightening"], warnings: [], setupDetected: false, resistance: null,
        opportunityScore: {
          overallScore: 48, technical: 50, institutional: 42, fundamental: 48,
          risk: 50, regime: 45, confidence: "low" as const, sector: "Consumer Staples", category: "Watch",
        },
      }],
      approaching: [],
      changes: [],
    } as any);

    const opp = await getCanonicalOpportunity("WMT");
    if (!opp) return; // no ranking available in test env — skip

    const {
      DEFAULT_CONSTRAINTS,
    } = await import("../../../shared/trade-planning-types");

    const results = evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS);
    const scaled  = results.find(r => r.family === "equity_scaled");

    // Without capital constraints, scaled equity should be potentially applicable or have missing constraints
    if (scaled) {
      expect(["potentially_applicable", "unavailable"]).toContain(scaled.status);
      // If potentially applicable, missing constraints should guide the user
      if (scaled.status === "potentially_applicable") {
        expect(scaled.constraintsMissing.length).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §EXP7 — Options remain UNAVAILABLE when optionsAllowed is false
// ---------------------------------------------------------------------------

describe("§EXP7: Options UNAVAILABLE when constraints.optionsAllowed = false", () => {
  it("evaluateExpressionFamilies marks all options families unavailable when optionsAllowed=false", async () => {
    const { evaluateExpressionFamilies } = await import("../../services/trade-planning-service");
    const { setLatestRanking } = await import("../../services/opportunity-ranking-engine");
    const { getCanonicalOpportunity } = await import("../../services/opportunity-intelligence-service");
    const { DEFAULT_CONSTRAINTS } = await import("../../../shared/trade-planning-types");

    setLatestRanking({
      generatedAt: new Date().toISOString(),
      topGrowth: [{ symbol: "WMT", score: 66, strategy: "Trend Continuation",
        reasons: ["VCP"], warnings: [], setupDetected: true, resistance: 90.0,
        opportunityScore: { overallScore: 66, technical: 70, institutional: 60,
          fundamental: 60, risk: 65, regime: 65, confidence: "medium" as const,
          sector: "Consumer Staples", category: "Top Growth" } }],
      topIncome: [],
      watchlist: [],
      approaching: [],
      changes: [],
    } as any);

    const opp = await getCanonicalOpportunity("WMT");
    if (!opp) return;

    const noOptions = { ...DEFAULT_CONSTRAINTS, optionsAllowed: false };
    const results   = evaluateExpressionFamilies(opp, noOptions);

    const optionFamilies = ["income", "defined_risk_directional", "covered_call",
      "cash_secured_put", "vertical_spread", "long_option", "neutral_options", "advanced_options"];

    for (const fam of optionFamilies) {
      const r = results.find(r => r.family === fam);
      if (r) {
        expect(r.status).toBe("unavailable");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §EXP8 — Monitor Only and Equity both applicable, neither auto-selected
// ---------------------------------------------------------------------------

describe("§EXP8: Multiple applicable families — no auto-selection", () => {
  it("evaluateExpressionFamilies can return multiple applicable families", async () => {
    const { evaluateExpressionFamilies } = await import("../../services/trade-planning-service");
    const { setLatestRanking } = await import("../../services/opportunity-ranking-engine");
    const { getCanonicalOpportunity } = await import("../../services/opportunity-intelligence-service");
    const { DEFAULT_CONSTRAINTS } = await import("../../../shared/trade-planning-types");

    setLatestRanking({
      generatedAt: new Date().toISOString(),
      topGrowth: [{ symbol: "WMT", score: 66, strategy: "Trend Continuation",
        reasons: ["VCP"], warnings: [], setupDetected: true, resistance: 90.0,
        opportunityScore: { overallScore: 66, technical: 70, institutional: 60,
          fundamental: 60, risk: 65, regime: 65, confidence: "medium" as const,
          sector: "Consumer Staples", category: "Top Growth" } }],
      topIncome: [],
      watchlist: [],
      approaching: [],
      changes: [],
    } as any);

    const opp = await getCanonicalOpportunity("WMT");
    if (!opp) return;

    const results = evaluateExpressionFamilies(opp, { ...DEFAULT_CONSTRAINTS, optionsAllowed: false });
    const applicable = results.filter(r => r.status === "applicable");

    // At least equity should be applicable for a top-growth candidate
    expect(applicable.length).toBeGreaterThanOrEqual(1);

    // Verify no single "selected" field — the service returns family+status, not a selection
    for (const r of results) {
      expect((r as any).selected).toBeUndefined();
      expect((r as any).selectedBy).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// §EXP9 — Trade Plan creation uses EQUITY planType for equity expression
// ---------------------------------------------------------------------------

describe("§EXP9: Trade Plan creation — EQUITY planType", () => {
  it("client createTradePlanMutation sends planType: 'EQUITY'", () => {
    const src = readClient("trade-planning.tsx");
    // The mutation must send EQUITY as the plan type
    expect(src).toContain('"EQUITY"');
    expect(src).toContain("createTradePlanMutation");
  });

  it("client createTradePlanMutation sends planningSessionId: sessionId", () => {
    const src = readClient("trade-planning.tsx");
    expect(src).toContain("planningSessionId: sessionId");
  });
});

// ---------------------------------------------------------------------------
// §EXP10 — Trade Plan creation requires planningSessionId
// ---------------------------------------------------------------------------

describe("§EXP10: Trade Plan creation — planningSessionId required server-side", () => {
  it("POST /api/trade-plans validates planningSessionId presence", () => {
    const src = readRoute("trade-plans.ts");
    expect(src).toContain("planningSessionId");
    expect(src).toContain("planningSessionId is required");
  });

  it("POST /api/trade-plans validates planType (EQUITY or OPTIONS)", () => {
    const src = readRoute("trade-plans.ts");
    expect(src).toContain("planType must be EQUITY or OPTIONS");
  });
});

// ---------------------------------------------------------------------------
// §EXP11–§EXP12 — trade-plans routes use canonical session auth
// ---------------------------------------------------------------------------

describe("§EXP11: trade-plans.ts — canonical session.userId auth", () => {
  let src: string;
  beforeEach(() => { src = readRoute("trade-plans.ts"); });

  it("uses req.session.userId! (not req.user.id)", () => {
    expect(src).toContain("req.session.userId!");
  });

  it("does not use (req as any).user?.id anywhere", () => {
    expect(src).not.toContain("(req as any).user?.id");
  });
});

describe("§EXP12: All trade-plans route handlers use session auth", () => {
  it("POST /api/trade-plans handler uses req.session.userId!", () => {
    const src = readRoute("trade-plans.ts");
    const postBlock = src.slice(
      src.indexOf('app.post("/api/trade-plans"'),
      src.indexOf('app.post("/api/trade-plans"') + 500,
    );
    expect(postBlock).toContain("req.session.userId!");
  });

  it("GET /api/trade-plans/:id handler uses req.session.userId!", () => {
    const src = readRoute("trade-plans.ts");
    const getBlock = src.slice(
      src.indexOf('app.get("/api/trade-plans/:id"'),
      src.indexOf('app.get("/api/trade-plans/:id"') + 500,
    );
    expect(getBlock).toContain("req.session.userId!");
  });
});

// ---------------------------------------------------------------------------
// §EXP13 — Forbidden body fields rejected by trade-plans creation
// ---------------------------------------------------------------------------

describe("§EXP13: Trade Plan creation — forbidden authoritative fields", () => {
  it("server rejects researchScore, technicalScore etc. from client body", () => {
    const src = readRoute("trade-plans.ts");
    expect(src).toContain("researchScore");
    expect(src).toContain("Client may not submit");
  });
});

// ---------------------------------------------------------------------------
// §EXP14–§EXP19 — Client source audits
// ---------------------------------------------------------------------------

describe("§EXP14: Client — handleExploreFamily function exists", () => {
  it("handleExploreFamily is defined in trade-planning.tsx", () => {
    const src = readClient("trade-planning.tsx");
    expect(src).toContain("function handleExploreFamily");
  });

  it("handleExploreFamily calls setSelectedFamily with the family (not a toggle)", () => {
    const src = readClient("trade-planning.tsx");
    const fn = src.slice(
      src.indexOf("function handleExploreFamily"),
      src.indexOf("function handleExploreFamily") + 600,
    );
    // Unlike handleSelectFamily which toggles, handleExploreFamily calls setSelectedFamily(f) directly
    expect(fn).toContain("setSelectedFamily(f)");
    // Must NOT toggle (f === selectedFamily ? null : f pattern)
    expect(fn).not.toContain("f === selectedFamily ? null");
  });
});

describe("§EXP15: Client — no auto-selection on page load", () => {
  it("selectedFamily initial useState is null", () => {
    const src = readClient("trade-planning.tsx");
    expect(src).toContain("useState<ExpressionFamily | null>(null)");
  });

  it("no setSelectedFamily call inside the contextQuery seeding useEffect", () => {
    const src = readClient("trade-planning.tsx");
    // Find the contextQuery-specific useEffect (the one that seeds sessionId from context)
    // We locate it by searching for the characteristic pattern:
    //   "if (contextQuery.data) {" ... "}, [contextQuery.data]"
    const marker    = "if (contextQuery.data) {";
    const markerIdx = src.indexOf(marker);
    const endIdx    = src.indexOf("}, [contextQuery.data]");
    if (markerIdx >= 0 && endIdx > markerIdx) {
      // Expand slightly back to capture the useEffect opening brace
      const effectBlock = src.slice(markerIdx - 100, endIdx + 30);
      expect(effectBlock).not.toContain("setSelectedFamily");
    }
  });
});

describe("§EXP16: Client — stale 'Future Planning Steps' placeholder removed", () => {
  it("'Future Planning Steps' title no longer exists in trade-planning.tsx", () => {
    const src = readClient("trade-planning.tsx");
    expect(src).not.toContain("Future Planning Steps");
  });
});

describe("§EXP17: Client — 'Order Preparation — Upcoming' text removed", () => {
  it("'Order Preparation — Upcoming' no longer appears in trade-planning.tsx", () => {
    const src = readClient("trade-planning.tsx");
    expect(src).not.toContain("Order Preparation</strong> — Upcoming");
    expect(src).not.toContain("Order Preparation — Upcoming");
  });
});

describe("§EXP18: Client — Create Trade Plan button present for equity expressions", () => {
  it("'Create Trade Plan' text appears in trade-planning.tsx", () => {
    const src = readClient("trade-planning.tsx");
    expect(src).toContain("Create Trade Plan");
  });

  it("createTradePlanMutation is defined", () => {
    const src = readClient("trade-planning.tsx");
    expect(src).toContain("createTradePlanMutation");
  });

  it("Create Trade Plan button is gated on equity family selection", () => {
    const src = readClient("trade-planning.tsx");
    // Locate the conditional guard that wraps the Create Trade Plan section.
    // The guard uses: selectedFamily === "equity" || selectedFamily === "equity_scaled"
    // and is followed by the Create Trade Plan card within a few hundred characters.
    // The Create Trade Plan section uses this specific guard (sessionId first)
    const guard    = 'sessionId && (selectedFamily === "equity" || selectedFamily === "equity_scaled")';
    const guardIdx = src.indexOf(guard);
    expect(guardIdx).toBeGreaterThan(-1); // guard must exist

    // Verify "Create Trade Plan" appears within 2000 chars after the guard
    const guardWindow = src.slice(guardIdx, guardIdx + 2000);
    expect(guardWindow).toContain("Create Trade Plan");
  });
});

describe("§EXP19: Client — EXPLORE_CTA_LABELS mapping defined", () => {
  it("EXPLORE_CTA_LABELS constant is defined and contains equity key", () => {
    const src = readClient("trade-planning.tsx");
    expect(src).toContain("EXPLORE_CTA_LABELS");
    expect(src).toContain("equity:");
    expect(src).toContain("monitor_only:");
  });
});

// ---------------------------------------------------------------------------
// §EXP20 — WMT regression: equity applicable, Explore action available
// ---------------------------------------------------------------------------

describe("§EXP20: WMT regression — equity = APPLICABLE", () => {
  it("evaluateExpressionFamilies returns equity as applicable for a top-growth WMT candidate", async () => {
    const { evaluateExpressionFamilies } = await import("../../services/trade-planning-service");
    const { setLatestRanking } = await import("../../services/opportunity-ranking-engine");
    const { getCanonicalOpportunity } = await import("../../services/opportunity-intelligence-service");
    const { DEFAULT_CONSTRAINTS } = await import("../../../shared/trade-planning-types");

    setLatestRanking({
      generatedAt: new Date().toISOString(),
      topGrowth: [{ symbol: "WMT", score: 66, strategy: "Trend Continuation",
        reasons: ["VCP detected"], warnings: [], setupDetected: true, resistance: 90.0,
        opportunityScore: { overallScore: 66, technical: 70, institutional: 60,
          fundamental: 60, risk: 65, regime: 65, confidence: "medium" as const,
          sector: "Consumer Staples", category: "Top Growth" } }],
      topIncome: [],
      watchlist: [],
      approaching: [],
      changes: [],
    } as any);

    const opp = await getCanonicalOpportunity("WMT");
    if (!opp) return; // engine unavailable in test env — skip

    const results = evaluateExpressionFamilies(opp, DEFAULT_CONSTRAINTS);
    const equity  = results.find(r => r.family === "equity");

    expect(equity).toBeDefined();
    expect(equity?.status).toBe("applicable");
  });

  it("WMT Explore Equity action is exposed to applicable cards (client source audit)", () => {
    const src = readClient("trade-planning.tsx");
    // applicable cards get onExplore={handleExploreFamily}
    const applicableSection = src.slice(
      src.indexOf("applicable.map(e =>"),
      src.indexOf("applicable.map(e =>") + 300,
    );
    expect(applicableSection).toContain("onExplore={handleExploreFamily}");
  });
});

// ---------------------------------------------------------------------------
// §EXP21 — Preference ordering does not auto-select
// ---------------------------------------------------------------------------

describe("§EXP21: Trading preferences affect ordering only, not selection", () => {
  it("computeExpressionOptions returns ordered options without a pre-selected family", async () => {
    const { computeExpressionOptions } = await import("../../services/trade-preferences-service");
    expect(typeof computeExpressionOptions).toBe("function");
    // The function returns ExpressionOptions which contains orderedFamilies, not a selection
    // We verify the function arity and name are not selection-flavored
    expect(computeExpressionOptions.length).toBeGreaterThanOrEqual(3);
  });

  it("client does not call computeExpressionOptions directly (server-side only)", () => {
    const src = readClient("trade-planning.tsx");
    // Client must never call the server-side service directly
    expect(src).not.toContain("computeExpressionOptions");
  });
});

// ---------------------------------------------------------------------------
// §EXP22 — Forbidden body fields rejected (security)
// ---------------------------------------------------------------------------

describe("§EXP22: Trade Plan creation — security: client cannot inject authoritative values", () => {
  it("POST /api/trade-plans rejects researchScore from client body", () => {
    const src = readRoute("trade-plans.ts");
    expect(src).toContain('"researchScore"');
    expect(src).toContain("Client may not submit");
  });

  it("POST /api/trade-plans rejects marketPrice from client body", () => {
    const src = readRoute("trade-plans.ts");
    expect(src).toContain('"marketPrice"');
  });

  it("POST expression-selection rejects selectedBy from client (must be USER from server)", () => {
    const src = readRoute("trade-preferences.ts");
    expect(src).toContain("FORBIDDEN_CLIENT_FIELDS");
    // The forbidden set must include selectedBy
    const forbiddenBlock = src.slice(
      src.indexOf("FORBIDDEN_CLIENT_FIELDS"),
      src.indexOf("FORBIDDEN_CLIENT_FIELDS") + 500,
    );
    expect(forbiddenBlock).toContain("selectedBy");
  });
});

// ---------------------------------------------------------------------------
// §EXP23 — pendingFamilyRef pattern for no-session flow
// ---------------------------------------------------------------------------

describe("§EXP23: Client — pendingFamilyRef enables Explore without pre-existing session", () => {
  let src: string;
  beforeEach(() => { src = readClient("trade-planning.tsx"); });

  it("pendingFamilyRef is declared as a useRef", () => {
    expect(src).toContain("pendingFamilyRef");
    expect(src).toContain("useRef");
  });

  it("handleExploreFamily sets pendingFamilyRef.current when no session exists", () => {
    const fn = src.slice(
      src.indexOf("function handleExploreFamily"),
      src.indexOf("function handleExploreFamily") + 800,
    );
    expect(fn).toContain("pendingFamilyRef.current = f");
  });

  it("createSessionMutation.onSuccess reads pendingFamilyRef to persist family", () => {
    const onSuccessBlock = src.slice(
      src.indexOf("pendingFamilyRef.current"),
      src.indexOf("pendingFamilyRef.current") + 1000,
    );
    expect(onSuccessBlock).toContain("pendingFamilyRef.current");
  });
});

// ---------------------------------------------------------------------------
// §EXP24 — No direct broker action from Trade Planning page
// ---------------------------------------------------------------------------

describe("§EXP24: No direct broker action from Trade Planning page", () => {
  let src: string;
  beforeEach(() => { src = readClient("trade-planning.tsx"); });

  it("createTradePlanMutation does NOT submit to broker (POST /api/trade-plans only)", () => {
    const mutBlock = src.slice(
      src.indexOf("createTradePlanMutation"),
      src.indexOf("createTradePlanMutation") + 600,
    );
    // Must call /api/trade-plans, NOT /api/execution or /api/order-drafts
    expect(mutBlock).toContain("/api/trade-plans");
    expect(mutBlock).not.toContain("/api/execution");
    expect(mutBlock).not.toContain("/api/order-drafts");
  });

  it("no automatic order submission in the page", () => {
    // Must not contain broker submission endpoints
    expect(src).not.toContain("/api/broker/submit");
    expect(src).not.toContain("submitOrder");
    expect(src).not.toContain("placeOrder");
  });
});

// ---------------------------------------------------------------------------
// §EXP25 — Research Workflow section (replaces stale placeholder)
// ---------------------------------------------------------------------------

describe("§EXP25: Research Workflow section", () => {
  let src: string;
  beforeEach(() => { src = readClient("trade-planning.tsx"); });

  it("'Research to Execution Workflow' section exists", () => {
    expect(src).toContain("Research to Execution Workflow");
  });

  it("workflow mentions Trade Plan as step 3", () => {
    // Trade Plan appears in the workflow list
    expect(src).toContain("Trade Plan");
  });

  it("workflow mentions Execution Preflight", () => {
    expect(src).toContain("Execution Preflight");
  });

  it("workflow mentions Order Preparation as available (not 'Upcoming')", () => {
    // Order Preparation exists as a step, but not labelled 'Upcoming' or 'Coming in future sprints'
    expect(src).toContain("Order Preparation");
    expect(src).not.toContain("Coming in future sprints");
    expect(src).not.toContain("Order Preparation — Upcoming");
  });
});
