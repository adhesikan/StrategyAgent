// Sprint 5.5 — Personalized Morning Dashboard (/dashboard)
// Task #58: Real market data — all demo/simulated/fallback values removed.
//
// Authenticated landing page. Calls GET /api/dashboard — a single backend
// orchestration endpoint that fans out in parallel to all data sources and
// returns a consolidated payload with per-section status tags.
//
// Section isolation: every section renders independently. A failed section
// shows an honest error + Retry button and never blanks the rest of the page.
//
// Compliance rules:
//   - No "buy", "sell", "recommended for you", "best investment" copy.
//   - No account numbers or broker identifiers.
//   - No fabricated data — missing fields show explicit error states.
//   - GPT may not reorder opportunity candidates.
//   - No raw internal enums exposed (verdicts come from stored record labels).

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { getMarketSessionInfo } from "@shared/market-session";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import {
  getScoreColorClass,
  getScoreBarClass,
  formatRelativeTime as formatRankingAge,
  getCategoryLabel,
  getCategoryBadgeClass,
  getChangeDisplay,
  getChangeBadgeClass,
  getConfidenceBadgeClass,
} from "@/lib/opportunity-ranking-helpers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TrialBanner } from "@/components/trial-banner";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  RefreshCw,
  BookOpen,
  Wallet,
  Search,
  Target,
  BarChart2,
  Newspaper,
  Globe,
  Briefcase,
  Star,
  AlertTriangle,
  Info,
  Plus,
  Clock,
  ExternalLink,
  DollarSign,
  Cpu,
  Minus,
  Activity,
  Database,
  History,
  ChevronUp,
  ChevronDown,
  Zap,
  X,
  CheckCircle2,
} from "lucide-react";
import { SCORE_LABEL_TO_GLOSSARY_KEY } from "@shared/research-glossary";
import { ResearchDefinitionTooltip, ResearchHelpIcon } from "@/components/research-definition-tooltip";
import { ScoreExplanationModal } from "@/components/score-explanation-modal";

// ---------------------------------------------------------------------------
// Types (mirrors what GET /api/dashboard returns)
// ---------------------------------------------------------------------------

interface IndexQuote {
  symbol: string;
  name: string;
  last: number;
  changePercent: number;
}

interface VixQuote {
  last: number;
  changePercent: number;
}

interface SectorQuote {
  symbol: string;
  name: string;
  changePercent: number;
}

interface MarketRegimeSummary {
  regime: "TRENDING" | "CHOPPY" | "RISK_OFF";
  strength: number;
  description: string;
}

interface MoverQuote {
  symbol: string;
  last: number;
  changePercent: number;
}

interface NewsItem {
  symbol: string;
  label: "bullish" | "bearish" | "neutral";
  impact: "high" | "medium" | "low";
  buzz: number;
  whyItMatters: string;
  articleCount: number;
}

interface SnapshotItem {
  symbol: string;
  name?: string;
  headline: string;
}

interface MarketSnapshot {
  marketTone: "bullish" | "mixed" | "defensive" | null;
  marketToneReason: string;
  indices: IndexQuote[];
  vix: VixQuote | null;
  sectorLeadership: SectorQuote[];
  marketRegime: MarketRegimeSummary | null;
  topMovers: MoverQuote[];
  topNews: NewsItem[];
  topGrowth: SnapshotItem | null;
  /** "live" | "partial" | "error" */
  dataMode: "live" | "partial" | "error";
  /** Precise provenance of index/mover prices. */
  dataSource?: "broker" | "twelve_data" | "unavailable";
  /** Source of topGrowth: sentiment-based, or null when unavailable. */
  growthSource?: "sentiment" | null;
  asOf: string;
}

/** Mirrors RankedTradeCandidate from ranked-trade-search.ts */
interface RankedStockCandidate {
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

/** Mirrors RankedWatchCandidate from ranked-trade-search.ts */
interface WatchStockCandidate {
  symbol: string;
  strategy?: string;
  currentStage?: string;
  missingConfirmation?: string;
  watchConditions: string[];
}

interface ExclusionGroup {
  reason: string;
  count: number;
}

interface StockOpportunitiesBlock {
  status: "ok" | "unavailable";
  dataSource?: "mcp";
  dataQuality?: "Latest daily market data";
  generatedAt?: string;
  sourceTimestamp?: string;
  reviewedCount?: number;
  qualifiedCount?: number;
  watchCount?: number;
  excludedCount?: number;
  unavailableCount?: number;
  candidates?: RankedStockCandidate[];
  watchCandidates?: WatchStockCandidate[];
  exclusionSummary?: ExclusionGroup[];
  warnings?: string[];
  reason?: string;
}

// ---------------------------------------------------------------------------
// Opportunity Engine snapshot (served by GET /api/opportunities/latest)
// ---------------------------------------------------------------------------

interface OpportunityCounts {
  reviewed: number;
  qualified: number;
  watch: number;
  rejected: number;
  excluded: number;
  unavailable: number;
}

interface OpportunitySnapshot {
  id: string;
  status: "SUCCESS" | "PARTIAL_SUCCESS" | "EMPTY_SUCCESS";
  freshnessStatus: "fresh" | "stale";
  refreshStatus: "idle" | "running" | "failed";
  startedAt: string;
  completedAt: string;
  generatedAt: string;
  scannerVersion: string;
  marketRegime: string | null;
  dataSource: string;
  dataQuality: string;
  counts: OpportunityCounts;
  topGrowth: RankedStockCandidate[];
  topIncome: RankedStockCandidate[];
  topWatchlist: WatchStockCandidate[];
  approachingQualification: WatchStockCandidate[];
  warnings: string[];
}

interface LastRefreshInfo {
  status: "idle" | "running" | "failed";
  attemptedAt: string | null;
  errorSummary: string | null;
}

interface OpportunityLatestResponse {
  snapshot: OpportunitySnapshot | null;
  lastRefresh: LastRefreshInfo;
}

// ---------------------------------------------------------------------------
// Lifecycle types (Sprint 2.0 — mirrors opportunity-comparison-service.ts)
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

interface SnapshotComparison {
  hasPreviousScan: boolean;
  summary: {
    newCount: number;
    triggeredCount: number;
    improvingCount: number;
    weakeningCount: number;
    removedCount: number;
    approachingCount: number;
    stillQualifiedCount: number;
    latestScanTime: string | null;
    previousScanTime: string | null;
  };
  newOpportunities: LifecycleItem[];
  triggered: LifecycleItem[];
  improving: LifecycleItem[];
  weakening: LifecycleItem[];
  removed: LifecycleItem[];
  approaching: LifecycleItem[];
  stillQualified: LifecycleItem[];
  all: LifecycleItem[];
  statistics: {
    avgRankDelta: number;
    topMover: string | null;
    mostStable: string | null;
  };
}

// ---------------------------------------------------------------------------
// Opportunity Ranking Engine types (Sprint 2.2.8)
// Mirrors the server-side engine output from /api/opportunities/today.
// ---------------------------------------------------------------------------

interface OpportunityScore {
  symbol: string;
  overallScore: number;
  confidence: "high" | "medium" | "low";
  technicalScore: number;
  institutionalScore: number;
  fundamentalScore: number;
  riskScore: number;
  regimeScore: number;
  category: "Top Growth" | "Income" | "Watch" | "Avoid";
  reasons: string[];
  warnings: string[];
  lastUpdated: string;
}

/** RankedStockCandidate extended with a composite OpportunityScore. */
interface ScoredStockCandidate extends RankedStockCandidate {
  opportunityScore: OpportunityScore;
}

/** WatchStockCandidate extended with a composite OpportunityScore. */
interface ScoredWatchStockCandidate extends WatchStockCandidate {
  opportunityScore: OpportunityScore;
}

interface OpportunityChange {
  symbol: string;
  from: string;
  to: string;
  direction: "upgraded" | "downgraded" | "new" | "moved";
}

interface OpportunityRanking {
  generatedAt: string;
  snapshotId: string;
  regime: string | null;
  weights: Record<string, number>;
  topGrowth: ScoredStockCandidate[];
  topIncome: ScoredStockCandidate[];
  watchlist: ScoredWatchStockCandidate[];
  approaching: ScoredWatchStockCandidate[];
  changes: OpportunityChange[];
}

interface OpportunityTodayResponse {
  ranking: OpportunityRanking | null;
  available: boolean;
  message: string | null;
}

// ---------------------------------------------------------------------------
// Change Intelligence types (Sprint 2.3.1 — /api/opportunities/changes/explained)
// ---------------------------------------------------------------------------

type ChangeImportance = "Minor" | "Moderate" | "Major" | "Critical";
type ChangeConfidence = "high" | "medium" | "low";
type ChangeDirection  = "upgraded" | "downgraded" | "new" | "moved" | "unchanged" | "removed";

interface OpportunityChangeExplanation {
  symbol: string;
  previousRank: number | null;
  currentRank:  number | null;
  previousScore: number | null;
  currentScore:  number;
  scoreDelta:    number | null;
  rankDelta:     number | null;
  importance:    ChangeImportance;
  summary:       string;
  drivers:       string[];
  warnings:      string[];
  confidence:    ChangeConfidence;
  category:      string;
  direction:     ChangeDirection;
}

interface ChangeIntelligenceReport {
  generatedAt:  string;
  majorMovers:  OpportunityChangeExplanation[];
  upgrades:     OpportunityChangeExplanation[];
  downgrades:   OpportunityChangeExplanation[];
  newEntries:   OpportunityChangeExplanation[];
  removed:      OpportunityChangeExplanation[];
  available:    boolean;
  message?:     string | null;
}

interface SymbolHistoryEntry {
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

interface OptionsAvailabilityBlock {
  liveChainAvailable: false;
  source: "broker" | null;
  brokerRequired: true;
  estimatedStructuresAvailable: boolean;
  message: string;
}

interface AiInfraTicker {
  symbol: string;
  companyName: string;
  trend: "up" | "down" | "flat";
  trendLabel: string;
  sentiment: "bullish" | "bearish" | "neutral";
  technicalScore: number;
  last: number | null;
  changePercent: number | null;
}

interface Position {
  symbol: string;
  qty: number;
  costBasis?: number;
  marketPrice?: number;
  unrealizedPnl?: number;
}

interface ResearchRecord {
  id: string;
  symbol?: string;
  title: string;
  domain: string;
  verdict?: string;
  confidence?: string;
  strategyDisplayName?: string;
  generatedAt: string;
  userLabel?: string;
}

interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

interface DashboardResponse {
  marketSnapshot: { status: "ok"; data: MarketSnapshot } | { status: "unavailable" };
  /** Options-data boundary. Never fabricated contracts; labeled "Estimated" only. */
  optionsAvailability: OptionsAvailabilityBlock;
  aiInfraWatch:
    | { status: "ok"; tickers: AiInfraTicker[] }
    | { status: "unavailable" };
  portfolio: {
    brokerConnected: boolean;
    status: "ok" | "unavailable" | "not_connected";
    positions?: Position[];
  };
  savedResearch: { status: "ok"; records: ResearchRecord[] } | { status: "unavailable" };
  watchlists: { status: "ok"; items: Watchlist[] } | { status: "unavailable" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Unified data-quality label system (Sprint 5.5A / Task #58)
// Use DATA_QUALITY[key] for user-facing text; DATA_QUALITY_CLASS[key] for styling.
// ---------------------------------------------------------------------------

const DATA_QUALITY = {
  LIVE:             "Live",
  BROKER_CONNECTED: "Broker data",
  DAILY_CLOSE:      "Latest daily close",
  DELAYED:          "Delayed",
  SNAPSHOT:         "Market snapshot",
  REAL_DATA:        "Real market data",
  ESTIMATED:        "Estimated structure",
  UNAVAILABLE:      "Data unavailable",
  UNKNOWN:          "Source not verified",
} as const;

type DataQualityKey = keyof typeof DATA_QUALITY;

const DATA_QUALITY_CLASS: Record<DataQualityKey, string> = {
  LIVE:             "text-emerald-300 border-emerald-500/30 bg-emerald-500/5",
  BROKER_CONNECTED: "text-sky-300 border-sky-500/30 bg-sky-500/5",
  DAILY_CLOSE:      "text-amber-300 border-amber-500/30 bg-amber-500/5",
  DELAYED:          "text-amber-300 border-amber-500/30 bg-amber-500/5",
  SNAPSHOT:         "text-muted-foreground border-border bg-muted/20",
  REAL_DATA:        "text-emerald-300 border-emerald-500/30 bg-emerald-500/5",
  ESTIMATED:        "text-amber-300 border-amber-500/30 bg-amber-500/5",
  UNAVAILABLE:      "text-rose-300 border-rose-500/30 bg-rose-500/5",
  UNKNOWN:          "text-muted-foreground border-border bg-muted/10",
};

/** Map the snapshot's dataSource field to a DATA_QUALITY key. */
function snapshotDataQualityKey(
  dataSource?: "broker" | "twelve_data" | "unavailable",
  dataMode?: "live" | "partial" | "error",
): DataQualityKey {
  if (dataMode === "error") return "UNAVAILABLE";
  if (dataSource === "broker") return "BROKER_CONNECTED";
  if (dataSource === "twelve_data") return "DAILY_CLOSE";
  return "UNAVAILABLE";
}

const TONE_CLASS: Record<string, string> = {
  bullish: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  mixed: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  defensive: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const REGIME_CLASS: Record<string, string> = {
  TRENDING:  "text-emerald-300 border-emerald-500/30 bg-emerald-500/5",
  CHOPPY:    "text-amber-300 border-amber-500/30 bg-amber-500/5",
  RISK_OFF:  "text-rose-300 border-rose-500/30 bg-rose-500/5",
};

const REGIME_LABEL: Record<string, string> = {
  TRENDING: "Trending",
  CHOPPY:   "Choppy",
  RISK_OFF: "Risk-Off",
};

// Sprint 5.5A: impact badges now have explicit meaning labels
const IMPACT_LABEL: Record<string, string> = {
  high: "High attention",
  medium: "Elevated activity",
  low: "Low activity",
};
const IMPACT_CLASS: Record<string, string> = {
  high: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  medium: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  low: "bg-muted text-muted-foreground border-border",
};

const SENTIMENT_LABEL: Record<string, string> = {
  bullish: "Positive sentiment",
  bearish: "Mixed / bearish sentiment",
  neutral: "Neutral context",
};

const GRADE_CLASS: Record<string, string> = {
  "A+": "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  A: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  B: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  C: "bg-amber-500/10 text-amber-300 border-amber-500/30",
};

function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function askRoute(prompt: string): string {
  return `/ask?q=${encodeURIComponent(prompt)}`;
}

// ---------------------------------------------------------------------------
// SectionError — honest error state with retry
// ---------------------------------------------------------------------------

function SectionError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
      <span data-testid={`error-${label}`}>Market data is temporarily unavailable.</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          track("dashboard_section_retry", { section: label } as any);
          onRetry();
        }}
        className="gap-1.5 text-xs"
        data-testid={`retry-${label}`}
        aria-label={`Retry loading ${label}`}
      >
        <RefreshCw className="h-3.5 w-3.5" /> Retry
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Morning Header
// ---------------------------------------------------------------------------

function MorningHeaderSection({ firstName }: { firstName: string }) {
  const now = new Date();
  const sessionInfo = getMarketSessionInfo(now);
  const hour = now.getHours();

  const sessionColor: Record<string, string> = {
    regular: "border-emerald-500/40 text-emerald-300 bg-emerald-500/5",
    pre: "border-blue-500/40 text-blue-300 bg-blue-500/5",
    after: "border-orange-500/40 text-orange-300 bg-orange-500/5",
    closed: "border-border text-muted-foreground bg-muted/20",
  };

  return (
    <section aria-labelledby="dashboard-greeting" data-testid="section-morning-header">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1
            id="dashboard-greeting"
            className="text-xl md:text-2xl font-semibold tracking-tight"
            data-testid="text-dashboard-greeting"
          >
            {greetingForHour(hour)}{firstName ? `, ${firstName}` : ""}.
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-dashboard-date">
            {formatDate(now)}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn("self-start sm:self-center text-xs px-3 py-1.5 gap-1.5", sessionColor[sessionInfo.session])}
          data-testid="badge-market-session"
          aria-label={`Market status: ${sessionInfo.label}`}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              sessionInfo.session === "regular"
                ? "bg-emerald-400 animate-pulse"
                : sessionInfo.session === "pre" || sessionInfo.session === "after"
                ? "bg-blue-400"
                : "bg-muted-foreground",
            )}
          />
          {sessionInfo.label}
        </Badge>
      </div>
    </section>
  );
}

function MarketCommandBar({ snapshot, brokerConnected }: { snapshot?: MarketSnapshot; brokerConnected: boolean }) {
  const now = new Date();
  const sessionInfo = getMarketSessionInfo(now);
  const regime = snapshot?.marketRegime?.regime;
  const regimeLabel = regime === "TRENDING" ? "Strong Bull" : regime === "RISK_OFF" ? "Risk-Off" : regime === "CHOPPY" ? "Choppy" : "Unavailable";
  const tone = snapshot?.marketTone ? snapshot.marketTone.charAt(0).toUpperCase() + snapshot.marketTone.slice(1) : "Unavailable";
  const asOf = snapshot?.asOf ? new Date(snapshot.asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "—";
  const dot = (color: string, pulse = false) => <span className={cn("h-1.5 w-1.5 rounded-full", color, pulse && "animate-pulse")} />;
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap rounded-md border border-border/40 bg-card/40 px-2.5 py-2 text-[10px]" data-testid="market-command-bar">
      <span className="uppercase tracking-widest text-muted-foreground mr-1">Command</span>
      <Badge variant="outline" className={cn("gap-1 text-[10px]", regime ? REGIME_CLASS[regime] : "text-muted-foreground border-border/40")}>{dot(regime === "RISK_OFF" ? "bg-rose-400" : regime === "CHOPPY" ? "bg-amber-400" : "bg-emerald-400")} Regime: {regimeLabel}</Badge>
      <Badge variant="outline" className={cn("gap-1 text-[10px]", snapshot?.marketTone ? TONE_CLASS[snapshot.marketTone] : "text-muted-foreground border-border/40")}>{dot(snapshot?.marketTone === "defensive" ? "bg-rose-400" : snapshot?.marketTone === "mixed" ? "bg-amber-400" : "bg-emerald-400")} Trend: {tone}</Badge>
      <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/40">Scanner: {snapshot?.dataSource === "broker" ? "Broker Data" : snapshot?.dataSource === "twelve_data" ? "Latest Daily Close" : "Unavailable"}</Badge>
      <span className="text-muted-foreground">As of <span className="font-mono text-foreground/80">{asOf}</span></span>
      <span className={cn("flex items-center gap-1", brokerConnected ? "text-emerald-300" : "text-muted-foreground")}>{dot(brokerConnected ? "bg-emerald-400" : "bg-muted-foreground")} Broker: {brokerConnected ? "Connected" : "Not Connected"}</span>
      <span className={cn("ml-auto flex items-center gap-1", sessionInfo.session === "regular" ? "text-emerald-300" : "text-muted-foreground")}>{dot(sessionInfo.session === "regular" ? "bg-emerald-400" : "bg-muted-foreground", sessionInfo.session === "regular")} {sessionInfo.label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Quick Actions
// ---------------------------------------------------------------------------

const QUICK_ACTIONS = [
  {
    id: "growth",
    label: "Find Growth",
    icon: TrendingUp,
    color: "text-emerald-400",
    href: askRoute("Find long-term AI infrastructure growth opportunities"),
  },
  {
    id: "income",
    label: "Generate Income",
    icon: DollarSign,
    color: "text-amber-400",
    href: askRoute("Find income opportunities with covered calls or cash-secured puts under $500 risk"),
  },
  {
    id: "analyze",
    label: "Analyze Stock",
    icon: Search,
    color: "text-violet-400",
    href: "/ask",
  },
  {
    id: "portfolio",
    label: "Review Portfolio",
    icon: Wallet,
    color: "text-primary",
    href: askRoute("Analyze my portfolio exposure and concentration"),
  },
  {
    id: "research",
    label: "Education",
    icon: BookOpen,
    color: "text-rose-400",
    href: "/ask",
  },
  {
    id: "markets",
    label: "Market Research",
    icon: Globe,
    color: "text-cyan-400",
    href: askRoute("Explain the current market regime and what it means for investors"),
  },
];

function QuickActionsSection() {
  const [, navigate] = useLocation();

  return (
    <section aria-labelledby="quick-actions-heading" data-testid="section-quick-actions">
      <h2 id="quick-actions-heading" className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        Quick Actions
      </h2>
      <div
        className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2"
        role="list"
        data-testid="grid-quick-actions"
      >
        {QUICK_ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.id}
              type="button"
              role="listitem"
              onClick={() => {
                track("dashboard_quick_action_clicked", { action: a.id } as any);
                navigate(a.href);
              }}
              data-testid={`btn-quick-${a.id}`}
              aria-label={a.label}
              className="flex flex-col items-center gap-1.5 rounded-lg border bg-card/50 px-2 py-3 text-center text-xs font-medium transition-colors hover:bg-accent/40 hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className={cn("h-5 w-5 shrink-0", a.color)} aria-hidden="true" />
              <span className="leading-tight">{a.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. Market Snapshot — real data only
// ---------------------------------------------------------------------------

function MarketSnapshotSection({
  data,
  status,
  onRetry,
}: {
  data?: MarketSnapshot;
  status: string;
  onRetry: () => void;
}) {
  if (status === "unavailable" || !data || data.dataMode === "error") {
    return (
      <section aria-labelledby="snapshot-heading" data-testid="section-market-snapshot">
        <h2 id="snapshot-heading" className="sr-only">Market Snapshot</h2>
        <SectionError label="Market snapshot" onRetry={onRetry} />
      </section>
    );
  }

  const asOf = new Date(data.asOf).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const qKey = snapshotDataQualityKey(data.dataSource, data.dataMode);
  const isBroker = data.dataSource === "broker";

  return (
    <section aria-labelledby="snapshot-heading" data-testid="section-market-snapshot">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <BarChart2 className="h-4 w-4 text-primary" aria-hidden="true" />
              <span id="snapshot-heading">Market Snapshot</span>
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Data provenance badges */}
              <Badge
                variant="outline"
                className={cn("text-[10px]", DATA_QUALITY_CLASS[qKey])}
                data-testid="badge-data-mode"
                aria-label={`Data quality: ${DATA_QUALITY[qKey]}`}
              >
                {DATA_QUALITY[qKey]}
              </Badge>
              {/* "Powered by Twelve Data" badge when using Twelve Data */}
              {data.dataSource === "twelve_data" && (
                <Badge
                  variant="outline"
                  className="text-[10px] text-muted-foreground border-border bg-muted/10"
                  data-testid="badge-twelve-data"
                >
                  Powered by Twelve Data
                </Badge>
              )}
              {/* "Latest Daily Close" explainer when not broker real-time */}
              {data.dataSource === "twelve_data" && (
                <Badge
                  variant="outline"
                  className={cn("text-[10px]", DATA_QUALITY_CLASS.DAILY_CLOSE)}
                  data-testid="badge-latest-close"
                >
                  Latest Daily Close
                </Badge>
              )}
              <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="text-snapshot-time">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {asOf}
              </span>
            </div>
          </div>

          {/* Market Tone + Regime */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Tone</span>
            {data.marketTone ? (
              <Badge
                variant="outline"
                className={cn("capitalize text-[10px]", TONE_CLASS[data.marketTone])}
                data-testid="badge-market-tone"
              >
                {data.marketTone}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                Unavailable
              </Badge>
            )}
            {data.marketRegime && (
              <>
                <span className="text-muted-foreground text-[10px]">·</span>
                <Badge
                  variant="outline"
                  className={cn("text-[10px]", REGIME_CLASS[data.marketRegime.regime] ?? "border-border")}
                  data-testid="badge-market-regime"
                  title={data.marketRegime.description}
                  aria-label={`Market regime: ${REGIME_LABEL[data.marketRegime.regime]}, strength ${data.marketRegime.strength}`}
                >
                  {REGIME_LABEL[data.marketRegime.regime]} Regime
                </Badge>
              </>
            )}
            {data.marketToneReason && (
              <span className="text-xs text-muted-foreground line-clamp-1" data-testid="text-tone-reason">
                {data.marketToneReason}
              </span>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Index tiles: SPY, QQQ, IWM + VIX */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Indices</div>
            <div
              className="grid grid-cols-2 sm:grid-cols-4 gap-2"
              role="list"
              aria-label="Index quotes"
            >
              {data.indices.slice(0, 3).map((idx) => {
                const up = idx.changePercent >= 0;
                const hasData = idx.last > 0;
                return (
                  <div
                    key={idx.symbol}
                    className="rounded-lg border bg-card/50 p-2.5"
                    role="listitem"
                    data-testid={`tile-index-${idx.symbol}`}
                    aria-label={`${idx.name}: ${hasData ? idx.last.toFixed(2) : "unavailable"}`}
                  >
                    <div className="text-[10px] uppercase text-muted-foreground">{idx.name}</div>
                    <div className="flex items-baseline justify-between gap-1 mt-0.5">
                      <span className="text-sm font-medium tabular-nums">
                        {hasData ? idx.last.toFixed(2) : <span className="text-muted-foreground text-xs">—</span>}
                      </span>
                      {hasData && (
                        <span
                          className={cn(
                            "text-xs tabular-nums flex items-center gap-0.5",
                            up ? "text-emerald-400" : "text-rose-400",
                          )}
                        >
                          {up ? <TrendingUp className="h-3 w-3" aria-hidden="true" /> : <TrendingDown className="h-3 w-3" aria-hidden="true" />}
                          {up ? "+" : ""}{idx.changePercent.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* VIX tile */}
              {data.vix ? (
                <div
                  className="rounded-lg border bg-card/50 p-2.5"
                  role="listitem"
                  data-testid="tile-index-VIX"
                  aria-label={`VIX: ${data.vix.last.toFixed(2)}`}
                >
                  <div className="text-[10px] uppercase text-muted-foreground">VIX</div>
                  <div className="flex items-baseline justify-between gap-1 mt-0.5">
                    <span className="text-sm font-medium tabular-nums">{data.vix.last.toFixed(2)}</span>
                    <span
                      className={cn(
                        "text-xs tabular-nums flex items-center gap-0.5",
                        // VIX up = market fear = bearish (red), VIX down = calmer (green)
                        data.vix.changePercent <= 0 ? "text-emerald-400" : "text-rose-400",
                      )}
                    >
                      {data.vix.changePercent >= 0 ? "+" : ""}{data.vix.changePercent.toFixed(2)}%
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border bg-card/30 p-2.5 opacity-50">
                  <div className="text-[10px] uppercase text-muted-foreground">VIX</div>
                  <div className="text-xs text-muted-foreground mt-1">—</div>
                </div>
              )}
            </div>
          </div>

          {/* Sector Leadership */}
          {data.sectorLeadership.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Sector Leadership</div>
              <div className="flex flex-wrap gap-1.5">
                {data.sectorLeadership.map((s) => {
                  const up = s.changePercent >= 0;
                  return (
                    <span
                      key={s.symbol}
                      className={cn(
                        "text-[10px] font-mono rounded-md border px-2 py-0.5 inline-flex items-center gap-1",
                        up
                          ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5"
                          : "text-rose-400 border-rose-500/30 bg-rose-500/5",
                      )}
                      data-testid={`sector-${s.symbol}`}
                      title={s.name}
                    >
                      {up ? "▲" : "▼"} {s.symbol} {up ? "+" : ""}{s.changePercent.toFixed(1)}%
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Top movers */}
          {data.topMovers.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Movers</div>
              <div className="flex flex-wrap gap-2">
                {data.topMovers.slice(0, 5).map((m) => (
                  <span
                    key={m.symbol}
                    className={cn(
                      "text-xs font-mono rounded-md border px-2 py-0.5",
                      m.changePercent >= 0
                        ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5"
                        : "text-rose-400 border-rose-500/30 bg-rose-500/5",
                    )}
                    data-testid={`mover-${m.symbol}`}
                  >
                    {m.symbol} {m.changePercent >= 0 ? "+" : ""}{m.changePercent.toFixed(1)}%
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4. Today's Stock Opportunities — MCP rank_market_trade_candidates pipeline
//    No simulated data, no synthetic options fields.
//    Options data boundary is a separate section.
// ---------------------------------------------------------------------------

/** Lifecycle state → badge label + colour class. */
const LIFECYCLE_BADGE: Record<LifecycleState, { label: string; className: string }> = {
  NEWLY_QUALIFIED: { label: "NEW",       className: "text-emerald-300 border-emerald-500/40 bg-emerald-500/8" },
  STILL_QUALIFIED: { label: "STABLE",    className: "text-sky-300     border-sky-500/40     bg-sky-500/8" },
  STRENGTHENING:   { label: "UP",        className: "text-emerald-300 border-emerald-500/40 bg-emerald-500/8" },
  WEAKENING:       { label: "DOWN",      className: "text-rose-300    border-rose-500/40    bg-rose-500/8" },
  APPROACHING:     { label: "WATCH",     className: "text-amber-300   border-amber-500/40   bg-amber-500/8" },
  TRIGGERED:       { label: "TRIGGERED", className: "text-violet-300  border-violet-500/40  bg-violet-500/8" },
  DROPPED:         { label: "DROPPED",   className: "text-rose-300    border-rose-500/40    bg-rose-500/8" },
  UNAVAILABLE:     { label: "N/A",       className: "text-muted-foreground border-border" },
};

/** Mini score pill — label + coloured numeric value. */
function ScorePill({ label, score }: { label: string; score: number }) {
  const termKey = SCORE_LABEL_TO_GLOSSARY_KEY[label];
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-0">
      <span
        className={cn("text-[11px] font-mono font-semibold tabular-nums", getScoreColorClass(score))}
        data-testid={`score-${label.toLowerCase()}`}
      >
        {score}
      </span>
      {termKey ? (
        <ResearchDefinitionTooltip term={termKey} side="bottom" showCaution={false}>
          <span className="text-[9px] text-muted-foreground truncate">{label}</span>
        </ResearchDefinitionTooltip>
      ) : (
        <span className="text-[9px] text-muted-foreground truncate">{label}</span>
      )}
    </div>
  );
}

/**
 * Opportunity card — Sprint 2.2.8.
 * Displays the composite OpportunityScore alongside all scanner evidence.
 * `opportunityScore` is required for candidates from /api/opportunities/today.
 */
function StockOpportunityCard({
  candidate,
  hasCachedResult,
  lifecycleState,
}: {
  candidate: ScoredStockCandidate;
  hasCachedResult?: boolean;
  lifecycleState?: LifecycleState;
}) {
  const [, navigate] = useLocation();
  const [showWhy, setShowWhy] = useState(false);
  const ctaText = hasCachedResult ? "Open Analysis" : "Analyze";
  const score = candidate.opportunityScore;

  return (
    <div
      className="rounded-md border border-border/40 bg-card/50 p-3 space-y-2.5 transition-colors hover:border-border"
      data-testid={`card-stock-${candidate.symbol}`}
      role="article"
      aria-label={`${candidate.symbol} stock opportunity`}
    >
      {/* ── Header row ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <span
          className="font-mono font-semibold text-lg tracking-tight"
          data-testid={`symbol-${candidate.symbol}`}
        >
          {candidate.symbol}
        </span>
        <Badge variant="outline" className="text-[10px] border-border/50 text-muted-foreground">
          #{candidate.rank}
        </Badge>
        {/* Category badge from the ranking engine */}
        <Badge
          variant="outline"
          className={cn("text-[10px]", getCategoryBadgeClass(score.category))}
          data-testid={`badge-category-${candidate.symbol}`}
        >
          {getCategoryLabel(score.category)}
        </Badge>
        {/* Composite confidence (not raw MCP confidence) */}
        <div className="flex items-center gap-0.5">
          <Badge
            variant="outline"
            className={cn("text-[10px]", getConfidenceBadgeClass(score.confidence))}
            data-testid={`confidence-${candidate.symbol}`}
            aria-label={`Evidence Confidence: ${score.confidence}`}
          >
            {score.confidence.charAt(0).toUpperCase() + score.confidence.slice(1)}
          </Badge>
          <ResearchHelpIcon term="evidence_confidence" side="bottom" />
        </div>
        {lifecycleState && <LifecycleBadge state={lifecycleState} />}
      </div>

      {/* ── Scanner strategy ────────────────────────────────────────────── */}
      {candidate.strategy && (
        <div
          className="text-[10px] uppercase tracking-wide text-muted-foreground"
          data-testid={`strategy-${candidate.symbol}`}
        >
          {candidate.strategy}
        </div>
      )}

      {/* ── Overall score bar ───────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span
          className={cn("text-xl font-bold font-mono tabular-nums", getScoreColorClass(score.overallScore))}
          data-testid={`overall-score-${candidate.symbol}`}
        >
          {score.overallScore}
        </span>
        <div className="flex-1 h-1.5 bg-border/30 rounded-full overflow-hidden" aria-hidden="true">
          <div
            className={cn("h-full rounded-full transition-all", getScoreBarClass(score.overallScore))}
            style={{ width: `${score.overallScore}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground">/ 100</span>
        <ResearchHelpIcon term="research_score" side="top" />
      </div>

      {/* ── Score breakdown ─────────────────────────────────────────────── */}
      <div
        className="grid grid-cols-4 gap-2 py-0.5 border-y border-border/20"
        data-testid={`score-breakdown-${candidate.symbol}`}
      >
        <ScorePill label="Tech"  score={score.technicalScore} />
        <ScorePill label="Inst"  score={score.institutionalScore} />
        <ScorePill label="Fund"  score={score.fundamentalScore} />
        <ScorePill label="Risk"  score={score.riskScore} />
      </div>

      {/* ── Why This Qualified (expandable) ─────────────────────────────── */}
      {(score.reasons.length > 0 || score.warnings.length > 0) && (
        <div data-testid={`why-qualified-${candidate.symbol}`}>
          <button
            type="button"
            onClick={() => setShowWhy((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground w-full text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded py-0.5"
            aria-expanded={showWhy}
            aria-controls={`why-panel-${candidate.symbol}`}
          >
            <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>Why this qualified</span>
            {showWhy ? (
              <ChevronUp className="h-3 w-3 ml-auto shrink-0" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3 w-3 ml-auto shrink-0" aria-hidden="true" />
            )}
          </button>
          {showWhy && (
            <div
              id={`why-panel-${candidate.symbol}`}
              className="mt-1.5 space-y-1.5"
              data-testid={`why-panel-${candidate.symbol}`}
            >
              {score.reasons.map((r, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{r}</span>
                </div>
              ))}
              {score.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] text-amber-400">
                  <AlertTriangle className="h-3 w-3 mt-px shrink-0" aria-hidden="true" />
                  <span>{w}</span>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground/50 border-t border-border/20 pt-1">
                Deterministic evidence only. Not a recommendation.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Entry / stop levels from MCP ────────────────────────────────── */}
      {(candidate.trigger || candidate.invalidation) && (
        <div className="flex gap-1.5 text-[10px] text-muted-foreground font-mono">
          {candidate.trigger && (
            <span className="rounded border border-emerald-500/20 bg-emerald-500/5 px-1.5 py-0.5">
              Entry {candidate.trigger}
            </span>
          )}
          {candidate.invalidation && (
            <span className="rounded border border-rose-500/20 bg-rose-500/5 px-1.5 py-0.5">
              Stop {candidate.invalidation}
            </span>
          )}
        </div>
      )}

      {/* ── CTAs ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 pt-0.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => {
            track(
              hasCachedResult ? "dashboard_existing_result_opened" : "dashboard_full_analysis_requested",
              { symbol: candidate.symbol } as any,
            );
            track("dashboard_stock_opportunity_opened" as any, { symbol: candidate.symbol } as any);
            navigate(askRoute(`Analyze ${candidate.symbol}`));
          }}
          data-testid={`btn-open-analysis-${candidate.symbol}`}
          aria-label={`${ctaText} for ${candidate.symbol}`}
        >
          {ctaText} <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1 px-2"
          onClick={() => {
            track("dashboard_research_package_opened" as any, { symbol: candidate.symbol } as any);
            navigate(`/opportunity/${candidate.symbol}`);
          }}
          data-testid={`btn-research-${candidate.symbol}`}
          aria-label={`Research Package for ${candidate.symbol}`}
        >
          Research
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => navigate("/scanner")}
          aria-label={`Watch ${candidate.symbol}`}
        >
          <Star className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enriched Ranking Changes Panel (Sprint 2.3.1)
// Replaces the simple chip list with driver/score details from the
// Change Intelligence engine (/api/opportunities/changes/explained).
// Falls back to the simple chip view when explained data is unavailable.
// ---------------------------------------------------------------------------

const IMPORTANCE_COLOR: Record<ChangeImportance, string> = {
  Critical: "border-rose-700 bg-rose-950/40 text-rose-200",
  Major:    "border-amber-700 bg-amber-950/40 text-amber-200",
  Moderate: "border-sky-800 bg-sky-950/40 text-sky-200",
  Minor:    "border-slate-700 bg-slate-900 text-slate-400",
};

const DIRECTION_ICON: Record<ChangeDirection, string> = {
  new:        "★",
  upgraded:   "↑",
  downgraded: "↓",
  moved:      "→",
  unchanged:  "·",
  removed:    "✕",
};

function ChangeExplanationCard({
  exp,
}: {
  exp: OpportunityChangeExplanation;
}) {
  const [expanded, setExpanded] = useState(false);
  const colorClass = IMPORTANCE_COLOR[exp.importance] ?? IMPORTANCE_COLOR.Minor;
  const dirIcon    = DIRECTION_ICON[exp.direction]   ?? "·";

  return (
    <div
      className={cn("rounded-lg border p-3 text-xs", colorClass)}
      data-testid={`change-card-${exp.symbol}`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 font-mono font-semibold">
          <span className="opacity-70">{dirIcon}</span>
          <span>{exp.symbol}</span>
          <span className={cn(
            "rounded px-1 py-0.5 text-[9px] font-sans font-normal uppercase tracking-wide",
            exp.direction === "new"        ? "bg-emerald-900/60 text-emerald-300" :
            exp.direction === "upgraded"   ? "bg-sky-900/60 text-sky-300" :
            exp.direction === "downgraded" ? "bg-rose-900/60 text-rose-300" :
            exp.direction === "removed"    ? "bg-slate-800 text-slate-400" :
            "bg-slate-800 text-slate-400",
          )}>
            {exp.direction}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {exp.scoreDelta != null && (
            <span className={cn(
              "font-mono tabular-nums font-medium",
              exp.scoreDelta > 0 ? "text-emerald-400" : exp.scoreDelta < 0 ? "text-rose-400" : "text-slate-500",
            )}>
              {exp.scoreDelta > 0 ? "+" : ""}{exp.scoreDelta}
            </span>
          )}
          <span className="text-slate-500">{exp.currentScore}</span>
        </div>
      </div>

      {/* Summary */}
      <p className="text-slate-300 leading-relaxed mb-1.5">{exp.summary}</p>

      {/* Expand/collapse for drivers */}
      {exp.drivers.length > 0 && (
        <button
          className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Hide" : "Show"} drivers ({exp.drivers.length})
        </button>
      )}

      {expanded && (
        <div className="mt-2 space-y-1">
          {exp.drivers.map((d, i) => (
            <p key={i} className="text-[10px] text-slate-400 pl-2 border-l border-slate-700">
              {d}
            </p>
          ))}
          {exp.warnings.map((w, i) => (
            <p key={`w${i}`} className="text-[10px] text-amber-400 pl-2 border-l border-amber-800">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function EnrichedRankingChangesPanel({
  report,
  fallbackChanges,
}: {
  report: ChangeIntelligenceReport | undefined;
  fallbackChanges: OpportunityChange[];
}) {
  // Build a unified list: Major movers first, then upgrades/downgrades/new/removed
  const allExplanations = report
    ? [
        ...report.majorMovers,
        ...report.upgrades.filter(e => !report.majorMovers.some(m => m.symbol === e.symbol)),
        ...report.downgrades.filter(e => !report.majorMovers.some(m => m.symbol === e.symbol)),
        ...report.newEntries.filter(e => !report.majorMovers.some(m => m.symbol === e.symbol)),
        ...report.removed,
      ]
    : [];

  const hasEnriched = allExplanations.length > 0;

  if (!hasEnriched && fallbackChanges.length === 0) return null;

  return (
    <div data-testid="enriched-ranking-changes-panel">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5" aria-hidden="true" />
        What Changed
        <span className="ml-auto text-[10px] font-normal normal-case">
          {hasEnriched ? allExplanations.length : fallbackChanges.length}
        </span>
      </h3>

      {hasEnriched ? (
        <div className="space-y-2">
          {allExplanations.slice(0, 8).map(exp => (
            <ChangeExplanationCard key={exp.symbol} exp={exp} />
          ))}
        </div>
      ) : (
        /* Simple chip fallback when explained data is loading or unavailable */
        <div className="flex flex-wrap gap-2">
          {fallbackChanges.map((c) => {
            const { symbol: sym, label } = getChangeDisplay(c.direction);
            return (
              <div
                key={`${c.symbol}-${c.direction}`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-mono",
                  getChangeBadgeClass(c.direction),
                )}
                title={`${c.symbol}: ${label} — ${c.from} → ${c.to}`}
              >
                <span aria-hidden="true">{sym}</span>
                <span className="font-semibold">{c.symbol}</span>
                <span className="opacity-60 font-sans normal-case">{label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lifecycle badge + cards (Sprint 2.0)
// ---------------------------------------------------------------------------

function LifecycleBadge({ state }: { state: LifecycleState }) {
  const badge = LIFECYCLE_BADGE[state];
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px]", badge.className)}
      data-testid={`badge-lifecycle-${state}`}
    >
      {badge.label}
    </Badge>
  );
}

/** Compact lifecycle card for qualified symbols (includes rank delta + score). */
function LifecycleItemCard({
  item,
  hasCachedResult,
  onOpenHistory,
}: {
  item: LifecycleItem;
  hasCachedResult?: boolean;
  onOpenHistory: (symbol: string) => void;
}) {
  const [, navigate] = useLocation();
  const ctaText = hasCachedResult ? "Open Analysis" : "Analyze";
  const scoreUp   = item.scoreDelta > 0;
  const scoreDown = item.scoreDelta < 0;

  return (
    <div
      className="rounded-lg border bg-card/50 p-3 space-y-2"
      data-testid={`card-lifecycle-${item.symbol}`}
      role="article"
      aria-label={`${item.symbol} lifecycle card`}
    >
      {/* Header: symbol + lifecycle badge + rank change */}
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <span className="font-mono font-semibold text-sm">
          {item.symbol}
        </span>
        <LifecycleBadge state={item.lifecycleState} />
        {/* Rank change indicator */}
        {item.rankCurrent !== null && (
          <span className="text-[10px] text-muted-foreground border border-border/40 rounded px-1">
            #{item.rankCurrent}
          </span>
        )}
        {item.rankPrev !== null && item.rankCurrent !== null && item.rankPrev !== item.rankCurrent && (
          <span
            className={cn(
              "text-[10px] flex items-center gap-0.5",
              item.rankCurrent < item.rankPrev ? "text-emerald-400" : "text-rose-400",
            )}
          >
            {item.rankCurrent < item.rankPrev ? (
              <ChevronUp className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            )}
            was #{item.rankPrev}
          </span>
        )}
      </div>

      {/* Strategy */}
      {item.strategy && (
        <div className="text-xs text-muted-foreground capitalize">{item.strategy}</div>
      )}

      {/* Score delta + first seen */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        {item.scoreDelta !== 0 && (
          <span className={cn(scoreUp ? "text-emerald-400" : scoreDown ? "text-rose-400" : "")}>
            {scoreUp ? "▲" : "▼"} {Math.abs(item.scoreDelta).toFixed(0)} pts
          </span>
        )}
        {item.firstSeen && (
          <span>
            First seen{" "}
            {new Date(item.firstSeen).toLocaleDateString([], {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-1.5 pt-0.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => {
            track("dashboard_stock_opportunity_opened" as any, { symbol: item.symbol } as any);
            navigate(askRoute(`Analyze ${item.symbol}`));
          }}
          data-testid={`btn-lifecycle-analyze-${item.symbol}`}
          aria-label={`${ctaText} for ${item.symbol}`}
        >
          {ctaText} <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1"
          onClick={() => onOpenHistory(item.symbol)}
          aria-label={`View history for ${item.symbol}`}
          data-testid={`btn-lifecycle-history-${item.symbol}`}
        >
          <History className="h-3 w-3" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/** Compact row for ABSENT symbols (triggered, dropped, unavailable). */
function AbsentLifecycleRow({
  item,
  onOpenHistory,
}: {
  item: LifecycleItem;
  onOpenHistory: (symbol: string) => void;
}) {
  const [, navigate] = useLocation();
  return (
    <div
      className="rounded-md border bg-card/20 p-2.5 flex items-center justify-between gap-3"
      data-testid={`card-absent-${item.symbol}`}
    >
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <span className="font-mono text-sm font-semibold">{item.symbol}</span>
        <LifecycleBadge state={item.lifecycleState} />
        {item.rankPrev !== null && (
          <span className="text-[10px] text-muted-foreground">was #{item.rankPrev}</span>
        )}
        {item.strategy && (
          <span className="text-[10px] text-muted-foreground capitalize">{item.strategy}</span>
        )}
      </div>
      <div className="flex gap-1 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1"
          onClick={() => navigate(askRoute(`Analyze ${item.symbol}`))}
          aria-label={`Analyze ${item.symbol}`}
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1"
          onClick={() => onOpenHistory(item.symbol)}
          aria-label={`View history for ${item.symbol}`}
        >
          <History className="h-3 w-3" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Symbol History Drawer (Sprint 2.0)
// ---------------------------------------------------------------------------

function SymbolHistoryDrawer({
  symbol,
  onClose,
}: {
  symbol: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<{ symbol: string; history: SymbolHistoryEntry[] }>({
    queryKey: ["/api/opportunities/symbol", symbol, "history"],
    queryFn: async () => {
      if (!symbol) return { symbol: "", history: [] };
      const res = await apiRequest("GET", `/api/opportunities/symbol/${encodeURIComponent(symbol)}/history`);
      if (!res.ok) return { symbol, history: [] };
      return res.json();
    },
    enabled: !!symbol,
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <Sheet open={!!symbol} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" aria-hidden="true" />
            {symbol} — Opportunity History
          </SheetTitle>
        </SheetHeader>

        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {!isLoading && (!data?.history.length) && (
          <p className="text-sm text-muted-foreground py-4">
            No history recorded yet. History is written after each Opportunity Engine scan.
          </p>
        )}

        {!isLoading && data?.history && data.history.length > 0 && (
          <div className="space-y-4">
            {/* Summary: first seen */}
            {data.history.length > 0 && (
              <div className="text-xs text-muted-foreground border border-border/40 rounded-md p-3 space-y-1">
                <div>
                  <span className="font-medium text-foreground">First appeared: </span>
                  {new Date(data.history[data.history.length - 1].scanTime).toLocaleString([], {
                    month: "short", day: "numeric", year: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </div>
                <div>
                  <span className="font-medium text-foreground">Total scans tracked: </span>
                  {data.history.length}
                </div>
                {data.history[0] && (
                  <div>
                    <span className="font-medium text-foreground">Last status: </span>
                    <span className="capitalize">
                      {LIFECYCLE_BADGE[data.history[0].lifecycleState as LifecycleState]?.label ?? data.history[0].lifecycleState}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* History table */}
            <div className="space-y-1">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Historical Rankings
              </h3>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40 border-b">
                      <th className="text-left p-2 font-medium text-muted-foreground">Date</th>
                      <th className="text-left p-2 font-medium text-muted-foreground">Status</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Rank</th>
                      <th className="text-right p-2 font-medium text-muted-foreground">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.slice(0, 30).map((entry) => (
                      <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="p-2 text-muted-foreground">
                          {new Date(entry.scanTime).toLocaleDateString([], {
                            month: "short", day: "numeric",
                          })}
                        </td>
                        <td className="p-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              LIFECYCLE_BADGE[entry.lifecycleState as LifecycleState]?.className ?? "",
                            )}
                          >
                            {LIFECYCLE_BADGE[entry.lifecycleState as LifecycleState]?.label ?? entry.lifecycleState}
                          </Badge>
                        </td>
                        <td className="p-2 text-right font-mono">
                          {entry.rank != null ? `#${entry.rank}` : "—"}
                        </td>
                        <td className="p-2 text-right font-mono">
                          {entry.score.toFixed(0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// 4. Opportunity Engine Section
// ---------------------------------------------------------------------------

/** Renders a subsection of candidate cards (growth or income). */
function CandidateSubsection({
  heading,
  candidates,
  cachedSymbols,
  emptyNote,
  lifecycleBySymbol,
}: {
  heading: string;
  candidates: ScoredStockCandidate[];
  cachedSymbols: Set<string>;
  emptyNote: string;
  lifecycleBySymbol?: Map<string, LifecycleState>;
}) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        {heading}
      </h3>
      {candidates.length > 0 ? (
        <div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          role="list"
          aria-label={heading}
        >
          {candidates.map((c) => (
            <StockOpportunityCard
              key={`${c.symbol}-${c.rank}`}
              candidate={c}
              hasCachedResult={cachedSymbols.has(c.symbol.toUpperCase())}
              lifecycleState={lifecycleBySymbol?.get(c.symbol.toUpperCase())}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground py-1">{emptyNote}</p>
      )}
    </div>
  );
}

/** Renders the watch-candidate list (Top Watchlist or Approaching Qualification). */
function WatchCandidateList({
  heading,
  icon: Icon,
  candidates,
}: {
  heading: string;
  icon: React.ElementType;
  candidates: WatchStockCandidate[];
}) {
  const [, navigate] = useLocation();
  if (candidates.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {heading}
      </h3>
      <div className="space-y-2">
        {candidates.map((w) => (
          <div
            key={w.symbol}
            className="rounded-md border bg-card/30 p-3 flex items-start justify-between gap-3"
            data-testid={`card-watch-${w.symbol}`}
          >
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm font-semibold">{w.symbol}</span>
                {w.strategy && (
                  <span className="text-xs text-muted-foreground">{w.strategy}</span>
                )}
                {w.currentStage && (
                  <Badge variant="outline" className="text-[10px] border-border">
                    {w.currentStage}
                  </Badge>
                )}
              </div>
              {w.watchConditions.length > 0 && (
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {w.watchConditions[0]}
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1 shrink-0"
              onClick={() => navigate(askRoute(`Analyze ${w.symbol}`))}
              aria-label={`Analyze ${w.symbol}`}
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Opportunity Lifecycle Section (Sprint 2.0)
// Renders when at least two successful scans have been completed.
// Falls back gracefully to nothing when no prior scan exists.
// ---------------------------------------------------------------------------

function LifecycleSubsection({
  heading,
  icon: Icon,
  items,
  renderItem,
  emptyNote,
}: {
  heading: string;
  icon: React.ElementType;
  items: LifecycleItem[];
  renderItem: (item: LifecycleItem) => React.ReactNode;
  emptyNote?: string;
}) {
  if (items.length === 0 && !emptyNote) return null;
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {heading}
        {items.length > 0 && (
          <span className="ml-auto text-[10px] font-normal normal-case">{items.length}</span>
        )}
      </h3>
      {items.length > 0 ? (
        <div className="space-y-2">{items.map(renderItem)}</div>
      ) : emptyNote ? (
        <p className="text-xs text-muted-foreground py-1">{emptyNote}</p>
      ) : null}
    </div>
  );
}

function OpportunityLifecycleSection({
  changesData,
  isLoading,
  cachedSymbols,
}: {
  changesData: SnapshotComparison | undefined;
  isLoading: boolean;
  cachedSymbols: Set<string>;
}) {
  const [historySymbol, setHistorySymbol] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Don't render until we have comparison data with a previous scan
  if (isLoading) return null;
  if (!changesData?.hasPreviousScan) return null;

  const { newOpportunities, triggered, improving, weakening, removed, approaching, stillQualified, summary } =
    changesData;

  const noChanges =
    newOpportunities.length === 0 &&
    triggered.length === 0 &&
    improving.length === 0 &&
    weakening.length === 0 &&
    removed.length === 0 &&
    approaching.length === 0;

  const hasActivity = !noChanges;

  const renderQualified = (item: LifecycleItem) => (
    <LifecycleItemCard
      key={item.symbol}
      item={item}
      hasCachedResult={cachedSymbols.has(item.symbol.toUpperCase())}
      onOpenHistory={setHistorySymbol}
    />
  );

  const category = (key: string, heading: string, icon: React.ElementType, items: LifecycleItem[], render: (item: LifecycleItem) => React.ReactNode) => {
    if (!items.length) return null;
    const isOpen = !collapsed[key];
    const Icon = icon;
    return (
      <div className="border-b border-border/30 last:border-0">
        <button type="button" className="flex w-full items-center gap-2 py-2 text-left" onClick={() => setCollapsed((s) => ({ ...s, [key]: !s[key] }))} aria-expanded={isOpen}>
          <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="text-xs font-medium">{heading}</span>
          <Badge variant="outline" className="ml-auto text-[10px] border-border/40">{items.length}</Badge>
          {isOpen ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
        </button>
        {isOpen && <div className="space-y-1 pb-2">{items.map(render)}</div>}
      </div>
    );
  };

  const renderAbsent = (item: LifecycleItem) => (
    <AbsentLifecycleRow
      key={item.symbol}
      item={item}
      onOpenHistory={setHistorySymbol}
    />
  );

  return (
    <>
      <section
        aria-labelledby="lifecycle-heading"
        data-testid="section-opportunity-lifecycle"
      >
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                <Zap className="h-4 w-4 text-primary" aria-hidden="true" />
                <span id="lifecycle-heading">Opportunity Changes</span>
              </CardTitle>
              {summary.previousScanTime && (
                <span className="text-[10px] text-muted-foreground">
                  vs scan {new Date(summary.previousScanTime).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Lifecycle changes between the two most recent scans. Not a recommendation to buy or sell.
            </p>
          </CardHeader>

          <CardContent className="space-y-5">
            {noChanges ? (
              <p className="text-xs text-muted-foreground">
                No changes between the last two scans — all positions held their status.
              </p>
            ) : (
              <>
                <div className="divide-y divide-border/30">
                  {category("new", "New Today", Sparkles, newOpportunities, renderQualified)}
                  {category("improving", "Strengthening", TrendingUp, improving, renderQualified)}
                  {category("weakening", "Weakening", TrendingDown, weakening, renderQualified)}
                  {category("removed", "Dropped", TrendingDown, removed, renderAbsent)}
                  {category("triggered", "Triggered", Zap, triggered, renderAbsent)}
                  {category("approaching", "Approaching", ArrowRight, approaching, renderAbsent)}
                </div>

                {/* Stable positions (collapsed summary) */}
                {stillQualified.length > 0 && (
                  <div>
                    <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      Holding Position
                      <span className="ml-auto text-[10px] font-normal normal-case">
                        {stillQualified.length} unchanged
                      </span>
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {stillQualified.map((item) => (
                        <button
                          key={item.symbol}
                          className="font-mono text-xs px-2 py-1 rounded-md border border-border/50 bg-card/30 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                          onClick={() => setHistorySymbol(item.symbol)}
                          aria-label={`View history for ${item.symbol}`}
                          data-testid={`chip-stable-${item.symbol}`}
                        >
                          {item.symbol}
                          {item.rankCurrent != null && (
                            <span className="ml-1 opacity-60">#{item.rankCurrent}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Symbol history drawer */}
      <SymbolHistoryDrawer
        symbol={historySymbol}
        onClose={() => setHistorySymbol(null)}
      />
    </>
  );
}

function OpportunityEngineSection({
  data,
  isLoading,
  isError,
  onRetry,
  explainedChanges,
}: {
  data: OpportunityTodayResponse | undefined;
  isLoading: boolean;
  isError?: boolean;
  onRetry: () => void;
  explainedChanges?: ChangeIntelligenceReport;
}) {
  const [, navigate] = useLocation();
  const ranking = data?.ranking ?? null;

  // Batch cache check for candidate symbols from the ranking engine
  const allCandidates = ranking
    ? [...ranking.topGrowth, ...ranking.topIncome]
    : [];
  const symbolsKey = allCandidates.map((c) => c.symbol).join(",");

  const { data: cacheData } = useQuery<{ hits: string[] }>({
    queryKey: ["analysis-cache-batch-stocks", symbolsKey],
    queryFn: async () => {
      if (!symbolsKey) return { hits: [] };
      try {
        const res = await apiRequest(
          "GET",
          `/api/analysis/cached?symbols=${encodeURIComponent(symbolsKey)}`,
        );
        if (!res.ok) return { hits: [] };
        return res.json() as Promise<{ hits: string[] }>;
      } catch {
        return { hits: [] };
      }
    },
    enabled: !!symbolsKey,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
  const cachedSymbols = new Set<string>(
    (cacheData?.hits ?? []).map((s) => s.toUpperCase()),
  );

  const qualifiedCount = ranking
    ? ranking.topGrowth.length + ranking.topIncome.length
    : 0;

  return (
    <section
      aria-labelledby="opp-engine-heading"
      data-testid="section-opportunity-engine"
    >
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              <span id="opp-engine-heading" data-testid="text-opp-engine-heading">
                Today&rsquo;s Stock Opportunities
              </span>
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Market regime from ranking engine */}
              {ranking?.regime && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-border/60"
                  data-testid="badge-market-regime"
                >
                  {ranking.regime}
                </Badge>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate("/scanner")}
                className="text-xs gap-1"
                data-testid="btn-open-scanner"
                aria-label="Open scanner for more opportunities"
              >
                Scanner <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-muted-foreground">
              Stock setups ranked by Technical, Institutional, Fundamental and Risk signals.
              Not a recommendation to buy or sell.
            </p>
            <ScoreExplanationModal />
          </div>
          {/* Freshness row — uses ranking.generatedAt */}
          {ranking && (
            <div className="flex items-center gap-3 pt-0.5 flex-wrap">
              <span
                className="text-[10px] text-muted-foreground/70"
                data-testid="text-ranking-freshness"
              >
                Updated {formatRankingAge(ranking.generatedAt)}
              </span>
              <span className="text-[10px] text-muted-foreground/70">
                <span className="font-mono">{qualifiedCount}</span> ranked
              </span>
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Loading state */}
          {isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          )}

          {/* Error state */}
          {!isLoading && isError && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-5 text-center space-y-2">
              <div className="flex items-center justify-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span data-testid="text-opp-engine-error">
                  Could not load ranked opportunities.
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                The ranking engine may still be computing. Check back shortly.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-1 text-xs gap-1"
                onClick={onRetry}
                data-testid="btn-opp-engine-retry"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
              </Button>
            </div>
          )}

          {/* No ranking yet — scan hasn't completed or engine hasn't run */}
          {!isLoading && !isError && !ranking && (
            <div className="rounded-lg border bg-card/30 p-5 text-center space-y-2">
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span data-testid="text-no-scan-yet">
                  {data?.available === false && data.message
                    ? data.message
                    : "Opportunity Engine has not completed its first scan."}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                The engine runs automatically in the background. Check back in a few minutes.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-1 text-xs gap-1"
                onClick={onRetry}
                data-testid="btn-opp-engine-retry"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
              </Button>
            </div>
          )}

          {/* Ranking loaded — show categorised buckets */}
          {!isLoading && !isError && ranking && (
            <>
              {/* Top Growth */}
              <CandidateSubsection
                heading="Top Growth"
                candidates={ranking.topGrowth}
                cachedSymbols={cachedSymbols}
                emptyNote="No growth setups ranked in the current cycle."
              />

              {/* Top Income */}
              <CandidateSubsection
                heading="Top Income"
                candidates={ranking.topIncome}
                cachedSymbols={cachedSymbols}
                emptyNote="No income setups ranked in the current cycle."
              />

              {/* Top Watchlist */}
              <WatchCandidateList
                heading="Top Watchlist"
                icon={Clock}
                candidates={ranking.watchlist}
              />

              {/* Approaching Qualification */}
              <WatchCandidateList
                heading="Approaching Qualification"
                icon={ArrowRight}
                candidates={ranking.approaching}
              />

              {/* What Changed — enriched by Change Intelligence engine (Sprint 2.3.1) */}
              <EnrichedRankingChangesPanel
                report={explainedChanges}
                fallbackChanges={ranking.changes}
              />
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function OpportunityTimeline({
  ranking,
  changes,
}: {
  ranking?: OpportunityRanking | null;
  changes?: SnapshotComparison;
}) {
  if (!ranking) return null;
  const time = (value: string | null | undefined) =>
    value
      ? new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "—";
  const qualifiedCount = ranking.topGrowth.length + ranking.topIncome.length;
  const previousQualified = changes?.summary
    ? changes.summary.stillQualifiedCount + changes.summary.newCount
    : 0;
  return (
    <section aria-labelledby="timeline-heading" data-testid="section-opportunity-timeline">
      <Card className="border-border/40">
        <CardHeader className="px-4 py-2.5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[13px] font-medium flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-sky-300" />
              <span id="timeline-heading">Opportunity Timeline</span>
            </CardTitle>
            <span className="text-[10px] text-muted-foreground">Ranking history</span>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-3 pt-0">
          <div className="relative space-y-2">
            <div className="absolute left-[3px] top-2 bottom-2 w-px bg-border/60" />
            <div className="relative flex items-center gap-3 text-[10px]">
              <span className="h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-emerald-400/15" />
              <span className="w-24 font-medium">Latest Ranking</span>
              <span className="font-mono text-muted-foreground">{time(ranking.generatedAt)}</span>
              <Badge variant="outline" className="text-[10px] text-emerald-300 border-emerald-500/30">
                {qualifiedCount} ranked
              </Badge>
              {changes?.summary && (
                <span className="text-muted-foreground">
                  {changes.summary.newCount} new · {changes.summary.removedCount} dropped
                </span>
              )}
            </div>
            {changes?.hasPreviousScan ? (
              <div className="relative flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-sky-400" />
                <span className="w-24 font-medium">Previous Scan</span>
                <span className="font-mono">{time(changes.summary.previousScanTime)}</span>
                <Badge variant="outline" className="text-[10px] border-border/40">
                  {previousQualified} qualified
                </Badge>
              </div>
            ) : (
              <div className="pl-5 text-[10px] text-muted-foreground">First scan — no history yet</div>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5. AI Infrastructure Watch
// ---------------------------------------------------------------------------

const TREND_ICON: Record<string, React.ElementType> = {
  up:   TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

const TREND_CLASS: Record<string, string> = {
  up:   "text-emerald-400",
  down: "text-rose-400",
  flat: "text-muted-foreground",
};

const SENTIMENT_CHIP_CLASS: Record<string, string> = {
  bullish: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5",
  bearish: "text-rose-300 border-rose-500/30 bg-rose-500/5",
  neutral: "text-muted-foreground border-border bg-muted/10",
};

const SENTIMENT_SHORT: Record<string, string> = {
  bullish: "Positive",
  bearish: "Bearish",
  neutral: "Neutral",
};

function TechScoreBar({ score }: { score: number }) {
  const color =
    score >= 70 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-14 rounded-full bg-muted/50 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">{score}</span>
    </div>
  );
}

function AiInfraWatchSection({
  status,
  tickers,
  onRetry,
}: {
  status: string;
  tickers?: AiInfraTicker[];
  onRetry: () => void;
}) {
  const [, navigate] = useLocation();

  return (
    <section aria-labelledby="ai-infra-heading" data-testid="section-ai-infra-watch">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Cpu className="h-4 w-4 text-violet-400" aria-hidden="true" />
              <span id="ai-infra-heading">AI Infrastructure Watch</span>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={cn("text-[10px]", DATA_QUALITY_CLASS.DAILY_CLOSE)}
                data-testid="badge-ai-infra-data"
              >
                {DATA_QUALITY.DAILY_CLOSE}
              </Badge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Core AI semiconductor and networking stocks — trend vs EMA21, news sentiment, technical score.
            Not investment advice.
          </p>
        </CardHeader>
        <CardContent>
          {status === "unavailable" ? (
            <SectionError label="AI infrastructure" onRetry={onRetry} />
          ) : (
            <div className="space-y-1" role="list" aria-label="AI infrastructure tickers" data-testid="list-ai-infra">
              {/* Header row */}
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                <span>Ticker</span>
                <span className="w-16 text-right">Price</span>
                <span className="w-14 text-center">Trend</span>
                <span className="w-16 text-center">Sentiment</span>
                <span className="w-20 text-center">Tech Score</span>
              </div>

              {(tickers ?? []).map((t) => {
                const TrendIcon = TREND_ICON[t.trend] ?? Minus;
                return (
                  <div
                    key={t.symbol}
                    className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2 rounded-lg border bg-card/50 px-2 py-2"
                    role="listitem"
                    data-testid={`ai-infra-${t.symbol}`}
                    aria-label={`${t.symbol}: trend ${t.trend}, sentiment ${t.sentiment}, score ${t.technicalScore}`}
                  >
                    {/* Ticker + company */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-xs">{t.symbol}</span>
                        <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">
                          {t.companyName}
                        </span>
                      </div>
                      {t.changePercent !== null && (
                        <span
                          className={cn(
                            "text-[10px] tabular-nums",
                            t.changePercent >= 0 ? "text-emerald-400" : "text-rose-400",
                          )}
                        >
                          {t.changePercent >= 0 ? "+" : ""}{t.changePercent.toFixed(2)}%
                        </span>
                      )}
                    </div>

                    {/* Price */}
                    <div className="w-16 text-right">
                      {t.last !== null ? (
                        <span className="text-xs tabular-nums font-medium">
                          ${t.last.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </div>

                    {/* Trend */}
                    <div className="w-14 flex justify-center">
                      <span
                        className={cn("flex items-center gap-0.5 text-xs", TREND_CLASS[t.trend])}
                        title={t.trendLabel}
                        aria-label={`Trend: ${t.trend} — ${t.trendLabel}`}
                      >
                        <TrendIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    </div>

                    {/* Sentiment */}
                    <div className="w-16 flex justify-center">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] px-1.5", SENTIMENT_CHIP_CLASS[t.sentiment])}
                        data-testid={`sentiment-${t.symbol}`}
                        aria-label={`Sentiment: ${t.sentiment}`}
                      >
                        {SENTIMENT_SHORT[t.sentiment]}
                      </Badge>
                    </div>

                    {/* Technical Score + Ask AI */}
                    <div className="w-20 flex items-center justify-between gap-1">
                      <TechScoreBar score={t.technicalScore} />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] px-1.5 shrink-0"
                        onClick={() => navigate(askRoute(`Analyze ${t.symbol}`))}
                        aria-label={`Ask AI about ${t.symbol}`}
                        data-testid={`btn-ask-ai-${t.symbol}`}
                      >
                        Ask <Sparkles className="h-2.5 w-2.5 ml-0.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 6. Portfolio Intelligence (Connect Broker gate — intentional)
// ---------------------------------------------------------------------------

function PortfolioSection({
  brokerConnected,
  status,
  positions,
  onRetry,
}: {
  brokerConnected: boolean;
  status: string;
  positions?: Position[];
  onRetry: () => void;
}) {
  const [, navigate] = useLocation();

  const totalPnl = (positions ?? []).reduce((sum, p) => sum + (p.unrealizedPnl ?? 0), 0);
  const positionCount = (positions ?? []).length;
  const largestConcentration = (positions ?? [])
    .filter((p) => (p.marketPrice ?? 0) > 0 && p.qty > 0)
    .sort((a, b) => (b.marketPrice ?? 0) * b.qty - (a.marketPrice ?? 0) * a.qty)[0];

  return (
    <section aria-labelledby="portfolio-heading" data-testid="section-portfolio">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Wallet className="h-4 w-4 text-primary" aria-hidden="true" />
            <span id="portfolio-heading">Portfolio Intelligence</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!brokerConnected ? (
            <div className="space-y-3" data-testid="text-portfolio-not-connected">
              <p className="text-sm text-muted-foreground">
                Connect a supported broker to view portfolio context, concentration and buying-power observations.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  track("dashboard_connect_broker_clicked" as any);
                  navigate("/settings?tab=broker");
                }}
                data-testid="btn-connect-broker"
                aria-label="Connect a broker"
              >
                Connect Broker
              </Button>
            </div>
          ) : status === "unavailable" ? (
            <SectionError label="Portfolio" onRetry={onRetry} />
          ) : (
            <div className="space-y-3" data-testid="container-portfolio-data">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border bg-card/50 p-2.5" data-testid="tile-position-count">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Open positions</div>
                  <div className="text-lg font-semibold tabular-nums mt-0.5">{positionCount}</div>
                </div>
                <div className="rounded-lg border bg-card/50 p-2.5" data-testid="tile-unrealized-pnl">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Unrealized P/L</div>
                  <div
                    className={cn(
                      "text-lg font-semibold tabular-nums mt-0.5",
                      totalPnl >= 0 ? "text-emerald-400" : "text-rose-400",
                    )}
                  >
                    {totalPnl >= 0 ? "+" : ""}${Math.abs(totalPnl).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </div>
                </div>
              </div>
              {largestConcentration && (
                <div className="text-xs text-muted-foreground" data-testid="text-largest-concentration">
                  <span className="font-medium text-foreground/80">Largest position:</span>{" "}
                  <span className="font-mono">{largestConcentration.symbol}</span> — review concentration before adding exposure.
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs gap-1"
                  onClick={() => navigate(askRoute("Analyze my portfolio exposure and concentration"))}
                  data-testid="btn-ask-portfolio"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Ask AI about Portfolio
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs gap-1"
                  onClick={() => navigate("/settings?tab=broker")}
                  data-testid="btn-broker-settings"
                >
                  Broker Settings <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug">
                Portfolio context is informational only. VCP Trader AI does not advise on rebalancing, buying, or selling.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 7. Watchlist Activity
// ---------------------------------------------------------------------------

function WatchlistSection({
  status,
  items,
  onRetry,
}: {
  status: string;
  items?: Watchlist[];
  onRetry: () => void;
}) {
  const [, navigate] = useLocation();

  if (status === "unavailable") {
    return (
      <section aria-labelledby="watchlist-heading" data-testid="section-watchlist">
        <h2 id="watchlist-heading" className="sr-only">Watchlist Activity</h2>
        <SectionError label="Watchlist" onRetry={onRetry} />
      </section>
    );
  }

  const hasWatchlists = (items?.length ?? 0) > 0;

  return (
    <section aria-labelledby="watchlist-heading" data-testid="section-watchlist">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Star className="h-4 w-4 text-primary" aria-hidden="true" />
              <span id="watchlist-heading">Watchlist Activity</span>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {!hasWatchlists ? (
            <div className="space-y-3 py-2" data-testid="text-no-watchlists">
              <p className="text-sm text-muted-foreground">
                Track symbols you&rsquo;re monitoring. Watchlists surface relevant opportunities and alerts.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => navigate("/scanner")}
                data-testid="btn-create-watchlist"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Create Watchlist
              </Button>
            </div>
          ) : (
            <div className="space-y-2" role="list" aria-label="Your watchlists">
              {items!.slice(0, 5).map((wl) => (
                <div
                  key={wl.id}
                  className="flex items-center justify-between rounded-lg border bg-card/50 px-3 py-2"
                  role="listitem"
                  data-testid={`watchlist-${wl.id}`}
                >
                  <div>
                    <div className="text-sm font-medium">{wl.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {wl.symbols.length} symbol{wl.symbols.length !== 1 ? "s" : ""}
                      {wl.symbols.length > 0 && (
                        <span className="ml-1 font-mono">
                          {wl.symbols.slice(0, 4).join(", ")}{wl.symbols.length > 4 ? "…" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1"
                    onClick={() => navigate(`/scanner?watchlist=${wl.id}`)}
                  >
                    Scan <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 8. Growth Watch — sentiment-driven, no hardcoded fallback
// ---------------------------------------------------------------------------

function GrowthWatchSection({
  snapshot,
  status,
  onRetry,
}: {
  snapshot?: MarketSnapshot;
  status: string;
  onRetry: () => void;
}) {
  const [, navigate] = useLocation();

  // Only show when we have real sentiment-driven topGrowth
  if (status === "unavailable" || !snapshot) {
    return (
      <section aria-labelledby="growth-watch-heading" data-testid="section-growth-watch">
        <h2 id="growth-watch-heading" className="sr-only">Growth Watch</h2>
        <SectionError label="Growth watch" onRetry={onRetry} />
      </section>
    );
  }

  const { topGrowth, growthSource } = snapshot;

  // Only render when real sentiment data is available
  if (!topGrowth || growthSource !== "sentiment") return null;

  return (
    <section aria-labelledby="growth-watch-heading" data-testid="section-growth-watch">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            <span id="growth-watch-heading">Growth Watch</span>
          </CardTitle>
          <Badge
            variant="outline"
            className={cn("text-[10px] w-fit", DATA_QUALITY_CLASS.SNAPSHOT)}
            data-testid="badge-growth-source"
          >
            News-sentiment context
          </Badge>
        </CardHeader>
        <CardContent className="space-y-2" data-testid="card-growth">
          <div className="font-mono font-semibold text-base">{topGrowth.symbol}</div>
          <p className="text-xs text-muted-foreground leading-snug" data-testid="text-growth-headline">
            {topGrowth.symbol} is receiving elevated positive news attention. Run a full analysis to evaluate technical and long-term conditions.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="text-xs gap-1 h-7"
            onClick={() => navigate(askRoute(`Analyze ${topGrowth.symbol} for long-term growth potential`))}
            data-testid={`btn-analyze-growth-${topGrowth.symbol}`}
          >
            Run Full Analysis <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 9. Saved Research
// ---------------------------------------------------------------------------

function SavedResearchSection({
  status,
  records,
  onRetry,
}: {
  status: string;
  records?: ResearchRecord[];
  onRetry: () => void;
}) {
  const [, navigate] = useLocation();

  return (
    <section aria-labelledby="research-heading" data-testid="section-saved-research">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <BookOpen className="h-4 w-4 text-primary" aria-hidden="true" />
              <span id="research-heading">Saved Research</span>
            </CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate("/research")}
              className="text-xs gap-1"
              data-testid="btn-open-research-library"
            >
              Library <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {status === "unavailable" ? (
            <SectionError label="Saved research" onRetry={onRetry} />
          ) : (records?.length ?? 0) === 0 ? (
            <div className="space-y-2 py-2" data-testid="text-no-research">
              <p className="text-sm text-muted-foreground">
                Run an analysis and choose <strong>Save Research</strong> to preserve an immutable evidence snapshot.
              </p>
              <Button size="sm" variant="outline" onClick={() => navigate("/ask")} data-testid="btn-start-research">
                Start Research
              </Button>
            </div>
          ) : (
            <div className="space-y-2" role="list" aria-label="Saved research records">
              {(records ?? []).map((r) => (
                <div
                  key={r.id}
                  className="flex items-start justify-between gap-3 rounded-lg border bg-card/50 px-3 py-2.5"
                  role="listitem"
                  data-testid={`research-record-${r.id}`}
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {r.symbol && (
                        <span className="font-mono text-xs font-semibold">{r.symbol}</span>
                      )}
                      <span className="text-sm font-medium truncate max-w-[200px]">{r.title}</span>
                    </div>
                    {r.verdict && (
                      <p className="text-xs text-muted-foreground truncate">{r.verdict}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground">{formatRelativeTime(r.generatedAt)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1 shrink-0"
                    onClick={() => {
                      track("dashboard_research_opened" as any);
                      navigate(`/research/${r.id}`);
                    }}
                    data-testid={`btn-open-research-${r.id}`}
                  >
                    Open <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 10. Market Events (topNews)
// ---------------------------------------------------------------------------

function MarketEventsSection({
  status,
  news,
  onRetry,
}: {
  status: string;
  news?: NewsItem[];
  onRetry: () => void;
}) {
  const [, navigate] = useLocation();

  if (status === "unavailable" || !news || news.length === 0) {
    if (status === "unavailable") {
      return (
        <section aria-labelledby="events-heading" data-testid="section-market-events">
          <h2 id="events-heading" className="sr-only">Market Events</h2>
          <SectionError label="Market events" onRetry={onRetry} />
        </section>
      );
    }
    return null;
  }

  return (
    <section aria-labelledby="events-heading" data-testid="section-market-events">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Newspaper className="h-4 w-4 text-primary" aria-hidden="true" />
            <span id="events-heading">Market Events &amp; News Context</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">Recent news attention and sentiment context. This does not indicate that a setup qualifies.</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2" role="list" aria-label="Market news context" data-testid="list-market-events">
            {news.slice(0, 5).map((item, i) => (
              <div
                key={`${item.symbol}-${i}`}
                className="flex items-start gap-3 rounded-lg border bg-card/50 px-3 py-2.5"
                role="listitem"
                data-testid={`event-${item.symbol}-${i}`}
              >
                <Badge
                  variant="outline"
                  className={cn("text-[10px] shrink-0 whitespace-nowrap", IMPACT_CLASS[item.impact])}
                >
                  {IMPACT_LABEL[item.impact] ?? item.impact}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono font-semibold text-xs">{item.symbol}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        item.label === "bullish"
                          ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5"
                          : item.label === "bearish"
                          ? "text-rose-400 border-rose-500/30 bg-rose-500/5"
                          : "text-muted-foreground border-border",
                      )}
                    >
                      {SENTIMENT_LABEL[item.label] ?? item.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug mt-0.5">{item.whyItMatters}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs shrink-0 px-1.5"
                  onClick={() => navigate(askRoute(`What's happening with ${item.symbol}?`))}
                >
                  Ask <Sparkles className="h-3 w-3 ml-0.5" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 11. Ask AI Panel
// ---------------------------------------------------------------------------

const SUGGESTED_PROMPTS = [
  "Find long-term AI infrastructure opportunities",
  "Show bullish swing setups",
  "Find income ideas under $500 risk",
  "Analyze my portfolio exposure",
  "Compare growth and income opportunities",
  "Explain the current market regime",
];

function AskAISection() {
  const [, navigate] = useLocation();

  return (
    <section aria-labelledby="ask-ai-heading" data-testid="section-ask-ai">
      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            <span id="ask-ai-heading">What would you like to explore today?</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Ask anything about stocks, options, market conditions, or your portfolio.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4" role="list">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                role="listitem"
                className="text-left rounded-lg border bg-card/50 px-3 py-2.5 text-xs font-medium transition-colors hover:bg-accent/40 hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => navigate(askRoute(prompt))}
                data-testid={`btn-prompt-${prompt.slice(0, 20).replace(/\s/g, "-").toLowerCase()}`}
              >
                {prompt}
              </button>
            ))}
          </div>
          <Button onClick={() => navigate("/ask")} className="gap-2" data-testid="btn-open-ask">
            <Sparkles className="h-4 w-4" aria-hidden="true" /> Open Ask AI
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Loading skeletons
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-label="Loading dashboard…" aria-busy="true" data-testid="dashboard-skeleton">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-20 w-full" />
      <div className="grid grid-cols-4 gap-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-64 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main DashboardPage
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { user } = useAuth();
  const firstName = user?.firstName ?? "";

  const dashboardQuery = useQuery<DashboardResponse>({
    queryKey: ["/api/dashboard"],
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

  // Opportunity Ranking Engine — fetched independently so the dashboard doesn't block
  // on the scanner. Returns composite-scored candidates from /api/opportunities/today.
  // Refreshes every 10 minutes; the ranking engine itself runs after each scanner cycle.
  const oppsQuery = useQuery<OpportunityTodayResponse>({
    queryKey: ["/api/opportunities/today"],
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Lifecycle changes — Sprint 2.0. Returns a diff between the two most recent
  // valid scans. Empty diff returned when fewer than two scans exist.
  const changesQuery = useQuery<SnapshotComparison>({
    queryKey: ["/api/opportunities/changes"],
    staleTime: 5 * 60_000,
    refetchInterval: 12 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Change Intelligence — Sprint 2.3.1. Explains WHY each opportunity changed
  // using the deterministic change engine. Non-blocking; dashboard still loads
  // without it. Shares stale time with the ranking engine.
  const explainedChangesQuery = useQuery<ChangeIntelligenceReport>({
    queryKey: ["/api/opportunities/changes/explained"],
    staleTime: 5 * 60_000,
    refetchInterval: 12 * 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    track("dashboard_viewed" as any);
  }, []);

  if (dashboardQuery.isLoading) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="w-full max-w-6xl mx-auto px-4 md:px-8 py-5 md:py-6 space-y-5">
          <TrialBanner />
          <DashboardSkeleton />
        </div>
      </div>
    );
  }

  if (dashboardQuery.isError) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="w-full max-w-6xl mx-auto px-4 md:px-8 py-8">
          <TrialBanner />
          <Card className="border-destructive/30 bg-destructive/5 mt-4">
            <CardContent className="p-6 flex items-start gap-3 text-sm">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">Dashboard data is temporarily unavailable.</p>
                <p className="text-muted-foreground mt-1">
                  Individual features — Ask AI, Research Library, Scanner — remain available via the navigation.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 gap-1.5"
                  onClick={() => dashboardQuery.refetch()}
                  data-testid="btn-dashboard-retry"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const data = dashboardQuery.data!;
  const snapshot = data.marketSnapshot.status === "ok" ? data.marketSnapshot.data : undefined;
  const records = data.savedResearch.status === "ok" ? data.savedResearch.records : undefined;
  const watchlists = data.watchlists.status === "ok" ? data.watchlists.items : undefined;
  const aiInfra = data.aiInfraWatch;

  return (
    <div className="flex-1 overflow-auto">
      <div
        className="w-full max-w-6xl mx-auto px-4 md:px-8 py-5 md:py-6 space-y-5"
        data-testid="dashboard-page"
      >
        <TrialBanner />

        <MarketCommandBar snapshot={snapshot} brokerConnected={data.portfolio.brokerConnected} />
        <MorningHeaderSection firstName={firstName} />

        {/* 2. Quick Actions */}
        <QuickActionsSection />

        {/* 3. Market Snapshot — real data, VIX, regime, sectors */}
        <MarketSnapshotSection
          data={snapshot}
          status={data.marketSnapshot.status}
          onRetry={() => {
            track("dashboard_section_retry", { section: "market_snapshot" } as any);
            dashboardQuery.refetch();
          }}
        />

        {/* 4. Today's Stock Opportunities — ranked by Opportunity Ranking Engine */}
        <OpportunityEngineSection
          data={oppsQuery.data}
          isLoading={oppsQuery.isLoading}
          isError={oppsQuery.isError}
          onRetry={() => {
            track("dashboard_section_retry", { section: "stock_opportunities" } as any);
            void oppsQuery.refetch();
          }}
          explainedChanges={explainedChangesQuery.data}
        />

        {/* 4b. Opportunity Lifecycle Changes — Sprint 2.0
              Appears only after the second successful scan has completed.
              Falls back silently when no history is available. */}
        <OpportunityLifecycleSection
          changesData={changesQuery.data}
          isLoading={changesQuery.isLoading}
          cachedSymbols={new Set<string>()} /* batch cache check omitted here — Analyze navigates directly */
        />

        <OpportunityTimeline ranking={oppsQuery.data?.ranking} changes={changesQuery.data} />

        {/* 5. AI Infrastructure Watch */}
        <AiInfraWatchSection
          status={aiInfra.status}
          tickers={aiInfra.status === "ok" ? aiInfra.tickers : undefined}
          onRetry={() => {
            track("dashboard_section_retry", { section: "ai_infra" } as any);
            dashboardQuery.refetch();
          }}
        />

        {/* 6 + 7: Portfolio & Watchlist — two-column on large screens */}
        <div className="grid gap-4 lg:grid-cols-2">
          <PortfolioSection
            brokerConnected={data.portfolio.brokerConnected}
            status={data.portfolio.status}
            positions={data.portfolio.positions}
            onRetry={() => {
              track("dashboard_section_retry", { section: "portfolio" } as any);
              dashboardQuery.refetch();
            }}
          />
          <WatchlistSection
            status={data.watchlists.status}
            items={watchlists}
            onRetry={() => {
              track("dashboard_section_retry", { section: "watchlist" } as any);
              dashboardQuery.refetch();
            }}
          />
        </div>

        {/* 8. Growth Watch — sentiment-driven only, no hardcoded fallback */}
        <GrowthWatchSection
          snapshot={snapshot}
          status={data.marketSnapshot.status}
          onRetry={() => dashboardQuery.refetch()}
        />

        {/* 9. Saved Research */}
        <SavedResearchSection
          status={data.savedResearch.status}
          records={records}
          onRetry={() => {
            track("dashboard_section_retry", { section: "saved_research" } as any);
            dashboardQuery.refetch();
          }}
        />

        {/* 10. Market Events */}
        <MarketEventsSection
          status={data.marketSnapshot.status}
          news={snapshot?.topNews}
          onRetry={() => dashboardQuery.refetch()}
        />

        {/* 11. Ask AI Panel */}
        <AskAISection />

        {/* Compliance footer */}
        <p className="text-xs text-muted-foreground pt-4 border-t leading-relaxed" data-testid="text-dashboard-disclaimer">
          VCP Trader AI surfaces market data and AI-generated analysis for educational purposes only.
          Nothing on this dashboard constitutes investment advice or a recommendation to buy, sell, or hold any security.
          Market data is provided by Twelve Data (latest daily close). Always confirm information with your own broker before acting.
        </p>
      </div>
    </div>
  );
}
