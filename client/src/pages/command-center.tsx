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
  Sparkles,
  ArrowRight,
  Search,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  Activity,
  Newspaper,
  AlertTriangle,
  LineChart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";
import { TrialBanner } from "@/components/trial-banner";
import {
  askRoute,
  QUICK_ACTIONS,
  stageCtas,
  stageLabel,
  stageTone,
  summarizePositions,
  toHomeOpportunities,
  toHomeRadarTrades,
  type BrokerPositionLike,
} from "@/lib/command-center";
import { Radar } from "lucide-react";

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
  const opportunitiesQuery = useQuery<any[]>({
    queryKey: ["/api/opportunities", { status: "ACTIVE", limit: 5 }],
    queryFn: async () => {
      // Stored detection statuses are uppercase (ACTIVE/RESOLVED) and the filter is exact-match.
      const r = await fetch("/api/opportunities?status=ACTIVE&limit=5&sortBy=detectedAt&sortOrder=desc", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load opportunities");
      return r.json();
    },
  });
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
  const radarQueryString = "timeHorizon=1_4w&universe=watchlist&maxLoss=2000";
  const radarQuery = useQuery<{ candidates: any[]; dataMode?: string }>({
    queryKey: ["/api/radar/scenarios", radarQueryString],
    queryFn: async () => {
      const r = await fetch(`/api/radar/scenarios?${radarQueryString}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load radar trades");
      return r.json();
    },
    staleTime: 5 * 60_000, // radar scans are expensive — don't rescan on every visit
  });

  const opportunities = useMemo(() => toHomeOpportunities(opportunitiesQuery.data), [opportunitiesQuery.data]);
  const radarTrades = useMemo(() => toHomeRadarTrades(radarQuery.data?.candidates), [radarQuery.data]);
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
      <div className="w-full max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-12 space-y-8">
        <TrialBanner />

        {/* ---------- Hero / AI command bar ---------- */}
        <section aria-labelledby="home-hero-title">
          <h1 id="home-hero-title" className="text-2xl md:text-[28px] font-medium tracking-tight" data-testid="text-home-headline">
            What do you want VCP Trader to help you do today{firstName ? `, ${firstName}` : ""}?
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1" data-testid="text-home-subtext">
            Analyze stocks, find opportunities, generate income, or understand your portfolio.
          </p>
          <div className="relative mt-4">
            <Search className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit(q)}
              placeholder="Ask about a stock, find opportunities, generate income, or review your portfolio..."
              aria-label="Ask VCP Trader AI"
              className="h-14 pl-11 pr-40 text-[15px] rounded-[14px]"
              data-testid="input-home-ai-command"
            />
            <Button onClick={() => submit(q)} className="absolute right-2 top-2 h-10 rounded-[10px] gap-2" data-testid="button-home-ai-ask">
              Ask VCP Trader AI <ArrowRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3" data-testid="row-quick-actions">
            {QUICK_ACTIONS.map((a) => (
              <Button
                key={a.id}
                variant="outline"
                className="justify-start gap-2 h-10"
                onClick={() => onQuickAction(a.id, a.event, a.href)}
                data-testid={`button-quick-${a.id}`}
              >
                {a.id === "analyze" && <Sparkles className="h-4 w-4 text-primary" />}
                {a.id === "find-trades" && <Search className="h-4 w-4 text-sky-400" />}
                {a.id === "income" && <DollarSign className="h-4 w-4 text-amber-400" />}
                {a.id === "scan" && <LineChart className="h-4 w-4 text-emerald-400" />}
                <span className="text-sm">{a.label}</span>
              </Button>
            ))}
          </div>
        </section>

        {/* ---------- Opportunities + Portfolio ---------- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card data-testid="card-home-opportunities">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4 text-primary" /> Today's Opportunities
                </CardTitle>
                <Button size="sm" variant="ghost" onClick={() => navigate("/scanner")} data-testid="button-open-scanner">
                  Open Scanner <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {opportunitiesQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : opportunitiesQuery.isError ? (
                <p className="text-xs text-muted-foreground py-3" data-testid="text-opportunities-error">
                  Opportunity data is temporarily unavailable. Try the Scanner directly.
                </p>
              ) : opportunities.length === 0 ? (
                <div className="py-3 space-y-3" data-testid="text-no-opportunities">
                  <p className="text-sm">No high-quality setups currently meet your criteria.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => { track("home_scan_market" as any); navigate("/scanner"); }}>
                      Scan the Market
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => navigate("/watchlists")}>
                      Review Watchlist
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => inputRef.current?.focus()}>
                      Ask VCP Trader AI
                    </Button>
                  </div>
                </div>
              ) : (
                opportunities.map((o) => {
                  const ctas = stageCtas(o.stage, o.symbol);
                  return (
                    <div key={`${o.symbol}-${o.detectedAt}`} className="rounded-lg border p-3" data-testid={`row-opportunity-${o.symbol}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono font-medium">{o.symbol}</span>
                          {o.price !== null && (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              ${o.price.toFixed(2)}
                              {!o.priceIsCurrent && <span className="ml-1 text-[10px] opacity-70">at detection</span>}
                            </span>
                          )}
                          {o.stage && (
                            <Badge variant="outline" className={cn("text-[10px]", stageTone(o.stage))} data-testid={`badge-opp-stage-${o.symbol}`}>
                              {stageLabel(o.stage)}
                            </Badge>
                          )}
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          {ctas.map((c) => (
                            <Button
                              key={c.label}
                              size="sm"
                              variant={c.primary ? "default" : "ghost"}
                              className="h-7 text-xs"
                              onClick={() => { track("home_opportunity_analyze" as any); navigate(c.href); }}
                              data-testid={`button-opp-${o.symbol}-${c.label.toLowerCase().replace(/\s+/g, "-")}`}
                            >
                              {c.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                      {o.note && <p className="text-xs text-muted-foreground mt-1.5 line-clamp-1">{o.note}</p>}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

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
        </div>

        {/* ---------- Opportunity Radar — Top Trades ---------- */}
        <Card data-testid="card-home-radar">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                <Radar className="h-4 w-4 text-primary" /> Opportunity Radar — Top Trades
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => { track("home_radar_open" as any); navigate("/opportunity-radar"); }} data-testid="button-open-radar">
                Open Radar <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
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
                <p className="text-sm">No radar trade candidates right now.</p>
                <Button size="sm" variant="outline" onClick={() => navigate("/opportunity-radar")}>
                  Open Opportunity Radar
                </Button>
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2" data-testid="grid-radar-trades">
                {radarTrades.map((t) => (
                  <div key={`${t.symbol}-${t.rank}`} className="rounded-lg border p-3 space-y-1.5" data-testid={`card-radar-${t.symbol}`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-muted-foreground tabular-nums">#{t.rank}</span>
                        <span className="font-mono font-medium">{t.symbol}</span>
                        <Badge variant="outline" className="text-[10px]">{t.grade}</Badge>
                        {t.bias && (
                          <span className={cn(
                            "text-[10px] uppercase tracking-wide",
                            t.bias === "bullish" ? "text-emerald-400" : t.bias === "bearish" ? "text-rose-400" : "text-muted-foreground",
                          )}>
                            {t.bias}
                          </span>
                        )}
                      </div>
                      {t.strategyLabel && <span className="text-[10px] text-muted-foreground">{t.strategyLabel}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums flex gap-3 flex-wrap">
                      <span>Entry ${t.entry.toFixed(2)}</span>
                      {t.stop !== null && <span>Stop ${t.stop.toFixed(2)}</span>}
                      {t.target !== null && <span>Target ${t.target.toFixed(2)}</span>}
                      {t.rewardRisk !== null && <span>R:R {t.rewardRisk.toFixed(1)}</span>}
                    </div>
                    {t.thesis && <p className="text-xs text-muted-foreground line-clamp-2">{t.thesis}</p>}
                    <div className="flex gap-1.5 flex-wrap pt-0.5">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        onClick={() => { track("home_radar_view_setup" as any); navigate(`/trade/${t.symbol}`); }}
                        data-testid={`button-radar-${t.symbol}-view-setup`}
                      >
                        View Setup
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => navigate(askRoute(`Analyze ${t.symbol}`))}
                        data-testid={`button-radar-${t.symbol}-analyze`}
                      >
                        Analyze {t.symbol}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ---------- Market Intelligence + boundaries ---------- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card data-testid="card-home-market-intel">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-primary" /> Market Intelligence
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

          {/* Hidden boundaries — see comments above the components */}
          <AiBriefCard />
          <ContinueResearchCard />
        </div>

        <p className="text-xs text-muted-foreground pt-6 border-t leading-relaxed" data-testid="text-home-disclaimer">
          These insights are for educational and informational purposes only. They are not investment advice or personalized
          recommendations. Nothing is traded without your explicit confirmation.
        </p>
      </div>
    </div>
  );
}
