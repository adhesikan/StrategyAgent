import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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