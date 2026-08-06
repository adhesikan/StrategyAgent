// Analysis Cache Routes — Sprint 5.5B tests
//
// Covers:
//   - Single-symbol lookup: cache hit / cache miss / cross-user isolation
//   - Batch lookup: hits subset correctly identified
//   - Eviction: DELETE clears the entry
//   - Input validation: bad symbol rejected cleanly
//   - storeAnalysisResult: only caches meaningful analysis
//   - batchLookupSymbols: correct symbol set returned

import { describe, it, expect, beforeEach } from "vitest";
import {
  storeAnalysisResult,
  lookupAnalysisResult,
  batchLookupSymbols,
  evictAnalysisResult,
  activeCacheEntryCount,
  _clearAllCacheEntries,
  type SafeAskResult,
} from "../services/analysis-result-cache";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<SafeAskResult> = {}): SafeAskResult {
  return {
    question: "Analyze NVDA",
    intent: "stock_analysis",
    tickers: ["NVDA"],
    brokerConnected: false,
    headline: "NVDA analysis",
    answer: "Here is the analysis.",
    keyPoints: ["Point 1"],
    riskNote: "Risk note",
    confidence: "medium",
    source: "openai",
    disclaimer: "Not investment advice.",
    multiStrategyAnalysis: { strategies: [] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("analysis-result-cache", () => {
  beforeEach(() => {
    _clearAllCacheEntries();
  });

  describe("storeAnalysisResult", () => {
    it("stores a result with multiStrategyAnalysis", () => {
      storeAnalysisResult("user1", "NVDA", makeResult());
      expect(activeCacheEntryCount()).toBe(1);
    });

    it("stores a result with vcpAnalysis", () => {
      storeAnalysisResult("user1", "AAPL", makeResult({ multiStrategyAnalysis: undefined, vcpAnalysis: { score: 80 } }));
      expect(activeCacheEntryCount()).toBe(1);
    });

    it("stores a result with strategyRecommendation", () => {
      storeAnalysisResult("user1", "AMD", makeResult({ multiStrategyAnalysis: undefined, strategyRecommendation: { strategy: "vcp" } }));
      expect(activeCacheEntryCount()).toBe(1);
    });

    it("does NOT store a result with no meaningful analysis sections", () => {
      storeAnalysisResult("user1", "NVDA", makeResult({
        multiStrategyAnalysis: undefined,
        vcpAnalysis: undefined,
        strategyRecommendation: undefined,
        rankedTradeSearch: undefined,
      }));
      expect(activeCacheEntryCount()).toBe(0);
    });

    it("does NOT store when symbol is empty", () => {
      storeAnalysisResult("user1", "", makeResult());
      expect(activeCacheEntryCount()).toBe(0);
    });

    it("normalizes symbol to uppercase", () => {
      storeAnalysisResult("user1", "nvda", makeResult());
      const result = lookupAnalysisResult("user1", "NVDA");
      expect(result.found).toBe(true);
    });

    it("replaces an existing entry for the same user+symbol", () => {
      storeAnalysisResult("user1", "NVDA", makeResult({ headline: "First" }));
      storeAnalysisResult("user1", "NVDA", makeResult({ headline: "Second" }));
      const result = lookupAnalysisResult("user1", "NVDA");
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.result.headline).toBe("Second");
      }
      expect(activeCacheEntryCount()).toBe(1);
    });

    it("enforces MAX_PER_USER=5 limit (LRU eviction)", () => {
      const syms = ["A", "B", "C", "D", "E", "F"];
      for (const s of syms) {
        storeAnalysisResult("user1", s, makeResult({ tickers: [s] }));
      }
      // Should only keep the last 5
      expect(activeCacheEntryCount()).toBe(5);
      // Oldest entry (A) should be evicted
      expect(lookupAnalysisResult("user1", "A").found).toBe(false);
      // Most recent (F) should be present
      expect(lookupAnalysisResult("user1", "F").found).toBe(true);
    });
  });

  describe("lookupAnalysisResult", () => {
    it("returns found:false when no entry exists", () => {
      const result = lookupAnalysisResult("user1", "NVDA");
      expect(result.found).toBe(false);
    });

    it("returns the cached result when present", () => {
      storeAnalysisResult("user1", "NVDA", makeResult({ headline: "My headline" }));
      const result = lookupAnalysisResult("user1", "NVDA");
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.result.headline).toBe("My headline");
        expect(result.symbol).toBe("NVDA");
        expect(result.ageSec).toBeGreaterThanOrEqual(0);
        expect(result.canRefresh).toBe(true);
      }
    });

    it("cross-user isolation: user2 cannot see user1 result", () => {
      storeAnalysisResult("user1", "NVDA", makeResult());
      const result = lookupAnalysisResult("user2", "NVDA");
      expect(result.found).toBe(false);
    });

    it("marks result as not stale when fresh (age < 10 min)", () => {
      storeAnalysisResult("user1", "NVDA", makeResult());
      const result = lookupAnalysisResult("user1", "NVDA");
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.isStale).toBe(false);
      }
    });

    it("provides a human-readable freshnessLabel", () => {
      storeAnalysisResult("user1", "NVDA", makeResult());
      const result = lookupAnalysisResult("user1", "NVDA");
      if (result.found) {
        // Should be "Analyzed just now" or "Analyzed X minutes ago"
        expect(result.freshnessLabel).toMatch(/Analyzed/);
      }
    });

    it("does not return researchSave in the cached result", () => {
      const resultWithHandle = makeResult() as any;
      resultWithHandle.researchSave = { handleId: "secret-handle-id", available: true };
      storeAnalysisResult("user1", "NVDA", resultWithHandle);
      const cached = lookupAnalysisResult("user1", "NVDA");
      if (cached.found) {
        expect((cached.result as any).researchSave).toBeUndefined();
      }
    });
  });

  describe("batchLookupSymbols", () => {
    it("returns empty array when no entries exist", () => {
      const hits = batchLookupSymbols("user1", ["NVDA", "AAPL"]);
      expect(hits).toEqual([]);
    });

    it("returns only symbols that have entries", () => {
      storeAnalysisResult("user1", "NVDA", makeResult({ tickers: ["NVDA"] }));
      storeAnalysisResult("user1", "AMD", makeResult({ tickers: ["AMD"] }));
      const hits = batchLookupSymbols("user1", ["NVDA", "AAPL", "AMD", "TSLA"]);
      expect(hits.sort()).toEqual(["AMD", "NVDA"]);
    });

    it("normalizes input symbols to uppercase", () => {
      storeAnalysisResult("user1", "NVDA", makeResult());
      const hits = batchLookupSymbols("user1", ["nvda"]);
      expect(hits).toEqual(["NVDA"]);
    });

    it("cross-user isolation in batch", () => {
      storeAnalysisResult("user1", "NVDA", makeResult());
      const hits = batchLookupSymbols("user2", ["NVDA"]);
      expect(hits).toEqual([]);
    });
  });

  describe("evictAnalysisResult", () => {
    it("removes an existing entry", () => {
      storeAnalysisResult("user1", "NVDA", makeResult());
      evictAnalysisResult("user1", "NVDA");
      expect(lookupAnalysisResult("user1", "NVDA").found).toBe(false);
      expect(activeCacheEntryCount()).toBe(0);
    });

    it("does not throw when evicting a non-existent entry", () => {
      expect(() => evictAnalysisResult("user1", "ZZZZZ")).not.toThrow();
    });

    it("only evicts the specified symbol, not others", () => {
      storeAnalysisResult("user1", "NVDA", makeResult({ tickers: ["NVDA"] }));
      storeAnalysisResult("user1", "AAPL", makeResult({ tickers: ["AAPL"] }));
      evictAnalysisResult("user1", "NVDA");
      expect(lookupAnalysisResult("user1", "NVDA").found).toBe(false);
      expect(lookupAnalysisResult("user1", "AAPL").found).toBe(true);
    });
  });
});
