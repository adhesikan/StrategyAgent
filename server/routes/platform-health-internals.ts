// ---------------------------------------------------------------------------
// Platform Health Internal Pure Computations — Sprint 2.5.3B
//
// Pure functions extracted from platform-health.ts for testability.
// No DB, no network, no AI, no side effects.
// Imported by:
//   - server/routes/platform-health.ts (production)
//   - server/routes/platform-health-test-exports.ts (tests)
// ---------------------------------------------------------------------------

import { assessFreshness, FRESHNESS_RULES, type FreshnessResult } from "../lib/health-freshness";

export type HealthStatus      = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "DISABLED" | "UNKNOWN";
export type OperationalStatus = "READY"   | "DEGRADED" | "WAITING"     | "FAILED"   | "UNKNOWN" | "DISABLED";
export type PipelineStageStatus = "HEALTHY" | "RUNNING" | "WAITING" | "DEGRADED" | "FAILED" | "UNKNOWN" | "DISABLED";

export interface HealthCard {
  status:          HealthStatus;
  summary:         string;
  lastSuccessAt?:  string | null;
  freshnessSec?:   number | null;
  action?:         string | null;
  details:         Record<string, unknown>;
}

export interface OperationsDimension {
  dimension:    string;
  status:       OperationalStatus;
  reason:       string | null;
  runbookQuery: string;
}

export interface OperationsSummary {
  overallStatus:     OperationalStatus;
  headline:          string;
  requiresAttention: boolean;
  reasons:           string[];
  dimensions:        OperationsDimension[];
  generatedAt:       string;
}

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

// ---------------------------------------------------------------------------
// Operations Summary — 7 readiness dimensions
// ---------------------------------------------------------------------------

export function computeOperationsSummary(health: Record<string, HealthCard>): OperationsSummary {
  const g = (k: string) => health[k] as HealthCard | undefined;

  // Dimension 1: Platform (app + DB)
  const appOk = g("application")?.status === "HEALTHY";
  const dbOk  = g("database")?.status    === "HEALTHY";
  const platStatus: OperationalStatus = (!appOk || !dbOk) ? "FAILED" : "READY";
  const platReason  = !appOk ? "Application unhealthy" : !dbOk ? "Database unreachable" : null;

  // Dimension 2: Research Readiness (ranking + OppIntel + Intel)
  const rankingOk  = g("ranking")?.status               === "HEALTHY";
  const oppIntelOk = g("opportunityIntelligence")?.status === "HEALTHY";
  const intelOk    = g("intelligence")?.status           === "HEALTHY";
  const researchStatus: OperationalStatus =
    !rankingOk  ? "WAITING" :
    !oppIntelOk ? "WAITING" :
    !intelOk    ? "DEGRADED" :
    "READY";
  const researchReason =
    !rankingOk  ? "Opportunity Ranking not yet computed" :
    !oppIntelOk ? "Opportunity Intelligence snapshot unavailable" :
    !intelOk    ? "Sector/Theme Intelligence degraded" :
    null;

  // Dimension 3: Market Data
  const mdStatus = g("marketData")?.status;
  const marketStatus: OperationalStatus =
    mdStatus === "DISABLED"   ? "DISABLED" :
    mdStatus === "HEALTHY"    ? "READY"    :
    mdStatus === "DEGRADED"   ? "DEGRADED" :
    "UNKNOWN";
  const marketReason = mdStatus === "DEGRADED" ? "Market data stale or unavailable" : null;

  // Dimension 4: AI (workspace)
  const wsStatus = g("researchWorkspace")?.status;
  const aiStatus: OperationalStatus =
    wsStatus === "HEALTHY"  ? "READY"    :
    wsStatus === "DEGRADED" ? "DEGRADED" :
    wsStatus === "DISABLED" ? "DISABLED" :
    "UNKNOWN";
  const aiReason = wsStatus === "DEGRADED"
    ? "Research Workspace degraded — check OpenAI key or context assembly"
    : null;

  // Dimension 5: Reports
  const rpStatus = g("researchReports")?.status;
  const reportsStatus: OperationalStatus =
    rpStatus === "HEALTHY"  ? "READY"    :
    rpStatus === "UNKNOWN"  ? "WAITING"  :
    rpStatus === "DEGRADED" ? "DEGRADED" :
    "UNKNOWN";
  const reportsReason = rpStatus === "UNKNOWN" ? "No research reports generated yet" : null;

  // Dimension 6: Portfolio Services
  const phStatus = g("portfolioHistory")?.status;
  const portfolioStatus: OperationalStatus =
    phStatus === "HEALTHY"  ? "READY"    :
    phStatus === "UNKNOWN"  ? "WAITING"  :
    phStatus === "DEGRADED" ? "DEGRADED" :
    "UNKNOWN";
  const portfolioReason = phStatus === "DEGRADED" ? "Portfolio history service degraded" : null;

  // Dimension 7: Broker Services
  const bsStatus = g("brokerSync")?.status;
  const brokerStatus: OperationalStatus =
    bsStatus === "DISABLED" ? "DISABLED" :
    bsStatus === "HEALTHY"  ? "READY"    :
    bsStatus === "DEGRADED" ? "DEGRADED" :
    "UNKNOWN";
  const brokerReason = bsStatus === "DEGRADED"
    ? "Broker sync has failed connections or needs reauth"
    : null;

  const dimensions: OperationsDimension[] = [
    { dimension: "Platform Status",              status: platStatus,      reason: platReason,      runbookQuery: "application database" },
    { dimension: "Research Readiness",           status: researchStatus,  reason: researchReason,  runbookQuery: "ranking opportunity intelligence" },
    { dimension: "Market Data Readiness",        status: marketStatus,    reason: marketReason,    runbookQuery: "market data stale" },
    { dimension: "AI Readiness",                 status: aiStatus,        reason: aiReason,        runbookQuery: "research workspace" },
    { dimension: "Reports Readiness",            status: reportsStatus,   reason: reportsReason,   runbookQuery: "research reports" },
    { dimension: "Portfolio Services Readiness", status: portfolioStatus, reason: portfolioReason, runbookQuery: "portfolio history" },
    { dimension: "Broker Services Readiness",    status: brokerStatus,    reason: brokerReason,    runbookQuery: "broker sync" },
  ];

  const attentionDims = dimensions.filter(
    d => d.reason && (d.status === "DEGRADED" || d.status === "FAILED" || d.status === "WAITING"),
  );
  const requiresAttention = attentionDims.length > 0;
  const reasons = attentionDims.map(d => d.reason!);

  const overallStatus: OperationalStatus =
    dimensions.some(d => d.status === "FAILED")   ? "FAILED"   :
    dimensions.some(d => d.status === "DEGRADED") ? "DEGRADED" :
    dimensions.some(d => d.status === "WAITING")  ? "WAITING"  :
    dimensions.filter(d => d.status !== "DISABLED" && d.status !== "UNKNOWN").every(d => d.status === "READY") ? "READY" :
    "UNKNOWN";

  return {
    overallStatus,
    headline:          requiresAttention ? "Today's Research Platform Requires Attention" : "Today's Research Platform is Ready",
    requiresAttention,
    reasons,
    dimensions,
    generatedAt:       new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Research Pipeline — 10-stage flow
// ---------------------------------------------------------------------------

function mapStatus(s: HealthStatus | undefined): PipelineStageStatus {
  if (s === "HEALTHY")     return "HEALTHY";
  if (s === "DEGRADED")    return "DEGRADED";
  if (s === "UNAVAILABLE") return "FAILED";
  if (s === "DISABLED")    return "DISABLED";
  return "UNKNOWN";
}

function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = parseInt(v, 10); return isNaN(n) ? null : n; }
  return null;
}

export function computePipelineStages(health: Record<string, HealthCard>): PipelineStage[] {
  const g = (k: string) => health[k] as HealthCard | undefined;

  const md      = g("marketData");
  const mdDets  = md?.details ?? {};
  const mdStage: PipelineStage = {
    name:           "Market Data",
    status:         md?.status === "DISABLED" ? "DISABLED" : mapStatus(md?.status),
    lastUpdated:    md?.lastSuccessAt ?? null,
    freshnessSec:   md?.freshnessSec ?? null,
    primaryMetric:  md?.status === "DISABLED" ? "Not configured" :
                    `${num(mdDets.symbolCount) ?? 0} active symbols — ${num(mdDets.sectorPct) ?? 0}% sector coverage`,
    warning:        md?.action ?? null,
    runbookQuery:   "market data stale",
    diagnosticPath: "/api/admin/market-data/status",
  };

  const universeSymbols = num(mdDets.symbolCount) ?? 0;
  const universeReady   = universeSymbols > 0 && md?.status === "HEALTHY";
  const universeStage: PipelineStage = {
    name:           "Universe Ready",
    status:         universeReady ? "HEALTHY" : universeSymbols === 0 ? "WAITING" : "DEGRADED",
    lastUpdated:    md?.lastSuccessAt ?? null,
    freshnessSec:   null,
    primaryMetric:  universeSymbols > 0
      ? `${universeSymbols} symbols in universe`
      : "No symbols loaded — ingest market data first",
    warning:        !universeReady && universeSymbols > 0 ? "Symbol enrichment may be incomplete" : null,
    runbookQuery:   "scanner universe",
    diagnosticPath: null,
  };

  const scanner    = g("scanner");
  const scanDets   = scanner?.details ?? {};
  const scanStatus = scanDets.scanStatus as string | undefined;
  const scanStage: PipelineStage = {
    name:           "Scanner",
    status:         scanStatus === "COMPLETED" ? "HEALTHY" :
                    scanStatus === "RUNNING"   ? "RUNNING" :
                    scanStatus === "FAILED"    ? "FAILED"  :
                    scanner?.status === "DEGRADED" ? "WAITING" : "UNKNOWN",
    lastUpdated:    scanner?.lastSuccessAt ?? null,
    freshnessSec:   scanner?.freshnessSec ?? null,
    primaryMetric:  scanDets.candidateCount != null
      ? `${num(scanDets.candidateCount)} candidates — ${num(scanDets.qualifiedCount)} qualified`
      : "Not run yet",
    warning:        scanner?.action ?? null,
    runbookQuery:   "scanner",
    diagnosticPath: null,
  };

  const ranking   = g("ranking");
  const rankDets  = ranking?.details ?? {};
  const rankStage: PipelineStage = {
    name:           "Opportunity Ranking",
    status:         mapStatus(ranking?.status),
    lastUpdated:    ranking?.lastSuccessAt ?? null,
    freshnessSec:   ranking?.freshnessSec ?? null,
    primaryMetric:  rankDets.symbolCount != null
      ? `${num(rankDets.symbolCount)} ranked symbols — regime: ${rankDets.regime ?? "unknown"}`
      : "No ranking in memory — restart or scan needed",
    warning:        ranking?.action ?? null,
    runbookQuery:   "ranking",
    diagnosticPath: null,
  };

  const oppIntel  = g("opportunityIntelligence");
  const oiDets    = oppIntel?.details ?? {};
  const oiStage: PipelineStage = {
    name:           "Opportunity Intelligence",
    status:         mapStatus(oppIntel?.status),
    lastUpdated:    oppIntel?.lastSuccessAt ?? null,
    freshnessSec:   null,
    primaryMetric:  oiDets.hasSnapshot
      ? `${num(oiDets.totalOpportunities)} opportunities — ${num(oiDets.growthCount)} growth, ${num(oiDets.incomeCount)} income`
      : "No snapshot yet",
    warning:        oppIntel?.action ?? null,
    runbookQuery:   "opportunity intelligence",
    diagnosticPath: "/api/admin/intelligence/diagnostics",
  };

  const intel     = g("intelligence");
  const intelDets = intel?.details ?? {};
  const intelStage: PipelineStage = {
    name:           "Sector / Theme Intelligence",
    status:         mapStatus(intel?.status),
    lastUpdated:    intel?.lastSuccessAt ?? (intelDets.sectorLatest as string | null) ?? null,
    freshnessSec:   intel?.freshnessSec ?? null,
    primaryMetric:  Object.keys(intelDets).length > 0
      ? `${num(intelDets.sectorSnapshotRows)} sector rows — ${num(intelDets.themeSnapshotRows)} theme rows`
      : "Not computed",
    warning:        intel?.action ?? null,
    runbookQuery:   "sector theme intelligence",
    diagnosticPath: "/api/admin/intelligence/diagnostics",
  };

  const coll     = g("collections");
  const collDets = coll?.details ?? {};
  const collStage: PipelineStage = {
    name:           "Research Collections",
    status:         mapStatus(coll?.status),
    lastUpdated:    null,
    freshnessSec:   null,
    primaryMetric:  collDets.systemCollectionCount != null
      ? `${num(collDets.systemCollectionCount)} system — ${num(collDets.userCollectionCount)} user`
      : "Not seeded",
    warning:        coll?.action ?? null,
    runbookQuery:   "research collections",
    diagnosticPath: null,
  };

  const mon     = g("researchMonitoring");
  const monDets = mon?.details ?? {};
  const monStage: PipelineStage = {
    name:           "Research Monitoring",
    status:         mon?.status === "UNKNOWN" ? "WAITING" : mapStatus(mon?.status),
    lastUpdated:    mon?.lastSuccessAt ?? null,
    freshnessSec:   null,
    primaryMetric:  monDets.watchCount != null && num(monDets.watchCount)! > 0
      ? `${num(monDets.activeWatchCount)} active watches — ${num(monDets.evaluationsToday)} evaluations today`
      : "No watches configured",
    warning:        mon?.action ?? null,
    runbookQuery:   "research monitoring",
    diagnosticPath: "/api/research-monitor/health",
  };

  const cc     = g("commandCenter");
  const ccDets = cc?.details ?? {};
  const ccStage: PipelineStage = {
    name:           "Market Research Command Center",
    status:         cc?.status === "UNKNOWN" ? "WAITING" : mapStatus(cc?.status),
    lastUpdated:    cc?.lastSuccessAt ?? null,
    freshnessSec:   cc?.freshnessSec ?? null,
    primaryMetric:  ccDets.sectionsAvailable != null
      ? `${num(ccDets.sectionsAvailable)} sections available`
      : "No snapshot generated yet",
    warning:        cc?.action ?? null,
    runbookQuery:   "command center",
    diagnosticPath: "/api/command-center/health",
  };

  const rr     = g("researchReports");
  const rrDets = rr?.details ?? {};
  const rrStage: PipelineStage = {
    name:           "Research Reports",
    status:         rr?.status === "UNKNOWN" ? "WAITING" : mapStatus(rr?.status),
    lastUpdated:    rr?.lastSuccessAt ?? null,
    freshnessSec:   null,
    primaryMetric:  rrDets.reportsGenerated != null
      ? `${num(rrDets.reportsGenerated)} total — ${num(rrDets.reportsToday)} today`
      : "No reports generated yet",
    warning:        rr?.action ?? null,
    runbookQuery:   "research reports",
    diagnosticPath: "/api/research-reports/health",
  };

  return [mdStage, universeStage, scanStage, rankStage, oiStage, intelStage, collStage, monStage, ccStage, rrStage];
}

// ---------------------------------------------------------------------------
// Data Freshness — 14 datasets assessed from existing health cards
// ---------------------------------------------------------------------------

export function computeDataFreshness(health: Record<string, HealthCard>): FreshnessResult[] {
  const g = (k: string) => health[k] as HealthCard | undefined;

  const md      = g("marketData");
  const mdDets  = md?.details ?? {};
  const inst    = g("institutional");
  const instDets = inst?.details ?? {};
  const oi      = g("opportunityIntelligence");
  const oiDets  = oi?.details ?? {};
  const intel   = g("intelligence");
  const intelDets = intel?.details ?? {};
  const mon     = g("researchMonitoring");
  const monDets = mon?.details ?? {};
  const cc      = g("commandCenter");
  const rr      = g("researchReports");
  const ph      = g("portfolioHistory");
  const bs      = g("brokerSync");

  const mdDisabled   = md?.status  === "DISABLED";
  const instDisabled = inst?.status === "DISABLED";
  const bsDisabled   = bs?.status  === "DISABLED";

  return [
    // Market Prices
    assessFreshness(
      mdDisabled ? null : md?.lastSuccessAt ?? null,
      mdDisabled ? { ...FRESHNESS_RULES.marketPrices, notApplicable: true } : FRESHNESS_RULES.marketPrices,
    ),
    // Historical Bars (same cadence as market prices)
    assessFreshness(
      mdDisabled ? null : md?.lastSuccessAt ?? null,
      mdDisabled ? { ...FRESHNESS_RULES.historicalBars, notApplicable: true } : FRESHNESS_RULES.historicalBars,
    ),
    // Symbol Metadata
    assessFreshness(
      mdDisabled ? null : md?.lastSuccessAt ?? null,
      mdDisabled ? { ...FRESHNESS_RULES.symbolMetadata, notApplicable: true } : FRESHNESS_RULES.symbolMetadata,
    ),
    // Opportunity Ranking
    assessFreshness(g("ranking")?.lastSuccessAt ?? null, FRESHNESS_RULES.opportunityRanking),
    // Opportunity Intelligence
    assessFreshness(
      (oiDets.lastGeneratedAt as string | null) ?? oi?.lastSuccessAt ?? null,
      FRESHNESS_RULES.opportunityIntelligence,
    ),
    // Sector Intelligence
    assessFreshness(
      (intelDets.sectorLatest as string | null) ?? intel?.lastSuccessAt ?? null,
      FRESHNESS_RULES.sectorIntelligence,
    ),
    // Theme Intelligence
    assessFreshness(
      (intelDets.themeLatest as string | null) ?? intel?.lastSuccessAt ?? null,
      FRESHNESS_RULES.themeIntelligence,
    ),
    // Institutional Signals (delayed by design; NOT_APPLICABLE when disabled)
    instDisabled
      ? assessFreshness(null, { ...FRESHNESS_RULES.institutionalSignals, notApplicable: true })
      : assessFreshness(
          (instDets.latestIngestionAt as string | null) ?? inst?.lastSuccessAt ?? null,
          FRESHNESS_RULES.institutionalSignals,
        ),
    // Research Collections
    assessFreshness(g("collections")?.lastSuccessAt ?? null, FRESHNESS_RULES.researchCollections),
    // Research Monitor
    assessFreshness(
      (monDets.lastFeedGeneratedAt as string | null) ?? mon?.lastSuccessAt ?? null,
      FRESHNESS_RULES.researchMonitor,
    ),
    // Command Center Snapshot
    assessFreshness(cc?.lastSuccessAt ?? null, FRESHNESS_RULES.commandCenterSnapshot),
    // Research Reports
    assessFreshness(rr?.lastSuccessAt ?? null, FRESHNESS_RULES.researchReports),
    // Portfolio History
    assessFreshness(ph?.lastSuccessAt ?? null, FRESHNESS_RULES.portfolioHistory),
    // Broker Sync (NOT_APPLICABLE when disabled)
    bsDisabled
      ? assessFreshness(null, { ...FRESHNESS_RULES.brokerSync, notApplicable: true })
      : assessFreshness(bs?.lastSuccessAt ?? null, FRESHNESS_RULES.brokerSync),
  ];
}
