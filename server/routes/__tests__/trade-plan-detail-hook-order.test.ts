/**
 * server/routes/__tests__/trade-plan-detail-hook-order.test.ts
 * Sprint 2.8.6A — Defect-7: React #310 hook-order crash on Trade Plan Detail
 *
 * React Error #310 = "Rendered more hooks than expected."
 * Root cause: 6 hooks (useState×2, useBrokerStatus, useQuery×3) were declared
 * AFTER the `if (isLoading) return` and `if (error || !plan) return` guards,
 * causing the hook count to change between render 1 (loading: 12 hooks) and
 * render 2 (plan loaded: 18 hooks).
 *
 * Permanent regression coverage:
 *   §HK1  All hooks execute before any early return in trade-plan-detail.tsx
 *   §HK2  No hook appears after `if (isLoading) return`
 *   §HK3  No hook appears after `if (error || !plan) return`
 *   §HK4  No hook is conditionally gated on plan type, broker status, or plan presence
 *   §HK5  All 6 previously misplaced hooks are now before early returns
 *   §HK6  activityCategory useState is before the loading guard
 *   §HK7  isEvaluating useState is before the loading guard
 *   §HK8  brokerConnected (useBrokerStatus) is before the loading guard
 *   §HK9  preflightData useQuery is before the loading guard
 *   §HK10 lifecycleData useQuery is before the loading guard
 *   §HK11 activityData useQuery is before the loading guard
 *   §HK12 No hook in execution child components is conditionally skipped by parent
 *   §HK13 ExecutionPreflightPanel has no top-level conditional hook calls
 *   §HK14 OrderPreparationPanel has no top-level conditional hook calls
 *   §HK15 EquityOrderPreviewPanel has no top-level conditional hook calls
 *   §HK16 ExecutionReadinessPanel has no top-level conditional hook calls
 *   §HK17 FinalOrderReviewPanel has no top-level conditional hook calls
 *   §HK18 Broker mutation count = 0 (rendering never mutates broker state)
 *   §HK19 No enabled: plan.type === ... pattern (conditional hook by plan type)
 *   §HK20 preflightData query gated by `enabled` not conditional call
 *   §HK21 lifecycleData query gated by `enabled` not conditional call
 *   §HK22 activityData query gated by `enabled` not conditional call
 *   §HK23 handleRefreshLifecycle is a function (not a hook) — allowed after hooks
 *   §HK24 No `if (...) { useQuery(...)` pattern anywhere in detail page
 *   §HK25 All hook calls in detail page use unconditional scope
 *
 * All tests are pure/structural — no render, no network, no broker calls.
 *
 * Category: regression, react-hooks
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLIENT_PAGES = path.resolve(__dirname, "../../../client/src/pages");
const CLIENT_EXEC  = path.resolve(__dirname, "../../../client/src/components/execution");

function readPage(name: string): string {
  return fs.readFileSync(path.join(CLIENT_PAGES, name), "utf8");
}
function readExec(name: string): string {
  return fs.readFileSync(path.join(CLIENT_EXEC, name), "utf8");
}

// Find the first occurrence of any `if (isLoading)` or `if (error` early return
// and return its character offset in the file.
function firstEarlyReturnOffset(src: string): number {
  // The canonical early returns in trade-plan-detail.tsx
  const patterns = [
    "if (isLoading) {",
    "if (isLoading){",
    "if (error || !plan) {",
    "if (error || !plan){",
  ];
  let earliest = Infinity;
  for (const p of patterns) {
    const idx = src.indexOf(p);
    if (idx !== -1 && idx < earliest) earliest = idx;
  }
  return earliest === Infinity ? -1 : earliest;
}

// Return true if a hook call appears AFTER the given offset
function hasHookAfterOffset(src: string, hookPattern: string, offset: number): boolean {
  const searchSrc = src.slice(offset);
  return searchSrc.includes(hookPattern);
}

// ---------------------------------------------------------------------------
// §HK1 — All hooks execute before any early return
// ---------------------------------------------------------------------------

describe("§HK1: Hook declarations are all before early returns", () => {
  let src: string;
  let earlyReturnOffset: number;

  beforeEach(() => {
    src = readPage("trade-plan-detail.tsx");
    earlyReturnOffset = firstEarlyReturnOffset(src);
  });

  it("early return guard is found in the file", () => {
    expect(earlyReturnOffset).toBeGreaterThan(-1);
  });

  it("no useState call appears after the first early return", () => {
    // Get everything after the early return
    const afterGuard = src.slice(earlyReturnOffset);
    // Find where the main return (render) begins
    const renderReturnIdx = afterGuard.lastIndexOf("\n  return (");
    const bodyBetweenGuards = afterGuard.slice(0, renderReturnIdx > 0 ? renderReturnIdx : undefined);
    // useState is only legal BEFORE early returns or inside JSX event handlers
    // In the body between the early-return guards and the render return, no useState should appear
    // We look for the raw function-scope pattern: "useState(" not inside JSX
    // A simple heuristic: const [...] = useState( at the top level of the function
    const matches = bodyBetweenGuards.match(/^\s+const\s+\[.*\]\s*=\s*useState\(/gm) ?? [];
    expect(matches.length).toBe(0);
  });

  it("no useQuery call appears after the first early return (outside JSX)", () => {
    const afterGuard = src.slice(earlyReturnOffset);
    const renderReturnIdx = afterGuard.lastIndexOf("\n  return (");
    const bodyBetweenGuards = afterGuard.slice(0, renderReturnIdx > 0 ? renderReturnIdx : undefined);
    const matches = bodyBetweenGuards.match(/^\s+const\s+\{.*\}\s*=\s*useQuery\(/gm) ?? [];
    expect(matches.length).toBe(0);
  });

  it("useBrokerStatus is not called after the first early return", () => {
    expect(hasHookAfterOffset(src, "= useBrokerStatus()", earlyReturnOffset)).toBe(false);
  });

  it("useMutation is not called after the first early return", () => {
    expect(hasHookAfterOffset(src, "= useMutation(", earlyReturnOffset)).toBe(false);
  });

  it("useEffect is not called after the first early return", () => {
    expect(hasHookAfterOffset(src, "useEffect(", earlyReturnOffset)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §HK2 — No hook after `if (isLoading) return`
// ---------------------------------------------------------------------------

describe("§HK2: No hook after isLoading guard", () => {
  let src: string;
  beforeEach(() => { src = readPage("trade-plan-detail.tsx"); });

  it("isLoading guard is present", () => {
    expect(src).toContain("if (isLoading)");
  });

  it("no useState appears after isLoading guard (outside JSX)", () => {
    const guardIdx = src.indexOf("if (isLoading)");
    const afterGuard = src.slice(guardIdx);
    // Only top-level const [...] = useState( counts (inside component function)
    const matches = afterGuard.match(/^\s{2}const\s+\[.*\]\s*=\s*useState\(/gm) ?? [];
    expect(matches.length).toBe(0);
  });

  it("no useQuery appears after isLoading guard (outside JSX)", () => {
    const guardIdx = src.indexOf("if (isLoading)");
    const afterGuard = src.slice(guardIdx);
    const matches = afterGuard.match(/^\s{2}const\s+\{.*\}\s*=\s*useQuery</gm) ?? [];
    expect(matches.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §HK3 — No hook after `if (error || !plan) return`
// ---------------------------------------------------------------------------

describe("§HK3: No hook after error/!plan guard", () => {
  let src: string;
  beforeEach(() => { src = readPage("trade-plan-detail.tsx"); });

  it("error guard is present", () => {
    expect(src).toContain("if (error || !plan)");
  });

  it("no useState appears after error guard (outside JSX)", () => {
    const guardIdx = src.indexOf("if (error || !plan)");
    const afterGuard = src.slice(guardIdx);
    const matches = afterGuard.match(/^\s{2}const\s+\[.*\]\s*=\s*useState\(/gm) ?? [];
    expect(matches.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §HK4 — No hook conditionally gated by plan type
// ---------------------------------------------------------------------------

describe("§HK4: No hook conditionally gated by plan type", () => {
  let src: string;
  beforeEach(() => { src = readPage("trade-plan-detail.tsx"); });

  it("no `if (plan.type` or `if (plan.planType` gates a hook call", () => {
    // Scan for: if (plan.type... { ... useXxx(
    // Simplified: the word useQuery/useState/useEffect must not appear inside
    // an if-block that checks plan.type or plan.planType
    expect(src).not.toMatch(/if\s*\(\s*plan\.type.*\{[^}]*useQuery\(/s);
    expect(src).not.toMatch(/if\s*\(\s*plan\.planType.*\{[^}]*useQuery\(/s);
    expect(src).not.toMatch(/if\s*\(\s*plan\.type.*\{[^}]*useState\(/s);
    expect(src).not.toMatch(/if\s*\(\s*plan\.planType.*\{[^}]*useState\(/s);
  });
});

// ---------------------------------------------------------------------------
// §HK5–§HK11 — The 6 previously misplaced hooks are now before early returns
// ---------------------------------------------------------------------------

describe("§HK5–§HK11: Previously misplaced hooks are before early returns", () => {
  let src: string;
  let earlyReturnOffset: number;

  beforeEach(() => {
    src = readPage("trade-plan-detail.tsx");
    earlyReturnOffset = firstEarlyReturnOffset(src);
  });

  it("§HK5: activityCategory useState is declared before early returns", () => {
    const hookIdx = src.indexOf('useState<string>("all")');
    expect(hookIdx).toBeGreaterThan(-1);
    expect(hookIdx).toBeLessThan(earlyReturnOffset);
  });

  it("§HK6: isEvaluating useState is declared before early returns", () => {
    const hookIdx = src.indexOf("const [isEvaluating, setIsEvaluating] = useState(false)");
    expect(hookIdx).toBeGreaterThan(-1);
    expect(hookIdx).toBeLessThan(earlyReturnOffset);
  });

  it("§HK7: useBrokerStatus is called before early returns", () => {
    const hookIdx = src.indexOf("= useBrokerStatus()");
    expect(hookIdx).toBeGreaterThan(-1);
    expect(hookIdx).toBeLessThan(earlyReturnOffset);
  });

  it("§HK8: preflightData useQuery is before early returns", () => {
    const hookIdx = src.indexOf("execution/preflight");
    expect(hookIdx).toBeGreaterThan(-1);
    // Walk back to the containing useQuery(
    const queryStart = src.lastIndexOf("useQuery", hookIdx);
    expect(queryStart).toBeLessThan(earlyReturnOffset);
  });

  it("§HK9: lifecycleData useQuery is before early returns", () => {
    const hookIdx = src.indexOf('"lifecycle"');
    expect(hookIdx).toBeGreaterThan(-1);
    const queryStart = src.lastIndexOf("useQuery", hookIdx);
    expect(queryStart).toBeLessThan(earlyReturnOffset);
  });

  it("§HK10: activityData useQuery is before early returns", () => {
    const hookIdx = src.indexOf('"activity"');
    expect(hookIdx).toBeGreaterThan(-1);
    const queryStart = src.lastIndexOf("useQuery", hookIdx);
    expect(queryStart).toBeLessThan(earlyReturnOffset);
  });

  it("§HK11: all hooks appear in the section between start and first early return", () => {
    const hooksSection = src.slice(0, earlyReturnOffset);
    // The 6 previously missing hooks must all appear in this section
    expect(hooksSection).toContain('useState<string>("all")');
    expect(hooksSection).toContain("isEvaluating");
    expect(hooksSection).toContain("useBrokerStatus()");
    expect(hooksSection).toContain("preflightData");
    expect(hooksSection).toContain("lifecycleData");
    expect(hooksSection).toContain("activityData");
  });
});

// ---------------------------------------------------------------------------
// §HK12–§HK17 — Execution child components have no top-level conditional hooks
// ---------------------------------------------------------------------------

describe("§HK12–§HK17: Execution child components — no conditional hooks", () => {
  it("§HK13: ExecutionPreflightPanel has no if-gated hook calls", () => {
    const src = readExec("ExecutionPreflightPanel.tsx");
    // No pattern: if (...) { ... useQuery( or useState(
    expect(src).not.toMatch(/if\s*\([^)]+\)\s*\{[^}]*useQuery\(/s);
    expect(src).not.toMatch(/if\s*\([^)]+\)\s*\{[^}]*useState\(/s);
    expect(src).not.toMatch(/if\s*\([^)]+\)\s*\{[^}]*useMutation\(/s);
  });

  it("§HK14: OrderPreparationPanel has no if-gated hook calls", () => {
    const src = readExec("OrderPreparationPanel.tsx");
    expect(src).not.toMatch(/if\s*\([^)]+\)\s*\{[^}]*useQuery\(/s);
    expect(src).not.toMatch(/if\s*\([^)]+\)\s*\{[^}]*useState\(/s);
  });

  it("§HK15: EquityOrderPreviewPanel has no if-gated hook calls", () => {
    const src = readExec("EquityOrderPreviewPanel.tsx");
    expect(src).not.toMatch(/if\s*\([^)]+\)\s*\{[^}]*useQuery\(/s);
    expect(src).not.toMatch(/if\s*\([^)]+\)\s*\{[^}]*useState\(/s);
  });

  it("§HK16: ExecutionReadinessPanel has no if-gated hook calls at component level", () => {
    const src = readExec("ExecutionReadinessPanel.tsx");
    // Readiness panel uses custom hooks — just check no raw if-useState at top-level
    expect(src).not.toMatch(/^\s{2}if\s*\([^)]+\)\s*\{[^}]*useState\(/gm);
  });

  it("§HK17: FinalOrderReviewPanel has no if-gated hook calls", () => {
    const src = readExec("FinalOrderReviewPanel.tsx");
    expect(src).not.toMatch(/if\s*\([^)]+\)\s*\{[^}]*useQuery\(/s);
  });
});

// ---------------------------------------------------------------------------
// §HK18 — Broker mutation count = 0 (page render never mutates broker state)
// ---------------------------------------------------------------------------

describe("§HK18: Rendering trade-plan-detail never mutates broker state", () => {
  let src: string;
  beforeEach(() => { src = readPage("trade-plan-detail.tsx"); });

  it("no call to placeOrder in trade-plan-detail.tsx", () => {
    expect(src).not.toContain("placeOrder");
  });

  it("no call to submitOrder in trade-plan-detail.tsx", () => {
    expect(src).not.toContain("submitOrder");
  });

  it("no call to replaceOrder in trade-plan-detail.tsx", () => {
    expect(src).not.toContain("replaceOrder");
  });

  it("no call to cancelOrder in trade-plan-detail.tsx", () => {
    expect(src).not.toContain("cancelOrder");
  });
});

// ---------------------------------------------------------------------------
// §HK19 — No `enabled: plan.type === ...` pattern (conditional by plan type)
// ---------------------------------------------------------------------------

describe("§HK19: Queries not conditionally enabled by plan type", () => {
  let src: string;
  beforeEach(() => { src = readPage("trade-plan-detail.tsx"); });

  it("no enabled: condition checks plan.type or plan.planType", () => {
    expect(src).not.toContain("enabled: plan.type");
    expect(src).not.toContain("enabled: plan.planType");
    expect(src).not.toContain("enabled: plan?.type");
    expect(src).not.toContain("enabled: plan?.planType");
  });
});

// ---------------------------------------------------------------------------
// §HK20–§HK22 — Queries use `enabled` guard (not conditional calls)
// ---------------------------------------------------------------------------

describe("§HK20–§HK22: Lifecycle/preflight/activity queries use `enabled` guard", () => {
  let src: string;
  beforeEach(() => { src = readPage("trade-plan-detail.tsx"); });

  it("§HK20: preflightData query has enabled: !!id && !!plan && brokerConnected", () => {
    const preflightBlock = src.slice(
      src.indexOf("execution/preflight") - 500,
      src.indexOf("execution/preflight") + 100,
    );
    expect(preflightBlock).toContain("enabled:");
    expect(preflightBlock).toContain("brokerConnected");
  });

  it("§HK21: lifecycleData query has enabled: !!id && !!plan", () => {
    // Sprint 2.8.7A: search for the queryKey array form to avoid matching the
    // TradePlanReadinessPanel helper component's { key: "lifecycle", ... } object literal.
    const lifecycleQueryKeyPattern = '"/api/trade-plans", id, "lifecycle"';
    const lifecycleIdx = src.indexOf(lifecycleQueryKeyPattern);
    expect(lifecycleIdx).toBeGreaterThan(-1);
    const lifecycleBlock = src.slice(
      src.lastIndexOf("useQuery", lifecycleIdx),
      lifecycleIdx + 300,
    );
    expect(lifecycleBlock).toContain("enabled:");
    expect(lifecycleBlock).toContain("!!plan");
  });

  it("§HK22: activityData query has enabled: !!id && !!plan", () => {
    const activityIdx = src.indexOf('"activity"');
    const queryStart  = src.lastIndexOf("useQuery", activityIdx);
    // Use 600 chars to cover the full query object (queryFn lines can be long)
    const activityBlock = src.slice(queryStart, activityIdx + 600);
    expect(activityBlock).toContain("enabled:");
    expect(activityBlock).toContain("!!plan");
  });
});

// ---------------------------------------------------------------------------
// §HK23 — handleRefreshLifecycle is a function (not a hook)
// ---------------------------------------------------------------------------

describe("§HK23: handleRefreshLifecycle is an async function (not a hook)", () => {
  let src: string;
  beforeEach(() => { src = readPage("trade-plan-detail.tsx"); });

  it("handleRefreshLifecycle is declared as an async function", () => {
    expect(src).toContain("const handleRefreshLifecycle = async () =>");
  });

  it("handleRefreshLifecycle does NOT start with 'use' (not a hook)", () => {
    // Just a sanity check — function names starting with 'use' are hooks by convention
    expect("handleRefreshLifecycle").not.toMatch(/^use[A-Z]/);
  });
});

// ---------------------------------------------------------------------------
// §HK24 — No `if (...) { useQuery(` pattern in trade-plan-detail.tsx
// ---------------------------------------------------------------------------

describe("§HK24: No if-gated useQuery/useState/useEffect calls", () => {
  let src: string;
  beforeEach(() => { src = readPage("trade-plan-detail.tsx"); });

  it("no if-gated useQuery call in function body", () => {
    // Look for: if (...) {\n  ... useQuery(   — must not exist
    expect(src).not.toMatch(/if\s*\([^)]+\)\s*\{\s*\n\s+(?:const\s+)?(?:\{[^}]+\}|[a-z]+)\s*=\s*useQuery\(/m);
  });

  it("no if-gated useState call in function body", () => {
    expect(src).not.toMatch(/if\s*\([^)]+\)\s*\{\s*\n\s+const\s+\[[^\]]+\]\s*=\s*useState\(/m);
  });
});

// ---------------------------------------------------------------------------
// §HK25 — All hook calls in the detail page use unconditional scope
// ---------------------------------------------------------------------------

describe("§HK25: All hooks are at unconditional component scope", () => {
  let src: string;
  beforeEach(() => { src = readPage("trade-plan-detail.tsx"); });

  it("all useState calls appear before the first early return guard", () => {
    const earlyReturnOffset = firstEarlyReturnOffset(src);
    const beforeGuard = src.slice(0, earlyReturnOffset);
    // Count useState in the before-guard section
    const beforeCount = (beforeGuard.match(/= useState[<(]/g) ?? []).length;
    // Count useState in the whole file (excluding JSX event handlers — rough count)
    // Just verify: there are no useState calls between the guard and the final render return
    const afterGuard = src.slice(earlyReturnOffset);
    const renderReturnIdx = afterGuard.indexOf("\n  return (");
    const betweenGuards = afterGuard.slice(0, renderReturnIdx > 0 ? renderReturnIdx : afterGuard.length);
    const afterCount = (betweenGuards.match(/^\s{2}const\s+\[.*\]\s*=\s*useState\(/gm) ?? []).length;
    expect(afterCount).toBe(0);
    expect(beforeCount).toBeGreaterThan(0); // sanity: there ARE useState calls
  });
});
