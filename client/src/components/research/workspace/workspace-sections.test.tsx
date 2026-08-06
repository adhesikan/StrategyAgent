// Tests for workspace-sections.tsx — Sprint 2.2.3
//
// Pure-function tests only — no React testing library needed.
// Mirrors the pattern established in trade-structure-engine.test.tsx.

import { describe, it, expect } from "vitest";
import {
  deriveLifecycleSummary,
  buildEvidenceSummaryRows,
  buildRiskGroups,
  deriveInstaTradePrepState,
  buildAssistantPrompts,
} from "./workspace-sections";
import type { LifecycleItem, ResearchPackage, EvidenceStars, MarketSnapshot } from "@/components/research/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLifecycleItem(
  override: Partial<LifecycleItem> = {},
): LifecycleItem {
  return {
    symbol: "NVDA",
    lifecycleState: "STILL_QUALIFIED",
    qualificationStatus: "QUALIFIED",
    rankCurrent: 3,
    rankPrev: 3,
    scoreCurrent: 85,
    scorePrev: 83,
    scoreDelta: 2,
    firstSeen: "2026-08-01T10:00:00Z",
    lastUpdated: "2026-08-06T10:00:00Z",
    ...override,
  };
}

function makePackage(override: Partial<ResearchPackage> = {}): ResearchPackage {
  return {
    symbol: "NVDA",
    candidate: {
      rank: 1,
      symbol: "NVDA",
      strategy: "VCP",
      setupStatus: "Stage 2",
      trigger: "135.50",
      invalidation: "128.00",
      objective: "155.00",
      rewardRisk: 2.5,
      maxRisk: 500,
      confidence: "high",
      whySelected: ["Tight volatility contraction", "Above 50-day MA", "Volume dry-up"],
      warnings: [],
    },
    lifecycleItem: makeLifecycleItem(),
    scanHistory: [],
    brokerConnected: false,
    marketRegime: "TRENDING",
    dataSource: "Twelve Data (stored)",
    dataQuality: "ok",
    freshnessStatus: "fresh",
    completedAt: "2026-08-06T10:00:00Z",
    snapshotId: "snap-1",
    ...override,
  };
}

const DEFAULT_STARS: EvidenceStars = {
  technical: 4,
  congress: 3,
  news: 3,
  institutional: 0,
  catalysts: 1,
  regime: 5,
};

// ---------------------------------------------------------------------------
// A. deriveLifecycleSummary
// ---------------------------------------------------------------------------

describe("deriveLifecycleSummary", () => {
  it("A1 — null item returns no_data kind", () => {
    const result = deriveLifecycleSummary(null);
    expect(result.kind).toBe("no_data");
    expect(result.headline).toContain("First appearance");
    expect(result.detail).toContain("No previous scan");
  });

  it("A2 — NEWLY_QUALIFIED", () => {
    const item = makeLifecycleItem({ lifecycleState: "NEWLY_QUALIFIED" });
    const result = deriveLifecycleSummary(item);
    expect(result.kind).toBe("new");
    expect(result.headline.toLowerCase()).toContain("newly qualified");
  });

  it("A3 — STRENGTHENING shows rank improvement", () => {
    const item = makeLifecycleItem({ lifecycleState: "STRENGTHENING", rankPrev: 5, rankCurrent: 2, scoreDelta: 12 });
    const result = deriveLifecycleSummary(item);
    expect(result.kind).toBe("improved");
    expect(result.headline).toContain("#5");
    expect(result.headline).toContain("#2");
    expect(result.detail).toContain("+12");
  });

  it("A4 — WEAKENING shows rank decline", () => {
    const item = makeLifecycleItem({ lifecycleState: "WEAKENING", rankPrev: 2, rankCurrent: 7, scoreDelta: -8 });
    const result = deriveLifecycleSummary(item);
    expect(result.kind).toBe("declined");
    expect(result.headline).toContain("#2");
    expect(result.headline).toContain("#7");
    expect(result.detail).toContain("-8");
  });

  it("A5 — STILL_QUALIFIED shows stable", () => {
    const item = makeLifecycleItem({ lifecycleState: "STILL_QUALIFIED", rankCurrent: 4, scoreDelta: 0 });
    const result = deriveLifecycleSummary(item);
    expect(result.kind).toBe("stable");
    expect(result.headline).toContain("#4");
  });

  it("A6 — TRIGGERED shows triggered kind", () => {
    const item = makeLifecycleItem({ lifecycleState: "TRIGGERED", rankCurrent: 1 });
    const result = deriveLifecycleSummary(item);
    expect(result.kind).toBe("triggered");
    expect(result.headline.toLowerCase()).toContain("trigger");
  });

  it("A7 — DROPPED shows dropped kind", () => {
    const item = makeLifecycleItem({ lifecycleState: "DROPPED", rankPrev: 3 });
    const result = deriveLifecycleSummary(item);
    expect(result.kind).toBe("dropped");
    expect(result.headline.toLowerCase()).toContain("dropped");
    expect(result.detail).toContain("#3");
  });

  it("A8 — APPROACHING shows approaching kind", () => {
    const item = makeLifecycleItem({ lifecycleState: "APPROACHING", scoreDelta: 5 });
    const result = deriveLifecycleSummary(item);
    expect(result.kind).toBe("approaching");
    expect(result.headline.toLowerCase()).toContain("approaching");
  });

  it("A9 — UNAVAILABLE shows no_data kind", () => {
    const item = makeLifecycleItem({ lifecycleState: "UNAVAILABLE" });
    const result = deriveLifecycleSummary(item);
    expect(result.kind).toBe("no_data");
    expect(result.headline.toLowerCase()).toContain("unavailable");
  });

  it("A10 — positive scoreDelta displays with + prefix", () => {
    const item = makeLifecycleItem({ lifecycleState: "STRENGTHENING", rankPrev: 4, rankCurrent: 2, scoreDelta: 7 });
    const result = deriveLifecycleSummary(item);
    expect(result.detail).toContain("+7");
  });

  it("A11 — negative scoreDelta displays without extra - prefix", () => {
    const item = makeLifecycleItem({ lifecycleState: "WEAKENING", rankPrev: 1, rankCurrent: 4, scoreDelta: -5 });
    const result = deriveLifecycleSummary(item);
    expect(result.detail).toContain("-5");
  });

  it("A12 — null rankPrev renders em-dash", () => {
    const item = makeLifecycleItem({ lifecycleState: "STRENGTHENING", rankPrev: null, rankCurrent: 2, scoreDelta: 3 });
    const result = deriveLifecycleSummary(item);
    expect(result.headline).toContain("#—");
  });
});

// ---------------------------------------------------------------------------
// B. buildEvidenceSummaryRows
// ---------------------------------------------------------------------------

describe("buildEvidenceSummaryRows", () => {
  it("B1 — returns 6 rows", () => {
    const pkg = makePackage();
    const rows = buildEvidenceSummaryRows(pkg, DEFAULT_STARS, null);
    expect(rows).toHaveLength(6);
  });

  it("B2 — row IDs are correct", () => {
    const pkg = makePackage();
    const rows = buildEvidenceSummaryRows(pkg, DEFAULT_STARS, null);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain("technical");
    expect(ids).toContain("regime");
    expect(ids).toContain("congress");
    expect(ids).toContain("news");
    expect(ids).toContain("catalysts");
    expect(ids).toContain("institutional");
  });

  it("B3 — TRENDING regime → supports", () => {
    const pkg = makePackage({ marketRegime: "TRENDING" });
    const rows = buildEvidenceSummaryRows(pkg, DEFAULT_STARS, null);
    const regime = rows.find((r) => r.id === "regime")!;
    expect(regime.strength).toBe("supports");
  });

  it("B4 — RISK_OFF regime → weakens", () => {
    const pkg = makePackage({ marketRegime: "RISK_OFF" });
    const rows = buildEvidenceSummaryRows(pkg, DEFAULT_STARS, null);
    const regime = rows.find((r) => r.id === "regime")!;
    expect(regime.strength).toBe("weakens");
  });

  it("B5 — CHOPPY regime → neutral", () => {
    const pkg = makePackage({ marketRegime: "CHOPPY" });
    const rows = buildEvidenceSummaryRows(pkg, DEFAULT_STARS, null);
    const regime = rows.find((r) => r.id === "regime")!;
    expect(regime.strength).toBe("neutral");
  });

  it("B6 — null regime → neutral", () => {
    const pkg = makePackage({ marketRegime: null });
    const rows = buildEvidenceSummaryRows(pkg, DEFAULT_STARS, null);
    const regime = rows.find((r) => r.id === "regime")!;
    expect(regime.strength).toBe("neutral");
    expect(regime.note.toLowerCase()).toContain("unavailable");
  });

  it("B7 — high tech stars → supports", () => {
    const pkg = makePackage();
    const rows = buildEvidenceSummaryRows(pkg, { ...DEFAULT_STARS, technical: 5 }, null);
    const tech = rows.find((r) => r.id === "technical")!;
    expect(tech.strength).toBe("supports");
  });

  it("B8 — low tech stars → weakens", () => {
    const pkg = makePackage();
    const rows = buildEvidenceSummaryRows(pkg, { ...DEFAULT_STARS, technical: 2 }, null);
    const tech = rows.find((r) => r.id === "technical")!;
    expect(tech.strength).toBe("weakens");
  });

  it("B9 — news with 3+ articles → supports", () => {
    const pkg = makePackage();
    const newsData = {
      symbol: "NVDA",
      snapshot: null,
      articles: [
        { id: "1", headline: "H1", sentimentLabel: "bullish", publishedAt: null },
        { id: "2", headline: "H2", sentimentLabel: "neutral", publishedAt: null },
        { id: "3", headline: "H3", sentimentLabel: "bullish", publishedAt: null },
      ],
      stale: false,
    };
    const rows = buildEvidenceSummaryRows(pkg, DEFAULT_STARS, newsData);
    const news = rows.find((r) => r.id === "news")!;
    expect(news.strength).toBe("supports");
    expect(news.note).toContain("3 articles");
  });

  it("B10 — no news data → neutral, note mentions loading", () => {
    const pkg = makePackage();
    const rows = buildEvidenceSummaryRows(pkg, DEFAULT_STARS, null);
    const news = rows.find((r) => r.id === "news")!;
    expect(news.strength).toBe("neutral");
    expect(news.note.toLowerCase()).toContain("news tab");
  });

  it("B11 — warnings present → catalysts weakens", () => {
    const pkg = makePackage({
      candidate: {
        rank: 1, symbol: "NVDA", whySelected: [], warnings: ["Earnings next week"],
      },
    } as any);
    const rows = buildEvidenceSummaryRows(pkg, DEFAULT_STARS, null);
    const cat = rows.find((r) => r.id === "catalysts")!;
    expect(cat.strength).toBe("weakens");
    expect(cat.note).toContain("1 scanner warning flag");
  });

  it("B12 — no warnings → catalysts neutral", () => {
    const pkg = makePackage();
    const rows = buildEvidenceSummaryRows(pkg, DEFAULT_STARS, null);
    const cat = rows.find((r) => r.id === "catalysts")!;
    expect(cat.strength).toBe("neutral");
  });

  it("B13 — institutional always unavailable", () => {
    const pkg = makePackage();
    const rows = buildEvidenceSummaryRows(pkg, DEFAULT_STARS, null);
    const inst = rows.find((r) => r.id === "institutional")!;
    expect(inst.strength).toBe("unavailable");
    expect(inst.numericScore).toBeNull();
  });

  it("B14 — congress always neutral", () => {
    const pkg = makePackage();
    const rows = buildEvidenceSummaryRows(pkg, DEFAULT_STARS, null);
    const cong = rows.find((r) => r.id === "congress")!;
    expect(cong.strength).toBe("neutral");
    expect(cong.numericScore).toBeNull();
  });

  it("B15 — tab targets are correct", () => {
    const pkg = makePackage();
    const rows = buildEvidenceSummaryRows(pkg, DEFAULT_STARS, null);
    const map = Object.fromEntries(rows.map((r) => [r.id, r.tabTarget]));
    expect(map.technical).toBe("technical");
    expect(map.regime).toBe("technical");
    expect(map.congress).toBe("congress");
    expect(map.news).toBe("news");
    expect(map.catalysts).toBe("catalysts");
    expect(map.institutional).toBe("institutional");
  });

  it("B16 — single article note is singular", () => {
    const pkg = makePackage();
    const newsData = {
      symbol: "NVDA",
      snapshot: null,
      articles: [{ id: "1", headline: "H1", sentimentLabel: null, publishedAt: null }],
      stale: false,
    };
    const rows = buildEvidenceSummaryRows(pkg, DEFAULT_STARS, newsData);
    const news = rows.find((r) => r.id === "news")!;
    expect(news.note).toContain("1 article indexed");
    expect(news.note).not.toContain("articles");
  });

  it("B17 — confidence shown in technical note", () => {
    const pkg = makePackage();
    const rows = buildEvidenceSummaryRows(pkg, DEFAULT_STARS, null);
    const tech = rows.find((r) => r.id === "technical")!;
    expect(tech.note.toLowerCase()).toContain("high");
  });

  it("B18 — technical numeric score is stars * 20", () => {
    const pkg = makePackage();
    const rows = buildEvidenceSummaryRows(pkg, { ...DEFAULT_STARS, technical: 3 }, null);
    const tech = rows.find((r) => r.id === "technical")!;
    expect(tech.numericScore).toBe(60);
  });

  it("B19 — multiple warnings: note shows count", () => {
    const pkg = makePackage({
      candidate: {
        rank: 1, symbol: "NVDA", whySelected: [],
        warnings: ["Earnings risk", "Extended on weekly chart", "Volume divergence"],
      },
    } as any);
    const rows = buildEvidenceSummaryRows(pkg, DEFAULT_STARS, null);
    const cat = rows.find((r) => r.id === "catalysts")!;
    expect(cat.note).toContain("3 scanner warning flags");
  });
});

// ---------------------------------------------------------------------------
// C. buildRiskGroups
// ---------------------------------------------------------------------------

describe("buildRiskGroups", () => {
  it("C1 — clean package has at least options risks", () => {
    const pkg = makePackage();
    const groups = buildRiskGroups(pkg, undefined);
    const ids = groups.map((g) => g.id);
    expect(ids).toContain("options");
  });

  it("C2 — invalidation condition appears as critical in thesis group", () => {
    const pkg = makePackage();
    const groups = buildRiskGroups(pkg, undefined);
    const thesis = groups.find((g) => g.id === "thesis");
    expect(thesis).toBeDefined();
    const critical = thesis!.items.find((i) => i.severity === "critical");
    expect(critical).toBeDefined();
    expect(critical!.label).toBe("Invalidation Condition");
    expect(critical!.detail).toContain("128.00");
  });

  it("C3 — no invalidation → thesis group absent if no earnings warning", () => {
    const pkg = makePackage({
      candidate: { rank: 1, symbol: "NVDA", whySelected: [], warnings: [] },
    } as any);
    const groups = buildRiskGroups(pkg, undefined);
    const thesis = groups.find((g) => g.id === "thesis");
    expect(thesis).toBeUndefined();
  });

  it("C4 — RISK_OFF regime adds market group with high severity", () => {
    const pkg = makePackage({ marketRegime: "RISK_OFF" });
    const groups = buildRiskGroups(pkg, undefined);
    const market = groups.find((g) => g.id === "market");
    expect(market).toBeDefined();
    const item = market!.items.find((i) => i.label === "Adverse Market Regime");
    expect(item).toBeDefined();
    expect(item!.severity).toBe("high");
  });

  it("C5 — TRENDING regime → no market group from regime alone", () => {
    const pkg = makePackage({ marketRegime: "TRENDING" });
    const groups = buildRiskGroups(pkg, undefined);
    const market = groups.find((g) => g.id === "market");
    // May exist if high-impact news, but no regime risk item
    if (market) {
      const regimeItem = market.items.find((i) => i.label === "Adverse Market Regime");
      expect(regimeItem).toBeUndefined();
    }
  });

  it("C6 — high-impact market news adds to market group", () => {
    const snapshot: MarketSnapshot = {
      topNews: [
        { symbol: "FED", label: "bearish", impact: "high", whyItMatters: "Fed rate hike", buzz: 1, articleCount: 5 },
      ],
    };
    const pkg = makePackage({ marketRegime: "TRENDING" });
    const groups = buildRiskGroups(pkg, snapshot);
    const market = groups.find((g) => g.id === "market");
    expect(market).toBeDefined();
    expect(market!.items[0].label).toContain("FED");
  });

  it("C7 — earnings warning appears in thesis group as high severity", () => {
    const pkg = makePackage({
      candidate: {
        rank: 1, symbol: "NVDA", whySelected: [],
        warnings: ["Earnings announcement next week"],
        invalidation: undefined,
      },
    } as any);
    const groups = buildRiskGroups(pkg, undefined);
    const thesis = groups.find((g) => g.id === "thesis");
    expect(thesis).toBeDefined();
    const item = thesis!.items.find((i) => i.label === "Earnings / Catalyst Risk");
    expect(item).toBeDefined();
    expect(item!.severity).toBe("high");
  });

  it("C8 — non-earnings warning appears in trade group as medium", () => {
    const pkg = makePackage({
      candidate: {
        rank: 1, symbol: "NVDA", whySelected: [],
        warnings: ["Extended on weekly chart"],
        invalidation: undefined,
      },
    } as any);
    const groups = buildRiskGroups(pkg, undefined);
    const trade = groups.find((g) => g.id === "trade");
    expect(trade).toBeDefined();
    const item = trade!.items.find((i) => i.label === "Scanner Warning");
    expect(item).toBeDefined();
    expect(item!.severity).toBe("medium");
  });

  it("C9 — null maxRisk adds position size risk to trade group", () => {
    const pkg = makePackage({
      candidate: {
        rank: 1, symbol: "NVDA", whySelected: [], warnings: [],
        maxRisk: undefined, invalidation: "128.00",
      },
    } as any);
    const groups = buildRiskGroups(pkg, undefined);
    const trade = groups.find((g) => g.id === "trade");
    expect(trade).toBeDefined();
    const item = trade!.items.find((i) => i.label === "Position Size Not Resolved");
    expect(item).toBeDefined();
  });

  it("C10 — no invalidation adds stop level risk to trade group", () => {
    const pkg = makePackage({
      candidate: {
        rank: 1, symbol: "NVDA", whySelected: [], warnings: [],
        maxRisk: 500, invalidation: undefined,
      },
    } as any);
    const groups = buildRiskGroups(pkg, undefined);
    const trade = groups.find((g) => g.id === "trade");
    expect(trade).toBeDefined();
    const item = trade!.items.find((i) => i.label === "Stop Level Not Specified");
    expect(item).toBeDefined();
  });

  it("C11 — stale freshness adds stale risk to data group", () => {
    const pkg = makePackage({ freshnessStatus: "stale" });
    const groups = buildRiskGroups(pkg, undefined);
    const data = groups.find((g) => g.id === "data");
    expect(data).toBeDefined();
    const item = data!.items.find((i) => i.label === "Stale Research Data");
    expect(item).toBeDefined();
    expect(item!.severity).toBe("medium");
  });

  it("C12 — no broker adds broker risk to data group", () => {
    const pkg = makePackage({ brokerConnected: false });
    const groups = buildRiskGroups(pkg, undefined);
    const data = groups.find((g) => g.id === "data");
    expect(data).toBeDefined();
    const item = data!.items.find((i) => i.label === "No Broker Connected");
    expect(item).toBeDefined();
    expect(item!.severity).toBe("low");
  });

  it("C13 — broker connected + fresh → no data group", () => {
    const pkg = makePackage({ brokerConnected: true, freshnessStatus: "fresh" });
    const groups = buildRiskGroups(pkg, undefined);
    const data = groups.find((g) => g.id === "data");
    expect(data).toBeUndefined();
  });

  it("C14 — options risks always present with two items", () => {
    const pkg = makePackage({ brokerConnected: true, freshnessStatus: "fresh" });
    const groups = buildRiskGroups(pkg, undefined);
    const opts = groups.find((g) => g.id === "options");
    expect(opts).toBeDefined();
    expect(opts!.items.length).toBeGreaterThanOrEqual(2);
  });

  it("C15 — first options risk mentions illustrative", () => {
    const pkg = makePackage();
    const groups = buildRiskGroups(pkg, undefined);
    const opts = groups.find((g) => g.id === "options");
    const item = opts!.items[0];
    expect(item.label.toLowerCase()).toContain("illustrative");
  });

  it("C16 — high-impact snapshot news capped at 2 items", () => {
    const snapshot: MarketSnapshot = {
      topNews: [
        { symbol: "A", label: "bearish", impact: "high", whyItMatters: "X", buzz: 1, articleCount: 1 },
        { symbol: "B", label: "bearish", impact: "high", whyItMatters: "Y", buzz: 1, articleCount: 1 },
        { symbol: "C", label: "bearish", impact: "high", whyItMatters: "Z", buzz: 1, articleCount: 1 },
      ],
    };
    const pkg = makePackage({ marketRegime: "TRENDING" });
    const groups = buildRiskGroups(pkg, snapshot);
    const market = groups.find((g) => g.id === "market")!;
    const newsItems = market.items.filter((i) => i.label.startsWith("Market Event"));
    expect(newsItems.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// D. deriveInstaTradePrepState
// ---------------------------------------------------------------------------

describe("deriveInstaTradePrepState", () => {
  it("D1 — no broker → no_broker", () => {
    expect(deriveInstaTradePrepState(false, false)).toBe("no_broker");
  });

  it("D2 — no broker, has contract → still no_broker (broker check first)", () => {
    expect(deriveInstaTradePrepState(false, true)).toBe("no_broker");
  });

  it("D3 — broker connected, contract selected → contract_selected", () => {
    expect(deriveInstaTradePrepState(true, true)).toBe("contract_selected");
  });

  it("D4 — broker connected, no contract → stock_ready", () => {
    expect(deriveInstaTradePrepState(true, false)).toBe("stock_ready");
  });
});

// ---------------------------------------------------------------------------
// E. buildAssistantPrompts
// ---------------------------------------------------------------------------

describe("buildAssistantPrompts", () => {
  it("E1 — returns at most 8 prompts", () => {
    const pkg = makePackage();
    const result = buildAssistantPrompts(pkg, DEFAULT_STARS, false, false);
    expect(result.length).toBeLessThanOrEqual(8);
  });

  it("E2 — always includes qualification prompt", () => {
    const pkg = makePackage();
    const result = buildAssistantPrompts(pkg, DEFAULT_STARS, false, false);
    expect(result.some((p) => p.toLowerCase().includes("qualify"))).toBe(true);
  });

  it("E3 — includes lifecycle prompt when lifecycleItem exists", () => {
    const pkg = makePackage({ lifecycleItem: makeLifecycleItem() });
    const result = buildAssistantPrompts(pkg, DEFAULT_STARS, false, false);
    expect(result.some((p) => p.toLowerCase().includes("previous scan"))).toBe(true);
  });

  it("E4 — lifecycle prompt absent when no lifecycleItem", () => {
    const pkg = makePackage({ lifecycleItem: null });
    const result = buildAssistantPrompts(pkg, DEFAULT_STARS, false, false);
    expect(result.some((p) => p.toLowerCase().includes("previous scan"))).toBe(false);
  });

  it("E5 — includes news prompt when hasNewsData is true", () => {
    const pkg = makePackage();
    const result = buildAssistantPrompts(pkg, DEFAULT_STARS, false, true);
    expect(result.some((p) => p.toLowerCase().includes("news"))).toBe(true);
  });

  it("E6 — news prompt absent when hasNewsData is false", () => {
    const pkg = makePackage();
    const result = buildAssistantPrompts(pkg, DEFAULT_STARS, false, false);
    // Check that no "latest news" prompt appears
    expect(result.some((p) => p.toLowerCase().includes("latest news"))).toBe(false);
  });

  it("E7 — includes contract prompt when hasSelectedContract is true", () => {
    const pkg = makePackage({ brokerConnected: true });
    const result = buildAssistantPrompts(pkg, DEFAULT_STARS, true, false);
    expect(result.some((p) => p.toLowerCase().includes("contract"))).toBe(true);
  });

  it("E8 — instatrade check prompt present in both contract/no-contract cases", () => {
    const pkgA = makePackage();
    const pkgB = makePackage();
    const withContract = buildAssistantPrompts(pkgA, DEFAULT_STARS, true, false);
    const withoutContract = buildAssistantPrompts(pkgB, DEFAULT_STARS, false, false);
    const eitherHas = (list: string[]) =>
      list.some((p) => p.toLowerCase().includes("instatrade"));
    expect(eitherHas(withContract)).toBe(true);
    expect(eitherHas(withoutContract)).toBe(true);
  });

  it("E9 — symbol appears in at least one prompt", () => {
    const pkg = makePackage({ symbol: "PLTR" });
    const result = buildAssistantPrompts(pkg, DEFAULT_STARS, false, false);
    expect(result.some((p) => p.includes("PLTR"))).toBe(true);
  });

  it("E10 — warnings present → risk/earnings prompt included", () => {
    const pkg = makePackage({
      candidate: {
        rank: 1, symbol: "NVDA", whySelected: [],
        warnings: ["Earnings announcement next week"],
      },
    } as any);
    const result = buildAssistantPrompts(pkg, DEFAULT_STARS, false, false);
    expect(result.some((p) => p.toLowerCase().includes("earnings") || p.toLowerCase().includes("risk"))).toBe(true);
  });

  it("E11 — all prompts are non-empty strings", () => {
    const pkg = makePackage();
    const result = buildAssistantPrompts(pkg, DEFAULT_STARS, true, true);
    expect(result.every((p) => typeof p === "string" && p.length > 0)).toBe(true);
  });
});
