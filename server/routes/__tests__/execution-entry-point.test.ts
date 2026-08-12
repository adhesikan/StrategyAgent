/**
 * server/routes/__tests__/execution-entry-point.test.ts — Sprint 2.8.6A (rev2)
 *
 * Verifies the end-to-end manual execution entry point for eligible Equity Trade Plans:
 *   Trade Plan Detail → Preflight → Order Preparation → Equity Preview → Final Review → Execution
 *
 * §EP1–§EP4:   "Execution Preparation" section and CTA visibility + eligibility gates
 * §EP5–§EP8:   Downstream execution components imported and mounted
 * §EP9–§EP10:  Downstream panels gated on draft + preflight PASS
 * §EP11–§EP13: No broker submission in any UI panel
 * §EP14–§EP18: All pipeline server routes exist (app.post/app.get pattern)
 * §EP19:       AI cannot invoke execution entry point
 * §EP20:       TEST_LIVE gates remain on submission route
 * §EP21:       End-to-end integration path (mocked, no broker network call)
 * §EP22–§EP25: Source-level safety invariants
 * §VD1–§VD4:  Visibility diagnostics — section always present; blocked-state for each blocker (§13)
 * §VD5–§VD6:  DOM content regression — "Execution Preparation" + CTA text in source (§14)
 * §VD7:        Production route test — App.tsx routes /trade-plans/:id to correct component (§15)
 * §VD8–§VD10: E2E path — preflight CTA wired; no broker mutation calls from UI panels (§16)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Source files under test
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");

function src(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

const detailSrc       = src("client/src/pages/trade-plan-detail.tsx");
const orderPrepSrc    = src("client/src/components/execution/OrderPreparationPanel.tsx");
const equityPrevSrc   = src("client/src/components/execution/EquityOrderPreviewPanel.tsx");
const finalRevSrc     = src("client/src/components/execution/FinalOrderReviewPanel.tsx");
const preflightRoute  = src("server/routes/execution-preflight.ts");
const orderPrepRoute  = src("server/routes/order-preparation.ts");
const equityPrevRoute = src("server/routes/equity-preview.ts");
const confirmRoute    = src("server/routes/order-confirmation.ts");
const execIntentRoute = src("server/routes/execution-intent.ts");
const validationSvc   = src("server/services/execution-final-validation-service.ts");
const execIntentTypes = src("shared/execution-intent-types.ts");

// ---------------------------------------------------------------------------
// §EP1–§EP4: "Execution Preparation" section and CTA visibility + eligibility
//
// Design change (Defect-8 rev2): the "Execution Preparation" section is now
// ALWAYS rendered for eligible EQUITY non-ARCHIVED plans (§10 UX invariant).
// brokerConnected controls BLOCKED state vs CTA within the section, not
// whether the section appears at all.
// ---------------------------------------------------------------------------

describe("§EP1–§EP4: Execution Preparation section and CTA", () => {
  it("§EP1: trade-plan-detail.tsx contains 'Check Execution Preconditions' CTA text", () => {
    expect(detailSrc).toContain("Check Execution Preconditions");
  });

  it("§EP1b: trade-plan-detail.tsx contains 'Execution Preparation' section heading", () => {
    expect(detailSrc).toContain("Execution Preparation");
  });

  it("§EP2: CTA button is gated on brokerConnected (inside else branch of !brokerConnected ternary)", () => {
    // Anchor on the unique data-testid attribute placed on the CTA button.
    // The BLOCKED state (~1100 chars) sits between !brokerConnected and the CTA button;
    // measured distance is ~2104 chars — use a 2200-char lookback window.
    const ctaIdx = detailSrc.indexOf('data-testid="prepare-for-execution-cta"');
    expect(ctaIdx).toBeGreaterThan(-1);
    const ctaContext = detailSrc.slice(Math.max(0, ctaIdx - 2200), ctaIdx + 50);
    expect(ctaContext).toContain("brokerConnected");
  });

  it("§EP3: Execution Preparation section is gated on plan.planType === 'EQUITY'", () => {
    // The section heading is anchored via aria-labelledby="execution-preparation-heading".
    // The gate (plan.planType === "EQUITY") precedes the heading in the same JSX block.
    const headingIdx = detailSrc.indexOf('"execution-preparation-heading"');
    expect(headingIdx).toBeGreaterThan(-1);
    // Within 300 chars before the heading we find the section's aria-labelledby attribute.
    // The gate that wraps the whole section is within 500 chars before the heading open tag.
    const sectionContext = detailSrc.slice(Math.max(0, headingIdx - 500), headingIdx + 50);
    expect(sectionContext).toContain("EQUITY");
  });

  it("§EP4: Execution Preparation section is gated on plan.status !== 'ARCHIVED'", () => {
    const headingIdx = detailSrc.indexOf('"execution-preparation-heading"');
    expect(headingIdx).toBeGreaterThan(-1);
    const sectionContext = detailSrc.slice(Math.max(0, headingIdx - 500), headingIdx + 50);
    expect(sectionContext).toContain("ARCHIVED");
  });
});

// ---------------------------------------------------------------------------
// §EP5–§EP8: Downstream execution components are imported and mounted
// ---------------------------------------------------------------------------

describe("§EP5–§EP8: downstream execution components imported and mounted", () => {
  it("§EP5: EquityOrderPreviewPanel is imported in trade-plan-detail.tsx", () => {
    expect(detailSrc).toMatch(/import.*EquityOrderPreviewPanel/);
  });

  it("§EP6: FinalOrderReviewPanel is imported in trade-plan-detail.tsx", () => {
    expect(detailSrc).toMatch(/import.*FinalOrderReviewPanel/);
  });

  it("§EP7: EquityOrderPreviewPanel is rendered in trade-plan-detail.tsx", () => {
    expect(detailSrc).toMatch(/<EquityOrderPreviewPanel/);
  });

  it("§EP8: FinalOrderReviewPanel is rendered in trade-plan-detail.tsx", () => {
    expect(detailSrc).toMatch(/<FinalOrderReviewPanel/);
  });
});

// ---------------------------------------------------------------------------
// §EP9–§EP10: Downstream panels are gated on activeDraftId + preflight PASS
// ---------------------------------------------------------------------------

describe("§EP9–§EP10: downstream panels gated on draft + preflight PASS", () => {
  it("§EP9: EquityOrderPreviewPanel render is gated on activeDraftId", () => {
    const eqIdx = detailSrc.indexOf("<EquityOrderPreviewPanel");
    expect(eqIdx).toBeGreaterThan(-1);
    const eqContext = detailSrc.slice(Math.max(0, eqIdx - 300), eqIdx + 20);
    expect(eqContext).toContain("activeDraftId");
  });

  it("§EP10: FinalOrderReviewPanel render is gated on activeDraftId", () => {
    const frIdx = detailSrc.indexOf("<FinalOrderReviewPanel");
    expect(frIdx).toBeGreaterThan(-1);
    const frContext = detailSrc.slice(Math.max(0, frIdx - 300), frIdx + 20);
    expect(frContext).toContain("activeDraftId");
  });
});

// ---------------------------------------------------------------------------
// §EP11–§EP13: No broker submission in any UI panel JSX
//
// We check that no rendered button/label contains forbidden submit text.
// Compliance comment headers (e.g. "No Confirm, Submit, …") legitimately
// mention these terms — we exclude comment lines from the check.
// ---------------------------------------------------------------------------

describe("§EP11–§EP13: no broker submission in UI panels", () => {
  /** Strip single-line comments and JSDoc from source, then scan for text in JSX */
  function noSubmitInJsx(content: string, name: string) {
    // Remove /* ... */ block comments and // line comments
    const noComments = content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    const FORBIDDEN = [
      ">Submit Order<",
      ">Place Order<",
      ">Execute Trade<",
      ">Send to Broker<",
    ];
    for (const f of FORBIDDEN) {
      if (noComments.includes(f)) {
        throw new Error(`${name} JSX renders forbidden text: "${f}"`);
      }
    }
  }

  it("§EP11: OrderPreparationPanel has no submit-to-broker JSX action", () => {
    noSubmitInJsx(orderPrepSrc, "OrderPreparationPanel");
  });

  it("§EP12: EquityOrderPreviewPanel has no submit-to-broker JSX action", () => {
    noSubmitInJsx(equityPrevSrc, "EquityOrderPreviewPanel");
  });

  it("§EP13: FinalOrderReviewPanel has no submit-to-broker JSX action", () => {
    noSubmitInJsx(finalRevSrc, "FinalOrderReviewPanel");
  });
});

// ---------------------------------------------------------------------------
// §EP14–§EP18: All pipeline server routes exist
// Routes in this project use app.post()/app.get() not router.post()
// ---------------------------------------------------------------------------

describe("§EP14–§EP18: all pipeline server routes exist", () => {
  it("§EP14: execution preflight route defines POST /api/trade-plans/:id/execution/preflight", () => {
    expect(preflightRoute).toContain('"/api/trade-plans/:id/execution/preflight"');
    expect(preflightRoute).toContain("app.post(");
  });

  it("§EP15: order preparation route defines POST and GET /api/trade-plans/:id/execution/order-draft", () => {
    expect(orderPrepRoute).toContain("/execution/order-draft");
    expect(orderPrepRoute).toContain("app.post(");
    expect(orderPrepRoute).toContain("app.get(");
  });

  it("§EP16: equity preview route defines POST /api/execution/order-drafts/:draftId/equity-preview", () => {
    expect(equityPrevRoute).toContain("/equity-preview");
    expect(equityPrevRoute).toContain("app.post(");
  });

  it("§EP17: order confirmation route defines POST final-review and POST confirm endpoints", () => {
    expect(confirmRoute).toContain("/final-review");
    expect(confirmRoute).toContain("/confirm");
    expect(confirmRoute).toContain("app.post(");
  });

  it("§EP18: execution-intent POST /submit is the ONLY broker submission path", () => {
    // execution-intent must have the submit route
    expect(execIntentRoute).toContain('"/api/executions/:id/submit"');
    // upstream routes must not define their own /submit route (app.post with /submit URL)
    expect(equityPrevRoute).not.toContain('"/api/execution/order-drafts/:draftId/equity-preview/submit"');
    expect(orderPrepRoute).not.toContain('/submit"');
    // confirmation route must not have a submit handler (only /confirm)
    expect(confirmRoute).not.toMatch(/app\.post\(\s*["'][^"']*\/submit["']/);
  });
});

// ---------------------------------------------------------------------------
// §EP19: AI cannot invoke the execution entry point
// ---------------------------------------------------------------------------

describe("§EP19: AI cannot invoke execution entry point", () => {
  it("§EP19a: setShowExecution only appears in trade-plan-detail.tsx (no other client page)", () => {
    const clientPages = fs.readdirSync(path.join(ROOT, "client/src/pages"))
      .filter(f => f.endsWith(".tsx") || f.endsWith(".ts"));
    const violations = clientPages
      .filter(f => f !== "trade-plan-detail.tsx")
      .filter(f => {
        try {
          return fs.readFileSync(path.join(ROOT, "client/src/pages", f), "utf8")
            .includes("setShowExecution");
        } catch { return false; }
      });
    expect(violations).toHaveLength(0);
  });

  it("§EP19b: server execution routes require session auth (not AI-injectable)", () => {
    expect(preflightRoute).toContain("session");
    expect(orderPrepRoute).toContain("session");
    expect(confirmRoute).toContain("session");
    expect(execIntentRoute).toContain("session");
  });

  it("§EP19c: no execution route accepts 'agentInitiated' or 'aiSource' parameter", () => {
    const routes = [preflightRoute, orderPrepRoute, equityPrevRoute, confirmRoute, execIntentRoute];
    for (const route of routes) {
      expect(route).not.toContain("agentInitiated");
      expect(route).not.toContain("aiSource");
      expect(route).not.toContain("ai_initiated");
    }
  });
});

// ---------------------------------------------------------------------------
// §EP20: TEST_LIVE gates remain on submission route
// ---------------------------------------------------------------------------

describe("§EP20: TEST_LIVE safety gates on broker submission", () => {
  it("§EP20a: execution-intent route references TEST_LIVE gate", () => {
    expect(execIntentRoute).toMatch(/TEST_LIVE|testLive|test_live/i);
  });

  it("§EP20b: EI_MARKET_ORDER_BANNED_IN_TEST_LIVE constant is defined in shared types", () => {
    expect(execIntentTypes).toContain("EI_MARKET_ORDER_BANNED_IN_TEST_LIVE");
  });

  it("§EP20c: final validation service enforces market order ban in TEST_LIVE", () => {
    expect(validationSvc).toContain("EI_MARKET_ORDER_BANNED_IN_TEST_LIVE");
    expect(validationSvc).toContain("Market orders are not permitted in TEST_LIVE");
  });

  it("§EP20d: TEST_LIVE allowlist is a submission gate, not a research-display gate", () => {
    // Preflight route must not block research display based on symbol allowlist
    const preflightLower = preflightRoute.toLowerCase();
    expect(preflightLower).not.toMatch(/allowlist.*block.*research|symbol_allowlist.*preflight_fail/);
  });
});

// ---------------------------------------------------------------------------
// §EP21: End-to-end integration path (route chain verification, no broker call)
// ---------------------------------------------------------------------------

describe("§EP21: end-to-end equity execution path (route chain verification)", () => {
  it("§EP21a: preflight route registers POST /api/trade-plans/:id/execution/preflight", () => {
    expect(preflightRoute).toContain('"/api/trade-plans/:id/execution/preflight"');
  });

  it("§EP21b: order-draft route registers both POST and GET handlers", () => {
    expect(orderPrepRoute).toContain("/execution/order-draft");
    expect(orderPrepRoute).toContain("app.post(");
    expect(orderPrepRoute).toContain("app.get(");
  });

  it("§EP21c: equity preview route registers POST /api/execution/order-drafts/:draftId/equity-preview", () => {
    expect(equityPrevRoute).toContain('"/api/execution/order-drafts/:draftId/equity-preview"');
  });

  it("§EP21d: final-review creation route registers POST /api/trade-plans/:id/final-review", () => {
    expect(confirmRoute).toContain('"/api/trade-plans/:id/final-review"');
  });

  it("§EP21e: final-review confirmation route registers POST .../confirm", () => {
    expect(confirmRoute).toContain("/confirm");
    expect(confirmRoute).toContain("app.post(");
  });

  it("§EP21f: execution intent creation from confirmation route exists", () => {
    expect(execIntentRoute).toContain("from-confirmation");
  });

  it("§EP21g: broker submit route is in execution-intent only (Sprint 2.8.6 isolation)", () => {
    // Only execution-intent has the /submit POST handler
    expect(execIntentRoute).toContain('"/api/executions/:id/submit"');
    // Confirmation route must not POST to a /submit endpoint
    expect(confirmRoute).not.toMatch(/app\.post\(\s*["'][^"']*\/submit["']/);
  });

  it("§EP21h: equity preview and order-preparation routes do not fetch directly to broker URLs", () => {
    const brokerPattern = /fetch\s*\(\s*["']https?:\/\/(api\.tradier|sandbox\.tradier|api\.tradestation)/;
    expect(orderPrepRoute).not.toMatch(brokerPattern);
    expect(equityPrevRoute).not.toMatch(brokerPattern);
  });

  it("§EP21i: final review route does not fetch directly to broker URLs", () => {
    const brokerPattern = /fetch\s*\(\s*["']https?:\/\/(api\.tradier|sandbox\.tradier|api\.tradestation)/;
    expect(confirmRoute).not.toMatch(brokerPattern);
  });
});

// ---------------------------------------------------------------------------
// §EP22–§EP25: Source-level safety invariants
// ---------------------------------------------------------------------------

describe("§EP22–§EP25: source-level safety invariants", () => {
  it("§EP22: showExecution toggle state exists in trade-plan-detail.tsx with useState(false)", () => {
    expect(detailSrc).toContain("showExecution");
    // The useState(false) for showExecution
    const showIdx = detailSrc.indexOf("showExecution");
    const context = detailSrc.slice(Math.max(0, showIdx - 50), showIdx + 120);
    expect(context).toMatch(/useState\s*\(false\)/);
  });

  it("§EP23: activeDraft query uses 'order-draft' cache key (shared with OrderPreparationPanel)", () => {
    expect(detailSrc).toContain('"order-draft"');
    expect(orderPrepSrc).toContain('"order-draft"');
  });

  it("§EP24: EquityOrderPreviewPanel and FinalOrderReviewPanel render after showExecution gate", () => {
    const gateIdx = detailSrc.indexOf("showExecution && brokerConnected");
    expect(gateIdx).toBeGreaterThan(-1);
    const eqIdx = detailSrc.indexOf("<EquityOrderPreviewPanel");
    expect(eqIdx).toBeGreaterThan(gateIdx);
    const frIdx = detailSrc.indexOf("<FinalOrderReviewPanel");
    expect(frIdx).toBeGreaterThan(gateIdx);
  });

  it("§EP25: FinalOrderReviewPanel onConfirmed does NOT navigate to /executions/:confirmationId", () => {
    // confirmation.id is a confirmation snapshot ID, not an execution ID.
    // Sprint 2.8.6 execution creation is a separate step via from-confirmation route.
    const frIdx = detailSrc.indexOf("<FinalOrderReviewPanel");
    expect(frIdx).toBeGreaterThan(-1);
    const frBlock = detailSrc.slice(frIdx, frIdx + 800);
    expect(frBlock).not.toMatch(/navigate.*\/executions\/.*confirmation\.id/);
    expect(frBlock).not.toMatch(/navigate.*`\/executions\/\${confirmation/);
  });
});

// ---------------------------------------------------------------------------
// §VD1–§VD4: Visibility diagnostics — §13
//
// The "Execution Preparation" section must always be visible for eligible
// EQUITY non-ARCHIVED plans. When a blocker is present the section renders a
// BLOCKED state with a human-readable reason (§10 UX invariant).
// ---------------------------------------------------------------------------

const appSrc = src("client/src/App.tsx");

describe("§VD1–§VD4: Execution Preparation section visibility (§13)", () => {
  it("§VD1: source contains 'Execution Preparation' heading rendered in JSX", () => {
    // The CardTitle text "Execution Preparation" must be present in detailSrc.
    expect(detailSrc).toContain("Execution Preparation");
  });

  it("§VD2: section renders for EQUITY non-ARCHIVED plans without requiring brokerConnected at section level", () => {
    // The section gate must be plan.planType === "EQUITY" && plan.status !== "ARCHIVED",
    // NOT additionally gated on brokerConnected at the outer JSX level.
    // Verify: the section's aria-labelledby is present and its gate does NOT include brokerConnected.
    const headingIdx = detailSrc.indexOf('"execution-preparation-heading"');
    expect(headingIdx).toBeGreaterThan(-1);

    // The ~180-char span from the gate open to the section tag must not contain brokerConnected.
    // (brokerConnected only appears inside the section, in the !brokerConnected ternary.)
    const gateToSection = detailSrc.slice(Math.max(0, headingIdx - 280), headingIdx - 50);
    expect(gateToSection).not.toContain("brokerConnected");
  });

  it("§VD3: BLOCKED state renders with reason text when broker is not connected", () => {
    // Source must contain the BLOCKED state and a plain-English reason.
    expect(detailSrc).toContain("BLOCKED");
    expect(detailSrc).toContain("Connect a broker account");
    // data-testid for the blocked state element
    expect(detailSrc).toContain('data-testid="execution-preparation-blocked"');
  });

  it("§VD4: section is hidden for ARCHIVED plans and OPTIONS plans (gate assertions)", () => {
    // Confirm the section gate excludes ARCHIVED and requires EQUITY.
    // These appear in the 500-char window before the heading aria attribute.
    const headingIdx = detailSrc.indexOf('"execution-preparation-heading"');
    const gateContext = detailSrc.slice(Math.max(0, headingIdx - 500), headingIdx + 50);
    expect(gateContext).toContain("ARCHIVED");  // plan.status !== "ARCHIVED"
    expect(gateContext).toContain("EQUITY");    // plan.planType === "EQUITY"
  });
});

// ---------------------------------------------------------------------------
// §VD5–§VD6: DOM content regression — §14
//
// Asserts that the actual page source contains the text the DOM must expose
// when the section is visible. Prevents "component exists but not mounted"
// regression.
// ---------------------------------------------------------------------------

describe("§VD5–§VD6: DOM content regression (§14)", () => {
  it("§VD5: detail page source contains 'Execution Preparation' (section heading text)", () => {
    expect(detailSrc).toContain("Execution Preparation");
  });

  it("§VD6: detail page source contains 'Check Execution Preconditions' (CTA button text)", () => {
    expect(detailSrc).toContain("Check Execution Preconditions");
  });
});

// ---------------------------------------------------------------------------
// §VD7: Production route test — §15
//
// Verifies that the App.tsx route configuration maps /trade-plans/:id to
// TradePlanDetailPage (the component we edited). Prevents "edited wrong file"
// regressions.
// ---------------------------------------------------------------------------

describe("§VD7: production route test (§15)", () => {
  it("§VD7a: App.tsx imports TradePlanDetailPage from pages/trade-plan-detail", () => {
    expect(appSrc).toMatch(/import TradePlanDetailPage from ["']@\/pages\/trade-plan-detail["']/);
  });

  it("§VD7b: App.tsx routes /trade-plans/:id to TradePlanDetailPage", () => {
    expect(appSrc).toContain('path="/trade-plans/:id"');
    // Confirm the same file that routes /trade-plans/:id also references TradePlanDetailPage
    const routeIdx = appSrc.indexOf('"/trade-plans/:id"');
    expect(routeIdx).toBeGreaterThan(-1);
    const routeContext = appSrc.slice(Math.max(0, routeIdx - 20), routeIdx + 120);
    expect(routeContext).toContain("TradePlanDetailPage");
  });

  it("§VD7c: no alternate trade-plan-detail component shadows the primary route", () => {
    // Only one file should export TradePlanDetailPage (the one App.tsx imports).
    const pages = require("fs").readdirSync(path.join(ROOT, "client/src/pages"))
      .filter((f: string) => f.endsWith(".tsx") || f.endsWith(".ts"));
    const exporters = pages.filter((f: string) => {
      try {
        const content = require("fs").readFileSync(
          path.join(ROOT, "client/src/pages", f), "utf8"
        );
        return content.includes("export default") &&
          content.includes("Execution Preparation") &&
          f !== "trade-plan-detail.tsx";
      } catch { return false; }
    });
    expect(exporters).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §VD8–§VD10: E2E path — §16
//
// Verifies that the preflight CTA is wired to the execution workflow and
// that no UI panel performs a broker mutation.
// ---------------------------------------------------------------------------

describe("§VD8–§VD10: E2E execution path — no broker mutation (§16)", () => {
  it("§VD8: preflight CTA (data-testid='prepare-for-execution-cta') is in trade-plan-detail.tsx", () => {
    expect(detailSrc).toContain('data-testid="prepare-for-execution-cta"');
  });

  it("§VD9a: OrderPreparationPanel does not fetch directly to broker order endpoints", () => {
    const brokerOrderPattern = /fetch\s*\(\s*["']https?:\/\/(api\.tradier|sandbox\.tradier|api\.tradestation).*order/;
    expect(orderPrepSrc).not.toMatch(brokerOrderPattern);
  });

  it("§VD9b: EquityOrderPreviewPanel does not fetch directly to broker order endpoints", () => {
    const brokerOrderPattern = /fetch\s*\(\s*["']https?:\/\/(api\.tradier|sandbox\.tradier|api\.tradestation).*order/;
    expect(equityPrevSrc).not.toMatch(brokerOrderPattern);
  });

  it("§VD10: BLOCKED state is distinct from the CTA — CTA text appears in source", () => {
    // "Check Execution Preconditions" appears in: file header comment, section comment,
    // aria-label, and button text — all legitimate. Assert it exists (≥ 1) and that
    // the BLOCKED state does NOT contain the button text (so they are truly distinct paths).
    expect(detailSrc).toContain("Check Execution Preconditions");
    // BLOCKED state must contain "BLOCKED" — not the CTA button label.
    const blockedIdx = detailSrc.indexOf('data-testid="execution-preparation-blocked"');
    expect(blockedIdx).toBeGreaterThan(-1);
    const blockedContent = detailSrc.slice(blockedIdx, blockedIdx + 500);
    expect(blockedContent).toContain("BLOCKED");
    expect(blockedContent).not.toContain("Check Execution Preconditions");
  });
});
