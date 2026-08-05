// Sprint 5.5 — Personalized Morning Dashboard (/dashboard)
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
//   - No fabricated data — missing fields show "Data currently unavailable".
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
  marketTone: "bullish" | "mixed" | "defensive";
  marketToneReason: string;
  indices: IndexQuote[];
  topMovers: MoverQuote[];
  topNews: NewsItem[];
  bestIncome: SnapshotItem;
  topGrowth: SnapshotItem;
  /** "live" | "simulated" — legacy field; use dataSource for UI labels. */
  dataMode: "live" | "simulated";
  /** Precise provenance of index/mover prices. */
  dataSource?: "broker" | "twelve_data" | "fallback";
  /** Source of topGrowth: sentiment-based or hardcoded reference. */
  growthSource?: "sentiment" | "fallback";
  /** Source of bestIncome: always "fallback" (hardcoded reference). */
  incomeSource?: "fallback";
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
  opportunities: { status: "ok"; candidates: RadarCandidate[]; dataMode?: string } | { status: "unavailable" };
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
// Unified data-quality label system (Sprint 5.5A)
// Use DATA_QUALITY[key] for user-facing text; DATA_QUALITY_CLASS[key] for styling.
// Never expose raw enum values in the UI.
// ---------------------------------------------------------------------------

const DATA_QUALITY = {
  LIVE:             "Live",
  BROKER_CONNECTED: "Broker data",
  DAILY_CLOSE:      "Latest daily close",
  DELAYED:          "Delayed",
  SNAPSHOT:         "Market snapshot",
  SIMULATED:        "Demonstration data",
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
  SIMULATED:        "text-violet-300 border-violet-500/30 bg-violet-500/5",
  ESTIMATED:        "text-amber-300 border-amber-500/30 bg-amber-500/5",
  UNAVAILABLE:      "text-rose-300 border-rose-500/30 bg-rose-500/5",
  UNKNOWN:          "text-muted-foreground border-border bg-muted/10",
};

/** Map the snapshot's dataSource field to a DATA_QUALITY key. */
function snapshotDataQualityKey(dataSource?: "broker" | "twelve_data" | "fallback"): DataQualityKey {
  if (dataSource === "broker") return "BROKER_CONNECTED";
  if (dataSource === "twelve_data") return "DAILY_CLOSE";
  return "SIMULATED";
}

const TONE_CLASS: Record<string, string> = {
  bullish: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  mixed: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  defensive: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

// Sprint 5.5A: impact badges now have explicit meaning labels (not just "high", "medium", "low")
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

// Sentiment label (separate from impact — appears alongside the symbol line)
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
      <span data-testid={`error-${label}`}>{label} data is temporarily unavailable.</span>
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
    prompt: "Find long-term growth opportunities",
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
// 3. Market Snapshot
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
  if (status === "unavailable" || !data) {
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

  return (
    <section aria-labelledby="snapshot-heading" data-testid="section-market-snapshot">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <BarChart2 className="h-4 w-4 text-primary" aria-hidden="true" />
              <span id="snapshot-heading">Market Snapshot</span>
            </CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {/* Sprint 5.5A: use dataSource for accurate label — never call daily-close data "Live" */}
              {(() => {
                const qKey = snapshotDataQualityKey(data.dataSource);
                return (
                  <Badge
                    variant="outline"
                    className={cn("text-[10px]", DATA_QUALITY_CLASS[qKey])}
                    data-testid="badge-data-mode"
                    aria-label={`Data quality: ${DATA_QUALITY[qKey]}`}
                  >
                    {DATA_QUALITY[qKey]}
                  </Badge>
                );
              })()}
              <span className="flex items-center gap-1" data-testid="text-snapshot-time">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {asOf}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Tone</span>
            <Badge
              variant="outline"
              className={cn("capitalize text-[10px]", TONE_CLASS[data.marketTone])}
              data-testid="badge-market-tone"
            >
              {data.marketTone}
            </Badge>
            <span className="text-xs text-muted-foreground line-clamp-1" data-testid="text-tone-reason">
              {data.marketToneReason}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Index tiles */}
          <div className="grid grid-cols-3 gap-2" role="list" aria-label="Index quotes">
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
                        aria-label={`${up ? "up" : "down"} ${Math.abs(idx.changePercent).toFixed(2)} percent`}
                      >
                        {up ? <TrendingUp className="h-3 w-3" aria-hidden="true" /> : <TrendingDown className="h-3 w-3" aria-hidden="true" />}
                        {up ? "+" : ""}{idx.changePercent.toFixed(2)}%
                      </span>
                    )}
                    {!hasData && (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Top movers (if any) */}
          {data.topMovers.length > 0 && (
            <div className="space-y-1" aria-label="Top movers">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Movers</div>
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

          {data.indices.every((i) => i.last === 0) && data.topMovers.length === 0 && (
            <p className="text-xs text-muted-foreground" data-testid="text-snapshot-unavailable">
              Data currently unavailable — market may be closed or data source unreachable.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4. Today's Opportunities
// ---------------------------------------------------------------------------

/**
 * Sprint 5.5B — CTA label for an opportunity card.
 * "Open Analysis"     → an existing full result is cached for this symbol
 * "Run Full Analysis" → no cached result; fresh run needed
 * "Open Example"      → demonstration card (no live analysis available)
 */
function opportunityCta(isDemonstration: boolean, hasCachedResult: boolean): string {
  if (isDemonstration) return "Open Example";
  if (hasCachedResult) return "Open Analysis";
  return "Run Full Analysis";
}

function OpportunityCard({
  candidate,
  sectionDataMode,
  hasCachedResult,
}: {
  candidate: RadarCandidate;
  /** The parent section's overall dataMode. When "simulated", suppress per-card badge. */
  sectionDataMode?: string;
  /** Sprint 5.5B: true when a cached full-analysis result exists for this symbol. */
  hasCachedResult?: boolean;
}) {
  const [, navigate] = useLocation();
  const grade = candidate.finalGrade;
  const isDemonstration = sectionDataMode === "simulated" || candidate.dataMode === "simulated";
  const ctaText = opportunityCta(isDemonstration, !!hasCachedResult);

  return (
    <div
      className="rounded-lg border bg-card/50 p-3 space-y-2"
      data-testid={`card-opportunity-${candidate.symbol}`}
      role="article"
      aria-label={`${candidate.symbol} opportunity`}
    >
      <div className="flex items-start justify-between gap-2">
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
          {/* Show per-card badge only when the card is simulated AND the section is NOT already fully simulated.
              When the whole section is simulated, the section-level banner already covers it. */}
          {candidate.dataMode === "simulated" && sectionDataMode !== "simulated" && (
            <Badge
              variant="outline"
              className={cn("text-[10px]", DATA_QUALITY_CLASS.SIMULATED)}
              data-testid={`badge-card-simulated-${candidate.symbol}`}
            >
              {DATA_QUALITY.SIMULATED}
            </Badge>
          )}
        </div>
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
      <div className="flex items-center gap-2 pt-0.5">
        {isDemonstration ? (
          /* Demo cards show an example of what real setups look like — no live analysis is available.
             A disabled button labeled "Open Example" is misleading; show a clear static note instead. */
          <span
            className="text-[11px] text-muted-foreground italic"
            data-testid={`label-demo-only-${candidate.symbol}`}
          >
            Example — connect a broker to see live setups
          </span>
        ) : (
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
        )}
      </div>
    </div>
  );
}

function OpportunitiesSection({
  status,
  candidates,
  dataMode,
  onRetry,
}: {
  status: string;
  candidates?: RadarCandidate[];
  dataMode?: string;
  onRetry: () => void;
}) {
  const [, navigate] = useLocation();

  // Sprint 5.5B: batch-check which opportunity symbols have a cached full analysis.
  // Only runs for non-demo sections (simulated candidates have no cached results).
  const symbolsKey = (candidates ?? []).map((c) => c.symbol).join(",");
  const { data: cacheData } = useQuery<{ hits: string[] }>({
    queryKey: ["analysis-cache-batch", symbolsKey],
    queryFn: async () => {
      if (!symbolsKey || dataMode === "simulated") return { hits: [] };
      try {
        const res = await apiRequest("GET", `/api/analysis/cached?symbols=${encodeURIComponent(symbolsKey)}`);
        if (!res.ok) return { hits: [] };
        return res.json() as Promise<{ hits: string[] }>;
      } catch {
        return { hits: [] };
      }
    },
    enabled: !!symbolsKey && dataMode !== "simulated",
    staleTime: 30 * 1000, // re-check every 30 seconds
    refetchOnWindowFocus: false,
  });
  const cachedSymbols = new Set<string>((cacheData?.hits ?? []).map((s) => s.toUpperCase()));

  return (
    <section aria-labelledby="opportunities-heading" data-testid="section-opportunities">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              {/* Sprint 5.5A: rename section when all candidates are demonstration data */}
              <span id="opportunities-heading" data-testid="text-opportunities-heading">
                {dataMode === "simulated" ? "Sample Opportunities" : "Today\u2019s Opportunities"}
              </span>
            </CardTitle>
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
          {dataMode === "simulated" ? (
            <>
              {/* Clear demonstration-data banner — never describe simulated cards as "current" opportunities */}
              <div
                className="flex items-center gap-2 rounded-md border border-violet-500/30 bg-violet-500/5 px-3 py-2 mt-1"
                role="note"
                data-testid="banner-demo-opportunities"
                aria-label="Demonstration data — these are example candidates only"
              >
                <Info className="h-3.5 w-3.5 text-violet-400 shrink-0" aria-hidden="true" />
                <span className="text-xs text-violet-300">{DATA_QUALITY.SIMULATED}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Demonstration candidates showing how ranked stock and options opportunities appear in VCP Trader AI. Connect a broker to see results based on current market data.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Candidates from current market data, ranked by score. Not a recommendation to buy or sell.
              {dataMode === "mixed" && " Some prices are estimated."}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {status === "unavailable" ? (
            <SectionError label="Opportunities" onRetry={onRetry} />
          ) : (candidates?.length ?? 0) === 0 ? (
            <div className="py-3 space-y-2" data-testid="text-no-opportunities">
              <p className="text-sm text-muted-foreground">
                No candidates meet qualification criteria right now.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate("/scanner")}
                data-testid="btn-open-scanner"
              >
                Open Scanner
              </Button>
            </div>
          ) : (
            <div
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              role="list"
              aria-label="Opportunity candidates"
              data-testid="grid-opportunities"
            >
              {(candidates ?? []).slice(0, 5).map((c) => (
                <OpportunityCard
                  key={c.id ?? `${c.symbol}-${c.rank}`}
                  candidate={c}
                  // When the whole section is simulated, suppress per-card badge (section banner covers it)
                  sectionDataMode={dataMode}
                  // Sprint 5.5B: drive CTA label from server cache
                  hasCachedResult={cachedSymbols.has(c.symbol.toUpperCase())}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5. Portfolio Intelligence
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
                  <div className="text-lg font-semibold tabular-nums mt-0.5" aria-label={`${positionCount} open positions`}>
                    {positionCount}
                  </div>
                </div>
                <div className="rounded-lg border bg-card/50 p-2.5" data-testid="tile-unrealized-pnl">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Unrealized P/L</div>
                  <div
                    className={cn(
                      "text-lg font-semibold tabular-nums mt-0.5",
                      totalPnl >= 0 ? "text-emerald-400" : "text-rose-400",
                    )}
                    aria-label={`Unrealized P/L: ${totalPnl >= 0 ? "+" : ""}$${Math.abs(totalPnl).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
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
                  aria-label="Ask AI about portfolio"
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
// 6. Watchlist Activity
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
                aria-label="Create a watchlist"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Create Watchlist
              </Button>
            </div>
          ) : (
            <div className="space-y-2" data-testid="list-watchlists" role="list" aria-label="Your watchlists">
              {items!.slice(0, 5).map((wl) => (
                <div
                  key={wl.id}
                  className="flex items-center justify-between rounded-lg border bg-card/50 px-3 py-2"
                  role="listitem"
                  data-testid={`watchlist-${wl.id}`}
                  aria-label={`Watchlist: ${wl.name}, ${wl.symbols.length} symbols`}
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
                    aria-label={`Scan ${wl.name} watchlist`}
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
// 7. Growth & Income Opportunities
// ---------------------------------------------------------------------------

function GrowthIncomeSection({
  snapshot,
  status,
  onRetry,
}: {
  snapshot?: MarketSnapshot;
  status: string;
  onRetry: () => void;
}) {
  const [, navigate] = useLocation();

  if (status === "unavailable" || !snapshot) {
    return (
      <section aria-labelledby="growth-income-heading" data-testid="section-growth-income">
        <h2 id="growth-income-heading" className="sr-only">Growth and Income Opportunities</h2>
        <SectionError label="Growth and income" onRetry={onRetry} />
      </section>
    );
  }

  const { topGrowth, bestIncome, dataMode } = snapshot;

  return (
    <section aria-labelledby="growth-income-heading" data-testid="section-growth-income">
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Growth */}
        <Card>
          {/* Sprint 5.5A: renamed to "Growth Watch" — topGrowth is news-sentiment or hardcoded reference,
            NOT a deterministically qualified trade setup. Never call it an "opportunity." */}
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              <span id="growth-income-heading">Growth Watch</span>
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] w-fit",
                  snapshot.growthSource === "sentiment"
                    ? DATA_QUALITY_CLASS.SNAPSHOT
                    : DATA_QUALITY_CLASS.ESTIMATED,
                )}
                data-testid="badge-growth-source"
                aria-label={snapshot.growthSource === "sentiment" ? "News-sentiment context" : "Reference context"}
              >
                {snapshot.growthSource === "sentiment" ? "News-sentiment context" : "Reference context"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2" data-testid="card-growth">
            <div className="font-mono font-semibold text-base">{topGrowth.symbol}</div>
            {/* Context-appropriate framing: sentiment news ≠ a qualified setup */}
            <p className="text-xs text-muted-foreground leading-snug" data-testid="text-growth-headline">
              {snapshot.growthSource === "sentiment"
                ? `${topGrowth.symbol} is receiving elevated positive news attention. Run a full analysis to evaluate technical and long-term conditions.`
                : topGrowth.headline}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1 h-7"
              onClick={() => navigate(askRoute(`Analyze ${topGrowth.symbol} for long-term growth potential`))}
              data-testid={`btn-analyze-growth-${topGrowth.symbol}`}
              aria-label={`Run full analysis for ${topGrowth.symbol}`}
            >
              Run Full Analysis <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>

        {/* Income — renamed to "Income Idea to Explore": bestIncome is always hardcoded reference data.
            No deterministic options qualification (ownership, chain, liquidity) has been performed. */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <DollarSign className="h-4 w-4 text-amber-400" aria-hidden="true" />
              Income Idea to Explore
            </CardTitle>
            <Badge
              variant="outline"
              className={cn("text-[10px] w-fit", DATA_QUALITY_CLASS.ESTIMATED)}
              data-testid="badge-income-estimated"
              title="Income scenarios are illustrative reference examples. Actual contract details require a broker connection and full analysis."
            >
              {DATA_QUALITY.ESTIMATED}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2" data-testid="card-income">
            <div className="font-mono font-semibold text-base">{bestIncome.symbol}</div>
            {/* Always use exploratory framing — no ownership/chain/liquidity check performed */}
            <p className="text-xs text-muted-foreground leading-snug" data-testid="text-income-headline">
              {`${bestIncome.symbol} may support dividend and covered-call analysis. Connect a broker or open the income workflow to evaluate share ownership, options liquidity, risk, and current contracts.`}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1 h-7"
              onClick={() => navigate(askRoute(`Find income opportunities with ${bestIncome.symbol}`))}
              data-testid={`btn-analyze-income-${bestIncome.symbol}`}
              aria-label={`Explore income ideas with ${bestIncome.symbol}`}
            >
              Explore Income Ideas <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 8. Saved Research
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
              aria-label="Open Research Library"
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
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate("/ask")}
                data-testid="btn-start-research"
              >
                Start Research
              </Button>
            </div>
          ) : (
            <div className="space-y-2" role="list" aria-label="Saved research records" data-testid="list-research-records">
              {(records ?? []).map((r) => (
                <div
                  key={r.id}
                  className="flex items-start justify-between gap-3 rounded-lg border bg-card/50 px-3 py-2.5"
                  role="listitem"
                  data-testid={`research-record-${r.id}`}
                  aria-label={`Research: ${r.title}`}
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {r.symbol && (
                        <span
                          className="font-mono text-xs font-semibold"
                          data-testid={`research-symbol-${r.id}`}
                        >
                          {r.symbol}
                        </span>
                      )}
                      <span
                        className="text-sm font-medium truncate max-w-[200px]"
                        data-testid={`research-title-${r.id}`}
                      >
                        {r.title}
                      </span>
                    </div>
                    {r.verdict && (
                      <p
                        className="text-xs text-muted-foreground truncate"
                        data-testid={`research-verdict-${r.id}`}
                      >
                        {r.verdict}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground" data-testid={`research-date-${r.id}`}>
                      {formatRelativeTime(r.generatedAt)}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs gap-1"
                      onClick={() => {
                        track("dashboard_research_opened" as any);
                        navigate(`/research/${r.id}`);
                      }}
                      data-testid={`btn-open-research-${r.id}`}
                      aria-label={`Open research record: ${r.title}`}
                    >
                      Open <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
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
// 9. Market Events (topNews)
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
    // Only show error if status is explicitly unavailable; silently hide if empty
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
          <div
            className="space-y-2"
            role="list"
            aria-label="Market news context"
            data-testid="list-market-events"
          >
            {news.slice(0, 5).map((item, i) => (
              <div
                key={`${item.symbol}-${i}`}
                className="flex items-start gap-3 rounded-lg border bg-card/50 px-3 py-2.5"
                role="listitem"
                data-testid={`event-${item.symbol}-${i}`}
                aria-label={`${item.symbol}: ${item.whyItMatters}`}
              >
                {/* Sprint 5.5A: never show raw "high/medium/low" — use explicit labels */}
                <Badge
                  variant="outline"
                  className={cn("text-[10px] shrink-0 whitespace-nowrap", IMPACT_CLASS[item.impact])}
                  data-testid={`badge-impact-${item.symbol}-${i}`}
                  aria-label={`News attention: ${IMPACT_LABEL[item.impact] ?? item.impact}`}
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
                      aria-label={SENTIMENT_LABEL[item.label] ?? item.label}
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
                  aria-label={`Ask AI about ${item.symbol}`}
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
// 10. Ask AI Panel
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
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4"
            role="list"
            aria-label="Suggested prompts"
          >
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                role="listitem"
                className="text-left rounded-lg border bg-card/50 px-3 py-2.5 text-xs font-medium transition-colors hover:bg-accent/40 hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => navigate(askRoute(prompt))}
                data-testid={`btn-prompt-${prompt.slice(0, 20).replace(/\s/g, "-").toLowerCase()}`}
                aria-label={`Ask: ${prompt}`}
              >
                {prompt}
              </button>
            ))}
          </div>
          <Button
            onClick={() => navigate("/ask")}
            className="gap-2"
            data-testid="btn-open-ask"
            aria-label="Open Ask AI"
          >
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
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-48 w-full" />
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
    refetchInterval: 5 * 60_000, // refresh every 5 minutes
    staleTime: 60_000,
  });

  // Fire analytics on mount
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
                  aria-label="Retry loading dashboard"
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
  const opportunities = data.opportunities.status === "ok" ? data.opportunities.candidates : undefined;
  const opportunitiesDataMode = data.opportunities.status === "ok" ? data.opportunities.dataMode : undefined;
  const records = data.savedResearch.status === "ok" ? data.savedResearch.records : undefined;
  const watchlists = data.watchlists.status === "ok" ? data.watchlists.items : undefined;

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

        {/* 3. Market Snapshot */}
        <MarketSnapshotSection
          data={snapshot}
          status={data.marketSnapshot.status}
          onRetry={() => {
            track("dashboard_section_retry", { section: "market_snapshot" } as any);
            dashboardQuery.refetch();
          }}
        />

        {/* 4. Today's Opportunities */}
        <OpportunitiesSection
          status={data.opportunities.status}
          candidates={opportunities}
          dataMode={opportunitiesDataMode}
          onRetry={() => {
            track("dashboard_section_retry", { section: "opportunities" } as any);
            dashboardQuery.refetch();
          }}
        />

        {/* 5 + 6: Portfolio & Watchlist — two-column on large screens */}
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

        {/* 7. Growth & Income */}
        <GrowthIncomeSection
          snapshot={snapshot}
          status={data.marketSnapshot.status}
          onRetry={() => dashboardQuery.refetch()}
        />

        {/* 8. Saved Research */}
        <SavedResearchSection
          status={data.savedResearch.status}
          records={records}
          onRetry={() => {
            track("dashboard_section_retry", { section: "saved_research" } as any);
            dashboardQuery.refetch();
          }}
        />

        {/* 9. Market Events */}
        <MarketEventsSection
          status={data.marketSnapshot.status}
          news={snapshot?.topNews}
          onRetry={() => dashboardQuery.refetch()}
        />

        {/* 10. Ask AI Panel */}
        <AskAISection />

        {/* Compliance footer */}
        <p className="text-xs text-muted-foreground pt-4 border-t leading-relaxed" data-testid="text-dashboard-disclaimer">
          VCP Trader AI provides market analysis, opportunity discovery, and educational information for self-directed
          investors and traders. It does not provide personalized investment advice or manage customer assets.
          Nothing shown here is a recommendation to buy or sell. You are solely responsible for every trading decision.
        </p>
      </div>
    </div>
  );
}
