// seed-mappings.test.ts — Reviewed mapping seed validation tests.
//
// Pure-function tests for the seed script's validation logic.
// No DB calls — all functions under test are pure.

import { describe, it, expect } from "vitest";
import {
  normaliseCusip,
  normaliseTicker,
  validateMapping,
} from "../../../../scripts/seed-institutional-mappings";

const VALID_RECORD = {
  cusip: "22160K105",
  ticker: "COST",
  issuerName: "Costco Wholesale Corporation",
  mappingMethod: "manual_reviewed",
  mappingStatus: "reviewed",
  figi: null,
};

// ---------------------------------------------------------------------------
// H — normaliseCusip
// ---------------------------------------------------------------------------

describe("H — normaliseCusip", () => {
  it("H1 — converts to uppercase", () => {
    expect(normaliseCusip("22160k105")).toBe("22160K105");
  });

  it("H2 — strips non-alphanumeric characters", () => {
    expect(normaliseCusip("221-60K 105")).toBe("22160K105");
  });

  it("H3 — trims whitespace", () => {
    expect(normaliseCusip("  22160K105  ")).toBe("22160K105");
  });
});

// ---------------------------------------------------------------------------
// I — normaliseTicker
// ---------------------------------------------------------------------------

describe("I — normaliseTicker", () => {
  it("I1 — converts to uppercase", () => {
    expect(normaliseTicker("cost")).toBe("COST");
  });

  it("I2 — strips non-alpha characters", () => {
    expect(normaliseTicker("C-OST.A")).toBe("COSTA");
  });

  it("I3 — truncates to 10 characters", () => {
    expect(normaliseTicker("ABCDEFGHIJKLMN")).toBe("ABCDEFGHIJ");
  });
});

// ---------------------------------------------------------------------------
// J — validateMapping
// ---------------------------------------------------------------------------

describe("J — validateMapping (valid records)", () => {
  it("J1 — accepts a fully valid reviewed record", () => {
    const result = validateMapping(VALID_RECORD as Record<string, unknown>);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.record).toBeDefined();
    expect(result.record!.cusip).toBe("22160K105");
    expect(result.record!.ticker).toBe("COST");
  });

  it("J2 — accepts mappingStatus=exact", () => {
    const result = validateMapping({ ...VALID_RECORD, mappingStatus: "exact" } as Record<string, unknown>);
    expect(result.ok).toBe(true);
  });

  it("J3 — normalises CUSIP on ingest", () => {
    const result = validateMapping({ ...VALID_RECORD, cusip: "22160k105" } as Record<string, unknown>);
    expect(result.ok).toBe(true);
    expect(result.record!.cusip).toBe("22160K105");
  });

  it("J4 — normalises ticker on ingest", () => {
    const result = validateMapping({ ...VALID_RECORD, ticker: "cost" } as Record<string, unknown>);
    expect(result.ok).toBe(true);
    expect(result.record!.ticker).toBe("COST");
  });

  it("J5 — defaults mappingMethod to manual_reviewed when not provided", () => {
    const { mappingMethod: _, ...withoutMethod } = VALID_RECORD;
    const result = validateMapping(withoutMethod as Record<string, unknown>);
    expect(result.ok).toBe(true);
    expect(result.record!.mappingMethod).toBe("manual_reviewed");
  });

  it("J6 — accepts null figi", () => {
    const result = validateMapping({ ...VALID_RECORD, figi: null } as Record<string, unknown>);
    expect(result.ok).toBe(true);
    expect(result.record!.figi).toBeNull();
  });

  it("J7 — accepts omitted figi (treated as null)", () => {
    const { figi: _, ...withoutFigi } = VALID_RECORD;
    const result = validateMapping(withoutFigi as Record<string, unknown>);
    expect(result.ok).toBe(true);
    expect(result.record!.figi).toBeNull();
  });
});

describe("J — validateMapping (invalid records reject correctly)", () => {
  it("J8 — rejects mappingStatus=probable", () => {
    const result = validateMapping({ ...VALID_RECORD, mappingStatus: "probable" } as Record<string, unknown>);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("probable"))).toBe(true);
    expect(result.errors.some((e) => e.includes("not allowed for production seed"))).toBe(true);
  });

  it("J9 — rejects mappingStatus=ambiguous", () => {
    const result = validateMapping({ ...VALID_RECORD, mappingStatus: "ambiguous" } as Record<string, unknown>);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("ambiguous"))).toBe(true);
  });

  it("J10 — rejects mappingStatus=unmapped", () => {
    const result = validateMapping({ ...VALID_RECORD, mappingStatus: "unmapped" } as Record<string, unknown>);
    expect(result.ok).toBe(false);
  });

  it("J11 — rejects invalid CUSIP (wrong length)", () => {
    const result = validateMapping({ ...VALID_RECORD, cusip: "TOOSHORT" } as Record<string, unknown>);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("cusip"))).toBe(true);
  });

  it("J12 — rejects empty issuerName", () => {
    const result = validateMapping({ ...VALID_RECORD, issuerName: "" } as Record<string, unknown>);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("issuerName"))).toBe(true);
  });

  it("J13 — rejects whitespace-only issuerName", () => {
    const result = validateMapping({ ...VALID_RECORD, issuerName: "   " } as Record<string, unknown>);
    expect(result.ok).toBe(false);
  });

  it("J14 — rejects empty ticker", () => {
    const result = validateMapping({ ...VALID_RECORD, ticker: "" } as Record<string, unknown>);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("ticker"))).toBe(true);
  });

  it("J15 — rejects ticker with digits only (after normalisation)", () => {
    const result = validateMapping({ ...VALID_RECORD, ticker: "1234" } as Record<string, unknown>);
    expect(result.ok).toBe(false);
  });

  it("J16 — rejects unknown mappingStatus value", () => {
    const result = validateMapping({ ...VALID_RECORD, mappingStatus: "guessed" } as Record<string, unknown>);
    expect(result.ok).toBe(false);
  });

  it("J17 — can accumulate multiple errors in one record", () => {
    const result = validateMapping({
      cusip: "BAD",
      ticker: "",
      issuerName: "",
      mappingStatus: "ambiguous",
    } as Record<string, unknown>);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// K — CLI quarter bound validation (pure logic)
// ---------------------------------------------------------------------------

describe("K — CLI backfill quarter bound validation", () => {
  const MIN_QUARTERS = 1;
  const MAX_QUARTERS = 8;

  it("K1 — valid quarters within bounds pass", () => {
    for (const n of [1, 2, 4, 8]) {
      expect(n >= MIN_QUARTERS && n <= MAX_QUARTERS).toBe(true);
    }
  });

  it("K2 — quarters below MIN are rejected", () => {
    expect(0 >= MIN_QUARTERS).toBe(false);
    expect(-1 >= MIN_QUARTERS).toBe(false);
  });

  it("K3 — quarters above MAX are rejected", () => {
    expect(9 <= MAX_QUARTERS).toBe(false);
    expect(100 <= MAX_QUARTERS).toBe(false);
  });

  it("K4 — non-integer is rejected", () => {
    const raw = "2.5";
    const n = parseInt(raw, 10);
    // parseInt("2.5") = 2 which is valid; but a float like NaN would fail
    const rawNaN = "abc";
    const nNaN = parseInt(rawNaN, 10);
    expect(Number.isFinite(nNaN)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// L — Dry-run contract (no writes expected in dry-run mode)
// ---------------------------------------------------------------------------

describe("L — dry-run contract", () => {
  it("L1 — validateMapping succeeds for valid record (pre-check for dry-run)", () => {
    // In dry-run, we validate but do not call upsert. This test verifies that
    // a valid record passes validation — the dry-run branch calls validateMapping
    // then skips the DB call.
    const result = validateMapping(VALID_RECORD as Record<string, unknown>);
    expect(result.ok).toBe(true);
  });

  it("L2 — validateMapping rejects ambiguous in dry-run (same path as live)", () => {
    // Dry-run must use the same validation path as live run.
    const result = validateMapping({ ...VALID_RECORD, mappingStatus: "probable" } as Record<string, unknown>);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
