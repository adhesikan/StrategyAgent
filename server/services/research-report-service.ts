// Sprint 2.5.5 — Research Report Engine
//
// Generates professional research reports from existing precomputed intelligence.
// NO rescanning, NO reranking, NO new market-data fetches.
// ALL data comes from precomputed stores already in memory / DB.
//
// Public API:
//   generateReport(userId, reportType, options)   → create + persist new report
//   listReports(userId, searchOptions)             → search / filter reports
//   getReport(reportId, userId)                    → single report lookup
//   updateReport(reportId, userId, updates)        → pin / rename / archive
//   deleteReport(reportId, userId)                 → soft-delete (status=archived)
//   exportReport(reportId, userId, format)         → html | markdown | json | pdf_ready | ppt_ready
//   buildLatestReportSection(userId)               → command-center integration
//   getResearchReportsHealth()                     → platform health
//   ensureResearchReportsTables()                  → startup idempotent migration

import { db } from "../db";
import {
  sql,
  desc,
  asc,
  eq,
  and,
  or,
  like,
  not,
} from "drizzle-orm";
import { researchReports } from "@shared/schema";
import { getLatestRanking } from "./opportunity-ranking-engine";
import {
  getLatestThemeSnapshots,
  getLatestSectorSnapshots,
} from "./intelligence-snapshot-store";
import { getOpportunityIntelligence } from "./opportunity-intelligence-service";
import { listCollections } from "./collection-service";
import { buildMyWatchChangesSection } from "./research-monitor-service";
import type {
  ResearchReport,
  ReportContent,
  ReportSection,
  ReportType,
  ReportStatus,
  ExportFormat,
  GenerateReportOptions,
  ReportUpdateInput,
  ReportSearchOptions,
  EvidenceItem,
  DataFreshnessInfo,
  LatestReportSection,
  ReportShortCard,
  ResearchReportsHealth,
  TemplateSectionType,
} from "@shared/research-report-types";
import { REPORT_TYPE_LABELS, REPORT_TYPE_SUBTITLES } from "@shared/research-report-types";
import type { ResearchReportRow } from "@shared/schema";

// ---------------------------------------------------------------------------
// Compliance — shared disclaimer
// ---------------------------------------------------------------------------

export const RESEARCH_DISCLAIMER =
  "This research report summarises deterministic intelligence generated from market data and predefined qualification rules. " +
  "It is provided for informational purposes only and does not constitute personalised investment advice, a recommendation to buy or sell any security, " +
  "or a guarantee of future performance. Past research patterns do not predict future results. " +
  "All scores and observations reflect data available at report generation time and may not reflect subsequent market developments.";

// ---------------------------------------------------------------------------
// Internal data bundle
// ---------------------------------------------------------------------------

interface ReportDataBundle {
  ranking:      ReturnType<typeof getLatestRanking>;
  themes:       Awaited<ReturnType<typeof getLatestThemeSnapshots>>;
  sectors:      Awaited<ReturnType<typeof getLatestSectorSnapshots>>;
  intel:        Awaited<ReturnType<typeof getOpportunityIntelligence>>;
  collections:  Awaited<ReturnType<typeof listCollections>>;
  watchSection: Awaited<ReturnType<typeof buildMyWatchChangesSection>> | null;
}

// ---------------------------------------------------------------------------
// Section builders (pure — no DB / network)
// ---------------------------------------------------------------------------

function _sectionId(type: TemplateSectionType, suffix?: string): string {
  return suffix ? `${type}-${suffix}` : type;
}

function _section(
  type: TemplateSectionType,
  title: string,
  content: string,
  bullets: string[],
  data: Record<string, unknown>,
  sortOrder: number
): ReportSection {
  return { id: _sectionId(type), sectionType: type, title, content, bullets, data, sortOrder };
}

function _buildExecutiveSummarySection(summary: string, sortOrder: number): ReportSection {
  return _section("executive_summary", "Executive Summary", summary, [], {}, sortOrder);
}

function _buildMarketOverviewSection(data: ReportDataBundle, sortOrder: number): ReportSection {
  const ranking = data.ranking;
  const regime  = ranking?.regime ?? data.intel?.marketRegime ?? null;
  const bullets: string[] = [];
  if (regime) bullets.push(`Market regime: ${regime}`);
  const topGrowth = ranking?.topGrowth?.slice(0, 3).map(c => c.symbol) ?? [];
  if (topGrowth.length) bullets.push(`Top research candidates: ${topGrowth.join(", ")}`);
  const changes = ranking?.changes ?? [];
  const newCount = changes.filter(c => c.direction === "new").length;
  if (newCount > 0) bullets.push(`${newCount} new qualified candidate${newCount !== 1 ? "s" : ""} observed`);
  const content = bullets.length
    ? `Market overview for this reporting period. ${bullets.join(". ")}.`
    : "Market overview data is not yet available for this reporting period.";
  return _section("market_overview", "Market Overview", content, bullets, { regime, topGrowth, newCount }, sortOrder);
}

function _buildSectorSummarySection(data: ReportDataBundle, sortOrder: number): ReportSection {
  const sectors = data.sectors.slice(0, 8);
  const bullets = sectors.map(s => {
    const delta = (s.changes as any)?.scoreDelta;
    const dir   = typeof delta === "number" && delta > 0 ? "↑" : typeof delta === "number" && delta < 0 ? "↓" : "→";
    return `${s.sector}: ${s.label} (score ${s.score}) ${dir}`;
  });
  const content = sectors.length
    ? `Sector intelligence for this reporting period. ${sectors.length} sector${sectors.length !== 1 ? "s" : ""} analysed.`
    : "Sector intelligence not yet available.";
  return _section("sector_summary", "Sector Research Summary", content, bullets,
    { sectors: sectors.map(s => ({ sector: s.sector, score: s.score, label: s.label })) }, sortOrder);
}

function _buildThemeSummarySection(data: ReportDataBundle, sortOrder: number): ReportSection {
  const themes = data.themes.slice(0, 8);
  const bullets = themes.map(t => {
    const delta = (t.changes as any)?.scoreDelta;
    const dir   = typeof delta === "number" && delta > 0 ? "↑" : typeof delta === "number" && delta < 0 ? "↓" : "→";
    return `${t.themeName}: ${t.label} (score ${t.score}) ${dir}`;
  });
  const content = themes.length
    ? `Theme intelligence for this reporting period. ${themes.length} theme${themes.length !== 1 ? "s" : ""} tracked.`
    : "Theme intelligence not yet available.";
  return _section("theme_summary", "Investment Theme Summary", content, bullets,
    { themes: themes.map(t => ({ themeId: t.themeId, name: t.themeName, score: t.score, label: t.label })) }, sortOrder);
}

function _buildInstitutionalSection(data: ReportDataBundle, sortOrder: number): ReportSection {
  const opps   = data.intel?.opportunities ?? [];
  const withInst = opps.filter(o => (o as any).institutionalScore != null).slice(0, 5);
  const bullets  = withInst.map(o => `${o.symbol}: institutional score ${(o as any).institutionalScore ?? "N/A"}`);
  const content  = withInst.length
    ? `Institutional intelligence observed for ${withInst.length} research candidate${withInst.length !== 1 ? "s" : ""}.`
    : "Institutional intelligence data not yet available.";
  return _section("institutional_summary", "Institutional Research Summary", content, bullets,
    { count: withInst.length }, sortOrder);
}

function _buildResearchCandidateSection(data: ReportDataBundle, sortOrder: number): ReportSection {
  const opps    = data.intel?.opportunities ?? [];
  const top     = opps.slice(0, 10);
  const bullets = top.map(o => `${o.symbol}${o.companyName ? ` (${o.companyName})` : ""}: research score ${o.researchScore}`);
  const content = top.length
    ? `${top.length} top research candidate${top.length !== 1 ? "s" : ""} identified. All scores are deterministic and based on qualification rules.`
    : "No research candidates available. Run the opportunity engine to populate data.";
  return _section("research_candidate_summary", "Research Candidate Summary", content, bullets,
    { candidateCount: top.length, symbols: top.map(o => o.symbol) }, sortOrder);
}

function _buildMonitoringSection(data: ReportDataBundle, sortOrder: number): ReportSection {
  const ws    = data.watchSection;
  const count = ws?.watchCount ?? 0;
  const active = ws?.activeWatchCount ?? 0;
  const changes = ws?.recentChanges ?? [];
  const bullets = changes.slice(0, 5).map(c => `${c.watchName}: ${c.changeSummary}`);
  const content = count > 0
    ? `Research monitoring: ${active} active watch${active !== 1 ? "es" : ""} tracking ${count} configured monitor${count !== 1 ? "s" : ""}. ${changes.length} recent change${changes.length !== 1 ? "s" : ""} observed.`
    : "No research watches configured. Visit /research-monitor to create your first research watch.";
  return _section("research_monitoring_summary", "Research Monitoring Summary", content, bullets,
    { watchCount: count, activeWatchCount: active, recentChanges: changes.length }, sortOrder);
}

function _buildCollectionSection(data: ReportDataBundle, sortOrder: number): ReportSection {
  const cols    = data.collections.slice(0, 8);
  const bullets = cols.map(c => `${c.name}: ${c.symbolCount ?? 0} symbols`);
  const content = cols.length
    ? `${cols.length} research collection${cols.length !== 1 ? "s" : ""} summarised.`
    : "No research collections available.";
  return _section("collection_summary", "Research Collection Summary", content, bullets,
    { collectionCount: cols.length, collections: cols.map(c => ({ id: c.id, name: c.name, symbolCount: c.symbolCount ?? 0 })) }, sortOrder);
}

function _buildRiskSection(riskFactors: string[], sortOrder: number): ReportSection {
  const content = riskFactors.length
    ? `${riskFactors.length} risk factor${riskFactors.length !== 1 ? "s" : ""} relevant to this reporting period.`
    : "Standard risk factors apply. Research intelligence does not remove market risk.";
  return _section("risk_summary", "Risk Factors", content, riskFactors, {}, sortOrder);
}

function _buildMethodologySection(reportType: ReportType, sortOrder: number): ReportSection {
  const content =
    `This ${REPORT_TYPE_LABELS[reportType]} was generated by the VCP Trader AI Research Engine. ` +
    `All intelligence is sourced from precomputed stores: opportunity ranking engine, sector/theme intelligence snapshots, ` +
    `institutional intelligence, research collections, and research monitoring. ` +
    `No new market data scans, rankings, or calculations were performed at report generation time. ` +
    `Score thresholds: qualification requires ≥70 research score. Change detection threshold: ±5 points for most signals.`;
  return _section("methodology", "Research Methodology", content, [], { reportType }, sortOrder);
}

function _buildAppendixSection(data: ReportDataBundle, sortOrder: number): ReportSection {
  const freshness = _computeFreshness(data);
  const bullets = [
    `Ranking data: ${freshness.rankingAt ?? "Not available"}`,
    `Theme data: ${freshness.themeAt ?? "Not available"}`,
    `Sector data: ${freshness.sectorAt ?? "Not available"}`,
    `Intelligence data: ${freshness.intelAt ?? "Not available"}`,
  ];
  return _section("appendix", "Data Sources & Freshness", bullets.join("\n"), bullets, { freshness }, sortOrder);
}

// ---------------------------------------------------------------------------
// Risk factors (deterministic)
// ---------------------------------------------------------------------------

function _buildRiskFactors(data: ReportDataBundle): string[] {
  const factors: string[] = [
    "Research intelligence reflects data available at report generation time and may not capture intraday developments.",
    "All research scores are deterministic outputs of predefined rules and do not constitute personalised advice.",
    "Market conditions can change rapidly; research findings may become stale within hours of generation.",
  ];
  if (!data.ranking) factors.push("Opportunity ranking data is currently unavailable — some sections may show limited intelligence.");
  if (data.themes.length === 0) factors.push("Theme intelligence snapshots are not yet available.");
  if (data.sectors.length === 0) factors.push("Sector intelligence snapshots are not yet available.");
  return factors;
}

// ---------------------------------------------------------------------------
// Data freshness
// ---------------------------------------------------------------------------

function _computeFreshness(data: ReportDataBundle): DataFreshnessInfo {
  return {
    rankingAt:  data.ranking?.generatedAt ?? null,
    themeAt:    data.themes[0]?.generatedAt ?? null,
    sectorAt:   data.sectors[0]?.generatedAt ?? null,
    intelAt:    data.intel?.generatedAt ?? null,
    reportedAt: new Date().toISOString(),
  };
}

function _freshnessLabel(info: DataFreshnessInfo): string {
  const sources = [info.rankingAt, info.themeAt, info.sectorAt, info.intelAt].filter(Boolean) as string[];
  if (!sources.length) return "No precomputed data available";
  const oldest = sources.reduce((a, b) => (a < b ? a : b));
  const ageMs  = Date.now() - new Date(oldest).getTime();
  const ageH   = Math.round(ageMs / 3_600_000);
  return ageH < 2 ? "Fresh (< 2 hours)" : ageH < 12 ? `${ageH}h ago` : `${Math.round(ageH / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Content builders per report type
// ---------------------------------------------------------------------------

function _buildExecutiveSummary(reportType: ReportType, data: ReportDataBundle): string {
  const ranking = data.ranking;
  const regime  = ranking?.regime ?? data.intel?.marketRegime ?? "Unknown";
  const opps    = data.intel?.opportunities ?? [];
  const newCount = (ranking?.changes ?? []).filter(c => c.direction === "new").length;
  const label   = REPORT_TYPE_LABELS[reportType];

  switch (reportType) {
    case "morning_brief":
      return `${label}: ${opps.length} research candidates tracked in ${regime} regime. ${newCount > 0 ? `${newCount} new candidate${newCount !== 1 ? "s" : ""} observed.` : "No new candidates this session."} Review key findings below before market open.`;
    case "evening_summary":
      return `${label}: End-of-day research recap. ${opps.length} research candidates active in ${regime} regime. ${(ranking?.changes ?? []).length} observed change${(ranking?.changes ?? []).length !== 1 ? "s" : ""} recorded today.`;
    case "market_changes":
      return `${label}: Observed changes in research intelligence. ${newCount} new candidate${newCount !== 1 ? "s" : ""}. Market regime: ${regime}.`;
    case "weekly_market_intel":
      return `${label}: Weekly market intelligence summary across all research sources. ${opps.length} total candidates, ${data.themes.length} themes, ${data.sectors.length} sectors tracked.`;
    case "weekly_ai_infrastructure":
      return `${label}: AI infrastructure sector research. Tracking compute, data centres, and AI platform research candidates.`;
    case "weekly_semiconductor":
      return `${label}: Semiconductor sector research. Tracking chip manufacturers, equipment, and materials research candidates.`;
    case "weekly_memory":
      return `${label}: Memory and storage sector research. Tracking DRAM, NAND, and storage infrastructure candidates.`;
    case "weekly_cloud":
      return `${label}: Cloud infrastructure research. Tracking cloud platform, SaaS, and enterprise software candidates.`;
    case "weekly_cybersecurity":
      return `${label}: Cybersecurity sector research. Tracking network security, endpoint protection, and identity management candidates.`;
    case "weekly_institutional":
      return `${label}: Institutional ownership activity research. Summarising 13F intelligence from precomputed institutional data.`;
    case "weekly_sector_leadership":
      return `${label}: Sector leadership research. ${data.sectors.length} sector${data.sectors.length !== 1 ? "s" : ""} scored. Review which sectors show the strongest research evidence.`;
    case "weekly_theme_leadership":
      return `${label}: Investment theme leadership research. ${data.themes.length} theme${data.themes.length !== 1 ? "s" : ""} tracked. Review theme score movements.`;
    case "collection_summary":
      return `${label}: Research collection overview. ${data.collections.length} collection${data.collections.length !== 1 ? "s" : ""} summarised. View your curated symbol lists and their current research scores.`;
    case "research_monitoring_summary":
      return `${label}: Research monitoring activity. ${data.watchSection?.activeWatchCount ?? 0} active watch${(data.watchSection?.activeWatchCount ?? 0) !== 1 ? "es" : ""} evaluated. ${data.watchSection?.recentChanges?.length ?? 0} observed change${(data.watchSection?.recentChanges?.length ?? 0) !== 1 ? "s" : ""} recorded.`;
    case "opportunity_intel_summary":
      return `${label}: Opportunity intelligence overview. ${opps.length} research candidate${opps.length !== 1 ? "s" : ""} scored across all sectors and themes. Market regime: ${regime}.`;
    case "workspace_summary":
      return `${label}: AI Research Workspace activity summary. Review recent research conversations and findings.`;
    default:
      return `${label} generated by VCP Trader AI Research Engine. ${opps.length} research candidates tracked.`;
  }
}

function _buildKeyFindings(reportType: ReportType, data: ReportDataBundle): string[] {
  const ranking  = data.ranking;
  const changes  = ranking?.changes ?? [];
  const opps     = data.intel?.opportunities ?? [];
  const newItems = changes.filter(c => c.direction === "new").map(c => c.symbol);
  const upgraded = changes.filter(c => c.direction === "upgraded").map(c => c.symbol);
  const downgraded = changes.filter(c => c.direction === "downgraded").map(c => c.symbol);
  const findings: string[] = [];

  if (data.ranking?.regime) findings.push(`Market regime: ${data.ranking.regime}`);
  if (opps.length > 0) findings.push(`${opps.length} research candidate${opps.length !== 1 ? "s" : ""} currently tracked`);
  if (newItems.length > 0) findings.push(`New qualified candidate${newItems.length !== 1 ? "s" : ""}: ${newItems.slice(0, 5).join(", ")}${newItems.length > 5 ? " and more" : ""}`);
  if (upgraded.length > 0) findings.push(`Research score improved: ${upgraded.slice(0, 3).join(", ")}`);
  if (downgraded.length > 0) findings.push(`Research score declined: ${downgraded.slice(0, 3).join(", ")}`);
  if (data.themes.length > 0) {
    const topTheme = data.themes[0];
    findings.push(`Top theme: ${topTheme.themeName} (score ${topTheme.score})`);
  }
  if (data.sectors.length > 0) {
    const topSector = data.sectors[0];
    findings.push(`Top sector: ${topSector.sector} (score ${topSector.score})`);
  }
  // Type-specific
  if (reportType === "research_monitoring_summary" && data.watchSection) {
    if (data.watchSection.recentChanges.length > 0) {
      findings.push(`${data.watchSection.recentChanges.length} watch update${data.watchSection.recentChanges.length !== 1 ? "s" : ""} in this period`);
    }
  }
  if (reportType === "collection_summary" && data.collections.length > 0) {
    findings.push(`${data.collections.length} research collection${data.collections.length !== 1 ? "s" : ""} summarised`);
  }
  return findings.length ? findings : ["No research intelligence data available for this report period."];
}

function _buildSupportingEvidence(data: ReportDataBundle): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  const ranking = data.ranking;
  if (ranking) {
    evidence.push({
      label: "Opportunity Ranking",
      value: `${(ranking.topGrowth?.length ?? 0) + (ranking.topIncome?.length ?? 0)} candidates`,
      context: `Generated at ${ranking.generatedAt}`,
      source: "Opportunity Ranking Engine",
      dataDate: ranking.generatedAt,
    });
  }
  if (data.themes.length > 0) {
    evidence.push({
      label: "Theme Intelligence",
      value: `${data.themes.length} theme${data.themes.length !== 1 ? "s" : ""}`,
      context: `Top: ${data.themes[0]?.themeName ?? "N/A"} (${data.themes[0]?.score ?? "N/A"})`,
      source: "Theme Intelligence Engine",
      dataDate: data.themes[0]?.generatedAt ?? null,
    });
  }
  if (data.sectors.length > 0) {
    evidence.push({
      label: "Sector Intelligence",
      value: `${data.sectors.length} sector${data.sectors.length !== 1 ? "s" : ""}`,
      context: `Top: ${data.sectors[0]?.sector ?? "N/A"} (${data.sectors[0]?.score ?? "N/A"})`,
      source: "Sector Intelligence Engine",
      dataDate: data.sectors[0]?.generatedAt ?? null,
    });
  }
  if (data.intel) {
    evidence.push({
      label: "Opportunity Intelligence",
      value: `${data.intel.opportunities.length} candidate${data.intel.opportunities.length !== 1 ? "s" : ""}`,
      context: `Market regime: ${data.intel.marketRegime ?? "Unknown"}`,
      source: "Opportunity Intelligence Engine",
      dataDate: data.intel.generatedAt,
    });
  }
  if (data.collections.length > 0) {
    evidence.push({
      label: "Research Collections",
      value: `${data.collections.length} collection${data.collections.length !== 1 ? "s" : ""}`,
      context: null,
      source: "Research Collection Service",
      dataDate: null,
    });
  }
  return evidence;
}

function _buildSectionsForType(reportType: ReportType, data: ReportDataBundle): ReportSection[] {
  const sections: ReportSection[] = [];
  let order = 1;

  // Executive summary is always first
  sections.push(_buildExecutiveSummarySection(_buildExecutiveSummary(reportType, data), order++));

  // Market overview for market-wide reports
  if (["morning_brief","evening_summary","market_changes","weekly_market_intel",
       "opportunity_intel_summary"].includes(reportType)) {
    sections.push(_buildMarketOverviewSection(data, order++));
  }

  // Candidate section for most reports
  if (!["collection_summary","research_monitoring_summary","workspace_summary"].includes(reportType)) {
    sections.push(_buildResearchCandidateSection(data, order++));
  }

  // Sector section
  if (["morning_brief","weekly_market_intel","weekly_sector_leadership",
       "opportunity_intel_summary","weekly_institutional"].includes(reportType)) {
    sections.push(_buildSectorSummarySection(data, order++));
  }

  // Theme section
  if (["morning_brief","weekly_market_intel","weekly_theme_leadership",
       "opportunity_intel_summary","weekly_ai_infrastructure","weekly_semiconductor",
       "weekly_memory","weekly_cloud","weekly_cybersecurity"].includes(reportType)) {
    sections.push(_buildThemeSummarySection(data, order++));
  }

  // Institutional section
  if (["weekly_institutional","opportunity_intel_summary","weekly_market_intel"].includes(reportType)) {
    sections.push(_buildInstitutionalSection(data, order++));
  }

  // Collection section
  if (["collection_summary","morning_brief","opportunity_intel_summary"].includes(reportType)) {
    sections.push(_buildCollectionSection(data, order++));
  }

  // Monitoring section
  if (["research_monitoring_summary","morning_brief","evening_summary"].includes(reportType)) {
    sections.push(_buildMonitoringSection(data, order++));
  }

  // Risk section — always present
  sections.push(_buildRiskSection(_buildRiskFactors(data), order++));

  // Methodology — always present
  sections.push(_buildMethodologySection(reportType, order++));

  // Appendix — always last
  sections.push(_buildAppendixSection(data, order++));

  return sections.sort((a, b) => a.sortOrder - b.sortOrder);
}

function _buildContent(reportType: ReportType, data: ReportDataBundle): ReportContent {
  const freshness     = _computeFreshness(data);
  const keyFindings   = _buildKeyFindings(reportType, data);
  const evidence      = _buildSupportingEvidence(data);
  const riskFactors   = _buildRiskFactors(data);
  const sections      = _buildSectionsForType(reportType, data);
  const executiveSummary = _buildExecutiveSummary(reportType, data);

  return {
    executiveSummary,
    keyFindings,
    supportingEvidence: evidence,
    riskFactors,
    methodology: sections.find(s => s.sectionType === "methodology")?.content ??
      "Report generated from precomputed intelligence. No recomputation performed.",
    dataFreshness: freshness,
    disclaimer: RESEARCH_DISCLAIMER,
    sections,
  };
}

// ---------------------------------------------------------------------------
// Row → domain mapper
// ---------------------------------------------------------------------------

function _rowToReport(row: ResearchReportRow): ResearchReport {
  return {
    id:           row.id,
    userId:       row.userId,
    title:        row.title,
    subtitle:     row.subtitle ?? null,
    reportType:   row.reportType as ResearchReport["reportType"],
    status:       row.status as ReportStatus,
    isPinned:     row.isPinned,
    generatedAt:  row.generatedAt.toISOString(),
    dataFreshness: row.dataFreshness ?? null,
    marketRegime:  row.marketRegime ?? null,
    author:        row.author,
    version:       row.version,
    disclaimer:    row.disclaimer,
    content:       row.content as ReportContent,
    tags:          (row.tags as string[] | null) ?? [],
    summary:       row.summary ?? null,
    createdAt:     (row.createdAt ?? new Date()).toISOString(),
    updatedAt:     (row.updatedAt ?? new Date()).toISOString(),
  };
}

function _toShortCard(report: ResearchReport): ReportShortCard {
  return {
    reportId:     report.id,
    title:        report.title,
    reportType:   report.reportType,
    typeLabel:    REPORT_TYPE_LABELS[report.reportType] ?? report.reportType,
    generatedAt:  report.generatedAt,
    marketRegime: report.marketRegime,
    summary:      report.summary,
    isPinned:     report.isPinned,
    status:       report.status,
    linkTo:       `/research-reports/${report.id}`,
  };
}

// ---------------------------------------------------------------------------
// ID generator
// ---------------------------------------------------------------------------

function _newId(): string {
  return `rpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Public API — generate
// ---------------------------------------------------------------------------

export async function generateReport(
  userId: string,
  reportType: ReportType,
  options: GenerateReportOptions = {}
): Promise<ResearchReport> {
  const t0 = Date.now();

  // Parallel fetch from precomputed stores — no rescanning, no reranking
  const [themes, sectors, intel, collections, watchSection] = await Promise.all([
    getLatestThemeSnapshots(),
    getLatestSectorSnapshots(),
    getOpportunityIntelligence(),
    listCollections(userId).catch(() => [] as Awaited<ReturnType<typeof listCollections>>),
    buildMyWatchChangesSection(userId).catch(() => null),
  ]);
  const ranking = getLatestRanking(); // synchronous

  const data: ReportDataBundle = { ranking, themes, sectors, intel, collections, watchSection };
  const content = _buildContent(reportType, data);
  const freshness = _computeFreshness(data);

  const title        = options.title ?? REPORT_TYPE_LABELS[reportType];
  const subtitle     = options.subtitle ?? REPORT_TYPE_SUBTITLES[reportType] ?? null;
  const marketRegime = ranking?.regime ?? intel?.marketRegime ?? null;
  const freshnessLabel = _freshnessLabel(freshness);

  const [row] = await db.insert(researchReports).values({
    id:           _newId(),
    userId,
    title,
    subtitle,
    reportType,
    status:       "published",
    isPinned:     false,
    generatedAt:  new Date(),
    dataFreshness: freshnessLabel,
    marketRegime,
    author:       "VCP Trader AI Research Engine",
    version:      1,
    disclaimer:   RESEARCH_DISCLAIMER,
    content,
    tags:         options.tags ?? [],
    summary:      content.executiveSummary.slice(0, 300),
  }).returning();

  console.log(`[research-reports] Generated "${title}" in ${Date.now() - t0}ms`);
  return _rowToReport(row);
}

// ---------------------------------------------------------------------------
// Public API — list / search
// ---------------------------------------------------------------------------

export async function listReports(
  userId: string,
  options: ReportSearchOptions = {}
): Promise<ResearchReport[]> {
  const conditions: any[] = [eq(researchReports.userId, userId)];

  // Status filter (default: exclude archived)
  const status = options.status ?? "published";
  if (status) conditions.push(eq(researchReports.status, status));

  // Optional filters
  if (options.reportType) {
    const types = Array.isArray(options.reportType) ? options.reportType : [options.reportType];
    conditions.push(
      types.length === 1
        ? eq(researchReports.reportType, types[0])
        : sql`${researchReports.reportType} = ANY(ARRAY[${sql.join(types.map(t => sql`${t}`), sql`, `)}])`
    );
  }
  if (options.isPinned !== undefined) {
    conditions.push(eq(researchReports.isPinned, options.isPinned));
  }
  if (options.marketRegime) {
    conditions.push(eq(researchReports.marketRegime, options.marketRegime));
  }
  if (options.keyword) {
    const kw = `%${options.keyword.toLowerCase()}%`;
    conditions.push(
      or(
        like(sql`lower(${researchReports.title})`, kw),
        like(sql`lower(${researchReports.summary})`, kw)
      )
    );
  }

  const sortDir = options.sortDir === "asc" ? asc : desc;
  const sortCol =
    options.sortBy === "title"      ? researchReports.title :
    options.sortBy === "reportType" ? researchReports.reportType :
                                      researchReports.generatedAt;

  const rows = await db
    .select()
    .from(researchReports)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .orderBy(
      desc(researchReports.isPinned), // pinned first
      sortDir(sortCol)
    )
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0);

  return rows.map(_rowToReport);
}

// ---------------------------------------------------------------------------
// Public API — get single
// ---------------------------------------------------------------------------

export async function getReport(reportId: string, userId: string): Promise<ResearchReport | null> {
  const rows = await db
    .select()
    .from(researchReports)
    .where(and(eq(researchReports.id, reportId), eq(researchReports.userId, userId)))
    .limit(1);
  return rows.length > 0 ? _rowToReport(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Public API — update
// ---------------------------------------------------------------------------

export async function updateReport(
  reportId: string,
  userId: string,
  updates: ReportUpdateInput
): Promise<ResearchReport | null> {
  const patch: Partial<typeof researchReports.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (updates.title    !== undefined) patch.title    = updates.title;
  if (updates.isPinned !== undefined) patch.isPinned = updates.isPinned;
  if (updates.status   !== undefined) patch.status   = updates.status;
  if (updates.tags     !== undefined) patch.tags     = updates.tags;

  const rows = await db
    .update(researchReports)
    .set(patch)
    .where(and(eq(researchReports.id, reportId), eq(researchReports.userId, userId)))
    .returning();

  return rows.length > 0 ? _rowToReport(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Public API — delete (soft)
// ---------------------------------------------------------------------------

export async function deleteReport(reportId: string, userId: string): Promise<boolean> {
  const rows = await db
    .update(researchReports)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(researchReports.id, reportId), eq(researchReports.userId, userId)))
    .returning();
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Public API — export
// ---------------------------------------------------------------------------

export async function exportReport(
  reportId: string,
  userId: string,
  format: ExportFormat
): Promise<string | Record<string, unknown> | null> {
  const report = await getReport(reportId, userId);
  if (!report) return null;
  return _renderExport(report, format);
}

function _renderExport(report: ResearchReport, format: ExportFormat): string | Record<string, unknown> {
  switch (format) {
    case "html":     return _renderHtml(report);
    case "markdown": return _renderMarkdown(report);
    case "json":     return report.content as unknown as Record<string, unknown>;
    case "pdf_ready":  return _renderPdfReady(report);
    case "ppt_ready":  return _renderPptReady(report);
    default:         return _renderHtml(report);
  }
}

function _renderHtml(report: ResearchReport): string {
  const c = report.content;
  const sectionsHtml = c.sections.map(s => `
  <section class="report-section" data-type="${s.sectionType}">
    <h2>${_escapeHtml(s.title)}</h2>
    <p>${_escapeHtml(s.content)}</p>
    ${s.bullets.length ? `<ul>${s.bullets.map(b => `<li>${_escapeHtml(b)}</li>`).join("")}</ul>` : ""}
  </section>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${_escapeHtml(report.title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; color: #1a1a2e; line-height: 1.6; }
    h1 { border-bottom: 2px solid #334155; padding-bottom: .5rem; }
    .report-meta { color: #64748b; font-size: .875rem; margin-bottom: 1.5rem; }
    .report-section { margin: 1.5rem 0; padding: 1rem; border: 1px solid #e2e8f0; border-radius: 6px; }
    .key-findings { background: #f8fafc; padding: 1rem; border-left: 3px solid #3b82f6; }
    .disclaimer { font-size: .75rem; color: #64748b; border-top: 1px solid #e2e8f0; margin-top: 2rem; padding-top: 1rem; }
  </style>
</head>
<body>
  <h1>${_escapeHtml(report.title)}</h1>
  ${report.subtitle ? `<p class="report-meta">${_escapeHtml(report.subtitle)}</p>` : ""}
  <div class="report-meta">
    Generated: ${report.generatedAt} | Author: ${report.author} | Freshness: ${report.dataFreshness ?? "N/A"}
    ${report.marketRegime ? ` | Market Regime: ${report.marketRegime}` : ""}
  </div>
  <div class="key-findings">
    <h2>Key Findings</h2>
    <ul>${c.keyFindings.map(f => `<li>${_escapeHtml(f)}</li>`).join("")}</ul>
  </div>
${sectionsHtml}
  <p class="disclaimer">${_escapeHtml(c.disclaimer)}</p>
</body>
</html>`;
}

function _renderMarkdown(report: ResearchReport): string {
  const c = report.content;
  const lines: string[] = [
    `# ${report.title}`,
    report.subtitle ? `\n_${report.subtitle}_\n` : "",
    `**Generated:** ${report.generatedAt}  `,
    `**Author:** ${report.author}  `,
    `**Data Freshness:** ${report.dataFreshness ?? "N/A"}  `,
    report.marketRegime ? `**Market Regime:** ${report.marketRegime}  ` : "",
    "",
    "## Executive Summary",
    "",
    c.executiveSummary,
    "",
    "## Key Findings",
    "",
    ...c.keyFindings.map(f => `- ${f}`),
    "",
    ...c.sections.map(s => [
      `## ${s.title}`,
      "",
      s.content,
      "",
      ...(s.bullets.length ? s.bullets.map(b => `- ${b}`) : []),
      "",
    ].join("\n")),
    "---",
    "",
    `*${c.disclaimer}*`,
  ];
  return lines.filter(l => l !== undefined).join("\n");
}

function _renderPdfReady(report: ResearchReport): Record<string, unknown> {
  const c = report.content;
  return {
    format:    "pdf_ready",
    version:   "1.0",
    metadata:  { title: report.title, subtitle: report.subtitle, author: report.author, generatedAt: report.generatedAt, marketRegime: report.marketRegime, dataFreshness: report.dataFreshness },
    pages: [
      { pageType: "cover",    content: { title: report.title, subtitle: report.subtitle, author: report.author, date: report.generatedAt, regime: report.marketRegime } },
      { pageType: "summary",  content: { heading: "Executive Summary", body: c.executiveSummary, keyFindings: c.keyFindings } },
      ...c.sections.map((s, i) => ({ pageType: "section", pageNumber: i + 3, content: { heading: s.title, body: s.content, bullets: s.bullets, sectionType: s.sectionType } })),
      { pageType: "evidence", content: { heading: "Supporting Evidence", items: c.supportingEvidence } },
      { pageType: "risk",     content: { heading: "Risk Factors", items: c.riskFactors } },
      { pageType: "disclaimer", content: { body: c.disclaimer } },
    ],
    pageBreakHints: c.sections.map((_, i) => i + 3),
    totalPages: c.sections.length + 4,
  };
}

function _renderPptReady(report: ResearchReport): Record<string, unknown> {
  const c = report.content;
  return {
    format:    "ppt_ready",
    version:   "1.0",
    metadata:  { title: report.title, author: report.author, generatedAt: report.generatedAt },
    slides: [
      { slideType: "title",   content: { title: report.title, subtitle: report.subtitle ?? REPORT_TYPE_LABELS[report.reportType], date: report.generatedAt } },
      { slideType: "agenda",  content: { title: "Agenda", bullets: c.sections.map(s => s.title) } },
      { slideType: "summary", content: { title: "Executive Summary", body: c.executiveSummary, bullets: c.keyFindings.slice(0, 6) } },
      ...c.sections
          .filter(s => s.sectionType !== "executive_summary")
          .map(s => ({ slideType: "section", content: { title: s.title, body: s.content, bullets: s.bullets.slice(0, 8), data: s.data } })),
      { slideType: "risk",       content: { title: "Risk Factors", bullets: c.riskFactors } },
      { slideType: "disclaimer", content: { title: "Disclaimer", body: c.disclaimer, fontSizePt: 8 } },
    ],
    totalSlides: c.sections.length + 4,
  };
}

function _escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Command Center integration
// ---------------------------------------------------------------------------

export async function buildLatestReportSection(userId: string): Promise<LatestReportSection> {
  const base: LatestReportSection = {
    available:        false,
    latestReport:     null,
    recentReports:    [],
    reportsToday:     0,
    lastGeneratedAt:  null,
    generateShortcut: "/research-reports",
    viewAllShortcut:  "/research-reports",
  };

  try {
    const [latest, todayRows] = await Promise.all([
      db.select().from(researchReports)
        .where(and(eq(researchReports.userId, userId), eq(researchReports.status, "published")))
        .orderBy(desc(researchReports.generatedAt))
        .limit(5),
      db.select({ id: researchReports.id })
        .from(researchReports)
        .where(and(
          eq(researchReports.userId, userId),
          eq(researchReports.status, "published"),
          sql`${researchReports.generatedAt} >= NOW() - INTERVAL '24 hours'`
        )),
    ]);

    if (latest.length === 0) return base;

    const reports = latest.map(r => _toShortCard(_rowToReport(r)));
    return {
      available:        true,
      latestReport:     reports[0],
      recentReports:    reports.slice(1),
      reportsToday:     todayRows.length,
      lastGeneratedAt:  reports[0].generatedAt,
      generateShortcut: "/research-reports",
      viewAllShortcut:  "/research-reports",
    };
  } catch {
    return base;
  }
}

// ---------------------------------------------------------------------------
// Platform Health
// ---------------------------------------------------------------------------

export async function getResearchReportsHealth(): Promise<ResearchReportsHealth> {
  try {
    const t0 = Date.now();
    const [totalRows, todayRows, latestRow] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(researchReports),
      db.select({ count: sql<number>`count(*)::int` }).from(researchReports)
        .where(sql`${researchReports.generatedAt} >= NOW() - INTERVAL '24 hours'`),
      db.select({ generatedAt: researchReports.generatedAt, reportType: researchReports.reportType })
        .from(researchReports)
        .orderBy(desc(researchReports.generatedAt))
        .limit(1),
    ]);
    const generationTimeMs = Date.now() - t0;

    // Type breakdown (last 90 days)
    const typeRows = await db
      .select({ reportType: researchReports.reportType, count: sql<number>`count(*)::int` })
      .from(researchReports)
      .where(sql`${researchReports.generatedAt} >= NOW() - INTERVAL '90 days'`)
      .groupBy(researchReports.reportType);

    const breakdown: Partial<Record<ReportType, number>> = {};
    for (const r of typeRows) breakdown[r.reportType as ReportType] = r.count;

    return {
      reportsGenerated:   totalRows[0]?.count ?? 0,
      reportsToday:       todayRows[0]?.count ?? 0,
      latestReport:       latestRow[0]?.generatedAt?.toISOString() ?? null,
      generationTimeMs,
      storageHealth:      "ok",
      reportTypeBreakdown: breakdown,
    };
  } catch {
    return {
      reportsGenerated: 0, reportsToday: 0, latestReport: null,
      generationTimeMs: null, storageHealth: "unknown", reportTypeBreakdown: {},
    };
  }
}

// ---------------------------------------------------------------------------
// Startup migration
// ---------------------------------------------------------------------------

export async function ensureResearchReportsTables(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS research_reports (
        id             VARCHAR(128) PRIMARY KEY,
        user_id        VARCHAR(128) NOT NULL,
        title          TEXT NOT NULL,
        subtitle       TEXT,
        report_type    TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'published',
        is_pinned      BOOLEAN NOT NULL DEFAULT false,
        generated_at   TIMESTAMP NOT NULL,
        data_freshness TEXT,
        market_regime  TEXT,
        author         TEXT NOT NULL DEFAULT 'VCP Trader AI Research Engine',
        version        INTEGER NOT NULL DEFAULT 1,
        disclaimer     TEXT NOT NULL,
        content        JSONB NOT NULL,
        exports        JSONB,
        tags           TEXT[],
        summary        TEXT,
        created_at     TIMESTAMP DEFAULT NOW(),
        updated_at     TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rr_user_id      ON research_reports (user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rr_status        ON research_reports (user_id, status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rr_type          ON research_reports (user_id, report_type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rr_pinned        ON research_reports (user_id, is_pinned)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rr_generated_at  ON research_reports (user_id, generated_at)`);
    console.log(JSON.stringify({ event: "[research-reports] tables_ready", ts: new Date().toISOString() }));
  } catch (err: any) {
    console.error("[research-reports] table init failed:", err?.message);
  }
}
