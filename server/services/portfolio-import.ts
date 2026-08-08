/**
 * Portfolio Import Service (Sprint 2.4.0)
 *
 * CSV and XLSX file parsing. Safety rules:
 *  - Max file size enforced by multer (5 MB)
 *  - Max 500 rows (normalizer enforces)
 *  - Formula cells (strings starting with =, +, -, @) treated as raw text / rejected
 *  - No macro execution (xlsx cellFormula: false)
 *  - No path traversal (multer memoryStorage — no disk writes)
 *  - MIME/type checked before parse attempt
 */

import * as XLSX from "xlsx";
import { normalizePortfolioPositions, type RawRow } from "./portfolio-normalization";

export type { NormalizationResult, NormalizedPortfolioPosition } from "./portfolio-normalization";

export const ALLOWED_CSV_MIMES = new Set([
  "text/csv",
  "text/plain",
  "application/csv",
  "application/vnd.ms-excel",
]);

export const ALLOWED_XLSX_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream", // some clients send this for xlsx
]);

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface SheetInfo {
  availableSheets: string[];
  selectedSheet:   string;
}

export interface ParsedImport {
  rows:       RawRow[];
  sheetInfo?: SheetInfo;
}

// ---------------------------------------------------------------------------
// Formula-cell sanitizer
// ---------------------------------------------------------------------------

const FORMULA_PREFIXES = ["=", "+", "-", "@"];

function sanitizeCellValue(val: string | number | boolean | null | undefined): string | number | null {
  if (val == null) return null;
  if (typeof val === "number" || typeof val === "boolean") return val as number;
  const s = String(val);
  if (FORMULA_PREFIXES.some(p => s.startsWith(p))) return ""; // strip formula
  return s;
}

// ---------------------------------------------------------------------------
// CSV parser — uses XLSX in CSV mode (no external dep, handles edge cases)
// ---------------------------------------------------------------------------

export function parseCsvBuffer(buffer: Buffer): ParsedImport {
  const workbook = XLSX.read(buffer, {
    type:          "buffer",
    raw:           false,
    cellFormula:   false,
    cellHTML:      false,
    cellText:      false,
    dense:         false,
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("CSV file appears to be empty");

  const sheet = workbook.Sheets[sheetName];
  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rawRows.length < 2) {
    return { rows: [] };
  }

  const [headerRow, ...dataRows] = rawRows as string[][];
  const headers = headerRow.map(h => String(h ?? "").trim());

  const rows: RawRow[] = dataRows
    .filter(row => row.some(cell => cell !== "" && cell != null))
    .map(row => {
      const obj: RawRow = {};
      headers.forEach((h, i) => {
        if (h) obj[h] = sanitizeCellValue(row[i] ?? null);
      });
      return obj;
    });

  return { rows };
}

// ---------------------------------------------------------------------------
// XLSX parser
// ---------------------------------------------------------------------------

export function parseXlsxBuffer(buffer: Buffer, sheetIndex = 0): ParsedImport {
  const workbook = XLSX.read(buffer, {
    type:        "buffer",
    raw:         false,
    cellFormula: false,
    cellHTML:    false,
    cellText:    false,
    dense:       false,
  });

  if (workbook.SheetNames.length === 0) throw new Error("XLSX file has no sheets");

  const availableSheets = workbook.SheetNames;
  const idx = Math.min(sheetIndex, availableSheets.length - 1);
  const sheetName = availableSheets[idx];
  const sheet = workbook.Sheets[sheetName];

  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rawRows.length < 2) {
    return {
      rows: [],
      sheetInfo: { availableSheets, selectedSheet: sheetName },
    };
  }

  const [headerRow, ...dataRows] = rawRows as Array<Array<string | number | null>>;
  const headers = headerRow.map(h => String(h ?? "").trim());

  const rows: RawRow[] = dataRows
    .filter(row => row.some(cell => cell !== "" && cell != null))
    .map(row => {
      const obj: RawRow = {};
      headers.forEach((h, i) => {
        if (h) obj[h] = sanitizeCellValue(row[i] ?? null);
      });
      return obj;
    });

  return {
    rows,
    sheetInfo: { availableSheets, selectedSheet: sheetName },
  };
}

// ---------------------------------------------------------------------------
// Convenience: parse + normalize in one call
// ---------------------------------------------------------------------------

export function parseAndNormalizeCsv(buffer: Buffer) {
  const { rows } = parseCsvBuffer(buffer);
  return { ...normalizePortfolioPositions(rows, "csv"), rowCount: rows.length };
}

export function parseAndNormalizeXlsx(buffer: Buffer, sheetIndex = 0) {
  const { rows, sheetInfo } = parseXlsxBuffer(buffer, sheetIndex);
  return {
    ...normalizePortfolioPositions(rows, "xlsx"),
    rowCount: rows.length,
    sheetInfo,
  };
}
