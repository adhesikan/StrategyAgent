// Platform Health Routes — Sprint 2.3.6
//
// GET  /api/admin/platform-health        — comprehensive system health (admin only)
// POST /api/admin/symbols/enrich         — trigger symbol sector enrichment (admin only)
//
// Health checks are cached for 30 seconds to avoid hammering external services
// on every page refresh.
//
// SECURITY: never exposes secrets, tokens, API keys, or connection strings.

import type { Express, Request, Response, RequestHandler } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getTwelveDataConfig } from "../services/daily-market-data/config";
import { getLatestRanking } from "../services/opportunity-ranking-engine";
import { getAllJobStatuses } from "../services/job-status-store";
import { getBrokerSyncHealth } from "../services/broker-sync-service";
import { getOpportunityIntelligenceHealth } from "../services/opportunity-intelligence-service";
import { getCollectionHealth } from "../services/collection-service";
import { getWorkspaceHealth } from "../services/research-workspace-service";
import { getCommandCenterHealth } from "./market-research-command-center";
import { enrichMissingSymbolClassifications } from "../services/daily-market-data/symbol-enrichment";
import { getResearchMonitoringHealth } from "../services/research-monitor-service";
import { getResearchReportsHealth } from "../services/research-report-service";
import { getPortfolioHistoryHealth } from "../services/portfolio-history-service";
import { getPortfolioIntelligenceHealth } from "../services/portfolio-intelligence-service";
import { getPortfolioAnalyticsHealth } from "../services/portfolio-analytics-service";
import { getWorkspaceV2Health } from "./opportunity-workspace";
import { type FreshnessResult } from "../lib/health-freshness";
import {
  computeOperationsSummary,
  computePipelineStages,
  computeDataFreshness,
} from "./platform-health-internals";

// ---------------------------------------------------------------------------
// Health status types — Sprint 2.5.3B canonical vocabulary
// ---------------------------------------------------------------------------

/** Per-subsystem health status: "Can the subsystem operate?" */
export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "DISABLED" | "UNKNOWN";

interface HealthCard {
  status:          HealthStatus;
  summary:         string;
  lastSuccessAt?:  string | null;
  lastAttemptAt?:  string | null;
  freshnessSec?:   number | null;
  action?:         string | null;
  details:         Record<string, unknown>;
}

/** Operational readiness status: "Is today's data/results ready?" */
export type OperationalStatus = "READY" | "DEGRADED" | "WAITING" | "FAILED" | "UNKNOWN" | "DISABLED";

export interface OperationsDimension {
  dimension:     string;
  status:        OperationalStatus;
  reason:        string | null;
  runbookQuery:  string;
}

export interface OperationsSummary {
  overallStatus:     OperationalStatus;
  headline:          string;
  requiresAttention: boolean;
  reasons:           string[];
  dimensions:        OperationsDimension[];
  generatedAt:       string;
}

/** Status of a stage in the end-to-end research pipeline */
export type PipelineStageStatus = "HEALTHY" | "RUNNING" | "WAITING" | "DEGRADED" | "FAILED" | "UNKNOWN" | "DISABLED";

export interface PipelineStage {
  name:           string;
  status:         PipelineStageStatus;
  lastUpdated:    string | null;
  freshnessSec:   number | null;
  primaryMetric:  string;
  warning:        string | null;
  runbookQuery:   string;
  diagnosticPath: string | null;
}

export interface PlatformHealthEnriched {
  health:             Record<string, HealthCard>;
  operationsSummary:  OperationsSummary;
  researchPipeline:   PipelineStage[];
  dataFreshness:      FreshnessResult[];
  endpointLatencyMs:  number;
}

// ---------------------------------------------------------------------------
// 30-second cache
// ---------------------------------------------------------------------------

let _cachedEnriched: PlatformHealthEnriched | null = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 30_000;

function isCacheValid(): boolean {
  return _cachedEnriched !== null && Date.now() - _cachedAt < CACHE_TTL_MS;
}

function invalidateHealthCache(): void {
  _cachedEnriched = null;
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function checkDatabase(): Promise<HealthCard> {
  try {
    const t0 = Date.now();
    await db.execute(sql`SELECT 1`);
    const latencyMs = Date.now() - t0;

    // Count key tables
    const tables = await db.execute<{ tablename: string }>(sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `);
    const tableNames = tables.rows.map(r => r.tablename);

    const requiredTables = [
      "symbols", "market_data_symbols", "opportunity_scan_snapshots",
      "sector_intelligence_snapshots", "theme_intelligence_snapshots",
    ];
    const missing = requiredTables.filter(t => !tableNames.includes(t));

    if (missing.length > 0) {
      return {
        status: "DEGRADED",
        summary: `DB reachable but ${missing.length} expected table(s) missing`,
        details: { latencyMs, tableCount: tableNames.length, missingTables: missing },
        action: "Run script/migrate.ts or check startup migration logs",
      };
    }

    return {
      status:  "HEALTHY",
      summary: `Reachable (${latencyMs}ms) — ${tableNames.length} tables`,
      details: { latencyMs, tableCount: tableNames.length },
    };
  } catch (err: any) {
    return {
      status:  "UNAVAILABLE",
      summary: "Database unreachable",
      details: { errorMessage: err?.message?.slice(0, 200) ?? "unknown" },
      action:  "Check DATABASE_URL and PostgreSQL service",
    };
  }
}

async function checkMarketData(): Promise<HealthCard> {
  const cfg = getTwelveDataConfig();
  if (!cfg.enabled || !cfg.apiKey) {
    return {
      status:  "DISABLED",
      summary: "Twelve Data not configured",
      details: { enabled: cfg.enabled, hasApiKey: !!cfg.apiKey },
      action:  "Set TWELVE_DATA_API_KEY and TWELVE_DATA_ENABLED=true to enable",
    };
  }

  try {
    const row = await db.execute<{ latest: string | null; symbol_count: string }>(sql`
      SELECT
        MAX(last_successful_ingestion_at)::text AS latest,
        COUNT(*)::text AS symbol_count
      FROM market_data_symbols
      WHERE enabled = true
    `);
    const latest    = row.rows[0]?.latest ?? null;
    const symCount  = parseInt(row.rows[0]?.symbol_count ?? "0", 10);

    // Sector coverage
    const sectorRow = await db.execute<{ with_sector: string }>(sql`
      SELECT COUNT(*) FILTER (WHERE sector IS NOT NULL AND sector <> '')::text AS with_sector
      FROM market_data_symbols WHERE enabled = true
    `);
    const withSector = parseInt(sectorRow.rows[0]?.with_sector ?? "0", 10);

    let freshnessSec: number | null = null;
    let status: HealthStatus = "HEALTHY";
    let action: string | null = null;

    if (latest) {
      freshnessSec = Math.round((Date.now() - new Date(latest).getTime()) / 1000);
      // DEGRADED if no ingestion in 3 days (on a trading day)
      if (freshnessSec > 3 * 86400) {
        status = "DEGRADED";
        action = "Check ingestion logs. POST /api/admin/market-data/force-ingest to trigger.";
      }
    } else {
      status = "DEGRADED";
      action = "No successful ingestion found. Trigger first ingestion.";
    }

    const sectorPct = symCount > 0 ? Math.round((withSector / symCount) * 100) : 0;
    if (withSector === 0) {
      status = "DEGRADED";
      action = "Run POST /api/admin/symbols/enrich to populate sector classifications.";
    }

    return {
      status,
      summary:       `${symCount} active symbols — ${sectorPct}% sector coverage`,
      lastSuccessAt: latest,
      freshnessSec,
      details: {
        symbolCount:     symCount,
        withSector,
        sectorPct,
        licenseMode:     cfg.licenseMode,
        environment:     cfg.environment,
      },
      action,
    };
  } catch (err: any) {
    return {
      status:  "UNKNOWN",
      summary: "Market data check failed",
      details: { errorMessage: err?.message?.slice(0, 200) ?? "unknown" },
    };
  }
}

async function checkMcp(): Promise<HealthCard> {
  const enabled     = process.env.MCP_ENABLED === "true";
  const baseUrl     = process.env.MCP_BASE_URL ? "[configured]" : null;
  const hasToken    = !!process.env.MCP_SERVICE_TOKEN;

  if (!enabled) {
    return {
      status:  "DISABLED",
      summary: "MCP_ENABLED is not set to true",
      details: { enabled, baseUrlConfigured: !!baseUrl, tokenConfigured: hasToken },
      action:  "Set MCP_ENABLED=true and MCP_BASE_URL to connect to MCP service",
    };
  }
  if (!baseUrl || !hasToken) {
    return {
      status:  "DEGRADED",
      summary: "MCP enabled but missing URL or token",
      details: { enabled, baseUrlConfigured: !!baseUrl, tokenConfigured: hasToken },
      action:  "Set MCP_BASE_URL and MCP_SERVICE_TOKEN",
    };
  }

  // Lightweight health ping (don't call if base URL is missing)
  try {
    const mcpBase = process.env.MCP_BASE_URL!;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const t0 = Date.now();
    const resp = await fetch(`${mcpBase}/health`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${process.env.MCP_SERVICE_TOKEN}` },
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - t0;
    if (resp.ok) {
      return {
        status:  "HEALTHY",
        summary: `MCP service reachable (${latencyMs}ms)`,
        details: { latencyMs, baseUrlConfigured: true, tokenConfigured: true },
      };
    } else {
      return {
        status:  "DEGRADED",
        summary: `MCP returned HTTP ${resp.status}`,
        details: { httpStatus: resp.status, latencyMs },
        action:  "Check MCP service logs and MCP_SERVICE_TOKEN",
      };
    }
  } catch (err: any) {
    return {
      status:  "DEGRADED",
      summary: "MCP service unreachable",
      details: { errorName: err?.name ?? "FETCH_ERROR" },
      action:  "Check MCP_BASE_URL is correct and service is running",
    };
  }
}

async function checkScanner(): Promise<HealthCard> {
  try {
    const row = await db.execute<{
      status: string;
      started_at: string | null;
      completed_at: string | null;
      candidate_count: number | null;
      qualified_count: number | null;
    }>(sql`
      SELECT status, started_at::text, completed_at::text, candidate_count, qualified_count
      FROM opportunity_scan_snapshots
      ORDER BY started_at DESC NULLS LAST
      LIMIT 1
    `);

    if (row.rows.length === 0) {
      return {
        status:  "DEGRADED",
        summary: "No scan has completed yet",
        details: {},
        action:  "Wait for first scheduled scan or trigger one from admin",
      };
    }

    const r = row.rows[0];
    const lastAt = r.completed_at ?? r.started_at ?? null;
    let freshnessSec: number | null = null;
    if (lastAt) freshnessSec = Math.round((Date.now() - new Date(lastAt).getTime()) / 1000);

    const status: HealthStatus =
      r.status === "COMPLETED"             ? "HEALTHY"   :
      r.status === "FAILED"                ? "DEGRADED"  :
      r.status === "RUNNING"               ? "HEALTHY"   :
      "UNKNOWN";

    return {
      status,
      summary:       `Last scan: ${r.status} — ${r.candidate_count ?? 0} candidates, ${r.qualified_count ?? 0} qualified`,
      lastSuccessAt: r.status === "COMPLETED" ? lastAt : null,
      freshnessSec,
      details: {
        scanStatus:     r.status,
        candidateCount: r.candidate_count,
        qualifiedCount: r.qualified_count,
      },
    };
  } catch {
    return { status: "UNKNOWN", summary: "Scanner status unavailable", details: {} };
  }
}

function checkRanking(): HealthCard {
  const ranking = getLatestRanking();
  if (!ranking) {
    return {
      status:  "DEGRADED",
      summary: "No ranking in memory — lost after restart or not yet computed",
      details: {},
      action:  "Wait for next scan cycle to rebuild ranking",
    };
  }
  const generatedAt = ranking.generatedAt ?? null;
  let freshnessSec: number | null = null;
  if (generatedAt) freshnessSec = Math.round((Date.now() - new Date(generatedAt).getTime()) / 1000);

  const symbolCount = [
    ...(ranking.topGrowth   ?? []),
    ...(ranking.topIncome   ?? []),
    ...(ranking.watchlist   ?? []),
    ...(ranking.approaching ?? []),
  ].length;

  return {
    status:        "HEALTHY",
    summary:       `${symbolCount} ranked symbols — regime: ${ranking.regime ?? "unknown"}`,
    lastSuccessAt: generatedAt,
    freshnessSec,
    details:       { symbolCount, regime: ranking.regime ?? null, generatedAt },
  };
}

async function checkIntelligence(): Promise<HealthCard> {
  try {
    const [sRow, tRow] = await Promise.all([
      db.execute<{ count: string; latest: string | null; unclassified: string }>(sql`
        SELECT
          COUNT(*)::text AS count,
          MAX(generated_at)::text AS latest,
          '0' AS unclassified
        FROM sector_intelligence_snapshots
      `),
      db.execute<{ count: string; latest: string | null }>(sql`
        SELECT COUNT(*)::text AS count, MAX(generated_at)::text AS latest
        FROM theme_intelligence_snapshots
      `),
    ]);

    const sCount = parseInt(sRow.rows[0]?.count ?? "0", 10);
    const tCount = parseInt(tRow.rows[0]?.count ?? "0", 10);
    const sLatest = sRow.rows[0]?.latest ?? null;
    const tLatest = tRow.rows[0]?.latest ?? null;
    const latest  = sLatest || tLatest;

    let freshnessSec: number | null = null;
    if (latest) freshnessSec = Math.round((Date.now() - new Date(latest).getTime()) / 1000);

    // Sector coverage from market_data_symbols
    const covRow = await db.execute<{ total: string; with_sector: string }>(sql`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE sector IS NOT NULL AND sector <> '')::text AS with_sector
      FROM market_data_symbols WHERE enabled = true
    `);
    const total      = parseInt(covRow.rows[0]?.total ?? "0", 10);
    const withSector = parseInt(covRow.rows[0]?.with_sector ?? "0", 10);
    const sectorPct  = total > 0 ? Math.round((withSector / total) * 100) : 0;

    const status: HealthStatus =
      sCount > 0 && tCount > 0 ? "HEALTHY" :
      sCount === 0 && tCount > 0 ? "DEGRADED" :
      tCount === 0 && sCount > 0 ? "DEGRADED" :
      "DEGRADED";

    const action = sCount === 0
      ? "Sector snapshots missing. POST /api/admin/intelligence/rebuild after enriching symbols."
      : tCount === 0
      ? "Theme snapshots missing. POST /api/admin/intelligence/rebuild."
      : null;

    return {
      status,
      summary:       `Sectors: ${sCount} rows, Themes: ${tCount} rows — classification ${sectorPct}%`,
      lastSuccessAt: latest,
      freshnessSec,
      details: {
        sectorSnapshotRows:  sCount,
        themeSnapshotRows:   tCount,
        sectorLatest:        sLatest,
        themeLatest:         tLatest,
        classificationTotal: total,
        withSector,
        sectorCoveragePct:   sectorPct,
      },
      action,
    };
  } catch (err: any) {
    return { status: "UNKNOWN", summary: "Intelligence check failed", details: { errorMessage: err?.message?.slice(0, 200) } };
  }
}

async function checkInstitutional(): Promise<HealthCard> {
  const ingestionEnabled  = process.env.INSTITUTIONAL_13F_INGESTION_ENABLED === "true";
  const intelligenceEnabled = process.env.INSTITUTIONAL_INTELLIGENCE_ENABLED !== "false";

  if (!ingestionEnabled) {
    return {
      status:  "DISABLED",
      summary: "Institutional 13F ingestion disabled (INSTITUTIONAL_13F_INGESTION_ENABLED)",
      details: { ingestionEnabled, intelligenceEnabled },
    };
  }

  try {
    const [filingRow, holdingRow, runRow, signalRow] = await Promise.all([
      db.execute<{ count: string }>(sql`SELECT COUNT(*)::text AS count FROM institutional_filings`),
      db.execute<{ count: string }>(sql`SELECT COUNT(*)::text AS count FROM institutional_holdings`),
      db.execute<{ status: string; started_at: string | null; completed_at: string | null }>(sql`
        SELECT status, started_at::text, completed_at::text FROM institutional_ingestion_runs
        ORDER BY started_at DESC NULLS LAST LIMIT 1
      `),
      db.execute<{ count: string; latest: string | null }>(sql`
        SELECT COUNT(*)::text AS count, MAX(calculated_at)::text AS latest FROM institutional_symbol_signals
      `),
    ]);

    const filingCount  = parseInt(filingRow.rows[0]?.count ?? "0", 10);
    const holdingCount = parseInt(holdingRow.rows[0]?.count ?? "0", 10);
    const latestRun    = runRow.rows[0] ?? null;
    const signalCount  = parseInt(signalRow.rows[0]?.count ?? "0", 10);
    const signalLatest = signalRow.rows[0]?.latest ?? null;

    const status: HealthStatus =
      filingCount > 0 && holdingCount > 0 ? "HEALTHY" :
      latestRun?.status === "running"      ? "HEALTHY"  :
      "DEGRADED";

    return {
      status,
      summary: `${filingCount} filings — ${holdingCount} holdings — ${signalCount} signals`,
      lastSuccessAt: latestRun?.completed_at ?? null,
      details: {
        filingCount, holdingCount, signalCount, signalLatest,
        lastRunStatus:      latestRun?.status ?? null,
        lastRunStartedAt:   latestRun?.started_at ?? null,
        lastRunCompletedAt: latestRun?.completed_at ?? null,
      },
    };
  } catch {
    return { status: "UNKNOWN", summary: "Institutional check failed", details: {} };
  }
}

async function checkSecurityMaster(): Promise<HealthCard> {
  try {
    const row = await db.execute<{ total: string; reviewed: string; probable: string; unmapped: string }>(sql`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE confidence_score >= 100)::text AS reviewed,
        COUNT(*) FILTER (WHERE confidence_score >= 70 AND confidence_score < 100)::text AS probable,
        COUNT(*) FILTER (WHERE confidence_score < 70 OR confidence_score IS NULL)::text AS unmapped
      FROM security_master
    `);
    const total    = parseInt(row.rows[0]?.total    ?? "0", 10);
    const reviewed = parseInt(row.rows[0]?.reviewed ?? "0", 10);
    const probable = parseInt(row.rows[0]?.probable ?? "0", 10);
    const unmapped = parseInt(row.rows[0]?.unmapped ?? "0", 10);
    const pct      = total > 0 ? Math.round((reviewed / total) * 100) : 0;

    return {
      status:  total > 0 ? "HEALTHY" : "DEGRADED",
      summary: `${total} mappings — ${reviewed} reviewed (${pct}%)`,
      details: { total, reviewed, probable, unmapped, reviewedPct: pct },
    };
  } catch {
    return { status: "UNKNOWN", summary: "Security master check failed", details: {} };
  }
}

async function checkBrokers(): Promise<HealthCard> {
  const tradier      = !!process.env.TRADIER_CLIENT_ID && !!process.env.TRADIER_CLIENT_SECRET;
  const tradeStation = !!process.env.TRADESTATION_CLIENT_ID && !!process.env.TRADESTATION_CLIENT_SECRET;
  const rithmic      = !!process.env.RITHMIC_USER_ID && !!process.env.RITHMIC_PASSWORD;

  const configured = [
    tradier      && "Tradier",
    tradeStation && "TradeStation",
    rithmic      && "Rithmic",
  ].filter(Boolean) as string[];

  return {
    status:  configured.length > 0 ? "HEALTHY" : "DISABLED",
    summary: configured.length > 0 ? `Configured: ${configured.join(", ")}` : "No brokers configured",
    details: {
      tradierConfigured:       tradier,
      tradeStationConfigured:  tradeStation,
      rithmicConfigured:       rithmic,
    },
  };
}

function checkApplication(): HealthCard {
  const uptimeSec = Math.round(process.uptime());
  const env = process.env.NODE_ENV ?? "unknown";
  const buildVersion = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8)
    ?? process.env.GIT_COMMIT?.slice(0, 8)
    ?? null;

  return {
    status:  "HEALTHY",
    summary: `${env} — uptime ${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`,
    details: {
      environment:  env,
      uptimeSec,
      buildVersion: buildVersion ?? "unknown",
      nodeVersion:  process.version,
    },
  };
}

// ---------------------------------------------------------------------------
// Aggregate health
// ---------------------------------------------------------------------------

async function checkResearchWorkspace(): Promise<HealthCard> {
  const snap = await getWorkspaceHealth().catch(() => null);
  if (!snap) return { status: "UNKNOWN", summary: "Research Workspace health unavailable", details: {} };
  const status: HealthStatus = !snap.openAiConfigured ? "DEGRADED"
    : !snap.contextAssemblyOk                         ? "DEGRADED"
    : "HEALTHY";
  return {
    status,
    summary: snap.openAiConfigured
      ? `${snap.conversationCount} conversations, ${snap.pinnedConversations} pinned; context assembly ${snap.contextAssemblyOk ? "ok" : "unavailable"}`
      : "OpenAI key not configured — AI responses unavailable",
    details: {
      conversationCount:   snap.conversationCount,
      pinnedConversations: snap.pinnedConversations,
      contextAssemblyOk:   snap.contextAssemblyOk,
      openAiConfigured:    snap.openAiConfigured,
      contextRequests:     snap.contextRequests,
      contextRequestsOk:   snap.contextRequestsOk,
      askRequests:         snap.askRequests,
      askRequestsOk:       snap.askRequestsOk,
      fallbackCount:       snap.fallbackCount,
      partialContextCount: snap.partialContextCount,
      averageAIResponseMs: snap.averageAIResponseMs,
    },
  };
}

async function checkCollections(): Promise<HealthCard> {
  const snap = await getCollectionHealth().catch(() => null);
  if (!snap) {
    return { status: "UNKNOWN", summary: "Collection health unavailable", details: {} };
  }
  const status: HealthStatus = !snap.seedingComplete             ? "DEGRADED"
    : snap.systemCollectionCount < 25                            ? "DEGRADED"
    : "HEALTHY";
  return {
    status,
    summary: snap.seedingComplete
      ? `${snap.systemCollectionCount} system, ${snap.userCollectionCount} user, ${snap.totalFollows} follows`
      : "System collections not yet seeded",
    details: {
      systemCollectionCount: snap.systemCollectionCount,
      userCollectionCount:   snap.userCollectionCount,
      totalFollows:          snap.totalFollows,
      totalFavorites:        snap.totalFavorites,
      totalPins:             snap.totalPins,
      totalUserSymbols:      snap.totalUserSymbols,
      seedingComplete:       snap.seedingComplete,
    },
  };
}

function checkOpportunityIntelligence(): HealthCard {
  const snap = getOpportunityIntelligenceHealth();
  const status: HealthStatus = !snap.hasSnapshot ? "UNKNOWN"
    : snap.totalOpportunities === 0              ? "DEGRADED"
    : "HEALTHY";
  return {
    status,
    summary: snap.hasSnapshot
      ? `${snap.totalOpportunities} opportunities — ${snap.growthCount} growth, ${snap.incomeCount} income, ${snap.watchlistCount} watch`
      : "No opportunity snapshot available yet",
    lastSuccessAt: snap.lastGeneratedAt,
    details: {
      hasSnapshot:       snap.hasSnapshot,
      totalOpportunities: snap.totalOpportunities,
      growthCount:       snap.growthCount,
      incomeCount:       snap.incomeCount,
      watchlistCount:    snap.watchlistCount,
      approachingCount:  snap.approachingCount,
      lastGeneratedAt:   snap.lastGeneratedAt ?? "Never",
      marketRegime:      snap.marketRegime     ?? "Unknown",
    },
  };
}

function checkBrokerSync(): HealthCard {
  const snap = getBrokerSyncHealth();
  const status: HealthStatus =
    snap.failedCount > 0 || snap.needsReauthCount > 0 ? "DEGRADED"
    : snap.totalConnections === 0                      ? "DISABLED"
    : "HEALTHY";
  return {
    status,
    summary: snap.totalConnections === 0
      ? "No broker portfolios linked"
      : `${snap.healthyCount} healthy, ${snap.failedCount} failed, ${snap.needsReauthCount} needs reauth`,
    lastSuccessAt: snap.lastSyncAt,
    details: {
      connections:    snap.totalConnections,
      healthy:        snap.healthyCount,
      failed:         snap.failedCount,
      needsReauth:    snap.needsReauthCount,
      running:        snap.runningCount,
      lastSyncAt:     snap.lastSyncAt ?? "Never",
      avgDurationMs:  snap.avgDurationMs ?? "—",
      pendingJobs:    snap.pendingJobs,
      lastError:      snap.lastError ?? null,
    },
  };
}

async function checkCommandCenter(): Promise<HealthCard> {
  const snap = getCommandCenterHealth();
  const status: HealthStatus =
    snap.lastGeneratedAt === null             ? "UNKNOWN"   :
    snap.sectionsAvailable === 0              ? "DEGRADED"  :
    snap.sectionsAvailable < 5               ? "DEGRADED"  :
    "HEALTHY";
  return {
    status,
    summary: snap.lastGeneratedAt
      ? `${snap.sectionsAvailable}/9 sections available — last generated ${new Date(snap.lastGeneratedAt).toISOString()}`
      : "No snapshot generated yet — page not yet visited",
    lastSuccessAt: snap.lastGeneratedAt,
    details: {
      sectionsAvailable:           snap.sectionsAvailable,
      opportunityChangesAvailable: snap.opportunityChangesAvailable,
      themeDataAvailable:          snap.themeDataAvailable,
      sectorDataAvailable:         snap.sectorDataAvailable,
      collectionsSeeded:           snap.collectionsSeeded,
      institutionalDataAvailable:  snap.institutionalDataAvailable,
    },
    action: snap.lastGeneratedAt === null
      ? "Visit /market-research-command-center to generate the first snapshot"
      : null,
  };
}

async function checkPortfolioIntelligence(): Promise<HealthCard> {
  try {
    const h = getPortfolioIntelligenceHealth();
    const status: HealthStatus =
      h.status === "HEALTHY"  ? "HEALTHY"  :
      h.status === "DEGRADED" ? "DEGRADED" :
      "UNKNOWN";
    return {
      status,
      summary: h.portfoliosAnalyzed === 0
        ? "No portfolio intelligence analyses yet this session"
        : `${h.portfoliosAnalyzed} portfolio${h.portfoliosAnalyzed !== 1 ? "s" : ""} analyzed — avg ${h.averageAnalysisDurationMs ?? "?"}ms`,
      lastSuccessAt: h.lastAnalysisAt,
      details: {
        portfoliosAnalyzed:       h.portfoliosAnalyzed,
        lastAnalysisAt:           h.lastAnalysisAt ?? "Never",
        averageAnalysisDurationMs: h.averageAnalysisDurationMs ?? "N/A",
        partialAnalyses:          h.partialAnalyses,
        failedAnalyses:           h.failedAnalyses,
        averageCoveragePercent:   h.averageCoveragePercent ?? "N/A",
      },
    };
  } catch {
    return { status: "UNKNOWN", summary: "Portfolio intelligence health unavailable", details: {} };
  }
}

async function checkPortfolioHistory(): Promise<HealthCard> {
  try {
    const h = await getPortfolioHistoryHealth();
    const status: HealthStatus =
      h.storageHealth === "unknown"  ? "UNKNOWN"  :
      h.storageHealth === "degraded" ? "DEGRADED" :
      "HEALTHY";
    return {
      status,
      summary: h.snapshotsTotal === 0
        ? "No portfolio snapshots captured yet"
        : `${h.portfoliosTracked} portfolio${h.portfoliosTracked !== 1 ? "s" : ""} tracked — ${h.snapshotsToday} snapshot${h.snapshotsToday !== 1 ? "s" : ""} today`,
      lastSuccessAt: h.latestSnapshotAt,
      details: {
        portfoliosTracked:         h.portfoliosTracked,
        snapshotsTotal:            h.snapshotsTotal,
        snapshotsToday:            h.snapshotsToday,
        latestSnapshotAt:          h.latestSnapshotAt ?? "Never",
        positionsCaptured:         h.positionsCaptured,
        averageSnapshotDurationMs: h.averageSnapshotDurationMs ?? "N/A",
        storageHealth:             h.storageHealth,
        scheduledSnapshots:        "Not implemented (Sprint 2.6.0 — future scheduler)",
      },
      action: h.snapshotsTotal === 0
        ? "Visit /portfolio to import or sync holdings and capture your first snapshot"
        : null,
    };
  } catch {
    return { status: "UNKNOWN", summary: "Portfolio history health unavailable", details: {} };
  }
}

async function checkResearchReports(): Promise<HealthCard> {
  try {
    const h = await getResearchReportsHealth();
    const status: HealthStatus =
      h.storageHealth === "unknown" ? "UNKNOWN"   :
      h.storageHealth === "degraded" ? "DEGRADED" :
      "HEALTHY";
    return {
      status,
      summary: h.reportsGenerated === 0
        ? "No research reports generated yet"
        : `${h.reportsGenerated} report${h.reportsGenerated !== 1 ? "s" : ""} — ${h.reportsToday} today`,
      lastSuccessAt: h.latestReport,
      details: {
        reportsGenerated:    h.reportsGenerated,
        reportsToday:        h.reportsToday,
        latestReport:        h.latestReport ?? "None",
        generationTimeMs:    h.generationTimeMs ?? "N/A",
        storageHealth:       h.storageHealth,
        scheduledReports:    "Not implemented (Sprint 2.5.5 — future)",
      },
      action: h.reportsGenerated === 0
        ? "Visit /research-reports to generate your first report"
        : null,
    };
  } catch {
    return { status: "UNKNOWN", summary: "Research reports health unavailable", details: {} };
  }
}

async function checkResearchMonitoring(): Promise<HealthCard> {
  try {
    const h = await getResearchMonitoringHealth();
    const status: HealthStatus =
      h.watchCount === 0          ? "UNKNOWN"  :
      h.activeWatchCount === 0    ? "DISABLED" :
      "HEALTHY";
    return {
      status,
      summary: h.watchCount === 0
        ? "No research watches configured"
        : `${h.activeWatchCount} active watch${h.activeWatchCount !== 1 ? "es" : ""} — ${h.evaluationsToday} evaluation${h.evaluationsToday !== 1 ? "s" : ""} today`,
      lastSuccessAt: h.lastEvaluatedAt,
      details: {
        watchCount:            h.watchCount,
        activeWatchCount:      h.activeWatchCount,
        evaluationsToday:      h.evaluationsToday,
        lastEvaluatedAt:       h.lastEvaluatedAt ?? "Never",
        lastFeedGeneratedAt:   h.lastFeedGeneratedAt ?? "Not yet",
        notificationChannels:  "Not implemented (Sprint 2.5.4 — future)",
      },
      action: h.watchCount === 0 ? "Visit /research-monitor to create your first research watch" : null,
    };
  } catch {
    return { status: "UNKNOWN", summary: "Research monitoring health unavailable", details: {} };
  }
}

// computeOperationsSummary, computePipelineStages, computeDataFreshness
// are imported from ./platform-health-internals (pure — no DB, no network).

// ---------------------------------------------------------------------------
// Build full enriched platform health
// ---------------------------------------------------------------------------

async function buildPlatformHealth(): Promise<PlatformHealthEnriched> {
  const [db_, marketData, mcp, scanner, intel, institutional, secMaster, brokers] = await Promise.all([
    checkDatabase(),
    checkMarketData(),
    checkMcp(),
    checkScanner(),
    checkIntelligence(),
    checkInstitutional(),
    checkSecurityMaster(),
    checkBrokers(),
  ]);

  const app        = checkApplication();
  const ranking    = checkRanking();
  const brokerSync = checkBrokerSync();
  const oppIntel   = checkOpportunityIntelligence();
  const [collections, researchWorkspace, commandCenter, researchMonitoring, researchReports_, portfolioHistory_, portfolioIntelligence_] = await Promise.all([
    checkCollections(),
    checkResearchWorkspace(),
    checkCommandCenter(),
    checkResearchMonitoring(),
    checkResearchReports(),
    checkPortfolioHistory(),
    checkPortfolioIntelligence(),
  ]);

  // Portfolio Analytics health (in-memory; resets on restart)
  const paHealth = getPortfolioAnalyticsHealth();
  const portfolioAnalytics_: HealthCard = {
    status:  paHealth.analyticsRequests === 0 ? "UNKNOWN" : "HEALTHY",
    summary: paHealth.analyticsRequests === 0
      ? "No portfolio analytics requests yet this session"
      : `${paHealth.portfoliosWithAnalytics} portfolio${paHealth.portfoliosWithAnalytics !== 1 ? "s" : ""} analyzed — avg ${paHealth.averageAnalyticsDurationMs ?? "?"}ms`,
    lastSuccessAt: paHealth.latestAnalyticsAt,
    details: {
      portfoliosWithAnalytics:    paHealth.portfoliosWithAnalytics,
      analyticsRequests:          paHealth.analyticsRequests,
      averageAnalyticsDurationMs: paHealth.averageAnalyticsDurationMs ?? "N/A",
      latestAnalyticsAt:          paHealth.latestAnalyticsAt ?? "Never",
      partialAnalytics:           paHealth.partialAnalytics,
    },
  };
  // Opportunity Workspace v2 health (in-memory; resets on restart)
  const wsV2Health = getWorkspaceV2Health();
  const opportunityWorkspaceV2_: HealthCard = {
    status: wsV2Health.workspaceRequests === 0
      ? "UNKNOWN"
      : wsV2Health.workspaceFailures > wsV2Health.workspaceSuccesses + wsV2Health.workspacePartials
        ? "DEGRADED"
        : "HEALTHY",
    summary: wsV2Health.workspaceRequests === 0
      ? "No workspace v2 requests yet this session"
      : `${wsV2Health.workspaceRequests} requests — ${wsV2Health.workspacePartials} partial — avg ${wsV2Health.averageWorkspaceLatencyMs ?? "?"}ms`,
    lastSuccessAt: wsV2Health.lastSuccessfulWorkspaceAt,
    details: {
      workspaceRequests:           wsV2Health.workspaceRequests,
      workspaceSuccesses:          wsV2Health.workspaceSuccesses,
      workspacePartials:           wsV2Health.workspacePartials,
      workspaceFailures:           wsV2Health.workspaceFailures,
      averageWorkspaceLatencyMs:   wsV2Health.averageWorkspaceLatencyMs ?? "N/A",
      lastSuccessfulWorkspaceAt:   wsV2Health.lastSuccessfulWorkspaceAt ?? "Never",
    },
  };

  const jobs = getAllJobStatuses();

  const health: Record<string, HealthCard> = {
    application: app,
    database:    db_,
    marketData,
    mcp,
    scanner,
    ranking,
    intelligence:            intel,
    institutional,
    securityMaster:          secMaster,
    brokers,
    brokerSync,
    opportunityIntelligence: oppIntel,
    collections,
    researchWorkspace,
    commandCenter,
    researchMonitoring,
    researchReports:  researchReports_,
    portfolioHistory:       portfolioHistory_,
    portfolioIntelligence:  portfolioIntelligence_,
    portfolioAnalytics:          portfolioAnalytics_,
    opportunityWorkspaceV2:      opportunityWorkspaceV2_,
    jobs: {
      status:  "HEALTHY",
      summary: `${Object.values(jobs).filter(j => j.status === "running").length} jobs running`,
      details: jobs,
    } as HealthCard,
  };

  return {
    health,
    operationsSummary: computeOperationsSummary(health),
    researchPipeline:  computePipelineStages(health),
    dataFreshness:     computeDataFreshness(health),
    endpointLatencyMs: 0, // caller will fill this in
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerPlatformHealthRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  isAdmin: RequestHandler,
): void {

  // ── GET /api/admin/platform-health ────────────────────────────────────────
  app.get("/api/admin/platform-health", isAuthenticated, isAdmin, async (_req: Request, res: Response) => {
    try {
      if (isCacheValid()) {
        return res.json({ ..._cachedEnriched!, cachedAt: new Date(_cachedAt).toISOString(), cached: true });
      }
      const t0 = Date.now();
      const enriched = await buildPlatformHealth();
      enriched.endpointLatencyMs = Date.now() - t0;
      _cachedEnriched = enriched;
      _cachedAt = Date.now();
      res.json({ ...enriched, cachedAt: new Date(_cachedAt).toISOString(), cached: false });
    } catch (err: any) {
      console.error("[platform-health] failed:", err?.message);
      res.status(500).json({ error: "Platform health check failed" });
    }
  });

  // ── POST /api/admin/platform-health/refresh ────────────────────────────────
  app.post("/api/admin/platform-health/refresh", isAuthenticated, isAdmin, async (_req: Request, res: Response) => {
    invalidateHealthCache();
    try {
      const t0 = Date.now();
      const enriched = await buildPlatformHealth();
      enriched.endpointLatencyMs = Date.now() - t0;
      _cachedEnriched = enriched;
      _cachedAt = Date.now();
      res.json({ ...enriched, cachedAt: new Date(_cachedAt).toISOString(), cached: false });
    } catch (err: any) {
      res.status(500).json({ error: "Platform health refresh failed" });
    }
  });

  // ── POST /api/admin/symbols/enrich ────────────────────────────────────────
  // Trigger symbol sector enrichment via Twelve Data /profile endpoint.
  app.post("/api/admin/symbols/enrich", isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    const { forceAll, symbols } = req.body ?? {};
    try {
      const result = await enrichMissingSymbolClassifications({
        forceAll: !!forceAll,
        symbols:  Array.isArray(symbols) ? symbols : undefined,
      });
      invalidateHealthCache(); // force health re-check after enrichment
      res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("[platform-health] enrich failed:", err?.message);
      res.status(500).json({ error: "Symbol enrichment failed", detail: err?.message });
    }
  });
}
