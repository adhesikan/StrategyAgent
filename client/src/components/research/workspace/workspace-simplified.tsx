// workspace-simplified.tsx — Sprint 2.2.4 UX Simplification
//
// Information hierarchy: Understand → Plan → Verify → Execute (InstaTrade™)
//
// NEW components (above-the-fold):
//   WorkspaceHeroCard          — prominent thesis card, max 3 bullets
//   WorkspaceTradePlanCard     — two-column stock/options plan
//   WorkspacePrimaryActions    — single action area, one dominant CTA
//   WorkspaceRiskCompact       — max 3 risks, expandable
//   WorkspaceEvidenceCompact   — 4 score bars, expandable
//   WorkspaceMarketContextCompact — 4 rows compact
//   WorkspaceWhatChangedCompact   — one sentence lifecycle
//   WorkspaceAdvancedAccordion    — collapsible deep-dive sections
//   WorkspaceFooterCta            — mobile-only sticky CTA
//
// Pure helpers (exported for testing):
//   selectTopRisks, buildHeroData, buildCompactPlanData, formatWhatChanged
//
// NO server/API/calculation changes.
// All data comes from existing pkg / stars / snapshot / newsData props.

import { useState, useCallback, type ReactNode } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, TrendingUp, Minus, TrendingDown, Sparkles, ExternalLink, Shield, Target, BookOpen, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type {
  ResearchPackage,
  EvidenceStars,
  LifecycleItem,
  MarketSnapshot,
} from "@/components/research/types";
import type { OptionsStructure } from "@/components/research/structure";
import type { Thesis } from "@/components/research/decision";
import {
  buildRiskGroups,
  buildEvidenceSummaryRows,
  deriveLifecycleSummary,
  WorkspaceDecisionSummary,
  WorkspaceStockPlanSummary,
  WorkspaceOptionsPlanSummary,
  WorkspaceCongressNewsCatalystSummary,
} from "@/components/research/workspace/workspace-sections";
import type { RiskGroup, RiskItem, SentimentResponseMin } from "@/components/research/workspace/workspace-sections";
import { InstitutionalWorkspaceCompact } from "@/components/research/institutional";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HeroData {
  thesis: Thesis;
  postureLabel: string;
  postureVariant: "bullish" | "neutral" | "bearish";
  whySelected3: string[];
  topRiskLabel: string | null;
  topRiskSeverity: "critical" | "high" | "medium" | "low" | null;
  regimeLabel: string;
  confidence: string | null;
}

export interface CompactPlanData {
  entryZone: string;
  stop: string;
  target: string;
  rewardRisk: string;
  holdingPeriod: string;
  structureLabel: string;
  preferredDTE: string;
  strikeGuidance: string;
  isDefinedRisk: boolean;
  hasOptionsStructure: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for testing
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Flatten risk groups, sort by severity, return top N and hidden count. */
export function selectTopRisks(
  groups: RiskGroup[],
  maxShown: number,
): { shown: RiskItem[]; hiddenCount: number } {
  const all = groups.flatMap((g) => g.items);
  all.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4));
  return {
    shown: all.slice(0, maxShown),
    hiddenCount: Math.max(0, all.length - maxShown),
  };
}

function regimeLabel(regime: string | null): string {
  if (!regime) return "Unknown";
  const map: Record<string, string> = {
    TRENDING: "Trending",
    CHOPPY: "Choppy",
    RISK_OFF: "Risk-Off",
    RISK_ON: "Risk-On",
  };
  return map[regime] ?? regime;
}

function holdingPeriod(strategy?: string): string {
  if (!strategy) return "Swing trade";
  const s = strategy.toLowerCase();
  if (s.includes("day") || s.includes("orb") || s.includes("gap")) return "Intraday";
  if (s.includes("momentum")) return "Momentum (days–weeks)";
  return "Swing trade";
}

/** Build all display values for the Hero Decision Card. */
export function buildHeroData(
  pkg: ResearchPackage,
  thesis: Thesis,
  riskGroups: RiskGroup[],
): HeroData {
  const variantMap: Record<Thesis, HeroData["postureVariant"]> = {
    bullish: "bullish",
    neutral: "neutral",
    bearish: "bearish",
  };
  const labelMap: Record<Thesis, string> = {
    bullish: "Bullish Setup",
    neutral: "Neutral — Watch",
    bearish: "Bearish — Caution",
  };
  const { shown } = selectTopRisks(riskGroups, 1);
  return {
    thesis,
    postureLabel: labelMap[thesis] ?? "Unknown",
    postureVariant: variantMap[thesis] ?? "neutral",
    whySelected3: (pkg.candidate.whySelected ?? []).slice(0, 3),
    topRiskLabel: shown[0]?.label ?? null,
    topRiskSeverity: (shown[0]?.severity ?? null) as HeroData["topRiskSeverity"],
    regimeLabel: regimeLabel(pkg.marketRegime),
    confidence: pkg.candidate.confidence ?? null,
  };
}

/** Build compact two-column plan display data. */
export function buildCompactPlanData(
  pkg: ResearchPackage,
  optStructure: OptionsStructure | null,
): CompactPlanData {
  const c = pkg.candidate;
  return {
    entryZone: c.trigger ?? "—",
    stop: c.invalidation ?? "—",
    target: c.objective ?? "—",
    rewardRisk: c.rewardRisk != null ? `${c.rewardRisk.toFixed(1)}:1` : "—",
    holdingPeriod: holdingPeriod(c.strategy),
    structureLabel: optStructure?.label ?? "Not determined",
    preferredDTE: optStructure?.preferredDTE ?? "—",
    strikeGuidance: optStructure?.strikeGuidance ?? "—",
    isDefinedRisk: optStructure?.isDefinedRisk ?? false,
    hasOptionsStructure: optStructure !== null,
  };
}

/** Convert a LifecycleSummary into a single display sentence for the compact card. */
export function formatWhatChanged(item: LifecycleItem | null): string {
  const summary = deriveLifecycleSummary(item);
  if (summary.kind === "no_data") return "First appearance in this scan cycle.";
  if (summary.detail) return `${summary.headline} — ${summary.detail}`;
  return summary.headline;
}

// ---------------------------------------------------------------------------
// Internal UI helpers
// ---------------------------------------------------------------------------

function PostureBadge({ variant }: { variant: HeroData["postureVariant"] }) {
  const map = {
    bullish: { icon: TrendingUp, label: "Bullish", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
    neutral: { icon: Minus,      label: "Neutral",  cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
    bearish: { icon: TrendingDown,label: "Bearish", cls: "bg-rose-500/10 text-rose-400 border-rose-500/30" },
  };
  const { icon: Icon, label, cls } = map[variant];
  return (
    <Badge variant="outline" className={cn("text-[10px] font-medium gap-1 px-2 py-0.5", cls)}>
      <Icon className="h-2.5 w-2.5" />
      {label}
    </Badge>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const cls = {
    critical: "bg-rose-500",
    high: "bg-orange-400",
    medium: "bg-amber-400",
    low: "bg-slate-400",
  }[severity] ?? "bg-slate-400";
  return <span className={cn("inline-block w-1.5 h-1.5 rounded-full shrink-0", cls)} />;
}

function StrengthBar({ strength }: { strength: string }) {
  const config = {
    supports:    { width: "w-full",  cls: "bg-emerald-500" },
    neutral:     { width: "w-1/2",   cls: "bg-amber-500" },
    weakens:     { width: "w-1/4",   cls: "bg-rose-500" },
    unavailable: { width: "w-0",     cls: "bg-muted" },
  }[strength] ?? { width: "w-0", cls: "bg-muted" };
  return (
    <div className="h-1 rounded-full bg-muted/40 flex-1">
      <div className={cn("h-full rounded-full transition-all", config.cls, config.width)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceHeroCard
// ---------------------------------------------------------------------------

interface WorkspaceHeroCardProps {
  pkg: ResearchPackage;
  thesis: Thesis;
  riskGroups: RiskGroup[];
  onNavigateTab: (tab: string) => void;
}

export function WorkspaceHeroCard({
  pkg,
  thesis,
  riskGroups,
  onNavigateTab,
}: WorkspaceHeroCardProps) {
  const hero = buildHeroData(pkg, thesis, riskGroups);

  const borderColor = {
    bullish: "border-l-emerald-500/60",
    neutral: "border-l-amber-500/60",
    bearish: "border-l-rose-500/60",
  }[hero.postureVariant];

  return (
    <Card
      className={cn(
        "border border-border/40 border-l-[3px]",
        borderColor,
      )}
      data-testid="workspace-hero-card"
    >
      <CardContent className="px-5 py-5 space-y-4">
        {/* Top row: posture + strategy */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <PostureBadge variant={hero.postureVariant} />
            {pkg.candidate.strategy && (
              <span className="text-[11px] text-muted-foreground">
                {pkg.candidate.strategy}
              </span>
            )}
          </div>
          {hero.confidence && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/40">
              {hero.confidence} confidence
            </Badge>
          )}
        </div>

        {/* Research thesis — why it qualified */}
        {hero.whySelected3.length > 0 ? (
          <ul className="space-y-2" data-testid="hero-why-selected">
            {hero.whySelected3.map((point, i) => (
              <li key={i} className="flex items-start gap-2">
                <ChevronRight className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <span className="text-[13px] leading-relaxed">{point}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-muted-foreground italic">
            Qualification details not available.
          </p>
        )}

        {/* Metrics row */}
        <div className="grid grid-cols-3 gap-3 pt-1">
          <div className="space-y-0.5">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Top Risk</p>
            {hero.topRiskLabel ? (
              <div className="flex items-center gap-1.5">
                <SeverityDot severity={hero.topRiskSeverity ?? "low"} />
                <p className="text-[11px] font-medium leading-snug">{hero.topRiskLabel}</p>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">None flagged</p>
            )}
          </div>
          <div className="space-y-0.5">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Regime</p>
            <p className="text-[11px] font-medium">{hero.regimeLabel}</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Posture</p>
            <p className="text-[11px] font-medium">{hero.postureLabel}</p>
          </div>
        </div>

        {/* CTA */}
        <Button
          variant="outline"
          size="sm"
          className="w-full h-8 text-[12px] gap-1.5 mt-1"
          onClick={() => onNavigateTab("decision")}
          data-testid="hero-view-decision-btn"
        >
          View Full Decision
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceTradePlanCard
// ---------------------------------------------------------------------------

interface WorkspaceTradePlanCardProps {
  pkg: ResearchPackage;
  primaryOptionsStructure: OptionsStructure | null;
  onNavigateTab: (tab: string) => void;
}

export function WorkspaceTradePlanCard({
  pkg,
  primaryOptionsStructure,
  onNavigateTab,
}: WorkspaceTradePlanCardProps) {
  const plan = buildCompactPlanData(pkg, primaryOptionsStructure);

  return (
    <Card className="border-border/40" data-testid="workspace-trade-plan-card">
      <CardHeader className="px-5 py-3 pb-2">
        <CardTitle className="text-[13px] font-semibold text-foreground/90">
          Trade Plan
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-0">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          {/* LEFT — Stock Plan */}
          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Stock
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {[
                { label: "Entry Zone", value: plan.entryZone },
                { label: "Stop",       value: plan.stop },
                { label: "Target",     value: plan.target },
                { label: "Risk/Reward",value: plan.rewardRisk },
                { label: "Holding",    value: plan.holdingPeriod },
              ].map(({ label, value }) => (
                <div key={label} className="space-y-0.5">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</p>
                  <p className="text-[13px] font-mono font-medium">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="hidden md:block absolute left-1/2 top-12 bottom-4 w-px bg-border/30" />

          {/* RIGHT — Options Plan */}
          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Options (Illustrative)
            </p>
            {plan.hasOptionsStructure ? (
              <div className="grid grid-cols-1 gap-y-2">
                {[
                  { label: "Structure", value: plan.structureLabel },
                  { label: "Suggested DTE", value: plan.preferredDTE },
                  { label: "Strike Framework", value: plan.strikeGuidance },
                ].map(({ label, value }) => (
                  <div key={label} className="space-y-0.5">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</p>
                    <p className="text-[12px] font-medium leading-snug">{value}</p>
                  </div>
                ))}
                {plan.isDefinedRisk && (
                  <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400 w-fit mt-1">
                    <Shield className="h-2.5 w-2.5 mr-1" />
                    Defined Risk
                  </Badge>
                )}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground italic">
                Options structure not determined for this candidate.
              </p>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-0 text-[11px] text-primary gap-1"
              onClick={() => onNavigateTab("trade-planning")}
              data-testid="trade-plan-live-contracts-btn"
            >
              View Live Contracts
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </div>

        <p className="text-[9px] text-muted-foreground mt-3 pt-3 border-t border-border/20 leading-relaxed">
          All values are illustrative parameters based on the scanner thesis. Live contract
          prices require broker connection. Not a recommendation.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WorkspacePrimaryActions
// ---------------------------------------------------------------------------

interface WorkspacePrimaryActionsProps {
  pkg: ResearchPackage;
  onOpenAssistant: () => void;
  onConnectBroker: () => void;
  onNavigateTab: (tab: string) => void;
}

export function WorkspacePrimaryActions({
  pkg,
  onOpenAssistant,
  onConnectBroker,
  onNavigateTab,
}: WorkspacePrimaryActionsProps) {
  const isBrokerConnected = pkg.brokerConnected;

  return (
    <div className="space-y-2" data-testid="workspace-primary-actions">
      {/* Primary CTA */}
      {isBrokerConnected ? (
        <Button
          className="w-full h-10 text-[13px] font-semibold gap-2"
          onClick={() => onNavigateTab("trade-planning")}
          data-testid="action-review-instatrade"
        >
          <Zap className="h-4 w-4" />
          Review with InstaTrade™
        </Button>
      ) : (
        <Button
          variant="outline"
          className="w-full h-10 text-[13px] font-semibold gap-2 border-primary/40 text-primary hover:bg-primary/5"
          onClick={onConnectBroker}
          data-testid="action-connect-broker"
        >
          Connect Broker to Trade
        </Button>
      )}

      {/* Secondary actions */}
      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-[11px] gap-1.5 border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
          onClick={onOpenAssistant}
          data-testid="action-ask-ai"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Ask VCP AI
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-[11px] gap-1.5"
          onClick={() => onNavigateTab("congress")}
          data-testid="action-congress"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Congress
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-[11px] gap-1.5"
          onClick={() => onNavigateTab("trade-planning")}
          data-testid="action-trade-plan"
        >
          <Target className="h-3.5 w-3.5" />
          Trade Plan
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceRiskCompact
// ---------------------------------------------------------------------------

interface WorkspaceRiskCompactProps {
  groups: RiskGroup[];
  maxInitial?: number;
}

export function WorkspaceRiskCompact({
  groups,
  maxInitial = 3,
}: WorkspaceRiskCompactProps) {
  const [expanded, setExpanded] = useState(false);
  const { shown, hiddenCount } = selectTopRisks(groups, expanded ? 999 : maxInitial);

  const totalRisks = groups.reduce((s, g) => s + g.items.length, 0);
  if (totalRisks === 0) return null;

  const severityLabel: Record<string, string> = {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    low: "Low",
  };
  const severityColor: Record<string, string> = {
    critical: "text-rose-400 border-rose-500/30 bg-rose-500/5",
    high:     "text-orange-400 border-orange-500/30 bg-orange-500/5",
    medium:   "text-amber-400 border-amber-500/30 bg-amber-500/5",
    low:      "text-slate-400 border-border/40 bg-muted/20",
  };

  return (
    <Card className="border-border/40" data-testid="workspace-risk-compact">
      <CardHeader className="px-4 py-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[12px] font-semibold flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            Risks & Warnings
          </CardTitle>
          <Badge variant="outline" className="text-[9px] border-border/40 text-muted-foreground">
            {totalRisks} total
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 space-y-2">
        {shown.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <Badge
              variant="outline"
              className={cn("text-[9px] shrink-0 mt-0.5", severityColor[item.severity])}
            >
              {severityLabel[item.severity]}
            </Badge>
            <div className="min-w-0">
              <p className="text-[11px] font-medium leading-snug">{item.label}</p>
              <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{item.detail}</p>
            </div>
          </div>
        ))}

        {!expanded && hiddenCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-0 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded(true)}
            data-testid="risk-expand-btn"
          >
            +{hiddenCount} additional {hiddenCount === 1 ? "item" : "items"}
            <ChevronDown className="h-3 w-3 ml-1" />
          </Button>
        )}
        {expanded && hiddenCount === 0 && totalRisks > maxInitial && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-0 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded(false)}
            data-testid="risk-collapse-btn"
          >
            Show fewer
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceEvidenceCompact
// ---------------------------------------------------------------------------

interface WorkspaceEvidenceCompactProps {
  pkg: ResearchPackage;
  stars: EvidenceStars;
  newsData: SentimentResponseMin | null;
  onNavigateTab: (tab: string) => void;
}

export function WorkspaceEvidenceCompact({
  pkg,
  stars,
  newsData,
  onNavigateTab,
}: WorkspaceEvidenceCompactProps) {
  const [expanded, setExpanded] = useState(false);
  const rows = buildEvidenceSummaryRows(pkg, stars, newsData);
  const primary = rows.slice(0, 4);   // technical, regime, congress, news
  const secondary = rows.slice(4);    // catalysts, institutional

  const strengthIcon = (s: string) => {
    if (s === "supports") return <span className="text-emerald-400 text-[10px]">✓</span>;
    if (s === "weakens")  return <span className="text-rose-400 text-[10px]">↓</span>;
    return <span className="text-amber-400 text-[10px]">–</span>;
  };

  return (
    <Card className="border-border/40" data-testid="workspace-evidence-compact">
      <CardHeader className="px-4 py-3 pb-2">
        <CardTitle className="text-[12px] font-semibold">Evidence Summary</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 space-y-2">
        {primary.map((row) => (
          <div key={row.id} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-20 shrink-0">{row.label}</span>
            <StrengthBar strength={row.strength} />
            {strengthIcon(row.strength)}
          </div>
        ))}

        {expanded && secondary.map((row) => (
          <div key={row.id} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-20 shrink-0">{row.label}</span>
            <StrengthBar strength={row.strength} />
            {strengthIcon(row.strength)}
          </div>
        ))}

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-0 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded((v) => !v)}
            data-testid="evidence-expand-btn"
          >
            {expanded ? "Show less" : `Expand full evidence (+${secondary.length} more)`}
            <ChevronDown className={cn("h-3 w-3 ml-1 transition-transform", expanded && "rotate-180")} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-0 text-[10px] text-primary hover:underline"
            onClick={() => onNavigateTab("technical")}
          >
            Technical tab →
          </Button>
        </div>

        <p className="text-[9px] text-muted-foreground italic leading-relaxed">
          Congressional disclosures are not investment advice. Disclosed trades may not reflect
          current positions and are subject to reporting delays.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceMarketContextCompact
// ---------------------------------------------------------------------------

interface WorkspaceMarketContextCompactProps {
  pkg: ResearchPackage;
  completedAt: string;
}

export function WorkspaceMarketContextCompact({
  pkg,
  completedAt,
}: WorkspaceMarketContextCompactProps) {
  const rows = [
    { label: "Regime",       value: regimeLabel(pkg.marketRegime) },
    { label: "Data Source",  value: pkg.dataSource || "—" },
    { label: "Quality",      value: pkg.dataQuality || "—" },
    { label: "Scan Time",    value: completedAt ? new Date(completedAt).toLocaleDateString() : "—" },
  ];

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      data-testid="workspace-market-context-compact"
    >
      {rows.map(({ label, value }) => (
        <div key={label} className="space-y-0.5">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="text-[11px] font-medium">{value}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceWhatChangedCompact
// ---------------------------------------------------------------------------

interface WorkspaceWhatChangedCompactProps {
  item: LifecycleItem | null;
  onViewHistory: () => void;
}

export function WorkspaceWhatChangedCompact({
  item,
  onViewHistory,
}: WorkspaceWhatChangedCompactProps) {
  const sentence = formatWhatChanged(item);

  return (
    <div
      className="flex items-center justify-between gap-3 flex-wrap text-[11px] text-muted-foreground"
      data-testid="workspace-what-changed-compact"
    >
      <span>{sentence}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-0 text-[10px] text-primary hover:underline shrink-0"
        onClick={onViewHistory}
        data-testid="what-changed-view-history-btn"
      >
        View Scan History →
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceAdvancedAccordion
// ---------------------------------------------------------------------------

interface AccordionSection {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface WorkspaceAdvancedAccordionProps {
  pkg: ResearchPackage;
  stars: EvidenceStars;
  newsData: SentimentResponseMin | null;
  snapshot: MarketSnapshot | null | undefined;
  workspaceOptionsStructures: OptionsStructure[];
  selectedContractId: string | null;
  onNavigateTab: (tab: string) => void;
  /** Scan history rendered JSX — passed from the page to avoid duplicating local component logic. */
  scanHistoryContent?: ReactNode;
}

function AccordionItem({
  section,
  isOpen,
  onToggle,
}: {
  section: AccordionSection;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-border/20 last:border-0">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-3 py-3 px-1 text-left hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`accordion-content-${section.id}`}
        data-testid={`accordion-btn-${section.id}`}
      >
        <span className="text-[12px] font-medium text-muted-foreground group-hover:text-foreground">
          {section.label}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>
      <div
        id={`accordion-content-${section.id}`}
        role="region"
        aria-labelledby={`accordion-btn-${section.id}`}
        className={cn(
          "overflow-hidden transition-all duration-200",
          isOpen ? "max-h-[2000px] pb-4" : "max-h-0",
        )}
        data-testid={`accordion-content-${section.id}`}
      >
        {section.content}
      </div>
    </div>
  );
}

export function WorkspaceAdvancedAccordion({
  pkg,
  stars,
  newsData,
  snapshot,
  workspaceOptionsStructures,
  selectedContractId,
  onNavigateTab,
  scanHistoryContent,
}: WorkspaceAdvancedAccordionProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
  }, []);

  const LinkButton = ({ tab, label }: { tab: string; label: string }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 text-[11px] gap-1.5 text-primary"
      onClick={() => onNavigateTab(tab)}
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </Button>
  );

  const sections: AccordionSection[] = [
    {
      id: "full-decision",
      label: "Decision Engine",
      content: (
        <div className="space-y-2">
          <WorkspaceDecisionSummary pkg={pkg} stars={stars} onNavigateTab={onNavigateTab} />
          <div className="flex justify-end">
            <LinkButton tab="decision" label="Full Decision Engine" />
          </div>
        </div>
      ),
    },
    {
      id: "trade-planning",
      label: "Trade Planning Details",
      content: (
        <div className="space-y-3">
          <WorkspaceStockPlanSummary pkg={pkg} onNavigateTab={onNavigateTab} />
          <WorkspaceOptionsPlanSummary
            optionsStructure={workspaceOptionsStructures[0] ?? null}
            onNavigateTab={onNavigateTab}
          />
          <div className="flex justify-end">
            <LinkButton tab="trade-planning" label="Live Contracts & Full Plan" />
          </div>
        </div>
      ),
    },
    {
      id: "congress-news",
      label: "Congress / News / Catalysts",
      content: (
        <div className="space-y-2">
          <WorkspaceCongressNewsCatalystSummary
            pkg={pkg}
            newsData={newsData}
            snapshot={snapshot ?? undefined}
            onNavigateTab={onNavigateTab}
          />
          <div className="flex gap-2 justify-end flex-wrap">
            <LinkButton tab="congress" label="Congress" />
            <LinkButton tab="news" label="News" />
            <LinkButton tab="catalysts" label="Catalysts" />
          </div>
        </div>
      ),
    },
    {
      id: "technical",
      label: "Technical Analysis",
      content: (
        <div className="flex items-center justify-between py-1">
          <p className="text-[11px] text-muted-foreground">
            Full charting, indicators, and technical deep-dive in the Technical tab.
          </p>
          <LinkButton tab="technical" label="View Technical" />
        </div>
      ),
    },
    {
      id: "institutional",
      label: "Institutional Activity",
      content: (
        <div className="flex items-center justify-between py-1">
          <p className="text-[11px] text-muted-foreground">
            Institutional ownership and 13F data in the Institutional tab.
          </p>
          <LinkButton tab="institutional" label="View Institutional" />
        </div>
      ),
    },
    {
      id: "ai-summary",
      label: "AI Summary",
      content: (
        <div className="flex items-center justify-between py-1">
          <p className="text-[11px] text-muted-foreground">
            VCP AI consolidated research summary.
          </p>
          <LinkButton tab="ai-summary" label="View AI Summary" />
        </div>
      ),
    },
    {
      id: "scan-history",
      label: "Scan History",
      content: scanHistoryContent ?? (
        <p className="text-[11px] text-muted-foreground py-1">
          {pkg.scanHistory.length === 0
            ? "No scan history available yet."
            : `${pkg.scanHistory.length} scan entries recorded.`}
        </p>
      ),
    },
  ];

  return (
    <div data-testid="workspace-advanced-accordion">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 px-1">
        Advanced Sections
      </p>
      <Card className="border-border/40">
        <CardContent className="px-4 py-0">
          {sections.map((section) => (
            <AccordionItem
              key={section.id}
              section={section}
              isOpen={openId === section.id}
              onToggle={() => toggle(section.id)}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceFooterCta — mobile-only sticky CTA
// ---------------------------------------------------------------------------

interface WorkspaceFooterCtaProps {
  pkg: ResearchPackage;
  hidden?: boolean;
  onConnectBroker: () => void;
  onNavigateTab: (tab: string) => void;
}

export function WorkspaceFooterCta({
  pkg,
  hidden = false,
  onConnectBroker,
  onNavigateTab,
}: WorkspaceFooterCtaProps) {
  if (hidden) return null;

  return (
    <div
      className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur border-t border-border/30 px-4 py-3 safe-area-bottom"
      data-testid="workspace-footer-cta"
      aria-label="Primary action"
    >
      {pkg.brokerConnected ? (
        <Button
          className="w-full h-10 text-[13px] font-semibold gap-2"
          onClick={() => onNavigateTab("trade-planning")}
          data-testid="footer-cta-instatrade"
        >
          <Zap className="h-4 w-4" />
          Review with InstaTrade™
        </Button>
      ) : (
        <Button
          variant="outline"
          className="w-full h-10 text-[13px] gap-2 border-primary/40 text-primary"
          onClick={onConnectBroker}
          data-testid="footer-cta-connect"
        >
          Connect Broker to Trade
        </Button>
      )}
    </div>
  );
}
