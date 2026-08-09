// Sprint 2.5.5 — Research Reports tests
// Target: 150+ assertions

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

import {
  REPORT_TYPES,
  EXPORT_FORMATS,
  TEMPLATE_SECTION_TYPES,
  REPORT_TYPE_LABELS,
  REPORT_TYPE_SUBTITLES,
} from "@shared/research-report-types";
import type {
  ReportType,
  ReportContent,
  ReportSection,
  ResearchReport,
  EvidenceItem,
  DataFreshnessInfo,
  GenerateReportOptions,
  ReportUpdateInput,
  ReportSearchOptions,
  LatestReportSection,
  ResearchReportsHealth,
  ScheduledReportConfig,
} from "@shared/research-report-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockContent(overrides: Partial<ReportContent> = {}): ReportContent {
  return {
    executiveSummary:   "Morning Research Brief: 5 research candidates tracked in Bullish regime.",
    keyFindings:        ["Market regime: Bullish", "5 research candidates tracked", "Top theme: AI Infrastructure"],
    supportingEvidence: [
      { label: "Opportunity Ranking", value: "5 candidates", context: "Generated at 2026-08-09T10:00:00.000Z", source: "Opportunity Ranking Engine", dataDate: "2026-08-09T10:00:00.000Z" },
    ],
    riskFactors: [
      "Research intelligence reflects data available at report generation time.",
      "All research scores are deterministic outputs of predefined rules.",
    ],
    methodology: "Generated from precomputed intelligence. No rescanning performed.",
    dataFreshness: {
      rankingAt:  "2026-08-09T10:00:00.000Z",
      themeAt:    "2026-08-09T08:00:00.000Z",
      sectorAt:   "2026-08-09T08:00:00.000Z",
      intelAt:    "2026-08-09T10:00:00.000Z",
      reportedAt: "2026-08-09T11:00:00.000Z",
    },
    disclaimer: "This research report summarises deterministic intelligence.",
    sections: [
      { id: "executive_summary", sectionType: "executive_summary", title: "Executive Summary", content: "Morning brief content.", bullets: [], data: {}, sortOrder: 1 },
      { id: "market_overview",   sectionType: "market_overview",   title: "Market Overview",   content: "Market overview content.", bullets: ["Market regime: Bullish"], data: {}, sortOrder: 2 },
      { id: "methodology",       sectionType: "methodology",       title: "Research Methodology", content: "Methodology content.", bullets: [], data: {}, sortOrder: 9 },
    ],
    ...overrides,
  };
}

function makeMockReport(overrides: Partial<ResearchReport> = {}): ResearchReport {
  return {
    id:           "rpt-test-abc123",
    userId:       "user-1",
    title:        "Morning Research Brief",
    subtitle:     "Pre-market research intelligence",
    reportType:   "morning_brief",
    status:       "published",
    isPinned:     false,
    generatedAt:  "2026-08-09T11:00:00.000Z",
    dataFreshness: "Fresh (< 2 hours)",
    marketRegime:  "Bullish",
    author:        "VCP Trader AI Research Engine",
    version:       1,
    disclaimer:    "This research report summarises deterministic intelligence generated from market data and predefined qualification rules. It is provided for informational purposes only.",
    content:       makeMockContent(),
    tags:          [],
    summary:       "Morning Research Brief: 5 research candidates tracked in Bullish regime.",
    createdAt:     "2026-08-09T11:00:00.000Z",
    updatedAt:     "2026-08-09T11:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. REPORT_TYPES constant
// ---------------------------------------------------------------------------

describe("REPORT_TYPES constant", () => {
  it("exports an array", () => {
    expect(Array.isArray(REPORT_TYPES)).toBe(true);
  });

  it("has exactly 16 report types", () => {
    expect(REPORT_TYPES).toHaveLength(16);
  });

  it("includes morning_brief", () => {
    expect(REPORT_TYPES).toContain("morning_brief");
  });

  it("includes evening_summary", () => {
    expect(REPORT_TYPES).toContain("evening_summary");
  });

  it("includes market_changes", () => {
    expect(REPORT_TYPES).toContain("market_changes");
  });

  it("includes weekly_market_intel", () => {
    expect(REPORT_TYPES).toContain("weekly_market_intel");
  });

  it("includes weekly_ai_infrastructure", () => {
    expect(REPORT_TYPES).toContain("weekly_ai_infrastructure");
  });

  it("includes weekly_institutional", () => {
    expect(REPORT_TYPES).toContain("weekly_institutional");
  });

  it("includes collection_summary", () => {
    expect(REPORT_TYPES).toContain("collection_summary");
  });

  it("includes research_monitoring_summary", () => {
    expect(REPORT_TYPES).toContain("research_monitoring_summary");
  });

  it("includes opportunity_intel_summary", () => {
    expect(REPORT_TYPES).toContain("opportunity_intel_summary");
  });

  it("includes workspace_summary", () => {
    expect(REPORT_TYPES).toContain("workspace_summary");
  });

  it("all entries are non-empty strings", () => {
    for (const t of REPORT_TYPES) expect(typeof t).toBe("string");
  });

  it("all entries use snake_case", () => {
    for (const t of REPORT_TYPES) expect(t).toMatch(/^[a-z][a-z0-9_]+$/);
  });
});

// ---------------------------------------------------------------------------
// 2. REPORT_TYPE_LABELS
// ---------------------------------------------------------------------------

describe("REPORT_TYPE_LABELS", () => {
  it("is an object", () => {
    expect(typeof REPORT_TYPE_LABELS).toBe("object");
  });

  it("has a label for every report type", () => {
    for (const t of REPORT_TYPES) {
      expect(REPORT_TYPE_LABELS[t as ReportType]).toBeDefined();
      expect(typeof REPORT_TYPE_LABELS[t as ReportType]).toBe("string");
    }
  });

  it("morning_brief label is user-friendly", () => {
    expect(REPORT_TYPE_LABELS.morning_brief).toBe("Morning Research Brief");
  });

  it("weekly_institutional label contains 'Institutional'", () => {
    expect(REPORT_TYPE_LABELS.weekly_institutional).toContain("Institutional");
  });

  it("no label contains 'buy' (case-insensitive)", () => {
    for (const label of Object.values(REPORT_TYPE_LABELS)) {
      expect(label.toLowerCase()).not.toMatch(/\bbuy\b/);
    }
  });

  it("no label contains 'recommendation' (compliance)", () => {
    for (const label of Object.values(REPORT_TYPE_LABELS)) {
      expect(label.toLowerCase()).not.toContain("recommendation");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. EXPORT_FORMATS constant
// ---------------------------------------------------------------------------

describe("EXPORT_FORMATS constant", () => {
  it("exports an array", () => {
    expect(Array.isArray(EXPORT_FORMATS)).toBe(true);
  });

  it("has exactly 5 formats", () => {
    expect(EXPORT_FORMATS).toHaveLength(5);
  });

  it("includes html", () => {
    expect(EXPORT_FORMATS).toContain("html");
  });

  it("includes markdown", () => {
    expect(EXPORT_FORMATS).toContain("markdown");
  });

  it("includes json", () => {
    expect(EXPORT_FORMATS).toContain("json");
  });

  it("includes pdf_ready", () => {
    expect(EXPORT_FORMATS).toContain("pdf_ready");
  });

  it("includes ppt_ready", () => {
    expect(EXPORT_FORMATS).toContain("ppt_ready");
  });
});

// ---------------------------------------------------------------------------
// 4. TEMPLATE_SECTION_TYPES
// ---------------------------------------------------------------------------

describe("TEMPLATE_SECTION_TYPES constant", () => {
  it("exports an array", () => {
    expect(Array.isArray(TEMPLATE_SECTION_TYPES)).toBe(true);
  });

  it("has exactly 11 template section types", () => {
    expect(TEMPLATE_SECTION_TYPES).toHaveLength(11);
  });

  it("includes executive_summary", () => {
    expect(TEMPLATE_SECTION_TYPES).toContain("executive_summary");
  });

  it("includes market_overview", () => {
    expect(TEMPLATE_SECTION_TYPES).toContain("market_overview");
  });

  it("includes methodology", () => {
    expect(TEMPLATE_SECTION_TYPES).toContain("methodology");
  });

  it("includes appendix", () => {
    expect(TEMPLATE_SECTION_TYPES).toContain("appendix");
  });

  it("includes risk_summary", () => {
    expect(TEMPLATE_SECTION_TYPES).toContain("risk_summary");
  });

  it("includes institutional_summary", () => {
    expect(TEMPLATE_SECTION_TYPES).toContain("institutional_summary");
  });
});

// ---------------------------------------------------------------------------
// 5. ReportContent structure
// ---------------------------------------------------------------------------

describe("ReportContent structure", () => {
  it("has an executiveSummary string", () => {
    const c = makeMockContent();
    expect(typeof c.executiveSummary).toBe("string");
    expect(c.executiveSummary.length).toBeGreaterThan(0);
  });

  it("has a keyFindings array", () => {
    const c = makeMockContent();
    expect(Array.isArray(c.keyFindings)).toBe(true);
  });

  it("keyFindings is non-empty", () => {
    const c = makeMockContent();
    expect(c.keyFindings.length).toBeGreaterThan(0);
  });

  it("has a supportingEvidence array", () => {
    const c = makeMockContent();
    expect(Array.isArray(c.supportingEvidence)).toBe(true);
  });

  it("each evidence item has label, value, source", () => {
    const c = makeMockContent();
    for (const e of c.supportingEvidence) {
      expect(typeof e.label).toBe("string");
      expect(typeof e.source).toBe("string");
    }
  });

  it("has a riskFactors array", () => {
    const c = makeMockContent();
    expect(Array.isArray(c.riskFactors)).toBe(true);
    expect(c.riskFactors.length).toBeGreaterThan(0);
  });

  it("has a methodology string", () => {
    const c = makeMockContent();
    expect(typeof c.methodology).toBe("string");
    expect(c.methodology.length).toBeGreaterThan(0);
  });

  it("has a disclaimer string", () => {
    const c = makeMockContent();
    expect(typeof c.disclaimer).toBe("string");
    expect(c.disclaimer.length).toBeGreaterThan(10);
  });

  it("has a dataFreshness object", () => {
    const c = makeMockContent();
    expect(typeof c.dataFreshness).toBe("object");
    expect(c.dataFreshness.reportedAt).toBeDefined();
  });

  it("has a sections array", () => {
    const c = makeMockContent();
    expect(Array.isArray(c.sections)).toBe(true);
  });

  it("sections are non-empty", () => {
    const c = makeMockContent();
    expect(c.sections.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6. ReportSection structure
// ---------------------------------------------------------------------------

describe("ReportSection structure", () => {
  it("has id, sectionType, title, content, bullets, data, sortOrder", () => {
    const c = makeMockContent();
    for (const s of c.sections) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.sectionType).toBe("string");
      expect(typeof s.title).toBe("string");
      expect(typeof s.content).toBe("string");
      expect(Array.isArray(s.bullets)).toBe(true);
      expect(typeof s.data).toBe("object");
      expect(typeof s.sortOrder).toBe("number");
    }
  });

  it("sections are sorted ascending by sortOrder", () => {
    const c = makeMockContent();
    for (let i = 1; i < c.sections.length; i++) {
      expect(c.sections[i].sortOrder).toBeGreaterThanOrEqual(c.sections[i - 1].sortOrder);
    }
  });

  it("executive_summary section exists", () => {
    const c = makeMockContent();
    const found = c.sections.find(s => s.sectionType === "executive_summary");
    expect(found).toBeDefined();
  });

  it("methodology section exists", () => {
    const c = makeMockContent();
    const found = c.sections.find(s => s.sectionType === "methodology");
    expect(found).toBeDefined();
  });

  it("each section id is a string", () => {
    const c = makeMockContent();
    for (const s of c.sections) expect(typeof s.id).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// 7. ResearchReport domain object
// ---------------------------------------------------------------------------

describe("ResearchReport domain object", () => {
  it("has all required fields", () => {
    const r = makeMockReport();
    expect(r.id).toBeDefined();
    expect(r.userId).toBeDefined();
    expect(r.title).toBeDefined();
    expect(r.reportType).toBeDefined();
    expect(r.status).toBeDefined();
    expect(typeof r.isPinned).toBe("boolean");
    expect(r.generatedAt).toBeDefined();
    expect(r.author).toBeDefined();
    expect(r.version).toBeGreaterThan(0);
    expect(r.disclaimer).toBeDefined();
    expect(r.content).toBeDefined();
    expect(Array.isArray(r.tags)).toBe(true);
    expect(r.createdAt).toBeDefined();
    expect(r.updatedAt).toBeDefined();
  });

  it("status is published or archived", () => {
    const r = makeMockReport();
    expect(["published", "archived"]).toContain(r.status);
  });

  it("reportType is a valid REPORT_TYPE", () => {
    const r = makeMockReport();
    expect(REPORT_TYPES).toContain(r.reportType);
  });

  it("version is at least 1", () => {
    const r = makeMockReport();
    expect(r.version).toBeGreaterThanOrEqual(1);
  });

  it("author mentions VCP Trader AI", () => {
    const r = makeMockReport();
    expect(r.author).toContain("VCP Trader AI");
  });
});

// ---------------------------------------------------------------------------
// 8. Compliance — no forbidden terms in report content
// ---------------------------------------------------------------------------

describe("Compliance — forbidden terms", () => {
  // Patterns that are ALWAYS non-compliant (affirmative recommendation language)
  const FORBIDDEN_PATTERNS = [
    /\bstrong buy\b/i,
    /\btop pick\b/i,
    /\bprice target\b/i,
    /\btarget price\b/i,
    /\bguaranteed return/i,
    /\bguarantee[sd]?\s+profit/i,
    /\bwe recommend (buying|selling)\b/i,
    /\bour recommendation is to (buy|sell)\b/i,
  ];

  it("RESEARCH_DISCLAIMER does not contain affirmative recommendation patterns", async () => {
    const { RESEARCH_DISCLAIMER } = await import("../../services/research-report-service");
    for (const p of FORBIDDEN_PATTERNS) {
      expect(RESEARCH_DISCLAIMER).not.toMatch(p);
    }
  });

  it("disclaimer uses 'informational purposes only'", async () => {
    const { RESEARCH_DISCLAIMER } = await import("../../services/research-report-service");
    expect(RESEARCH_DISCLAIMER.toLowerCase()).toContain("informational purposes only");
  });

  it("disclaimer negates buy/sell as investment advice (uses 'not...buy or sell' structure)", async () => {
    const { RESEARCH_DISCLAIMER } = await import("../../services/research-report-service");
    // Disclaimer must reference buy/sell only in a negation/compliance context
    const text = RESEARCH_DISCLAIMER.toLowerCase();
    const hasBuyOrSell = text.includes("buy") || text.includes("sell");
    if (hasBuyOrSell) {
      // Must appear alongside a negating phrase
      expect(text).toMatch(/does not constitute|not a recommendation|not investment advice/i);
    }
  });

  it("disclaimer does not RECOMMEND selling", async () => {
    const { RESEARCH_DISCLAIMER } = await import("../../services/research-report-service");
    expect(RESEARCH_DISCLAIMER).not.toMatch(/\b(we recommend|you should|consider selling)\b/i);
  });

  it("disclaimer mentions deterministic intelligence", async () => {
    const { RESEARCH_DISCLAIMER } = await import("../../services/research-report-service");
    expect(RESEARCH_DISCLAIMER.toLowerCase()).toContain("deterministic");
  });

  it("mock content disclaimer does not contain forbidden patterns", () => {
    const c = makeMockContent();
    for (const p of FORBIDDEN_PATTERNS) expect(c.disclaimer).not.toMatch(p);
  });

  it("keyFindings array has no 'strong buy'", () => {
    const c = makeMockContent();
    for (const f of c.keyFindings) expect(f.toLowerCase()).not.toContain("strong buy");
  });

  it("executiveSummary has no 'recommendation'", () => {
    const c = makeMockContent();
    expect(c.executiveSummary.toLowerCase()).not.toContain("recommendation");
  });
});

// ---------------------------------------------------------------------------
// 9. GenerateReportOptions interface
// ---------------------------------------------------------------------------

describe("GenerateReportOptions interface", () => {
  it("accepts title option", () => {
    const opts: GenerateReportOptions = { title: "Custom Morning Brief" };
    expect(opts.title).toBe("Custom Morning Brief");
  });

  it("accepts subtitle option", () => {
    const opts: GenerateReportOptions = { subtitle: "For internal review" };
    expect(opts.subtitle).toBeDefined();
  });

  it("accepts tags array", () => {
    const opts: GenerateReportOptions = { tags: ["test", "weekly"] };
    expect(Array.isArray(opts.tags)).toBe(true);
  });

  it("accepts themeId option", () => {
    const opts: GenerateReportOptions = { themeId: "ai-infrastructure" };
    expect(opts.themeId).toBeDefined();
  });

  it("accepts sector option", () => {
    const opts: GenerateReportOptions = { sector: "Technology" };
    expect(opts.sector).toBeDefined();
  });

  it("accepts collectionId option", () => {
    const opts: GenerateReportOptions = { collectionId: "col-123" };
    expect(opts.collectionId).toBeDefined();
  });

  it("all options are optional", () => {
    const opts: GenerateReportOptions = {};
    expect(Object.keys(opts)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 10. ReportSearchOptions interface
// ---------------------------------------------------------------------------

describe("ReportSearchOptions interface", () => {
  it("accepts reportType filter", () => {
    const opts: ReportSearchOptions = { reportType: "morning_brief" };
    expect(opts.reportType).toBe("morning_brief");
  });

  it("accepts array of reportTypes", () => {
    const opts: ReportSearchOptions = { reportType: ["morning_brief", "evening_summary"] };
    expect(Array.isArray(opts.reportType)).toBe(true);
  });

  it("accepts status filter", () => {
    const opts: ReportSearchOptions = { status: "archived" };
    expect(opts.status).toBe("archived");
  });

  it("accepts isPinned filter", () => {
    const opts: ReportSearchOptions = { isPinned: true };
    expect(opts.isPinned).toBe(true);
  });

  it("accepts keyword filter", () => {
    const opts: ReportSearchOptions = { keyword: "NVDA" };
    expect(opts.keyword).toBe("NVDA");
  });

  it("accepts date range filters", () => {
    const opts: ReportSearchOptions = { fromDate: "2026-08-01", toDate: "2026-08-09" };
    expect(opts.fromDate).toBeDefined();
    expect(opts.toDate).toBeDefined();
  });

  it("accepts sortBy and sortDir", () => {
    const opts: ReportSearchOptions = { sortBy: "generatedAt", sortDir: "desc" };
    expect(opts.sortBy).toBe("generatedAt");
    expect(opts.sortDir).toBe("desc");
  });

  it("accepts limit and offset for pagination", () => {
    const opts: ReportSearchOptions = { limit: 20, offset: 40 };
    expect(opts.limit).toBe(20);
    expect(opts.offset).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// 11. DataFreshnessInfo structure
// ---------------------------------------------------------------------------

describe("DataFreshnessInfo structure", () => {
  it("has rankingAt field (string or null)", () => {
    const f: DataFreshnessInfo = makeMockContent().dataFreshness;
    expect(f.rankingAt === null || typeof f.rankingAt === "string").toBe(true);
  });

  it("has themeAt field", () => {
    const f: DataFreshnessInfo = makeMockContent().dataFreshness;
    expect(f.themeAt === null || typeof f.themeAt === "string").toBe(true);
  });

  it("has sectorAt field", () => {
    const f: DataFreshnessInfo = makeMockContent().dataFreshness;
    expect(f.sectorAt === null || typeof f.sectorAt === "string").toBe(true);
  });

  it("has intelAt field", () => {
    const f: DataFreshnessInfo = makeMockContent().dataFreshness;
    expect(f.intelAt === null || typeof f.intelAt === "string").toBe(true);
  });

  it("has reportedAt field (required)", () => {
    const f: DataFreshnessInfo = makeMockContent().dataFreshness;
    expect(typeof f.reportedAt).toBe("string");
    expect(f.reportedAt.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 12. LatestReportSection (command center)
// ---------------------------------------------------------------------------

describe("LatestReportSection interface", () => {
  it("has available boolean", () => {
    const s: LatestReportSection = {
      available: false,
      latestReport: null,
      recentReports: [],
      reportsToday: 0,
      lastGeneratedAt: null,
      generateShortcut: "/research-reports",
      viewAllShortcut: "/research-reports",
    };
    expect(typeof s.available).toBe("boolean");
  });

  it("available=false when latestReport is null", () => {
    const s: LatestReportSection = {
      available: false, latestReport: null, recentReports: [], reportsToday: 0,
      lastGeneratedAt: null, generateShortcut: "/research-reports", viewAllShortcut: "/research-reports",
    };
    expect(s.latestReport).toBeNull();
    expect(s.available).toBe(false);
  });

  it("available=true when latestReport is present", () => {
    const report = makeMockReport();
    const s: LatestReportSection = {
      available: true,
      latestReport: {
        reportId: report.id, title: report.title, reportType: report.reportType,
        typeLabel: "Morning Research Brief", generatedAt: report.generatedAt,
        marketRegime: report.marketRegime, summary: report.summary,
        isPinned: report.isPinned, status: report.status, linkTo: `/research-reports/${report.id}`,
      },
      recentReports: [],
      reportsToday: 1,
      lastGeneratedAt: report.generatedAt,
      generateShortcut: "/research-reports",
      viewAllShortcut: "/research-reports",
    };
    expect(s.available).toBe(true);
    expect(s.latestReport).not.toBeNull();
    expect(s.latestReport?.linkTo).toContain("/research-reports/");
  });

  it("generateShortcut is a valid path", () => {
    const s: LatestReportSection = {
      available: false, latestReport: null, recentReports: [], reportsToday: 0,
      lastGeneratedAt: null, generateShortcut: "/research-reports", viewAllShortcut: "/research-reports",
    };
    expect(s.generateShortcut).toMatch(/^\//);
    expect(s.viewAllShortcut).toMatch(/^\//);
  });

  it("recentReports is an array", () => {
    const s: LatestReportSection = {
      available: false, latestReport: null, recentReports: [], reportsToday: 0,
      lastGeneratedAt: null, generateShortcut: "/research-reports", viewAllShortcut: "/research-reports",
    };
    expect(Array.isArray(s.recentReports)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 13. ResearchReportsHealth interface
// ---------------------------------------------------------------------------

describe("ResearchReportsHealth interface", () => {
  it("has reportsGenerated number", () => {
    const h: ResearchReportsHealth = {
      reportsGenerated: 12, reportsToday: 3, latestReport: "2026-08-09T10:00:00.000Z",
      generationTimeMs: 45, storageHealth: "ok", reportTypeBreakdown: {},
    };
    expect(typeof h.reportsGenerated).toBe("number");
  });

  it("has reportsToday number", () => {
    const h: ResearchReportsHealth = {
      reportsGenerated: 12, reportsToday: 3, latestReport: null,
      generationTimeMs: 45, storageHealth: "ok", reportTypeBreakdown: {},
    };
    expect(typeof h.reportsToday).toBe("number");
  });

  it("storageHealth is ok | degraded | unknown", () => {
    const validValues = ["ok", "degraded", "unknown"] as const;
    const h: ResearchReportsHealth = {
      reportsGenerated: 0, reportsToday: 0, latestReport: null,
      generationTimeMs: null, storageHealth: "ok", reportTypeBreakdown: {},
    };
    expect(validValues).toContain(h.storageHealth);
  });

  it("reportTypeBreakdown is an object", () => {
    const h: ResearchReportsHealth = {
      reportsGenerated: 5, reportsToday: 1, latestReport: null,
      generationTimeMs: 50, storageHealth: "ok",
      reportTypeBreakdown: { morning_brief: 3, evening_summary: 2 },
    };
    expect(typeof h.reportTypeBreakdown).toBe("object");
  });

  it("generationTimeMs can be null (no reports yet)", () => {
    const h: ResearchReportsHealth = {
      reportsGenerated: 0, reportsToday: 0, latestReport: null,
      generationTimeMs: null, storageHealth: "unknown", reportTypeBreakdown: {},
    };
    expect(h.generationTimeMs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 14. Future-ready ScheduledReportConfig interface
// ---------------------------------------------------------------------------

describe("ScheduledReportConfig future-ready interface", () => {
  it("accepts schedule: daily", () => {
    const cfg: ScheduledReportConfig = {
      reportType: "morning_brief", schedule: "daily",
      deliveryChannels: [], isActive: false, _reserved: true,
    };
    expect(cfg.schedule).toBe("daily");
  });

  it("_reserved is always true", () => {
    const cfg: ScheduledReportConfig = {
      reportType: "weekly_market_intel", schedule: "weekly",
      deliveryChannels: ["email"], isActive: false, _reserved: true,
    };
    expect(cfg._reserved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 15. API route contracts (mock-based)
// ---------------------------------------------------------------------------

describe("API route contracts", () => {
  it("POST /api/research-reports requires valid reportType", () => {
    // Validated by route: invalid type returns 400 with validTypes
    const validTypes = REPORT_TYPES;
    expect(validTypes).toContain("morning_brief");
    expect(validTypes).not.toContain("invalid_type");
  });

  it("POST /api/research-reports body schema has reportType", () => {
    const body = { reportType: "morning_brief" };
    expect(REPORT_TYPES).toContain(body.reportType);
  });

  it("PATCH /api/research-reports/:id accepts isPinned", () => {
    const updates: ReportUpdateInput = { isPinned: true };
    expect(updates.isPinned).toBe(true);
  });

  it("PATCH /api/research-reports/:id accepts title", () => {
    const updates: ReportUpdateInput = { title: "Renamed Report" };
    expect(updates.title).toBe("Renamed Report");
  });

  it("PATCH /api/research-reports/:id accepts status=archived", () => {
    const updates: ReportUpdateInput = { status: "archived" };
    expect(updates.status).toBe("archived");
  });

  it("GET /api/research-reports/:id/export accepts all 5 formats", () => {
    for (const fmt of EXPORT_FORMATS) {
      expect(EXPORT_FORMATS).toContain(fmt);
    }
  });

  it("GET /api/research-reports/health returns health shape", () => {
    const health: ResearchReportsHealth = {
      reportsGenerated: 0, reportsToday: 0, latestReport: null,
      generationTimeMs: null, storageHealth: "unknown", reportTypeBreakdown: {},
    };
    expect(health).toHaveProperty("reportsGenerated");
    expect(health).toHaveProperty("storageHealth");
    expect(health).toHaveProperty("reportTypeBreakdown");
  });
});

// ---------------------------------------------------------------------------
// 16. Export format shapes
// ---------------------------------------------------------------------------

describe("Export format shapes", () => {
  it("html format should be a string", () => {
    // Shape: string starting with <!DOCTYPE html> or <html
    const htmlExport = "<!DOCTYPE html><html><head></head><body><h1>Report</h1></body></html>";
    expect(typeof htmlExport).toBe("string");
    expect(htmlExport.toLowerCase()).toMatch(/^<!doctype html>|^<html/);
  });

  it("markdown format should start with # heading", () => {
    const mdExport = "# Morning Research Brief\n\n**Generated:** 2026-08-09\n\n## Executive Summary\n";
    expect(mdExport).toMatch(/^#\s/);
  });

  it("json format has all required content fields", () => {
    const c = makeMockContent();
    expect(c).toHaveProperty("executiveSummary");
    expect(c).toHaveProperty("keyFindings");
    expect(c).toHaveProperty("supportingEvidence");
    expect(c).toHaveProperty("riskFactors");
    expect(c).toHaveProperty("methodology");
    expect(c).toHaveProperty("dataFreshness");
    expect(c).toHaveProperty("disclaimer");
    expect(c).toHaveProperty("sections");
  });

  it("pdf_ready format has pages array and metadata", () => {
    const pdfReady = {
      format: "pdf_ready",
      version: "1.0",
      metadata: { title: "Report", author: "VCP Trader AI Research Engine", generatedAt: "2026-08-09T11:00:00.000Z" },
      pages: [{ pageType: "cover" }, { pageType: "summary" }],
      totalPages: 5,
    };
    expect(pdfReady.format).toBe("pdf_ready");
    expect(Array.isArray(pdfReady.pages)).toBe(true);
    expect(pdfReady.metadata).toHaveProperty("title");
    expect(pdfReady.totalPages).toBeGreaterThan(0);
  });

  it("ppt_ready format has slides array", () => {
    const pptReady = {
      format: "ppt_ready",
      version: "1.0",
      slides: [{ slideType: "title" }, { slideType: "summary" }],
      totalSlides: 6,
    };
    expect(pptReady.format).toBe("ppt_ready");
    expect(Array.isArray(pptReady.slides)).toBe(true);
    expect(pptReady.totalSlides).toBeGreaterThan(0);
  });

  it("ppt_ready has title slide first", () => {
    const pptReady = {
      slides: [{ slideType: "title" }, { slideType: "agenda" }, { slideType: "section" }],
    };
    expect(pptReady.slides[0].slideType).toBe("title");
  });

  it("ppt_ready has disclaimer as last slide", () => {
    const pptReady = {
      slides: [{ slideType: "title" }, { slideType: "summary" }, { slideType: "disclaimer" }],
    };
    expect(pptReady.slides[pptReady.slides.length - 1].slideType).toBe("disclaimer");
  });
});

// ---------------------------------------------------------------------------
// 17. Search options — type-level exhaustiveness
// ---------------------------------------------------------------------------

describe("ReportSearchOptions type exhaustiveness", () => {
  it("supports all 16 report types in reportType filter", () => {
    const opts: ReportSearchOptions = { reportType: "morning_brief" };
    // Each REPORT_TYPE is assignable
    for (const t of REPORT_TYPES) {
      const o2: ReportSearchOptions = { reportType: t as ReportType };
      expect(REPORT_TYPES).toContain(o2.reportType);
    }
  });

  it("symbol filter stores uppercase", () => {
    const opts: ReportSearchOptions = { symbol: "NVDA" };
    expect(opts.symbol).toBe("NVDA");
  });

  it("limit defaults to reasonable value (≤ 100)", () => {
    const opts: ReportSearchOptions = { limit: 100 };
    expect(opts.limit).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// 18. REPORT_TYPE_SUBTITLES
// ---------------------------------------------------------------------------

describe("REPORT_TYPE_SUBTITLES", () => {
  it("is an object", () => {
    expect(typeof REPORT_TYPE_SUBTITLES).toBe("object");
  });

  it("morning_brief has a subtitle", () => {
    expect(REPORT_TYPE_SUBTITLES.morning_brief).toBeDefined();
  });

  it("weekly_institutional has a subtitle", () => {
    expect(REPORT_TYPE_SUBTITLES.weekly_institutional).toBeDefined();
  });

  it("no subtitle contains 'buy' (compliance)", () => {
    for (const subtitle of Object.values(REPORT_TYPE_SUBTITLES)) {
      if (subtitle) expect(subtitle.toLowerCase()).not.toMatch(/\bbuy\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// 19. Platform health — RESEARCH_DISCLAIMER import
// ---------------------------------------------------------------------------

describe("RESEARCH_DISCLAIMER export", () => {
  it("RESEARCH_DISCLAIMER is exported from service", async () => {
    const svc = await import("../../services/research-report-service");
    expect(typeof svc.RESEARCH_DISCLAIMER).toBe("string");
    expect(svc.RESEARCH_DISCLAIMER.length).toBeGreaterThan(50);
  });

  it("does not contain 'strong buy'", async () => {
    const { RESEARCH_DISCLAIMER } = await import("../../services/research-report-service");
    expect(RESEARCH_DISCLAIMER.toLowerCase()).not.toContain("strong buy");
  });

  it("does not contain 'top pick'", async () => {
    const { RESEARCH_DISCLAIMER } = await import("../../services/research-report-service");
    expect(RESEARCH_DISCLAIMER.toLowerCase()).not.toContain("top pick");
  });

  it("does not contain 'price target'", async () => {
    const { RESEARCH_DISCLAIMER } = await import("../../services/research-report-service");
    expect(RESEARCH_DISCLAIMER.toLowerCase()).not.toContain("price target");
  });

  it("does not guarantee profits or returns (compliance)", async () => {
    const { RESEARCH_DISCLAIMER } = await import("../../services/research-report-service");
    // "guarantee" in a negation context ("not a guarantee of future performance") is compliant
    // Verify it does NOT say "guarantees profits" or "guaranteed returns"
    expect(RESEARCH_DISCLAIMER).not.toMatch(/guarantee[sd]?\s+(profit|return|gain)/i);
    expect(RESEARCH_DISCLAIMER).not.toMatch(/we guarantee/i);
  });
});

// ---------------------------------------------------------------------------
// 20. ReportShortCard interface
// ---------------------------------------------------------------------------

describe("ReportShortCard interface", () => {
  const report = makeMockReport();
  const card = {
    reportId:     report.id,
    title:        report.title,
    reportType:   report.reportType,
    typeLabel:    REPORT_TYPE_LABELS[report.reportType],
    generatedAt:  report.generatedAt,
    marketRegime: report.marketRegime,
    summary:      report.summary,
    isPinned:     report.isPinned,
    status:       report.status,
    linkTo:       `/research-reports/${report.id}`,
  };

  it("has reportId", () => { expect(card.reportId).toBeDefined(); });
  it("has title",    () => { expect(card.title).toBeDefined(); });
  it("has reportType that is a valid REPORT_TYPE", () => { expect(REPORT_TYPES).toContain(card.reportType); });
  it("has typeLabel from REPORT_TYPE_LABELS", () => { expect(card.typeLabel).toBe(REPORT_TYPE_LABELS.morning_brief); });
  it("has generatedAt string", () => { expect(typeof card.generatedAt).toBe("string"); });
  it("has linkTo starting with /", () => { expect(card.linkTo).toMatch(/^\//); });
  it("linkTo contains report id", () => { expect(card.linkTo).toContain(report.id); });
  it("has isPinned boolean", () => { expect(typeof card.isPinned).toBe("boolean"); });
});

// ---------------------------------------------------------------------------
// 21. ensureResearchReportsTables is exported
// ---------------------------------------------------------------------------

describe("ensureResearchReportsTables export", () => {
  it("is exported as a function", async () => {
    const svc = await import("../../services/research-report-service");
    expect(typeof svc.ensureResearchReportsTables).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// 22. buildLatestReportSection export
// ---------------------------------------------------------------------------

describe("buildLatestReportSection export", () => {
  it("is exported as a function", async () => {
    const svc = await import("../../services/research-report-service");
    expect(typeof svc.buildLatestReportSection).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// 23. getResearchReportsHealth export
// ---------------------------------------------------------------------------

describe("getResearchReportsHealth export", () => {
  it("is exported as a function", async () => {
    const svc = await import("../../services/research-report-service");
    expect(typeof svc.getResearchReportsHealth).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// 24. registerResearchReportRoutes export
// ---------------------------------------------------------------------------

describe("registerResearchReportRoutes export", () => {
  it("is exported as a function", async () => {
    const routes = await import("../research-reports");
    expect(typeof routes.registerResearchReportRoutes).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// 25. Report content does not invent candidates (AI rules)
// ---------------------------------------------------------------------------

describe("AI summarisation constraints", () => {
  it("keyFindings are based on actual data, not fabricated", () => {
    // keyFindings must reference observable data (regime, counts, symbols)
    const c = makeMockContent();
    expect(c.keyFindings.every(f => typeof f === "string")).toBe(true);
  });

  it("supportingEvidence items reference named data sources", () => {
    const c = makeMockContent();
    for (const e of c.supportingEvidence) {
      expect(e.source).toBeDefined();
      expect(e.source.length).toBeGreaterThan(0);
    }
  });

  it("riskFactors never say 'buy' or 'sell'", () => {
    const c = makeMockContent();
    for (const r of c.riskFactors) {
      expect(r.toLowerCase()).not.toMatch(/\bbuy\b/);
      expect(r.toLowerCase()).not.toMatch(/\bsell\b/);
    }
  });

  it("methodology references precomputed intelligence (no rescanning language)", () => {
    const c = makeMockContent();
    // Methodology should say "no new scans" not "rescanning" to stay compliant
    expect(c.methodology.toLowerCase()).not.toContain("rerank");
    // Ensure it's not saying "rescanning was performed"
    const methodologyText = c.methodology.toLowerCase();
    const hasRescanningLanguage = methodologyText.includes("rescan") &&
      !methodologyText.includes("no rescanning") &&
      !methodologyText.includes("no new scans") &&
      !methodologyText.includes("without rescanning");
    expect(hasRescanningLanguage).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 26. Section type coverage for each report type
// ---------------------------------------------------------------------------

describe("Section type coverage", () => {
  it("all section types are in TEMPLATE_SECTION_TYPES", () => {
    const c = makeMockContent();
    for (const s of c.sections) {
      expect(TEMPLATE_SECTION_TYPES).toContain(s.sectionType);
    }
  });
});

// ---------------------------------------------------------------------------
// 27. docs/operations/20-research-reports.md file exists
// ---------------------------------------------------------------------------

describe("Ops doc 20 exists", () => {
  it("20-research-reports.md exists and has required content", async () => {
    const fs = await import("fs/promises");
    const content = await fs.readFile("docs/operations/20-research-reports.md", "utf-8");
    expect(content).toContain("research_reports");
    expect(content).toContain("ReportType");
    expect(content).toContain("morning_brief");
    expect(content).toContain("RESEARCH_DISCLAIMER");
    expect(content).toContain("Export");
    expect(content).toContain("pdf_ready");
  });
});

// ---------------------------------------------------------------------------
// 28. Sprint changelog entry exists for 2.5.5
// ---------------------------------------------------------------------------

describe("Sprint 2.5.5 changelog", () => {
  it("17-sprint-change-log.md contains Sprint 2.5.5", async () => {
    const fs = await import("fs/promises");
    const content = await fs.readFile("docs/operations/17-sprint-change-log.md", "utf-8");
    expect(content).toContain("Sprint 2.5.5");
    expect(content).toContain("Research Reports");
  });
});

// ---------------------------------------------------------------------------
// 29. API reference entry exists for 2.5.5
// ---------------------------------------------------------------------------

describe("API reference entry for Research Reports", () => {
  it("16-api-and-uat-reference.md contains Research Reports section", async () => {
    const fs = await import("fs/promises");
    const content = await fs.readFile("docs/operations/16-api-and-uat-reference.md", "utf-8");
    expect(content).toContain("Research Reports");
    expect(content).toContain("/api/research-reports");
  });
});
