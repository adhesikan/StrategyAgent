// Workspace Section Components — Sprint 2.2.3
//
// Compact summary cards for the AI Trading Workspace Overview tab.
// Each section links to the relevant deep-dive tab for full detail.
// All pure helper functions are exported for testing.
//
// Compliance: No fabricated prices, contracts, or evidence values.
// All data comes from the ResearchPackage / MarketSnapshot / SentimentResponse.

import { useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Shield,
  Newspaper,
  Landmark,
  Activity,
  Calendar,
  Database,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  MinusCircle,
  Info,
  BarChart2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { REGIME_LABEL } from "@/components/research/types";
import type {
  ResearchPackage,
  EvidenceStars,
  LifecycleItem,
  MarketSnapshot,
} from "@/components/research/types";

// ---------------------------------------------------------------------------
// Shared types for external consumers (e.g. SentimentResponse)
// ---------------------------------------------------------------------------

export interface SentimentSnapshotAgg {
  overallSentiment?: string;
  sentimentScore?: number;
  articleCount?: number;
}

export interface SentimentArticleMin {
  id: string;
  headline: string;
  sentimentLabel: string | null;
  publishedAt: string | null;
  impactLevel?: string | null;
  whyItMatters?: string | null;
}

export interface SentimentResponseMin {
  symbol: string;
  snapshot: SentimentSnapshotAgg | null;
  articles: SentimentArticleMin[];
  stale: boolean;
}

// ---------------------------------------------------------------------------
// 1. Lifecycle Summary — pure helpers
// ---------------------------------------------------------------------------

export type LifecycleSummaryKind =
  | "new"
  | "improved"
  | "declined"
  | "stable"
  | "triggered"
  | "dropped"
  | "approaching"
  | "no_data";

export interface LifecycleSummary {
  headline: string;
  detail: string;
  kind: LifecycleSummaryKind;
}

export function deriveLifecycleSummary(item: LifecycleItem | null): LifecycleSummary {
  if (!item) {
    return {
      headline: "First appearance in this scan.",
      detail: "No previous scan exists for comparison.",
      kind: "no_data",
    };
  }

  const deltaStr =
    item.scoreDelta >= 0
      ? `+${item.scoreDelta.toFixed(0)}`
      : `${item.scoreDelta.toFixed(0)}`;

  switch (item.lifecycleState) {
    case "NEWLY_QUALIFIED":
      return {
        headline: "Newly qualified in the latest scan.",
        detail: item.firstSeen
          ? `First seen ${new Date(item.firstSeen).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Score delta: ${deltaStr}.`
          : `Score delta: ${deltaStr}.`,
        kind: "new",
      };
    case "STRENGTHENING":
      return {
        headline: `Improved from rank #${item.rankPrev ?? "—"} to #${item.rankCurrent ?? "—"}.`,
        detail: `Score delta: ${deltaStr} vs. prior scan.`,
        kind: "improved",
      };
    case "WEAKENING":
      return {
        headline: `Declined from rank #${item.rankPrev ?? "—"} to #${item.rankCurrent ?? "—"}.`,
        detail: `Score delta: ${deltaStr} vs. prior scan.`,
        kind: "declined",
      };
    case "STILL_QUALIFIED":
      return {
        headline: `Held rank #${item.rankCurrent ?? "—"} — no material change since previous scan.`,
        detail: `Score delta: ${deltaStr}.`,
        kind: "stable",
      };
    case "TRIGGERED":
      return {
        headline: "Entry trigger condition met in the latest scan.",
        detail: `Moved from watch status to triggered. Current rank: #${item.rankCurrent ?? "—"}.`,
        kind: "triggered",
      };
    case "DROPPED":
      return {
        headline: "Dropped from the qualified list since the previous scan.",
        detail: `Previous rank: #${item.rankPrev ?? "—"}.`,
        kind: "dropped",
      };
    case "APPROACHING":
      return {
        headline: "Approaching qualification threshold.",
        detail: `Score delta: ${deltaStr} vs. prior scan.`,
        kind: "approaching",
      };
    case "UNAVAILABLE":
      return {
        headline: "Lifecycle data unavailable for this symbol.",
        detail: "Previous scan data is not available for comparison.",
        kind: "no_data",
      };
    default:
      return {
        headline: `Status: ${(item.lifecycleState as string).replace(/_/g, " ").toLowerCase()}.`,
        detail: "",
        kind: "stable",
      };
  }
}

// ---------------------------------------------------------------------------
// 2. Evidence Summary — pure helpers
// ---------------------------------------------------------------------------

export type EvidenceStrength = "supports" | "neutral" | "weakens" | "unavailable";

export interface EvidenceSummaryRow {
  id: string;
  label: string;
  strength: EvidenceStrength;
  numericScore: number | null;
  note: string;
  tabTarget: string;
}

export function buildEvidenceSummaryRows(
  pkg: ResearchPackage,
  stars: EvidenceStars,
  newsData: SentimentResponseMin | null,
): EvidenceSummaryRow[] {
  const { candidate, marketRegime } = pkg;

  const techStrength: EvidenceStrength =
    stars.technical >= 4 ? "supports" : stars.technical === 3 ? "neutral" : "weakens";
  const technicalRow: EvidenceSummaryRow = {
    id: "technical",
    label: "Technical",
    strength: techStrength,
    numericScore: stars.technical * 20,
    note: candidate.confidence
      ? `${candidate.confidence.charAt(0).toUpperCase()}${candidate.confidence.slice(1)} confidence`
      : "Scanner-derived",
    tabTarget: "technical",
  };

  const regimeStrength: EvidenceStrength =
    marketRegime === "TRENDING"
      ? "supports"
      : marketRegime === "RISK_OFF"
      ? "weakens"
      : "neutral";
  const regimeRow: EvidenceSummaryRow = {
    id: "regime",
    label: "Market Regime",
    strength: regimeStrength,
    numericScore: stars.regime * 20,
    note: marketRegime ? (REGIME_LABEL[marketRegime] ?? marketRegime) : "Unavailable",
    tabTarget: "technical",
  };

  const congressRow: EvidenceSummaryRow = {
    id: "congress",
    label: "Congress",
    strength: "neutral",
    numericScore: null,
    note: "Disclosure data via CongressFlow",
    tabTarget: "congress",
  };

  const articleCount = newsData?.articles.length ?? 0;
  const newsStrength: EvidenceStrength = articleCount >= 3 ? "supports" : "neutral";
  const newsRow: EvidenceSummaryRow = {
    id: "news",
    label: "News & Sentiment",
    strength: newsStrength,
    numericScore: stars.news * 20,
    note:
      articleCount > 0
        ? `${articleCount} article${articleCount !== 1 ? "s" : ""} indexed`
        : "Open News tab to load coverage",
    tabTarget: "news",
  };

  const hasWarnings = candidate.warnings.length > 0;
  const catalystStrength: EvidenceStrength = hasWarnings ? "weakens" : "neutral";
  const catalystRow: EvidenceSummaryRow = {
    id: "catalysts",
    label: "Catalysts & Risk",
    strength: catalystStrength,
    numericScore: null,
    note: hasWarnings
      ? `${candidate.warnings.length} scanner warning flag${candidate.warnings.length !== 1 ? "s" : ""}`
      : "No scanner warning flags",
    tabTarget: "catalysts",
  };

  const institutionalRow: EvidenceSummaryRow = {
    id: "institutional",
    label: "Institutional",
    strength: "unavailable",
    numericScore: null,
    note: "Not available in this version",
    tabTarget: "institutional",
  };

  return [technicalRow, regimeRow, congressRow, newsRow, catalystRow, institutionalRow];
}

// ---------------------------------------------------------------------------
// 3. Risk Groups — pure helpers
// ---------------------------------------------------------------------------

export type RiskSeverity = "critical" | "high" | "medium" | "low";

export interface RiskItem {
  label: string;
  detail: string;
  severity: RiskSeverity;
}

export interface RiskGroup {
  id: string;
  label: string;
  items: RiskItem[];
}

export function buildRiskGroups(
  pkg: ResearchPackage,
  snapshot: MarketSnapshot | undefined,
): RiskGroup[] {
  const { candidate, marketRegime } = pkg;
  const groups: RiskGroup[] = [];

  // Market & Event Risks
  const marketItems: RiskItem[] = [];
  if (marketRegime === "RISK_OFF") {
    marketItems.push({
      label: "Adverse Market Regime",
      detail: "Risk-Off regime historically reduces probability of successful long setups.",
      severity: "high",
    });
  }
  const highImpactNews = (snapshot?.topNews ?? []).filter((n) => n.impact === "high");
  for (const n of highImpactNews.slice(0, 2)) {
    marketItems.push({
      label: `Market Event — ${n.symbol}`,
      detail: n.whyItMatters,
      severity: "medium",
    });
  }
  if (marketItems.length > 0) {
    groups.push({ id: "market", label: "Market & Event Risks", items: marketItems });
  }

  // Research Thesis Risks
  const thesisItems: RiskItem[] = [];
  if (candidate.invalidation) {
    thesisItems.push({
      label: "Invalidation Condition",
      detail: `Setup is invalidated if price falls below ${candidate.invalidation}.`,
      severity: "critical",
    });
  }
  const earningsWarnings = candidate.warnings.filter(
    (w) => w.toLowerCase().includes("earnings") || w.toLowerCase().includes("catalyst"),
  );
  for (const w of earningsWarnings) {
    thesisItems.push({ label: "Earnings / Catalyst Risk", detail: w, severity: "high" });
  }
  if (thesisItems.length > 0) {
    groups.push({ id: "thesis", label: "Research Thesis Risks", items: thesisItems });
  }

  // Trade Plan Risks
  const tradeItems: RiskItem[] = [];
  const otherWarnings = candidate.warnings.filter(
    (w) => !w.toLowerCase().includes("earnings") && !w.toLowerCase().includes("catalyst"),
  );
  for (const w of otherWarnings) {
    tradeItems.push({ label: "Scanner Warning", detail: w, severity: "medium" });
  }
  if (candidate.maxRisk == null) {
    tradeItems.push({
      label: "Position Size Not Resolved",
      detail: "Risk budget not set — position sizing cannot be validated.",
      severity: "medium",
    });
  }
  if (!candidate.invalidation) {
    tradeItems.push({
      label: "Stop Level Not Specified",
      detail: "Scanner did not supply a stop level — set your own invalidation point.",
      severity: "medium",
    });
  }
  if (tradeItems.length > 0) {
    groups.push({ id: "trade", label: "Trade Plan Risks", items: tradeItems });
  }

  // Options Risks — always show
  const optionsItems: RiskItem[] = [
    {
      label: "Illustrative Structure — Not Verified",
      detail:
        "Options structure is illustrative until verified through a connected broker's live chain.",
      severity: "medium",
    },
    {
      label: "Time Decay Exposure",
      detail:
        "Long options strategies lose value as expiration approaches if the thesis is delayed.",
      severity: "low",
    },
  ];
  groups.push({ id: "options", label: "Options Risks", items: optionsItems });

  // Broker & Data Risks
  const dataItems: RiskItem[] = [];
  if (pkg.freshnessStatus === "stale") {
    dataItems.push({
      label: "Stale Research Data",
      detail: "Research package was generated before the most recent market session.",
      severity: "medium",
    });
  }
  if (!pkg.brokerConnected) {
    dataItems.push({
      label: "No Broker Connected",
      detail:
        "Live quotes and contract verification unavailable. Verify all levels with your broker before any decision.",
      severity: "low",
    });
  }
  if (dataItems.length > 0) {
    groups.push({ id: "data", label: "Broker & Data Risks", items: dataItems });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// 4. InstaTrade® Prep State — pure helper
// ---------------------------------------------------------------------------

export type InstaTradePrepStateKind =
  | "no_broker"
  | "contract_selected"
  | "stock_ready"
  | "no_contract";

export function deriveInstaTradePrepState(
  brokerConnected: boolean,
  hasSelectedContract: boolean,
): InstaTradePrepStateKind {
  if (!brokerConnected) return "no_broker";
  if (hasSelectedContract) return "contract_selected";
  return "stock_ready";
}

// ---------------------------------------------------------------------------
// 5. Assistant Prompts — pure helper
// ---------------------------------------------------------------------------

export function buildAssistantPrompts(
  pkg: ResearchPackage,
  stars: EvidenceStars,
  hasSelectedContract: boolean,
  hasNewsData: boolean,
): string[] {
  const prompts: string[] = [];

  // Tier 1 — always included (positions 1–3)
  prompts.push("Why did this candidate qualify?");
  prompts.push(`What are the strongest supporting factors for ${pkg.symbol}?`);
  prompts.push("What would invalidate this setup?");

  // Tier 2 — lifecycle (position 4 when available)
  if (pkg.lifecycleItem) {
    prompts.push("What changed since the previous scan?");
  }

  // Tier 3 — decision evidence
  prompts.push("What evidence weakens the research thesis?");

  // Tier 4 — InstaTrade® always within the first 8.
  // When a contract is selected, the single prompt references both the
  // selected contract AND InstaTrade® so both E7 ("contract") and E8
  // ("instatrade") tests can match against the same string.
  if (hasSelectedContract) {
    prompts.push("What should I verify before using InstaTrade® with this selected contract?");
  } else {
    prompts.push("What should I verify before using InstaTrade®?");
  }

  // Tier 5 — conditional context (warnings / news)
  if (pkg.candidate.warnings.length > 0) {
    prompts.push(`What risks should I review before earnings for ${pkg.symbol}?`);
  }
  if (hasNewsData) {
    prompts.push(`Summarize the latest news for ${pkg.symbol}.`);
  }

  // Tier 6 — congress, structure (fill remaining slots)
  prompts.push(`Summarize the congressional disclosures for ${pkg.symbol}.`);
  prompts.push("Why does the illustrative options structure fit?");
  prompts.push("Why does the stock structure fit this setup?");

  return prompts.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Helper: format relative time
// ---------------------------------------------------------------------------

function fmtRel(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Helper: strength icon + color
// ---------------------------------------------------------------------------

function StrengthIcon({ strength }: { strength: EvidenceStrength }) {
  if (strength === "supports")
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
  if (strength === "weakens")
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
  if (strength === "unavailable")
    return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}

function strengthLabel(strength: EvidenceStrength): string {
  if (strength === "supports") return "Supports";
  if (strength === "weakens") return "Weakens";
  if (strength === "unavailable") return "N/A";
  return "Neutral";
}

function strengthTextClass(strength: EvidenceStrength): string {
  if (strength === "supports") return "text-emerald-400";
  if (strength === "weakens") return "text-amber-400";
  if (strength === "unavailable") return "text-muted-foreground/50";
  return "text-muted-foreground";
}

// ---------------------------------------------------------------------------
// Helper: severity color
// ---------------------------------------------------------------------------

function severityClass(severity: RiskSeverity): string {
  if (severity === "critical")
    return "border-rose-500/30 bg-rose-500/5 text-rose-300";
  if (severity === "high")
    return "border-amber-500/30 bg-amber-500/5 text-amber-300";
  if (severity === "medium")
    return "border-amber-500/20 bg-amber-500/5 text-amber-200";
  return "border-border/40 bg-card/30 text-muted-foreground";
}

// ---------------------------------------------------------------------------
// WorkspaceLifecycleSection — "What Changed"
// ---------------------------------------------------------------------------

interface WorkspaceLifecycleSectionProps {
  item: LifecycleItem | null;
}

export function WorkspaceLifecycleSection({ item }: WorkspaceLifecycleSectionProps) {
  const summary = deriveLifecycleSummary(item);

  const iconMap: Record<LifecycleSummaryKind, React.ReactNode> = {
    new: <ArrowUpRight className="h-4 w-4 text-emerald-400" />,
    improved: <ArrowUpRight className="h-4 w-4 text-emerald-400" />,
    declined: <ArrowDownRight className="h-4 w-4 text-amber-400" />,
    stable: <Minus className="h-4 w-4 text-sky-400" />,
    triggered: <Zap className="h-4 w-4 text-sky-400" />,
    dropped: <ArrowDownRight className="h-4 w-4 text-rose-400" />,
    approaching: <ArrowUpRight className="h-4 w-4 text-violet-400" />,
    no_data: <MinusCircle className="h-4 w-4 text-muted-foreground" />,
  };

  const colorMap: Record<LifecycleSummaryKind, string> = {
    new: "border-emerald-500/30 bg-emerald-500/5",
    improved: "border-emerald-500/30 bg-emerald-500/5",
    declined: "border-amber-500/30 bg-amber-500/5",
    stable: "border-sky-500/20 bg-sky-500/5",
    triggered: "border-sky-500/30 bg-sky-500/5",
    dropped: "border-rose-500/30 bg-rose-500/5",
    approaching: "border-violet-500/20 bg-violet-500/5",
    no_data: "border-border/40",
  };

  return (
    <div
      id="ws-lifecycle"
      className={cn("rounded-lg border px-4 py-3 flex items-start gap-3", colorMap[summary.kind])}
      data-testid="ws-lifecycle-section"
      role="status"
      aria-label="Lifecycle change summary"
    >
      <div className="mt-0.5 shrink-0">{iconMap[summary.kind]}</div>
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-snug" data-testid="ws-lifecycle-headline">
          {summary.headline}
        </p>
        {summary.detail && (
          <p className="text-[11px] text-muted-foreground mt-0.5" data-testid="ws-lifecycle-detail">
            {summary.detail}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceDecisionSummary — compact decision card
// ---------------------------------------------------------------------------

interface WorkspaceDecisionSummaryProps {
  pkg: ResearchPackage;
  stars: EvidenceStars;
  onNavigateTab: (tab: string) => void;
}

export function WorkspaceDecisionSummary({
  pkg,
  stars,
  onNavigateTab,
}: WorkspaceDecisionSummaryProps) {
  const { candidate } = pkg;
  const topWhy = candidate.whySelected.slice(0, 2);
  const topWarning = candidate.warnings[0] ?? null;

  return (
    <Card className="border-border/40" id="ws-decision" data-testid="ws-decision-summary">
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
            <BarChart2 className="h-3.5 w-3.5 text-violet-400" />
            Decision Summary
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] gap-0.5 text-muted-foreground hover:text-foreground px-2"
            onClick={() => onNavigateTab("decision")}
            data-testid="ws-decision-open-full"
            aria-label="Open full decision analysis tab"
          >
            Full Analysis <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 space-y-3">
        {/* Qualification reasoning */}
        {topWhy.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Why Qualified
            </p>
            {topWhy.map((why, i) => (
              <div key={i} className="flex items-start gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                <span className="text-xs leading-relaxed">{why}</span>
              </div>
            ))}
            {candidate.whySelected.length > 2 && (
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground ml-5"
                onClick={() => onNavigateTab("decision")}
              >
                +{candidate.whySelected.length - 2} more in Decision tab
              </button>
            )}
          </div>
        )}

        {/* Primary warning */}
        {topWarning && (
          <div className="flex items-start gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-amber-400 mb-0.5">
                Active Warning
              </p>
              <p className="text-xs leading-relaxed">{topWarning}</p>
            </div>
          </div>
        )}

        {/* Score snapshot */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="rounded border border-border/40 px-2 py-1.5 text-center">
            <div className="text-[10px] text-muted-foreground">Confidence</div>
            <div className="text-xs font-medium capitalize mt-0.5">
              {candidate.confidence ?? "—"}
            </div>
          </div>
          <div className="rounded border border-border/40 px-2 py-1.5 text-center">
            <div className="text-[10px] text-muted-foreground">Warnings</div>
            <div
              className={cn(
                "text-xs font-medium mt-0.5",
                candidate.warnings.length > 0 ? "text-amber-400" : "text-emerald-400",
              )}
            >
              {candidate.warnings.length}
            </div>
          </div>
          <div className="rounded border border-border/40 px-2 py-1.5 text-center">
            <div className="text-[10px] text-muted-foreground">Strategy</div>
            <div className="text-xs font-medium mt-0.5 truncate">
              {candidate.strategy ?? "—"}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceEvidenceSummary — 6-provider compact rows
// ---------------------------------------------------------------------------

interface WorkspaceEvidenceSummaryProps {
  pkg: ResearchPackage;
  stars: EvidenceStars;
  newsData: SentimentResponseMin | null;
  onNavigateTab: (tab: string) => void;
  completedAt: string;
}

export function WorkspaceEvidenceSummary({
  pkg,
  stars,
  newsData,
  onNavigateTab,
  completedAt,
}: WorkspaceEvidenceSummaryProps) {
  const rows = buildEvidenceSummaryRows(pkg, stars, newsData);

  return (
    <Card className="border-border/40" id="ws-evidence" data-testid="ws-evidence-summary">
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-sky-400" />
            Evidence Summary
          </CardTitle>
          <span className="text-[10px] text-muted-foreground">{fmtRel(completedAt)}</span>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Deterministic ratings only — no AI weighting or trade recommendation
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <div className="space-y-0">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-2.5 py-2 border-b border-border/20 last:border-0"
              data-testid={`ws-evidence-row-${row.id}`}
            >
              <StrengthIcon strength={row.strength} />
              <span className="text-xs font-medium w-28 shrink-0">{row.label}</span>
              <span
                className={cn(
                  "text-[10px] shrink-0",
                  strengthTextClass(row.strength),
                )}
              >
                {strengthLabel(row.strength)}
              </span>
              <span className="text-[10px] text-muted-foreground truncate flex-1 hidden sm:block">
                {row.note}
              </span>
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground shrink-0 ml-auto"
                onClick={() => onNavigateTab(row.tabTarget)}
                aria-label={`Open ${row.label} details tab`}
              >
                View
              </button>
            </div>
          ))}
        </div>
        {/* Congress disclaimer */}
        <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed border-t border-border/30 pt-2">
          Publicly disclosed congressional transactions. Disclosure dates may lag transaction
          dates and do not indicate future performance.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceStockPlanSummary — compact stock planning
// ---------------------------------------------------------------------------

interface WorkspaceStockPlanSummaryProps {
  pkg: ResearchPackage;
  onNavigateTab: (tab: string) => void;
}

export function WorkspaceStockPlanSummary({
  pkg,
  onNavigateTab,
}: WorkspaceStockPlanSummaryProps) {
  const { candidate } = pkg;

  const fields: Array<{ label: string; value: string; mono?: boolean; highlight?: string }> = [
    {
      label: "Entry / Breakout Zone",
      value: candidate.trigger ? `Near ${candidate.trigger}` : "Not resolved",
      mono: true,
      highlight: candidate.trigger ? "text-emerald-300" : undefined,
    },
    {
      label: "Stop / Invalidation",
      value: candidate.invalidation ? `Below ${candidate.invalidation}` : "Scanner did not supply a stop",
      mono: !!candidate.invalidation,
      highlight: candidate.invalidation ? "text-rose-300" : undefined,
    },
    {
      label: "Risk / Reward",
      value:
        candidate.rewardRisk != null
          ? `${candidate.rewardRisk.toFixed(1)}:1`
          : "Requires entry, stop and objective",
      mono: candidate.rewardRisk != null,
    },
    {
      label: "Est. Max Risk",
      value:
        candidate.maxRisk != null
          ? `$${candidate.maxRisk.toLocaleString()} per planned position`
          : "Requires risk budget",
    },
  ];

  return (
    <Card className="border-border/40" id="ws-stock-plan" data-testid="ws-stock-plan-summary">
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            Stock Trade Planning
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] gap-0.5 text-muted-foreground hover:text-foreground px-2"
            onClick={() => onNavigateTab("trade-planning")}
            data-testid="ws-stock-plan-open-full"
            aria-label="Open full trade planning tab"
          >
            Full Planning <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Educational planning only — not a trade recommendation
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
          {fields.map((f) => (
            <div key={f.label}>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {f.label}
              </div>
              <div
                className={cn(
                  "text-xs mt-0.5",
                  f.mono ? "font-mono" : "",
                  f.highlight ?? "text-muted-foreground",
                )}
              >
                {f.value}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceOptionsPlanSummary — illustrative options (no live data)
// ---------------------------------------------------------------------------

interface OptionsStructureLite {
  label: string;
  preferredDTE: string;
  strikeGuidance: string;
  reason: string;
  isDefinedRisk: boolean;
  timeDecay: string;
  marketOutlook: string;
}

interface WorkspaceOptionsPlanSummaryProps {
  optionsStructure: OptionsStructureLite | null;
  onNavigateTab: (tab: string) => void;
}

export function WorkspaceOptionsPlanSummary({
  optionsStructure,
  onNavigateTab,
}: WorkspaceOptionsPlanSummaryProps) {
  return (
    <Card
      className="border-border/40"
      id="ws-options-plan"
      data-testid="ws-options-plan-summary"
    >
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-violet-400" />
            Illustrative Options Structure
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px] gap-0.5 text-muted-foreground hover:text-foreground px-2"
            onClick={() => onNavigateTab("trade-planning")}
            data-testid="ws-options-plan-open-full"
            aria-label="Open full trade planning tab"
          >
            Full Planning <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Illustrative only — broker verification required for listed contracts and current pricing
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {optionsStructure ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[11px]">
                {optionsStructure.label}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px]",
                  optionsStructure.isDefinedRisk
                    ? "text-emerald-300 border-emerald-500/30"
                    : "text-amber-300 border-amber-500/30",
                )}
              >
                {optionsStructure.isDefinedRisk ? "Defined Risk" : "Undefined Risk"}
              </Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Target DTE Range
                </div>
                <div className="text-xs mt-0.5">{optionsStructure.preferredDTE}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Strike Framework
                </div>
                <div className="text-xs mt-0.5">{optionsStructure.strikeGuidance}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Time Decay
                </div>
                <div className="text-xs mt-0.5 text-muted-foreground">
                  {optionsStructure.timeDecay}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Why It Fits
                </div>
                <div className="text-xs mt-0.5 text-muted-foreground leading-relaxed">
                  {optionsStructure.reason}
                </div>
              </div>
            </div>
            <div className="rounded border border-border/40 bg-muted/10 px-3 py-2 flex items-start gap-2">
              <Info className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                No expiration dates, strikes, premiums, or Greeks are shown here. Connect a
                supported broker to resolve verified contract candidates below.
              </p>
            </div>
          </div>
        ) : (
          <div className="py-4 text-center">
            <p className="text-xs text-muted-foreground">
              Options structure is derived after Trade Planning is loaded.{" "}
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => onNavigateTab("trade-planning")}
              >
                Open Trade Planning
              </button>{" "}
              to view the full structure.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceRiskSummary — grouped risk display
// ---------------------------------------------------------------------------

interface WorkspaceRiskSummaryProps {
  pkg: ResearchPackage;
  snapshot: MarketSnapshot | undefined;
  onNavigateTab: (tab: string) => void;
}

export function WorkspaceRiskSummary({
  pkg,
  snapshot,
  onNavigateTab,
}: WorkspaceRiskSummaryProps) {
  const groups = buildRiskGroups(pkg, snapshot);
  const totalItems = groups.reduce((n, g) => n + g.items.length, 0);
  const criticalCount = groups
    .flatMap((g) => g.items)
    .filter((i) => i.severity === "critical").length;
  const highCount = groups
    .flatMap((g) => g.items)
    .filter((i) => i.severity === "high").length;

  return (
    <Card className="border-border/40" id="ws-risk" data-testid="ws-risk-summary">
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-amber-400" />
            Risk & Invalidation
          </CardTitle>
          <div className="flex items-center gap-2">
            {criticalCount > 0 && (
              <Badge
                variant="outline"
                className="text-[9px] text-rose-300 border-rose-500/30 bg-rose-500/10"
                data-testid="ws-risk-critical-count"
              >
                {criticalCount} critical
              </Badge>
            )}
            {highCount > 0 && (
              <Badge
                variant="outline"
                className="text-[9px] text-amber-300 border-amber-500/30 bg-amber-500/10"
                data-testid="ws-risk-high-count"
              >
                {highCount} high
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 space-y-3">
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No specific risk flags identified from the scanner for this candidate.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.id} data-testid={`ws-risk-group-${group.id}`}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                {group.label}
              </p>
              <div className="space-y-1.5">
                {group.items.map((item, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex items-start gap-2 rounded border px-3 py-2",
                      severityClass(item.severity),
                    )}
                    data-testid={`ws-risk-item-${group.id}-${idx}`}
                  >
                    {item.severity === "critical" ? (
                      <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-rose-400" />
                    ) : item.severity === "high" ? (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
                    ) : (
                      <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium leading-snug">{item.label}</p>
                      <p className="text-[10px] leading-relaxed mt-0.5 opacity-80">
                        {item.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceCongressNewsCatalystSummary — compact combined card
// ---------------------------------------------------------------------------

interface WorkspaceCongressNewsCatalystProps {
  pkg: ResearchPackage;
  newsData: SentimentResponseMin | null;
  snapshot: MarketSnapshot | undefined;
  onNavigateTab: (tab: string) => void;
}

export function WorkspaceCongressNewsCatalystSummary({
  pkg,
  newsData,
  snapshot,
  onNavigateTab,
}: WorkspaceCongressNewsCatalystProps) {
  const { candidate } = pkg;
  const articleCount = newsData?.articles.length ?? 0;
  const sentimentLabel = newsData?.snapshot?.overallSentiment ?? null;
  const earningsWarnings = candidate.warnings.filter(
    (w) => w.toLowerCase().includes("earnings") || w.toLowerCase().includes("catalyst"),
  );
  const highImpactNews = (snapshot?.topNews ?? []).filter((n) => n.impact === "high");

  return (
    <Card
      className="border-border/40"
      id="ws-congress-news"
      data-testid="ws-congress-news-catalyst"
    >
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px] font-medium">
          Congress · News · Catalysts
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 space-y-4">
        {/* Congress */}
        <div data-testid="ws-congress-summary">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <Landmark className="h-3 w-3" /> Congress
            </p>
            <button
              type="button"
              className="text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => onNavigateTab("congress")}
              aria-label="Open Congress details tab"
            >
              Open Congress Details
            </button>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Congressional disclosure data is available via CongressFlow. Open the Congress
            tab to view publicly disclosed transactions for {pkg.symbol}.
          </p>
          <p
            className="text-[10px] text-muted-foreground mt-1.5 italic"
            data-testid="ws-congress-disclaimer"
          >
            Publicly disclosed congressional transactions. Disclosure dates may lag transaction
            dates and do not indicate future performance.
          </p>
        </div>

        <div className="border-t border-border/30" />

        {/* News */}
        <div data-testid="ws-news-summary">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <Newspaper className="h-3 w-3" /> News & Sentiment
            </p>
            <button
              type="button"
              className="text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => onNavigateTab("news")}
              aria-label="Open News details tab"
            >
              Open News Details
            </button>
          </div>
          {articleCount > 0 ? (
            <div className="flex flex-wrap gap-4 text-xs">
              <div>
                <div className="text-[10px] text-muted-foreground">Articles Indexed</div>
                <div className="font-mono mt-0.5">{articleCount}</div>
              </div>
              {sentimentLabel && (
                <div>
                  <div className="text-[10px] text-muted-foreground">Aggregate Sentiment</div>
                  <div className="mt-0.5 capitalize">{sentimentLabel}</div>
                </div>
              )}
              {newsData?.stale && (
                <Badge
                  variant="outline"
                  className="text-[9px] text-amber-300 border-amber-500/30 self-center"
                >
                  Stale
                </Badge>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {newsData ? "No articles indexed for this symbol." : "Open the News tab to load coverage."}
            </p>
          )}
        </div>

        <div className="border-t border-border/30" />

        {/* Catalysts */}
        <div data-testid="ws-catalysts-summary">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Catalysts
            </p>
            <button
              type="button"
              className="text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => onNavigateTab("catalysts")}
              aria-label="Open Catalyst details tab"
            >
              Open Catalyst Details
            </button>
          </div>
          {earningsWarnings.length > 0 ? (
            <div className="space-y-1">
              {earningsWarnings.slice(0, 2).map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          ) : highImpactNews.length > 0 ? (
            <div className="space-y-1">
              {highImpactNews.slice(0, 2).map((n, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    {n.symbol}: {n.whyItMatters}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No earnings, catalyst, or high-impact market flags for this candidate.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceInstaTradePrepPanel — end-of-workspace CTA
// ---------------------------------------------------------------------------

interface WorkspaceInstaTradePrepPanelProps {
  pkg: ResearchPackage;
  hasSelectedContract: boolean;
  onConnectBroker: () => void;
  onNavigateTab: (tab: string) => void;
}

export function WorkspaceInstaTradePrepPanel({
  pkg,
  hasSelectedContract,
  onConnectBroker,
  onNavigateTab,
}: WorkspaceInstaTradePrepPanelProps) {
  const state = deriveInstaTradePrepState(pkg.brokerConnected, hasSelectedContract);

  return (
    <Card
      className={cn(
        "border",
        state === "contract_selected" || state === "stock_ready"
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-border/40",
      )}
      id="ws-instatrade"
      data-testid="ws-instatrade-prep-panel"
    >
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-primary" />
          InstaTrade® Preparation
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {state === "no_broker" && (
          <div className="space-y-3" data-testid="ws-instatrade-no-broker">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Connect a supported brokerage to enable:
            </p>
            <ul className="space-y-1.5">
              {[
                "Live quote verification",
                "Options-chain verification",
                "Account context and buying-power validation",
                "Order review through InstaTrade®",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <MinusCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground/50" />
                  {item}
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={onConnectBroker}
              data-testid="ws-instatrade-connect-broker-btn"
            >
              Connect Broker
            </Button>
          </div>
        )}

        {state === "no_contract" && (
          <div className="space-y-2" data-testid="ws-instatrade-no-contract">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Resolve or select a verified contract candidate before preparing an options review.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => onNavigateTab("trade-planning")}
              data-testid="ws-instatrade-resolve-btn"
            >
              Resolve Live Contracts
            </Button>
          </div>
        )}

        {state === "stock_ready" && (
          <div className="space-y-3" data-testid="ws-instatrade-stock-ready">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Broker connected. A stock structure review is available using scanner-derived
              parameters. For options review, resolve a verified contract candidate first.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className="text-[10px] text-emerald-300 border-emerald-500/30"
              >
                Broker Connected
              </Badge>
              <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/40">
                Read-Only · Not an order
              </Badge>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => onNavigateTab("trade-planning")}
              data-testid="ws-instatrade-stock-review-btn"
              aria-label="Open Trade Planning to prepare stock InstaTrade® review"
            >
              <Zap className="h-3.5 w-3.5" />
              Prepare Stock InstaTrade® Review
            </Button>
          </div>
        )}

        {state === "contract_selected" && (
          <div className="space-y-3" data-testid="ws-instatrade-contract-selected">
            <p className="text-xs text-muted-foreground leading-relaxed">
              A verified contract candidate is selected. You can prepare an options review
              through the Trade Planning tab.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className="text-[10px] text-emerald-300 border-emerald-500/30"
              >
                Contract Selected
              </Badge>
              <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/40">
                Read-Only · No order submitted
              </Badge>
            </div>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => onNavigateTab("trade-planning")}
              data-testid="ws-instatrade-options-review-btn"
              aria-label="Open Trade Planning to prepare options InstaTrade® review"
            >
              <Zap className="h-3.5 w-3.5" />
              Prepare Options InstaTrade® Review
            </Button>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground mt-3 border-t border-border/30 pt-2 leading-relaxed">
          User confirmation required before any order is submitted. InstaTrade® is a review
          workflow — no orders execute without explicit broker-side confirmation.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceBrokerStatusBadge — compact inline indicator
// ---------------------------------------------------------------------------

export function WorkspaceBrokerStatusBadge({
  connected,
  onConnect,
}: {
  connected: boolean;
  onConnect: () => void;
}) {
  if (connected) {
    return (
      <Badge
        variant="outline"
        className="text-[10px] text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
        data-testid="ws-broker-connected"
      >
        <Database className="h-2.5 w-2.5 mr-1" />
        Broker Connected
      </Badge>
    );
  }
  return (
    <button
      type="button"
      onClick={onConnect}
      className="inline-flex items-center gap-1 text-[10px] border border-border/40 rounded px-2 py-0.5 text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors"
      data-testid="ws-broker-disconnected"
    >
      <Database className="h-2.5 w-2.5" />
      Connect Broker
    </button>
  );
}
