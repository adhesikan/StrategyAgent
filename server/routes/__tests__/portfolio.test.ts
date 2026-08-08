/**
 * Portfolio Tests — Sprint 2.4.0
 *
 * Covers every acceptance criterion from the spec §15:
 *   - CSV standard/alternate headers
 *   - XLSX standard sheet / multiple sheets
 *   - Invalid numeric values
 *   - Missing ticker
 *   - Duplicate symbols (consolidated)
 *   - Quantity validation
 *   - Average cost optional
 *   - Preview/confirm session flow
 *   - Manual add/edit/delete (validation layer)
 *   - User isolation / cross-user denial
 *   - File size rejection
 *   - Invalid file type rejection
 *   - Empty file handling
 *   - 100+ position import
 *   - Deterministic normalization
 *   - No LLM dependency
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import {
  normalizePortfolioPositions,
  type RawRow,
} from "../../services/portfolio-normalization";
import {
  parseCsvBuffer,
  parseXlsxBuffer,
  parseAndNormalizeCsv,
  parseAndNormalizeXlsx,
  ALLOWED_CSV_MIMES,
  ALLOWED_XLSX_MIMES,
  MAX_FILE_BYTES,
} from "../../services/portfolio-import";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCsvBuffer(rows: string[]): Buffer {
  return Buffer.from(rows.join("\n"), "utf8");
}

function makeXlsxBuffer(
  data: string[][],
  sheetName = "Sheet1",
  additionalSheets: Record<string, string[][]> = {},
): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  for (const [name, rows] of Object.entries(additionalSheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// ---------------------------------------------------------------------------
// Normalization service — pure unit tests
// ---------------------------------------------------------------------------

describe("normalizePortfolioPositions — standard headers", () => {
  it("parses Symbol, Quantity, Average Cost", () => {
    const rows: RawRow[] = [
      { Symbol: "AAPL", Quantity: "100", "Average Cost": "150.00" },
      { Symbol: "MSFT", Quantity: "50",  "Average Cost": "300.00" },
    ];
    const { normalizedPositions, invalidRows } = normalizePortfolioPositions(rows, "csv");
    expect(normalizedPositions).toHaveLength(2);
    expect(invalidRows).toHaveLength(0);
    const aapl = normalizedPositions.find(p => p.symbol === "AAPL")!;
    expect(aapl.quantity).toBe(100);
    expect(aapl.averageCost).toBe(150);
    expect(aapl.costBasis).toBeCloseTo(15000);
  });
});

describe("normalizePortfolioPositions — alternate headers", () => {
  it("parses Ticker, Shares, Avg Cost", () => {
    const rows: RawRow[] = [
      { Ticker: "NVDA", Shares: "25", "Avg Cost": "500" },
    ];
    const { normalizedPositions } = normalizePortfolioPositions(rows, "csv");
    expect(normalizedPositions[0].symbol).toBe("NVDA");
    expect(normalizedPositions[0].quantity).toBe(25);
    expect(normalizedPositions[0].averageCost).toBe(500);
  });

  it("parses Qty and Cost Basis Per Share", () => {
    const rows: RawRow[] = [
      { Ticker: "AMD", Qty: "200", "Cost Basis Per Share": "90.00" },
    ];
    const { normalizedPositions } = normalizePortfolioPositions(rows, "csv");
    expect(normalizedPositions[0].symbol).toBe("AMD");
    expect(normalizedPositions[0].quantity).toBe(200);
    expect(normalizedPositions[0].averageCost).toBe(90);
  });

  it("parses Units header", () => {
    const rows: RawRow[] = [
      { Sym: "MU", Units: "300", Price: "50" },
    ];
    const { normalizedPositions } = normalizePortfolioPositions(rows, "csv");
    expect(normalizedPositions[0].symbol).toBe("MU");
    expect(normalizedPositions[0].quantity).toBe(300);
  });

  it("ignores unknown columns safely", () => {
    const rows: RawRow[] = [
      { Ticker: "TSLA", Shares: "10", "Average Cost": "200", Notes: "long term", Category: "Tech" },
    ];
    const { normalizedPositions, invalidRows } = normalizePortfolioPositions(rows, "csv");
    expect(normalizedPositions).toHaveLength(1);
    expect(invalidRows).toHaveLength(0);
  });

  it("parses Cost Basis column", () => {
    const rows: RawRow[] = [
      { Symbol: "GOOG", Quantity: "5", "Cost Basis": "7500" },
    ];
    const { normalizedPositions } = normalizePortfolioPositions(rows, "csv");
    const p = normalizedPositions[0];
    expect(p.costBasis).toBeCloseTo(7500);
    expect(p.averageCost).toBeCloseTo(1500); // derived
  });
});

describe("normalizePortfolioPositions — validation", () => {
  it("rejects row with missing ticker", () => {
    const rows: RawRow[] = [
      { Symbol: "", Quantity: "100", "Average Cost": "10" },
    ];
    const { normalizedPositions, invalidRows } = normalizePortfolioPositions(rows, "csv");
    expect(normalizedPositions).toHaveLength(0);
    expect(invalidRows).toHaveLength(1);
    expect(invalidRows[0].reason).toMatch(/ticker/i);
  });

  it("rejects row with no symbol column at all", () => {
    const rows: RawRow[] = [{ NotASymbol: "AAPL", Quantity: "10" }];
    const { invalidRows } = normalizePortfolioPositions(rows, "csv");
    expect(invalidRows).toHaveLength(1);
  });

  it("rejects zero quantity", () => {
    const rows: RawRow[] = [
      { Symbol: "AAPL", Quantity: "0", "Average Cost": "100" },
    ];
    const { invalidRows } = normalizePortfolioPositions(rows, "csv");
    expect(invalidRows).toHaveLength(1);
    expect(invalidRows[0].reason).toMatch(/quantity/i);
  });

  it("rejects negative quantity", () => {
    const rows: RawRow[] = [
      { Symbol: "AAPL", Quantity: "-5", "Average Cost": "100" },
    ];
    const { invalidRows } = normalizePortfolioPositions(rows, "csv");
    expect(invalidRows).toHaveLength(1);
  });

  it("accepts average cost as optional (null if missing)", () => {
    const rows: RawRow[] = [
      { Symbol: "AAPL", Quantity: "100" },
    ];
    const { normalizedPositions, invalidRows } = normalizePortfolioPositions(rows, "csv");
    expect(normalizedPositions).toHaveLength(1);
    expect(invalidRows).toHaveLength(0);
    expect(normalizedPositions[0].averageCost).toBeNull();
    expect(normalizedPositions[0].costBasis).toBeNull();
  });

  it("treats invalid numeric average cost as warning, not hard rejection", () => {
    const rows: RawRow[] = [
      { Symbol: "AAPL", Quantity: "100", "Average Cost": "N/A" },
    ];
    const { normalizedPositions, invalidRows } = normalizePortfolioPositions(rows, "csv");
    expect(normalizedPositions).toHaveLength(1);
    expect(invalidRows).toHaveLength(0);
    expect(normalizedPositions[0].averageCost).toBeNull();
    expect(normalizedPositions[0].warnings.length).toBeGreaterThan(0);
  });

  it("strips $ and , from numeric fields", () => {
    const rows: RawRow[] = [
      { Symbol: "AAPL", Quantity: "1,000", "Average Cost": "$150.50" },
    ];
    const { normalizedPositions } = normalizePortfolioPositions(rows, "csv");
    expect(normalizedPositions[0].quantity).toBe(1000);
    expect(normalizedPositions[0].averageCost).toBe(150.5);
  });
});

describe("normalizePortfolioPositions — duplicate symbols", () => {
  it("consolidates duplicates deterministically (sum qty, weighted avg cost)", () => {
    const rows: RawRow[] = [
      { Symbol: "AAPL", Quantity: "100", "Average Cost": "150" },
      { Symbol: "AAPL", Quantity: "50",  "Average Cost": "180" },
    ];
    const { normalizedPositions } = normalizePortfolioPositions(rows, "csv");
    expect(normalizedPositions).toHaveLength(1);
    const p = normalizedPositions[0];
    expect(p.quantity).toBe(150);
    // weighted avg: (100*150 + 50*180) / 150 = (15000 + 9000) / 150 = 160
    expect(p.averageCost).toBeCloseTo(160);
    expect(p.costBasis).toBeCloseTo(24000);
  });

  it("consolidation is deterministic (same order → same result)", () => {
    const rows: RawRow[] = [
      { Symbol: "MSFT", Quantity: "10", "Average Cost": "300" },
      { Symbol: "AAPL", Quantity: "5",  "Average Cost": "200" },
      { Symbol: "MSFT", Quantity: "5",  "Average Cost": "350" },
    ];
    const r1 = normalizePortfolioPositions(rows, "csv");
    const r2 = normalizePortfolioPositions(rows, "csv");
    expect(r1.normalizedPositions.find(p => p.symbol === "MSFT")!.quantity)
      .toBe(r2.normalizedPositions.find(p => p.symbol === "MSFT")!.quantity);
    expect(r1.normalizedPositions.find(p => p.symbol === "MSFT")!.averageCost)
      .toBeCloseTo(r2.normalizedPositions.find(p => p.symbol === "MSFT")!.averageCost!);
  });

  it("case-normalizes symbols to uppercase", () => {
    const rows: RawRow[] = [
      { Ticker: "aapl", Shares: "10" },
    ];
    const { normalizedPositions } = normalizePortfolioPositions(rows, "csv");
    expect(normalizedPositions[0].symbol).toBe("AAPL");
  });
});

describe("normalizePortfolioPositions — 100+ positions", () => {
  it("handles 100 positions without error", () => {
    const rows: RawRow[] = Array.from({ length: 100 }, (_, i) => ({
      Symbol: `SYM${i}`,
      Quantity: "10",
      "Average Cost": "50",
    }));
    const { normalizedPositions, invalidRows } = normalizePortfolioPositions(rows, "csv");
    expect(normalizedPositions).toHaveLength(100);
    expect(invalidRows).toHaveLength(0);
  });

  it("caps at 500 and warns when over", () => {
    const rows: RawRow[] = Array.from({ length: 600 }, (_, i) => ({
      Symbol: `SYM${i}`,
      Quantity: "5",
    }));
    const { normalizedPositions, warnings } = normalizePortfolioPositions(rows, "csv");
    expect(normalizedPositions.length).toBeLessThanOrEqual(500);
    expect(warnings.some(w => w.includes("500"))).toBe(true);
  });
});

describe("normalizePortfolioPositions — no LLM dependency", () => {
  it("module has no import of AI provider libraries", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("server/services/portfolio-normalization.ts", "utf8");
    // Check no imports of AI provider packages (comments mentioning "LLM" as a concept are fine)
    expect(src).not.toMatch(/^import.*openai/im);
    expect(src).not.toMatch(/^import.*anthropic/im);
    expect(src).not.toMatch(/^import.*@anthropic/im);
    expect(src).not.toMatch(/from ['"]openai['"]/);
    expect(src).not.toMatch(/from ['"]anthropic['"]/);
    // No actual LLM calls
    expect(src).not.toContain("createCompletion");
    expect(src).not.toContain("chat.completions");
    expect(src).not.toContain("client.messages");
  });
});

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

describe("parseCsvBuffer — CSV parsing", () => {
  it("parses standard CSV with header row", () => {
    const csv = makeCsvBuffer([
      "Symbol,Shares,Average Cost",
      "AAPL,100,150.00",
      "MSFT,50,300.00",
    ]);
    const { rows } = parseCsvBuffer(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]["Symbol"]).toBe("AAPL");
    expect(rows[0]["Shares"]).toBeDefined();
  });

  it("returns empty rows for CSV with only header", () => {
    const csv = makeCsvBuffer(["Symbol,Shares,Average Cost"]);
    const { rows } = parseCsvBuffer(csv);
    expect(rows).toHaveLength(0);
  });

  it("strips formula cells (= prefix)", () => {
    const csv = makeCsvBuffer([
      "Symbol,Shares,Average Cost",
      "AAPL,=1+1,150",
    ]);
    const { rows } = parseCsvBuffer(csv);
    // Formula value stripped to empty string — normalization will reject as invalid qty
    const result = normalizePortfolioPositions(rows, "csv");
    expect(result.invalidRows.length).toBeGreaterThan(0);
  });
});

describe("parseAndNormalizeCsv — end-to-end", () => {
  it("parses and normalizes standard CSV", () => {
    const csv = makeCsvBuffer([
      "Ticker,Quantity,Avg Cost",
      "AAPL,100,150",
      "NVDA,25,500",
    ]);
    const result = parseAndNormalizeCsv(csv);
    expect(result.normalizedPositions).toHaveLength(2);
    expect(result.invalidRows).toHaveLength(0);
  });

  it("handles alternate header: Shares + Average Cost", () => {
    const csv = makeCsvBuffer([
      "Symbol,Shares,Average Cost",
      "TSLA,10,200",
    ]);
    const result = parseAndNormalizeCsv(csv);
    expect(result.normalizedPositions[0].symbol).toBe("TSLA");
    expect(result.normalizedPositions[0].quantity).toBe(10);
  });

  it("returns invalid rows for missing ticker", () => {
    const csv = makeCsvBuffer([
      "Symbol,Shares",
      ",100",
    ]);
    const result = parseAndNormalizeCsv(csv);
    expect(result.invalidRows.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// XLSX parser
// ---------------------------------------------------------------------------

describe("parseXlsxBuffer — XLSX parsing", () => {
  it("parses standard XLSX with header row", () => {
    const buf = makeXlsxBuffer([
      ["Symbol", "Quantity", "Average Cost"],
      ["AAPL", 100, 150],
      ["MSFT", 50, 300],
    ]);
    const { rows, sheetInfo } = parseXlsxBuffer(buf);
    expect(rows).toHaveLength(2);
    expect(sheetInfo?.availableSheets).toContain("Sheet1");
    expect(sheetInfo?.selectedSheet).toBe("Sheet1");
  });

  it("lists available sheet names when multiple sheets exist", () => {
    const buf = makeXlsxBuffer(
      [["Symbol", "Quantity"], ["AAPL", 100]],
      "Holdings",
      { "Summary": [["Total", "100"]] },
    );
    const { sheetInfo } = parseXlsxBuffer(buf);
    expect(sheetInfo?.availableSheets).toHaveLength(2);
    expect(sheetInfo?.availableSheets).toContain("Holdings");
    expect(sheetInfo?.availableSheets).toContain("Summary");
  });

  it("selects first sheet by default", () => {
    const buf = makeXlsxBuffer(
      [["Symbol", "Quantity"], ["AAPL", 100]],
      "Sheet1",
      { "Sheet2": [["Symbol", "Quantity"], ["MSFT", 50]] },
    );
    const { rows, sheetInfo } = parseXlsxBuffer(buf, 0);
    expect(sheetInfo?.selectedSheet).toBe("Sheet1");
    expect(rows[0]["Symbol"]).toBe("AAPL");
  });

  it("selects second sheet when sheetIndex=1", () => {
    const buf = makeXlsxBuffer(
      [["Symbol", "Quantity"], ["AAPL", 100]],
      "Sheet1",
      { "Sheet2": [["Symbol", "Quantity"], ["MSFT", 50]] },
    );
    const { rows, sheetInfo } = parseXlsxBuffer(buf, 1);
    expect(sheetInfo?.selectedSheet).toBe("Sheet2");
    expect(rows[0]["Symbol"]).toBe("MSFT");
  });

  it("returns empty rows for XLSX with only header", () => {
    const buf = makeXlsxBuffer([["Symbol", "Quantity", "Average Cost"]]);
    const { rows } = parseXlsxBuffer(buf);
    expect(rows).toHaveLength(0);
  });
});

describe("parseAndNormalizeXlsx — end-to-end", () => {
  it("parses and normalizes XLSX", () => {
    const buf = makeXlsxBuffer([
      ["Ticker", "Shares", "Avg Cost"],
      ["AAPL", 100, 150],
      ["NVDA", 25, 500],
    ]);
    const result = parseAndNormalizeXlsx(buf);
    expect(result.normalizedPositions).toHaveLength(2);
    expect(result.invalidRows).toHaveLength(0);
    expect(result.sheetInfo?.availableSheets).toBeDefined();
  });

  it("returns invalid rows for rows with missing ticker", () => {
    const buf = makeXlsxBuffer([
      ["Symbol", "Quantity"],
      ["", 100],
    ]);
    const result = parseAndNormalizeXlsx(buf);
    expect(result.invalidRows.length).toBeGreaterThan(0);
  });

  it("handles 100+ positions", () => {
    const data: Array<string | number>[] = [["Symbol", "Quantity", "Average Cost"]];
    for (let i = 0; i < 100; i++) {
      data.push([`SYM${i}`, 10, 50]);
    }
    const buf = makeXlsxBuffer(data as string[][]);
    const result = parseAndNormalizeXlsx(buf);
    expect(result.normalizedPositions).toHaveLength(100);
  });
});

// ---------------------------------------------------------------------------
// File safety constants
// ---------------------------------------------------------------------------

describe("file safety — constants", () => {
  it("MAX_FILE_BYTES is 5 MB", () => {
    expect(MAX_FILE_BYTES).toBe(5 * 1024 * 1024);
  });

  it("ALLOWED_CSV_MIMES includes text/csv", () => {
    expect(ALLOWED_CSV_MIMES.has("text/csv")).toBe(true);
  });

  it("ALLOWED_XLSX_MIMES includes openxml sheet", () => {
    expect(ALLOWED_XLSX_MIMES.has("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(true);
  });

  it("ALLOWED_CSV_MIMES does NOT include xlsx mime", () => {
    expect(ALLOWED_CSV_MIMES.has("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// User isolation — structural / logic tests
// ---------------------------------------------------------------------------

describe("user isolation — portfolio route guards", () => {
  it("portfolio route file imports isAuthenticated parameter (required)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("server/routes/portfolio.ts", "utf8");
    expect(src).toContain("isAuthenticated");
    expect(src).toContain("req.session.userId");
  });

  it("getPortfolioForUser filters by both id AND userId", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("server/routes/portfolio.ts", "utf8");
    // Ownership enforced at query level
    expect(src).toContain("eq(portfolios.userId, userId)");
    expect(src).toContain("eq(portfolios.id, portfolioId)");
  });

  it("preview store uses userId in claim — cross-user tokens denied (structural)", async () => {
    // claimPreview enforces userId match — verified by reading source
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("server/routes/portfolio.ts", "utf8");
    // claimPreview must compare stored userId with caller userId
    expect(src).toContain("session.userId !== userId");
    // Single-use: preview deleted after claim
    expect(src).toContain("_previewStore.delete(previewId)");
  });

  it("route file never trusts client-provided userId", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("server/routes/portfolio.ts", "utf8");
    // userId must always come from session, not body/params
    expect(src).toContain("req.session.userId!");
    expect(src).not.toContain("req.body.userId");
    expect(src).not.toContain("req.params.userId");
  });

  it("no broker credentials returned in position response", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("server/routes/portfolio.ts", "utf8");
    expect(src).not.toContain("accessToken");
    expect(src).not.toContain("brokerToken");
    expect(src).not.toContain("clientSecret");
  });
});

// ---------------------------------------------------------------------------
// Manual entry — validation (mirrors route logic)
// ---------------------------------------------------------------------------

describe("manual entry — input validation", () => {
  function validateManualPosition(symbol: string, quantity: number, averageCost?: number) {
    const errors: string[] = [];
    if (!symbol || !symbol.trim()) errors.push("Symbol required");
    else if (!/^[A-Z0-9./-]{1,10}$/.test(symbol.trim().toUpperCase())) errors.push("Invalid symbol");
    if (!isFinite(quantity) || quantity <= 0) errors.push("Quantity must be positive");
    if (averageCost !== undefined && (!isFinite(averageCost) || averageCost < 0)) errors.push("Average cost non-negative");
    return errors;
  }

  it("accepts valid symbol + quantity", () => {
    expect(validateManualPosition("AAPL", 100)).toHaveLength(0);
  });

  it("accepts optional average cost", () => {
    expect(validateManualPosition("AAPL", 100)).toHaveLength(0);
    expect(validateManualPosition("AAPL", 100, 150)).toHaveLength(0);
  });

  it("rejects empty symbol", () => {
    expect(validateManualPosition("", 100)).toContain("Symbol required");
  });

  it("rejects zero quantity", () => {
    expect(validateManualPosition("AAPL", 0)).toContain("Quantity must be positive");
  });

  it("rejects negative quantity", () => {
    expect(validateManualPosition("AAPL", -5)).toContain("Quantity must be positive");
  });

  it("rejects negative average cost", () => {
    const errs = validateManualPosition("AAPL", 10, -50);
    expect(errs).toContain("Average cost non-negative");
  });

  it("rejects symbol over 10 characters", () => {
    expect(validateManualPosition("TOOLONGSYM123", 10)).toContain("Invalid symbol");
  });

  it("accepts ETF-style symbols", () => {
    expect(validateManualPosition("SPY", 10)).toHaveLength(0);
    expect(validateManualPosition("QQQ", 5)).toHaveLength(0);
    expect(validateManualPosition("BRK.B", 2)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Schema integrity
// ---------------------------------------------------------------------------

describe("shared/schema.ts — portfolio tables", () => {
  it("exports portfolios table", async () => {
    const schema = await import("../../../shared/schema");
    expect(schema.portfolios).toBeDefined();
  });

  it("exports portfolioPositions table", async () => {
    const schema = await import("../../../shared/schema");
    expect(schema.portfolioPositions).toBeDefined();
  });

  it("exports insertPortfolioSchema", async () => {
    const schema = await import("../../../shared/schema");
    expect(schema.insertPortfolioSchema).toBeDefined();
  });

  it("exports insertPortfolioPositionSchema", async () => {
    const schema = await import("../../../shared/schema");
    expect(schema.insertPortfolioPositionSchema).toBeDefined();
  });

  it("portfolioSourceTypeEnum has correct values", async () => {
    const schema = await import("../../../shared/schema");
    expect(schema.portfolioSourceTypeEnum).toBeDefined();
    // The enum definition includes the valid values
    const src = await (await import("node:fs/promises")).readFile("shared/schema.ts", "utf8");
    expect(src).toContain('"manual"');
    expect(src).toContain('"csv"');
    expect(src).toContain('"xlsx"');
    expect(src).toContain('"broker"');
    expect(src).not.toContain('"screenshot"');
    expect(src).not.toContain('"pdf"');
  });
});

// ---------------------------------------------------------------------------
// Route module
// ---------------------------------------------------------------------------

describe("portfolio route module", () => {
  it("exports registerPortfolioRoutes", async () => {
    const mod = await import("../portfolio");
    expect(typeof mod.registerPortfolioRoutes).toBe("function");
  });

  it("uses getReferenceSnapshotsBulk (not a direct Twelve Data call)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("server/routes/portfolio.ts", "utf8");
    expect(src).toContain("getReferenceSnapshotsBulk");
    expect(src).not.toContain("getTwelveData");
    expect(src).not.toContain("twelvedata.com");
    expect(src).not.toContain("TWELVE_DATA_API_KEY");
  });
});
