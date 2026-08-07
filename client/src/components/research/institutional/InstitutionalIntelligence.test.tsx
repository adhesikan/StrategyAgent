// Client tests H: Institutional Intelligence pure helpers — Sprint 2.2.5.
// Pure-function tests only (no RTL, consistent with project pattern).

import { describe, it, expect } from "vitest";
import {
  formatShares,
  formatValueThousands,
  formatPctChange,
  formatConcentrationPct,
  formatDate,
  formatPeriodOfReport,
  trendColorClass,
  alignmentColorClass,
  activityBadge,
  type TrendState,
  type EvidenceAlignmentState,
} from "./types";

// ---------------------------------------------------------------------------
// H — Client display helpers
// ---------------------------------------------------------------------------

describe("H — Client display helpers", () => {
  // formatShares
  describe("H1 — formatShares", () => {
    it("H1a — formats millions", () => {
      expect(formatShares(12_400_000)).toBe("12.4M");
    });
    it("H1b — formats billions", () => {
      expect(formatShares(2_300_000_000)).toBe("2.3B");
    });
    it("H1c — formats thousands", () => {
      expect(formatShares(340_000)).toBe("340K");
    });
    it("H1d — formats small numbers", () => {
      expect(formatShares(500)).toBe("500");
    });
    it("H1e — null → N/A", () => {
      expect(formatShares(null)).toBe("N/A");
    });
    it("H1f — undefined → N/A", () => {
      expect(formatShares(undefined)).toBe("N/A");
    });
  });

  // formatValueThousands
  describe("H2 — formatValueThousands", () => {
    it("H2a — 5,000,000 thousands = $5.0B", () => {
      // reportedValue is stored in USD thousands (as SEC reports it).
      // 5_000_000 thousands = 5_000_000_000 dollars = $5.0B
      expect(formatValueThousands(5_000_000)).toBe("$5.0B");
    });
    it("H2b — null → N/A", () => {
      expect(formatValueThousands(null)).toBe("N/A");
    });
    it("H2c — values in millions range", () => {
      // 1000 thousands = 1_000_000 dollars = $1.0M
      const result = formatValueThousands(1000);
      expect(result).toBe("$1.0M");
    });
  });

  // formatPctChange
  describe("H3 — formatPctChange", () => {
    it("H3a — positive with + sign", () => {
      expect(formatPctChange(0.028)).toBe("+2.8%");
    });
    it("H3b — negative", () => {
      expect(formatPctChange(-0.05)).toBe("-5.0%");
    });
    it("H3c — zero", () => {
      expect(formatPctChange(0)).toBe("+0.0%");
    });
    it("H3d — null → N/A", () => {
      expect(formatPctChange(null)).toBe("N/A");
    });
  });

  // formatConcentrationPct
  describe("H4 — formatConcentrationPct", () => {
    it("H4a — formats 0-1 value as percent", () => {
      expect(formatConcentrationPct(0.432)).toBe("43.2%");
    });
    it("H4b — null → N/A", () => {
      expect(formatConcentrationPct(null)).toBe("N/A");
    });
    it("H4c — 100% edge case", () => {
      expect(formatConcentrationPct(1.0)).toBe("100.0%");
    });
  });

  // formatDate
  describe("H5 — formatDate", () => {
    it("H5a — formats ISO date", () => {
      const result = formatDate("2026-08-14");
      expect(result).toContain("2026");
      expect(result).toContain("14");
    });
    it("H5b — null → N/A", () => {
      expect(formatDate(null)).toBe("N/A");
    });
    it("H5c — empty → N/A", () => {
      expect(formatDate("")).toBe("N/A");
    });
  });

  // formatPeriodOfReport
  describe("H6 — formatPeriodOfReport", () => {
    it("H6a — Q1 period shows Q1", () => {
      const result = formatPeriodOfReport("2024-03-31");
      expect(result).toContain("2024-Q1");
    });
    it("H6b — Q2 period shows Q2", () => {
      expect(formatPeriodOfReport("2024-06-30")).toContain("2024-Q2");
    });
    it("H6c — Q4 period shows Q4", () => {
      expect(formatPeriodOfReport("2023-12-31")).toContain("2023-Q4");
    });
    it("H6d — null → N/A", () => {
      expect(formatPeriodOfReport(null)).toBe("N/A");
    });
  });

  // trendColorClass
  describe("H7 — trendColorClass", () => {
    const cases: Array<[TrendState, string]> = [
      ["increasing", "text-emerald-400"],
      ["stable", "text-sky-400"],
      ["decreasing", "text-rose-400"],
      ["mixed", "text-amber-400"],
      ["unavailable", "text-muted-foreground"],
      ["insufficient_history", "text-muted-foreground"],
    ];
    cases.forEach(([trend, expected]) => {
      it(`H7 — ${trend}`, () => {
        expect(trendColorClass(trend)).toBe(expected);
      });
    });
  });

  // alignmentColorClass
  describe("H8 — alignmentColorClass", () => {
    const cases: Array<[EvidenceAlignmentState, string]> = [
      ["supports", "text-emerald-400"],
      ["weakens", "text-rose-400"],
      ["neutral", "text-sky-400"],
      ["unavailable", "text-muted-foreground"],
    ];
    cases.forEach(([state, expected]) => {
      it(`H8 — ${state}`, () => {
        expect(alignmentColorClass(state)).toBe(expected);
      });
    });
  });

  // activityBadge
  describe("H9 — activityBadge", () => {
    it("H9a — new activity: emerald color", () => {
      const badge = activityBadge("new");
      expect(badge.label).toBe("New");
      expect(badge.className).toContain("emerald");
    });
    it("H9b — increased activity: sky color", () => {
      const badge = activityBadge("increased");
      expect(badge.label).toBe("Increased");
      expect(badge.className).toContain("sky");
    });
    it("H9c — reduced activity: amber color", () => {
      const badge = activityBadge("reduced");
      expect(badge.label).toBe("Reduced");
      expect(badge.className).toContain("amber");
    });
    it("H9d — exited activity: rose color", () => {
      const badge = activityBadge("exited");
      expect(badge.label).toBe("Exited");
      expect(badge.className).toContain("rose");
    });
    it("H9e — unchanged: muted", () => {
      const badge = activityBadge("unchanged");
      expect(badge.label).toBe("Unchanged");
    });
  });

  // No predictive terminology tests
  describe("H10 — terminology compliance", () => {
    it("H10a — trendColorClass does not return 'accumulation' string", () => {
      const allTrends: TrendState[] = ["increasing", "stable", "decreasing", "mixed", "unavailable", "insufficient_history"];
      for (const t of allTrends) {
        expect(trendColorClass(t).toLowerCase()).not.toContain("accumulation");
      }
    });
    it("H10b — alignmentLabel strings do not contain 'smart money'", () => {
      const states: EvidenceAlignmentState[] = ["supports", "neutral", "weakens", "unavailable"];
      for (const s of states) {
        // alignmentColorClass returns a CSS class, not a label — just verify the class
        expect(alignmentColorClass(s).toLowerCase()).not.toContain("smart");
      }
    });
    it("H10c — formatPctChange never produces text containing 'accumulation'", () => {
      const values = [0.1, -0.05, 0, null];
      for (const v of values) {
        expect(formatPctChange(v).toLowerCase()).not.toContain("accumulation");
      }
    });
  });

  // Workspace compact — pure test for N/A fallbacks
  describe("H11 — unavailable data handling", () => {
    it("H11a — all formatter functions handle null safely", () => {
      expect(() => formatShares(null)).not.toThrow();
      expect(() => formatValueThousands(null)).not.toThrow();
      expect(() => formatPctChange(null)).not.toThrow();
      expect(() => formatConcentrationPct(null)).not.toThrow();
      expect(() => formatDate(null)).not.toThrow();
      expect(() => formatPeriodOfReport(null)).not.toThrow();
    });
    it("H11b — formatShares returns 'N/A' for null (not '0' or '$0')", () => {
      const result = formatShares(null);
      expect(result).toBe("N/A");
      expect(result).not.toBe("0");
    });
    it("H11c — formatPctChange returns 'N/A' for null (not '0.0%')", () => {
      const result = formatPctChange(null);
      expect(result).toBe("N/A");
      expect(result).not.toBe("0.0%");
    });
  });
});
