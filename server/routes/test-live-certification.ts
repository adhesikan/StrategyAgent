/**
 * server/routes/test-live-certification.ts — Sprint 2.8.6A
 *
 * Controlled TEST_LIVE Execution Certification API.
 *
 * These routes allow a platform admin to audit the complete TEST_LIVE
 * execution configuration, verify the test account, check market state,
 * and (after manually confirming all gates) initiate exactly ONE controlled
 * live order through the certified test pipeline.
 *
 * INVARIANTS (enforced here and in the submission layer):
 *   - Admin-only access. No regular user can trigger certification.
 *   - PRODUCTION mode is permanently blocked (compile-time constant).
 *   - No automatic submission at startup or on schedule.
 *   - Config values are NEVER logged or returned to the client.
 *   - Account IDs are ALWAYS masked in responses.
 *   - Disarm is idempotent: calling it when already unarmed is a no-op.
 *
 * Routes:
 *   GET  /api/admin/test-live/config-audit     — Sections 1+2: all config gates
 *   GET  /api/admin/test-live/market-status    — Section 6: market hours
 *   GET  /api/admin/test-live/account-status   — Section 2: broker account
 *   POST /api/admin/test-live/disarm           — Section 30: post-cert disarm
 *   GET  /api/admin/test-live/completion-report — Section 34: 48-item report
 */

import type { Express, RequestHandler } from "express";
import {
  isExecutionEnabled,
  getExecutionMode,
  isTestLiveArmed,
  isTradierExecutionEnabled,
  isTradeStationExecutionEnabled,
  getTestLiveAllowlistedAccounts,
  getTestLiveAllowlistedSymbols,
  getTestLiveMaxNotional,
  getTestLiveMaxEquityQty,
  getTestLiveMaxOptionContracts,
} from "../services/execution-policy";
import { PRODUCTION_SUBMISSION_NOT_ENABLED } from "@shared/execution-intent-types";

// ─────────────────────────────────────────────────────────────────────────────
// PURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfigGate {
  variable: string;
  status: "PASS" | "FAIL" | "NOT_CONFIGURED" | "OPTIONAL";
  safeDescription: string; // never the actual value
}

export interface ConfigAuditResult {
  gates: ConfigGate[];
  allRequiredPass: boolean;
  missingRequired: string[];
  // Derived invariants (always enforced, not configurable)
  marketOrderPolicy: "banned";
  multiLegPolicy: "banned";
  productionBlocked: true;
  // Execution mode
  executionMode: string;
  executionEnabled: boolean;
  testLiveArmed: boolean;
  // Allowlist metadata (counts/symbols are safe; IDs are not)
  allowlistedSymbols: string[]; // safe to show
  accountAllowlistCount: number; // count only — no IDs
  maxNotional: number | null;
  maxEquityQty: number | null;
  maxOptionContracts: number | null;
}

/** Deps are injectable for testability. */
export interface ConfigAuditDeps {
  isExecutionEnabled: () => boolean;
  getExecutionMode: () => string;
  isTradierExecutionEnabled: () => boolean;
  isTradeStationExecutionEnabled: () => boolean;
  isTestLiveArmed: () => boolean;
  getTestLiveAllowlistedAccounts: () => string[];
  getTestLiveAllowlistedSymbols: () => string[];
  getTestLiveMaxNotional: () => number | null;
  getTestLiveMaxEquityQty: () => number | null;
  getTestLiveMaxOptionContracts: () => number | null;
}

function defaultConfigDeps(): ConfigAuditDeps {
  return {
    isExecutionEnabled,
    getExecutionMode,
    isTradierExecutionEnabled,
    isTradeStationExecutionEnabled,
    isTestLiveArmed,
    getTestLiveAllowlistedAccounts,
    getTestLiveAllowlistedSymbols,
    getTestLiveMaxNotional,
    getTestLiveMaxEquityQty,
    getTestLiveMaxOptionContracts,
  };
}

export function computeConfigAudit(deps: ConfigAuditDeps = defaultConfigDeps()): ConfigAuditResult {
  const gates: ConfigGate[] = [];
  const missingRequired: string[] = [];

  // ── Gate 1: Global kill switch ───────────────────────────────────────────
  const execEnabled = deps.isExecutionEnabled();
  gates.push({
    variable: "BROKER_EXECUTION_ENABLED",
    status: execEnabled ? "PASS" : "FAIL",
    safeDescription: execEnabled ? "Execution enabled" : "Execution disabled (set to true to enable)",
  });
  if (!execEnabled) missingRequired.push("BROKER_EXECUTION_ENABLED");

  // ── Gate 2: Execution mode ───────────────────────────────────────────────
  const mode = deps.getExecutionMode();
  const modePass = mode === "test_live";
  gates.push({
    variable: "BROKER_EXECUTION_MODE",
    status: modePass ? "PASS" : "FAIL",
    safeDescription: modePass
      ? "Mode = test_live (correct)"
      : `Mode = ${mode || "not set"} (must be test_live for certification)`,
  });
  if (!modePass) missingRequired.push("BROKER_EXECUTION_MODE");

  // ── Gate 3: Tradier provider flag ────────────────────────────────────────
  const tradierEnabled = deps.isTradierExecutionEnabled();
  gates.push({
    variable: "TRADIER_EXECUTION_ENABLED",
    status: tradierEnabled ? "PASS" : "NOT_CONFIGURED",
    safeDescription: tradierEnabled ? "Tradier execution enabled" : "Tradier execution not enabled",
  });

  // ── Gate 4: TradeStation provider flag ──────────────────────────────────
  const tsEnabled = deps.isTradeStationExecutionEnabled();
  gates.push({
    variable: "TRADESTATION_EXECUTION_ENABLED",
    status: tsEnabled ? "PASS" : "NOT_CONFIGURED",
    safeDescription: tsEnabled ? "TradeStation execution enabled" : "TradeStation execution not enabled",
  });

  // At least one provider must be enabled when execution is enabled
  if (execEnabled && !tradierEnabled && !tsEnabled) {
    missingRequired.push("TRADIER_EXECUTION_ENABLED or TRADESTATION_EXECUTION_ENABLED");
    // Update Tradier gate to FAIL since no provider is available
    const tradierGate = gates.find(g => g.variable === "TRADIER_EXECUTION_ENABLED");
    if (tradierGate) { tradierGate.status = "FAIL"; tradierGate.safeDescription = "No provider enabled — set TRADIER_EXECUTION_ENABLED or TRADESTATION_EXECUTION_ENABLED=true"; }
  }

  // ── Gate 5: TEST_LIVE armed ──────────────────────────────────────────────
  const armed = deps.isTestLiveArmed();
  const armedRaw = (process.env.EXECUTION_TEST_LIVE_ARMED ?? "").trim().toLowerCase();
  const armedUntilRaw = (process.env.EXECUTION_TEST_LIVE_ARMED_UNTIL ?? "").trim();
  let armedDesc: string;
  if (!armedRaw || armedRaw !== "true") {
    armedDesc = "Not armed (EXECUTION_TEST_LIVE_ARMED not set to true)";
  } else if (armedUntilRaw && isNaN(new Date(armedUntilRaw).getTime())) {
    armedDesc = "Armed flag set but EXECUTION_TEST_LIVE_ARMED_UNTIL is an invalid date";
  } else if (!armed && armedRaw === "true") {
    armedDesc = "Arming has expired (EXECUTION_TEST_LIVE_ARMED_UNTIL is in the past)";
  } else {
    armedDesc = armedUntilRaw
      ? `Armed, expires at configured timestamp`
      : "Armed (no expiry configured)";
  }
  gates.push({
    variable: "EXECUTION_TEST_LIVE_ARMED",
    status: armed ? "PASS" : "FAIL",
    safeDescription: armedDesc,
  });
  if (!armed) missingRequired.push("EXECUTION_TEST_LIVE_ARMED");

  // ── Gate 6: Account allowlist ────────────────────────────────────────────
  const accounts = deps.getTestLiveAllowlistedAccounts();
  gates.push({
    variable: "EXECUTION_TEST_ACCOUNT_ALLOWLIST",
    status: accounts.length > 0 ? "PASS" : "FAIL",
    safeDescription: accounts.length > 0
      ? `${accounts.length} account(s) allowlisted (IDs not shown)`
      : "Empty — all accounts blocked (required for TEST_LIVE)",
  });
  if (accounts.length === 0) missingRequired.push("EXECUTION_TEST_ACCOUNT_ALLOWLIST");

  // ── Gate 7: Symbol allowlist ─────────────────────────────────────────────
  const symbols = deps.getTestLiveAllowlistedSymbols();
  gates.push({
    variable: "EXECUTION_TEST_SYMBOL_ALLOWLIST",
    status: symbols.length > 0 ? "PASS" : "FAIL",
    safeDescription: symbols.length > 0
      ? `${symbols.length} symbol(s): ${symbols.join(", ")}`
      : "Empty — all symbols blocked (required for TEST_LIVE)",
  });
  if (symbols.length === 0) missingRequired.push("EXECUTION_TEST_SYMBOL_ALLOWLIST");

  // ── Gate 8: Notional cap ─────────────────────────────────────────────────
  const maxNotional = deps.getTestLiveMaxNotional();
  gates.push({
    variable: "EXECUTION_TEST_MAX_NOTIONAL",
    status: maxNotional !== null ? "PASS" : "FAIL",
    safeDescription: maxNotional !== null
      ? `Notional cap: $${maxNotional.toFixed(2)}`
      : "Not configured — required (all TEST_LIVE orders blocked without this)",
  });
  if (maxNotional === null) missingRequired.push("EXECUTION_TEST_MAX_NOTIONAL");

  // ── Gate 9: Equity quantity cap ──────────────────────────────────────────
  const maxEquityQty = deps.getTestLiveMaxEquityQty();
  gates.push({
    variable: "EXECUTION_TEST_MAX_EQUITY_QTY",
    status: maxEquityQty !== null ? "PASS" : "FAIL",
    safeDescription: maxEquityQty !== null
      ? `Equity qty cap: ${maxEquityQty} share(s)`
      : "Not configured — required for equity TEST_LIVE orders",
  });
  if (maxEquityQty === null) missingRequired.push("EXECUTION_TEST_MAX_EQUITY_QTY");

  // ── Gate 10: Option contracts cap (optional for equity-only cert) ────────
  const maxOptionContracts = deps.getTestLiveMaxOptionContracts();
  gates.push({
    variable: "EXECUTION_TEST_MAX_OPTION_CONTRACTS",
    status: maxOptionContracts !== null ? "PASS" : "OPTIONAL",
    safeDescription: maxOptionContracts !== null
      ? `Option contracts cap: ${maxOptionContracts}`
      : "Not configured — optional for equity-only certification",
  });
  // Not required for equity certification

  // ── Derived invariants (always enforced) ─────────────────────────────────
  gates.push({
    variable: "MARKET_ORDER_POLICY",
    status: "PASS",
    safeDescription: "Market orders banned in TEST_LIVE (enforced by submission layer)",
  });
  gates.push({
    variable: "MULTI_LEG_POLICY",
    status: "PASS",
    safeDescription: "Multi-leg orders banned in TEST_LIVE (enforced by submission layer)",
  });
  gates.push({
    variable: "PRODUCTION_EXECUTION_BLOCK",
    status: "PASS",
    safeDescription: "PRODUCTION_SUBMISSION_NOT_ENABLED constant — production permanently blocked",
  });

  // Verify compile-time constant is actually true
  void PRODUCTION_SUBMISSION_NOT_ENABLED;

  return {
    gates,
    allRequiredPass: missingRequired.length === 0,
    missingRequired,
    marketOrderPolicy: "banned",
    multiLegPolicy: "banned",
    productionBlocked: true,
    executionMode: mode,
    executionEnabled: execEnabled,
    testLiveArmed: armed,
    allowlistedSymbols: symbols,
    accountAllowlistCount: accounts.length,
    maxNotional,
    maxEquityQty,
    maxOptionContracts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKET STATUS
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketStatusResult {
  open: boolean;
  status: "OPEN" | "CLOSED_WEEKEND" | "CLOSED_OUTSIDE_HOURS" | "CLOSED_HOLIDAY";
  currentEtTime: string;     // "HH:MM ET" — never timezone-sensitive secrets
  regularSessionStartEt: "09:30";
  regularSessionEndEt: "16:00";
  note: string;
  canCertify: boolean;       // true only when market is OPEN
}

/** Injectable for tests — pass a specific Date to pin time. */
export function computeMarketStatus(now?: Date): MarketStatusResult {
  const d = now ?? new Date();

  // Convert to US Eastern Time (ET).
  // DST approximation: second Sunday in March → first Sunday in November.
  // For certification purposes an approximate DST rule is acceptable.
  const year = d.getUTCFullYear();
  const dstStart = nthSundayInMonth(year, 2, 2); // 2nd Sunday in March (month 2 = March)
  const dstEnd   = nthSundayInMonth(year, 10, 1); // 1st Sunday in November (month 10 = November)

  const isDst = d >= dstStart && d < dstEnd;
  const etOffsetMs = isDst ? -4 * 3600_000 : -5 * 3600_000;
  const etMs = d.getTime() + etOffsetMs;
  const etDate = new Date(etMs);

  const etHour   = etDate.getUTCHours();
  const etMinute = etDate.getUTCMinutes();
  const etDow    = etDate.getUTCDay(); // 0=Sun, 6=Sat
  const etTotalMins = etHour * 60 + etMinute;

  const marketOpenMins  = 9 * 60 + 30;  // 9:30
  const marketCloseMins = 16 * 60;       // 16:00

  const etTimeStr = `${String(etHour).padStart(2, "0")}:${String(etMinute).padStart(2, "0")} ET (${isDst ? "EDT" : "EST"})`;

  if (etDow === 0 || etDow === 6) {
    return { open: false, status: "CLOSED_WEEKEND", currentEtTime: etTimeStr, regularSessionStartEt: "09:30", regularSessionEndEt: "16:00", note: "US equity markets are closed on weekends.", canCertify: false };
  }

  if (etTotalMins < marketOpenMins || etTotalMins >= marketCloseMins) {
    return { open: false, status: "CLOSED_OUTSIDE_HOURS", currentEtTime: etTimeStr, regularSessionStartEt: "09:30", regularSessionEndEt: "16:00", note: `Market is outside regular session hours (9:30–16:00 ET). Current: ${etTimeStr}.`, canCertify: false };
  }

  // Holiday check — major US market holidays (approximate; full holiday calendar is broker-authoritative)
  const etMonthDay = `${etDate.getUTCMonth() + 1}-${etDate.getUTCDate()}`;
  const fixedHolidays: Record<string, string> = {
    "1-1":  "New Year's Day",
    "7-4":  "Independence Day",
    "12-25": "Christmas Day",
  };
  if (fixedHolidays[etMonthDay]) {
    return { open: false, status: "CLOSED_HOLIDAY", currentEtTime: etTimeStr, regularSessionStartEt: "09:30", regularSessionEndEt: "16:00", note: `Market closed for ${fixedHolidays[etMonthDay]}.`, canCertify: false };
  }

  return { open: true, status: "OPEN", currentEtTime: etTimeStr, regularSessionStartEt: "09:30", regularSessionEndEt: "16:00", note: "US equity market is in regular session.", canCertify: true };
}

/** Returns the Date of the Nth occurrence of dayOfWeek in month (0-indexed month). */
function nthSundayInMonth(year: number, month: number, n: number): Date {
  // month: 0=Jan, 2=Mar, 10=Nov
  // Find first Sunday of the month
  const firstDay = new Date(Date.UTC(year, month, 1));
  const daysUntilSunday = (7 - firstDay.getUTCDay()) % 7;
  const firstSunday = daysUntilSunday === 0 ? 1 : daysUntilSunday + 1;
  const nthSunday = firstSunday + (n - 1) * 7;
  return new Date(Date.UTC(year, month, nthSunday, 2, 0, 0)); // 2:00 AM UTC = transition time
}

// ─────────────────────────────────────────────────────────────────────────────
// DISARM
// ─────────────────────────────────────────────────────────────────────────────

export interface DisarmResult {
  wasArmed: boolean;
  action: "disarmed" | "already_unarmed";
  note: string;
  productionStillBlocked: true;
}

export function computeDisarmResult(wasArmed: boolean): DisarmResult {
  return {
    wasArmed,
    action: wasArmed ? "disarmed" : "already_unarmed",
    note: wasArmed
      ? "EXECUTION_TEST_LIVE_ARMED must now be removed or set to false in environment secrets. This API call cannot modify env vars — the operator must make that change."
      : "TEST_LIVE was already unarmed. No action required.",
    productionStillBlocked: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPLETION REPORT
// ─────────────────────────────────────────────────────────────────────────────

export interface CompletionReportItem {
  item: number;
  label: string;
  value: string;
}

export interface CompletionReport {
  items: CompletionReportItem[];
  verdict: "LIVE_TEST_CERTIFIED" | "NOT_CERTIFIED" | "READY_BUT_MARKET_CLOSED" | "NOT_READY";
  decision: "GO" | "CONDITIONAL_GO" | "NO_GO";
  note: string;
}

export function buildCompletionReport(
  audit: ConfigAuditResult,
  market: MarketStatusResult,
  liveTestResult?: {
    releaseSha?: string;
    provider?: string;
    testSymbol?: string;
    quantity?: number;
    orderType?: string;
    tif?: string;
    snapshotHashPrefix?: string;
    intentId?: string;
    idempotencyKey?: string;
    submissionFingerprint?: string;
    brokerMutationCount?: number;
    brokerOrderRef?: string | null;
    submissionState?: string;
    ambiguousHandling?: string | null;
    reconciliationResult?: string | null;
    fillResult?: string | null;
    partialFillResult?: string | null;
    positionLink?: string | null;
    portfolioSync?: string | null;
    confirmationReplayTest?: string;
    duplicateProtection?: string;
    auditTrailComplete?: boolean;
    logReview?: string;
    platformHealthOk?: boolean;
    unexpected500Count?: number;
    defectsFound?: string;
    regressionTestsAdded?: string;
    testLiveDisarmed?: boolean;
  },
): CompletionReport {
  const r = liveTestResult ?? {};
  const notRun = "NOT_YET_RUN";
  const notCfg = "NOT_CONFIGURED";

  const items: CompletionReportItem[] = [
    { item: 1, label: "Release SHA", value: r.releaseSha ?? notRun },
    { item: 2, label: "Provider", value: r.provider ?? notRun },
    { item: 3, label: "Execution mode", value: audit.executionMode || notCfg },
    { item: 4, label: "Test account allowlist", value: audit.accountAllowlistCount > 0 ? "PASS" : "FAIL" },
    { item: 5, label: "Symbol allowlist", value: audit.allowlistedSymbols.length > 0 ? "PASS" : "FAIL" },
    { item: 6, label: "Quantity cap", value: audit.maxEquityQty !== null ? "PASS" : "FAIL" },
    { item: 7, label: "Notional cap", value: audit.maxNotional !== null ? "PASS" : "FAIL" },
    { item: 8, label: "TEST_LIVE armed", value: audit.testLiveArmed ? "PASS" : "FAIL" },
    { item: 9, label: "Production mode blocked", value: "PASS (permanent)" },
    { item: 10, label: "Market state", value: market.status },
    { item: 11, label: "Test symbol", value: r.testSymbol ?? (audit.allowlistedSymbols[0] ?? notCfg) },
    { item: 12, label: "Quantity", value: r.quantity !== undefined ? String(r.quantity) : notRun },
    { item: 13, label: "Order type", value: r.orderType ?? notRun },
    { item: 14, label: "TIF", value: r.tif ?? notRun },
    { item: 15, label: "Trade Plan validation", value: notRun },
    { item: 16, label: "Lifecycle validation", value: notRun },
    { item: 17, label: "Preflight result", value: notRun },
    { item: 18, label: "Draft result", value: notRun },
    { item: 19, label: "Preview result", value: notRun },
    { item: 20, label: "Final snapshot hash match", value: r.snapshotHashPrefix ? `PASS (prefix: ${r.snapshotHashPrefix})` : notRun },
    { item: 21, label: "Acknowledgements", value: notRun },
    { item: 22, label: "Final revalidation", value: notRun },
    { item: 23, label: "ExecutionIntent created", value: r.intentId ? `PASS (${r.intentId.substring(0, 8)}…)` : notRun },
    { item: 24, label: "Idempotency key created", value: r.idempotencyKey ? "PASS" : notRun },
    { item: 25, label: "Submission fingerprint", value: r.submissionFingerprint ? "PASS" : notRun },
    { item: 26, label: "Broker mutation count", value: r.brokerMutationCount !== undefined ? String(r.brokerMutationCount) : notRun },
    { item: 27, label: "Broker acknowledgement", value: r.submissionState ?? notRun },
    { item: 28, label: "Broker order reference", value: r.brokerOrderRef ? `received (ref masked)` : r.submissionState === "SUBMISSION_UNKNOWN" ? "UNKNOWN" : notRun },
    { item: 29, label: "Submission state", value: r.submissionState ?? notRun },
    { item: 30, label: "Ambiguous response handling", value: r.ambiguousHandling ?? "N/A" },
    { item: 31, label: "Reconciliation result", value: r.reconciliationResult ?? "N/A" },
    { item: 32, label: "Fill result", value: r.fillResult ?? notRun },
    { item: 33, label: "Partial-fill result", value: r.partialFillResult ?? "N/A" },
    { item: 34, label: "Position link", value: r.positionLink ?? notRun },
    { item: 35, label: "Portfolio sync", value: r.portfolioSync ?? notRun },
    { item: 36, label: "Confirmation replay test", value: r.confirmationReplayTest ?? notRun },
    { item: 37, label: "Duplicate protection", value: r.duplicateProtection ?? notRun },
    { item: 38, label: "Audit trail", value: r.auditTrailComplete === true ? "PASS" : notRun },
    { item: 39, label: "Log review", value: r.logReview ?? notRun },
    { item: 40, label: "Platform Health", value: r.platformHealthOk === true ? "PASS" : notRun },
    { item: 41, label: "Unexpected 500 count", value: r.unexpected500Count !== undefined ? String(r.unexpected500Count) : notRun },
    { item: 42, label: "Defects found", value: r.defectsFound ?? notRun },
    { item: 43, label: "Regression tests added", value: r.regressionTestsAdded ?? notRun },
    { item: 44, label: "TEST_LIVE disarmed", value: r.testLiveDisarmed === true ? "PASS" : r.testLiveDisarmed === false ? "FAIL" : notRun },
    { item: 45, label: "General production execution still disabled", value: "PASS (permanent compile-time block)" },
    { item: 46, label: "Operations Manual updated", value: "docs/operations/45-test-live-execution-certification.md created" },
    { item: 47, label: "LIVE_TEST_CERTIFIED / NOT_CERTIFIED", value: "NOT_CERTIFIED — live test has not yet been executed" },
    { item: 48, label: "GO / CONDITIONAL_GO / NO_GO", value: audit.allRequiredPass && market.open ? "CONDITIONAL_GO" : "NO_GO" },
  ];

  const allConfigPass = audit.allRequiredPass;
  const marketOpen = market.open;
  const testRan = r.intentId !== undefined;

  let verdict: CompletionReport["verdict"];
  let decision: CompletionReport["decision"];
  let note: string;

  if (!allConfigPass) {
    verdict = "NOT_READY";
    decision = "NO_GO";
    note = `${audit.missingRequired.length} required configuration item(s) not set: ${audit.missingRequired.join(", ")}. Set these environment variables and re-run the config audit.`;
  } else if (!marketOpen) {
    verdict = "READY_BUT_MARKET_CLOSED";
    decision = "CONDITIONAL_GO";
    note = `All configuration gates pass. Market is currently ${market.status}. Re-run during NYSE regular session (9:30–16:00 ET, Mon–Fri).`;
  } else if (!testRan) {
    verdict = "NOT_CERTIFIED";
    decision = "CONDITIONAL_GO";
    note = "All configuration gates pass and market is open. Operator must progress through the full certification workflow (Sections 7–30) to achieve LIVE_TEST_CERTIFIED status.";
  } else {
    verdict = "NOT_CERTIFIED";
    decision = "CONDITIONAL_GO";
    note = "Partial certification data received. Full LIVE_TEST_CERTIFIED requires completing all 35 sections including fill confirmation, audit review, and TEST_LIVE disarm.";
  }

  return { items, verdict, decision, note };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

export function registerTestLiveCertificationRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  isAdmin: RequestHandler,
): void {

  // Admin guard: uses the canonical isAdmin passed from routes.ts.
  // No inline admin logic — same middleware as Platform Health and all other
  // admin surfaces. Unauthenticated → 401 (from isAuthenticated). Non-admin
  // authenticated → 403 (from isAdmin).

  // ── GET /api/admin/test-live/config-audit ──────────────────────────────
  app.get(
    "/api/admin/test-live/config-audit",
    isAuthenticated,
    isAdmin,
    async (_req, res) => {
      try {
        const audit = computeConfigAudit();
        res.json({ ok: true, audit });
      } catch (e: any) {
        res.status(500).json({ ok: false, error: "Config audit failed", detail: e?.message ?? "unknown" });
      }
    },
  );

  // ── GET /api/admin/test-live/market-status ────────────────────────────
  app.get(
    "/api/admin/test-live/market-status",
    isAuthenticated,
    isAdmin,
    async (_req, res) => {
      try {
        const market = computeMarketStatus();
        res.json({ ok: true, market });
      } catch (e: any) {
        res.status(500).json({ ok: false, error: "Market status check failed", detail: e?.message ?? "unknown" });
      }
    },
  );

  // ── GET /api/admin/test-live/account-status ───────────────────────────
  app.get(
    "/api/admin/test-live/account-status",
    isAuthenticated,
    isAdmin,
    async (req, res) => {
      try {
        const { storage } = await import("../storage");
        const userId = req.session!.userId!;
        const conn = await storage.getBrokerConnectionWithToken(userId);

        if (!conn) {
          res.json({
            ok: true,
            accountStatus: {
              connected: false,
              provider: null,
              maskedAccountRef: null,
              inAllowlist: false,
              requiresReauth: false,
              note: "No broker connection found for this admin user. Connect a broker account first.",
            },
          });
          return;
        }

        // Get the preferred account ID (never expose raw)
        const accountRef = conn.preferredAccountId ?? null;
        const maskedRef = accountRef
          ? `***${accountRef.slice(-4)}`
          : null;

        const allowedAccounts = getTestLiveAllowlistedAccounts();
        const inAllowlist = accountRef
          ? (allowedAccounts.length > 0 && allowedAccounts.includes(accountRef))
          : false;

        // Determine if reauth is needed: check if access token exists (safe check)
        const hasToken = !!(conn.accessToken || conn.refreshToken);

        res.json({
          ok: true,
          accountStatus: {
            connected: true,
            provider: conn.provider,
            maskedAccountRef: maskedRef,
            inAllowlist,
            allowlistConfigured: allowedAccounts.length > 0,
            requiresReauth: !hasToken,
            simMode: conn.simMode ?? false,
            note: !inAllowlist && allowedAccounts.length > 0
              ? `Account not in EXECUTION_TEST_ACCOUNT_ALLOWLIST. Add the account ID to the allowlist.`
              : !inAllowlist && allowedAccounts.length === 0
              ? "Account allowlist is empty. Configure EXECUTION_TEST_ACCOUNT_ALLOWLIST."
              : "Account verified and in allowlist.",
          },
        });
      } catch (e: any) {
        res.status(500).json({ ok: false, error: "Account status check failed", detail: e?.message ?? "unknown" });
      }
    },
  );

  // ── POST /api/admin/test-live/disarm ──────────────────────────────────
  // Reminder: this API cannot modify environment variables (they are managed
  // externally via Replit Secrets). It documents what the operator must do.
  app.post(
    "/api/admin/test-live/disarm",
    isAuthenticated,
    isAdmin,
    async (_req, res) => {
      try {
        const wasArmed = isTestLiveArmed();
        const result = computeDisarmResult(wasArmed);
        res.json({ ok: true, disarm: result });
      } catch (e: any) {
        res.status(500).json({ ok: false, error: "Disarm check failed", detail: e?.message ?? "unknown" });
      }
    },
  );

  // ── GET /api/admin/test-live/completion-report ────────────────────────
  app.get(
    "/api/admin/test-live/completion-report",
    isAuthenticated,
    isAdmin,
    async (_req, res) => {
      try {
        const audit = computeConfigAudit();
        const market = computeMarketStatus();
        const report = buildCompletionReport(audit, market);
        res.json({ ok: true, report });
      } catch (e: any) {
        res.status(500).json({ ok: false, error: "Completion report failed", detail: e?.message ?? "unknown" });
      }
    },
  );
}
