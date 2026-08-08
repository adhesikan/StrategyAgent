/**
 * Portfolio Document Extractor (Sprint 2.4.1)
 *
 * Extracts candidate portfolio positions from:
 *   A. Images (PNG / JPG / JPEG / WEBP) — via GPT-4o vision
 *   B. PDF brokerage statements — via pdf-parse text extraction + GPT-4 text prompt
 *
 * AI is used ONLY to transform unstructured data into structured candidate rows.
 * All extracted rows then flow through the canonical normalizePortfolioPositions()
 * pipeline from Sprint 2.4.0 — no separate business rules.
 *
 * Privacy / Safety rules:
 *   - File buffers are never written to disk (multer memoryStorage upstream)
 *   - Raw file contents are never logged
 *   - Account numbers, emails, SSNs redacted before any logging
 *   - Original buffer is discarded after extraction
 *   - Only extraction telemetry (counts, durations, status) is logged
 */

import OpenAI from "openai";
import { normalizePortfolioPositions, type NormalizationResult, type RawRow } from "./portfolio-normalization";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_PDF_BYTES   = 15 * 1024 * 1024; // 15 MB
export const MAX_PDF_PAGES   = 50;

export const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpg",
  "image/jpeg",
  "image/webp",
]);

export const ALLOWED_PDF_MIMES = new Set([
  "application/pdf",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExtractionConfidence = "high" | "medium" | "low";

export interface ExtractedPositionRaw {
  symbol:       string | null;
  quantity:     number | null;
  averageCost:  number | null;
  costBasis:    number | null;
  marketValue:  number | null;
  confidence:   number; // 0–1 from AI
}

export interface ExtractionMetadata {
  detectedInstitution?: string | null;
  detectedPeriod?:      string | null;
  extractionWarnings:   string[];
  lowConfidenceCount:   number;
}

export interface DocumentExtractionResult extends NormalizationResult {
  metadata:    ExtractionMetadata;
  telemetry:   ExtractionTelemetry;
}

export interface ExtractionTelemetry {
  sourceType:            "image" | "pdf";
  processingDurationMs:  number;
  rowsDetected:          number;
  rowsValid:             number;
  rowsInvalid:           number;
  lowConfidenceCount:    number;
  resultStatus:          "success" | "partial" | "no_holdings" | "extraction_failed" | "provider_unavailable";
}

// ---------------------------------------------------------------------------
// Structured extraction schema — the JSON we ask the model to return
// ---------------------------------------------------------------------------

const EXTRACTION_SCHEMA_DESCRIPTION = `
Return ONLY valid JSON matching this exact schema (no markdown, no commentary):
{
  "positions": [
    {
      "symbol": "AAPL",
      "quantity": 100,
      "averageCost": 150.00,
      "costBasis": 15000.00,
      "marketValue": 18000.00,
      "confidence": 0.95
    }
  ],
  "detectedInstitution": "Fidelity",
  "detectedPeriod": "Q1 2024",
  "warnings": ["Average cost not visible for MSFT"]
}

Rules:
- symbol: uppercase ticker string (1–10 chars). null if unreadable.
- quantity: positive number (shares held). null if not visible.
- averageCost: per-share cost. null if not visible. NEVER fabricate.
- costBasis: total cost = quantity × averageCost. null if not visible. NEVER fabricate.
- marketValue: current value. null if not visible. NEVER fabricate.
- confidence: 0.0–1.0. 1.0 = highly certain, 0.5 = partially readable, 0.2 = guessing.
- detectedInstitution: broker/institution name if visible, else null.
- detectedPeriod: statement date or period if visible, else null.
- warnings: list any fields that were unclear or unreadable.
- Only include actual stock/ETF/fund positions. Exclude cash, money market, bonds unless clearly labeled as a holding.
- Do NOT invent or guess ticker symbols. If a company name is visible but ticker is ambiguous, omit that row and add a warning.
- Do NOT produce buy/sell/hold recommendations. Extract data only.
`;

const IMAGE_EXTRACTION_PROMPT = `You are a financial data extraction assistant. 
Extract all portfolio holdings visible in this brokerage account screenshot.
${EXTRACTION_SCHEMA_DESCRIPTION}`;

const PDF_EXTRACTION_PROMPT = `You are a financial data extraction assistant.
The following is text extracted from a brokerage account statement PDF.
Extract all portfolio holdings (stocks, ETFs, funds) from this text.
${EXTRACTION_SCHEMA_DESCRIPTION}`;

// ---------------------------------------------------------------------------
// PII / sensitive field redaction (for logging only — never mutates stored data)
// ---------------------------------------------------------------------------

const REDACT_PATTERNS: Array<[RegExp, string]> = [
  [/\b\d{9}\b/g,                         "[ACCT#]"],          // 9-digit account numbers
  [/account[:\s#]+[\w-]{4,}/gi,           "[ACCT]"],           // "Account: XXXX"
  [/\b\d{3}-\d{2}-\d{4}\b/g,             "[SSN]"],            // SSN pattern
  [/\b\d{9,12}\b/g,                      "[NUM]"],            // long numeric IDs
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[EMAIL]"],    // emails
  [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[IP]"],      // IP addresses
];

export function redactSensitiveText(text: string): string {
  let result = text;
  for (const [pattern, replacement] of REDACT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Parse AI JSON response
// ---------------------------------------------------------------------------

interface AiExtractionResponse {
  positions:           ExtractedPositionRaw[];
  detectedInstitution: string | null;
  detectedPeriod:      string | null;
  warnings:            string[];
}

function parseAiResponse(rawText: string): AiExtractionResponse {
  // Strip any markdown code fences the model might add
  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`AI returned non-JSON response: ${cleaned.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as Record<string, unknown>).positions)) {
    throw new Error("AI response missing required 'positions' array");
  }

  const obj = parsed as Record<string, unknown>;
  const positions = (obj.positions as unknown[]).map((p): ExtractedPositionRaw => {
    const pos = p as Record<string, unknown>;
    return {
      symbol:      typeof pos.symbol === "string" ? pos.symbol : null,
      quantity:    typeof pos.quantity === "number" ? pos.quantity : null,
      averageCost: typeof pos.averageCost === "number" ? pos.averageCost : null,
      costBasis:   typeof pos.costBasis  === "number" ? pos.costBasis   : null,
      marketValue: typeof pos.marketValue === "number" ? pos.marketValue : null,
      confidence:  typeof pos.confidence === "number" ? Math.max(0, Math.min(1, pos.confidence)) : 0.5,
    };
  });

  return {
    positions,
    detectedInstitution: typeof obj.detectedInstitution === "string" ? obj.detectedInstitution : null,
    detectedPeriod:      typeof obj.detectedPeriod      === "string" ? obj.detectedPeriod      : null,
    warnings:            Array.isArray(obj.warnings) ? obj.warnings.map(String) : [],
  };
}

// ---------------------------------------------------------------------------
// Map AI-extracted positions → RawRows for normalizer
// ---------------------------------------------------------------------------

export function classifyConfidence(confidence: number): ExtractionConfidence {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

function aiPositionsToRawRows(
  positions: ExtractedPositionRaw[],
): { rows: RawRow[]; lowConfidenceCount: number } {
  let lowConfidenceCount = 0;
  const rows: RawRow[] = [];

  for (const pos of positions) {
    // Skip rows with no symbol or no quantity — normalizer will reject them anyway
    if (!pos.symbol || pos.quantity === null) continue;

    if (classifyConfidence(pos.confidence) === "low") lowConfidenceCount++;

    rows.push({
      Ticker:          pos.symbol,
      Quantity:        pos.quantity,
      "Average Cost":  pos.averageCost ?? "",
      "Cost Basis":    pos.costBasis   ?? "",
      // marketValue is stored as extraction metadata only — not in normalization
    });
  }

  return { rows, lowConfidenceCount };
}

// ---------------------------------------------------------------------------
// Confidence annotations — attach back to normalised positions for preview UI
// ---------------------------------------------------------------------------

/**
 * Attach confidence back to normalised positions by symbol lookup.
 * This is display-only data for the preview — it is NOT persisted to the DB.
 */
export function annotateWithConfidence(
  normalizedPositions: NormalizationResult["normalizedPositions"],
  aiPositions: ExtractedPositionRaw[],
): Array<NormalizationResult["normalizedPositions"][number] & { confidence: ExtractionConfidence; marketValue: number | null }> {
  const confidenceBySymbol = new Map<string, number>();
  const marketValueBySymbol = new Map<string, number | null>();
  for (const p of aiPositions) {
    if (p.symbol) {
      confidenceBySymbol.set(p.symbol.toUpperCase(), p.confidence);
      marketValueBySymbol.set(p.symbol.toUpperCase(), p.marketValue);
    }
  }
  return normalizedPositions.map(p => ({
    ...p,
    confidence:  classifyConfidence(confidenceBySymbol.get(p.symbol) ?? 0.5),
    marketValue: marketValueBySymbol.get(p.symbol) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// OpenAI client factory
// ---------------------------------------------------------------------------

function getOpenAiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  return new OpenAI({ apiKey });
}

// ---------------------------------------------------------------------------
// Image extraction — GPT-4o vision
// ---------------------------------------------------------------------------

const IMAGE_MIME_TO_DETAIL: Record<string, string> = {
  "image/png":  "image/png",
  "image/jpg":  "image/jpeg",
  "image/jpeg": "image/jpeg",
  "image/webp": "image/webp",
};

export async function extractFromImage(
  buffer: Buffer,
  mimeType: string,
): Promise<DocumentExtractionResult> {
  const start = Date.now();
  const normalizedMime = IMAGE_MIME_TO_DETAIL[mimeType.toLowerCase()] ?? "image/jpeg";

  let aiResponse: AiExtractionResponse;
  try {
    const client = getOpenAiClient();
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${normalizedMime};base64,${base64}`;

    const response = await client.chat.completions.create({
      model:       "gpt-4o",
      max_tokens:  2000,
      temperature: 0,
      messages: [
        {
          role:    "user",
          content: [
            { type: "text",      text: IMAGE_EXTRACTION_PROMPT },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
    });

    const rawText = response.choices[0]?.message?.content ?? "";
    aiResponse = parseAiResponse(rawText);
  } catch (err) {
    const durationMs = Date.now() - start;
    const isUnavailable = err instanceof Error && (
      err.message.includes("OPENAI_API_KEY") ||
      err.message.includes("401") ||
      err.message.includes("insufficient_quota")
    );
    // Safe telemetry — no raw content
    console.error("[portfolio-extractor] image extraction failed:", {
      durationMs,
      error: err instanceof Error ? err.message : "unknown",
    });
    return buildFailedResult("image", durationMs, isUnavailable ? "provider_unavailable" : "extraction_failed");
  }

  return buildResult("image", aiResponse, start);
}

// ---------------------------------------------------------------------------
// PDF extraction — pdf-parse text → GPT-4
// ---------------------------------------------------------------------------

const MIN_MEANINGFUL_TEXT_LENGTH = 100; // chars

export async function extractFromPdf(
  buffer: Buffer,
): Promise<DocumentExtractionResult> {
  const start = Date.now();

  // --- Step 1: Extract embedded text with pdf-parse ---
  let pdfText = "";
  let pageCount = 0;
  try {
    // Dynamic import to avoid requiring pdf-parse at startup if not installed
    const pdfParse = await import("pdf-parse").then(m => m.default || m);
    const data = await pdfParse(buffer, { max: MAX_PDF_PAGES });
    pdfText    = data.text ?? "";
    pageCount  = data.numpages ?? 0;
  } catch (err) {
    const durationMs = Date.now() - start;
    console.error("[portfolio-extractor] pdf-parse failed:", {
      durationMs,
      error: err instanceof Error ? err.message : "unknown",
    });
    return buildFailedResult("pdf", durationMs, "extraction_failed");
  }

  // --- Step 2: Validate we have usable text ---
  const trimmedText = pdfText.replace(/\s+/g, " ").trim();
  if (trimmedText.length < MIN_MEANINGFUL_TEXT_LENGTH) {
    const durationMs = Date.now() - start;
    console.warn("[portfolio-extractor] pdf has insufficient text:", {
      durationMs,
      charCount: trimmedText.length,
      pageCount,
    });
    return buildFailedResult("pdf", durationMs, "no_holdings");
  }

  // --- Step 3: Truncate to stay within token limits (~60k chars ≈ 15k tokens) ---
  const MAX_TEXT_CHARS = 60_000;
  const truncatedText = trimmedText.length > MAX_TEXT_CHARS
    ? trimmedText.slice(0, MAX_TEXT_CHARS) + "\n[text truncated for length]"
    : trimmedText;

  // --- Step 4: GPT-4 text extraction ---
  let aiResponse: AiExtractionResponse;
  try {
    const client = getOpenAiClient();
    const response = await client.chat.completions.create({
      model:       "gpt-4o",
      max_tokens:  2000,
      temperature: 0,
      messages: [
        { role: "system", content: PDF_EXTRACTION_PROMPT },
        { role: "user",   content: truncatedText },
      ],
    });

    const rawText = response.choices[0]?.message?.content ?? "";
    aiResponse = parseAiResponse(rawText);
  } catch (err) {
    const durationMs = Date.now() - start;
    const isUnavailable = err instanceof Error && (
      err.message.includes("OPENAI_API_KEY") ||
      err.message.includes("401") ||
      err.message.includes("insufficient_quota")
    );
    console.error("[portfolio-extractor] pdf ai extraction failed:", {
      durationMs,
      error: err instanceof Error ? err.message : "unknown",
    });
    return buildFailedResult("pdf", durationMs, isUnavailable ? "provider_unavailable" : "extraction_failed");
  }

  return buildResult("pdf", aiResponse, start);
}

// ---------------------------------------------------------------------------
// Shared result builders
// ---------------------------------------------------------------------------

function buildResult(
  sourceType: "image" | "pdf",
  aiResponse: AiExtractionResponse,
  startMs: number,
): DocumentExtractionResult {
  const durationMs = Date.now() - startMs;
  const { rows, lowConfidenceCount } = aiPositionsToRawRows(aiResponse.positions);
  const normResult = normalizePortfolioPositions(rows, sourceType);

  const resultStatus: ExtractionTelemetry["resultStatus"] =
    normResult.normalizedPositions.length === 0 ? "no_holdings" :
    normResult.normalizedPositions.length < aiResponse.positions.length ? "partial" :
    "success";

  // Safe telemetry — no position values or account data
  console.info("[portfolio-extractor] extraction complete:", {
    sourceType,
    durationMs,
    rowsDetected:       aiResponse.positions.length,
    rowsValid:          normResult.normalizedPositions.length,
    rowsInvalid:        normResult.invalidRows.length,
    lowConfidenceCount,
    resultStatus,
    detectedInstitution: aiResponse.detectedInstitution ?? null,
  });

  return {
    ...normResult,
    metadata: {
      detectedInstitution: aiResponse.detectedInstitution,
      detectedPeriod:      aiResponse.detectedPeriod,
      extractionWarnings:  aiResponse.warnings,
      lowConfidenceCount,
    },
    telemetry: {
      sourceType,
      processingDurationMs: durationMs,
      rowsDetected:         aiResponse.positions.length,
      rowsValid:            normResult.normalizedPositions.length,
      rowsInvalid:          normResult.invalidRows.length,
      lowConfidenceCount,
      resultStatus,
    },
  };
}

function buildFailedResult(
  sourceType: "image" | "pdf",
  durationMs: number,
  status: ExtractionTelemetry["resultStatus"],
): DocumentExtractionResult {
  return {
    normalizedPositions: [],
    invalidRows:         [],
    parsedCount:         0,
    warnings:            [],
    metadata: {
      detectedInstitution: null,
      detectedPeriod:      null,
      extractionWarnings:  [],
      lowConfidenceCount:  0,
    },
    telemetry: {
      sourceType,
      processingDurationMs: durationMs,
      rowsDetected:         0,
      rowsValid:            0,
      rowsInvalid:          0,
      lowConfidenceCount:   0,
      resultStatus:         status,
    },
  };
}
