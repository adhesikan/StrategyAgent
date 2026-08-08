/**
 * Portfolio Normalization Service (Sprint 2.4.0)
 *
 * Pure, deterministic, no-LLM normalization of raw position rows into the
 * canonical PortfolioPosition shape. Handles flexible header synonyms from
 * CSV/XLSX imports, manual entry, and broker adapter output.
 */

export type PortfolioSourceType = "manual" | "csv" | "xlsx" | "broker" | "image" | "pdf";

export interface RawRow {
  [key: string]: string | number | null | undefined;
}

export interface NormalizedPortfolioPosition {
  symbol:      string;
  quantity:    number;
  averageCost: number | null;
  costBasis:   number | null;
  currency:    string;
  warnings:    string[];
}

export interface InvalidRow {
  rowIndex: number;
  raw:      RawRow;
  reason:   string;
}

export interface NormalizationResult {
  normalizedPositions: NormalizedPortfolioPosition[];
  invalidRows:         InvalidRow[];
  parsedCount:         number;
  warnings:            string[];
}

// ---------------------------------------------------------------------------
// Header synonyms (all lowercased for case-insensitive matching)
// ---------------------------------------------------------------------------

const SYMBOL_HEADERS   = new Set(["ticker", "symbol", "sym", "stock", "security"]);
const QUANTITY_HEADERS  = new Set(["shares", "quantity", "qty", "units", "share qty", "share quantity", "number of shares"]);
const AVG_COST_HEADERS  = new Set([
  "average cost", "avg cost", "cost basis per share", "avg price",
  "average price", "price per share", "cost per share", "unit cost",
  "average cost basis", "price",
]);
const COST_BASIS_HEADERS = new Set([
  "cost basis", "total cost", "total cost basis", "total invested",
  "book value", "book cost", "basis",
]);

function normalizeHeaderKey(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function findColumnKey(
  row: RawRow,
  synonyms: Set<string>,
): string | undefined {
  for (const key of Object.keys(row)) {
    if (synonyms.has(normalizeHeaderKey(key))) return key;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

function toSymbol(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase().replace(/[^A-Z0-9./-]/g, "");
  return s.length > 0 && s.length <= 10 ? s : null;
}

function toPositiveNumber(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,%]/g, "").trim());
  if (!isFinite(n)) return null;
  return n;
}

function toPositiveQty(raw: string | number | null | undefined): number | null {
  const n = toPositiveNumber(raw);
  if (n === null) return null;
  return n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Main normalizer
// ---------------------------------------------------------------------------

/**
 * Normalize raw rows (from CSV, XLSX, manual entry, or broker adapter) into
 * canonical portfolio positions. Consolidates duplicate symbols deterministically
 * (summed qty, weighted-average cost). Does NOT call any external service.
 */
export function normalizePortfolioPositions(
  rows: RawRow[],
  sourceType: PortfolioSourceType,
): NormalizationResult {
  const normalizedMap = new Map<string, NormalizedPortfolioPosition>();
  const invalidRows: InvalidRow[] = [];
  const topWarnings: string[] = [];

  if (rows.length > 500) {
    topWarnings.push(`Only the first 500 rows will be processed (received ${rows.length}).`);
  }

  const rowsToProcess = rows.slice(0, 500);

  for (let i = 0; i < rowsToProcess.length; i++) {
    const row = rowsToProcess[i];
    const rowWarnings: string[] = [];

    // --- Symbol ---
    const symKey = findColumnKey(row, SYMBOL_HEADERS);
    const rawSym = symKey != null ? row[symKey] : undefined;
    const symbol = toSymbol(rawSym);
    if (!symbol) {
      invalidRows.push({ rowIndex: i, raw: row, reason: "Missing or invalid ticker symbol" });
      continue;
    }

    // --- Quantity ---
    const qtyKey = findColumnKey(row, QUANTITY_HEADERS);
    const rawQty = qtyKey != null ? row[qtyKey] : undefined;
    const quantity = toPositiveQty(rawQty);
    if (quantity === null) {
      invalidRows.push({ rowIndex: i, raw: row, reason: `Invalid or zero quantity for ${symbol}` });
      continue;
    }

    // --- Average Cost (optional) ---
    const avgKey = findColumnKey(row, AVG_COST_HEADERS);
    const rawAvg = avgKey != null ? row[avgKey] : undefined;
    let averageCost = toPositiveNumber(rawAvg);
    if (rawAvg != null && rawAvg !== "" && averageCost === null) {
      rowWarnings.push(`Could not parse average cost "${rawAvg}" for ${symbol} — treated as unknown`);
      averageCost = null;
    }

    // --- Cost Basis (optional) ---
    const cbKey = findColumnKey(row, COST_BASIS_HEADERS);
    const rawCb = cbKey != null ? row[cbKey] : undefined;
    let costBasis = toPositiveNumber(rawCb);
    if (rawCb != null && rawCb !== "" && costBasis === null) {
      rowWarnings.push(`Could not parse cost basis "${rawCb}" for ${symbol} — treated as unknown`);
      costBasis = null;
    }

    // Derive costBasis from averageCost × qty if missing
    if (costBasis === null && averageCost !== null) {
      costBasis = averageCost * quantity;
    }
    // Derive averageCost from costBasis ÷ qty if missing
    if (averageCost === null && costBasis !== null && quantity > 0) {
      averageCost = costBasis / quantity;
    }

    // --- Currency ---
    const currency = "USD";

    // --- Consolidate duplicates ---
    if (normalizedMap.has(symbol)) {
      const existing = normalizedMap.get(symbol)!;
      const newQty = existing.quantity + quantity;

      // Weighted-average cost
      let newAvgCost: number | null = null;
      if (existing.averageCost !== null && averageCost !== null) {
        newAvgCost = (existing.averageCost * existing.quantity + averageCost * quantity) / newQty;
      } else if (existing.averageCost !== null) {
        newAvgCost = existing.averageCost;
      } else if (averageCost !== null) {
        newAvgCost = averageCost;
      }

      const newCostBasis =
        existing.costBasis !== null && costBasis !== null
          ? existing.costBasis + costBasis
          : existing.costBasis ?? costBasis;

      existing.quantity    = newQty;
      existing.averageCost = newAvgCost;
      existing.costBasis   = newCostBasis;
      existing.warnings.push(...rowWarnings, `Duplicate row for ${symbol} consolidated`);
    } else {
      normalizedMap.set(symbol, {
        symbol,
        quantity,
        averageCost,
        costBasis,
        currency,
        warnings: rowWarnings,
      });
    }
  }

  return {
    normalizedPositions: Array.from(normalizedMap.values()),
    invalidRows,
    parsedCount: rowsToProcess.length,
    warnings: topWarnings,
  };
}
