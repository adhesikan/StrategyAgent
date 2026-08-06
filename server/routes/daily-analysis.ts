// Daily Analysis endpoints (Phase 29 + Trial Daily Analysis Mode). Every route
// is gated by the central entitlement service (license gate + product flag +
// subscription/trial state). During prelaunch these serve ONLY admins /
// internal testers / allowlisted emails; external users receive the safe
// denial message with no data. Trial-restricted users are limited to the
// approved trial symbol universe, enforced server-side.

import type { Express, RequestHandler } from "express";
import { desc, eq, and, inArray } from "drizzle-orm";
import { db } from "../db";
import { dailyAnalysisSnapshots, dailyIndicators, marketDataSymbols } from "@shared/schema";
import { SAFE_DENIAL_MESSAGE } from "../services/daily-market-data/access-control";
import { getTwelveDataConfig } from "../services/daily-market-data/config";
import {
  getDailyAnalysisEntitlement,
  isTrialRestricted,
  normalizeSymbol,
  getAllowedTrialSymbols,
  TRIAL_SYMBOL_DENIAL_MESSAGE,
  type DailyAnalysisEntitlement,
} from "../services/daily-market-data/trial-entitlement";
import { evaluateDailyConditions } from "../services/daily-market-data/ingestion";
import { getHistoricalBars } from "../services/market-history-service";
import { computeDailyIndicators } from "../services/daily-market-data/indicators";

const DISCLOSURE =
  "Market analysis is based on historical daily data through the previous completed trading session. It does not reflect current intraday prices or market conditions.";

function attribution() {
  const cfg = getTwelveDataConfig();
  return cfg.attributionEnabled
    ? "Data provided by Twelve Data. Technical analysis, scores, rankings, and AI-generated insights are produced by VCP Trader AI."
    : null;
}

/** Data older than this many days (accounting for weekends) is flagged stale. */
function isStale(marketDataAsOf: string | null | undefined): boolean {
  if (!marketDataAsOf) return true;
  const asOf = new Date(`${marketDataAsOf}T00:00:00Z`).getTime();
  if (!Number.isFinite(asOf)) return true;
  return Date.now() - asOf > 5 * 24 * 60 * 60 * 1000;
}

export function registerDailyAnalysisRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  getUser: (req: any) => Promise<{ id?: string; email?: string | null; role?: string | null } | null>,
) {
  const gate: RequestHandler = async (req: any, res, next) => {
    try {
      const user = await getUser(req);
      const ent = await getDailyAnalysisEntitlement(user);
      if (!ent.allowed) {
        return res.status(403).json({ error: SAFE_DENIAL_MESSAGE, code: "DAILY_ANALYSIS_UNAVAILABLE" });
      }
      req.dailyAnalysisEntitlement = ent;
      next();
    } catch {
      res.status(403).json({ error: SAFE_DENIAL_MESSAGE, code: "DAILY_ANALYSIS_UNAVAILABLE" });
    }
  };

  /** Validates :symbol for the caller's entitlement. Returns null after responding on failure. */
  async function checkSymbol(req: any, res: any): Promise<string | null> {
    const sym = normalizeSymbol(String(req.params.symbol || ""));
    if (!sym) {
      res.status(400).json({ error: "Invalid symbol" });
      return null;
    }
    const ent: DailyAnalysisEntitlement = req.dailyAnalysisEntitlement;
    if (isTrialRestricted(ent) && !ent.allowedSymbols.includes(sym)) {
      res.status(403).json({ error: TRIAL_SYMBOL_DENIAL_MESSAGE, code: "SYMBOL_NOT_IN_TRIAL_COVERAGE" });
      return null;
    }
    return sym;
  }

  // Access probe: lets the frontend decide whether to render Daily Analysis
  // sections without leaking license configuration.
  app.get("/api/daily-analysis/access", isAuthenticated, async (req: any, res) => {
    const user = await getUser(req);
    const ent = await getDailyAnalysisEntitlement(user);
    res.json({
      allowed: ent.allowed,
      accessLevel: ent.accessLevel,
      dataMode: ent.dataMode,
      trialRestricted: ent.allowed ? isTrialRestricted(ent) : false,
      limits: ent.allowed ? ent.limits : undefined,
    });
  });

  // Trial Market Coverage: the approved universe, split by asset type.
  app.get("/api/daily-analysis/coverage", isAuthenticated, gate, async (_req: any, res) => {
    const allowed = await getAllowedTrialSymbols();
    const rows = allowed.length
      ? await db
          .select({
            symbol: marketDataSymbols.symbol,
            companyName: marketDataSymbols.companyName,
            assetType: marketDataSymbols.assetType,
            displayOrder: marketDataSymbols.displayOrder,
            latestAvailableTradeDate: marketDataSymbols.latestAvailableTradeDate,
          })
          .from(marketDataSymbols)
          .where(inArray(marketDataSymbols.symbol, allowed))
      : [];
    rows.sort((a, b) => a.displayOrder - b.displayOrder);
    res.json({
      title: "Trial Market Coverage",
      description:
        "Explore historical daily analysis for a curated group of highly liquid U.S. stocks and ETFs.",
      disclosure: DISCLOSURE,
      attribution: attribution(),
      etfs: rows.filter((r) => r.assetType === "etf"),
      stocks: rows.filter((r) => r.assetType !== "etf"),
      deniedSymbolMessage: TRIAL_SYMBOL_DENIAL_MESSAGE,
    });
  });

  app.get("/api/daily-analysis/opportunities", isAuthenticated, gate, async (req: any, res) => {
    const ent: DailyAnalysisEntitlement = req.dailyAnalysisEntitlement;
    const restricted = isTrialRestricted(ent);
    let query = db
      .select()
      .from(dailyAnalysisSnapshots)
      .where(
        restricted && ent.allowedSymbols.length
          ? and(
              eq(dailyAnalysisSnapshots.isCurrent, true),
              inArray(dailyAnalysisSnapshots.symbol, ent.allowedSymbols),
            )
          : eq(dailyAnalysisSnapshots.isCurrent, true),
      )
      .orderBy(desc(dailyAnalysisSnapshots.compositeScore))
      .limit(10);
    const snapshots = await query;
    res.json({
      mode: "Daily Analysis Mode",
      modeLabel: "Historical daily data through the previous completed trading session",
      disclosure: DISCLOSURE,
      attribution: attribution(),
      dataSourceType: "Historical Daily Data",
      opportunities: snapshots.slice(0, 5).map((s) => ({
        ...s,
        stale: isStale(s.marketDataAsOf as any),
        candidateDisclosure: `This candidate was generated using data available through ${s.marketDataAsOf}. Prices and conditions may have changed.`,
      })),
    });
  });

  app.get("/api/daily-analysis/symbol/:symbol", isAuthenticated, gate, async (req: any, res) => {
    const symbol = await checkSymbol(req, res);
    if (!symbol) return;
    const [snapshot] = await db
      .select()
      .from(dailyAnalysisSnapshots)
      .where(and(eq(dailyAnalysisSnapshots.symbol, symbol), eq(dailyAnalysisSnapshots.isCurrent, true)))
      .limit(1);
    if (!snapshot) return res.status(404).json({ error: "No daily analysis available for this symbol yet." });
    const [indicators] = await db
      .select()
      .from(dailyIndicators)
      .where(eq(dailyIndicators.symbol, symbol))
      .orderBy(desc(dailyIndicators.tradeDate))
      .limit(1);
    const { bars } = await getHistoricalBars({ symbol, outputSize: 5, purpose: "user", caller: "daily_analysis_symbol" })
      .catch(() => ({ bars: [] as Awaited<ReturnType<typeof getHistoricalBars>>["bars"] }));
    const latestClose = bars.length ? bars[bars.length - 1].close : null;
    res.json({
      disclosure: DISCLOSURE,
      attribution: attribution(),
      dataSourceType: "Historical Daily Data",
      marketDataThrough: snapshot.marketDataAsOf,
      stale: isStale(snapshot.marketDataAsOf as any),
      latestCompletedSessionClose: latestClose,
      snapshot,
      indicators: indicators ?? null,
      unavailableFactors: [
        { factor: "Realtime", status: "Requires broker connection" },
        { factor: "Current options data", status: "Requires broker connection" },
        { factor: "Account suitability", status: "Requires broker connection and user settings" },
      ],
    });
  });

  app.get("/api/daily-analysis/conditions/:symbol", isAuthenticated, gate, async (req: any, res) => {
    const symbol = await checkSymbol(req, res);
    if (!symbol) return;
    const { bars } = await getHistoricalBars({ symbol, outputSize: 320, purpose: "user", caller: "daily_analysis_conditions" })
      .catch(() => ({ bars: [] as Awaited<ReturnType<typeof getHistoricalBars>>["bars"] }));
    if (bars.length < 30) return res.status(404).json({ error: "Insufficient stored history for this symbol." });
    const ind = computeDailyIndicators(bars);
    if (!ind) return res.status(404).json({ error: "Indicators unavailable." });
    const last = bars[bars.length - 1];
    const { passed, failed } = evaluateDailyConditions(ind, last.close);
    res.json({
      disclosure: DISCLOSURE,
      attribution: attribution(),
      marketDataAsOf: last.tradeDate,
      stale: isStale(last.tradeDate),
      conditionsPassed: passed,
      conditionsFailed: failed,
      indicators: ind,
    });
  });

  app.get("/api/daily-analysis/history/:symbol", isAuthenticated, gate, async (req: any, res) => {
    const symbol = await checkSymbol(req, res);
    if (!symbol) return;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "120"), 10) || 120, 1), 500);
    const { bars } = await getHistoricalBars({ symbol, outputSize: limit, purpose: "user", caller: "daily_analysis_history" })
      .catch(() => ({ bars: [] as Awaited<ReturnType<typeof getHistoricalBars>>["bars"] }));
    res.json({
      disclosure: DISCLOSURE,
      attribution: attribution(),
      marketDataAsOf: bars.length ? bars[bars.length - 1].tradeDate : null,
      stale: isStale(bars.length ? bars[bars.length - 1].tradeDate : null),
      bars,
    });
  });

  app.get("/api/daily-analysis/symbols", isAuthenticated, gate, async (req: any, res) => {
    const ent: DailyAnalysisEntitlement = req.dailyAnalysisEntitlement;
    const rows = await db
      .select({
        symbol: marketDataSymbols.symbol,
        companyName: marketDataSymbols.companyName,
        assetType: marketDataSymbols.assetType,
        latestAvailableTradeDate: marketDataSymbols.latestAvailableTradeDate,
      })
      .from(marketDataSymbols)
      .where(and(eq(marketDataSymbols.enabled, true), eq(marketDataSymbols.internalAnalysisEnabled, true)));
    const filtered = isTrialRestricted(ent)
      ? rows.filter((r) => ent.allowedSymbols.includes(r.symbol.toUpperCase()))
      : rows;
    res.json(filtered);
  });
}
