// GET /api/opportunities/workspace/:symbol — Sprint 2.6.3 v2
//
// Aggregated workspace endpoint for the Opportunity Research Workspace v2 page.
// Returns a consolidated payload covering every research section the client needs.
//
// Performance contract:
//   - All subsystem calls run in parallel via Promise.allSettled
//   - CanonicalOpportunity and changeExplanation come from the in-memory ranking (zero DB cost)
//   - History, institutional, sector, and theme data hit the DB once each
//   - Collections, monitoring, reports, and portfolio context are user-personalized (one query each)
//   - Cold load target: < 400 ms; warm load target: < 100 ms (ranking/institutional in-memory)
//
// Client still uses exactly 2 API calls:
//   Call 1 — GET /api/opportunities/today     → full ranking (in-memory, instant)
//   Call 2 — GET /api/opportunities/workspace/:symbol → this endpoint
//
// Trust rules:
//   - Authenticated; no broker connection required.
//   - Symbol validated before any DB access.
//   - Institutional data: precomputed signal only (no raw SEC payload).
//   - Portfolio/collection/monitoring context: strict userId ownership enforcement.
//   - No stack traces in response.
//   - History capped at 100 rows.
//   - Portfolio context: no raw account balances or position dollar values in response.

import type { Express, RequestHandler, Request } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getSymbolHistory } from "../services/opportunity-snapshot-store";
import { getInstitutionalSignal } from "../services/institutional/signal-engine";
import { getLatestRanking } from "../services/opportunity-ranking-engine";
import { explainSymbolChange, type SymbolHistoryRow } from "../services/opportunity-change-engine";
import { getCanonicalOpportunity } from "../services/opportunity-intelligence-service";
import {
  getLatestSectorDetail,
  getLatestThemeSnapshots,
  type StoredSectorSummary,
  type StoredThemeSummary,
} from "../services/intelligence-snapshot-store";
import { getCollectionsForSymbol } from "../services/collection-service";
import { listWatches } from "../services/research-monitor-service";
import { listReports } from "../services/research-report-service";
import type { CanonicalOpportunity } from "../../shared/opportunity-intelligence-types";
import type { SymbolCollectionMembership } from "../../shared/collection-types";
import type { ResearchWatch } from "../../shared/research-monitor-types";
import type { ResearchReport } from "../../shared/research-report-types";

// ---------------------------------------------------------------------------
// Workspace health metrics (in-memory, no user data)
// ---------------------------------------------------------------------------

interface WorkspaceHealthMetrics {
  workspaceRequests: number;
  workspaceSuccesses: number;
  workspacePartials: number;
  workspaceFailures: number;
  totalDurationMs: number;
  lastSuccessfulWorkspaceAt: string | null;
}

const _healthMetrics: WorkspaceHealthMetrics = {
  workspaceRequests: 0,
  workspaceSuccesses: 0,
  workspacePartials: 0,
  workspaceFailures: 0,
  totalDurationMs: 0,
  lastSuccessfulWorkspaceAt: null,
};

export function getWorkspaceV2Health(): {
  workspaceRequests: number;
  workspaceSuccesses: number;
  workspacePartials: number;
  workspaceFailures: number;
  averageWorkspaceLatencyMs: number | null;
  lastSuccessfulWorkspaceAt: string | null;
} {
  const avg =
    _healthMetrics.workspaceSuccesses > 0
      ? Math.round(_healthMetrics.totalDurationMs / _healthMetrics.workspaceSuccesses)
      : null;
  return {
    workspaceRequests: _healthMetrics.workspaceRequests,
    workspaceSuccesses: _healthMetrics.workspaceSuccesses,
    workspacePartials: _healthMetrics.workspacePartials,
    workspaceFailures: _healthMetrics.workspaceFailures,
    averageWorkspaceLatencyMs: avg,
    lastSuccessfulWorkspaceAt: _healthMetrics.lastSuccessfulWorkspaceAt,
  };
}

// ---------------------------------------------------------------------------
// Types exported for tests and client
// ---------------------------------------------------------------------------

export interface WorkspaceMonitoringState {
  isMonitored: boolean;
  watchId: string | null;
  status: string | null;
  lastChangeAt: string | null;
  lastChangeSummary: string | null;
  recentActivityCount: number;
}

export interface WorkspacePortfolioContext {
  portfolioId: string;
  portfolioName: string;
  symbol: string;
  portfolioWeight: number | null;
  sector: string | null;
  industry: string | null;
  researchChange: string | null;
}

export interface WorkspaceReportSummary {
  reportId: string;
  title: string;
  reportType: string;
  status: string;
  generatedAt: string | null;
  isPinned: boolean;
}

export interface WorkspaceFreshness {
  rankingGeneratedAt: string | null;
  institutionalDataAt: string | null;
  sectorDataAt: string | null;
  historyLatestAt: string | null;
  workspaceAssembledAt: string;
}

export interface WorkspaceV2Response {
  symbol: string;
  companyName: string | null;
  opportunity: CanonicalOpportunity | null;
  history: unknown[];
  institutional: unknown | null;
  changeExplanation: unknown | null;
  sectorContext: StoredSectorSummary | null;
  themeContexts: StoredThemeSummary[];
  collections: SymbolCollectionMembership[];
  monitoring: WorkspaceMonitoringState;
  reports: WorkspaceReportSummary[];
  portfolioContext: WorkspacePortfolioContext | null;
  relatedOpportunities: Array<{ symbol: string; companyName: string | null; score: number; category: string }>;
  freshness: WorkspaceFreshness;
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Shared company name lookup (deliberate duplicate — zero coupling to radar-service)
// ---------------------------------------------------------------------------

const COMPANY_NAMES: Record<string, string> = {
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corporation",
  NVDA: "NVIDIA Corporation",
  AMD: "Advanced Micro Devices",
  TSLA: "Tesla, Inc.",
  META: "Meta Platforms, Inc.",
  AMZN: "Amazon.com, Inc.",
  GOOGL: "Alphabet Inc.",
  MU: "Micron Technology",
  PLTR: "Palantir Technologies",
  SPY: "SPDR S&P 500 ETF",
  QQQ: "Invesco QQQ Trust",
  IWM: "iShares Russell 2000 ETF",
  DIA: "SPDR Dow Jones Industrial",
  INTC: "Intel Corporation",
  BAC: "Bank of America",
  F: "Ford Motor Company",
  AVGO: "Broadcom Inc.",
  GOOG: "Alphabet Inc.",
  NFLX: "Netflix, Inc.",
  CRM: "Salesforce, Inc.",
  ORCL: "Oracle Corporation",
  IBM: "IBM Corporation",
  QCOM: "Qualcomm Incorporated",
  TXN: "Texas Instruments",
  SMCI: "Super Micro Computer",
  ARM: "Arm Holdings",
  SNOW: "Snowflake Inc.",
  PANW: "Palo Alto Networks",
  CRWD: "CrowdStrike Holdings",
  ZS: "Zscaler, Inc.",
  NET: "Cloudflare, Inc.",
  DDOG: "Datadog, Inc.",
  COIN: "Coinbase Global",
  MSTR: "MicroStrategy Inc.",
  CELH: "Celsius Holdings",
  MRVL: "Marvell Technology",
  ON: "ON Semiconductor",
  KLAC: "KLA Corporation",
  AMAT: "Applied Materials",
  LRCX: "Lam Research",
  ASML: "ASML Holding",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeSettle<T>(p: Promise<T>): Promise<T | null> {
  return p.catch(() => null);
}

/** Extract userId from request — works with both session-based and JWT auth */
function getUserId(req: Request): string | null {
  const u = (req as any).user;
  if (!u) return null;
  return u.id ?? u.userId ?? null;
}

/** Find portfolio context for a symbol: the first portfolio owned by userId that holds the symbol */
async function findPortfolioContext(
  userId: string,
  symbol: string,
): Promise<WorkspacePortfolioContext | null> {
  try {
    const rows = await db.execute<{
      portfolio_id: string;
      portfolio_name: string;
      portfolio_weight: number | null;
      sector: string | null;
      industry: string | null;
    }>(sql`
      SELECT
        p.id            AS portfolio_id,
        p.name          AS portfolio_name,
        pp.portfolio_weight AS portfolio_weight,
        pp.sector       AS sector,
        pp.industry     AS industry
      FROM portfolio_positions pp
      JOIN portfolios p ON p.id = pp.portfolio_id
      WHERE p.user_id = ${userId}
        AND pp.symbol  = ${symbol.toUpperCase()}
      ORDER BY p.updated_at DESC
      LIMIT 1
    `);
    if (rows.rows.length === 0) return null;
    const r = rows.rows[0];
    return {
      portfolioId: r.portfolio_id,
      portfolioName: r.portfolio_name,
      symbol: symbol.toUpperCase(),
      portfolioWeight:
        r.portfolio_weight != null ? Math.round(Number(r.portfolio_weight) * 10) / 10 : null,
      sector: r.sector ?? null,
      industry: r.industry ?? null,
      researchChange: null, // deterministic — omitted here for simplicity
    };
  } catch {
    return null;
  }
}

/** Build monitoring state from user's watches list */
function buildMonitoringState(watches: ResearchWatch[], symbol: string): WorkspaceMonitoringState {
  const sym = symbol.toUpperCase();
  const watch = watches.find(
    w => w.entityId?.toUpperCase() === sym && w.status !== "archived",
  );
  if (!watch) {
    return {
      isMonitored: false,
      watchId: null,
      status: null,
      lastChangeAt: null,
      lastChangeSummary: null,
      recentActivityCount: 0,
    };
  }
  return {
    isMonitored: true,
    watchId: watch.id,
    status: watch.status,
    lastChangeAt: watch.lastChangeAt ? new Date(watch.lastChangeAt).toISOString() : null,
    lastChangeSummary: watch.lastChangeSummary ?? null,
    recentActivityCount: 0, // activity count requires separate DB call; deferred
  };
}

/** Summarize reports for workspace display */
function summarizeReports(reports: ResearchReport[]): WorkspaceReportSummary[] {
  return reports.slice(0, 5).map(r => ({
    reportId: r.id,
    title: r.title,
    reportType: r.reportType,
    status: r.status,
    generatedAt: r.generatedAt ? new Date(r.generatedAt).toISOString() : null,
    isPinned: r.isPinned ?? false,
  }));
}

/** Build related opportunities from in-memory ranking (same sector/theme, nearby score) */
function buildRelatedOpportunities(
  symbol: string,
  opportunity: CanonicalOpportunity | null,
  ranking: ReturnType<typeof getLatestRanking>,
): Array<{ symbol: string; companyName: string | null; score: number; category: string }> {
  if (!ranking || !opportunity) return [];

  const allCandidates = [
    ...ranking.topGrowth.map(c => ({ symbol: c.symbol, score: c.opportunityScore.overallScore, category: c.opportunityScore.category })),
    ...ranking.topIncome.map(c => ({ symbol: c.symbol, score: c.opportunityScore.overallScore, category: c.opportunityScore.category })),
    ...ranking.watchlist.map(c => ({ symbol: c.symbol, score: c.opportunityScore.overallScore, category: c.opportunityScore.category })),
  ];

  const myScore = opportunity.researchScore;
  const mySector = opportunity.sector;
  const myThemes = new Set(opportunity.themes);

  const scored = allCandidates
    .filter(c => c.symbol.toUpperCase() !== symbol.toUpperCase())
    .map(c => {
      // Find this candidate's canonical opportunity from ranking
      const allRanked = [
        ...ranking.topGrowth,
        ...ranking.topIncome,
        ...ranking.watchlist,
      ] as Array<{ symbol: string; opportunityScore: { sector?: string | null; themes?: string[]; overallScore: number; category: string } }>;
      const match = allRanked.find(r => r.symbol.toUpperCase() === c.symbol.toUpperCase()) as any;
      const candSector: string | null = match?.sector ?? match?.opportunityScore?.sector ?? null;
      const candThemes: string[] = match?.themes ?? match?.opportunityScore?.themes ?? [];

      let relevance = 0;
      if (mySector && candSector === mySector) relevance += 3;
      if (candThemes.some((t: string) => myThemes.has(t))) relevance += 2;
      const scoreDiff = Math.abs(c.score - myScore);
      if (scoreDiff <= 10) relevance += 2;
      else if (scoreDiff <= 20) relevance += 1;

      return { ...c, relevance, companyName: COMPANY_NAMES[c.symbol] ?? null };
    })
    .filter(c => c.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || b.score - a.score)
    .slice(0, 6)
    .map(({ relevance: _r, ...rest }) => rest);

  return scored;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

const SYMBOL_RE = /^[A-Z]{1,10}$/;

export function registerOpportunityWorkspaceRoute(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  app.get(
    "/api/opportunities/workspace/:symbol",
    isAuthenticated,
    async (req, res) => {
      const raw = String(req.params.symbol ?? "").toUpperCase().trim();
      if (!SYMBOL_RE.test(raw)) {
        return res.status(400).json({ error: "Invalid symbol" });
      }

      _healthMetrics.workspaceRequests++;
      const startMs = Date.now();
      const assembledAt = new Date().toISOString();

      try {
        // ── Phase 1: In-memory ranking (zero DB cost) ─────────────────────
        const ranking = getLatestRanking();

        // ── Phase 2: Parallel subsystem fetches ──────────────────────────
        const userId = getUserId(req) ?? "";

        const [
          historyResult,
          institutionalResult,
          opportunityResult,
          allThemeSnapshotsResult,
          collectionsResult,
          watchesResult,
          reportsResult,
          portfolioContextResult,
        ] = await Promise.allSettled([
          getSymbolHistory(raw, 100),
          getInstitutionalSignal(raw).catch(() => null),
          getCanonicalOpportunity(raw),
          getLatestThemeSnapshots(),
          userId ? getCollectionsForSymbol(userId, raw) : Promise.resolve([] as SymbolCollectionMembership[]),
          userId ? listWatches(userId, false) : Promise.resolve([] as ResearchWatch[]),
          userId ? listReports(userId, { keyword: raw }) : Promise.resolve([] as ResearchReport[]),
          userId ? findPortfolioContext(userId, raw) : Promise.resolve(null),
        ]);

        const history = historyResult.status === "fulfilled" ? historyResult.value : [];
        const institutional = institutionalResult.status === "fulfilled" ? institutionalResult.value : null;
        const opportunity = opportunityResult.status === "fulfilled" ? opportunityResult.value : null;
        const allThemeSnapshots = allThemeSnapshotsResult.status === "fulfilled" ? allThemeSnapshotsResult.value : [];
        const collections = collectionsResult.status === "fulfilled" ? collectionsResult.value : [];
        const watches = watchesResult.status === "fulfilled" ? watchesResult.value : [];
        const allReports = reportsResult.status === "fulfilled" ? reportsResult.value : [];
        const portfolioContext = portfolioContextResult.status === "fulfilled" ? portfolioContextResult.value : null;

        // ── Phase 3: Sector context (depends on opportunity.sector) ───────
        const sectorContext = await safeSettle(
          opportunity?.sector ? getLatestSectorDetail(opportunity.sector) : Promise.resolve(null),
        );

        // ── Phase 4: In-memory derivations ───────────────────────────────

        // Filter theme snapshots to themes this symbol belongs to
        const symbolThemeNames = new Set((opportunity?.themes ?? []).map(t => t.toLowerCase()));
        const themeContexts = allThemeSnapshots.filter(t =>
          symbolThemeNames.has(t.themeName.toLowerCase()),
        );

        // Change explanation from in-memory ranking
        let changeExplanation: unknown = null;
        try {
          if (ranking) {
            const allCandidates = [
              ...ranking.topGrowth.map((c, i) => ({ candidate: c, rank: i + 1 })),
              ...ranking.topIncome.map((c, i) => ({ candidate: c, rank: i + 1 })),
              ...ranking.watchlist.map(c => ({ candidate: c, rank: null })),
              ...ranking.approaching.map(c => ({ candidate: c, rank: null })),
            ];
            const match = allCandidates.find(x => x.candidate.symbol.toUpperCase() === raw);
            if (match) {
              const change = ranking.changes.find(c => c.symbol.toUpperCase() === raw) ?? null;
              const historyRows: SymbolHistoryRow[] = history.slice(0, 2).map((h: any) => ({
                symbol: raw,
                score: h.score,
                rank: h.rank,
                qualificationStatus: h.qualificationStatus,
                lifecycleState: h.lifecycleState,
                strategy: h.strategy,
                marketRegime: h.marketRegime,
                scanTime: h.scanTime,
              }));
              changeExplanation = explainSymbolChange(
                match.candidate as any,
                historyRows,
                change,
                match.rank,
                ranking.regime,
              );
            }
          }
        } catch {
          // Non-fatal
        }

        // Related opportunities
        const relatedOpportunities = buildRelatedOpportunities(raw, opportunity, ranking);

        // Monitoring state
        const monitoring = buildMonitoringState(watches, raw);

        // Reports summary
        const reports = summarizeReports(allReports);

        // Freshness
        const freshness: WorkspaceFreshness = {
          rankingGeneratedAt: ranking?.generatedAt ?? null,
          institutionalDataAt: (institutional as any)?.freshness?.calculatedAt ?? null,
          sectorDataAt: sectorContext?.generatedAt ?? null,
          historyLatestAt: history.length > 0 ? (history[0] as any).scanTime : null,
          workspaceAssembledAt: assembledAt,
        };

        // Limitations
        const limitations: string[] = [];
        if (!opportunity) limitations.push("This symbol is not present in the latest Opportunity Intelligence snapshot.");
        if (!institutional) limitations.push("Institutional evidence is unavailable for this symbol.");
        if (!sectorContext) limitations.push("Sector intelligence data is not yet available.");
        if (themeContexts.length === 0 && (opportunity?.themes ?? []).length > 0)
          limitations.push("Theme intelligence data is not yet available.");
        if (history.length === 0) limitations.push("Research history will appear after multiple ranking cycles.");

        // Detect partial vs full response
        const subsystemsAvailable = [
          opportunity != null,
          institutional != null,
          sectorContext != null,
          themeContexts.length > 0,
          history.length > 0,
        ].filter(Boolean).length;

        const durationMs = Date.now() - startMs;
        _healthMetrics.totalDurationMs += durationMs;

        if (limitations.length === 0) {
          _healthMetrics.workspaceSuccesses++;
          _healthMetrics.lastSuccessfulWorkspaceAt = assembledAt;
        } else {
          _healthMetrics.workspacePartials++;
          if (subsystemsAvailable >= 2) _healthMetrics.lastSuccessfulWorkspaceAt = assembledAt;
        }

        // Structured log
        process.stdout.write(
          JSON.stringify({
            event: limitations.length === 0 ? "opportunity_workspace_completed" : "opportunity_workspace_partial",
            durationMs,
            subsystemsAvailable,
            evidenceCounts: {
              primary: opportunity?.primaryEvidence?.length ?? 0,
              secondary: opportunity?.secondaryEvidence?.length ?? 0,
              riskFactors: opportunity?.riskFactors?.length ?? 0,
              invalidatesThesis: opportunity?.invalidatesThesis?.length ?? 0,
            },
            historyCount: history.length,
            collectionsCount: collections.length,
            themeContextsCount: themeContexts.length,
            limitations: limitations.length,
          }) + "\n",
        );

        const response: WorkspaceV2Response = {
          symbol: raw,
          companyName: opportunity?.companyName ?? COMPANY_NAMES[raw] ?? null,
          opportunity,
          history,
          institutional,
          changeExplanation,
          sectorContext,
          themeContexts,
          collections,
          monitoring,
          reports,
          portfolioContext,
          relatedOpportunities,
          freshness,
          limitations,
        };

        return res.json(response);
      } catch (err: any) {
        _healthMetrics.workspaceFailures++;
        const durationMs = Date.now() - startMs;

        process.stderr.write(
          JSON.stringify({
            event: "opportunity_workspace_failed",
            durationMs,
            error: String(err?.message ?? err).slice(0, 200),
          }) + "\n",
        );
        return res.status(500).json({ error: "Failed to load workspace data" });
      }
    },
  );
}
