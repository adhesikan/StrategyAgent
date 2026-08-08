/**
 * Broker Synchronization — Sprint 2.4.2
 *
 * Pure structural tests. No DB, no network, no JSDOM required.
 * Covers all 15 spec parts.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// File sources
const syncServiceSrc = fs.readFileSync(
  path.join(__dirname, "../../services/broker-sync-service.ts"), "utf-8",
);
const syncRoutesSrc = fs.readFileSync(
  path.join(__dirname, "../broker-sync.ts"), "utf-8",
);
const connectPageSrc = fs.readFileSync(
  path.join(__dirname, "../../../client/src/pages/portfolio-connect.tsx"), "utf-8",
);
const jobStoreSrc = fs.readFileSync(
  path.join(__dirname, "../../services/job-status-store.ts"), "utf-8",
);
const platformHealthSrc = fs.readFileSync(
  path.join(__dirname, "../platform-health.ts"), "utf-8",
);
const adminHealthPageSrc = fs.readFileSync(
  path.join(__dirname, "../../../client/src/pages/admin-platform-health.tsx"), "utf-8",
);
const portfolioPageSrc = fs.readFileSync(
  path.join(__dirname, "../../../client/src/pages/portfolio.tsx"), "utf-8",
);
const appSrc = fs.readFileSync(
  path.join(__dirname, "../../../client/src/App.tsx"), "utf-8",
);
const routesSrc = fs.readFileSync(
  path.join(__dirname, "../../routes.ts"), "utf-8",
);

// ---------------------------------------------------------------------------
// Part 1 — Portfolio Source Model
// ---------------------------------------------------------------------------

describe("Part 1 — Portfolio Source Model", () => {
  it("portfolioSourceTypeEnum includes 'broker'", () => {
    const schemaSrc = fs.readFileSync(
      path.join(__dirname, "../../../shared/schema.ts"), "utf-8",
    );
    expect(schemaSrc).toContain('"broker"');
  });

  it("portfolio.tsx sourceLabel has an entry for 'broker'", () => {
    expect(portfolioPageSrc).toContain("broker:");
  });

  it("portfolio.tsx sourceLabel labels 'broker' correctly", () => {
    expect(portfolioPageSrc).toContain("Broker");
  });

  it("portfolio.tsx sourceBadgeVariant handles 'broker' distinctly", () => {
    expect(portfolioPageSrc).toContain('t === "broker"');
  });

  it("portfolio.tsx tooltip explains broker source type", () => {
    expect(portfolioPageSrc).toContain("Positions synced from a connected broker account");
  });

  it("portfolio.tsx source badge is rendered on portfolio cards", () => {
    expect(portfolioPageSrc).toContain("sourceLabel(portfolio.sourceType)");
    expect(portfolioPageSrc).toContain("sourceBadgeVariant(portfolio.sourceType)");
  });
});

// ---------------------------------------------------------------------------
// Part 2 — Broker Connection Center
// ---------------------------------------------------------------------------

describe("Part 2 — Broker Connection Center (/portfolio/connect)", () => {
  it("App.tsx registers /portfolio/connect route", () => {
    expect(appSrc).toContain("/portfolio/connect");
  });

  it("App.tsx imports PortfolioConnectPage", () => {
    expect(appSrc).toContain("PortfolioConnectPage");
  });

  it("portfolio-connect.tsx exists and exports default component", () => {
    expect(connectPageSrc).toContain("export default function PortfolioConnectPage");
  });

  it("page shows Tradier card", () => {
    expect(connectPageSrc).toContain("tradier");
    expect(connectPageSrc).toContain("Tradier");
  });

  it("page shows TradeStation card", () => {
    expect(connectPageSrc).toContain("tradestation");
    expect(connectPageSrc).toContain("TradeStation");
  });

  it("each card has a broker-card testid", () => {
    expect(connectPageSrc).toContain('data-testid={`broker-card-${def.provider}`}');
  });

  it("Connect / Import Holdings button present", () => {
    expect(connectPageSrc).toContain("Import Holdings");
    expect(connectPageSrc).toContain("btn-connect-");
  });

  it("Disconnect button present", () => {
    expect(connectPageSrc).toContain("Disconnect");
    expect(connectPageSrc).toContain("btn-disconnect-");
  });

  it("Last Sync displayed", () => {
    expect(connectPageSrc).toContain("Last Sync");
  });

  it("Connection Health panel present", () => {
    expect(connectPageSrc).toContain("Connection Health");
    expect(connectPageSrc).toContain("connection-health-panel");
  });

  it("Holdings Imported metric displayed", () => {
    expect(connectPageSrc).toContain("Holdings Imported");
  });

  it("NO API credentials rendered as values (no token/key exposed)", () => {
    const lower = connectPageSrc.toLowerCase();
    // Tokens must never be rendered as values
    expect(lower).not.toContain("accesstoken:");
    expect(lower).not.toContain("refreshtoken:");
    // Credential field labels (as JSX props/values) must not appear
    expect(lower).not.toContain("authorization:");
    // "API keys" may appear in a security notice ("No API keys are stored") — that is fine
    // What must NOT appear is an actual rendered API key value
    expect(lower).not.toContain('value="api_');
    expect(lower).not.toContain("apikey=");
  });

  it("portfolio.tsx Connect Broker button navigates to /portfolio/connect", () => {
    expect(portfolioPageSrc).toContain("/portfolio/connect");
    expect(portfolioPageSrc).toContain("btn-connect-broker");
  });

  it("coming-soon cards for future brokers present", () => {
    expect(connectPageSrc).toContain("Charles Schwab");
    expect(connectPageSrc).toContain("Fidelity");
    expect(connectPageSrc).toContain("IBKR");
    expect(connectPageSrc).toContain("Robinhood");
  });
});

// ---------------------------------------------------------------------------
// Part 3 — Synchronization Service
// ---------------------------------------------------------------------------

describe("Part 3 — Synchronization Service", () => {
  it("syncPortfolioFromBroker is exported", () => {
    expect(syncServiceSrc).toContain("export async function syncPortfolioFromBroker");
  });

  it("calls getBrokerPositions (reuses broker infrastructure)", () => {
    expect(syncServiceSrc).toContain("getBrokerPositions");
  });

  it("calls normalizePortfolioPositions (reuses canonical pipeline)", () => {
    expect(syncServiceSrc).toContain("normalizePortfolioPositions");
  });

  it("updates portfolio_positions via db", () => {
    expect(syncServiceSrc).toContain("portfolioPositions");
    expect(syncServiceSrc).toContain("db.delete");
    expect(syncServiceSrc).toContain("db.insert");
  });

  it("deletes before inserting — idempotent (no duplicates)", () => {
    const deleteIdx  = syncServiceSrc.indexOf("db.delete");
    const insertIdx  = syncServiceSrc.indexOf("db.insert");
    expect(deleteIdx).toBeLessThan(insertIdx);
  });

  it("updates portfolio updatedAt after sync", () => {
    expect(syncServiceSrc).toContain("updatedAt: new Date()");
  });

  it("tracks importedCount, updatedCount, deletedCount", () => {
    expect(syncServiceSrc).toContain("importedCount");
    expect(syncServiceSrc).toContain("updatedCount");
    expect(syncServiceSrc).toContain("deletedCount");
  });

  it("sourceType set to 'broker' for all inserted positions", () => {
    expect(syncServiceSrc).toContain('sourceType:      "broker" as const');
  });

  it("stores provider in sourceReference", () => {
    expect(syncServiceSrc).toContain("sourceReference: provider");
  });
});

// ---------------------------------------------------------------------------
// Part 4 — Sync Status
// ---------------------------------------------------------------------------

describe("Part 4 — Sync Status", () => {
  it("BrokerSyncStatus type includes all required states", () => {
    expect(syncServiceSrc).toContain('"idle"');
    expect(syncServiceSrc).toContain('"running"');
    expect(syncServiceSrc).toContain('"completed"');
    expect(syncServiceSrc).toContain('"failed"');
    expect(syncServiceSrc).toContain('"needs_reauth"');
  });

  it("PortfolioSyncState has all Part 4 fields", () => {
    expect(syncServiceSrc).toContain("startedAt");
    expect(syncServiceSrc).toContain("completedAt");
    expect(syncServiceSrc).toContain("durationMs");
    expect(syncServiceSrc).toContain("importedCount");
    expect(syncServiceSrc).toContain("updatedCount");
    expect(syncServiceSrc).toContain("deletedCount");
  });

  it("getPortfolioSyncState is exported", () => {
    expect(syncServiceSrc).toContain("export function getPortfolioSyncState");
  });

  it("sync status endpoint returns sync state", () => {
    expect(syncRoutesSrc).toContain("/api/portfolio/broker/sync/:portfolioId/status");
    expect(syncRoutesSrc).toContain("getPortfolioSyncState");
  });

  it("needs-reauth warning shown in client", () => {
    expect(connectPageSrc).toContain("needs_reauth");
    expect(connectPageSrc).toContain("needs-reauth-warning");
    expect(connectPageSrc).toContain("Reconnection required");
  });

  it("client shows Next Sync field", () => {
    expect(connectPageSrc).toContain("Next Sync");
  });

  it("client shows Duration field", () => {
    expect(connectPageSrc).toContain("Duration");
    expect(connectPageSrc).toContain("formatDuration");
  });
});

// ---------------------------------------------------------------------------
// Part 5 — Refresh (manual sync)
// ---------------------------------------------------------------------------

describe("Part 5 — Refresh Portfolio", () => {
  it("Refresh Portfolio button in client", () => {
    expect(connectPageSrc).toContain("Refresh Portfolio");
    expect(connectPageSrc).toContain("btn-sync-");
  });

  it("POST /api/portfolio/broker/sync/:portfolioId route exists", () => {
    expect(syncRoutesSrc).toContain("POST");
    expect(syncRoutesSrc).toContain("/api/portfolio/broker/sync/:portfolioId");
  });

  it("route returns 409 when sync already running", () => {
    expect(syncRoutesSrc).toContain("409");
    expect(syncRoutesSrc).toContain("isPortfolioSyncRunning");
    expect(syncRoutesSrc).toContain("Synchronization already in progress");
  });

  it("isPortfolioSyncRunning exported from service", () => {
    expect(syncServiceSrc).toContain("export function isPortfolioSyncRunning");
  });

  it("concurrent-sync guard uses runningSyncs Set", () => {
    expect(syncServiceSrc).toContain("runningSyncs");
    expect(syncServiceSrc).toContain("runningSyncs.has(portfolioId)");
    expect(syncServiceSrc).toContain("runningSyncs.add(portfolioId)");
    expect(syncServiceSrc).toContain("runningSyncs.delete(portfolioId)");
  });

  it("runningSyncs.delete in finally block", () => {
    expect(syncServiceSrc).toContain("} finally {");
    expect(syncServiceSrc).toContain("runningSyncs.delete(portfolioId)");
  });
});

// ---------------------------------------------------------------------------
// Part 6 — Background Sync Interface
// ---------------------------------------------------------------------------

describe("Part 6 — Background Sync Interface", () => {
  it("runBrokerSync(userId) exported", () => {
    expect(syncServiceSrc).toContain("export async function runBrokerSync");
  });

  it("runBrokerSync accepts userId parameter", () => {
    expect(syncServiceSrc).toContain("runBrokerSync(userId: string)");
  });

  it("runBrokerSync finds all broker portfolios for the user", () => {
    expect(syncServiceSrc).toContain('sourceType, "broker"');
  });

  it("runBrokerSync does not block (fire-and-forget per portfolio)", () => {
    expect(syncServiceSrc).toContain(".catch(");
  });

  it("no cron import in broker-sync-service (scheduler not yet wired)", () => {
    expect(syncServiceSrc).not.toContain("node-cron");
    expect(syncServiceSrc).not.toContain("cron.schedule");
  });
});

// ---------------------------------------------------------------------------
// Part 7 — Admin Platform Health
// ---------------------------------------------------------------------------

describe("Part 7 — Admin Platform Health — Broker Sync card", () => {
  it("checkBrokerSync function in platform-health.ts", () => {
    expect(platformHealthSrc).toContain("checkBrokerSync");
  });

  it("getBrokerSyncHealth imported from broker-sync-service", () => {
    expect(platformHealthSrc).toContain("getBrokerSyncHealth");
    expect(platformHealthSrc).toContain("broker-sync-service");
  });

  it("brokerSync key in buildPlatformHealth result", () => {
    expect(platformHealthSrc).toContain("brokerSync,");
  });

  it("brokerSync card includes connections, healthy, failed, lastSyncAt", () => {
    expect(platformHealthSrc).toContain("connections");
    expect(platformHealthSrc).toContain("healthy");
    expect(platformHealthSrc).toContain("failed");
    expect(platformHealthSrc).toContain("lastSyncAt");
    expect(platformHealthSrc).toContain("avgDurationMs");
    expect(platformHealthSrc).toContain("pendingJobs");
    expect(platformHealthSrc).toContain("lastError");
  });

  it("admin health page renders Broker Sync card", () => {
    expect(adminHealthPageSrc).toContain("Broker Sync");
    expect(adminHealthPageSrc).toContain("brokerSync");
  });

  it("getBrokerSyncHealth exported from service", () => {
    expect(syncServiceSrc).toContain("export function getBrokerSyncHealth");
  });
});

// ---------------------------------------------------------------------------
// Part 8 — Background Jobs
// ---------------------------------------------------------------------------

describe("Part 8 — Job Status Store — broker_sync", () => {
  it("'broker_sync' added to JobName union", () => {
    expect(jobStoreSrc).toContain('"broker_sync"');
  });

  it("'broker_sync' in allNames array", () => {
    expect(jobStoreSrc).toContain('"broker_sync"');
    const allNamesSection = jobStoreSrc.slice(jobStoreSrc.indexOf("allNames"), jobStoreSrc.indexOf("allNames") + 300);
    expect(allNamesSection).toContain("broker_sync");
  });

  it("sync service calls markJobStarted", () => {
    expect(syncServiceSrc).toContain("markJobStarted");
  });

  it("sync service calls markJobCompleted", () => {
    expect(syncServiceSrc).toContain("markJobCompleted");
  });

  it("sync service calls markJobFailed", () => {
    expect(syncServiceSrc).toContain("markJobFailed");
  });

  it("markJobStarted called with 'broker_sync'", () => {
    expect(syncServiceSrc).toContain('markJobStarted("broker_sync"');
  });

  it("markJobCompleted called with 'broker_sync'", () => {
    expect(syncServiceSrc).toContain('markJobCompleted("broker_sync"');
  });

  it("markJobFailed called with 'broker_sync'", () => {
    expect(syncServiceSrc).toContain('markJobFailed("broker_sync"');
  });
});

// ---------------------------------------------------------------------------
// Part 9 — Structured Logging
// ---------------------------------------------------------------------------

describe("Part 9 — Structured Logging", () => {
  it("emits broker_sync_started event", () => {
    expect(syncServiceSrc).toContain('"broker_sync_started"');
  });

  it("emits broker_sync_completed event", () => {
    expect(syncServiceSrc).toContain('"broker_sync_completed"');
  });

  it("emits broker_sync_failed event", () => {
    expect(syncServiceSrc).toContain('"broker_sync_failed"');
  });

  it("userId is redacted in logs — never logged as a value", () => {
    expect(syncServiceSrc).toContain('"[redacted]"');
  });

  it("no token/credential/PII in log fields", () => {
    const lower = syncServiceSrc.toLowerCase();
    expect(lower).not.toContain("accesstoken:");
    expect(lower).not.toContain("refreshtoken:");
    expect(lower).not.toContain("password:");
    expect(lower).not.toContain("secret:");
  });

  it("logs use JSON.stringify for structured format", () => {
    expect(syncServiceSrc).toContain("JSON.stringify");
  });

  it("account number never passed to log statements", () => {
    expect(syncServiceSrc).not.toContain("accountId:");
    expect(syncServiceSrc).not.toContain("account_id:");
  });
});

// ---------------------------------------------------------------------------
// Part 10 — Compliance Disclosures
// ---------------------------------------------------------------------------

describe("Part 10 — Compliance Disclosures", () => {
  it("broker-sync-compliance-disclosure testid present", () => {
    expect(connectPageSrc).toContain("broker-sync-compliance-disclosure");
  });

  it("'imports portfolio holdings for research purposes' statement", () => {
    expect(connectPageSrc).toContain("imports portfolio holdings for research purposes");
    expect(connectPageSrc).toContain("sync-purpose-statement");
  });

  it("'does not authorize trading' statement", () => {
    expect(connectPageSrc).toContain("does not authorize trading");
    expect(connectPageSrc).toContain("no-trading-authorization-statement");
  });

  it("'disconnect your broker at any time' statement", () => {
    expect(connectPageSrc).toContain("disconnect your broker at any time");
    expect(connectPageSrc).toContain("disconnect-anytime-statement");
  });

  it("'broker data is used only for portfolio research' statement", () => {
    expect(connectPageSrc).toContain("Broker data is used only for portfolio research features");
    expect(connectPageSrc).toContain("data-use-statement");
  });

  it("compliance section uses Shield icon (matching existing styling)", () => {
    expect(connectPageSrc).toContain("Shield");
  });

  it("Privacy Policy link present on connect page", () => {
    expect(connectPageSrc).toContain('href="/privacy"');
  });
});

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

describe("Route registration", () => {
  it("registerBrokerSyncRoutes imported in routes.ts", () => {
    expect(routesSrc).toContain("registerBrokerSyncRoutes");
    expect(routesSrc).toContain("broker-sync");
  });

  it("registerBrokerSyncRoutes called in routes.ts", () => {
    expect(routesSrc).toContain("registerBrokerSyncRoutes(app, isAuthenticated)");
  });

  it("GET /api/portfolio/broker/connections route registered", () => {
    expect(syncRoutesSrc).toContain("/api/portfolio/broker/connections");
  });

  it("POST /api/portfolio/broker/connect route registered", () => {
    expect(syncRoutesSrc).toContain("/api/portfolio/broker/connect");
  });

  it("DELETE /api/portfolio/broker/disconnect/:portfolioId route registered", () => {
    expect(syncRoutesSrc).toContain("/api/portfolio/broker/disconnect/:portfolioId");
  });

  it("GET /api/portfolio/broker/sync/:portfolioId/status route registered", () => {
    expect(syncRoutesSrc).toContain("/api/portfolio/broker/sync/:portfolioId/status");
  });
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe("Authorization", () => {
  it("all broker-sync routes require isAuthenticated", () => {
    expect(syncRoutesSrc).toContain("isAuthenticated");
    // All 5 routes use isAuthenticated as middleware
    const matches = syncRoutesSrc.match(/isAuthenticated/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(5);
  });

  it("routes verify portfolio ownership before sync", () => {
    expect(syncRoutesSrc).toContain("eq(portfolios.userId, userId)");
  });

  it("routes return 401 for unauthenticated requests", () => {
    expect(syncRoutesSrc).toContain("401");
    expect(syncRoutesSrc).toContain("Unauthorized");
  });

  it("routes return 404 for portfolios not owned by user", () => {
    expect(syncRoutesSrc).toContain("404");
    expect(syncRoutesSrc).toContain("Portfolio not found");
  });

  it("disconnect requires portfolio.sourceType to be 'broker'", () => {
    expect(syncRoutesSrc).toContain('sourceType !== "broker"');
  });

  it("sync route requires portfolio to be broker-linked", () => {
    // Two checks for sourceType !== broker in the route file
    const count = (syncRoutesSrc.match(/sourceType !== "broker"/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Duplicate prevention / idempotency
// ---------------------------------------------------------------------------

describe("Duplicate prevention / idempotency", () => {
  it("connect route prevents duplicate broker portfolios", () => {
    expect(syncRoutesSrc).toContain("409");
    expect(syncRoutesSrc).toContain("already exists");
    expect(syncRoutesSrc).toContain("duplicate");
  });

  it("sync service uses delete-then-insert (not upsert) for idempotency", () => {
    // delete before insert — confirmed by order check above
    expect(syncServiceSrc).toContain("db.delete(portfolioPositions)");
    expect(syncServiceSrc).toContain("db.insert(portfolioPositions)");
  });

  it("sync service never inserts when normalized result is empty", () => {
    expect(syncServiceSrc).toContain("positionRows.length > 0");
  });
});

// ---------------------------------------------------------------------------
// Disconnect behavior
// ---------------------------------------------------------------------------

describe("Disconnect behavior", () => {
  it("disconnect converts sourceType to 'manual'", () => {
    expect(syncRoutesSrc).toContain("sourceType:      \"manual\"");
  });

  it("disconnect clears sourceAccountId", () => {
    expect(syncRoutesSrc).toContain("sourceAccountId: null");
  });

  it("disconnect updates position sourceType to manual", () => {
    // Route may chain db.update() across multiple lines
    expect(syncRoutesSrc).toContain(".update(portfolioPositions)");
    expect(syncRoutesSrc).toContain('sourceType: "manual"');
  });

  it("disconnect keeps existing positions (does not delete)", () => {
    // The disconnect route must NOT call db.delete(portfolioPositions)
    const disconnectSection = syncRoutesSrc.slice(
      syncRoutesSrc.indexOf("/api/portfolio/broker/disconnect"),
      syncRoutesSrc.indexOf("/api/portfolio/broker/disconnect") + 600,
    );
    expect(disconnectSection).not.toContain("db.delete(portfolioPositions)");
  });

  it("disconnect returns message confirming positions retained", () => {
    expect(syncRoutesSrc).toContain("Existing positions retained");
  });
});

// ---------------------------------------------------------------------------
// Safety — no secrets in routes or client
// ---------------------------------------------------------------------------

describe("Safety — no secrets exposed", () => {
  it("broker-sync route never returns accessToken", () => {
    expect(syncRoutesSrc).not.toContain("accessToken:");
    expect(syncRoutesSrc).not.toContain("refreshToken:");
  });

  it("broker-sync route uses safeConnectionInfo (strips tokens)", () => {
    expect(syncRoutesSrc).toContain("safeConnectionInfo");
  });

  it("connect page never renders token or credential values", () => {
    const lower = connectPageSrc.toLowerCase();
    expect(lower).not.toContain("accesstoken:");
    expect(lower).not.toContain("refreshtoken:");
    // "No passwords ... are stored" in a security notice is acceptable
    // What must NOT appear is a password input or password value
    expect(lower).not.toContain('type="password"');
    expect(lower).not.toContain("password=");
  });

  it("service uses getBrokerPositions — not direct API calls", () => {
    expect(syncServiceSrc).toContain("getBrokerPositions");
    expect(syncServiceSrc).not.toContain("fetch(\"https://api.tradier");
    expect(syncServiceSrc).not.toContain("fetch(\"https://api.tradestation");
  });
});

// ---------------------------------------------------------------------------
// Architecture extensibility (future brokers without schema redesign)
// ---------------------------------------------------------------------------

describe("Architecture extensibility", () => {
  it("SUPPORTED_PROVIDERS array makes adding new brokers trivial", () => {
    expect(syncRoutesSrc).toContain("SUPPORTED_PROVIDERS");
  });

  it("portfolio schema sourceAccountId is text (arbitrary provider name)", () => {
    const schemaSrc = fs.readFileSync(
      path.join(__dirname, "../../../shared/schema.ts"), "utf-8",
    );
    expect(schemaSrc).toContain("sourceAccountId");
    expect(schemaSrc).toContain("text(");
  });

  it("FUTURE_BROKERS array in connect page for coming-soon display", () => {
    expect(connectPageSrc).toContain("FUTURE_BROKERS");
  });

  it("Schwab, Fidelity, IBKR, Robinhood listed as coming soon", () => {
    expect(connectPageSrc).toContain("Schwab");
    expect(connectPageSrc).toContain("Fidelity");
    expect(connectPageSrc).toContain("IBKR");
    expect(connectPageSrc).toContain("Robinhood");
  });
});

// ---------------------------------------------------------------------------
// No future roadmap work pulled in
// ---------------------------------------------------------------------------

describe("Roadmap discipline — no future features implemented", () => {
  it("no portfolio intelligence / scoring in broker-sync service", () => {
    const lower = syncServiceSrc.toLowerCase();
    expect(lower).not.toContain("portfolio score");
    expect(lower).not.toContain("rebalance");
    expect(lower).not.toContain("intelligence");
    expect(lower).not.toContain("recommendation");
  });

  it("no tax optimization in broker-sync", () => {
    expect(syncServiceSrc.toLowerCase()).not.toContain("tax");
  });

  it("no goal planning in broker-sync", () => {
    expect(syncServiceSrc.toLowerCase()).not.toContain("goal");
  });

  it("no alerting wired in broker-sync", () => {
    expect(syncServiceSrc.toLowerCase()).not.toContain("alert");
  });

  it("connect page does not show investment recommendations", () => {
    expect(connectPageSrc.toLowerCase()).not.toContain("buy signal");
    expect(connectPageSrc.toLowerCase()).not.toContain("sell signal");
    expect(connectPageSrc.toLowerCase()).not.toContain("recommendation");
  });
});
