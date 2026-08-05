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

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { getMarketSessionInfo } from "@shared/market-session";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";

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

interface RadarCandidate {
  id?: string;
  rank?: number;
  symbol: string;
  companyName?: string;
  strategyType: string;
  bias?: string;
  finalGrade?: string;
  finalScore?: number;
  thesis?: string;
  mainReason?: string;
  mainRisk?: string;
  entry?: number;
  dataMode?: string;
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

interface OpportunitiesBlock {
  status: "ok" | "unavailable";
  candidates?: RadarCandidate[];
  dataMode?: string;
}

interface DashboardResponse {
  marketSnapshot: { status: "ok"; data: MarketSnapshot } | { status: "unavailable" };
  growthOpportunities: OpportunitiesBlock;
  incomeOpportunities: OpportunitiesBlock;
  watchlistOpportunities: OpportunitiesBlock;
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

// ---------------------------------------------------------------------------
// 2. Quick Actions
// ---------------------------------------------------------------------------

const QUICK_ACTIONS = [
  {
    id: "growth",
    label: "Find Growth Opportunities",
    icon: TrendingUp,
    color: "text-emerald-400",
    href: askRoute("Find long-term AI infrastructure growth opportunities"),
  },
  {
    id: "income",
    label: "Find Income Opportunities",
    icon: DollarSign,
    color: "text-amber-400",
    href: askRoute("Find income opportunities with covered calls or cash-secured puts under $500 risk"),
  },
  {
    id: "trade",
    label: "Find Trade Setups",
    icon: Target,
    color: "text-sky-400",
    href: "/scanner",
  },
  {
    id: "analyze",
    label: "Analyze a Stock",
    icon: Search,
    color: "text-violet-400",
    href: "/ask",
  },
  {
    id: "portfolio",
    label: "Review My Portfolio",
    icon: Wallet,
    color: "text-primary",
    href: askRoute("Analyze my portfolio exposure and concentration"),
  },
  {
    id: "research",
    label: "Continue Saved Research",
    icon: BookOpen,
    color: "text-rose-400",
    href: "/research",
  },
  {
    id: "markets",
    label: "Understand Markets",
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
// 4. Today's Market Opportunities — Growth / Income / Watchlist Movers
// ---------------------------------------------------------------------------

function OpportunityCard({
  candidate,
  hasCachedResult,
}: {
  candidate: RadarCandidate;
  hasCachedResult?: boolean;
}) {
  const [, navigate] = useLocation();
  const grade = candidate.finalGrade;
  const ctaText = hasCachedResult ? "Open Analysis" : "Analyze";

  return (
    <div
      className="rounded-lg border bg-card/50 p-3 space-y-2"
      data-testid={`card-opportunity-${candidate.symbol}`}
      role="article"
      aria-label={`${candidate.symbol} opportunity`}
    >
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <span className="font-mono font-semibold text-sm" data-testid={`symbol-${candidate.symbol}`}>
          {candidate.symbol}
        </span>
        {candidate.companyName && (
          <span className="text-xs text-muted-foreground truncate max-w-[120px]">
            {candidate.companyName}
          </span>
        )}
        {grade && (
          <Badge
            variant="outline"
            className={cn("text-[10px]", GRADE_CLASS[grade] ?? "border-border")}
            data-testid={`grade-${candidate.symbol}`}
            aria-label={`Grade: ${grade}`}
          >
            Grade {grade}
          </Badge>
        )}
      </div>
      {candidate.strategyType && (
        <div className="text-xs text-muted-foreground capitalize">
          {candidate.strategyType.replace(/_/g, " ")}
          {candidate.bias && ` · ${candidate.bias}`}
        </div>
      )}
      {candidate.mainReason && (
        <p className="text-xs leading-snug line-clamp-2" data-testid={`reason-${candidate.symbol}`}>
          {candidate.mainReason}
        </p>
      )}
      <div className="pt-0.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={() => {
            if (hasCachedResult) {
              track("dashboard_existing_result_opened", { symbol: candidate.symbol } as any);
            } else {
              track("dashboard_full_analysis_requested", { symbol: candidate.symbol, grade } as any);
            }
            track("dashboard_opportunity_opened", { symbol: candidate.symbol, grade } as any);
            navigate(askRoute(`Analyze ${candidate.symbol}`));
          }}
          data-testid={`btn-open-analysis-${candidate.symbol}`}
          aria-label={`${ctaText} for ${candidate.symbol}`}
        >
          {ctaText} <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function OpportunitySubSection({
  title,
  icon: Icon,
  status,
  candidates,
  emptyMessage,
  onRetry,
}: {
  title: string;
  icon: React.ElementType;
  status: "ok" | "unavailable";
  candidates?: RadarCandidate[];
  emptyMessage: string;
  onRetry: () => void;
}) {
  const [, navigate] = useLocation();

  // Batch cache check for this sub-section's symbols
  const symbolsKey = (candidates ?? []).map((c) => c.symbol).join(",");
  const { data: cacheData } = useQuery<{ hits: string[] }>({
    queryKey: ["analysis-cache-batch", symbolsKey],
    queryFn: async () => {
      if (!symbolsKey) return { hits: [] };
      try {
        const res = await apiRequest("GET", `/api/analysis/cached?symbols=${encodeURIComponent(symbolsKey)}`);
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
  const cachedSymbols = new Set<string>((cacheData?.hits ?? []).map((s) => s.toUpperCase()));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground uppercase tracking-wide">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {title}
        </h3>
      </div>
      {status === "unavailable" ? (
        <SectionError label={title} onRetry={onRetry} />
      ) : (candidates?.length ?? 0) === 0 ? (
        <div className="rounded-lg border bg-card/30 px-3 py-4 text-center">
          <p className="text-xs text-muted-foreground">{emptyMessage}</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 text-xs"
            onClick={() => navigate("/scanner")}
          >
            Open Scanner
          </Button>
        </div>
      ) : (
        <div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          role="list"
          aria-label={`${title} candidates`}
        >
          {(candidates ?? []).slice(0, 5).map((c) => (
            <OpportunityCard
              key={c.id ?? `${c.symbol}-${c.rank}`}
              candidate={c}
              hasCachedResult={cachedSymbols.has(c.symbol.toUpperCase())}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TodaysOpportunitiesSection({
  growth,
  income,
  watchlist,
  onRetry,
}: {
  growth: OpportunitiesBlock;
  income: OpportunitiesBlock;
  watchlist: OpportunitiesBlock;
  onRetry: () => void;
}) {
  const [, navigate] = useLocation();

  return (
    <section aria-labelledby="opportunities-heading" data-testid="section-opportunities">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              <span id="opportunities-heading" data-testid="text-opportunities-heading">
                Today&rsquo;s Market Opportunities
              </span>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={cn("text-[10px]", DATA_QUALITY_CLASS.REAL_DATA)}
                data-testid="badge-opportunities-real-data"
              >
                {DATA_QUALITY.REAL_DATA}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate("/scanner")}
                className="text-xs gap-1"
                data-testid="btn-open-radar"
                aria-label="Open scanner for more opportunities"
              >
                View All <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Candidates from current market data, ranked by score. Not a recommendation to buy or sell.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <OpportunitySubSection
            title="Today's Growth Opportunities"
            icon={TrendingUp}
            status={growth.status}
            candidates={growth.candidates}
            emptyMessage="No growth candidates meet qualification criteria right now."
            onRetry={onRetry}
          />
          <div className="border-t border-border/40 pt-5">
            <OpportunitySubSection
              title="Today's Income Opportunities"
              icon={DollarSign}
              status={income.status}
              candidates={income.candidates}
              emptyMessage="No income candidates meet qualification criteria right now."
              onRetry={onRetry}
            />
          </div>
          <div className="border-t border-border/40 pt-5">
            <OpportunitySubSection
              title="Today's Watchlist Movers"
              icon={Star}
              status={watchlist.status}
              candidates={watchlist.candidates}
              emptyMessage="No watchlist candidates qualify right now. Add symbols to a watchlist to see movers."
              onRetry={onRetry}
            />
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

        {/* 1. Morning Header */}
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

        {/* 4. Today's Market Opportunities — Growth / Income / Watchlist */}
        <TodaysOpportunitiesSection
          growth={data.growthOpportunities}
          income={data.incomeOpportunities}
          watchlist={data.watchlistOpportunities}
          onRetry={() => {
            track("dashboard_section_retry", { section: "opportunities" } as any);
            dashboardQuery.refetch();
          }}
        />

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
