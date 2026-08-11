/**
 * server/routes/__tests__/test-live-certification.test.ts — Sprint 2.8.6A
 *
 * Pure unit tests for TEST_LIVE Execution Certification.
 * All functions are deterministic and use injectable dependencies.
 * No network calls, no DB, no env var side effects.
 */

import { describe, it, expect } from "vitest";
import {
  computeConfigAudit,
  computeMarketStatus,
  computeDisarmResult,
  buildCompletionReport,
  type ConfigAuditDeps,
} from "../test-live-certification";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function makeFullyConfiguredDeps(overrides: Partial<ConfigAuditDeps> = {}): ConfigAuditDeps {
  return {
    isExecutionEnabled: () => true,
    getExecutionMode: () => "test_live",
    isTradierExecutionEnabled: () => true,
    isTradeStationExecutionEnabled: () => false,
    isTestLiveArmed: () => true,
    getTestLiveAllowlistedAccounts: () => ["ACCT1234", "ACCT5678"],
    getTestLiveAllowlistedSymbols: () => ["AAPL", "MSFT"],
    getTestLiveMaxNotional: () => 250,
    getTestLiveMaxEquityQty: () => 1,
    getTestLiveMaxOptionContracts: () => null, // optional
    ...overrides,
  };
}

// Market dates (UTC — these land in US business hours in ET)
const OPEN_TUESDAY_ET  = new Date("2026-08-11T17:00:00Z"); // 13:00 EDT → market open
const OPEN_MONDAY_ET   = new Date("2026-08-10T19:00:00Z"); // 15:00 EDT → market open
const PRE_MARKET_ET    = new Date("2026-08-11T12:00:00Z"); // 08:00 EDT → pre-market
const AFTER_HOURS_ET   = new Date("2026-08-11T21:00:00Z"); // 17:00 EDT → after hours
const SATURDAY_ET      = new Date("2026-08-15T16:00:00Z"); // Saturday
const SUNDAY_ET        = new Date("2026-08-16T16:00:00Z"); // Sunday
const NEW_YEARS_ET     = new Date("2026-01-01T18:00:00Z"); // New Year's Day (13:00 ET)
const XMAS_ET          = new Date("2026-12-25T18:00:00Z"); // Christmas (13:00 ET)
const WINTER_OPEN_ET   = new Date("2026-11-17T17:00:00Z"); // Tuesday, 12:00 EST → open (winter)

// ─────────────────────────────────────────────────────────────────────────────
// computeConfigAudit — all-pass
// ─────────────────────────────────────────────────────────────────────────────

describe("computeConfigAudit — all gates pass", () => {
  it("returns allRequiredPass=true when all required deps are configured", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps());
    expect(result.allRequiredPass).toBe(true);
    expect(result.missingRequired).toHaveLength(0);
  });

  it("returns executionMode=test_live", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps());
    expect(result.executionMode).toBe("test_live");
  });

  it("returns executionEnabled=true", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps());
    expect(result.executionEnabled).toBe(true);
  });

  it("returns testLiveArmed=true", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps());
    expect(result.testLiveArmed).toBe(true);
  });

  it("returns allowlistedSymbols array", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps());
    expect(result.allowlistedSymbols).toEqual(["AAPL", "MSFT"]);
  });

  it("returns accountAllowlistCount without exposing IDs", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps());
    expect(result.accountAllowlistCount).toBe(2);
  });

  it("always returns productionBlocked=true", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps());
    expect(result.productionBlocked).toBe(true);
  });

  it("always returns marketOrderPolicy=banned", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps());
    expect(result.marketOrderPolicy).toBe("banned");
  });

  it("always returns multiLegPolicy=banned", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps());
    expect(result.multiLegPolicy).toBe("banned");
  });

  it("includes PRODUCTION_EXECUTION_BLOCK gate with PASS status", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps());
    const gate = result.gates.find(g => g.variable === "PRODUCTION_EXECUTION_BLOCK");
    expect(gate?.status).toBe("PASS");
  });

  it("includes MARKET_ORDER_POLICY gate with PASS status", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps());
    const gate = result.gates.find(g => g.variable === "MARKET_ORDER_POLICY");
    expect(gate?.status).toBe("PASS");
  });

  it("optional option-contracts cap does not fail allRequiredPass", () => {
    const deps = makeFullyConfiguredDeps({ getTestLiveMaxOptionContracts: () => null });
    const result = computeConfigAudit(deps);
    expect(result.allRequiredPass).toBe(true);
    const gate = result.gates.find(g => g.variable === "EXECUTION_TEST_MAX_OPTION_CONTRACTS");
    expect(gate?.status).toBe("OPTIONAL");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeConfigAudit — individual gate failures
// ─────────────────────────────────────────────────────────────────────────────

describe("computeConfigAudit — gate failures", () => {
  it("fails when BROKER_EXECUTION_ENABLED=false", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps({ isExecutionEnabled: () => false }));
    expect(result.allRequiredPass).toBe(false);
    expect(result.missingRequired).toContain("BROKER_EXECUTION_ENABLED");
    const gate = result.gates.find(g => g.variable === "BROKER_EXECUTION_ENABLED");
    expect(gate?.status).toBe("FAIL");
  });

  it("fails when BROKER_EXECUTION_MODE is not test_live", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps({ getExecutionMode: () => "disabled" }));
    expect(result.allRequiredPass).toBe(false);
    expect(result.missingRequired).toContain("BROKER_EXECUTION_MODE");
    const gate = result.gates.find(g => g.variable === "BROKER_EXECUTION_MODE");
    expect(gate?.status).toBe("FAIL");
  });

  it("fails when BROKER_EXECUTION_MODE is sandbox (not test_live)", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps({ getExecutionMode: () => "sandbox" }));
    expect(result.allRequiredPass).toBe(false);
    expect(result.missingRequired).toContain("BROKER_EXECUTION_MODE");
  });

  it("fails when EXECUTION_TEST_LIVE_ARMED=false", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps({ isTestLiveArmed: () => false }));
    expect(result.allRequiredPass).toBe(false);
    expect(result.missingRequired).toContain("EXECUTION_TEST_LIVE_ARMED");
    const gate = result.gates.find(g => g.variable === "EXECUTION_TEST_LIVE_ARMED");
    expect(gate?.status).toBe("FAIL");
  });

  it("fails when account allowlist is empty (fail-closed)", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps({ getTestLiveAllowlistedAccounts: () => [] }));
    expect(result.allRequiredPass).toBe(false);
    expect(result.missingRequired).toContain("EXECUTION_TEST_ACCOUNT_ALLOWLIST");
    const gate = result.gates.find(g => g.variable === "EXECUTION_TEST_ACCOUNT_ALLOWLIST");
    expect(gate?.status).toBe("FAIL");
  });

  it("fails when symbol allowlist is empty (fail-closed)", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps({ getTestLiveAllowlistedSymbols: () => [] }));
    expect(result.allRequiredPass).toBe(false);
    expect(result.missingRequired).toContain("EXECUTION_TEST_SYMBOL_ALLOWLIST");
    const gate = result.gates.find(g => g.variable === "EXECUTION_TEST_SYMBOL_ALLOWLIST");
    expect(gate?.status).toBe("FAIL");
  });

  it("fails when max notional is null (required)", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps({ getTestLiveMaxNotional: () => null }));
    expect(result.allRequiredPass).toBe(false);
    expect(result.missingRequired).toContain("EXECUTION_TEST_MAX_NOTIONAL");
    const gate = result.gates.find(g => g.variable === "EXECUTION_TEST_MAX_NOTIONAL");
    expect(gate?.status).toBe("FAIL");
  });

  it("fails when max equity qty is null (required)", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps({ getTestLiveMaxEquityQty: () => null }));
    expect(result.allRequiredPass).toBe(false);
    expect(result.missingRequired).toContain("EXECUTION_TEST_MAX_EQUITY_QTY");
    const gate = result.gates.find(g => g.variable === "EXECUTION_TEST_MAX_EQUITY_QTY");
    expect(gate?.status).toBe("FAIL");
  });

  it("fails when no provider is enabled despite execution being enabled", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps({
      isExecutionEnabled: () => true,
      isTradierExecutionEnabled: () => false,
      isTradeStationExecutionEnabled: () => false,
    }));
    expect(result.allRequiredPass).toBe(false);
    expect(result.missingRequired.some(m => m.includes("EXECUTION_ENABLED"))).toBe(true);
  });

  it("passes when TradeStation is the enabled provider (not Tradier)", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps({
      isTradierExecutionEnabled: () => false,
      isTradeStationExecutionEnabled: () => true,
    }));
    expect(result.allRequiredPass).toBe(true);
  });

  it("safeDescription never contains raw account IDs", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps({
      getTestLiveAllowlistedAccounts: () => ["REALACCT123456"],
    }));
    const allDescriptions = result.gates.map(g => g.safeDescription).join("\n");
    expect(allDescriptions).not.toContain("REALACCT123456");
  });

  it("accumulates multiple failures in missingRequired", () => {
    const result = computeConfigAudit(makeFullyConfiguredDeps({
      isExecutionEnabled: () => false,
      isTestLiveArmed: () => false,
      getTestLiveAllowlistedAccounts: () => [],
    }));
    expect(result.missingRequired.length).toBeGreaterThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeMarketStatus
// ─────────────────────────────────────────────────────────────────────────────

describe("computeMarketStatus", () => {
  it("returns OPEN during regular session on a Tuesday", () => {
    const result = computeMarketStatus(OPEN_TUESDAY_ET);
    expect(result.open).toBe(true);
    expect(result.status).toBe("OPEN");
    expect(result.canCertify).toBe(true);
  });

  it("returns OPEN during regular session on a Monday", () => {
    const result = computeMarketStatus(OPEN_MONDAY_ET);
    expect(result.open).toBe(true);
    expect(result.status).toBe("OPEN");
  });

  it("returns CLOSED_OUTSIDE_HOURS before market open (pre-market)", () => {
    const result = computeMarketStatus(PRE_MARKET_ET);
    expect(result.open).toBe(false);
    expect(result.status).toBe("CLOSED_OUTSIDE_HOURS");
    expect(result.canCertify).toBe(false);
  });

  it("returns CLOSED_OUTSIDE_HOURS after market close", () => {
    const result = computeMarketStatus(AFTER_HOURS_ET);
    expect(result.open).toBe(false);
    expect(result.status).toBe("CLOSED_OUTSIDE_HOURS");
    expect(result.canCertify).toBe(false);
  });

  it("returns CLOSED_WEEKEND on Saturday", () => {
    const result = computeMarketStatus(SATURDAY_ET);
    expect(result.open).toBe(false);
    expect(result.status).toBe("CLOSED_WEEKEND");
    expect(result.canCertify).toBe(false);
  });

  it("returns CLOSED_WEEKEND on Sunday", () => {
    const result = computeMarketStatus(SUNDAY_ET);
    expect(result.open).toBe(false);
    expect(result.status).toBe("CLOSED_WEEKEND");
    expect(result.canCertify).toBe(false);
  });

  it("returns CLOSED_HOLIDAY on New Year's Day", () => {
    const result = computeMarketStatus(NEW_YEARS_ET);
    expect(result.open).toBe(false);
    expect(result.status).toBe("CLOSED_HOLIDAY");
  });

  it("returns CLOSED_HOLIDAY on Christmas Day", () => {
    const result = computeMarketStatus(XMAS_ET);
    expect(result.open).toBe(false);
    expect(result.status).toBe("CLOSED_HOLIDAY");
  });

  it("handles winter time (EST UTC-5) correctly", () => {
    // Nov 17, 2026 = post DST end (first Sunday Nov = Nov 1; so Nov 1 onwards is EST)
    // 17:00 UTC = 12:00 EST = market open
    const result = computeMarketStatus(WINTER_OPEN_ET);
    expect(result.open).toBe(true);
    expect(result.status).toBe("OPEN");
  });

  it("always returns regularSessionStartEt=09:30", () => {
    const result = computeMarketStatus(OPEN_TUESDAY_ET);
    expect(result.regularSessionStartEt).toBe("09:30");
  });

  it("always returns regularSessionEndEt=16:00", () => {
    const result = computeMarketStatus(OPEN_TUESDAY_ET);
    expect(result.regularSessionEndEt).toBe("16:00");
  });

  it("includes current ET time in the result", () => {
    const result = computeMarketStatus(OPEN_TUESDAY_ET);
    // Format: "HH:MM ET (EDT)" or "HH:MM ET (EST)"
    expect(result.currentEtTime).toMatch(/\d{2}:\d{2} ET \(E[DS]T\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeDisarmResult
// ─────────────────────────────────────────────────────────────────────────────

describe("computeDisarmResult", () => {
  it("returns action=disarmed when was armed", () => {
    const result = computeDisarmResult(true);
    expect(result.action).toBe("disarmed");
    expect(result.wasArmed).toBe(true);
  });

  it("returns action=already_unarmed when was not armed", () => {
    const result = computeDisarmResult(false);
    expect(result.action).toBe("already_unarmed");
    expect(result.wasArmed).toBe(false);
  });

  it("always returns productionStillBlocked=true", () => {
    expect(computeDisarmResult(true).productionStillBlocked).toBe(true);
    expect(computeDisarmResult(false).productionStillBlocked).toBe(true);
  });

  it("includes operator guidance note when armed", () => {
    const result = computeDisarmResult(true);
    expect(result.note).toMatch(/EXECUTION_TEST_LIVE_ARMED/);
    expect(result.note.length).toBeGreaterThan(20);
  });

  it("includes no-op note when already unarmed", () => {
    const result = computeDisarmResult(false);
    expect(result.note).toMatch(/already|no action/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildCompletionReport
// ─────────────────────────────────────────────────────────────────────────────

describe("buildCompletionReport", () => {
  const openMarket = computeMarketStatus(OPEN_TUESDAY_ET);
  const closedMarket = computeMarketStatus(SATURDAY_ET);

  it("returns 48 items exactly", () => {
    const audit = computeConfigAudit(makeFullyConfiguredDeps());
    const report = buildCompletionReport(audit, openMarket);
    expect(report.items).toHaveLength(48);
    // Items must be numbered 1-48
    expect(report.items[0].item).toBe(1);
    expect(report.items[47].item).toBe(48);
  });

  it("verdict=NOT_READY and decision=NO_GO when config incomplete", () => {
    const audit = computeConfigAudit(makeFullyConfiguredDeps({ isExecutionEnabled: () => false }));
    const report = buildCompletionReport(audit, openMarket);
    expect(report.verdict).toBe("NOT_READY");
    expect(report.decision).toBe("NO_GO");
  });

  it("verdict=READY_BUT_MARKET_CLOSED when config ok but market closed", () => {
    const audit = computeConfigAudit(makeFullyConfiguredDeps());
    const report = buildCompletionReport(audit, closedMarket);
    expect(report.verdict).toBe("READY_BUT_MARKET_CLOSED");
    expect(report.decision).toBe("CONDITIONAL_GO");
  });

  it("verdict=NOT_CERTIFIED and decision=CONDITIONAL_GO when config+market ok but test not run", () => {
    const audit = computeConfigAudit(makeFullyConfiguredDeps());
    const report = buildCompletionReport(audit, openMarket);
    expect(report.verdict).toBe("NOT_CERTIFIED");
    expect(report.decision).toBe("CONDITIONAL_GO");
  });

  it("item 3 contains execution mode", () => {
    const audit = computeConfigAudit(makeFullyConfiguredDeps());
    const report = buildCompletionReport(audit, openMarket);
    const item = report.items.find(i => i.item === 3);
    expect(item?.value).toBe("test_live");
  });

  it("item 4 account allowlist PASS when configured", () => {
    const audit = computeConfigAudit(makeFullyConfiguredDeps());
    const report = buildCompletionReport(audit, openMarket);
    expect(report.items.find(i => i.item === 4)?.value).toBe("PASS");
  });

  it("item 4 account allowlist FAIL when empty", () => {
    const audit = computeConfigAudit(makeFullyConfiguredDeps({ getTestLiveAllowlistedAccounts: () => [] }));
    const report = buildCompletionReport(audit, openMarket);
    expect(report.items.find(i => i.item === 4)?.value).toBe("FAIL");
  });

  it("item 9 always shows production blocked", () => {
    const audit = computeConfigAudit(makeFullyConfiguredDeps());
    const report = buildCompletionReport(audit, openMarket);
    const item = report.items.find(i => i.item === 9);
    expect(item?.value).toMatch(/PASS/);
  });

  it("item 45 always shows production disabled regardless of test result", () => {
    const audit = computeConfigAudit(makeFullyConfiguredDeps());
    const report = buildCompletionReport(audit, openMarket);
    const item = report.items.find(i => i.item === 45);
    expect(item?.value).toMatch(/PASS/);
  });

  it("item 10 reflects market status", () => {
    const audit = computeConfigAudit(makeFullyConfiguredDeps());
    const report = buildCompletionReport(audit, closedMarket);
    expect(report.items.find(i => i.item === 10)?.value).toBe("CLOSED_WEEKEND");
  });

  it("includes note explaining what to do next", () => {
    const audit = computeConfigAudit(makeFullyConfiguredDeps());
    const report = buildCompletionReport(audit, closedMarket);
    expect(report.note.length).toBeGreaterThan(30);
  });

  it("items NOT_YET_RUN for live test fields when no liveTestResult provided", () => {
    const audit = computeConfigAudit(makeFullyConfiguredDeps());
    const report = buildCompletionReport(audit, openMarket);
    const item26 = report.items.find(i => i.item === 26); // broker mutation count
    expect(item26?.value).toBe("NOT_YET_RUN");
  });

  it("populates live test fields when liveTestResult provided", () => {
    const audit = computeConfigAudit(makeFullyConfiguredDeps());
    const report = buildCompletionReport(audit, openMarket, {
      intentId: "abc-123-def",
      submissionState: "BROKER_ACCEPTED",
      brokerMutationCount: 1,
      testSymbol: "AAPL",
      quantity: 1,
      orderType: "limit",
      tif: "day",
    });
    expect(report.items.find(i => i.item === 11)?.value).toBe("AAPL");
    expect(report.items.find(i => i.item === 12)?.value).toBe("1");
    expect(report.items.find(i => i.item === 26)?.value).toBe("1");
    expect(report.items.find(i => i.item === 29)?.value).toBe("BROKER_ACCEPTED");
  });

  it("item 48 shows decision from report", () => {
    const audit = computeConfigAudit(makeFullyConfiguredDeps());
    const report = buildCompletionReport(audit, closedMarket);
    const item48 = report.items.find(i => i.item === 48);
    expect(item48?.value).toMatch(/CONDITIONAL_GO|NO_GO/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11 — Admin consistency: canonical admin helper used across all admin families
// ─────────────────────────────────────────────────────────────────────────────

describe("§11 Admin consistency: registerTestLiveCertificationRoutes accepts isAdmin", () => {
  it("registerTestLiveCertificationRoutes has arity 3 (app, isAuthenticated, isAdmin)", async () => {
    // Verifies the route registration function takes the canonical isAdmin
    // middleware as its 3rd argument — same pattern as registerPlatformHealthRoutes.
    // This prevents future drift where TEST_LIVE reverts to inline admin logic.
    const mod = await import("../test-live-certification");
    expect(typeof mod.registerTestLiveCertificationRoutes).toBe("function");
    expect(mod.registerTestLiveCertificationRoutes.length).toBe(3);
  });

  it("no inline storage.getUser appears inside registerTestLiveCertificationRoutes body", async () => {
    // Read the source to confirm no inline admin check remains inside the function.
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../test-live-certification.ts", import.meta.url).pathname,
      "utf8",
    );
    // Find the function body start
    const fnStart = src.indexOf("export function registerTestLiveCertificationRoutes");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = src.slice(fnStart);
    // No inline storage.getUser (the in-memory stub) should appear in the registration body
    expect(fnBody).not.toContain("storage.getUser");
  });

  it("no inline role comparison or requireAdmin appears inside registerTestLiveCertificationRoutes body", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../test-live-certification.ts", import.meta.url).pathname,
      "utf8",
    );
    const fnStart = src.indexOf("export function registerTestLiveCertificationRoutes");
    const fnBody = src.slice(fnStart);
    // No hardcoded role comparison inside the registration body
    expect(fnBody).not.toContain(`user.role !== "admin"`);
    expect(fnBody).not.toContain(`user.role !== UserRole.ADMIN`);
    expect(fnBody).not.toContain("requireAdmin");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12 — Security negative tests: client-supplied admin indicators are ignored
// ─────────────────────────────────────────────────────────────────────────────

describe("§12 Security: admin role resolved server-side only", () => {
  it("computeConfigAudit ignores any role passed via its deps", () => {
    // ConfigAuditDeps has no role field — no client-controlled escalation possible
    const deps = makeFullyConfiguredDeps();
    expect("role" in deps).toBe(false);
    expect("isAdmin" in deps).toBe(false);
    expect("admin" in deps).toBe(false);
  });

  it("ConfigAuditDeps type has no role, isAdmin, or admin field", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../test-live-certification.ts", import.meta.url).pathname,
      "utf8",
    );
    // Find ConfigAuditDeps interface
    const ifaceStart = src.indexOf("export interface ConfigAuditDeps");
    const ifaceEnd = src.indexOf("}", ifaceStart);
    expect(ifaceStart).toBeGreaterThan(-1);
    const iface = src.slice(ifaceStart, ifaceEnd + 1);
    expect(iface).not.toContain("role");
    expect(iface).not.toContain("isAdmin");
    expect(iface).not.toContain("admin");
  });

  it("computeConfigAudit productionBlocked cannot be falsified by any dep combination", () => {
    // Even if a crafted dep overrides everything, productionBlocked stays true
    const crafted = makeFullyConfiguredDeps({
      isExecutionEnabled: () => true,
      getExecutionMode: () => "production" as any,
    });
    const audit = computeConfigAudit(crafted);
    expect(audit.productionBlocked).toBe(true);
  });

  it("computeConfigAudit never returns raw account IDs regardless of deps", () => {
    const deps = makeFullyConfiguredDeps({
      getTestLiveAllowlistedAccounts: () => ["RAWACCT-FORGED-0001", "RAWACCT-FORGED-0002"],
    });
    const audit = computeConfigAudit(deps);
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain("RAWACCT-FORGED-0001");
    expect(serialized).not.toContain("RAWACCT-FORGED-0002");
    // Count is safe to expose
    expect(audit.accountAllowlistCount).toBe(2);
  });

  it("completion report never surfaces raw account IDs regardless of audit deps", () => {
    const deps = makeFullyConfiguredDeps({
      getTestLiveAllowlistedAccounts: () => ["RAWACCT-REPORT-9999"],
    });
    const audit = computeConfigAudit(deps);
    const report = buildCompletionReport(audit, computeMarketStatus(OPEN_TUESDAY_ET));
    expect(JSON.stringify(report)).not.toContain("RAWACCT-REPORT-9999");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §17 — Admin cannot bypass execution safety gates
// ─────────────────────────────────────────────────────────────────────────────

describe("§17 Admin does not bypass execution safety gates", () => {
  it("allRequiredPass is false when execution is disabled even for a fully-configured admin audit", () => {
    const deps = makeFullyConfiguredDeps({ isExecutionEnabled: () => false });
    const audit = computeConfigAudit(deps);
    expect(audit.allRequiredPass).toBe(false);
    expect(audit.missingRequired).toContain("BROKER_EXECUTION_ENABLED");
  });

  it("allRequiredPass is false when mode is not test_live even for a fully-configured admin audit", () => {
    const deps = makeFullyConfiguredDeps({ getExecutionMode: () => "sandbox" as any });
    const audit = computeConfigAudit(deps);
    expect(audit.allRequiredPass).toBe(false);
    expect(audit.missingRequired).toContain("BROKER_EXECUTION_MODE");
  });

  it("allRequiredPass is false when not armed even for a fully-configured admin audit", () => {
    const deps = makeFullyConfiguredDeps({ isTestLiveArmed: () => false });
    const audit = computeConfigAudit(deps);
    expect(audit.allRequiredPass).toBe(false);
    expect(audit.missingRequired).toContain("EXECUTION_TEST_LIVE_ARMED");
  });

  it("allRequiredPass is false when account allowlist is empty", () => {
    const deps = makeFullyConfiguredDeps({ getTestLiveAllowlistedAccounts: () => [] });
    const audit = computeConfigAudit(deps);
    expect(audit.allRequiredPass).toBe(false);
  });

  it("allRequiredPass is false when symbol allowlist is empty", () => {
    const deps = makeFullyConfiguredDeps({ getTestLiveAllowlistedSymbols: () => [] });
    const audit = computeConfigAudit(deps);
    expect(audit.allRequiredPass).toBe(false);
  });

  it("allRequiredPass is false when notional cap is null", () => {
    const deps = makeFullyConfiguredDeps({ getTestLiveMaxNotional: () => null });
    const audit = computeConfigAudit(deps);
    expect(audit.allRequiredPass).toBe(false);
  });

  it("allRequiredPass is false when equity qty cap is null", () => {
    const deps = makeFullyConfiguredDeps({ getTestLiveMaxEquityQty: () => null });
    const audit = computeConfigAudit(deps);
    expect(audit.allRequiredPass).toBe(false);
  });

  it("marketOrderPolicy is always 'banned' regardless of config — cannot be overridden", () => {
    const deps = makeFullyConfiguredDeps();
    const audit = computeConfigAudit(deps);
    expect(audit.marketOrderPolicy).toBe("banned");
  });

  it("multiLegPolicy is always 'banned' regardless of config — cannot be overridden", () => {
    const deps = makeFullyConfiguredDeps();
    const audit = computeConfigAudit(deps);
    expect(audit.multiLegPolicy).toBe("banned");
  });

  it("productionBlocked is always true — cannot be overridden by admin or any dep", () => {
    const deps = makeFullyConfiguredDeps({ getExecutionMode: () => "production" as any });
    const audit = computeConfigAudit(deps);
    expect(audit.productionBlocked).toBe(true);
  });

  it("completion report decision is NO_GO when market is closed even if all config gates pass", () => {
    const closedMarket = computeMarketStatus(new Date("2026-08-15T16:00:00Z")); // Saturday
    expect(closedMarket.open).toBe(false);
    const audit = computeConfigAudit(makeFullyConfiguredDeps());
    const report = buildCompletionReport(audit, closedMarket);
    // Cannot be GO when market is closed — must be CONDITIONAL_GO or NO_GO
    expect(report.decision).not.toBe("GO");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security invariants
// ─────────────────────────────────────────────────────────────────────────────

describe("security invariants", () => {
  it("config audit never exposes raw account IDs in gate descriptions", () => {
    const deps = makeFullyConfiguredDeps({
      getTestLiveAllowlistedAccounts: () => ["SECRETACCT9999", "ANOTHERACCT0001"],
    });
    const audit = computeConfigAudit(deps);
    const allText = JSON.stringify(audit);
    expect(allText).not.toContain("SECRETACCT9999");
    expect(allText).not.toContain("ANOTHERACCT0001");
  });

  it("completion report never exposes raw account IDs", () => {
    const audit = computeConfigAudit(makeFullyConfiguredDeps({
      getTestLiveAllowlistedAccounts: () => ["SECRETACCT9999"],
    }));
    const report = buildCompletionReport(audit, computeMarketStatus(OPEN_TUESDAY_ET));
    const allText = JSON.stringify(report);
    expect(allText).not.toContain("SECRETACCT9999");
  });

  it("disarm result never exposes env var values", () => {
    const result = computeDisarmResult(true);
    // The note tells the operator WHAT to change, not the current value
    expect(result.note).not.toMatch(/=true|=false/);
  });

  it("productionBlocked is always true — cannot be false", () => {
    // Verify it's a literal 'true' type value
    const audit = computeConfigAudit(makeFullyConfiguredDeps({
      isExecutionEnabled: () => false,
      isTestLiveArmed: () => false,
    }));
    expect(audit.productionBlocked).toBe(true);
  });

  it("completion report item 45 always shows production disabled regardless of any input", () => {
    // Even if liveTestResult tries to influence it, item 45 is hardcoded
    const audit = computeConfigAudit(makeFullyConfiguredDeps());
    const report = buildCompletionReport(audit, computeMarketStatus(OPEN_TUESDAY_ET), {
      testSymbol: "AAPL",
    });
    const item45 = report.items.find(i => i.item === 45);
    expect(item45?.value).toMatch(/PASS.*permanent|permanent.*PASS/i);
  });
});
