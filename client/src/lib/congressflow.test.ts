import { describe, it, expect } from "vitest";
import {
  buildCongressFlowEmbedUrl,
  normalizeTicker,
  normalizeWatchlist,
  isValidPoliticianSlug,
  isValidIsoDate,
  CONGRESSFLOW_EMBED_URL,
} from "./congressflow";

describe("normalizeTicker", () => {
  it("uppercases and trims", () => {
    expect(normalizeTicker(" nvda ")).toBe("NVDA");
  });
  it("accepts dots and dashes", () => {
    expect(normalizeTicker("brk.b")).toBe("BRK.B");
  });
  it("rejects malformed tickers", () => {
    expect(normalizeTicker("")).toBeNull();
    expect(normalizeTicker("../../etc")).toBeNull();
    expect(normalizeTicker("AAPL&view=x")).toBeNull();
    expect(normalizeTicker("TOOLONGTICKER99")).toBeNull();
  });
});

describe("buildCongressFlowEmbedUrl", () => {
  it("builds activity URL", () => {
    expect(buildCongressFlowEmbedUrl({})).toBe(CONGRESSFLOW_EMBED_URL);
    expect(buildCongressFlowEmbedUrl({ view: "activity" })).toBe(CONGRESSFLOW_EMBED_URL);
  });
  it("builds ticker URL with normalized ticker", () => {
    const url = buildCongressFlowEmbedUrl({ view: "ticker", ticker: " nvda " });
    expect(url).toBe(`${CONGRESSFLOW_EMBED_URL}?view=ticker&ticker=NVDA`);
  });
  it("falls back to activity for malformed ticker", () => {
    expect(buildCongressFlowEmbedUrl({ view: "ticker", ticker: "bad ticker&x=1" })).toBe(CONGRESSFLOW_EMBED_URL);
  });
  it("builds politician URL with valid slug", () => {
    expect(buildCongressFlowEmbedUrl({ view: "politician", politicianSlug: "nancy-pelosi" })).toBe(
      `${CONGRESSFLOW_EMBED_URL}?view=politician&slug=nancy-pelosi`,
    );
  });
  it("rejects invalid slug and origin injection", () => {
    expect(buildCongressFlowEmbedUrl({ view: "politician", politicianSlug: "https://evil.com" })).toBe(
      CONGRESSFLOW_EMBED_URL,
    );
    const url = buildCongressFlowEmbedUrl({ view: "ticker", ticker: "AAPL" });
    expect(url.startsWith("https://congress.vcptrader.com/embed")).toBe(true);
  });
});

describe("isValidPoliticianSlug", () => {
  it("accepts lowercase hyphenated slugs", () => {
    expect(isValidPoliticianSlug("nancy-pelosi")).toBe(true);
  });
  it("rejects uppercase, slashes, and empty", () => {
    expect(isValidPoliticianSlug("Nancy-Pelosi")).toBe(false);
    expect(isValidPoliticianSlug("a/b")).toBe(false);
    expect(isValidPoliticianSlug("")).toBe(false);
  });
});

describe("isValidIsoDate", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(isValidIsoDate("2026-01-31")).toBe(true);
  });
  it("rejects other formats", () => {
    expect(isValidIsoDate("01/31/2026")).toBe(false);
    expect(isValidIsoDate("2026-1-3")).toBe(false);
  });
  it("rejects impossible calendar dates", () => {
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2025-02-29")).toBe(false);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
  });
});

describe("normalizeWatchlist", () => {
  it("normalizes, dedupes, drops invalid, and caps size", () => {
    expect(normalizeWatchlist([" aapl", "AAPL", "msft", "bad ticker", ""])).toEqual(["AAPL", "MSFT"]);
    const many = Array.from({ length: 100 }, (_, i) => `T${i}`);
    expect(normalizeWatchlist(many).length).toBe(50);
  });
});
