// Admin Market Data endpoints (Phase 27/29). Admin-only. External display can
// NEVER be enabled from these endpoints — it requires deployment env config
// (TWELVE_DATA_LICENSE_MODE=external + TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED=true).

import type { Express, RequestHandler } from "express";
import { desc, eq, asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  marketDataSymbols,
  marketDataIngestionRuns,
  marketDataIngestionItems,
  marketDataLicenseConfig,
  marketDailyBars,
  insertMarketDataSymbolSchema,
} from "@shared/schema";
import { getTwelveDataConfig } from "../services/daily-market-data/config";
import { invalidateTrialSymbolCache } from "../services/daily-market-data/trial-entitlement";
import { storage } from "../storage";
import { twelveDataProvider } from "../services/daily-market-data/twelve-data-client";
import { getCreditUsageSummary } from "../services/daily-market-data/credit-manager";
import {
  runIngestion,
  seedSymbolUniverseIfEmpty,
  ensureLicenseConfigRow,
  setIngestionPaused,
  isIngestionPaused,
} from "../services/daily-market-data/ingestion";

const READINESS_CHECKLIST = [
  "Twelve Data Venture plan active",
  "Written external-display approval retained",
  "Plan name updated in license configuration",
  "License mode updated to external (deployment env var)",
  "TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED=true set in deployment",
  "Attribution reviewed",
  "Exchange-specific attribution reviewed",
  "External endpoints tested",
  "Trial user access tested",
  "Paid user access tested",
  "Unauthorized user denial tested",
  "Data-date disclosures present",
  "Current-price terminology removed",
  "Broker refresh before order review verified",
  "Privacy policy updated if needed",
  "Terms and disclosures updated",
  "Production monitoring enabled",
];

export function registerMarketDataAdminRoutes(app: Express, isAdmin: RequestHandler) {
  app.get("/api/admin/market-data/status", isAdmin, async (_req, res) => {
    try {
      const cfg = getTwelveDataConfig();
      await ensureLicenseConfigRow();
      const [license] = await db
        .select()
        .from(marketDataLicenseConfig)
        .where(eq(marketDataLicenseConfig.provider, "twelve_data"));
      const credits = await getCreditUsageSummary();
      const symbols = await db.select().from(marketDataSymbols).orderBy(asc(marketDataSymbols.displayOrder));
      const [lastRun] = await db
        .select()
        .from(marketDataIngestionRuns)
        .orderBy(desc(marketDataIngestionRuns.createdAt))
        .limit(1);
      const [lastBackfill] = await db
        .select()
        .from(marketDataIngestionRuns)
        .where(eq(marketDataIngestionRuns.runType, "backfill"))
        .orderBy(desc(marketDataIngestionRuns.createdAt))
        .limit(1);
      res.json({
        provider: "twelve_data",
        planName: license?.planName ?? "basic",
        licenseMode: cfg.licenseMode,
        externalDisplayEnabled: cfg.externalDisplayEnabled,
        apiKeyConfigured: !!cfg.apiKey,
        enabled: cfg.enabled,
        attributionEnabled: cfg.attributionEnabled,
        environment: cfg.environment,
        ingestionPaused: isIngestionPaused(),
        credits,
        lastRun: lastRun ?? null,
        lastBackfill: lastBackfill ?? null,
        symbols: symbols.map((s) => ({
          id: s.id,
          symbol: s.symbol,
          companyName: s.companyName,
          assetType: s.assetType,
          enabled: s.enabled,
          internalAnalysisEnabled: s.internalAnalysisEnabled,
          futureTrialEnabled: s.futureTrialEnabled,
          trialEnabled: s.trialEnabled,
          backfillYears: s.backfillYears,
          latestAvailableTradeDate: s.latestAvailableTradeDate,
          lastSuccessfulIngestionAt: s.lastSuccessfulIngestionAt,
        })),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to load status" });
    }
  });

  app.post("/api/admin/market-data/test", isAdmin, async (_req, res) => {
    const result = await twelveDataProvider.healthCheck();
    res.json(result);
  });

  app.post("/api/admin/market-data/seed", isAdmin, async (_req, res) => {
    const seeded = await seedSymbolUniverseIfEmpty();
    await ensureLicenseConfigRow();
    res.json({ seeded });
  });

  app.post("/api/admin/market-data/refresh/:symbol", isAdmin, async (req: any, res) => {
    const symbol = String(req.params.symbol || "").toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return res.status(400).json({ error: "Invalid symbol" });
    const result = await runIngestion({ runType: "manual", symbols: [symbol], initiatedBy: req.session?.userId });
    res.json(result);
  });

  app.post("/api/admin/market-data/backfill", isAdmin, async (req: any, res) => {
    const symbols = Array.isArray(req.body?.symbols) ? req.body.symbols.map(String) : undefined;
    const result = await runIngestion({ runType: "backfill", symbols, initiatedBy: req.session?.userId });
    res.json(result);
  });

  app.post("/api/admin/market-data/ingest-daily", isAdmin, async (req: any, res) => {
    const result = await runIngestion({ runType: "daily", initiatedBy: req.session?.userId });
    res.json(result);
  });

  app.post("/api/admin/market-data/pause", isAdmin, async (req, res) => {
    setIngestionPaused(req.body?.paused !== false);
    res.json({ paused: isIngestionPaused() });
  });

  app.get("/api/admin/market-data/runs", isAdmin, async (_req, res) => {
    const runs = await db
      .select()
      .from(marketDataIngestionRuns)
      .orderBy(desc(marketDataIngestionRuns.createdAt))
      .limit(50);
    res.json(runs);
  });

  app.get("/api/admin/market-data/runs/:id", isAdmin, async (req, res) => {
    const [run] = await db
      .select()
      .from(marketDataIngestionRuns)
      .where(eq(marketDataIngestionRuns.id, String(req.params.id)));
    if (!run) return res.status(404).json({ error: "Run not found" });
    const items = await db
      .select()
      .from(marketDataIngestionItems)
      .where(eq(marketDataIngestionItems.ingestionRunId, run.id));
    res.json({ run, items });
  });

  app.get("/api/admin/market-data/symbols", isAdmin, async (_req, res) => {
    const rows = await db.select().from(marketDataSymbols).orderBy(asc(marketDataSymbols.displayOrder));
    res.json(rows);
  });

  app.post("/api/admin/market-data/symbols", isAdmin, async (req, res) => {
    try {
      const data = insertMarketDataSymbolSchema.parse({
        ...req.body,
        symbol: String(req.body?.symbol || "").toUpperCase(),
      });
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(data.symbol)) return res.status(400).json({ error: "Invalid symbol" });
      const [row] = await db.insert(marketDataSymbols).values(data).returning();
      invalidateTrialSymbolCache();
      try {
        await storage.createActivityLog({
          userId: (req as any).session?.userId ?? "system",
          eventType: "trial_market_coverage_change",
          description: `Admin added market-data symbol ${row.symbol}`,
          metadataJson: { action: "add", symbol: row.symbol, trialEnabled: row.trialEnabled },
        });
      } catch {}
      res.status(201).json(row);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: e.errors });
      res.status(500).json({ error: e?.message || "Failed to add symbol" });
    }
  });

  app.patch("/api/admin/market-data/symbols/:id", isAdmin, async (req, res) => {
    try {
      const patch = insertMarketDataSymbolSchema.partial().parse(req.body);
      const [row] = await db
        .update(marketDataSymbols)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(marketDataSymbols.id, String(req.params.id)))
        .returning();
      if (!row) return res.status(404).json({ error: "Symbol not found" });
      invalidateTrialSymbolCache();
      try {
        await storage.createActivityLog({
          userId: (req as any).session?.userId ?? "system",
          eventType: "trial_market_coverage_change",
          description: `Admin updated market-data symbol ${row.symbol}`,
          metadataJson: { action: "update", symbol: row.symbol, patch },
        });
      } catch {}
      res.json(row);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: e.errors });
      res.status(500).json({ error: e?.message || "Failed to update symbol" });
    }
  });

  app.get("/api/admin/market-data/license", isAdmin, async (_req, res) => {
    await ensureLicenseConfigRow();
    const [license] = await db
      .select()
      .from(marketDataLicenseConfig)
      .where(eq(marketDataLicenseConfig.provider, "twelve_data"));
    const cfg = getTwelveDataConfig();
    res.json({
      license,
      effectiveLicenseMode: cfg.licenseMode,
      effectiveExternalDisplayEnabled: cfg.externalDisplayEnabled,
      note: "Environment variables are the final safety control. Database values cannot override restrictive env settings. External display requires deployment configuration.",
      readinessChecklist: READINESS_CHECKLIST,
    });
  });

  app.patch("/api/admin/market-data/license", isAdmin, async (req: any, res) => {
    // Only descriptive fields may be updated. licenseMode / externalDisplayEnabled
    // in the DB are records only — env vars remain authoritative.
    const schema = z.object({
      planName: z.string().min(1).optional(),
      licenseMode: z.enum(["disabled", "prelaunch", "external"]).optional(),
      externalDisplayEnabled: z.boolean().optional(),
      confirmationReference: z.string().optional(),
      notes: z.string().optional(),
    });
    try {
      const patch = schema.parse(req.body);
      await ensureLicenseConfigRow();
      const [row] = await db
        .update(marketDataLicenseConfig)
        .set({ ...patch, updatedBy: req.session?.userId ?? null, updatedAt: new Date() })
        .where(eq(marketDataLicenseConfig.provider, "twelve_data"))
        .returning();
      res.json({
        license: row,
        warning:
          "Database record updated. Effective behavior is still controlled by TWELVE_DATA_LICENSE_MODE and TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED environment variables.",
      });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: e.errors });
      res.status(500).json({ error: e?.message || "Failed to update license record" });
    }
  });

  app.get("/api/admin/market-data/bars/:symbol", isAdmin, async (req, res) => {
    const symbol = String(req.params.symbol || "").toUpperCase();
    const rows = await db
      .select()
      .from(marketDailyBars)
      .where(eq(marketDailyBars.symbol, symbol))
      .orderBy(desc(marketDailyBars.tradeDate))
      .limit(30);
    res.json(rows);
  });
}
