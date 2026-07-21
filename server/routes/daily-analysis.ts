// Daily Analysis endpoints (Phase 29). Every route is gated by the central
// Twelve Data access-control service. During prelaunch these serve ONLY
// admins / internal testers / allowlisted emails; external users receive the
// safe denial message with no data.

import type { Express, RequestHandler } from "express";
import { desc, eq, and } from "drizzle-orm";
import { db } from "../db";
import { dailyAnalysisSnapshots, dailyIndicators, marketDataSymbols } from "@shared/schema";
import {
  canAccessTwelveDataBackedAnalysis,
  SAFE_DENIAL_MESSAGE,
} from "../services/daily-market-data/access-control";
import { getTwelveDataConfig } from "../services/daily-market-data/config";
import { evaluateDailyConditions, loadStoredBars } from "../services/daily-market-data/ingestion";
import { computeDailyIndicators } from "../services/daily-market-data/indicators";

const DISCLOSURE =
  "Market analysis is based on historical daily data through the previous completed trading session. It does not reflect current intraday prices or market conditions.";

function attribution() {
  const cfg = getTwelveDataConfig();
  return cfg.attributionEnabled
    ? "Historical daily market data provided by Twelve Data. Technical analysis, scores, rankings, and AI-generated insights are produced by VCP Trader AI."
    : null;
}

export function registerDailyAnalysisRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  getUser: (req: any) => Promise<{ id?: string; email?: string | null; role?: string | null } | null>,
) {
  const gate: RequestHandler = async (req: any, res, next) => {
    try {
      const user = await getUser(req);
      const decision = canAccessTwelveDataBackedAnalysis({ user });
      if (!decision.allowed) {
        return res.status(403).json({ error: SAFE_DENIAL_MESSAGE, code: "DAILY_ANALYSIS_UNAVAILABLE" });
      }
      req.dailyAnalysisScope = decision.scope;
      next();
    } catch {
      res.status(403).json({ error: SAFE_DENIAL_MESSAGE, code: "DAILY_ANALYSIS_UNAVAILABLE" });
    }
  };

  // Access probe: lets the frontend decide whether to render Daily Analysis
  // sections without leaking license configuration.
  app.get("/api/daily-analysis/access", isAuthenticated, async (req: any, res) => {
    const user = await getUser(req);
    const decision = canAccessTwelveDataBackedAnalysis({ user });
    res.json({ allowed: decision.allowed });
  });

  app.get("/api/daily-analysis/opportunities", isAuthenticated, gate, async (_req, res) => {
    const snapshots = await db
      .select()
      .from(dailyAnalysisSnapshots)
      .where(eq(dailyAnalysisSnapshots.isCurrent, true))
      .orderBy(desc(dailyAnalysisSnapshots.compositeScore))
      .limit(10);
    res.json({
      disclosure: DISCLOSURE,
      attribution: attribution(),
      dataSourceType: "Historical Daily Data",
      opportunities: snapshots.slice(0, 5).map((s) => ({
        ...s,
        candidateDisclosure: `This candidate was generated using data available through ${s.marketDataAsOf}. Prices and conditions may have changed.`,
      })),
    });
  });

  app.get("/api/daily-analysis/symbol/:symbol", isAuthenticated, gate, async (req, res) => {
    const symbol = String(req.params.symbol || "").toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return res.status(400).json({ error: "Invalid symbol" });
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
    const bars = await loadStoredBars(symbol, 5);
    const latestClose = bars.length ? bars[bars.length - 1].close : null;
    res.json({
      disclosure: DISCLOSURE,
      attribution: attribution(),
      dataSourceType: "Historical Daily Data",
      marketDataThrough: snapshot.marketDataAsOf,
      latestCompletedSessionClose: latestClose,
      snapshot,
      indicators: indicators ?? null,
      unavailableFactors: [
        { factor: "Realtime", status: "Unavailable in Daily Analysis Mode" },
        { factor: "Options Data", status: "Requires broker connection" },
      ],
    });
  });

  app.get("/api/daily-analysis/conditions/:symbol", isAuthenticated, gate, async (req, res) => {
    const symbol = String(req.params.symbol || "").toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return res.status(400).json({ error: "Invalid symbol" });
    const bars = await loadStoredBars(symbol, 320);
    if (bars.length < 30) return res.status(404).json({ error: "Insufficient stored history for this symbol." });
    const ind = computeDailyIndicators(bars);
    if (!ind) return res.status(404).json({ error: "Indicators unavailable." });
    const last = bars[bars.length - 1];
    const { passed, failed } = evaluateDailyConditions(ind, last.close);
    res.json({
      disclosure: DISCLOSURE,
      attribution: attribution(),
      marketDataAsOf: last.tradeDate,
      conditionsPassed: passed,
      conditionsFailed: failed,
      indicators: ind,
    });
  });

  app.get("/api/daily-analysis/history/:symbol", isAuthenticated, gate, async (req, res) => {
    const symbol = String(req.params.symbol || "").toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return res.status(400).json({ error: "Invalid symbol" });
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "120"), 10) || 120, 1), 500);
    const bars = await loadStoredBars(symbol, limit);
    res.json({
      disclosure: DISCLOSURE,
      attribution: attribution(),
      marketDataAsOf: bars.length ? bars[bars.length - 1].tradeDate : null,
      bars,
    });
  });

  app.get("/api/daily-analysis/symbols", isAuthenticated, gate, async (_req, res) => {
    const rows = await db
      .select({
        symbol: marketDataSymbols.symbol,
        companyName: marketDataSymbols.companyName,
        latestAvailableTradeDate: marketDataSymbols.latestAvailableTradeDate,
      })
      .from(marketDataSymbols)
      .where(and(eq(marketDataSymbols.enabled, true), eq(marketDataSymbols.internalAnalysisEnabled, true)));
    res.json(rows);
  });
}
