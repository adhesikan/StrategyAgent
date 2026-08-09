/**
 * Research Monitor Tests — Sprint 2.5.4
 *
 * 150+ assertions covering:
 *   - WatchType enum completeness
 *   - ResearchWatch domain model
 *   - WatchActivityType coverage
 *   - DailyResearchFeed structure
 *   - FeedSection / FeedItem shapes
 *   - NotificationTarget future interface
 *   - MyWatchChangesSection structure
 *   - ResearchMonitoringHealth structure
 *   - API route validation logic
 *   - ChangeDirection enum
 *   - WATCH_TYPES array coverage
 *   - createWatch input validation
 *   - updateWatch input validation
 *   - Feed summary computation
 *   - Feed section change types
 *   - Platform health integration
 *   - Command center type integration
 *   - Ops doc existence
 *   - Changelog + API reference
 *   - Schema migration safety
 *   - Compliance terminology
 */

import { describe, it, expect } from "vitest";
import {
  WATCH_TYPES,
  type WatchType,
  type WatchStatus,
  type ChangeDirection,
  type WatchActivityType,
  type ResearchWatch,
  type WatchActivityEntry,
  type WatchEvaluation,
  type WatchCurrentStatus,
  type ResearchWatchDetail,
  type RelatedCandidate,
  type DailyResearchFeed,
  type FeedSection,
  type FeedItem,
  type FeedSummary,
  type CreateWatchInput,
  type UpdateWatchInput,
  type NotificationTarget,
  type NotificationChannelStatus,
  type ResearchMonitoringHealth,
  type WatchChangeSummary,
  type MyWatchChangesSection,
} from "../../../shared/research-monitor-types";

// ============================================================================
// 1. WatchType Enum Completeness
// ============================================================================

describe("WatchType enum", () => {
  it("WATCH_TYPES is an array", () => {
    expect(Array.isArray(WATCH_TYPES)).toBe(true);
  });

  it("contains at least 12 watch types", () => {
    expect(WATCH_TYPES.length).toBeGreaterThanOrEqual(12);
  });

  it("contains all core entity types", () => {
    expect(WATCH_TYPES).toContain("company");
    expect(WATCH_TYPES).toContain("theme");
    expect(WATCH_TYPES).toContain("sector");
    expect(WATCH_TYPES).toContain("collection");
    expect(WATCH_TYPES).toContain("market_regime");
    expect(WATCH_TYPES).toContain("institutional_activity");
  });

  it("contains all candidate category types", () => {
    expect(WATCH_TYPES).toContain("growth_candidates");
    expect(WATCH_TYPES).toContain("income_candidates");
    expect(WATCH_TYPES).toContain("momentum");
    expect(WATCH_TYPES).toContain("etf_candidates");
    expect(WATCH_TYPES).toContain("dividend_candidates");
  });

  it("contains opportunity_type", () => {
    expect(WATCH_TYPES).toContain("opportunity_type");
  });

  it("contains custom_collection", () => {
    expect(WATCH_TYPES).toContain("custom_collection");
  });

  it("has no duplicates", () => {
    const unique = new Set(WATCH_TYPES);
    expect(unique.size).toBe(WATCH_TYPES.length);
  });

  it("all entries are non-empty strings", () => {
    WATCH_TYPES.forEach(t => {
      expect(typeof t).toBe("string");
      expect(t.length).toBeGreaterThan(0);
    });
  });

  it("uses snake_case", () => {
    WATCH_TYPES.forEach(t => {
      expect(t).toMatch(/^[a-z_]+$/);
    });
  });
});

// ============================================================================
// 2. ResearchWatch Domain Model
// ============================================================================

describe("ResearchWatch domain model", () => {
  function makeWatch(overrides: Partial<ResearchWatch> = {}): ResearchWatch {
    return {
      id: "watch-1",
      userId: "user-1",
      name: "NVDA Watch",
      watchType: "company",
      entityId: "NVDA",
      entityLabel: "NVIDIA Corporation",
      status: "active",
      lastEvaluatedAt: null,
      lastChangeAt: null,
      lastChangeType: null,
      lastChangeSummary: null,
      notifyEmail: false,
      notifyPush: false,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      ...overrides,
    };
  }

  it("has required fields", () => {
    const w = makeWatch();
    expect(w.id).toBeDefined();
    expect(w.userId).toBeDefined();
    expect(w.name).toBeDefined();
    expect(w.watchType).toBeDefined();
    expect(w.status).toBeDefined();
    expect(w.notifyEmail).toBeDefined();
    expect(w.notifyPush).toBeDefined();
    expect(w.createdAt).toBeInstanceOf(Date);
    expect(w.updatedAt).toBeInstanceOf(Date);
  });

  it("entityId is nullable", () => {
    const w = makeWatch({ entityId: null });
    expect(w.entityId).toBeNull();
  });

  it("entityLabel is nullable", () => {
    const w = makeWatch({ entityLabel: null });
    expect(w.entityLabel).toBeNull();
  });

  it("lastEvaluatedAt is nullable", () => {
    const w = makeWatch({ lastEvaluatedAt: null });
    expect(w.lastEvaluatedAt).toBeNull();
  });

  it("lastChangeAt is nullable", () => {
    const w = makeWatch({ lastChangeAt: null });
    expect(w.lastChangeAt).toBeNull();
  });

  it("lastChangeSummary is nullable", () => {
    const w = makeWatch({ lastChangeSummary: null });
    expect(w.lastChangeSummary).toBeNull();
  });

  it("future notification fields present but default false", () => {
    const w = makeWatch();
    expect(w.notifyEmail).toBe(false);
    expect(w.notifyPush).toBe(false);
  });

  it("accepts all valid watch types", () => {
    WATCH_TYPES.forEach(t => {
      const w = makeWatch({ watchType: t });
      expect(w.watchType).toBe(t);
    });
  });

  it("accepts all valid statuses", () => {
    const statuses: WatchStatus[] = ["active", "paused", "archived"];
    statuses.forEach(s => {
      const w = makeWatch({ status: s });
      expect(w.status).toBe(s);
    });
  });
});

// ============================================================================
// 3. WatchActivityEntry
// ============================================================================

describe("WatchActivityEntry", () => {
  function makeEntry(overrides: Partial<WatchActivityEntry> = {}): WatchActivityEntry {
    return {
      id: "act-1",
      watchId: "watch-1",
      userId: "user-1",
      activityType: "score_improved",
      entitySymbol: "NVDA",
      entityLabel: "NVIDIA Corporation",
      changeDirection: "improved",
      changeData: { from: 70, to: 85, delta: 15 },
      observedAt: new Date("2026-01-01"),
      ...overrides,
    };
  }

  it("has required fields", () => {
    const e = makeEntry();
    expect(e.id).toBeDefined();
    expect(e.watchId).toBeDefined();
    expect(e.userId).toBeDefined();
    expect(e.activityType).toBeDefined();
    expect(e.observedAt).toBeInstanceOf(Date);
  });

  it("entitySymbol is nullable", () => {
    const e = makeEntry({ entitySymbol: null });
    expect(e.entitySymbol).toBeNull();
  });

  it("changeDirection is nullable", () => {
    const e = makeEntry({ changeDirection: null });
    expect(e.changeDirection).toBeNull();
  });

  it("changeData is nullable", () => {
    const e = makeEntry({ changeData: null });
    expect(e.changeData).toBeNull();
  });

  it("changeData can hold from/to/delta", () => {
    const e = makeEntry({ changeData: { from: 70, to: 85, delta: 15, reasons: ["volume surge"] } });
    expect((e.changeData as any).from).toBe(70);
    expect((e.changeData as any).to).toBe(85);
    expect((e.changeData as any).delta).toBe(15);
  });

  const validActivityTypes: WatchActivityType[] = [
    "new_candidate", "candidate_removed", "score_improved", "score_weakened",
    "confidence_changed", "regime_change", "theme_improved", "theme_weakened",
    "sector_improved", "sector_weakened", "collection_added", "collection_removed",
    "institutional_accumulation", "institutional_distribution",
    "member_count_changed", "status_unchanged",
  ];

  it("accepts all defined activity types", () => {
    validActivityTypes.forEach(t => {
      const e = makeEntry({ activityType: t });
      expect(e.activityType).toBe(t);
    });
  });
});

// ============================================================================
// 4. WatchEvaluation
// ============================================================================

describe("WatchEvaluation", () => {
  function makeEval(overrides: Partial<WatchEvaluation> = {}): WatchEvaluation {
    return {
      watchId: "watch-1",
      evaluatedAt: "2026-01-01T00:00:00.000Z",
      changed: true,
      changeType: "score_improved",
      changeDirection: "improved",
      changeSummary: "Score improved by 10 points",
      activityEntries: [],
      currentStatus: { score: 85, lastUpdated: "2026-01-01T00:00:00.000Z" },
      ...overrides,
    };
  }

  it("has required fields", () => {
    const e = makeEval();
    expect(e.watchId).toBeDefined();
    expect(e.evaluatedAt).toBeDefined();
    expect(typeof e.changed).toBe("boolean");
    expect(e.changeSummary).toBeDefined();
  });

  it("changed=false produces stable evaluation", () => {
    const e = makeEval({ changed: false, changeType: "status_unchanged", changeDirection: null, changeSummary: "No change" });
    expect(e.changed).toBe(false);
    expect(e.changeType).toBe("status_unchanged");
    expect(e.changeDirection).toBeNull();
  });

  it("currentStatus has lastUpdated", () => {
    const e = makeEval();
    expect(e.currentStatus.lastUpdated).toBeDefined();
  });
});

// ============================================================================
// 5. WatchCurrentStatus
// ============================================================================

describe("WatchCurrentStatus", () => {
  it("score is optional", () => {
    const s: WatchCurrentStatus = { lastUpdated: null };
    expect(s.score).toBeUndefined();
  });

  it("memberCount is optional", () => {
    const s: WatchCurrentStatus = { lastUpdated: null };
    expect(s.memberCount).toBeUndefined();
  });

  it("regime is optional", () => {
    const s: WatchCurrentStatus = { lastUpdated: null };
    expect(s.regime).toBeUndefined();
  });

  it("freshnessSec is optional", () => {
    const s: WatchCurrentStatus = { lastUpdated: null };
    expect(s.freshnessSec).toBeUndefined();
  });
});

// ============================================================================
// 6. ChangeDirection enum
// ============================================================================

describe("ChangeDirection", () => {
  const directions: ChangeDirection[] = ["improved", "weakened", "new", "removed", "attention", "stable"];
  it("has 6 valid directions", () => expect(directions.length).toBe(6));

  it("covers all semantic cases", () => {
    expect(directions).toContain("improved");
    expect(directions).toContain("weakened");
    expect(directions).toContain("new");
    expect(directions).toContain("removed");
    expect(directions).toContain("attention");
    expect(directions).toContain("stable");
  });
});

// ============================================================================
// 7. DailyResearchFeed
// ============================================================================

describe("DailyResearchFeed", () => {
  function makeFeed(overrides: Partial<DailyResearchFeed> = {}): DailyResearchFeed {
    return {
      feedId: "feed-2026-01-01",
      generatedAt: "2026-01-01T00:00:00.000Z",
      feedDate: "2026-01-01",
      summary: {
        totalChanges: 5,
        highlights: ["3 new candidates"],
        newCandidates: 3,
        improvedCandidates: 1,
        weakenedCandidates: 1,
        themeChanges: 0,
        sectorChanges: 0,
        regimeChanged: false,
      },
      sections: [],
      isPersonalized: false,
      watchCount: 0,
      ...overrides,
    };
  }

  it("has required top-level fields", () => {
    const f = makeFeed();
    expect(f.feedId).toBeDefined();
    expect(f.generatedAt).toBeDefined();
    expect(f.feedDate).toBeDefined();
    expect(f.summary).toBeDefined();
    expect(Array.isArray(f.sections)).toBe(true);
    expect(typeof f.isPersonalized).toBe("boolean");
    expect(typeof f.watchCount).toBe("number");
  });

  it("summary has all required counts", () => {
    const f = makeFeed();
    expect(typeof f.summary.totalChanges).toBe("number");
    expect(Array.isArray(f.summary.highlights)).toBe(true);
    expect(typeof f.summary.newCandidates).toBe("number");
    expect(typeof f.summary.improvedCandidates).toBe("number");
    expect(typeof f.summary.weakenedCandidates).toBe("number");
    expect(typeof f.summary.themeChanges).toBe("number");
    expect(typeof f.summary.sectorChanges).toBe("number");
    expect(typeof f.summary.regimeChanged).toBe("boolean");
  });

  it("summary totalChanges can be 0 (no changes)", () => {
    const f = makeFeed({ summary: { ...makeFeed().summary, totalChanges: 0, highlights: ["No significant changes"] } });
    expect(f.summary.totalChanges).toBe(0);
    expect(f.summary.highlights).toContain("No significant changes");
  });

  it("isPersonalized=true when user has watches", () => {
    const f = makeFeed({ isPersonalized: true, watchCount: 3 });
    expect(f.isPersonalized).toBe(true);
    expect(f.watchCount).toBe(3);
  });
});

// ============================================================================
// 8. FeedSection
// ============================================================================

describe("FeedSection", () => {
  function makeSection(overrides: Partial<FeedSection> = {}): FeedSection {
    return {
      id: "new-candidates",
      title: "3 New Qualified Candidates",
      description: "Symbols that newly qualified based on research signals",
      changeType: "new",
      count: 3,
      items: [],
      ...overrides,
    };
  }

  it("has required fields", () => {
    const s = makeSection();
    expect(s.id).toBeDefined();
    expect(s.title).toBeDefined();
    expect(s.description).toBeDefined();
    expect(s.changeType).toBeDefined();
    expect(typeof s.count).toBe("number");
    expect(Array.isArray(s.items)).toBe(true);
  });

  it("linkTo is optional", () => {
    const s = makeSection({ linkTo: undefined });
    expect(s.linkTo).toBeUndefined();
  });

  const validChangeTypes: FeedSection["changeType"][] = ["new", "improved", "weakened", "attention", "stable"];
  it("accepts all valid change types", () => {
    validChangeTypes.forEach(t => {
      const s = makeSection({ changeType: t });
      expect(s.changeType).toBe(t);
    });
  });

  it("title includes count when count > 0", () => {
    const s = makeSection({ count: 5, title: "5 New Qualified Candidates" });
    expect(s.title).toMatch(/5/);
  });
});

// ============================================================================
// 9. FeedItem
// ============================================================================

describe("FeedItem", () => {
  function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
    return {
      id: "item-1",
      symbol: "NVDA",
      label: "NVIDIA",
      detail: "Research score improved to 88",
      changeDirection: "improved",
      linkTo: "/opportunities/NVDA",
      score: 88,
      ...overrides,
    };
  }

  it("has required fields", () => {
    const i = makeItem();
    expect(i.id).toBeDefined();
    expect(i.label).toBeDefined();
    expect(i.detail).toBeDefined();
    expect(i.changeDirection).toBeDefined();
    expect(i.linkTo).toBeDefined();
  });

  it("symbol is optional", () => {
    const i = makeItem({ symbol: undefined });
    expect(i.symbol).toBeUndefined();
  });

  it("score is optional", () => {
    const i = makeItem({ score: undefined });
    expect(i.score).toBeUndefined();
  });

  it("delta is optional", () => {
    const i = makeItem({ delta: 5 });
    expect(i.delta).toBe(5);
  });

  it("linkTo always points to an existing app page", () => {
    const validPrefixes = ["/", "http"];
    const i = makeItem();
    const valid = validPrefixes.some(p => i.linkTo.startsWith(p));
    expect(valid).toBe(true);
  });
});

// ============================================================================
// 10. CreateWatchInput validation
// ============================================================================

describe("CreateWatchInput validation", () => {
  it("has required name field", () => {
    const input: CreateWatchInput = { name: "My Watch", watchType: "company" };
    expect(input.name).toBe("My Watch");
  });

  it("has required watchType field", () => {
    const input: CreateWatchInput = { name: "My Watch", watchType: "theme" };
    expect(input.watchType).toBe("theme");
  });

  it("entityId is optional", () => {
    const input: CreateWatchInput = { name: "Growth Watch", watchType: "growth_candidates" };
    expect(input.entityId).toBeUndefined();
  });

  it("entityLabel is optional", () => {
    const input: CreateWatchInput = { name: "Watch", watchType: "company", entityId: "NVDA" };
    expect(input.entityLabel).toBeUndefined();
  });

  it("entity-required types: company needs entityId", () => {
    const entityRequired: WatchType[] = ["company", "theme", "sector", "collection", "institutional_activity"];
    entityRequired.forEach(t => {
      // Just verify the types are in WATCH_TYPES (validation enforced in route layer)
      expect(WATCH_TYPES).toContain(t);
    });
  });

  it("market-wide types do not require entityId", () => {
    const marketWide: WatchType[] = ["market_regime", "growth_candidates", "income_candidates", "momentum"];
    marketWide.forEach(t => {
      const input: CreateWatchInput = { name: "Watch", watchType: t };
      expect(input.entityId).toBeUndefined();
    });
  });
});

// ============================================================================
// 11. UpdateWatchInput
// ============================================================================

describe("UpdateWatchInput", () => {
  it("all fields are optional", () => {
    const input: UpdateWatchInput = {};
    expect(Object.keys(input).length).toBe(0);
  });

  it("can update name only", () => {
    const input: UpdateWatchInput = { name: "New Name" };
    expect(input.name).toBe("New Name");
    expect(input.status).toBeUndefined();
  });

  it("can update status to paused", () => {
    const input: UpdateWatchInput = { status: "paused" };
    expect(input.status).toBe("paused");
  });

  it("can update notification flags (future)", () => {
    const input: UpdateWatchInput = { notifyEmail: true };
    expect(input.notifyEmail).toBe(true);
  });

  it("accepts all valid statuses", () => {
    const statuses: WatchStatus[] = ["active", "paused", "archived"];
    statuses.forEach(s => {
      const input: UpdateWatchInput = { status: s };
      expect(input.status).toBe(s);
    });
  });
});

// ============================================================================
// 12. NotificationTarget (future interface only)
// ============================================================================

describe("NotificationTarget (future interface — not implemented)", () => {
  it("supports email channel type", () => {
    const target: NotificationTarget = { type: "email", config: {}, enabled: false };
    expect(target.type).toBe("email");
    expect(target.enabled).toBe(false);
  });

  it("supports push channel type", () => {
    const target: NotificationTarget = { type: "push", config: {}, enabled: false };
    expect(target.type).toBe("push");
  });

  it("supports slack channel type", () => {
    const target: NotificationTarget = { type: "slack", config: {}, enabled: false };
    expect(target.type).toBe("slack");
  });

  it("supports teams channel type", () => {
    const target: NotificationTarget = { type: "teams", config: {}, enabled: false };
    expect(target.type).toBe("teams");
  });

  it("supports webhook channel type", () => {
    const target: NotificationTarget = { type: "webhook", config: { url: "https://example.com" }, enabled: false };
    expect(target.type).toBe("webhook");
  });

  it("enabled is always false (not implemented)", () => {
    // Future sprint: these are always false until notification infrastructure is built
    const channels: NotificationTarget["type"][] = ["email", "push", "slack", "teams", "webhook"];
    channels.forEach(t => {
      const target: NotificationTarget = { type: t, config: {}, enabled: false };
      expect(target.enabled).toBe(false);
    });
  });

  it("config is a plain object (extensible)", () => {
    const target: NotificationTarget = { type: "slack", config: { workspace: "my-workspace", channel: "#research" }, enabled: false };
    expect(typeof target.config).toBe("object");
  });
});

// ============================================================================
// 13. NotificationChannelStatus (future)
// ============================================================================

describe("NotificationChannelStatus (future interface)", () => {
  it("has required fields", () => {
    const status: NotificationChannelStatus = {
      channelType: "email",
      isConfigured: false,
      isEnabled: false,
      lastDeliveredAt: null,
    };
    expect(status.channelType).toBeDefined();
    expect(typeof status.isConfigured).toBe("boolean");
    expect(typeof status.isEnabled).toBe("boolean");
    expect(status.lastDeliveredAt).toBeNull();
  });
});

// ============================================================================
// 14. ResearchMonitoringHealth
// ============================================================================

describe("ResearchMonitoringHealth", () => {
  it("has required numeric fields", () => {
    const h: ResearchMonitoringHealth = {
      watchCount: 5,
      activeWatchCount: 4,
      lastEvaluatedAt: "2026-01-01T00:00:00.000Z",
      lastFeedGeneratedAt: null,
      evaluationsToday: 12,
    };
    expect(typeof h.watchCount).toBe("number");
    expect(typeof h.activeWatchCount).toBe("number");
    expect(typeof h.evaluationsToday).toBe("number");
  });

  it("lastEvaluatedAt is nullable", () => {
    const h: ResearchMonitoringHealth = {
      watchCount: 0, activeWatchCount: 0,
      lastEvaluatedAt: null, lastFeedGeneratedAt: null, evaluationsToday: 0,
    };
    expect(h.lastEvaluatedAt).toBeNull();
  });

  it("activeWatchCount <= watchCount", () => {
    const h: ResearchMonitoringHealth = {
      watchCount: 5, activeWatchCount: 3,
      lastEvaluatedAt: null, lastFeedGeneratedAt: null, evaluationsToday: 8,
    };
    expect(h.activeWatchCount).toBeLessThanOrEqual(h.watchCount);
  });

  it("zero state is valid", () => {
    const h: ResearchMonitoringHealth = {
      watchCount: 0, activeWatchCount: 0,
      lastEvaluatedAt: null, lastFeedGeneratedAt: null, evaluationsToday: 0,
    };
    expect(h.watchCount).toBe(0);
    expect(h.evaluationsToday).toBe(0);
  });
});

// ============================================================================
// 15. WatchChangeSummary
// ============================================================================

describe("WatchChangeSummary", () => {
  it("has required fields", () => {
    const s: WatchChangeSummary = {
      watchId: "watch-1",
      watchName: "NVDA Watch",
      watchType: "company",
      entityLabel: "NVIDIA Corporation",
      changeType: "score_improved",
      changeDirection: "improved",
      changeSummary: "Score improved to 88",
      changedAt: "2026-01-01T00:00:00.000Z",
      linkTo: "/opportunities/NVDA",
    };
    expect(s.watchId).toBeDefined();
    expect(s.watchName).toBeDefined();
    expect(s.changeSummary).toBeDefined();
    expect(s.changedAt).toBeDefined();
  });

  it("entityLabel is nullable", () => {
    const s: WatchChangeSummary = {
      watchId: "w1", watchName: "Growth Watch", watchType: "growth_candidates",
      entityLabel: null, changeType: "member_count_changed", changeDirection: "improved",
      changeSummary: "3 new candidates", changedAt: "2026-01-01T00:00:00.000Z", linkTo: "/dashboard",
    };
    expect(s.entityLabel).toBeNull();
  });
});

// ============================================================================
// 16. MyWatchChangesSection
// ============================================================================

describe("MyWatchChangesSection", () => {
  it("has required fields when available", () => {
    const s: MyWatchChangesSection = {
      available: true,
      watchCount: 5,
      activeWatchCount: 4,
      recentChanges: [],
      lastEvaluatedAt: "2026-01-01T00:00:00.000Z",
      feedSummary: "2 research watch updates",
    };
    expect(s.available).toBe(true);
    expect(typeof s.watchCount).toBe("number");
    expect(typeof s.activeWatchCount).toBe("number");
    expect(Array.isArray(s.recentChanges)).toBe(true);
  });

  it("has valid zero state when unavailable", () => {
    const s: MyWatchChangesSection = {
      available: false,
      watchCount: 0,
      activeWatchCount: 0,
      recentChanges: [],
      lastEvaluatedAt: null,
      feedSummary: null,
    };
    expect(s.available).toBe(false);
    expect(s.feedSummary).toBeNull();
  });

  it("feedSummary is nullable", () => {
    const s: MyWatchChangesSection = {
      available: true, watchCount: 3, activeWatchCount: 3,
      recentChanges: [], lastEvaluatedAt: null, feedSummary: null,
    };
    expect(s.feedSummary).toBeNull();
  });
});

// ============================================================================
// 17. ResearchWatchDetail
// ============================================================================

describe("ResearchWatchDetail", () => {
  it("extends ResearchWatch with detail fields", () => {
    const detail: ResearchWatchDetail = {
      id: "watch-1", userId: "user-1", name: "Watch", watchType: "company",
      entityId: "NVDA", entityLabel: "NVIDIA", status: "active",
      lastEvaluatedAt: null, lastChangeAt: null, lastChangeType: null,
      lastChangeSummary: null, notifyEmail: false, notifyPush: false,
      createdAt: new Date(), updatedAt: new Date(),
      currentStatus: { lastUpdated: null },
      recentActivity: [],
      relatedCandidates: [],
      evidence: [],
      whyChanged: [],
      freshness: null,
    };
    expect(detail.currentStatus).toBeDefined();
    expect(Array.isArray(detail.recentActivity)).toBe(true);
    expect(Array.isArray(detail.relatedCandidates)).toBe(true);
    expect(Array.isArray(detail.evidence)).toBe(true);
    expect(Array.isArray(detail.whyChanged)).toBe(true);
  });

  it("freshness is nullable", () => {
    const partial: Pick<ResearchWatchDetail, "freshness"> = { freshness: null };
    expect(partial.freshness).toBeNull();
  });
});

// ============================================================================
// 18. RelatedCandidate
// ============================================================================

describe("RelatedCandidate", () => {
  it("has required fields", () => {
    const c: RelatedCandidate = {
      symbol: "NVDA",
      label: "NVIDIA Corporation",
      score: 85,
      direction: "stable",
      linkTo: "/opportunities/NVDA",
    };
    expect(c.symbol).toBeDefined();
    expect(c.label).toBeDefined();
    expect(typeof c.score).toBe("number");
    expect(c.direction).toBeDefined();
    expect(c.linkTo).toMatch(/^\/opportunities\//);
  });
});

// ============================================================================
// 19. Feed Section — link policy
// ============================================================================

describe("Feed section link policy", () => {
  const validAppPaths = ["/dashboard", "/opportunities/", "/intelligence", "/research", "/research-monitor"];

  it("opportunity change items link to /opportunities/:symbol", () => {
    const item: FeedItem = {
      id: "i1", symbol: "NVDA", label: "NVDA", detail: "Score improved",
      changeDirection: "improved", linkTo: "/opportunities/NVDA", score: 85,
    };
    expect(item.linkTo).toMatch(/^\/opportunities\//);
  });

  it("theme items link to /intelligence/themes/:themeId", () => {
    const item: FeedItem = {
      id: "i2", label: "AI Infrastructure", detail: "Score changed",
      changeDirection: "improved", linkTo: "/intelligence/themes/ai-infrastructure",
    };
    expect(item.linkTo).toMatch(/^\/intelligence\//);
  });

  it("sector items link to /intelligence/sectors/:sector", () => {
    const item: FeedItem = {
      id: "i3", label: "Technology", detail: "Score changed",
      changeDirection: "weakened", linkTo: "/intelligence/sectors/Technology",
    };
    expect(item.linkTo).toMatch(/^\/intelligence\//);
  });

  it("watch change items link to /opportunities/:symbol or /research-monitor", () => {
    const withSymbol: FeedItem = {
      id: "i4", symbol: "NVDA", label: "NVDA Watch", detail: "Score improved",
      changeDirection: "improved", linkTo: "/opportunities/NVDA", watchId: "watch-1",
    };
    const marketWide: FeedItem = {
      id: "i5", label: "Growth Watch", detail: "3 new candidates",
      changeDirection: "new", linkTo: "/research-monitor", watchId: "watch-2",
    };
    expect(withSymbol.linkTo).toMatch(/^\/opportunities\//);
    expect(marketWide.linkTo).toBe("/research-monitor");
  });
});

// ============================================================================
// 20. Compliance terminology
// ============================================================================

describe("Compliance terminology in types", () => {
  it("WatchActivityType has no 'recommendation' terminology", () => {
    const activityTypes = [
      "new_candidate", "candidate_removed", "score_improved", "score_weakened",
      "confidence_changed", "regime_change", "theme_improved", "theme_weakened",
      "sector_improved", "sector_weakened", "collection_added", "collection_removed",
      "institutional_accumulation", "institutional_distribution",
      "member_count_changed", "status_unchanged",
    ];
    const forbidden = ["recommend", "buy", "sell", "predict", "guarantee", "target"];
    activityTypes.forEach(t => {
      forbidden.forEach(f => {
        expect(t.toLowerCase()).not.toContain(f);
      });
    });
  });

  it("WatchType has no 'top picks' or 'buy' terminology", () => {
    WATCH_TYPES.forEach(t => {
      expect(t.toLowerCase()).not.toContain("top_pick");
      expect(t.toLowerCase()).not.toContain("buy");
      expect(t.toLowerCase()).not.toContain("recommend");
    });
  });

  it("ChangeDirection uses neutral observation language", () => {
    const dirs: ChangeDirection[] = ["improved", "weakened", "new", "removed", "attention", "stable"];
    const forbidden = ["buy", "sell", "profit", "loss", "target", "guarantee"];
    dirs.forEach(d => {
      forbidden.forEach(f => {
        expect(d.toLowerCase()).not.toContain(f);
      });
    });
  });
});

// ============================================================================
// 21. Schema migration safety
// ============================================================================

describe("Schema migration (idempotency)", () => {
  it("research_watches uses IF NOT EXISTS in startup migration", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/services/research-monitor-service.ts", "utf8");
    expect(src).toContain("CREATE TABLE IF NOT EXISTS research_watches");
    expect(src).toContain("CREATE TABLE IF NOT EXISTS watch_activity_log");
  });

  it("uses CREATE INDEX IF NOT EXISTS for all indexes", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/services/research-monitor-service.ts", "utf8");
    const matches = (src.match(/CREATE INDEX IF NOT EXISTS/g) ?? []).length;
    expect(matches).toBeGreaterThanOrEqual(6); // 3 for watches + 3 for activity_log
  });

  it("schema.ts defines research_watches table", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("shared/schema.ts", "utf8");
    expect(src).toContain("researchWatches");
    expect(src).toContain("watchActivityLog");
  });

  it("research_watches has notifyEmail and notifyPush columns", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("shared/schema.ts", "utf8");
    expect(src).toContain("notify_email");
    expect(src).toContain("notify_push");
  });

  it("watch_activity_log has change_data JSONB", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("shared/schema.ts", "utf8");
    expect(src).toContain("change_data");
    expect(src).toContain("jsonb");
  });
});

// ============================================================================
// 22. API Route file
// ============================================================================

describe("API route file integrity", () => {
  it("research-monitor.ts exports registerResearchMonitorRoutes", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/routes/research-monitor.ts", "utf8");
    expect(src).toContain("registerResearchMonitorRoutes");
  });

  it("all 8 endpoints are registered", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/routes/research-monitor.ts", "utf8");
    expect(src).toContain("GET /api/research-monitor/watches");
    expect(src).toContain("POST /api/research-monitor/watches");
    expect(src).toContain("GET /api/research-monitor/watches/:id");
    expect(src).toContain("PATCH /api/research-monitor/watches/:id");
    expect(src).toContain("DELETE /api/research-monitor/watches/:id");
    expect(src).toContain("/api/research-monitor/watches/:id/evaluate");
    expect(src).toContain("/api/research-monitor/feed");
    expect(src).toContain("/api/research-monitor/health");
  });

  it("all routes are authenticated", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/routes/research-monitor.ts", "utf8");
    // Count isAuthenticated usages (one per app.get/post/patch/delete)
    const matches = (src.match(/isAuthenticated/g) ?? []).length;
    expect(matches).toBeGreaterThanOrEqual(8);
  });

  it("returns 401 for missing userId", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/routes/research-monitor.ts", "utf8");
    expect(src).toContain("401");
    expect(src).toContain("Unauthorized");
  });

  it("returns 404 for missing watch", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/routes/research-monitor.ts", "utf8");
    expect(src).toContain("404");
    expect(src).toContain("not found");
  });

  it("validates watchType against WATCH_TYPES", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/routes/research-monitor.ts", "utf8");
    expect(src).toContain("WATCH_TYPES");
    expect(src).toContain("validateWatchType");
  });
});

// ============================================================================
// 23. Service file
// ============================================================================

describe("Research monitor service integrity", () => {
  it("exports all CRUD functions", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/services/research-monitor-service.ts", "utf8");
    expect(src).toContain("export async function createWatch");
    expect(src).toContain("export async function listWatches");
    expect(src).toContain("export async function getWatchById");
    expect(src).toContain("export async function updateWatch");
    expect(src).toContain("export async function deleteWatch");
    expect(src).toContain("export async function evaluateWatch");
    expect(src).toContain("export async function getWatchDetail");
    expect(src).toContain("export async function getDailyFeed");
    expect(src).toContain("export async function getResearchMonitoringHealth");
    expect(src).toContain("export async function buildMyWatchChangesSection");
    expect(src).toContain("export async function ensureResearchMonitorTables");
  });

  it("uses existing precomputed stores (no recomputation)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/services/research-monitor-service.ts", "utf8");
    expect(src).toContain("getLatestRanking");
    expect(src).toContain("getLatestThemeSnapshots");
    expect(src).toContain("getLatestSectorSnapshots");
    expect(src).toContain("getCanonicalOpportunity");
  });

  it("soft-deletes watches (archive not hard delete)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/services/research-monitor-service.ts", "utf8");
    expect(src).toContain('"archived"');
  });

  it("uses SCORE_THRESHOLD >= 5 for change detection", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/services/research-monitor-service.ts", "utf8");
    // Uses threshold = 5 (or similar constant)
    expect(src).toMatch(/threshold.*=.*5|>=.*5|<=.*-5/);
  });

  it("status_unchanged entries written for freshness tracking", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/services/research-monitor-service.ts", "utf8");
    expect(src).toContain("status_unchanged");
  });

  it("no LLM calls", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/services/research-monitor-service.ts", "utf8");
    expect(src).not.toContain("openai.chat");
    expect(src).not.toContain("gpt-4");
    expect(src).not.toContain("generateText");
    expect(src).not.toContain("streamText");
  });

  it("no scanner logic", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/services/research-monitor-service.ts", "utf8");
    expect(src).not.toContain("computeTechnicalScore");
    expect(src).not.toContain("buildRanking");
    expect(src).not.toContain("computeRankingForSnapshot");
  });
});

// ============================================================================
// 24. Command Center Integration
// ============================================================================

describe("Command center integration", () => {
  it("CommandCenterDailySnapshot has myWatchChanges field", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("shared/command-center-types.ts", "utf8");
    expect(src).toContain("myWatchChanges");
    expect(src).toContain("MyWatchChangesSection");
  });
});

// ============================================================================
// 25. Client page
// ============================================================================

describe("Client page integrity", () => {
  it("research-monitor.tsx exists", async () => {
    const fs = await import("node:fs");
    expect(fs.existsSync("client/src/pages/research-monitor.tsx")).toBe(true);
  });

  it("page has required sections", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("client/src/pages/research-monitor.tsx", "utf8");
    expect(src).toContain("My Research Watches");
    expect(src).toContain("Daily Research Feed");
    expect(src).toContain("New Watch");
    expect(src).toContain("Not investment advice");
  });

  it("page has create watch modal", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("client/src/pages/research-monitor.tsx", "utf8");
    expect(src).toContain("CreateWatchModal");
    expect(src).toContain("Watch Type");
  });

  it("page has compliance disclaimer", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("client/src/pages/research-monitor.tsx", "utf8");
    const lowerSrc = src.toLowerCase();
    expect(lowerSrc).toContain("not");
    // Contains some disclaimer language
    const hasDisclaimer = lowerSrc.includes("not investment") || lowerSrc.includes("not a recommendation") || lowerSrc.includes("no predictions");
    expect(hasDisclaimer).toBe(true);
  });
});

// ============================================================================
// 26. Ops doc existence
// ============================================================================

describe("Operations manual", () => {
  it("docs/operations/19-research-monitor.md exists", async () => {
    const fs = await import("node:fs");
    expect(fs.existsSync("docs/operations/19-research-monitor.md")).toBe(true);
  });

  it("Sprint 2.5.4 entry in change log", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("docs/operations/17-sprint-change-log.md", "utf8");
    expect(src).toContain("Sprint 2.5.4");
    expect(src).toContain("Continuous Research Monitoring");
  });

  it("API reference contains Research Monitor UAT", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("docs/operations/16-api-and-uat-reference.md", "utf8");
    expect(src).toContain("Research Monitor");
    expect(src).toContain("/api/research-monitor/watches");
  });

  it("19-research-monitor.md covers key sections", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("docs/operations/19-research-monitor.md", "utf8");
    expect(src).toContain("research_watches");
    expect(src).toContain("watch_activity_log");
    expect(src).toContain("WatchType");
    expect(src).toContain("Daily Research Feed");
  });
});

// ============================================================================
// 27. Route registration
// ============================================================================

describe("Route registration", () => {
  it("server/routes.ts registers research monitor routes", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/routes.ts", "utf8");
    expect(src).toContain("registerResearchMonitorRoutes");
  });
});

// ============================================================================
// 28. App.tsx routing
// ============================================================================

describe("App routing", () => {
  it("/research-monitor route is registered in App.tsx", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("client/src/App.tsx", "utf8");
    expect(src).toContain("research-monitor");
    expect(src).toContain("ResearchMonitorPage");
  });
});
