import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Radar } from "lucide-react";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import {
  filterRadarCandidates,
  sortRadarCandidates,
  RADAR_UNIVERSE_OPTIONS,
  RADAR_TYPE_OPTIONS,
  RADAR_SORT_OPTIONS,
  type RadarUniverse,
  type RadarTypeFilter,
  type RadarSort,
} from "@/lib/command-center";
import {
  ScenarioCard,
  ExplanationDrawer,
  NewsContextDrawer,
  CongressActivityDrawer,
  OrderReviewDialog,
  logScenarioAction,
  tradeUrlForScenario,
  type RadarCandidateScenario,
} from "@/components/radar-scenario-card";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  ArrowRight,
  DollarSign,
  Newspaper,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  Info,
} from "lucide-react";
import { HelpLink } from "@/components/help-link";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TrialBanner } from "@/components/trial-banner";

interface IndexQuote { symbol: string; name: string; last: number; changePercent: number; }
interface MoverQuote { symbol: string; last: number; changePercent: number; }
interface NewsItem {
  symbol: string;
  label: "bullish" | "bearish" | "neutral";
  impact: "high" | "medium" | "low";
  buzz: number;
  whyItMatters: string;
  articleCount: number;
}

interface Snapshot {
  marketTone: "bullish" | "mixed" | "defensive";
  marketToneReason: string;
  indices: IndexQuote[];
  topMovers: MoverQuote[];
  topNews: NewsItem[];
  bestIncome: { symbol: string; name?: string; headline: string } | null;
  topGrowth: { symbol: string; name?: string; headline: string } | null;
  watchlistAlert: { symbol: string; message: string } | null;
  dataMode: "live" | "simulated";
  asOf: string;
  disclaimer: string;
}

function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground/70 hover:text-foreground" aria-label="What does this mean?">
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

const TONE_CLASS: Record<string, string> = {
  bullish: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  mixed: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  defensive: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

interface DailyMarketRegime {
  label: string;
  tone: "bullish" | "bearish" | "mixed" | "low_vol" | "high_vol";
  hint: string;
}

type ScanUniverseId =
  | "default"
  | "watchlist"
  | "large_cap"
  | "nasdaq_100"
  | "sp_500"
  | "high_volume"
  | "options_liquid"
  | "custom";

const SCAN_UNIVERSE_OPTIONS: { value: ScanUniverseId; label: string; hint: string }[] = [
  { value: "default", label: "Auto (recommended)", hint: "Use your watchlist with smart fallbacks" },
  { value: "watchlist", label: "My Watchlist", hint: "Only the symbols you've saved" },
  { value: "large_cap", label: "Dow 30", hint: "30 blue-chip stocks" },
  { value: "nasdaq_100", label: "Nasdaq 100", hint: "Top 100 Nasdaq names" },
  { value: "sp_500", label: "S&P 500", hint: "Top 500 US stocks (sampled)" },
  { value: "high_volume", label: "High Volume", hint: "Most-traded liquid names" },
  { value: "options_liquid", label: "Options Liquid", hint: "Best for option ideas" },
  { value: "custom", label: "Custom symbols…", hint: "Enter your own list" },
];

const ACTIONS = [
  {
    title: "Grow My Money",
    desc: "Simple stock and options ideas based on your limits",
    icon: TrendingUp,
    href: "/goal-mode",
    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    testId: "card-action-grow",
  },
  {
    title: "Generate Income",
    desc: "Covered calls, cash-secured puts, and income opportunities",
    icon: DollarSign,
    href: "/income-mode",
    color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    testId: "card-action-income",
  },
  {
    title: "Find a Trade",
    desc: "Describe a stock or options setup in plain English",
    icon: Search,
    href: "/trade-finder",
    color: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
    testId: "card-action-trade",
  },
  {
    title: "Understand Markets",
    desc: "News, sentiment, catalysts, and watchlist impact",
    icon: Newspaper,
    href: "/market-intel",
    color: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
    testId: "card-action-markets",
  },
];

const PLACEHOLDERS = [
  "How can I grow $10k?",
  "Find income ideas under $200 risk",
  "Show bullish stock setups today",
  "Find defined-risk option ideas",
  "Why is NVDA moving?",
  "Show lower-risk swing trades",
];

// Simplified taxonomy: previous Grow/Stocks both queried the "stocks"
// bucket and Income/Options overlapped (income strategies are
// option-based). Collapsed to four meaningful tabs so users see
// distinct results, not duplicates.
// Higher = better. A+ > A > B > C > anything else.
const GRADE_RANK: Record<string, number> = { "A+": 4, A: 3, B: 2, C: 1 };

function routeFor(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return "/ask";
  return `/ask?q=${encodeURIComponent(trimmed)}`;
}

export default function HomeV2() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  // Radar-backed trade ideas — the SAME engine, cards, and actions as /home
  // (shared cache key with the home Market Signals section).
  const { isConnected } = useBrokerStatus();
  const [radarUniverse, setRadarUniverse] = useState<RadarUniverse>(() => {
    if (typeof window === "undefined") return "watchlist";
    const v = window.localStorage.getItem("ideas.radarUniverse");
    return v === "watchlist" || v === "large_cap" || v === "high_volume" || v === "options_liquid" ? v : "watchlist";
  });
  useEffect(() => {
    window.localStorage.setItem("ideas.radarUniverse", radarUniverse);
  }, [radarUniverse]);
  const [radarTypeFilter, setRadarTypeFilter] = useState<RadarTypeFilter>("all");
  const [radarSort, setRadarSort] = useState<RadarSort>("rank");
  const radarQueryString = `timeHorizon=1_4w&universe=${radarUniverse}&maxLoss=2000`;
  const radarQuery = useQuery<{ candidates: RadarCandidateScenario[]; dataMode?: string }>({
    queryKey: ["/api/radar/scenarios", radarQueryString],
    queryFn: async () => {
      const r = await fetch(`/api/radar/scenarios?${radarQueryString}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load trade ideas");
      return r.json();
    },
    staleTime: 5 * 60_000, // radar scans are expensive — don't rescan on every visit
  });
  const ideas = useMemo(
    () => sortRadarCandidates(filterRadarCandidates(radarQuery.data?.candidates ?? [], radarTypeFilter), radarSort),
    [radarQuery.data, radarTypeFilter, radarSort],
  );
  const [explainScenario, setExplainScenario] = useState<RadarCandidateScenario | null>(null);
  const [newsScenario, setNewsScenario] = useState<RadarCandidateScenario | null>(null);
  const [congressSymbol, setCongressSymbol] = useState<string | null>(null);
  const [reviewScenario, setReviewScenario] = useState<RadarCandidateScenario | null>(null);

  const { data: snap } = useQuery<Snapshot>({
    queryKey: ["/api/home/snapshot"],
    refetchInterval: 60_000,
  });

  const submit = (text: string) => {
    if (!text.trim()) return;
    navigate(routeFor(text));
  };

  const greetingHour = new Date().getHours();
  const greeting =
    greetingHour < 12 ? "Good morning" : greetingHour < 18 ? "Good afternoon" : "Good evening";
  const firstName = user?.firstName || "there";

  const placeholder = useMemo(
    () => PLACEHOLDERS[Math.floor(Date.now() / 60_000) % PLACEHOLDERS.length],
    [],
  );

  return (
    <div className="flex-1 overflow-auto">
      <div className="w-full max-w-6xl mx-auto px-4 md:px-8 py-5 md:py-6 space-y-6">
        <TrialBanner />
        <div>
          <h1 className="text-xl md:text-2xl font-medium tracking-tight" data-testid="text-home-greeting">
            {greeting}, {firstName}.
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-home-subtitle">
            {radarQuery.isLoading
              ? "Scanning for trade candidates…"
              : `${ideas.length} ${ideas.length === 1 ? "candidate" : "candidates"} ready to review — nothing sent without your approval.`}
          </p>
        </div>

        <section data-testid="section-trade-ideas">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Radar className="h-4 w-4 text-primary" />
              Market Signals
            </h2>
            <Button size="sm" variant="ghost" onClick={() => navigate("/opportunity-radar")} data-testid="button-ideas-open-radar">
              Open Radar <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Trade candidates surfaced from current market data and your selected screening criteria — the same cards and actions as the home page.
          </p>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Select value={radarUniverse} onValueChange={(v) => setRadarUniverse(v as RadarUniverse)}>
              <SelectTrigger className="h-8 w-[150px] text-xs" data-testid="select-ideas-universe">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RADAR_UNIVERSE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={radarTypeFilter} onValueChange={(v) => setRadarTypeFilter(v as RadarTypeFilter)}>
              <SelectTrigger className="h-8 w-[120px] text-xs" data-testid="select-ideas-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RADAR_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={radarSort} onValueChange={(v) => setRadarSort(v as RadarSort)}>
              <SelectTrigger className="h-8 w-[170px] text-xs" data-testid="select-ideas-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RADAR_SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {radarQuery.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : radarQuery.isError ? (
            <p className="text-xs text-muted-foreground py-3" data-testid="text-ideas-error">
              Radar data is temporarily unavailable. Open the Radar page to retry.
            </p>
          ) : ideas.length === 0 ? (
            <div className="py-3 space-y-3" data-testid="text-no-ideas">
              <p className="text-sm">
                {(radarQuery.data?.candidates?.length ?? 0) > 0 && radarTypeFilter !== "all"
                  ? "No candidates match this type filter. Try \u201CAll types\u201D or another source."
                  : "No trade candidates right now."}
              </p>
              <Button size="sm" variant="outline" onClick={() => navigate("/opportunity-radar")}>
                Open Opportunity Radar
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2" data-testid="grid-ideas-cards">
              {ideas.map((c) => (
                <ScenarioCard
                  key={c.id ?? `${c.symbol}-${c.rank}`}
                  scenario={c}
                  onExplain={() => setExplainScenario(c)}
                  onReview={() => { logScenarioAction(c, "reviewed"); navigate(tradeUrlForScenario(c)); }}
                  onPrepareOrder={() => { setReviewScenario(c); logScenarioAction(c, "prepared_order"); }}
                  onViewNews={() => setNewsScenario(c)}
                  onViewCongress={() => setCongressSymbol(c.symbol)}
                />
              ))}
            </div>
          )}
          <ExplanationDrawer scenario={explainScenario} onClose={() => setExplainScenario(null)} />
          <NewsContextDrawer scenario={newsScenario} onClose={() => setNewsScenario(null)} />
          <CongressActivityDrawer symbol={congressSymbol} onClose={() => setCongressSymbol(null)} />
          <OrderReviewDialog scenario={reviewScenario} brokerConnected={isConnected} onClose={() => setReviewScenario(null)} />
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Ask VCP Trader AI
          </h2>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit(q)}
              placeholder={placeholder}
              className="h-14 pl-11 pr-32 text-[15px] rounded-[14px] border-border focus-visible:ring-1 focus-visible:ring-foreground"
              data-testid="input-home-ask"
            />
            <Button
              onClick={() => submit(q)}
              className="absolute right-2 top-2 h-10 rounded-[10px] gap-2"
              data-testid="button-home-ask"
            >
              Ask <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Ask about a ticker, news, income ideas, or a setup — get an AI-generated answer with live context.
          </p>
        </section>

        <TooltipProvider delayDuration={150}>
        <section data-testid="section-snapshot">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              Today's snapshot
              <InfoHint text="A live read on market tone, indices, biggest movers in your watchlist, and the news catalysts driving them. Click any tile to dig deeper." />
            </h2>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={
                  snap?.dataMode === "live"
                    ? "text-[10px] text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
                    : "text-[10px] text-amber-300 border-amber-500/40 bg-amber-500/10"
                }
                data-testid="badge-snapshot-source"
              >
                {snap?.dataMode === "live" ? "Live broker data" : "Delayed reference"}
              </Badge>
              <HelpLink section="home" label="Snapshot help" />
            </div>
          </div>

          {/* Row 1 — tone + indices */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Card
              onClick={() => navigate("/market-intel")}
              className="p-4 md:col-span-1 cursor-pointer hover-elevate active-elevate-2"
              data-testid="snapshot-tone"
            >
              <div className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground tracking-wide">
                <Activity className="h-3.5 w-3.5" /> Market tone
                <InfoHint text="Derived from SPY, QQQ, and IWM intraday performance. Bullish = all up. Defensive = all down. Mixed = rotation under the surface." />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="outline" className={cn("capitalize", TONE_CLASS[snap?.marketTone ?? "mixed"])}>
                  {snap?.marketTone || "Loading"}
                </Badge>
              </div>
              <p className="text-xs mt-2 text-foreground/80 leading-snug line-clamp-3" data-testid="text-tone-reason">
                {snap?.marketToneReason || "Reading market conditions..."}
              </p>
            </Card>

            {(snap?.indices ?? [
              { symbol: "SPY", name: "S&P 500", last: 0, changePercent: 0 },
              { symbol: "QQQ", name: "Nasdaq 100", last: 0, changePercent: 0 },
              { symbol: "IWM", name: "Russell 2000", last: 0, changePercent: 0 },
            ]).slice(0, 3).map((idx) => {
              const up = idx.changePercent >= 0;
              return (
                <Card
                  key={idx.symbol}
                  onClick={() => navigate(`/market-intel?symbol=${idx.symbol}`)}
                  className="p-4 cursor-pointer hover-elevate active-elevate-2"
                  data-testid={`snapshot-index-${idx.symbol}`}
                >
                  <div className="flex items-center justify-between text-[11px] uppercase text-muted-foreground tracking-wide">
                    <span>{idx.name}</span>
                    <span className="font-mono">{idx.symbol}</span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <div className="text-xl font-semibold tabular-nums" data-testid={`text-index-last-${idx.symbol}`}>
                      {idx.last > 0 ? idx.last.toFixed(2) : "—"}
                    </div>
                    <div
                      className={cn(
                        "text-sm font-medium tabular-nums flex items-center gap-1",
                        idx.last === 0 ? "text-muted-foreground" : up ? "text-emerald-400" : "text-rose-400",
                      )}
                      data-testid={`text-index-change-${idx.symbol}`}
                    >
                      {idx.last === 0 ? null : up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                      {idx.last === 0 ? "—" : `${up ? "+" : ""}${idx.changePercent.toFixed(2)}%`}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Row 2 — movers + top news */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <Card className="p-5" data-testid="snapshot-movers">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground tracking-wide">
                  <TrendingUp className="h-3.5 w-3.5" /> Biggest movers
                  <InfoHint text="Largest absolute % moves from your watchlist (or a default universe if you haven't built one yet). Live broker quotes when connected." />
                </div>
                <span className="text-[10px] text-muted-foreground">{snap?.topMovers?.length ?? 0} symbols</span>
              </div>
              {snap?.topMovers && snap.topMovers.length > 0 ? (
                <ul className="divide-y divide-border/60">
                  {snap.topMovers.slice(0, 5).map((m) => {
                    const up = m.changePercent >= 0;
                    return (
                      <li
                        key={m.symbol}
                        className="flex items-center justify-between py-2 cursor-pointer hover:bg-muted/30 -mx-2 px-2 rounded"
                        onClick={() => navigate(`/market-intel?symbol=${m.symbol}`)}
                        data-testid={`row-mover-${m.symbol}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium font-mono text-sm">{m.symbol}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">${m.last.toFixed(2)}</span>
                        </div>
                        <span className={cn(
                          "text-sm font-medium tabular-nums flex items-center gap-1",
                          up ? "text-emerald-400" : "text-rose-400",
                        )}>
                          {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                          {up ? "+" : ""}{m.changePercent.toFixed(2)}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground py-3" data-testid="text-no-movers">
                  Connect a broker to see live movers from your watchlist.
                </p>
              )}
            </Card>

            <Card className="p-5" data-testid="snapshot-news">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground tracking-wide">
                  <Newspaper className="h-3.5 w-3.5" /> Top news catalysts
                  <InfoHint text="High-buzz stories from the last few hours. Bullish/bearish labels are AI-generated from headline + summary; impact is heuristic." />
                </div>
                <button
                  onClick={() => navigate("/market-intel")}
                  className="text-[10px] text-primary hover:underline"
                  data-testid="link-all-news"
                >
                  View all
                </button>
              </div>
              {snap?.topNews && snap.topNews.length > 0 ? (
                <ul className="space-y-2.5">
                  {snap.topNews.slice(0, 4).map((n, i) => (
                    <li
                      key={`${n.symbol}-${i}`}
                      className="flex gap-2 cursor-pointer hover:bg-muted/30 -mx-2 px-2 py-1 rounded"
                      onClick={() => navigate(`/market-intel?symbol=${n.symbol}`)}
                      data-testid={`row-news-${n.symbol}`}
                    >
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-5 text-[10px] shrink-0 mt-0.5",
                          n.label === "bullish" && "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
                          n.label === "bearish" && "border-rose-500/40 text-rose-300 bg-rose-500/10",
                          n.label === "neutral" && "border-border text-muted-foreground",
                        )}
                      >
                        {n.symbol}
                      </Badge>
                      <p className="text-xs leading-snug text-foreground/80 line-clamp-2 flex-1">{n.whyItMatters}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground py-3">
                  No high-impact stories tracked right now. Check back during market hours.
                </p>
              )}
            </Card>
          </div>

          {/* Row 3 — actionable: income / growth / watchlist alert */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <Card
              onClick={() => navigate("/income-mode")}
              className="p-5 cursor-pointer hover-elevate active-elevate-2"
              data-testid="snapshot-income"
            >
              <div className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground tracking-wide">
                <DollarSign className="h-3.5 w-3.5" /> Best income idea
                <InfoHint text="Today's highest-rated covered call, cash-secured put, or defined-risk premium-selling candidate." />
              </div>
              <div className="mt-3 text-2xl font-medium" data-testid="text-income-symbol">
                {snap?.bestIncome?.symbol || "—"}
              </div>
              <p className="text-xs mt-2 text-foreground/80 leading-snug line-clamp-3">
                {snap?.bestIncome?.headline || "Looking for income candidates..."}
              </p>
            </Card>

            <Card
              onClick={() => snap?.topGrowth?.symbol && navigate(`/market-intel?symbol=${snap.topGrowth.symbol}`)}
              className="p-5 cursor-pointer hover-elevate active-elevate-2"
              data-testid="snapshot-growth"
            >
              <div className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground tracking-wide">
                <TrendingUp className="h-3.5 w-3.5" /> Top growth opportunity
                <InfoHint text="Symbol with the strongest combination of bullish news flow and trending buzz score this session." />
              </div>
              <div className="mt-3 text-2xl font-medium" data-testid="text-growth-symbol">
                {snap?.topGrowth?.symbol || "—"}
              </div>
              <p className="text-xs mt-2 text-foreground/80 leading-snug line-clamp-3">
                {snap?.topGrowth?.headline || "Looking for growth candidates..."}
              </p>
            </Card>

            <Card
              onClick={() => snap?.watchlistAlert
                ? navigate(`/market-intel?symbol=${snap.watchlistAlert.symbol}`)
                : navigate("/market-intel")
              }
              className={cn(
                "p-5 cursor-pointer hover-elevate active-elevate-2",
                snap?.watchlistAlert && "border-rose-500/30 bg-rose-500/5",
              )}
              data-testid="snapshot-watchlist-alert"
            >
              <div className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground tracking-wide">
                <AlertTriangle className="h-3.5 w-3.5" /> Watchlist alert
                <InfoHint text="Bearish news flow on a symbol from your watchlist that may warrant review. If empty, no flagged risks right now." />
              </div>
              <div className="mt-3 text-2xl font-medium" data-testid="text-watchlist-alert-symbol">
                {snap?.watchlistAlert?.symbol || "All clear"}
              </div>
              <p className="text-xs mt-2 text-foreground/80 leading-snug line-clamp-3">
                {snap?.watchlistAlert?.message || "No flagged risks on your watchlist right now."}
              </p>
            </Card>
          </div>
        </section>
        </TooltipProvider>

        <section>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            What do you want to do?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ACTIONS.map((a) => (
              <Card
                key={a.title}
                onClick={() => navigate(a.href)}
                className="p-6 cursor-pointer hover-elevate active-elevate-2 group"
                data-testid={a.testId}
              >
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${a.color}`}>
                  <a.icon className="h-5 w-5" />
                </div>
                <div className="mt-4 text-base font-medium">{a.title}</div>
                <div className="text-sm text-muted-foreground mt-1">{a.desc}</div>
              </Card>
            ))}
          </div>
        </section>

        <p className="text-xs text-muted-foreground pt-6 border-t leading-relaxed" data-testid="text-home-disclaimer">
          These ideas are for educational and informational purposes only. They are not investment advice or personalized recommendations. You decide whether any setup fits your objectives, risk tolerance, and account.
        </p>
      </div>
    </div>
  );
}
