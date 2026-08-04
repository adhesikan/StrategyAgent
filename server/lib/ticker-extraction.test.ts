// Regression tests for centralized ticker extraction (false-ticker spec §7).
import { describe, test, expect } from "vitest";
import { extractTickers, isReservedTickerWord, stripConstraintPhrases } from "./ticker-extraction";

describe("extractTickers — market-wide asks return no symbol", () => {
  test('1+10. "Find a trade under $500 max loss" → no symbol (UNDER/MAX/LOSS never tickers)', () => {
    expect(extractTickers("Find a trade under $500 max loss")).toEqual([]);
  });
  test('2. "Find a stock trade under $300 risk" → no symbol', () => {
    expect(extractTickers("Find a stock trade under $300 risk")).toEqual([]);
  });
  test('3. "Find three bullish trades" → no symbol', () => {
    expect(extractTickers("Find three bullish trades")).toEqual([]);
  });
  test('4. "What should I trade today?" → no symbol', () => {
    expect(extractTickers("What should I trade today?")).toEqual([]);
  });
  test('5. "Find an income option" → no symbol', () => {
    expect(extractTickers("Find an income option")).toEqual([]);
  });
  test("other broad phrasings", () => {
    expect(extractTickers("Find an options trade")).toEqual([]);
    expect(extractTickers("Find an income opportunity")).toEqual([]);
    expect(extractTickers("maximum loss of $1,000 please")).toEqual([]);
    expect(extractTickers("risk no more than $250")).toEqual([]);
    expect(extractTickers("within a $500 budget")).toEqual([]);
  });
});

describe("extractTickers — legitimate symbols preserved", () => {
  test('6. "Find a trade for NVDA" → NVDA', () => {
    expect(extractTickers("Find a trade for NVDA")).toEqual(["NVDA"]);
  });
  test('7. "Analyze BA" → BA', () => {
    expect(extractTickers("Analyze BA")).toEqual(["BA"]);
  });
  test('8. "Analyze ticker ON" → ON despite English-word collision', () => {
    expect(extractTickers("Analyze ticker ON")).toEqual(["ON"]);
  });
  test('9. "$META under $500 risk" → META only', () => {
    expect(extractTickers("$META under $500 risk")).toEqual(["META"]);
  });
  test("explicit context bypasses denylist", () => {
    expect(extractTickers("symbol ON please")).toEqual(["ON"]);
    expect(extractTickers("NASDAQ:AMD looks strong")).toContain("AMD");
    expect(extractTickers("$ALL breakout?")).toEqual(["ALL"]);
  });
  test("14. existing extraction behaviors unchanged", () => {
    expect(extractTickers("why is nvda moving")).toEqual(["NVDA"]);
    expect(extractTickers("How does BA look?")).toEqual(["BA"]);
    expect(extractTickers("Compare NVDA and AMD")).toEqual(["NVDA", "AMD"]);
    expect(extractTickers("Analyze MU")).toEqual(["MU"]);
  });
});

describe("stripConstraintPhrases / isReservedTickerWord", () => {
  test("constraint words consumed before extraction", () => {
    const s = stripConstraintPhrases("Find a trade under $500 max loss");
    expect(s.toUpperCase()).not.toMatch(/UNDER|MAX|LOSS|500/);
  });
  test("residual command verbs never self-match as tickers", () => {
    expect(extractTickers("check the scan and quote")).toEqual([]);
    expect(extractTickers("can you check scan quote please")).toEqual([]);
    expect(extractTickers("check NVDA quote")).toEqual(["NVDA"]);
  });
  test("reserved words flagged; real tickers not", () => {
    for (const w of ["UNDER", "MAX", "LOSS", "TRADE", "FIND", "RISK"]) expect(isReservedTickerWord(w)).toBe(true);
    for (const w of ["NVDA", "BA", "MU", "META", "AMD"]) expect(isReservedTickerWord(w)).toBe(false);
  });
});
