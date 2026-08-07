// institutional-mappings-routes.test.ts
//
// Regression tests for the institutional mapping route helpers.
//
// Strategy: test the exported pure helpers and empty-shape constants directly —
// no HTTP layer, no supertest, no DB. This matches the existing codebase pattern
// (see opportunity-research.test.ts).
//
// Key regression: the page crashed with
//   "Cannot read properties of undefined (reading 'length')"
// because the frontend accessed `queueQuery.data?.entries.length` without
// optional chaining on `entries`. These tests guard that the API always returns
// a valid shape so the UI can access `.entries.length` and `.stats.coveragePercent`
// without throwing.

import { describe, it, expect } from "vitest";

// We mock the service so the DB is never touched.
// The mocks must be declared before importing the route module.
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

import {
  isTableMissingError,
  EMPTY_QUEUE,
  EMPTY_AUDIT,
} from "../institutional-mappings";

// ---------------------------------------------------------------------------
// 1. isTableMissingError — pure function
// ---------------------------------------------------------------------------

describe("isTableMissingError()", () => {
  const tableMissingMessages = [
    'relation "security_master" does not exist',
    "relation security_master does not exist",
    'ERROR: relation "foo" does not exist',
    "table security_master does not exist",
    'relation "institutional_13f_holdings" does not exist',
  ];

  const notTableMissing = [
    "connection refused",
    "query timeout",
    "unexpected error",
    "duplicate key value violates unique constraint",
    "null value in column violates not-null constraint",
    "",
  ];

  for (const msg of tableMissingMessages) {
    it(`returns true for: "${msg}"`, () => {
      expect(isTableMissingError(new Error(msg))).toBe(true);
    });
  }

  for (const msg of notTableMissing) {
    it(`returns false for: "${msg}"`, () => {
      expect(isTableMissingError(new Error(msg))).toBe(false);
    });
  }

  it("handles non-Error values safely", () => {
    expect(isTableMissingError(null)).toBe(false);
    expect(isTableMissingError(undefined)).toBe(false);
    expect(isTableMissingError("some string")).toBe(false);
    expect(isTableMissingError(42)).toBe(false);
    expect(isTableMissingError({ message: 'relation "foo" does not exist' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. EMPTY_QUEUE — shape contract (MappingPage interface)
// ---------------------------------------------------------------------------
//
// These keys are derived from the MappingPage interface in the frontend page.
// If any key is missing the UI will crash.

describe("EMPTY_QUEUE shape", () => {
  it("has entries as an array", () => {
    expect(Array.isArray(EMPTY_QUEUE.entries)).toBe(true);
  });

  it("entries is empty — length === 0 must not throw", () => {
    // Regression: the crash was on `queueQuery.data?.entries.length`
    // This test documents that `.entries.length` is always safe
    expect(() => EMPTY_QUEUE.entries.length).not.toThrow();
    expect(EMPTY_QUEUE.entries.length).toBe(0);
  });

  it("has total as a number", () => {
    expect(typeof EMPTY_QUEUE.total).toBe("number");
  });

  it("has page as a number", () => {
    expect(typeof EMPTY_QUEUE.page).toBe("number");
  });

  it("has pageSize as a number", () => {
    expect(typeof EMPTY_QUEUE.pageSize).toBe("number");
  });

  it("satisfies all required MappingPage keys", () => {
    const required = ["entries", "total", "page", "pageSize"] as const;
    for (const key of required) {
      expect(EMPTY_QUEUE).toHaveProperty(key);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. EMPTY_AUDIT — shape contract (MappingAudit interface)
// ---------------------------------------------------------------------------
//
// These keys are derived from the MappingAudit + MappingStats interfaces in
// the frontend page. A missing key causes the UI to render `undefined` or crash.

describe("EMPTY_AUDIT shape", () => {
  it("has stats object", () => {
    expect(typeof EMPTY_AUDIT.stats).toBe("object");
    expect(EMPTY_AUDIT.stats).not.toBeNull();
  });

  it("stats.coveragePercent is a number — never undefined", () => {
    // Regression guard: UI renders `${stats.coveragePercent}%`
    expect(typeof EMPTY_AUDIT.stats.coveragePercent).toBe("number");
  });

  it("satisfies all required MappingStats keys as numbers", () => {
    const required = [
      "reviewed", "probable", "needsReview", "unmapped", "rejected",
      "total", "mappedHoldings", "unmappedHoldings", "totalHoldings", "coveragePercent",
    ] as const;
    for (const key of required) {
      expect(EMPTY_AUDIT.stats).toHaveProperty(key);
      expect(typeof EMPTY_AUDIT.stats[key]).toBe("number");
    }
  });

  it("topUnmapped is an empty array", () => {
    expect(Array.isArray(EMPTY_AUDIT.topUnmapped)).toBe(true);
    expect(EMPTY_AUDIT.topUnmapped.length).toBe(0);
  });

  it("remainingWork has toReview and estimatedReviewMinutes as numbers", () => {
    expect(typeof EMPTY_AUDIT.remainingWork.toReview).toBe("number");
    expect(typeof EMPTY_AUDIT.remainingWork.estimatedReviewMinutes).toBe("number");
  });

  it("satisfies all required MappingAudit keys", () => {
    const required = ["stats", "topUnmapped", "remainingWork"] as const;
    for (const key of required) {
      expect(EMPTY_AUDIT).toHaveProperty(key);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Shape consistency — EMPTY_QUEUE.entries.map() must never throw
// ---------------------------------------------------------------------------

describe("EMPTY_QUEUE.entries defensive access patterns (frontend usage)", () => {
  it("entries.map() works without crashing when empty", () => {
    expect(() => EMPTY_QUEUE.entries.map((e: any) => e.cusip)).not.toThrow();
    expect(EMPTY_QUEUE.entries.map((e: any) => e.cusip)).toEqual([]);
  });

  it("entries ?? [] fallback is equivalent (defensive pattern used in UI)", () => {
    const entries = (EMPTY_QUEUE.entries ?? []);
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBe(0);
  });

  it("(entries?.length ?? 0) === 0 is true (empty-state check used in UI)", () => {
    expect((EMPTY_QUEUE.entries?.length ?? 0) === 0).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. EMPTY_AUDIT stats defensive access (frontend usage)
// ---------------------------------------------------------------------------

describe("EMPTY_AUDIT.stats defensive access patterns (frontend usage)", () => {
  it("`${stats.coveragePercent}%` does not produce 'undefined%'", () => {
    const display = `${EMPTY_AUDIT.stats.coveragePercent}%`;
    expect(display).not.toBe("undefined%");
    expect(display).toBe("0%");
  });

  it("stats.reviewed.toLocaleString() does not throw", () => {
    expect(() => EMPTY_AUDIT.stats.reviewed.toLocaleString()).not.toThrow();
  });

  it("stats.coveragePercent.toLocaleString() does not throw", () => {
    expect(() => EMPTY_AUDIT.stats.coveragePercent.toLocaleString()).not.toThrow();
  });
});
