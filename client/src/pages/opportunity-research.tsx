// /opportunity/:symbol — Sprint 2.1.1 Evidence Engine
//
// Tabbed research dossier for a single Opportunity Engine candidate.
// Each tab is an independent evidence provider — one failing never breaks
// the page. All data is deterministic or clearly attributed.
//
// Compliance rules applied throughout:
//   - Never uses "buy", "sell", "recommendation", "expected profit", "target return"
//   - All price/level fields are labeled as "educational planning" only
//   - InstaTrade™ section is read-only planning display; never an execution button
//   - AI Summary tab is deterministic derivation — no LLM call

import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient as useRQClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  MinusCircle,
  XCircle,
  TrendingUp,
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
  Landmark,
  Building2,
  Calendar,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { CongressFlowEmbed } from "@/components/congressflow-embed";

// ---------------------------------------------------------------------------
// Types — imported from shared module; re-exported for backward-compat tests
// ---------------------------------------------------------------------------

import {
  LIFECYCLE_BADGE,
  REGIME_LABEL,
  type LifecycleState,
  type LifecycleItem,
  type ScanHistoryEntry,
  type Candidate,
  type ResearchPackage,
  type MarketSnapshot,
  type DashboardResponse,
  type EvidenceStars,
} from "@/components/research/types";

export type { EvidenceStars } from "@/components/research/types";

import { ResearchTradeCard } from "@/components/research";
import { ResearchDecisionCard, ResearchDecisionEngine } from "@/components/research/decision";
import { TradeStructureEngine } from "@/components/research/structure";

// ---------------------------------------------------------------------------
// Sentiment types (for News Evidence tab)
// ---------------------------------------------------------------------------

interface SentimentArticle {
  id: string;
  headline: string;
  source: string | null;
  url: string | null;
  publishedAt: string | null;
  summary: string | null;
  whyItMatters: string | null;
  sentimentLabel: string | null;
  sentimentScore: number | null;
  impactLevel: string | null;
  bullishDrivers: string[];
  bearishDrivers: string[];
  riskWarnings: string[];
}

interface SentimentSnapshotAgg {
  overallSentiment?: string;
  sentimentScore?: number;
  articleCount?: number;
}

export interface SentimentResponse {
  symbol: string;
  snapshot: SentimentSnapshotAgg | null;
  articles: SentimentArticle[];
  stale: boolean;
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// Constants (LIFECYCLE_BADGE + REGIME_LABEL imported from @/components/research/types)
// ---------------------------------------------------------------------------

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
// Evidence star scoring (pure, deterministic)
// ---------------------------------------------------------------------------

export function computeEvidenceStars(
  pkg: ResearchPackage,
  newsData: SentimentResponse | null,
  snapshot: MarketSnapshot | undefined,
): EvidenceStars {
  const { candidate, marketRegime } = pkg;

  // Technical: confidence + whySelected count
  const conf = (candidate.confidence ?? "").toLowerCase();
  const whyCount = candidate.whySelected.length;
  let technical: EvidenceStars["technical"] = 1;
  if (conf === "high" && whyCount >= 3) technical = 5;
  else if (conf === "high" && whyCount >= 1) technical = 4;
  else if (conf === "medium") technical = 3;
  else if (conf === "low") technical = 2;

  // Congress: always 3 — embed is available, no quantitative API
  const congress: EvidenceStars["congress"] = 3;

  // News: article count
  const articleCount = newsData?.articles.length ?? 0;
  let news: EvidenceStars["news"] = 1;
  if (articleCount >= 5) news = 5;
  else if (articleCount >= 3) news = 4;
  else if (articleCount >= 1) news = 3;

  // Institutional: always unavailable (no data source)
  const institutional: EvidenceStars["institutional"] = 0;

  // Catalysts: warning count + high-impact market news
  const warningCount = candidate.warnings.length;
  const hasHighImpact = (snapshot?.topNews ?? []).some((n) => n.impact === "high");
  let catalysts: EvidenceStars["catalysts"] = 1;
  if (warningCount >= 2 || hasHighImpact) catalysts = 3;
  else if (warningCount >= 1) catalysts = 2;

  // Market Regime
  let regime: EvidenceStars["regime"] = 1;
  if (marketRegime === "TRENDING") regime = 5;
  else if (marketRegime === "CHOPPY") regime = 3;
  else if (marketRegime === "RISK_OFF") regime = 2;

  return { technical, congress, news, institutional, catalysts, regime };
}

// ---------------------------------------------------------------------------
// Deterministic AI Summary bullets
// ---------------------------------------------------------------------------

export function buildAiSummaryBullets(
  pkg: ResearchPackage,
  snapshot: MarketSnapshot | undefined,
  newsData: SentimentResponse | null,
): string[] {
  const { candidate, lifecycleItem, marketRegime } = pkg;
  const bullets: string[] = [];

  // 1. Technical posture
  const conf = candidate.confidence ? `${candidate.confidence} confidence` : "unrated confidence";
  const whyItem = candidate.whySelected[0] ?? "pattern identified by scanner criteria";
  bullets.push(
    `Technical: ${candidate.strategy ?? "Setup"} with ${conf}. Primary scanner criterion: ${whyItem}`,
  );

  // 2. Market regime
  const regimeLabel = marketRegime
    ? (REGIME_LABEL[marketRegime] ?? marketRegime)
    : "Unavailable";
  const regimeDesc =
    snapshot?.marketRegime?.description ??
    (marketRegime === "TRENDING"
      ? "broad market showing upward trend"
      : marketRegime === "RISK_OFF"
      ? "broad market in defensive posture"
      : marketRegime === "CHOPPY"
      ? "broad market in consolidation"
      : "regime data not available");
  bullets.push(`Market Regime: ${regimeLabel} — ${regimeDesc}`);

  // 3. News / sentiment
  if (newsData && newsData.articles.length > 0) {
    const count = newsData.articles.length;
    const aggLabel = newsData.snapshot?.overallSentiment
      ? ` — aggregate sentiment labeled "${newsData.snapshot.overallSentiment}"`
      : "";
    bullets.push(
      `News: ${count} article${count !== 1 ? "s" : ""} indexed for ${pkg.symbol}${aggLabel}. Open the News tab for full headlines and sentiment detail.`,
    );
  } else {
    bullets.push(
      `News: Open the News tab to fetch article coverage for ${pkg.symbol}. Data loads on first tab visit.`,
    );
  }

  // 4. Primary risk
  const primaryWarn = candidate.warnings[0];
  const invalidation = candidate.invalidation;
  if (primaryWarn) {
    bullets.push(
      `Primary Risk Flag: ${primaryWarn}${
        invalidation ? ` — setup invalidated below ${invalidation}` : ""
      }`,
    );
  } else if (invalidation) {
    bullets.push(
      `Invalidation Level: Setup is considered invalid if price falls below ${invalidation}. No other scanner warnings for this candidate.`,
    );
  } else {
    bullets.push(
      `Risk: No specific scanner warning flags for this candidate. Apply your own risk management process before any financial decision.`,
    );
  }

  // 5. Lifecycle change
  if (lifecycleItem) {
    const stateLabel = lifecycleItem.lifecycleState.replace(/_/g, " ").toLowerCase();
    const rankInfo =
      lifecycleItem.rankCurrent != null ? ` Current rank: #${lifecycleItem.rankCurrent}.` : "";
    const delta = lifecycleItem.scoreDelta;
    const deltaStr = `Score delta vs. prior scan: ${delta >= 0 ? "+" : ""}${delta.toFixed(0)}.`;
    bullets.push(
      `Lifecycle: ${pkg.symbol} is "${stateLabel}" since the prior scan.${rankInfo} ${deltaStr}`,
    );
  } else {
    bullets.push(
      `Lifecycle: ${pkg.symbol} appears for the first time in this scan — no prior comparison is available.`,
    );
  }

  return bullets;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div className="w-full max-w-5xl mx-auto px-4 md:px-8 py-6 space-y-4" data-testid="research-skeleton">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-10 w-full" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
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
        <span className="text-sm text-muted-foreground">Could not load {label}.</span>
        <Button size="sm" variant="ghost" onClick={onRetry} className="ml-auto h-7 gap-1 text-xs">
          <RefreshCcw className="h-3 w-3" /> Retry
        </Button>
      </CardContent>
    </Card>
  );
}

function LastUpdated({ iso }: { iso: string }) {
  return (
    <span className="text-[10px] text-muted-foreground">Updated {formatRelativeTime(iso)}</span>
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

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xs leading-relaxed">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence Scorecard — visual star ratings (Overview tab)
// ---------------------------------------------------------------------------

function StarRating({ stars, max = 5 }: { stars: number; max?: number }) {
  if (stars === 0) {
    return <span className="text-[11px] text-muted-foreground italic">Unavailable</span>;
  }
  return (
    <span className="flex gap-0.5" aria-label={`${stars} out of ${max} stars`}>
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "h-3 w-3",
            i < stars ? "text-amber-400 fill-amber-400" : "text-muted-foreground/40",
          )}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

interface ScorecardRow {
  id: string;
  label: string;
  stars: number;
  note: string;
}

function EvidenceScorecardSection({
  stars,
  completedAt,
}: {
  stars: EvidenceStars;
  completedAt: string;
}) {
  const rows: ScorecardRow[] = [
    { id: "technical",      label: "Technical",      stars: stars.technical,      note: "Scanner-derived pattern, confidence, and criteria" },
    { id: "congress",       label: "Congress",        stars: stars.congress,       note: "Available via CongressFlow — publicly disclosed transactions" },
    { id: "news",           label: "News & Sentiment", stars: stars.news,          note: "Article coverage and sentiment from news index" },
    { id: "institutional",  label: "Institutional",   stars: stars.institutional,  note: "Institutional ownership data not available in this version" },
    { id: "catalysts",      label: "Catalysts & Risk", stars: stars.catalysts,    note: "Scanner warnings and high-impact market events" },
    { id: "market-regime",  label: "Market Regime",   stars: stars.regime,         note: "Broad market regime classification" },
  ];

  return (
    <Card className="border-border/40" data-testid="section-evidence-scorecard">
      <CardHeader className="px-4 py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
            <Star className="h-3.5 w-3.5 text-amber-400" />
            Evidence Scorecard
          </CardTitle>
          <LastUpdated iso={completedAt} />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Visual summary only — no AI weighting, no trade recommendation
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <div className="space-y-2.5">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-3 py-1.5 border-b border-border/20 last:border-0"
              data-testid={`scorecard-row-${row.id}`}
            >
              <span className="text-xs font-medium w-32 shrink-0">{row.label}</span>
              <StarRating stars={row.stars} />
              <span className="text-[10px] text-muted-foreground ml-auto hidden sm:block truncate">
                {row.note}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 1 — Research Header (unchanged)
// ---------------------------------------------------------------------------

function ResearchHeader({ pkg }: { pkg: ResearchPackage }) {
  const { candidate, lifecycleItem, freshnessStatus, completedAt, marketRegime, dataSource } = pkg;

  const qualStatus =
    lifecycleItem?.qualificationStatus === "QUALIFIED"
      ? "Opportunity Qualified"
      : lifecycleItem?.qualificationStatus === "WATCHING"
      ? "Watching"
      : "Opportunity Qualified";

  return (
    <Card className="border-border/40" data-testid="section-research-header">
      <CardContent className="px-4 py-4 space-y-3">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold text-3xl tracking-tight" data-testid="research-symbol">
                {pkg.symbol}
              </span>
              {candidate.strategy && (
                <Badge variant="outline" className="text-[10px] border-border/50">
                  {candidate.strategy}
                </Badge>
              )}
              {lifecycleItem && <LifecycleBadge state={lifecycleItem.lifecycleState} />}
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
            <div className="text-2xl font-mono font-semibold">#{candidate.rank}</div>
            {lifecycleItem?.rankPrev && lifecycleItem.rankPrev !== candidate.rank && (
              <div className="text-[10px] text-muted-foreground">
                was #{lifecycleItem.rankPrev}
                {lifecycleItem.rankPrev - candidate.rank > 0 ? (
                  <span className="text-emerald-400 ml-1">▲{lifecycleItem.rankPrev - candidate.rank}</span>
                ) : (
                  <span className="text-rose-400 ml-1">▼{candidate.rank - lifecycleItem.rankPrev}</span>
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
              Regime:{" "}
              <span className="text-foreground/80 ml-0.5">{REGIME_LABEL[marketRegime] ?? marketRegime}</span>
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
              Confidence:{" "}
              <span className="text-foreground/80 ml-0.5 capitalize">{candidate.confidence}</span>
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
// Section 2 — Research Summary (unchanged)
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
    candidate.setupStatus ?? candidate.strategy ?? "See Technical Evidence tab";

  const currentRegime = marketRegime
    ? `${REGIME_LABEL[marketRegime] ?? marketRegime} — ${
        marketRegime === "TRENDING"
          ? "broad market showing upward trend"
          : marketRegime === "RISK_OFF"
          ? "broad market in defensive posture"
          : "broad market in consolidation"
      }`
    : "Regime data unavailable";

  const primaryOpportunity = candidate.trigger
    ? `Entry zone near ${candidate.trigger}${
        candidate.invalidation ? `; below ${candidate.invalidation} invalidates the setup` : ""
      }`
    : candidate.objective
    ? candidate.objective
    : "Review Technical Evidence tab for level details";

  const primaryRisks =
    candidate.warnings.length > 0
      ? candidate.warnings[0]
      : candidate.invalidation
      ? `Setup invalidated below ${candidate.invalidation}`
      : "Review Catalysts tab";

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
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — Technical Evidence (unchanged)
// ---------------------------------------------------------------------------

function buildEvidenceItems(candidate: Candidate): Array<{
  label: string;
  value: string;
  status: EvidenceStatus;
}> {
  const items: Array<{ label: string; value: string; status: EvidenceStatus }> = [];

  items.push({
    label: "Strategy Identified",
    value: candidate.strategy ?? "Not specified",
    status: candidate.strategy ? "pass" : "neutral",
  });

  const conf = (candidate.confidence ?? "").toLowerCase();
  items.push({
    label: "Confidence Level",
    value: conf ? conf.charAt(0).toUpperCase() + conf.slice(1) : "Not specified",
    status: conf === "high" ? "pass" : conf === "medium" ? "warning" : conf === "low" ? "warning" : "neutral",
  });

  items.push({
    label: "Entry Level",
    value: candidate.trigger ? `Near ${candidate.trigger}` : "Not specified",
    status: candidate.trigger ? "pass" : "neutral",
  });

  items.push({
    label: "Stop / Invalidation",
    value: candidate.invalidation ? `Below ${candidate.invalidation}` : "Not specified",
    status: candidate.invalidation ? "pass" : "warning",
  });

  const rr = candidate.rewardRisk;
  items.push({
    label: "Risk/Reward Ratio",
    value: rr != null ? `${rr.toFixed(1)}:1` : "Not calculated",
    status: rr != null ? (rr >= 2 ? "pass" : "warning") : "neutral",
  });

  items.push({
    label: "Max Risk Estimate",
    value:
      candidate.maxRisk != null
        ? `$${candidate.maxRisk.toLocaleString()} per planned position`
        : "Not calculated",
    status: candidate.maxRisk != null ? "pass" : "neutral",
  });

  if (candidate.setupStatus) {
    items.push({ label: "Setup Stage", value: candidate.setupStatus, status: "pass" });
  }

  for (const why of candidate.whySelected) {
    items.push({ label: "Scanner Criteria", value: why, status: "pass" });
  }

  for (const warn of candidate.warnings) {
    items.push({ label: "Warning Flag", value: warn, status: "warning" });
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
// Section 4 — Market Context (unchanged)
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
                <div
                  className={cn(
                    "text-[10px]",
                    snapshot.vix.changePercent >= 0 ? "text-rose-400" : "text-emerald-400",
                  )}
                >
                  {snapshot.vix.changePercent >= 0 ? "+" : ""}
                  {snapshot.vix.changePercent.toFixed(2)}%
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Unavailable</div>
            )}
          </div>
        </div>

        {(snapshot.sectorLeadership ?? []).length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Sector Leadership
            </div>
            <div className="space-y-1">
              {(snapshot.sectorLeadership ?? []).slice(0, 5).map((s) => (
                <div key={s.symbol} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{s.name}</span>
                  <span
                    className={cn(
                      "font-mono text-[11px]",
                      s.changePercent >= 0 ? "text-emerald-400" : "text-rose-400",
                    )}
                  >
                    {s.changePercent >= 0 ? "+" : ""}
                    {s.changePercent.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {highImpactNews.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              High-Impact Events
            </div>
            <div className="space-y-2">
              {highImpactNews.map((n, idx) => (
                <div
                  key={idx}
                  className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs space-y-0.5"
                >
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
                    <span className="font-medium">{n.symbol}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        n.label === "bullish"
                          ? "text-emerald-300 border-emerald-500/30"
                          : n.label === "bearish"
                          ? "text-rose-300 border-rose-500/30"
                          : "border-border/40 text-muted-foreground",
                      )}
                    >
                      {n.label}
                    </Badge>
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
// Section 5 — Stock Research (unchanged)
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
                ? `Estimated max risk: $${candidate.maxRisk.toLocaleString()} per planned position${
                    candidate.fitsRiskBudget ? " (fits risk budget)" : ""
                  }`
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
// Section 6 — Options Research (static educational content, unchanged)
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
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {label}
                      </div>
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
// Section 7 — Why This Qualified (checklist, unchanged)
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
          <p className="text-xs text-muted-foreground">
            Scanner criteria details not available for this candidate.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="why-qualified-list">
            {items.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2.5">
                <CheckCircle2
                  className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0"
                  aria-hidden="true"
                />
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
// Section 8 — Risk Factors (unchanged)
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
    candidate.warnings.length > 0 || candidate.invalidation || (highImpactNews ?? []).length > 0;

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
          <p className="text-xs text-muted-foreground">
            No specific risk flags from the scanner for this candidate.
          </p>
        )}

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

        {candidate.invalidation && (
          <div
            className="flex items-start gap-2 rounded border border-rose-500/20 bg-rose-500/5 px-3 py-2"
            data-testid="risk-invalidation"
          >
            <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-0.5">
              <div className="font-medium">Invalidation Condition</div>
              <div className="text-muted-foreground">
                Setup is invalidated if price falls below {candidate.invalidation}
              </div>
            </div>
          </div>
        )}

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
// Section 9 — Action Center + Section 10 — InstaTrade™ (unchanged)
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
            {pkg.marketRegime ? (REGIME_LABEL[pkg.marketRegime] ?? pkg.marketRegime) : "—"}
          </div>
        </div>
      </div>

      <div className="border-t border-border/30 pt-2 space-y-1.5">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          This planning display shows scanner-derived parameters only. No order has been created.
          Only the connected broker executes orders.
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
// Scan History (unchanged)
// ---------------------------------------------------------------------------

function ScanHistorySection({
  history,
  symbol,
}: {
  history: ScanHistoryEntry[];
  symbol: string;
}) {
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
          {history.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-3 text-[10px] py-1 border-b border-border/20 last:border-0"
            >
              <span className="text-muted-foreground w-20 shrink-0 font-mono">
                {new Date(row.scanTime).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
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
// Evidence Provider Tabs
// ---------------------------------------------------------------------------

// --- Congress Tab ---

function CongressTab({ symbol }: { symbol: string }) {
  return (
    <div className="space-y-3" data-testid="tab-congress">
      {/* Disclaimer card */}
      <Card className="border-border/40">
        <CardContent className="px-4 py-3 flex items-start gap-2.5">
          <Landmark className="h-3.5 w-3.5 text-sky-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-medium">Publicly disclosed congressional transactions</p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Congressional financial disclosures may be delayed, amended, incomplete, or reported as
              value ranges. This information is provided for research purposes only and is not a
              trading signal, investment recommendation, or indication of any public official&rsquo;s
              views on this company. Past disclosure activity does not predict future price movement.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Embed */}
      <CongressFlowEmbed
        view="ticker"
        ticker={symbol}
        minHeight={500}
      />
    </div>
  );
}

// --- News Evidence Tab ---

function NewsEvidenceTab({ symbol }: { symbol: string }) {
  const [, navigate] = useLocation();

  const newsQuery = useQuery<SentimentResponse>({
    queryKey: ["/api/sentiment", symbol],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/sentiment/${symbol}`);
      if (!res.ok) throw new Error("Failed to load news data");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  if (newsQuery.isLoading) {
    return (
      <div className="space-y-3" data-testid="tab-news-loading">
        <Card className="border-border/40">
          <CardHeader className="px-4 py-3">
            <Skeleton className="h-4 w-40" />
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (newsQuery.isError) {
    return (
      <div data-testid="tab-news-error">
        <SectionError
          label="news and sentiment data"
          onRetry={() => newsQuery.refetch()}
        />
      </div>
    );
  }

  const data = newsQuery.data!;
  const articles = data.articles ?? [];

  return (
    <div className="space-y-3" data-testid="tab-news">
      {/* Aggregate snapshot */}
      {data.snapshot && (
        <Card className="border-border/40">
          <CardHeader className="px-4 py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
                <Newspaper className="h-3.5 w-3.5 text-sky-400" />
                News &amp; Sentiment — {symbol}
              </CardTitle>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px]",
                  data.stale ? "text-amber-300 border-amber-500/30" : "text-emerald-300 border-emerald-500/30",
                )}
              >
                {data.stale ? "Stale" : "Live"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <div className="flex flex-wrap gap-4">
              {data.snapshot.overallSentiment && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Aggregate Sentiment</div>
                  <div className="text-sm font-medium mt-0.5 capitalize">{data.snapshot.overallSentiment}</div>
                </div>
              )}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Articles Indexed</div>
                <div className="text-sm font-mono mt-0.5">{data.snapshot.articleCount ?? articles.length}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No articles state */}
      {articles.length === 0 && (
        <Card className="border-border/40" data-testid="tab-news-empty">
          <CardContent className="px-4 py-6 flex flex-col items-center gap-3 text-center">
            <Newspaper className="h-6 w-6 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">No news articles indexed for {symbol}.</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Articles are collected from public news sources. Coverage varies by symbol.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={() => navigate("/news")}
            >
              <ExternalLink className="h-3 w-3" /> View Market Intel
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Article list */}
      {articles.length > 0 && (
        <div className="space-y-2">
          {articles.map((article) => {
            const sentimentColor =
              article.sentimentLabel === "bullish"
                ? "text-emerald-300 border-emerald-500/30"
                : article.sentimentLabel === "bearish"
                ? "text-rose-300 border-rose-500/30"
                : "text-muted-foreground border-border/40";

            return (
              <Card
                key={article.id}
                className="border-border/40"
                data-testid={`news-article-${article.id}`}
              >
                <CardContent className="px-4 py-3 space-y-2">
                  {/* Headline row */}
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium leading-relaxed flex-1">
                      {article.url ? (
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-primary transition-colors"
                        >
                          {article.headline}
                        </a>
                      ) : (
                        article.headline
                      )}
                    </p>
                    {article.sentimentLabel && (
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] shrink-0", sentimentColor)}
                        data-testid={`article-sentiment-${article.id}`}
                      >
                        {article.sentimentLabel}
                      </Badge>
                    )}
                  </div>

                  {/* Meta row */}
                  <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                    {article.source && <span>{article.source}</span>}
                    {article.publishedAt && (
                      <span>{formatRelativeTime(article.publishedAt)}</span>
                    )}
                    {article.impactLevel && (
                      <Badge variant="outline" className="text-[10px] border-border/40">
                        {article.impactLevel} impact
                      </Badge>
                    )}
                  </div>

                  {/* Why it matters */}
                  {article.whyItMatters && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed border-l-2 border-border/40 pl-2">
                      {article.whyItMatters}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/news")}
          >
            <ExternalLink className="h-3 w-3" /> View full Market Intel feed
          </Button>
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-[10px] text-muted-foreground leading-relaxed px-1">
        {data.disclaimer}
      </p>
    </div>
  );
}

// --- Institutional Evidence Tab ---

function InstitutionalTab() {
  return (
    <Card className="border-border/40" data-testid="tab-institutional">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          Institutional Context
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-6 pt-0 space-y-4">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Building2 className="h-8 w-8 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Institutional ownership data is not available in this version.
            </p>
            <p className="text-[11px] text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
              When connected, this section would display institutional ownership percentage, recent
              accumulation trends, major holder changes, ETF inclusion, and sector participation data
              from public 13-F filings and fund flows.
            </p>
          </div>
        </div>

        <div className="rounded border border-border/40 bg-muted/20 px-4 py-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
            What institutional context covers
          </p>
          {[
            "Reported institutional ownership percentage (SEC 13-F filings)",
            "Recent quarter-over-quarter accumulation or distribution",
            "ETF index inclusion and fund-level exposure",
            "Sector fund participation and rotation signals",
            "Major holder concentration risk",
          ].map((item) => (
            <div key={item} className="flex items-start gap-2">
              <MinusCircle className="h-3 w-3 text-muted-foreground/50 shrink-0 mt-0.5" />
              <span className="text-[11px] text-muted-foreground">{item}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Catalysts Evidence Tab ---

function CatalystsTab({
  pkg,
  snapshot,
}: {
  pkg: ResearchPackage;
  snapshot: MarketSnapshot | undefined;
}) {
  const { candidate, scanHistory } = pkg;

  const earningsWarnings = candidate.warnings.filter(
    (w) => w.toLowerCase().includes("earnings") || w.toLowerCase().includes("catalyst"),
  );
  const otherWarnings = candidate.warnings.filter(
    (w) => !w.toLowerCase().includes("earnings") && !w.toLowerCase().includes("catalyst"),
  );
  const highImpactNews = (snapshot?.topNews ?? []).filter((n) => n.impact === "high").slice(0, 3);
  const recentScans = scanHistory.slice(0, 5);

  const hasContent =
    earningsWarnings.length > 0 ||
    otherWarnings.length > 0 ||
    highImpactNews.length > 0 ||
    recentScans.length > 0;

  return (
    <div className="space-y-3" data-testid="tab-catalysts">
      {/* Earnings & catalyst warnings from scanner */}
      {earningsWarnings.length > 0 && (
        <Card className="border-border/40">
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-amber-400" />
              Earnings &amp; Catalyst Flags
            </CardTitle>
            <p className="text-[10px] text-muted-foreground">
              Scanner-identified earnings risk for this candidate
            </p>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 space-y-2">
            {earningsWarnings.map((warn, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2"
                data-testid={`catalyst-earnings-${idx}`}
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span className="text-xs">{warn}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Other scanner warnings */}
      {otherWarnings.length > 0 && (
        <Card className="border-border/40">
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-amber-400" />
              Scanner Risk Flags
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 space-y-2">
            {otherWarnings.map((warn, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2"
                data-testid={`catalyst-warning-${idx}`}
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span className="text-xs">{warn}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* High-impact market events */}
      {highImpactNews.length > 0 && (
        <Card className="border-border/40">
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-rose-400" />
              High-Impact Market Events
            </CardTitle>
            <p className="text-[10px] text-muted-foreground">
              From current market snapshot — may affect broader environment
            </p>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 space-y-2">
            {highImpactNews.map((n, idx) => (
              <div
                key={idx}
                className="rounded border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs space-y-1"
                data-testid={`catalyst-market-event-${idx}`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{n.symbol}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      n.label === "bullish"
                        ? "text-emerald-300 border-emerald-500/30"
                        : n.label === "bearish"
                        ? "text-rose-300 border-rose-500/30"
                        : "border-border/40 text-muted-foreground",
                    )}
                  >
                    {n.label}
                  </Badge>
                </div>
                <p className="text-muted-foreground">{n.whyItMatters}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Scan history as catalyst timeline */}
      {recentScans.length > 0 && (
        <Card className="border-border/40">
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-sky-400" />
              Recent Scan Activity — {pkg.symbol}
            </CardTitle>
            <p className="text-[10px] text-muted-foreground">
              Shows when this candidate last changed qualification status
            </p>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <div className="space-y-1">
              {recentScans.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-3 text-[10px] py-1.5 border-b border-border/20 last:border-0"
                >
                  <span className="text-muted-foreground w-20 shrink-0 font-mono">
                    {new Date(row.scanTime).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
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
      )}

      {!hasContent && (
        <Card className="border-border/40">
          <CardContent className="px-4 py-6 flex flex-col items-center gap-2 text-center">
            <Calendar className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No catalyst flags or high-impact events identified for this candidate.
            </p>
            <p className="text-[10px] text-muted-foreground">
              Scanner did not flag any earnings, catalyst, or high-impact market conditions.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// --- AI Research Summary Tab (deterministic, no LLM) ---

function AiSummaryTab({
  pkg,
  snapshot,
  newsData,
}: {
  pkg: ResearchPackage;
  snapshot: MarketSnapshot | undefined;
  newsData: SentimentResponse | null;
}) {
  const bullets = buildAiSummaryBullets(pkg, snapshot, newsData);

  return (
    <div className="space-y-3" data-testid="tab-ai-summary">
      <Card className="border-border/40">
        <CardHeader className="px-4 py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-violet-400" />
              Research Summary — {pkg.symbol}
            </CardTitle>
            <LastUpdated iso={pkg.completedAt} />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Derived from scanner output and available evidence — not AI-generated advice
          </p>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <ul className="space-y-3" data-testid="ai-summary-bullets">
            {bullets.map((bullet, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2.5"
                data-testid={`ai-summary-bullet-${idx}`}
              >
                <span className="text-[10px] font-mono text-muted-foreground mt-0.5 shrink-0 w-4">
                  {idx + 1}.
                </span>
                <span className="text-xs leading-relaxed">{bullet}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="border-violet-500/20 bg-violet-500/5">
        <CardContent className="px-4 py-3 flex items-start gap-2.5">
          <Info className="h-3.5 w-3.5 text-violet-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            This summary is generated deterministically from scanner output, market regime data, and
            indexed news coverage. It references only observed evidence — no financial forecast,
            price target, or trade recommendation is implied. Open the News tab to load article
            coverage, which updates the news bullet above.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Symbol Not Found state (unchanged)
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

const TABS = [
  { value: "overview",       label: "Overview" },
  { value: "decision",       label: "Decision" },
  { value: "trade-planning", label: "Trade Planning" },
  { value: "technical",      label: "Technical" },
  { value: "congress",      label: "Congress" },
  { value: "news",          label: "News" },
  { value: "institutional", label: "Institutional" },
  { value: "catalysts",     label: "Catalysts" },
  { value: "ai-summary",    label: "AI Summary" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

export default function OpportunityResearchPage() {
  const { symbol: rawSymbol } = useParams<{ symbol: string }>();
  const symbol = (rawSymbol ?? "").toUpperCase();
  const [, navigate] = useLocation();

  // Tab state + lazy-load tracking
  const [activeTab, setActiveTab] = useState<TabValue>("overview");
  const [visitedTabs, setVisitedTabs] = useState<Set<TabValue>>(new Set<TabValue>(["overview"]));

  const handleTabChange = (value: string) => {
    const tab = value as TabValue;
    setActiveTab(tab);
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
    track("research_package_tab_changed" as any, { symbol, tab: value });
  };

  // Primary research package query
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
      if (err?.status === 404) return false;
      return count < 2;
    },
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: /^[A-Z]{1,10}$/.test(symbol),
  });

  // Dashboard query for market context
  const dashboardQuery = useQuery<DashboardResponse>({
    queryKey: ["/api/dashboard"],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // News query — lazy: only fetches after News tab is visited
  const newsQuery = useQuery<SentimentResponse>({
    queryKey: ["/api/sentiment", symbol],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/sentiment/${symbol}`);
      if (!res.ok) throw new Error("Failed to load news data");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
    enabled: visitedTabs.has("news") && /^[A-Z]{1,10}$/.test(symbol),
  });

  const snapshot: MarketSnapshot | undefined =
    dashboardQuery.data?.marketSnapshot.status === "ok"
      ? dashboardQuery.data.marketSnapshot.data
      : undefined;

  const highImpactNews = (snapshot?.topNews ?? []).filter((n) => n.impact === "high");

  // --- Symbol not found ---
  if (!researchQuery.isLoading && (researchQuery.error as any)?.status === 404) {
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
          <SectionError
            label={`research package for ${symbol}`}
            onRetry={() => researchQuery.refetch()}
          />
        </div>
      </div>
    );
  }

  const pkg = researchQuery.data!;
  const newsData = newsQuery.data ?? null;
  const stars = computeEvidenceStars(pkg, newsData, snapshot);

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

        {/* Research Header — always visible above tabs */}
        <ResearchHeader pkg={pkg} />

        {/* Evidence Engine — tabbed layout */}
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          data-testid="evidence-engine-tabs"
        >
          {/* Tab bar — scrollable on mobile */}
          <div className="overflow-x-auto pb-1">
            <TabsList className="inline-flex w-max min-w-full sm:w-full h-9 text-xs">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="text-xs px-3 py-1.5"
                  data-testid={`tab-trigger-${t.value}`}
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* ─── Overview ─── */}
          <TabsContent value="overview" data-testid="tab-content-overview">
            <div className="space-y-4 mt-3">
              {/* Thesis summary — answers "should I research this?" immediately */}
              <ResearchDecisionCard pkg={pkg} stars={stars} />
              {/* Professional institutional research workspace */}
              <ResearchTradeCard
                pkg={pkg}
                stars={stars}
                snapshot={snapshot}
                onNavigateTab={handleTabChange}
              />
              {/* Market context + scan history remain below the trade card */}
              <MarketContextSection
                snapshot={snapshot}
                isLoading={dashboardQuery.isLoading}
              />
              <ScanHistorySection history={pkg.scanHistory} symbol={pkg.symbol} />
            </div>
          </TabsContent>

          {/* ─── Decision ─── */}
          <TabsContent value="decision" data-testid="tab-content-decision">
            <div className="mt-3">
              <ResearchDecisionEngine
                pkg={pkg}
                stars={stars}
                snapshot={snapshot}
                onNavigateTab={handleTabChange}
              />
            </div>
          </TabsContent>

          {/* ─── Trade Planning ─── */}
          <TabsContent value="trade-planning" data-testid="tab-content-trade-planning">
            <div className="mt-3">
              <TradeStructureEngine
                pkg={pkg}
                stars={stars}
                snapshot={snapshot}
                onNavigateTab={handleTabChange}
              />
            </div>
          </TabsContent>

          {/* ─── Technical ─── */}
          <TabsContent value="technical" data-testid="tab-content-technical">
            <div className="space-y-4 mt-3">
              <TechnicalEvidence pkg={pkg} />
              <WhyQualifiedSection pkg={pkg} />
              <RiskFactorsSection pkg={pkg} highImpactNews={highImpactNews} />
              <OptionsResearchSection />
            </div>
          </TabsContent>

          {/* ─── Congress ─── */}
          <TabsContent value="congress" data-testid="tab-content-congress">
            <div className="mt-3">
              {visitedTabs.has("congress") && <CongressTab symbol={symbol} />}
            </div>
          </TabsContent>

          {/* ─── News ─── */}
          <TabsContent value="news" data-testid="tab-content-news">
            <div className="mt-3">
              {visitedTabs.has("news") && <NewsEvidenceTab symbol={symbol} />}
            </div>
          </TabsContent>

          {/* ─── Institutional ─── */}
          <TabsContent value="institutional" data-testid="tab-content-institutional">
            <div className="mt-3">
              <InstitutionalTab />
            </div>
          </TabsContent>

          {/* ─── Catalysts ─── */}
          <TabsContent value="catalysts" data-testid="tab-content-catalysts">
            <div className="mt-3">
              <CatalystsTab pkg={pkg} snapshot={snapshot} />
            </div>
          </TabsContent>

          {/* ─── AI Summary ─── */}
          <TabsContent value="ai-summary" data-testid="tab-content-ai-summary">
            <div className="mt-3">
              <AiSummaryTab pkg={pkg} snapshot={snapshot} newsData={newsData} />
            </div>
          </TabsContent>
        </Tabs>

        {/* Compliance Footer — always visible */}
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
