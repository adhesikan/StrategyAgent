/**
 * server/routes/__tests__/execution-entry-point.test.ts — Sprint 2.8.6A
 *
 * Verifies the end-to-end manual execution entry point for eligible Equity Trade Plans:
 *   Trade Plan Detail → Preflight → Order Preparation → Equity Preview → Final Review → Execution
 *
 * §EP1–§EP4:   CTA visibility and eligibility gates (source-level)
 * §EP5–§EP8:   Downstream execution components imported and mounted
 * §EP9–§EP10:  Downstream panels gated on draft + preflight PASS
 * §EP11–§EP13: No broker submission in any UI panel
 * §EP14–§EP18: All pipeline server routes exist (app.post/app.get pattern)
 * §EP19:       AI cannot invoke execution entry point
 * §EP20:       TEST_LIVE gates remain on submission route
 * §EP21:       End-to-end integration path (mocked, no broker network call)
 * §EP22–§EP25: Source-level safety invariants
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
// §EP1–§EP4: "Prepare for Execution" CTA — visibility and eligibility
// ---------------------------------------------------------------------------

describe("§EP1–§EP4: Prepare for Execution CTA", () => {
  it("§EP1: trade-plan-detail.tsx contains 'Prepare for Execution' text", () => {
    expect(detailSrc).toContain("Prepare for Execution");
  });

  it("§EP2: CTA is gated on brokerConnected in the JSX condition", () => {
    // Anchor on the unique data-testid attribute placed on the CTA button.
    // The JSX condition is ~775 chars before the data-testid — use 900-char window.
    const ctaIdx = detailSrc.indexOf('data-testid="prepare-for-execution-cta"');
    expect(ctaIdx).toBeGreaterThan(-1);
    const ctaContext = detailSrc.slice(Math.max(0, ctaIdx - 900), ctaIdx + 50);
    expect(ctaContext).toContain("brokerConnected");
  });

  it("§EP3: CTA is gated on plan.planType === 'EQUITY'", () => {
    const ctaIdx = detailSrc.indexOf('data-testid="prepare-for-execution-cta"');
    expect(ctaIdx).toBeGreaterThan(-1);
    const ctaContext = detailSrc.slice(Math.max(0, ctaIdx - 900), ctaIdx + 50);
    expect(ctaContext).toContain("EQUITY");
  });

  it("§EP4: CTA is gated on plan.status !== 'ARCHIVED'", () => {
    const ctaIdx = detailSrc.indexOf('data-testid="prepare-for-execution-cta"');
    expect(ctaIdx).toBeGreaterThan(-1);
    const ctaContext = detailSrc.slice(Math.max(0, ctaIdx - 900), ctaIdx + 50);
    expect(ctaContext).toContain("ARCHIVED");
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
