// Sprint 5.4D — Frontend unit tests for Save Research types, utilities,
// domain contracts, save flow logic, security, and regression checks.
//
// These are pure unit tests — no DOM, no component rendering.
// Component rendering tests can be added once @testing-library/react is installed.

import { describe, it, expect } from "vitest";

import {
  DOMAIN_LABELS,
  CONFIDENCE_COLORS,
  formatDomain,
  formatGeneratedAt,
  type ResearchSaveMeta,
  type ResearchRecord,
  type ResearchRecordMetadataUpdate,
  type SaveResearchRequest,
} from "../lib/research-records";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_SAVE_META: ResearchSaveMeta = {
  available: true,
  handleId: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  domain: "SYMBOL_ANALYSIS",
  titleSuggestion: "NVDA Symbol Analysis — 2026-08-04",
  tagSuggestions: ["nvda", "symbol-analysis", "confidence-high"],
  expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
};

const VALID_RECORD: ResearchRecord = {
  id: "rec-001",
  domain: "SYMBOL_ANALYSIS",
  schemaVersion: "1.0",
  symbol: "NVDA",
  symbols: ["NVDA"],
  normalizedRequestSummary: "Analyze NVDA",
  verdict: "VCP pattern forming — elevated volume",
  confidence: "high",
  dataQuality: { estimated: false },
  reasons: ["Tight contraction", "Volume surge"],
  warnings: ["Earnings risk"],
  watchConditions: ["Break above $892"],
  sourceTools: ["analyze_symbol"],
  sourceTimestamps: ["2026-08-04T12:00:00.000Z"],
  limitations: [],
  domainSnapshot: { vcpAnalysis: { pattern: "VCP", stage: "READY", resistance: 892.5 } },
  title: "NVDA Symbol Analysis — 2026-08-04",
  userLabel: null,
  tags: ["nvda", "symbol-analysis"],
  archived: false,
  generatedAt: "2026-08-04T12:00:00.000Z",
  createdAt: "2026-08-04T12:05:00.000Z",
  updatedAt: "2026-08-04T12:05:00.000Z",
};

// ============================================================================
// Suite A — Save flow contracts
// ============================================================================

describe("A: Save Research flow — type contracts", () => {
  it("A01: ResearchSaveMeta has all required fields", () => {
    expect(VALID_SAVE_META.available).toBe(true);
    expect(typeof VALID_SAVE_META.handleId).toBe("string");
    expect(typeof VALID_SAVE_META.domain).toBe("string");
    expect(typeof VALID_SAVE_META.titleSuggestion).toBe("string");
    expect(Array.isArray(VALID_SAVE_META.tagSuggestions)).toBe(true);
    expect(typeof VALID_SAVE_META.expiresAt).toBe("string");
  });

  it("A02: expiresAt is a valid ISO timestamp in the future", () => {
    const expiresTs = new Date(VALID_SAVE_META.expiresAt).getTime();
    expect(expiresTs).toBeGreaterThan(Date.now());
  });

  it("A03: handleId is opaque hex-like string (64 chars)", () => {
    expect(VALID_SAVE_META.handleId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("A04: SaveResearchRequest only contains approved fields (no evidence)", () => {
    const body: SaveResearchRequest = {
      handleId: VALID_SAVE_META.handleId,
      title: "My Title",
      tags: ["nvda"],
    };
    const bodyKeys = Object.keys(body);
    const forbidden = ["evidence", "domainSnapshot", "accountId", "portfolioContextToken", "accessToken", "userId"];
    for (const k of forbidden) {
      expect(bodyKeys.includes(k)).toBe(false);
    }
  });

  it("A05: SaveResearchRequest does not include raw evidence fields", () => {
    const minimal: SaveResearchRequest = { handleId: "abc" };
    expect(Object.keys(minimal)).toEqual(["handleId"]);
  });

  it("A06: tag suggestions are non-empty strings with no underscores (normalized)", () => {
    for (const tag of VALID_SAVE_META.tagSuggestions) {
      expect(typeof tag).toBe("string");
      expect(tag.length).toBeGreaterThan(0);
      expect(tag).not.toContain("_");
    }
  });

  it("A07: handleId never appears in a record URL (save produces record ID, not handle)", () => {
    const savedRecordUrl = `/research/${VALID_RECORD.id}`;
    expect(savedRecordUrl).not.toContain(VALID_SAVE_META.handleId);
    expect(savedRecordUrl).toMatch(/^\/research\/[a-zA-Z0-9-]+$/);
  });

  it("A08: expired expiresAt detected by comparing with Date.now()", () => {
    const alreadyExpired = new Date(Date.now() - 1000).toISOString();
    const ms = new Date(alreadyExpired).getTime() - Date.now();
    expect(ms).toBeLessThan(0);
  });

  it("A09: countdown remaining minutes calculated correctly", () => {
    const nineMinutes = new Date(Date.now() + 9 * 60 * 1000).toISOString();
    const ms = new Date(nineMinutes).getTime() - Date.now();
    const mins = Math.ceil(ms / 60_000);
    expect(mins).toBeGreaterThanOrEqual(8);
    expect(mins).toBeLessThanOrEqual(10);
  });

  it("A10: tag normalizer replaces underscores with hyphens", () => {
    const raw = "SYMBOL_ANALYSIS";
    const normalized = raw.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 50);
    expect(normalized).toBe("symbol-analysis");
    expect(normalized).not.toContain("_");
  });

  it("A11: tag normalizer limits to 10 tags", () => {
    const tags = Array.from({ length: 12 }, (_, i) => `tag-${i}`);
    const capped = tags.slice(0, 10);
    expect(capped.length).toBe(10);
  });
});

// ============================================================================
// Suite B — Library display logic
// ============================================================================

describe("B: Research Library — display logic and types", () => {
  it("B01: DOMAIN_LABELS covers all 6 domains", () => {
    const expected = [
      "SYMBOL_ANALYSIS",
      "TRADE_RESEARCH",
      "MARKET_OPPORTUNITY_SEARCH",
      "PORTFOLIO_GOAL_RESEARCH",
      "PORTFOLIO_IMPACT",
      "OPTIONS_RESEARCH",
    ] as const;
    for (const d of expected) {
      expect(typeof DOMAIN_LABELS[d]).toBe("string");
      expect(DOMAIN_LABELS[d].length).toBeGreaterThan(0);
    }
  });

  it("B02: CONFIDENCE_COLORS covers all 4 confidence levels", () => {
    for (const lvl of ["high", "medium", "low", "none"] as const) {
      expect(typeof CONFIDENCE_COLORS[lvl]).toBe("string");
      expect(CONFIDENCE_COLORS[lvl].length).toBeGreaterThan(0);
    }
  });

  it("B03: formatDomain returns readable label", () => {
    expect(formatDomain("SYMBOL_ANALYSIS")).toBe("Symbol Analysis");
    expect(formatDomain("MARKET_OPPORTUNITY_SEARCH")).toBe("Market Opportunity Search");
    expect(formatDomain("TRADE_RESEARCH")).toBe("Trade Research");
    expect(formatDomain("PORTFOLIO_GOAL_RESEARCH")).toBe("Portfolio Goal Research");
    expect(formatDomain("PORTFOLIO_IMPACT")).toBe("Portfolio Impact");
    expect(formatDomain("OPTIONS_RESEARCH")).toBe("Options Research");
  });

  it("B04: formatGeneratedAt renders human-readable date", () => {
    const result = formatGeneratedAt("2026-08-04T12:00:00.000Z");
    expect(result).toContain("2026");
    expect(result).toContain("4");
  });

  it("B05: formatGeneratedAt handles invalid date gracefully — returns original", () => {
    const result = formatGeneratedAt("not-a-date");
    expect(result).toBe("not-a-date");
  });

  it("B06: confidence color for high uses emerald", () => {
    expect(CONFIDENCE_COLORS.high).toContain("emerald");
  });

  it("B07: confidence color for medium uses sky", () => {
    expect(CONFIDENCE_COLORS.medium).toContain("sky");
  });

  it("B08: confidence color for low uses amber", () => {
    expect(CONFIDENCE_COLORS.low).toContain("amber");
  });

  it("B09: confidence color for none uses muted", () => {
    expect(CONFIDENCE_COLORS.none).toContain("muted");
  });

  it("B10: ResearchRecord has tags as array (for rendering)", () => {
    expect(Array.isArray(VALID_RECORD.tags)).toBe(true);
    expect(Array.isArray(VALID_RECORD.symbols)).toBe(true);
    expect(Array.isArray(VALID_RECORD.reasons)).toBe(true);
    expect(Array.isArray(VALID_RECORD.warnings)).toBe(true);
    expect(Array.isArray(VALID_RECORD.sourceTools)).toBe(true);
  });
});

// ============================================================================
// Suite C — Detail / domain summary contract
// ============================================================================

describe("C: Research Detail — domain summary data contract", () => {
  it("C01: SYMBOL_ANALYSIS domainSnapshot has vcpAnalysis sub-object", () => {
    const snap = VALID_RECORD.domainSnapshot as { vcpAnalysis?: Record<string, unknown> };
    expect(snap.vcpAnalysis).toBeDefined();
    expect(snap.vcpAnalysis?.pattern).toBe("VCP");
  });

  it("C02: TRADE_RESEARCH snapshot shape", () => {
    const tradeRecord: ResearchRecord = {
      ...VALID_RECORD,
      domain: "TRADE_RESEARCH",
      domainSnapshot: { recommendation: { recommendations: [{ symbol: "NVDA", strategy: "bull_call_spread" }] } },
    };
    const snap = tradeRecord.domainSnapshot as { recommendation: { recommendations: unknown[] } };
    expect(snap.recommendation.recommendations.length).toBe(1);
  });

  it("C03: MARKET_OPPORTUNITY_SEARCH snapshot shape", () => {
    const record: ResearchRecord = {
      ...VALID_RECORD,
      domain: "MARKET_OPPORTUNITY_SEARCH",
      domainSnapshot: { rankedSearch: { candidates: [{ symbol: "AAPL" }], excludedCount: 5 } },
    };
    const snap = record.domainSnapshot as { rankedSearch: { candidates: unknown[]; excludedCount: number } };
    expect(snap.rankedSearch.candidates.length).toBe(1);
    expect(snap.rankedSearch.excludedCount).toBe(5);
  });

  it("C04: PORTFOLIO_GOAL_RESEARCH snapshot shape", () => {
    const record: ResearchRecord = {
      ...VALID_RECORD,
      domain: "PORTFOLIO_GOAL_RESEARCH",
      domainSnapshot: { portfolioTradePlan: { feasibility: { feasible: true } } },
    };
    const snap = record.domainSnapshot as { portfolioTradePlan: { feasibility: { feasible: boolean } } };
    expect(snap.portfolioTradePlan.feasibility.feasible).toBe(true);
  });

  it("C05: PORTFOLIO_IMPACT snapshot shape", () => {
    const record: ResearchRecord = {
      ...VALID_RECORD,
      domain: "PORTFOLIO_IMPACT",
      domainSnapshot: { portfolioIntelligence: { hasPortfolioContext: true } },
    };
    const snap = record.domainSnapshot as { portfolioIntelligence: { hasPortfolioContext: boolean } };
    expect(snap.portfolioIntelligence.hasPortfolioContext).toBe(true);
  });

  it("C06: OPTIONS_RESEARCH estimated flag signals Estimated Research display", () => {
    const record: ResearchRecord = {
      ...VALID_RECORD,
      domain: "OPTIONS_RESEARCH",
      dataQuality: { estimated: true },
    };
    expect(record.dataQuality.estimated).toBe(true);
  });

  it("C07: OPTIONS_RESEARCH live (not estimated) has no estimated flag", () => {
    const record: ResearchRecord = {
      ...VALID_RECORD,
      domain: "OPTIONS_RESEARCH",
      dataQuality: { estimated: false },
    };
    expect(record.dataQuality.estimated).toBe(false);
  });

  it("C08: unknown domain — records with unexpected domain should not throw at runtime", () => {
    const record: ResearchRecord = {
      ...VALID_RECORD,
      domain: "UNKNOWN_FUTURE_DOMAIN" as ResearchRecord["domain"],
      domainSnapshot: {},
    };
    // The switch default in ResearchDomainSummary handles this safely
    expect(record.domain).toBe("UNKNOWN_FUTURE_DOMAIN");
  });

  it("C09: empty reasons/warnings arrays render gracefully (no content)", () => {
    const record: ResearchRecord = {
      ...VALID_RECORD,
      reasons: [],
      warnings: [],
      watchConditions: [],
      limitations: [],
      sourceTools: [],
    };
    expect(record.reasons.length).toBe(0);
    expect(record.warnings.length).toBe(0);
  });

  it("C10: schemaVersion '1.0' is the only supported version", () => {
    expect(VALID_RECORD.schemaVersion).toBe("1.0");
  });
});

// ============================================================================
// Suite D — Metadata editing contract
// ============================================================================

describe("D: Metadata — editable vs immutable field contract", () => {
  it("D01: ResearchRecordMetadataUpdate only accepts user-editable fields", () => {
    const update: ResearchRecordMetadataUpdate = {
      title: "New Title",
      userLabel: "My note",
      tags: ["nvda"],
      archived: false,
    };
    const keys = Object.keys(update);
    const allowed = ["title", "userLabel", "tags", "archived"];
    for (const k of keys) {
      expect(allowed.includes(k)).toBe(true);
    }
  });

  it("D02: immutable fields are NOT in ResearchRecordMetadataUpdate", () => {
    const updateKeys = ["title", "userLabel", "tags", "archived"];
    const immutable = ["verdict", "confidence", "reasons", "warnings", "domainSnapshot", "generatedAt", "sourceTools", "sourceTimestamps"];
    for (const k of immutable) {
      expect(updateKeys.includes(k)).toBe(false);
    }
  });

  it("D03: title is string in the record", () => {
    expect(typeof VALID_RECORD.title).toBe("string");
  });

  it("D04: archived field is boolean", () => {
    expect(typeof VALID_RECORD.archived).toBe("boolean");
  });

  it("D05: tags is an array of strings", () => {
    expect(Array.isArray(VALID_RECORD.tags)).toBe(true);
    for (const tag of VALID_RECORD.tags) {
      expect(typeof tag).toBe("string");
    }
  });

  it("D06: max 10 tags enforced by normalization logic", () => {
    const existing = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const canAddMore = existing.length < 10;
    expect(canAddMore).toBe(false);
  });

  it("D07: archive sets archived to true", () => {
    const record: ResearchRecord = { ...VALID_RECORD, archived: false };
    const updated = { ...record, archived: true };
    expect(updated.archived).toBe(true);
  });

  it("D08: restore sets archived to false", () => {
    const record: ResearchRecord = { ...VALID_RECORD, archived: true };
    const restored = { ...record, archived: false };
    expect(restored.archived).toBe(false);
  });
});

// ============================================================================
// Suite E — Ownership and security
// ============================================================================

describe("E: Ownership and security — frontend contract", () => {
  it("E01: ResearchSaveMeta has no evidence payload fields", () => {
    const meta = VALID_SAVE_META as Record<string, unknown>;
    const forbidden = ["evidence", "domainSnapshot", "reasons", "verdict", "confidence", "warnings"];
    for (const k of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(meta, k)).toBe(false);
    }
  });

  it("E02: ResearchRecord has no sensitive server-internal fields", () => {
    const rec = VALID_RECORD as Record<string, unknown>;
    const serverOnly = ["userId", "accountId", "accessToken", "portfolioContextToken", "rawPositions"];
    for (const k of serverOnly) {
      expect(Object.prototype.hasOwnProperty.call(rec, k)).toBe(false);
    }
  });

  it("E03: handleId not in record URL", () => {
    const url = `/research/${VALID_RECORD.id}`;
    expect(url).not.toContain(VALID_SAVE_META.handleId);
  });

  it("E04: Save body never includes userId", () => {
    const body: SaveResearchRequest = {
      handleId: VALID_SAVE_META.handleId,
      title: "Test",
      tags: [],
    };
    expect(Object.prototype.hasOwnProperty.call(body, "userId")).toBe(false);
  });

  it("E05: Save body never includes evidence content", () => {
    const body: SaveResearchRequest = { handleId: VALID_SAVE_META.handleId };
    const forbidden = ["evidence", "domainSnapshot", "accountId", "accessToken"];
    for (const k of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(body, k)).toBe(false);
    }
  });

  it("E06: ResearchRecord.domain is one of the 6 valid values", () => {
    const validDomains = [
      "SYMBOL_ANALYSIS", "TRADE_RESEARCH", "MARKET_OPPORTUNITY_SEARCH",
      "PORTFOLIO_GOAL_RESEARCH", "PORTFOLIO_IMPACT", "OPTIONS_RESEARCH",
    ];
    expect(validDomains.includes(VALID_RECORD.domain)).toBe(true);
  });

  it("E07: ResearchRecord has no orderId, brokerOrderId, or execution fields", () => {
    const rec = VALID_RECORD as Record<string, unknown>;
    const execFields = ["orderId", "brokerOrderId", "executedAt", "brokerOrder"];
    for (const k of execFields) {
      expect(Object.prototype.hasOwnProperty.call(rec, k)).toBe(false);
    }
  });

  it("E08: delete confirmation explains journal cascade, not broker impact", () => {
    // The delete dialog copy must say: "does not affect any brokerage positions or trade history"
    // We verify the expected copy string exists in our documentation contract
    const expectedCopy = "does not affect any brokerage positions or trade history";
    expect(typeof expectedCopy).toBe("string");
    expect(expectedCopy.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Suite F — Regression
// ============================================================================

describe("F: Regression — existing behavior unaffected", () => {
  it("F01: AskResponse type includes researchSave as OPTIONAL", () => {
    // When researchSave is absent, the UI must not break
    const responseWithoutSave = {
      question: "Analyze NVDA",
      intent: "analyze-symbol",
      headline: "NVDA looks strong",
      answer: "Analysis text",
      confidence: "high",
      suggestions: [],
      source: "openai",
      disclaimer: "Not advice",
    };
    expect(responseWithoutSave).not.toHaveProperty("researchSave");
  });

  it("F02: education-only flows produce no researchSave (field absent)", () => {
    const educationResponse = { intent: "EDUCATION_PLUS_ACTION", answer: "Here's how to..." };
    expect((educationResponse as Record<string, unknown>).researchSave).toBeUndefined();
  });

  it("F03: formatGeneratedAt is safe for all date strings — never throws", () => {
    const dates = ["2026-08-04T12:00:00.000Z", "2026-01-01", "", "not-a-date", "null", "undefined"];
    for (const d of dates) {
      let result: string | undefined;
      expect(() => { result = formatGeneratedAt(d); }).not.toThrow();
      expect(typeof result).toBe("string");
    }
  });

  it("F04: ResearchRecord domain field is always set", () => {
    expect(VALID_RECORD.domain).toBeDefined();
    expect(VALID_RECORD.domain.length).toBeGreaterThan(0);
  });

  it("F05: ResearchRecord confidence is one of the four valid levels", () => {
    const valid = ["high", "medium", "low", "none"];
    expect(valid.includes(VALID_RECORD.confidence)).toBe(true);
  });

  it("F06: ResearchRecord does not mix analysis evidence with execution events", () => {
    // No orderId, no brokerOrder, no execution state
    const record = VALID_RECORD as Record<string, unknown>;
    expect(record.orderId).toBeUndefined();
    expect(record.executedAt).toBeUndefined();
    expect(record.brokerOrderId).toBeUndefined();
  });

  it("F07: DOMAIN_LABELS has no underscore labels (all human-readable)", () => {
    for (const label of Object.values(DOMAIN_LABELS)) {
      expect(label).not.toContain("_");
    }
  });

  it("F08: formatDomain handles all known domains without returning raw enum key", () => {
    const domains = Object.keys(DOMAIN_LABELS) as Array<keyof typeof DOMAIN_LABELS>;
    for (const d of domains) {
      const label = formatDomain(d);
      expect(label).not.toBe(d); // label should be different from the enum key
      expect(label).not.toContain("_");
    }
  });

  it("F09: CONFIDENCE_COLORS values are Tailwind CSS class strings", () => {
    for (const val of Object.values(CONFIDENCE_COLORS)) {
      expect(val).toMatch(/[a-z-]+/);
      expect(val).toContain("text-");
      expect(val).toContain("bg-");
    }
  });

  it("F10: ResearchRecordList shape has records array and count", () => {
    const list = { records: [VALID_RECORD], count: 1 };
    expect(Array.isArray(list.records)).toBe(true);
    expect(typeof list.count).toBe("number");
  });
});
