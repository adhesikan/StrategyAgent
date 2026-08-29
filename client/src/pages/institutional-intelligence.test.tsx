import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { apiErrorCode } from "../lib/queryClient";
import { symbolQueryOpensStock } from "./institutional-intelligence";

const pageSource = readFileSync(
  resolve(__dirname, "institutional-intelligence.tsx"),
  "utf8",
);
const routeSource = readFileSync(
  resolve(__dirname, "../../../server/routes/institutional-application.ts"),
  "utf8",
);

describe("Institutional Intelligence hub", () => {
  it("includes every required research view", () => {
    for (const label of [
      "Stock view",
      "Trends",
      "Rotation",
      "Institutional discovery",
      "Multibagger discovery",
      "Fund Explorer",
    ]) {
      expect(pageSource).toContain(label);
    }
  });

  it("keeps delayed Form 13F limitations visible", () => {
    expect(pageSource).toContain("Form 13F disclosures are periodic and delayed");
    expect(pageSource).toContain("tracked reporting managers");
    expect(pageSource).toContain("reported holdings only");
  });

  it("uses server-side pagination for ranking tables", () => {
    expect(pageSource).toContain("limit=${limit}&offset=${page * limit}");
    expect(pageSource).toContain("query.data?.totalCount");
  });

  it("hydrates ranked symbol links and distinguishes unavailable snapshots", () => {
    expect(pageSource).toContain("useSearch()");
    expect(pageSource).toContain("symbolFromSearch(search)");
    expect(pageSource).toContain("setActiveTab(\"stock\")");
    expect(pageSource).toContain('apiErrorCode(error) === "DATA_UNAVAILABLE"');
    expect(
      apiErrorCode(
        new Error(
          '404: {"error":{"code":"DATA_UNAVAILABLE","message":"No snapshot"}}',
        ),
      ),
    ).toBe("DATA_UNAVAILABLE");
    expect(pageSource).toContain("legacyQuery.data?.summary");
    expect(pageSource).toContain("<TabsContent");
    expect(symbolQueryOpensStock("AAPL")).toBe(true);
  });

  it("renders stock-level fields from server-ranked analytics without client sorting", () => {
    for (const field of [
      "reportedHolderCount",
      "holderCountChange",
      "dataAsOf",
      "largestReportedShareIncreases",
      "largestReportedShareReductions",
      "Largest Reported Increases",
      "Largest Reported Reductions",
      "No reported increases are available for this symbol.",
      "No reported reductions are available for this symbol.",
    ]) {
      expect(pageSource).toContain(field);
    }
    expect(pageSource).not.toContain("largestReportedShareIncreases.sort");
    expect(pageSource).not.toContain("largestReportedShareReductions.sort");
    expect(pageSource).toContain('data?.dataAsOf ? formatDate(data.dataAsOf) : "Unavailable"');
  });

  it("does not introduce prohibited promotional or transaction language", () => {
    const normalized = pageSource.toLowerCase();
    for (const phrase of [
      "smart money",
      "conviction buy",
      "best fund",
      "fund recommendation",
      "bought",
      "sold",
    ]) {
      expect(normalized).not.toContain(phrase);
    }
  });

  it("protects the application Multibagger adapter with session authentication", () => {
    expect(routeSource).toContain('"/api/institutional/multibagger/:symbol"');
    expect(routeSource).toContain("isAuthenticated");
    expect(routeSource).toContain("multibaggerDiscoveryRepository.load");
    expect(routeSource).toContain("computeMultibaggerDiscovery");
  });
});