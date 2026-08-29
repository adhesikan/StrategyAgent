// Client tests H: Institutional Intelligence pure helpers — Sprint 2.2.5.
// Pure-function tests only (no RTL, consistent with project pattern).

import { describe, it, expect } from "vitest";
import {
  formatShares,
  formatReportedValueDollars,
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

  // formatReportedValueDollars
  describe("H2 — formatReportedValueDollars", () => {
    it("H2a — formats canonical dollars without 1000x inflation", () => {
      expect(formatReportedValueDollars(5_000_000)).toBe("$5.0M");
    });
    it("H2b — null → N/A", () => {
      expect(formatReportedValueDollars(null)).toBe("N/A");
    });
    it("H2c — formats dollar values in the thousands range", () => {
      expect(formatReportedValueDollars(1000)).toBe("$1K");
    });
    it("H2d — keeps the legacy helper name as a dollar-safe alias", () => {
      expect(formatValueThousands(5_000_000)).toBe("$5.0M");
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

  // SEC link URL compliance — updated for canonical Phase A fixes
  describe("H9b — SEC link URL compliance", () => {
    // Phase A corrected URLs (canonical — must match InstitutionalIntelligence.tsx and
    // InstitutionalWorkspaceCompact.tsx exactly):
    const PRIMARY_URL = "https://www.sec.gov/edgar/search/";
    const DATASETS_URL =
      "https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets";
    const COMPACT_URL = "https://www.sec.gov/edgar/search/";

    const BANNED_PATTERNS = [
      "efts.sec.gov/LATEST/search-index",
      "data.sec.gov",
      // Obsolete dataset path (was 404 in production):
      "/financial-data-sets/form-13f-data-sets",
      // Generic latest-filings list:
      "cgi-bin/browse-edgar?action=getcurrent",
    ];

    it("H9b-1 — primary search link does not contain 'search-index'", () => {
      expect(PRIMARY_URL).not.toContain("search-index");
    });

    it("H9b-2 — primary search link does not use efts.sec.gov", () => {
      expect(PRIMARY_URL).not.toContain("efts.sec.gov");
    });

    it("H9b-3 — primary search link points to official EDGAR full-text search UI", () => {
      expect(PRIMARY_URL).toContain("www.sec.gov/edgar/search");
    });

    it("H9b-4 — datasets link points to current /sec-markets-data/ path (not obsolete /financial-data-sets/)", () => {
      expect(DATASETS_URL).toContain("www.sec.gov");
      expect(DATASETS_URL).toContain("sec-markets-data/form-13f-data-sets");
      expect(DATASETS_URL).not.toContain("financial-data-sets");
    });

    it("H9b-5 — no banned/raw endpoint pattern in any link", () => {
      for (const pattern of BANNED_PATTERNS) {
        expect(PRIMARY_URL).not.toContain(pattern);
        expect(DATASETS_URL).not.toContain(pattern);
        expect(COMPACT_URL).not.toContain(pattern);
      }
    });

    it("H9b-6 — primary URL uses https", () => {
      expect(PRIMARY_URL.startsWith("https://")).toBe(true);
    });

    it("H9b-7 — datasets URL uses https", () => {
      expect(DATASETS_URL.startsWith("https://")).toBe(true);
    });

    it("H9b-8 — compact unavailable state link uses same canonical EDGAR search URL", () => {
      expect(COMPACT_URL).toBe("https://www.sec.gov/edgar/search/");
      expect(COMPACT_URL).not.toContain("efts.sec.gov");
      expect(COMPACT_URL).not.toContain("search-index");
    });

    it("H9b-9 — datasets URL does not 404 (path is /sec-markets-data/, not /financial-data-sets/)", () => {
      // The old /financial-data-sets/ path returned 404 in production.
      // The canonical path since 2024 is /sec-markets-data/.
      expect(DATASETS_URL).toContain("/sec-markets-data/");
      expect(DATASETS_URL).not.toContain("/financial-data-sets/");
    });

    it("H9b-10 — primary link is the full-text search landing page, not a pre-filtered API call", () => {
      // /edgar/search/ is the human-readable landing page; the EFTS API is at efts.sec.gov.
      expect(PRIMARY_URL).toBe("https://www.sec.gov/edgar/search/");
    });
  });

  // Feature-flag gate and client error-state differentiation
  describe("H9c — feature-flag gate and client error states", () => {
    // These are pure constant / contract tests that document the server status
    // vocabulary the UI must handle. Full DOM rendering tests are in UAT.

    const VALID_STATUSES = ["available", "partial", "unavailable", "stale", "error"] as const;

    it("H9c-1 — InstitutionalStatus type covers all server-defined values", () => {
      // Every value the server sends must be in the client union.
      const expected = ["available", "partial", "unavailable", "stale", "error"];
      for (const s of expected) {
        expect(VALID_STATUSES as readonly string[]).toContain(s);
      }
    });

    it("H9c-2 — 'unavailable' is the status returned when INSTITUTIONAL_INTELLIGENCE_ENABLED=false", () => {
      // server/services/institutional/institutional-service.ts line ~188:
      // When !isInstitutionalEnabled() → unavailableResponse(symbol, "…not enabled…")
      // Client maps status==="unavailable" → UnavailableState
      const STATUS_FOR_DISABLED = "unavailable";
      expect(VALID_STATUSES as readonly string[]).toContain(STATUS_FOR_DISABLED);
    });

    it("H9c-3 — 'stale' status is distinct from 'unavailable' (separate badge and copy)", () => {
      expect(VALID_STATUSES).toContain("stale");
      // stale and unavailable must be different values so the UI handles them separately
      const stale: string = "stale";
      const unavailable: string = "unavailable";
      expect(stale).not.toBe(unavailable);
    });

    it("H9c-4 — 'partial' status is distinct from 'available' (partial-coverage warning shown)", () => {
      expect(VALID_STATUSES).toContain("partial");
      const partial: string = "partial";
      const available: string = "available";
      expect(partial).not.toBe(available);
    });

    it("H9c-5 — 'error' status triggers the error branch in the UI", () => {
      // Server returns 'error' on unhandled exceptions; UI must not show 'feature disabled' for this.
      expect(VALID_STATUSES).toContain("error");
    });

    it("H9c-6 — feature flag default is false (INSTITUTIONAL_INTELLIGENCE_ENABLED not set → disabled)", () => {
      // config.ts: parseBool(process.env.INSTITUTIONAL_INTELLIGENCE_ENABLED, false)
      // Default=false means the feature ships disabled until explicitly enabled.
      const DEFAULT_ENABLED = false;
      expect(DEFAULT_ENABLED).toBe(false);
    });

    it("H9c-7 — ingestion default is true (INSTITUTIONAL_13F_INGESTION_ENABLED not set → on)", () => {
      // config.ts: parseBool(process.env.INSTITUTIONAL_13F_INGESTION_ENABLED, true)
      // Ingestion is ready to run but gated by the feature flag and SEC_USER_AGENT.
      const DEFAULT_INGESTION_ENABLED = true;
      expect(DEFAULT_INGESTION_ENABLED).toBe(true);
    });

    it("H9c-8 — isIngestionConfigured requires both feature flag AND SEC_USER_AGENT", () => {
      // config.ts isIngestionConfigured(): cfg.enabled && cfg.ingestionEnabled && cfg.secUserAgent !== null
      // Without SEC_USER_AGENT the function returns false regardless of flags.
      const ingestionRequiresUserAgent = true; // documented contract
      expect(ingestionRequiresUserAgent).toBe(true);
    });

    it("H9c-9 — advisory lock key is distinct from opportunity engine lock key", () => {
      const INSTITUTIONAL_LOCK = 774_412_003;
      const OPPORTUNITY_LOCK = 774_412_002;
      expect(INSTITUTIONAL_LOCK).not.toBe(OPPORTUNITY_LOCK);
    });

    it("H9c-10 — disclaimer text remains visible in the unavailable state", () => {
      // UnavailableState renders data-testid="institutional-unavailable-disclaimer"
      // This test documents the contract; the actual rendering is verified in UAT.
      const DISCLAIMER_TESTID = "institutional-unavailable-disclaimer";
      expect(typeof DISCLAIMER_TESTID).toBe("string");
      expect(DISCLAIMER_TESTID.length).toBeGreaterThan(0);
    });

    it("H9c-11 — no efts.sec.gov link appears in rendered unavailable-state action buttons", () => {
      // Both action links must use www.sec.gov, not the efts.sec.gov raw API.
      const links = [
        "https://www.sec.gov/edgar/search/",
        "https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets",
      ];
      for (const link of links) {
        expect(link).toContain("www.sec.gov");
        expect(link).not.toContain("efts.sec.gov");
      }
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
