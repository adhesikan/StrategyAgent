import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderAccumulation, renderMultibagger, renderMultibaggerDetail, renderStock } from "../public/ui-render.mjs";

const ranking = {
  mode: "ACCUMULATION",
  quarter: { label: "2026-Q1", periodEndDate: "2026-03-31" },
  items: [{
    symbol: "ALFA", companyName: "Alfa Systems", sector: "Technology",
    currentReportedHolderCount: 12, netHolderIncrease: 4,
    newlyReportedHolderCount: 3, increasedReportedHolderCount: 7,
    unchangedReportedHolderCount: 5, reducedReportedHolderCount: 2,
    noLongerReportedHolderCount: 1,
    aggregateReportedShareChangePct: 18.2, aggregateReportedValue: 5000000,
  }],
  totalCount: 1, limit: 25, offset: 0, dataQuality: { status: "complete" },
};
const stock = {
  data: {
    symbol: "ALFA", modelVersion: { version: "institutional_v1" }, dataAsOf: "2026-03-31",
    reportedHolderCount: 12, previousReportedHolderCount: 9,
    reportingManagerCount: 48, holderCountChange: 3,
    newlyReportedHolderCount: 3, increasedReportedHolderCount: 7,
    unchangedReportedHolderCount: 5, reducedReportedHolderCount: 2,
    noLongerReportedHolderCount: 1,
    aggregateReportedShares: 8000, aggregateReportedShareChangePct: 18.2,
    topReportedHolders: [{ managerName: "Largest Fund", reportedShareChange: null, changeType: "UNCHANGED" }],
    largestNewlyReportedPositions: [{ managerName: "New Fund", reportedShareChange: 250, changeType: "NEWLY_REPORTED" }],
    largestReportedShareIncreases: [{ managerName: "North Fund", reportedShareChange: 400, changeType: "INCREASED" }],
    largestReportedShareReductions: [{ managerName: "South Fund", reportedShareChange: -100, changeType: "REDUCED" }],
    noLongerReportedPositions: [{ managerName: "Exited Fund", reportedShareChange: -350, changeType: "NO_LONGER_REPORTED" }],
    dataQuality: { status: "complete", warnings: ["Delayed filing data"] },
  },
  meta: { dataAsOf: "2026-03-31" },
};
const trend = { data: { classification: "ACCUMULATION", quarters: [{ quarter: { label: "2026-Q1" }, reportedHolderCount: 12, breadthChange: 3, shareTrend: 18.2 }] } };

describe("external consumer UI", () => {
  it("renders accumulation server fields, pagination, stock links, and disclosure", () => {
    const html = renderAccumulation(ranking);
    assert.match(html, /Alfa Systems/);
    assert.match(html, /18\.2%/);
    assert.match(html, /data-symbol="ALFA"/);
    assert.match(html, /Showing 1–1 of 1/);
    assert.match(html, /Form 13F information reflects/);
    for (const text of ["Newly reported", "Increased", "Unchanged", "Reduced", "No longer reported"]) {
      assert.match(html, new RegExp(text, "i"));
    }
    for (const name of [
      "quarter", "positionType", "cohort", "sector", "industry", "theme",
      "marketCapMin", "marketCapMax", "minManagers", "minReportedValue",
      "sortBy", "sortDirection", "limit",
    ]) {
      assert.match(html, new RegExp(`name="${name}"`));
    }
  });

  it("renders stock holder counts, ranked changes, trend, data quality, and as-of", () => {
    const html = renderStock(stock, trend, "ALFA");
    for (const text of [
      "Reported holders", "Prior reported holders", "Newly reported holders",
      "Increased holders", "Unchanged holders", "Reduced holders",
      "No longer reported", "Largest Fund", "New Fund",
      "North Fund", "South Fund", "Exited Fund", "Multi-quarter trend",
      "ACCUMULATION", "2026-03-31", "Delayed reported holdings",
    ]) {
      assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("renders every server-provided holder row and reports the truthful count", () => {
    const holders = Array.from({ length: 9 }, (_, index) => ({
      managerName: `Manager ${index + 1}`,
      reportedShareChange: index + 1,
      changeType: "INCREASED",
    }));
    const html = renderStock({
      ...stock,
      data: { ...stock.data, topReportedHolders: holders },
    }, trend, "ALFA");
    assert.match(html, /9 shown/);
    assert.match(html, /Manager 9/);
  });

  it("renders multibagger results and server-provided detail evidence", () => {
    const screen = renderMultibagger({
      candidates: [{
        symbol: "ALFA", overallScore: 81.5, dataAsOf: "2026-03-31",
        sector: "Technology", dataQuality: { status: "available" },
        profiles: {
          fiveX: { classification: "STRONG_PROFILE" },
          tenX: { classification: "MODERATE_PROFILE" },
          twentyFiveX: { classification: "WEAK_PROFILE" },
          hundredX: { classification: "INSUFFICIENT_DATA" },
        },
        componentScores: {
          institutional: 90, growth: 82, fundamentals: 77, valuation: 65,
          runway: 73, optionality: 68, risk: 71,
        },
      }],
      totalCount: 1, limit: 25, offset: 0, modelVersion: "multibagger_v1",
    });
    assert.match(screen, /81\.5/);
    assert.match(screen, /MODERATE PROFILE/);
    assert.match(screen, /data-symbol="ALFA"/);
    for (const text of ["5x", "10x", "25x", "100x", "Inst.", "Growth", "Fund.", "Value", "Runway", "Optionality", "Risk"]) {
      assert.match(screen, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    for (const name of [
      "minOverallScore", "profile", "marketCapMin", "marketCapMax", "sector",
      "industry", "theme", "institutionalTrend", "minInstitutionalScore",
      "minRevenueGrowth", "limit",
    ]) {
      assert.match(screen, new RegExp(`name="${name}"`));
    }
    const detail = renderMultibaggerDetail({
      data: {
        symbol: "ALFA", overallScore: 81.5, modelVersion: "multibagger_v1",
        dataAsOf: "2026-03-31", marketCap: 500000000, revenueGrowth: 42,
        dataQuality: { status: "available", confidence: "high" },
        componentScores: { institutional: 90, growth: 82 },
        profiles: {
          fiveX: { classification: "STRONG_PROFILE", score: 85 },
          tenX: { classification: "MODERATE_PROFILE", score: 72 },
          twentyFiveX: { classification: "WEAK_PROFILE", score: 44 },
          hundredX: { classification: "INSUFFICIENT_DATA", score: null },
        },
        supportingFactors: [{ component: "growth", explanation: "Growth evidence is available." }],
        limitingFactors: [{ component: "valuation", explanation: "Evidence is mixed." }],
      },
      meta: { limitations: ["Candidate profile screen only."] },
    });
    assert.match(detail, /Component evidence/);
    assert.match(detail, /Evidence limits/);
    assert.match(detail, /Supporting evidence/);
    assert.match(detail, /Growth evidence is available/);
    assert.match(detail, /API limitations and data-quality notes/);
    assert.match(detail, /Candidate profile screen only/);
    assert.match(detail, /multibagger_v1/);
    assert.doesNotMatch(detail, /\bstrong buy\b|\bbuy\b|\bsell\b|\bguaranteed\b|\bwill (?:5x|10x|25x|100x)\b|\brisk[- ]free\b/i);
  });

  it("has a browser entry point that never contains an API key or upstream URL", async () => {
    const [html, js] = await Promise.all([
      readFile(new URL("../public/index.html", import.meta.url), "utf8"),
      readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    ]);
    assert.match(html, /key stays server-side/);
    assert.doesNotMatch(`${html}\n${js}`, /STOCKMETRICS_API_KEY|Bearer\s+sm_|Authorization\s*:/i);
  });

  it("renders safe empty and error states", () => {
    assert.match(renderAccumulation({ items: [], quarter: { periodEndDate: "2026-03-31" } }), /No results/);
    assert.match(renderStock(null, null, ""), /Inspect a symbol/);
    assert.match(renderMultibagger({ candidates: [] }), /No candidate profiles match/);
  });

  it("contains no prohibited claims across the complete browser surface", async () => {
    const sources = await Promise.all([
      readFile(new URL("../public/index.html", import.meta.url), "utf8"),
      readFile(new URL("../public/app.js", import.meta.url), "utf8"),
      readFile(new URL("../public/ui-render.mjs", import.meta.url), "utf8"),
    ]);
    const completeSurface = [
      ...sources,
      renderAccumulation(ranking),
      renderStock(stock, trend, "ALFA"),
    ].join("\n");
    assert.doesNotMatch(
      completeSurface,
      /\bstrong buy\b|\bbuy now\b|\bsell now\b|\bguaranteed\b|\bwill (?:5x|10x|25x|100x)\b|\brisk[- ]free\b|\bsure thing\b/i,
    );
  });
});