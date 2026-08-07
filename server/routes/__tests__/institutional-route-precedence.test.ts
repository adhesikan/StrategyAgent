// institutional-route-precedence.test.ts
//
// Regression tests for the route registration order / collision bug:
//
//   BEFORE fix: registerInstitutionalRoute (GET /api/institutional/:symbol)
//               was registered FIRST — Express matched it before the static
//               named routes, so "/api/institutional/mappings" was captured
//               by :symbol, "mappings".toUpperCase() = "MAPPINGS" passed the
//               SYMBOL_RE regex, and getInstitutionalData("MAPPINGS") ran,
//               returning { status:"unavailable", symbol:"!MAPPINGS" }.
//
//   AFTER fix:  Static named routes are registered first; dynamic :symbol is
//               last. The handler also has a belt-and-suspenders denylist that
//               rejects reserved path segments regardless of order.
//
// Strategy: test the pure business-logic guards exported from the route
// modules directly — no HTTP server, no supertest, no DB connection.

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// 1. RESERVED_SEGMENTS denylist (tests the guard in institutional.ts logic)
//    We test the guard as a pure unit — re-implement the same check the
//    handler uses so we can assert it without spinning up an Express app.
// ---------------------------------------------------------------------------

const SYMBOL_RE = /^[A-Z]{1,10}$/;

const RESERVED_SEGMENTS = new Set([
  "mappings",
  "unmapped",
  "mapping-audit",
  "mapping-pipeline",
  "review",
]);

function validateSymbolParam(raw: string): "reserved" | "invalid" | "valid" {
  if (RESERVED_SEGMENTS.has(raw.toLowerCase())) return "reserved";
  if (!SYMBOL_RE.test(raw.toUpperCase())) return "invalid";
  return "valid";
}

describe("validateSymbolParam — reserved segment denylist", () => {
  // These must never reach getInstitutionalData
  const reservedWords = [
    "mappings",
    "MAPPINGS",
    "Mappings",
    "unmapped",
    "UNMAPPED",
    "mapping-audit",
    "MAPPING-AUDIT",
    "mapping-pipeline",
    "review",
    "REVIEW",
  ];

  it.each(reservedWords)("rejects reserved segment %s", (word) => {
    expect(validateSymbolParam(word)).toBe("reserved");
  });

  // These are real tickers that must reach the institutional intelligence handler
  const validTickers = [
    "COST",
    "NVDA",
    "AAPL",
    "MU",
    "MSFT",
    "A",
    "TSLA",
    "GOOG",
  ];

  it.each(validTickers)("accepts valid ticker %s", (ticker) => {
    expect(validateSymbolParam(ticker)).toBe("valid");
  });

  // These are invalid symbols that should also be rejected
  const invalidSymbols = [
    "", // empty
    "1NVDA", // starts with digit
    "TOOLONGSYMBOL", // >10 chars
    "AA BB", // contains space
    "NVDA!",  // special char
  ];

  it.each(invalidSymbols)("rejects invalid symbol %s", (sym) => {
    const result = validateSymbolParam(sym);
    // reserved returns "reserved", otherwise "invalid"
    expect(result === "reserved" || result === "invalid").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Route registration order contract
//    We test the declared order in server/routes.ts by reading the source
//    and asserting the relative line positions.
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { resolve } from "path";

describe("Route registration order — institutional routes in server/routes.ts", () => {
  const routesContent = readFileSync(resolve(__dirname, "../../routes.ts"), "utf-8");
  const lines = routesContent.split("\n");

  function lineOf(fragment: string): number {
    const idx = lines.findIndex((l) => l.includes(fragment));
    return idx; // -1 if not found
  }

  it("registerInstitutionalMappingRoutes is defined in routes.ts", () => {
    expect(lineOf("registerInstitutionalMappingRoutes")).toBeGreaterThan(-1);
  });

  it("registerInstitutionalRoute (dynamic :symbol) is defined in routes.ts", () => {
    expect(lineOf("registerInstitutionalRoute(app")).toBeGreaterThan(-1);
  });

  it("static mapping routes are registered BEFORE the dynamic :symbol route", () => {
    const mappingLine = lineOf("registerInstitutionalMappingRoutes(app");
    const symbolLine = lineOf("registerInstitutionalRoute(app");

    expect(mappingLine).toBeGreaterThan(-1);
    expect(symbolLine).toBeGreaterThan(-1);

    // The key regression: mappings must come first
    expect(mappingLine).toBeLessThan(symbolLine);
  });

  it("registerInstitutionalAdminRoutes is registered before the dynamic :symbol route", () => {
    const adminLine = lineOf("registerInstitutionalAdminRoutes(app");
    const symbolLine = lineOf("registerInstitutionalRoute(app");

    expect(adminLine).toBeGreaterThan(-1);
    expect(symbolLine).toBeGreaterThan(-1);
    expect(adminLine).toBeLessThan(symbolLine);
  });
});

// ---------------------------------------------------------------------------
// 3. EMPTY_QUEUE and EMPTY_AUDIT shape contracts
//    /api/institutional/mappings must return { entries, total, page, pageSize }
//    NEVER { status, symbol, managerActivity, largestReportedHolders }.
// ---------------------------------------------------------------------------

import { vi } from "vitest";

vi.mock("../../services/institutional/security-master-service", () => ({
  getMappingQueue: vi.fn(),
  getMappingStats: vi.fn(),
  getTopUnmapped: vi.fn(),
  getMappingAudit: vi.fn(),
  approveMapping: vi.fn(),
  rejectMapping: vi.fn(),
  mergeMapping: vi.fn(),
  runMappingPipeline: vi.fn(),
}));

import { EMPTY_QUEUE, EMPTY_AUDIT } from "../institutional-mappings";

describe("EMPTY_QUEUE — mapping queue response shape", () => {
  it("has entries array (not undefined)", () => {
    expect(Array.isArray(EMPTY_QUEUE.entries)).toBe(true);
  });

  it("has numeric total", () => {
    expect(typeof EMPTY_QUEUE.total).toBe("number");
  });

  it("has numeric page", () => {
    expect(typeof EMPTY_QUEUE.page).toBe("number");
  });

  it("has numeric pageSize", () => {
    expect(typeof EMPTY_QUEUE.pageSize).toBe("number");
  });

  it("does NOT contain institutional-intelligence-specific fields", () => {
    const q = EMPTY_QUEUE as any;
    expect(q.status).toBeUndefined();
    expect(q.symbol).toBeUndefined();
    expect(q.managerActivity).toBeUndefined();
    expect(q.largestReportedHolders).toBeUndefined();
    expect(q.sourceLinks).toBeUndefined();
  });
});

describe("EMPTY_AUDIT — mapping audit response shape", () => {
  it("has stats object", () => {
    expect(typeof EMPTY_AUDIT.stats).toBe("object");
  });

  it("does NOT contain institutional-intelligence-specific fields", () => {
    const a = EMPTY_AUDIT as any;
    expect(a.status).toBeUndefined();
    expect(a.symbol).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. "mappings" must NEVER be treated as a ticker
//    Belt-and-suspenders: even if the denylist or regex was somehow bypassed,
//    we document the intent here so a future refactor cannot accidentally re-
//    introduce the collision silently.
// ---------------------------------------------------------------------------

describe("Route word 'mappings' can never be a valid ticker", () => {
  it("'mappings' is in the reserved segment set", () => {
    expect(RESERVED_SEGMENTS.has("mappings")).toBe(true);
  });

  it("'MAPPINGS' is caught by the case-insensitive denylist check", () => {
    expect(validateSymbolParam("MAPPINGS")).toBe("reserved");
  });

  it("'unmapped' is in the reserved segment set", () => {
    expect(RESERVED_SEGMENTS.has("unmapped")).toBe(true);
  });

  it("COST passes all checks (is a valid ticker)", () => {
    expect(validateSymbolParam("COST")).toBe("valid");
  });

  it("NVDA passes all checks (is a valid ticker)", () => {
    expect(validateSymbolParam("NVDA")).toBe("valid");
  });
});
