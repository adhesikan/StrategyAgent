// /opportunity/:symbol — Sprint 2.1 Research Package
//
// Displays a structured educational Research Package for a single
// Opportunity Engine candidate. All data comes from deterministic
// scanner output — no AI generation, no fabricated values.
//
// Compliance rules applied throughout:
//   - Never uses "buy", "sell", "recommendation", "expected profit", "target return"
//   - All price/level fields are labeled as "educational planning" only
//   - InstaTrade™ section is read-only planning display; never an execution button

import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient as useRQClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  MinusCircle,
  XCircle,
  TrendingUp,
  TrendingDown,
  Zap,
  Shield,
  Clock,
  Database,
  Activity,
  BookOpen,
  Star,
  BarChart2,
  FileText,
  Users,
  Newspaper,
  GraduationCap,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RefreshCcw,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";

// ---------------------------------------------------------------------------
// Types (mirror server/routes/opportunity-research.ts)
// ---------------------------------------------------------------------------

type LifecycleState =
  | "NEWLY_QUALIFIED"
  | "STILL_QUALIFIED"
  | "STRENGTHENING"
  | "WEAKENING"
  | "APPROACHING"
  | "TRIGGERED"
  | "DROPPED"
  | "UNAVAILABLE";

interface LifecycleItem {
  symbol: string;
  lifecycleState: LifecycleState;
  qualificationStatus: "QUALIFIED" | "WATCHING" | "ABSENT";
  strategy?: string;
  rankCurrent: number | null;
  rankPrev: number | null;
  scoreCurrent: number;
  scorePrev: number;
  scoreDelta: number;
  firstSeen: string | null;
  lastUpdated: string;
}

interface ScanHistoryEntry {
  id: string;
  snapshotId: string;
  scanTime: string;
  rank: number | null;
  score: number;
  qualificationStatus: string;
  lifecycleState: string;
  strategy: string | null;
  marketRegime: string | null;
  createdAt: string;
}

interface Candidate {
  rank: number;
  symbol: string;
  strategy?: string;
  setupStatus?: string;
  instrument?: string;
  structure?: string;
  trigger?: string;
  invalidation?: string;
  objective?: string;
  rewardRisk?: number;
  maxRisk?: number;
  quantity?: number;
  confidence?: string;
  dataQuality?: string;
  fitsRiskBudget?: boolean;
  strategyScore?: number;
  currentPrice?: number;
  whySelected: string[];
  warnings: string[];
}

interface ResearchPackage {
  symbol: string;
  candidate: Candidate;
  lifecycleItem: LifecycleItem | null;
  scanHistory: ScanHistoryEntry[];
  brokerConnected: boolean;
  marketRegime: string | null;
  dataSource: string;
  dataQuality: string;
  freshnessStatus: "fresh" | "stale";
  completedAt: string;
  snapshotId: string;
}

interface MarketSnapshot {
  marketRegime?: { regime: string; strength: number; description: string } | null;
  marketTone?: string | null;
  vix?: { last: number; changePercent: number } | null;
  sectorLeadership?: Array<{ symbol: string; name: string; changePercent: number }>;
  topNews?: Array<{
    symbol: string;
    label: string;
    impact: string;
    whyItMatters: string;
    buzz: number;
    articleCount: number;
  }>;
  asOf?: string;
}

interface DashboardResponse {
  marketSnapshot:
    | { status: "ok"; data: MarketSnapshot }
    | { status: "unavailable" };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIFECYCLE_BADGE: Record<
  LifecycleState,
  { label: string; className: string }
> = {
  NEWLY_QUALIFIED: { label: "New Today",    className: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  STILL_QUALIFIED: { label: "Holding",      className: "text-sky-300 border-sky-500/40 bg-sky-500/10" },
  STRENGTHENING:   { label: "Strengthening", className: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  WEAKENING:       { label: "Weakening",    className: "text-amber-300 border-amber-500/40 bg-amber-500/10" },
  APPROACHING:     { label: "Approaching",  className: "text-violet-300 border-violet-500/40 bg-violet-500/10" },
  TRIGGERED:       { label: "Triggered",    className: "text-sky-300 border-sky-500/40 bg-sky-500/10" },
  DROPPED:         { label: "Dropped",      className: "text-rose-300 border-rose-500/40 bg-rose-500/10" },
  UNAVAILABLE:     { label: "Data Gap",     className: "text-muted-foreground border-border/40" },
};

const REGIME_LABEL: Record<string, string> = {
  TRENDING:  "Strong Bull",
  CHOPPY:    "Choppy",
  RISK_OFF:  "Risk-Off",
};

const OPTIONS_STRUCTURES = [
  {
    name: "Long Stock",
    outlook: "Bullish — expects price appreciation over time",
    capitalEfficiency: "Requires full capital (100% of share price × quantity)",
    definedRisk: "Loses full investment value if price drops to zero; no built-in stop",
    timeDecay: "No time decay — position does not expire",
    liquidity: "Typically the most liquid structure for large-cap stocks",
    suitableWhen: "Trader wants uncapped upside and is comfortable holding through volatility",
  },
  {
    name: "Long Call",
    outlook: "Bullish — expects significant price increase before expiration",
    capitalEfficiency: "High leverage; controls 100 shares for a fraction of the stock price",
    definedRisk: "Maximum loss is limited to the premium paid",
    timeDecay: "Time decay (theta) works against the holder — value erodes daily",
    liquidity: "Varies; liquid for near-the-money options on active stocks",
    suitableWhen: "Trader expects a large move and wants defined downside with leverage",
  },
  {
    name: "Bull Call Spread",
    outlook: "Moderately bullish — expects move to a defined upper level",
    capitalEfficiency: "Reduced premium cost versus a single long call; capped upside",
    definedRisk: "Maximum loss is the net debit paid; maximum gain is capped at the spread width",
    timeDecay: "Mixed — long leg decays, short leg partially offsets",
    liquidity: "Requires two option legs; wider spreads may have lower liquidity",
    suitableWhen: "Trader wants limited-risk exposure with lower entry cost than a long call",
  },
  {
    name: "Cash-Secured Put",
    outlook: "Neutral to mildly bullish — comfortable owning shares at the strike",
    capitalEfficiency: "Requires cash equal to 100× the strike price as collateral",
    definedRisk: "Maximum loss is strike price minus premium received (substantial if stock collapses)",
    timeDecay: "Works in the seller's favor — premium erodes over time",
    liquidity: "Good liquidity on actively traded stocks; check open interest before entering",
    suitableWhen: "Trader is comfortable acquiring shares at the strike and wants premium income",
  },
  {
    name: "Covered Call",
    outlook: "Neutral to mildly bullish — willing to cap upside for income",
    capitalEfficiency: "Requires long position in underlying stock (100 shares per contract)",
    definedRisk: "Upside is capped at strike; stock decline risk is unchanged",
    timeDecay: "Works in the seller's favor — premium erodes over time",
    liquidity: "Typically good; depends on underlying stock liquidity",
    suitableWhen: "Trader already holds shares and wants to generate income against the position",
  },
  {
    name: "Protective Put",
    outlook: "Hedging — expects downside risk on an existing long stock position",
    capitalEfficiency: "Insurance cost reduces net return on the stock position",
    definedRisk: "Limits downside to strike price minus premium paid",
    timeDecay: "Works against the holder — value erodes if stock stays flat",
    liquidity: "Good for near-the-money puts on major stocks; check bid-ask spreads",
    suitableWhen: "Trader holds shares through a catalyst and wants to cap maximum loss",
  },
];

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

function formatRelativeTime(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
  } catch {
    return "—";
  }
}

function askRoute(prompt: string): string {
  return `/ask?q=${encodeURIComponent(prompt)}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div className="w-full max-w-5xl mx-auto px-4 md:px-8 py-6 space-y-4" data-testid="research-skeleton">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function SectionError({
  label,
  onRetry,
}: {
  label: string;
  onRetry: () => void;
}) {
  return (
    <Card className="border-rose-500/20">
      <CardContent className="flex items-center gap-3 py-4">
        <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
        <span className="text-sm text-muted-foreground">
          Could not load {label}.
        </span>
        <Button size="sm" variant="ghost" onClick={onRetry} className="ml-auto h-7 gap-1 text-xs">
          <RefreshCcw className="h-3 w-3" /> Retry
        </Button>
      </CardContent>
    </Card>
  );
}

function LastUpdated({ iso }: { iso: string }) {
  return (
    <span className="text-[10px] text-muted-foreground">
      Updated {formatRelativeTime(iso)}
    </span>
  );
}

function LifecycleBadge({ state }: { state: LifecycleState }) {
  const cfg = LIFECYCLE_BADGE[state];
  return (
    <Badge variant="outline" className={cn("text-[10px]", cfg.className)}>
      {cfg.label}
    </Badge>
  );
}

type EvidenceStatus = "pass" | "warning" | "neutral";

function EvidenceRow({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: EvidenceStatus;
}) {
  const icon =
    status === "pass" ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
    ) : status === "warning" ? (
      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
    ) : (
      <MinusCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    );

  return (
    <div className="flex items-center gap-2.5 py-1.5 border-b border-border/30 last:border-0">
      {icon}
      <span className="text-xs font-medium w-36 shrink-0">{label}</span>
      <span
        className={cn(
          "text-xs",
          status === "pass"
            ? "text-foreground/80"
            : status === "warning"
            ? "text-amber-300"
            : "text-muted-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function SummaryField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xs leading-relaxed">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 1 — Research Header
// ---------------------------------------------------------------------------

function ResearchHeader({ pkg }: { pkg: ResearchPackage }) {
  const { candidate, lifecycleItem, freshnessStatus, completedAt, marketRegime, dataSource } = pkg;

  const qualStatus =
    lifecycleItem?.qualificationStatus === "QUALIFIED"
      ? "Opportunity Qualified"
      : lifecycleItem?.qualificationStatus === "WATCHING"
      ? "Watching"
      : "Opportunity Qualified"; // fallback for first scan

  return (
    <Card className="border-border/40" data-testid="section-research-header">
      <CardContent className="px-4 py-4 space-y-3">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="font-mono font-bold text-3xl tracking-tight"
                data-testid="research-symbol"
              >
                {pkg.symbol}
              </span>
              {candidate.strategy && (
                <Badge variant="outline" className="text-[10px] border-border/50">
                  {candidate.strategy}
                </Badge>
              )}
              {lifecycleItem && (
                <LifecycleBadge state={lifecycleItem.lifecycleState} />
              )}
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px]",
                  freshnessStatus === "fresh"
                    ? "text-emerald-300 border-emerald-500/30"
                    : "text-amber-300 border-amber-500/30",
                )}
                data-testid="research-freshness"
              >
                {freshnessStatus === "fresh" ? "Fresh" : "Stale"}
              </Badge>
            </div>
            {candidate.setupStatus && (
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {candidate.setupStatus}
              </div>
            )}
          </div>

          {/* Rank block */}
          <div className="text-right space-y-0.5">
            <div className="text-2xl font-mono font-semibold">
              #{candidate.rank}
            </div>
            {lifecycleItem?.rankPrev && lifecycleItem.rankPrev !== candidate.rank && (
              <div className="text-[10px] text-muted-foreground">
                was #{lifecycleItem.rankPrev}
                {(lifecycleItem.rankPrev - candidate.rank) > 0 ? (
                  <span className="text-emerald-400 ml-1">
                    ▲{lifecycleItem.rankPrev - candidate.rank}
                  </span>
                ) : (
                  <span className="text-rose-400 ml-1">
                    ▼{candidate.rank - lifecycleItem.rankPrev}
                  </span>
                )}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground">Current Rank</div>
          </div>
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground border-t border-border/30 pt-2.5">
          {marketRegime && (
            <span className="flex items-center gap-1">
              <Activity className="h-3 w-3" />
              Regime: <span className="text-foreground/80 ml-0.5">{REGIME_LABEL[marketRegime] ?? marketRegime}</span>
            </span>
          )}
          <span className="flex items-center gap-1">
            <Database className="h-3 w-3" />
            {dataSource}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Scanned {formatDate(completedAt)}
          </span>
          {candidate.confidence && (
            <span className="flex items-center gap-1">
              <Shield className="h-3 w-3" />
              Confidence: <span className="text-foreground/80 ml-0.5 capitalize">{candidate.confidence}</span>
            </span>
          )}
        </div>

        {/* Opportunity status */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant="outline"
            className="text-[10px] text-emerald-300 border-emerald-500/30"
            data-testid="research-opp-status"
          >
            {qualStatus}
          </Badge>
          {lifecycleItem?.firstSeen && (
            <span className="text-[10px] text-muted-foreground">
              First seen {formatDate(lifecycleItem.firstSeen)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — Research Summary
// ---------------------------------------------------------------------------

function ResearchSummary({ pkg }: { pkg: ResearchPackage }) {
  const { candidate, lifecycleItem, marketRegime } = pkg;

  const whyQualified =
    candidate.whySelected.length > 0
      ? candidate.whySelected[0]
      : "Pattern identified by scanner criteria";

  const whatChanged = lifecycleItem
    ? lifecycleItem.lifecycleState === "STRENGTHENING"
      ? `Rank improved from #${lifecycleItem.rankPrev ?? "—"} to #${lifecycleItem.rankCurrent ?? "—"} since previous scan`
      : lifecycleItem.lifecycleState === "WEAKENING"
      ? `Rank fell from #${lifecycleItem.rankPrev ?? "—"} to #${lifecycleItem.rankCurrent ?? "—"} since previous scan`
      : lifecycleItem.lifecycleState === "NEWLY_QUALIFIED"
      ? "New to the qualified list in this scan"
      : lifecycleItem.lifecycleState === "STILL_QUALIFIED"
      ? `Held rank #${lifecycleItem.rankCurrent ?? "—"} — stable since previous scan`
      : `Status: ${lifecycleItem.lifecycleState.replace(/_/g, " ").toLowerCase()}`
    : "First scan — no previous comparison available";

  const technicalPosture =
    candidate.setupStatus ?? candidate.strategy ?? "See Technical Evidence section";

  const currentRegime =
    marketRegime
      ? `${REGIME_LABEL[marketRegime] ?? marketRegime} — ${
          marketRegime === "TRENDING"
            ? "broad market showing upward trend"
            : marketRegime === "RISK_OFF"
            ? "broad market in defensive posture"
            : "broad market in consolidation"
        }`
      : "Regime data unavailable";

  const primaryOpportunity =
    candidate.trigger
      ? `Entry zone near ${candidate.trigger}${candidate.invalidation ? `; below ${candidate.invalidation} invalidates the setup` : ""}`
      : candidate.objective
      ? candidate.objective
      : "Review Technical Evidence for level details";

  const primaryRisks =
    candidate.warnings.length > 0
      ? candidate.warnings[0]
      : candidate.invalidation
      ? `Setup invalidated below ${candidate.invalidation}`
      : "Review Risk Factors section";

  const catalysts = "Review upcoming earnings and market events in the Market Context section";

  return (
    <Card className="border-border/40" data-testid="section-research-summary">
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-violet-400" />
            Research Summary
          </CardTitle>
          <LastUpdated iso={pkg.completedAt} />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
        <SummaryField label="Why This Qualified" value={whyQualified} />
        <SummaryField label="What Changed" value={whatChanged} />
        <SummaryField label="Technical Posture" value={technicalPosture} />
        <SummaryField label="Market Regime" value={currentRegime} />
        <SummaryField label="Primary Opportunity" value={primaryOpportunity} />
        <SummaryField label="Primary Risks" value={primaryRisks} />
        <SummaryField label="Upcoming Catalysts" value={catalysts} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — Technical Evidence
// ---------------------------------------------------------------------------

function buildEvidenceItems(candidate: Candidate): Array<{
  label: string;
  value: string;
  status: EvidenceStatus;
}> {
  const items: Array<{ label: string; value: string; status: EvidenceStatus }> = [];

  // Strategy
  items.push({
    label: "Strategy Identified",
    value: candidate.strategy ?? "Not specified",
    status: candidate.strategy ? "pass" : "neutral",
  });

  // Confidence
  const conf = (candidate.confidence ?? "").toLowerCase();
  items.push({
    label: "Confidence Level",
    value: conf ? conf.charAt(0).toUpperCase() + conf.slice(1) : "Not specified",
    status: conf === "high" ? "pass" : conf === "medium" ? "warning" : conf === "low" ? "warning" : "neutral",
  });

  // Entry level
  items.push({
    label: "Entry Level",
    value: candidate.trigger ? `Near ${candidate.trigger}` : "Not specified",
    status: candidate.trigger ? "pass" : "neutral",
  });

  // Stop / invalidation
  items.push({
    label: "Stop / Invalidation",
    value: candidate.invalidation ? `Below ${candidate.invalidation}` : "Not specified",
    status: candidate.invalidation ? "pass" : "warning",
  });

  // Risk/Reward
  const rr = candidate.rewardRisk;
  items.push({
    label: "Risk/Reward Ratio",
    value: rr != null ? `${rr.toFixed(1)}:1` : "Not calculated",
    status: rr != null ? (rr >= 2 ? "pass" : "warning") : "neutral",
  });

  // Max risk
  items.push({
    label: "Max Risk Estimate",
    value:
      candidate.maxRisk != null
        ? `$${candidate.maxRisk.toLocaleString()} per planned position`
        : "Not calculated",
    status: candidate.maxRisk != null ? "pass" : "neutral",
  });

  // Setup status
  if (candidate.setupStatus) {
    items.push({
      label: "Setup Stage",
      value: candidate.setupStatus,
      status: "pass",
    });
  }

  // Why selected items
  for (const why of candidate.whySelected) {
    items.push({
      label: "Scanner Criteria",
      value: why,
      status: "pass",
    });
  }

  // Warning flags
  for (const warn of candidate.warnings) {
    items.push({
      label: "Warning Flag",
      value: warn,
      status: "warning",
    });
  }

  return items;
}

function TechnicalEvidence({ pkg }: { pkg: ResearchPackage }) {
  const items = buildEvidenceItems(pkg.candidate);
  const passes = items.filter((i) => i.status === "pass").length;
  const warnings = items.filter((i) => i.status === "warning").length;

  return (
    <Card className="border-border/40" data-testid="section-technical-evidence">
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            Technical Evidence
          </CardTitle>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="text-emerald-400">{passes} pass</span>
            {warnings > 0 && <span className="text-amber-400">{warnings} warning</span>}
            <LastUpdated iso={pkg.completedAt} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No evidence items available from scanner.</p>
        ) : (
          <div>
            {items.map((item, idx) => (
              <EvidenceRow
                key={`${item.label}-${idx}`}
                label={item.label}
                value={item.value}
                status={item.status}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 4 — Market Context
// ---------------------------------------------------------------------------

function MarketContextSection({
  snapshot,
  isLoading,
}: {
  snapshot?: MarketSnapshot;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card className="border-border/40" data-testid="section-market-context">
        <CardHeader className="px-4 py-3">
          <CardTitle className="text-[13px] font-medium">Market Context</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (!snapshot) {
    return (
      <Card className="border-border/40" data-testid="section-market-context">
        <CardContent className="px-4 py-4">
          <p className="text-xs text-muted-foreground">Market context data unavailable.</p>
        </CardContent>
      </Card>
    );
  }

  const regime = snapshot.marketRegime;
  const regimeColor =
    regime?.regime === "TRENDING"
      ? "text-emerald-400"
      : regime?.regime === "RISK_OFF"
      ? "text-rose-400"
      : "text-amber-400";

  const highImpactNews = (snapshot.topNews ?? []).filter((n) => n.impact === "high").slice(0, 3);

  return (
    <Card className="border-border/40" data-testid="section-market-context">
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-sky-400" />
            Market Context
          </CardTitle>
          {snapshot.asOf && <LastUpdated iso={snapshot.asOf} />}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 space-y-4">
        {/* Regime + VIX */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded border border-border/40 px-3 py-2 space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Regime</div>
            <div className={cn("text-sm font-medium", regimeColor)}>
              {regime ? (REGIME_LABEL[regime.regime] ?? regime.regime) : "Unavailable"}
            </div>
            {regime?.description && (
              <div className="text-[10px] text-muted-foreground line-clamp-2">{regime.description}</div>
            )}
          </div>
          <div className="rounded border border-border/40 px-3 py-2 space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">VIX</div>
            {snapshot.vix ? (
              <>
                <div className="text-sm font-medium font-mono">{snapshot.vix.last.toFixed(2)}</div>
                <div className={cn("text-[10px]", snapshot.vix.changePercent >= 0 ? "text-rose-400" : "text-emerald-400")}>
                  {snapshot.vix.changePercent >= 0 ? "+" : ""}{snapshot.vix.changePercent.toFixed(2)}%
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Unavailable</div>
            )}
          </div>
        </div>

        {/* Sector leadership */}
        {(snapshot.sectorLeadership ?? []).length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Sector Leadership</div>
            <div className="space-y-1">
              {(snapshot.sectorLeadership ?? []).slice(0, 5).map((s) => (
                <div key={s.symbol} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{s.name}</span>
                  <span className={cn("font-mono text-[11px]", s.changePercent >= 0 ? "text-emerald-400" : "text-rose-400")}>
                    {s.changePercent >= 0 ? "+" : ""}{s.changePercent.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* High-impact news */}
        {highImpactNews.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">High-Impact Events</div>
            <div className="space-y-2">
              {highImpactNews.map((n, idx) => (
                <div key={idx} className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
                    <span className="font-medium">{n.symbol}</span>
                    <Badge variant="outline" className={cn("text-[10px]", n.label === "bullish" ? "text-emerald-300 border-emerald-500/30" : n.label === "bearish" ? "text-rose-300 border-rose-500/30" : "border-border/40 text-muted-foreground")}>{n.label}</Badge>
                  </div>
                  <p className="text-muted-foreground">{n.whyItMatters}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 5 — Stock Research (educational planning only)
// ---------------------------------------------------------------------------

function StockResearchSection({ pkg }: { pkg: ResearchPackage }) {
  const { candidate, marketRegime } = pkg;

  const holdingHorizon =
    candidate.strategy?.toUpperCase().includes("INTRADAY") ||
    candidate.strategy?.toUpperCase().includes("ORB") ||
    candidate.strategy?.toUpperCase().includes("GAP")
      ? "Intraday (same-day close typical)"
      : candidate.strategy?.toUpperCase().includes("SWING") ||
        candidate.strategy?.toUpperCase().includes("VCP") ||
        candidate.strategy?.toUpperCase().includes("PULLBACK")
      ? "Swing (days to weeks)"
      : "Verify with your research process";

  const trend =
    marketRegime === "TRENDING"
      ? "Broad market in uptrend — historically more favorable for long setups"
      : marketRegime === "RISK_OFF"
      ? "Broad market in risk-off mode — historically less favorable for growth setups"
      : "Choppy market — discretion advised on timing";

  return (
    <Card className="border-border/40" data-testid="section-stock-research">
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
            <BarChart2 className="h-3.5 w-3.5 text-emerald-400" />
            Stock Research
          </CardTitle>
          <LastUpdated iso={pkg.completedAt} />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Educational planning only — not a trade recommendation
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Current Price</div>
            <div className="text-sm font-mono mt-0.5" data-testid="research-price">
              {candidate.currentPrice != null
                ? `$${candidate.currentPrice.toFixed(2)}`
                : "Verify with your broker"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Risk Zone / Invalidation</div>
            <div className="text-sm font-mono mt-0.5 text-rose-300">
              {candidate.invalidation ? `Below ${candidate.invalidation}` : "Not specified"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Entry / Breakout Zone</div>
            <div className="text-sm font-mono mt-0.5 text-emerald-300">
              {candidate.trigger ? `Near ${candidate.trigger}` : "Not specified"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Risk/Reward</div>
            <div className="text-sm font-mono mt-0.5">
              {candidate.rewardRisk != null ? `${candidate.rewardRisk.toFixed(1)}:1` : "Not calculated"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Trend Environment</div>
            <div className="text-xs mt-0.5 text-muted-foreground leading-relaxed">{trend}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Holding Horizon</div>
            <div className="text-xs mt-0.5 text-muted-foreground leading-relaxed">{holdingHorizon}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Capital Characteristics</div>
            <div className="text-xs mt-0.5 text-muted-foreground leading-relaxed">
              {candidate.maxRisk != null
                ? `Estimated max risk: $${candidate.maxRisk.toLocaleString()} per planned position${candidate.fitsRiskBudget ? " (fits risk budget)" : ""}`
                : "Verify position sizing with your risk management process"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Liquidity</div>
            <div className="text-xs mt-0.5 text-muted-foreground leading-relaxed">
              Verify bid-ask spreads and average daily volume with your broker before entry
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 6 — Options Research (static educational content)
// ---------------------------------------------------------------------------

function OptionsResearchSection() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Card className="border-border/40" data-testid="section-options-research">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-violet-400" />
          Options Research Structures
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">
          Educational overview only — not a recommendation to use any specific structure
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 space-y-1.5">
        {OPTIONS_STRUCTURES.map((s) => {
          const isOpen = expanded === s.name;
          return (
            <div
              key={s.name}
              className="rounded border border-border/40 overflow-hidden"
              data-testid={`options-structure-${s.name.replace(/\s+/g, "-").toLowerCase()}`}
            >
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-accent/30 transition-colors"
                onClick={() => setExpanded(isOpen ? null : s.name)}
                aria-expanded={isOpen}
              >
                <span className="text-xs font-medium">{s.name}</span>
                {isOpen ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/30 bg-card/30">
                  {[
                    ["Typical Market Outlook", s.outlook],
                    ["Capital Efficiency", s.capitalEfficiency],
                    ["Defined Risk", s.definedRisk],
                    ["Time Decay", s.timeDecay],
                    ["Liquidity", s.liquidity],
                    ["Suitable When", s.suitableWhen],
                  ].map(([label, value]) => (
                    <div key={label} className="space-y-0.5">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
                      <div className="text-xs text-foreground/80 leading-relaxed">{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 7 — Why This Qualified (checklist)
// ---------------------------------------------------------------------------

function WhyQualifiedSection({ pkg }: { pkg: ResearchPackage }) {
  const { candidate } = pkg;
  const items = candidate.whySelected;

  return (
    <Card className="border-border/40" data-testid="section-why-qualified">
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            Why This Qualified
          </CardTitle>
          <LastUpdated iso={pkg.completedAt} />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">Scanner criteria details not available for this candidate.</p>
        ) : (
          <ul className="space-y-2" data-testid="why-qualified-list">
            {items.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" aria-hidden="true" />
                <span className="text-xs leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 8 — Risk Factors
// ---------------------------------------------------------------------------

function RiskFactorsSection({
  pkg,
  highImpactNews,
}: {
  pkg: ResearchPackage;
  highImpactNews: MarketSnapshot["topNews"];
}) {
  const { candidate } = pkg;
  const hasRisks =
    candidate.warnings.length > 0 ||
    candidate.invalidation ||
    (highImpactNews ?? []).length > 0;

  return (
    <Card className="border-border/40" data-testid="section-risk-factors">
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-amber-400" />
            Risk Factors
          </CardTitle>
          <LastUpdated iso={pkg.completedAt} />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 space-y-2">
        {!hasRisks && (
          <p className="text-xs text-muted-foreground">No specific risk flags from the scanner for this candidate.</p>
        )}

        {/* Scanner warning flags */}
        {candidate.warnings.map((warn, idx) => (
          <div
            key={idx}
            className="flex items-start gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2"
            data-testid={`risk-warning-${idx}`}
          >
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
            <span className="text-xs">{warn}</span>
          </div>
        ))}

        {/* Invalidation condition */}
        {candidate.invalidation && (
          <div className="flex items-start gap-2 rounded border border-rose-500/20 bg-rose-500/5 px-3 py-2" data-testid="risk-invalidation">
            <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-0.5">
              <div className="font-medium">Invalidation Condition</div>
              <div className="text-muted-foreground">Setup is invalidated if price falls below {candidate.invalidation}</div>
            </div>
          </div>
        )}

        {/* High-impact news */}
        {(highImpactNews ?? []).slice(0, 2).map((n, idx) => (
          <div
            key={idx}
            className="flex items-start gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2"
          >
            <Newspaper className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-0.5">
              <div className="font-medium">Market Event — {n.symbol}</div>
              <div className="text-muted-foreground">{n.whyItMatters}</div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 9 — Action Center + Section 10 — InstaTrade™
// ---------------------------------------------------------------------------

function ActionCenterSection({
  pkg,
  symbol,
}: {
  pkg: ResearchPackage;
  symbol: string;
}) {
  const [, navigate] = useLocation();
  const [showInstatrade, setShowInstatrade] = useState(false);
  const { toast } = useToast();
  const [addingToWatchlist, setAddingToWatchlist] = useState(false);
  const rqClient = useRQClient();

  // Add to first available watchlist
  const handleAddToWatchlist = async () => {
    setAddingToWatchlist(true);
    try {
      const listsRes = await apiRequest("GET", "/api/watchlists");
      if (!listsRes.ok) throw new Error("Could not load watchlists");
      const lists: Array<{ id: string; name: string }> = await listsRes.json();
      const first = lists[0];
      if (!first) throw new Error("No watchlist found");

      const addRes = await apiRequest("POST", `/api/watchlists/${first.id}/symbols`, {
        symbol: symbol.toUpperCase(),
      });
      if (!addRes.ok) {
        const body = await addRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to add to watchlist");
      }

      await rqClient.invalidateQueries({ queryKey: ["/api/watchlists"] });
      track("research_package_add_to_watchlist" as any, { symbol });
      toast({ title: `${symbol} added to ${first.name}` });
    } catch (err: any) {
      toast({
        title: "Could not add to watchlist",
        description: String(err?.message ?? err),
        variant: "destructive",
      });
    } finally {
      setAddingToWatchlist(false);
    }
  };

  const actions = [
    {
      id: "save",
      label: "Save Research",
      icon: FileText,
      onClick: () => {
        track("research_package_save_research" as any, { symbol });
        navigate(askRoute(`Research ${symbol} and save the analysis`));
      },
    },
    {
      id: "compare",
      label: "Compare",
      icon: BarChart2,
      onClick: () => {
        track("research_package_compare" as any, { symbol });
        navigate(askRoute(`Compare ${symbol} to similar setups in the current scan`));
      },
    },
    {
      id: "congress",
      label: "Congress Activity",
      icon: Users,
      onClick: () => {
        track("research_package_congress" as any, { symbol });
        navigate(`/markets/congress-activity?symbol=${symbol}`);
      },
    },
    {
      id: "news",
      label: "News",
      icon: Newspaper,
      onClick: () => {
        track("research_package_news" as any, { symbol });
        navigate(askRoute(`Show me recent news and analyst commentary for ${symbol}`));
      },
    },
    {
      id: "education",
      label: "Education",
      icon: GraduationCap,
      onClick: () => {
        track("research_package_education" as any, { symbol });
        navigate(askRoute(`Explain the ${pkg.candidate.strategy ?? "VCP"} pattern and how to research it`));
      },
    },
    {
      id: "trade-planning",
      label: "Trade Planning",
      icon: Zap,
      onClick: () => {
        track("research_package_trade_planning" as any, { symbol });
        navigate(askRoute(`Help me think through a position sizing scenario for ${symbol}`));
      },
    },
  ];

  return (
    <Card className="border-border/40" data-testid="section-action-center">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-primary" />
          Action Center
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 space-y-4">
        {/* Button grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-9 text-xs gap-1.5 justify-start"
            onClick={handleAddToWatchlist}
            disabled={addingToWatchlist}
            data-testid="btn-add-to-watchlist"
          >
            <Star className="h-3.5 w-3.5 text-amber-400" />
            Add to Watchlist
          </Button>
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <Button
                key={a.id}
                size="sm"
                variant="outline"
                className="h-9 text-xs gap-1.5 justify-start"
                onClick={a.onClick}
                data-testid={`btn-action-${a.id}`}
              >
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                {a.label}
              </Button>
            );
          })}
        </div>

        {/* InstaTrade™ button — conditional on broker connection */}
        {pkg.brokerConnected ? (
          <div className="border-t border-border/30 pt-3">
            <Button
              size="sm"
              variant="default"
              className="gap-1.5"
              onClick={() => {
                track("research_package_instatrade_open" as any, { symbol });
                setShowInstatrade((v) => !v);
              }}
              data-testid="btn-review-instatrade"
            >
              <Zap className="h-3.5 w-3.5" />
              {showInstatrade ? "Hide" : "Review with InstaTrade™"}
            </Button>
            {showInstatrade && <InstaTradePanel pkg={pkg} symbol={symbol} />}
          </div>
        ) : (
          <div className="border-t border-border/30 pt-3">
            <div
              className="flex items-center gap-3 rounded border border-border/40 px-3 py-2.5 text-xs text-muted-foreground"
              data-testid="instatrade-connect-prompt"
            >
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span>
                Connect a brokerage to use InstaTrade™ order planning.{" "}
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => navigate("/settings")}
                >
                  Connect Brokerage
                </button>
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 10 — InstaTrade™ panel (read-only planning display)
// ---------------------------------------------------------------------------

function InstaTradePanel({ pkg, symbol }: { pkg: ResearchPackage; symbol: string }) {
  const [, navigate] = useLocation();
  const { candidate } = pkg;

  return (
    <div
      className="mt-3 rounded border border-primary/30 bg-primary/5 px-4 py-3 space-y-3"
      data-testid="instatrade-panel"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-primary uppercase tracking-wide">
          InstaTrade™ Planning
        </span>
        <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/40">
          Read-Only · Not an order
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <div className="text-[10px] text-muted-foreground">Symbol</div>
          <div className="font-mono font-medium">{symbol}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">Strategy</div>
          <div>{candidate.strategy ?? "—"}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">Entry Zone</div>
          <div className="font-mono text-emerald-300">{candidate.trigger ?? "—"}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">Stop / Invalidation</div>
          <div className="font-mono text-rose-300">{candidate.invalidation ?? "—"}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">Est. Max Risk</div>
          <div className="font-mono">
            {candidate.maxRisk != null ? `$${candidate.maxRisk.toLocaleString()}` : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">Regime Alignment</div>
          <div className={cn(pkg.marketRegime === "TRENDING" ? "text-emerald-300" : "text-amber-300")}>
            {pkg.marketRegime ? REGIME_LABEL[pkg.marketRegime] ?? pkg.marketRegime : "—"}
          </div>
        </div>
      </div>

      <div className="border-t border-border/30 pt-2 space-y-1.5">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          This planning display shows scanner-derived parameters only.
          No order has been created. Only the connected broker executes orders.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => {
            track("research_package_instatrade_navigate" as any, { symbol });
            navigate("/instatrade");
          }}
        >
          Open InstaTrade™ <ExternalLink className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scan History (inline within page)
// ---------------------------------------------------------------------------

function ScanHistorySection({ history, symbol }: { history: ScanHistoryEntry[]; symbol: string }) {
  if (history.length === 0) return null;

  return (
    <Card className="border-border/40" data-testid="section-scan-history">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-sky-400" />
          Scan History — {symbol}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0">
        <div className="space-y-1">
          {history.map((row, idx) => (
            <div key={row.id} className="flex items-center gap-3 text-[10px] py-1 border-b border-border/20 last:border-0">
              <span className="text-muted-foreground w-20 shrink-0 font-mono">
                {new Date(row.scanTime).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
              <span className="text-muted-foreground">#{row.rank ?? "—"}</span>
              <span
                className={cn(
                  "font-mono",
                  row.lifecycleState === "STRENGTHENING"
                    ? "text-emerald-400"
                    : row.lifecycleState === "WEAKENING"
                    ? "text-amber-400"
                    : row.lifecycleState === "NEWLY_QUALIFIED"
                    ? "text-violet-400"
                    : "text-muted-foreground",
                )}
              >
                {row.lifecycleState.replace(/_/g, " ").toLowerCase()}
              </span>
              {row.strategy && <span className="text-muted-foreground">{row.strategy}</span>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Symbol Not Found state
// ---------------------------------------------------------------------------

function SymbolNotFound({ symbol }: { symbol: string }) {
  const [, navigate] = useLocation();
  return (
    <div
      className="w-full max-w-5xl mx-auto px-4 md:px-8 py-12 flex flex-col items-center gap-4 text-center"
      data-testid="research-symbol-not-found"
    >
      <MinusCircle className="h-10 w-10 text-muted-foreground" />
      <h2 className="text-lg font-semibold">{symbol} — Not in Current Scan</h2>
      <p className="text-sm text-muted-foreground max-w-md">
        This symbol is not in the Opportunity Engine&rsquo;s current qualified list. The engine
        scans on a 4-hour cycle — the symbol may appear in a future scan.
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigate("/dashboard")}
        className="gap-1.5"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Dashboard
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function OpportunityResearchPage() {
  const { symbol: rawSymbol } = useParams<{ symbol: string }>();
  const symbol = (rawSymbol ?? "").toUpperCase();
  const [, navigate] = useLocation();

  const researchQuery = useQuery<ResearchPackage>({
    queryKey: ["/api/opportunities/research", symbol],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/opportunities/research/${symbol}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(body.error ?? "Failed to load research package") as any;
        err.status = res.status;
        err.code = body.code;
        throw err;
      }
      return res.json();
    },
    retry: (count, err: any) => {
      // Don't retry 404s — symbol genuinely not in scan
      if (err?.status === 404) return false;
      return count < 2;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchOnWindowFocus: false,
    enabled: /^[A-Z]{1,10}$/.test(symbol),
  });

  const dashboardQuery = useQuery<DashboardResponse>({
    queryKey: ["/api/dashboard"],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const snapshot: MarketSnapshot | undefined =
    dashboardQuery.data?.marketSnapshot.status === "ok"
      ? dashboardQuery.data.marketSnapshot.data
      : undefined;

  const highImpactNews = (snapshot?.topNews ?? []).filter((n) => n.impact === "high");

  // --- Symbol not found ---
  if (
    !researchQuery.isLoading &&
    (researchQuery.error as any)?.status === 404
  ) {
    return (
      <div className="flex-1 overflow-auto">
        <SymbolNotFound symbol={symbol} />
      </div>
    );
  }

  // --- Loading ---
  if (researchQuery.isLoading) {
    return (
      <div className="flex-1 overflow-auto">
        <PageSkeleton />
      </div>
    );
  }

  // --- Error (non-404) ---
  if (researchQuery.isError) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="w-full max-w-5xl mx-auto px-4 md:px-8 py-8" data-testid="research-error">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 mb-4"
            onClick={() => navigate("/dashboard")}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
          </Button>
          <SectionError label={`research package for ${symbol}`} onRetry={() => researchQuery.refetch()} />
        </div>
      </div>
    );
  }

  const pkg = researchQuery.data!;

  return (
    <div className="flex-1 overflow-auto" data-testid="opportunity-research-page">
      <div className="w-full max-w-5xl mx-auto px-4 md:px-8 py-5 md:py-6 space-y-4">
        {/* Back nav */}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 -ml-2 h-7 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => navigate("/dashboard")}
          data-testid="btn-back-to-dashboard"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Dashboard
        </Button>

        {/* S1 — Research Header */}
        <ResearchHeader pkg={pkg} />

        {/* S2 — Research Summary */}
        <ResearchSummary pkg={pkg} />

        {/* S3 + S7 side by side on wide screens */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TechnicalEvidence pkg={pkg} />
          <WhyQualifiedSection pkg={pkg} />
        </div>

        {/* S4 — Market Context */}
        <MarketContextSection
          snapshot={snapshot}
          isLoading={dashboardQuery.isLoading}
        />

        {/* S5 — Stock Research */}
        <StockResearchSection pkg={pkg} />

        {/* S6 — Options Research */}
        <OptionsResearchSection />

        {/* S8 — Risk Factors */}
        <RiskFactorsSection pkg={pkg} highImpactNews={highImpactNews} />

        {/* Scan History */}
        <ScanHistorySection history={pkg.scanHistory} symbol={pkg.symbol} />

        {/* S9 + S10 — Action Center + InstaTrade™ */}
        <ActionCenterSection pkg={pkg} symbol={symbol} />

        {/* S11 — Compliance Footer */}
        <p
          className="text-xs text-muted-foreground pt-4 border-t leading-relaxed"
          data-testid="text-research-disclaimer"
        >
          This Research Package presents scanner-derived market data and educational analysis for
          informational purposes only. Nothing on this page constitutes investment advice,
          a recommendation, or a solicitation to enter any financial position. All fields labeled
          "entry zone," "risk zone," or "stop" are educational planning references derived from
          algorithmic scanner output — they are not price targets or trade recommendations.
          Always verify information with your own broker and conduct independent due diligence
          before making any financial decision. Market data provided by Twelve Data (latest daily close).
        </p>
      </div>
    </div>
  );
}
