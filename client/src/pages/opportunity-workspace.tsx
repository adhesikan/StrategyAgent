// /opportunities/:symbol — Sprint 2.6.3 Opportunity Workspace v2
//
// Canonical single-security research workspace. Answers:
//   • Why is this security currently relevant?
//   • What evidence supports it?
//   • What changed?
//   • Where is evidence strengthening or weakening?
//   • What are the risks?
//   • What would invalidate the thesis?
//   • How does the sector/theme context look?
//   • What institutional evidence exists?
//   • What related research exists?
//   • How fresh is the data?
//   • What should I research next?
//
// This workspace does NOT answer:
//   • What should I buy/sell?
//   • What trade should I place?
//
// Performance contract: exactly 2 API calls.
//   Call 1 — GET /api/opportunities/today      → full ranking (in-memory)
//   Call 2 — GET /api/opportunities/workspace/:symbol → consolidated payload
//
// Compliance: no "buy/sell/recommendation/target price/expected return" language.
//             All evidence is deterministic. AI sections link out to Research Workspace.
//             13F data disclosure present wherever institutional data appears.

import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ResearchDefinitionTooltip } from "@/components/research-definition-tooltip";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  Shield,
  Building2,
  BarChart2,
  Clock,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Info,
  Users,
  Layers,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  BookOpen,
  Bell,
  FolderOpen,
  FileText,
  BrainCircuit,
  MapPin,
  Tag,
  Eye,
} from "lucide-react";
import {
  findScoredCandidate,
  getAllRankedSymbols,
  getScoreColor,
  getScoreBarBg,
  getConfidenceBadge,
  getCategoryBadge,
  type OpportunityScore,
  type ScoredCandidate,
  type WatchScoredCandidate,
  type OpportunityRanking,
  type HistoryEntry,
} from "@/lib/opportunity-workspace-helpers";

// ---------------------------------------------------------------------------
// Types (mirrored from server/routes/opportunity-workspace.ts)
// ---------------------------------------------------------------------------

interface CanonicalOpportunity {
  id: string;
  symbol: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  themes: string[];
  opportunityType: string;
  opportunityTypeLabel: string;
  researchScore: number;
  technicalScore: number;
  fundamentalScore: number;
  institutionalScore: number;
  sentimentScore: number;
  confidence: string;
  marketRegime: string | null;
  timeHorizon: string;
  riskLevel: string;
  lastUpdated: string;
  primaryEvidence: EvidenceItem[];
  secondaryEvidence: EvidenceItem[];
  riskFactors: RiskFactor[];
  invalidatesThesis: InvalidatesThesisItem[];
  _sourceCategory: string;
  _rank: number;
}

interface EvidenceItem {
  category: string;
  label: string;
  value?: string | null;
  detail?: string | null;
  strength?: string | null;
}

interface RiskFactor {
  category: string;
  label: string;
  severity?: string;
  detail?: string | null;
}

interface InvalidatesThesisItem {
  condition: string;
  detail?: string | null;
}

interface InstitutionalSignal {
  symbol: string;
  status: string;
  latestQuarter: string | null;
  previousQuarter: string | null;
  periodEndDate: string | null;
  score: number | null;
  label: string | null;
  summary: string | null;
  metrics: {
    managerCountLatest: number | null;
    managerCountPrevious: number | null;
    newManagerCount: number;
    exitedManagerCount: number;
    increasedManagerCount: number;
    reducedManagerCount: number;
  };
  concentration: {
    holderCount: number;
    topHolderSharePct: number | null;
    trend: string;
  };
  dataQuality: {
    confidence: string;
    comparableManagerCount: number;
    mappingCoverage: number | null;
  };
  freshness: {
    source: string;
    delayed: boolean;
    periodEndDate: string | null;
    calculatedAt: string | null;
  };
}

interface ChangeExplanation {
  symbol: string;
  previousRank: number | null;
  currentRank: number | null;
  previousScore: number | null;
  currentScore: number;
  scoreDelta: number | null;
  rankDelta: number | null;
  importance: "Minor" | "Moderate" | "Major" | "Critical";
  summary: string;
  drivers: string[];
  warnings: string[];
  confidence: "high" | "medium" | "low";
  category: string;
  direction: "upgraded" | "downgraded" | "new" | "moved" | "unchanged" | "removed";
}

interface SectorContext {
  sector: string;
  score: number;
  label: string;
  generatedAt: string;
  metrics: Record<string, unknown>;
  topSymbols: unknown[];
  changes: Record<string, unknown>;
}

interface ThemeContext {
  themeId: string;
  themeName: string;
  score: number;
  label: string;
  generatedAt: string;
  metrics: Record<string, unknown>;
  topSymbols: unknown[];
  changes: Record<string, unknown>;
}

interface CollectionMembership {
  collectionId: string;
  collectionName: string;
  collectionType: "system" | "user";
  systemKey: string | null;
  isMember: boolean;
  isFollowing: boolean;
  isFavorite: boolean;
}

interface MonitoringState {
  isMonitored: boolean;
  watchId: string | null;
  status: string | null;
  lastChangeAt: string | null;
  lastChangeSummary: string | null;
  recentActivityCount: number;
}

interface ReportSummary {
  reportId: string;
  title: string;
  reportType: string;
  status: string;
  generatedAt: string | null;
  isPinned: boolean;
}

interface PortfolioContext {
  portfolioId: string;
  portfolioName: string;
  symbol: string;
  portfolioWeight: number | null;
  sector: string | null;
  industry: string | null;
  researchChange: string | null;
}

interface RelatedOpp {
  symbol: string;
  companyName: string | null;
  score: number;
  category: string;
}

interface WorkspaceFreshness {
  rankingGeneratedAt: string | null;
  institutionalDataAt: string | null;
  sectorDataAt: string | null;
  historyLatestAt: string | null;
  workspaceAssembledAt: string;
}

interface WorkspaceV2Response {
  symbol: string;
  companyName: string | null;
  opportunity: CanonicalOpportunity | null;
  history: HistoryEntry[];
  institutional: InstitutionalSignal | null;
  changeExplanation: ChangeExplanation | null;
  sectorContext: SectorContext | null;
  themeContexts: ThemeContext[];
  collections: CollectionMembership[];
  monitoring: MonitoringState;
  reports: ReportSummary[];
  portfolioContext: PortfolioContext | null;
  relatedOpportunities: RelatedOpp[];
  freshness: WorkspaceFreshness;
  limitations: string[];
}

interface OpportunityTodayResponse {
  ranking: OpportunityRanking | null;
  available: boolean;
  message: string | null;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function formatAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function scoreColor(s: number) {
  if (s >= 75) return "text-emerald-400";
  if (s >= 55) return "text-sky-400";
  if (s >= 35) return "text-amber-400";
  return "text-rose-400";
}

function labelBadgeClass(label: string) {
  switch (label) {
    case "Strong": return "bg-emerald-900/40 text-emerald-300 border-emerald-800";
    case "Improving": return "bg-sky-900/40 text-sky-300 border-sky-800";
    case "Mixed": return "bg-amber-900/40 text-amber-300 border-amber-800";
    case "Weakening": return "bg-orange-900/40 text-orange-300 border-orange-800";
    case "Weak": return "bg-rose-900/40 text-rose-300 border-rose-800";
    default: return "bg-slate-800 text-slate-400 border-slate-700";
  }
}

function riskLevelBadge(level: string) {
  switch (level?.toLowerCase()) {
    case "low": return "bg-emerald-900/40 text-emerald-300 border-emerald-800";
    case "moderate": return "bg-amber-900/40 text-amber-300 border-amber-800";
    case "high": return "bg-rose-900/40 text-rose-300 border-rose-800";
    default: return "bg-slate-800 text-slate-400 border-slate-700";
  }
}

function directionIcon(dir: string) {
  if (dir === "upgraded" || dir === "new") return <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />;
  if (dir === "downgraded" || dir === "removed") return <TrendingDown className="h-3.5 w-3.5 text-rose-400" />;
  return <Minus className="h-3.5 w-3.5 text-slate-500" />;
}

// ---------------------------------------------------------------------------
// Score bar component
// ---------------------------------------------------------------------------

function ScoreBar({ label, score, glossaryKey }: { label: string; score: number | null; glossaryKey?: string }) {
  if (score == null) return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-600">—</span>
    </div>
  );
  const bar = (
    <div className="flex items-center gap-2 text-xs flex-1">
      <span className="w-20 text-slate-400 shrink-0">{label}</span>
      <div className="flex-1 bg-slate-800 rounded-full h-1.5 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", getScoreBarBg(score))}
          style={{ width: `${Math.min(100, score)}%` }}
        />
      </div>
      <span className={cn("w-8 text-right font-mono tabular-nums", scoreColor(score))}>{score}</span>
    </div>
  );
  if (glossaryKey) {
    return (
      <ResearchDefinitionTooltip term={glossaryKey as any}>
        {bar}
      </ResearchDefinitionTooltip>
    );
  }
  return bar;
}

// ---------------------------------------------------------------------------
// Research Snapshot card
// ---------------------------------------------------------------------------

function ResearchSnapshotCard({ opportunity, changeExplanation, freshness }: {
  opportunity: CanonicalOpportunity;
  changeExplanation: ChangeExplanation | null;
  freshness: WorkspaceFreshness;
}) {
  const trendLabel =
    changeExplanation?.direction === "upgraded" || changeExplanation?.direction === "new" ? "Strengthening" :
    changeExplanation?.direction === "downgraded" ? "Weakening" :
    changeExplanation?.direction === "unchanged" ? "Stable" :
    "Unknown";

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-400 flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-sky-400" />
          Research Snapshot
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-slate-500 mb-0.5">Classification</div>
            <div className="text-slate-200 font-medium">{opportunity.opportunityTypeLabel}</div>
          </div>
          <div>
            <div className="text-slate-500 mb-0.5">Research Score</div>
            <div className={cn("font-bold tabular-nums text-lg", scoreColor(opportunity.researchScore))}>
              {opportunity.researchScore}
            </div>
          </div>
          <div>
            <div className="text-slate-500 mb-0.5">Evidence Confidence</div>
            <div className="text-slate-200 capitalize">{opportunity.confidence}</div>
          </div>
          <div>
            <div className="text-slate-500 mb-0.5">Market Context</div>
            <div className="text-slate-200">{opportunity.marketRegime ?? "—"}</div>
          </div>
          <div>
            <div className="text-slate-500 mb-0.5">Research Trend</div>
            <div className={cn(
              trendLabel === "Strengthening" ? "text-emerald-400" :
              trendLabel === "Weakening" ? "text-rose-400" : "text-slate-300"
            )}>{trendLabel}</div>
          </div>
          <div>
            <div className="text-slate-500 mb-0.5">Time Horizon</div>
            <div className="text-slate-200 capitalize">{opportunity.timeHorizon}</div>
          </div>
        </div>

        <div className="space-y-1.5 pt-1 border-t border-slate-800">
          <ScoreBar label="Technical" score={opportunity.technicalScore} glossaryKey="technical_score" />
          <ScoreBar label="Fundamental" score={opportunity.fundamentalScore} glossaryKey="fundamental_score" />
          <ScoreBar label="Institutional" score={opportunity.institutionalScore} glossaryKey="institutional_score" />
        </div>

        {freshness.rankingGeneratedAt && (
          <div className="text-[10px] text-slate-600 flex items-center gap-1 pt-1">
            <Clock className="h-3 w-3" />
            Ranking: {formatAge(freshness.rankingGeneratedAt)}
            {freshness.institutionalDataAt && (
              <>
                <span className="mx-1">·</span>
                Institutional: {formatAge(freshness.institutionalDataAt)}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Why This Qualified — evidence panel
// ---------------------------------------------------------------------------

function EvidenceGroup({ title, items, icon, colorClass }: {
  title: string;
  items: EvidenceItem[];
  icon: React.ReactNode;
  colorClass: string;
}) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <button
        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors w-full"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        {icon}
        <span className={cn("font-medium", colorClass)}>{title}</span>
        <span className="text-slate-600 ml-1">({items.length})</span>
        <span className="ml-auto">{open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</span>
      </button>
      {open && (
        <ul className="space-y-1 pl-4">
          {items.map((item, i) => (
            <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
              <span className="text-slate-600 shrink-0 mt-0.5">·</span>
              <span>
                <span className="font-medium">{item.label}</span>
                {item.value && <span className="text-slate-400"> — {item.value}</span>}
                {item.detail && <span className="text-slate-500"> ({item.detail})</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WhyThisQualifiedSection({ opportunity }: { opportunity: CanonicalOpportunity }) {
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          Why This Qualified
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <EvidenceGroup
          title="Primary Reasons"
          items={opportunity.primaryEvidence}
          icon={<TrendingUp className="h-3.5 w-3.5 text-emerald-400" />}
          colorClass="text-emerald-300"
        />
        <EvidenceGroup
          title="Supporting Context"
          items={opportunity.secondaryEvidence}
          icon={<Info className="h-3.5 w-3.5 text-sky-400" />}
          colorClass="text-sky-300"
        />
        {opportunity.invalidatesThesis.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-rose-300">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
              What Would Invalidate This Thesis
            </div>
            <ul className="space-y-1 pl-4">
              {opportunity.invalidatesThesis.map((item, i) => (
                <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
                  <span className="text-rose-700 shrink-0 mt-0.5">✕</span>
                  <span>
                    {item.condition}
                    {item.detail && <span className="text-slate-500"> — {item.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {opportunity.primaryEvidence.length === 0 && opportunity.secondaryEvidence.length === 0 && (
          <p className="text-xs text-slate-500">No evidence items available for this snapshot.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// What Changed panel
// ---------------------------------------------------------------------------

const IMPORTANCE_BORDER: Record<string, string> = {
  Critical: "border-rose-700 bg-rose-950/20",
  Major: "border-amber-700 bg-amber-950/20",
  Moderate: "border-sky-800 bg-sky-950/20",
  Minor: "border-slate-700 bg-slate-900/60",
};

function WhatChangedSection({ changeExplanation }: { changeExplanation: ChangeExplanation | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!changeExplanation) {
    return (
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="py-4">
          <p className="text-xs text-slate-500 flex items-center gap-2">
            <Activity className="h-4 w-4 text-slate-600" />
            No material research change since the previous snapshot.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (changeExplanation.direction === "unchanged") {
    return (
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="py-4">
          <p className="text-xs text-slate-400 flex items-center gap-2">
            <Minus className="h-4 w-4 text-slate-600" />
            No material research change since the previous snapshot.
          </p>
        </CardContent>
      </Card>
    );
  }

  const borderClass = IMPORTANCE_BORDER[changeExplanation.importance] ?? IMPORTANCE_BORDER.Minor;
  const scoreDeltaStr =
    changeExplanation.scoreDelta == null ? null :
    changeExplanation.scoreDelta > 0 ? `+${changeExplanation.scoreDelta}` :
    `${changeExplanation.scoreDelta}`;
  const deltaColor =
    (changeExplanation.scoreDelta ?? 0) > 0 ? "text-emerald-400" :
    (changeExplanation.scoreDelta ?? 0) < 0 ? "text-rose-400" : "text-slate-500";

  return (
    <Card className={`border ${borderClass}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
          <Activity className="h-4 w-4 text-amber-400" />
          What Changed
          {scoreDeltaStr && (
            <span className={cn("ml-auto text-xs font-mono tabular-nums", deltaColor)}>
              {scoreDeltaStr}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-200">{changeExplanation.summary}</p>

        {changeExplanation.drivers.length > 0 && (
          <>
            <button
              className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
              onClick={() => setExpanded(e => !e)}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? "Hide" : "Show"} primary drivers ({changeExplanation.drivers.length})
            </button>
            {expanded && (
              <ul className="space-y-1.5">
                {changeExplanation.drivers.map((d, i) => (
                  <li key={i} className="text-xs text-slate-300 pl-2 border-l border-slate-700">{d}</li>
                ))}
                {changeExplanation.warnings.map((w, i) => (
                  <li key={`w${i}`} className="text-xs text-amber-300 pl-2 border-l border-amber-800">⚠ {w}</li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span className="capitalize">{changeExplanation.importance} change</span>
          <span>·</span>
          <span className="capitalize">{changeExplanation.confidence} confidence</span>
          {changeExplanation.previousScore != null && (
            <>
              <span>·</span>
              <span>Prev score: {changeExplanation.previousScore}</span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Evidence Matrix (compact 7-row table)
// ---------------------------------------------------------------------------

function EvidenceMatrix({ opportunity, sectorContext, themeContexts, institutional }: {
  opportunity: CanonicalOpportunity;
  sectorContext: SectorContext | null;
  themeContexts: ThemeContext[];
  institutional: InstitutionalSignal | null;
}) {
  const rows = [
    {
      dimension: "Technical",
      score: opportunity.technicalScore,
      direction: opportunity.technicalScore >= 60 ? "Improving" : opportunity.technicalScore >= 40 ? "Stable" : "Weakening",
      confidence: opportunity.confidence,
      freshness: opportunity.lastUpdated ? formatAge(opportunity.lastUpdated) : "—",
      evidenceCount: opportunity.primaryEvidence.filter(e => e.category?.toLowerCase().includes("tech")).length,
    },
    {
      dimension: "Fundamental",
      score: opportunity.fundamentalScore,
      direction: opportunity.fundamentalScore >= 60 ? "Improving" : opportunity.fundamentalScore >= 40 ? "Stable" : "Weakening",
      confidence: opportunity.fundamentalScore > 0 ? "available" : "limited",
      freshness: opportunity.lastUpdated ? formatAge(opportunity.lastUpdated) : "—",
      evidenceCount: opportunity.primaryEvidence.filter(e => e.category?.toLowerCase().includes("fund")).length,
    },
    {
      dimension: "Institutional",
      score: institutional?.score ?? null,
      direction: institutional?.label ?? "—",
      confidence: institutional?.dataQuality?.confidence ?? "unavailable",
      freshness: institutional?.freshness?.calculatedAt ? formatAge(institutional.freshness.calculatedAt) : "—",
      evidenceCount: institutional?.metrics?.managerCountLatest ?? 0,
    },
    {
      dimension: "Sector",
      score: sectorContext?.score ?? null,
      direction: sectorContext?.label ?? "—",
      confidence: sectorContext ? "available" : "unavailable",
      freshness: sectorContext?.generatedAt ? formatAge(sectorContext.generatedAt) : "—",
      evidenceCount: sectorContext ? 1 : 0,
    },
    {
      dimension: "Theme",
      score: themeContexts.length > 0 ? Math.round(themeContexts.reduce((s, t) => s + t.score, 0) / themeContexts.length) : null,
      direction: themeContexts.length > 0 ? themeContexts[0].label : "—",
      confidence: themeContexts.length > 0 ? "available" : "unavailable",
      freshness: themeContexts[0]?.generatedAt ? formatAge(themeContexts[0].generatedAt) : "—",
      evidenceCount: themeContexts.length,
    },
    {
      dimension: "Market Regime",
      score: null as number | null,
      direction: opportunity.marketRegime ?? "—",
      confidence: opportunity.marketRegime ? "available" : "unavailable",
      freshness: opportunity.lastUpdated ? formatAge(opportunity.lastUpdated) : "—",
      evidenceCount: 0,
    },
    {
      dimension: "Risk",
      score: null as number | null,
      direction: opportunity.riskLevel,
      confidence: opportunity.riskFactors.length > 0 ? "documented" : "minimal",
      freshness: opportunity.lastUpdated ? formatAge(opportunity.lastUpdated) : "—",
      evidenceCount: opportunity.riskFactors.length,
    },
  ];

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
          <Layers className="h-4 w-4 text-sky-400" />
          Evidence Matrix
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" role="grid" aria-label="Evidence matrix">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-slate-500 font-normal px-4 py-2">Dimension</th>
                <th className="text-right text-slate-500 font-normal px-2 py-2">Score / State</th>
                <th className="text-left text-slate-500 font-normal px-2 py-2 hidden sm:table-cell">Direction</th>
                <th className="text-left text-slate-500 font-normal px-2 py-2 hidden sm:table-cell">Confidence</th>
                <th className="text-right text-slate-500 font-normal px-4 py-2">Freshness</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.dimension} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                  <td className="px-4 py-2 font-medium text-slate-300">{row.dimension}</td>
                  <td className="px-2 py-2 text-right">
                    {row.score != null ? (
                      <span className={cn("font-mono tabular-nums", scoreColor(row.score))}>{row.score}</span>
                    ) : (
                      <span className="text-slate-400">{row.direction}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-slate-400 hidden sm:table-cell capitalize">{row.score != null ? row.direction : "—"}</td>
                  <td className="px-2 py-2 text-slate-500 hidden sm:table-cell capitalize">{row.confidence}</td>
                  <td className="px-4 py-2 text-right text-slate-500">{row.freshness}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Technical Research tab
// ---------------------------------------------------------------------------

function TechnicalResearchTab({ opportunity }: { opportunity: CanonicalOpportunity }) {
  const candidate = null; // candidate from /today used for legacy fields only
  const techEvidence = [
    ...opportunity.primaryEvidence.filter(e =>
      e.category?.toLowerCase().includes("tech") ||
      e.category?.toLowerCase().includes("pattern") ||
      e.category?.toLowerCase().includes("volume") ||
      e.category?.toLowerCase().includes("trend"),
    ),
    ...opportunity.secondaryEvidence.filter(e =>
      e.category?.toLowerCase().includes("tech"),
    ),
  ];

  return (
    <div className="space-y-4">
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="pt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-slate-500 mb-0.5">Opportunity Type</div>
              <div className="text-slate-200">{opportunity.opportunityTypeLabel}</div>
            </div>
            <div>
              <div className="text-slate-500 mb-0.5">Technical Score</div>
              <div className={cn("font-bold tabular-nums", scoreColor(opportunity.technicalScore))}>
                {opportunity.technicalScore}
              </div>
            </div>
            <div>
              <div className="text-slate-500 mb-0.5">Risk Level</div>
              <Badge className={cn("text-[10px] border", riskLevelBadge(opportunity.riskLevel))}>
                {opportunity.riskLevel}
              </Badge>
            </div>
            <div>
              <div className="text-slate-500 mb-0.5">Time Horizon</div>
              <div className="text-slate-200 capitalize">{opportunity.timeHorizon}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {techEvidence.length > 0 ? (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-slate-400">Technical Evidence</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {techEvidence.map((e, i) => (
              <div key={i} className="text-xs border-l-2 border-sky-800 pl-3 space-y-0.5">
                <div className="text-slate-300 font-medium">{e.label}</div>
                {e.value && <div className="text-slate-400">{e.value}</div>}
                {e.detail && <div className="text-slate-500">{e.detail}</div>}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="py-6 text-center">
            <p className="text-xs text-slate-500">Technical evidence details are part of the broader research snapshot above.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fundamental Research tab
// ---------------------------------------------------------------------------

function FundamentalResearchTab({ opportunity }: { opportunity: CanonicalOpportunity }) {
  const fundEvidence = [
    ...opportunity.primaryEvidence.filter(e =>
      e.category?.toLowerCase().includes("fund") ||
      e.category?.toLowerCase().includes("earning") ||
      e.category?.toLowerCase().includes("revenue") ||
      e.category?.toLowerCase().includes("margin") ||
      e.category?.toLowerCase().includes("eps"),
    ),
    ...opportunity.secondaryEvidence.filter(e =>
      e.category?.toLowerCase().includes("fund") ||
      e.category?.toLowerCase().includes("earning"),
    ),
  ];

  const lowCoverage = opportunity.fundamentalScore < 20;

  return (
    <div className="space-y-4">
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500 mb-0.5">Fundamental Score</div>
              <div className={cn("text-2xl font-bold tabular-nums", scoreColor(opportunity.fundamentalScore))}>
                {opportunity.fundamentalScore}
              </div>
            </div>
            {lowCoverage && (
              <Badge className="text-[10px] border bg-amber-900/30 text-amber-300 border-amber-800">
                Partial Data
              </Badge>
            )}
          </div>
          {lowCoverage && (
            <p className="text-xs text-amber-400/80 bg-amber-950/30 rounded p-2 border border-amber-900/40">
              Fundamental data coverage is limited for this symbol. Score reflects available evidence only — unavailable data is not treated as zero.
            </p>
          )}
        </CardContent>
      </Card>

      {fundEvidence.length > 0 ? (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-slate-400">Fundamental Evidence</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {fundEvidence.map((e, i) => (
              <div key={i} className="text-xs border-l-2 border-emerald-900 pl-3 space-y-0.5">
                <div className="text-slate-300 font-medium">{e.label}</div>
                {e.value && <div className="text-slate-400">{e.value}</div>}
                {e.detail && <div className="text-slate-500">{e.detail}</div>}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="py-6 text-center">
            <p className="text-xs text-slate-500">
              {lowCoverage
                ? "Fundamental evidence is not available for this symbol in the current snapshot."
                : "Fundamental evidence is incorporated into the overall research score above."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Institutional Research tab
// ---------------------------------------------------------------------------

function InstitutionalResearchTab({ institutional, opportunity }: {
  institutional: InstitutionalSignal | null;
  opportunity: CanonicalOpportunity;
}) {
  const DELAY_DISCLOSURE =
    "SEC Form 13F data is delayed and does not represent real-time institutional positions. Data reflects filings from a previous quarter.";

  return (
    <div className="space-y-4">
      {/* 13F disclosure — always visible */}
      <div className="flex items-start gap-2 text-xs text-amber-400/80 bg-amber-950/20 rounded p-3 border border-amber-900/30">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>{DELAY_DISCLOSURE}</span>
      </div>

      {institutional ? (
        <>
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-slate-500 mb-0.5">Institutional Score</div>
                  <div className={cn("text-2xl font-bold tabular-nums", scoreColor(institutional.score ?? 0))}>
                    {institutional.score ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 mb-0.5">Signal</div>
                  <Badge className={cn("text-[10px] border", labelBadgeClass(institutional.label ?? ""))}>
                    {institutional.label ?? "—"}
                  </Badge>
                </div>
                <div>
                  <div className="text-slate-500 mb-0.5">Manager Count</div>
                  <div className="text-slate-200">{fmtNum(institutional.metrics.managerCountLatest)}</div>
                </div>
                <div>
                  <div className="text-slate-500 mb-0.5">Data Confidence</div>
                  <div className="text-slate-200 capitalize">{institutional.dataQuality.confidence}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-slate-800">
                {[
                  { label: "New Positions", value: institutional.metrics.newManagerCount, color: "text-emerald-400" },
                  { label: "Increased", value: institutional.metrics.increasedManagerCount, color: "text-sky-400" },
                  { label: "Reduced", value: institutional.metrics.reducedManagerCount, color: "text-amber-400" },
                  { label: "Exited", value: institutional.metrics.exitedManagerCount, color: "text-rose-400" },
                ].map(item => (
                  <div key={item.label} className="text-center">
                    <div className={cn("text-lg font-bold tabular-nums", item.color)}>
                      {fmtNum(item.value)}
                    </div>
                    <div className="text-[10px] text-slate-500">{item.label}</div>
                  </div>
                ))}
              </div>

              {institutional.summary && (
                <p className="text-xs text-slate-400 italic">{institutional.summary}</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-slate-400">Concentration & Trend</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Holder Count</span>
                <span className="text-slate-200">{fmtNum(institutional.concentration.holderCount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Top Holder Share</span>
                <span className="text-slate-200">{institutional.concentration.topHolderSharePct != null ? `${fmtNum(institutional.concentration.topHolderSharePct, 1)}%` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Concentration Trend</span>
                <span className="text-slate-200 capitalize">{institutional.concentration.trend}</span>
              </div>
              {institutional.latestQuarter && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Latest Quarter</span>
                  <span className="text-slate-200">{institutional.latestQuarter}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="py-8 text-center">
            <Users className="h-8 w-8 text-slate-700 mx-auto mb-3" />
            <p className="text-sm text-slate-400">Institutional evidence is unavailable for this symbol.</p>
            <p className="text-xs text-slate-600 mt-1">Institutional Score: {opportunity.institutionalScore}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sector & Theme Context tab
// ---------------------------------------------------------------------------

function SectorThemeTab({ opportunity, sectorContext, themeContexts, navigate }: {
  opportunity: CanonicalOpportunity;
  sectorContext: SectorContext | null;
  themeContexts: ThemeContext[];
  navigate: (path: string) => void;
}) {
  const regimeText = opportunity.marketRegime
    ? opportunity.marketRegime.toLowerCase().includes("bull")
      ? `Current market regime (${opportunity.marketRegime}) is generally supportive of growth-oriented research candidates.`
      : opportunity.marketRegime.toLowerCase().includes("bear")
      ? `Current market regime (${opportunity.marketRegime}) reflects increased caution in broader research conditions.`
      : `Current market regime is ${opportunity.marketRegime}. Evidence should be interpreted in this broader context.`
    : "Market regime context is not available in the current snapshot.";

  return (
    <div className="space-y-4">
      {/* Sector */}
      {sectorContext ? (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-sky-400" />
              Sector: {sectorContext.sector}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-4 text-xs">
              <div>
                <div className="text-slate-500 mb-0.5">Score</div>
                <div className={cn("font-bold tabular-nums", scoreColor(sectorContext.score))}>
                  {sectorContext.score}
                </div>
              </div>
              <div>
                <div className="text-slate-500 mb-0.5">State</div>
                <Badge className={cn("text-[10px] border", labelBadgeClass(sectorContext.label))}>
                  {sectorContext.label}
                </Badge>
              </div>
              <div>
                <div className="text-slate-500 mb-0.5">Updated</div>
                <div className="text-slate-400">{formatAge(sectorContext.generatedAt)}</div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-sky-400 hover:text-sky-300 -ml-2 h-7"
              onClick={() => navigate(`/intelligence/sector/${encodeURIComponent(sectorContext.sector)}`)}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Open Sector Research
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="py-4">
            <p className="text-xs text-slate-500">
              {opportunity.sector
                ? `Sector intelligence data for "${opportunity.sector}" is not yet available.`
                : "No sector classification for this symbol."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Themes */}
      {opportunity.themes.length > 0 ? (
        <div className="space-y-3">
          {opportunity.themes.map((themeName, i) => {
            const tc = themeContexts.find(t => t.themeName.toLowerCase() === themeName.toLowerCase());
            return (
              <Card key={i} className="bg-slate-900 border-slate-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                    <Tag className="h-4 w-4 text-purple-400" />
                    {themeName}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {tc ? (
                    <>
                      <div className="flex items-center gap-4 text-xs">
                        <div>
                          <div className="text-slate-500 mb-0.5">Score</div>
                          <div className={cn("font-bold tabular-nums", scoreColor(tc.score))}>{tc.score}</div>
                        </div>
                        <div>
                          <div className="text-slate-500 mb-0.5">State</div>
                          <Badge className={cn("text-[10px] border", labelBadgeClass(tc.label))}>{tc.label}</Badge>
                        </div>
                        <div>
                          <div className="text-slate-500 mb-0.5">Updated</div>
                          <div className="text-slate-400">{formatAge(tc.generatedAt)}</div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-purple-400 hover:text-purple-300 -ml-2 h-7"
                        onClick={() => navigate(`/intelligence/theme/${tc.themeId}`)}
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Open Theme Research
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">Theme intelligence data is not yet available.</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="py-4">
            <p className="text-xs text-slate-500">No theme classifications for this symbol.</p>
          </CardContent>
        </Card>
      )}

      {/* Market Regime */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-slate-400 flex items-center gap-2">
            <Activity className="h-3.5 w-3.5" />
            Market Regime Context
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-slate-300">{regimeText}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Risk & Thesis Invalidation tab
// ---------------------------------------------------------------------------

function RiskThesisTab({ opportunity }: { opportunity: CanonicalOpportunity }) {
  return (
    <div className="space-y-4">
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-400" />
            Observed Risk
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 text-xs">
            <div>
              <div className="text-slate-500 mb-0.5">Risk Level</div>
              <Badge className={cn("border", riskLevelBadge(opportunity.riskLevel))}>
                {opportunity.riskLevel}
              </Badge>
            </div>
          </div>

          {opportunity.riskFactors.length > 0 ? (
            <ul className="space-y-2">
              {opportunity.riskFactors.map((rf, i) => (
                <li key={i} className="text-xs border-l-2 border-amber-800 pl-3 space-y-0.5">
                  <div className="text-slate-300 font-medium">{rf.label}</div>
                  {rf.severity && <div className="text-amber-400/70 text-[10px] uppercase tracking-wide">Risk Factor — {rf.severity}</div>}
                  {rf.detail && <div className="text-slate-500">{rf.detail}</div>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">No specific risk factors documented in the current snapshot.</p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-400" />
            What Would Invalidate This Thesis
          </CardTitle>
        </CardHeader>
        <CardContent>
          {opportunity.invalidatesThesis.length > 0 ? (
            <ul className="space-y-2">
              {opportunity.invalidatesThesis.map((item, i) => (
                <li key={i} className="text-xs border-l-2 border-rose-900 pl-3 space-y-0.5">
                  <div className="text-slate-300">{item.condition}</div>
                  {item.detail && <div className="text-slate-500">{item.detail}</div>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">No thesis invalidation conditions documented.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History & Change Timeline tab
// ---------------------------------------------------------------------------

function HistoryTimelineTab({ history, symbol }: { history: HistoryEntry[]; symbol: string }) {
  if (history.length === 0) {
    return (
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="py-8 text-center">
          <Clock className="h-8 w-8 text-slate-700 mx-auto mb-3" />
          <p className="text-sm text-slate-400">Research history will appear after multiple ranking cycles.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Change Timeline */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-slate-400">Change Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3" aria-label="Research change timeline">
            {history.slice(0, 10).map((h, i) => {
              const prev = history[i + 1];
              const delta = prev ? h.score - prev.score : null;
              const deltaStr = delta == null ? null : delta > 0 ? `+${delta}` : `${delta}`;
              const deltaColor = delta == null ? "" : delta > 0 ? "text-emerald-400" : delta < 0 ? "text-rose-400" : "text-slate-500";
              return (
                <li key={h.id} className="flex items-start gap-3 text-xs">
                  <div className="shrink-0 w-16 text-slate-600 pt-0.5">{formatDate(h.scanTime)}</div>
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className={cn("font-mono tabular-nums font-medium", scoreColor(h.score))}>
                        {h.score}
                      </span>
                      {deltaStr && (
                        <span className={cn("text-[10px] font-mono", deltaColor)}>{deltaStr}</span>
                      )}
                      {h.qualificationStatus && (
                        <Badge className="text-[9px] border bg-slate-800 text-slate-400 border-slate-700 py-0">
                          {h.qualificationStatus}
                        </Badge>
                      )}
                    </div>
                    {h.lifecycleState && h.lifecycleState !== h.qualificationStatus && (
                      <div className="text-slate-600">{h.lifecycleState}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      {/* Score history table */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-slate-400">Full Research Score History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs" aria-label="Research score history">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left text-slate-500 font-normal px-4 py-2">Date</th>
                  <th className="text-right text-slate-500 font-normal px-2 py-2">Score</th>
                  <th className="text-right text-slate-500 font-normal px-2 py-2 hidden sm:table-cell">Rank</th>
                  <th className="text-left text-slate-500 font-normal px-4 py-2 hidden sm:table-cell">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors">
                    <td className="px-4 py-1.5 text-slate-400">{formatDate(h.scanTime)}</td>
                    <td className={cn("px-2 py-1.5 text-right font-mono tabular-nums", scoreColor(h.score))}>{h.score}</td>
                    <td className="px-2 py-1.5 text-right text-slate-500 hidden sm:table-cell">{h.rank ?? "—"}</td>
                    <td className="px-4 py-1.5 text-slate-500 hidden sm:table-cell">{h.qualificationStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Related Research section
// ---------------------------------------------------------------------------

function RelatedResearchSection({ relatedOpportunities, navigate }: {
  relatedOpportunities: RelatedOpp[];
  navigate: (path: string) => void;
}) {
  if (relatedOpportunities.length === 0) return null;

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-sky-400" />
          Related Research
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {relatedOpportunities.map(opp => (
            <button
              key={opp.symbol}
              className="text-left p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 border border-slate-700 hover:border-slate-600 transition-all"
              onClick={() => navigate(`/opportunities/${opp.symbol}`)}
              aria-label={`Open research for ${opp.symbol}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-slate-200">{opp.symbol}</span>
                <span className={cn("text-xs font-mono tabular-nums", scoreColor(opp.score))}>{opp.score}</span>
              </div>
              {opp.companyName && <div className="text-[10px] text-slate-500 truncate">{opp.companyName}</div>}
              <Badge className={cn("text-[9px] border mt-1", getCategoryBadge(opp.category))}>{opp.category}</Badge>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Collections integration section
// ---------------------------------------------------------------------------

function CollectionsSection({ collections, symbol, navigate }: {
  collections: CollectionMembership[];
  symbol: string;
  navigate: (path: string) => void;
}) {
  const memberCollections = collections.filter(c => c.isMember);

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-purple-400" />
          Collections
        </CardTitle>
      </CardHeader>
      <CardContent>
        {memberCollections.length > 0 ? (
          <ul className="space-y-2">
            {memberCollections.map(c => (
              <li key={c.collectionId} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Badge className={cn("text-[9px] border", c.collectionType === "system" ? "bg-sky-900/40 text-sky-300 border-sky-800" : "bg-purple-900/40 text-purple-300 border-purple-800")}>
                    {c.collectionType}
                  </Badge>
                  <span className="text-slate-300">{c.collectionName}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] text-slate-500 hover:text-slate-300"
                  onClick={() => navigate(`/research?collection=${c.collectionId}`)}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">{symbol} is not in any of your collections.</p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 text-xs text-sky-400 hover:text-sky-300 -ml-2 h-7"
          onClick={() => navigate("/research")}
        >
          <FolderOpen className="h-3 w-3 mr-1" />
          Manage Collections
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Monitoring integration section
// ---------------------------------------------------------------------------

function MonitoringSection({ monitoring, symbol, navigate }: {
  monitoring: MonitoringState;
  symbol: string;
  navigate: (path: string) => void;
}) {
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
          <Bell className="h-4 w-4 text-amber-400" />
          Research Monitoring
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {monitoring.isMonitored ? (
          <>
            <div className="flex items-center gap-2 text-xs">
              <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
              <span className="text-emerald-300 font-medium">Monitoring: Active</span>
            </div>
            {monitoring.lastChangeAt && (
              <div className="text-xs text-slate-400">
                Last research change: {formatAge(monitoring.lastChangeAt)}
              </div>
            )}
            {monitoring.lastChangeSummary && (
              <p className="text-xs text-slate-400 italic">{monitoring.lastChangeSummary}</p>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-500">This symbol is not currently monitored.</p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-amber-400 hover:text-amber-300 -ml-2 h-7"
          onClick={() => navigate("/research-monitor")}
        >
          <Eye className="h-3 w-3 mr-1" />
          Open Research Monitor
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Reports integration section
// ---------------------------------------------------------------------------

function ReportsSection({ reports, navigate }: { reports: ReportSummary[]; navigate: (path: string) => void }) {
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
          <FileText className="h-4 w-4 text-sky-400" />
          Research Reports
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {reports.length > 0 ? (
          <ul className="space-y-2">
            {reports.map(r => (
              <li key={r.reportId} className="flex items-start justify-between gap-2 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="text-slate-300 truncate">{r.title}</div>
                  <div className="text-slate-600">
                    {r.reportType}
                    {r.generatedAt && <> · {formatAge(r.generatedAt)}</>}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] text-sky-400 hover:text-sky-300 shrink-0"
                  onClick={() => navigate(`/research-reports/${r.reportId}`)}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">No related research reports are available yet.</p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-sky-400 hover:text-sky-300 -ml-2 h-7"
          onClick={() => navigate("/research-reports")}
        >
          <FileText className="h-3 w-3 mr-1" />
          View All Reports
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// AI Research actions
// ---------------------------------------------------------------------------

function AIResearchSection({ symbol, navigate }: { symbol: string; navigate: (path: string) => void }) {
  // Sprint 2.6.4: use valid ResearchMode + action param instead of overloading mode
  const actions = [
    { label: "Explain This Candidate",         mode: "company",       action: "explain_concept" },
    { label: "Challenge This Thesis",           mode: "company",       action: "challenge" },
    { label: "Explain What Changed",            mode: "opportunity",   action: "explain_change" },
    { label: "Explain Risk Factors",            mode: "company",       action: "risk" },
    { label: "Compare With Another Candidate",  mode: "comparison",    action: "compare" },
    { label: "Explain Institutional Evidence",  mode: "institutional", action: "institutional" },
  ];

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
          <BrainCircuit className="h-4 w-4 text-violet-400" />
          AI Research
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-slate-500 mb-3">
          Open the AI Research Workspace with this symbol's context pre-selected.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {actions.map(action => (
            <Button
              key={action.action}
              variant="outline"
              size="sm"
              className="text-xs h-8 border-slate-700 text-slate-300 hover:text-slate-100 hover:border-violet-700 justify-start"
              onClick={() => navigate(`/research-workspace?symbol=${symbol}&mode=${action.mode}&action=${action.action}&sourceRoute=/opportunities/${symbol}`)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Portfolio Context (optional)
// ---------------------------------------------------------------------------

function PortfolioContextCard({ portfolioContext, navigate }: {
  portfolioContext: PortfolioContext;
  navigate: (path: string) => void;
}) {
  return (
    <Card className="bg-slate-900 border-emerald-900/40">
      <CardContent className="pt-4 space-y-3">
        <div className="text-xs font-medium text-emerald-300 flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" />
          Portfolio Position
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-slate-500 mb-0.5">Owned in</div>
            <div className="text-slate-200">{portfolioContext.portfolioName}</div>
          </div>
          {portfolioContext.portfolioWeight != null && (
            <div>
              <div className="text-slate-500 mb-0.5">Portfolio Weight</div>
              <div className="text-slate-200">{portfolioContext.portfolioWeight}%</div>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-emerald-400 hover:text-emerald-300 -ml-2 h-7"
          onClick={() => navigate(`/portfolio/${portfolioContext.portfolioId}?tab=intelligence`)}
        >
          <ExternalLink className="h-3 w-3 mr-1" />
          Open Portfolio Intelligence
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Future Trade Planning Handoff
// ---------------------------------------------------------------------------

function TradePlanningHandoff({ opportunity }: { opportunity: CanonicalOpportunity }) {
  const type = opportunity.opportunityType?.toLowerCase() ?? "";
  const paths = [];
  if (type.includes("growth") || type.includes("vcp") || type.includes("momentum"))
    paths.push("Equity Research", "Options Research");
  if (type.includes("income") || type.includes("covered"))
    paths.push("Income Strategy Research", "Defined-Risk Research");
  if (paths.length === 0)
    paths.push("Equity Research", "Options Research");

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-slate-500">Potential Research Expression</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-slate-600 italic">
          Trade Planning capabilities are part of a future workflow.
        </p>
        <div className="space-y-1">
          {paths.map(p => (
            <div key={p} className="text-xs text-slate-500 flex items-center gap-1.5">
              <span className="text-slate-700">·</span> {p}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reserved route segments — defense-in-depth
// These are static application paths under /opportunities/* that must never
// be treated as ticker symbols. Routing fixes in App.tsx are the primary guard;
// this list provides a second layer in case a link bypasses Wouter ordering.
// ---------------------------------------------------------------------------
const RESERVED_OPPORTUNITY_SEGMENTS = new Set([
  "TODAY", "CHANGES", "GROWTH", "INCOME",
  "WATCH", "WATCHLIST", "HISTORY", "MONITOR", "RESEARCH",
]);

export default function OpportunityWorkspacePage() {
  const params = useParams<{ symbol: string }>();
  const [, navigate] = useLocation();
  const symbol = (params.symbol ?? "").toUpperCase();

  // Guard: reserved segment reached the workspace — redirect to canonical route.
  // Primary fix is route ordering in App.tsx; this prevents a confusing error page.
  if (RESERVED_OPPORTUNITY_SEGMENTS.has(symbol)) {
    if (symbol === "TODAY")    { navigate("/opportunities/today",    { replace: true }); return null; }
    if (symbol === "CHANGES")  { navigate("/opportunities/changes",  { replace: true }); return null; }
    // All other reserved words → research hub
    navigate("/research", { replace: true });
    return null;
  }

  // Call 1: In-memory ranking
  const todayQuery = useQuery<OpportunityTodayResponse>({
    queryKey: ["/api/opportunities/today"],
    staleTime: 5 * 60 * 1000,
  });

  // Call 2: Full workspace payload
  const workspaceQuery = useQuery<WorkspaceV2Response>({
    queryKey: [`/api/opportunities/workspace/${symbol}`],
    enabled: !!symbol,
    staleTime: 5 * 60 * 1000,
  });

  const ranking = todayQuery.data?.ranking ?? null;
  const ws = workspaceQuery.data;
  const opportunity = ws?.opportunity ?? null;
  const candidate = ranking ? findScoredCandidate(symbol, ranking) : null;
  const score = candidate?.opportunityScore ?? null;

  // Use canonical opportunity scores when available; fall back to ranking score
  const researchScore = opportunity?.researchScore ?? score?.overallScore ?? null;
  const companyName = ws?.companyName ?? opportunity?.companyName ?? null;

  const isLoading = todayQuery.isLoading || workspaceQuery.isLoading;

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <Skeleton className="h-8 w-32 bg-slate-800" />
          <Skeleton className="h-28 w-full bg-slate-800" />
          <Skeleton className="h-10 w-full bg-slate-800" />
          <Skeleton className="h-48 w-full bg-slate-800" />
          <Skeleton className="h-64 w-full bg-slate-800" />
        </div>
      </div>
    );
  }

  // ── Not in ranking — still render if workspace data is available ─────────
  if (!researchScore && !isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
        <div className="max-w-4xl mx-auto">
          <Button variant="ghost" className="mb-4 text-slate-400" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Dashboard
          </Button>
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-16 text-center">
              <Info className="h-10 w-10 text-slate-600 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-slate-200 mb-2">{symbol} — Research Not Available</h2>
              <p className="text-sm text-slate-400 max-w-sm mx-auto">
                {ws?.limitations?.[0] ??
                  (todayQuery.data?.available === false
                    ? todayQuery.data.message ?? "Rankings are being computed."
                    : "This symbol is not present in the latest Opportunity Intelligence snapshot.")}
              </p>
              <Button className="mt-6" onClick={() => navigate("/dashboard")}>Back to Dashboard</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!researchScore) return null;

  const changeExplanation = ws?.changeExplanation ?? null;
  const institutional = ws?.institutional ?? null;
  const history = ws?.history ?? [];
  const sectorContext = ws?.sectorContext ?? null;
  const themeContexts = ws?.themeContexts ?? [];
  const collections = ws?.collections ?? [];
  const monitoring = ws?.monitoring ?? { isMonitored: false, watchId: null, status: null, lastChangeAt: null, lastChangeSummary: null, recentActivityCount: 0 };
  const reports = ws?.reports ?? [];
  const portfolioContext = ws?.portfolioContext ?? null;
  const relatedOpportunities = ws?.relatedOpportunities ?? [];
  const freshness = ws?.freshness ?? { rankingGeneratedAt: null, institutionalDataAt: null, sectorDataAt: null, historyLatestAt: null, workspaceAssembledAt: new Date().toISOString() };
  const limitations = ws?.limitations ?? [];

  // Derive display values from canonical opportunity or ranking score
  const displaySector = opportunity?.sector ?? score?.category ?? null;
  const displayIndustry = opportunity?.industry ?? null;
  const displayThemes = opportunity?.themes ?? [];
  const displayRiskLevel = opportunity?.riskLevel ?? "—";
  const displayConfidence = opportunity?.confidence ?? score?.confidence ?? "—";
  const displayRegime = opportunity?.marketRegime ?? ranking?.regime ?? null;
  const displayTypeLabel = opportunity?.opportunityTypeLabel ?? score?.category ?? "Research Candidate";

  return (
    <div className="min-h-screen bg-slate-950">
      {/* ── Sticky Header ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-50 bg-slate-950/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="mb-2 text-slate-400 -ml-2"
            onClick={() => navigate("/dashboard")}
            aria-label="Back to Dashboard"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
          </Button>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-100">{symbol}</h1>
                {companyName && (
                  <span className="text-sm text-slate-400 truncate">{companyName}</span>
                )}
              </div>

              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <Badge className={cn("text-[10px] border", getCategoryBadge(score?.category ?? "Watch"))}>
                  {displayTypeLabel}
                </Badge>
                {displaySector && (
                  <Badge className="text-[10px] border bg-slate-800/60 text-slate-400 border-slate-700">
                    {displaySector}
                  </Badge>
                )}
                {displayThemes.slice(0, 2).map(t => (
                  <Badge key={t} className="text-[10px] border bg-purple-900/30 text-purple-300 border-purple-800">
                    {t}
                  </Badge>
                ))}
                <Badge className={cn("text-[10px] border", riskLevelBadge(displayRiskLevel))}>
                  {displayRiskLevel} risk
                </Badge>
                {displayRegime && (
                  <Badge className="text-[10px] border bg-slate-800/60 text-slate-300 border-slate-700">
                    {displayRegime}
                  </Badge>
                )}
              </div>
            </div>

            <div className="text-right shrink-0">
              <div aria-label={`Research score: ${researchScore}`}>
                <ResearchDefinitionTooltip term="research_score">
                  <div className={cn("text-3xl font-black tabular-nums cursor-help", scoreColor(researchScore))}>
                    {researchScore}
                  </div>
                </ResearchDefinitionTooltip>
              </div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">Research Score</div>
              {freshness.rankingGeneratedAt && (
                <div className="text-[10px] text-slate-600 mt-0.5 flex items-center justify-end gap-1">
                  <Clock className="h-3 w-3" />
                  {formatAge(freshness.rankingGeneratedAt)}
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-slate-700 text-violet-300 hover:border-violet-700"
              onClick={() => navigate(`/research-workspace?symbol=${symbol}&mode=company&action=explain_concept&sourceRoute=/opportunities/${symbol}`)}
            >
              <BrainCircuit className="h-3 w-3 mr-1" />
              Open AI Research
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-slate-700 text-slate-300 hover:border-slate-600"
              onClick={() => navigate("/research")}
            >
              <FolderOpen className="h-3 w-3 mr-1" />
              Collections
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-slate-700 text-slate-300 hover:border-slate-600"
              onClick={() => navigate("/research-monitor")}
            >
              <Bell className="h-3 w-3 mr-1" />
              Monitor
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-slate-700 text-slate-300 hover:border-slate-600"
              onClick={() => navigate("/research-reports")}
            >
              <FileText className="h-3 w-3 mr-1" />
              Reports
            </Button>
          </div>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

        {/* Portfolio context — shown only when the user owns this symbol */}
        {portfolioContext && (
          <PortfolioContextCard portfolioContext={portfolioContext} navigate={navigate} />
        )}

        {/* Research Snapshot */}
        {opportunity && (
          <ResearchSnapshotCard
            opportunity={opportunity}
            changeExplanation={changeExplanation}
            freshness={freshness}
          />
        )}

        {/* Why This Qualified */}
        {opportunity && <WhyThisQualifiedSection opportunity={opportunity} />}

        {/* What Changed */}
        <WhatChangedSection changeExplanation={changeExplanation} />

        {/* Evidence Matrix */}
        {opportunity && (
          <EvidenceMatrix
            opportunity={opportunity}
            sectorContext={sectorContext}
            themeContexts={themeContexts}
            institutional={institutional}
          />
        )}

        {/* Main research tabs */}
        {opportunity && (
          <Tabs defaultValue="technical">
            <TabsList className="bg-slate-900 border border-slate-800 w-full overflow-x-auto flex" role="tablist" aria-label="Research sections">
              <TabsTrigger value="technical" className="text-xs data-[state=active]:bg-slate-800 shrink-0">Technical</TabsTrigger>
              <TabsTrigger value="fundamental" className="text-xs data-[state=active]:bg-slate-800 shrink-0">Fundamental</TabsTrigger>
              <TabsTrigger value="institutional" className="text-xs data-[state=active]:bg-slate-800 shrink-0">Institutional</TabsTrigger>
              <TabsTrigger value="sector-theme" className="text-xs data-[state=active]:bg-slate-800 shrink-0">Sector & Theme</TabsTrigger>
              <TabsTrigger value="risk" className="text-xs data-[state=active]:bg-slate-800 shrink-0">Risk</TabsTrigger>
              <TabsTrigger value="history" className="text-xs data-[state=active]:bg-slate-800 shrink-0">History</TabsTrigger>
            </TabsList>

            <TabsContent value="technical" className="mt-4">
              <TechnicalResearchTab opportunity={opportunity} />
            </TabsContent>

            <TabsContent value="fundamental" className="mt-4">
              <FundamentalResearchTab opportunity={opportunity} />
            </TabsContent>

            <TabsContent value="institutional" className="mt-4">
              <InstitutionalResearchTab institutional={institutional} opportunity={opportunity} />
            </TabsContent>

            <TabsContent value="sector-theme" className="mt-4">
              <SectorThemeTab
                opportunity={opportunity}
                sectorContext={sectorContext}
                themeContexts={themeContexts}
                navigate={navigate}
              />
            </TabsContent>

            <TabsContent value="risk" className="mt-4">
              <RiskThesisTab opportunity={opportunity} />
            </TabsContent>

            <TabsContent value="history" className="mt-4">
              <HistoryTimelineTab history={history} symbol={symbol} />
            </TabsContent>
          </Tabs>
        )}

        {/* Related Research */}
        <RelatedResearchSection relatedOpportunities={relatedOpportunities} navigate={navigate} />

        {/* Collections / Monitoring / Reports / AI Research */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CollectionsSection collections={collections} symbol={symbol} navigate={navigate} />
          <MonitoringSection monitoring={monitoring} symbol={symbol} navigate={navigate} />
        </div>
        <ReportsSection reports={reports} navigate={navigate} />
        <AIResearchSection symbol={symbol} navigate={navigate} />

        {/* Future Trade Planning Handoff */}
        {opportunity && <TradePlanningHandoff opportunity={opportunity} />}

        {/* Limitations */}
        {limitations.length > 0 && (
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-slate-500 flex items-center gap-2">
                <Info className="h-3.5 w-3.5" />
                Coverage & Limitations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {limitations.map((l, i) => (
                  <li key={i} className="text-xs text-slate-500 flex items-start gap-2">
                    <span className="text-slate-700 shrink-0">·</span>
                    {l}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Data Freshness summary */}
        <div className="text-[10px] text-slate-600 space-y-0.5">
          {freshness.rankingGeneratedAt && <div>Ranking: {formatAge(freshness.rankingGeneratedAt)}</div>}
          {freshness.sectorDataAt && <div>Sector: {formatAge(freshness.sectorDataAt)}</div>}
          {freshness.institutionalDataAt && <div>Institutional: {formatAge(freshness.institutionalDataAt)}</div>}
          <div>Workspace assembled: {formatAge(freshness.workspaceAssembledAt)}</div>
        </div>

        {/* Compliance disclaimer */}
        <p className="text-[11px] text-slate-700 text-center pb-4">
          Opportunity research summarizes deterministic and AI-assisted research evidence for informational and research purposes.
          It does not constitute investment advice or a recommendation to buy, sell, hold, or enter any particular security or strategy.
        </p>
      </div>
    </div>
  );
}
