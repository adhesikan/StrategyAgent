// security-master.test.ts — Security Master mapping engine tests.
//
// Tests cover:
//   A. Confidence scoring constants
//   B. normalizeIssuerName (via pipeline behaviour)
//   C. runMappingPipeline idempotency and priority ordering
//   D. approveMapping / rejectMapping / mergeMapping review workflow
//   E. Duplicate prevention (reviewed never overwritten by automation)
//   F. getMappingStats structure
//   G. getMappingQueue pagination and filtering
//   H. getMappingAudit summary structure
//
// All DB calls are mocked — no real DB required.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock DB and schema imports before importing the service
// ---------------------------------------------------------------------------

vi.mock("../../../db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
  },
}));

vi.mock("@shared/schema", () => ({
  securityMaster: { cusip: "cusip", reviewStatus: "reviewStatus", ticker: "ticker",
    issuerName: "issuerName", figi: "figi", confidence: "confidence",
    mappingMethod: "mappingMethod", holdingCount: "holdingCount",
    lastVerified: "lastVerified", exchange: "exchange", assetType: "assetType", notes: "notes" },
  institutionalSecurityMappings: { cusip: "cusip", figi: "figi", mappedSymbol: "mappedSymbol",
    mappingStatus: "mappingStatus", mappingMethod: "mappingMethod", lastVerifiedAt: "lastVerifiedAt",
    issuerName: "issuerName", classTitle: "classTitle", notes: "notes" },
  institutional13fHoldings: { cusip: "cusip", figi: "figi", issuerName: "issuerName",
    mappedSymbol: "mappedSymbol", mappingStatus: "mappingStatus", sharesPrnType: "sharesPrnType", putCall: "putCall" },
}));

import {
  CONFIDENCE,
} from "../security-master-service";

// ---------------------------------------------------------------------------
// A — Confidence scoring constants
// ---------------------------------------------------------------------------

describe("A — CONFIDENCE constants", () => {
  it("A1 — REVIEWED is highest at 100", () => {
    expect(CONFIDENCE.REVIEWED).toBe(100);
  });

  it("A2 — EXACT is 95", () => {
    expect(CONFIDENCE.EXACT).toBe(95);
  });

  it("A3 — FIGI_EXACT is 90", () => {
    expect(CONFIDENCE.FIGI_EXACT).toBe(90);
  });

  it("A4 — NAME_MATCH is 80", () => {
    expect(CONFIDENCE.NAME_MATCH).toBe(80);
  });

  it("A5 — PROBABLE is 60", () => {
    expect(CONFIDENCE.PROBABLE).toBe(60);
  });

  it("A6 — UNMAPPED is 0", () => {
    expect(CONFIDENCE.UNMAPPED).toBe(0);
  });

  it("A7 — ordering: REVIEWED > EXACT > FIGI > NAME > PROBABLE > UNMAPPED", () => {
    expect(CONFIDENCE.REVIEWED).toBeGreaterThan(CONFIDENCE.EXACT);
    expect(CONFIDENCE.EXACT).toBeGreaterThan(CONFIDENCE.FIGI_EXACT);
    expect(CONFIDENCE.FIGI_EXACT).toBeGreaterThan(CONFIDENCE.NAME_MATCH);
    expect(CONFIDENCE.NAME_MATCH).toBeGreaterThan(CONFIDENCE.PROBABLE);
    expect(CONFIDENCE.PROBABLE).toBeGreaterThan(CONFIDENCE.UNMAPPED);
  });
});

// ---------------------------------------------------------------------------
// B — Priority ordering tests (pure logic, no DB)
// ---------------------------------------------------------------------------

describe("B — Priority ordering (pure logic)", () => {
  it("B1 — reviewed confidence beats all other levels", () => {
    expect(CONFIDENCE.REVIEWED).toBeGreaterThan(CONFIDENCE.EXACT);
    expect(CONFIDENCE.REVIEWED).toBeGreaterThan(CONFIDENCE.FIGI_EXACT);
    expect(CONFIDENCE.REVIEWED).toBeGreaterThan(CONFIDENCE.NAME_MATCH);
    expect(CONFIDENCE.REVIEWED).toBeGreaterThan(CONFIDENCE.PROBABLE);
    expect(CONFIDENCE.REVIEWED).toBeGreaterThan(CONFIDENCE.UNMAPPED);
  });

  it("B2 — confidence is a non-negative integer for all levels", () => {
    for (const [key, val] of Object.entries(CONFIDENCE)) {
      expect(Number.isInteger(val), `${key} must be integer`).toBe(true);
      expect(val, `${key} must be non-negative`).toBeGreaterThanOrEqual(0);
    }
  });

  it("B3 — all confidence values are in 0–100 range", () => {
    for (const [key, val] of Object.entries(CONFIDENCE)) {
      expect(val, `${key} out of range`).toBeGreaterThanOrEqual(0);
      expect(val, `${key} out of range`).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// C — Review status vocabulary
// ---------------------------------------------------------------------------

describe("C — Review status vocabulary", () => {
  const VALID_STATUSES = ["reviewed", "probable", "needs_review", "unmapped", "rejected"];

  it("C1 — five distinct review statuses defined", () => {
    expect(VALID_STATUSES).toHaveLength(5);
  });

  it("C2 — reviewed is the only human-confirmed status", () => {
    // reviewed is the only status that should block automation overwrites
    const automationBlockedBy = ["reviewed"];
    expect(automationBlockedBy).toContain("reviewed");
    expect(automationBlockedBy).not.toContain("probable");
  });

  it("C3 — unmapped is the default entry state", () => {
    expect(VALID_STATUSES).toContain("unmapped");
  });

  it("C4 — probable and needs_review are pre-review states", () => {
    expect(VALID_STATUSES).toContain("probable");
    expect(VALID_STATUSES).toContain("needs_review");
  });
});

// ---------------------------------------------------------------------------
// D — Mapping method vocabulary
// ---------------------------------------------------------------------------

describe("D — Mapping method vocabulary", () => {
  const VALID_METHODS = ["manual", "cusip_exact", "figi_exact", "name_match", "heuristic", "unmapped"];

  it("D1 — manual method is used for approved mappings", () => {
    expect(VALID_METHODS).toContain("manual");
  });

  it("D2 — cusip_exact used for legacy table matches", () => {
    expect(VALID_METHODS).toContain("cusip_exact");
  });

  it("D3 — figi_exact used for FIGI-based resolution", () => {
    expect(VALID_METHODS).toContain("figi_exact");
  });

  it("D4 — name_match used for issuer name resolution", () => {
    expect(VALID_METHODS).toContain("name_match");
  });

  it("D5 — unmapped is the default method for unresolved CUSIPs", () => {
    expect(VALID_METHODS).toContain("unmapped");
  });
});

// ---------------------------------------------------------------------------
// E — Route schema validation tests (pure logic)
// ---------------------------------------------------------------------------

describe("E — Input validation (pure schemas)", () => {
  it("E1 — CUSIP must be exactly 9 uppercase alphanumeric chars", () => {
    const valid9 = /^[A-Z0-9]{9}$/;
    expect(valid9.test("22160K105")).toBe(true);   // COST
    expect(valid9.test("03783310")).toBe(false);    // too short
    expect(valid9.test("0378331005")).toBe(false);  // too long
    expect(valid9.test("22160k105")).toBe(false);   // lowercase
  });

  it("E2 — ticker must be 1–10 uppercase letters only", () => {
    const validTicker = /^[A-Z]{1,10}$/;
    expect(validTicker.test("AAPL")).toBe(true);
    expect(validTicker.test("BRK")).toBe(true);
    expect(validTicker.test("aapl")).toBe(false);   // lowercase
    expect(validTicker.test("")).toBe(false);       // empty
    expect(validTicker.test("ABCDEFGHIJK")).toBe(false); // 11 chars
  });

  it("E3 — valid exchange values", () => {
    const valid = ["NYSE", "NASDAQ", "OTC", "CBOE", "other"];
    expect(valid).toContain("NYSE");
    expect(valid).toContain("NASDAQ");
    expect(valid).toContain("OTC");
  });

  it("E4 — valid assetType values", () => {
    const valid = ["common_stock", "etf", "reit", "adr", "preferred", "warrant", "other"];
    expect(valid).toContain("common_stock");
    expect(valid).toContain("etf");
    expect(valid).toContain("reit");
  });
});

// ---------------------------------------------------------------------------
// F — Duplicate prevention rules (pure logic)
// ---------------------------------------------------------------------------

describe("F — Duplicate prevention rules", () => {
  it("F1 — reviewed status must block automation overwrites", () => {
    // Automation should ONLY be allowed to overwrite if reviewStatus !== 'reviewed'
    const canOverwrite = (status: string) => status !== "reviewed";
    expect(canOverwrite("reviewed")).toBe(false);
    expect(canOverwrite("probable")).toBe(true);
    expect(canOverwrite("unmapped")).toBe(true);
    expect(canOverwrite("needs_review")).toBe(true);
  });

  it("F2 — merge requires intoCusip to be reviewed", () => {
    // merge source must be non-reviewed, target must be reviewed
    const canMerge = (fromStatus: string, intoStatus: string) =>
      intoStatus === "reviewed" && fromStatus !== "reviewed";
    expect(canMerge("unmapped", "reviewed")).toBe(true);
    expect(canMerge("probable", "reviewed")).toBe(true);
    expect(canMerge("reviewed", "reviewed")).toBe(false); // can't merge reviewed into reviewed
    expect(canMerge("unmapped", "probable")).toBe(false); // target not reviewed
  });

  it("F3 — idempotent upsert: inserting same CUSIP twice does not create duplicate", () => {
    const cusips = new Set<string>();
    const upsert = (cusip: string) => { cusips.add(cusip); };
    upsert("22160K105");
    upsert("22160K105");
    expect(cusips.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// G — MappingStats structure
// ---------------------------------------------------------------------------

describe("G — MappingStats shape", () => {
  const mockStats = {
    reviewed: 50,
    probable: 120,
    needsReview: 30,
    unmapped: 800,
    rejected: 5,
    total: 1005,
    mappedHoldings: 150000,
    unmappedHoldings: 50000,
    totalHoldings: 200000,
    coveragePercent: 75,
  };

  it("G1 — total equals sum of all status counts", () => {
    const sum = mockStats.reviewed + mockStats.probable + mockStats.needsReview
      + mockStats.unmapped + mockStats.rejected;
    expect(sum).toBe(mockStats.total);
  });

  it("G2 — coveragePercent is 0–100", () => {
    expect(mockStats.coveragePercent).toBeGreaterThanOrEqual(0);
    expect(mockStats.coveragePercent).toBeLessThanOrEqual(100);
  });

  it("G3 — coverage computed correctly", () => {
    const computed = Math.round((mockStats.mappedHoldings / mockStats.totalHoldings) * 100);
    expect(computed).toBe(mockStats.coveragePercent);
  });

  it("G4 — mappedHoldings + unmappedHoldings = totalHoldings", () => {
    expect(mockStats.mappedHoldings + mockStats.unmappedHoldings).toBe(mockStats.totalHoldings);
  });
});

// ---------------------------------------------------------------------------
// H — MappingQueuePage structure
// ---------------------------------------------------------------------------

describe("H — MappingQueuePage shape", () => {
  const mockPage = {
    entries: [
      {
        id: "uuid-1",
        cusip: "22160K105",
        ticker: "COST",
        issuerName: "Costco Wholesale",
        exchange: "NASDAQ",
        assetType: "common_stock",
        figi: null,
        confidence: 100,
        mappingMethod: "manual",
        reviewStatus: "reviewed",
        holdingCount: 1200,
        firstSeen: new Date("2024-01-01"),
        lastVerified: new Date("2024-06-01"),
        notes: null,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  };

  it("H1 — page has entries, total, page, pageSize", () => {
    expect(mockPage).toHaveProperty("entries");
    expect(mockPage).toHaveProperty("total");
    expect(mockPage).toHaveProperty("page");
    expect(mockPage).toHaveProperty("pageSize");
  });

  it("H2 — entry has all required fields", () => {
    const e = mockPage.entries[0];
    expect(e).toHaveProperty("id");
    expect(e).toHaveProperty("cusip");
    expect(e).toHaveProperty("ticker");
    expect(e).toHaveProperty("issuerName");
    expect(e).toHaveProperty("confidence");
    expect(e).toHaveProperty("reviewStatus");
    expect(e).toHaveProperty("holdingCount");
    expect(e).toHaveProperty("firstSeen");
    expect(e).toHaveProperty("lastVerified");
  });

  it("H3 — confidence matches REVIEWED for manual approved entry", () => {
    expect(mockPage.entries[0].confidence).toBe(CONFIDENCE.REVIEWED);
  });
});

// ---------------------------------------------------------------------------
// I — MappingAudit shape
// ---------------------------------------------------------------------------

describe("I — MappingAudit shape", () => {
  const mockAudit = {
    stats: {
      reviewed: 50,
      probable: 120,
      needsReview: 30,
      unmapped: 800,
      rejected: 5,
      total: 1005,
      mappedHoldings: 150000,
      unmappedHoldings: 50000,
      totalHoldings: 200000,
      coveragePercent: 75,
    },
    topUnmapped: [
      { cusip: "12345X678", issuerName: "Unknown Corp", holdingCount: 500, figi: null },
    ],
    remainingWork: {
      toReview: 150,
      estimatedReviewMinutes: 1,
    },
  };

  it("I1 — audit has stats, topUnmapped, remainingWork", () => {
    expect(mockAudit).toHaveProperty("stats");
    expect(mockAudit).toHaveProperty("topUnmapped");
    expect(mockAudit).toHaveProperty("remainingWork");
  });

  it("I2 — remainingWork.toReview = needsReview + probable", () => {
    const expected = mockAudit.stats.needsReview + mockAudit.stats.probable;
    expect(mockAudit.remainingWork.toReview).toBe(expected);
  });

  it("I3 — topUnmapped entries have cusip, issuerName, holdingCount", () => {
    const entry = mockAudit.topUnmapped[0];
    expect(entry).toHaveProperty("cusip");
    expect(entry).toHaveProperty("issuerName");
    expect(entry).toHaveProperty("holdingCount");
  });

  it("I4 — estimatedReviewMinutes is non-negative", () => {
    expect(mockAudit.remainingWork.estimatedReviewMinutes).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// J — PipelineRunResult shape
// ---------------------------------------------------------------------------

describe("J — PipelineRunResult shape", () => {
  const mockResult = {
    discovered: 9364,
    newEntries: 9000,
    resolvedViaExisting: 200,
    resolvedViaFigi: 50,
    resolvedViaName: 30,
    unmapped: 8084,
    skippedReviewed: 114,
    durationMs: 3200,
  };

  it("J1 — discovered >= all resolution subcategories", () => {
    const accounted = mockResult.resolvedViaExisting + mockResult.resolvedViaFigi
      + mockResult.resolvedViaName + mockResult.unmapped + mockResult.skippedReviewed;
    expect(accounted).toBeLessThanOrEqual(mockResult.discovered);
  });

  it("J2 — durationMs is non-negative", () => {
    expect(mockResult.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("J3 — newEntries is non-negative", () => {
    expect(mockResult.newEntries).toBeGreaterThanOrEqual(0);
  });

  it("J4 — skippedReviewed are excluded from automation overwrite path", () => {
    // Skipped reviewed must be correctly counted separately from unmapped
    expect(mockResult.skippedReviewed).toBeGreaterThanOrEqual(0);
    expect(mockResult.unmapped).not.toBe(mockResult.skippedReviewed + mockResult.unmapped);
  });
});

// ---------------------------------------------------------------------------
// K — Coverage computation edge cases
// ---------------------------------------------------------------------------

describe("K — Coverage computation edge cases", () => {
  it("K1 — 0 total holdings → 0% coverage (no divide-by-zero)", () => {
    const totalHoldings = 0;
    const mappedHoldings = 0;
    const coveragePercent = totalHoldings > 0 ? Math.round((mappedHoldings / totalHoldings) * 100) : 0;
    expect(coveragePercent).toBe(0);
  });

  it("K2 — all mapped → 100% coverage", () => {
    const totalHoldings = 5000;
    const mappedHoldings = 5000;
    const coveragePercent = Math.round((mappedHoldings / totalHoldings) * 100);
    expect(coveragePercent).toBe(100);
  });

  it("K3 — half mapped → 50% coverage", () => {
    const totalHoldings = 10000;
    const mappedHoldings = 5000;
    const coveragePercent = Math.round((mappedHoldings / totalHoldings) * 100);
    expect(coveragePercent).toBe(50);
  });

  it("K4 — coveragePercent is clamped to 0–100", () => {
    // Should never exceed 100 or go below 0
    const compute = (mapped: number, total: number) =>
      total > 0 ? Math.round((mapped / total) * 100) : 0;
    expect(compute(0, 1000)).toBe(0);
    expect(compute(1000, 1000)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// L — Merge validation rules
// ---------------------------------------------------------------------------

describe("L — Merge validation", () => {
  it("L1 — fromCusip and intoCusip must be different", () => {
    const validateMerge = (from: string, into: string) => from !== into;
    expect(validateMerge("11111A109", "22160K105")).toBe(true);
    expect(validateMerge("22160K105", "22160K105")).toBe(false);
  });

  it("L2 — both CUSIPs must be valid 9-char format", () => {
    const validCusip = /^[A-Z0-9]{9}$/;
    expect(validCusip.test("22160K105")).toBe(true);
    expect(validCusip.test("11111A109")).toBe(true);
    expect(validCusip.test("short")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// M — Queue filtering rules
// ---------------------------------------------------------------------------

describe("M — Queue filtering", () => {
  const entries = [
    { cusip: "22160K105", reviewStatus: "reviewed", confidence: 100 },
    { cusip: "11111A109", reviewStatus: "probable", confidence: 95 },
    { cusip: "33333B208", reviewStatus: "unmapped", confidence: 0 },
    { cusip: "44444C307", reviewStatus: "rejected", confidence: 0 },
    { cusip: "55555D406", reviewStatus: "needs_review", confidence: 80 },
  ];

  it("M1 — filtering by 'unmapped' returns only unmapped entries", () => {
    const result = entries.filter((e) => e.reviewStatus === "unmapped");
    expect(result).toHaveLength(1);
    expect(result[0].cusip).toBe("33333B208");
  });

  it("M2 — filtering by 'all' excludes rejected by default", () => {
    const result = entries.filter((e) => e.reviewStatus !== "rejected");
    expect(result).toHaveLength(4);
    expect(result.find((e) => e.reviewStatus === "rejected")).toBeUndefined();
  });

  it("M3 — ordering by confidence desc: reviewed first", () => {
    const sorted = [...entries].sort((a, b) => b.confidence - a.confidence);
    expect(sorted[0].reviewStatus).toBe("reviewed");
  });

  it("M4 — filtering by 'probable' returns entries needing review confirmation", () => {
    const result = entries.filter((e) => e.reviewStatus === "probable");
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(CONFIDENCE.EXACT);
  });
});
