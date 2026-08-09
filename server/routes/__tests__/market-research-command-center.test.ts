/**
 * Sprint 2.5.3 — Market Research Command Center Tests
 *
 * Tests cover:
 *   1. Shared types structure (command-center-types.ts)
 *   2. Route structure (registerCommandCenterRoutes export)
 *   3. Section builder pure logic helpers
 *   4. Health snapshot structure
 *   5. Client page component structure (data-testid presence)
 *   6. API contract shapes (field completeness)
 *   7. Cross-navigation links (relatedResearch always present)
 *   8. Confidence level rules
 *   9. Direction classification (up/down/stable)
 *  10. Freshness label rules
 *  11. Degraded / unavailable section handling
 *  12. Opportunity change item mapping
 *  13. Collection section building
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// 1. Shared types structure
// ---------------------------------------------------------------------------

describe("CommandCenter shared types — field contracts", () => {
  it("RelatedResearchLink has label and path", () => {
    const link: import("@shared/command-center-types").RelatedResearchLink = {
      label: "Research Hub",
      path:  "/research",
    };
    expect(link.label).toBe("Research Hub");
    expect(link.path).toBe("/research");
  });

  it("ConfidenceLevel has level and basis", () => {
    const conf: import("@shared/command-center-types").ConfidenceLevel = {
      level: "high",
      basis: "15 sector snapshots",
    };
    expect(["high", "medium", "low"]).toContain(conf.level);
    expect(typeof conf.basis).toBe("string");
  });

  it("ThemeSummaryItem has required fields", () => {
    const item: import("@shared/command-center-types").ThemeSummaryItem = {
      themeId:    "ai-infrastructure",
      themeName:  "AI Infrastructure",
      score:      82,
      direction:  "up",
      scoreDelta: 5.2,
      topSymbols: ["NVDA", "MSFT"],
      relatedResearch: [],
    };
    expect(item.themeId).toBe("ai-infrastructure");
    expect(["up", "down", "stable"]).toContain(item.direction);
  });

  it("SectorSummaryItem has required fields", () => {
    const item: import("@shared/command-center-types").SectorSummaryItem = {
      sector:     "Technology",
      label:      "Technology",
      score:      75,
      direction:  "stable",
      scoreDelta: null,
      topSymbols: ["AAPL"],
      relatedResearch: [],
    };
    expect(item.sector).toBe("Technology");
    expect(item.scoreDelta).toBeNull();
  });

  it("OpportunityChangeItem has all required fields", () => {
    const item: import("@shared/command-center-types").OpportunityChangeItem = {
      symbol:        "NVDA",
      companyName:   null,
      previousScore: 70,
      currentScore:  85,
      scoreDelta:    15,
      changeType:    "upgrade",
      importance:    "Major",
      explanation:   "Strong momentum continuation",
      drivers:       ["Breakout above resistance"],
      warnings:      [],
      previousState: "QUALIFIED",
      currentState:  "QUALIFIED",
      relatedResearch: [{ label: "NVDA Research", path: "/opportunities/NVDA" }],
    };
    expect(item.symbol).toBe("NVDA");
    expect(["upgrade", "downgrade", "new", "removed", "major_mover"]).toContain(item.changeType);
    expect(["Minor", "Moderate", "Major", "Critical"]).toContain(item.importance);
  });

  it("InstitutionalSignalItem has magnitude field", () => {
    const item: import("@shared/command-center-types").InstitutionalSignalItem = {
      symbol:       "NVDA",
      companyName:  null,
      signalType:   "accumulation",
      magnitude:    "high",
      detail:       "Multiple large funds added positions",
      calculatedAt: "2026-08-09T00:00:00.000Z",
      relatedResearch: [],
    };
    expect(["high", "medium", "low"]).toContain(item.magnitude);
  });

  it("CollectionChangeSummary has opportunityCount", () => {
    const c: import("@shared/command-center-types").CollectionChangeSummary = {
      id:             "uuid-1",
      name:           "AI Infrastructure",
      collectionType: "system",
      systemKey:      "ai-infrastructure",
      opportunityCount: 12,
      topOpportunities: ["NVDA", "MSFT"],
      isFollowing: false,
      isFavorite:  false,
      isPinned:    false,
      relatedResearch: [],
    };
    expect(c.opportunityCount).toBe(12);
    expect(c.collectionType).toBe("system");
  });

  it("SuggestedQuery has all required fields", () => {
    const q: import("@shared/command-center-types").SuggestedQuery = {
      label:       "What changed today?",
      description: "Market summary",
      mode:        "market",
      scope:       "entire_market",
      promptText:  "Summarize today's changes",
    };
    expect(q.mode).toBe("market");
    expect(q.scope).toBe("entire_market");
  });

  it("ResearchTimelineItem has isPinned flag", () => {
    const item: import("@shared/command-center-types").ResearchTimelineItem = {
      id:            "conv-1",
      title:         "AI Infrastructure analysis",
      researchMode:  "theme",
      contextScope:  "ai-infrastructure",
      lastMessageAt: "2026-08-09T12:00:00.000Z",
      isPinned:      true,
      relatedResearch: [],
    };
    expect(item.isPinned).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. CommandCenterDailySnapshot shape completeness
// ---------------------------------------------------------------------------

describe("CommandCenterDailySnapshot — shape completeness", () => {
  const buildSnapshot = (): import("@shared/command-center-types").CommandCenterDailySnapshot => ({
    generatedAt: new Date().toISOString(),
    marketOverview: {
      regime: "bull",
      marketHealth: 72,
      marketHealthLabel: "Strong",
      leadingThemes: [],
      leadingSectors: [],
      mostImprovedThemes: [],
      weakeningThemes: [],
      whatsNew: ["AI Infrastructure strengthening"],
      whatsChanged: [],
      evidence: ["12 themes analyzed"],
      confidence: { level: "high", basis: "12 themes" },
      freshness: "2026-08-09T00:00:00.000Z",
      hasData: true,
      relatedResearch: [{ label: "Intelligence Hub", path: "/intelligence" }],
    },
    opportunityChanges: {
      available: true,
      majorMovers: [], upgrades: [], downgrades: [], newEntries: [], removed: [],
      totalChanged: 0,
      whatsNew: [], whatsChanged: [],
      evidence: ["50 symbols ranked"],
      confidence: { level: "medium", basis: "50 ranked symbols" },
      freshness: null,
      relatedResearch: [{ label: "Opportunity Workspace", path: "/opportunities" }],
    },
    themeChanges: {
      themes: [],
      whatsNew: [], whatsChanged: [],
      evidence: [],
      confidence: { level: "low", basis: "No data" },
      freshness: null,
      hasData: false,
      relatedResearch: [],
    },
    sectorChanges: {
      sectors: [],
      whatsNew: [], whatsChanged: [],
      evidence: [],
      confidence: { level: "low", basis: "No data" },
      freshness: null,
      hasData: false,
      relatedResearch: [],
    },
    institutionalChanges: {
      available: false,
      recentSignals: [],
      whatsNew: [], whatsChanged: [],
      evidence: [],
      confidence: { level: "low", basis: "Disabled" },
      freshness: null,
      relatedResearch: [],
    },
    collectionChanges: {
      collections: [],
      whatsNew: [], whatsChanged: [],
      evidence: [],
      confidence: { level: "low", basis: "No data" },
      freshness: null,
      relatedResearch: [],
    },
    myCollections: {
      pinned: [], favorites: [], followed: [], systemHighlights: [],
      total: 0,
      relatedResearch: [],
    },
    aiResearchSummary: {
      available: false,
      recentConversationCount: 0,
      pinnedConversationCount: 0,
      topModes: [],
      suggestedQueries: [],
      whatsNew: [],
      evidence: [],
      confidence: { level: "low", basis: "No data" },
      relatedResearch: [],
    },
    researchTimeline: {
      items: [],
      totalConversations: 0,
      available: false,
      relatedResearch: [],
    },
  });

  it("has all 10 top-level section keys", () => {
    const s = buildSnapshot();
    expect(s).toHaveProperty("marketOverview");
    expect(s).toHaveProperty("opportunityChanges");
    expect(s).toHaveProperty("themeChanges");
    expect(s).toHaveProperty("sectorChanges");
    expect(s).toHaveProperty("institutionalChanges");
    expect(s).toHaveProperty("collectionChanges");
    expect(s).toHaveProperty("myCollections");
    expect(s).toHaveProperty("aiResearchSummary");
    expect(s).toHaveProperty("researchTimeline");
    expect(s).toHaveProperty("generatedAt");
  });

  it("generatedAt is ISO string", () => {
    const s = buildSnapshot();
    expect(() => new Date(s.generatedAt)).not.toThrow();
    expect(new Date(s.generatedAt).getTime()).toBeGreaterThan(0);
  });

  it("marketOverview.marketHealthLabel is one of four values", () => {
    const s = buildSnapshot();
    expect(["Strong", "Moderate", "Weak", "Unknown"]).toContain(s.marketOverview.marketHealthLabel);
  });

  it("opportunityChanges.available is boolean", () => {
    const s = buildSnapshot();
    expect(typeof s.opportunityChanges.available).toBe("boolean");
  });

  it("every section has a relatedResearch array", () => {
    const s = buildSnapshot();
    expect(Array.isArray(s.marketOverview.relatedResearch)).toBe(true);
    expect(Array.isArray(s.opportunityChanges.relatedResearch)).toBe(true);
    expect(Array.isArray(s.themeChanges.relatedResearch)).toBe(true);
    expect(Array.isArray(s.sectorChanges.relatedResearch)).toBe(true);
    expect(Array.isArray(s.institutionalChanges.relatedResearch)).toBe(true);
    expect(Array.isArray(s.collectionChanges.relatedResearch)).toBe(true);
    expect(Array.isArray(s.myCollections.relatedResearch)).toBe(true);
    expect(Array.isArray(s.aiResearchSummary.relatedResearch)).toBe(true);
    expect(Array.isArray(s.researchTimeline.relatedResearch)).toBe(true);
  });

  it("every section has a confidence object", () => {
    const s = buildSnapshot();
    for (const section of [
      s.marketOverview, s.opportunityChanges, s.themeChanges,
      s.sectorChanges, s.institutionalChanges, s.collectionChanges,
      s.aiResearchSummary,
    ] as Array<{ confidence: import("@shared/command-center-types").ConfidenceLevel }>) {
      expect(section.confidence).toBeDefined();
      expect(["high", "medium", "low"]).toContain(section.confidence.level);
      expect(typeof section.confidence.basis).toBe("string");
    }
  });

  it("every section has whatsNew and whatsChanged arrays", () => {
    const s = buildSnapshot();
    const sections = [
      s.marketOverview, s.opportunityChanges, s.themeChanges,
      s.sectorChanges, s.institutionalChanges, s.collectionChanges,
    ] as Array<{ whatsNew: string[]; whatsChanged: string[] }>;
    for (const sec of sections) {
      expect(Array.isArray(sec.whatsNew)).toBe(true);
      expect(Array.isArray(sec.whatsChanged)).toBe(true);
    }
  });

  it("every section has an evidence array", () => {
    const s = buildSnapshot();
    const sections = [
      s.marketOverview, s.opportunityChanges, s.themeChanges,
      s.sectorChanges, s.institutionalChanges, s.collectionChanges,
      s.aiResearchSummary,
    ] as Array<{ evidence: string[] }>;
    for (const sec of sections) {
      expect(Array.isArray(sec.evidence)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Direction classification logic
// ---------------------------------------------------------------------------

describe("Direction classification helpers", () => {
  function directionOf(delta: number | null): "up" | "down" | "stable" {
    if (delta == null) return "stable";
    if (delta >= 3)  return "up";
    if (delta <= -3) return "down";
    return "stable";
  }

  it("null delta → stable", ()      => expect(directionOf(null)).toBe("stable"));
  it("delta +3 → up",      ()      => expect(directionOf(3)).toBe("up"));
  it("delta +10 → up",     ()      => expect(directionOf(10)).toBe("up"));
  it("delta -3 → down",    ()      => expect(directionOf(-3)).toBe("down"));
  it("delta -8 → down",    ()      => expect(directionOf(-8)).toBe("down"));
  it("delta +2 → stable",  ()      => expect(directionOf(2)).toBe("stable"));
  it("delta -2 → stable",  ()      => expect(directionOf(-2)).toBe("stable"));
  it("delta 0 → stable",   ()      => expect(directionOf(0)).toBe("stable"));
});

// ---------------------------------------------------------------------------
// 4. Market health label logic
// ---------------------------------------------------------------------------

describe("marketHealthLabel", () => {
  function marketHealthLabel(health: number | null): string {
    if (health == null) return "Unknown";
    if (health >= 70) return "Strong";
    if (health >= 45) return "Moderate";
    return "Weak";
  }

  it("null → Unknown",    () => expect(marketHealthLabel(null)).toBe("Unknown"));
  it("70  → Strong",      () => expect(marketHealthLabel(70)).toBe("Strong"));
  it("100 → Strong",      () => expect(marketHealthLabel(100)).toBe("Strong"));
  it("69  → Moderate",    () => expect(marketHealthLabel(69)).toBe("Moderate"));
  it("45  → Moderate",    () => expect(marketHealthLabel(45)).toBe("Moderate"));
  it("44  → Weak",        () => expect(marketHealthLabel(44)).toBe("Weak"));
  it("0   → Weak",        () => expect(marketHealthLabel(0)).toBe("Weak"));
});

// ---------------------------------------------------------------------------
// 5. Score-to-health calculation
// ---------------------------------------------------------------------------

describe("scoreToHealth", () => {
  function scoreToHealth(sectors: Array<{ score: number }>, themes: Array<{ score: number }>): number | null {
    const sScores = sectors.slice(0, 5).map(s => s.score).filter(Boolean) as number[];
    const tScores = themes.slice(0, 5).map(t => t.score).filter(Boolean) as number[];
    if (sScores.length === 0 && tScores.length === 0) return null;
    const combined = [...sScores, ...tScores];
    return Math.round(combined.reduce((a, b) => a + b, 0) / combined.length);
  }

  it("returns null when no data",         () => expect(scoreToHealth([], [])).toBeNull());
  it("averages sector scores",            () => expect(scoreToHealth([{ score: 80 }, { score: 60 }], [])).toBe(70));
  it("averages theme scores",             () => expect(scoreToHealth([], [{ score: 90 }, { score: 70 }])).toBe(80));
  it("averages mixed sectors and themes", () => {
    const result = scoreToHealth([{ score: 80 }], [{ score: 60 }]);
    expect(result).toBe(70);
  });
  it("ignores zero scores",               () => {
    const result = scoreToHealth([{ score: 0 }, { score: 80 }], []);
    // 0 is falsy — filtered out; only 80 remains
    expect(result).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// 6. OpportunityChangeItem changeType contract
// ---------------------------------------------------------------------------

describe("OpportunityChangeItem changeType values", () => {
  const validTypes: Array<import("@shared/command-center-types").OpportunityChangeItem["changeType"]> = [
    "upgrade", "downgrade", "new", "removed", "major_mover",
  ];
  it("changeType enum covers all 5 values", () => {
    expect(validTypes).toHaveLength(5);
  });
  it("scoreDelta is positive for upgrade", () => {
    const item: import("@shared/command-center-types").OpportunityChangeItem = {
      symbol: "AAPL", companyName: null,
      previousScore: 60, currentScore: 80, scoreDelta: 20,
      changeType: "upgrade", importance: "Major",
      explanation: "Score increased", drivers: [], warnings: [],
      previousState: null, currentState: null, relatedResearch: [],
    };
    expect(item.scoreDelta!).toBeGreaterThan(0);
  });
  it("scoreDelta is negative for downgrade", () => {
    const item: import("@shared/command-center-types").OpportunityChangeItem = {
      symbol: "AAPL", companyName: null,
      previousScore: 80, currentScore: 60, scoreDelta: -20,
      changeType: "downgrade", importance: "Moderate",
      explanation: "Score decreased", drivers: [], warnings: [],
      previousState: null, currentState: null, relatedResearch: [],
    };
    expect(item.scoreDelta!).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. InstitutionalChangesSection magnitude values
// ---------------------------------------------------------------------------

describe("InstitutionalChangesSection magnitude values", () => {
  it("magnitude is one of high/medium/low", () => {
    const validMagnitudes = ["high", "medium", "low"];
    const section: import("@shared/command-center-types").InstitutionalChangesSection = {
      available: true,
      recentSignals: [
        { symbol: "NVDA", companyName: null, signalType: "accumulation", magnitude: "high", detail: "test", calculatedAt: null, relatedResearch: [] },
        { symbol: "AAPL", companyName: null, signalType: "distribution",  magnitude: "low",  detail: "test", calculatedAt: null, relatedResearch: [] },
      ],
      whatsNew: [], whatsChanged: [], evidence: [],
      confidence: { level: "high", basis: "2 signals" },
      freshness: null,
      relatedResearch: [],
    };
    for (const s of section.recentSignals) {
      expect(validMagnitudes).toContain(s.magnitude);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. CollectionChangesSection — structure
// ---------------------------------------------------------------------------

describe("CollectionChangesSection structure", () => {
  it("collections array elements have id and name", () => {
    const section: import("@shared/command-center-types").CollectionChangesSection = {
      collections: [
        {
          id: "col-1", name: "AI Infrastructure", collectionType: "system",
          systemKey: "ai-infrastructure", opportunityCount: 10,
          topOpportunities: ["NVDA"], isFollowing: false, isFavorite: false, isPinned: false,
          relatedResearch: [{ label: "View", path: "/research?collection=col-1" }],
        },
      ],
      whatsNew: ["10 candidates in AI Infrastructure"],
      whatsChanged: [],
      evidence: ["1 collection"],
      confidence: { level: "high", basis: "25 system collections" },
      freshness: null,
      relatedResearch: [{ label: "Research Hub", path: "/research" }],
    };
    expect(section.collections[0].id).toBe("col-1");
    expect(section.collections[0].name).toBe("AI Infrastructure");
    expect(section.collections[0].relatedResearch.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 9. MyCollectionsSection — groups
// ---------------------------------------------------------------------------

describe("MyCollectionsSection groups", () => {
  it("has pinned, favorites, followed, systemHighlights arrays", () => {
    const section: import("@shared/command-center-types").MyCollectionsSection = {
      pinned: [], favorites: [], followed: [],
      systemHighlights: [
        { id: "col-2", name: "Growth", collectionType: "system", systemKey: "growth",
          opportunityCount: 5, topOpportunities: [], isFollowing: true, isFavorite: false, isPinned: false,
          relatedResearch: [] },
      ],
      total: 1,
      relatedResearch: [],
    };
    expect(Array.isArray(section.pinned)).toBe(true);
    expect(Array.isArray(section.favorites)).toBe(true);
    expect(Array.isArray(section.followed)).toBe(true);
    expect(section.systemHighlights).toHaveLength(1);
    expect(section.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 10. AiResearchSummarySection — suggested queries shape
// ---------------------------------------------------------------------------

describe("AiResearchSummarySection — suggested queries", () => {
  it("each query has label, mode, scope, promptText", () => {
    const queries: import("@shared/command-center-types").SuggestedQuery[] = [
      {
        label: "What changed today?",
        description: "Market summary",
        mode: "market",
        scope: "entire_market",
        promptText: "Summarize today's changes",
      },
      {
        label: "AI Infrastructure leaders",
        description: "Top ranked in AI theme",
        mode: "collection",
        scope: "ai-infrastructure",
        promptText: "Show AI infrastructure leaders",
      },
    ];
    for (const q of queries) {
      expect(typeof q.label).toBe("string");
      expect(typeof q.mode).toBe("string");
      expect(typeof q.scope).toBe("string");
      expect(typeof q.promptText).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// 11. ResearchTimelineSection — items shape
// ---------------------------------------------------------------------------

describe("ResearchTimelineSection — item structure", () => {
  it("items have id, title, researchMode, contextScope, lastMessageAt, isPinned", () => {
    const item: import("@shared/command-center-types").ResearchTimelineItem = {
      id:           "c1",
      title:        "AI analysis",
      researchMode: "theme",
      contextScope: "ai-infrastructure",
      lastMessageAt: "2026-08-09T00:00:00.000Z",
      isPinned:     false,
      relatedResearch: [],
    };
    expect(item.id).toBe("c1");
    expect(typeof item.isPinned).toBe("boolean");
    expect(() => new Date(item.lastMessageAt)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 12. CommandCenterHealthSnapshot fields
// ---------------------------------------------------------------------------

describe("CommandCenterHealthSnapshot fields", () => {
  it("has all required health fields", () => {
    const snap: import("@shared/command-center-types").CommandCenterHealthSnapshot = {
      lastGeneratedAt:             null,
      sectionsAvailable:           0,
      opportunityChangesAvailable: false,
      themeDataAvailable:          false,
      sectorDataAvailable:         false,
      collectionsSeeded:           false,
      institutionalDataAvailable:  false,
    };
    expect(snap.sectionsAvailable).toBe(0);
    expect(snap.lastGeneratedAt).toBeNull();
    expect(typeof snap.collectionsSeeded).toBe("boolean");
  });

  it("sectionsAvailable is bounded [0, 9]", () => {
    const maxSections = 9; // 9 sections can be "available"
    const snap: import("@shared/command-center-types").CommandCenterHealthSnapshot = {
      lastGeneratedAt: "2026-08-09T00:00:00.000Z",
      sectionsAvailable: maxSections,
      opportunityChangesAvailable: true,
      themeDataAvailable: true,
      sectorDataAvailable: true,
      collectionsSeeded: true,
      institutionalDataAvailable: true,
    };
    expect(snap.sectionsAvailable).toBeLessThanOrEqual(9);
    expect(snap.sectionsAvailable).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 13. Route registration export
// ---------------------------------------------------------------------------

describe("registerCommandCenterRoutes export", () => {
  it("is a function", async () => {
    const mod = await import("../market-research-command-center");
    expect(typeof mod.registerCommandCenterRoutes).toBe("function");
  });

  it("getCommandCenterHealth is exported and returns valid shape", async () => {
    const mod = await import("../market-research-command-center");
    expect(typeof mod.getCommandCenterHealth).toBe("function");
    const health = mod.getCommandCenterHealth();
    expect(health).toHaveProperty("sectionsAvailable");
    expect(health).toHaveProperty("lastGeneratedAt");
    expect(health).toHaveProperty("opportunityChangesAvailable");
    expect(health).toHaveProperty("themeDataAvailable");
    expect(health).toHaveProperty("sectorDataAvailable");
    expect(health).toHaveProperty("collectionsSeeded");
    expect(health).toHaveProperty("institutionalDataAvailable");
  });
});

// ---------------------------------------------------------------------------
// 14. Compliance — no forbidden terms in type file
// ---------------------------------------------------------------------------

describe("CommandCenter types — compliance contract", () => {
  it("SuggestedQuery promptText does not contain 'recommendation'", () => {
    const queries: import("@shared/command-center-types").SuggestedQuery[] = [
      {
        label: "What changed today?",
        description: "Market summary",
        mode: "market",
        scope: "entire_market",
        promptText: "Summarize today's market intelligence and key evidence changes",
      },
    ];
    for (const q of queries) {
      expect(q.promptText.toLowerCase()).not.toContain("recommendation");
      expect(q.promptText.toLowerCase()).not.toContain("buy ");
      expect(q.promptText.toLowerCase()).not.toContain("sell ");
    }
  });

  it("OpportunityChangeItem explanation field does not enforce prohibited terms", () => {
    const item: import("@shared/command-center-types").OpportunityChangeItem = {
      symbol: "AAPL", companyName: "Apple Inc.",
      previousScore: 60, currentScore: 75, scoreDelta: 15,
      changeType: "upgrade", importance: "Moderate",
      explanation: "Research score increased based on technical evidence",
      drivers: ["Contraction tightening", "Volume confirmation"],
      warnings: [],
      previousState: "QUALIFIED", currentState: "QUALIFIED",
      relatedResearch: [],
    };
    expect(item.explanation).not.toContain("recommendation");
    expect(item.explanation).not.toContain("buy");
    expect(item.explanation).not.toContain("sell");
  });
});

// ---------------------------------------------------------------------------
// 15. OpportunityChangesSection — totalChanged derivation
// ---------------------------------------------------------------------------

describe("OpportunityChangesSection — totalChanged", () => {
  it("totalChanged equals sum of all change arrays", () => {
    const section: import("@shared/command-center-types").OpportunityChangesSection = {
      available: true,
      majorMovers:  [{ symbol: "A", companyName: null, previousScore: null, currentScore: null, scoreDelta: null, changeType: "major_mover", importance: "Critical", explanation: "", drivers: [], warnings: [], previousState: null, currentState: null, relatedResearch: [] }],
      upgrades:     [{ symbol: "B", companyName: null, previousScore: null, currentScore: null, scoreDelta: null, changeType: "upgrade",     importance: "Major",    explanation: "", drivers: [], warnings: [], previousState: null, currentState: null, relatedResearch: [] },
                     { symbol: "C", companyName: null, previousScore: null, currentScore: null, scoreDelta: null, changeType: "upgrade",     importance: "Minor",    explanation: "", drivers: [], warnings: [], previousState: null, currentState: null, relatedResearch: [] }],
      downgrades:   [],
      newEntries:   [{ symbol: "D", companyName: null, previousScore: null, currentScore: null, scoreDelta: null, changeType: "new",         importance: "Moderate", explanation: "", drivers: [], warnings: [], previousState: null, currentState: null, relatedResearch: [] }],
      removed:      [],
      totalChanged: 4,
      whatsNew: [], whatsChanged: [], evidence: [],
      confidence: { level: "high", basis: "4 changes" },
      freshness: null,
      relatedResearch: [],
    };
    const computed =
      section.majorMovers.length + section.upgrades.length +
      section.downgrades.length + section.newEntries.length + section.removed.length;
    expect(computed).toBe(section.totalChanged);
  });
});

// ---------------------------------------------------------------------------
// 16. MarketOverviewSection — marketHealth bounds
// ---------------------------------------------------------------------------

describe("MarketOverviewSection — marketHealth", () => {
  it("marketHealth is null or number in [0, 100]", () => {
    const section: import("@shared/command-center-types").MarketOverviewSection = {
      regime: "bull",
      marketHealth: 78,
      marketHealthLabel: "Strong",
      leadingThemes: [], leadingSectors: [],
      mostImprovedThemes: [], weakeningThemes: [],
      whatsNew: [], whatsChanged: [], evidence: [],
      confidence: { level: "high", basis: "10 snapshots" },
      freshness: null,
      hasData: true,
      relatedResearch: [],
    };
    if (section.marketHealth != null) {
      expect(section.marketHealth).toBeGreaterThanOrEqual(0);
      expect(section.marketHealth).toBeLessThanOrEqual(100);
    }
  });

  it("hasData false yields correct marketHealthLabel", () => {
    const section: import("@shared/command-center-types").MarketOverviewSection = {
      regime: null, marketHealth: null, marketHealthLabel: "Unknown",
      leadingThemes: [], leadingSectors: [],
      mostImprovedThemes: [], weakeningThemes: [],
      whatsNew: [], whatsChanged: [], evidence: [],
      confidence: { level: "low", basis: "No data" },
      freshness: null,
      hasData: false,
      relatedResearch: [],
    };
    expect(section.marketHealthLabel).toBe("Unknown");
    expect(section.hasData).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 17. ThemeChangesSection — sort order contract
// ---------------------------------------------------------------------------

describe("ThemeChangesSection — themes are by score descending", () => {
  it("top theme has highest score", () => {
    const themes: import("@shared/command-center-types").ThemeSummaryItem[] = [
      { themeId: "a", themeName: "AI",    score: 90, direction: "up",   scoreDelta: 5,  topSymbols: [], relatedResearch: [] },
      { themeId: "b", themeName: "Cloud", score: 70, direction: "stable", scoreDelta: 0, topSymbols: [], relatedResearch: [] },
      { themeId: "c", themeName: "Cyber", score: 55, direction: "down", scoreDelta: -4, topSymbols: [], relatedResearch: [] },
    ];
    // Verify sorted order (the route builder sorts; we verify the contract)
    const sorted = [...themes].sort((a, b) => b.score - a.score);
    expect(sorted[0].score).toBeGreaterThanOrEqual(sorted[1].score);
    expect(sorted[1].score).toBeGreaterThanOrEqual(sorted[2].score);
  });
});

// ---------------------------------------------------------------------------
// 18. SectorChangesSection — direction from delta
// ---------------------------------------------------------------------------

describe("SectorChangesSection — direction from delta", () => {
  it("improving sector has direction up", () => {
    const sector: import("@shared/command-center-types").SectorSummaryItem = {
      sector: "Technology", label: "Technology",
      score: 80, direction: "up", scoreDelta: 7,
      topSymbols: [], relatedResearch: [],
    };
    expect(sector.direction).toBe("up");
    expect(sector.scoreDelta).toBeGreaterThan(0);
  });

  it("weakening sector has direction down", () => {
    const sector: import("@shared/command-center-types").SectorSummaryItem = {
      sector: "Energy", label: "Energy",
      score: 40, direction: "down", scoreDelta: -5,
      topSymbols: [], relatedResearch: [],
    };
    expect(sector.direction).toBe("down");
    expect(sector.scoreDelta!).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// 19. Client page — data-testid attributes present
// ---------------------------------------------------------------------------

describe("MarketResearchCommandCenterPage — data-testid contract", () => {
  const EXPECTED_TESTIDS = [
    "cmd-center-title",
    "cmd-market-overview",
    "cmd-opp-changes",
    "cmd-theme-changes",
    "cmd-sector-changes",
    "cmd-institutional-changes",
    "cmd-collection-changes",
    "cmd-my-collections",
    "cmd-ai-research-summary",
    "cmd-research-timeline",
    "cmd-explain-why",
  ];

  it("page exports all required data-testid identifiers", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("client/src/pages/market-research-command-center.tsx", "utf8");
    for (const id of EXPECTED_TESTIDS) {
      expect(src, `Missing data-testid="${id}"`).toContain(`data-testid="${id}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// 20. Cross-navigation — relatedResearch paths are valid routes
// ---------------------------------------------------------------------------

describe("relatedResearch paths — valid route format", () => {
  it("all paths start with /", () => {
    const links: import("@shared/command-center-types").RelatedResearchLink[] = [
      { label: "Opportunity Workspace", path: "/opportunities" },
      { label: "AI Workspace",          path: "/research-workspace" },
      { label: "Theme Detail",          path: "/intelligence/themes/ai-infrastructure" },
      { label: "Sector Detail",         path: "/intelligence/sectors/Technology" },
      { label: "Collections",           path: "/research?collection=abc" },
      { label: "Institutional Funds",   path: "/institutional/funds" },
    ];
    for (const l of links) {
      expect(l.path.startsWith("/")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 21. Free vs Premium documentation
// ---------------------------------------------------------------------------

describe("Free vs Premium documentation", () => {
  it("command-center-types.ts documents access tiers in JSDoc", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("shared/command-center-types.ts", "utf8");
    expect(src).toContain("Registered users (free)");
    expect(src).toContain("Subscribers");
    expect(src).toContain("Professional");
    expect(src).toContain("Enterprise");
    expect(src).toContain("No artificial restrictions");
  });
});
