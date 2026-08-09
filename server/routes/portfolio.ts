/**
 * Portfolio Routes (Sprint 2.4.0)
 *
 * All routes require authenticated user. User isolation is enforced by
 * injecting req.session.userId into every DB read/write.
 */

import type { Express, RequestHandler } from "express";
import multer from "multer";
import crypto from "crypto";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import {
  portfolios,
  portfolioPositions,
  type Portfolio,
  type PortfolioPosition,
} from "@shared/schema";
import {
  parseCsvBuffer,
  parseXlsxBuffer,
  ALLOWED_CSV_MIMES,
  ALLOWED_XLSX_MIMES,
  MAX_FILE_BYTES,
} from "../services/portfolio-import";
import { normalizePortfolioPositions, type NormalizedPortfolioPosition, type PortfolioSourceType } from "../services/portfolio-normalization";
import {
  extractFromImage,
  extractFromPdf,
  annotateWithConfidence,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_PDF_MIMES,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
} from "../services/portfolio-document-extractor";
import { getReferenceSnapshotsBulk } from "../services/daily-market-data/reference-snapshot";
import { triggerSnapshotAsync } from "../services/portfolio-history-service";

// ---------------------------------------------------------------------------
// Multer instances — memory storage only (no disk writes)
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_FILE_BYTES },
});

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_IMAGE_BYTES },
});

const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_PDF_BYTES },
});

// ---------------------------------------------------------------------------
// Import preview store
// ---------------------------------------------------------------------------

interface PreviewSession {
  userId:       string;
  sourceType:   PortfolioSourceType;
  positions:    NormalizedPortfolioPosition[];
  warnings:     string[];
  invalidCount: number;
  sheetInfo?:   { availableSheets: string[]; selectedSheet: string };
  // Document extraction metadata (image / pdf only) — never persisted to DB
  extractionMetadata?: {
    detectedInstitution?: string | null;
    detectedPeriod?:      string | null;
    extractionWarnings:   string[];
    lowConfidenceCount:   number;
  };
  expiresAt:    number; // ms epoch
}

const _previewStore = new Map<string, PreviewSession>();

function cleanupPreviews() {
  const now = Date.now();
  for (const [k, v] of Array.from(_previewStore)) {
    if (v.expiresAt < now) _previewStore.delete(k);
  }
}

function storePreview(session: PreviewSession): string {
  cleanupPreviews();
  const id = crypto.randomUUID();
  _previewStore.set(id, session);
  return id;
}

function claimPreview(previewId: string, userId: string): PreviewSession | null {
  cleanupPreviews();
  const session = _previewStore.get(previewId);
  if (!session) return null;
  if (session.userId !== userId) return null;
  if (session.expiresAt < Date.now()) { _previewStore.delete(previewId); return null; }
  _previewStore.delete(previewId); // single-use
  return session;
}

const PREVIEW_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// Ownership helpers
// ---------------------------------------------------------------------------

async function getPortfolioForUser(portfolioId: string, userId: string): Promise<Portfolio | null> {
  const rows = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Market value enrichment
// ---------------------------------------------------------------------------

type EnrichedPosition = Omit<PortfolioPosition, "marketValue"> & {
  currentPrice: number | null;
  marketValue:  number | null;
  gainLoss:     number | null;
};

async function enrichPositionsWithMarketData(
  userId: string,
  positions: PortfolioPosition[],
): Promise<EnrichedPosition[]> {
  const symbols = Array.from(new Set(positions.map(p => p.symbol)));
  const priceMap: Record<string, number | null> = {};
  try {
    const bulk = await getReferenceSnapshotsBulk(userId, symbols);
    // getReferenceSnapshotsBulk returns an array of snapshot objects
    if (Array.isArray(bulk)) {
      for (const snap of bulk as Array<{ symbol?: string; lastPrice?: number | null } | null>) {
        if (snap?.symbol) priceMap[snap.symbol] = snap.lastPrice ?? null;
      }
    }
  } catch {
    // graceful degradation — positions returned without price data
  }

  return positions.map(p => {
    const currentPrice = priceMap[p.symbol] ?? null;
    const qty = Number(p.quantity);
    const marketValueCalc = currentPrice != null ? currentPrice * qty : null;
    const cbNum = p.costBasis != null ? Number(p.costBasis) : null;
    const gainLoss = marketValueCalc != null && cbNum != null ? marketValueCalc - cbNum : null;
    return {
      ...p,
      currentPrice,
      marketValue: marketValueCalc,
      gainLoss,
    } as EnrichedPosition;
  });
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerPortfolioRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
) {
  // ── List portfolios ───────────────────────────────────────────────────────

  app.get("/api/portfolio", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const rows = await db
        .select()
        .from(portfolios)
        .where(eq(portfolios.userId, userId))
        .orderBy(portfolios.createdAt);
      res.json(rows);
    } catch (err) {
      console.error("[portfolio] list error:", err);
      res.status(500).json({ error: "Failed to load portfolios" });
    }
  });

  // ── Create portfolio ──────────────────────────────────────────────────────

  app.post("/api/portfolio", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { name, sourceType = "manual", sourceAccountId } = req.body as {
        name?: string;
        sourceType?: string;
        sourceAccountId?: string;
      };
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Portfolio name is required" });
      }
      const allowed: PortfolioSourceType[] = ["manual", "csv", "xlsx", "broker", "image", "pdf"];
      if (!allowed.includes(sourceType as PortfolioSourceType)) {
        return res.status(400).json({ error: "Invalid sourceType" });
      }
      const [created] = await db.insert(portfolios).values({
        userId,
        name:            name.trim(),
        sourceType:      sourceType as PortfolioSourceType,
        sourceAccountId: sourceAccountId ?? null,
      }).returning();
      res.status(201).json(created);
    } catch (err) {
      console.error("[portfolio] create error:", err);
      res.status(500).json({ error: "Failed to create portfolio" });
    }
  });

  // ── Update portfolio ──────────────────────────────────────────────────────

  app.patch("/api/portfolio/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const portfolio = await getPortfolioForUser(req.params.id, userId);
      if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });

      const { name } = req.body as { name?: string };
      if (name !== undefined && !name.trim()) {
        return res.status(400).json({ error: "Portfolio name cannot be empty" });
      }
      const [updated] = await db
        .update(portfolios)
        .set({
          ...(name ? { name: name.trim() } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(portfolios.id, req.params.id), eq(portfolios.userId, userId)))
        .returning();
      res.json(updated);
    } catch (err) {
      console.error("[portfolio] update error:", err);
      res.status(500).json({ error: "Failed to update portfolio" });
    }
  });

  // ── Delete portfolio ──────────────────────────────────────────────────────

  app.delete("/api/portfolio/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const portfolio = await getPortfolioForUser(req.params.id, userId);
      if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });
      // Cascade delete positions first
      await db.delete(portfolioPositions).where(eq(portfolioPositions.portfolioId, req.params.id));
      await db.delete(portfolios).where(and(eq(portfolios.id, req.params.id), eq(portfolios.userId, userId)));
      res.json({ ok: true });
    } catch (err) {
      console.error("[portfolio] delete error:", err);
      res.status(500).json({ error: "Failed to delete portfolio" });
    }
  });

  // ── List positions (enriched with market data) ────────────────────────────

  app.get("/api/portfolio/:id/positions", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const portfolio = await getPortfolioForUser(req.params.id, userId);
      if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });

      const positions = await db
        .select()
        .from(portfolioPositions)
        .where(eq(portfolioPositions.portfolioId, req.params.id))
        .orderBy(portfolioPositions.symbol);

      const enriched = await enrichPositionsWithMarketData(userId, positions);
      res.json({ portfolio, positions: enriched });
    } catch (err) {
      console.error("[portfolio] positions error:", err);
      res.status(500).json({ error: "Failed to load positions" });
    }
  });

  // ── Add position (manual) ─────────────────────────────────────────────────

  app.post("/api/portfolio/:id/positions", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const portfolio = await getPortfolioForUser(req.params.id, userId);
      if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });

      const { symbol, quantity, averageCost } = req.body as {
        symbol?: string;
        quantity?: number;
        averageCost?: number;
      };

      if (!symbol || !symbol.trim()) return res.status(400).json({ error: "Symbol is required" });
      const sym = symbol.trim().toUpperCase();
      if (!/^[A-Z0-9./-]{1,10}$/.test(sym)) return res.status(400).json({ error: "Invalid symbol format" });
      const qty = Number(quantity);
      if (!isFinite(qty) || qty <= 0) return res.status(400).json({ error: "Quantity must be a positive number" });

      let avgCost: number | null = null;
      let costBasis: number | null = null;
      if (averageCost !== undefined) {
        avgCost = Number(averageCost);
        if (!isFinite(avgCost) || avgCost < 0) return res.status(400).json({ error: "Average cost must be a non-negative number" });
        costBasis = avgCost * qty;
      }

      const [created] = await db.insert(portfolioPositions).values({
        portfolioId:  req.params.id,
        symbol:       sym,
        quantity:     String(qty),
        averageCost:  avgCost !== null ? String(avgCost) : null,
        costBasis:    costBasis !== null ? String(costBasis) : null,
        currency:     "USD",
        sourceType:   "manual",
      }).returning();
      // Sprint 2.6.0 — snapshot after position change (fire-and-forget)
      triggerSnapshotAsync(req.params.id, userId, "position_change");
      res.status(201).json(created);
    } catch (err) {
      console.error("[portfolio] add position error:", err);
      res.status(500).json({ error: "Failed to add position" });
    }
  });

  // ── Edit position ─────────────────────────────────────────────────────────

  app.patch("/api/portfolio/:id/positions/:positionId", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const portfolio = await getPortfolioForUser(req.params.id, userId);
      if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });

      const [existing] = await db
        .select()
        .from(portfolioPositions)
        .where(and(
          eq(portfolioPositions.id, req.params.positionId),
          eq(portfolioPositions.portfolioId, req.params.id),
        ))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Position not found" });

      const { quantity, averageCost } = req.body as { quantity?: number; averageCost?: number | null };
      const updates: Partial<typeof portfolioPositions.$inferInsert> = { updatedAt: new Date() };

      if (quantity !== undefined) {
        const qty = Number(quantity);
        if (!isFinite(qty) || qty <= 0) return res.status(400).json({ error: "Quantity must be positive" });
        updates.quantity = String(qty);
      }
      if (averageCost !== undefined) {
        if (averageCost === null) {
          updates.averageCost = null;
          updates.costBasis   = null;
        } else {
          const ac = Number(averageCost);
          if (!isFinite(ac) || ac < 0) return res.status(400).json({ error: "Average cost must be non-negative" });
          updates.averageCost = String(ac);
          const qty = updates.quantity ? Number(updates.quantity) : Number(existing.quantity);
          updates.costBasis   = String(ac * qty);
        }
      }

      const [updated] = await db
        .update(portfolioPositions)
        .set(updates)
        .where(and(
          eq(portfolioPositions.id, req.params.positionId),
          eq(portfolioPositions.portfolioId, req.params.id),
        ))
        .returning();
      // Sprint 2.6.0 — snapshot after position change (fire-and-forget)
      triggerSnapshotAsync(req.params.id, userId, "position_change");
      res.json(updated);
    } catch (err) {
      console.error("[portfolio] edit position error:", err);
      res.status(500).json({ error: "Failed to update position" });
    }
  });

  // ── Delete position ───────────────────────────────────────────────────────

  app.delete("/api/portfolio/:id/positions/:positionId", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const portfolio = await getPortfolioForUser(req.params.id, userId);
      if (!portfolio) return res.status(404).json({ error: "Portfolio not found" });

      const deleted = await db
        .delete(portfolioPositions)
        .where(and(
          eq(portfolioPositions.id, req.params.positionId),
          eq(portfolioPositions.portfolioId, req.params.id),
        ))
        .returning();
      if (!deleted.length) return res.status(404).json({ error: "Position not found" });
      // Sprint 2.6.0 — snapshot after position removed (fire-and-forget)
      triggerSnapshotAsync(req.params.id, userId, "position_change");
      res.json({ ok: true });
    } catch (err) {
      console.error("[portfolio] delete position error:", err);
      res.status(500).json({ error: "Failed to delete position" });
    }
  });

  // ── CSV import (preview only) ─────────────────────────────────────────────

  app.post(
    "/api/portfolio/import/csv",
    isAuthenticated,
    upload.single("file"),
    async (req, res) => {
      try {
        const userId = req.session.userId!;
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        if (req.file.size === 0) return res.status(400).json({ error: "Uploaded file is empty" });

        const mime = req.file.mimetype.toLowerCase();
        if (!ALLOWED_CSV_MIMES.has(mime) && !mime.includes("csv")) {
          return res.status(400).json({ error: "File must be a CSV (text/csv)" });
        }

        let parsed: ReturnType<typeof parseCsvBuffer>;
        try {
          parsed = parseCsvBuffer(req.file.buffer);
        } catch (e: unknown) {
          return res.status(400).json({ error: `CSV parse error: ${e instanceof Error ? e.message : String(e)}` });
        }

        const result = normalizePortfolioPositions(parsed.rows, "csv");
        const previewId = storePreview({
          userId,
          sourceType:   "csv",
          positions:    result.normalizedPositions,
          warnings:     result.warnings,
          invalidCount: result.invalidRows.length,
          expiresAt:    Date.now() + PREVIEW_TTL_MS,
        });

        res.json({
          previewId,
          parsedRows:          result.parsedCount,
          validRows:           result.normalizedPositions.length,
          invalidRows:         result.invalidRows,
          warnings:            result.warnings,
          normalizedPositions: result.normalizedPositions,
          expiresInSeconds:    PREVIEW_TTL_MS / 1000,
        });
      } catch (err) {
        console.error("[portfolio] csv import error:", err);
        res.status(500).json({ error: "CSV import failed" });
      }
    },
  );

  // ── XLSX import (preview only) ────────────────────────────────────────────

  app.post(
    "/api/portfolio/import/xlsx",
    isAuthenticated,
    upload.single("file"),
    async (req, res) => {
      try {
        const userId = req.session.userId!;
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        if (req.file.size === 0) return res.status(400).json({ error: "Uploaded file is empty" });

        const mime = req.file.mimetype.toLowerCase();
        if (!ALLOWED_XLSX_MIMES.has(mime) && !mime.includes("spreadsheet") && !mime.includes("excel") && !mime.includes("xlsx")) {
          return res.status(400).json({ error: "File must be an Excel spreadsheet (.xlsx or .xls)" });
        }

        const sheetIndex = Number(req.body.sheetIndex ?? 0);

        let parsed: ReturnType<typeof parseXlsxBuffer>;
        try {
          parsed = parseXlsxBuffer(req.file.buffer, sheetIndex);
        } catch (e: unknown) {
          return res.status(400).json({ error: `XLSX parse error: ${e instanceof Error ? e.message : String(e)}` });
        }

        const result = normalizePortfolioPositions(parsed.rows, "xlsx");
        const previewId = storePreview({
          userId,
          sourceType:   "xlsx",
          positions:    result.normalizedPositions,
          warnings:     result.warnings,
          invalidCount: result.invalidRows.length,
          sheetInfo:    parsed.sheetInfo,
          expiresAt:    Date.now() + PREVIEW_TTL_MS,
        });

        res.json({
          previewId,
          parsedRows:          result.parsedCount,
          validRows:           result.normalizedPositions.length,
          invalidRows:         result.invalidRows,
          warnings:            result.warnings,
          normalizedPositions: result.normalizedPositions,
          sheetInfo:           parsed.sheetInfo,
          expiresInSeconds:    PREVIEW_TTL_MS / 1000,
        });
      } catch (err) {
        console.error("[portfolio] xlsx import error:", err);
        res.status(500).json({ error: "XLSX import failed" });
      }
    },
  );

  // ── Image import (preview only) ───────────────────────────────────────────
  //
  // POST /api/portfolio/import/image
  // Accepts: PNG, JPG, JPEG, WEBP — max 10 MB
  // Processing: GPT-4o vision → structured JSON → normalizePortfolioPositions()
  // Privacy: file buffer processed in memory only, never written to disk or logged.

  app.post(
    "/api/portfolio/import/image",
    isAuthenticated,
    uploadImage.single("file"),
    async (req, res) => {
      const start = Date.now();
      try {
        const userId = req.session.userId!;
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        if (req.file.size === 0) return res.status(400).json({ error: "Uploaded file is empty" });

        const mime = req.file.mimetype.toLowerCase();
        if (!ALLOWED_IMAGE_MIMES.has(mime)) {
          return res.status(400).json({
            error: "File must be an image (PNG, JPG, JPEG, or WEBP)",
          });
        }

        // Extract holdings via GPT-4o vision — AI transforms unstructured image into candidate rows
        let result: Awaited<ReturnType<typeof extractFromImage>>;
        try {
          result = await extractFromImage(req.file.buffer, mime);
        } catch (e) {
          return res.status(502).json({ error: "Image extraction service unavailable. Please try again." });
        }

        // Discard buffer reference — it is not needed after extraction
        req.file.buffer = Buffer.alloc(0);

        if (result.telemetry.resultStatus === "provider_unavailable") {
          return res.status(503).json({ error: "AI extraction service is currently unavailable. Please try again later." });
        }

        if (result.telemetry.resultStatus === "no_holdings" || result.normalizedPositions.length === 0) {
          return res.status(422).json({
            error:    "No holdings detected in the screenshot.",
            warnings: result.warnings,
            metadata: result.metadata,
            telemetry: { durationMs: Date.now() - start },
          });
        }

        // Annotate positions with confidence for preview UI (not persisted)
        const annotatedPositions = annotateWithConfidence(result.normalizedPositions, []);

        const previewId = storePreview({
          userId,
          sourceType:          "image",
          positions:           result.normalizedPositions,
          warnings:            result.warnings,
          invalidCount:        result.invalidRows.length,
          extractionMetadata:  result.metadata,
          expiresAt:           Date.now() + PREVIEW_TTL_MS,
        });

        res.json({
          previewId,
          parsedRows:          result.parsedCount,
          validRows:           result.normalizedPositions.length,
          invalidRows:         result.invalidRows,
          warnings:            result.warnings,
          normalizedPositions: annotatedPositions,
          metadata:            result.metadata,
          telemetry:           result.telemetry,
          expiresInSeconds:    PREVIEW_TTL_MS / 1000,
        });
      } catch (err) {
        console.error("[portfolio] image import error:", { durationMs: Date.now() - start, error: err instanceof Error ? err.message : "unknown" });
        res.status(500).json({ error: "Image import failed" });
      }
    },
  );

  // ── PDF import (preview only) ─────────────────────────────────────────────
  //
  // POST /api/portfolio/import/pdf
  // Accepts: application/pdf — max 15 MB, max 50 pages
  // Processing: pdf-parse text extraction → GPT-4 → normalizePortfolioPositions()
  // Privacy: file buffer processed in memory only, never written to disk or logged.

  app.post(
    "/api/portfolio/import/pdf",
    isAuthenticated,
    uploadPdf.single("file"),
    async (req, res) => {
      const start = Date.now();
      try {
        const userId = req.session.userId!;
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        if (req.file.size === 0) return res.status(400).json({ error: "Uploaded file is empty" });

        const mime = req.file.mimetype.toLowerCase();
        if (!ALLOWED_PDF_MIMES.has(mime) && mime !== "application/pdf") {
          return res.status(400).json({ error: "File must be a PDF (application/pdf)" });
        }

        // Quick page count check before expensive extraction
        // pdf-parse will also enforce MAX_PDF_PAGES but we can pre-check file header
        // Note: proper page count enforcement happens inside extractFromPdf via pdf-parse max option.

        let result: Awaited<ReturnType<typeof extractFromPdf>>;
        try {
          result = await extractFromPdf(req.file.buffer);
        } catch (e) {
          return res.status(502).json({ error: "PDF extraction service unavailable. Please try again." });
        }

        // Discard buffer reference — not needed after extraction
        req.file.buffer = Buffer.alloc(0);

        if (result.telemetry.resultStatus === "provider_unavailable") {
          return res.status(503).json({ error: "AI extraction service is currently unavailable. Please try again later." });
        }

        if (result.telemetry.resultStatus === "extraction_failed") {
          return res.status(422).json({
            error:    "Could not parse this PDF. The file may be corrupted or use an unsupported format.",
            warnings: result.warnings,
            metadata: result.metadata,
          });
        }

        if (result.telemetry.resultStatus === "no_holdings" || result.normalizedPositions.length === 0) {
          return res.status(422).json({
            error:    "No holdings detected in the PDF. The document may not contain a readable holdings table, or it may be a scanned PDF without embedded text.",
            warnings: result.warnings,
            metadata: result.metadata,
          });
        }

        const annotatedPositions = annotateWithConfidence(result.normalizedPositions, []);

        const previewId = storePreview({
          userId,
          sourceType:          "pdf",
          positions:           result.normalizedPositions,
          warnings:            result.warnings,
          invalidCount:        result.invalidRows.length,
          extractionMetadata:  result.metadata,
          expiresAt:           Date.now() + PREVIEW_TTL_MS,
        });

        res.json({
          previewId,
          parsedRows:          result.parsedCount,
          validRows:           result.normalizedPositions.length,
          invalidRows:         result.invalidRows,
          warnings:            result.warnings,
          normalizedPositions: annotatedPositions,
          metadata:            result.metadata,
          telemetry:           result.telemetry,
          expiresInSeconds:    PREVIEW_TTL_MS / 1000,
        });
      } catch (err) {
        console.error("[portfolio] pdf import error:", { durationMs: Date.now() - start, error: err instanceof Error ? err.message : "unknown" });
        res.status(500).json({ error: "PDF import failed" });
      }
    },
  );

  // ── Confirm import ────────────────────────────────────────────────────────

  app.post("/api/portfolio/import/confirm", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { previewId, portfolioName, portfolioId, editedPositions } = req.body as {
        previewId:        string;
        portfolioName?:   string;
        portfolioId?:     string;
        editedPositions?: Array<{ symbol: string; quantity: number; averageCost?: number | null }>;
      };

      if (!previewId) return res.status(400).json({ error: "previewId is required" });

      const session = claimPreview(previewId, userId);
      if (!session) {
        return res.status(400).json({ error: "Preview not found, expired, or belongs to a different user" });
      }

      // Allow client to submit edited positions (user may have removed/edited rows)
      const positionsToCommit: NormalizedPortfolioPosition[] = editedPositions
        ? normalizePortfolioPositions(
            editedPositions.map(p => ({
              Ticker:         p.symbol,
              Quantity:       p.quantity,
              "Average Cost": p.averageCost ?? "",
            })),
            session.sourceType,
          ).normalizedPositions
        : session.positions;

      if (positionsToCommit.length === 0) {
        return res.status(400).json({ error: "No valid positions to import" });
      }

      // Resolve target portfolio
      let targetPortfolio: Portfolio;
      if (portfolioId) {
        const existing = await getPortfolioForUser(portfolioId, userId);
        if (!existing) return res.status(404).json({ error: "Portfolio not found" });
        targetPortfolio = existing;
        // Replace all positions in the existing portfolio
        await db.delete(portfolioPositions).where(eq(portfolioPositions.portfolioId, portfolioId));
      } else {
        const name = portfolioName?.trim() || `Imported Portfolio ${new Date().toLocaleDateString()}`;
        const [created] = await db.insert(portfolios).values({
          userId,
          name,
          sourceType: session.sourceType,
        }).returning();
        targetPortfolio = created;
      }

      // Bulk insert positions
      const rows = positionsToCommit.map(p => ({
        portfolioId:  targetPortfolio.id,
        symbol:       p.symbol,
        quantity:     String(p.quantity),
        averageCost:  p.averageCost !== null ? String(p.averageCost) : null,
        costBasis:    p.costBasis   !== null ? String(p.costBasis)   : null,
        currency:     p.currency,
        sourceType:   session.sourceType,
      }));

      await db.insert(portfolioPositions).values(rows);

      // Sprint 2.6.0 — trigger portfolio history snapshot (fire-and-forget)
      triggerSnapshotAsync(targetPortfolio.id, userId, `${session.sourceType}_import` as any);

      res.status(201).json({
        ok:             true,
        portfolioId:    targetPortfolio.id,
        portfolioName:  targetPortfolio.name,
        importedCount:  positionsToCommit.length,
      });
    } catch (err) {
      console.error("[portfolio] confirm error:", err);
      res.status(500).json({ error: "Import confirmation failed" });
    }
  });
}
