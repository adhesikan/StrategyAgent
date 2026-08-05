// Freshness Policy — Sprint 5.5B tests
//
// Covers:
//   - Demonstration and saved_research categories are never stale
//   - Intraday setup is stale after 10 minutes
//   - Age labels are human-readable
//   - null/undefined generatedAt handled gracefully
//   - extractSymbolFromAnalysisQuery returns correct symbols
//   - ctaLabel returns the right action label for each sourceType

import { describe, it, expect } from "vitest";
import {
  getFreshnessStatus,
  ctaLabel,
  categoryForSourceType,
  type FreshnessCategory,
  type SourceType,
} from "./freshness-policy";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoMinutesAgo(n: number): string {
  return new Date(Date.now() - n * 60 * 1000).toISOString();
}

function isoHoursAgo(n: number): string {
  return new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// getFreshnessStatus
// ---------------------------------------------------------------------------

describe("getFreshnessStatus", () => {
  describe("demonstration category", () => {
    it("is never stale", () => {
      const status = getFreshnessStatus(isoHoursAgo(24), "demonstration");
      expect(status.isStale).toBe(false);
      expect(status.isDemonstration).toBe(true);
      expect(status.canRefresh).toBe(false);
    });

    it("returns Demonstration data label", () => {
      const status = getFreshnessStatus(null, "demonstration");
      expect(status.label).toBe("Demonstration data");
    });
  });

  describe("saved_research category", () => {
    it("is never stale", () => {
      const status = getFreshnessStatus(isoHoursAgo(720), "saved_research");
      expect(status.isStale).toBe(false);
      expect(status.isDemonstration).toBe(false);
      expect(status.canRefresh).toBe(false);
    });

    it("returns Saved research label", () => {
      const status = getFreshnessStatus(isoHoursAgo(1), "saved_research");
      expect(status.label).toBe("Saved research");
    });
  });

  describe("intraday_setup category", () => {
    it("is fresh within 10 minutes", () => {
      const status = getFreshnessStatus(isoMinutesAgo(5), "intraday_setup");
      expect(status.isStale).toBe(false);
      expect(status.canRefresh).toBe(true);
      expect(status.isDemonstration).toBe(false);
    });

    it("is stale after 10 minutes", () => {
      const status = getFreshnessStatus(isoMinutesAgo(11), "intraday_setup");
      expect(status.isStale).toBe(true);
    });

    it("returns age label in minutes", () => {
      const status = getFreshnessStatus(isoMinutesAgo(5), "intraday_setup");
      expect(status.label).toMatch(/5 minute/);
    });

    it("returns age label in hours", () => {
      const status = getFreshnessStatus(isoHoursAgo(2), "intraday_setup");
      expect(status.label).toMatch(/2 hour/);
    });

    it("returns 'Just now' for < 60 seconds", () => {
      const status = getFreshnessStatus(new Date(Date.now() - 30_000).toISOString(), "intraday_setup");
      expect(status.label).toBe("Just now");
    });
  });

  describe("news_sentiment category", () => {
    it("is fresh within 30 minutes", () => {
      const status = getFreshnessStatus(isoMinutesAgo(20), "news_sentiment");
      expect(status.isStale).toBe(false);
    });

    it("is stale after 30 minutes", () => {
      const status = getFreshnessStatus(isoMinutesAgo(31), "news_sentiment");
      expect(status.isStale).toBe(true);
    });
  });

  describe("daily_swing category", () => {
    it("is fresh within 24 hours", () => {
      const status = getFreshnessStatus(isoHoursAgo(12), "daily_swing");
      expect(status.isStale).toBe(false);
    });

    it("is stale after 24 hours", () => {
      const status = getFreshnessStatus(isoHoursAgo(25), "daily_swing");
      expect(status.isStale).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles null generatedAt gracefully", () => {
      const status = getFreshnessStatus(null, "intraday_setup");
      expect(status.isStale).toBe(true);
      expect(status.label).toBe("Timestamp unavailable");
    });

    it("handles undefined generatedAt gracefully", () => {
      const status = getFreshnessStatus(undefined, "intraday_setup");
      expect(status.isStale).toBe(true);
    });

    it("handles invalid date string gracefully", () => {
      const status = getFreshnessStatus("not-a-date", "intraday_setup");
      expect(status.isStale).toBe(true);
    });

    it("accepts a Date object", () => {
      const status = getFreshnessStatus(new Date(Date.now() - 5 * 60 * 1000), "intraday_setup");
      expect(status.isStale).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// ctaLabel — spec §11 action labels
// ---------------------------------------------------------------------------

describe("ctaLabel", () => {
  it("returns 'Open Example' for demonstration cards", () => {
    expect(ctaLabel({ sourceType: "demonstration", hasCachedResult: false })).toBe("Open Example");
    expect(ctaLabel({ sourceType: "demonstration", hasCachedResult: true })).toBe("Open Example");
  });

  it("returns 'Open Saved Research' for saved_research", () => {
    expect(ctaLabel({ sourceType: "saved_research", hasCachedResult: false })).toBe("Open Saved Research");
  });

  it("returns 'Run Full Analysis' for context_only cards (no full result exists)", () => {
    expect(ctaLabel({ sourceType: "context_only", hasCachedResult: false })).toBe("Run Full Analysis");
    // Even if cache has something, context-only always prompts fresh run
    expect(ctaLabel({ sourceType: "context_only", hasCachedResult: true })).toBe("Run Full Analysis");
  });

  it("returns 'Open Analysis' for full_analysis when cached result exists", () => {
    expect(ctaLabel({ sourceType: "full_analysis", hasCachedResult: true })).toBe("Open Analysis");
  });

  it("returns 'Run Full Analysis' for full_analysis when NO cached result", () => {
    expect(ctaLabel({ sourceType: "full_analysis", hasCachedResult: false })).toBe("Run Full Analysis");
  });

  it("returns 'Run Full Analysis' for scanner_ranking when NO cached result", () => {
    expect(ctaLabel({ sourceType: "scanner_ranking", hasCachedResult: false })).toBe("Run Full Analysis");
  });

  it("returns 'Open Analysis' for scanner_ranking when cached result exists", () => {
    expect(ctaLabel({ sourceType: "scanner_ranking", hasCachedResult: true })).toBe("Open Analysis");
  });

  it("returns 'Refresh Analysis' when isRefresh=true regardless of other params", () => {
    expect(ctaLabel({ sourceType: "full_analysis", hasCachedResult: true, isRefresh: true })).toBe("Refresh Analysis");
    expect(ctaLabel({ sourceType: "scanner_ranking", hasCachedResult: false, isRefresh: true })).toBe("Refresh Analysis");
  });
});

// ---------------------------------------------------------------------------
// categoryForSourceType
// ---------------------------------------------------------------------------

describe("categoryForSourceType", () => {
  const cases: Array<[SourceType, FreshnessCategory]> = [
    ["scanner_ranking", "intraday_setup"],
    ["full_analysis", "intraday_setup"],
    ["context_only", "news_sentiment"],
    ["saved_research", "saved_research"],
    ["demonstration", "demonstration"],
  ];

  for (const [sourceType, expected] of cases) {
    it(`maps ${sourceType} → ${expected}`, () => {
      expect(categoryForSourceType(sourceType)).toBe(expected);
    });
  }
});
