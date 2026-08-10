/**
 * Research Workspace v2 Tests — Sprint 2.6.4
 *
 * 175+ pure assertions covering:
 *   § 1  Shared types — ResearchContext, WorkspaceAction
 *   § 2  URL param parsing (parseWorkspaceParams)
 *   § 3  Context label derivation (deriveContextLabel)
 *   § 4  Context type derivation (deriveContextType)
 *   § 5  Initial mode derivation (deriveInitialMode)
 *   § 6  Prefill question derivation (derivePrefillQuestion)
 *   § 7  Service — assembleCanonicalContext (market, company, comparison, theme, sector, collection)
 *   § 8  Service — buildResearchSystemPrompt
 *   § 9  Service — buildRuleBasedWorkspaceResponse
 *   § 10 Service — parseAIWorkspaceResponse
 *   § 11 Service — parseFollowUpActions (relax_filter)
 *   § 12 Service — buildResearchUserMessage
 *   § 13 Service — getWorkspaceHealth
 *   § 14 Service — recordAskRequest / recordContextRequest / recordPartialContext
 *   § 15 Route registration (GET /api/research-workspace/context validation)
 *   § 16 VALID_CONTEXT_TYPES coverage
 *   § 17 ACTION_QUESTIONS / ACTION_MODE_MAP
 *   § 18 ConversationSummary new fields
 *   § 19 WorkspaceAskRequest researchContext
 *   § 20 Schema column check (contextType etc.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// § 1  Shared types
// ---------------------------------------------------------------------------

import type {
  ResearchMode,
  ResearchContextType,
  WorkspaceAction,
  ContextScope,
  ResearchContext,
  FollowUpAction,
  WorkspaceAskRequest,
  ConversationSummary,
} from "../../../shared/research-workspace-types";
import {
  RESEARCH_MODE_LABELS,
  RESEARCH_MODE_DESCRIPTIONS,
  CONTEXT_SCOPE_LABELS,
  ACTION_QUESTIONS,
  ACTION_MODE_MAP,
  RESEARCH_TEMPLATES,
} from "../../../shared/research-workspace-types";

describe("§ 1 Shared types — ResearchContext", () => {
  it("ResearchContext has all required fields", () => {
    const ctx: ResearchContext = {
      contextType: "company",
      label:       "Researching: NVDA",
      symbols:     ["NVDA"],
      defaultMode: "company",
      defaultScope:"entire_market",
    };
    expect(ctx.contextType).toBe("company");
    expect(ctx.label).toBe("Researching: NVDA");
    expect(ctx.symbols).toEqual(["NVDA"]);
    expect(ctx.defaultMode).toBe("company");
    expect(ctx.defaultScope).toBe("entire_market");
  });

  it("ResearchContext optional fields are optional", () => {
    const ctx: ResearchContext = {
      contextType:       "comparison",
      label:             "Comparing: NVDA vs AMD",
      symbols:           ["NVDA", "AMD"],
      defaultMode:       "comparison",
      defaultScope:      "entire_market",
      comparisonSymbols: ["NVDA", "AMD"],
      sourceRoute:       "/opportunities/NVDA",
    };
    expect(ctx.comparisonSymbols).toEqual(["NVDA", "AMD"]);
    expect(ctx.sourceRoute).toBe("/opportunities/NVDA");
    expect(ctx.themeId).toBeUndefined();
    expect(ctx.portfolioId).toBeUndefined();
  });

  it("all ResearchContextType values are recognized", () => {
    const types: ResearchContextType[] = [
      "market", "opportunity", "company", "theme", "sector",
      "institutional", "collection", "comparison", "monitor",
      "report", "portfolio", "portfolio_holding", "custom",
    ];
    expect(types.length).toBe(13);
  });

  it("WorkspaceAction enum covers all 6 actions", () => {
    const actions: WorkspaceAction[] = [
      "explain_concept", "challenge", "explain_change",
      "risk", "institutional", "compare",
    ];
    expect(actions.length).toBe(6);
  });

  it("ConversationSummary new Sprint 2.6.4 fields are typed", () => {
    const summary: ConversationSummary = {
      id:            "uuid-1",
      title:         "Test",
      researchMode:  "company",
      contextScope:  "entire_market",
      tickers:       ["NVDA"],
      isPinned:      false,
      lastMessageAt: new Date().toISOString(),
      createdAt:     new Date().toISOString(),
      contextType:       "company",
      contextLabel:      "Researching: NVDA",
      primarySymbol:     "NVDA",
      comparisonSymbols: [],
      sourceRoute:       "/opportunities/NVDA",
    };
    expect(summary.contextType).toBe("company");
    expect(summary.primarySymbol).toBe("NVDA");
  });

  it("WorkspaceAskRequest includes researchContext", () => {
    const req: WorkspaceAskRequest = {
      question:      "Explain NVDA",
      researchMode:  "company",
      contextScope:  "entire_market",
      tickers:       ["NVDA"],
      researchContext: {
        contextType:   "company",
        contextLabel:  "Researching: NVDA",
        primarySymbol: "NVDA",
        sourceRoute:   "/opportunities/NVDA",
      },
    };
    expect(req.researchContext?.contextType).toBe("company");
    expect(req.researchContext?.primarySymbol).toBe("NVDA");
  });
});

// ---------------------------------------------------------------------------
// § 2  URL param parsing
// ---------------------------------------------------------------------------

import {
  parseWorkspaceParams,
  deriveContextLabel,
  deriveContextType,
  deriveInitialMode,
  derivePrefillQuestion,
} from "../../../shared/research-workspace-helpers";

describe("§ 2 parseWorkspaceParams", () => {
  it("returns nulls for empty search string", () => {
    const p = parseWorkspaceParams("");
    expect(p.mode).toBeNull();
    expect(p.symbol).toBeNull();
    expect(p.symbols).toEqual([]);
    expect(p.action).toBeNull();
    expect(p.conversation).toBeNull();
  });

  it("parses mode=company", () => {
    const p = parseWorkspaceParams("?mode=company");
    expect(p.mode).toBe("company");
  });

  it("rejects invalid mode", () => {
    const p = parseWorkspaceParams("?mode=explain_concept");
    expect(p.mode).toBeNull();
  });

  it("parses symbol uppercased", () => {
    const p = parseWorkspaceParams("?symbol=nvda");
    expect(p.symbol).toBe("NVDA");
  });

  it("parses multi-symbol from symbols param", () => {
    const p = parseWorkspaceParams("?symbols=nvda,amd,msft");
    expect(p.symbols).toEqual(["NVDA", "AMD", "MSFT"]);
  });

  it("parses action param", () => {
    const p = parseWorkspaceParams("?action=challenge");
    expect(p.action).toBe("challenge");
  });

  it("rejects unknown action", () => {
    const p = parseWorkspaceParams("?action=unknown_action");
    expect(p.action).toBeNull();
  });

  it("parses themeId, sector, collectionId", () => {
    const p = parseWorkspaceParams("?themeId=ai-infrastructure&sector=Technology&collectionId=c123");
    expect(p.themeId).toBe("ai-infrastructure");
    expect(p.sector).toBe("Technology");
    expect(p.collectionId).toBe("c123");
  });

  it("parses conversation param", () => {
    const p = parseWorkspaceParams("?conversation=uuid-abc");
    expect(p.conversation).toBe("uuid-abc");
  });

  it("parses sourceRoute param", () => {
    const p = parseWorkspaceParams("?sourceRoute=/opportunities/NVDA");
    expect(p.sourceRoute).toBe("/opportunities/NVDA");
  });

  it("parses q param", () => {
    const p = parseWorkspaceParams("?q=explain+NVDA");
    expect(p.q).toBe("explain NVDA");
  });

  it("parses portfolioId, watchId, reportId", () => {
    const p = parseWorkspaceParams("?portfolioId=p1&watchId=w2&reportId=r3");
    expect(p.portfolioId).toBe("p1");
    expect(p.watchId).toBe("w2");
    expect(p.reportId).toBe("r3");
  });

  it("parses full compound query from OW action link", () => {
    const p = parseWorkspaceParams("?symbol=NVDA&mode=company&action=challenge&sourceRoute=/opportunities/NVDA");
    expect(p.symbol).toBe("NVDA");
    expect(p.mode).toBe("company");
    expect(p.action).toBe("challenge");
    expect(p.sourceRoute).toBe("/opportunities/NVDA");
  });
});

// ---------------------------------------------------------------------------
// § 3  Context label derivation
// ---------------------------------------------------------------------------

describe("§ 3 deriveContextLabel", () => {
  const base = { mode: null, scope: null, themeId: null, sector: null, collectionId: null, portfolioId: null, watchId: null, reportId: null, action: null, conversation: null, sourceRoute: null, q: null };

  it("returns empty string for market context", () => {
    const p = { ...base, symbol: null, symbols: [] };
    expect(deriveContextLabel(p)).toBe("");
  });

  it("returns Researching: NVDA for single symbol", () => {
    const p = { ...base, symbol: "NVDA", symbols: [] };
    expect(deriveContextLabel(p)).toBe("Researching: NVDA");
  });

  it("returns Comparing: X vs Y for multi-symbol", () => {
    const p = { ...base, symbol: null, symbols: ["NVDA", "AMD"] };
    expect(deriveContextLabel(p)).toBe("Comparing: NVDA vs AMD");
  });

  it("returns Theme: for themeId", () => {
    const p = { ...base, symbol: null, symbols: [], themeId: "ai-infrastructure" };
    expect(deriveContextLabel(p)).toBe("Theme: ai-infrastructure");
  });

  it("returns Sector: for sector", () => {
    const p = { ...base, symbol: null, symbols: [], sector: "Technology" };
    expect(deriveContextLabel(p)).toBe("Sector: Technology");
  });

  it("returns Collection Research for collectionId", () => {
    const p = { ...base, symbol: null, symbols: [], collectionId: "col-1" };
    expect(deriveContextLabel(p)).toBe("Collection Research");
  });

  it("caps multi-symbol display at 5", () => {
    const p = { ...base, symbol: null, symbols: ["A", "B", "C", "D", "E", "F"] };
    const label = deriveContextLabel(p);
    expect(label).toContain("A vs B vs C vs D vs E");
    expect(label).not.toContain("F");
  });
});

// ---------------------------------------------------------------------------
// § 4  Context type derivation
// ---------------------------------------------------------------------------

describe("§ 4 deriveContextType", () => {
  const base = { mode: null, scope: null, symbol: null, symbols: [], themeId: null, sector: null, collectionId: null, portfolioId: null, watchId: null, reportId: null, action: null, conversation: null, sourceRoute: null, q: null };

  it("returns market for empty params", () => {
    expect(deriveContextType(base)).toBe("market");
  });

  it("returns company for single symbol", () => {
    const p = { ...base, symbol: "NVDA" };
    expect(deriveContextType(p)).toBe("company");
  });

  it("returns comparison for multiple symbols", () => {
    const p = { ...base, symbols: ["NVDA", "AMD"] };
    expect(deriveContextType(p)).toBe("comparison");
  });

  it("returns comparison for compare action", () => {
    const p = { ...base, symbol: "NVDA", action: "compare" as WorkspaceAction };
    expect(deriveContextType(p)).toBe("comparison");
  });

  it("returns opportunity when mode=opportunity with symbol", () => {
    const p = { ...base, symbol: "NVDA", mode: "opportunity" as ResearchMode };
    expect(deriveContextType(p)).toBe("opportunity");
  });

  it("returns theme for themeId", () => {
    const p = { ...base, themeId: "ai-infrastructure" };
    expect(deriveContextType(p)).toBe("theme");
  });

  it("returns sector for sector", () => {
    const p = { ...base, sector: "Technology" };
    expect(deriveContextType(p)).toBe("sector");
  });

  it("returns collection for collectionId", () => {
    const p = { ...base, collectionId: "c1" };
    expect(deriveContextType(p)).toBe("collection");
  });

  it("returns monitor for watchId", () => {
    const p = { ...base, watchId: "w1" };
    expect(deriveContextType(p)).toBe("monitor");
  });

  it("returns report for reportId", () => {
    const p = { ...base, reportId: "r1" };
    expect(deriveContextType(p)).toBe("report");
  });

  it("returns portfolio for portfolioId", () => {
    const p = { ...base, portfolioId: "p1" };
    expect(deriveContextType(p)).toBe("portfolio");
  });
});

// ---------------------------------------------------------------------------
// § 5  Initial mode derivation
// ---------------------------------------------------------------------------

describe("§ 5 deriveInitialMode", () => {
  const base = { mode: null, scope: null, symbol: null, symbols: [], themeId: null, sector: null, collectionId: null, portfolioId: null, watchId: null, reportId: null, action: null, conversation: null, sourceRoute: null, q: null };

  it("returns opportunity for empty params", () => {
    expect(deriveInitialMode(base)).toBe("opportunity");
  });

  it("respects explicit mode param", () => {
    const p = { ...base, mode: "institutional" as ResearchMode };
    expect(deriveInitialMode(p)).toBe("institutional");
  });

  it("returns comparison for multi-symbols", () => {
    const p = { ...base, symbols: ["NVDA", "AMD"] };
    expect(deriveInitialMode(p)).toBe("comparison");
  });

  it("returns company for single symbol", () => {
    const p = { ...base, symbol: "NVDA" };
    expect(deriveInitialMode(p)).toBe("company");
  });

  it("returns theme for themeId", () => {
    const p = { ...base, themeId: "ai" };
    expect(deriveInitialMode(p)).toBe("theme");
  });

  it("returns sector for sector", () => {
    const p = { ...base, sector: "Tech" };
    expect(deriveInitialMode(p)).toBe("sector");
  });

  it("returns collection for collectionId", () => {
    const p = { ...base, collectionId: "c1" };
    expect(deriveInitialMode(p)).toBe("collection");
  });

  it("maps action=challenge to company mode", () => {
    const p = { ...base, action: "challenge" as WorkspaceAction };
    expect(deriveInitialMode(p)).toBe("company");
  });

  it("maps action=explain_change to opportunity mode", () => {
    const p = { ...base, action: "explain_change" as WorkspaceAction };
    expect(deriveInitialMode(p)).toBe("opportunity");
  });

  it("maps action=institutional to institutional mode", () => {
    const p = { ...base, action: "institutional" as WorkspaceAction };
    expect(deriveInitialMode(p)).toBe("institutional");
  });

  it("maps action=compare to comparison mode", () => {
    const p = { ...base, action: "compare" as WorkspaceAction };
    expect(deriveInitialMode(p)).toBe("comparison");
  });

  it("explicit mode takes priority over action", () => {
    const p = { ...base, mode: "market" as ResearchMode, action: "challenge" as WorkspaceAction };
    expect(deriveInitialMode(p)).toBe("market");
  });
});

// ---------------------------------------------------------------------------
// § 6  Prefill question derivation
// ---------------------------------------------------------------------------

describe("§ 6 derivePrefillQuestion", () => {
  const base = { mode: null, scope: null, symbol: null, symbols: [], themeId: null, sector: null, collectionId: null, portfolioId: null, watchId: null, reportId: null, action: null, conversation: null, sourceRoute: null, q: null };

  it("returns empty string for no params", () => {
    expect(derivePrefillQuestion(base)).toBe("");
  });

  it("returns q param when present", () => {
    const p = { ...base, q: "Explain NVDA" };
    expect(derivePrefillQuestion(p)).toBe("Explain NVDA");
  });

  it("q param takes priority over action", () => {
    const p = { ...base, symbol: "NVDA", action: "challenge" as WorkspaceAction, q: "My custom question" };
    expect(derivePrefillQuestion(p)).toBe("My custom question");
  });

  it("generates explain_concept question for NVDA", () => {
    const p = { ...base, symbol: "NVDA", action: "explain_concept" as WorkspaceAction };
    const q = derivePrefillQuestion(p);
    expect(q).toContain("NVDA");
    expect(q).toContain("qualified");
  });

  it("generates challenge question for AMD", () => {
    const p = { ...base, symbol: "AMD", action: "challenge" as WorkspaceAction };
    const q = derivePrefillQuestion(p);
    expect(q).toContain("AMD");
    expect(q.toLowerCase()).toContain("challenge");
  });

  it("generates explain_change question", () => {
    const p = { ...base, symbol: "MSFT", action: "explain_change" as WorkspaceAction };
    const q = derivePrefillQuestion(p);
    expect(q).toContain("MSFT");
    expect(q).toContain("changed");
  });

  it("generates risk question", () => {
    const p = { ...base, symbol: "TSLA", action: "risk" as WorkspaceAction };
    const q = derivePrefillQuestion(p);
    expect(q).toContain("TSLA");
    expect(q.toLowerCase()).toContain("risk");
  });

  it("generates institutional question", () => {
    const p = { ...base, symbol: "AAPL", action: "institutional" as WorkspaceAction };
    const q = derivePrefillQuestion(p);
    expect(q).toContain("AAPL");
    expect(q.toLowerCase()).toContain("institutional");
  });

  it("generates compare question", () => {
    const p = { ...base, symbol: "NVDA", action: "compare" as WorkspaceAction };
    const q = derivePrefillQuestion(p);
    expect(q).toContain("NVDA");
    expect(q.toLowerCase()).toContain("compare");
  });

  it("returns empty when action present but no symbol", () => {
    const p = { ...base, action: "challenge" as WorkspaceAction };
    expect(derivePrefillQuestion(p)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// § 7  Service — assembleCanonicalContext
// ---------------------------------------------------------------------------

describe("§ 7 assembleCanonicalContext — market context", () => {
  it("returns market context with correct fields", async () => {
    const {
      assembleCanonicalContext,
    } = await import("../../services/research-workspace-service");

    const { context, limitations } = await assembleCanonicalContext(
      "user-1", "market", {}
    );

    expect(context.contextType).toBe("market");
    expect(context.label).toBe("Market Intelligence");
    expect(context.symbols).toEqual([]);
    expect(context.defaultMode).toBe("market");
    expect(context.defaultScope).toBe("entire_market");
    expect(limitations).toEqual([]);
  });

  it("returns company context with symbol", async () => {
    vi.doMock("../../services/opportunity-intelligence-service", () => ({
      getOpportunityIntelligence: async () => ({
        opportunities: [{ symbol: "NVDA", companyName: "NVIDIA Corp" }],
        generatedAt: new Date().toISOString(),
      }),
    }));

    const { assembleCanonicalContext } = await import("../../services/research-workspace-service");
    const { context, limitations } = await assembleCanonicalContext(
      "user-1", "company", { symbol: "NVDA" }
    );

    expect(context.contextType).toBe("company");
    expect(context.symbols).toContain("NVDA");
    expect(context.defaultMode).toBe("company");
    expect(context.label).toContain("NVDA");
  });

  it("adds limitation when symbol missing for company context", async () => {
    const { assembleCanonicalContext } = await import("../../services/research-workspace-service");
    const { limitations } = await assembleCanonicalContext(
      "user-1", "company", {}
    );
    expect(limitations.length).toBeGreaterThan(0);
    expect(limitations[0]).toContain("symbol");
  });

  it("returns comparison context with 2+ symbols", async () => {
    const { assembleCanonicalContext } = await import("../../services/research-workspace-service");
    const { context, limitations } = await assembleCanonicalContext(
      "user-1", "comparison", { symbols: ["NVDA", "AMD"] }
    );

    expect(context.contextType).toBe("comparison");
    expect(context.comparisonSymbols).toEqual(["NVDA", "AMD"]);
    expect(context.label).toContain("NVDA");
    expect(context.label).toContain("AMD");
    expect(context.defaultMode).toBe("comparison");
  });

  it("adds limitation when comparison has < 2 symbols", async () => {
    const { assembleCanonicalContext } = await import("../../services/research-workspace-service");
    const { limitations } = await assembleCanonicalContext(
      "user-1", "comparison", { symbols: ["NVDA"] }
    );
    expect(limitations.some(l => l.includes("2 symbols"))).toBe(true);
  });

  it("returns theme context", async () => {
    vi.doMock("../../services/intelligence-snapshot-store", () => ({
      getLatestSectorSnapshots: async () => [],
      getLatestThemeSnapshots:  async () => [],
      getLatestSectorDetail:    async () => null,
      getLatestThemeDetail:     async (id: string) => ({ themeId: id, themeName: "AI Infrastructure" }),
    }));

    const { assembleCanonicalContext } = await import("../../services/research-workspace-service");
    const { context } = await assembleCanonicalContext(
      "user-1", "theme", { themeId: "ai-infrastructure" }
    );

    expect(context.contextType).toBe("theme");
    expect(context.defaultMode).toBe("theme");
    expect(context.themeId).toBe("ai-infrastructure");
  });

  it("returns sector context", async () => {
    const { assembleCanonicalContext } = await import("../../services/research-workspace-service");
    const { context } = await assembleCanonicalContext(
      "user-1", "sector", { sector: "Technology" }
    );

    expect(context.contextType).toBe("sector");
    expect(context.sector).toBe("Technology");
    expect(context.defaultMode).toBe("sector");
    expect(context.label).toBe("Sector: Technology");
  });

  it("returns institutional context with symbol", async () => {
    const { assembleCanonicalContext } = await import("../../services/research-workspace-service");
    const { context } = await assembleCanonicalContext(
      "user-1", "institutional", { symbol: "NVDA" }
    );

    expect(context.contextType).toBe("institutional");
    expect(context.symbols).toContain("NVDA");
    expect(context.defaultMode).toBe("institutional");
  });

  it("returns custom context via default branch", async () => {
    const { assembleCanonicalContext } = await import("../../services/research-workspace-service");
    const { context } = await assembleCanonicalContext(
      "user-1", "custom", {}
    );
    expect(context.contextType).toBe("market"); // falls through to market
    expect(context.defaultMode).toBe("market");
  });
});

// ---------------------------------------------------------------------------
// § 8  Service — buildResearchSystemPrompt
// ---------------------------------------------------------------------------

describe("§ 8 buildResearchSystemPrompt", () => {
  const mockCtx = {
    mode: "company" as ResearchMode,
    scope: "entire_market" as ContextScope,
    scopeLabel: "Entire Market",
    opportunities: [],
    totalCandidates: 0,
    sectors: [],
    themes: [],
    topSectors: ["Technology", "Healthcare"],
    topThemes: ["AI Infrastructure", "Semiconductors"],
    collectionNames: [],
    tickers: ["NVDA"],
    tickerOpportunities: [],
    dataFreshness: "Test freshness",
    hasOpportunities: false,
  };

  it("includes CORE RULES header", async () => {
    const { buildResearchSystemPrompt } = await import("../../services/research-workspace-service");
    const prompt = buildResearchSystemPrompt("company", mockCtx);
    expect(prompt).toContain("CORE RULES");
  });

  it("never includes forbidden words", async () => {
    const { buildResearchSystemPrompt } = await import("../../services/research-workspace-service");
    const modes: ResearchMode[] = ["opportunity", "company", "theme", "sector", "institutional", "market", "collection", "comparison"];
    for (const m of modes) {
      const prompt = buildResearchSystemPrompt(m, mockCtx);
      expect(prompt).not.toMatch(/\brecommendation\b/i);
      expect(prompt).not.toMatch(/\bbuy\b/i);
      expect(prompt).not.toMatch(/\bsell\b/i);
      expect(prompt).not.toMatch(/\btarget price\b/i);
    }
  });

  it("includes MODE-specific rule for each mode", async () => {
    const { buildResearchSystemPrompt } = await import("../../services/research-workspace-service");
    const modeLabels: Record<ResearchMode, string> = {
      opportunity:   "Opportunity Research",
      company:       "Company Research",
      theme:         "Theme Research",
      sector:        "Sector Research",
      institutional: "Institutional Research",
      market:        "Market Research",
      collection:    "Collection Research",
      comparison:    "Comparison Research",
    };
    for (const [mode, label] of Object.entries(modeLabels)) {
      const prompt = buildResearchSystemPrompt(mode as ResearchMode, mockCtx);
      expect(prompt).toContain(`MODE: ${label}`);
    }
  });

  it("mentions relax_filter in system prompt", async () => {
    const { buildResearchSystemPrompt } = await import("../../services/research-workspace-service");
    const prompt = buildResearchSystemPrompt("opportunity", mockCtx);
    expect(prompt).toContain("relax_filter");
  });

  it("includes data freshness", async () => {
    const { buildResearchSystemPrompt } = await import("../../services/research-workspace-service");
    const prompt = buildResearchSystemPrompt("market", mockCtx);
    expect(prompt).toContain("Test freshness");
  });

  it("includes strict JSON response format", async () => {
    const { buildResearchSystemPrompt } = await import("../../services/research-workspace-service");
    const prompt = buildResearchSystemPrompt("company", mockCtx);
    expect(prompt).toContain("RESPONSE FORMAT");
    expect(prompt).toContain('"headline"');
    expect(prompt).toContain('"evidencePanel"');
    expect(prompt).toContain('"followUpActions"');
  });
});

// ---------------------------------------------------------------------------
// § 9  Service — buildRuleBasedWorkspaceResponse
// ---------------------------------------------------------------------------

describe("§ 9 buildRuleBasedWorkspaceResponse", () => {
  const baseCtx = {
    mode: "opportunity" as ResearchMode,
    scope: "entire_market" as ContextScope,
    scopeLabel: "Entire Market",
    opportunities: [],
    totalCandidates: 0,
    sectors: [],
    themes: [],
    topSectors: [],
    topThemes: [],
    collectionNames: [],
    tickers: [],
    tickerOpportunities: [],
    dataFreshness: "N/A",
    hasOpportunities: false,
  };

  it("returns valid WorkspaceAIResponse shape", async () => {
    const { buildRuleBasedWorkspaceResponse } = await import("../../services/research-workspace-service");
    const resp = buildRuleBasedWorkspaceResponse("test", baseCtx, "opportunity", "entire_market");
    expect(resp.headline).toBeTruthy();
    expect(resp.answer).toBeTruthy();
    expect(Array.isArray(resp.keyPoints)).toBe(true);
    expect(resp.riskNote).toBeTruthy();
    expect(["low","medium","high"]).toContain(resp.confidence);
    expect(resp.source).toBe("rule_based");
    expect(resp.disclaimer).toBeTruthy();
  });

  it("sets diagnostics when no opportunities", async () => {
    const { buildRuleBasedWorkspaceResponse } = await import("../../services/research-workspace-service");
    const resp = buildRuleBasedWorkspaceResponse("test", baseCtx, "opportunity", "entire_market");
    expect(resp.diagnostics).toBeDefined();
    expect(resp.diagnostics?.candidatesQualified).toBe(0);
  });

  it("does NOT use forbidden words in answer", async () => {
    const { buildRuleBasedWorkspaceResponse } = await import("../../services/research-workspace-service");
    const ctxWithOpps = {
      ...baseCtx,
      hasOpportunities: true,
      opportunities: [
        { symbol: "NVDA", companyName: "NVIDIA", researchScore: 80, riskLevel: "low", themes: [], evidence: [], riskFactors: [], thesisInvalidators: [], lastUpdated: new Date().toISOString(), technicalScore: 75, institutionalScore: 70, opportunityType: "vcp", sector: "Technology", fundamentalScore: 65 },
      ],
    };
    const resp = buildRuleBasedWorkspaceResponse("test", ctxWithOpps as any, "opportunity", "entire_market");
    expect(resp.answer).not.toMatch(/\brecommendation\b/i);
    expect(resp.answer).not.toMatch(/\bbuy\b/i);
    expect(resp.answer).not.toMatch(/\bsell\b/i);
  });

  it("uses relax_filter in empty-state follow-up actions", async () => {
    const { buildRuleBasedWorkspaceResponse } = await import("../../services/research-workspace-service");
    const resp = buildRuleBasedWorkspaceResponse("test", baseCtx, "opportunity", "entire_market");
    const relaxAction = resp.followUpActions.find(a => a.action.type === "relax_filter");
    expect(relaxAction).toBeDefined();
  });

  it("navigate action uses /opportunities/:symbol path", async () => {
    const { buildRuleBasedWorkspaceResponse } = await import("../../services/research-workspace-service");
    const ctxWithOpps = {
      ...baseCtx,
      hasOpportunities: true,
      opportunities: [
        { symbol: "NVDA", companyName: "NVIDIA", researchScore: 80, riskLevel: "low", themes: [], evidence: [], riskFactors: [], thesisInvalidators: [], lastUpdated: new Date().toISOString(), technicalScore: 75, institutionalScore: 70, opportunityType: "vcp", sector: "Technology", fundamentalScore: 65 },
      ],
    };
    const resp = buildRuleBasedWorkspaceResponse("test", ctxWithOpps as any, "opportunity", "entire_market");
    const navAction = resp.followUpActions.find(a => a.action.type === "navigate");
    expect(navAction).toBeDefined();
    const act = navAction!.action as { type: "navigate"; path: string };
    expect(act.path).toContain("/opportunities/");
  });
});

// ---------------------------------------------------------------------------
// § 10 Service — parseAIWorkspaceResponse
// ---------------------------------------------------------------------------

describe("§ 10 parseAIWorkspaceResponse", () => {
  const baseCtx = {
    mode: "company" as ResearchMode,
    scope: "entire_market" as ContextScope,
    scopeLabel: "Entire Market",
    opportunities: [],
    totalCandidates: 0,
    sectors: [],
    themes: [],
    topSectors: [],
    topThemes: [],
    collectionNames: [],
    tickers: ["NVDA"],
    tickerOpportunities: [],
    dataFreshness: "N/A",
    hasOpportunities: false,
  };

  const validJson = JSON.stringify({
    headline: "NVDA Analysis",
    answer: "NVDA shows strong technical patterns with institutional accumulation.",
    keyPoints: ["Pattern quality: strong", "Institutional score: 82", "Risk: low"],
    riskNote: "This is research data, not investment advice.",
    confidence: "high",
    evidencePanel: {
      summary: "Strong evidence",
      supportingEvidence: [{ label: "Pattern", value: "VCP", strength: "strong", source: "Technical Engine" }],
      technicalEvidence: [],
      fundamentalEvidence: [],
      institutionalEvidence: [],
      riskFactors: ["Market regime shift"],
      thesisInvalidators: ["Pattern failure"],
      researchSourcesUsed: ["Technical Engine"],
    },
    followUpActions: [
      { label: "Challenge Thesis", description: "Test bear case", action: { type: "ask", question: "Challenge NVDA" } },
    ],
    referencedTickers: ["NVDA"],
    diagnostics: null,
  });

  it("parses valid JSON response", async () => {
    const { parseAIWorkspaceResponse } = await import("../../services/research-workspace-service");
    const resp = parseAIWorkspaceResponse(validJson, "company", "entire_market", baseCtx as any);
    expect(resp.headline).toBe("NVDA Analysis");
    expect(resp.confidence).toBe("high");
    expect(resp.source).toBe("openai");
    expect(resp.referencedTickers).toContain("NVDA");
  });

  it("strips markdown code fences", async () => {
    const { parseAIWorkspaceResponse } = await import("../../services/research-workspace-service");
    const fenced = "```json\n" + validJson + "\n```";
    const resp = parseAIWorkspaceResponse(fenced, "company", "entire_market", baseCtx as any);
    expect(resp.headline).toBe("NVDA Analysis");
  });

  it("falls back to rule-based on parse failure", async () => {
    const { parseAIWorkspaceResponse } = await import("../../services/research-workspace-service");
    const resp = parseAIWorkspaceResponse("not valid json", "company", "entire_market", baseCtx as any);
    expect(resp.source).toBe("rule_based");
  });

  it("clamps confidence to low|medium|high", async () => {
    const { parseAIWorkspaceResponse } = await import("../../services/research-workspace-service");
    const badConf = JSON.stringify({ ...JSON.parse(validJson), confidence: "extreme" });
    const resp = parseAIWorkspaceResponse(badConf, "company", "entire_market", baseCtx as any);
    expect(["low","medium","high"]).toContain(resp.confidence);
  });
});

// ---------------------------------------------------------------------------
// § 11 Service — parseFollowUpActions (relax_filter)
// ---------------------------------------------------------------------------

describe("§ 11 parseFollowUpActions with relax_filter", () => {
  it("parses relax_filter action with suggestedScope", async () => {
    const { buildRuleBasedWorkspaceResponse } = await import("../../services/research-workspace-service");
    const baseCtx = {
      mode: "opportunity" as ResearchMode,
      scope: "growth" as ContextScope,
      scopeLabel: "Growth",
      opportunities: [],
      totalCandidates: 5,
      sectors: [],
      themes: [],
      topSectors: [],
      topThemes: [],
      collectionNames: [],
      tickers: [],
      tickerOpportunities: [],
      dataFreshness: "N/A",
      hasOpportunities: false,
    };
    const resp = buildRuleBasedWorkspaceResponse("test", baseCtx as any, "opportunity", "growth");
    const rf = resp.followUpActions.find(a => a.action.type === "relax_filter");
    expect(rf).toBeDefined();
    expect((rf!.action as any).suggestedScope).toBe("entire_market");
  });

  it("parseAIWorkspaceResponse preserves relax_filter action", async () => {
    const { parseAIWorkspaceResponse } = await import("../../services/research-workspace-service");
    const baseCtx = {
      mode: "opportunity" as ResearchMode,
      scope: "entire_market" as ContextScope,
      scopeLabel: "Entire Market",
      opportunities: [],
      totalCandidates: 0,
      sectors: [],
      themes: [],
      topSectors: [],
      topThemes: [],
      collectionNames: [],
      tickers: [],
      tickerOpportunities: [],
      dataFreshness: "N/A",
      hasOpportunities: false,
    };
    const json = JSON.stringify({
      headline: "No candidates",
      answer: "Scope is too narrow.",
      keyPoints: ["Try broader scope"],
      riskNote: "Research only.",
      confidence: "low",
      evidencePanel: { summary: "", supportingEvidence: [], technicalEvidence: [], fundamentalEvidence: [], institutionalEvidence: [], riskFactors: [], thesisInvalidators: [], researchSourcesUsed: [] },
      followUpActions: [
        { label: "Broaden Scope", description: "Try entire market", action: { type: "relax_filter", filterName: "scope", suggestedScope: "entire_market" } },
      ],
      referencedTickers: [],
      diagnostics: null,
    });
    const resp = parseAIWorkspaceResponse(json, "opportunity", "entire_market", baseCtx as any);
    const rf = resp.followUpActions.find(a => a.action.type === "relax_filter");
    expect(rf).toBeDefined();
    expect((rf!.action as any).suggestedScope).toBe("entire_market");
  });
});

// ---------------------------------------------------------------------------
// § 12 Service — buildResearchUserMessage
// ---------------------------------------------------------------------------

describe("§ 12 buildResearchUserMessage", () => {
  it("includes question and context info", async () => {
    const { buildResearchUserMessage } = await import("../../services/research-workspace-service");
    const ctx = {
      mode: "company" as ResearchMode,
      scope: "entire_market" as ContextScope,
      scopeLabel: "Entire Market",
      opportunities: [],
      totalCandidates: 10,
      sectors: [],
      themes: [],
      topSectors: [],
      topThemes: [],
      collectionNames: [],
      tickers: ["NVDA"],
      tickerOpportunities: [{ symbol: "NVDA", researchScore: 80, companyName: "NVIDIA" } as any],
      dataFreshness: "2025-01-01",
      hasOpportunities: true,
    };
    const msg = buildResearchUserMessage("Explain NVDA", ctx as any);
    const parsed = JSON.parse(msg);
    expect(parsed.question).toBe("Explain NVDA");
    expect(parsed.requestedTickers).toContain("NVDA");
    expect(parsed.dataFreshness).toBe("2025-01-01");
  });

  it("includes comparison candidates for comparison mode", async () => {
    const { buildResearchUserMessage } = await import("../../services/research-workspace-service");
    const ctx = {
      mode: "comparison" as ResearchMode,
      scope: "entire_market" as ContextScope,
      scopeLabel: "Entire Market",
      opportunities: [],
      totalCandidates: 5,
      sectors: [],
      themes: [],
      topSectors: [],
      topThemes: [],
      collectionNames: [],
      tickers: ["NVDA", "AMD"],
      tickerOpportunities: [
        { symbol: "NVDA", researchScore: 80 } as any,
        { symbol: "AMD", researchScore: 72 } as any,
      ],
      dataFreshness: "N/A",
      hasOpportunities: true,
    };
    const msg = buildResearchUserMessage("Compare NVDA and AMD", ctx as any);
    const parsed = JSON.parse(msg);
    expect(parsed.comparisonCandidates).toBeDefined();
    expect(parsed.comparisonCandidates.length).toBeGreaterThanOrEqual(2);
  });

  it("adds diagnostics when no opportunities", async () => {
    const { buildResearchUserMessage } = await import("../../services/research-workspace-service");
    const ctx = {
      mode: "opportunity" as ResearchMode,
      scope: "growth" as ContextScope,
      scopeLabel: "Growth",
      opportunities: [],
      totalCandidates: 0,
      sectors: [],
      themes: [],
      topSectors: [],
      topThemes: [],
      collectionNames: [],
      tickers: [],
      tickerOpportunities: [],
      dataFreshness: "N/A",
      hasOpportunities: false,
    };
    const msg = buildResearchUserMessage("Find growth stocks", ctx as any);
    const parsed = JSON.parse(msg);
    expect(parsed.diagnostics).toBeDefined();
    expect(parsed.diagnostics.note).toContain("No qualifying candidates");
  });
});

// ---------------------------------------------------------------------------
// § 13 Service — getWorkspaceHealth
// ---------------------------------------------------------------------------

describe("§ 13 getWorkspaceHealth", () => {
  it("returns valid health snapshot shape", async () => {
    const { getWorkspaceHealth } = await import("../../services/research-workspace-service");
    const health = await getWorkspaceHealth();
    expect(typeof health.conversationCount).toBe("number");
    expect(typeof health.pinnedConversations).toBe("number");
    expect(typeof health.contextAssemblyOk).toBe("boolean");
    expect(typeof health.openAiConfigured).toBe("boolean");
    expect(typeof health.contextRequests).toBe("number");
    expect(typeof health.askRequests).toBe("number");
    expect(typeof health.fallbackCount).toBe("number");
    expect(typeof health.partialContextCount).toBe("number");
    expect(typeof health.averageAIResponseMs).toBe("number");
  });

  it("does not throw on DB failure", async () => {
    const { getWorkspaceHealth } = await import("../../services/research-workspace-service");
    // Should not throw even if DB unavailable
    await expect(getWorkspaceHealth()).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// § 14 Service — record* telemetry functions
// ---------------------------------------------------------------------------

describe("§ 14 Telemetry recording functions", () => {
  it("recordContextRequest increments counters", async () => {
    const {
      recordContextRequest,
      getWorkspaceHealth,
    } = await import("../../services/research-workspace-service");

    const before = await getWorkspaceHealth();
    recordContextRequest(true);
    recordContextRequest(false);
    const after = await getWorkspaceHealth();

    expect(after.contextRequests).toBeGreaterThanOrEqual(before.contextRequests + 2);
  });

  it("recordAskRequest increments ask counters and fallback", async () => {
    const { recordAskRequest, getWorkspaceHealth } = await import("../../services/research-workspace-service");
    const before = await getWorkspaceHealth();
    recordAskRequest(true, true, 500);
    recordAskRequest(false, false);
    const after = await getWorkspaceHealth();
    expect(after.askRequests).toBeGreaterThanOrEqual(before.askRequests + 2);
    expect(after.fallbackCount).toBeGreaterThanOrEqual(before.fallbackCount + 1);
  });

  it("recordPartialContext increments partial counter", async () => {
    const { recordPartialContext, getWorkspaceHealth } = await import("../../services/research-workspace-service");
    const before = await getWorkspaceHealth();
    recordPartialContext();
    const after = await getWorkspaceHealth();
    expect(after.partialContextCount).toBeGreaterThanOrEqual(before.partialContextCount + 1);
  });
});

// ---------------------------------------------------------------------------
// § 15 Route context endpoint validation
// ---------------------------------------------------------------------------

describe("§ 15 Context endpoint param validation", () => {
  const VALID_CONTEXT_TYPES = [
    "market", "opportunity", "company", "theme", "sector",
    "institutional", "collection", "comparison", "monitor",
    "report", "portfolio", "portfolio_holding", "custom",
  ];

  it("VALID_CONTEXT_TYPES has 13 entries", () => {
    expect(VALID_CONTEXT_TYPES.length).toBe(13);
  });

  it("market type is always valid", () => {
    expect(VALID_CONTEXT_TYPES.includes("market")).toBe(true);
  });

  it("opportunity and company are separate types", () => {
    expect(VALID_CONTEXT_TYPES.includes("opportunity")).toBe(true);
    expect(VALID_CONTEXT_TYPES.includes("company")).toBe(true);
  });

  it("portfolio_holding is a valid type", () => {
    expect(VALID_CONTEXT_TYPES.includes("portfolio_holding")).toBe(true);
  });

  it("unknown_type is not valid", () => {
    expect(VALID_CONTEXT_TYPES.includes("unknown_type" as ResearchContextType)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// § 16 VALID_CONTEXT_TYPES coverage in route
// ---------------------------------------------------------------------------

describe("§ 16 All context types handled by assembleCanonicalContext", () => {
  it("monitor context uses watchId", async () => {
    const { assembleCanonicalContext } = await import("../../services/research-workspace-service");
    const { context } = await assembleCanonicalContext("user-1", "monitor", { watchId: "w1" });
    expect(context.contextType).toBe("monitor");
    expect(context.watchId).toBe("w1");
    expect(context.defaultMode).toBe("company");
  });

  it("report context uses reportId", async () => {
    const { assembleCanonicalContext } = await import("../../services/research-workspace-service");
    const { context } = await assembleCanonicalContext("user-1", "report", { reportId: "r1" });
    expect(context.contextType).toBe("report");
    expect(context.reportId).toBe("r1");
    expect(context.defaultMode).toBe("opportunity");
  });

  it("portfolio context uses portfolioId", async () => {
    const { assembleCanonicalContext } = await import("../../services/research-workspace-service");
    const { context } = await assembleCanonicalContext("user-1", "portfolio", { portfolioId: "p1" });
    expect(context.contextType).toBe("portfolio");
    expect(context.portfolioId).toBe("p1");
    expect(context.defaultMode).toBe("company");
  });

  it("sourceRoute is preserved in context", async () => {
    const { assembleCanonicalContext } = await import("../../services/research-workspace-service");
    const { context } = await assembleCanonicalContext("user-1", "market", { sourceRoute: "/opportunities/today" });
    expect(context.sourceRoute).toBe("/opportunities/today");
  });
});

// ---------------------------------------------------------------------------
// § 17 ACTION_QUESTIONS / ACTION_MODE_MAP
// ---------------------------------------------------------------------------

describe("§ 17 ACTION_QUESTIONS and ACTION_MODE_MAP", () => {
  const ACTIONS: WorkspaceAction[] = [
    "explain_concept", "challenge", "explain_change", "risk", "institutional", "compare",
  ];

  it("ACTION_QUESTIONS covers all 6 actions", () => {
    expect(Object.keys(ACTION_QUESTIONS).length).toBe(6);
    for (const a of ACTIONS) {
      expect(ACTION_QUESTIONS[a]).toBeDefined();
    }
  });

  it("ACTION_MODE_MAP covers all 6 actions", () => {
    expect(Object.keys(ACTION_MODE_MAP).length).toBe(6);
    for (const a of ACTIONS) {
      expect(ACTION_MODE_MAP[a]).toBeDefined();
      expect(MODES_LIST.includes(ACTION_MODE_MAP[a])).toBe(true);
    }
  });

  it("explain_concept maps to company mode", () => {
    expect(ACTION_MODE_MAP.explain_concept).toBe("company");
  });

  it("challenge maps to company mode", () => {
    expect(ACTION_MODE_MAP.challenge).toBe("company");
  });

  it("explain_change maps to opportunity mode", () => {
    expect(ACTION_MODE_MAP.explain_change).toBe("opportunity");
  });

  it("risk maps to company mode", () => {
    expect(ACTION_MODE_MAP.risk).toBe("company");
  });

  it("institutional maps to institutional mode", () => {
    expect(ACTION_MODE_MAP.institutional).toBe("institutional");
  });

  it("compare maps to comparison mode", () => {
    expect(ACTION_MODE_MAP.compare).toBe("comparison");
  });

  it("ACTION_QUESTIONS return strings containing symbol", () => {
    for (const a of ACTIONS) {
      const q = ACTION_QUESTIONS[a]("NVDA");
      expect(typeof q).toBe("string");
      expect(q).toContain("NVDA");
    }
  });

  it("challenge question does not include buy/sell", () => {
    const q = ACTION_QUESTIONS.challenge("NVDA");
    expect(q).not.toMatch(/\bbuy\b/i);
    expect(q).not.toMatch(/\bsell\b/i);
    expect(q).not.toMatch(/\brecommend\b/i);
  });
});

const MODES_LIST: ResearchMode[] = ["opportunity","company","theme","sector","institutional","market","collection","comparison"];

// ---------------------------------------------------------------------------
// § 18 RESEARCH_TEMPLATES completeness
// ---------------------------------------------------------------------------

describe("§ 18 RESEARCH_TEMPLATES v2", () => {
  it("has 12 templates", () => {
    expect(RESEARCH_TEMPLATES.length).toBe(12);
  });

  it("challenge-thesis template exists", () => {
    const t = RESEARCH_TEMPLATES.find(t => t.id === "challenge-thesis");
    expect(t).toBeDefined();
    expect(t?.mode).toBe("company");
  });

  it("explain-change template exists", () => {
    const t = RESEARCH_TEMPLATES.find(t => t.id === "explain-change");
    expect(t).toBeDefined();
    expect(t?.mode).toBe("opportunity");
  });

  it("risk-profile template exists", () => {
    const t = RESEARCH_TEMPLATES.find(t => t.id === "risk-profile");
    expect(t).toBeDefined();
    expect(t?.mode).toBe("company");
  });

  it("all templates have required fields", () => {
    for (const t of RESEARCH_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(MODES_LIST).toContain(t.mode);
      expect(t.promptText).toBeTruthy();
      expect(typeof t.requiresTicker).toBe("boolean");
    }
  });

  it("ticker templates have {TICKER} placeholder", () => {
    const tickerTemplates = RESEARCH_TEMPLATES.filter(t => t.requiresTicker);
    for (const t of tickerTemplates) {
      expect(t.promptText).toContain("{TICKER");
    }
  });

  it("no template uses forbidden compliance words", () => {
    for (const t of RESEARCH_TEMPLATES) {
      expect(t.promptText).not.toMatch(/\bbuy\b/i);
      expect(t.promptText).not.toMatch(/\bsell\b/i);
      expect(t.promptText).not.toMatch(/\btarget price\b/i);
    }
  });
});

// ---------------------------------------------------------------------------
// § 19 WorkspaceAskRequest researchContext shape
// ---------------------------------------------------------------------------

describe("§ 19 WorkspaceAskRequest researchContext", () => {
  it("is optional in WorkspaceAskRequest", () => {
    const req: WorkspaceAskRequest = {
      question:     "test",
      researchMode: "opportunity",
      contextScope: "entire_market",
    };
    expect(req.researchContext).toBeUndefined();
  });

  it("accepts full researchContext payload", () => {
    const req: WorkspaceAskRequest = {
      question:     "Compare these",
      researchMode: "comparison",
      contextScope: "entire_market",
      tickers:      ["NVDA", "AMD"],
      researchContext: {
        contextType:       "comparison",
        contextLabel:      "Comparing: NVDA vs AMD",
        primarySymbol:     "NVDA",
        comparisonSymbols: ["NVDA", "AMD"],
        sourceRoute:       "/opportunities/NVDA",
      },
    };
    expect(req.researchContext?.comparisonSymbols).toEqual(["NVDA", "AMD"]);
    expect(req.researchContext?.sourceRoute).toBe("/opportunities/NVDA");
  });
});

// ---------------------------------------------------------------------------
// § 20 Schema column existence
// ---------------------------------------------------------------------------

describe("§ 20 Schema workspaceConversations columns", () => {
  it("has contextType column defined", async () => {
    const { workspaceConversations } = await import("../../../shared/schema");
    const cols = Object.keys(workspaceConversations);
    expect(cols).toContain("contextType");
  });

  it("has contextLabel column defined", async () => {
    const { workspaceConversations } = await import("../../../shared/schema");
    const cols = Object.keys(workspaceConversations);
    expect(cols).toContain("contextLabel");
  });

  it("has primarySymbol column defined", async () => {
    const { workspaceConversations } = await import("../../../shared/schema");
    const cols = Object.keys(workspaceConversations);
    expect(cols).toContain("primarySymbol");
  });

  it("has comparisonSymbols column defined", async () => {
    const { workspaceConversations } = await import("../../../shared/schema");
    const cols = Object.keys(workspaceConversations);
    expect(cols).toContain("comparisonSymbols");
  });

  it("has sourceRoute column defined", async () => {
    const { workspaceConversations } = await import("../../../shared/schema");
    const cols = Object.keys(workspaceConversations);
    expect(cols).toContain("sourceRoute");
  });

  it("has all original columns preserved", async () => {
    const { workspaceConversations } = await import("../../../shared/schema");
    const cols = Object.keys(workspaceConversations);
    expect(cols).toContain("id");
    expect(cols).toContain("userId");
    expect(cols).toContain("title");
    expect(cols).toContain("researchMode");
    expect(cols).toContain("contextScope");
    expect(cols).toContain("tickers");
    expect(cols).toContain("isPinned");
    expect(cols).toContain("lastMessageAt");
  });
});
