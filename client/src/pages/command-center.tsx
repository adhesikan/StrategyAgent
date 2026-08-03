import { useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBrokerStatus } from "@/hooks/use-broker-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sparkles,
  ArrowRight,
  Search,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  Activity,
  Newspaper,
  LineChart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { TrialBanner } from "@/components/trial-banner";
import {
  askRoute,
  QUICK_ACTIONS,
  greetingForHour,
  summarizePositions,
  filterRadarCandidates,
  sortRadarCandidates,
  RADAR_UNIVERSE_OPTIONS,
  RADAR_TYPE_OPTIONS,
  RADAR_SORT_OPTIONS,
  type BrokerPositionLike,
  type RadarUniverse,
  type RadarTypeFilter,
  type RadarSort,
} from "@/lib/command-center";
import { Radar } from "lucide-react";
import {
  ScenarioCard,
  ExplanationDrawer,
  NewsContextDrawer,
  CongressActivityDrawer,
  OrderReviewDialog,
  logScenarioAction,
  type RadarCandidateScenario,
} from "@/components/radar-scenario-card";

// ---------------------------------------------------------------------------
// AI Command Center (/home). AI is the front door: the command bar routes into
// the existing Ask AI page (/ask?q=) which auto-executes via POST /api/ask —
// no second AI backend. Every panel loads independently and degrades on its
// own (failure isolation): one failed card never takes down /home.
// ---------------------------------------------------------------------------

interface IndexQuote { symbol: string; name: string; last: number; changePercent: number; }
interface NewsItem { symbol: string; label: "bullish" | "bearish" | "neutral"; whyItMatters: string; }
interface Snapshot {
  marketTone: "bullish" | "mixed" | "defensive";
  marketToneReason: string;
  indices: IndexQuote[];
  topNews: NewsItem[];
  dataMode: "live" | "simulated";
}

const TONE_CLASS: Record<string, string> = {
  bullish: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  mixed: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  defensive: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

// -- Today's AI Brief -------------------------------------------------------
// Component boundary only (spec §12): a trustworthy brief needs a backend
// summary derived from real scan results across the user's universe (e.g. a
// cached endpoint like GET /api/home/ai-brief built from stored scan_vcp
// stages + pivot distances). No such data source exists yet, so the card is
// hidden — nothing is fabricated. Do not populate this client-side.
function AiBriefCard() {
  return null;
}

// -- Continue Research ------------------------------------------------------
// Boundary only: there is no persisted ask/analysis history model today, and
// the spec forbids creating a new persistence model solely for the homepage.
// When an ask-history source exists, render recent analyses here linking to
// /ask?q=Analyze <SYMBOL>.
function ContinueResearchCard() {
  return null;
}

export default function CommandCenterPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { isConnected } = useBrokerStatus();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // --- data (parallel, cached, cheap — no MCP scans on render) ---
  const snapshotQuery = useQuery<Snapshot>({
    queryKey: ["/api/home/snapshot"],
    refetchInterval: 60_000,
  });
  const positionsQuery = useQuery<BrokerPositionLike[]>({
    queryKey: ["/api/broker/positions"],
    enabled: isConnected,
  });
  // Opportunity Radar top trades — same default scan as the Radar page
  // (shared cache key) so opening /opportunity-radar is instant afterwards.
  // Users can change the symbol source (default: watchlist) right here.
  const [radarUniverse, setRadarUniverse] = useState<RadarUniverse>("watchlist");
  const [radarTypeFilter, setRadarTypeFilter] = useState<RadarTypeFilter>("all");
  const [radarSort, setRadarSort] = useState<RadarSort>("rank");
  const radarQueryString = `timeHorizon=1_4w&universe=${radarUniverse}&maxLoss=2000`;
  const radarQuery = useQuery<{ candidates: RadarCandidateScenario[]; dataMode?: string }>({
    queryKey: ["/api/radar/scenarios", radarQueryString],
    queryFn: async () => {
      const r = await fetch(`/api/radar/scenarios?${radarQueryString}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load radar trades");
      return r.json();
    },
    staleTime: 5 * 60_000, // radar scans are expensive — don't rescan on every visit
  });

  // Top radar candidates: instrument filter + sort applied client-side to the
  // server-ranked scan, then the best 4 of what remains are shown.
  const radarTrades = useMemo(() => {
    const all = Array.isArray(radarQuery.data?.candidates) ? radarQuery.data!.candidates : [];
    return sortRadarCandidates(filterRadarCandidates(all, radarTypeFilter), radarSort).slice(0, 4);
  }, [radarQuery.data, radarTypeFilter, radarSort]);
  const [explainScenario, setExplainScenario] = useState<RadarCandidateScenario | null>(null);
  const [newsScenario, setNewsScenario] = useState<RadarCandidateScenario | null>(null);
  const [congressSymbol, setCongressSymbol] = useState<string | null>(null);
  const [reviewScenario, setReviewScenario] = useState<RadarCandidateScenario | null>(null);
  const portfolio = useMemo(() => summarizePositions(positionsQuery.data), [positionsQuery.data]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    track("home_ai_submit" as any);
    navigate(askRoute(trimmed));
  };

  const onQuickAction = (id: string, event: string, href: string) => {
    track(event as any);
    if (id === "analyze") {
      // Prompt/ticker flow: prefill the command bar, user supplies the ticker.
      setQ("Analyze ");
      inputRef.current?.focus();
      return;
    }
    navigate(href);
  };

  const firstName = user?.firstName || "";

  return (
    <div className="flex-1 overflow-auto">
      <div className="w-full max-w-6xl mx-auto px-4 md:px-8 py-5 md:py-6 space-y-5">
        <TrialBanner />

        {/* ---------- Compact hero / Ask VCP AI ---------- */}
        <section aria-labelledby="home-hero-title">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 id="home-hero-title" className="text-xl md:text-2xl font-medium tracking-tight" data-testid="text-home-headline">
              {greetingForHour(new Date().getHours())}{firstName ? `, ${firstName}` : ""}.
            </h1>
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[10px]" data-testid="badge-vcp-ai-ready">
              VCP AI Ready
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-home-subtext">
            I&rsquo;m VCP AI, your trading research assistant. Ask about a stock, explore market signals, find trade candidates, generate income strategies, or review your portfolio.
          </p>
          <div className="relative mt-3">
            <Search className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit(q)}
              placeholder="Ask about a stock, market signals, options strategies, your portfolio, earnings, or today's market…"
              aria-label="Ask VCP AI"
              className="h-12 pl-11 pr-36 text-[15px] rounded-[14px]"
              data-testid="input-home-ai-command"
            />
            <Button onClick={() => submit(q)} className="absolute right-1.5 top-1.5 h-9 rounded-[10px] gap-2" data-testid="button-home-ai-ask">
              Ask VCP AI <ArrowRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2.5" data-testid="row-quick-actions">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                className="text-left rounded-lg border bg-card/50 px-3 py-2 hover-elevate transition-colors"
                onClick={() => onQuickAction(a.id, a.event, a.href)}
                data-testid={`button-quick-${a.id}`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {a.id === "analyze" && <Sparkles className="h-4 w-4 text-primary" />}
                  {a.id === "find-trades" && <Search className="h-4 w-4 text-sky-400" />}
                  {a.id === "income" && <DollarSign className="h-4 w-4 text-amber-400" />}
                  {a.id === "scan" && <LineChart className="h-4 w-4 text-emerald-400" />}
                  {a.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground line-clamp-2">{a.description}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ---------- Market Signals (Opportunity Radar data) ---------- */}
        <Card data-testid="card-home-radar">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                <Radar className="h-4 w-4 text-primary" /> Market Signals
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => { track("home_radar_open" as any); navigate("/opportunity-radar"); }} data-testid="button-open-radar">
                Open Radar <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="text-signals-subtitle">
              Trade candidates surfaced from current market data and your selected screening criteria.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Select
                value={radarUniverse}
                onValueChange={(v) => { track("home_radar_universe" as any); setRadarUniverse(v as RadarUniverse); }}
              >
                <SelectTrigger className="h-8 w-[150px] text-xs" data-testid="select-home-radar-universe">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RADAR_UNIVERSE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={radarTypeFilter}
                onValueChange={(v) => { track("home_radar_type_filter" as any); setRadarTypeFilter(v as RadarTypeFilter); }}
              >
                <SelectTrigger className="h-8 w-[120px] text-xs" data-testid="select-home-radar-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RADAR_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={radarSort}
                onValueChange={(v) => { track("home_radar_sort" as any); setRadarSort(v as RadarSort); }}
              >
                <SelectTrigger className="h-8 w-[170px] text-xs" data-testid="select-home-radar-sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RADAR_SORT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {radarQuery.isLoading ? (
              <div className="grid gap-2 md:grid-cols-2">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : radarQuery.isError ? (
              <p className="text-xs text-muted-foreground py-3" data-testid="text-radar-error">
                Radar data is temporarily unavailable. Open the Radar page to retry.
              </p>
            ) : radarTrades.length === 0 ? (
              <div className="py-3 space-y-3" data-testid="text-no-radar-trades">
                <p className="text-sm">
                  {(radarQuery.data?.candidates?.length ?? 0) > 0 && radarTypeFilter !== "all"
                    ? "No candidates match this type filter. Try \u201CAll types\u201D or another source."
                    : "No radar trade candidates right now."}
                </p>
                <Button size="sm" variant="outline" onClick={() => navigate("/opportunity-radar")}>
                  Open Opportunity Radar
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2" data-testid="grid-radar-trades">
                {radarTrades.map((c) => (
                  <ScenarioCard
                    key={c.id ?? `${c.symbol}-${c.rank}`}
                    scenario={c}
                    onExplain={() => { track("home_radar_view_why" as any); setExplainScenario(c); }}
                    onReview={() => { track("home_radar_review" as any); setReviewScenario(c); logScenarioAction(c, "reviewed"); }}
                    onPrepareOrder={() => { track("home_radar_prepare" as any); setReviewScenario(c); logScenarioAction(c, "prepared_order"); }}
                    onViewNews={() => { track("home_radar_view_news" as any); setNewsScenario(c); }}
                    onViewCongress={() => { track("home_radar_view_congress" as any); setCongressSymbol(c.symbol); }}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <ExplanationDrawer scenario={explainScenario} onClose={() => setExplainScenario(null)} />
        <NewsContextDrawer scenario={newsScenario} onClose={() => setNewsScenario(null)} />
        <CongressActivityDrawer symbol={congressSymbol} onClose={() => setCongressSymbol(null)} />
        <OrderReviewDialog scenario={reviewScenario} brokerConnected={isConnected} onClose={() => setReviewScenario(null)} />

        {/* ---------- Today's Market Brief (below signals, compact) ---------- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card data-testid="card-home-market-intel">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-primary" /> Today&rsquo;s Market Brief
                </CardTitle>
                <Button size="sm" variant="ghost" onClick={() => { track("home_market_cta" as any); navigate("/markets"); }} data-testid="button-view-markets">
                  View Markets <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {snapshotQuery.isLoading ? (
                <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
              ) : snapshotQuery.isError || !snapshotQuery.data ? (
                <p className="text-xs text-muted-foreground py-3" data-testid="text-market-error">
                  Market data is temporarily unavailable.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Market tone</span>
                    <Badge variant="outline" className={cn("capitalize", TONE_CLASS[snapshotQuery.data.marketTone])} data-testid="badge-market-tone">
                      {snapshotQuery.data.marketTone}
                    </Badge>
                    <span className="text-xs text-muted-foreground line-clamp-1">{snapshotQuery.data.marketToneReason}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(snapshotQuery.data.indices ?? []).slice(0, 3).map((idx) => {
                      const up = idx.changePercent >= 0;
                      return (
                        <div key={idx.symbol} className="rounded-lg border bg-card/50 p-2" data-testid={`tile-index-${idx.symbol}`}>
                          <div className="text-[10px] uppercase text-muted-foreground">{idx.name}</div>
                          <div className="flex items-baseline justify-between gap-1">
                            <span className="text-sm font-medium tabular-nums">{idx.last > 0 ? idx.last.toFixed(2) : "—"}</span>
                            <span className={cn("text-xs tabular-nums flex items-center", idx.last === 0 ? "text-muted-foreground" : up ? "text-emerald-400" : "text-rose-400")}>
                              {idx.last === 0 ? "" : up ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
                              {idx.last === 0 ? "—" : `${up ? "+" : ""}${idx.changePercent.toFixed(2)}%`}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {(snapshotQuery.data.topNews ?? []).slice(0, 2).map((n, i) => (
                    <div key={`${n.symbol}-${i}`} className="flex items-start gap-2 text-xs" data-testid={`row-market-news-${n.symbol}`}>
                      <Newspaper className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                      <span className="line-clamp-2"><span className="font-mono font-medium">{n.symbol}</span> — {n.whyItMatters}</span>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>

          {/* ---------- AI Market Summary (real snapshot data, cautious research language) ---------- */}
          {snapshotQuery.data && (
            <Card data-testid="card-home-ai-summary">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-primary" /> AI Market Summary
                  </CardTitle>
                  {snapshotQuery.data.dataMode === "simulated" && (
                    <Badge variant="outline" className="text-[10px]" data-testid="badge-ai-summary-mode">Simulated data</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Research context generated from current market, technical, news, and options data.
                </p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-xs leading-relaxed" data-testid="list-ai-summary">
                  <li className="flex gap-2">
                    <span className="text-primary shrink-0">•</span>
                    <span>Market data indicates a {snapshotQuery.data.marketTone} tone — {snapshotQuery.data.marketToneReason}</span>
                  </li>
                  {(snapshotQuery.data.indices ?? []).filter((idx) => idx.last > 0).slice(0, 1).map((idx) => (
                    <li key={idx.symbol} className="flex gap-2">
                      <span className="text-primary shrink-0">•</span>
                      <span>
                        {idx.name} is {idx.changePercent >= 0 ? "up" : "down"} {Math.abs(idx.changePercent).toFixed(2)}% on the session; index trend remains a key input for setup quality.
                      </span>
                    </li>
                  ))}
                  {(snapshotQuery.data.topNews ?? []).slice(0, 3).map((n, i) => (
                    <li key={`${n.symbol}-${i}`} className="flex gap-2">
                      <span className="text-primary shrink-0">•</span>
                      <span><span className="font-mono font-medium">{n.symbol}</span>: {n.whyItMatters}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card data-testid="card-home-portfolio">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                <Wallet className="h-4 w-4 text-primary" /> My Portfolio
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!isConnected ? (
                <div className="py-3 space-y-3" data-testid="text-portfolio-disconnected">
                  <p className="text-sm text-muted-foreground">Connect your broker to unlock portfolio intelligence.</p>
                  <Button size="sm" onClick={() => { track("home_portfolio_cta" as any); navigate("/settings"); }} data-testid="button-connect-broker">
                    Connect Broker
                  </Button>
                </div>
              ) : positionsQuery.isLoading ? (
                <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
              ) : positionsQuery.isError ? (
                <p className="text-xs text-muted-foreground py-3" data-testid="text-portfolio-error">
                  Portfolio data is temporarily unavailable.
                </p>
              ) : (
                <div className="space-y-3" data-testid="text-portfolio-summary">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border bg-card/50 p-2.5">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Positions</div>
                      <div className="text-lg font-semibold tabular-nums">{portfolio.positionCount}</div>
                    </div>
                    <div className="rounded-lg border bg-card/50 p-2.5">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Unrealized P/L</div>
                      <div className={cn(
                        "text-lg font-semibold tabular-nums",
                        portfolio.totalUnrealizedPnl === null ? "text-muted-foreground" : portfolio.totalUnrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400",
                      )}>
                        {portfolio.totalUnrealizedPnl === null
                          ? "—"
                          : `${portfolio.totalUnrealizedPnl >= 0 ? "+" : ""}$${Math.abs(portfolio.totalUnrealizedPnl).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { track("home_portfolio_cta" as any); navigate(askRoute("Review my portfolio")); }}
                    data-testid="button-portfolio-ask-ai"
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Ask AI about my portfolio
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          {/* Hidden boundaries — see comments above the components */}
          <AiBriefCard />
          <ContinueResearchCard />
        </div>

        <p className="text-xs text-muted-foreground pt-6 border-t leading-relaxed" data-testid="text-home-disclaimer">
          These research insights are for educational and informational purposes only. They are not investment advice
          and are not personalized to your financial situation. Nothing is traded without your explicit confirmation.
        </p>
      </div>
    </div>
  );
}
